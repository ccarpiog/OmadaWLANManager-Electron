// Session cookie jar for the Omada API client. Pure (no Electron), so the
// Set-Cookie merge rules are unit-tested directly (tests/unit/cookie-jar.test.ts).

/**
 * In-memory cookie jar keyed by cookie name. Responses are MERGED into it,
 * never replace it wholesale, so the session cookie (TPOMADA_SESSIONID)
 * survives responses that only set unrelated cookies. Cookie attributes other
 * than the expiry ones (Path, Domain, Secure, HttpOnly, SameSite) are ignored:
 * the jar belongs to a single controller origin.
 */
export class CookieJar {
  private readonly cookies: Map<string, string> = new Map();
  private readonly clock: () => number;

  /**
   * Creates an empty jar.
   * @param {() => number} [clock] - Returns the current time in epoch
   *   milliseconds; used to decide whether an Expires date lies in the past.
   *   Defaults to Date.now (tests inject a fixed clock).
   */
  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  /**
   * Number of cookies currently held.
   * @returns {number} The cookie count.
   */
  get size(): number {
    return this.cookies.size;
  }

  /**
   * Returns the value of one cookie.
   * @param {string} name - Cookie name.
   * @returns {string | undefined} The value, or undefined when absent.
   */
  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  /**
   * Removes every cookie (logout / failed re-login).
   */
  clear(): void {
    this.cookies.clear();
  }

  /**
   * Builds the request Cookie header value from the jar, in insertion order.
   * @returns {string} "name=value; name2=value2", or '' when the jar is empty.
   */
  toHeader(): string {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join('; ');
  }

  /**
   * Merge the cookies from a response's Set-Cookie header(s) into the jar.
   * Deletions are honored: an empty value, a Max-Age <= 0, or an Expires
   * date in the past removes the cookie from the jar. A header without a
   * cookie name is ignored.
   * @param {string | string[]} setCookieHeaders - Raw Set-Cookie header value(s) from the response.
   */
  merge(setCookieHeaders: string | string[]): void {
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

    for (const header of headers) {
      const [nameValue, ...attributes] = header.split(';');
      const eqIndex = nameValue.indexOf('=');
      if (eqIndex <= 0) {
        continue; // Malformed cookie (no name); ignore it
      }
      const name = nameValue.slice(0, eqIndex).trim();
      const value = nameValue.slice(eqIndex + 1).trim();

      // Detect a deletion via Expires in the past or Max-Age <= 0
      let expired = false;
      for (const attribute of attributes) {
        const [attrName, ...attrRest] = attribute.split('=');
        const key = attrName.trim().toLowerCase();
        const attrValue = attrRest.join('=').trim();
        if (key === 'expires') {
          const timestamp = Date.parse(attrValue);
          if (!Number.isNaN(timestamp) && timestamp <= this.clock()) {
            expired = true;
          }
        } else if (key === 'max-age') {
          const seconds = Number(attrValue);
          if (!Number.isNaN(seconds) && seconds <= 0) {
            expired = true;
          }
        }
      } // End of the loop that scans the cookie attributes

      if (value === '' || expired) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    } // End of the loop that merges each Set-Cookie header
  } // End of function merge()
} // End of class CookieJar
