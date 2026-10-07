// Tests for the config model and save rules (src/main/config-model.ts), in
// particular the URL-scoped credentials of todo.md 4.4 (a controller URL
// change drops the password, the Client ID and Client Secret, the site id and
// the certificate pin and requires a typed password; a same-URL save keeps
// them) and the optional management access of todo.md 4.8 (the Client Secret
// only as a safeStorage blob, session-only when secure storage is unavailable
// — no encryption, or Linux's basic_text / unknown backend —, never in the
// renderer view). Encryption is a fake SecretBox (no Electron safeStorage).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyConfigSave,
  ConfigSaveOutcome,
  managementAccessStatus,
  managementCredentialsOf,
  normalizeClientId,
  SafeStorageProbe,
  SecretBox,
  SECURE_LINUX_STORAGE_BACKENDS,
  secureSecretStorageAvailable,
  StoredConfig,
  toRendererConfig,
  validateStoredConfig
} from '../../src/main/config-model';
import type { ConfigSavePayload } from '../../src/shared/types';

const URL_A = 'https://192.168.1.130:8043';
const URL_B = 'https://192.168.1.140:8043';
const FINGERPRINT = Array.from({ length: 32 }, () => 'C3').join(':');

/**
 * A reversible fake SecretBox: "encrypts" as base64 of a marked string.
 * `secure: false` plays Linux's basic_text / unknown backend: encryption is
 * available (the password is encrypted) but the storage is not a real secret
 * store (the Client Secret must not be persisted). Secure storage also needs
 * `available`.
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
 * A fully populated stored config for controller A.
 * @returns {StoredConfig} The config.
 */
function storedForA(): StoredConfig {
  return {
    url: URL_A,
    username: 'admin',
    language: 'en',
    encryptedPassword: box.encryptString('password-for-A'),
    password: 'legacy-plaintext-A',
    clientId: 'client-A',
    encryptedClientSecret: box.encryptString('client-secret-A'),
    siteId: 'site-a',
    certificatePin: { origin: URL_A, sha256: FINGERPRINT, trustedAt: '2026-10-06T10:00:00.000Z' }
  };
} // End of function storedForA()

/**
 * Asserts a successful outcome and returns its config.
 * @param {ConfigSaveOutcome} outcome - The outcome.
 * @returns {{ config: StoredConfig; urlChanged: boolean; sessionClientSecret: string | null }} The success payload.
 */
function expectOk(outcome: ConfigSaveOutcome): { config: StoredConfig; urlChanged: boolean; sessionClientSecret: string | null } {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (!outcome.ok) {
    throw new Error('unreachable');
  }
  return { config: outcome.config, urlChanged: outcome.urlChanged, sessionClientSecret: outcome.sessionClientSecret };
}

/**
 * Builds a save payload.
 * @param {Partial<ConfigSavePayload>} overrides - Fields to change.
 * @returns {ConfigSavePayload} The payload.
 */
function payload(overrides: Partial<ConfigSavePayload>): ConfigSavePayload {
  return { url: URL_A, username: 'admin', language: 'en', ...overrides };
}

