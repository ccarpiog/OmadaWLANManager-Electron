// Config model and save rules. Pure (no Electron, no filesystem): encryption
// is injected through the SecretBox interface (config.ts passes a safeStorage
// implementation, unit tests a fake), so the rules — including the URL-scoped
// credentials of todo.md 4.4, the optional Open API management access of
// todo.md 4.8 and the optional TP-Link cloud access of inbox item I-1 — are
// unit-tested directly (tests/unit/config-model.test.ts,
// tests/unit/config-cloud.test.ts). config.ts owns the file I/O, the in-memory
// cache, the session-only secrets and the legacy-password migration.

import type {
  CloudAccessStatus,
  CloudRegion,
  ConfigSaveError,
  ConfigSavePayload,
  Language,
  ManagementAccessStatus,
  RendererConfig
} from '../shared/types';
import { CertificatePin, isValidCertificatePin, pinnedFingerprintFor } from './cert-pinning';
import { CloudCredentials, isOmadacId } from './cloud-account-model';
import { DEFAULT_CLOUD_REGION, isCloudRegion } from './cloud-hosts';
import { redactErrorMessage } from './redact';
import { isSameControllerUrl, normalizeControllerUrl } from './url';

// The active controller when it is the configured one (reached directly);
// any other value of `activeController` is a cloud controller's omadacId
export const LOCAL_CONTROLLER = 'local';

// A site id remembered per cloud controller (same format as the site ids the
// IPC handlers accept, SITE_ID_REGEX in index.ts) and how many are kept
const CLOUD_SITE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_CLOUD_SITES = 64;

// Supported UI languages; anything else falls back to the default on load
export const SUPPORTED_LANGUAGES: readonly Language[] = ['es', 'en'];
export const DEFAULT_LANGUAGE: Language = 'es';

// Length cap for a stored site id (Omada ids are short generated strings; the
// cap only rejects absurd values coming from a hand-edited config file)
const MAX_SITE_ID_LENGTH = 128;

// Format of an Open API Client ID after trimming: 1–128 letters, digits, '.',
// '_' or '-'. The controller generates it (a hex-like string in TP-Link's
// documentation); the exact format is unverified (D4), so the check only
// rejects implausible input. The renderer mirrors it in
// src/renderer/management-form.ts (keep both in sync).
export const CLIENT_ID_REGEX = /^[A-Za-z0-9._-]{1,128}$/;

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
 * Everything tied to one controller — the password, the Open API Client ID
 * and Client Secret, the site id and the certificate pin — is scoped to
 * `url`: applyConfigSave() drops all of them when the URL changes (new
 * management credentials may come with the same save).
 */
export interface StoredConfig {
  url: string;
  username: string;
  language: Language;
  encryptedPassword?: string;
  password?: string;
  // Open API management access (optional, todo.md 4.8): the Client ID in
  // plain text (it is not a secret) and the Client Secret ONLY as a
  // safeStorage blob. There is no plaintext fallback for the secret: when
  // secure storage is unavailable (SecretBox.isSecureStorageAvailable(): no
  // encryption, or Linux's obfuscation-only basic_text / unknown backend) it
  // is kept in main-process memory for the session only (config.ts) and
  // nothing secret is written here
  clientId?: string;
  encryptedClientSecret?: string;
  // Site chosen by the user on a multi-site controller. Reused on the next
  // connect only when it is still in the authorized-site list (the membership
  // check lives in OmadaController.connect())
  siteId?: string;
  // Trusted controller certificate (TOFU pin, see cert-pinning.ts)
  certificatePin?: CertificatePin;
  // The configured controller's omadacId (learned on a local connect, inbox
  // I-1b; used to list a cloud duplicate of it once, as local). Tied to
  // `url` like the fields above: dropped when the URL changes
  localOmadacId?: string;
  // TP-Link cloud access (optional, inbox item I-1; docs/omada-cloud-openapi.md).
  // The account is not tied to the controller URL, so a URL change keeps all
  // of it. `cloudRegion` (absent: DEFAULT_CLOUD_REGION) and the cloud Client
  // ID in plain text (not secrets); the cloud Client Secret ONLY as a
  // safeStorage blob, with the management Client Secret's session-only
  // fallback (never plaintext on disk). Changing the region or the cloud
  // Client ID drops the stored secret
  cloudRegion?: CloudRegion;
  cloudClientId?: string;
  encryptedCloudClientSecret?: string;
  // 'local' (LOCAL_CONTROLLER; also when absent) or the omadacId of the cloud
  // controller the app works with
  activeController?: string;
  // The site chosen per cloud controller: omadacId -> site id
  cloudSites?: Record<string, string>;
}

