// Tests for the TP-Link cloud-access config rules (src/main/config-model.ts,
// inbox item I-1a): the new optional fields and their validation on load
// (malformed entries dropped, no schema break), the cloud secret stored only
// as a safeStorage blob with the session-only fallback, a region or cloud
// Client ID change dropping the stored secret, Remove cloud access deleting
// every cloud field and making the local controller active, the cloud
// account surviving a controller URL change while `localOmadacId` is dropped
// with it, the renderer view (flags only) and the credential accessor.
// Encryption is a fake SecretBox (no Electron safeStorage).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  activeControllerOf,
  applyConfigSave,
  cloudAccessStatus,
  cloudCredentialsOf,
  ConfigSaveOutcome,
  MAX_CLOUD_SITES,
  normalizeCloudSites,
  SecretBox,
  StoredConfig,
  toRendererConfig,
  validateStoredConfig
} from '../../src/main/config-model';
import type { ConfigSavePayload } from '../../src/shared/types';

const URL_A = 'https://192.168.1.130:8043';
const URL_B = 'https://192.168.1.140:8043';
const CLOUD_SECRET = 'Cloud-Secret-Value-789';
const OMADAC_LOCAL = 'c0ffee00c0ffee00c0ffee00c0ffee00';
const OMADAC_REMOTE = '4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d';

/**
 * A reversible fake SecretBox (same as config-model.test.ts).
 * @param {{ available?: boolean; secure?: boolean; failEncrypt?: boolean }} [options] - Behaviour switches.
 * @returns {SecretBox} The fake.
 */
function fakeBox(options: { available?: boolean; secure?: boolean; failEncrypt?: boolean } = {}): SecretBox {
  return {
    isEncryptionAvailable: () => options.available !== false,
    isSecureStorageAvailable: () => options.available !== false && options.secure !== false,
    encryptString: (plainText) => {
      if (options.failEncrypt) {
        throw new Error('encryption failed');
      }
      return Buffer.from(`enc:${plainText}`).toString('base64');
    },
    decryptString: (blob) => {
      const decoded = Buffer.from(blob, 'base64').toString();
      if (!decoded.startsWith('enc:')) {
        throw new Error('undecryptable');
      }
      return decoded.slice(4);
    }
  };
} // End of function fakeBox()

const box = fakeBox();

/**
 * A stored config for controller A with cloud access on APS.
 * @returns {StoredConfig} The config.
 */
function storedWithCloud(): StoredConfig {
  return {
    url: URL_A,
    username: 'admin',
    language: 'en',
    encryptedPassword: box.encryptString('password-for-A'),
    localOmadacId: OMADAC_LOCAL,
    cloudRegion: 'aps',
    cloudClientId: 'cloud-client-1',
    encryptedCloudClientSecret: box.encryptString(CLOUD_SECRET),
    activeController: OMADAC_REMOTE,
    cloudSites: { [OMADAC_REMOTE]: 'site-remote' }
  };
}

/**
 * Builds a save payload for controller A.
 * @param {Partial<ConfigSavePayload>} overrides - Fields to change.
 * @returns {ConfigSavePayload} The payload.
 */
function payload(overrides: Partial<ConfigSavePayload>): ConfigSavePayload {
  return { url: URL_A, username: 'admin', language: 'en', ...overrides };
}

/**
 * Asserts a successful outcome and returns it.
 * @param {ConfigSaveOutcome} outcome - The outcome.
 * @returns {Extract<ConfigSaveOutcome, { ok: true }>} The success.
 */
function expectOk(outcome: ConfigSaveOutcome): Extract<ConfigSaveOutcome, { ok: true }> {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (!outcome.ok) {
    throw new Error('unreachable');
  }
  return outcome;
}

/**
 * Asserts a serialized config holds no plaintext cloud secret.
 * @param {StoredConfig} config - The config to persist.
 * @param {string} secret - The secret.
 */
function assertNoPlaintext(config: StoredConfig, secret: string): void {
  assert.ok(!JSON.stringify(config).includes(secret), 'no plaintext cloud secret on disk');
}

