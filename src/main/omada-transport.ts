// HTTP transport seam for the Omada API client. OmadaController (omada-api.ts)
// talks to the controller only through the OmadaTransport interface below, so
// it can be driven by a fake transport in unit tests. The production transport
// is createHardenedTransport() over Electron's net.request (net-transport.ts);
// this module itself never imports Electron. OpenApiClient (openapi-client.ts)
// uses the same transport contract, hence PUT and DELETE.

import { OmadaApiResponse } from '../shared/types';
import { redactText } from './redact';

// Request hardening limits
export const REQUEST_TIMEOUT_MS = 15000; // Abort any request that takes longer than this
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // Cap accumulated response bodies at 5 MB
export const ERROR_BODY_EXCERPT_CHARS = 200; // Max body characters quoted in HTTP error messages

/**
 * HTTP methods the transport sends: the internal client uses GET/POST/PATCH,
 * the Open API client (openapi-client.ts) also PUT and DELETE.
 */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * One HTTP request as built by OmadaController or OpenApiClient: absolute
 * URL, the headers to set (in this order), and the already-serialized JSON
 * body, if any.
 */
export interface OmadaHttpRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * A fully received HTTP response: status code and the raw (unparsed) body.
 */
export interface OmadaHttpResponse {
  statusCode: number;
  body: string;
}

/**
 * Response headers as exposed by the transport (multi-valued headers such as
 * Set-Cookie may be arrays).
 */
export type ResponseHeaders = Record<string, string | string[]>;

/**
 * The transport contract. `send()` resolves once the whole body has been
 * received, for ANY status code (status handling is the caller's job, see
 * parseOmadaResponse()), and rejects on network errors, timeouts, aborts and
 * oversized bodies. `onResponseHeaders` is called exactly once per received
 * response, as soon as its headers arrive and before the body is read, and
 * never after the request has settled (a late response is discarded).
 */
export interface OmadaTransport {
  send(request: OmadaHttpRequest, onResponseHeaders: (headers: ResponseHeaders) => void): Promise<OmadaHttpResponse>;
}

/**
 * Minimal structural view of a streaming HTTP response (Electron's
 * IncomingMessage satisfies it).
 */
export interface IncomingMessageLike {
  statusCode: number;
  headers: ResponseHeaders;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Minimal structural view of an outgoing HTTP request (Electron's
 * ClientRequest satisfies it).
 */
export interface ClientRequestLike {
  setHeader(name: string, value: string): void;
  on(event: 'response', listener: (response: IncomingMessageLike) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'abort', listener: () => void): unknown;
  write(chunk: string): void;
  end(): void;
  abort(): void;
}

/**
 * Creates an outgoing request (Electron: `(options) => net.request(options)`).
 */
export type RequestFactory = (options: { method: string; url: string }) => ClientRequestLike;

/**
 * Tunable limits for createHardenedTransport(). Production uses the defaults;
 * unit tests shrink them to exercise the timeout and size-cap paths quickly.
 */
export interface TransportLimits {
  timeoutMs?: number;
  maxResponseBytes?: number;
}

/**
 * Returns the bounded, redacted excerpt of a response body quoted in an error
 * message (the message can reach the renderer as error detail): the WHOLE
 * body goes through redactText() (redact.ts) first and only then is it cut
 * to ERROR_BODY_EXCERPT_CHARS characters, so the cut can never split a secret
 * away from the key that identifies it (a prefix of redacted text is still
 * redacted). The body is already capped at MAX_RESPONSE_BYTES and the scan is
 * linear, so redacting all of it stays cheap on this error-only path.
 * @param {string} body - Raw response body.
 * @returns {string} The excerpt.
 */
export function errorBodyExcerpt(body: string): string {
  return redactText(body).slice(0, ERROR_BODY_EXCERPT_CHARS);
}

/**
 * Turns a fully received response into the parsed Omada API envelope. A
 * non-2xx status is rejected with a bounded, redacted body excerpt instead of
 * trying to JSON-parse an HTML error page; an unparseable body is rejected the
 * same way.
 * @param {number} statusCode - HTTP status code of the response.
 * @param {string} body - Raw response body.
 * @returns {OmadaApiResponse<T>} The parsed Omada API response.
 * @throws {Error} "HTTP <status>: <excerpt>" or "Invalid JSON response: <excerpt>".
 */
export function parseOmadaResponse<T>(statusCode: number, body: string): OmadaApiResponse<T> {
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`HTTP ${statusCode}: ${errorBodyExcerpt(body)}`);
  }
  try {
    return JSON.parse(body) as OmadaApiResponse<T>;
  } catch {
    throw new Error(`Invalid JSON response: ${errorBodyExcerpt(body)}`);
  }
} // End of function parseOmadaResponse()

