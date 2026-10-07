// Omada Open API client (docs/management-design.md §2.1, §3, §5; todo.md 4.8).
// Electron-free: every request goes through an injected OmadaTransport
// (omada-transport.ts). In production ControllerSession (controller-session.ts)
// creates it with the net transport bound to the pinned ControllerTlsSessions
// session, only after the internal connect passed the certificate pin check;
// the unit tests pass a fake (tests/unit/openapi-client.test.ts).
//
// - Token: TP-Link's client-credentials flow, `POST
//   /openapi/authorize/token?grant_type=client_credentials` with the JSON body
//   `{omadacId, client_id, client_secret}` → `result.accessToken` +
//   `expiresIn` (seconds). The token lives in memory only (a private field);
//   every call sends `Authorization: AccessToken=<token>`. The refresh token
//   the endpoint also returns is ignored (never stored): re-acquiring with the
//   client credentials needs no second grant.
// - Lifecycle: the token is re-acquired proactively shortly before it expires
//   (TOKEN_EXPIRY_MARGIN_MS); a token-rejected response (HTTP 401 or an
//   errorCode in TOKEN_REJECTED_ERROR_CODES) makes the request re-acquire ONCE
//   and retry ONCE. Every acquisition goes through one shared in-flight
//   promise (like sharedRelogin() in omada-api.ts), so concurrent requests
//   share it; a second rejection surfaces as 'tokenRejected', never a loop.
//   close() drops every token reference (the current token, the acquisition
//   in flight, the tokens remembered for scrubbing); an operation in flight
//   then ends as 'clientClosed' as soon as it resumes and sends nothing more.
// - Paths: every call names its API version explicitly ('v1' | 'v2', no
//   default) and its path segments, which are percent-encoded one by one.
// - AP-group writes (todo.md 4.9): createApGroup() / renameApGroup() /
//   deleteApGroup() send exactly the documented v1 calls; their only caller
//   is ControllerSession, which checks the capabilities, the name rules and
//   the delete policy (ap-group-policy.ts) on fresh data first.
// - Wi-Fi network reads (todo.md 4.10): listSsids() (the v2 catalog, paged),
//   getSsidDetail() (v1) and getSsidApGroups() (v1 bindings), each answer
//   validated by wifi-network-model.ts, which keeps allowlisted values only
//   (never the passphrase); a malformed answer is 'malformedResponse'.
// - Wi-Fi network writes (todo.md 4.11): createSsid() (v2), getSsidWriteDetail()
//   (the v1 detail as the controller sent it, for the read-merge-write — main
//   memory only), updateSsidBasicConfig(), setSsidEnabled() and deleteSsid()
//   (v1) send exactly the documented calls with the bodies wifi-network-write.ts
//   builds; their only caller is ControllerSession, which checks the
//   capabilities and the write rules on fresh data first. A body is sanity-
//   checked here too (never an Enterprise / PPSK body), and the passphrase it
//   carries is scrubbed by value from every diagnostic of that call.
// - Wi-Fi network bindings (todo.md 4.12): updateSsidApGroups() (v1) sends
//   exactly `{apGroupIds}` (network-binding-plan.ts), the complete new set of
//   bound AP groups; its only caller is ControllerSession, which plans the
//   change on fresh data first (never for an "All access points" or
//   unknown-scope network). The ids are sanity-checked here too.
// - Errors: OpenApiError with a stable `code` and a sanitized diagnostic
//   (redact.ts plus the client's own secret and tokens scrubbed by value);
//   never a raw request or response body, the Client Secret or a token.
// - The Client Secret and the token are private class fields (#…): they are
//   not enumerable, so JSON.stringify() and util.inspect() never show them.
// - Routes (inbox item I-1, docs/omada-cloud-openapi.md §6): 'local' (the
//   default, everything above: the configured controller reached directly,
//   its own client-credentials token) or 'cloud' (a controller of the TP-Link
//   cloud account, reached through the Account Level Open API tunnel). The
//   cloud route prefixes every self-hosted path with
//   `{serverHost}/v1/cloudaccess/{deviceId}` — e.g.
//   `{serverHost}/v1/cloudaccess/{deviceId}/openapi/v1/{omadacId}/sites` —,
//   takes the omadacId, deviceId and serverHost from the organization list
//   (never /api/info), refuses a serverHost outside the allowlist in the
//   constructor (cloud-hosts.ts: before any request), and gets its token from
//   a CloudTokenProvider (CloudAccountClient: the account token, never the
//   refresh token). Every cloud call takes a slot of the credential's shared
//   CloudRequestThrottle first; a rate-limit answer (-7132 or HTTP 429) holds
//   the credential back and is retried up to CLOUD_RATE_LIMIT_MAX_RETRIES
//   times, then is 'rateLimited'. The operations and validators below are the
//   same for both routes.

import { MAX_AP_GROUP_NAME_LENGTH } from './ap-group-policy';
import {
  CLOUD_RATE_LIMIT_ERROR_CODE,
  CLOUD_TOKEN_REJECTED_ERROR_CODES,
  CloudAccountError,
  CloudAccountErrorCode,
  CloudControllerTarget,
  CloudTokenProvider,
  isDeviceId,
  isOmadacId
} from './cloud-account-model';
import { allowlistedCloudOrigin } from './cloud-hosts';
import { CLOUD_RATE_LIMIT_MAX_RETRIES, CloudRequestThrottle } from './cloud-throttle';
import { buildBindingsBody, isSaneBindingIds } from './network-binding-plan';
import { HttpMethod, OmadaHttpRequest, OmadaHttpResponse, OmadaTransport } from './omada-transport';
import { redactText } from './redact';
import { buildEnableBody, isSaneSsidWriteBody, ssidBodySecrets } from './wifi-network-write';
import {
  isSsidId,
  OpenApiSsid,
  OpenApiSsidBindings,
  OpenApiSsidDetail,
  validateOpenApiSsid,
  validateOpenApiSsidDetail,
  validateSsidBindings
} from './wifi-network-model';

/** The Open API version of one endpoint (spec §2.1: SSID list/create are v2, the rest v1). */
export type OpenApiVersion = 'v1' | 'v2';

/** HTTP methods the Open API client sends. */
export type OpenApiMethod = HttpMethod;

/**
 * Stable error codes of OpenApiError:
 * - 'invalidCredentials': the token endpoint rejected the Client ID / Secret;
 * - 'tokenRejected': a call's token was rejected again after one re-acquire;
 * - 'httpError': a non-2xx status (other than a token rejection);
 * - 'timeout': no complete response within the transport's timeout;
 * - 'networkError': any other transport failure (connection, abort, size cap);
 * - 'apiError': the controller answered with a non-zero errorCode
 *   (`controllerErrorCode` carries it);
 * - 'malformedResponse': invalid JSON, a missing errorCode, or a payload whose
 *   shape the validators reject;
 * - 'clientClosed': the client was closed (close()) before or during the call;
 * - 'rateLimited' (cloud route only): TP-Link's rate limit (-7132 / HTTP 429)
 *   persisted through the backoff retries.
 */
export type OpenApiErrorCode =
  | 'invalidCredentials'
  | 'tokenRejected'
  | 'httpError'
  | 'timeout'
  | 'networkError'
  | 'apiError'
  | 'malformedResponse'
  | 'clientClosed'
  | 'rateLimited';

// How a cloud token failure (CloudAccountError from the CloudTokenProvider)
// surfaces from the cloud route
const CLOUD_TOKEN_ERROR_CODES: Readonly<Record<CloudAccountErrorCode, OpenApiErrorCode>> = {
  credentialInvalid: 'invalidCredentials',
  tokenRejected: 'tokenRejected',
  rateLimited: 'rateLimited',
  httpError: 'httpError',
  timeout: 'timeout',
  networkError: 'networkError',
  apiError: 'apiError',
  malformedResponse: 'malformedResponse',
  clientClosed: 'clientClosed'
};

// The token endpoint (client-credentials mode). Not in the controller's
// self-hosted spec: taken from TP-Link's Open API documentation
// (docs/omada-6.3-api-findings.md), unverified live (spec §5)
export const TOKEN_PATH = '/openapi/authorize/token?grant_type=client_credentials';

// Controller errorCodes meaning "the access token has expired / is invalid".
// UNVERIFIED (spec §5, D4): the repo's docs list none; -44112 ("access token
// expired") and -44113 ("access token invalid") are TP-Link's Open API
// general error codes as published in its Open API guide. To be confirmed by
// the phase 20 live checklist (docs/live-test-checklist.md). HTTP 401 is
// treated as a token rejection as well.
export const TOKEN_REJECTED_ERROR_CODES: ReadonlySet<number> = new Set([-44112, -44113]);

// Token-endpoint errorCodes meaning "wrong Client ID / Client Secret".
// UNVERIFIED like the set above: -44106 ("client id or client secret is
// invalid") per TP-Link's Open API guide; phase 20 live checklist. An HTTP
// 401/403 from the token endpoint maps to 'invalidCredentials' too; any other
// non-zero errorCode there is an 'apiError' carrying the code.
export const INVALID_CLIENT_ERROR_CODES: ReadonlySet<number> = new Set([-44106]);

