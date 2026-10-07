// Tests for the HTTP transport seam (src/main/omada-transport.ts):
// parseOmadaResponse() status/JSON handling, and createHardenedTransport()
// driven by an EventEmitter-based fake of Electron's ClientRequest — header
// order, body write, timeout, 5 MB-style size cap, settle-once semantics and
// late-response discarding. No Electron and no network involved.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';
import {
  createHardenedTransport,
  ERROR_BODY_EXCERPT_CHARS,
  errorBodyExcerpt,
  isUnreachableTransportError,
  MAX_RESPONSE_BYTES,
  parseOmadaResponse,
  REQUEST_TIMEOUT_MS,
  TransportError,
  type ClientRequestLike,
  type IncomingMessageLike,
  type ResponseHeaders,
} from '../../src/main/omada-transport';

/**
 * Fake streaming response (stands in for Electron's IncomingMessage).
 */
class FakeIncomingMessage extends EventEmitter implements IncomingMessageLike {
  statusCode: number;
  headers: ResponseHeaders;

  /**
   * @param {number} statusCode - Status code to report.
   * @param {ResponseHeaders} headers - Response headers to report.
   */
  constructor(statusCode: number, headers: ResponseHeaders = {}) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }
} // End of class FakeIncomingMessage

/**
 * Fake outgoing request (stands in for Electron's ClientRequest). Like the
 * real one, abort() emits 'abort'.
 */
class FakeClientRequest extends EventEmitter implements ClientRequestLike {
  readonly headers: Array<[string, string]> = [];
  readonly written: string[] = [];
  ended = false;
  abortCount = 0;

  /**
   * Records a request header.
   * @param {string} name - Header name.
   * @param {string} value - Header value.
   */
  setHeader(name: string, value: string): void {
    this.headers.push([name, value]);
  }

  /**
   * Records a body chunk.
   * @param {string} chunk - Body chunk.
   */
  write(chunk: string): void {
    this.written.push(chunk);
  }

  /** Marks the request as ended (sent). */
  end(): void {
    this.ended = true;
  }

  /** Aborts the request, emitting 'abort' like Electron does. */
  abort(): void {
    this.abortCount++;
    this.emit('abort');
  }

  /**
   * Simulates the response headers arriving.
   * @param {FakeIncomingMessage} response - The response to deliver.
   */
  respond(response: FakeIncomingMessage): void {
    this.emit('response', response);
  }
} // End of class FakeClientRequest

/**
 * Creates a transport whose factory hands out one FakeClientRequest and
 * remembers the options it was called with.
 * @param {{ timeoutMs?: number; maxResponseBytes?: number }} [limits] - Transport limits.
 * @returns {{ transport: ReturnType<typeof createHardenedTransport>; request: FakeClientRequest; options: Array<{ method: string; url: string }> }}
 */
function setup(limits?: { timeoutMs?: number; maxResponseBytes?: number }) {
  const request = new FakeClientRequest();
  const options: Array<{ method: string; url: string }> = [];
  const transport = createHardenedTransport((requestOptions) => {
    options.push(requestOptions);
    return request;
  }, limits);
  return { transport, request, options };
}

