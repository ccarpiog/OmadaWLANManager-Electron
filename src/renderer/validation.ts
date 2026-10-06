// ============================================================================
// Boundary Validation
// ============================================================================
//
// Pure (no DOM): besides the renderer, the unit tests import this module to
// check the controller-URL mirror against the main-process rules
// (tests/unit/renderer-validation.test.ts).

import type { CertificateDetails } from '../shared/types';

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