// A token counts as expired this long before its reported expiry (capped at
// half its lifetime, so a short-lived token is still used)
export const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;
// Lifetime assumed when the token response carries no `expiresIn` (TP-Link
// documents it; a controller omitting it gets a short, safe default)
export const DEFAULT_TOKEN_LIFETIME_S = 300;
// Upper bound for a reported lifetime (an absurd value is clamped, so the
// proactive renewal still happens within a day)
export const MAX_TOKEN_LIFETIME_S = 24 * 60 * 60;

// Pagination (spec: `page` from 1, `pageSize` 1–1000). With a sane
// `totalRows` the walk goes on until the raw entries fetched reach it (short
// pages included: the controller may cap the page size); without one a short
// page ends it. Anything that makes completeness unprovable — an empty or
// repeating page before the end, a changed `totalRows`, the defensive
// MAX_PAGES cap — marks the listing incomplete (`truncated`), never silently
// shorter. Entries are deduplicated by id (see listAll())
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 1000;
export const MAX_PAGES = 50;

// Diagnostics are cut to this many characters (after redaction)
export const MAX_DIAGNOSTIC_CHARS = 200;

// Sanity caps on identifiers and tokens taken from responses
const MAX_ID_LENGTH = 128;
const MAX_TOKEN_LENGTH = 4096;
// An access token goes into a header: printable ASCII without spaces only
const TOKEN_REGEX = /^[\x21-\x7e]+$/;
// HTTP header names (RFC 9110 token characters)
const HEADER_NAME_REGEX = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// Header names the caller may not set: the client owns them
const RESERVED_HEADERS = new Set(['authorization', 'cookie', 'host', 'content-length']);
// How many of this client's tokens are remembered to scrub them by value
const MAX_REMEMBERED_TOKENS = 8;

/**
 * Error thrown by OpenApiClient: a stable code plus a sanitized diagnostic
 * (redacted, at most MAX_DIAGNOSTIC_CHARS characters; never a raw body, the
 * Client Secret or a token). `httpStatus` / `controllerErrorCode` are set
 * when known.
 */
export class OpenApiError extends Error {
  readonly code: OpenApiErrorCode;
  readonly diagnostic: string;
  readonly httpStatus: number | null;
  readonly controllerErrorCode: number | null;

  /**
   * Creates the error. The diagnostic is redacted again here (idempotent),
   * so no caller can put an unredacted secret pattern into a message.
   * @param {OpenApiErrorCode} code - Stable error code.
   * @param {string} diagnostic - Sanitized diagnostic text.
   * @param {{ httpStatus?: number; controllerErrorCode?: number }} [details] - Status / errorCode.
   */
  constructor(code: OpenApiErrorCode, diagnostic: string, details: { httpStatus?: number; controllerErrorCode?: number } = {}) {
    const safeDiagnostic = redactText(diagnostic).slice(0, MAX_DIAGNOSTIC_CHARS);
    super(`Open API ${code}: ${safeDiagnostic}`);
    this.name = 'OpenApiError';
    this.code = code;
    this.diagnostic = safeDiagnostic;
    this.httpStatus = details.httpStatus ?? null;
    this.controllerErrorCode = details.controllerErrorCode ?? null;
  }
} // End of class OpenApiError

/** A validated access token (memory only). */
export interface AccessTokenState {
  accessToken: string;
  // Epoch ms from which the token counts as expired (reported expiry minus
  // the safety margin)
  renewAt: number;
}

/** Query parameters of an Open API call (undefined values are skipped). */
export type OpenApiQuery = Record<string, string | number | boolean | undefined>;

/** Options of one OpenApiClient.request() call. */
export interface OpenApiRequestOptions {
  query?: OpenApiQuery;
  // JSON body (serialized by the client); omitted when undefined
  body?: unknown;
  // Extra headers (Authorization, Cookie, Host, Content-Length are reserved)
  headers?: Record<string, string>;
  // Secret values this call carries (e.g. a Wi-Fi passphrase in its body):
  // scrubbed by value from every diagnostic of the call, like the client's
  // own Client Secret and tokens
  secrets?: readonly string[];
}

/** Options of OpenApiClient.listAll(). */
export interface OpenApiListOptions {
  pageSize?: number;
  maxPages?: number;
  // Extra query parameters (page and pageSize are the client's)
  query?: OpenApiQuery;
  // Called with each page's raw `result` (after its shape was validated), for
  // page-level fields a listing also carries (e.g. the AP-group SSID limits)
  onPage?: (result: unknown, page: number) => void;
}

/**
 * The result of a paginated listing: the deduplicated items and whether the
 * listing may be incomplete (`truncated`: the page cap cut it, or the walk
 * could not prove it complete — see listAll()). Every caller treats a
 * truncated list as incomplete, never as the whole listing.
 */
export interface PagedList<T> {
  items: T[];
  truncated: boolean;
}

/** One validated page of an Open API listing (`result` of a paged call). */
export interface OpenApiPage {
  data: unknown[];
  // `totalRows`, or null when absent or not a sane count (a non-negative
  // safe integer)
  totalRows: number | null;
}

// Why listAll() could not prove a listing complete (logged, codes only)
type ListIncompleteReason = 'pageCap' | 'emptyPage' | 'noProgress' | 'totalChanged';

/** A site as listed by `GET /openapi/v1/{omadacId}/sites`. */
export interface OpenApiSite {
  id: string;
  name: string;
}

/**
 * An AP group as listed by `GET /openapi/v1/{omadacId}/sites/{siteId}/ap-groups`.
 * Optional fields are present only when the controller reports them sanely:
 * `isDefault` only as `true` (`primary: true`), `apNum` as a non-negative
 * integer, `ssidNameList` only as an array of strings (an array with any other
 * entry, or anything but an array, is left out: the bindings are unknown, never
 * "none" — the delete policy refuses such a group), `remainingBinding` with its
 * non-negative integer entries (per band; the spec keys them 0: 2.4 GHz,
 * 1: 5 GHz, 2: 6 GHz).
 */
export interface OpenApiApGroup {
  id: string;
  name: string;
  isDefault?: true;
  apNum?: number;
  ssidNameList?: string[];
  remainingBinding?: Record<string, number>;
}

/**
 * The per-group SSID limits a `GET …/ap-groups` page reports next to its data
 * (`maxSsids2G`, `maxSsids5G`, `maxSsids6G`, `maxSsidsMlo`), each kept only as
 * a non-negative integer.
 */
export interface OpenApiApGroupLimits {
  band2g?: number;
  band5g?: number;
  band6g?: number;
  mlo?: number;
}

/** The AP groups of a site plus the SSID limits of its first page. */
export interface OpenApiApGroupList extends PagedList<OpenApiApGroup> {
  limits: OpenApiApGroupLimits;
}

/**
 * One SSID detail read for a write (getSsidWriteDetail()): the validated
 * detail, and the `result` object exactly as the controller sent it — the
 * base of the read-merge-write. `raw` may hold the passphrase: it stays in
 * main-process memory and is never logged, returned over IPC or put into a
 * body by the merge (wifi-network-write.ts).
 */
export interface OpenApiSsidWriteDetail {
  detail: OpenApiSsidDetail;
  raw: Record<string, unknown>;
}

/** Constructor options of OpenApiClient on the local route (the default). */
export interface OpenApiClientOptions {
  route?: 'local';
  // Controller base URL (a trailing slash is removed)
  baseUrl: string;
  // The controller id from /api/info
  omadacId: string;
  clientId: string;
  // Main process only; held in a private field
  clientSecret: string;
  transport: OmadaTransport;
  // Clock (epoch ms); tests inject a fake one
  now?: () => number;
}

/**
 * Constructor options of OpenApiClient on the cloud route (see the header):
 * the organization's target, the account's token provider and the
 * credential's shared throttle. The transport is the cloud transport (its
 * own Electron session, the origin allowlist enforced again there).
 */
export interface CloudOpenApiClientOptions {
  route: 'cloud';
  target: CloudControllerTarget;
  tokenProvider: CloudTokenProvider;
  throttle: CloudRequestThrottle;
  transport: OmadaTransport;
}

/** Options of walkPagedListing(). */
export interface PagedWalkOptions {
  pageSize: number;
  maxPages: number;
  // Extra query parameters (page and pageSize are the walker's)
  query?: OpenApiQuery;
  // What is listed (e.g. 'sites'), and the subject of the incompleteness log
  // line (e.g. 'Open API listing')
  what: string;
  label: string;
  // Called with each page's raw `result` (after its shape was validated)
  onPage?: (result: unknown, page: number) => void;
}

/**
 * Tells whether a value is a usable identifier from a response: a non-empty
 * string of sane length.
 * @param {unknown} value - The raw value.
 * @returns {value is string} True when usable.
 */
function isUsableId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

/**
 * Tells whether a value is a non-negative safe integer (a count).
 * @param {unknown} value - The raw value.
 * @returns {value is number} True when the value is a count.
 */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Builds the 'malformedResponse' error for a payload a validator rejects.
 * @param {string} what - What was being validated (e.g. 'sites').
 * @returns {OpenApiError} The error.
 */
function malformed(what: string): OpenApiError {
  return new OpenApiError('malformedResponse', `Unsupported Open API response (${what})`);
}

/**
 * Percent-encodes one path segment. Empty, '.' and '..' segments are refused
 * (they would change the path's meaning even when encoded).
 * @param {string} segment - The raw segment.
 * @returns {string} The encoded segment.
 * @throws {Error} When the segment is not a usable string.
 */
