// Fake OmadaTransport for unit tests: serves canned replies per
// "METHOD /path?query" route and records every request, so OmadaController
// can be driven end-to-end without Electron or any network.

import type {
  OmadaHttpRequest,
  OmadaHttpResponse,
  OmadaTransport,
  ResponseHeaders,
} from '../../../src/main/omada-transport';

/**
 * One canned reply. Object bodies are JSON-serialized; string bodies are sent
 * verbatim (e.g. an HTML error page).
 */
export interface FakeReply {
  status?: number;
  body: unknown;
  setCookie?: string | string[];
}

/**
 * A route serves either the same reply forever, or a sequence of replies
 * (one per call; an exhausted sequence fails the request loudly, which
 * catches unexpected extra calls such as a second re-login).
 */
export type FakeRoute = FakeReply | FakeReply[];

/**
 * A request as seen by the fake transport.
 */
export interface RecordedRequest {
  method: string;
  url: string;
  // URL with the base stripped, e.g. "/api/info" or "/<id>/api/v2/login"
  path: string;
  headers: Record<string, string>;
  // Parsed JSON body, or undefined when the request had none
  body: unknown;
}

/**
 * In-memory transport implementing the OmadaTransport contract.
 */
export class FakeTransport implements OmadaTransport {
  readonly requests: RecordedRequest[] = [];
  private readonly routes = new Map<string, FakeRoute>();
  private readonly baseUrl: string;

  /**
   * Creates a fake transport for one controller base URL.
   * @param {string} baseUrl - Base URL the controller under test was given
   *   (without trailing slash); stripped from recorded paths.
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Registers (or replaces) the reply for a route.
   * @param {string} method - HTTP method, e.g. 'GET'.
   * @param {string} path - Path including the query string.
   * @param {FakeRoute} route - The reply or sequence of replies.
   * @returns {this} The transport, for chaining.
   */
  on(method: string, path: string, route: FakeRoute): this {
    // Copy sequences so consuming them never mutates the caller's array
    this.routes.set(`${method} ${path}`, Array.isArray(route) ? [...route] : route);
    return this;
  }

  /**
   * Lists the recorded requests as "METHOD /path" strings, in order.
   * @returns {string[]} The request log.
   */
  log(): string[] {
    return this.requests.map((request) => `${request.method} ${request.path}`);
  }

  /**
   * Returns the recorded requests that hit one route.
   * @param {string} method - HTTP method.
   * @param {string} path - Path including the query string.
   * @returns {RecordedRequest[]} The matching requests, in order.
   */
  requestsTo(method: string, path: string): RecordedRequest[] {
    return this.requests.filter((request) => request.method === method && request.path === path);
  }

  /**
   * Serves one request (see OmadaTransport.send()).
   * @param {OmadaHttpRequest} request - The request built by the controller.
   * @param {(headers: ResponseHeaders) => void} onResponseHeaders - Headers hook.
   * @returns {Promise<OmadaHttpResponse>} The canned status and body.
   */
  async send(request: OmadaHttpRequest, onResponseHeaders: (headers: ResponseHeaders) => void): Promise<OmadaHttpResponse> {
    const path = request.url.startsWith(this.baseUrl) ? request.url.slice(this.baseUrl.length) : request.url;
    this.requests.push({
      method: request.method,
      url: request.url,
      path,
      headers: { ...request.headers },
      body: request.body === undefined ? undefined : JSON.parse(request.body),
    });

    const key = `${request.method} ${path}`;
    const route = this.routes.get(key);
    if (route === undefined) {
      throw new Error(`FakeTransport: no route for ${key}`);
    }
    let reply: FakeReply | undefined;
    if (Array.isArray(route)) {
      reply = route.shift();
      if (reply === undefined) {
        throw new Error(`FakeTransport: no more replies for ${key}`);
      }
    } else {
      reply = route;
    }

    const headers: ResponseHeaders = {};
    if (reply.setCookie !== undefined) {
      headers['set-cookie'] = reply.setCookie;
    }
    onResponseHeaders(headers);

    return {
      statusCode: reply.status ?? 200,
      body: typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
    };
  } // End of function send()
} // End of class FakeTransport
