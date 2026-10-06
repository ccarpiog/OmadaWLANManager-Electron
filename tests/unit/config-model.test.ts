// Tests for the config model and save rules (src/main/config-model.ts), in
// particular the URL-scoped credentials of todo.md 4.4: a controller URL
// change drops the password, Client Secret, site id and certificate pin and
// requires a typed password; a same-URL save keeps them. Encryption is a fake
// SecretBox (no Electron safeStorage).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyConfigSave,
  ConfigSaveOutcome,
  SecretBox,
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
 * @param {{ available?: boolean; failEncrypt?: boolean }} [options] - Behaviour switches.
 * @returns {SecretBox} The fake.
 */
function fakeBox(options: { available?: boolean; failEncrypt?: boolean } = {}): SecretBox {
  return {
    isEncryptionAvailable: () => options.available !== false,
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
    encryptedClientSecret: 'client-secret-blob-A',
    siteId: 'site-a',
    certificatePin: { origin: URL_A, sha256: FINGERPRINT, trustedAt: '2026-10-06T10:00:00.000Z' }
  };
} // End of function storedForA()

/**
 * Asserts a successful outcome and returns its config.
 * @param {ConfigSaveOutcome} outcome - The outcome.
 * @returns {{ config: StoredConfig; urlChanged: boolean }} The success payload.
 */
function expectOk(outcome: ConfigSaveOutcome): { config: StoredConfig; urlChanged: boolean } {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (!outcome.ok) {
    throw new Error('unreachable');
  }
  return { config: outcome.config, urlChanged: outcome.urlChanged };
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

  test('URL change with a typed password clears the old password (blob and plaintext), Client Secret, site id and pin', () => {
    const { config, urlChanged } = expectOk(applyConfigSave(storedForA(), payload({ url: `${URL_B}/`, password: 'password-for-B' }), box));
    assert.equal(urlChanged, true);
    assert.deepEqual(config, {
      url: URL_B,
      username: 'admin',
      language: 'en',
      encryptedPassword: box.encryptString('password-for-B')
    });
  });

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
    assert.equal(config.encryptedClientSecret, 'client-secret-blob-A');
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
  test('exposes flags and the pinned fingerprint only — never secret material', () => {
    const view = toRendererConfig(storedForA(), box);
    assert.deepEqual(view, { url: URL_A, username: 'admin', language: 'en', hasPassword: true, pinnedFingerprint: FINGERPRINT });
    const serialized = JSON.stringify(view);
    for (const secret of ['password-for-A', 'legacy-plaintext-A', 'client-secret-blob-A', storedForA().encryptedPassword as string]) {
      assert.ok(!serialized.includes(secret), secret);
    }
  });

  test('a pin for another origin is not reported; an undecryptable password reports hasPassword false', () => {
    const config: StoredConfig = {
      url: URL_B,
      username: 'admin',
      language: 'en',
      encryptedPassword: Buffer.from('garbage').toString('base64'),
      certificatePin: { origin: URL_A, sha256: FINGERPRINT, trustedAt: 't' }
    };
    assert.deepEqual(toRendererConfig(config, box), { url: URL_B, username: 'admin', language: 'en', hasPassword: false, pinnedFingerprint: null });
  });
}); // End of the describe block for toRendererConfig
