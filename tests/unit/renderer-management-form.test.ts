// Tests for the renderer's management-access form rules
// (src/renderer/management-form.ts), which mirror the main-process rules of
// src/main/config-model.ts: what a save sends (never an unchanged secret),
// when it is refused, and what the Client Secret placeholder says; plus what
// "Test management access" reports and when it refuses unsaved changes, and
// how the session's capabilities follow a check run: unknown (so the
// read-only banner says "checking" and no AP-group write action exists) from
// the moment a run that may change the verdict starts, late replies
// discarded, a reply without capabilities failing closed.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CLIENT_ID_REGEX as MAIN_CLIENT_ID_REGEX } from '../../src/main/config-model';
import type { ManagementCapabilities } from '../../src/shared/types';
import {
  CAPABILITIES_UNAVAILABLE,
  CLIENT_ID_REGEX,
  clientSecretAffordance,
  hasUnsavedManagementChanges,
  isValidClientId,
  managementTestOutcome,
  planManagementSave,
  settleCapabilityCheck,
  startCapabilityCheck,
  type CapabilityCheckState,
  type ManagementFormInput
} from '../../src/renderer/management-form';
import { readOnlyReason } from '../../src/renderer/view-state';

// Every check passed: management on
const ON: ManagementCapabilities = { manageApGroups: true, manageWifiNetworks: true, reason: null };
// A failing check: management off with its reason and diagnostic
const INVALID_CREDENTIALS: ManagementCapabilities = { manageApGroups: false, manageWifiNetworks: false, reason: 'invalidCredentials', diagnostic: 'invalidCredentials, errorCode -44106' };

/**
 * What the AP groups view decides from the record: readOnlyReason() (the
 * banner) with data of an Omada 6.3+ controller on screen — null means
 * management on, i.e. the write actions are shown (isGroupManagementOn()).
 * @param {CapabilityCheckState} record - The capabilities record.
 * @returns {string | null} The banner's reason, or null.
 */
function bannerOf(record: CapabilityCheckState): string | null {
  return readOnlyReason({ hasData: true, groupModel: 'apGroup', capabilities: record.capabilities });
}

/**
 * Builds a form input: nothing stored, same URL, empty fields.
 * @param {Partial<ManagementFormInput>} overrides - Fields to change.
 * @returns {ManagementFormInput} The input.
 */
function input(overrides: Partial<ManagementFormInput>): ManagementFormInput {
  return { removeStaged: false, clientIdField: '', clientSecretField: '', storedClientId: '', hasClientSecret: false, sameUrl: true, ...overrides };
}

