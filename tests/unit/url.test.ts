// Tests for controller URL normalization/validation (src/main/url.ts, used
// by config.ts saveConfig()). Cases live in
// tests/fixtures/config/controller-urls.json.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeControllerUrl } from '../../src/main/url';
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
}); // End of the describe block for normalizeControllerUrl
