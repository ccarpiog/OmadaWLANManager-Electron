// Pure shape guards for the session-owned IPC channels (docs/management-design.md
// §3): the management-access channels of phase 15b and the AP-group channels
// of phase 16a. index.ts calls them right after assertTrustedIpcSender(); the
// unit tests (tests/unit/ipc-guards.test.ts) and the smoke stub
// (tests/smoke/stub-main.cjs, which requires the compiled module) use the very
// same functions. A malformed call throws (the IPC invoke rejects, like the
// other channels' format guards); the semantic checks (name rules, policy,
// session ownership) answer with stable error codes elsewhere.

import { AP_GROUP_ID_REGEX } from './ap-group-policy';
import type { ApGroupCreateRequest, ApGroupDeleteRequest, ApGroupRenameRequest } from '../shared/types';

// Format guard for the opaque nonces (site selection, certificate trust, the
// controller session): exactly 32 lowercase hex characters (16 random bytes —
// see createNonce() in connection-manager.ts)
export const NONCE_REGEX = /^[0-9a-f]{32}$/;

// Upper bound for a group name as it arrives (before trimming): a defense
// against absurd payloads. The name rules proper (1–128 characters after
// trimming) are applied by validateApGroupName() and answered with codes
export const MAX_RAW_AP_GROUP_NAME_LENGTH = 1024;

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
 * Checks that an AP-group payload is the only argument and a plain object
 * (Object or null prototype) carrying exactly `keys` — none missing, no other.
 * @param {unknown} payload - The first argument.
 * @param {unknown[]} extra - Any further arguments (must be none).
 * @param {readonly string[]} keys - The keys the payload must carry.
 * @returns {Record<string, unknown>} The payload.
 * @throws {Error} On extra arguments, a non-object or the wrong keys.
 */
function requireExactPayload(payload: unknown, extra: unknown[], keys: readonly string[]): Record<string, unknown> {
  if (extra.length > 0) {
    reject('unexpected arguments');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    reject('invalid AP-group request');
  }
  const prototype = Object.getPrototypeOf(payload);
  if (prototype !== Object.prototype && prototype !== null) {
    reject('invalid AP-group request');
  }
  const present = Object.keys(payload);
  if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
    reject('invalid AP-group request keys');
  }
  return payload as Record<string, unknown>;
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
