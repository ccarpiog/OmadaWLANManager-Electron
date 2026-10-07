// Pure shape guards for the session-owned IPC channels (docs/management-design.md
// §3): the management-access channels of phase 15b, the AP-group channels of
// phase 16a, the Wi-Fi network read of phase 17a (requireSessionNonce()) and
// the Wi-Fi network writes of phase 18a.
// index.ts calls them right after assertTrustedIpcSender(); the
// unit tests (tests/unit/ipc-guards.test.ts) and the smoke stub
// (tests/smoke/stub-main.cjs, which requires the compiled module) use the very
// same functions. A malformed call throws (the IPC invoke rejects, like the
// other channels' format guards); the semantic checks (name rules, policy,
// session ownership) answer with stable error codes elsewhere. A rejection's
// message is fixed text: it never quotes a value (a typed passphrase may be
// in the payload).

import { AP_GROUP_ID_REGEX } from './ap-group-policy';
import type {
  ApGroupCreateRequest,
  ApGroupDeleteRequest,
  ApGroupRenameRequest,
  NetworkBand,
  NetworkCreateRequest,
  NetworkDeleteRequest,
  NetworkEnableRequest,
  NetworkPasswordRequest,
  NetworkSecurity,
  NetworkUpdateRequest
} from '../shared/types';
import { isSsidId } from './wifi-network-model';
import { NETWORK_BANDS, NETWORK_SECURITIES } from './wifi-network-write';

// Format guard for the opaque nonces (site selection, certificate trust, the
// controller session): exactly 32 lowercase hex characters (16 random bytes —
// see createNonce() in connection-manager.ts)
export const NONCE_REGEX = /^[0-9a-f]{32}$/;

// Upper bound for a group name as it arrives (before trimming): a defense
// against absurd payloads. The name rules proper (1–128 characters after
// trimming) are applied by validateApGroupName() and answered with codes
export const MAX_RAW_AP_GROUP_NAME_LENGTH = 1024;

// Upper bounds for the Wi-Fi network write payloads as they arrive: the raw
// name (the SSID rules proper — trimmed, 1–32 bytes of UTF-8 — are applied by
// validateSsidName()), the raw passphrase (validatePassphrase(): 8–63
// printable ASCII characters) and the number of AP-group ids of a create
export const MAX_RAW_NETWORK_NAME_LENGTH = 1024;
export const MAX_RAW_PASSPHRASE_LENGTH = 256;
export const MAX_NETWORK_AP_GROUP_IDS = 256;

/**
 * Throws the rejection of a malformed IPC call.
 * @param {string} what - What was wrong.
 * @returns {never} Never returns.
 */
function reject(what: string): never {
  throw new Error(`IPC call rejected: ${what}`);
}

/**
 * Shape guard shared by the management-access channels: exactly one argument,
 * the session nonce of a connect result (32 lowercase hex characters).
 * @param {unknown} sessionNonce - The first argument.
 * @param {unknown[]} extra - Any further arguments (must be none).
 * @returns {string} The nonce.
 * @throws {Error} On extra arguments or a malformed nonce.
 */
export function requireSessionNonce(sessionNonce: unknown, extra: unknown[]): string {
  if (extra.length > 0) {
    reject('unexpected arguments');
  }
  if (typeof sessionNonce !== 'string' || !NONCE_REGEX.test(sessionNonce)) {
    reject('invalid session nonce format');
  }
  return sessionNonce;
}

/**
 * Checks that a payload is the only argument and a plain object (Object or
 * null prototype) carrying every one of `keys`, any of `optionalKeys`, and no
 * other key. An optional key that is present must not be undefined.
 * @param {unknown} payload - The first argument.
 * @param {unknown[]} extra - Any further arguments (must be none).
 * @param {readonly string[]} keys - The keys the payload must carry.
 * @param {readonly string[]} [optionalKeys] - The keys it may carry.
 * @param {string} [label] - What is asked for (in the rejection message).
 * @returns {Record<string, unknown>} The payload.
 * @throws {Error} On extra arguments, a non-object or the wrong keys.
 */
