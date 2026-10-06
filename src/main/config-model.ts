// Config model and save rules. Pure (no Electron, no filesystem): encryption
// is injected through the SecretBox interface (config.ts passes a safeStorage
// implementation, unit tests a fake), so the rules — including the URL-scoped
// credentials of todo.md 4.4 — are unit-tested directly
// (tests/unit/config-model.test.ts). config.ts owns the file I/O, the
// in-memory cache and the legacy-password migration.

import type { ConfigSaveError, ConfigSavePayload, Language, RendererConfig } from '../shared/types';
import { CertificatePin, isValidCertificatePin, pinnedFingerprintFor } from './cert-pinning';
import { isSameControllerUrl, normalizeControllerUrl } from './url';

// Supported UI languages; anything else falls back to the default on load
export const SUPPORTED_LANGUAGES: readonly Language[] = ['es', 'en'];
export const DEFAULT_LANGUAGE: Language = 'es';

// Length cap for a stored site id (Omada ids are short generated strings; the
// cap only rejects absurd values coming from a hand-edited config file)
const MAX_SITE_ID_LENGTH = 128;

/**
 * Shape of the config as persisted on disk and cached in memory.
 *
 * The password is normally stored only as `encryptedPassword`, a base64
 * safeStorage blob (Keychain-backed on macOS) that is decrypted exclusively
 * in the main process. Fallback: when safeStorage reports encryption as
 * unavailable (e.g. a Linux session without a secret service), the plaintext
 * `password` field is kept instead — with a console warning — so the app
 * stays usable rather than crashing or silently dropping the credential. The
 * plaintext `password` field is also how legacy (pre-encryption) config files
 * look; config.ts migrates those once on first load.
 *
 * Everything tied to one controller — the password, the Client Secret, the
 * site id and the certificate pin — is scoped to `url`: applyConfigSave()
 * drops all of them when the URL changes.
 */
export interface StoredConfig {
  url: string;
  username: string;
  language: Language;
  encryptedPassword?: string;
  password?: string;
  // Open API Client Secret as a safeStorage blob. Written by the Open API
  // credentials feature (phase 15); this model only validates, keeps it on a
  // same-URL save and drops it when the URL changes
  encryptedClientSecret?: string;
  // Site chosen by the user on a multi-site controller. Reused on the next
  // connect only when it is still in the authorized-site list (the membership
  // check lives in OmadaController.connect())
  siteId?: string;
  // Trusted controller certificate (TOFU pin, see cert-pinning.ts)
  certificatePin?: CertificatePin;
}

/**
 * The encryption primitives the config needs (safeStorage in production).
 * Blobs are base64 strings.
 */
export interface SecretBox {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): string;
  decryptString(blob: string): string;
}

/**
 * Result of applyConfigSave(): the config to persist, or an error code.
 * `urlChanged` tells the caller to drop TLS state tied to the old controller.
 */
export type ConfigSaveOutcome =
  | { ok: true; config: StoredConfig; urlChanged: boolean }
  | { ok: false; error: ConfigSaveError };

/**
 * Type guard for supported languages.
 * @param {unknown} value - Candidate value read from disk or IPC.
 * @returns {value is Language} True when the value is a supported language.
 */
export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Returns a fresh default (empty) configuration.
 * @returns {StoredConfig} An empty config with the default language.
 */
export function defaultConfig(): StoredConfig {
  return { url: '', username: '', language: DEFAULT_LANGUAGE };
}

/**
 * Validates a parsed JSON value into a StoredConfig: every field must have the
 * expected type (unexpected types are dropped, not blindly cast) and the
 * language must be one of the supported values, else the default is used.
 * @param {unknown} parsed - The raw value produced by JSON.parse.
 * @returns {StoredConfig} A config with only validated fields.
 */
export function validateStoredConfig(parsed: unknown): StoredConfig {
  const config = defaultConfig();
  if (typeof parsed !== 'object' || parsed === null) {
    console.warn('Config file does not contain a JSON object; using defaults');
    return config;
  }
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.url === 'string') {
    config.url = raw.url;
  }
  if (typeof raw.username === 'string') {
    config.username = raw.username;
  }
  if (isSupportedLanguage(raw.language)) {
    config.language = raw.language;
  }
  if (typeof raw.encryptedPassword === 'string' && raw.encryptedPassword) {
    config.encryptedPassword = raw.encryptedPassword;
  }
  if (typeof raw.password === 'string' && raw.password) {
    config.password = raw.password;
  }
  if (typeof raw.encryptedClientSecret === 'string' && raw.encryptedClientSecret) {
    config.encryptedClientSecret = raw.encryptedClientSecret;
  }
  if (typeof raw.siteId === 'string' && raw.siteId && raw.siteId.length <= MAX_SITE_ID_LENGTH) {
    config.siteId = raw.siteId;
  }
  if (isValidCertificatePin(raw.certificatePin)) {
    const pin = raw.certificatePin;
    config.certificatePin = { origin: pin.origin, sha256: pin.sha256, trustedAt: pin.trustedAt };
  }
  return config;
} // End of function validateStoredConfig()

