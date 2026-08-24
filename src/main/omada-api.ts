import { net } from 'electron';
import { AccessPoint, WlanGroup, Ssid, OmadaApiResponse, SiteInfo } from '../shared/types';

/**
 * Outcome of a connect() call. Authentication has already succeeded when this
 * is returned (failures throw instead). `siteSelected` is false when the
 * controller manages several sites and neither the preferred id nor an
 * automatic pick applied — the caller must then offer `sites` to the user and
 * complete the connection with selectSite().
 */
export interface ConnectOutcome {
  siteSelected: boolean;
  sites: SiteInfo[];
}

// Request hardening limits
const REQUEST_TIMEOUT_MS = 15000; // Abort any request that takes longer than this
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // Cap accumulated response bodies at 5 MB
const ERROR_BODY_EXCERPT_CHARS = 200; // Max body characters quoted in HTTP error messages

// Omada errorCode values that mean the session is no longer authenticated
// (-1200 = "login required"; extend this set if other codes show up)
const AUTH_ERROR_CODES = new Set<number>([-1200]);

// Pagination limits for the authorized-site listing. Each request asks for
// SITES_PAGE_SIZE entries; MAX_SITE_PAGES caps the walk defensively (50
// pages x 100 sites = 5000 sites) so a broken or malicious controller can
// never keep the client looping forever. Hitting the cap logs a warning.
const SITES_PAGE_SIZE = 100;
const MAX_SITE_PAGES = 50;

/**
 * Omada Controller API Client
 * Handles authentication and communication with TP-Link Omada Controller
 */
export class OmadaController {
  private baseUrl: string;
  private username: string;
  private password: string;
  private omadacId: string | null = null;
  private siteId: string | null = null;
  // Sites the logged-in account is authorized to see (filled by connect());
  // selectSite() only ever accepts an id from this list
  private availableSites: SiteInfo[] = [];
  private csrfToken: string | null = null;
  private cookies: Map<string, string> = new Map();
  // Shared in-flight re-login: concurrent session-expired requests all
  // await this single promise instead of starting competing logins
  private reloginPromise: Promise<void> | null = null;

  constructor(baseUrl: string, username: string, password: string) {
    // Remove trailing slash if present
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;
  }