function requireExactPayload(
  payload: unknown,
  extra: unknown[],
  keys: readonly string[],
  optionalKeys: readonly string[] = [],
  label = 'AP-group'
): Record<string, unknown> {
  if (extra.length > 0) {
    reject('unexpected arguments');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    reject(`invalid ${label} request`);
  }
  const prototype = Object.getPrototypeOf(payload);
  if (prototype !== Object.prototype && prototype !== null) {
    reject(`invalid ${label} request`);
  }
  const present = Object.keys(payload);
  const record = payload as Record<string, unknown>;
  const missing = keys.some((key) => !present.includes(key));
  const unknown = present.some((key) => !keys.includes(key) && !(optionalKeys.includes(key) && record[key] !== undefined));
  if (missing || unknown) {
    reject(`invalid ${label} request keys`);
  }
  return record;
} // End of function requireExactPayload()

/**
 * Reads the session nonce of an AP-group payload.
 * @param {Record<string, unknown>} raw - The payload.
 * @returns {string} The nonce.
 * @throws {Error} When it is not a 32-hex nonce.
 */
function nonceField(raw: Record<string, unknown>): string {
  const value = raw.sessionNonce;
  if (typeof value !== 'string' || !NONCE_REGEX.test(value)) {
    reject('invalid session nonce format');
  }
  return value;
}

/**
 * Reads the AP-group id of a payload.
 * @param {Record<string, unknown>} raw - The payload.
 * @returns {string} The id.
 * @throws {Error} When it is not 24 hex digits.
 */
function apGroupIdField(raw: Record<string, unknown>): string {
  const value = raw.apGroupId;
  if (typeof value !== 'string' || !AP_GROUP_ID_REGEX.test(value)) {
    reject('invalid AP group id format');
  }
  return value;
}

/**
 * Reads the (untrimmed) group name of a payload: a string within the raw cap.
 * Blank, too long after trimming or with refused characters is not a shape
 * error: validateApGroupName() answers it with a code.
 * @param {Record<string, unknown>} raw - The payload.
 * @returns {string} The name as sent.
 * @throws {Error} When it is not a string or exceeds the raw cap.
 */
function nameField(raw: Record<string, unknown>): string {
  const value = raw.name;
  if (typeof value !== 'string' || value.length > MAX_RAW_AP_GROUP_NAME_LENGTH) {
    reject('invalid AP group name');
  }
  return value;
}

/**
 * Shape guard of MANAGEMENT_AP_GROUP_CREATE: one argument `{sessionNonce, name}`.
 * @param {unknown} payload - The first argument.
 * @param {unknown[]} extra - Any further arguments (must be none).
 * @returns {ApGroupCreateRequest} A fresh copy with exactly these keys.
 * @throws {Error} On any other shape.
 */
export function parseApGroupCreateRequest(payload: unknown, extra: unknown[]): ApGroupCreateRequest {
  const raw = requireExactPayload(payload, extra, ['sessionNonce', 'name']);
  return { sessionNonce: nonceField(raw), name: nameField(raw) };
}

/**
 * Shape guard of MANAGEMENT_AP_GROUP_RENAME: one argument `{sessionNonce, apGroupId, name}`.
 * @param {unknown} payload - The first argument.
 * @param {unknown[]} extra - Any further arguments (must be none).
 * @returns {ApGroupRenameRequest} A fresh copy with exactly these keys.
 * @throws {Error} On any other shape.
 */
export function parseApGroupRenameRequest(payload: unknown, extra: unknown[]): ApGroupRenameRequest {
  const raw = requireExactPayload(payload, extra, ['sessionNonce', 'apGroupId', 'name']);
  return { sessionNonce: nonceField(raw), apGroupId: apGroupIdField(raw), name: nameField(raw) };
}

/**
 * Shape guard of MANAGEMENT_AP_GROUP_DELETE: one argument `{sessionNonce, apGroupId}`.
 * @param {unknown} payload - The first argument.
 * @param {unknown[]} extra - Any further arguments (must be none).
 * @returns {ApGroupDeleteRequest} A fresh copy with exactly these keys.
 * @throws {Error} On any other shape.
 */
export function parseApGroupDeleteRequest(payload: unknown, extra: unknown[]): ApGroupDeleteRequest {
  const raw = requireExactPayload(payload, extra, ['sessionNonce', 'apGroupId']);
  return { sessionNonce: nonceField(raw), apGroupId: apGroupIdField(raw) };
}

