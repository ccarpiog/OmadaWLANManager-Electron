import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { safeStorage } from 'electron';
import { ConfigSavePayload, ConfigSaveResult, RendererConfig } from '../shared/types';
import { CertificatePin } from './cert-pinning';
import {
  applyConfigSave,
  decryptStoredPassword,
  defaultConfig,
  SecretBox,
  StoredConfig,
  toRendererConfig,
  validateStoredConfig
} from './config-model';

// Config file path. The format (encrypted password, URL-scoped credentials,
// certificate pin — see StoredConfig in config-model.ts) is not compatible
// with the old Python version (an accepted, one-way break).
const CONFIG_DIR = path.join(os.homedir(), '.omada-wlan-manager');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// In-memory cache of the parsed config. Populated lazily on first read and
// updated on every save, so hot paths (like TLS certificate verification)
// never touch the filesystem.
let cachedConfig: StoredConfig | null = null;

/**
 * Reports whether safeStorage encryption can be used, never throwing
 * (safeStorage throws when queried before the app is ready on some platforms).
 * @returns {boolean} True when OS-level encryption is available.
 */
function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

// The production SecretBox: safeStorage, with blobs stored as base64
const safeStorageBox: SecretBox = {
  isEncryptionAvailable: encryptionAvailable,
  encryptString: (plainText) => safeStorage.encryptString(plainText).toString('base64'),
  decryptString: (blob) => safeStorage.decryptString(Buffer.from(blob, 'base64'))
};

/**
 * Writes the config file atomically: the JSON is written to a temp file in
 * the same directory (mode 0o600) and then renamed over the real file, so a
 * crash mid-write can never leave truncated JSON behind. The config directory
 * is created with mode 0o700 when missing.
 * @param {StoredConfig} config - The config to persist.
 */
function writeConfigFile(config: StoredConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  } else {
    tightenPermissions(CONFIG_DIR, 0o700);
  }
  const tempFile = path.join(CONFIG_DIR, `config.json.${process.pid}.tmp`);
  fs.writeFileSync(tempFile, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tempFile, CONFIG_FILE);
} // End of function writeConfigFile()

/**
 * Best-effort chmod that never throws — used to fix up permissions of legacy
 * files/directories created before modes were set explicitly.
 * @param {string} target - Path to chmod.
 * @param {number} mode - The mode to apply.
 */
function tightenPermissions(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch (error) {
    console.warn(`Could not set permissions on ${target}:`, error);
  }
}

/**
 * One-time migration of a legacy plaintext password: when a plaintext
 * `password` field is found on load and OS-level encryption is available, it
 * is encrypted, the file is rewritten, and the plaintext is dropped. When
 * encryption is unavailable the plaintext is kept as-is (with a warning) —
 * see the StoredConfig doc comment for the rationale of this fallback.
 * @param {StoredConfig} config - The config just loaded from disk (mutated in place).
 */
function migrateLegacyPassword(config: StoredConfig): void {
  if (!config.password) {
    return;
  }
  if (!encryptionAvailable()) {
    console.warn('safeStorage encryption is unavailable; keeping the stored password in plaintext');
    // The plaintext file stays on disk, so at least make sure a legacy file
    // created with the old default umask is not group/world-readable
    tightenPermissions(CONFIG_DIR, 0o700);
    tightenPermissions(CONFIG_FILE, 0o600);
    return;
  }
  try {
    config.encryptedPassword = safeStorageBox.encryptString(config.password);
    delete config.password;
    writeConfigFile(config);
    console.log('Migrated legacy plaintext password to safeStorage encryption');
  } catch (error) {
    console.error('Error migrating the plaintext password to safeStorage:', error);
  }
} // End of function migrateLegacyPassword()

/**
 * Reads and validates the config file from disk, migrating a legacy plaintext
 * password when found. Unparseable JSON is treated as "no config" (defaults)
 * but logged as a warning instead of being silently swallowed.
 * @returns {StoredConfig} The validated config, or defaults when missing/invalid.
 */
function readConfigFromDisk(): StoredConfig {
  let data: string;
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return defaultConfig();
    }
    data = fs.readFileSync(CONFIG_FILE, 'utf-8');
  } catch (error) {
    console.error('Error reading config file:', error);
    return defaultConfig();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    console.warn('Config file contains invalid JSON; treating it as no config:', error);
    return defaultConfig();
  }
  const config = validateStoredConfig(parsed);
  migrateLegacyPassword(config);
  return config;
} // End of function readConfigFromDisk()

/**
 * Returns the cached config, loading it from disk on first use.
 * @returns {StoredConfig} The in-memory config (never null after this call).
 */
function getCachedConfig(): StoredConfig {
  if (cachedConfig === null) {
    cachedConfig = readConfigFromDisk();
  }
  return cachedConfig;
}

