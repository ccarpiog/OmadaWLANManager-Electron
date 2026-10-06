// Tests for controller URL normalization/validation (src/main/url.ts, used
// by config.ts saveConfig()). Cases live in
// tests/fixtures/config/controller-urls.json.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isSameControllerUrl, normalizeControllerUrl } from '../../src/main/url';
import urlFixtures from '../fixtures/config/controller-urls.json';

/**
 * Shape of the URL fixture file.
 */
interface UrlFixture {
  valid: Array<{ name: string; input: string; expected: string }>;
  invalid: Array<{ name: string; input: string }>;
  nonString: unknown[];
}

const fixture = urlFixtures as unknown as UrlFixture;

describe('normalizeControllerUrl', () => {
  for (const validCase of fixture.valid) {
    test(`normalizes: ${validCase.name} (${JSON.stringify(validCase.input)})`, () => {
      assert.equal(normalizeControllerUrl(validCase.input), validCase.expected);
    });
  }

  for (const invalidCase of fixture.invalid) {
    test(`rejects: ${invalidCase.name} (${JSON.stringify(invalidCase.input)})`, () => {
      assert.equal(normalizeControllerUrl(invalidCase.input), null);
    });
  }

  test('rejects non-string input (null, number, boolean, object, array, undefined)', () => {
    for (const value of [...fixture.nonString, undefined]) {
      assert.equal(normalizeControllerUrl(value), null, `input ${JSON.stringify(value)}`);
    }
  });

  test('normalization is idempotent for every valid case', () => {
    for (const validCase of fixture.valid) {
      assert.equal(normalizeControllerUrl(validCase.expected), validCase.expected, validCase.name);
    }
  });

  test('every normalized URL is https and has no trailing slash', () => {
    for (const validCase of fixture.valid) {
      const normalized = normalizeControllerUrl(validCase.input);
      assert.ok(normalized?.startsWith('https://'), validCase.name);
      assert.ok(!normalized?.endsWith('/'), validCase.name);
    }
  });

  test('an empty fragment is rejected, never kept as a trailing "#"', () => {
    assert.equal(normalizeControllerUrl('https://192.168.1.1:8043/#'), null);
    assert.equal(normalizeControllerUrl('https://192.168.1.1:8043#'), null);
    for (const validCase of fixture.valid) {
      assert.ok(!normalizeControllerUrl(validCase.input)?.includes('#'), validCase.name);
    }
  });
}); // End of the describe block for normalizeControllerUrl

describe('isSameControllerUrl', () => {
  test('same URL, and equal after normalization (legacy trailing slash, case, default port)', () => {
    assert.equal(isSameControllerUrl('https://192.168.1.130:8043', 'https://192.168.1.130:8043'), true);
    assert.equal(isSameControllerUrl('https://192.168.1.130:8043/', 'https://192.168.1.130:8043'), true);
    assert.equal(isSameControllerUrl('HTTPS://Omada.Example.com:443/', 'https://omada.example.com'), true);
  });

  test('a different host, port, scheme or path is a different controller', () => {
    assert.equal(isSameControllerUrl('https://192.168.1.130:8043', 'https://192.168.1.131:8043'), false);
    assert.equal(isSameControllerUrl('https://192.168.1.130:8043', 'https://192.168.1.130:443'), false);
    assert.equal(isSameControllerUrl('https://omada.example.com/a', 'https://omada.example.com/b'), false);
    assert.equal(isSameControllerUrl('http://192.168.1.130:8043', 'https://192.168.1.130:8043'), false);
  });

  test('an empty or invalid stored URL never matches', () => {
    assert.equal(isSameControllerUrl('', 'https://192.168.1.130:8043'), false);
    assert.equal(isSameControllerUrl('not a url', 'not a url'), false);
    assert.equal(isSameControllerUrl('https://192.168.1.130:8043/#', 'https://192.168.1.130:8043'), false);
  });
}); // End of the describe block for isSameControllerUrl
