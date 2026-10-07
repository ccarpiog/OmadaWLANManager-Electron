// Tests for the renderer's TP-Link cloud form and reply rules
// (src/renderer/cloud-form.ts, inbox item I-1c1): the mirrors of main's
// regions and Client ID format, the cloud flags read from a config, what a
// save sends (never an unchanged secret) and when it is refused — checked
// against main's applyConfigSave() over a matrix of stored and typed states —
// the cloud secret placeholder, the unsaved-changes guard of "Test cloud
// access", the validation of a cloud:test reply (main's own DTOs accepted,
// anything malformed refused), the code → text mapping (a refused
// credential refined by TP-Link's errorCode, unknown codes shown with their
// message), the es / en texts of every outcome, reason and save code, and the
// late-reply guard; and (inbox I-1c2a) the local controller's omadacId of a
// cloud reply (malformed → absent) with the "This network" mark, and the
// cloud-only save of a configuration without a local controller, checked
// against main's applyConfigSave() over a matrix.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CLOUD_REGIONS as MAIN_CLOUD_REGIONS, DEFAULT_CLOUD_REGION as MAIN_DEFAULT_REGION } from '../../src/main/cloud-hosts';
import { toCloudController, validateCloudOrganization } from '../../src/main/cloud-account-model';
import { applyConfigSave, cloudAccessStatus, CLIENT_ID_REGEX as MAIN_CLIENT_ID_REGEX, type SecretBox, type StoredConfig } from '../../src/main/config-model';
import type { CloudAccessError, CloudController, CloudControllerReason, CloudRegion, ConfigSavePayload } from '../../src/shared/types';
import {
  CLOUD_REASON_TEXT,
  CLOUD_REGIONS,
  CLOUD_SAVE_ERROR_TEXT,
  CLOUD_TEST_TEXT,
  DEFAULT_CLOUD_REGION,
  NO_CLOUD_ACCESS,
  cloudControllerStatusKey,
  cloudSaveErrorKey,
  cloudSecretAffordance,
  cloudTestOutcome,
  cloudTestSummaryKey,
  cloudTestTone,
  hasUnsavedCloudChanges,
  isCloudControllerId,
  isCloudOnlyForm,
  isCloudRegion,
  isCloudTestCurrent,
  isLocalDuplicate,
  parseCloudAccessResult,
  parseCloudAccessStatus,
  parseCloudController,
  parseCloudDiagnostic,
  parseLocalOmadacId,
  planCloudOnlySave,
  planCloudSave,
  tpLinkErrorCode,
  type CloudFormInput,
  type CloudTestDisplay,
  type ParsedCloudResult,
} from '../../src/renderer/cloud-form';
import { CLIENT_ID_REGEX } from '../../src/renderer/management-form';
import { formatMessage, translations, type Translations } from '../../src/renderer/i18n-strings';
import fourOrganizations from '../fixtures/cloud/organizations-four.json';

const URL_A = 'https://192.168.1.130:8043';
const TYPED_SECRET = 'typed-cloud-secret-1';

/**
 * A reversible fake SecretBox (as in config-cloud.test.ts; no Electron).
 * @returns {SecretBox} The fake.
 */
function fakeBox(): SecretBox {
  return {
    isEncryptionAvailable: () => true,
    isSecureStorageAvailable: () => true,
    encryptString: (plainText) => Buffer.from(`enc:${plainText}`).toString('base64'),
    decryptString: (blob) => {
      const decoded = Buffer.from(blob, 'base64').toString();
      if (!decoded.startsWith('enc:')) {
        throw new Error('undecryptable');
      }
      return decoded.slice(4);
    },
  };
} // End of function fakeBox()

const box = fakeBox();

/**
 * Builds a form input: nothing stored, the default region, empty fields.
 * @param {Partial<CloudFormInput>} overrides - Fields to change.
 * @returns {CloudFormInput} The input.
 */
function input(overrides: Partial<CloudFormInput>): CloudFormInput {
  return {
    removeStaged: false,
    regionField: 'euw',
    clientIdField: '',
    clientSecretField: '',
    storedRegion: 'euw',
    storedClientId: '',
    hasCloudSecret: false,
    ...overrides,
  };
}

/**
 * The four controller DTOs main builds from the organization fixture.
 * @returns {CloudController[]} The DTOs.
 */
function mainDtos(): CloudController[] {
  return fourOrganizations.page.result.data.map((entry) => toCloudController(validateCloudOrganization(entry)));
}

describe('mirrors of the main-process rules', () => {
  test('the regions, the default region and the Client ID format are main\'s', () => {
    assert.deepEqual([...CLOUD_REGIONS], [...MAIN_CLOUD_REGIONS]);
    assert.equal(DEFAULT_CLOUD_REGION, MAIN_DEFAULT_REGION);
    assert.equal(CLIENT_ID_REGEX.source, MAIN_CLIENT_ID_REGEX.source);
    assert.ok(CLOUD_REGIONS.every((region) => isCloudRegion(region)));
    assert.ok(!isCloudRegion('EUW') && !isCloudRegion('') && !isCloudRegion(undefined) && !isCloudRegion('us'));
  });
});