describe('planManagementSave', () => {
  test('nothing typed and nothing stored: no management fields (the payload is unchanged)', () => {
    assert.deepEqual(planManagementSave(input({})), { ok: true, fields: {} });
    assert.deepEqual(planManagementSave(input({ sameUrl: false })), { ok: true, fields: {} });
  });

  test('a typed Client ID and secret are sent (Client ID trimmed, secret verbatim)', () => {
    assert.deepEqual(planManagementSave(input({ clientIdField: '  my-client ', clientSecretField: ' s3cret ' })), {
      ok: true,
      fields: { clientId: 'my-client', clientSecret: ' s3cret ' }
    });
  });

  test('blank secret with the stored Client ID on the same controller: nothing is sent (kept as stored)', () => {
    assert.deepEqual(planManagementSave(input({ clientIdField: 'my-client', storedClientId: 'my-client', hasClientSecret: true })), { ok: true, fields: {} });
    // Also when only the Client ID is stored (its session-only secret was lost)
    assert.deepEqual(planManagementSave(input({ clientIdField: 'my-client', storedClientId: 'my-client' })), { ok: true, fields: {} });
  });

  test('a new Client ID or a new controller URL needs a typed secret', () => {
    assert.deepEqual(planManagementSave(input({ clientIdField: 'other', storedClientId: 'my-client', hasClientSecret: true })), { ok: false, error: 'clientSecretRequired' });
    assert.deepEqual(planManagementSave(input({ clientIdField: 'my-client', storedClientId: 'my-client', hasClientSecret: true, sameUrl: false })), {
      ok: false,
      error: 'clientSecretRequired'
    });
    assert.deepEqual(planManagementSave(input({ clientIdField: 'first-client' })), { ok: false, error: 'clientSecretRequired' });
  });

  test('a secret without a Client ID, or blanking a stored Client ID (Remove is the way), is clientIdRequired', () => {
    assert.deepEqual(planManagementSave(input({ clientSecretField: 's3cret' })), { ok: false, error: 'clientIdRequired' });
    assert.deepEqual(planManagementSave(input({ storedClientId: 'my-client', hasClientSecret: true })), { ok: false, error: 'clientIdRequired' });
    assert.deepEqual(planManagementSave(input({ hasClientSecret: true })), { ok: false, error: 'clientIdRequired' });
    // On a URL change a blank Client ID is fine: main drops the old credentials
    assert.deepEqual(planManagementSave(input({ storedClientId: 'my-client', hasClientSecret: true, sameUrl: false })), { ok: true, fields: {} });
  });

  test('an implausible Client ID is invalidClientId', () => {
    for (const clientIdField of ['has space', 'a/b', 'x'.repeat(129), 'ñ']) {
      assert.deepEqual(planManagementSave(input({ clientIdField, clientSecretField: 's' })), { ok: false, error: 'invalidClientId' }, clientIdField);
    }
  });

  test('a staged removal sends removeManagementAccess alone, whatever the fields hold', () => {
    assert.deepEqual(planManagementSave(input({ removeStaged: true, clientIdField: 'x', clientSecretField: 'y', storedClientId: 'x', hasClientSecret: true })), {
      ok: true,
      fields: { removeManagementAccess: true }
    });
  });
}); // End of the describe block for planManagementSave

describe('clientSecretAffordance', () => {
  test('"(unchanged)" only for a stored secret, the same controller and the stored Client ID', () => {
    const stored = { hasClientSecret: true, sameUrl: true, clientIdField: ' my-client ', storedClientId: 'my-client' };
    assert.equal(clientSecretAffordance(stored), 'unchanged');
    assert.equal(clientSecretAffordance({ ...stored, sameUrl: false }), 'requiredNewUrl');
    assert.equal(clientSecretAffordance({ ...stored, clientIdField: 'other' }), 'requiredNewClientId');
    assert.equal(clientSecretAffordance({ ...stored, clientIdField: '' }), 'none');
    assert.equal(clientSecretAffordance({ ...stored, hasClientSecret: false }), 'none');
  });
});

describe('Client ID format', () => {
  test('the renderer mirror matches the main-process rule', () => {
    assert.equal(CLIENT_ID_REGEX.source, MAIN_CLIENT_ID_REGEX.source);
    assert.equal(isValidClientId(' abc-123_X.y '), true);
    assert.equal(isValidClientId(''), false);
  });
});

describe('Test management access', () => {
  const saved = { removeStaged: false, clientIdField: ' my-client ', clientSecretField: '', storedClientId: 'my-client', sameUrl: true };

  test('the saved settings as shown: nothing unsaved (the Client ID is compared trimmed)', () => {
    assert.equal(hasUnsavedManagementChanges(saved), false);
    assert.equal(hasUnsavedManagementChanges({ ...saved, clientIdField: '', storedClientId: '' }), false);
  });

  test('a staged removal, a typed secret, another Client ID or another controller URL are unsaved', () => {
    assert.equal(hasUnsavedManagementChanges({ ...saved, removeStaged: true }), true);
    assert.equal(hasUnsavedManagementChanges({ ...saved, clientSecretField: 's3cret' }), true);
    assert.equal(hasUnsavedManagementChanges({ ...saved, clientIdField: 'other-client' }), true);
    assert.equal(hasUnsavedManagementChanges({ ...saved, sameUrl: false }), true);
  });

  test('the outcome: ok, the reason of the failing check, or main\'s refusal; a malformed reply is "failed"', () => {
    assert.equal(managementTestOutcome({ ok: true, capabilities: { manageApGroups: true, manageWifiNetworks: true, reason: null } }), 'ok');
    assert.equal(managementTestOutcome({ ok: true, capabilities: { manageApGroups: false, manageWifiNetworks: false, reason: 'apGroupsMismatch' } }), 'apGroupsMismatch');
    assert.equal(managementTestOutcome({ ok: false, error: 'notConnected' }), 'notConnected');
    assert.equal(managementTestOutcome({ ok: false, error: 'superseded' }), 'superseded');
    assert.equal(managementTestOutcome({ ok: false, error: 'invalid' }), 'failed');
  });
}); // End of the describe block for Test management access