/**
 * Decrypts the stored password. Main process only — this value must never be
 * sent over IPC to the renderer.
 * @param {StoredConfig} config - The config holding the password.
 * @param {SecretBox} box - Decryption primitives.
 * @returns {string} The plaintext password, or '' when none/undecryptable.
 */
export function decryptStoredPassword(config: StoredConfig, box: SecretBox): string {
  if (config.encryptedPassword) {
    try {
      return box.decryptString(config.encryptedPassword);
    } catch (error) {
      console.error('Error decrypting the stored password:', error);
      return '';
    }
  }
  // Plaintext fallback (safeStorage unavailable, or not-yet-migrated legacy)
  return config.password || '';
} // End of function decryptStoredPassword()

/**
 * Builds the renderer-safe view of a config: no secret material, only flags,
 * plus the pinned certificate fingerprint (public data) when the pin belongs
 * to the configured origin.
 * @param {StoredConfig} config - The stored config.
 * @param {SecretBox} box - Decryption primitives (to test the password).
 * @returns {RendererConfig} The renderer-safe view.
 */
export function toRendererConfig(config: StoredConfig, box: SecretBox): RendererConfig {
  return {
    url: config.url,
    username: config.username,
    language: config.language,
    // Report a stored password only when it can actually be produced — a
    // corrupt/undecryptable blob must make the UI ask for the password again
    hasPassword: decryptStoredPassword(config, box) !== '',
    pinnedFingerprint: pinnedFingerprintFor(config.url, config.certificatePin ?? null)
  };
} // End of function toRendererConfig()

/**
 * Applies a settings save from the renderer to the current config. Rules:
 * - the URL is normalized (normalizeControllerUrl(): HTTPS only, no
 *   credentials/fragment) — invalid → 'invalidUrl';
 * - the username must be a non-blank string — else 'saveFailed';
 * - URL-scoped credentials: when the normalized URL differs from the stored
 *   one, the stored password (blob AND legacy plaintext), the Client Secret,
 *   the site id and the certificate pin are all dropped, and a password must
 *   be typed — a blank one is 'passwordRequired' (it must never carry
 *   controller A's password over to controller B);
 * - same URL with no typed password: the stored password is kept, unless
 *   nothing usable is stored ('passwordRequired');
 * - a typed password is encrypted when encryption is available, else kept in
 *   plaintext with a warning (documented fallback); an encryption failure is
 *   'saveFailed'.
 * @param {StoredConfig} current - The config currently stored.
 * @param {ConfigSavePayload} payload - The settings sent by the renderer.
 * @param {SecretBox} box - Encryption primitives.
 * @returns {ConfigSaveOutcome} The config to persist, or an error code.
 */
export function applyConfigSave(current: StoredConfig, payload: ConfigSavePayload, box: SecretBox): ConfigSaveOutcome {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, error: 'saveFailed' };
  }

  const normalizedUrl = normalizeControllerUrl(payload.url);
  if (!normalizedUrl) {
    return { ok: false, error: 'invalidUrl' };
  }

  if (typeof payload.username !== 'string' || !payload.username.trim()) {
    return { ok: false, error: 'saveFailed' };
  }

  const urlChanged = !isSameControllerUrl(current.url, normalizedUrl);
  let encryptedPassword: string | undefined;
  let plainPassword: string | undefined;

  if (typeof payload.password === 'string' && payload.password.length > 0) {
    // The user typed a new password: encrypt it (or keep plaintext as the
    // documented fallback when encryption is unavailable)
    if (box.isEncryptionAvailable()) {
      try {
        encryptedPassword = box.encryptString(payload.password);
      } catch (error) {
        console.error('Error encrypting the password:', error);
        return { ok: false, error: 'saveFailed' };
      }
    } else {
      console.warn('safeStorage encryption is unavailable; storing the password in plaintext');
      plainPassword = payload.password;
    }
  } else {
    // No password in the payload. A different controller never inherits the
    // stored one; for the same controller, keep it — unless nothing is stored
    // or the stored blob can no longer be decrypted (retaining an unusable
    // blob would hide the problem forever)
    if (urlChanged || decryptStoredPassword(current, box) === '') {
      return { ok: false, error: 'passwordRequired' };
    }
    encryptedPassword = current.encryptedPassword;
    plainPassword = current.password;
  } // End of the password keep/require branch

  const config: StoredConfig = {
    url: normalizedUrl,
    username: payload.username.trim(),
    language: isSupportedLanguage(payload.language) ? payload.language : DEFAULT_LANGUAGE
  };
  if (encryptedPassword) {
    config.encryptedPassword = encryptedPassword;
  }
  if (plainPassword) {
    config.password = plainPassword;
  }
  // Everything else tied to the controller survives only while the URL is
  // unchanged: a different controller has its own sites, Open API client and
  // certificate
  if (!urlChanged) {
    if (current.encryptedClientSecret) {
      config.encryptedClientSecret = current.encryptedClientSecret;
    }
    if (current.siteId) {
      config.siteId = current.siteId;
    }
    if (current.certificatePin) {
      config.certificatePin = { ...current.certificatePin };
    }
  }
  return { ok: true, config, urlChanged };
} // End of function applyConfigSave()