function encodePathSegment(segment: string): string {
  if (typeof segment !== 'string' || segment === '' || segment === '.' || segment === '..') {
    throw new Error('Invalid Open API path segment');
  }
  return encodeURIComponent(segment);
}

/**
 * Builds an Open API path with an EXPLICIT version: `/openapi/{v}/{omadacId}/…`,
 * every segment (the controller id included) percent-encoded.
 * @param {OpenApiVersion} version - 'v1' or 'v2' (required, no default).
 * @param {string} omadacId - The controller id.
 * @param {readonly string[]} segments - The path segments after the controller id.
 * @returns {string} The path (no query string).
 * @throws {Error} On an unknown version or an unusable segment.
 */
export function openApiPath(version: OpenApiVersion, omadacId: string, segments: readonly string[]): string {
  if (version !== 'v1' && version !== 'v2') {
    throw new Error('Open API version must be v1 or v2');
  }
  const parts = [omadacId, ...segments].map(encodePathSegment);
  return `/openapi/${version}/${parts.join('/')}`;
}

/**
 * Builds a query string ('' when there is nothing to send) in insertion order;
 * undefined values are skipped.
 * @param {OpenApiQuery | undefined} query - The parameters.
 * @returns {string} '' or '?a=1&b=2'.
 */
export function buildQueryString(query: OpenApiQuery | undefined): string {
  if (!query) {
    return '';
  }
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.append(name, String(value));
    }
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
} // End of function buildQueryString()

/**
 * Validates the `result` of the token endpoint into an in-memory token:
 * `accessToken` must be a non-empty printable-ASCII string without spaces
 * (it goes into a header) of sane length; `expiresIn` (seconds) must be a
 * positive finite number when present (clamped to MAX_TOKEN_LIFETIME_S), and
 * DEFAULT_TOKEN_LIFETIME_S is assumed when it is absent. The renewal time is
 * the expiry minus TOKEN_EXPIRY_MARGIN_MS (at most half the lifetime).
 * @param {unknown} result - Raw `result` of the token response.
 * @param {number} nowMs - Current time (epoch ms).
 * @returns {AccessTokenState} The validated token.
 * @throws {OpenApiError} 'malformedResponse' on any other shape.
 */
export function validateTokenResult(result: unknown, nowMs: number): AccessTokenState {
  if (result === null || typeof result !== 'object') {
    throw malformed('token');
  }
  const raw = result as Record<string, unknown>;
  const accessToken = raw.accessToken;
  if (typeof accessToken !== 'string' || accessToken.length === 0 || accessToken.length > MAX_TOKEN_LENGTH || !TOKEN_REGEX.test(accessToken)) {
    throw malformed('token');
  }
  let lifetimeSeconds = DEFAULT_TOKEN_LIFETIME_S;
  if (raw.expiresIn !== undefined && raw.expiresIn !== null) {
    if (typeof raw.expiresIn !== 'number' || !Number.isFinite(raw.expiresIn) || raw.expiresIn <= 0) {
      throw malformed('token');
    }
    lifetimeSeconds = Math.min(raw.expiresIn, MAX_TOKEN_LIFETIME_S);
  }
  const lifetimeMs = lifetimeSeconds * 1000;
  const marginMs = Math.min(TOKEN_EXPIRY_MARGIN_MS, lifetimeMs / 2);
  return { accessToken, renewAt: nowMs + lifetimeMs - marginMs };
} // End of function validateTokenResult()

/**
 * Validates the `result` of one page of a paged Open API listing:
 * `result.data` must be an array; `totalRows` is kept when it is a sane
 * count (a non-negative safe integer), otherwise it is null (not reported).
 * @param {unknown} result - Raw `result` of a paged response.
 * @param {string} what - What is listed (for the error diagnostic).
 * @returns {OpenApiPage} The page.
 * @throws {OpenApiError} 'malformedResponse' when `data` is not an array.
 */
export function validateOpenApiPage(result: unknown, what: string): OpenApiPage {
  const data = result !== null && typeof result === 'object' ? (result as Record<string, unknown>).data : undefined;
  if (!Array.isArray(data)) {
    throw malformed(what);
  }
  const rawTotal = (result as Record<string, unknown>).totalRows;
  const totalRows = isCount(rawTotal) ? rawTotal : null;
  return { data, totalRows };
}

/**
 * Validates one site entry of `GET /openapi/v1/{omadacId}/sites`: `siteId`
 * is required; a missing or empty name falls back to the id (display only).
 * @param {unknown} entry - One raw entry of `result.data`.
 * @returns {OpenApiSite} The site.
 * @throws {OpenApiError} 'malformedResponse' when the entry or its id is unusable.
 */
export function validateOpenApiSite(entry: unknown): OpenApiSite {
  if (entry === null || typeof entry !== 'object') {
    throw malformed('sites');
  }
  const raw = entry as Record<string, unknown>;
  if (!isUsableId(raw.siteId)) {
    throw malformed('sites');
  }
  return { id: raw.siteId, name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : raw.siteId };
}

/**
 * Validates one AP-group entry of `GET …/sites/{siteId}/ap-groups`: `id` is
 * required; the name is normalized ('' when missing); the optional fields are
 * kept only when sane (see OpenApiApGroup) and otherwise left out — an SSID
 * list is kept whole or not at all (never filtered into a shorter one).
 * @param {unknown} entry - One raw entry of `result.data`.
 * @returns {OpenApiApGroup} The AP group.
 * @throws {OpenApiError} 'malformedResponse' when the entry or its id is unusable.
 */
export function validateOpenApiApGroup(entry: unknown): OpenApiApGroup {
  if (entry === null || typeof entry !== 'object') {
    throw malformed('ap-groups');
  }
  const raw = entry as Record<string, unknown>;
  if (!isUsableId(raw.id)) {
    throw malformed('ap-groups');
  }
  const group: OpenApiApGroup = { id: raw.id, name: typeof raw.name === 'string' ? raw.name : '' };
  if (raw.primary === true) {
    group.isDefault = true;
  }
  if (isCount(raw.apNum)) {
    group.apNum = raw.apNum;
  }
  // Fail closed: filtering out the insane entries could turn `[null]` into
  // `[]` ("no networks bound") and let the delete policy pass
  if (Array.isArray(raw.ssidNameList) && raw.ssidNameList.every((name) => typeof name === 'string')) {
    group.ssidNameList = [...(raw.ssidNameList as string[])];
  }
  if (raw.remainingBinding !== null && typeof raw.remainingBinding === 'object' && !Array.isArray(raw.remainingBinding)) {
    const bindings: Record<string, number> = {};
    for (const [band, remaining] of Object.entries(raw.remainingBinding as Record<string, unknown>)) {
      if (band.length > 0 && band.length <= 32 && isCount(remaining)) {
        bindings[band] = remaining;
      }
    }
    if (Object.keys(bindings).length > 0) {
      group.remainingBinding = bindings;
    }
  } // End of the remainingBinding normalization
  return group;
} // End of function validateOpenApiApGroup()

/**
 * Reads the page-level SSID limits of an AP-group page `result`
 * (`maxSsids2G` / `5G` / `6G` / `Mlo`); a missing or insane value is left out.
 * @param {unknown} result - Raw `result` of a `GET …/ap-groups` page.
 * @returns {OpenApiApGroupLimits} The limits that were reported sanely.
 */
export function validateApGroupLimits(result: unknown): OpenApiApGroupLimits {
  const limits: OpenApiApGroupLimits = {};
  if (result === null || typeof result !== 'object') {
    return limits;
  }
  const raw = result as Record<string, unknown>;
  const fields: ReadonlyArray<readonly [string, keyof OpenApiApGroupLimits]> = [
    ['maxSsids2G', 'band2g'],
    ['maxSsids5G', 'band5g'],
    ['maxSsids6G', 'band6g'],
    ['maxSsidsMlo', 'mlo']
  ];
  for (const [field, key] of fields) {
    if (isCount(raw[field])) {
      limits[key] = raw[field] as number;
    }
  }
  return limits;
} // End of function validateApGroupLimits()

/**
 * Validates the `result` of `POST …/ap-groups` (ops doc: `{id}`, the new AP
 * group's id). Unverified live: a missing or unusable id is reported as null
 * (the caller then identifies the group from a fresh list), never guessed.
 * @param {unknown} result - Raw `result` of the create response.
 * @returns {string | null} The new group's id, or null when not usable.
 */
export function validateCreatedApGroup(result: unknown): string | null {
  if (result === null || typeof result !== 'object') {
    return null;
  }
  const id = (result as Record<string, unknown>).id;
  return isUsableId(id) ? id : null;
}

/**
 * Validates the `result` of `POST …/wireless-network/ssids` (ops doc: `{id}`,
 * the new SSID's id). Unverified live: a missing or unusable id (not an SSID
 * id, see isSsidId()) is reported as null — the caller then looks for the
 * network in a fresh catalog — never guessed.
 * @param {unknown} result - Raw `result` of the create response.
 * @returns {string | null} The new SSID's id, or null when not usable.
 */
export function validateCreatedSsid(result: unknown): string | null {
  if (result === null || typeof result !== 'object') {
    return null;
  }
  const id = (result as Record<string, unknown>).id;
  return isSsidId(id) ? id : null;
}