describe('parseCloudAccessStatus', () => {
  test('missing or malformed flags read as nothing stored', () => {
    assert.deepEqual(parseCloudAccessStatus(undefined), NO_CLOUD_ACCESS);
    assert.deepEqual(parseCloudAccessStatus(null), NO_CLOUD_ACCESS);
    assert.deepEqual(parseCloudAccessStatus('euw'), NO_CLOUD_ACCESS);
    assert.deepEqual(
      parseCloudAccessStatus({ region: 'mars', clientId: 'not an id', hasCloudSecret: 'yes', cloudSecretSessionOnly: 1, canPersistCloudSecret: false, activeController: '../x' }),
      { ...NO_CLOUD_ACCESS, canPersistCloudSecret: false }
    );
  });

  test('main\'s flags are kept as reported, and nothing else is copied', () => {
    const flags = { region: 'aps', clientId: 'cloud-client-1', hasCloudSecret: true, cloudSecretSessionOnly: true, canPersistCloudSecret: true, activeController: '4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d' };
    assert.deepEqual(parseCloudAccessStatus({ ...flags, clientSecret: 'leaked' }), flags);
  });

  test('main\'s renderer view of a stored credential passes unchanged', () => {
    const stored: StoredConfig = {
      url: URL_A, username: 'admin', language: 'es', encryptedPassword: box.encryptString('pw'),
      cloudRegion: 'use', cloudClientId: 'cloud-client-9', encryptedCloudClientSecret: box.encryptString('s'),
    };
    const status = cloudAccessStatus(stored, box, null);
    assert.deepEqual(parseCloudAccessStatus(status), status);
  });
});