/**
 * The encryption primitives the config needs (safeStorage in production).
 * Blobs are base64 strings. Two availability questions, on purpose:
 * - isEncryptionAvailable(): may the PASSWORD be encrypted (it falls back to
 *   plaintext otherwise — its documented, unchanged behaviour);
 * - isSecureStorageAvailable(): may the Open API CLIENT SECRET be persisted —
 *   encryption backed by a real OS secret store, not merely obfuscated (see
 *   secureSecretStorageAvailable()); the secret is session-only otherwise.
 */
export interface SecretBox {
  isEncryptionAvailable(): boolean;
  isSecureStorageAvailable(): boolean;
  encryptString(plainText: string): string;
  decryptString(blob: string): string;
}

// Linux safeStorage backends (Electron's getSelectedStorageBackend()) that
// keep the encryption key in a real OS secret store. Every other answer —
// 'basic_text' (a key hardcoded in Chromium: obfuscation, effectively
// plaintext), 'unknown', a name a future Electron adds, or no answer at all —
// fails closed: the Client Secret is not persisted.
export const SECURE_LINUX_STORAGE_BACKENDS: readonly string[] = ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'];

/**
 * The part of Electron's safeStorage that secureSecretStorageAvailable()
 * queries (structurally satisfied by `safeStorage` itself; a fake in tests).
 * getSelectedStorageBackend() exists on Linux only.
 */
export interface SafeStorageProbe {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
}

/**
 * Decides whether a secret with no plaintext fallback (the Open API Client
 * Secret) may be persisted as a safeStorage blob: encryption must be
 * available and, on Linux only, the selected backend must be a real secret
 * store (SECURE_LINUX_STORAGE_BACKENDS) — never 'basic_text' or 'unknown'.
 * Fails closed and never throws: a throwing query, or a Linux safeStorage
 * without getSelectedStorageBackend(), means "cannot persist". The backend is
 * never queried on other platforms (macOS Keychain, Windows DPAPI).
 * @param {string} platform - The OS (process.platform).
 * @param {SafeStorageProbe} storage - safeStorage (or a test fake).
 * @returns {boolean} True when the Client Secret may be written to disk.
 */
export function secureSecretStorageAvailable(platform: string, storage: SafeStorageProbe): boolean {
  try {
    if (!storage.isEncryptionAvailable()) {
      return false;
    }
    if (platform !== 'linux') {
      return true;
    }
    if (typeof storage.getSelectedStorageBackend !== 'function') {
      return false;
    }
    const backend: unknown = storage.getSelectedStorageBackend();
    return typeof backend === 'string' && SECURE_LINUX_STORAGE_BACKENDS.includes(backend);
  } catch {
    return false;
  }
} // End of function secureSecretStorageAvailable()

/**
 * Result of applyConfigSave(): the config to persist, or an error code.
 * `urlChanged` tells the caller to drop TLS state tied to the old controller.
 * `sessionClientSecret` / `sessionCloudClientSecret` are the session-only
 * Client Secret and cloud Client Secret the caller must hold in memory after
 * persisting the config (null = none): kept, replaced by a newly typed secret
 * when secure storage is unavailable, or cleared. `cloudCredentialsChanged`
 * tells the caller that the cloud credential (region, Client ID, stored or
 * session-only secret) differs after the save, so its tokens must go.
 */
export type ConfigSaveOutcome =
  | {
      ok: true;
      config: StoredConfig;
      urlChanged: boolean;
      sessionClientSecret: string | null;
      sessionCloudClientSecret: string | null;
      cloudCredentialsChanged: boolean;
    }
  | { ok: false; error: ConfigSaveError };

/**
 * The management-access part of a save (see applyManagementAccessSave()).
 */
type ManagementSaveOutcome =
  | { ok: true; clientId?: string; encryptedClientSecret?: string; sessionClientSecret: string | null }
  | { ok: false; error: ConfigSaveError };

/**
 * The cloud-access part of a save (see applyCloudAccessSave()). `removed`:
 * Remove cloud access was applied (the site choices and the active cloud
 * controller go too).
 */
type CloudSaveOutcome =
  | {
      ok: true;
      cloudRegion?: CloudRegion;
      cloudClientId?: string;
      encryptedCloudClientSecret?: string;
      sessionCloudClientSecret: string | null;
      removed: boolean;
    }
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
 * Trims and validates an Open API Client ID (CLIENT_ID_REGEX).
 * @param {unknown} value - The raw Client ID.
 * @returns {string | null} The trimmed Client ID, or null when invalid.
 */
export function normalizeClientId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return CLIENT_ID_REGEX.test(trimmed) ? trimmed : null;
}

/**
 * Returns a fresh default (empty) configuration.
 * @returns {StoredConfig} An empty config with the default language.
 */
export function defaultConfig(): StoredConfig {
  return { url: '', username: '', language: DEFAULT_LANGUAGE };
}

