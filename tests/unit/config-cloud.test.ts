// Tests for the TP-Link cloud-access config rules (src/main/config-model.ts,
// inbox item I-1a): the new optional fields and their validation on load
// (malformed entries dropped, no schema break), the cloud secret stored only
// as a safeStorage blob with the session-only fallback, a region or cloud
// Client ID change dropping the stored secret, Remove cloud access deleting
// every cloud field and making the local controller active, the cloud
// account surviving a controller URL change while `localOmadacId` is dropped
// with it, the renderer view (flags only) and the credential accessor; and
// the persistence helpers of the connection targets (inbox I-1b2b1:
// localOmadacId, activeController, cloudSites); and the cloud-only save of a
// configuration without a local controller (inbox I-1c2a).
// Encryption is a fake SecretBox (no Electron safeStorage).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  activeControllerOf,
  applyConfigSave,
  cloudAccessStatus,
  cloudCredentialsOf,
  cloudSiteOf,
  ConfigSaveOutcome,
  isCloudOnlySave,
  MAX_CLOUD_SITES,
  normalizeCloudSites,
  SecretBox,
  StoredConfig,
  toRendererConfig,
  validateStoredConfig,
  withActiveController,
  withCloudSite,
  withLocalOmadacId
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

describe('the persistence helpers of the connection targets (inbox I-1b2b1)', () => {
  test('withLocalOmadacId(): written for the configured URL only, and only when it changed; the URL-change rule still drops it', () => {
    const config = storedWithCloud();
    assert.equal(withLocalOmadacId(config, URL_A, OMADAC_LOCAL), null, 'unchanged: nothing to write');
    const next = withLocalOmadacId(config, URL_A, OMADAC_REMOTE);
    assert.deepEqual(next, { ...config, localOmadacId: OMADAC_REMOTE });
    assert.equal(config.localOmadacId, OMADAC_LOCAL, 'the input is not mutated');
    assert.equal(withLocalOmadacId(config, URL_B, OMADAC_REMOTE), null, 'a connect to another URL');
    for (const bad of ['', 'local', 'a b', '__proto__']) {
      assert.equal(withLocalOmadacId(config, URL_A, bad), null, bad);
    }
    assert.equal(withLocalOmadacId({ url: '', username: '', language: 'es' }, '', OMADAC_LOCAL), null, 'no configured URL');
    assert.ok(next);
    assert.equal(expectOk(applyConfigSave(next, payload({ url: URL_B, password: 'password-for-B' }), box)).config.localOmadacId, undefined);
  }); // End of test "withLocalOmadacId()..."

  test('withActiveController(): "local" or an omadacId, written only when it changed', () => {
    const base: StoredConfig = { url: URL_A, username: 'admin', language: 'en' };
    assert.equal(withActiveController(base, 'local'), null, 'an absent field counts as local');
    const cloud = withActiveController(base, OMADAC_REMOTE);
    assert.equal(cloud?.activeController, OMADAC_REMOTE);
    assert.ok(cloud);
    assert.equal(withActiveController(cloud, OMADAC_REMOTE), null);
    assert.equal(withActiveController(cloud, 'local')?.activeController, 'local');
    for (const bad of ['', 'a b', '__proto__', 'constructor']) {
      assert.equal(withActiveController(cloud, bad), null, bad);
    }
    assert.equal(validateStoredConfig(JSON.parse(JSON.stringify(cloud))).activeController, OMADAC_REMOTE, 'loads back');
  }); // End of test "withActiveController()..."

  test('cloudSiteOf() / withCloudSite(): per omadacId, never the local siteId; capped at MAX_CLOUD_SITES with the newest last', () => {
    const config: StoredConfig = { ...storedWithCloud(), siteId: 'site-local' };
    assert.equal(cloudSiteOf(config, OMADAC_REMOTE), 'site-remote');
    assert.equal(cloudSiteOf(config, OMADAC_LOCAL), '');
    assert.equal(cloudSiteOf(config, 'constructor'), '');
    assert.equal(cloudSiteOf({ url: URL_A, username: 'admin', language: 'en' }, OMADAC_REMOTE), '');
    assert.equal(withCloudSite(config, OMADAC_REMOTE, 'site-remote'), null, 'unchanged');
    const next = withCloudSite(config, OMADAC_LOCAL, 'site-2');
    assert.deepEqual(next?.cloudSites, { [OMADAC_REMOTE]: 'site-remote', [OMADAC_LOCAL]: 'site-2' });
    assert.equal(next?.siteId, 'site-local', 'the local site is never touched');
    assert.deepEqual(config.cloudSites, { [OMADAC_REMOTE]: 'site-remote' }, 'the input is not mutated');
    for (const [omadacId, siteId] of [['a b', 'site-1'], ['local', 'site-1'], [OMADAC_LOCAL, 'x y'], [OMADAC_LOCAL, '']]) {
      assert.equal(withCloudSite(config, omadacId, siteId), null, `${omadacId} ${siteId}`);
    }
    let many: StoredConfig = { url: URL_A, username: 'admin', language: 'en' };
    for (let index = 0; index < MAX_CLOUD_SITES + 5; index++) {
      many = withCloudSite(many, `org${index}`, `site${index}`) ?? many;
    }
    const keys = Object.keys(many.cloudSites ?? {});
    assert.equal(keys.length, MAX_CLOUD_SITES);
    assert.equal(keys[0], 'org5', 'the oldest entries went');
    assert.equal(keys[keys.length - 1], `org${MAX_CLOUD_SITES + 4}`);
    const rechosen = withCloudSite(many, 'org5', 'site-new');
    assert.equal(Object.keys(rechosen?.cloudSites ?? {}).pop(), 'org5', 'a new choice moves last');
    assert.equal(Object.keys(rechosen?.cloudSites ?? {}).length, MAX_CLOUD_SITES);
    assert.deepEqual(validateStoredConfig(JSON.parse(JSON.stringify(many))).cloudSites, many.cloudSites, 'loads back');
  }); // End of test "cloudSiteOf() / withCloudSite()..."
}); // End of describe 'the persistence helpers of the connection targets'

