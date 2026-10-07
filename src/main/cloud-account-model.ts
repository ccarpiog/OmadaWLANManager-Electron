// TP-Link cloud account model (Account Level Open API, docs/omada-cloud-openapi.md).
// Pure (no Electron): the error type of the cloud client, the documented error
// codes, the strict validator of an organization-list row, the controller DTO
// the renderer gets (and why a controller cannot be connected), and the two
// small interfaces the Open API client's cloud route depends on. Unit-tested
// in tests/unit/cloud-account-model.test.ts.
//
// The organization row keeps main-only data — `deviceId` and the allowlisted
// `serverHost` origin — that never crosses to the renderer: toCloudController()
// builds the DTO `{omadacId, name, online, version, connectable, reason}` only.

import type { CloudController, CloudControllerReason, CloudRegion } from '../shared/types';
import { allowlistedCloudOrigin } from './cloud-hosts';
import { groupModelForVersion, normalizeControllerVersion, parseControllerVersion } from './controller-version';
import { redactText } from './redact';

/**
 * Stable error codes of CloudAccountError:
 * - 'credentialInvalid': the token request was refused for the credential
 *   (CREDENTIAL_INVALID_ERROR_CODES, or HTTP 401 / 403 there);
 * - 'tokenRejected': a call's token was rejected again after one re-acquire;
 * - 'rateLimited': still -7132 / HTTP 429 after the throttle's backoff retries;
 * - 'httpError': another non-2xx status;
 * - 'timeout' / 'networkError': transport failures (also a URL the cloud
 *   transport refused: not an allowlisted origin);
 * - 'apiError': another non-zero errorCode (`apiErrorCode` carries it; the
 *   diagnostic carries TP-Link's redacted message);
 * - 'malformedResponse': invalid JSON, no errorCode, or an unexpected shape;
 * - 'clientClosed': the client was closed (credentials changed or removed).
 */
export type CloudAccountErrorCode =
  | 'credentialInvalid'
  | 'tokenRejected'
  | 'rateLimited'
  | 'httpError'
  | 'timeout'
  | 'networkError'
  | 'apiError'
  | 'malformedResponse'
  | 'clientClosed';

// Diagnostics are cut to this many characters (after redaction)
export const MAX_CLOUD_DIAGNOSTIC_CHARS = 200;

// The documented token-request refusals that mean "this credential cannot be
// used" (docs/omada-cloud-openapi.md §9): -52602 "This Open API Application
// has expired or does not exist." (seen live on EUW with dummy credentials,
// 2026-10-07; not in the guide's table), -90106 "The Client Id Or Client
// Secret is Invalid", -90112 "…has expired or does not exist", -90113 "…has
// been disabled", -44116 "Open API authorized failed, please check whether the
// input parameters are legal". Which of them the token endpoint really answers
// is UNVERIFIED (live-test checklist)
export const CREDENTIAL_INVALID_ERROR_CODES: ReadonlySet<number> = new Set([-52602, -90106, -90112, -90113, -44116]);

// The documented answers meaning "this access token is not (or no longer)
// valid" on an authorized call: -44112 expired, -44113 invalid, -44116
// (HTTP 401 on /v1/organizations with a bad token, seen live 2026-10-07).
// HTTP 401 counts as well. Whether the cloudaccess tunnel answers the same
// codes is UNVERIFIED
export const CLOUD_TOKEN_REJECTED_ERROR_CODES: ReadonlySet<number> = new Set([-44112, -44113, -44116]);

// The rate-limit answer ("Our server is receiving too many requests now")
export const CLOUD_RATE_LIMIT_ERROR_CODE = -7132;

// An omadacId as it may be stored, compared and sent: letters, digits, '_'
// and '-' (TP-Link's are 32 hex digits, unverified), never one of the
// reserved words ('local' names the configured controller; the others would
// be dangerous as object keys)
export const OMADAC_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED_IDS: ReadonlySet<string> = new Set(['local', '__proto__', 'constructor', 'prototype']);

// A deviceId (the cloudaccess path segment): TP-Link's example is 38 hex digits
const DEVICE_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

// Controller organization types: `SMB.OMADA.*CONTROLLER` (the guide's note on
// orgVersion; e.g. SMB.OMADA.SOFTWARECONTROLLER). The OC200's exact value is
// UNVERIFIED
const CONTROLLER_TYPE_REGEX = /^SMB\.OMADA\.[A-Z0-9_.]*CONTROLLER$/i;