/**
 * Parses the text of the config file. Unparseable JSON is treated as "no
 * config" (null) and logged by its error NAME only: V8's JSON.parse messages
 * quote a slice of the input (e.g. `Unexpected token 'h', "{"password":
 * hunter2"... is not valid JSON`), and the file holds the password (plaintext
 * on a legacy or insecure-storage install) and the encrypted secrets.
 * @param {string} text - The file content.
 * @returns {unknown | null} The parsed value (validateStoredConfig() checks
 *   it), or null when the text is not JSON.
 */
export function parseStoredConfigText(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    console.warn('Config file contains invalid JSON; treating it as no config:', error instanceof Error ? error.name : 'unknown error');
    return null;
  }
} // End of function parseStoredConfigText()

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
  const clientId = normalizeClientId(raw.clientId);
  if (clientId) {
    config.clientId = clientId;
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
  if (isOmadacId(raw.localOmadacId)) {
    config.localOmadacId = raw.localOmadacId;
  }
  // TP-Link cloud access: a non-string blob, an unusable active controller or
  // a malformed site entry is dropped (never cast). The region, the cloud
  // Client ID and the blob are one credential: an absent region means the
  // default (EUW), but a region or Client ID that is present and invalid
  // drops all three, so a secret created for another region is never sent
  // to the default region's endpoint
  const cloudClientId = normalizeClientId(raw.cloudClientId);
  const cloudCredentialIntact =
    (raw.cloudRegion === undefined || isCloudRegion(raw.cloudRegion)) &&
    (raw.cloudClientId === undefined || cloudClientId !== null);
  if (!cloudCredentialIntact) {
    console.warn('Config file holds a malformed TP-Link cloud region or Client ID; the cloud credential is dropped');
  } else {
    if (isCloudRegion(raw.cloudRegion)) {
      config.cloudRegion = raw.cloudRegion;
    }
    if (cloudClientId) {
      config.cloudClientId = cloudClientId;
    }
    if (typeof raw.encryptedCloudClientSecret === 'string' && raw.encryptedCloudClientSecret) {
      config.encryptedCloudClientSecret = raw.encryptedCloudClientSecret;
    }
  }
  if (raw.activeController === LOCAL_CONTROLLER || isOmadacId(raw.activeController)) {
    config.activeController = raw.activeController;
  }
  const cloudSites = normalizeCloudSites(raw.cloudSites);
  if (cloudSites) {
    config.cloudSites = cloudSites;
  }
  return config;
} // End of function validateStoredConfig()

/**
 * Validates the per-cloud-controller site choices read from the config file:
 * a plain object whose keys are omadacIds (isOmadacId()) and whose values are
 * site ids (CLOUD_SITE_ID_REGEX); malformed entries are dropped one by one,
 * at most MAX_CLOUD_SITES are kept (in file order).
 * @param {unknown} raw - The parsed `cloudSites` value.
 * @returns {Record<string, string> | null} The valid entries, or null when none.
 */
export function normalizeCloudSites(raw: unknown): Record<string, string> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) {
    return null;
  }
  const sites: Record<string, string> = {};
  let kept = 0;
  for (const [omadacId, siteId] of Object.entries(raw as Record<string, unknown>)) {
    if (kept >= MAX_CLOUD_SITES) {
      break;
    }
    if (isOmadacId(omadacId) && typeof siteId === 'string' && CLOUD_SITE_ID_REGEX.test(siteId)) {
      sites[omadacId] = siteId;
      kept++;
    }
  } // End of the loop over the stored site choices
  return kept > 0 ? sites : null;
} // End of function normalizeCloudSites()

/**
 * The active controller of a config: 'local' unless a cloud controller's
 * omadacId is stored.
 * @param {StoredConfig} config - The stored config.
 * @returns {string} 'local' or an omadacId.
 */
export function activeControllerOf(config: StoredConfig): string {
  return isOmadacId(config.activeController) ? config.activeController : LOCAL_CONTROLLER;
}

/**
 * The config to write once a local connect learned the controller's omadacId
 * (inbox I-1b2b1): `localOmadacId` set, everything else kept. Nothing is to
 * be written (null) when the id is unusable (isOmadacId()), when the same id
 * is stored already, or when the config's controller URL is no longer the
 * one the connect used — the field belongs to that URL, and a URL change
 * drops it (applyConfigSave()).
 * @param {StoredConfig} config - The stored config.
 * @param {string} url - The configured URL the connect used.
 * @param {string} omadacId - The omadacId /api/info reported.
 * @returns {StoredConfig | null} The config to persist, or null when nothing changes.
 */
export function withLocalOmadacId(config: StoredConfig, url: string, omadacId: string): StoredConfig | null {
  if (!isOmadacId(omadacId) || config.url === '' || config.url !== url || config.localOmadacId === omadacId) {
    return null;
  }
  return { ...config, localOmadacId: omadacId };
}