describe('planCloudSave', () => {
  test('a staged removal sends removeCloudAccess alone, whatever the fields hold', () => {
    assert.deepEqual(
      planCloudSave(input({ removeStaged: true, regionField: 'aps', clientIdField: 'x', clientSecretField: 'y', storedClientId: 'x', hasCloudSecret: true })),
      { ok: true, fields: { removeCloudAccess: true } }
    );
  });

  test('nothing typed and nothing stored sends nothing; another region alone sends only the region', () => {
    assert.deepEqual(planCloudSave(input({})), { ok: true, fields: {} });
    assert.deepEqual(planCloudSave(input({ regionField: 'use' })), { ok: true, fields: { cloudRegion: 'use' } });
  });

  test('a blank Client ID with a typed secret, or with a stored credential, is cloudClientIdRequired', () => {
    assert.deepEqual(planCloudSave(input({ clientSecretField: TYPED_SECRET })), { ok: false, error: 'cloudClientIdRequired' });
    assert.deepEqual(planCloudSave(input({ storedClientId: 'cloud-client-1', hasCloudSecret: true })), { ok: false, error: 'cloudClientIdRequired' });
    assert.deepEqual(planCloudSave(input({ hasCloudSecret: true })), { ok: false, error: 'cloudClientIdRequired' });
  });

  test('an implausible Client ID is invalidCloudClientId', () => {
    assert.deepEqual(planCloudSave(input({ clientIdField: 'has space', clientSecretField: TYPED_SECRET })), { ok: false, error: 'invalidCloudClientId' });
    assert.deepEqual(planCloudSave(input({ clientIdField: 'x'.repeat(129) })), { ok: false, error: 'invalidCloudClientId' });
  });

  test('a typed secret sends the region, the trimmed Client ID and the secret', () => {
    assert.deepEqual(planCloudSave(input({ regionField: 'aps', clientIdField: '  cloud-client-1  ', clientSecretField: TYPED_SECRET })), {
      ok: true,
      fields: { cloudRegion: 'aps', cloudClientId: 'cloud-client-1', cloudClientSecret: TYPED_SECRET },
    });
  });

  test('a blank secret keeps the stored one only for the same region and Client ID', () => {
    const stored = { storedRegion: 'aps' as CloudRegion, storedClientId: 'cloud-client-1', hasCloudSecret: true };
    assert.deepEqual(planCloudSave(input({ ...stored, regionField: 'aps', clientIdField: ' cloud-client-1 ' })), { ok: true, fields: {} });
    assert.deepEqual(planCloudSave(input({ ...stored, regionField: 'euw', clientIdField: 'cloud-client-1' })), { ok: false, error: 'cloudClientSecretRequired' });
    assert.deepEqual(planCloudSave(input({ ...stored, regionField: 'aps', clientIdField: 'cloud-client-2' })), { ok: false, error: 'cloudClientSecretRequired' });
    assert.deepEqual(planCloudSave(input({ clientIdField: 'cloud-client-new' })), { ok: false, error: 'cloudClientSecretRequired' });
  });

  test('a region field that is not a region reads as the stored region', () => {
    assert.deepEqual(planCloudSave(input({ storedRegion: 'aps', regionField: 'mars' })), { ok: true, fields: {} });
  });

  test('agrees with main\'s applyConfigSave() over a matrix of stored and typed states (the renderer is stricter only for a blank Client ID while a credential is stored)', () => {
    const base = { url: URL_A, username: 'admin', language: 'es' as const };
    const storedStates: StoredConfig[] = [
      { url: URL_A, username: 'admin', language: 'es', encryptedPassword: box.encryptString('pw') },
      { url: URL_A, username: 'admin', language: 'es', encryptedPassword: box.encryptString('pw'), cloudRegion: 'aps', cloudClientId: 'cloud-client-1', encryptedCloudClientSecret: box.encryptString('stored-secret') },
      { url: URL_A, username: 'admin', language: 'es', encryptedPassword: box.encryptString('pw'), cloudClientId: 'cloud-client-1' },
    ];
    let compared = 0;
    for (const stored of storedStates) {
      const status = cloudAccessStatus(stored, box, null);
      for (const regionField of [status.region, status.region === 'aps' ? 'use' : 'aps']) {
        for (const clientIdField of ['', '  cloud-client-1 ', 'cloud-client-2', 'bad id!']) {
          for (const clientSecretField of ['', TYPED_SECRET]) {
            const form = input({ regionField, clientIdField, clientSecretField, storedRegion: status.region, storedClientId: status.clientId, hasCloudSecret: status.hasCloudSecret });
            const plan = planCloudSave(form);
            const label = JSON.stringify({ stored: status, regionField, clientIdField, clientSecretField });
            if (plan.ok) {
              const outcome = applyConfigSave(stored, { ...base, ...plan.fields }, box);
              assert.ok(outcome.ok, `main refused an accepted plan: ${label}`);
              if (!outcome.ok) continue;
              if (plan.fields.cloudClientSecret !== undefined) {
                assert.equal(outcome.config.cloudClientId, clientIdField.trim(), label);
                assert.equal(box.decryptString(outcome.config.encryptedCloudClientSecret ?? ''), TYPED_SECRET, label);
              } else {
                assert.equal(outcome.config.cloudClientId, stored.cloudClientId, label);
                assert.equal(outcome.config.encryptedCloudClientSecret, stored.encryptedCloudClientSecret, label);
              }
              assert.equal(outcome.config.cloudRegion ?? 'euw', regionField, label);
            } else if (clientIdField.trim() === '' && clientSecretField === '' && (status.clientId !== '' || status.hasCloudSecret)) {
              // Stricter on purpose (like management access): "Remove cloud access" removes
              assert.equal(plan.error, 'cloudClientIdRequired', label);
            } else {
              const naive: ConfigSavePayload = { ...base, cloudRegion: regionField as CloudRegion };
              if (clientIdField.trim() !== '') naive.cloudClientId = clientIdField;
              if (clientSecretField !== '') naive.cloudClientSecret = clientSecretField;
              const outcome = applyConfigSave(stored, naive, box);
              assert.ok(!outcome.ok && outcome.error === plan.error, `main disagrees (${outcome.ok ? 'ok' : outcome.error} vs ${plan.error}): ${label}`);
            }
            compared++;
          } // End of the loop over the typed secrets
        } // End of the loop over the Client ID fields
      } // End of the loop over the region fields
    } // End of the loop over the stored states
    assert.equal(compared, 3 * 2 * 4 * 2);
  });
});

describe('cloudSecretAffordance', () => {
  const stored = { hasCloudSecret: true, storedRegion: 'aps' as CloudRegion, storedClientId: 'cloud-client-1' };

  test('"(unchanged)" only for the stored region and Client ID with a secret stored', () => {
    assert.equal(cloudSecretAffordance({ ...stored, regionField: 'aps', clientIdField: ' cloud-client-1 ' }), 'unchanged');
    assert.equal(cloudSecretAffordance({ ...stored, regionField: 'euw', clientIdField: 'cloud-client-1' }), 'requiredNewRegion');
    assert.equal(cloudSecretAffordance({ ...stored, regionField: 'aps', clientIdField: 'cloud-client-2' }), 'requiredNewClientId');
  });

  test('nothing without a stored secret or with a blank Client ID', () => {
    assert.equal(cloudSecretAffordance({ ...stored, hasCloudSecret: false, regionField: 'aps', clientIdField: 'cloud-client-1' }), 'none');
    assert.equal(cloudSecretAffordance({ ...stored, regionField: 'aps', clientIdField: '  ' }), 'none');
  });
});

