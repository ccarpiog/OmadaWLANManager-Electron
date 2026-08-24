import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { safeStorage } from 'electron';
import { ConfigSavePayload, ConfigSaveResult, Language, RendererConfig } from '../shared/types';

// Config file path. Note: since the password is now stored encrypted, the
// on-disk format is no longer compatible with the old Python version (this
// break was an accepted decision).
const CONFIG_DIR = path.join(os.homedir(), '.omada-wlan-manager');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Supported UI languages; anything else falls back to the default on load
const SUPPORTED_LANGUAGES: readonly Language[] = ['es', 'en'];
const DEFAULT_LANGUAGE: Language = 'es';

/**
 * Shape of the config as persisted on disk and cached in memory.
 *
 * The password is normally stored only as `encryptedPassword`, a base64
 * safeStorage blob (Keychain-backed on macOS) that is decrypted exclusively
 * in the main process. Fallback: when safeStorage reports encryption as
 * unavailable (`safeStorage.isEncryptionAvailable() === false`, e.g. a Linux
 * session without a secret service), the plaintext `password` field is kept
 * instead — with a console warning — so the app stays usable rather than
 * crashing or silently dropping the credential. The plaintext `password`
 * field is also how legacy (pre-encryption) config files look; those are
 * migrated once on first load (see migrateLegacyPassword()).
 */
interface StoredConfig {
  url: string;
  username: string;
  language: Language;
  encryptedPassword?: string;
  password?: string;
  // Site chosen by the user on a multi-site controller. Reused on the next
  // connect only when it is still in the authorized-site list (the membership
  // check lives in OmadaController.connect()); dropped when the URL changes.
  siteId?: string;
}

// Length cap for a stored site id (Omada ids are short generated strings; the
// cap only rejects absurd values coming from a hand-edited config file)
const MAX_SITE_ID_LENGTH = 128;

// In-memory cache of the parsed config. Populated lazily on first read and
// updated on every save, so hot paths (like TLS certificate verification)
// never touch the filesystem.
let cachedConfig: StoredConfig | null = null;

/**
 * Type guard for supported languages.
 * @param {unknown} value - Candidate value read from disk or IPC.
 * @returns {value is Language} True when the value is a supported language.
 */
function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

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

/**
 * Returns a fresh default (empty) configuration.
 * @returns {StoredConfig} An empty config with the default language.
 */
function defaultConfig(): StoredConfig {
  return { url: '', username: '', language: DEFAULT_LANGUAGE };
}

/**
 * Validates a parsed JSON value into a StoredConfig: every field must have the
 * expected type (unexpected types are dropped, not blindly cast) and the
 * language must be one of the supported values, else the default is used.
 * @param {unknown} parsed - The raw value produced by JSON.parse.
 * @returns {StoredConfig} A config with only validated fields.
 */
function validateStoredConfig(parsed: unknown): StoredConfig {
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
  if (typeof raw.siteId === 'string' && raw.siteId && raw.siteId.length <= MAX_SITE_ID_LENGTH) {
    config.siteId = raw.siteId;
  }
  return config;
} // End of function validateStoredConfig()

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
    config.encryptedPassword = safeStorage.encryptString(config.password).toString('base64');
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
 * Decrypts the stored password. Main process only — this value must never be
 * sent over IPC to the renderer.
 * @param {StoredConfig} config - The config holding the password.
 * @returns {string} The plaintext password, or '' when none/undecryptable.
 */
function getDecryptedPassword(config: StoredConfig): string {
  if (config.encryptedPassword) {
    try {
      return safeStorage.decryptString(Buffer.from(config.encryptedPassword, 'base64'));
    } catch (error) {
      console.error('Error decrypting the stored password:', error);
      return '';
    }
  }
  // Plaintext fallback (safeStorage unavailable, or not-yet-migrated legacy)
  return config.password || '';
}

/**
 * Returns the sanitized config for the renderer: no password material, only
 * a boolean flag telling whether one is stored.
 * @returns {RendererConfig} The renderer-safe view of the config.
 */