describe('applyConfigSave: URL-scoped credentials', () => {
  test('URL change with a blank password is rejected with passwordRequired (A\'s password is never reused for B)', () => {
    assert.deepEqual(applyConfigSave(storedForA(), payload({ url: URL_B }), box), { ok: false, error: 'passwordRequired' });
    assert.deepEqual(applyConfigSave(storedForA(), payload({ url: URL_B, password: '' }), box), { ok: false, error: 'passwordRequired' });
  });

  test('URL change with a typed password clears the old password (blob and plaintext), Client ID, Client Secret (stored and session-only), site id and pin', () => {
    const { config, urlChanged, sessionClientSecret } = expectOk(
      applyConfigSave(storedForA(), payload({ url: `${URL_B}/`, password: 'password-for-B' }), box, 'session-secret-A')
    );
    assert.equal(urlChanged, true);
    assert.equal(sessionClientSecret, null);
    assert.deepEqual(config, {
      url: URL_B,
      username: 'admin',
      language: 'en',
      encryptedPassword: box.encryptString('password-for-B')
    });
  }); // End of test "URL change with a typed password clears the old password..."

  test('same-URL save with a blank password keeps the password, Client Secret, site id and pin', () => {
    const current = storedForA();
    const { config, urlChanged } = expectOk(applyConfigSave(current, payload({ username: ' operator ', language: 'es' }), box));
    assert.equal(urlChanged, false);
    assert.deepEqual(config, { ...current, username: 'operator', language: 'es' });
  });

  test('same-URL save with a typed password replaces only the password', () => {
    const current = storedForA();
    const { config } = expectOk(applyConfigSave(current, payload({ password: 'new-A' }), box));
    assert.equal(config.encryptedPassword, box.encryptString('new-A'));
    assert.equal(config.password, undefined);
    assert.equal(config.siteId, 'site-a');
    assert.equal(config.clientId, 'client-A');
    assert.equal(config.encryptedClientSecret, current.encryptedClientSecret);
    assert.deepEqual(config.certificatePin, current.certificatePin);
  });

  test('a stored URL that only differs before normalization (legacy trailing slash) counts as the same controller', () => {
    const current = { ...storedForA(), url: `${URL_A}/` };
    const { config, urlChanged } = expectOk(applyConfigSave(current, payload({}), box));
    assert.equal(urlChanged, false);
    assert.equal(config.url, URL_A);
    assert.equal(config.siteId, 'site-a');
    assert.ok(config.certificatePin);
  });

  test('a different port or path on the same host is a different controller', () => {
    assert.deepEqual(applyConfigSave(storedForA(), payload({ url: 'https://192.168.1.130:9443' }), box), { ok: false, error: 'passwordRequired' });
    assert.deepEqual(applyConfigSave(storedForA(), payload({ url: `${URL_A}/omada` }), box), { ok: false, error: 'passwordRequired' });
  });

  test('first configuration (no stored URL) requires a password', () => {
    const empty: StoredConfig = { url: '', username: '', language: 'es' };
    assert.deepEqual(applyConfigSave(empty, payload({}), box), { ok: false, error: 'passwordRequired' });
    const { urlChanged } = expectOk(applyConfigSave(empty, payload({ password: 'p' }), box));
    assert.equal(urlChanged, true);
  });
}); // End of the describe block for URL-scoped credentials

describe('applyConfigSave: existing rules', () => {
  test('same URL but nothing usable stored -> passwordRequired (missing, or undecryptable blob)', () => {
    const noPassword: StoredConfig = { url: URL_A, username: 'admin', language: 'en' };
    assert.deepEqual(applyConfigSave(noPassword, payload({}), box), { ok: false, error: 'passwordRequired' });
    const corrupt: StoredConfig = { ...noPassword, encryptedPassword: Buffer.from('garbage').toString('base64') };
    assert.deepEqual(applyConfigSave(corrupt, payload({}), box), { ok: false, error: 'passwordRequired' });
  });

  test('legacy plaintext password is kept on a same-URL save', () => {
    const legacy: StoredConfig = { url: URL_A, username: 'admin', language: 'en', password: 'plain' };
    const { config } = expectOk(applyConfigSave(legacy, payload({}), box));
    assert.equal(config.password, 'plain');
  });

  test('encryption unavailable -> typed password stored in plaintext (documented fallback)', () => {
    const { config } = expectOk(applyConfigSave(storedForA(), payload({ url: URL_B, password: 'pw' }), fakeBox({ available: false })));
    assert.equal(config.password, 'pw');
    assert.equal(config.encryptedPassword, undefined);
  });

  test('encryption failure -> saveFailed', () => {
    assert.deepEqual(applyConfigSave(storedForA(), payload({ password: 'pw' }), fakeBox({ failEncrypt: true })), { ok: false, error: 'saveFailed' });
  });

  test('invalid URLs -> invalidUrl (including an empty fragment); blank username / non-object -> saveFailed', () => {
    for (const url of ['http://192.168.1.130:8043', `${URL_A}/#`, `${URL_A}#`, 'nope', '']) {
      assert.deepEqual(applyConfigSave(storedForA(), payload({ url, password: 'pw' }), box), { ok: false, error: 'invalidUrl' }, url);
    }
    assert.deepEqual(applyConfigSave(storedForA(), payload({ username: '   ' }), box), { ok: false, error: 'saveFailed' });
    assert.deepEqual(applyConfigSave(storedForA(), null as unknown as ConfigSavePayload, box), { ok: false, error: 'saveFailed' });
  });

  test('unsupported language falls back to the default', () => {
    const { config } = expectOk(applyConfigSave(storedForA(), payload({ language: 'fr' as unknown as 'es' }), box));
    assert.equal(config.language, 'es');
  });
}); // End of the describe block for existing rules