describe('hasUnsavedCloudChanges', () => {
  const clean = { removeStaged: false, regionField: 'aps', clientIdField: 'cloud-client-1', clientSecretField: '', storedRegion: 'aps' as CloudRegion, storedClientId: 'cloud-client-1' };

  test('the saved state is clean (a Client ID differing only by spaces too)', () => {
    assert.equal(hasUnsavedCloudChanges(clean), false);
    assert.equal(hasUnsavedCloudChanges({ ...clean, clientIdField: ' cloud-client-1 ' }), false);
    assert.equal(hasUnsavedCloudChanges({ ...clean, regionField: 'mars' }), false);
  });

  test('a staged removal, a typed secret, another Client ID or another region is unsaved', () => {
    assert.equal(hasUnsavedCloudChanges({ ...clean, removeStaged: true }), true);
    assert.equal(hasUnsavedCloudChanges({ ...clean, clientSecretField: 's' }), true);
    assert.equal(hasUnsavedCloudChanges({ ...clean, clientIdField: 'cloud-client-2' }), true);
    assert.equal(hasUnsavedCloudChanges({ ...clean, clientIdField: '' }), true);
    assert.equal(hasUnsavedCloudChanges({ ...clean, regionField: 'euw' }), true);
  });
});

describe('parseCloudAccessResult', () => {
  test('main\'s own DTOs (the four-organization fixture) are accepted unchanged', () => {
    const controllers = mainDtos();
    assert.deepEqual(controllers, fourOrganizations.expected);
    assert.deepEqual(parseCloudAccessResult({ success: true, controllers, truncated: false }), { ok: true, controllers, truncated: false });
    assert.deepEqual(parseCloudAccessResult({ success: true, controllers: [], truncated: true }), { ok: true, controllers: [], truncated: true });
    assert.deepEqual(parseCloudAccessResult({ success: true, controllers: [] }), { ok: true, controllers: [], truncated: false });
  });

  test('a malformed controller rejects the whole reply; only the six DTO fields are copied', () => {
    const good = mainDtos()[3];
    const invalid = { ok: false, error: 'invalid', code: null, diagnostic: null };
    const broken: unknown[] = [
      { ...good, omadacId: 'local' },
      { ...good, omadacId: 'has space' },
      { ...good, name: '‮\u0007' },
      { ...good, name: 'x'.repeat(129) },
      { ...good, version: 6.3 },
      { ...good, version: '' },
      { ...good, reason: 'sleeping', connectable: false },
      { ...good, connectable: false },
      { ...good, reason: 'offline' },
      { ...good, online: 'yes' },
      null,
    ];
    for (const entry of broken) {
      assert.deepEqual(parseCloudAccessResult({ success: true, controllers: [entry], truncated: false }), invalid, JSON.stringify(entry));
    }
    assert.deepEqual(parseCloudController({ ...good, deviceId: 'A1', serverHost: 'https://x' }), good);
    assert.deepEqual(parseCloudController({ ...good, name: ' ‎OC200\u0000 ' }), { ...good, name: 'OC200' });
    assert.deepEqual(parseCloudAccessResult({ success: true, controllers: 'none' }), invalid);
    assert.deepEqual(parseCloudAccessResult({ success: true, controllers: [], truncated: 'no' }), invalid);
    assert.deepEqual(parseCloudAccessResult({ success: true, controllers: Array.from({ length: 1001 }, () => good) }), invalid);
  });

  test('a failure keeps a known code, an unknown code-shaped one as "unknown", and refuses anything else', () => {
    assert.deepEqual(parseCloudAccessResult({ success: false, error: 'rateLimited', diagnostic: 'rateLimited, errorCode -7132' }), {
      ok: false, error: 'rateLimited', code: 'rateLimited', diagnostic: 'rateLimited, errorCode -7132',
    });
    assert.deepEqual(parseCloudAccessResult({ success: false, error: 'notConfigured' }), { ok: false, error: 'notConfigured', code: 'notConfigured', diagnostic: null });
    assert.deepEqual(parseCloudAccessResult({ success: false, error: 'quotaExceeded', diagnostic: 'errorCode -90114' }), {
      ok: false, error: 'unknown', code: 'quotaExceeded', diagnostic: 'errorCode -90114',
    });
    for (const raw of [null, 'ok', {}, { success: 'false', error: 'timeout' }, { success: false }, { success: false, error: 'not a code' }, { success: false, error: 42 }]) {
      assert.deepEqual(parseCloudAccessResult(raw), { ok: false, error: 'invalid', code: null, diagnostic: null }, JSON.stringify(raw));
    }
  });

  test('a diagnostic keeps printable text up to main\'s cap, without control or bidirectional characters', () => {
    assert.equal(parseCloudDiagnostic('apiError, organization list failed: errorCode -44121 (no permission)'), 'apiError, organization list failed: errorCode -44121 (no permission)');
    assert.equal(parseCloudDiagnostic('timeout\u0000‮'), 'timeout');
    assert.equal(parseCloudDiagnostic('x'.repeat(201)), null);
    assert.equal(parseCloudDiagnostic('   '), null);
    assert.equal(parseCloudDiagnostic(42), null);
  });
});