/**
 * The config to write for a new active controller (ConnectionManager
 * .switchTarget()): 'local' or a cloud controller's omadacId. Nothing is to
 * be written (null) for any other value or when it is the active one already
 * (an absent field counts as 'local').
 * @param {StoredConfig} config - The stored config.
 * @param {string} activeController - 'local' or an omadacId.
 * @returns {StoredConfig | null} The config to persist, or null when nothing changes.
 */
export function withActiveController(config: StoredConfig, activeController: string): StoredConfig | null {
  if (activeController !== LOCAL_CONTROLLER && !isOmadacId(activeController)) {
    return null;
  }
  if (activeControllerOf(config) === activeController) {
    return null;
  }
  return { ...config, activeController };
}

/**
 * The site remembered for a cloud controller.
 * @param {StoredConfig} config - The stored config.
 * @param {string} omadacId - The cloud controller's omadacId.
 * @returns {string} Its site id, or '' when none is stored.
 */
export function cloudSiteOf(config: StoredConfig, omadacId: string): string {
  if (!isOmadacId(omadacId) || !config.cloudSites || !Object.prototype.hasOwnProperty.call(config.cloudSites, omadacId)) {
    return '';
  }
  return config.cloudSites[omadacId];
}

/**
 * The config to write once the user picked a site on a cloud controller:
 * `cloudSites[omadacId]` set (never the local `siteId`). The entry moves to
 * the end, and the oldest entries go when more than MAX_CLOUD_SITES would be
 * kept. Nothing is to be written (null) for an unusable omadacId or site id,
 * or when that site is stored already.
 * @param {StoredConfig} config - The stored config.
 * @param {string} omadacId - The cloud controller's omadacId.
 * @param {string} siteId - The chosen site id.
 * @returns {StoredConfig | null} The config to persist, or null when nothing changes.
 */
export function withCloudSite(config: StoredConfig, omadacId: string, siteId: string): StoredConfig | null {
  if (!isOmadacId(omadacId) || typeof siteId !== 'string' || !CLOUD_SITE_ID_REGEX.test(siteId)) {
    return null;
  }
  if (cloudSiteOf(config, omadacId) === siteId) {
    return null;
  }
  const kept = Object.entries(config.cloudSites ?? {}).filter(([id]) => id !== omadacId);
  const entries = [...kept.slice(Math.max(0, kept.length - (MAX_CLOUD_SITES - 1))), [omadacId, siteId]];
  return { ...config, cloudSites: Object.fromEntries(entries) };
} // End of function withCloudSite()

/**
 * The effective cloud region of a config (DEFAULT_CLOUD_REGION when none or
 * an unknown one is stored).
 * @param {StoredConfig} config - The stored config.
 * @returns {CloudRegion} The region.
 */
export function cloudRegionOf(config: StoredConfig): CloudRegion {
  return isCloudRegion(config.cloudRegion) ? config.cloudRegion : DEFAULT_CLOUD_REGION;
}

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
      console.error('Error decrypting the stored password:', redactErrorMessage(error));
      return '';
    }
  }
  // Plaintext fallback (safeStorage unavailable, or not-yet-migrated legacy)
  return config.password || '';
} // End of function decryptStoredPassword()

/**
 * Decrypts the stored Open API Client Secret blob. Main process only — this
 * value must never be sent over IPC to the renderer.
 *
 * While secure storage is unavailable (box.isSecureStorageAvailable() false,
 * e.g. Linux's basic_text backend) a stored blob is NOT trusted: it is not
 * decrypted, so it is neither used nor reported (`hasClientSecret` false; the
 * user types the secret again, which is then session-only and drops the blob).
 * It is otherwise left on disk untouched, so a blob written under a real
 * keyring survives a session in which that keyring was missing. A blob that
 * an earlier build wrote under basic_text cannot be told apart from it
 * without relying on Chromium's internal blob prefixes, which this app
 * deliberately does not do; no released build ever persisted the Client
 * Secret under basic_text (persistence of it is new and fails closed here).
 * @param {StoredConfig} config - The config holding the blob.
 * @param {SecretBox} box - Decryption primitives.
 * @returns {string} The plaintext secret, or '' when none/undecryptable/untrusted.
 */
export function decryptStoredClientSecret(config: StoredConfig, box: SecretBox): string {
  if (!config.encryptedClientSecret || !box.isSecureStorageAvailable()) {
    return '';
  }
  try {
    return box.decryptString(config.encryptedClientSecret);
  } catch (error) {
    // Never log the blob or the error's details beyond the message class
    console.error('Error decrypting the stored Client Secret:', error instanceof Error ? error.name : 'unknown error');
    return '';
  }
} // End of function decryptStoredClientSecret()

/**
 * Returns the Open API credentials of a config (main process only, never
 * over IPC): the stored Client ID with the session-only secret when there is
 * one, else the decrypted stored secret.
 * @param {StoredConfig} config - The stored config.
 * @param {SecretBox} box - Decryption primitives.
 * @param {string | null} sessionClientSecret - The session-only secret, if any.
 * @returns {{ clientId: string; clientSecret: string } | null} The
 *   credentials, or null when the Client ID or a usable secret is missing.
 */
