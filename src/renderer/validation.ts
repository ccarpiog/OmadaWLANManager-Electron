// ============================================================================
// Boundary Validation
// ============================================================================
//
// Pure (no DOM): besides the renderer, the unit tests import this module to
// check the controller-URL mirror against the main-process rules
// (tests/unit/renderer-validation.test.ts).

import type { CertificateDetails, GroupListing, ManagementCapabilities, ManagementCheckError, ManagementReason } from '../shared/types';

// Format guards for identifiers crossing the IPC boundary (from the
// controller via the main process, and back when applying a change). The main
// process enforces the same patterns (src/main/index.ts — keep both in sync).
const MAC_REGEX = /^[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}$/;
const WLAN_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const SITE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
// A SHA-256 certificate fingerprint: 32 bytes as colon-separated uppercase hex
// (same pattern as FINGERPRINT_REGEX in src/main/cert-pinning.ts — keep in sync)
const FINGERPRINT_REGEX = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;
// Length cap for the controller host shown in the certificate dialogs
const MAX_CERTIFICATE_HOST_LENGTH = 300;
// Length cap for the controller version of a group listing (same value as
// MAX_CONTROLLER_VERSION_LENGTH in src/main/controller-version.ts)
const MAX_CONTROLLER_VERSION_LENGTH = 64;
// Length cap for the site name of a connect result (display only)
const MAX_SITE_NAME_LENGTH = 256;
// Length cap for the opaque session nonce of a connect result (main sends 32
// hex characters; the renderer only checks presence, type and size)
const MAX_SESSION_NONCE_LENGTH = 64;
// A management diagnostic as main builds it (error codes, HTTP status,
// errorCode, counts): anything else is dropped before it reaches the DOM
const DIAGNOSTIC_REGEX = /^[A-Za-z0-9 ,.:_-]{1,160}$/;
// Every ManagementReason (src/shared/types.ts); the Record type makes the
// compiler require each one, so a new reason cannot be forgotten here
const MANAGEMENT_REASONS: Record<ManagementReason, true> = {
  legacyController: true,
  managementNotConfigured: true,
  invalidCredentials: true,
  tokenFailed: true,
  siteNotFound: true,
  apGroupsMismatch: true,
  probeFailed: true,
};

/**
 * Validates a MAC address format (six hex pairs separated by ':' or '-').
 * @param {unknown} mac - Candidate MAC address.
 * @returns {mac is string} True when the value is a well-formed MAC string.
 */
export function isValidMac(mac: unknown): mac is string {
  return typeof mac === 'string' && MAC_REGEX.test(mac);
}

/**
 * Validates a WLAN group id format (alphanumeric Omada object id, plus '_'/'-').
 * @param {unknown} id - Candidate WLAN group id.
 * @returns {id is string} True when the value is a well-formed WLAN id string.
 */
export function isValidWlanId(id: unknown): id is string {
  return typeof id === 'string' && WLAN_ID_REGEX.test(id);
}

/**
 * Validates a site id format (alphanumeric Omada object id, plus '_'/'-').
 * @param {unknown} id - Candidate site id.
 * @returns {id is string} True when the value is a well-formed site id string.
 */
export function isValidSiteId(id: unknown): id is string {
  return typeof id === 'string' && SITE_ID_REGEX.test(id);
}

/**
 * Validates a SHA-256 certificate fingerprint (colon-separated uppercase hex).
 * @param {unknown} value - Candidate fingerprint.
 * @returns {value is string} True when the value is a well-formed fingerprint.
 */
export function isValidFingerprint(value: unknown): value is string {
  return typeof value === 'string' && FINGERPRINT_REGEX.test(value);
}

/**
 * Validates the `certificate` field of a certificateUntrusted /
 * certificateChanged connect result before anything of it reaches the DOM:
 * a non-empty host within the length cap and well-formed fingerprint(s).
 * @param {unknown} raw - The `certificate` field received over IPC.
 * @param {boolean} withPinned - True when a pinned fingerprint is required
 *   (certificateChanged).
 * @returns {CertificateDetails | null} The validated details, or null.
 */
export function parseCertificateDetails(raw: unknown, withPinned: boolean): CertificateDetails | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.host !== 'string' || candidate.host.length === 0 || candidate.host.length > MAX_CERTIFICATE_HOST_LENGTH) {
    return null;
  }
  if (!isValidFingerprint(candidate.fingerprint)) {
    return null;
  }
  if (!withPinned) {
    return { host: candidate.host, fingerprint: candidate.fingerprint };
  }
  if (!isValidFingerprint(candidate.pinnedFingerprint)) {
    return null;
  }
  return { host: candidate.host, fingerprint: candidate.fingerprint, pinnedFingerprint: candidate.pinnedFingerprint };
} // End of function parseCertificateDetails()

/**
 * Validates the group listing received over IPC (getWlanGroups()) before it
 * reaches the renderer state. It must be an object with a `groups` array,
 * otherwise this throws: a broken listing surfaces as a load error, never as
 * an empty list. The group model is 'apGroup' only when exactly that value
 * arrives; anything else becomes the legacy 'wlanGroup' (the defensive
 * default of docs/management-design.md §2.2). The version is kept only as a
 * non-empty string within the length cap. The group entries are returned as
 * received: loadData() drops the ones with a malformed id itself.
 * @param {unknown} raw - The listing received over IPC.
 * @returns {GroupListing} The validated listing.
 * @throws {Error} When the listing has no group array.
 */