describe('cloudTestOutcome (code → what the result line shows)', () => {
  /**
   * A failure reply as parseCloudAccessResult() returns it.
   * @param {CloudAccessError} error - The code.
   * @param {string | null} diagnostic - Main's diagnostic.
   * @returns {ParsedCloudResult} The parsed reply.
   */
  function failure(error: CloudAccessError, diagnostic: string | null): ParsedCloudResult {
    return { ok: false, error, code: error, diagnostic };
  }

  test('a success lists the controllers; a malformed reply is "failed"', () => {
    const controllers = mainDtos();
    assert.deepEqual(cloudTestOutcome({ ok: true, controllers, truncated: true }), { display: 'ok', detail: null, controllers, truncated: true });
    assert.deepEqual(cloudTestOutcome({ ok: false, error: 'invalid', code: null, diagnostic: null }), { display: 'failed', detail: null, controllers: [], truncated: false });
  });

  test('every known code has its own display with main\'s diagnostic as the detail', () => {
    const codes: CloudAccessError[] = ['notConfigured', 'superseded', 'tokenRejected', 'rateLimited', 'timeout', 'networkError', 'malformedResponse', 'httpError', 'apiError'];
    for (const code of codes) {
      assert.deepEqual(cloudTestOutcome(failure(code, `${code}, HTTP 503`)), { display: code, detail: `${code}, HTTP 503`, controllers: [], truncated: false });
    }
    assert.equal(cloudTestOutcome(failure('rateLimited', 'rateLimited, errorCode -7132')).display, 'rateLimited');
  });

  test('a refused credential is refined by TP-Link\'s errorCode: -52602 / -90112 expired or deleted, -90113 disabled, -90106 wrong; others generic', () => {
    const cases: Array<[string | null, CloudTestDisplay]> = [
      ['credentialInvalid, errorCode -52602', 'credentialExpired'],
      ['credentialInvalid, errorCode -90112', 'credentialExpired'],
      ['credentialInvalid, errorCode -90113', 'credentialDisabled'],
      ['credentialInvalid, errorCode -90106', 'credentialWrong'],
      ['credentialInvalid, errorCode -44116', 'credentialInvalid'],
      ['credentialInvalid, HTTP 401', 'credentialInvalid'],
      ['credentialInvalid, errorCode -525021', 'credentialInvalid'],
      [null, 'credentialInvalid'],
    ];
    for (const [diagnostic, display] of cases) {
      assert.deepEqual(cloudTestOutcome(failure('credentialInvalid', diagnostic)), { display, detail: diagnostic, controllers: [], truncated: false }, String(diagnostic));
    }
  });

  test('an unknown code is shown as the code plus its message (the diagnostic alone when it starts with the code)', () => {
    assert.equal(cloudTestOutcome({ ok: false, error: 'unknown', code: 'quotaExceeded', diagnostic: 'errorCode -90114 (too many)' }).detail, 'quotaExceeded: errorCode -90114 (too many)');
    assert.equal(cloudTestOutcome({ ok: false, error: 'unknown', code: 'quotaExceeded', diagnostic: 'quotaExceeded, errorCode -90114' }).detail, 'quotaExceeded, errorCode -90114');
    assert.deepEqual(cloudTestOutcome({ ok: false, error: 'unknown', code: 'quotaExceeded', diagnostic: null }), { display: 'unknownError', detail: 'quotaExceeded', controllers: [], truncated: false });
  });

  test('tpLinkErrorCode reads the errorCode out of a diagnostic', () => {
    assert.equal(tpLinkErrorCode('credentialInvalid, errorCode -52602'), -52602);
    assert.equal(tpLinkErrorCode('apiError, token request failed: errorCode -90114 (x)'), -90114);
    assert.equal(tpLinkErrorCode('httpError, HTTP 503'), null);
    assert.equal(tpLinkErrorCode(null), null);
  });

  test('the tone: ok, busy while testing, info for what asks the user to act first, off for failures', () => {
    assert.equal(cloudTestTone('ok'), 'ok');
    assert.equal(cloudTestTone('testing'), 'busy');
    for (const display of ['unsavedChanges', 'notConfigured', 'superseded'] as const) assert.equal(cloudTestTone(display), 'info');
    for (const display of ['rateLimited', 'credentialExpired', 'unknownError', 'failed', 'apiError'] as const) assert.equal(cloudTestTone(display), 'off');
  });
});

