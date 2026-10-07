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
// - Errors: OpenApiError with a stable `code` and a sanitized diagnostic
//   (redact.ts plus the client's own secret and tokens scrubbed by value);
//   never a raw request or response body, the Client Secret or a token.
// - The Client Secret and the token are private class fields (#…): they are
//   not enumerable, so JSON.stringify() and util.inspect() never show them.

import { MAX_AP_GROUP_NAME_LENGTH } from './ap-group-policy';
import { HttpMethod, OmadaHttpRequest, OmadaHttpResponse, OmadaTransport } from './omada-transport';
import { redactText } from './redact';

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
 * - 'clientClosed': the client was closed (close()) before or during the call.
 */
export type OpenApiErrorCode =
  | 'invalidCredentials'
  | 'tokenRejected'
  | 'httpError'
  | 'timeout'
  | 'networkError'
  | 'apiError'
  | 'malformedResponse'
  | 'clientClosed';

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

// Pagination (spec: `page` from 1, `pageSize` 1–1000). The walk stops on a
// short page, on reaching `totalRows`, or defensively at MAX_PAGES (like the
// internal client's site listing), and deduplicates entries by id
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

/** The result of a paginated listing: deduplicated items and whether the page cap cut it. */
export interface PagedList<T> {
  items: T[];
  truncated: boolean;
}

/** One validated page of an Open API listing (`result` of a paged call). */
export interface OpenApiPage {
  data: unknown[];
  // `totalRows`, or null when absent or not a sane non-negative number
  totalRows: number | null;
}

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

/** Constructor options of OpenApiClient. */
export interface OpenApiClientOptions {
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
 * non-negative number.
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
  const totalRows = typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal >= 0 ? rawTotal : null;
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
 * Parsed Open API response envelope (`{errorCode, msg, result}`).
 */
interface OpenApiEnvelope {
  errorCode: number;
  msg: string;
  result: unknown;
}

/**
 * Outcome of one authorized call: its result, or a token rejection the
 * caller may answer with one re-acquire.
 */
type CallOutcome = { kind: 'ok'; result: unknown } | { kind: 'tokenRejected'; diagnostic: string };

/**
 * Client for the controller's Open API (see the header). One instance per
 * controller + Open API application; close() makes it unusable.
 */
export class OpenApiClient {
  readonly baseUrl: string;
  readonly omadacId: string;
  readonly clientId: string;
  // Secrets and state: private fields, never enumerable or serializable
  readonly #clientSecret: string;
  readonly #transport: OmadaTransport;
  readonly #now: () => number;
  #token: AccessTokenState | null = null;
  // The single in-flight token acquisition shared by every request
  #acquiring: Promise<AccessTokenState> | null = null;
  // Tokens this client received (newest last), scrubbed from diagnostics;
  // emptied by close()
  #knownTokens: string[] = [];
  #closed = false;