/**
 * Sanity check of an AP-group name handed to the client: a non-empty string
 * of at most MAX_AP_GROUP_NAME_LENGTH characters with no surrounding white
 * space. The name rules proper live in ap-group-policy.ts (applied by
 * ControllerSession); this only keeps a programming error from reaching the
 * controller.
 * @param {unknown} name - The name.
 * @returns {boolean} True when sane.
 */
function isSaneApGroupName(name: unknown): name is string {
  return typeof name === 'string' && name !== '' && name === name.trim() && name.length <= MAX_AP_GROUP_NAME_LENGTH;
}

/**
 * Checks the caller's extra headers: valid names, no CR/LF/NUL in values, and
 * none of the reserved names (the client owns Authorization and friends).
 * @param {Record<string, string> | undefined} headers - The extra headers.
 * @returns {Record<string, string>} A copy of the headers.
 * @throws {Error} On an invalid or reserved header.
 */
function checkExtraHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const checked: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!HEADER_NAME_REGEX.test(name) || RESERVED_HEADERS.has(name.toLowerCase())) {
      throw new Error(`Invalid or reserved Open API header: ${name}`);
    }
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)) {
      throw new Error(`Invalid value for the Open API header ${name}`);
    }
    checked[name] = value;
  } // End of the loop that checks each extra header
  return checked;
} // End of function checkExtraHeaders()

/**
 * Walks every page of a paged listing (`page` from 1, `pageSize`),
 * validating each entry and deduplicating by id (the first occurrence is
 * kept). Shared by OpenApiClient.listAll() and the cloud organization list
 * (CloudAccountClient). `truncated` is false only when the walk PROVED the
 * listing complete; otherwise it is true and the reason is logged (codes
 * only) — never a silently shorter list:
 * - a sane `totalRows` on the first page (see validateOpenApiPage()): the
 *   walk goes on until the raw entries fetched (duplicates included, so a
 *   repeated entry never costs an extra request) reach it, whatever the
 *   page lengths — a server that caps the page size below the requested one
 *   is still read completely. Incomplete: an empty page before the total is
 *   reached ('emptyPage');
 * - no sane `totalRows` on the first page: a short (or empty) page ends the
 *   walk;
 * - either way, incomplete: a page whose `totalRows` differs from the first
 *   page's — absent or insane vs a sane one included — ('totalChanged': the
 *   listing changed during the walk, or the server contradicts itself); a
 *   non-empty page that adds no new id ('noProgress': it only repeats
 *   entries, e.g. a server ignoring `page`); still unfinished at the page cap
 *   ('pageCap').
 * Every iteration either ends the walk or moves to the next page, and the
 * page cap ends it at the latest: at most `maxPages` requests, never a loop.
 * @param {(query: OpenApiQuery, page: number) => Promise<unknown>} fetchPage -
 *   Fetches one page's raw `result` (throws on any failure).
 * @param {(result: unknown) => OpenApiPage} validatePage - Validates a page's shape (throws).
 * @param {(entry: unknown) => T} validateEntry - Validates one entry (throws).
 * @param {(item: T) => string} idOf - The id to deduplicate by.
 * @param {PagedWalkOptions} options - Page size, page cap, extra query, labels.
 * @returns {Promise<PagedList<T>>} The items, in response order, and whether
 *   the listing may be incomplete (`truncated`).
 */
export async function walkPagedListing<T>(
  fetchPage: (query: OpenApiQuery, page: number) => Promise<unknown>,
  validatePage: (result: unknown) => OpenApiPage,
  validateEntry: (entry: unknown) => T,
  idOf: (item: T) => string,
  options: PagedWalkOptions
): Promise<PagedList<T>> {
  const { pageSize, maxPages, what } = options;
  const items: T[] = [];
  const seenIds = new Set<string>();
  let fetchedEntries = 0; // Raw entries fetched (pre-deduplication)
  let pagesFetched = 0;
  // The first page's sane `totalRows` (null: none); every later page must
  // report the same value
  let expectedTotal: number | null = null;
  let incomplete: ListIncompleteReason | null = null;

  for (let page = 1; ; page++) {
    const query: OpenApiQuery = { page, pageSize };
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (name !== 'page' && name !== 'pageSize') {
        query[name] = value;
      }
    }
    const result = await fetchPage(query, page);
    const pageData = validatePage(result);
    options.onPage?.(result, page);
    pagesFetched = page;
    let newItems = 0;
    for (const entry of pageData.data) {
      const item = validateEntry(entry);
      const id = idOf(item);
      if (seenIds.has(id)) {
        continue; // Deduplicate: keep the first occurrence of each id
      }
      seenIds.add(id);
      items.push(item);
      newItems++;
    } // End of the loop that validates the page's entries
    fetchedEntries += pageData.data.length;

    // Completeness (see the JSDoc): the first page decides whether the
    // walk follows `totalRows` or the short-page rule
    if (page === 1) {
      expectedTotal = pageData.totalRows;
    } else if (pageData.totalRows !== expectedTotal) {
      incomplete = 'totalChanged';
      break;
    }
    const totalReached = expectedTotal !== null && fetchedEntries >= expectedTotal;
    if (pageData.data.length === 0) {
      // The end of a short-page walk, or of an empty listing; before the
      // reported total is reached, a gap
      if (expectedTotal !== null && !totalReached) {
        incomplete = 'emptyPage';
      }
      break;
    }
    if (newItems === 0) {
      incomplete = 'noProgress';
      break;
    }
    if (expectedTotal !== null ? totalReached : pageData.data.length < pageSize) {
      break;
    }
    if (page >= maxPages) {
      incomplete = 'pageCap';
      break;
    }
  } // End of the loop that walks the listing's pages

  if (incomplete !== null) {
    const total = expectedTotal === null ? 'no totalRows' : `totalRows ${expectedTotal}`;
    console.warn(`${options.label} (${what}) incomplete: ${incomplete} after ${pagesFetched} pages (${fetchedEntries} entries fetched, ${total})`);
  }
  return { items, truncated: incomplete !== null };
} // End of function walkPagedListing()

/**
 * Parsed Open API response envelope (`{errorCode, msg, result}`).
 */
interface OpenApiEnvelope {
  errorCode: number;
  msg: string;
  result: unknown;
}

/**
 * Outcome of one authorized call: its result, a token rejection the caller
 * may answer with one re-acquire, or (cloud route only) a rate-limit answer
 * the caller retries after the throttle's backoff.
 */
type CallOutcome =
  | { kind: 'ok'; result: unknown }
  | { kind: 'tokenRejected'; diagnostic: string }
  | { kind: 'rateLimited'; httpStatus?: number; controllerErrorCode?: number };

/**
 * Client for the controller's Open API (see the header). One instance per
 * controller + Open API application (local route) or per cloud controller
 * (cloud route); close() makes it unusable.
 */
export class OpenApiClient {
  readonly route: 'local' | 'cloud';
  // Local: the controller URL. Cloud: `{serverHost}/v1/cloudaccess/{deviceId}`
  readonly baseUrl: string;
  readonly omadacId: string;
  // Local: the Open API application's Client ID. Cloud: '' (the cloud
  // credential's Client ID belongs to CloudAccountClient)
  readonly clientId: string;
  // Secrets and state: private fields, never enumerable or serializable
  readonly #clientSecret: string;
  readonly #transport: OmadaTransport;
  readonly #now: () => number;
  // Cloud route only: the account's token provider and the credential's throttle
  readonly #tokenProvider: CloudTokenProvider | null;
  readonly #throttle: CloudRequestThrottle | null;
  // The errorCodes that mean "token rejected" on this route
  readonly #tokenRejectedCodes: ReadonlySet<number>;
  #token: AccessTokenState | null = null;
  // The single in-flight token acquisition shared by every request
  #acquiring: Promise<AccessTokenState> | null = null;
  // Tokens this client received (newest last), scrubbed from diagnostics;
  // emptied by close()
  #knownTokens: string[] = [];
  #closed = false;

  /**
   * Creates a client. Nothing is sent until the first request.
   * @param {OpenApiClientOptions | CloudOpenApiClientOptions} options - Local:
   *   base URL, controller id, credentials, transport and (tests) clock.
   *   Cloud: the organization's target, the token provider, the throttle and
   *   the transport.
   * @throws {Error} When a required option is missing or, on the cloud
   *   route, the target's serverHost origin is not allowlisted (nothing is
   *   sent then; the message never includes a credential).
   */
  constructor(options: OpenApiClientOptions | CloudOpenApiClientOptions) {
    if (options.route === 'cloud') {
      const target = options.target;
      if (target === null || typeof target !== 'object' || allowlistedCloudOrigin(target.serverOrigin) !== target.serverOrigin) {
        throw new Error('OpenApiClient cloud route needs an allowlisted TP-Link cloud serverHost');
      }
      if (!isOmadacId(target.omadacId) || !isDeviceId(target.deviceId)) {
        throw new Error('OpenApiClient cloud route needs the organization\'s omadacId and deviceId');
      }
      if (!options.tokenProvider || !(options.throttle instanceof CloudRequestThrottle)) {
        throw new Error('OpenApiClient cloud route needs a token provider and a throttle');
      }
      this.route = 'cloud';
      this.baseUrl = `${target.serverOrigin}/v1/cloudaccess/${encodePathSegment(target.deviceId)}`;
      this.omadacId = target.omadacId;
      this.clientId = '';
      this.#clientSecret = '';
      this.#transport = options.transport;
      this.#now = Date.now;
      this.#tokenProvider = options.tokenProvider;
      this.#throttle = options.throttle;
      this.#tokenRejectedCodes = CLOUD_TOKEN_REJECTED_ERROR_CODES;
      return;
    } // End of the cloud-route branch
    if (typeof options.baseUrl !== 'string' || options.baseUrl === '') {
      throw new Error('OpenApiClient needs a base URL');
    }
    if (!isUsableId(options.omadacId)) {
      throw new Error('OpenApiClient needs a controller id');
    }
    if (typeof options.clientId !== 'string' || options.clientId === '') {
      throw new Error('OpenApiClient needs a Client ID');
    }
    if (typeof options.clientSecret !== 'string' || options.clientSecret === '') {
      throw new Error('OpenApiClient needs a Client Secret');
    }
    this.route = 'local';
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.omadacId = options.omadacId;
    this.clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#transport = options.transport;
    this.#now = options.now ?? Date.now;
    this.#tokenProvider = null;
    this.#throttle = null;
    this.#tokenRejectedCodes = TOKEN_REJECTED_ERROR_CODES;
  } // End of constructor