describe('texts (es and en)', () => {
  /**
   * Asserts a key has a non-empty text in both languages, different between them.
   * @param {keyof Translations} key - The key.
   */
  function assertBilingual(key: keyof Translations): void {
    assert.ok(translations.es[key].trim() !== '', `es ${key}`);
    assert.ok(translations.en[key].trim() !== '', `en ${key}`);
    assert.notEqual(translations.es[key], translations.en[key], key);
  }

  test('every display but "ok" has its text; the success summary depends on the count', () => {
    for (const key of Object.values(CLOUD_TEST_TEXT)) assertBilingual(key);
    assert.equal(new Set(Object.values(CLOUD_TEST_TEXT)).size, Object.keys(CLOUD_TEST_TEXT).length);
    assert.equal(cloudTestSummaryKey(0), 'cloudTestOkNone');
    assert.equal(cloudTestSummaryKey(1), 'cloudTestOkOne');
    assert.equal(cloudTestSummaryKey(4), 'cloudTestOkMany');
    assert.equal(formatMessage(translations.es.cloudTestOkMany, { count: '4' }), 'El acceso a la nube funciona: se encontraron 4 controladores.');
    assert.equal(formatMessage(translations.en.cloudTestOkMany, { count: '4' }), 'Cloud access works: 4 controllers found.');
    for (const key of ['cloudTestOkNone', 'cloudTestOkOne', 'cloudTestTruncated', 'cloudControllersLabel'] as const) assertBilingual(key);
  });

  test('rate limiting and an expired or deleted credential have specific texts', () => {
    assert.match(translations.en.cloudTestRateLimited, /too many requests/);
    assert.match(translations.es.cloudTestRateLimited, /demasiadas solicitudes/);
    assert.match(translations.en.cloudTestCredentialExpired, /expired or no longer exists/);
    assert.match(translations.es.cloudTestCredentialExpired, /caducado o ya no existe/);
  });

  test('every controller reason has a status text; a connectable controller reads "available"', () => {
    const reasons: CloudControllerReason[] = ['notController', 'incompleteEntry', 'unsupportedHost', 'versionUnknown', 'versionTooOld', 'offline'];
    assert.deepEqual(Object.keys(CLOUD_REASON_TEXT).sort(), [...reasons].sort());
    for (const reason of reasons) {
      const controller: CloudController = { omadacId: 'a1', name: 'n', online: reason !== 'offline', version: null, connectable: false, reason };
      assert.equal(cloudControllerStatusKey(controller), CLOUD_REASON_TEXT[reason]);
      assertBilingual(CLOUD_REASON_TEXT[reason]);
    }
    const available: CloudController = { omadacId: 'a1', name: 'n', online: true, version: '6.3.0.45', connectable: true, reason: null };
    assert.equal(cloudControllerStatusKey(available), 'cloudControllerAvailable');
    assertBilingual('cloudControllerAvailable');
  });

  test('the three cloud save codes map to their own texts (not the management ones); any other code to none', () => {
    for (const code of ['invalidCloudClientId', 'cloudClientIdRequired', 'cloudClientSecretRequired'] as const) {
      const key = cloudSaveErrorKey(code);
      assert.equal(key, CLOUD_SAVE_ERROR_TEXT[code]);
      assert.ok(key !== null);
      assertBilingual(key);
      assert.match(translations.en[key], /TP-Link cloud/);
      assert.match(translations.es[key], /nube de TP-Link/);
    }
    for (const other of ['invalidClientId', 'saveFailed', 'passwordRequired', undefined, 7, '__proto__']) {
      assert.equal(cloudSaveErrorKey(other), null, String(other));
    }
  });

  test('the section\'s static texts exist in both languages', () => {
    const keys: Array<keyof Translations> = [
      'cloudTitle', 'cloudHelp', 'cloudCredentialHelp', 'cloudRegion', 'cloudRegionAps', 'cloudRegionEuw', 'cloudRegionUse',
      'cloudSecretRequiredNewRegion', 'cloudSessionOnly', 'cloudRemove', 'cloudRemoveConfirm', 'cloudRemoveAction',
      'cloudRemovalPending', 'cloudUndoRemoval', 'cloudSavedSessionOnly', 'cloudTest',
    ];
    for (const key of keys) assertBilingual(key);
    assert.match(translations.en.cloudCredentialHelp, /Account Level Open API/);
    assert.match(translations.en.cloudCredentialHelp, /full access/);
    assert.match(translations.es.cloudCredentialHelp, /acceso completo/);
  });
});

describe('isCloudTestCurrent', () => {
  test('a reply is shown only for the latest run while Settings is open', () => {
    assert.equal(isCloudTestCurrent(3, 3, true), true);
    assert.equal(isCloudTestCurrent(3, 4, true), false);
    assert.equal(isCloudTestCurrent(3, 3, false), false);
  });
});