/**
 * Reads the SSID id of a Wi-Fi network payload.
 * @param {Record<string, unknown>} raw - The payload.
 * @returns {string} The id.
 * @throws {Error} When it is not an SSID id (isSsidId()).
 */
function networkIdField(raw: Record<string, unknown>): string {
  const value = raw.networkId;
  if (!isSsidId(value)) {
    reject('invalid Wi-Fi network id format');
  }
  return value;
}

/**
 * Reads the (untrimmed) name of a Wi-Fi network payload: a string within the
 * raw cap (the SSID rules answer the rest with codes).
 * @param {Record<string, unknown>} raw - The payload.
 * @returns {string} The name as sent.
 * @throws {Error} When it is not a string or exceeds the raw cap.
 */
function networkNameField(raw: Record<string, unknown>): string {
  const value = raw.name;
  if (typeof value !== 'string' || value.length > MAX_RAW_NETWORK_NAME_LENGTH) {
    reject('invalid Wi-Fi network name');
  }
  return value;
}

/**
 * Reads the typed passphrase of a Wi-Fi network payload: a string within the
 * raw cap (validatePassphrase() answers the rest with codes). The rejection
 * never quotes it.
 * @param {Record<string, unknown>} raw - The payload.
 * @returns {string} The passphrase as typed.
 * @throws {Error} When it is not a string or exceeds the raw cap.
 */
function passphraseField(raw: Record<string, unknown>): string {
  const value = raw.passphrase;
  if (typeof value !== 'string' || value.length > MAX_RAW_PASSPHRASE_LENGTH) {
    reject('invalid Wi-Fi network passphrase');
  }
  return value;
}

/**
 * Reads the security mode of a Wi-Fi network payload: one of the
 * NetworkSecurity values (enum check; main refuses every mode but open and
 * WPA-Personal with 'unsupportedSecurity').
 * @param {Record<string, unknown>} raw - The payload.
 * @returns {NetworkSecurity} The mode.
 * @throws {Error} On any other value.
 */
function securityField(raw: Record<string, unknown>): NetworkSecurity {
  const value = raw.security;
  if (typeof value !== 'string' || !NETWORK_SECURITIES.includes(value as NetworkSecurity)) {
    reject('invalid Wi-Fi network security');
  }
  return value as NetworkSecurity;
}

/**
 * Reads the bands of a Wi-Fi network payload: an array of at most three
 * NetworkBand values, copied deduplicated in canonical order (an empty list
 * is answered with 'bandsRequired' by the rules).
 * @param {Record<string, unknown>} raw - The payload.
 * @returns {NetworkBand[]} The bands.
 * @throws {Error} When it is not such an array.
 */
function bandsField(raw: Record<string, unknown>): NetworkBand[] {
  const value = raw.bands;
  if (!Array.isArray(value) || value.length > NETWORK_BANDS.length || !value.every((band) => NETWORK_BANDS.includes(band as NetworkBand))) {
    reject('invalid Wi-Fi network bands');
  }
  return NETWORK_BANDS.filter((band) => (value as unknown[]).includes(band));
}

/**
 * Reads the AP-group ids of a create payload: an array of at most
 * MAX_NETWORK_AP_GROUP_IDS 24-hex ids, copied deduplicated in their order (an
 * empty list is answered with 'groupsRequired' by the rules).
 * @param {Record<string, unknown>} raw - The payload.
 * @returns {string[]} The ids.
 * @throws {Error} When it is not such an array.
 */
function apGroupIdsField(raw: Record<string, unknown>): string[] {
  const value = raw.apGroupIds;
  if (
    !Array.isArray(value) ||
    value.length > MAX_NETWORK_AP_GROUP_IDS ||
    !value.every((id) => typeof id === 'string' && AP_GROUP_ID_REGEX.test(id))
  ) {
    reject('invalid AP group id format');
  }
  return [...new Set(value as string[])];
} // End of function apGroupIdsField()

/**
 * Shape guard of MANAGEMENT_NETWORK_CREATE: one argument `{sessionNonce, name,
 * security, bands, apGroupIds}` plus `passphrase` only when typed.
 * @param {unknown} payload - The first argument.
 * @param {unknown[]} extra - Any further arguments (must be none).
 * @returns {NetworkCreateRequest} A fresh copy with exactly these keys.
 * @throws {Error} On any other shape.
 */
