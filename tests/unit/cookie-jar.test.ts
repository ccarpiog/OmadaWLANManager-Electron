// Tests for the session cookie jar (src/main/cookie-jar.ts): per-name
// Set-Cookie merge, deletions (empty value, Max-Age <= 0, past Expires),
// and the Cookie request header. Cases live in
// tests/fixtures/cookies/merge-cases.json.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CookieJar } from '../../src/main/cookie-jar';
import mergeFixtures from '../fixtures/cookies/merge-cases.json';

/**
 * Shape of the merge-case fixture file.
 */
interface MergeFixture {
  now: string;
  cases: Array<{
    name: string;
    initial: Record<string, string>;
    setCookie: string | string[];
    expected: Record<string, string>;
  }>;
}

const fixture = mergeFixtures as unknown as MergeFixture;
const fixedNow = Date.parse(fixture.now);

/**
 * Builds the Cookie header a jar holding `cookies` (in insertion order) must produce.
 * @param {Record<string, string>} cookies - Expected jar content.
 * @returns {string} The expected Cookie header value.
 */
function expectedHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
}

describe('CookieJar.merge (fixture cases)', () => {
  test('fixture has cases', () => {
    assert.ok(fixture.cases.length > 0);
  });

  for (const mergeCase of fixture.cases) {
    test(mergeCase.name, () => {
      const jar = new CookieJar(() => fixedNow);
      for (const [name, value] of Object.entries(mergeCase.initial)) {
        jar.merge(`${name}=${value}; Path=/`);
      }
      assert.equal(jar.toHeader(), expectedHeader(mergeCase.initial), 'seeded jar');

      jar.merge(mergeCase.setCookie);

      assert.equal(jar.size, Object.keys(mergeCase.expected).length);
      assert.equal(jar.toHeader(), expectedHeader(mergeCase.expected));
      for (const [name, value] of Object.entries(mergeCase.expected)) {
        assert.equal(jar.get(name), value, `cookie ${name}`);
      }
    }); // End of the per-case merge test
  } // End of the loop that registers one test per merge case
}); // End of the describe block for the fixture cases

describe('CookieJar basics', () => {
  test('a new jar is empty and builds an empty header', () => {
    const jar = new CookieJar();
    assert.equal(jar.size, 0);
    assert.equal(jar.toHeader(), '');
    assert.equal(jar.get('TPOMADA_SESSIONID'), undefined);
  });

  test('clear() removes every cookie', () => {
    const jar = new CookieJar();
    jar.merge(['TPOMADA_SESSIONID=abc', 'lang=en']);
    assert.equal(jar.size, 2);
    jar.clear();
    assert.equal(jar.size, 0);
    assert.equal(jar.toHeader(), '');
  });

  test('the default clock is the real time (far past expires, far future keeps)', () => {
    const jar = new CookieJar();
    jar.merge('keep=1; Expires=Fri, 01 Jan 2100 00:00:00 GMT');
    jar.merge('gone=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    assert.equal(jar.toHeader(), 'keep=1');
  });

  test('the injected clock decides whether an Expires date is past', () => {
    const expires = 'Tue, 06 Oct 2026 12:00:00 GMT';
    const before = new CookieJar(() => Date.parse(expires) - 1);
    before.merge(`TPOMADA_SESSIONID=abc; Expires=${expires}`);
    assert.equal(before.get('TPOMADA_SESSIONID'), 'abc');

    const after = new CookieJar(() => Date.parse(expires) + 1);
    after.merge(`TPOMADA_SESSIONID=abc; Expires=${expires}`);
    assert.equal(after.get('TPOMADA_SESSIONID'), undefined);
  });
}); // End of the describe block for the basics