  /**
   * Connect to the Omada controller and authenticate, then resolve the site.
   * Site selection is explicit — the first site is never silently picked:
   * exactly one authorized site is auto-selected; with several, the
   * `preferredSiteId` (the id stored in the config) is used only when it is
   * still in the authorized-site list, and otherwise the outcome asks the
   * caller to have the user choose (see ConnectOutcome / selectSite()).
   * @param preferredSiteId Previously chosen site id to reuse, if any.
   * @returns The connect outcome (authentication failures throw instead).
   */
  async connect(preferredSiteId?: string): Promise<ConnectOutcome> {
    try {
      // Step 1: Get controller info to retrieve omadacId
      const infoResponse = await this.request<{ omadacId: string }>('/api/info', 'GET');

      if (!infoResponse.result?.omadacId) {
        throw new Error('No se pudo obtener el ID del controlador');
      }

      this.omadacId = infoResponse.result.omadacId;

      // Step 2: Login to get CSRF token
      const loginResponse = await this.request<{ token: string }>(
        `/${this.omadacId}/api/v2/login`,
        'POST',
        { username: this.username, password: this.password }
      );

      if (loginResponse.errorCode !== 0) {
        throw new Error(loginResponse.msg || 'Error de autenticación');
      }

      if (!loginResponse.result?.token) {
        throw new Error('No se recibió token de autenticación');
      }

      this.csrfToken = loginResponse.result.token;

      // Step 3: Load the authorized sites (newer controllers don't expose
      // "Default" — sites are addressed by generated ids)
      this.availableSites = await this.loadSites();

      // Step 4: Pick the site. Auto-select ONLY when exactly one site
      // exists; with several, reuse the preferred (stored) id only when it
      // is still authorized, and otherwise defer to the user
      if (this.availableSites.length === 1) {
        this.siteId = this.availableSites[0].id;
      } else if (
        preferredSiteId &&
        this.availableSites.some((site) => site.id === preferredSiteId)
      ) {
        this.siteId = preferredSiteId;
      } else {
        this.siteId = null;
      }

      return { siteSelected: this.siteId !== null, sites: this.availableSites };
    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  } // End of function connect()

  /**
   * Select one of the authorized sites by id. Only ids present in the list
   * loaded by connect() are accepted — the id is later interpolated into
   * request paths, so the exact-match check doubles as an injection guard.
   * @param siteId Id of the site to select.
   * @returns True when the id belongs to the authorized-site list.
   */
  selectSite(siteId: string): boolean {
    if (!this.availableSites.some((site) => site.id === siteId)) {
      return false;
    }
    this.siteId = siteId;
    return true;
  } // End of function selectSite()

  /**
   * Log out from the controller (best-effort) and clear all local session
   * state (cookies, CSRF token, site id). Network errors are swallowed:
   * logout is a courtesy to the server, not a requirement.
   */
  async logout(): Promise<void> {
    if (this.omadacId && this.csrfToken) {
      try {
        await this.rawRequest(`/${this.omadacId}/api/v2/logout`, 'POST');
      } catch (error) {
        // Best-effort: the server-side session will expire on its own
        console.warn('Logout request failed:', error);
      }
    }
    this.clearSessionState();
  } // End of function logout()

  /**
   * Clear all local authentication state: cookies, CSRF token, site id, and
   * the authorized-site list. Used by logout() and by a failed re-login so no
   * half-valid session survives (the public methods' guards then report "not
   * connected").
   */
  private clearSessionState(): void {
    this.cookies.clear();
    this.csrfToken = null;
    this.siteId = null;
    this.availableSites = [];
  } // End of function clearSessionState()

  /**
   * Load the sites the logged-in user is authorized to see, walking every
   * page of the paginated listing (one page holds at most SITES_PAGE_SIZE
   * sites). The walk stops on a short/empty page, on reaching the total the
   * response metadata reports, or — defensively — at MAX_SITE_PAGES, in
   * which case a console warning notes the truncation.
   * Newer controllers do not expose the site as the literal "Default" — the
   * site is addressed by a generated id, so we look the list up after login.
   * Ids are strictly validated and the combined list is deduplicated by id;
   * a missing/empty name falls back to the id (display-only field).
   * @returns The validated, deduplicated, non-empty list of authorized sites.
   */
  private async loadSites(): Promise<SiteInfo[]> {
    const sites: SiteInfo[] = [];
    const seenIds = new Set<string>();
    let page = 1;
    let fetchedEntries = 0; // Raw entries fetched (pre-deduplication)

    for (;;) {
      const response = await this.request<unknown>(
        `/${this.omadacId}/api/v2/sites?currentPage=${page}&currentPageSize=${SITES_PAGE_SIZE}`,
        'GET'
      );

      if (response.errorCode !== 0) {
        throw new Error(response.msg || 'No se pudo obtener la lista de sitios');
      }

      // Runtime validation: result.data must be an array of objects with a
      // string id, otherwise the controller speaks a shape we don't support
      const result = response.result;
      const data = result !== null && typeof result === 'object'
        ? (result as Record<string, unknown>).data
        : undefined;
      if (!Array.isArray(data)) {
        throw new Error('Unsupported API response (sites)');
      }

      for (const entry of data) {
        if (entry === null || typeof entry !== 'object') {
          throw new Error('Unsupported API response (sites)');
        }
        const site = entry as Record<string, unknown>;
        if (typeof site.id !== 'string' || site.id === '') {
          // The id is the site's required identifier; a missing one means the
          // controller speaks a shape we don't support
          throw new Error('Unsupported API response (sites)');
        }
        if (seenIds.has(site.id)) {
          continue; // Deduplicate: keep the first occurrence of each id
        }
        seenIds.add(site.id);
        sites.push({
          id: site.id,
          // The name is display-only: normalize a missing one to the id
          name: typeof site.name === 'string' && site.name !== '' ? site.name : site.id
        });
      } // End of the loop that validates each site entry of the page

      fetchedEntries += data.length;

      // Total-entry metadata, honored only when it is a sane number (the
      // field the Omada v2 paged responses use is `totalRows`)
      const rawTotal = (result as Record<string, unknown>).totalRows;
      const totalRows = typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal >= 0
        ? rawTotal
        : null;

      // A short (or empty) page, or reaching the reported total, ends the
      // walk; totals are compared against raw fetched entries so duplicate
      // entries can never cause extra requests
      if (data.length < SITES_PAGE_SIZE || (totalRows !== null && fetchedEntries >= totalRows)) {
        break;
      }
      if (page >= MAX_SITE_PAGES) {
        // Defensive cap: never loop forever on a broken/malicious controller
        console.warn(
          `Site listing truncated at ${MAX_SITE_PAGES} pages (${fetchedEntries} entries fetched); later sites are not offered`
        );
        break;
      }
      page++;
    } // End of the loop that walks the site-listing pages

    if (sites.length === 0) {
      throw new Error('El usuario no tiene acceso a ningún sitio');
    }

    return sites;
  } // End of function loadSites()

  /**
   * Get all access points from the controller
   * @returns Access points sorted alphabetically by name.
   */
  async getAccessPoints(): Promise<AccessPoint[]> {
    if (!this.omadacId || !this.csrfToken || !this.siteId) {
      throw new Error('No conectado al controlador');
    }

    const response = await this.request<unknown>(
      `/${this.omadacId}/api/v2/sites/${this.siteId}/devices`,
      'GET'
    );

    if (response.errorCode !== 0) {
      throw new Error(response.msg || 'Error al obtener access points');
    }

    // Validate/normalize at runtime instead of trusting a TypeScript cast
    const aps = OmadaController.validateAccessPoints(response.result);

    // Sort alphabetically by name (names are guaranteed strings here)
    return aps.sort((a, b) => a.name.localeCompare(b.name));
  } // End of function getAccessPoints()

  /**
   * Get all WLAN groups from the controller
   * @returns WLAN groups sorted alphabetically by name.
   */
  async getWlanGroups(): Promise<WlanGroup[]> {
    if (!this.omadacId || !this.csrfToken || !this.siteId) {
      throw new Error('No conectado al controlador');
    }

    // The API returns { result: { ssids: [...] } } not { result: [...] }
    const response = await this.request<unknown>(
      `/${this.omadacId}/api/v2/sites/${this.siteId}/setting/ssids`,
      'GET'
    );

    if (response.errorCode !== 0) {
      throw new Error(response.msg || 'Error al obtener grupos WLAN');
    }

    // Validate/normalize at runtime instead of trusting a TypeScript cast
    const wlans = OmadaController.validateWlanGroups(response.result);

    // Sort alphabetically by name (names are guaranteed strings here)
    return wlans.sort((a, b) => a.wlanName.localeCompare(b.wlanName));
  } // End of function getWlanGroups()

  /**
   * Assign a WLAN group to an access point
   * @param mac MAC address of the access point.
   * @param wlanId Id of the WLAN group to assign.
   * @returns True when the controller accepts the change.
   */
  async setApWlanGroup(mac: string, wlanId: string): Promise<boolean> {
    if (!this.omadacId || !this.csrfToken || !this.siteId) {
      throw new Error('No conectado al controlador');
    }

    const response = await this.request(
      `/${this.omadacId}/api/v2/sites/${this.siteId}/eaps/${mac}`,
      'PATCH',
      { wlanId }
    );

    if (response.errorCode !== 0) {
      throw new Error(response.msg || 'Error al asignar grupo WLAN');
    }

    return true;
  } // End of function setApWlanGroup()

  /**
   * Validate and normalize the raw device list returned by the controller.
   * Keeps only access points and normalizes optional display fields
   * (missing name, wlanGroup, statusCategory) so later dereferences cannot
   * crash. Required identifiers are strict: an entry that is not an object,
   * lacks a string `type`, or is an AP without a MAC address makes the
   * whole payload fail as unsupported instead of silently shrinking the
   * list to empty.
   * @param result Raw `result` field of the devices response.
   * @returns The normalized list of access points.
   * @throws Error when the payload shape is unsupported.
   */
  private static validateAccessPoints(result: unknown): AccessPoint[] {
    if (!Array.isArray(result)) {
      throw new Error('Unsupported API response (devices)');
    }

    const accessPoints: AccessPoint[] = [];
    for (const entry of result) {
      if (entry === null || typeof entry !== 'object') {
        throw new Error('Unsupported API response (devices)');
      }
      const device = entry as Record<string, unknown>;
      if (typeof device.type !== 'string') {
        // Without a device type we cannot even tell APs apart
        throw new Error('Unsupported API response (devices)');
      }
      if (device.type !== 'ap') {
        continue; // Only access points are relevant
      }
      if (typeof device.mac !== 'string' || device.mac === '') {
        // The MAC is the AP's required identifier
        throw new Error('Unsupported API response (devices)');
      }
      accessPoints.push({
        mac: device.mac,
        name: typeof device.name === 'string' ? device.name : device.mac,
        type: 'ap',
        wlanGroup: typeof device.wlanGroup === 'string' ? device.wlanGroup : '',
        statusCategory: typeof device.statusCategory === 'number' ? device.statusCategory : 0
      });
    } // End of the loop that validates each device entry

    return accessPoints;
  } // End of function validateAccessPoints()

  /**
   * Validate and normalize the raw WLAN/SSID payload returned by the
   * controller. Normalizes only optional display fields (missing wlanName,
   * missing SSID lists become empty). Required identifiers are strict: an
   * entry that is not an object or lacks a string wlanId makes the whole
   * payload fail as unsupported instead of silently shrinking the list.
   * @param result Raw `result` field of the ssids response.
   * @returns The normalized list of WLAN groups.
   * @throws Error when the payload shape is unsupported.
   */
  private static validateWlanGroups(result: unknown): WlanGroup[] {
    const ssids = result !== null && typeof result === 'object'
      ? (result as Record<string, unknown>).ssids
      : undefined;
    if (!Array.isArray(ssids)) {
      throw new Error('Unsupported API response (WLANs)');
    }

    const wlanGroups: WlanGroup[] = [];
    for (const entry of ssids) {
      if (entry === null || typeof entry !== 'object') {
        throw new Error('Unsupported API response (WLANs)');
      }
      const wlan = entry as Record<string, unknown>;
      if (typeof wlan.wlanId !== 'string' || wlan.wlanId === '') {
        // wlanId is the group's required identifier
        throw new Error('Unsupported API response (WLANs)');
      }

      // Normalize the SSID list: absent/invalid lists become empty arrays
      const rawSsidList = Array.isArray(wlan.ssidList) ? wlan.ssidList : [];
      const ssidList: Ssid[] = [];
      for (const rawSsid of rawSsidList) {
        const ssidName = rawSsid !== null && typeof rawSsid === 'object'
          ? (rawSsid as Record<string, unknown>).ssidName
          : undefined;
        ssidList.push({ ssidName: typeof ssidName === 'string' ? ssidName : '' });
      } // End of the loop that normalizes the SSID list

      wlanGroups.push({
        wlanId: wlan.wlanId,
        wlanName: typeof wlan.wlanName === 'string' ? wlan.wlanName : '',
        ssidList
      });
    } // End of the loop that validates each WLAN entry

    return wlanGroups;
  } // End of function validateWlanGroups()

  /**
   * Merge the cookies from a response's Set-Cookie header(s) into the jar.
   * The jar is never replaced wholesale, so the session cookie
   * (TPOMADA_SESSIONID) survives responses that only set unrelated cookies.
   * Deletions are honored: an empty value, a Max-Age <= 0, or an Expires
   * date in the past removes the cookie from the jar.
   * @param setCookieHeaders Raw Set-Cookie header value(s) from the response.
   */
  private mergeCookies(setCookieHeaders: string | string[]): void {
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
          if (!Number.isNaN(timestamp) && timestamp <= Date.now()) {
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
  } // End of function mergeCookies()

  /**
   * Make an API request, transparently re-logging in once when the
   * controller reports an expired session (see AUTH_ERROR_CODES). The retry
   * goes through rawRequest() directly, so it can never re-login again.
   * @param endpoint API path appended to the base URL.
   * @param method HTTP method.
   * @param body Optional JSON body.
   * @param allowRelogin Internal guard; false disables the re-login path.
   * @returns The parsed Omada API response.
   */
  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH',
    body?: Record<string, unknown>,
    allowRelogin = true
  ): Promise<OmadaApiResponse<T>> {
    const response = await this.rawRequest<T>(endpoint, method, body);

    // Transparent re-login on session expiry. Only attempted when a previous
    // login succeeded (csrfToken set), so the connect flow never triggers it
    if (allowRelogin && this.csrfToken !== null && AUTH_ERROR_CODES.has(response.errorCode)) {
      await this.sharedRelogin();
      return this.rawRequest<T>(endpoint, method, body);
    }

    return response;
  } // End of function request()

  /**
   * Start (or join) the shared re-login attempt. Every request that hits a
   * session-expired error awaits the SAME login operation, so concurrent
   * expirations (e.g. APs and WLANs fetched with Promise.all) can never run
   * competing logins that clobber each other's cookie/CSRF state.
   * @returns The in-flight re-login promise.
   */
  private sharedRelogin(): Promise<void> {
    if (this.reloginPromise === null) {
      this.reloginPromise = this.relogin().finally(() => {
        // Allow a future expiry to start a fresh attempt. A failing
        // attempt's cleanup (clearSessionState) runs inside relogin()
        // before this reset, so it can never clear the state written by a
        // later successful attempt
        this.reloginPromise = null;
      });
    }
    return this.reloginPromise;
  } // End of function sharedRelogin()

  /**
   * Re-run the login step to refresh the session cookie and CSRF token
   * after the controller reported an expired session. On failure all local
   * auth state is cleared (cookies, CSRF token, site id) — a failed login
   * response may already have replaced or deleted the session cookie in the
   * jar, and keeping the stale token/site id would let the instance keep
   * operating on a half-valid session. Only called through sharedRelogin().
   * @throws Error with a clear message when the re-login fails.
   */
  private async relogin(): Promise<void> {
    if (!this.omadacId) {
      this.clearSessionState();
      throw new Error('Session expired');
    }

    let loginResponse: OmadaApiResponse<{ token: string }>;
    try {
      loginResponse = await this.rawRequest<{ token: string }>(
        `/${this.omadacId}/api/v2/login`,
        'POST',
        { username: this.username, password: this.password }
      );
    } catch (error) {
      this.clearSessionState();
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Session expired; re-login failed: ${detail}`);
    }

    if (loginResponse.errorCode !== 0 || !loginResponse.result?.token) {
      this.clearSessionState();
      throw new Error('Session expired; re-login failed');
    }

    this.csrfToken = loginResponse.result.token;
  } // End of function relogin()

  /**
   * Low-level HTTP request to the Omada API using Electron's net module.
   * Hardened: rejects non-2xx statuses with a bounded body excerpt, aborts
   * after REQUEST_TIMEOUT_MS, and caps the response body at
   * MAX_RESPONSE_BYTES. The timeout timer is cleared on every terminal path
   * (resolve and reject both go through the settle helpers).
   * @param endpoint API path appended to the base URL.
   * @param method HTTP method.
   * @param body Optional JSON body.
   * @returns The parsed Omada API response.
   */
  private rawRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH',
    body?: Record<string, unknown>
  ): Promise<OmadaApiResponse<T>> {
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}${endpoint}`;

      const request = net.request({
        method,
        url,
        // Electron's net module handles SSL certificates via the app's certificate-error event
      });

      let settled = false;
      let timeoutTimer: NodeJS.Timeout | null = null;

      /** Clear the timeout timer so it cannot fire after the request settles. */
      const clearTimer = (): void => {
        if (timeoutTimer !== null) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
      };

      /** Resolve exactly once, clearing the timeout timer first. */
      const settleResolve = (value: OmadaApiResponse<T>): void => {
        if (!settled) {
          settled = true;
          clearTimer();
          resolve(value);
        }
      };

      /** Reject exactly once, clearing the timeout timer first. */
      const settleReject = (error: Error): void => {
        if (!settled) {
          settled = true;
          clearTimer();
          reject(error);
        }
      };

      // Abort requests that take too long (covers connect + body download)
      timeoutTimer = setTimeout(() => {
        settleReject(new Error(`Request timeout (${REQUEST_TIMEOUT_MS / 1000}s)`));
        request.abort();
      }, REQUEST_TIMEOUT_MS);

      // Set headers
      request.setHeader('Content-Type', 'application/json');
      request.setHeader('Accept', 'application/json');

      if (this.csrfToken) {
        request.setHeader('Csrf-Token', this.csrfToken);
      }

      // Build the Cookie header from the jar
      if (this.cookies.size > 0) {
        const cookieHeader = Array.from(
          this.cookies,
          ([name, value]) => `${name}=${value}`
        ).join('; ');
        request.setHeader('Cookie', cookieHeader);
      }

      let responseData = '';
      let receivedBytes = 0;

      request.on('response', (response) => {
        // Discard a response that arrives after the request has settled
        // (timeout/abort): merging its cookies would mutate the jar after
        // the caller has already received a rejection
        if (settled) {
          request.abort();
          return;
        }

        // Merge cookies from the response into the jar (never replace it)
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
          this.mergeCookies(setCookie as string | string[]);
        }

        const statusCode = response.statusCode;

        response.on('data', (chunk) => {
          if (settled) {
            return;
          }
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_RESPONSE_BYTES) {
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
          // Reject non-2xx statuses with a bounded body excerpt instead of
          // trying to JSON-parse an HTML error page
          if (statusCode < 200 || statusCode >= 300) {
            const excerpt = responseData.slice(0, ERROR_BODY_EXCERPT_CHARS);
            settleReject(new Error(`HTTP ${statusCode}: ${excerpt}`));
            return;
          }
          try {
            const data = JSON.parse(responseData) as OmadaApiResponse<T>;
            settleResolve(data);
          } catch {
            const excerpt = responseData.slice(0, ERROR_BODY_EXCERPT_CHARS);
            settleReject(new Error(`Invalid JSON response: ${excerpt}`));
          }
        }); // End of the response end handler

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
      if (body) {
        request.write(JSON.stringify(body));
      }

      request.end();
    });
  } // End of function rawRequest()
}
