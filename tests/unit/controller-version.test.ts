// Tests for the controller-version rule (src/main/controller-version.ts,
// docs/management-design.md §2.2): 6.3 and later -> 'apGroup'; older versions
// and, defensively, missing or unparseable versions -> 'wlanGroup'.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MAX_CONTROLLER_VERSION_LENGTH,
  describeController,
  groupModelForVersion,
  normalizeControllerVersion,
  parseControllerVersion,
} from '../../src/main/controller-version';

describe('groupModelForVersion: 6.3 and later use the AP-groups model', () => {
  for (const version of ['6.3', '6.3.0', '6.3.0.45', '6.3.1.2', '6.4.0.1', '6.10.0.3', '7.0', '10.0.0.1', '06.03.0']) {
    test(`"${version}" -> apGroup`, () => {
      assert.equal(groupModelForVersion(normalizeControllerVersion(version)), 'apGroup');
    });
  }
}); // End of the describe block for versions >= 6.3

describe('groupModelForVersion: older controllers use the legacy WLAN-groups model', () => {
  for (const version of ['6.2.9.99', '6.2', '6.1.0.19', '6.0.0.25', '5.15.24.18', '5.9', '4.4.6', '0.3']) {
    test(`"${version}" -> wlanGroup`, () => {
      assert.equal(groupModelForVersion(normalizeControllerVersion(version)), 'wlanGroup');
    });
  }
}); // End of the describe block for versions < 6.3

describe('unknown or garbage versions fall back to the legacy model (defensive default)', () => {
  const garbage: Array<{ name: string; raw: unknown }> = [
    { name: 'absent', raw: undefined },
    { name: 'null', raw: null },
    { name: 'a number', raw: 6.3 },
    { name: 'an object', raw: { major: 6, minor: 3 } },
    { name: 'an empty string', raw: '' },
    { name: 'blank', raw: '   ' },
    { name: 'a word', raw: 'banana' },
    { name: 'a single number', raw: '6' },
    { name: 'a "v" prefix', raw: 'v6.3.0' },
    { name: 'a pre-release suffix', raw: '6.3.0-beta' },
    { name: 'a wildcard part', raw: '6.x' },
    { name: 'a trailing dot', raw: '6.3.' },
    { name: 'an oversized part', raw: '6.3333333333' },
    { name: 'a negative part', raw: '6.-3' },
    { name: 'a control character', raw: '6.3\u0000' },
    { name: 'non-ASCII digits', raw: '６.３' },
    { name: 'an oversized string', raw: `6.3.${'1.'.repeat(40)}1` },
  ];
  for (const { name, raw } of garbage) {
    test(`${name} -> wlanGroup`, () => {
      assert.equal(describeController(raw).groupModel, 'wlanGroup');
    });
  }
}); // End of the describe block for garbage versions

describe('normalizeControllerVersion / parseControllerVersion / describeController', () => {
  test('keeps a sane version string (trimmed), even an unparseable one', () => {
    assert.equal(normalizeControllerVersion(' 6.3.0.45 '), '6.3.0.45');
    assert.equal(normalizeControllerVersion('banana'), 'banana');
  });

  test('drops non-strings, blank strings, control characters and oversized strings', () => {
    assert.equal(normalizeControllerVersion(6.3), null);
    assert.equal(normalizeControllerVersion('  '), null);
    assert.equal(normalizeControllerVersion('6.3\n'), '6.3', 'surrounding whitespace is trimmed');
    assert.equal(normalizeControllerVersion('6.\u00073'), null);
    assert.equal(normalizeControllerVersion('9'.repeat(MAX_CONTROLLER_VERSION_LENGTH)), '9'.repeat(MAX_CONTROLLER_VERSION_LENGTH));
    assert.equal(normalizeControllerVersion('9'.repeat(MAX_CONTROLLER_VERSION_LENGTH + 1)), null);
  });

  test('parses only major.minor[.more] numbers', () => {
    assert.deepEqual(parseControllerVersion('6.3.0.45'), { major: 6, minor: 3 });
    assert.deepEqual(parseControllerVersion('5.15'), { major: 5, minor: 15 });
    assert.equal(parseControllerVersion('6'), null);
    assert.equal(parseControllerVersion(null), null);
  });

  test('describeController keeps the version and derives the model', () => {
    assert.deepEqual(describeController('6.3.0.45'), { controllerVersion: '6.3.0.45', groupModel: 'apGroup' });
    assert.deepEqual(describeController('5.15.24.18'), { controllerVersion: '5.15.24.18', groupModel: 'wlanGroup' });
    assert.deepEqual(describeController('banana'), { controllerVersion: 'banana', groupModel: 'wlanGroup' });
    assert.deepEqual(describeController(undefined), { controllerVersion: null, groupModel: 'wlanGroup' });
  });
}); // End of the describe block for the helpers
