// Tests for the renderer's boundary validation (src/renderer/validation.ts,
// a DOM-free module): the controller-URL mirror must accept and reject exactly
// what the main process does (same fixture as tests/unit/url.test.ts), and the
// certificate details of a connect result must be format-checked before they
// reach the DOM, and the group listing must carry a group array, a known group
// model (else the legacy default) and a sane controller version. Management
// capabilities and their replies fail closed (only known reason codes, flags
// on only without a reason, main's codes-only diagnostic), and the site name
// and session nonce of a connect result are size-checked.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isSameControllerUrl as mainIsSameControllerUrl, normalizeControllerUrl } from '../../src/main/url';
import {
  isManagementReason,
  isSameControllerUrl,
  isValidFingerprint,
  parseCertificateDetails,
  parseGroupListing,
  parseManagementCapabilities,
  parseManagementResult,
  parseSessionNonce,
  parseSiteName,
  validateControllerUrl
} from '../../src/renderer/validation';
import { FINGERPRINT_REGEX } from '../../src/main/cert-pinning';
import urlFixtures from '../fixtures/config/controller-urls.json';

/**
 * Shape of the URL fixture file.
 */
interface UrlFixture {
  valid: Array<{ name: string; input: string; expected: string }>;
  invalid: Array<{ name: string; input: string }>;
}

const fixture = urlFixtures as unknown as UrlFixture;
const FINGERPRINT_A = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0').toUpperCase()).join(':');
const FINGERPRINT_B = Array.from({ length: 32 }, () => 'AB').join(':');

describe('validateControllerUrl (renderer mirror of normalizeControllerUrl)', () => {
  for (const validCase of fixture.valid) {
    test(`normalizes like main: ${validCase.name}`, () => {
      assert.equal(validateControllerUrl(validCase.input), validCase.expected);
      assert.equal(validateControllerUrl(validCase.input), normalizeControllerUrl(validCase.input));
    });
  }

  for (const invalidCase of fixture.invalid) {
    test(`rejects like main: ${invalidCase.name}`, () => {
      assert.equal(validateControllerUrl(invalidCase.input), null);
      assert.equal(normalizeControllerUrl(invalidCase.input), null);
    });
  }
}); // End of the describe block for validateControllerUrl

describe('isSameControllerUrl (renderer mirror)', () => {
  test('agrees with the main-process check on every pair of fixture inputs', () => {
    const inputs = [...fixture.valid.map((entry) => entry.input), ...fixture.invalid.map((entry) => entry.input), ''];
    for (const stored of inputs) {
      for (const candidate of inputs) {
        assert.equal(isSameControllerUrl(stored, candidate), mainIsSameControllerUrl(stored, candidate), `${stored} vs ${candidate}`);
      }
    }
  });
}); // End of the describe block for isSameControllerUrl

describe('certificate details validation', () => {
  test('the renderer fingerprint pattern matches the main-process one', () => {
    assert.equal(isValidFingerprint(FINGERPRINT_A), true);
    assert.equal(FINGERPRINT_REGEX.test(FINGERPRINT_A), true);
    for (const bad of [FINGERPRINT_A.toLowerCase(), FINGERPRINT_A.replace(/:/g, ''), `${FINGERPRINT_A}:00`, FINGERPRINT_A.slice(3), '', 42, null]) {
      assert.equal(isValidFingerprint(bad), false, String(bad));
      assert.equal(typeof bad === 'string' && FINGERPRINT_REGEX.test(bad), false, String(bad));
    }
  });

  test('first-use details: host + fingerprint accepted, extra fields dropped', () => {
    assert.deepEqual(
      parseCertificateDetails({ host: '192.168.1.130:8043', fingerprint: FINGERPRINT_A, extra: '<b>x</b>' }, false),
      { host: '192.168.1.130:8043', fingerprint: FINGERPRINT_A }
    );
  });

  test('changed details require a well-formed pinned fingerprint too', () => {
    assert.deepEqual(
      parseCertificateDetails({ host: 'h:1', fingerprint: FINGERPRINT_B, pinnedFingerprint: FINGERPRINT_A }, true),
      { host: 'h:1', fingerprint: FINGERPRINT_B, pinnedFingerprint: FINGERPRINT_A }
    );
    assert.equal(parseCertificateDetails({ host: 'h:1', fingerprint: FINGERPRINT_B }, true), null);
    assert.equal(parseCertificateDetails({ host: 'h:1', fingerprint: FINGERPRINT_B, pinnedFingerprint: 'nope' }, true), null);
  });

  test('malformed details are rejected', () => {
    for (const raw of [null, undefined, 'x', 42, {}, { host: '', fingerprint: FINGERPRINT_A }, { host: 'h', fingerprint: 'zz' },
      { host: 'x'.repeat(301), fingerprint: FINGERPRINT_A }, { host: 7, fingerprint: FINGERPRINT_A }]) {
      assert.equal(parseCertificateDetails(raw, false), null, JSON.stringify(raw));
    }
  });
}); // End of the describe block for certificate details validation