/**
 * Writes a new config and, only when the write succeeded, makes it the cached
 * one. Errors are logged, never thrown.
 * @param {StoredConfig} newConfig - The config to persist.
 * @param {string} what - What is being saved (for the error log).
 * @returns {boolean} True when the config was written.
 */
function persistConfig(newConfig: StoredConfig, what: string): boolean {
  try {
    writeConfigFile(newConfig);
  } catch (error) {
    console.error(`Error saving ${what}:`, error);
    return false;
  }
  cachedConfig = newConfig;
  return true;
} // End of function persistConfig()

/**
 * Returns the sanitized config for the renderer: no password or Client Secret
 * material, only a hasPassword flag, plus the pinned certificate fingerprint
 * (not a secret) for the Settings display.
 * @returns {RendererConfig} The renderer-safe view of the config.
 */
export function getRendererConfig(): RendererConfig {
  return toRendererConfig(getCachedConfig(), safeStorageBox);
}

/**
 * Returns the credentials needed to connect to the controller, decrypting the
 * password in the main process. Never expose this result to the renderer.
 * @returns {{url: string, username: string, password: string}} The connection credentials.
 */
export function getConnectionCredentials(): { url: string; username: string; password: string } {
  const config = getCachedConfig();
  return {
    url: config.url,
    username: config.username,
    password: decryptStoredPassword(config, safeStorageBox)
  };
}

/**
 * Returns the configured controller URL from the in-memory cache. Used by the
 * TLS certificate-verification hot path, which must not hit the filesystem.
 * @returns {string} The configured URL, or '' when not configured.
 */
export function getConfiguredUrl(): string {
  return getCachedConfig().url;
}

/**
 * Returns the stored certificate pin from the in-memory cache (TLS hot path).
 * Whether it applies to the configured origin is decided by cert-pinning.ts.
 * @returns {CertificatePin | null} The stored pin, or null.
 */
export function getCertificatePin(): CertificatePin | null {
  return getCachedConfig().certificatePin ?? null;
}

/**
 * Persists a trusted certificate pin (replacing any previous one).
 * @param {CertificatePin} pin - The pin to store (validated by the caller).
 * @returns {boolean} True when the pin was written.
 */
export function saveCertificatePin(pin: CertificatePin): boolean {
  return persistConfig({ ...getCachedConfig(), certificatePin: { ...pin } }, 'the certificate pin');
}

/**
 * Removes the stored certificate pin (a no-op success when none is stored).
 * @returns {boolean} True when no pin remains stored.
 */
export function clearCertificatePin(): boolean {
  const current = getCachedConfig();
  if (!current.certificatePin) {
    return true;
  }
  const newConfig: StoredConfig = { ...current };
  delete newConfig.certificatePin;
  return persistConfig(newConfig, 'the certificate pin removal');
} // End of function clearCertificatePin()

/**
 * Returns the site id the user previously chose on a multi-site controller.
 * @returns {string} The stored site id, or '' when none is stored.
 */
export function getStoredSiteId(): string {
  return getCachedConfig().siteId || '';
}

/**
 * Persists the site id the user just chose on a multi-site controller, so the
 * next connect can reuse it without asking again. A write failure is logged
 * but not surfaced: the selection already took effect on the live controller
 * instance, it just will not be remembered across restarts.
 * @param {string} siteId - The chosen site id (already validated by the caller).
 */
export function saveStoredSiteId(siteId: string): void {
  persistConfig({ ...getCachedConfig(), siteId }, 'the selected site id');
}

/**
 * Validates and saves the configuration sent by the renderer, applying the
 * rules of applyConfigSave() (config-model.ts): URL normalization, the
 * password keep/require rules and the URL-scoped credentials (a URL change
 * drops the password, Client Secret, site id and certificate pin, and
 * requires a typed password). The file is written atomically and the
 * in-memory cache is updated only after a successful write. Errors are
 * returned as codes, never thrown.
 * @param {ConfigSavePayload} payload - The settings sent by the renderer.
 * @returns {ConfigSaveResult & { urlChanged?: boolean }} Success flag plus an
 *   error code on failure; on success, whether the controller URL changed
 *   (main-process only — the IPC handler strips it before replying).
 */
export function saveConfig(payload: ConfigSavePayload): ConfigSaveResult & { urlChanged?: boolean } {
  const outcome = applyConfigSave(getCachedConfig(), payload, safeStorageBox);
  if (!outcome.ok) {
    return { success: false, error: outcome.error };
  }
  if (!persistConfig(outcome.config, 'config')) {
    return { success: false, error: 'saveFailed' };
  }
  return { success: true, urlChanged: outcome.urlChanged };
} // End of function saveConfig()