/**
 * Builds the hardened transport over a request factory (production: Electron's
 * net.request — its SSL handling goes through the app's certificate verify
 * proc). Hardened: aborts after REQUEST_TIMEOUT_MS (covers connect + body
 * download), caps the response body at MAX_RESPONSE_BYTES, and settles each
 * request exactly once — the timeout timer is cleared on every terminal path
 * (resolve and reject both go through the settle helpers).
 * @param {RequestFactory} requestFactory - Creates the outgoing request.
 * @param {TransportLimits} [limits] - Overrides for the timeout / size cap.
 * @returns {OmadaTransport} The transport.
 */
export function createHardenedTransport(requestFactory: RequestFactory, limits: TransportLimits = {}): OmadaTransport {
  const timeoutMs = limits.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxResponseBytes = limits.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  /**
   * Sends one request (see OmadaTransport.send()).
   * @param {OmadaHttpRequest} httpRequest - The request to send.
   * @param {(headers: ResponseHeaders) => void} onResponseHeaders - Response-headers hook.
   * @returns {Promise<OmadaHttpResponse>} Status code and raw body.
   */
  const send = (
    httpRequest: OmadaHttpRequest,
    onResponseHeaders: (headers: ResponseHeaders) => void
  ): Promise<OmadaHttpResponse> => {
    return new Promise((resolve, reject) => {
      const request = requestFactory({
        method: httpRequest.method,
        url: httpRequest.url,
      });

      let settled = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      /** Clear the timeout timer so it cannot fire after the request settles. */
      const clearTimer = (): void => {
        if (timeoutTimer !== null) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
      };

      /**
       * Resolve exactly once, clearing the timeout timer first.
       * @param {OmadaHttpResponse} value - The received response.
       */
      const settleResolve = (value: OmadaHttpResponse): void => {
        if (!settled) {
          settled = true;
          clearTimer();
          resolve(value);
        }
      };

      /**
       * Reject exactly once, clearing the timeout timer first.
       * @param {Error} error - The failure.
       */
      const settleReject = (error: Error): void => {
        if (!settled) {
          settled = true;
          clearTimer();
          reject(error);
        }
      };

      // Abort requests that take too long (covers connect + body download)
      timeoutTimer = setTimeout(() => {
        settleReject(new Error(`Request timeout (${timeoutMs / 1000}s)`));
        request.abort();
      }, timeoutMs);

      // Set headers (in the order the caller built them)
      for (const [name, value] of Object.entries(httpRequest.headers)) {
        request.setHeader(name, value);
      }

      let responseData = '';
      let receivedBytes = 0;

      request.on('response', (response) => {
        // Discard a response that arrives after the request has settled
        // (timeout/abort): handing its headers (cookies) to the caller would
        // mutate the session after the caller has already received a rejection
        if (settled) {
          request.abort();
          return;
        }

        onResponseHeaders(response.headers);

        const statusCode = response.statusCode;

        response.on('data', (chunk) => {
          if (settled) {
            return;
          }
          receivedBytes += chunk.length;
          if (receivedBytes > maxResponseBytes) {
            settleReject(new Error('Response too large'));
            request.abort();
            return;
          }
          responseData += chunk.toString();
        }); // End of the response data handler

        response.on('end', () => {
          if (settled) {
            return;
          }
          settleResolve({ statusCode, body: responseData });
        });

        response.on('error', (error: Error) => {
          settleReject(error);
        });
      }); // End of the request response handler

      request.on('error', (error: Error) => {
        settleReject(new Error(`No se pudo conectar al controlador: ${error.message}`));
      });

      request.on('abort', () => {
        // Only reached when the abort was not initiated by a settle path
        settleReject(new Error('Request aborted'));
      });

      // Send body if present
      if (httpRequest.body !== undefined) {
        request.write(httpRequest.body);
      }

      request.end();
    }); // End of the request promise executor
  }; // End of function send()

  return { send };
} // End of function createHardenedTransport()