// Display names: at most this many characters; control characters removed
const MAX_ORG_NAME_LENGTH = 128;
const MAX_DEVICE_TYPE_LENGTH = 128;
// C0 / C1 control characters and the bidirectional controls (never displayed)
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/**
 * Error thrown by CloudAccountClient: a stable code plus a sanitized
 * diagnostic (redacted, at most MAX_CLOUD_DIAGNOSTIC_CHARS characters; never
 * a raw body, the cloud Client Secret or a token). `httpStatus` /
 * `apiErrorCode` are set when known.
 */
export class CloudAccountError extends Error {
  readonly code: CloudAccountErrorCode;
  readonly diagnostic: string;
  readonly httpStatus: number | null;
  readonly apiErrorCode: number | null;

  /**
   * Creates the error. The diagnostic is redacted again here (idempotent).
   * @param {CloudAccountErrorCode} code - Stable error code.
   * @param {string} diagnostic - Sanitized diagnostic text.
   * @param {{ httpStatus?: number; apiErrorCode?: number }} [details] - Status / errorCode.
   */
  constructor(code: CloudAccountErrorCode, diagnostic: string, details: { httpStatus?: number; apiErrorCode?: number } = {}) {
    const safeDiagnostic = redactText(diagnostic).slice(0, MAX_CLOUD_DIAGNOSTIC_CHARS);
    super(`Cloud account ${code}: ${safeDiagnostic}`);
    this.name = 'CloudAccountError';
    this.code = code;
    this.diagnostic = safeDiagnostic;
    this.httpStatus = details.httpStatus ?? null;
    this.apiErrorCode = details.apiErrorCode ?? null;
  }
} // End of class CloudAccountError

/** A saved cloud credential (main process only, never over IPC or in a log). */
export interface CloudCredentials {
  region: CloudRegion;
  clientId: string;
  clientSecret: string;
}

/**
 * Where the Open API client's cloud route gets its access token (implemented
 * by CloudAccountClient). Both methods reject with a CloudAccountError.
 */
export interface CloudTokenProvider {
  // A usable account token (the cached one, or a fresh get_tokens)
  getAccessToken(): Promise<string>;
  // The token to retry with after `rejectedToken` was rejected: a newer one,
  // or a fresh get_tokens (shared with every concurrent caller)
  renewAccessToken(rejectedToken: string): Promise<string>;
}

/**
 * One organization of the account as main keeps it (never sent to the
 * renderer as such): `deviceId` is null when absent or malformed,
 * `serverOrigin` is the allowlisted origin of `serverHost` (null when absent
 * or not allowlisted), `version` the normalized orgVersion, `deviceType` the
 * reported type (null when absent or insane).
 */
export interface CloudOrganization {
  omadacId: string;
  name: string;
  online: boolean;
  deviceId: string | null;
  version: string | null;
  deviceType: string | null;
  serverOrigin: string | null;
}

/**
 * What the Open API client's cloud route needs to reach one controller: the
 * organization's omadacId (used in the self-hosted path instead of
 * /api/info's), its deviceId and its allowlisted serverHost origin.
 */
export interface CloudControllerTarget {
  omadacId: string;
  deviceId: string;
  serverOrigin: string;
}

/**
 * Tells whether a value is a usable omadacId (OMADAC_ID_REGEX, not reserved).
 * @param {unknown} value - The raw value.
 * @returns {value is string} True when usable.
 */
export function isOmadacId(value: unknown): value is string {
  return typeof value === 'string' && OMADAC_ID_REGEX.test(value) && !RESERVED_IDS.has(value);
}

/**
 * Tells whether a value is a usable deviceId (DEVICE_ID_REGEX).
 * @param {unknown} value - The raw value.
 * @returns {value is string} True when usable.
 */
export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_REGEX.test(value);
}

/**
 * Normalizes an organization name for display: control and bidirectional
 * characters removed, trimmed, at most MAX_ORG_NAME_LENGTH characters.
 * @param {unknown} raw - The raw `orgName`.
 * @returns {string | null} The name, or null when nothing usable is left.
 */