describe('validateStoredConfig', () => {
  test('keeps a valid pin and Client Secret blob', () => {
    const config = validateStoredConfig(storedForA());
    assert.deepEqual(config, storedForA());
  });

  test('drops malformed pins and wrongly typed fields', () => {
    const base = storedForA();
    for (const certificatePin of [
      { ...base.certificatePin, sha256: 'not-a-fingerprint' },
      { ...base.certificatePin, origin: 'http://192.168.1.130:8043' },
      { ...base.certificatePin, origin: `${URL_A}/path` },
      { origin: URL_A, sha256: FINGERPRINT },
      'pin',
      null
    ]) {
      assert.equal(validateStoredConfig({ ...base, certificatePin }).certificatePin, undefined, JSON.stringify(certificatePin));
    }
    const config = validateStoredConfig({ url: 7, username: null, language: 'xx', encryptedClientSecret: 5, siteId: 'x'.repeat(129) });
    assert.deepEqual(config, { url: '', username: '', language: 'es' });
  }); // End of test "drops malformed pins and wrongly typed fields"
}); // End of the describe block for validateStoredConfig

describe('toRendererConfig', () => {
  test('exposes flags, the Client ID and the pinned fingerprint only — never secret material', () => {
    const view = toRendererConfig(storedForA(), box);
    assert.deepEqual(view, {
      url: URL_A,
      username: 'admin',
      language: 'en',
      hasPassword: true,
      pinnedFingerprint: FINGERPRINT,
      clientId: 'client-A',
      hasClientSecret: true,
      clientSecretSessionOnly: false,
      canPersistClientSecret: true
    });
    const serialized = JSON.stringify(view);
    for (const secret of [
      'password-for-A',
      'legacy-plaintext-A',
      'client-secret-A',
      storedForA().encryptedPassword as string,
      storedForA().encryptedClientSecret as string
    ]) {
      assert.ok(!serialized.includes(secret), secret);
    }
  }); // End of test "exposes flags, the Client ID and the pinned fingerprint o..."

  test('a pin for another origin is not reported; an undecryptable password reports hasPassword false', () => {
    const config: StoredConfig = {
      url: URL_B,
      username: 'admin',
      language: 'en',
      encryptedPassword: Buffer.from('garbage').toString('base64'),
      certificatePin: { origin: URL_A, sha256: FINGERPRINT, trustedAt: 't' }
    };
    assert.deepEqual(toRendererConfig(config, box), {
      url: URL_B,
      username: 'admin',
      language: 'en',
      hasPassword: false,
      pinnedFingerprint: null,
      clientId: '',
      hasClientSecret: false,
      clientSecretSessionOnly: false,
      canPersistClientSecret: true
    });
  }); // End of test "a pin for another origin is not reported; an undecryptabl..."
}); // End of the describe block for toRendererConfig