  /**
   * Creates a client. Nothing is sent until the first request.
   * @param {OpenApiClientOptions} options - Base URL, controller id,
   *   credentials, transport and (tests) clock.
   * @throws {Error} When a required option is missing (the message never
   *   includes a credential).
   */
  constructor(options: OpenApiClientOptions) {
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
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.omadacId = options.omadacId;
    this.clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#transport = options.transport;
    this.#now = options.now ?? Date.now;
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
   * @param {OpenApiRequestOptions} [options] - Query, body and extra headers.
   * @returns {Promise<unknown>} The response's `result` (errorCode 0).
   * @throws {OpenApiError} With a stable code (see OpenApiErrorCode).
   */
  async request(method: OpenApiMethod, version: OpenApiVersion, segments: readonly string[], options: OpenApiRequestOptions = {}): Promise<unknown> {
    this.#assertOpen();
    const url = `${this.baseUrl}${openApiPath(version, this.omadacId, segments)}${buildQueryString(options.query)}`;
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const extraHeaders = checkExtraHeaders(options.headers);

    const firstToken = await this.#currentToken();
    const first = await this.#call(method, url, firstToken, body, extraHeaders);
    this.#assertOpen();
    if (first.kind === 'ok') {
      return first.result;
    }

    // The token was rejected: re-acquire once (shared with every concurrent
    // request) and retry once; a second rejection is final
    const secondToken = await this.#tokenAfterRejection(firstToken);
    const second = await this.#call(method, url, secondToken, body, extraHeaders);
    this.#assertOpen();
    if (second.kind === 'ok') {
      return second.result;
    }
    throw new OpenApiError('tokenRejected', `token rejected again after re-acquiring (${second.diagnostic})`);
  } // End of function request()

  /**
   * Walks every page of a paged Open API listing (`page` from 1, `pageSize`),
   * validating each entry and deduplicating by id. Stops on a short page, on
   * reaching `totalRows`, or at the page cap (then `truncated` is true and a
   * warning is logged).
   * @param {OpenApiVersion} version - API version of this endpoint (explicit).
   * @param {readonly string[]} segments - Path segments after the controller id.
   * @param {(entry: unknown) => T} validateEntry - Validates one entry (throws OpenApiError).
   * @param {(item: T) => string} idOf - The id to deduplicate by.
   * @param {OpenApiListOptions} [options] - Page size, page cap, extra query.
   * @returns {Promise<PagedList<T>>} The items, in response order, and the truncation flag.
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
    const items: T[] = [];
    const seenIds = new Set<string>();
    let fetchedEntries = 0; // Raw entries fetched (pre-deduplication)
    let truncated = false;

    for (let page = 1; ; page++) {
      const query: OpenApiQuery = { page, pageSize };
      for (const [name, value] of Object.entries(options.query ?? {})) {
        if (name !== 'page' && name !== 'pageSize') {
          query[name] = value;
        }
      }
      const result = await this.request('GET', version, segments, { query });
      // Closed meanwhile: neither this page nor a next one is used
      this.#assertOpen();
      const pageData = validateOpenApiPage(result, what);
      options.onPage?.(result, page);
      for (const entry of pageData.data) {
        const item = validateEntry(entry);
        const id = idOf(item);
        if (seenIds.has(id)) {
          continue; // Deduplicate: keep the first occurrence of each id
        }
        seenIds.add(id);
        items.push(item);
      } // End of the loop that validates the page's entries
      fetchedEntries += pageData.data.length;

      // A short (or empty) page, or reaching the reported total, ends the
      // walk; the total is compared with raw entries so duplicates never
      // cause extra requests
      if (pageData.data.length < pageSize || (pageData.totalRows !== null && fetchedEntries >= pageData.totalRows)) {
        break;
      }
      if (page >= maxPages) {
        truncated = true;
        console.warn(`Open API listing (${what}) truncated at ${maxPages} pages (${fetchedEntries} entries fetched)`);
        break;
      }
    } // End of the loop that walks the listing's pages

    return { items, truncated };
  } // End of function listAll()

  /**
   * Lists the sites the Open API application can see (v1, paged).
   * @returns {Promise<PagedList<OpenApiSite>>} The sites.
   * @throws {OpenApiError} On any failure.
   */
  listSites(): Promise<PagedList<OpenApiSite>> {
    return this.listAll('v1', ['sites'], validateOpenApiSite, (site) => site.id);
  }

  /**
   * Lists the AP groups of one site (`GET /openapi/v1/{omadacId}/sites/{siteId}/ap-groups`,
   * paged), with `apNum`, `ssidNameList` and `remainingBinding` when reported,
   * plus the per-group SSID limits of the first page.
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
   * Throws 'clientClosed' once close() was called.
   */
  #assertOpen(): void {
    if (this.#closed) {
      throw new OpenApiError('clientClosed', 'the Open API client was closed');
    }
  }

  /**
   * Returns a usable access token: the cached one while it is not (about to
   * be) expired, otherwise a fresh one from the shared acquisition.
   * @returns {Promise<string>} The access token.
   */
  async #currentToken(): Promise<string> {
    const token = this.#token;
    if (token !== null && this.#now() < token.renewAt) {
      return token.accessToken;
    }
    return (await this.#sharedAcquire()).accessToken;
  }