describe('group listing validation (parseGroupListing)', () => {
  const groups = [{ wlanId: '6512a0e1f3b2c41d2e3f4a5e', wlanName: 'zNinguna', ssidList: [] }];

  test('accepts an AP-groups listing as is', () => {
    assert.deepEqual(parseGroupListing({ controllerVersion: '6.3.0.45', groupModel: 'apGroup', groups }), {
      controllerVersion: '6.3.0.45', groupModel: 'apGroup', groups,
    });
  });

  test('keeps the legacy model and a null version', () => {
    assert.deepEqual(parseGroupListing({ controllerVersion: null, groupModel: 'wlanGroup', groups: [] }), {
      controllerVersion: null, groupModel: 'wlanGroup', groups: [],
    });
  });

  test('an unknown or missing group model becomes the legacy one (defensive default)', () => {
    for (const groupModel of ['APGROUP', 'apgroup', '', 1, null, undefined]) {
      assert.equal(parseGroupListing({ controllerVersion: '6.3.0.45', groupModel, groups }).groupModel, 'wlanGroup', String(groupModel));
    }
  });

  test('a non-string, empty or oversized version becomes null', () => {
    for (const controllerVersion of [6.3, '', '9'.repeat(65), { major: 6 }]) {
      assert.equal(parseGroupListing({ controllerVersion, groupModel: 'apGroup', groups }).controllerVersion, null);
    }
    assert.equal(parseGroupListing({ controllerVersion: '9'.repeat(64), groupModel: 'apGroup', groups }).controllerVersion, '9'.repeat(64));
  });

  test('a listing without a group array throws (a load error, never an empty list)', () => {
    for (const raw of [null, undefined, 'listing', [], { groupModel: 'apGroup' }, { groupModel: 'apGroup', groups: {} }, groups]) {
      assert.throws(() => parseGroupListing(raw), { message: 'Unsupported group listing' });
    }
  });
}); // End of the describe block for parseGroupListing

describe('management capabilities and replies', () => {
  const on = { manageApGroups: true, manageWifiNetworks: true, reason: null };

  test('every reason code main reports is known; anything else is not', () => {
    for (const reason of ['legacyController', 'managementNotConfigured', 'invalidCredentials', 'tokenFailed', 'siteNotFound', 'apGroupsMismatch', 'probeFailed']) {
      assert.equal(isManagementReason(reason), true, reason);
    }
    for (const value of ['managementChecking', 'toString', '__proto__', 'ok', '', null, 3]) {
      assert.equal(isManagementReason(value), false, String(value));
    }
  });

  test('management on only with both flags true and no reason; a reason forces both flags off', () => {
    assert.deepEqual(parseManagementCapabilities(on), on);
    assert.deepEqual(parseManagementCapabilities({ manageApGroups: true, manageWifiNetworks: true, reason: 'siteNotFound' }), {
      manageApGroups: false, manageWifiNetworks: false, reason: 'siteNotFound',
    });
  });

  test('malformed capabilities are rejected (null): unknown reason, non-boolean flags, no reason with a flag off', () => {
    for (const raw of [
      null, 'on', [], {},
      { ...on, reason: 'managementChecking' },
      { ...on, reason: undefined },
      { ...on, manageApGroups: 'true' },
      { ...on, manageWifiNetworks: 1 },
      { ...on, manageWifiNetworks: false },
    ]) {
      assert.equal(parseManagementCapabilities(raw), null, JSON.stringify(raw));
    }
  }); // End of test "malformed capabilities are rejected..."

  test('the diagnostic is kept only in main\'s codes-and-counts form', () => {
    const off = { manageApGroups: false, manageWifiNetworks: false, reason: 'tokenFailed' };
    assert.equal(parseManagementCapabilities({ ...off, diagnostic: 'httpError, HTTP 404' })?.diagnostic, 'httpError, HTTP 404');
    assert.equal(parseManagementCapabilities({ ...off, diagnostic: 'ap-groups: apiError, errorCode -44106' })?.diagnostic, 'ap-groups: apiError, errorCode -44106');
    for (const diagnostic of ['<b>x</b>', 'client_secret="abc"', 'x'.repeat(161), '', 42]) {
      assert.equal(parseManagementCapabilities({ ...off, diagnostic })?.diagnostic, undefined, String(diagnostic));
    }
  });

  test('replies: capabilities, notConnected, superseded, or invalid', () => {
    assert.deepEqual(parseManagementResult({ success: true, capabilities: on }), { ok: true, capabilities: on });
    assert.deepEqual(parseManagementResult({ success: false, error: 'notConnected' }), { ok: false, error: 'notConnected' });
    assert.deepEqual(parseManagementResult({ success: false, error: 'superseded' }), { ok: false, error: 'superseded' });
    for (const raw of [null, undefined, 'ok', { success: true }, { success: true, capabilities: { reason: 'x' } }, { success: false, error: 'other' }, { success: 'true', capabilities: on }]) {
      assert.deepEqual(parseManagementResult(raw), { ok: false, error: 'invalid' }, JSON.stringify(raw));
    }
  });

  test('the site name and the session nonce of a connect result are size-checked strings', () => {
    assert.equal(parseSiteName('Casa'), 'Casa');
    assert.equal(parseSiteName('x'.repeat(256)), 'x'.repeat(256));
    for (const raw of ['', 'x'.repeat(257), 7, null, undefined]) {
      assert.equal(parseSiteName(raw), null, String(raw));
    }
    assert.equal(parseSessionNonce('a'.repeat(32)), 'a'.repeat(32));
    for (const raw of ['', 'a'.repeat(65), 32, null, undefined]) {
      assert.equal(parseSessionNonce(raw), null, String(raw));
    }
  });
}); // End of the describe block for management capabilities and replies
