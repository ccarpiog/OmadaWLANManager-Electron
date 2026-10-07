// Tests for the central redactor (src/main/redact.ts): every sensitive key
// (case-insensitive, any separator), nested objects and arrays, and the free
// text forms — JSON pairs, query/form/cookie `key=value`, header lines,
// `AccessToken=` and `Bearer` — quoted (double, single, JSON-escaped, with
// whitespace and escaped quotes) or not, plus known secrets by value,
// truncated values and idempotence.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isSensitiveKey, REDACTED, redactErrorMessage, redactText, redactValue } from '../../src/main/redact';

// Every key the spec lists (docs/management-design.md §3) in the spellings
// the controller and HTTP use
const SENSITIVE_KEYS = [
  'password',
  'Password',
  'client_secret',
  'clientSecret',
  'securityKey',
  'psk',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'set-cookie',
  'Set-Cookie',
  'csrf',
  'Csrf-Token',
  'accessToken',
  'access_token',
  'AccessToken',
  'refreshToken',
  'refresh_token',
  'token',
  'TOKEN',
  'TPOMADA_SESSIONID'
];

// Keys that must stay visible (diagnostic value, not secret)
const PLAIN_KEYS = ['errorCode', 'msg', 'name', 'siteId', 'omadacId', 'client_id', 'clientId', 'expiresIn', 'grant_type', 'apNum'];

describe('isSensitiveKey', () => {
  test('every listed key is sensitive, in any case and with any separator', () => {
    for (const key of SENSITIVE_KEYS) {
      assert.equal(isSensitiveKey(key), true, key);
    }
    // Keys that contain a sensitive fragment are covered too
    for (const key of ['pskSetting', 'newPassword', 'x-csrf-token', 'radiusSecret', 'wpaPassphrase']) {
      assert.equal(isSensitiveKey(key), true, key);
    }
  });

  test('ordinary keys are not', () => {
    for (const key of [...PLAIN_KEYS, '', '-']) {
      assert.equal(isSensitiveKey(key), false, key);
    }
  });
}); // End of the describe block for isSensitiveKey

describe('redactValue', () => {
  test('redacts every sensitive key, keeps the rest, never mutates the input', () => {
    const input: Record<string, unknown> = {};
    for (const key of SENSITIVE_KEYS) {
      input[key] = `secret-of-${key}`;
    }
    for (const key of PLAIN_KEYS) {
      input[key] = `value-of-${key}`;
    }
    const snapshot = structuredClone(input);
    const output = redactValue(input) as Record<string, unknown>;
    for (const key of SENSITIVE_KEYS) {
      assert.equal(output[key], REDACTED, key);
    }
    for (const key of PLAIN_KEYS) {
      assert.equal(output[key], `value-of-${key}`, key);
    }
    assert.deepEqual(input, snapshot);
  }); // End of test "redacts every sensitive key, keeps the rest, never mutate..."

  test('walks nested objects and arrays (also non-string secret values)', () => {
    const input = {
      result: {
        data: [
          { name: 'Casa', pskSetting: { securityKey: 'wifi-pass-1' } },
          { name: 'Taller', wpa: { psk: 12345678, keep: 'ok' } },
          [{ refresh_token: 'rt-1' }, { list: [{ Authorization: 'AccessToken=tok-1' }] }]
        ]
      },
      headers: { Cookie: 'TPOMADA_SESSIONID=sess-1', 'Csrf-Token': 'csrf-1', Accept: 'application/json' }
    };
    const output = redactValue(input);
    const serialized = JSON.stringify(output);
    for (const secret of ['wifi-pass-1', '12345678', 'rt-1', 'tok-1', 'sess-1', 'csrf-1']) {
      assert.ok(!serialized.includes(secret), secret);
    }
    assert.deepEqual(output, {
      result: {
        data: [
          { name: 'Casa', pskSetting: REDACTED },
          { name: 'Taller', wpa: { psk: REDACTED, keep: 'ok' } },
          [{ refresh_token: REDACTED }, { list: [{ Authorization: REDACTED }] }]
        ]
      },
      headers: { Cookie: REDACTED, 'Csrf-Token': REDACTED, Accept: 'application/json' }
    });
  }); // End of test "walks nested objects and arrays"

  test('strings inside are redacted as free text; Errors, cycles, depth and functions are handled', () => {
    const cyclic: Record<string, unknown> = { msg: 'url?client_secret=abc123&x=1' };
    cyclic.self = cyclic;
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let level = 0; level < 40; level++) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    const output = redactValue({ cyclic, deep, error: new Error('Bearer tok-9 rejected'), fn: () => 1, n: 5, b: false, nil: null }) as Record<string, unknown>;
    assert.deepEqual((output.cyclic as Record<string, unknown>).msg, `url?client_secret=${REDACTED}&x=1`);
    assert.equal((output.cyclic as Record<string, unknown>).self, '[Circular]');
    assert.ok(JSON.stringify(output.deep).includes('[Truncated]'));
    assert.deepEqual(output.error, { name: 'Error', message: `Bearer ${REDACTED} rejected` });
    assert.equal('fn' in output, false);
    assert.equal(output.n, 5);
    assert.equal(output.b, false);
    assert.equal(output.nil, null);
  }); // End of test "strings inside are redacted as free text..."
}); // End of the describe block for redactValue

