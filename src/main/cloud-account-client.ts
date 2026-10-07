// TP-Link cloud account client (Account Level Open API, docs/omada-cloud-openapi.md
// §3–§5, §7, §9). Electron-free: every request goes through an injected
// OmadaTransport — in production the cloud transport (cloud-transport.ts:
// Electron's net module in the cloud's own session, Chromium's normal
// certificate verification, the origin allowlist enforced again), in the unit
// tests a fake (tests/unit/cloud-account-client.test.ts). The clock and the
// sleep are injected too (through the throttle).
//
// - Token: `POST {base}/authorize/account/token?type=get_tokens` with the JSON
//   body `{client_id, client_secret}` → `result.accessToken` + `expiresIn`
//   (7200 s documented). The token lives in memory only (a private field);
//   calls send `Authorization: AccessToken=<token>`. It is renewed by running
//   get_tokens AGAIN shortly before it expires (TOKEN_EXPIRY_MARGIN_MS) and
//   once after an auth error (HTTP 401 or CLOUD_TOKEN_REJECTED_ERROR_CODES).
//   The single-use refresh token the endpoint also returns is NEVER used and
//   never kept: validateTokenResult() keeps the access token and its renewal
//   time only. Every acquisition goes through one shared in-flight promise.
// - Organizations: `GET {base}/v1/organizations?page&pageSize` (page size
//   1–100) walked to `totalRows` with walkPagedListing() (openapi-client.ts),
//   capped at MAX_ORGANIZATION_PAGES (fail-closed `truncated`), each row
//   validated strictly (validateCloudOrganization()).
// - Rate limit: every request — token requests included — first takes a slot
//   of the credential's CloudRequestThrottle (≤ 5 per second across every
//   user of the credential, the cloud route of OpenApiClient included); a
//   -7132 or HTTP 429 answer backs the credential off and is retried at most
//   CLOUD_RATE_LIMIT_MAX_RETRIES times, then is 'rateLimited'.
// - Errors: CloudAccountError with a stable code and a sanitized diagnostic
//   (redact.ts plus this client's secret and tokens scrubbed by value); never
//   a raw body, the Client Secret or a token.
// - The client is also the CloudTokenProvider of the Open API cloud route.
//   close() drops every token reference; a call in flight then ends as
//   'clientClosed'.

import {
  CLOUD_RATE_LIMIT_ERROR_CODE,
  CLOUD_TOKEN_REJECTED_ERROR_CODES,
  CloudAccountError,
  CloudCredentials,
  CloudOrganization,
  CloudTokenProvider,
  CREDENTIAL_INVALID_ERROR_CODES,
  MAX_CLOUD_DIAGNOSTIC_CHARS,
  validateCloudOrganization
} from './cloud-account-model';
import { cloudBaseUrl, isCloudRegion } from './cloud-hosts';
import { CLOUD_RATE_LIMIT_MAX_RETRIES, CloudRequestThrottle } from './cloud-throttle';
import { OmadaHttpRequest, OmadaHttpResponse, OmadaTransport } from './omada-transport';
import {
  AccessTokenState,
  buildQueryString,
  OpenApiError,
  OpenApiQuery,
  PagedList,
  validateOpenApiPage,
  validateTokenResult,
  walkPagedListing
} from './openapi-client';
import { redactText } from './redact';
import type { CloudRegion } from '../shared/types';

// The account token endpoint (client-credentials mode). The refresh variant
// (`type=refresh&refresh_token=…`) is deliberately never sent
export const CLOUD_TOKEN_PATH = '/authorize/account/token?type=get_tokens';
// The organization list (the only account-level endpoint the guide documents)
export const CLOUD_ORGANIZATIONS_PATH = '/v1/organizations';

// Organization pages: the documented page size range is 1–100; the walk is
// capped so a misbehaving answer can never make it loop
export const ORGANIZATION_PAGE_SIZE = 100;
export const MAX_ORGANIZATION_PAGES = 10;

// How many of this client's tokens are remembered to scrub them by value
const MAX_REMEMBERED_TOKENS = 8;