export function parseNetworkCreateRequest(payload: unknown, extra: unknown[]): NetworkCreateRequest {
  const raw = requireExactPayload(payload, extra, ['sessionNonce', 'name', 'security', 'bands', 'apGroupIds'], ['passphrase'], 'Wi-Fi network');
  const request: NetworkCreateRequest = {
    sessionNonce: nonceField(raw),
    name: networkNameField(raw),
    security: securityField(raw),
    bands: bandsField(raw),
    apGroupIds: apGroupIdsField(raw)
  };
  if (raw.passphrase !== undefined) {
    request.passphrase = passphraseField(raw);
  }
  return request;
} // End of function parseNetworkCreateRequest()

/**
 * Shape guard of MANAGEMENT_NETWORK_UPDATE: one argument `{sessionNonce,
 * networkId}` plus any of the edited fields `name`, `security`, `bands`,
 * `passphrase` (only the edited ones; whether there is any is a rule).
 * @param {unknown} payload - The first argument.
 * @param {unknown[]} extra - Any further arguments (must be none).
 * @returns {NetworkUpdateRequest} A fresh copy with exactly these keys.
 * @throws {Error} On any other shape.
 */
export function parseNetworkUpdateRequest(payload: unknown, extra: unknown[]): NetworkUpdateRequest {
  const raw = requireExactPayload(payload, extra, ['sessionNonce', 'networkId'], ['name', 'security', 'bands', 'passphrase'], 'Wi-Fi network');
  const request: NetworkUpdateRequest = { sessionNonce: nonceField(raw), networkId: networkIdField(raw) };
  if (raw.name !== undefined) {
    request.name = networkNameField(raw);
  }
  if (raw.security !== undefined) {
    request.security = securityField(raw);
  }
  if (raw.bands !== undefined) {
    request.bands = bandsField(raw);
  }
  if (raw.passphrase !== undefined) {
    request.passphrase = passphraseField(raw);
  }
  return request;
} // End of function parseNetworkUpdateRequest()

/**
 * Shape guard of MANAGEMENT_NETWORK_PASSWORD: one argument `{sessionNonce,
 * networkId, passphrase}`.
 * @param {unknown} payload - The first argument.
 * @param {unknown[]} extra - Any further arguments (must be none).
 * @returns {NetworkPasswordRequest} A fresh copy with exactly these keys.
 * @throws {Error} On any other shape.
 */
export function parseNetworkPasswordRequest(payload: unknown, extra: unknown[]): NetworkPasswordRequest {
  const raw = requireExactPayload(payload, extra, ['sessionNonce', 'networkId', 'passphrase'], [], 'Wi-Fi network');
  return { sessionNonce: nonceField(raw), networkId: networkIdField(raw), passphrase: passphraseField(raw) };
}

/**
 * Shape guard of MANAGEMENT_NETWORK_ENABLE: one argument `{sessionNonce,
 * networkId, enabled}` with a boolean `enabled`.
 * @param {unknown} payload - The first argument.
 * @param {unknown[]} extra - Any further arguments (must be none).
 * @returns {NetworkEnableRequest} A fresh copy with exactly these keys.
 * @throws {Error} On any other shape.
 */
export function parseNetworkEnableRequest(payload: unknown, extra: unknown[]): NetworkEnableRequest {
  const raw = requireExactPayload(payload, extra, ['sessionNonce', 'networkId', 'enabled'], [], 'Wi-Fi network');
  if (typeof raw.enabled !== 'boolean') {
    reject('invalid Wi-Fi network enable state');
  }
  return { sessionNonce: nonceField(raw), networkId: networkIdField(raw), enabled: raw.enabled as boolean };
}

/**
 * Shape guard of MANAGEMENT_NETWORK_DELETE: one argument `{sessionNonce, networkId}`.
 * @param {unknown} payload - The first argument.
 * @param {unknown[]} extra - Any further arguments (must be none).
 * @returns {NetworkDeleteRequest} A fresh copy with exactly these keys.
 * @throws {Error} On any other shape.
 */
export function parseNetworkDeleteRequest(payload: unknown, extra: unknown[]): NetworkDeleteRequest {
  const raw = requireExactPayload(payload, extra, ['sessionNonce', 'networkId'], [], 'Wi-Fi network');
  return { sessionNonce: nonceField(raw), networkId: networkIdField(raw) };
}