  /**
   * Whether close() was called.
   * @returns {boolean} True once closed.
   */
  get isClosed(): boolean {
    return this.#closed;
  }

  /**
   * Closes the client (idempotent): every bearer-token reference is dropped —
   * the current token, the shared acquisition in flight and the tokens
   * remembered for scrubbing diagnostics — and every later call fails with
   * 'clientClosed'. An operation in flight fails the same way as soon as it
   * resumes, whatever its transport call returned (a response or a failure):
   * nothing it receives is used or cached, and it sends nothing more (no
   * retry, no re-acquire, no next page). Nothing after close needs the
   * remembered tokens: errors raised before close were scrubbed when they
   * were built, and a closed client builds no diagnostic from controller or
   * transport text (the 'clientClosed' error carries fixed text only).
   */
  close(): void {
    this.#closed = true;
    this.#token = null;
    this.#acquiring = null;
    this.#knownTokens = [];
  }

  /**
   * Makes sure the client holds a usable access token, acquiring one (through
   * the shared acquisition) when none is cached or it is about to expire;
   * sends nothing while a cached token is still valid. This is "token
   * acquisition succeeds", check 3 of docs/management-design.md §2.2.
   * @returns {Promise<void>} Resolves once a token is held.
   * @throws {OpenApiError} 'invalidCredentials', 'httpError', 'apiError',
   *   'malformedResponse', 'timeout', 'networkError' or 'clientClosed'.
   */
  async authorize(): Promise<void> {
    this.#assertOpen();
    await this.#currentToken();
    this.#assertOpen();
  }

  /**
   * Sends one Open API call: GET/POST/PATCH/PUT/DELETE on
   * `/openapi/{version}/{omadacId}/{segments…}` with the access token, a JSON
   * body when given, and the extra headers. A token rejection makes it
   * re-acquire once (shared) and retry once. After every await the client
   * must still be open (close() turns the call into 'clientClosed').
   * @param {OpenApiMethod} method - HTTP method.
   * @param {OpenApiVersion} version - API version of this endpoint (explicit).
   * @param {readonly string[]} segments - Path segments after the controller id.
   * @param {OpenApiRequestOptions} [options] - Query, body, extra headers and
   *   the call's own secrets (scrubbed by value from its diagnostics).
   * @returns {Promise<unknown>} The response's `result` (errorCode 0).
   * @throws {OpenApiError} With a stable code (see OpenApiErrorCode).
   */
  async request(method: OpenApiMethod, version: OpenApiVersion, segments: readonly string[], options: OpenApiRequestOptions = {}): Promise<unknown> {
    this.#assertOpen();
    const url = `${this.baseUrl}${openApiPath(version, this.omadacId, segments)}${buildQueryString(options.query)}`;
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const extraHeaders = checkExtraHeaders(options.headers);
    const secrets = (options.secrets ?? []).filter((secret) => typeof secret === 'string' && secret !== '');

    const firstToken = await this.#currentToken();
    const first = await this.#callWithBackoff(method, url, firstToken, body, extraHeaders, secrets);
    this.#assertOpen();
    if (first.kind === 'ok') {
      return first.result;
    }

    // The token was rejected: re-acquire once (shared with every concurrent
    // request) and retry once; a second rejection is final
    const secondToken = await this.#tokenAfterRejection(firstToken);
    const second = await this.#callWithBackoff(method, url, secondToken, body, extraHeaders, secrets);
    this.#assertOpen();
    if (second.kind === 'ok') {
      return second.result;
    }
    throw new OpenApiError('tokenRejected', `token rejected again after re-acquiring (${second.diagnostic})`);
  } // End of function request()