/** Constructor options of CloudAccountClient. */
export interface CloudAccountClientOptions {
  region: CloudRegion;
  clientId: string;
  // Main process only; held in a private field
  clientSecret: string;
  transport: OmadaTransport;
  // The credential's shared throttle (a new one when absent)
  throttle?: CloudRequestThrottle;
  // Clock (epoch ms); tests inject a fake one (also into the throttle)
  now?: () => number;
}

/**
 * Parsed response envelope (`{errorCode, msg, result}`).
 */
interface CloudEnvelope {
  errorCode: number;
  msg: string;
  result: unknown;
}

/**
 * Outcome of one sent request after the rate-limit handling: the response,
 * already known not to be a rate-limit answer.
 */
type SentResponse = OmadaHttpResponse & { envelope: CloudEnvelope | null };

/**
 * Client for one TP-Link cloud credential (see the header). One instance per
 * saved credential; close() makes it unusable.
 */
export class CloudAccountClient implements CloudTokenProvider {
  readonly region: CloudRegion;
  readonly baseUrl: string;
  readonly clientId: string;
  readonly throttle: CloudRequestThrottle;
  // Secrets and state: private fields, never enumerable or serializable
  readonly #clientSecret: string;
  readonly #transport: OmadaTransport;
  readonly #now: () => number;
  #token: AccessTokenState | null = null;
  // The single in-flight token acquisition shared by every caller
  #acquiring: Promise<AccessTokenState> | null = null;
  // Tokens this client received (newest last), scrubbed from diagnostics
  #knownTokens: string[] = [];
  #closed = false;