export function managementCredentialsOf(
  config: StoredConfig,
  box: SecretBox,
  sessionClientSecret: string | null
): { clientId: string; clientSecret: string } | null {
  if (!config.clientId) {
    return null;
  }
  const clientSecret = sessionClientSecret || decryptStoredClientSecret(config, box);
  return clientSecret ? { clientId: config.clientId, clientSecret } : null;
} // End of function managementCredentialsOf()

/**
 * Builds the renderer-safe management-access status (flags only).
 * `hasClientSecret` is true only for a trusted blob that decrypts (see
 * decryptStoredClientSecret()) or a session-only secret, so a corrupt or
 * untrusted blob makes the UI ask for the secret again.
 * `canPersistClientSecret` is box.isSecureStorageAvailable().
 * @param {StoredConfig} config - The stored config.
 * @param {SecretBox} box - Decryption primitives.
 * @param {string | null} sessionClientSecret - The session-only secret, if any.
 * @returns {ManagementAccessStatus} The status.
 */
export function managementAccessStatus(config: StoredConfig, box: SecretBox, sessionClientSecret: string | null): ManagementAccessStatus {
  const sessionOnly = typeof sessionClientSecret === 'string' && sessionClientSecret.length > 0;
  return {
    clientId: config.clientId ?? '',
    hasClientSecret: sessionOnly || decryptStoredClientSecret(config, box) !== '',
    clientSecretSessionOnly: sessionOnly,
    canPersistClientSecret: box.isSecureStorageAvailable()
  };
} // End of function managementAccessStatus()

/**
 * Decrypts the stored cloud Client Secret blob (main process only), with the
 * same trust rule as decryptStoredClientSecret(): while secure storage is
 * unavailable a stored blob is neither decrypted nor reported (it stays on
 * disk untouched).
 * @param {StoredConfig} config - The config holding the blob.
 * @param {SecretBox} box - Decryption primitives.
 * @returns {string} The plaintext secret, or '' when none/undecryptable/untrusted.
 */
export function decryptStoredCloudSecret(config: StoredConfig, box: SecretBox): string {
  if (!config.encryptedCloudClientSecret || !box.isSecureStorageAvailable()) {
    return '';
  }
  try {
    return box.decryptString(config.encryptedCloudClientSecret);
  } catch (error) {
    // Never log the blob or the error's details beyond the message class
    console.error('Error decrypting the stored cloud Client Secret:', error instanceof Error ? error.name : 'unknown error');
    return '';
  }
} // End of function decryptStoredCloudSecret()

/**
 * Returns the saved cloud credential of a config (main process only, never
 * over IPC): the effective region, the stored cloud Client ID and the
 * session-only secret when there is one, else the decrypted stored secret.
 * @param {StoredConfig} config - The stored config.
 * @param {SecretBox} box - Decryption primitives.
 * @param {string | null} sessionCloudClientSecret - The session-only cloud secret, if any.
 * @returns {CloudCredentials | null} The credential, or null when the cloud
 *   Client ID or a usable secret is missing.
 */
export function cloudCredentialsOf(config: StoredConfig, box: SecretBox, sessionCloudClientSecret: string | null): CloudCredentials | null {
  if (!config.cloudClientId) {
    return null;
  }
  const clientSecret = sessionCloudClientSecret || decryptStoredCloudSecret(config, box);
  return clientSecret ? { region: cloudRegionOf(config), clientId: config.cloudClientId, clientSecret } : null;
} // End of function cloudCredentialsOf()

/**
 * Builds the renderer-safe cloud-access status (flags only, never the secret).
 * `hasCloudSecret` is true only for a trusted blob that decrypts or a
 * session-only secret; `canPersistCloudSecret` is box.isSecureStorageAvailable().
 * @param {StoredConfig} config - The stored config.
 * @param {SecretBox} box - Decryption primitives.
 * @param {string | null} sessionCloudClientSecret - The session-only cloud secret, if any.
 * @returns {CloudAccessStatus} The status.
 */
export function cloudAccessStatus(config: StoredConfig, box: SecretBox, sessionCloudClientSecret: string | null): CloudAccessStatus {
  const sessionOnly = typeof sessionCloudClientSecret === 'string' && sessionCloudClientSecret.length > 0;
  return {
    region: cloudRegionOf(config),
    clientId: config.cloudClientId ?? '',
    hasCloudSecret: sessionOnly || decryptStoredCloudSecret(config, box) !== '',
    cloudSecretSessionOnly: sessionOnly,
    canPersistCloudSecret: box.isSecureStorageAvailable(),
    activeController: activeControllerOf(config)
  };
} // End of function cloudAccessStatus()

