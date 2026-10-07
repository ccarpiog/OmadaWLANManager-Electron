// Tests for the renderer's management-access form rules
// (src/renderer/management-form.ts), which mirror the main-process rules of
// src/main/config-model.ts: what a save sends (never an unchanged secret),
// when it is refused, and what the Client Secret placeholder says.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CLIENT_ID_REGEX as MAIN_CLIENT_ID_REGEX } from '../../src/main/config-model';
import {
  CLIENT_ID_REGEX,
  clientSecretAffordance,
  isValidClientId,
  planManagementSave,
  type ManagementFormInput
} from '../../src/renderer/management-form';

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