  /**
   * Walks every page of a paged Open API listing (`page` from 1, `pageSize`)
   * with walkPagedListing(): each entry validated, deduplicated by id (the
   * first occurrence is kept), `truncated` false only when the walk PROVED
   * the listing complete (the completeness rules — a sane `totalRows`
   * followed past short pages; 'emptyPage', 'totalChanged', 'noProgress',
   * 'pageCap' — are documented there). At most `maxPages` requests, never a
   * loop; once the client is closed, no page is used and no next one asked.
   * @param {OpenApiVersion} version - API version of this endpoint (explicit).
   * @param {readonly string[]} segments - Path segments after the controller id.
   * @param {(entry: unknown) => T} validateEntry - Validates one entry (throws OpenApiError).
   * @param {(item: T) => string} idOf - The id to deduplicate by.
   * @param {OpenApiListOptions} [options] - Page size, page cap, extra query.
   * @returns {Promise<PagedList<T>>} The items, in response order, and whether
   *   the listing may be incomplete (`truncated`).
   * @throws {OpenApiError} From request() or the validators.
   */
  async listAll<T>(
    version: OpenApiVersion,
    segments: readonly string[],
    validateEntry: (entry: unknown) => T,
    idOf: (item: T) => string,
    options: OpenApiListOptions = {}
  ): Promise<PagedList<T>> {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const maxPages = options.maxPages ?? MAX_PAGES;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new Error(`Open API page size must be an integer from 1 to ${MAX_PAGE_SIZE}`);
    }
    if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
      throw new Error('Open API page cap must be a positive integer');
    }
    const what = segments[segments.length - 1] ?? 'list';
    return walkPagedListing(
      async (query) => {
        const result = await this.request('GET', version, segments, { query });
        // Closed meanwhile: neither this page nor a next one is used
        this.#assertOpen();
        return result;
      },
      (result) => validateOpenApiPage(result, what),
      validateEntry,
      idOf,
      { pageSize, maxPages, query: options.query, what, label: 'Open API listing', onPage: options.onPage }
    );
  } // End of function listAll()

  /**
   * Lists the sites the Open API application can see (v1, paged). A
   * `truncated` (possibly incomplete, see listAll()) list still proves that
   * the sites it holds are visible, so ControllerSession uses the flag only
   * in its 'siteNotFound' diagnostic (a site missing from it fails the check).
   * @returns {Promise<PagedList<OpenApiSite>>} The sites.
   * @throws {OpenApiError} On any failure.
   */
  listSites(): Promise<PagedList<OpenApiSite>> {
    return this.listAll('v1', ['sites'], validateOpenApiSite, (site) => site.id);
  }

  /**
   * Lists the AP groups of one site (`GET /openapi/v1/{omadacId}/sites/{siteId}/ap-groups`,
   * paged), with `apNum`, `ssidNameList` and `remainingBinding` when reported,
   * plus the per-group SSID limits of the first page. A `truncated` list
   * (possibly incomplete, see listAll()) is refused by every caller:
   * 'apGroupsMismatch' in the capability check, 'groupListIncomplete' for the
   * managed list and before any AP-group write (ControllerSession).
   * @param {string} siteId - The site id (percent-encoded into the path).
   * @returns {Promise<OpenApiApGroupList>} The AP groups and the limits.
   * @throws {OpenApiError} On any failure; Error on an unusable site id.
   */
  async listApGroups(siteId: string): Promise<OpenApiApGroupList> {
    if (!isUsableId(siteId)) {
      throw new Error('Invalid site id');
    }
    let limits: OpenApiApGroupLimits = {};
    const list = await this.listAll('v1', ['sites', siteId, 'ap-groups'], validateOpenApiApGroup, (group) => group.id, {
      onPage: (result, page) => {
        if (page === 1) {
          limits = validateApGroupLimits(result);
        }
      }
    });
    return { ...list, limits };
  } // End of function listApGroups()

  /**
   * Creates an empty AP group: `POST /openapi/v1/{omadacId}/sites/{siteId}/ap-groups`
   * with exactly the body `{name}` (the optional `apMacs` is not sent: the
   * group starts empty and APs are moved in through the internal move path).
   * Callers (ControllerSession) validate the name and the app policy first.
   * Unverified live (phase 20): that the body without `apMacs` is accepted,
   * and that `result.id` is the new group's id (the same value the internal
   * setting/wlans list reports).
   * @param {string} siteId - The site id.
   * @param {string} name - The validated, trimmed name.
   * @returns {Promise<string | null>} The new group's id, or null when the
   *   answer carries no usable id (see validateCreatedApGroup()).
   * @throws {OpenApiError} On any failure (an errorCode such as -33200 / -33201
   *   is an 'apiError' carrying it); Error on an unusable argument.
   */
  async createApGroup(siteId: string, name: string): Promise<string | null> {
    if (!isUsableId(siteId) || !isSaneApGroupName(name)) {
      throw new Error('Invalid AP group create arguments');
    }
    const result = await this.request('POST', 'v1', ['sites', siteId, 'ap-groups'], { body: { name } });
    return validateCreatedApGroup(result);
  }

  /**
   * Renames an AP group: `PATCH /openapi/v1/{omadacId}/sites/{siteId}/ap-groups/{apGroupId}`
   * with exactly the body `{name}` (the ops doc requires only `name`;
   * `addApMacs` / `removeApMacs` are optional and not sent, so no read-merge-
   * write is needed). The answer carries no result: errorCode 0 is the
   * confirmation. Unverified live (phase 20): that omitting the two AP lists
   * leaves the group's APs untouched.
   * @param {string} siteId - The site id.
   * @param {string} apGroupId - The group id.
   * @param {string} name - The validated, trimmed new name.
   * @returns {Promise<void>} Resolves once the controller confirmed it.
   * @throws {OpenApiError} On any failure (-33200 is an 'apiError' carrying it);
   *   Error on an unusable argument.
   */
  async renameApGroup(siteId: string, apGroupId: string, name: string): Promise<void> {
    if (!isUsableId(siteId) || !isUsableId(apGroupId) || !isSaneApGroupName(name)) {
      throw new Error('Invalid AP group rename arguments');
    }
    await this.request('PATCH', 'v1', ['sites', siteId, 'ap-groups', apGroupId], { body: { name } });
  }

  /**
   * Deletes an AP group: `DELETE /openapi/v1/{omadacId}/sites/{siteId}/ap-groups/{apGroupId}`,
   * no body. Callers (ControllerSession) re-check the app's delete policy on
   * fresh data right before. The answer carries no result: errorCode 0 is the
   * confirmation.
   * @param {string} siteId - The site id.
   * @param {string} apGroupId - The group id.
   * @returns {Promise<void>} Resolves once the controller confirmed it.
   * @throws {OpenApiError} On any failure (-33203, the default group, is an
   *   'apiError' carrying it); Error on an unusable argument.
   */
  async deleteApGroup(siteId: string, apGroupId: string): Promise<void> {
    if (!isUsableId(siteId) || !isUsableId(apGroupId)) {
      throw new Error('Invalid AP group delete arguments');
    }
    await this.request('DELETE', 'v1', ['sites', siteId, 'ap-groups', apGroupId]);
  }

  /**
   * Lists the Wi-Fi networks of one site: the paged v2 catalog
   * `GET /openapi/v2/{omadacId}/sites/{siteId}/wireless-network/ssids?page&pageSize`
   * (listAll(): ⌈N / page size⌉ GET requests — the page size is
   * DEFAULT_PAGE_SIZE, or the smaller one a controller caps it to —, at
   * least 1, at most MAX_PAGES; deduplicated by id). Each entry is validated
   * by validateOpenApiSsid(): one malformed entry rejects the whole listing.
   * A possibly incomplete catalog comes back `truncated` (see listAll());
   * ControllerSession refuses it with the explicit error
   * 'networkListIncomplete', and a complete one over MAX_MANAGED_NETWORKS too
   * — never a shorter list.
   * @param {string} siteId - The site id.
   * @returns {Promise<PagedList<OpenApiSsid>>} The validated entries and the truncation flag.
   * @throws {OpenApiError} On any failure ('malformedResponse' for a garbage
   *   page or entry); Error on an unusable site id.
   */
  async listSsids(siteId: string): Promise<PagedList<OpenApiSsid>> {
    if (!isUsableId(siteId)) {
      throw new Error('Invalid site id');
    }
    return this.listAll(
      'v2',
      ['sites', siteId, 'wireless-network', 'ssids'],
      /**
       * Validates one catalog entry (one malformed entry rejects the listing).
       * @param {unknown} entry - The raw entry.
       * @returns {OpenApiSsid} The validated entry.
       */
      (entry) => {
        const ssid = validateOpenApiSsid(entry);
        if (ssid === null) {
          throw malformed('ssids');
        }
        return ssid;
      },
      (ssid) => ssid.id
    );
  } // End of function listSsids()

  /**
   * Reads one network's detail: exactly one
   * `GET /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}`,
   * validated by validateOpenApiSsidDetail() (the answer must name this SSID;
   * of the passphrase only "a key is reported" is kept).
   * @param {string} siteId - The site id.
   * @param {string} ssidId - The SSID id (from the catalog).
   * @returns {Promise<OpenApiSsidDetail>} The validated detail.
   * @throws {OpenApiError} On any failure ('malformedResponse' for an answer
   *   the validator rejects); Error on an unusable argument.
   */
  async getSsidDetail(siteId: string, ssidId: string): Promise<OpenApiSsidDetail> {
    if (!isUsableId(siteId) || !isSsidId(ssidId)) {
      throw new Error('Invalid SSID detail arguments');
    }
    const result = await this.request('GET', 'v1', ['sites', siteId, 'wireless-network', 'ssids', ssidId]);
    const detail = validateOpenApiSsidDetail(result, ssidId);
    if (detail === null) {
      throw malformed('ssid detail');
    }
    return detail;
  } // End of function getSsidDetail()

  /**
   * Reads the AP groups one network is bound to: exactly one
   * `GET /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}/ap-groups`,
   * validated by validateSsidBindings() (only the group ids are kept).
   * @param {string} siteId - The site id.
   * @param {string} ssidId - The SSID id (from the catalog).
   * @returns {Promise<OpenApiSsidBindings>} The validated bindings.
   * @throws {OpenApiError} On any failure ('malformedResponse' for a non-array
   *   or mixed `apGroups` list); Error on an unusable argument.
   */
  async getSsidApGroups(siteId: string, ssidId: string): Promise<OpenApiSsidBindings> {
    if (!isUsableId(siteId) || !isSsidId(ssidId)) {
      throw new Error('Invalid SSID bindings arguments');
    }
    const result = await this.request('GET', 'v1', ['sites', siteId, 'wireless-network', 'ssids', ssidId, 'ap-groups']);
    const bindings = validateSsidBindings(result);
    if (bindings === null) {
      throw malformed('ssid ap-groups');
    }
    return bindings;
  } // End of function getSsidApGroups()

  /**
   * Reads one network's detail for a write: exactly one
   * `GET /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}`
   * (the same call as getSsidDetail()). The answer must pass
   * validateOpenApiSsidDetail() (a plain object naming this SSID); besides
   * the validated detail, the `result` object is returned as the controller
   * sent it (see OpenApiSsidWriteDetail: main memory only).
   * @param {string} siteId - The site id.
   * @param {string} ssidId - The SSID id.
   * @returns {Promise<OpenApiSsidWriteDetail>} The validated and the raw detail.
   * @throws {OpenApiError} On any failure ('malformedResponse' for an answer
   *   the validator rejects); Error on an unusable argument.
   */
  async getSsidWriteDetail(siteId: string, ssidId: string): Promise<OpenApiSsidWriteDetail> {
    if (!isUsableId(siteId) || !isSsidId(ssidId)) {
      throw new Error('Invalid SSID detail arguments');
    }
    const result = await this.request('GET', 'v1', ['sites', siteId, 'wireless-network', 'ssids', ssidId]);
    const detail = validateOpenApiSsidDetail(result, ssidId);
    if (detail === null) {
      throw malformed('ssid detail');
    }
    return { detail, raw: result as Record<string, unknown> };
  } // End of function getSsidWriteDetail()

  /**
   * Creates a Wi-Fi network: `POST /openapi/v2/{omadacId}/sites/{siteId}/wireless-network/ssids`
   * with exactly the given body (buildCreateSsidBody() of
   * wifi-network-write.ts; sanity-checked by isSaneSsidWriteBody(): open or
   * WPA-Personal only). The body's passphrase is scrubbed by value from every
   * diagnostic of the call. Unverified live (phase 20): the body shape and
   * that `result.id` is the new network's id.
   * @param {string} siteId - The site id.
   * @param {Record<string, unknown>} body - The create body.
   * @returns {Promise<string | null>} The new network's id, or null when the
   *   answer carries no usable id (see validateCreatedSsid()).
   * @throws {OpenApiError} On any failure (a documented errorCode such as
   *   -33219 is an 'apiError' carrying it); Error on an unusable argument.
   */
  async createSsid(siteId: string, body: Record<string, unknown>): Promise<string | null> {
    if (!isUsableId(siteId) || !isSaneSsidWriteBody(body)) {
      throw new Error('Invalid SSID create arguments');
    }
    const result = await this.request('POST', 'v2', ['sites', siteId, 'wireless-network', 'ssids'], { body, secrets: ssidBodySecrets(body) });
    return validateCreatedSsid(result);
  } // End of function createSsid()

  /**
   * Saves a network's basic settings: `PATCH /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}/basic-config`
   * with exactly the given full body (mergeBasicConfig() of
   * wifi-network-write.ts, sanity-checked by isSaneSsidWriteBody()). The
   * body's passphrase is scrubbed by value from every diagnostic of the
   * call. The answer carries no result: errorCode 0 is the confirmation.
   * @param {string} siteId - The site id.
   * @param {string} ssidId - The SSID id.
   * @param {Record<string, unknown>} body - The merged basic-config body.
   * @returns {Promise<void>} Resolves once the controller confirmed it.
   * @throws {OpenApiError} On any failure; Error on an unusable argument.
   */
  async updateSsidBasicConfig(siteId: string, ssidId: string, body: Record<string, unknown>): Promise<void> {
    if (!isUsableId(siteId) || !isSsidId(ssidId) || !isSaneSsidWriteBody(body)) {
      throw new Error('Invalid SSID basic-config arguments');
    }
    await this.request('PATCH', 'v1', ['sites', siteId, 'wireless-network', 'ssids', ssidId, 'basic-config'], {
      body,
      secrets: ssidBodySecrets(body)
    });
  } // End of function updateSsidBasicConfig()

  /**
   * Enables or disables a network: `PATCH /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}/enable`
   * with exactly `{ssidEnable}` (no passphrase needed). The answer carries no
   * result: errorCode 0 is the confirmation.
   * @param {string} siteId - The site id.
   * @param {string} ssidId - The SSID id.
   * @param {boolean} enabled - The new enable state.
   * @returns {Promise<void>} Resolves once the controller confirmed it.
   * @throws {OpenApiError} On any failure; Error on an unusable argument.
   */
  async setSsidEnabled(siteId: string, ssidId: string, enabled: boolean): Promise<void> {
    if (!isUsableId(siteId) || !isSsidId(ssidId) || typeof enabled !== 'boolean') {
      throw new Error('Invalid SSID enable arguments');
    }
    await this.request('PATCH', 'v1', ['sites', siteId, 'wireless-network', 'ssids', ssidId, 'enable'], { body: buildEnableBody(enabled) });
  }

  /**
   * Deletes a network: `DELETE /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}`,
   * no body. The answer carries no result: errorCode 0 is the confirmation.
   * Unverified live (phase 20): what the controller does with a network
   * still bound to AP groups.
   * @param {string} siteId - The site id.
   * @param {string} ssidId - The SSID id.
   * @returns {Promise<void>} Resolves once the controller confirmed it.
   * @throws {OpenApiError} On any failure; Error on an unusable argument.
   */
  async deleteSsid(siteId: string, ssidId: string): Promise<void> {
    if (!isUsableId(siteId) || !isSsidId(ssidId)) {
      throw new Error('Invalid SSID delete arguments');
    }
    await this.request('DELETE', 'v1', ['sites', siteId, 'wireless-network', 'ssids', ssidId]);
  }

  /**
   * Replaces the AP groups a network is bound to: `PATCH /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}/ap-groups`
   * with exactly `{apGroupIds}` (buildBindingsBody() of network-binding-plan.ts;
   * the ops doc's only, required field) — the complete new set, never empty.
   * The answer carries no result: errorCode 0 is the confirmation. Callers
   * (ControllerSession) plan the change on fresh data first. Unverified live
   * (phase 20): that the set replaces the bindings (not merged), that
   * `chooseDevices` stays 1, and which errorCode a group without room answers
   * (the ops doc lists only -33000).
   * @param {string} siteId - The site id.
   * @param {string} ssidId - The SSID id.
   * @param {readonly string[]} apGroupIds - The planned ids (distinct, 24 hex digits, at least one).
   * @returns {Promise<void>} Resolves once the controller confirmed it.
   * @throws {OpenApiError} On any failure (-33000 is an 'apiError' carrying it);
   *   Error on an unusable argument.
   */
  async updateSsidApGroups(siteId: string, ssidId: string, apGroupIds: readonly string[]): Promise<void> {
    if (!isUsableId(siteId) || !isSsidId(ssidId) || !isSaneBindingIds(apGroupIds)) {
      throw new Error('Invalid SSID bindings update arguments');
    }
    await this.request('PATCH', 'v1', ['sites', siteId, 'wireless-network', 'ssids', ssidId, 'ap-groups'], { body: buildBindingsBody(apGroupIds) });
  }

  /**
   * Throws 'clientClosed' once close() was called.
   */
  #assertOpen(): void {
    if (this.#closed) {
      throw new OpenApiError('clientClosed', 'the Open API client was closed');
    }
  }

  /**
   * Returns a usable access token: the cached one while it is not (about to
   * be) expired, otherwise a fresh one from the shared acquisition. On the
   * cloud route: the token provider's account token.
   * @returns {Promise<string>} The access token.
   */
  async #currentToken(): Promise<string> {
    if (this.#tokenProvider !== null) {
      const provider = this.#tokenProvider;
      return this.#providerToken(() => provider.getAccessToken());
    }
    const token = this.#token;
    if (token !== null && this.#now() < token.renewAt) {
      return token.accessToken;
    }
    return (await this.#sharedAcquire()).accessToken;
  }

  /**
   * Cloud route: runs one token-provider call and checks its answer; a
   * CloudAccountError becomes the OpenApiError of the same meaning
   * (CLOUD_TOKEN_ERROR_CODES), anything else 'networkError' with a scrubbed
   * message. The token is remembered for scrubbing.
   * @param {() => Promise<string>} getToken - The provider call.
   * @returns {Promise<string>} The token.
   * @throws {OpenApiError} On any failure, or 'clientClosed' once closed.
   */
  async #providerToken(getToken: () => Promise<string>): Promise<string> {
    this.#assertOpen();
    let token: string;
    try {
      token = await getToken();
    } catch (error) {
      this.#assertOpen();
      if (error instanceof CloudAccountError) {
        throw new OpenApiError(CLOUD_TOKEN_ERROR_CODES[error.code], `cloud token: ${error.diagnostic}`, {
          httpStatus: error.httpStatus ?? undefined,
          controllerErrorCode: error.apiErrorCode ?? undefined
        });
      }
      throw new OpenApiError('networkError', this.#scrub(`cloud token: ${error instanceof Error ? error.message : String(error)}`));
    }
    this.#assertOpen();
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH || !TOKEN_REGEX.test(token)) {
      throw malformed('cloud token');
    }
    this.#rememberToken(token);
    return token;
  } // End of function #providerToken()

  /**
   * Returns the token to retry with after `rejectedToken` was rejected: a
   * newer token another request already obtained, else the result of the
   * shared acquisition (started here, or joined when one is in flight). On
   * the cloud route the token provider decides (CloudAccountClient: the same
   * rules over the account token).
   * @param {string} rejectedToken - The token the controller rejected.
   * @returns {Promise<string>} The token for the single retry.
   */
  async #tokenAfterRejection(rejectedToken: string): Promise<string> {
    this.#assertOpen();
    if (this.#tokenProvider !== null) {
      const provider = this.#tokenProvider;
      return this.#providerToken(() => provider.renewAccessToken(rejectedToken));
    }
    const token = this.#token;
    if (token !== null && token.accessToken !== rejectedToken && this.#now() < token.renewAt) {
      return token.accessToken;
    }
    if (token !== null && token.accessToken === rejectedToken) {
      this.#token = null;
    }
    return (await this.#sharedAcquire()).accessToken;
  } // End of function #tokenAfterRejection()

  /**
   * Starts (or joins) the single in-flight token acquisition. A closed client
   * neither starts nor joins one.
   * @returns {Promise<AccessTokenState>} The acquired token.
   * @throws {OpenApiError} 'clientClosed' once close() was called.
   */
  #sharedAcquire(): Promise<AccessTokenState> {
    this.#assertOpen();
    if (this.#acquiring === null) {
      const acquiring = this.#acquire().finally(() => {
        // Allow a later expiry or rejection to start a fresh acquisition
        if (this.#acquiring === acquiring) {
          this.#acquiring = null;
        }
      });
      this.#acquiring = acquiring;
    }
    return this.#acquiring;
  } // End of function #sharedAcquire()

  /**
   * Acquires a token with the client credentials (only through
   * #sharedAcquire()). The request carries no Authorization header.
   * @returns {Promise<AccessTokenState>} The validated token (also cached).
   * @throws {OpenApiError} 'invalidCredentials', 'httpError', 'apiError',
   *   'malformedResponse', 'timeout', 'networkError' or 'clientClosed'.
   */
  async #acquire(): Promise<AccessTokenState> {
    this.#assertOpen();
    const response = await this.#send({
      method: 'POST',
      url: `${this.baseUrl}${TOKEN_PATH}`,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ omadacId: this.omadacId, client_id: this.clientId, client_secret: this.#clientSecret })
    });
    this.#assertOpen();

    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new OpenApiError('invalidCredentials', `token request refused (HTTP ${response.statusCode})`, { httpStatus: response.statusCode });
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw this.#httpError(response);
    }
    const envelope = this.#parseEnvelope(response.body);
    if (envelope.errorCode !== 0) {
      const code = INVALID_CLIENT_ERROR_CODES.has(envelope.errorCode) ? 'invalidCredentials' : 'apiError';
      throw new OpenApiError(code, this.#envelopeDiagnostic('token request failed', envelope), { controllerErrorCode: envelope.errorCode });
    }
    const token = validateTokenResult(envelope.result, this.#now());
    this.#rememberToken(token.accessToken);
    this.#token = token;
    return token;
  } // End of function #acquire()

  /**
   * Sends one authorized call through #call(); on the cloud route a
   * rate-limit answer holds the credential's throttle back
   * (CloudRequestThrottle.rateLimited()) and the call is sent again, at most
   * CLOUD_RATE_LIMIT_MAX_RETRIES times, then fails as 'rateLimited'. Any other
   * answer resets the backoff. The local route never sees a rate-limit
   * outcome, so it sends exactly once.
   * @param {OpenApiMethod} method - HTTP method.
   * @param {string} url - Absolute URL.
   * @param {string} token - The access token to send.
   * @param {string | undefined} body - Serialized JSON body.
   * @param {Record<string, string>} extraHeaders - Checked extra headers.
   * @param {readonly string[]} secrets - The call's own secrets (scrubbed by value).
   * @returns {Promise<CallOutcome>} The result or a token rejection.
   * @throws {OpenApiError} 'rateLimited', or what #call() throws.
   */
  async #callWithBackoff(
    method: OpenApiMethod,
    url: string,
    token: string,
    body: string | undefined,
    extraHeaders: Record<string, string>,
    secrets: readonly string[]
  ): Promise<Exclude<CallOutcome, { kind: 'rateLimited' }>> {
    for (let attempt = 0; ; attempt++) {
      const outcome = await this.#call(method, url, token, body, extraHeaders, secrets);
      this.#assertOpen();
      if (outcome.kind !== 'rateLimited') {
        this.#throttle?.succeeded();
        return outcome;
      }
      if (this.#throttle === null || attempt >= CLOUD_RATE_LIMIT_MAX_RETRIES) {
        const status = outcome.httpStatus !== undefined ? `HTTP ${outcome.httpStatus}` : `errorCode ${outcome.controllerErrorCode}`;
        throw new OpenApiError('rateLimited', `${method} request rate-limited (${status}) after ${attempt} retries`, {
          httpStatus: outcome.httpStatus,
          controllerErrorCode: outcome.controllerErrorCode
        });
      }
      this.#throttle.rateLimited();
    } // End of the loop that retries a rate-limited call
  } // End of function #callWithBackoff()

  /**
   * Sends one authorized call and classifies the response.
   * @param {OpenApiMethod} method - HTTP method.
   * @param {string} url - Absolute URL.
   * @param {string} token - The access token to send.
   * @param {string | undefined} body - Serialized JSON body.
   * @param {Record<string, string>} extraHeaders - Checked extra headers.
   * @param {readonly string[]} secrets - The call's own secrets (scrubbed by value).
   * @returns {Promise<CallOutcome>} The result, or a token rejection.
   * @throws {OpenApiError} On every other failure.
   */
  async #call(
    method: OpenApiMethod,
    url: string,
    token: string,
    body: string | undefined,
    extraHeaders: Record<string, string>,
    secrets: readonly string[]
  ): Promise<CallOutcome> {
    this.#assertOpen();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    Object.assign(headers, extraHeaders);
    headers.Authorization = `AccessToken=${token}`;

    const response = await this.#send({ method, url, headers, body }, secrets);
    this.#assertOpen();

    if (response.statusCode === 401) {
      return { kind: 'tokenRejected', diagnostic: 'HTTP 401' };
    }
    const cloud = this.route === 'cloud';
    if (cloud && response.statusCode === 429) {
      return { kind: 'rateLimited', httpStatus: 429 };
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw this.#httpError(response, secrets);
    }
    const envelope = this.#parseEnvelope(response.body);
    if (this.#tokenRejectedCodes.has(envelope.errorCode)) {
      return { kind: 'tokenRejected', diagnostic: `errorCode ${envelope.errorCode}` };
    }
    if (cloud && envelope.errorCode === CLOUD_RATE_LIMIT_ERROR_CODE) {
      return { kind: 'rateLimited', controllerErrorCode: envelope.errorCode };
    }
    if (envelope.errorCode !== 0) {
      throw new OpenApiError('apiError', this.#envelopeDiagnostic(`${method} request failed`, envelope, secrets), {
        controllerErrorCode: envelope.errorCode
      });
    }
    return { kind: 'ok', result: envelope.result };
  } // End of function #call()

  /**
   * Sends a request through the transport, turning transport failures into
   * 'timeout' / 'networkError' with a scrubbed diagnostic — or into
   * 'clientClosed' when the client was closed meanwhile: the failure text is
   * then never surfaced (the remembered tokens it would be scrubbed against
   * are gone).
   * @param {OmadaHttpRequest} request - The request.
   * @param {readonly string[]} [secrets] - The call's own secrets (scrubbed by value).
   * @returns {Promise<OmadaHttpResponse>} Status and raw body.
   * @throws {OpenApiError} 'timeout', 'networkError' or 'clientClosed'.
   */
  async #send(request: OmadaHttpRequest, secrets: readonly string[] = []): Promise<OmadaHttpResponse> {
    if (this.#throttle !== null) {
      // Cloud route: one slot of the credential's shared rate limit per request
      await this.#throttle.acquire();
      this.#assertOpen();
    }
    try {
      // The Open API is token-authenticated: response cookies are ignored
      return await this.#transport.send(request, () => undefined);
    } catch (error) {
      this.#assertOpen();
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Request timeout')) {
        throw new OpenApiError('timeout', this.#scrub(message, secrets));
      }
      throw new OpenApiError('networkError', this.#scrub(message, secrets));
    }
  } // End of function #send()

  /**
   * Parses a 2xx body into the Open API envelope.
   * @param {string} body - Raw body.
   * @returns {OpenApiEnvelope} The envelope.
   * @throws {OpenApiError} 'malformedResponse' on invalid JSON or a missing
   *   integer errorCode (the body itself is never quoted).
   */
  #parseEnvelope(body: string): OpenApiEnvelope {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new OpenApiError('malformedResponse', 'invalid JSON response');
    }
    if (parsed === null || typeof parsed !== 'object' || !Number.isSafeInteger((parsed as Record<string, unknown>).errorCode)) {
      throw new OpenApiError('malformedResponse', 'response without an errorCode');
    }
    const raw = parsed as Record<string, unknown>;
    return { errorCode: raw.errorCode as number, msg: typeof raw.msg === 'string' ? raw.msg : '', result: raw.result };
  } // End of function #parseEnvelope()

  /**
   * Builds the 'httpError' for a non-2xx response: the status, plus the
   * controller's errorCode and scrubbed message when the body is an Open API
   * envelope (never the raw body).
   * @param {OmadaHttpResponse} response - The response.
   * @param {readonly string[]} [secrets] - The call's own secrets (scrubbed by value).
   * @returns {OpenApiError} The error.
   */
  #httpError(response: OmadaHttpResponse, secrets: readonly string[] = []): OpenApiError {
    let diagnostic = `HTTP ${response.statusCode}`;
    let controllerErrorCode: number | undefined;
    try {
      const parsed = JSON.parse(response.body) as Record<string, unknown>;
      if (parsed !== null && typeof parsed === 'object' && Number.isSafeInteger(parsed.errorCode)) {
        controllerErrorCode = parsed.errorCode as number;
        diagnostic = this.#envelopeDiagnostic(
          diagnostic,
          {
            errorCode: controllerErrorCode,
            msg: typeof parsed.msg === 'string' ? parsed.msg : '',
            result: undefined
          },
          secrets
        );
      }
    } catch {
      // Not JSON (e.g. an HTML error page): the status alone
    }
    return new OpenApiError('httpError', diagnostic, { httpStatus: response.statusCode, controllerErrorCode });
  } // End of function #httpError()

  /**
   * Formats "<context>: errorCode <n> (<msg>)" with the message scrubbed.
   * @param {string} context - What failed.
   * @param {OpenApiEnvelope} envelope - The parsed envelope.
   * @param {readonly string[]} [secrets] - The call's own secrets (scrubbed by value).
   * @returns {string} The diagnostic.
   */
  #envelopeDiagnostic(context: string, envelope: OpenApiEnvelope, secrets: readonly string[] = []): string {
    const message = envelope.msg ? ` (${this.#scrub(envelope.msg, secrets)})` : '';
    return `${context}: errorCode ${envelope.errorCode}${message}`;
  }

  /**
   * Redacts a diagnostic text, also removing this client's Client Secret,
   * every token it received and the call's own secrets by value, and cuts it
   * to MAX_DIAGNOSTIC_CHARS.
   * @param {string} text - The raw text.
   * @param {readonly string[]} [secrets] - The call's own secrets (e.g. a passphrase).
   * @returns {string} The sanitized text.
   */
  #scrub(text: string, secrets: readonly string[] = []): string {
    return redactText(text, [this.#clientSecret, ...this.#knownTokens, ...secrets]).slice(0, MAX_DIAGNOSTIC_CHARS);
  }

  /**
   * Remembers a received token so diagnostics can scrub it by value.
   * @param {string} accessToken - The token.
   */
  #rememberToken(accessToken: string): void {
    if (this.#knownTokens.includes(accessToken)) {
      return; // The cloud route hands the same account token out repeatedly
    }
    this.#knownTokens.push(accessToken);
    if (this.#knownTokens.length > MAX_REMEMBERED_TOKENS) {
      this.#knownTokens.shift();
    }
  }
} // End of class OpenApiClient