describe('redactText', () => {
  test('JSON pairs: string and scalar values of sensitive keys, any spacing, escaped quotes', () => {
    const text = '{"errorCode":0,"result":{"accessToken":"AT-1","tokenType":"bearer","expiresIn":7200,"refreshToken" : "RT-1"},'
      + '"password":"p\\"w","psk":12345678,"client_secret":"CS-1","msg":"ok"}';
    const redacted = redactText(text);
    for (const secret of ['AT-1', 'RT-1', 'p\\"w', '12345678', 'CS-1']) {
      assert.ok(!redacted.includes(secret), secret);
    }
    assert.ok(redacted.includes('"errorCode":0'));
    assert.ok(redacted.includes('"expiresIn":7200'));
    assert.ok(redacted.includes('"msg":"ok"'));
    assert.ok(redacted.includes(`"accessToken":"${REDACTED}"`));
    assert.ok(redacted.includes(`"refreshToken" : "${REDACTED}"`));
  }); // End of test "JSON pairs: string and scalar values of sensitive keys, a..."

  test('query strings, form bodies and cookies: client_secret=, refresh_token=, access_token=, TPOMADA_SESSIONID=', () => {
    // An unquoted value runs to the next delimiter (&, ;, ',', whitespace,
    // end), so a fragment glued to the last value goes with it
    const url = 'https://c.invalid:8043/openapi/authorize/token?grant_type=client_credentials&client_id=abc&client_secret=CS-2&refresh_token=RT-2&access_token=AT-2#x';
    assert.equal(
      redactText(url),
      `https://c.invalid:8043/openapi/authorize/token?grant_type=client_credentials&client_id=abc&client_secret=${REDACTED}&refresh_token=${REDACTED}&access_token=${REDACTED}`
    );
    assert.equal(redactText('TPOMADA_SESSIONID=SID-1; Path=/; HttpOnly'), `TPOMADA_SESSIONID=${REDACTED}; Path=/; HttpOnly`);
    assert.equal(redactText('password = hunter2 and more'), `password = ${REDACTED} and more`);
  });

  test('AccessToken=, Bearer and header-style lines (Authorization, Cookie, Set-Cookie, Csrf-Token)', () => {
    assert.equal(redactText('Authorization: AccessToken=AT-3'), `Authorization: ${REDACTED}`);
    assert.equal(redactText('sent AccessToken=AT-3 to the controller'), `sent AccessToken=${REDACTED} to the controller`);
    assert.equal(redactText('auth Bearer AT-4, retry'), `auth Bearer ${REDACTED}, retry`);
    const headers = 'Accept: application/json\r\nCookie: TPOMADA_SESSIONID=SID-2; other=1\r\nSet-Cookie: TPOMADA_SESSIONID=SID-3\r\nCsrf-Token: CSRF-2\r\nHost: c.invalid';
    const redacted = redactText(headers);
    for (const secret of ['SID-2', 'SID-3', 'CSRF-2', 'other=1']) {
      assert.ok(!redacted.includes(secret), secret);
    }
    assert.ok(redacted.includes('Accept: application/json'));
    assert.ok(redacted.includes('Host: c.invalid'));
  }); // End of test "AccessToken=, Bearer and header-style lines (Authorizatio..."

  test('a value cut by an excerpt boundary is still redacted', () => {
    assert.equal(redactText('{"msg":"x","client_secret":"CS-cut'), `{"msg":"x","client_secret":"${REDACTED}"`);
    assert.equal(redactText('...&access_token=AT-cu'), `...&access_token=${REDACTED}`);
  });

  test('known secrets are removed by value wherever they appear', () => {
    const redacted = redactText('controller said: invalid value s3cr3t-value near tok-77', ['s3cr3t-value', 'tok-77', '', null, undefined]);
    assert.equal(redacted, `controller said: invalid value ${REDACTED} near ${REDACTED}`);
  });

  test('ordinary diagnostics are untouched, and redaction is idempotent', () => {
    for (const text of ['HTTP 502: <html>Bad gateway</html>', 'Request timeout (15s)', 'errorCode -33000 (This site does not exist.)', 'https://192.168.1.130:8043/api/info']) {
      assert.equal(redactText(text), text);
    }
    const samples = [
      'Authorization: Bearer AT-5',
      '{"password":"x","token":5}',
      'a=1&client_secret=y',
      'Cookie: TPOMADA_SESSIONID=z',
      'password="a b" x=1',
      "AccessToken='c d'; y=2",
      '{"msg":"password=\\"e f\\" rejected","errorCode":-1}',
      "{'token': 'g h', 'name': 'n'}",
      'auth Bearer "i j", retry',
      'TPOMADA_SESSIONID="k"; Path=/',
      'password: "l\nm" n\nHost: c.invalid',
      'client_secret="cut value'
    ];
    for (const sample of samples) {
      const once = redactText(sample);
      assert.equal(redactText(once), once, sample);
    }
  }); // End of test "ordinary diagnostics are untouched, and redaction is idem..."

  test('stays fast on long inputs without separators', () => {
    const start = Date.now();
    redactText('x'.repeat(200000));
    redactText('"'.repeat(50000));
    redactText('a:'.repeat(50000));
    // Adversarial repetitions of the quoted, escaped and Bearer forms
    redactText("'a".repeat(100000));
    redactText('password="'.repeat(50000));
    redactText("password='\\".repeat(50000));
    redactText('password=\\"'.repeat(50000));
    redactText('Bearer '.repeat(50000));
    redactText('token: "'.repeat(50000));
    assert.ok(Date.now() - start < 2000);
  }); // End of test "stays fast on long inputs without separators"

  // Every key family the spec lists, in the spellings the controller and HTTP use
  const KEY_FAMILIES = ['password', 'client_secret', 'clientSecret', 'access_token', 'AccessToken', 'refresh_token', 'token', 'TPOMADA_SESSIONID', 'Csrf-Token', 'securityKey', 'psk'];

  /**
   * Asserts that none of the given secret fragments survives in a text.
   * @param {string} text - The redacted text.
   * @param {string[]} fragments - Fragments of the original secret.
   * @param {string} label - Assertion label.
   */
  function assertNoFragments(text: string, fragments: string[], label: string): void {
    for (const fragment of fragments) {
      assert.ok(!text.includes(fragment), `${label}: "${fragment}" survived in ${text}`);
    }
  }

  test('key=value: double- and single-quoted values (whitespace, escaped quotes) for every key family', () => {
    for (const key of KEY_FAMILIES) {
      assert.equal(redactText(`${key}="hunter 2 \\"q\\" end" next=1`), `${key}="${REDACTED}" next=1`, key);
      assert.equal(redactText(`${key}='hunter 2 \\'q\\' end'; next=1`), `${key}='${REDACTED}'; next=1`, key);
      assert.equal(redactText(`x ${key} = "spaced value", next=1`), `x ${key} = "${REDACTED}", next=1`, key);
      assert.equal(redactText(`${key}=""&next=1`), `${key}="${REDACTED}"&next=1`, key);
      assertNoFragments(redactText(`a=1&${key}="se cret \\"in\\" side"&b=2`), ['se cret', 'in\\', 'side'], key);
    } // End of the loop over the key families
  });

  test('key=value: an unterminated quoted value (cut by an excerpt) is redacted to the end of the text', () => {
    for (const key of KEY_FAMILIES) {
      assert.equal(redactText(`err ${key}="cut value with spa`), `err ${key}="${REDACTED}"`, key);
      assert.equal(redactText(`err ${key}='cut value\nnext line`), `err ${key}='${REDACTED}'`, key);
      // A trailing lone backslash (cut inside an escape) goes too
      assert.equal(redactText(`err ${key}="cut\\`), `err ${key}="${REDACTED}"`, key);
      assert.equal(redactText(`err ${key}="`), `err ${key}="${REDACTED}"`, key);
    } // End of the loop over the key families
  });

  test('key=value: an unquoted value runs to the next delimiter (&, ;, comma, whitespace, end), so no tail survives', () => {
    for (const key of KEY_FAMILIES) {
      assert.equal(redactText(`${key}=ab"cd)ef]gh}ij<kl>#mn'op rest`), `${key}=${REDACTED} rest`, key);
      assert.equal(redactText(`${key}=v1&a=1`), `${key}=${REDACTED}&a=1`, key);
      assert.equal(redactText(`${key}=v1;a=1`), `${key}=${REDACTED};a=1`, key);
      assert.equal(redactText(`${key}=v1,a=1`), `${key}=${REDACTED},a=1`, key);
      assert.equal(redactText(`${key}=v1\ta=1`), `${key}=${REDACTED}\ta=1`, key);
      assert.equal(redactText(`${key}=v1`), `${key}=${REDACTED}`, key);
    } // End of the loop over the key families
    // A literal REDACTED with a tail is not mistaken for an already redacted value
    assert.equal(redactText('password=[REDACTED]tail x'), `password=${REDACTED} x`);
  }); // End of test "key=value: an unquoted value runs to the next delimiter..."

  test('key=value with JSON-escaped quotes inside a JSON string (e.g. a controller msg)', () => {
    const body = '{"errorCode":-1,"msg":"login failed: password=\\"hunter 2\\" rejected","result":null}';
    assert.equal(redactText(body), `{"errorCode":-1,"msg":"login failed: password=\\"${REDACTED}\\"","result":null}`);
    assert.equal(redactText('{"msg":"AccessToken=\\"AT \\\\\\" 7\\" x"}'), `{"msg":"AccessToken=\\"${REDACTED}\\""}`);
    // Unterminated (cut by an excerpt)
    assert.equal(redactText('{"msg":"client_secret=\\"CS cut'), `{"msg":"client_secret=\\"${REDACTED}\\"`);
  });

  test('JSON pairs: spaces, escaped quotes, single-quoted keys/values, bare values; objects are still walked into', () => {
    assert.equal(redactText('{"password" :  "a\\"b c", "name":"n"}'), `{"password" :  "${REDACTED}", "name":"n"}`);
    assert.equal(redactText("{'client_secret': 'CS 1', 'name': 'n'}"), `{'client_secret': '${REDACTED}', 'name': 'n'}`);
    assert.equal(redactText("{'Csrf-Token': \"x y\"}"), `{'Csrf-Token': "${REDACTED}"}`);
    assert.equal(redactText('{"token":null,"psk":hunter2,"x":1}'), `{"token":"${REDACTED}","psk":"${REDACTED}","x":1}`);
    assert.equal(
      redactText('{"pskSetting":{"securityKey":"wifi pass","mode":2},"accessToken":"AT 8'),
      `{"pskSetting":{"securityKey":"${REDACTED}","mode":2},"accessToken":"${REDACTED}"`
    );
    assert.equal(redactText('{"refreshToken":"cut\\'), `{"refreshToken":"${REDACTED}"`);
  });

  test('header and cookie forms: quoted values, AccessToken= and Bearer in headers, multi-line and unterminated quotes', () => {
    assert.equal(redactText('Authorization: AccessToken="AT 1"'), `Authorization: ${REDACTED}`);
    assert.equal(redactText("Authorization: AccessToken='AT 1'\r\nHost: c.invalid"), `Authorization: ${REDACTED}\r\nHost: c.invalid`);
    assert.equal(redactText('Authorization: Bearer "AT 2" trailing\nAccept: */*'), `Authorization: ${REDACTED}\nAccept: */*`);
    assert.equal(redactText('Cookie: TPOMADA_SESSIONID="SID 1"; other=1'), `Cookie: ${REDACTED}`);
    assert.equal(redactText("Set-Cookie: TPOMADA_SESSIONID='SID 2'; Path=/"), `Set-Cookie: ${REDACTED}`);
    assert.equal(redactText('TPOMADA_SESSIONID="SID 3"; Path=/; HttpOnly'), `TPOMADA_SESSIONID="${REDACTED}"; Path=/; HttpOnly`);
    // A quoted header value runs through its closing quote, even across lines
    assert.equal(redactText('password: "line 1\nline 2" after\nHost: c.invalid'), `password: ${REDACTED}\nHost: c.invalid`);
    assert.equal(redactText('Csrf-Token: "cut\nstill secret'), `Csrf-Token: ${REDACTED}`);
    assert.equal(redactText('X-Token: [REDACTED] tail\nHost: h'), `X-Token: ${REDACTED}\nHost: h`);
  }); // End of test "header and cookie forms: quoted values, AccessToken= and..."

  test('Bearer: quoted, single-quoted, unterminated and unquoted values leave no tail', () => {
    assert.equal(redactText('auth Bearer "AT 3" rejected'), `auth Bearer "${REDACTED}" rejected`);
    assert.equal(redactText("auth Bearer 'AT 4', retry"), `auth Bearer '${REDACTED}', retry`);
    assert.equal(redactText('auth Bearer "AT 5 cut'), `auth Bearer "${REDACTED}"`);
    assert.equal(redactText('auth Bearer AT-6"tail)x rest'), `auth Bearer ${REDACTED} rest`);
    assert.equal(redactText('auth bearer\tAT-7'), `auth bearer\t${REDACTED}`);
  });

  test('redactErrorMessage() redacts an Error or a thrown value', () => {
    assert.equal(redactErrorMessage(new Error('bad client_secret=abc')), `bad client_secret=${REDACTED}`);
    assert.equal(redactErrorMessage('Bearer AT-6'), `Bearer ${REDACTED}`);
    assert.equal(redactErrorMessage(new Error('leaked tok-8'), ['tok-8']), `leaked ${REDACTED}`);
  });
}); // End of the describe block for redactText