export function parseGroupListing(raw: unknown): GroupListing {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as Record<string, unknown>).groups)) {
    throw new Error('Unsupported group listing');
  }
  const candidate = raw as Record<string, unknown>;
  const version = candidate.controllerVersion;
  return {
    controllerVersion: typeof version === 'string' && version.length > 0 && version.length <= MAX_CONTROLLER_VERSION_LENGTH ? version : null,
    groupModel: candidate.groupModel === 'apGroup' ? 'apGroup' : 'wlanGroup',
    groups: candidate.groups as GroupListing['groups'],
  };
} // End of function parseGroupListing()

/**
 * Validates the site name of a connect / site-selection result (display
 * only): a non-empty string within the length cap, else null.
 * @param {unknown} raw - The `siteName` field received over IPC.
 * @returns {string | null} The site name, or null.
 */
export function parseSiteName(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_SITE_NAME_LENGTH ? raw : null;
}

/**
 * Validates the opaque session nonce of a connect / site-selection result:
 * only its presence, type and size are checked (main interprets it).
 * @param {unknown} raw - The `sessionNonce` field received over IPC.
 * @returns {string | null} The nonce, or null.
 */
export function parseSessionNonce(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_SESSION_NONCE_LENGTH ? raw : null;
}

/**
 * Tells whether a value is a known management reason code.
 * @param {unknown} value - The candidate.
 * @returns {value is ManagementReason} True for a ManagementReason.
 */
export function isManagementReason(value: unknown): value is ManagementReason {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MANAGEMENT_REASONS, value);
}

/**
 * Validates management capabilities received over IPC, failing closed: both
 * flags must be booleans and the reason null or a known code; management is
 * on only with both flags true and no reason (a reason forces both flags
 * off; no reason with a flag off is inconsistent and rejected). The
 * diagnostic is kept only in main's codes-and-counts form.
 * @param {unknown} raw - The `capabilities` field received over IPC.
 * @returns {ManagementCapabilities | null} The capabilities, or null when malformed.
 */
export function parseManagementCapabilities(raw: unknown): ManagementCapabilities | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.manageApGroups !== 'boolean' || typeof candidate.manageWifiNetworks !== 'boolean') {
    return null;
  }
  const reason = candidate.reason;
  if (reason !== null && !isManagementReason(reason)) {
    return null;
  }
  if (reason === null && !(candidate.manageApGroups && candidate.manageWifiNetworks)) {
    return null;
  }
  const capabilities: ManagementCapabilities =
    reason === null
      ? { manageApGroups: true, manageWifiNetworks: true, reason: null }
      : { manageApGroups: false, manageWifiNetworks: false, reason };
  if (typeof candidate.diagnostic === 'string' && DIAGNOSTIC_REGEX.test(candidate.diagnostic)) {
    capabilities.diagnostic = candidate.diagnostic;
  }
  return capabilities;
} // End of function parseManagementCapabilities()

/**
 * A management-access reply after validation: the capabilities, or why there
 * are none ('invalid' for a malformed reply).
 */
export type ParsedManagementResult =
  | { ok: true; capabilities: ManagementCapabilities }
  | { ok: false; error: ManagementCheckError | 'invalid' };

/**
 * Validates a getManagementCapabilities() / testManagementAccess() reply.
 * @param {unknown} raw - The reply received over IPC.
 * @returns {ParsedManagementResult} The validated reply.
 */
export function parseManagementResult(raw: unknown): ParsedManagementResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'invalid' };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.success === true) {
    const capabilities = parseManagementCapabilities(candidate.capabilities);
    return capabilities === null ? { ok: false, error: 'invalid' } : { ok: true, capabilities };
  }
  if (candidate.success === false && (candidate.error === 'notConnected' || candidate.error === 'superseded')) {
    return { ok: false, error: candidate.error };
  }
  return { ok: false, error: 'invalid' };
} // End of function parseManagementResult()

/**
 * Validates and normalizes the controller URL. Mirrors the main-process rules
 * (normalizeControllerUrl() in src/main/url.ts — keep both in sync): it
 * must parse, use HTTPS, and carry no embedded credentials or fragment (not
 * even an empty "#"); a trailing slash is stripped.
 * @param {string} raw - The URL as typed by the user.
 * @returns {string | null} The normalized URL, or null when invalid.
 */
export function validateControllerUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  // A '#' can only survive URL parsing as the fragment delimiter, so its
  // presence in the href means a (possibly empty) fragment
  if (parsed.username || parsed.password || parsed.hash || parsed.href.includes('#')) {
    return null;
  }
  let normalized = parsed.toString();
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
} // End of function validateControllerUrl()

/**
 * Tells whether the URL in the settings form designates the same controller
 * as the stored URL (normalized comparison; an empty/invalid stored URL never
 * matches). Mirrors isSameControllerUrl() in src/main/url.ts: the stored
 * password is reused only for the same controller URL.
 * @param {string} storedUrl - The stored controller URL (from loadConfig()).
 * @param {string} candidateUrl - The URL currently in the form.
 * @returns {boolean} True when both normalize to the same URL.
 */
export function isSameControllerUrl(storedUrl: string, candidateUrl: string): boolean {
  const stored = validateControllerUrl(storedUrl);
  return stored !== null && stored === validateControllerUrl(candidateUrl);
}