/**
 * Builds the renderer-safe view of a config: no secret material, only flags,
 * plus the pinned certificate fingerprint (public data) when the pin belongs
 * to the configured origin, the management-access status and the
 * cloud-access status.
 * @param {StoredConfig} config - The stored config.
 * @param {SecretBox} box - Decryption primitives (to test the password and the secrets).
 * @param {string | null} [sessionClientSecret] - The session-only Client Secret, if any.
 * @param {string | null} [sessionCloudClientSecret] - The session-only cloud secret, if any.
 * @returns {RendererConfig} The renderer-safe view.
 */
export function toRendererConfig(
  config: StoredConfig,
  box: SecretBox,
  sessionClientSecret: string | null = null,
  sessionCloudClientSecret: string | null = null
): RendererConfig {
  return {
    url: config.url,
    username: config.username,
    language: config.language,
    // Report a stored password only when it can actually be produced — a
    // corrupt/undecryptable blob must make the UI ask for the password again
    hasPassword: decryptStoredPassword(config, box) !== '',
    pinnedFingerprint: pinnedFingerprintFor(config.url, config.certificatePin ?? null),
    ...managementAccessStatus(config, box, sessionClientSecret),
    cloudAccess: cloudAccessStatus(config, box, sessionCloudClientSecret)
  };
} // End of function toRendererConfig()

/**
 * Applies the management-access part of a settings save (rules in
 * applyConfigSave()'s documentation).
 * @param {StoredConfig} current - The config currently stored.
 * @param {ConfigSavePayload} payload - The settings sent by the renderer.
 * @param {SecretBox} box - Encryption primitives.
 * @param {string | null} sessionClientSecret - The current session-only secret.
 * @param {boolean} urlChanged - Whether the save changes the controller URL.
 * @returns {ManagementSaveOutcome} The Client ID, blob and session secret to
 *   keep, or an error code.
 */
function applyManagementAccessSave(
  current: StoredConfig,
  payload: ConfigSavePayload,
  box: SecretBox,
  sessionClientSecret: string | null,
  urlChanged: boolean
): ManagementSaveOutcome {
  const hasClientId = payload.clientId !== undefined;
  const hasClientSecretField = payload.clientSecret !== undefined;
  if (hasClientSecretField && typeof payload.clientSecret !== 'string') {
    return { ok: false, error: 'saveFailed' };
  }
  const typedSecret = typeof payload.clientSecret === 'string' && payload.clientSecret.length > 0 ? payload.clientSecret : null;

  if (payload.removeManagementAccess !== undefined) {
    // Explicit removal: only the literal true, and never mixed with new values
    if (payload.removeManagementAccess !== true || hasClientId || hasClientSecretField) {
      return { ok: false, error: 'saveFailed' };
    }
    return { ok: true, sessionClientSecret: null };
  }

  if (!hasClientId) {
    if (typedSecret !== null) {
      return { ok: false, error: 'clientIdRequired' };
    }
    if (urlChanged) {
      // A different controller has its own Open API application
      return { ok: true, sessionClientSecret: null };
    }
    return {
      ok: true,
      clientId: current.clientId,
      encryptedClientSecret: current.encryptedClientSecret,
      sessionClientSecret
    };
  } // End of the branch without a Client ID in the payload

  const clientId = normalizeClientId(payload.clientId);
  if (clientId === null) {
    return { ok: false, error: 'invalidClientId' };
  }

  if (typedSecret !== null) {
    // A new secret replaces the stored blob and any session-only secret
    if (box.isSecureStorageAvailable()) {
      try {
        return { ok: true, clientId, encryptedClientSecret: box.encryptString(typedSecret), sessionClientSecret: null };
      } catch (error) {
        console.error('Error encrypting the Client Secret:', error instanceof Error ? error.name : 'unknown error');
        return { ok: false, error: 'saveFailed' };
      }
    }
    // No plaintext (nor obfuscated basic_text) fallback for the Client
    // Secret: session-only
    console.warn('Secure secret storage is unavailable; the Client Secret is kept in memory for this session only');
    return { ok: true, clientId, sessionClientSecret: typedSecret };
  } // End of the typed-secret branch

  // No typed secret: the stored one (blob or session-only) is kept only for
  // the same controller AND the same Open API application; a new Client ID
  // or URL never inherits it
  if (!urlChanged && clientId === current.clientId) {
    return { ok: true, clientId, encryptedClientSecret: current.encryptedClientSecret, sessionClientSecret };
  }
  return { ok: false, error: 'clientSecretRequired' };
} // End of function applyManagementAccessSave()

/**
 * Applies the cloud-access part of a settings save (rules in
 * applyConfigSave()'s documentation). The controller URL plays no part: the
 * cloud account is not tied to it.
 * @param {StoredConfig} current - The config currently stored.
 * @param {ConfigSavePayload} payload - The settings sent by the renderer.
 * @param {SecretBox} box - Encryption primitives.
 * @param {string | null} sessionCloudClientSecret - The current session-only cloud secret.
 * @returns {CloudSaveOutcome} The region, Client ID, blob and session secret
 *   to keep, or an error code.
 */
