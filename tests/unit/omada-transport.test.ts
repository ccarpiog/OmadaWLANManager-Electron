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
  MAX_RESPONSE_BYTES,
  parseOmadaResponse,
  REQUEST_TIMEOUT_MS,
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