describe('validateStoredConfig: the cloud fields', () => {
  test('valid cloud fields are kept as they are', () => {
    assert.deepEqual(validateStoredConfig(storedWithCloud()), storedWithCloud());
  });

  test('malformed values are dropped one by one (never cast); a config without them loads as before', () => {
    const config = validateStoredConfig({
      ...storedWithCloud(),
      cloudRegion: 'eu',
      cloudClientId: 'bad id!',
      encryptedCloudClientSecret: 42,
      localOmadacId: 'local',
      activeController: '__proto__'
    });
    for (const field of ['cloudRegion', 'cloudClientId', 'encryptedCloudClientSecret', 'localOmadacId', 'activeController'] as const) {
      assert.equal(config[field], undefined, field);
    }
    assert.equal(validateStoredConfig({ ...storedWithCloud(), activeController: 'local' }).activeController, 'local');
    assert.equal(validateStoredConfig({ ...storedWithCloud(), cloudClientId: '  cloud-client-1 ' }).cloudClientId, 'cloud-client-1');
  });

  test('a present but invalid region or Client ID drops the whole credential (never rebound to the default region)', () => {
    for (const broken of [{ cloudRegion: 'eu' }, { cloudRegion: null }, { cloudRegion: 7 }, { cloudClientId: 'bad id!' }, { cloudClientId: '' }]) {
      const config = validateStoredConfig({ ...storedWithCloud(), ...broken });
      for (const field of ['cloudRegion', 'cloudClientId', 'encryptedCloudClientSecret'] as const) {
        assert.equal(config[field], undefined, `${JSON.stringify(broken)}: ${field}`);
      }
      assert.equal(cloudCredentialsOf(config, box, null), null, JSON.stringify(broken));
      // Keyed by omadacIds, not by the credential: kept, as on a credential change
      assert.equal(config.activeController, OMADAC_REMOTE);
      assert.deepEqual(config.cloudSites, { [OMADAC_REMOTE]: 'site-remote' });
    }
    // An absent region is the default one, so the credential is kept
    const { cloudRegion: _omitted, ...withoutRegion } = storedWithCloud();
    const config = validateStoredConfig(withoutRegion);
    assert.equal(config.cloudRegion, undefined);
    assert.equal(config.cloudClientId, 'cloud-client-1');
    assert.equal(config.encryptedCloudClientSecret, storedWithCloud().encryptedCloudClientSecret);
  });

  test('cloudSites: malformed entries are dropped, the rest kept; nothing usable → absent; no prototype pollution', () => {
    const sites = normalizeCloudSites(
      JSON.parse(`{"${OMADAC_REMOTE}":"site-1","local":"site-2","__proto__":"site-3","bad/key":"site-4","abc":"bad site","def":7,"ghi":"site-ok"}`)
    );
    assert.deepEqual(sites, { [OMADAC_REMOTE]: 'site-1', ghi: 'site-ok' });
    assert.equal(Object.getPrototypeOf(sites), Object.prototype);
    for (const raw of [null, [], 'x', 5, {}, { a: 1 }, new Map()]) {
      assert.equal(normalizeCloudSites(raw), null, String(raw));
    }
    const many = Object.fromEntries(Array.from({ length: MAX_CLOUD_SITES + 10 }, (_, index) => [`org${index}`, `site${index}`]));
    assert.equal(Object.keys(normalizeCloudSites(many) ?? {}).length, MAX_CLOUD_SITES);
    assert.equal(validateStoredConfig({ ...storedWithCloud(), cloudSites: { 'x y': 'z' } }).cloudSites, undefined);
  });

  test('activeControllerOf(): "local" unless a cloud omadacId is stored', () => {
    assert.equal(activeControllerOf({ url: '', username: '', language: 'es' }), 'local');
    assert.equal(activeControllerOf(storedWithCloud()), OMADAC_REMOTE);
    assert.equal(activeControllerOf({ ...storedWithCloud(), activeController: 'local' }), 'local');
  });
});