describe('applyConfigSave: a configuration without a local controller (cloud-only, inbox I-1c2a)', () => {
  /**
   * A stored config without a local controller.
   * @param {Partial<StoredConfig>} [extra] - Cloud fields to store.
   * @returns {StoredConfig} The config.
   */
  function noLocal(extra: Partial<StoredConfig> = {}): StoredConfig {
    return { url: '', username: '', language: 'es', ...extra };
  }

  /**
   * A cloud-only save payload ('' as URL and username, no password).
   * @param {Partial<ConfigSavePayload>} overrides - Fields to add.
   * @returns {ConfigSavePayload} The payload.
   */
  function cloudOnly(overrides: Partial<ConfigSavePayload>): ConfigSavePayload {
    return { url: '', username: '', language: 'en', ...overrides };
  }

  const STORED_CLOUD: Partial<StoredConfig> = {
    cloudRegion: 'aps',
    cloudClientId: 'cloud-client-1',
    encryptedCloudClientSecret: box.encryptString(CLOUD_SECRET),
    activeController: OMADAC_REMOTE,
    cloudSites: { [OMADAC_REMOTE]: 'site-remote' }
  };

  test('isCloudOnlySave(): URL, username and password all empty AND no local controller stored', () => {
    assert.equal(isCloudOnlySave(noLocal(), cloudOnly({})), true);
    assert.equal(isCloudOnlySave(noLocal(), cloudOnly({ url: '  ', username: ' ', password: '' })), true);
    assert.equal(isCloudOnlySave(noLocal(), cloudOnly({ password: 'p' })), false, 'a typed password is a local section');
    assert.equal(isCloudOnlySave(noLocal(), cloudOnly({ url: URL_A })), false);
    assert.equal(isCloudOnlySave(noLocal(), cloudOnly({ username: 'admin' })), false);
    assert.equal(isCloudOnlySave(storedWithCloud(), cloudOnly({})), false, 'a stored local controller is never emptied this way');
  });

  test('a first cloud credential without a local controller: only the cloud fields are stored (the secret as a blob), no local field', () => {
    const outcome = expectOk(applyConfigSave(noLocal(), cloudOnly({ cloudRegion: 'aps', cloudClientId: ' cloud-client-1 ', cloudClientSecret: CLOUD_SECRET }), box));
    assert.deepEqual(Object.keys(outcome.config).sort(), ['cloudClientId', 'cloudRegion', 'encryptedCloudClientSecret', 'language', 'url', 'username']);
    assert.equal(outcome.config.url, '');
    assert.equal(outcome.config.username, '');
    assert.equal(outcome.config.language, 'en');
    assert.equal(outcome.config.cloudClientId, 'cloud-client-1');
    assert.equal(box.decryptString(outcome.config.encryptedCloudClientSecret as string), CLOUD_SECRET);
    assertNoPlaintext(outcome.config, CLOUD_SECRET);
    assert.equal(outcome.urlChanged, false, 'no controller transition');
    assert.equal(outcome.cloudCredentialsChanged, true);
    assert.equal(outcome.sessionClientSecret, null);
    assert.deepEqual(cloudCredentialsOf(outcome.config, box, outcome.sessionCloudClientSecret), { region: 'aps', clientId: 'cloud-client-1', clientSecret: CLOUD_SECRET });
  });

  test('without secure storage the typed cloud secret is session-only there too (never on disk)', () => {
    const insecure = fakeBox({ secure: false });
    const outcome = expectOk(applyConfigSave(noLocal(), cloudOnly({ cloudClientId: 'cloud-client-1', cloudClientSecret: CLOUD_SECRET }), insecure));
    assert.equal(outcome.config.encryptedCloudClientSecret, undefined);
    assert.equal(outcome.sessionCloudClientSecret, CLOUD_SECRET);
    assertNoPlaintext(outcome.config, CLOUD_SECRET);
  });

  test('a stored credential is kept by a save that touches no cloud field (e.g. the language), with activeController and cloudSites', () => {
    const outcome = expectOk(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly({ language: 'es' }), box, null, 'session-cloud'));
    assert.deepEqual(outcome.config, { url: '', username: '', language: 'es', ...STORED_CLOUD });
    assert.equal(outcome.cloudCredentialsChanged, false);
    assert.equal(outcome.sessionCloudClientSecret, 'session-cloud');
    // The same region and Client ID with a blank secret keep it too
    assert.equal(expectOk(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly({ cloudRegion: 'aps', cloudClientId: 'cloud-client-1' }), box)).config.encryptedCloudClientSecret, STORED_CLOUD.encryptedCloudClientSecret);
  });

  test('Remove cloud access without a local controller leaves an empty configuration (the local controller active)', () => {
    const outcome = expectOk(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly({ removeCloudAccess: true }), box, null, 'session-cloud'));
    assert.deepEqual(outcome.config, { url: '', username: '', language: 'en' });
    assert.equal(outcome.sessionCloudClientSecret, null);
    assert.equal(outcome.cloudCredentialsChanged, true);
    assert.equal(activeControllerOf(outcome.config), 'local');
  });

  test('nothing configured at all (the empty form, a region alone) stays invalidUrl, as the empty form always was', () => {
    assert.deepEqual(applyConfigSave(noLocal(), cloudOnly({}), box), { ok: false, error: 'invalidUrl' });
    assert.deepEqual(applyConfigSave(noLocal(), cloudOnly({ cloudRegion: 'use' }), box), { ok: false, error: 'invalidUrl' });
  });

  test('management access needs a local controller: a Client ID or Client Secret is managementNeedsController; a removal changes nothing', () => {
    for (const fields of [{ clientId: 'mgmt-client' }, { clientSecret: 'mgmt-secret' }, { clientId: 'mgmt-client', clientSecret: 'mgmt-secret' }]) {
      assert.deepEqual(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly(fields), box), { ok: false, error: 'managementNeedsController' }, JSON.stringify(fields));
    }
    const removed = expectOk(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly({ removeManagementAccess: true }), box, 'mgmt-session'));
    assert.equal(removed.config.clientId, undefined);
    assert.equal(removed.sessionClientSecret, null);
    assert.deepEqual(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly({ removeManagementAccess: false as unknown as true }), box), { ok: false, error: 'saveFailed' });
    // The management check comes first, like the local path's order
    assert.deepEqual(applyConfigSave(noLocal(), cloudOnly({ clientId: 'mgmt-client', cloudClientSecret: 's' }), box), { ok: false, error: 'managementNeedsController' });
  });

  test('the cloud field rules apply unchanged', () => {
    assert.deepEqual(applyConfigSave(noLocal(), cloudOnly({ cloudClientSecret: 's' }), box), { ok: false, error: 'cloudClientIdRequired' });
    assert.deepEqual(applyConfigSave(noLocal(), cloudOnly({ cloudClientId: 'bad id!', cloudClientSecret: 's' }), box), { ok: false, error: 'invalidCloudClientId' });
    assert.deepEqual(applyConfigSave(noLocal(), cloudOnly({ cloudClientId: 'cloud-client-new' }), box), { ok: false, error: 'cloudClientSecretRequired' });
    assert.deepEqual(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly({ cloudRegion: 'euw' }), box), { ok: false, error: 'cloudClientSecretRequired' });
  });

  test('a partially filled local section keeps the local rules and codes (exactly as before)', () => {
    assert.deepEqual(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly({ username: 'admin' }), box), { ok: false, error: 'invalidUrl' });
    assert.deepEqual(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly({ password: 'pw' }), box), { ok: false, error: 'invalidUrl' });
    assert.deepEqual(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly({ url: URL_A }), box), { ok: false, error: 'saveFailed' }, 'a URL without a username');
    assert.deepEqual(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly({ url: URL_A, username: 'admin' }), box), { ok: false, error: 'passwordRequired' });
    assert.deepEqual(applyConfigSave(noLocal(STORED_CLOUD), cloudOnly({ url: 'http://192.168.1.130', username: 'admin', password: 'pw' }), box), { ok: false, error: 'invalidUrl' });
    // An emptied local section while a local controller is stored: the local rules (invalidUrl), never a silent removal
    assert.deepEqual(applyConfigSave(storedWithCloud(), cloudOnly({}), box), { ok: false, error: 'invalidUrl' });
  });

  test('adding a local controller later is a URL change: a typed password is required, the cloud account and choices are kept', () => {
    assert.deepEqual(applyConfigSave(noLocal(STORED_CLOUD), payload({ url: URL_A }), box), { ok: false, error: 'passwordRequired' });
    const outcome = expectOk(applyConfigSave(noLocal(STORED_CLOUD), payload({ url: URL_A, password: 'password-for-A' }), box));
    assert.equal(outcome.urlChanged, true);
    assert.equal(outcome.config.url, URL_A);
    assert.equal(outcome.config.cloudClientId, 'cloud-client-1');
    assert.equal(outcome.config.activeController, OMADAC_REMOTE);
    assert.equal(outcome.cloudCredentialsChanged, false);
  });
}); // End of describe 'applyConfigSave: a configuration without a local controller'