describe('capability check runs (fail closed)', () => {
  const managing: CapabilityCheckState = { capabilities: ON, check: 4 };

  test('a run that may change the verdict ("Test management access", a connection\'s checks) clears the capabilities as it starts: the banner says "checking" and no write action is offered', () => {
    assert.equal(bannerOf(managing), null);
    const started = startCapabilityCheck(managing, false);
    assert.deepEqual(started, { capabilities: null, check: 5 });
    assert.equal(bannerOf(started), 'managementChecking');
    // From a failing verdict too: unknown, not the old reason
    assert.deepEqual(startCapabilityCheck({ capabilities: INVALID_CREDENTIALS, check: 0 }, false), { capabilities: null, check: 1 });
  });

  test('a re-read (after an AP-group write) keeps a known verdict while main is asked; unknown stays unknown', () => {
    assert.deepEqual(startCapabilityCheck(managing, true), { capabilities: ON, check: 5 });
    assert.deepEqual(startCapabilityCheck({ capabilities: null, check: 9 }, true), { capabilities: null, check: 10 });
  });

  test('a failing result settles off with its reason (the banner states it; still no write action); a passing one turns management on', () => {
    const started = startCapabilityCheck(managing, false);
    const failed = settleCapabilityCheck(started, started.check, { ok: true, capabilities: INVALID_CREDENTIALS });
    assert.deepEqual(failed, { capabilities: INVALID_CREDENTIALS, check: started.check });
    assert.equal(failed === null ? null : bannerOf(failed), 'invalidCredentials');
    const passed = settleCapabilityCheck(started, started.check, { ok: true, capabilities: ON });
    assert.deepEqual(passed, { capabilities: ON, check: started.check });
    assert.equal(passed === null ? 'late' : bannerOf(passed), null);
  });

  test('a reply without capabilities (unreadable, the call threw, notConnected / superseded) fails closed with "probeFailed", never the verdict from before the run', () => {
    const started = startCapabilityCheck(managing, false);
    for (const result of [{ ok: false, error: 'invalid' }, { ok: false, error: 'notConnected' }, { ok: false, error: 'superseded' }] as const) {
      const settled = settleCapabilityCheck(started, started.check, result);
      assert.deepEqual(settled, { capabilities: { ...CAPABILITIES_UNAVAILABLE }, check: started.check }, result.error);
      assert.equal(settled === null ? null : bannerOf(settled), 'probeFailed', result.error);
    }
    // Also after a re-read that kept the old verdict on screen
    const reread = startCapabilityCheck(managing, true);
    assert.deepEqual(settleCapabilityCheck(reread, reread.check, { ok: false, error: 'invalid' })?.capabilities, { ...CAPABILITIES_UNAVAILABLE });
  });

  test('a late reply (a newer run started since) is discarded, whatever it says: the newer run\'s state stays', () => {
    const first = startCapabilityCheck(managing, false);
    const second = startCapabilityCheck(first, false);
    assert.equal(settleCapabilityCheck(second, first.check, { ok: true, capabilities: ON }), null);
    assert.equal(settleCapabilityCheck(second, first.check, { ok: true, capabilities: INVALID_CREDENTIALS }), null);
    assert.equal(bannerOf(second), 'managementChecking');
    assert.deepEqual(settleCapabilityCheck(second, second.check, { ok: true, capabilities: ON }), { capabilities: ON, check: second.check });
  });

  test('the settled capabilities are a copy (the reply object is not kept)', () => {
    const reply = { ...ON };
    const settled = settleCapabilityCheck({ capabilities: null, check: 1 }, 1, { ok: true, capabilities: reply });
    assert.notEqual(settled?.capabilities, reply);
    assert.ok(Object.isFrozen(CAPABILITIES_UNAVAILABLE));
  });
}); // End of the describe block for capability check runs