describe('applyConfigSave: management access (Client ID / Client Secret)', () => {
  const SECRET = 'Open-API-Secret-Value-123';

  /**
   * Asserts that a stored config, serialized as config.ts writes it, holds no
   * plaintext Client Secret.
   * @param {StoredConfig} config - The config to persist.
   */
  function assertNoPlainSecret(config: StoredConfig): void {
    assert.ok(!JSON.stringify(config, null, 2).includes(SECRET), JSON.stringify(config));
  }

  test('encryption available: a typed secret is stored only as a blob; the Client ID is trimmed and stored in plain text', () => {
    const { config, sessionClientSecret } = expectOk(
      applyConfigSave(storedForA(), payload({ clientId: '  new-client  ', clientSecret: SECRET }), box, 'old-session-secret')
    );
    assert.equal(config.clientId, 'new-client');
    assert.equal(config.encryptedClientSecret, box.encryptString(SECRET));
    assert.equal(sessionClientSecret, null);
    assertNoPlainSecret(config);
  });

  test('encryption unavailable: the secret is refused for disk (old blob dropped too) and kept for the session only', () => {
    const noEncryption = fakeBox({ available: false });
    const { config, sessionClientSecret } = expectOk(applyConfigSave(storedForA(), payload({ clientId: 'client-A', clientSecret: SECRET }), noEncryption));
    assert.equal(config.clientId, 'client-A');
    assert.equal(config.encryptedClientSecret, undefined);
    assert.equal(sessionClientSecret, SECRET);
    assertNoPlainSecret(config);
    // What the renderer then sees: a usable, session-only secret — never the value
    const view = toRendererConfig(config, noEncryption, sessionClientSecret);
    assert.equal(view.hasClientSecret, true);
    assert.equal(view.clientSecretSessionOnly, true);
    assert.equal(view.canPersistClientSecret, false);
    assert.ok(!JSON.stringify(view).includes(SECRET));
  }); // End of test "encryption unavailable: the secret is refused for disk (o..."

  test('blank secret keeps the stored one for the same URL and Client ID (blob or session-only); no management fields keep everything', () => {
    const current = storedForA();
    const sameId = expectOk(applyConfigSave(current, payload({ clientId: ' client-A ' }), box, null));
    assert.equal(sameId.config.encryptedClientSecret, current.encryptedClientSecret);
    assert.equal(sameId.config.clientId, 'client-A');
    const session = expectOk(applyConfigSave({ ...current, encryptedClientSecret: undefined }, payload({ clientId: 'client-A' }), box, 'session-secret'));
    assert.equal(session.sessionClientSecret, 'session-secret');
    assert.equal(session.config.encryptedClientSecret, undefined);
    const untouched = expectOk(applyConfigSave(current, payload({}), box, 'session-secret'));
    assert.equal(untouched.config.clientId, 'client-A');
    assert.equal(untouched.config.encryptedClientSecret, current.encryptedClientSecret);
    assert.equal(untouched.sessionClientSecret, 'session-secret');
    // The Client ID alone (its session-only secret lost in a restart) can still be re-saved
    const idOnly = expectOk(applyConfigSave({ ...current, encryptedClientSecret: undefined }, payload({ clientId: 'client-A' }), box, null));
    assert.equal(idOnly.config.clientId, 'client-A');
    assert.equal(idOnly.sessionClientSecret, null);
  }); // End of test "blank secret keeps the stored one..."

  test('an old secret is never reused for a new Client ID or a new URL; a secret needs a Client ID; the Client ID is validated', () => {
    assert.deepEqual(applyConfigSave(storedForA(), payload({ clientId: 'other-client' }), box), { ok: false, error: 'clientSecretRequired' });
    assert.deepEqual(applyConfigSave(storedForA(), payload({ clientId: 'client-A' }), box, 'session-secret').ok, true);
    assert.deepEqual(applyConfigSave(storedForA(), payload({ url: URL_B, password: 'pw', clientId: 'client-A' }), box), { ok: false, error: 'clientSecretRequired' });
    assert.deepEqual(applyConfigSave(storedForA(), payload({ clientSecret: SECRET }), box), { ok: false, error: 'clientIdRequired' });
    for (const clientId of ['', '   ', 'has space', 'semi;colon', 'x'.repeat(129), 'ñandú']) {
      assert.deepEqual(applyConfigSave(storedForA(), payload({ clientId, clientSecret: SECRET }), box), { ok: false, error: 'invalidClientId' }, clientId);
    }
    assert.deepEqual(applyConfigSave(storedForA(), payload({ clientId: 'c', clientSecret: SECRET }), fakeBox({ failEncrypt: true })), { ok: false, error: 'saveFailed' });
    assert.deepEqual(applyConfigSave(storedForA(), payload({ clientId: 5 as unknown as string }), box), { ok: false, error: 'invalidClientId' });
    assert.deepEqual(applyConfigSave(storedForA(), payload({ clientId: 'c', clientSecret: 7 as unknown as string }), box), { ok: false, error: 'saveFailed' });
  }); // End of test "an old secret is never reused..."

  test('a URL change drops the Client ID, the stored secret and the session-only secret, unless new credentials come with it', () => {
    const dropped = expectOk(applyConfigSave(storedForA(), payload({ url: URL_B, password: 'pw' }), box, 'session-secret'));
    assert.equal(dropped.config.clientId, undefined);
    assert.equal(dropped.config.encryptedClientSecret, undefined);
    assert.equal(dropped.sessionClientSecret, null);
    const renewed = expectOk(applyConfigSave(storedForA(), payload({ url: URL_B, password: 'pw', clientId: 'client-B', clientSecret: SECRET }), box, 'session-secret'));
    assert.equal(renewed.config.clientId, 'client-B');
    assert.equal(renewed.config.encryptedClientSecret, box.encryptString(SECRET));
    assert.equal(renewed.sessionClientSecret, null);
  });

  test('removeManagementAccess clears the Client ID, the stored blob and the session-only secret; it never mixes with new values', () => {
    const { config, sessionClientSecret } = expectOk(applyConfigSave(storedForA(), payload({ removeManagementAccess: true }), box, 'session-secret'));
    assert.equal(config.clientId, undefined);
    assert.equal(config.encryptedClientSecret, undefined);
    assert.equal(sessionClientSecret, null);
    assert.equal(config.encryptedPassword, storedForA().encryptedPassword);
    assert.equal(config.siteId, 'site-a');
    assert.deepEqual(applyConfigSave(storedForA(), payload({ removeManagementAccess: true, clientId: 'c' }), box), { ok: false, error: 'saveFailed' });
    assert.deepEqual(applyConfigSave(storedForA(), payload({ removeManagementAccess: true, clientSecret: SECRET }), box), { ok: false, error: 'saveFailed' });
    assert.deepEqual(applyConfigSave(storedForA(), payload({ removeManagementAccess: false as unknown as true }), box), { ok: false, error: 'saveFailed' });
  });

  test('the renderer view never carries the secret: a corrupt blob reports no secret; credentials stay main-only', () => {
    const corrupt: StoredConfig = { ...storedForA(), encryptedClientSecret: Buffer.from('garbage').toString('base64') };
    assert.deepEqual(managementAccessStatus(corrupt, box, null), {
      clientId: 'client-A',
      hasClientSecret: false,
      clientSecretSessionOnly: false,
      canPersistClientSecret: true
    });
    const sessionView = managementAccessStatus({ ...storedForA(), encryptedClientSecret: undefined }, box, 'session-secret');
    assert.equal(sessionView.hasClientSecret, true);
    assert.equal(sessionView.clientSecretSessionOnly, true);
    assert.ok(!JSON.stringify(sessionView).includes('session-secret'));
    // Main-only credentials: the session secret wins, else the decrypted blob; none without a Client ID
    assert.deepEqual(managementCredentialsOf(storedForA(), box, null), { clientId: 'client-A', clientSecret: 'client-secret-A' });
    assert.deepEqual(managementCredentialsOf(storedForA(), box, 'session-secret'), { clientId: 'client-A', clientSecret: 'session-secret' });
    assert.equal(managementCredentialsOf({ ...storedForA(), clientId: undefined }, box, 'session-secret'), null);
    assert.equal(managementCredentialsOf(corrupt, box, null), null);
  }); // End of test "the renderer view never carries the secret..."

  test('validateStoredConfig() keeps a valid Client ID (trimmed) and drops an invalid one; normalizeClientId()', () => {
    assert.equal(validateStoredConfig({ ...storedForA(), clientId: ' client-A ' }).clientId, 'client-A');
    assert.equal(validateStoredConfig({ ...storedForA(), clientId: 'bad id' }).clientId, undefined);
    assert.equal(validateStoredConfig({ ...storedForA(), clientId: 42 }).clientId, undefined);
    assert.equal(normalizeClientId('abc.DEF_1-2'), 'abc.DEF_1-2');
    assert.equal(normalizeClientId(''), null);
    assert.equal(normalizeClientId(undefined), null);
  });

  test('Linux basic_text / unknown backend (encryption available, storage not secure): the Client Secret is session-only, the password is still encrypted', () => {
    const obfuscationOnly = fakeBox({ secure: false });
    const { config, sessionClientSecret } = expectOk(
      applyConfigSave(storedForA(), payload({ password: 'new-password', clientId: 'client-A', clientSecret: SECRET }), obfuscationOnly)
    );
    // The password keeps its own rule: encrypted whenever encryption is available
    assert.equal(config.encryptedPassword, obfuscationOnly.encryptString('new-password'));
    assert.equal(config.password, undefined);
    // The Client Secret is never written (the old blob is dropped too) and lives for the session only
    assert.equal(config.clientId, 'client-A');
    assert.equal(config.encryptedClientSecret, undefined);
    assert.equal(sessionClientSecret, SECRET);
    assertNoPlainSecret(config);
    const view = toRendererConfig(config, obfuscationOnly, sessionClientSecret);
    assert.equal(view.hasPassword, true);
    assert.equal(view.hasClientSecret, true);
    assert.equal(view.clientSecretSessionOnly, true);
    assert.equal(view.canPersistClientSecret, false);
    assert.ok(!JSON.stringify(view).includes(SECRET));
  }); // End of test "Linux basic_text / unknown backend (encryption available..."

  test('an existing blob is not trusted while storage is not secure: not used, not reported, kept on disk by a blank save, dropped by a typed secret', () => {
    const obfuscationOnly = fakeBox({ secure: false });
    const current = storedForA();
    assert.deepEqual(managementAccessStatus(current, obfuscationOnly, null), {
      clientId: 'client-A',
      hasClientSecret: false,
      clientSecretSessionOnly: false,
      canPersistClientSecret: false
    });
    assert.equal(managementCredentialsOf(current, obfuscationOnly, null), null);
    // The password is unaffected
    assert.equal(toRendererConfig(current, obfuscationOnly).hasPassword, true);
    // A blank-secret save (same URL and Client ID) leaves the blob untouched on disk but still unused
    const blank = expectOk(applyConfigSave(current, payload({ clientId: 'client-A' }), obfuscationOnly, null));
    assert.equal(blank.config.encryptedClientSecret, current.encryptedClientSecret);
    assert.equal(managementCredentialsOf(blank.config, obfuscationOnly, null), null);
    // The same blob is trusted again in a session with a real secret store
    assert.deepEqual(managementCredentialsOf(blank.config, box, null), { clientId: 'client-A', clientSecret: 'client-secret-A' });
    // A typed secret replaces it with a session-only one
    const typed = expectOk(applyConfigSave(current, payload({ clientId: 'client-A', clientSecret: SECRET }), obfuscationOnly, null));
    assert.equal(typed.config.encryptedClientSecret, undefined);
    assert.deepEqual(managementCredentialsOf(typed.config, obfuscationOnly, typed.sessionClientSecret), { clientId: 'client-A', clientSecret: SECRET });
  }); // End of test "an existing blob is not trusted while storage is not secure..."
}); // End of the describe block for management access