  /**
   * Returns the token to retry with after `rejectedToken` was rejected: a
   * newer token another request already obtained, else the result of the
   * shared acquisition (started here, or joined when one is in flight).
   * @param {string} rejectedToken - The token the controller rejected.
   * @returns {Promise<string>} The token for the single retry.
   */
  async #tokenAfterRejection(rejectedToken: string): Promise<string> {
    this.#assertOpen();
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
   * Sends one authorized call and classifies the response.
   * @param {OpenApiMethod} method - HTTP method.
   * @param {string} url - Absolute URL.
   * @param {string} token - The access token to send.
   * @param {string | undefined} body - Serialized JSON body.
   * @param {Record<string, string>} extraHeaders - Checked extra headers.
   * @returns {Promise<CallOutcome>} The result, or a token rejection.
   * @throws {OpenApiError} On every other failure.
   */
  async #call(
    method: OpenApiMethod,
    url: string,
    token: string,
    body: string | undefined,
    extraHeaders: Record<string, string>
  ): Promise<CallOutcome> {
    this.#assertOpen();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    Object.assign(headers, extraHeaders);
    headers.Authorization = `AccessToken=${token}`;

    const response = await this.#send({ method, url, headers, body });
    this.#assertOpen();

    if (response.statusCode === 401) {
      return { kind: 'tokenRejected', diagnostic: 'HTTP 401' };
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw this.#httpError(response);
    }
    const envelope = this.#parseEnvelope(response.body);
    if (TOKEN_REJECTED_ERROR_CODES.has(envelope.errorCode)) {
      return { kind: 'tokenRejected', diagnostic: `errorCode ${envelope.errorCode}` };
    }
    if (envelope.errorCode !== 0) {
      throw new OpenApiError('apiError', this.#envelopeDiagnostic(`${method} request failed`, envelope), {
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
   * @returns {Promise<OmadaHttpResponse>} Status and raw body.
   * @throws {OpenApiError} 'timeout', 'networkError' or 'clientClosed'.
   */
  async #send(request: OmadaHttpRequest): Promise<OmadaHttpResponse> {
    try {
      // The Open API is token-authenticated: response cookies are ignored
      return await this.#transport.send(request, () => undefined);
    } catch (error) {
      this.#assertOpen();
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Request timeout')) {
        throw new OpenApiError('timeout', this.#scrub(message));
      }
      throw new OpenApiError('networkError', this.#scrub(message));
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
   * @returns {OpenApiError} The error.
   */
  #httpError(response: OmadaHttpResponse): OpenApiError {
    let diagnostic = `HTTP ${response.statusCode}`;
    let controllerErrorCode: number | undefined;
    try {
      const parsed = JSON.parse(response.body) as Record<string, unknown>;
      if (parsed !== null && typeof parsed === 'object' && Number.isSafeInteger(parsed.errorCode)) {
        controllerErrorCode = parsed.errorCode as number;
        diagnostic = this.#envelopeDiagnostic(diagnostic, {
          errorCode: controllerErrorCode,
          msg: typeof parsed.msg === 'string' ? parsed.msg : '',
          result: undefined
        });
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
   * @returns {string} The diagnostic.
   */
  #envelopeDiagnostic(context: string, envelope: OpenApiEnvelope): string {
    const message = envelope.msg ? ` (${this.#scrub(envelope.msg)})` : '';
    return `${context}: errorCode ${envelope.errorCode}${message}`;
  }

  /**
   * Redacts a diagnostic text, also removing this client's Client Secret and
   * every token it received by value, and cuts it to MAX_DIAGNOSTIC_CHARS.
   * @param {string} text - The raw text.
   * @returns {string} The sanitized text.
   */
  #scrub(text: string): string {
    return redactText(text, [this.#clientSecret, ...this.#knownTokens]).slice(0, MAX_DIAGNOSTIC_CHARS);
  }

  /**
   * Remembers a received token so diagnostics can scrub it by value.
   * @param {string} accessToken - The token.
   */
  #rememberToken(accessToken: string): void {
    this.#knownTokens.push(accessToken);
    if (this.#knownTokens.length > MAX_REMEMBERED_TOKENS) {
      this.#knownTokens.shift();
    }
  }
} // End of class OpenApiClient