/**
 * Waits for the given number of milliseconds.
 * @param {number} ms - Delay.
 * @returns {Promise<void>}
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('parseOmadaResponse', () => {
  test('parses a 2xx JSON body', () => {
    assert.deepEqual(parseOmadaResponse(200, '{"errorCode":0,"msg":"Success.","result":{"a":1}}'), {
      errorCode: 0,
      msg: 'Success.',
      result: { a: 1 },
    });
    assert.deepEqual(parseOmadaResponse(299, '{"errorCode":0,"msg":""}'), { errorCode: 0, msg: '' });
  });

  test('rejects non-2xx statuses with a bounded excerpt (no JSON parse)', () => {
    assert.throws(() => parseOmadaResponse(404, '<html>Not found</html>'), { message: 'HTTP 404: <html>Not found</html>' });
    assert.throws(() => parseOmadaResponse(500, '{"errorCode":0}'), { message: 'HTTP 500: {"errorCode":0}' });
    assert.throws(() => parseOmadaResponse(199, ''), { message: 'HTTP 199: ' });
    assert.throws(() => parseOmadaResponse(300, 'moved'), { message: 'HTTP 300: moved' });
    const longBody = 'x'.repeat(ERROR_BODY_EXCERPT_CHARS + 50);
    assert.throws(() => parseOmadaResponse(502, longBody), { message: `HTTP 502: ${'x'.repeat(ERROR_BODY_EXCERPT_CHARS)}` });
  });

  test('the excerpt is redacted: tokens, passwords, secrets and cookies never reach the error message', () => {
    const body = '{"errorCode":-1,"password":"hunter2","token":"tok-123","msg":"Cookie: TPOMADA_SESSIONID=sid-9"}';
    assert.throws(() => parseOmadaResponse(500, body), (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      return message.startsWith('HTTP 500: {"errorCode":-1,') && !['hunter2', 'tok-123', 'sid-9'].some((secret) => message.includes(secret));
    });
    assert.throws(() => parseOmadaResponse(200, 'oops client_secret=abc&x=1'), { message: 'Invalid JSON response: oops client_secret=[REDACTED]&x=1' });
    // A value cut by the excerpt boundary is still redacted
    const cut = `${'x'.repeat(ERROR_BODY_EXCERPT_CHARS - 20)} "password":"abcdefghijklmnopqrstuvwxyz"`;
    assert.throws(() => parseOmadaResponse(502, cut), (error: unknown) => error instanceof Error && !error.message.includes('abcdef'));
  });

  test('a secret straddling the 200-char excerpt cut never survives, quoted or not; the body is redacted before it is cut', () => {
    // Each body puts the key before the cut and the secret across it, at
    // several offsets, in every quoting form
    const forms: { make: (secret: string) => string; secret: string; fragments: string[] }[] = [
      { make: (secret) => `password="${secret}" rest`, secret: 'hunter two three', fragments: ['hunter', 'two', 'three'] },
      { make: (secret) => `client_secret='${secret}'; next=1`, secret: 'CS quoted value', fragments: ['CS', 'quoted', 'value'] },
      { make: (secret) => `Authorization: AccessToken=${secret}\r\nHost: c.invalid`, secret: 'AT-straddle-0123456789', fragments: ['AT-', 'straddle', '0123456789'] },
      { make: (secret) => `{"msg":"login failed: password=\\"${secret}\\" rejected"}`, secret: 'pw in json', fragments: ['pw', 'in json'] },
      { make: (secret) => `Cookie: TPOMADA_SESSIONID="${secret}"; Path=/`, secret: 'SID straddle', fragments: ['SID', 'straddle'] },
      { make: (secret) => `auth Bearer "${secret}" rejected`, secret: 'bearer token value', fragments: ['bearer', 'token value'] }
    ];
    for (const form of forms) {
      const pair = form.make(form.secret);
      const secretStart = pair.indexOf(form.secret);
      for (let insideSecret = 1; insideSecret < form.secret.length; insideSecret += 3) {
        // The cut falls `insideSecret` characters into the secret (the
        // filler ends with a space: a key starts at a word boundary)
        const body = `${'x'.repeat(ERROR_BODY_EXCERPT_CHARS - 1 - secretStart - insideSecret)} ${pair}${'y'.repeat(50)}`;
        assert.throws(() => parseOmadaResponse(500, body), (error: unknown) => {
          const message = error instanceof Error ? error.message : '';
          for (const fragment of form.fragments) {
            assert.ok(!message.includes(fragment), `"${fragment}" survived (cut ${insideSecret} chars in): ${message}`);
          }
          assert.ok(message.length <= 'HTTP 500: '.length + ERROR_BODY_EXCERPT_CHARS, message);
          return message.startsWith('HTTP 500: xxx');
        });
      } // End of the loop over the cut offsets
    } // End of the loop over the quoting forms
    assert.equal(errorBodyExcerpt(`${'x'.repeat(185)} password="hunter two three"`), `${'x'.repeat(185)} password="[RED`);
  }); // End of test "a secret straddling the 200-char excerpt cut never survives..."

  test('rejects an unparseable 2xx body with a bounded excerpt', () => {
    assert.throws(() => parseOmadaResponse(200, '<!DOCTYPE html><title>Login</title>'), {
      message: 'Invalid JSON response: <!DOCTYPE html><title>Login</title>',
    });
    assert.throws(() => parseOmadaResponse(200, ''), { message: 'Invalid JSON response: ' });
    const longBody = '<'.repeat(ERROR_BODY_EXCERPT_CHARS + 1);
    assert.throws(() => parseOmadaResponse(200, longBody), {
      message: `Invalid JSON response: ${'<'.repeat(ERROR_BODY_EXCERPT_CHARS)}`,
    });
  });
}); // End of the describe block for parseOmadaResponse

describe('createHardenedTransport', () => {
  test('production limits are 15 s and 5 MB; error excerpts are 200 chars', () => {
    assert.equal(REQUEST_TIMEOUT_MS, 15000);
    assert.equal(MAX_RESPONSE_BYTES, 5 * 1024 * 1024);
    assert.equal(ERROR_BODY_EXCERPT_CHARS, 200);
  });

  test('creates the request, sets headers in order, writes the body and ends', async () => {
    const { transport, request, options } = setup();
    const pending = transport.send(
      {
        method: 'POST',
        url: 'https://controller.invalid:8043/abc/api/v2/login',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Csrf-Token': 't', Cookie: 'a=1' },
        body: '{"username":"u"}',
      },
      () => {}
    );
    assert.deepEqual(options, [{ method: 'POST', url: 'https://controller.invalid:8043/abc/api/v2/login' }]);
    assert.deepEqual(request.headers, [
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
      ['Csrf-Token', 't'],
      ['Cookie', 'a=1'],
    ]);
    assert.deepEqual(request.written, ['{"username":"u"}']);
    assert.equal(request.ended, true);

    const response = new FakeIncomingMessage(200);
    request.respond(response);
    response.emit('end');
    assert.deepEqual(await pending, { statusCode: 200, body: '' });
  }); // End of test "creates the request, sets headers in order, writes the body and ends"

  test('passes PUT and DELETE (and any method) through to the request factory', async () => {
    for (const method of ['PUT', 'DELETE'] as const) {
      const { transport, request, options } = setup();
      const pending = transport.send({ method, url: 'https://c.invalid/openapi/v1/x/sites/s/ap-groups/g', headers: { Authorization: 'AccessToken=t' }, body: method === 'PUT' ? '{"name":"a"}' : undefined }, () => {});
      assert.deepEqual(options, [{ method, url: 'https://c.invalid/openapi/v1/x/sites/s/ap-groups/g' }]);
      assert.deepEqual(request.written, method === 'PUT' ? ['{"name":"a"}'] : []);
      const response = new FakeIncomingMessage(200);
      request.respond(response);
      response.emit('end');
      assert.deepEqual(await pending, { statusCode: 200, body: '' });
    }
  });

  test('writes nothing when there is no body', async () => {
    const { transport, request } = setup();
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/api/info', headers: {} }, () => {});
    assert.deepEqual(request.written, []);
    const response = new FakeIncomingMessage(200);
    request.respond(response);
    response.emit('end');
    await pending;
  });

  test('hands headers over before the body and resolves with status + concatenated chunks', async () => {
    const { transport, request } = setup();
    const events: string[] = [];
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/x', headers: {} }, (headers) => {
      events.push(`headers:${JSON.stringify(headers)}`);
    });
    const response = new FakeIncomingMessage(200, { 'set-cookie': ['TPOMADA_SESSIONID=abc; Path=/'] });
    request.respond(response);
    events.push('data');
    response.emit('data', Buffer.from('{"errorCode":'));
    response.emit('data', Buffer.from('0}'));
    response.emit('end');
    assert.deepEqual(await pending, { statusCode: 200, body: '{"errorCode":0}' });
    assert.deepEqual(events, ['headers:{"set-cookie":["TPOMADA_SESSIONID=abc; Path=/"]}', 'data']);
  }); // End of test "hands headers over before the body and resolves with status + conca..."

  test('resolves non-2xx responses too (status handling is parseOmadaResponse\'s job)', async () => {
    const { transport, request } = setup();
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/x', headers: {} }, () => {});
    const response = new FakeIncomingMessage(503);
    request.respond(response);
    response.emit('data', Buffer.from('Service Unavailable'));
    response.emit('end');
    assert.deepEqual(await pending, { statusCode: 503, body: 'Service Unavailable' });
  });

  test('rejects "Response too large" past the size cap and aborts the request', async () => {
    const { transport, request } = setup({ maxResponseBytes: 10 });
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/x', headers: {} }, () => {});
    const response = new FakeIncomingMessage(200);
    request.respond(response);
    response.emit('data', Buffer.from('12345'));
    response.emit('data', Buffer.from('67890'));
    assert.equal(request.abortCount, 0, 'exactly at the cap is still accepted');
    response.emit('data', Buffer.from('1'));
    await assert.rejects(pending, { message: 'Response too large' });
    assert.equal(request.abortCount, 1);
    // Data and end after the rejection are ignored (settled once)
    response.emit('data', Buffer.from('more'));
    response.emit('end');
  }); // End of test "rejects "Response too large" past the size cap and aborts the request"

  test('rejects with a timeout and aborts when no response arrives in time', async () => {
    const { transport, request } = setup({ timeoutMs: 20 });
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/x', headers: {} }, () => {});
    await assert.rejects(pending, { message: 'Request timeout (0.02s)' });
    assert.equal(request.abortCount, 1);
  });

  test('the timeout also covers a slow body download', async () => {
    const { transport, request } = setup({ timeoutMs: 20 });
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/x', headers: {} }, () => {});
    const response = new FakeIncomingMessage(200);
    request.respond(response);
    response.emit('data', Buffer.from('{"errorCode"'));
    await assert.rejects(pending, { message: 'Request timeout (0.02s)' });
  });

  test('a response arriving after the timeout is discarded (headers never handed over)', async () => {
    const { transport, request } = setup({ timeoutMs: 20 });
    let headersSeen = 0;
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/x', headers: {} }, () => {
      headersSeen++;
    });
    await assert.rejects(pending, { message: 'Request timeout (0.02s)' });
    request.respond(new FakeIncomingMessage(200, { 'set-cookie': 'TPOMADA_SESSIONID=late' }));
    assert.equal(headersSeen, 0);
    assert.equal(request.abortCount, 2, 'the late response is aborted too');
  });

  test('the timer is cleared once settled: no late abort after a successful response', async () => {
    const { transport, request } = setup({ timeoutMs: 20 });
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/x', headers: {} }, () => {});
    const response = new FakeIncomingMessage(200);
    request.respond(response);
    response.emit('end');
    await pending;
    await sleep(40);
    assert.equal(request.abortCount, 0);
  });

  test('a request error is reported as a connection failure', async () => {
    const { transport, request } = setup();
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/x', headers: {} }, () => {});
    request.emit('error', new Error('net::ERR_CONNECTION_REFUSED'));
    await assert.rejects(pending, { message: 'No se pudo conectar al controlador: net::ERR_CONNECTION_REFUSED' });
  });

  test('a response stream error rejects with that error', async () => {
    const { transport, request } = setup();
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/x', headers: {} }, () => {});
    const response = new FakeIncomingMessage(200);
    request.respond(response);
    response.emit('error', new Error('stream reset'));
    await assert.rejects(pending, { message: 'stream reset' });
  });

  test('an abort not initiated by the transport rejects with "Request aborted"', async () => {
    const { transport, request } = setup();
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/x', headers: {} }, () => {});
    request.abort();
    await assert.rejects(pending, { message: 'Request aborted' });
  });

  test('a factory that throws rejects the send', async () => {
    const transport = createHardenedTransport(() => {
      throw new Error('invalid URL');
    });
    await assert.rejects(transport.send({ method: 'GET', url: 'nope', headers: {} }, () => {}), { message: 'invalid URL' });
  });
}); // End of the describe block for createHardenedTransport

describe('typed transport failures and "never answered" (inbox I-1c2a review)', () => {
  /**
   * What the hardened transport rejects with after `emit` runs.
   * @param {(request: FakeClientRequest) => void} emit - Drives the fake request.
   * @param {{ timeoutMs?: number }} [limits] - Transport limits.
   * @returns {Promise<unknown>} The rejection.
   */
  async function rejection(emit: (request: FakeClientRequest) => void, limits?: { timeoutMs?: number }): Promise<unknown> {
    const { transport, request } = setup(limits);
    const pending = transport.send({ method: 'GET', url: 'https://c.invalid/x', headers: {} }, () => {});
    emit(request);
    try {
      await pending;
    } catch (error) {
      return error;
    }
    return 'resolved';
  } // End of function rejection()

  test('a timeout, a request error and an abort reject with a TransportError (kind, net error code, responded); the messages are unchanged', async () => {
    const timeout = await rejection(() => {}, { timeoutMs: 20 });
    assert.ok(timeout instanceof TransportError);
    assert.deepEqual([timeout.message, timeout.kind, timeout.netError, timeout.responded], ['Request timeout (0.02s)', 'timeout', null, false]);
    const refused = await rejection((request) => request.emit('error', new Error('net::ERR_CONNECTION_REFUSED')));
    assert.ok(refused instanceof TransportError);
    assert.deepEqual([refused.message, refused.kind, refused.netError, refused.responded], ['No se pudo conectar al controlador: net::ERR_CONNECTION_REFUSED', 'network', 'ERR_CONNECTION_REFUSED', false]);
    const odd = await rejection((request) => request.emit('error', new Error('socket hang up')));
    assert.ok(odd instanceof TransportError && odd.netError === null);
    const aborted = await rejection((request) => request.emit('abort'));
    assert.ok(aborted instanceof TransportError && aborted.kind === 'aborted');
    // A timeout after the response headers arrived (a slow body): the controller answered
    const slowBody = await rejection((request) => request.respond(new FakeIncomingMessage(200)), { timeoutMs: 20 });
    assert.ok(slowBody instanceof TransportError && slowBody.kind === 'timeout' && slowBody.responded === true);
  }); // End of test "a timeout, a request error and an abort reject with a TransportError..."

  test('isUnreachableTransportError(): a timeout or an unreachable net error before any response; never a certificate / unknown net error, an abort, a slow body, a size cap or a plain error', async () => {
    for (const code of ['ERR_CONNECTION_REFUSED', 'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_TIMED_OUT', 'ERR_ADDRESS_UNREACHABLE', 'ERR_CONNECTION_RESET', 'ERR_INTERNET_DISCONNECTED']) {
      assert.equal(isUnreachableTransportError(await rejection((request) => request.emit('error', new Error(`net::${code}`)))), true, code);
    }
    assert.equal(isUnreachableTransportError(await rejection(() => {}, { timeoutMs: 20 })), true, 'the request timeout');
    for (const code of ['ERR_CERT_AUTHORITY_INVALID', 'ERR_CERT_COMMON_NAME_INVALID', 'ERR_SSL_PROTOCOL_ERROR', 'ERR_FAILED', 'ERR_ABORTED']) {
      assert.equal(isUnreachableTransportError(await rejection((request) => request.emit('error', new Error(`net::${code}`)))), false, code);
    }
    assert.equal(isUnreachableTransportError(await rejection((request) => request.emit('abort'))), false, 'Request aborted');
    assert.equal(isUnreachableTransportError(await rejection((request) => request.respond(new FakeIncomingMessage(200)), { timeoutMs: 20 })), false, 'a slow body');
    const tooLarge = await rejection((request) => {
      const response = new FakeIncomingMessage(200);
      request.respond(response);
      response.emit('data', Buffer.alloc(MAX_RESPONSE_BYTES + 1));
    });
    assert.ok(tooLarge instanceof Error && !(tooLarge instanceof TransportError) && tooLarge.message === 'Response too large');
    assert.equal(isUnreachableTransportError(tooLarge), false);
    // Text alone never counts: a plain Error with the very same message
    assert.equal(isUnreachableTransportError(new Error('Request timeout (15s)')), false);
    assert.equal(isUnreachableTransportError(new Error('No se pudo conectar al controlador: net::ERR_CONNECTION_REFUSED')), false);
  }); // End of test "isUnreachableTransportError()..."
}); // End of the describe block for the typed transport failures