  /**
   * Creates a client. Nothing is sent until the first call.
   * @param {CloudAccountClientOptions} options - Region, credential,
   *   transport, throttle and (tests) clock.
   * @throws {Error} When an option is missing or the region is unknown (the
   *   message never includes a credential).
   */
  constructor(options: CloudAccountClientOptions) {
    if (!isCloudRegion(options.region)) {
      throw new Error('CloudAccountClient needs a known region');
    }
    if (typeof options.clientId !== 'string' || options.clientId === '') {
      throw new Error('CloudAccountClient needs a Client ID');
    }
    if (typeof options.clientSecret !== 'string' || options.clientSecret === '') {
      throw new Error('CloudAccountClient needs a Client Secret');
    }
    this.region = options.region;
    this.baseUrl = cloudBaseUrl(options.region);
    this.clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#transport = options.transport;
    this.#now = options.now ?? Date.now;
    this.throttle = options.throttle ?? new CloudRequestThrottle({ now: this.#now });
  } // End of constructor

  /**
   * Whether close() was called.
   * @returns {boolean} True once closed.
   */
  get isClosed(): boolean {
    return this.#closed;
  }

  /**
   * Tells whether this client was built from exactly these credentials (the
   * secret is compared here, so no copy of it leaves the client).
   * @param {CloudCredentials} credentials - The credentials to compare.
   * @returns {boolean} True when region, Client ID and secret are all equal.
   */
  usesCredentials(credentials: CloudCredentials): boolean {
    return credentials.region === this.region && credentials.clientId === this.clientId && credentials.clientSecret === this.#clientSecret;
  }

  /**
   * The values to scrub from any text by value (main only): the Client
   * Secret and every token this client received. Empty once closed.
   * @returns {string[]} The secret values.
   */
  liveSecrets(): string[] {
    return this.#closed ? [] : [this.#clientSecret, ...this.#knownTokens];
  }

  /**
   * Closes the client (idempotent): every token reference is dropped and
   * every later call fails with 'clientClosed'; a call in flight fails the
   * same way as soon as it resumes and sends nothing more.
   */
  close(): void {
    this.#closed = true;
    this.#token = null;
    this.#acquiring = null;
    this.#knownTokens = [];
  }

  /**
   * Makes sure a usable token is held. `fresh` drops the cached one first
   * ("Test cloud access" proves the credential with a new get_tokens; a
   * get_tokens already in flight is joined).
   * @param {{ fresh?: boolean }} [options] - Whether to require a new token.
   * @returns {Promise<void>} Resolves once a token is held.
   * @throws {CloudAccountError} On any failure.
   */
  async authorize(options: { fresh?: boolean } = {}): Promise<void> {
    this.#assertOpen();
    if (options.fresh === true) {
      this.#token = null;
    }
    await this.getAccessToken();
    this.#assertOpen();
  }

  /**
   * CloudTokenProvider: the cached token while it is not (about to be)
   * expired, else a fresh get_tokens (shared).
   * @returns {Promise<string>} The access token.
   * @throws {CloudAccountError} On any failure.
   */
  async getAccessToken(): Promise<string> {
    this.#assertOpen();
    const token = this.#token;
    if (token !== null && this.#now() < token.renewAt) {
      return token.accessToken;
    }
    return (await this.#sharedAcquire()).accessToken;
  }

  /**
   * CloudTokenProvider: the token to retry with after `rejectedToken` was
   * rejected — a newer valid token, else a fresh get_tokens (shared). Never
   * the refresh token.
   * @param {string} rejectedToken - The token that was rejected.
   * @returns {Promise<string>} The token for the single retry.
   * @throws {CloudAccountError} On any failure.
   */
  async renewAccessToken(rejectedToken: string): Promise<string> {
    this.#assertOpen();
    const token = this.#token;
    if (token !== null && token.accessToken !== rejectedToken && this.#now() < token.renewAt) {
      return token.accessToken;
    }
    if (token !== null && token.accessToken === rejectedToken) {
      this.#token = null;
    }
    return (await this.#sharedAcquire()).accessToken;
  } // End of function renewAccessToken()

  /**
   * Lists the account's organizations (every page, see the header). A token
   * rejection re-acquires once and retries the page once.
   * @returns {Promise<PagedList<CloudOrganization>>} The organizations
   *   (deduplicated by omadacId) and whether the list may be incomplete.
   * @throws {CloudAccountError} On any failure ('malformedResponse' for a
   *   garbage page or row).
   */
  async listOrganizations(): Promise<PagedList<CloudOrganization>> {
    this.#assertOpen();
    return walkPagedListing(
      (query) => this.#authorizedGet(CLOUD_ORGANIZATIONS_PATH, query),
      (result) => {
        try {
          return validateOpenApiPage(result, 'organizations');
        } catch (error) {
          if (error instanceof OpenApiError) {
            throw new CloudAccountError('malformedResponse', 'Unsupported organization list page');
          }
          throw error;
        }
      },
      validateCloudOrganization,
      (organization) => organization.omadacId,
      { pageSize: ORGANIZATION_PAGE_SIZE, maxPages: MAX_ORGANIZATION_PAGES, what: 'organizations', label: 'Cloud account listing' }
    );
  } // End of function listOrganizations()

  /**
   * Sends one authorized GET with the token; a token rejection re-acquires
   * once (shared) and retries once, a second one is 'tokenRejected'.
   * @param {string} path - The path (no query).
   * @param {OpenApiQuery} query - The query parameters.
   * @returns {Promise<unknown>} The `result` of the answer (errorCode 0).
   * @throws {CloudAccountError} On any failure.
   */
  async #authorizedGet(path: string, query: OpenApiQuery): Promise<unknown> {
    const url = `${this.baseUrl}${path}${buildQueryString(query)}`;
    const firstToken = await this.getAccessToken();
    const first = await this.#authorizedCall(url, firstToken);
    if (first.kind === 'ok') {
      return first.result;
    }
    const secondToken = await this.renewAccessToken(firstToken);
    const second = await this.#authorizedCall(url, secondToken);
    if (second.kind === 'ok') {
      return second.result;
    }
    throw new CloudAccountError('tokenRejected', `token rejected again after re-acquiring (${second.diagnostic})`);
  } // End of function #authorizedGet()

  /**
   * Sends one authorized GET and classifies the answer.
   * @param {string} url - Absolute URL.
   * @param {string} token - The access token.
   * @returns {Promise<{ kind: 'ok'; result: unknown } | { kind: 'tokenRejected'; diagnostic: string }>} The outcome.
   * @throws {CloudAccountError} On every failure but a token rejection.
   */
  async #authorizedCall(url: string, token: string): Promise<{ kind: 'ok'; result: unknown } | { kind: 'tokenRejected'; diagnostic: string }> {
    const response = await this.#send({ method: 'GET', url, headers: { Accept: 'application/json', Authorization: `AccessToken=${token}` } });
    if (response.statusCode === 401) {
      return { kind: 'tokenRejected', diagnostic: 'HTTP 401' };
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw this.#httpError(response);
    }
    const envelope = this.#requireEnvelope(response);
    if (CLOUD_TOKEN_REJECTED_ERROR_CODES.has(envelope.errorCode)) {
      return { kind: 'tokenRejected', diagnostic: `errorCode ${envelope.errorCode}` };
    }
    if (envelope.errorCode !== 0) {
      throw new CloudAccountError('apiError', this.#envelopeDiagnostic('organization list failed', envelope), { apiErrorCode: envelope.errorCode });
    }
    return { kind: 'ok', result: envelope.result };
  } // End of function #authorizedCall()

  /**
   * Throws 'clientClosed' once close() was called.
   */
  #assertOpen(): void {
    if (this.#closed) {
      throw new CloudAccountError('clientClosed', 'the cloud account client was closed');
    }
  }

  /**
   * Starts (or joins) the single in-flight get_tokens. A closed client
   * neither starts nor joins one.
   * @returns {Promise<AccessTokenState>} The acquired token.
   */
  #sharedAcquire(): Promise<AccessTokenState> {
    this.#assertOpen();
    if (this.#acquiring === null) {
      const acquiring = this.#acquire().finally(() => {
        if (this.#acquiring === acquiring) {
          this.#acquiring = null;
        }
      });
      this.#acquiring = acquiring;
    }
    return this.#acquiring;
  } // End of function #sharedAcquire()

  /**
   * Runs get_tokens with the client credentials (only through
   * #sharedAcquire()). The request carries no Authorization header; only the
   * access token and its renewal time are kept (never the refresh token).
   * @returns {Promise<AccessTokenState>} The validated token (also cached).
   * @throws {CloudAccountError} 'credentialInvalid', 'httpError', 'apiError',
   *   'rateLimited', 'malformedResponse', 'timeout', 'networkError' or 'clientClosed'.
   */
  async #acquire(): Promise<AccessTokenState> {
    const response = await this.#send({
      method: 'POST',
      url: `${this.baseUrl}${CLOUD_TOKEN_PATH}`,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: this.clientId, client_secret: this.#clientSecret })
    });
    if (response.statusCode === 401 || response.statusCode === 403) {
      const envelope = response.envelope;
      throw new CloudAccountError(
        'credentialInvalid',
        envelope ? this.#envelopeDiagnostic(`token request refused (HTTP ${response.statusCode})`, envelope) : `token request refused (HTTP ${response.statusCode})`,
        { httpStatus: response.statusCode, apiErrorCode: envelope?.errorCode }
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw this.#httpError(response);
    }
    const envelope = this.#requireEnvelope(response);
    if (envelope.errorCode !== 0) {
      const code = CREDENTIAL_INVALID_ERROR_CODES.has(envelope.errorCode) ? 'credentialInvalid' : 'apiError';
      throw new CloudAccountError(code, this.#envelopeDiagnostic('token request failed', envelope), { apiErrorCode: envelope.errorCode });
    }
    let token: AccessTokenState;
    try {
      token = validateTokenResult(envelope.result, this.#now());
    } catch {
      throw new CloudAccountError('malformedResponse', 'Unsupported token response');
    }
    this.#assertOpen();
    this.#rememberToken(token.accessToken);
    this.#token = token;
    return token;
  } // End of function #acquire()

  /**
   * Sends one request through the throttle and the transport. A rate-limit
   * answer (-7132 in a JSON envelope, or HTTP 429) backs the credential off
   * and is sent again, at most CLOUD_RATE_LIMIT_MAX_RETRIES times; transport
   * failures become 'timeout' / 'networkError' with a scrubbed diagnostic.
   * After every await the client must still be open.
   * @param {OmadaHttpRequest} request - The request.
   * @returns {Promise<SentResponse>} The response (never a rate-limit one)
   *   with its envelope when the body is one.
   * @throws {CloudAccountError} 'rateLimited', 'timeout', 'networkError' or 'clientClosed'.
   */
  async #send(request: OmadaHttpRequest): Promise<SentResponse> {
    for (let attempt = 0; ; attempt++) {
      this.#assertOpen();
      await this.throttle.acquire();
      this.#assertOpen();
      let response: OmadaHttpResponse;
      try {
        // Token-authenticated: response cookies are ignored
        response = await this.#transport.send(request, () => undefined);
      } catch (error) {
        this.#assertOpen();
        const message = error instanceof Error ? error.message : String(error);
        throw new CloudAccountError(message.startsWith('Request timeout') ? 'timeout' : 'networkError', this.#scrub(message));
      }
      this.#assertOpen();
      const envelope = parseEnvelope(response.body);
      const rateLimited = response.statusCode === 429 || envelope?.errorCode === CLOUD_RATE_LIMIT_ERROR_CODE;
      if (!rateLimited) {
        this.throttle.succeeded();
        return { ...response, envelope };
      }
      if (attempt >= CLOUD_RATE_LIMIT_MAX_RETRIES) {
        const detail = response.statusCode === 429 ? 'HTTP 429' : `errorCode ${CLOUD_RATE_LIMIT_ERROR_CODE}`;
        throw new CloudAccountError('rateLimited', `rate-limited (${detail}) after ${attempt} retries`, {
          httpStatus: response.statusCode === 429 ? 429 : undefined,
          apiErrorCode: envelope?.errorCode
        });
      }
      this.throttle.rateLimited();
    } // End of the loop that retries a rate-limited request
  } // End of function #send()

  /**
   * Returns the envelope of a 2xx answer.
   * @param {SentResponse} response - The response.
   * @returns {CloudEnvelope} The envelope.
   * @throws {CloudAccountError} 'malformedResponse' on invalid JSON or no errorCode.
   */
  #requireEnvelope(response: SentResponse): CloudEnvelope {
    if (response.envelope === null) {
      throw new CloudAccountError('malformedResponse', 'response without a JSON errorCode');
    }
    return response.envelope;
  }

  /**
   * Builds the 'httpError' of a non-2xx answer: the status, plus TP-Link's
   * errorCode and scrubbed message when the body is an envelope.
   * @param {SentResponse} response - The response.
   * @returns {CloudAccountError} The error.
   */
  #httpError(response: SentResponse): CloudAccountError {
    const context = `HTTP ${response.statusCode}`;
    const envelope = response.envelope;
    return new CloudAccountError('httpError', envelope ? this.#envelopeDiagnostic(context, envelope) : context, {
      httpStatus: response.statusCode,
      apiErrorCode: envelope?.errorCode
    });
  }

  /**
   * Formats "<context>: errorCode <n> (<msg>)" with the message scrubbed.
   * @param {string} context - What failed.
   * @param {CloudEnvelope} envelope - The parsed envelope.
   * @returns {string} The diagnostic.
   */
  #envelopeDiagnostic(context: string, envelope: CloudEnvelope): string {
    const message = envelope.msg ? ` (${this.#scrub(envelope.msg)})` : '';
    return `${context}: errorCode ${envelope.errorCode}${message}`;
  }

  /**
   * Redacts a diagnostic text, also removing this client's Client Secret and
   * every token it received by value, and cuts it.
   * @param {string} text - The raw text.
   * @returns {string} The sanitized text.
   */
  #scrub(text: string): string {
    return redactText(text, [this.#clientSecret, ...this.#knownTokens]).slice(0, MAX_CLOUD_DIAGNOSTIC_CHARS);
  }

  /**
   * Remembers a received token so diagnostics can scrub it by value.
   * @param {string} accessToken - The token.
   */
  #rememberToken(accessToken: string): void {
    if (this.#knownTokens.includes(accessToken)) {
      return;
    }
    this.#knownTokens.push(accessToken);
    if (this.#knownTokens.length > MAX_REMEMBERED_TOKENS) {
      this.#knownTokens.shift();
    }
  }
} // End of class CloudAccountClient

/**
 * Parses a body into the response envelope, or null when it is not one
 * (invalid JSON, not an object, or no integer errorCode). The body itself is
 * never quoted anywhere.
 * @param {string} body - Raw body.
 * @returns {CloudEnvelope | null} The envelope, or null.
 */
function parseEnvelope(body: string): CloudEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || !Number.isSafeInteger((parsed as Record<string, unknown>).errorCode)) {
    return null;
  }
  const raw = parsed as Record<string, unknown>;
  return { errorCode: raw.errorCode as number, msg: typeof raw.msg === 'string' ? raw.msg : '', result: raw.result };
} // End of function parseEnvelope()