export function getRendererConfig(): RendererConfig {
  const config = getCachedConfig();
  return {
    url: config.url,
    username: config.username,
    language: config.language,
    // Report a stored password only when it can actually be produced — a
    // corrupt/undecryptable blob must make the UI ask for the password again
    hasPassword: getDecryptedPassword(config) !== ''
  };
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
    password: getDecryptedPassword(config)
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
  const newConfig: StoredConfig = { ...getCachedConfig(), siteId };
  try {
    writeConfigFile(newConfig);
    cachedConfig = newConfig;
  } catch (error) {
    console.error('Error persisting the selected site id:', error);
  }
} // End of function saveStoredSiteId()

/**
 * Validates and normalizes a controller URL: it must parse, use HTTPS (plain
 * HTTP would send credentials unencrypted), and carry no embedded credentials
 * or fragment; a trailing slash is stripped. The renderer applies the same
 * rules (validateControllerUrl() in renderer.ts) — keep both in sync.
 * @param {unknown} raw - The URL as received (typed by the user / over IPC).
 * @returns {string | null} The normalized URL, or null when invalid.
 */
export function normalizeControllerUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  if (parsed.username || parsed.password || parsed.hash) {
    return null;
  }
  let normalized = parsed.toString();
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
} // End of function normalizeControllerUrl()

/**
 * Validates and saves the configuration sent by the renderer. The URL is
 * normalized with the same rules the renderer applies (HTTPS only, no
 * credentials/fragment). When the payload carries no password, the previously
 * stored (encrypted) one is kept; if none is stored either, the save is
 * rejected — a config without a password would be unusable. The password is
 * encrypted with safeStorage when available (plaintext fallback with a
 * warning otherwise, see StoredConfig), the file is written atomically, and
 * the in-memory cache is updated. Errors are returned as codes, never thrown.
 * @param {ConfigSavePayload} payload - The settings sent by the renderer.
 * @returns {ConfigSaveResult} Success flag plus an error code on failure.
 */
export function saveConfig(payload: ConfigSavePayload): ConfigSaveResult {
  if (typeof payload !== 'object' || payload === null) {
    return { success: false, error: 'saveFailed' };
  }

  const normalizedUrl = normalizeControllerUrl(payload.url);
  if (!normalizedUrl) {
    return { success: false, error: 'invalidUrl' };
  }

  if (typeof payload.username !== 'string' || !payload.username.trim()) {
    return { success: false, error: 'saveFailed' };
  }

  const current = getCachedConfig();
  let encryptedPassword: string | undefined;
  let plainPassword: string | undefined;

  if (typeof payload.password === 'string' && payload.password.length > 0) {
    // The user typed a new password: encrypt it (or keep plaintext as the
    // documented fallback when safeStorage encryption is unavailable)
    if (encryptionAvailable()) {
      try {
        encryptedPassword = safeStorage.encryptString(payload.password).toString('base64');
      } catch (error) {
        console.error('Error encrypting the password:', error);
        return { success: false, error: 'saveFailed' };
      }
    } else {
      console.warn('safeStorage encryption is unavailable; storing the password in plaintext');
      plainPassword = payload.password;
    }
  } else {
    // No password in the payload: keep the previously stored one; reject the
    // save when there is nothing stored OR the stored blob can no longer be
    // decrypted (retaining an unusable blob would hide the problem forever)
    if (getDecryptedPassword(current) === '') {
      return { success: false, error: 'passwordRequired' };
    }
    encryptedPassword = current.encryptedPassword;
    plainPassword = current.password;
  }

  const newConfig: StoredConfig = {
    url: normalizedUrl,
    username: payload.username.trim(),
    language: isSupportedLanguage(payload.language) ? payload.language : DEFAULT_LANGUAGE
  };
  if (encryptedPassword) {
    newConfig.encryptedPassword = encryptedPassword;
  }
  if (plainPassword) {
    newConfig.password = plainPassword;
  }
  // Keep the previously chosen site only while the controller URL is
  // unchanged: a different controller has different site ids anyway
  if (current.siteId && current.url === normalizedUrl) {
    newConfig.siteId = current.siteId;
  }

  try {
    writeConfigFile(newConfig);
  } catch (error) {
    console.error('Error saving config:', error);
    return { success: false, error: 'saveFailed' };
  }

  // Update the in-memory cache only after a successful write
  cachedConfig = newConfig;
  return { success: true };
} // End of function saveConfig()