describe('the local controller\'s omadacId in a cloud reply (inbox I-1c2a)', () => {
  const LOCAL_ID = 'c0ffee00c0ffee00c0ffee00c0ffee00';

  test('parseLocalOmadacId() / isCloudControllerId(): an omadacId as main sends it; anything else is absent (null), never a crash', () => {
    assert.equal(parseLocalOmadacId(LOCAL_ID), LOCAL_ID);
    for (const raw of [undefined, null, '', 'local', 'has space', 'x'.repeat(65), 7, {}, ['a']]) {
      assert.equal(parseLocalOmadacId(raw), null, JSON.stringify(raw));
    }
    assert.equal(isCloudControllerId('4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d'), true);
    assert.equal(isCloudControllerId('local'), false);
  });

  test('parseCloudAccessResult() keeps a well-formed localOmadacId on a success and drops a malformed one without refusing the reply', () => {
    const controllers = mainDtos();
    assert.deepEqual(parseCloudAccessResult({ success: true, controllers, truncated: false, localOmadacId: LOCAL_ID }), { ok: true, controllers, truncated: false, localOmadacId: LOCAL_ID });
    for (const bad of ['local', '', 'a b', 42, null]) {
      assert.deepEqual(parseCloudAccessResult({ success: true, controllers, truncated: false, localOmadacId: bad }), { ok: true, controllers, truncated: false }, JSON.stringify(bad));
    }
    assert.deepEqual(parseCloudAccessResult({ success: false, error: 'rateLimited', localOmadacId: LOCAL_ID }), { ok: false, error: 'rateLimited', code: 'rateLimited', diagnostic: null });
  });

  test('cloudTestOutcome() passes it on; isLocalDuplicate() names the controller Settings marks "This network"', () => {
    const controllers = mainDtos();
    const outcome = cloudTestOutcome({ ok: true, controllers, truncated: false, localOmadacId: controllers[0].omadacId });
    assert.equal(outcome.localOmadacId, controllers[0].omadacId);
    assert.equal('localOmadacId' in cloudTestOutcome({ ok: true, controllers, truncated: false }), false);
    assert.deepEqual(controllers.map((controller) => isLocalDuplicate(controller, outcome.localOmadacId)), [true, false, false, false]);
    assert.ok(controllers.every((controller) => !isLocalDuplicate(controller, undefined) && !isLocalDuplicate(controller, null) && !isLocalDuplicate(controller, 'local')));
  });
});