describe('secureSecretStorageAvailable (may the Client Secret be persisted?)', () => {
  /**
   * A fake safeStorage. `backend` undefined = no getSelectedStorageBackend()
   * method at all; a backend of 'throw' makes the method throw; `available`
   * 'throw' makes isEncryptionAvailable() throw. Counts backend queries.
   * @param {{ available?: boolean | 'throw'; backend?: string }} options - Behaviour switches.
   * @returns {SafeStorageProbe & { backendQueries: number }} The fake.
   */
  function probe(options: { available?: boolean | 'throw'; backend?: string }): SafeStorageProbe & { backendQueries: number } {
    const fake: SafeStorageProbe & { backendQueries: number } = {
      backendQueries: 0,
      isEncryptionAvailable: () => {
        if (options.available === 'throw') {
          throw new Error('not ready');
        }
        return options.available !== false;
      }
    };
    if (options.backend !== undefined) {
      fake.getSelectedStorageBackend = () => {
        fake.backendQueries++;
        if (options.backend === 'throw') {
          throw new Error('backend query failed');
        }
        return options.backend as string;
      };
    }
    return fake;
  } // End of function probe()

  test('Linux: basic_text and unknown cannot persist; gnome_libsecret and kwallet* can', () => {
    assert.equal(secureSecretStorageAvailable('linux', probe({ backend: 'basic_text' })), false);
    assert.equal(secureSecretStorageAvailable('linux', probe({ backend: 'unknown' })), false);
    for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) {
      assert.equal(secureSecretStorageAvailable('linux', probe({ backend })), true, backend);
    }
    assert.deepEqual([...SECURE_LINUX_STORAGE_BACKENDS], ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']);
  });

  test('Linux fails closed: an unrecognized backend name, a missing or throwing backend query', () => {
    for (const backend of ['', 'kwallet7', 'BASIC_TEXT', 'portal']) {
      assert.equal(secureSecretStorageAvailable('linux', probe({ backend })), false, backend);
    }
    assert.equal(secureSecretStorageAvailable('linux', probe({})), false);
    assert.equal(secureSecretStorageAvailable('linux', probe({ backend: 'throw' })), false);
    const nonString = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 42 as unknown as string };
    assert.equal(secureSecretStorageAvailable('linux', nonString), false);
  });

  test('macOS and Windows: encryption availability alone decides; the backend is never queried', () => {
    for (const platform of ['darwin', 'win32']) {
      const throwingBackend = probe({ backend: 'throw' });
      assert.equal(secureSecretStorageAvailable(platform, throwingBackend), true, platform);
      assert.equal(throwingBackend.backendQueries, 0, platform);
      assert.equal(secureSecretStorageAvailable(platform, probe({ backend: 'basic_text' })), true, platform);
      assert.equal(secureSecretStorageAvailable(platform, probe({})), true, platform);
    }
  });

  test('encryption unavailable (or its query throwing) cannot persist on any platform, without querying the backend', () => {
    for (const platform of ['linux', 'darwin', 'win32']) {
      const unavailable = probe({ available: false, backend: 'gnome_libsecret' });
      assert.equal(secureSecretStorageAvailable(platform, unavailable), false, platform);
      assert.equal(unavailable.backendQueries, 0, platform);
      assert.equal(secureSecretStorageAvailable(platform, probe({ available: 'throw', backend: 'gnome_libsecret' })), false, platform);
    }
  });
}); // End of the describe block for secureSecretStorageAvailable