function applyCloudAccessSave(
  current: StoredConfig,
  payload: ConfigSavePayload,
  box: SecretBox,
  sessionCloudClientSecret: string | null
): CloudSaveOutcome {
  const hasRegion = payload.cloudRegion !== undefined;
  const hasClientId = payload.cloudClientId !== undefined;
  const hasSecretField = payload.cloudClientSecret !== undefined;
  if ((hasSecretField && typeof payload.cloudClientSecret !== 'string') || (hasRegion && !isCloudRegion(payload.cloudRegion))) {
    return { ok: false, error: 'saveFailed' };
  }
  const typedSecret = typeof payload.cloudClientSecret === 'string' && payload.cloudClientSecret.length > 0 ? payload.cloudClientSecret : null;

  if (payload.removeCloudAccess !== undefined) {
    // Explicit removal: only the literal true, and never mixed with new values
    if (payload.removeCloudAccess !== true || hasRegion || hasClientId || hasSecretField) {
      return { ok: false, error: 'saveFailed' };
    }
    return { ok: true, sessionCloudClientSecret: null, removed: true };
  }

  const storedRegion = isCloudRegion(current.cloudRegion) ? current.cloudRegion : undefined;
  const currentRegion = storedRegion ?? DEFAULT_CLOUD_REGION;
  const region = hasRegion ? (payload.cloudRegion as CloudRegion) : currentRegion;
  const regionChanged = region !== currentRegion;

  if (!hasClientId) {
    if (typedSecret !== null) {
      return { ok: false, error: 'cloudClientIdRequired' };
    }
    if (!regionChanged) {
      return {
        ok: true,
        cloudRegion: hasRegion ? region : storedRegion,
        cloudClientId: current.cloudClientId,
        encryptedCloudClientSecret: current.encryptedCloudClientSecret,
        sessionCloudClientSecret,
        removed: false
      };
    }
    // Another region is another credential: the stored secret never follows
    // it, so a stored Client ID now needs a typed secret
    if (current.cloudClientId) {
      return { ok: false, error: 'cloudClientSecretRequired' };
    }
    return { ok: true, cloudRegion: region, sessionCloudClientSecret: null, removed: false };
  } // End of the branch without a cloud Client ID in the payload

  const clientId = normalizeClientId(payload.cloudClientId);
  if (clientId === null) {
    return { ok: false, error: 'invalidCloudClientId' };
  }

  if (typedSecret !== null) {
    // A new secret replaces the stored blob and any session-only secret
    if (box.isSecureStorageAvailable()) {
      try {
        return { ok: true, cloudRegion: region, cloudClientId: clientId, encryptedCloudClientSecret: box.encryptString(typedSecret), sessionCloudClientSecret: null, removed: false };
      } catch (error) {
        console.error('Error encrypting the cloud Client Secret:', error instanceof Error ? error.name : 'unknown error');
        return { ok: false, error: 'saveFailed' };
      }
    }
    // No plaintext (nor obfuscated basic_text) fallback: session-only
    console.warn('Secure secret storage is unavailable; the cloud Client Secret is kept in memory for this session only');
    return { ok: true, cloudRegion: region, cloudClientId: clientId, sessionCloudClientSecret: typedSecret, removed: false };
  } // End of the typed-secret branch

  // No typed secret: the stored one (blob or session-only) is kept only for
  // the same region AND the same cloud Client ID
  if (!regionChanged && clientId === current.cloudClientId) {
    return {
      ok: true,
      cloudRegion: region,
      cloudClientId: clientId,
      encryptedCloudClientSecret: current.encryptedCloudClientSecret,
      sessionCloudClientSecret,
      removed: false
    };
  }
  return { ok: false, error: 'cloudClientSecretRequired' };
} // End of function applyCloudAccessSave()

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
 * Management access (Open API Client ID + Client Secret, optional):
 * - `removeManagementAccess: true` drops the Client ID, the stored blob and
 *   the session-only secret (any other management field with it: 'saveFailed');
 * - no `clientId` in the payload: everything is kept for the same URL and
 *   dropped on a URL change (an Open API application belongs to one
 *   controller); a typed secret without a Client ID is 'clientIdRequired';
 * - a `clientId` is trimmed and validated (CLIENT_ID_REGEX) — else
 *   'invalidClientId';
 * - a typed secret is encrypted into `encryptedClientSecret` when secure
 *   storage is available (box.isSecureStorageAvailable(): encryption backed by
 *   an OS secret store — not Linux basic_text/unknown; an encryption failure
 *   is 'saveFailed'); otherwise it is NEVER persisted: it becomes the
 *   session-only secret and the stored blob is dropped (the password keeps
 *   its own isEncryptionAvailable() rule above);
 * - a blank secret keeps the stored one (blob or session-only, possibly none)
 *   only when the URL and the Client ID are both unchanged; otherwise it is
 *   'clientSecretRequired'.
 * TP-Link cloud access (optional; NOT tied to the URL — a URL change keeps
 * every cloud field):
 * - `removeCloudAccess: true` deletes the region, the cloud Client ID, the
 *   stored blob, the session-only secret, the per-controller site choices
 *   (`cloudSites`) and the active cloud controller (the local one is active
 *   again: `activeController` absent); any other cloud field with it:
 *   'saveFailed';
 * - an unknown `cloudRegion` is 'saveFailed' (a select's enum, like the
 *   language);
 * - no `cloudClientId`: a typed cloud secret is 'cloudClientIdRequired'; the
 *   same region keeps everything; a different region drops the stored
 *   secret, so a stored cloud Client ID then needs a typed secret
 *   ('cloudClientSecretRequired'), and with none only the region is stored;
 * - a `cloudClientId` is trimmed and validated like the management Client ID
 *   (CLIENT_ID_REGEX) — else 'invalidCloudClientId';
 * - a typed cloud secret is encrypted into `encryptedCloudClientSecret` when
 *   secure storage is available (an encryption failure is 'saveFailed'),
 *   otherwise it becomes the session-only cloud secret and is never persisted;
 * - a blank cloud secret keeps the stored one only when the region and the
 *   cloud Client ID are both unchanged; otherwise 'cloudClientSecretRequired';
 * - `activeController` and `cloudSites` survive every save but a removal
 *   (they are keyed by the controllers' omadacIds, not by a credential);
 *   `localOmadacId` belongs to the configured controller and is dropped with
 *   a URL change.
 * @param {StoredConfig} current - The config currently stored.
 * @param {ConfigSavePayload} payload - The settings sent by the renderer.
 * @param {SecretBox} box - Encryption primitives.
 * @param {string | null} [sessionClientSecret] - The session-only Client
 *   Secret currently held in memory (config.ts), if any.
 * @param {string | null} [sessionCloudClientSecret] - The session-only cloud
 *   Client Secret currently held in memory (config.ts), if any.
 * @returns {ConfigSaveOutcome} The config to persist and the session-only
 *   secrets to hold, or an error code.
 */
export function applyConfigSave(
  current: StoredConfig,
  payload: ConfigSavePayload,
  box: SecretBox,
  sessionClientSecret: string | null = null,
  sessionCloudClientSecret: string | null = null
): ConfigSaveOutcome {
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
        console.error('Error encrypting the password:', redactErrorMessage(error, [payload.password]));
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

  const management = applyManagementAccessSave(current, payload, box, sessionClientSecret, urlChanged);
  if (!management.ok) {
    return { ok: false, error: management.error };
  }
  const cloud = applyCloudAccessSave(current, payload, box, sessionCloudClientSecret);
  if (!cloud.ok) {
    return { ok: false, error: cloud.error };
  }

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
  // Management access, as decided above (dropped on a URL change unless the
  // payload brought new credentials for the new controller)
  if (management.clientId) {
    config.clientId = management.clientId;
  }
  if (management.encryptedClientSecret) {
    config.encryptedClientSecret = management.encryptedClientSecret;
  }
  // Everything else tied to the controller survives only while the URL is
  // unchanged: a different controller has its own sites and certificate
  if (!urlChanged) {
    if (current.siteId) {
      config.siteId = current.siteId;
    }
    if (current.certificatePin) {
      config.certificatePin = { ...current.certificatePin };
    }
    if (current.localOmadacId) {
      config.localOmadacId = current.localOmadacId;
    }
  }
  // Cloud access, as decided above (independent of the URL)
  if (cloud.cloudRegion) {
    config.cloudRegion = cloud.cloudRegion;
  }
  if (cloud.cloudClientId) {
    config.cloudClientId = cloud.cloudClientId;
  }
  if (cloud.encryptedCloudClientSecret) {
    config.encryptedCloudClientSecret = cloud.encryptedCloudClientSecret;
  }
  if (!cloud.removed) {
    if (current.activeController) {
      config.activeController = current.activeController;
    }
    if (current.cloudSites) {
      config.cloudSites = { ...current.cloudSites };
    }
  }
  const cloudCredentialsChanged =
    cloudRegionOf(current) !== cloudRegionOf(config) ||
    current.cloudClientId !== config.cloudClientId ||
    current.encryptedCloudClientSecret !== config.encryptedCloudClientSecret ||
    (sessionCloudClientSecret ?? null) !== cloud.sessionCloudClientSecret;
  return {
    ok: true,
    config,
    urlChanged,
    sessionClientSecret: management.sessionClientSecret,
    sessionCloudClientSecret: cloud.sessionCloudClientSecret,
    cloudCredentialsChanged
  };
} // End of function applyConfigSave()