describe('a configuration without a local controller: the cloud-only save (inbox I-1c2a)', () => {
  const NO_LOCAL = { urlField: '', usernameField: '', passwordField: '', storedUrl: '' };

  test('isCloudOnlyForm(): URL, username and password blank AND no local controller stored (main\'s isCloudOnlySave())', () => {
    assert.equal(isCloudOnlyForm(NO_LOCAL), true);
    assert.equal(isCloudOnlyForm({ ...NO_LOCAL, urlField: '  ', usernameField: ' ' }), true);
    assert.equal(isCloudOnlyForm({ ...NO_LOCAL, urlField: URL_A }), false);
    assert.equal(isCloudOnlyForm({ ...NO_LOCAL, usernameField: 'admin' }), false);
    assert.equal(isCloudOnlyForm({ ...NO_LOCAL, passwordField: ' ' }), false, 'any typed password is a local section');
    assert.equal(isCloudOnlyForm({ ...NO_LOCAL, storedUrl: URL_A }), false, 'a stored local controller is never emptied this way');
  });

  test('planCloudOnlySave(): typed management fields need a controller; the cloud plan; nothing configured is the empty form', () => {
    const blank = { managementRemoveStaged: false, managementClientIdField: '', managementSecretField: '' };
    assert.deepEqual(planCloudOnlySave({ ...blank, managementClientIdField: 'mgmt-1', cloud: input({ clientIdField: 'c', clientSecretField: 's' }) }), { ok: false, error: 'managementNeedsController' });
    assert.deepEqual(planCloudOnlySave({ ...blank, managementSecretField: 'x', cloud: input({}) }), { ok: false, error: 'managementNeedsController' });
    assert.deepEqual(planCloudOnlySave({ ...blank, cloud: input({ clientIdField: 'cloud-client-1', clientSecretField: TYPED_SECRET }) }), {
      ok: true, fields: { cloudRegion: 'euw', cloudClientId: 'cloud-client-1', cloudClientSecret: TYPED_SECRET },
    });
    assert.deepEqual(planCloudOnlySave({ ...blank, cloud: input({ clientIdField: 'cloud-client-1', storedClientId: 'cloud-client-1', hasCloudSecret: true }) }), { ok: true, fields: {} });
    assert.deepEqual(planCloudOnlySave({ ...blank, cloud: input({ removeStaged: true, storedClientId: 'cloud-client-1', hasCloudSecret: true }) }), { ok: true, fields: { removeCloudAccess: true } });
    assert.deepEqual(planCloudOnlySave({ ...blank, managementRemoveStaged: true, cloud: input({ removeStaged: true }) }), { ok: true, fields: { removeManagementAccess: true, removeCloudAccess: true } });
    assert.deepEqual(planCloudOnlySave({ ...blank, cloud: input({}) }), { ok: false, error: 'fillUrlAndUser' });
    assert.deepEqual(planCloudOnlySave({ ...blank, cloud: input({ regionField: 'use' }) }), { ok: false, error: 'fillUrlAndUser' }, 'a region alone configures nothing');
    assert.deepEqual(planCloudOnlySave({ ...blank, cloud: input({ clientSecretField: 's' }) }), { ok: false, error: 'cloudClientIdRequired' });
  });

  test('agrees with main\'s applyConfigSave() over a matrix of cloud-only states (stricter only for a blank Client ID while a credential is stored)', () => {
    const base = { url: '', username: '', language: 'es' as const };
    const storedStates: StoredConfig[] = [
      { url: '', username: '', language: 'es' },
      { url: '', username: '', language: 'es', cloudRegion: 'aps', cloudClientId: 'cloud-client-1', encryptedCloudClientSecret: box.encryptString('stored-secret'), activeController: '4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d' },
      { url: '', username: '', language: 'es', cloudClientId: 'cloud-client-1' },
    ];
    let compared = 0;
    for (const stored of storedStates) {
      const status = cloudAccessStatus(stored, box, null);
      for (const removeStaged of [false, true]) {
        for (const regionField of [status.region, status.region === 'aps' ? 'use' : 'aps']) {
          for (const clientIdField of ['', '  cloud-client-1 ', 'cloud-client-2', 'bad id!']) {
            for (const clientSecretField of ['', TYPED_SECRET]) {
              for (const managementClientIdField of ['', 'mgmt-client-1']) {
                const cloud = input({ removeStaged, regionField, clientIdField, clientSecretField, storedRegion: status.region, storedClientId: status.clientId, hasCloudSecret: status.hasCloudSecret });
                const plan = planCloudOnlySave({ managementRemoveStaged: false, managementClientIdField, managementSecretField: '', cloud });
                const label = JSON.stringify({ stored: status, removeStaged, regionField, clientIdField, clientSecretField, managementClientIdField });
                if (plan.ok) {
                  const outcome = applyConfigSave(stored, { ...base, ...plan.fields }, box);
                  assert.ok(outcome.ok, `main refused an accepted plan: ${label}`);
                  if (!outcome.ok) continue;
                  assert.equal(outcome.config.url, '', label);
                  assert.equal(outcome.config.username, '', label);
                  assert.equal(outcome.urlChanged, false, label);
                  if (removeStaged) {
                    assert.equal(outcome.config.cloudClientId, undefined, label);
                  } else {
                    assert.equal(outcome.config.cloudClientId, plan.fields.cloudClientId ?? stored.cloudClientId, label);
                    assert.ok(outcome.config.cloudClientId, `a cloud-only config keeps a cloud Client ID: ${label}`);
                  }
                } else if (plan.error === 'cloudClientIdRequired' && clientIdField.trim() === '' && clientSecretField === '' && (status.clientId !== '' || status.hasCloudSecret)) {
                  // Stricter on purpose (like the local path): "Remove cloud access" removes
                  compared++;
                  continue;
                } else {
                  const naive: ConfigSavePayload = { ...base };
                  if (managementClientIdField !== '') naive.clientId = managementClientIdField;
                  if (removeStaged) {
                    naive.removeCloudAccess = true;
                  } else {
                    naive.cloudRegion = regionField as CloudRegion;
                    if (clientIdField.trim() !== '') naive.cloudClientId = clientIdField;
                    if (clientSecretField !== '') naive.cloudClientSecret = clientSecretField;
                  }
                  const outcome = applyConfigSave(stored, naive, box);
                  const expected = plan.error === 'fillUrlAndUser' ? 'invalidUrl' : plan.error;
                  assert.ok(!outcome.ok && outcome.error === expected, `main disagrees (${outcome.ok ? 'ok' : outcome.error} vs ${plan.error}): ${label}`);
                }
                compared++;
              } // End of the loop over the management Client ID fields
            } // End of the loop over the typed secrets
          } // End of the loop over the Client ID fields
        } // End of the loop over the region fields
      } // End of the loop over the staged removals
    } // End of the loop over the stored states
    assert.equal(compared, 3 * 2 * 2 * 4 * 2 * 2);
  }); // End of test "agrees with main's applyConfigSave() over a matrix of cloud-only states"

  test('the new texts exist in both languages: the refusal points at the local controller, the certificate note at the cloud', () => {
    for (const key of ['managementNeedsController', 'certCloudNote', 'thisNetwork', 'fillUrlAndUser'] as const) {
      assert.ok(translations.es[key].trim() !== '' && translations.en[key].trim() !== '' && translations.es[key] !== translations.en[key], key);
    }
    assert.match(translations.en.certCloudNote, /verified normally/);
    assert.match(translations.es.certCloudNote, /verifica de la forma habitual/);
    assert.match(translations.en.managementNeedsController, /URL, username and password/);
    assert.match(translations.es.managementNeedsController, /URL, usuario y contraseña/);
  });
});