function normalizeOrgName(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const cleaned = raw.replace(UNSAFE_NAME_CHARACTERS, '').trim().slice(0, MAX_ORG_NAME_LENGTH).trim();
  return cleaned === '' ? null : cleaned;
}

/**
 * Validates one row of `GET /v1/organizations` (`result.data[]`) strictly:
 * the row must be a plain object with a usable omadacId (otherwise the whole
 * listing is refused as malformed — the caller cannot even name the row);
 * every other field is kept only when sane, else recorded as unknown (null),
 * which makes the controller not connectable with a reason (never a guess):
 * `online` only as the literal true; `deviceId` per DEVICE_ID_REGEX;
 * `orgVersion` normalized like /api/info's controllerVer; `deviceType` a
 * printable string of sane length; `serverHost` through the allowlist
 * (allowlistedCloudOrigin()). A missing or unusable name falls back to the
 * omadacId (display only).
 * @param {unknown} entry - One raw entry of `result.data`.
 * @returns {CloudOrganization} The organization.
 * @throws {CloudAccountError} 'malformedResponse' when the row or its omadacId is unusable.
 */
export function validateCloudOrganization(entry: unknown): CloudOrganization {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new CloudAccountError('malformedResponse', 'Unsupported organization list entry');
  }
  const raw = entry as Record<string, unknown>;
  if (!isOmadacId(raw.omadacId)) {
    throw new CloudAccountError('malformedResponse', 'Organization list entry without a usable omadacId');
  }
  const deviceType =
    typeof raw.deviceType === 'string' && raw.deviceType.length > 0 && raw.deviceType.length <= MAX_DEVICE_TYPE_LENGTH && /^[\x21-\x7e]+$/.test(raw.deviceType)
      ? raw.deviceType
      : null;
  return {
    omadacId: raw.omadacId,
    name: normalizeOrgName(raw.orgName) ?? raw.omadacId,
    online: raw.online === true,
    deviceId: isDeviceId(raw.deviceId) ? raw.deviceId : null,
    version: normalizeControllerVersion(raw.orgVersion),
    deviceType,
    serverOrigin: allowlistedCloudOrigin(raw.serverHost)
  };
} // End of function validateCloudOrganization()

/**
 * Decides why an organization cannot be connected (null: it can), in the
 * order documented on CloudControllerReason: notController, incompleteEntry,
 * unsupportedHost, versionUnknown, versionTooOld, offline.
 * @param {CloudOrganization} organization - The validated organization.
 * @returns {CloudControllerReason | null} The first reason that applies, or null.
 */
export function cloudControllerReason(organization: CloudOrganization): CloudControllerReason | null {
  if (organization.deviceType !== null && !CONTROLLER_TYPE_REGEX.test(organization.deviceType)) {
    return 'notController';
  }
  if (organization.deviceType === null || organization.deviceId === null) {
    return 'incompleteEntry';
  }
  if (organization.serverOrigin === null) {
    return 'unsupportedHost';
  }
  if (parseControllerVersion(organization.version) === null) {
    return 'versionUnknown';
  }
  if (groupModelForVersion(organization.version) !== 'apGroup') {
    return 'versionTooOld';
  }
  if (!organization.online) {
    return 'offline';
  }
  return null;
} // End of function cloudControllerReason()

/**
 * Builds the renderer DTO of one organization: exactly `{omadacId, name,
 * online, version, connectable, reason}` — never its deviceId, serverHost or
 * deviceType.
 * @param {CloudOrganization} organization - The validated organization.
 * @returns {CloudController} The DTO.
 */
export function toCloudController(organization: CloudOrganization): CloudController {
  const reason = cloudControllerReason(organization);
  return {
    omadacId: organization.omadacId,
    name: organization.name,
    online: organization.online,
    version: organization.version,
    connectable: reason === null,
    reason
  };
}

/**
 * Returns the cloud route target of a connectable organization (main only).
 * @param {CloudOrganization} organization - The validated organization.
 * @returns {CloudControllerTarget | null} The target, or null when the
 *   organization is not connectable (cloudControllerReason() is not null).
 */
export function cloudControllerTarget(organization: CloudOrganization): CloudControllerTarget | null {
  if (cloudControllerReason(organization) !== null || organization.deviceId === null || organization.serverOrigin === null) {
    return null;
  }
  return { omadacId: organization.omadacId, deviceId: organization.deviceId, serverOrigin: organization.serverOrigin };
}