describe('applyConfigSave: cloud access', () => {
  test('a first cloud credential: the region and Client ID in plain text, the secret only as a blob (never plaintext)', () => {
    const current: StoredConfig = { url: URL_A, username: 'admin', language: 'en', encryptedPassword: box.encryptString('pw') };
    const outcome = expectOk(applyConfigSave(current, payload({ cloudRegion: 'euw', cloudClientId: ' cloud-client-2 ', cloudClientSecret: CLOUD_SECRET }), box));
    assert.equal(outcome.config.cloudRegion, 'euw');
    assert.equal(outcome.config.cloudClientId, 'cloud-client-2');
    assert.equal(outcome.config.encryptedCloudClientSecret, box.encryptString(CLOUD_SECRET));
    assert.equal(outcome.sessionCloudClientSecret, null);
    assert.equal(outcome.cloudCredentialsChanged, true);
    assertNoPlaintext(outcome.config, CLOUD_SECRET);
    assert.deepEqual(cloudCredentialsOf(outcome.config, box, null), { region: 'euw', clientId: 'cloud-client-2', clientSecret: CLOUD_SECRET });
  });

  test('without secure storage the typed cloud secret is session-only: never on disk, the blob dropped', () => {
    for (const noSecure of [fakeBox({ available: false }), fakeBox({ secure: false })]) {
      const outcome = expectOk(applyConfigSave(storedWithCloud(), payload({ password: 'pw', cloudRegion: 'aps', cloudClientId: 'cloud-client-1', cloudClientSecret: 'typed-secret' }), noSecure));
      assert.equal(outcome.sessionCloudClientSecret, 'typed-secret');
      assert.equal(outcome.config.encryptedCloudClientSecret, undefined);
      assertNoPlaintext(outcome.config, 'typed-secret');
      assert.deepEqual(cloudCredentialsOf(outcome.config, noSecure, outcome.sessionCloudClientSecret), { region: 'aps', clientId: 'cloud-client-1', clientSecret: 'typed-secret' });
      const status = cloudAccessStatus(outcome.config, noSecure, outcome.sessionCloudClientSecret);
      assert.deepEqual([status.hasCloudSecret, status.cloudSecretSessionOnly, status.canPersistCloudSecret], [true, true, false]);
    }
    assert.deepEqual(applyConfigSave(storedWithCloud(), payload({ cloudClientId: 'c', cloudClientSecret: 's' }), fakeBox({ failEncrypt: true })), { ok: false, error: 'saveFailed' });
  });

  test('no cloud field in the payload keeps all of it (blob and session-only secret); cloudCredentialsChanged is false', () => {
    const current = storedWithCloud();
    const outcome = expectOk(applyConfigSave(current, payload({ username: 'operator' }), box, null, 'session-cloud-secret'));
    assert.deepEqual(outcome.config, { ...current, username: 'operator' });
    assert.equal(outcome.sessionCloudClientSecret, 'session-cloud-secret');
    assert.equal(outcome.cloudCredentialsChanged, false);
  });

  test('the same region and Client ID with a blank secret keep the stored secret', () => {
    const current = storedWithCloud();
    const outcome = expectOk(applyConfigSave(current, payload({ cloudRegion: 'aps', cloudClientId: 'cloud-client-1' }), box));
    assert.equal(outcome.config.encryptedCloudClientSecret, current.encryptedCloudClientSecret);
    assert.equal(outcome.cloudCredentialsChanged, false);
  });

  test('changing the region drops the stored secret: without a typed one it is cloudClientSecretRequired', () => {
    assert.deepEqual(applyConfigSave(storedWithCloud(), payload({ cloudRegion: 'euw', cloudClientId: 'cloud-client-1' }), box), { ok: false, error: 'cloudClientSecretRequired' });
    assert.deepEqual(applyConfigSave(storedWithCloud(), payload({ cloudRegion: 'use' }), box, null, 'session-cloud-secret'), { ok: false, error: 'cloudClientSecretRequired' });
    const outcome = expectOk(applyConfigSave(storedWithCloud(), payload({ cloudRegion: 'euw', cloudClientId: 'cloud-client-1', cloudClientSecret: 'secret-for-euw' }), box));
    assert.equal(outcome.config.cloudRegion, 'euw');
    assert.equal(outcome.config.encryptedCloudClientSecret, box.encryptString('secret-for-euw'));
    assert.equal(outcome.cloudCredentialsChanged, true);
    // With no stored Client ID a region alone is just stored
    const bare: StoredConfig = { url: URL_A, username: 'admin', language: 'en', encryptedPassword: box.encryptString('pw') };
    const regionOnly = expectOk(applyConfigSave(bare, payload({ cloudRegion: 'use' }), box));
    assert.equal(regionOnly.config.cloudRegion, 'use');
    assert.equal(regionOnly.config.cloudClientId, undefined);
  }); // End of test "changing the region drops the stored secret..."

  test('changing the cloud Client ID drops the stored secret (and the session-only one): a typed secret is required', () => {
    assert.deepEqual(applyConfigSave(storedWithCloud(), payload({ cloudRegion: 'aps', cloudClientId: 'cloud-client-NEW' }), box, null, 'session'), {
      ok: false,
      error: 'cloudClientSecretRequired'
    });
    const outcome = expectOk(applyConfigSave(storedWithCloud(), payload({ cloudClientId: 'cloud-client-NEW', cloudClientSecret: 'new-secret' }), box, null, 'session'));
    assert.equal(outcome.config.cloudClientId, 'cloud-client-NEW');
    assert.equal(outcome.config.encryptedCloudClientSecret, box.encryptString('new-secret'));
    assert.equal(outcome.sessionCloudClientSecret, null);
    assert.equal(outcome.config.cloudRegion, 'aps', 'the stored region is kept when none is sent');
  });

  test('field rules: a secret without a Client ID, an implausible Client ID, an unknown region', () => {
    assert.deepEqual(applyConfigSave(storedWithCloud(), payload({ cloudClientSecret: 's' }), box), { ok: false, error: 'cloudClientIdRequired' });
    assert.deepEqual(applyConfigSave(storedWithCloud(), payload({ cloudClientId: 'bad id!', cloudClientSecret: 's' }), box), { ok: false, error: 'invalidCloudClientId' });
    assert.deepEqual(applyConfigSave(storedWithCloud(), payload({ cloudClientId: '   ', cloudClientSecret: 's' }), box), { ok: false, error: 'invalidCloudClientId' });
    assert.deepEqual(applyConfigSave(storedWithCloud(), payload({ cloudRegion: 'eu' as unknown as 'euw' }), box), { ok: false, error: 'saveFailed' });
  });

  test('Remove cloud access deletes every cloud field (and the session-only secret) and makes the local controller active', () => {
    const outcome = expectOk(applyConfigSave(storedWithCloud(), payload({ removeCloudAccess: true }), box, 'mgmt-session', 'session-cloud-secret'));
    for (const field of ['cloudRegion', 'cloudClientId', 'encryptedCloudClientSecret', 'cloudSites', 'activeController'] as const) {
      assert.equal(outcome.config[field], undefined, field);
    }
    assert.equal(activeControllerOf(outcome.config), 'local');
    assert.equal(outcome.sessionCloudClientSecret, null);
    assert.equal(outcome.sessionClientSecret, 'mgmt-session', 'the management access is untouched');
    assert.equal(outcome.config.localOmadacId, OMADAC_LOCAL, 'the local controller\'s own id is not a cloud field');
    assert.equal(outcome.cloudCredentialsChanged, true);
    assert.equal(cloudCredentialsOf(outcome.config, box, outcome.sessionCloudClientSecret), null);
    for (const mixed of [{ cloudRegion: 'euw' as const }, { cloudClientId: 'x' }, { cloudClientSecret: 'y' }]) {
      assert.deepEqual(applyConfigSave(storedWithCloud(), payload({ removeCloudAccess: true, ...mixed }), box), { ok: false, error: 'saveFailed' }, JSON.stringify(mixed));
    }
    assert.deepEqual(applyConfigSave(storedWithCloud(), payload({ removeCloudAccess: false as unknown as true }), box), { ok: false, error: 'saveFailed' });
  }); // End of test "Remove cloud access deletes every cloud field..."

  test('a controller URL change keeps the cloud account, drops localOmadacId (with the password, site and pin)', () => {
    const outcome = expectOk(applyConfigSave(storedWithCloud(), payload({ url: URL_B, password: 'password-for-B' }), box, null, 'session-cloud-secret'));
    assert.equal(outcome.urlChanged, true);
    assert.equal(outcome.config.localOmadacId, undefined);
    assert.equal(outcome.config.cloudRegion, 'aps');
    assert.equal(outcome.config.cloudClientId, 'cloud-client-1');
    assert.equal(outcome.config.encryptedCloudClientSecret, storedWithCloud().encryptedCloudClientSecret);
    assert.equal(outcome.config.activeController, OMADAC_REMOTE);
    assert.deepEqual(outcome.config.cloudSites, { [OMADAC_REMOTE]: 'site-remote' });
    assert.equal(outcome.sessionCloudClientSecret, 'session-cloud-secret');
    assert.equal(outcome.cloudCredentialsChanged, false);
    // Same URL: localOmadacId stays
    assert.equal(expectOk(applyConfigSave(storedWithCloud(), payload({}), box)).config.localOmadacId, OMADAC_LOCAL);
  }); // End of test "a controller URL change keeps the cloud account..."
});

