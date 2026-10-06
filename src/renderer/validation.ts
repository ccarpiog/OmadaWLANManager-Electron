// ============================================================================
// Boundary Validation
// ============================================================================

// Format guards for identifiers crossing the IPC boundary (from the
// controller via the main process, and back when applying a change). The main
// process enforces the same patterns (src/main/index.ts — keep both in sync).
const MAC_REGEX = /^[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}$/;
const WLAN_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const SITE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

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