describe('the renderer view of cloud access', () => {
  test('flags only: region, Client ID, hasCloudSecret, session-only, can-persist, the active controller — never the secret or the blob', () => {
    const config = storedWithCloud();
    const view = toRendererConfig(config, box);
    assert.deepEqual(view.cloudAccess, {
      region: 'aps',
      clientId: 'cloud-client-1',
      hasCloudSecret: true,
      cloudSecretSessionOnly: false,
      canPersistCloudSecret: true,
      activeController: OMADAC_REMOTE
    });
    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes(CLOUD_SECRET) && !serialized.includes(config.encryptedCloudClientSecret as string));
    // An untrusted or undecryptable blob is reported as no secret
    assert.equal(toRendererConfig(config, fakeBox({ secure: false })).cloudAccess.hasCloudSecret, false);
    assert.equal(toRendererConfig({ ...config, encryptedCloudClientSecret: Buffer.from('garbage').toString('base64') }, box).cloudAccess.hasCloudSecret, false);
    assert.equal(cloudCredentialsOf({ ...config, encryptedCloudClientSecret: Buffer.from('garbage').toString('base64') }, box, null), null);
    assert.equal(toRendererConfig(config, box, null, 'session').cloudAccess.cloudSecretSessionOnly, true);
  }); // End of test "flags only..."
});
