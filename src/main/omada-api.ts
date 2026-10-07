import { AccessPoint, ControllerInfo, GroupListing, WlanGroup, OmadaApiResponse, SiteInfo } from '../shared/types';
import { describeController } from './controller-version';
import { CookieJar } from './cookie-jar';
import {
  GroupListEntry,
  joinGroupsWithSsids,
  validateAccessPoints,
  validateGroupList,
  validateSitePage,
  validateWlanGroups
} from './omada-validators';
import { OmadaTransport, parseOmadaResponse, ResponseHeaders } from './omada-transport';
import { isSensitiveKey, redactErrorMessage } from './redact';

// This module never imports Electron: all HTTP goes through the injected
// OmadaTransport (production: createNetTransport() from net-transport.ts), so the
// client is unit-tested with a fake transport (tests/unit/omada-controller.test.ts).

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

// Omada errorCode values that mean the session is no longer authenticated
// (-1200 = "login required"; extend this set if other codes show up)
const AUTH_ERROR_CODES = new Set<number>([-1200]);

// Pagination limits for the authorized-site listing. Each request asks for
// SITES_PAGE_SIZE entries; MAX_SITE_PAGES caps the walk defensively (50
// pages x 100 sites = 5000 sites) so a broken or malicious controller can
// never keep the client looping forever. Hitting the cap logs a warning.
const SITES_PAGE_SIZE = 100;
const MAX_SITE_PAGES = 50;

// Session credentials remembered for scrubbing (sessionSecrets()): at most
// this many, the oldest dropped first (each login adds a CSRF token and
// usually a session cookie)
const MAX_HELD_SECRETS = 32;
// A cookie whose name is not sensitive (isSensitiveKey(): TPOMADA_SESSIONID
// is) is scrubbed by value only from this length on: a shorter value is no
// credential, and scrubbing it ("en", "1") would mangle every diagnostic
const MIN_SCRUBBED_COOKIE_LENGTH = 8;

/**
 * Omada Controller API Client
 * Handles authentication and communication with TP-Link Omada Controller
 */
export class OmadaController {
  private baseUrl: string;
  private username: string;
  private password: string;
  // HTTP transport (timeouts, body cap and the actual network I/O live there)
  private transport: OmadaTransport;
  private omadacId: string | null = null;
  // The controllerVer /api/info reported and the group model derived from it
  // (controller-version.ts); until connect() reads it, the defensive default
  private controllerInfo: ControllerInfo = { controllerVersion: null, groupModel: 'wlanGroup' };
  private siteId: string | null = null;
  // Sites the logged-in account is authorized to see (filled by connect());
  // selectSite() only ever accepts an id from this list
  private availableSites: SiteInfo[] = [];
  private csrfToken: string | null = null;
  private cookies: CookieJar = new CookieJar();
  // Every session credential this client has held — the CSRF tokens and the
  // cookie values (see MIN_SCRUBBED_COOKIE_LENGTH) — newest last, at most
  // MAX_HELD_SECRETS. Kept after a logout or a failed re-login cleared the
  // session: a failure reported afterwards can still echo one
  private heldSecrets: string[] = [];
  // Shared in-flight re-login: concurrent session-expired requests all
  // await this single promise instead of starting competing logins
  private reloginPromise: Promise<void> | null = null;

  /**
   * Creates a client for one controller. Nothing is sent until connect().
   * @param {string} baseUrl - Controller URL (a trailing slash is removed).
   * @param {string} username - Login username.
   * @param {string} password - Login password (main process only).
   * @param {OmadaTransport} transport - HTTP transport; production passes
   *   the createNetTransport() transport (net-transport.ts), tests pass a fake.
   */
  constructor(baseUrl: string, username: string, password: string, transport: OmadaTransport) {
    // Remove trailing slash if present
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this.transport = transport;
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
      // Step 1: Get controller info to retrieve omadacId, and keep the
      // controller version: it decides the group model (AP groups on 6.3+,
      // legacy WLAN groups otherwise — see describeController())
      const infoResponse = await this.request<{ omadacId: string; controllerVer?: unknown }>('/api/info', 'GET');

      if (!infoResponse.result?.omadacId) {
        throw new Error('No se pudo obtener el ID del controlador');
      }

      this.omadacId = infoResponse.result.omadacId;
      this.controllerInfo = describeController(infoResponse.result.controllerVer);

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
      this.rememberSessionSecrets();

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
      console.error('Connection error:', this.redactedMessage(error));
      throw error;
    }
  } // End of function connect()

  /**
   * The controller id (`omadacId`) /api/info reported, or null before
   * connect() read it.
   * @returns {string | null} The controller id.
   */
  get controllerId(): string | null {
    return this.omadacId;
  }

  /**
   * The controller version and the group model derived from it (the
   * defensive 'wlanGroup' default until connect() read /api/info).
   * @returns {ControllerInfo} A copy of the controller info.
   */
  get info(): ControllerInfo {
    return { ...this.controllerInfo };
  }

  /**
   * The selected site (id and display name from the authorized-site list),
   * or null while none is selected.
   * @returns {SiteInfo | null} A copy of the selected site.
   */
  get selectedSite(): SiteInfo | null {
    const site = this.availableSites.find((candidate) => candidate.id === this.siteId);
    return site ? { ...site } : null;
  }

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
   * Every credential this client's requests carry or carried, for scrubbing
   * by value from a failure before it is logged, rethrown or shown (a
   * controller message or an error page can echo one bare, where no key
   * names it): the login password, the Cookie header sent now, and every
   * CSRF token and cookie value held so far (heldSecrets — also the ones a
   * logout or a failed re-login has cleared since).
   * @returns {string[]} The secret values (none empty).
   */
  sessionSecrets(): string[] {
    const secrets = [this.password, this.cookies.toHeader(), ...this.heldSecrets];
    return secrets.filter((secret) => secret.length > 0);
  }

  /**
   * Adds the session credentials held now — the CSRF token and the cookie
   * values worth scrubbing (a sensitive name, or MIN_SCRUBBED_COOKIE_LENGTH
   * characters) — to heldSecrets, each once; the oldest are dropped beyond
   * MAX_HELD_SECRETS.
   */
  private rememberSessionSecrets(): void {
    const current = this.cookies
      .entries()
      .filter(([name, value]) => isSensitiveKey(name) || value.length >= MIN_SCRUBBED_COOKIE_LENGTH)
      .map(([, value]) => value);
    if (this.csrfToken) {
      current.push(this.csrfToken);
    }
    for (const secret of current) {
      if (secret.length > 0 && !this.heldSecrets.includes(secret)) {
        this.heldSecrets.push(secret);
      }
    }
    if (this.heldSecrets.length > MAX_HELD_SECRETS) {
      this.heldSecrets.splice(0, this.heldSecrets.length - MAX_HELD_SECRETS);
    }
  } // End of function rememberSessionSecrets()

  /**
   * The redacted message of a failure, for this client's log lines: the
   * central redactor (redact.ts) with every session credential
   * (sessionSecrets()) scrubbed by value as well (a failure can quote a
   * controller message or a response excerpt).
   * @param {unknown} error - The thrown value.
   * @returns {string} The redacted message.
   */
  private redactedMessage(error: unknown): string {
    return redactErrorMessage(error, this.sessionSecrets());
  }

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
        console.warn('Logout request failed:', this.redactedMessage(error));
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
   * Each page is strictly validated (validateSitePage() in
   * omada-validators.ts) and the combined list is deduplicated by id.
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

      // Runtime validation: throws "Unsupported API response (sites)" when
      // the page is not an array of objects with a string id
      const sitePage = validateSitePage(response.result);

      for (const site of sitePage.sites) {
        if (seenIds.has(site.id)) {
          continue; // Deduplicate: keep the first occurrence of each id
        }
        seenIds.add(site.id);
        sites.push(site);
      }

      fetchedEntries += sitePage.entryCount;

      // A short (or empty) page, or reaching the reported total, ends the
      // walk; totals are compared against raw fetched entries so duplicate
      // entries can never cause extra requests
      const totalRows = sitePage.totalRows;
      if (sitePage.entryCount < SITES_PAGE_SIZE || (totalRows !== null && fetchedEntries >= totalRows)) {
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
    const aps = validateAccessPoints(response.result);

    // Sort alphabetically by name (names are guaranteed strings here)
    return aps.sort((a, b) => a.name.localeCompare(b.name));
  } // End of function getAccessPoints()

  /**
   * Get the groups APs can be assigned to (AP groups on Omada 6.3+, WLAN
   * groups before), each with the names of the Wi-Fi networks it broadcasts,
   * together with the controller info (version, group model) they belong to.
   *
   * Sources (docs/management-design.md §2.3): the authoritative list is
   * `GET setting/wlans`, which includes the groups without SSIDs (e.g. an
   * empty group used to silence APs) that `GET setting/ssids` omits; the SSID
   * names are outer-joined onto it from `GET setting/ssids`
   * (joinGroupsWithSsids()). Both requests run in parallel.
   *
   * Legacy controllers (decision): `setting/wlans` is live-verified only on
   * 6.3.0.45 (docs/omada-6.3-api-findings.md), while the app has always built
   * its group list from `setting/ssids` alone, which works on older
   * controllers. Therefore:
   * - groupModel 'apGroup' (6.3+): `setting/wlans` is required. A failed
   *   request, an errorCode or a shape validateGroupList() rejects fails the
   *   whole load: falling back would silently hide the empty groups, which are
   *   exactly what this list must offer as move targets.
   * - groupModel 'wlanGroup' (older, or a missing/unparseable version):
   *   `setting/wlans` is tried, and when it is unavailable — any request
   *   error, an errorCode such as -1600 "Unsupported request path", or a shape
   *   validateGroupList() rejects — the list falls back to the pre-6.3 source,
   *   the groups `setting/ssids` reports (groups without SSIDs then stay
   *   invisible, as they always were on those controllers).
   * `setting/ssids` is required in both models.
   * @returns The group listing; groups sorted alphabetically by name.
   */
  async getWlanGroups(): Promise<GroupListing> {
    if (!this.omadacId || !this.csrfToken || !this.siteId) {
      throw new Error('No conectado al controlador');
    }

    const info = this.controllerInfo;
    const [listOutcome, ssidOutcome] = await Promise.allSettled([this.loadGroupList(), this.loadSsidGroups()]);

    if (listOutcome.status === 'rejected' && info.groupModel === 'apGroup') {
      throw listOutcome.reason;
    }
    if (ssidOutcome.status === 'rejected') {
      throw ssidOutcome.reason;
    }

    let groups: WlanGroup[];
    if (listOutcome.status === 'fulfilled') {
      const joined = joinGroupsWithSsids(listOutcome.value, ssidOutcome.value);
      if (joined.ignoredSsidGroupIds.length > 0) {
        console.warn(
          `Ignoring setting/ssids entries for ${joined.ignoredSsidGroupIds.length} group id(s) missing from setting/wlans:`,
          joined.ignoredSsidGroupIds.join(', ')
        );
      }
      groups = joined.groups;
    } else {
      // Pre-6.3 (or unknown) controller without a usable setting/wlans
      console.warn('Group list (setting/wlans) unavailable; using the groups setting/ssids reports:', this.redactedMessage(listOutcome.reason));
      groups = ssidOutcome.value;
    }

    // Sort alphabetically by name (names are guaranteed strings here)
    groups.sort((a, b) => a.wlanName.localeCompare(b.wlanName));
    return { controllerVersion: info.controllerVersion, groupModel: info.groupModel, groups };
  } // End of function getWlanGroups()

  /**
   * The ids of the authoritative group list (`GET setting/wlans`, entries
   * validated and deduplicated by validateGroupList()), for the management
   * capability check that compares them with the Open API AP-group ids
   * (docs/management-design.md §2.2, check 5). No fallback: a failed request,
   * an errorCode or an unsupported shape throws.
   * @returns The group ids, in response order.
   */
  async listGroupIds(): Promise<string[]> {
    if (!this.omadacId || !this.csrfToken || !this.siteId) {
      throw new Error('No conectado al controlador');
    }
    const entries = await this.loadGroupList();
    return entries.map((entry) => entry.id);
  } // End of function listGroupIds()

  /**
   * Load and validate the authoritative group list (`GET setting/wlans`).
   * @returns The validated group-list entries.
   * @throws When the request fails, reports an errorCode, or the payload
   *   shape is unsupported (validateGroupList()).
   */
  private async loadGroupList(): Promise<GroupListEntry[]> {
    const response = await this.request<unknown>(
      `/${this.omadacId}/api/v2/sites/${this.siteId}/setting/wlans`,
      'GET'
    );

    if (response.errorCode !== 0) {
      throw new Error(response.msg || 'Error al obtener la lista de grupos');
    }

    return validateGroupList(response.result);
  } // End of function loadGroupList()

  /**
   * Load and validate the per-group SSID lists (`GET setting/ssids`, which
   * returns { result: { ssids: [...] } }, not { result: [...] }).
   * @returns The groups that have SSIDs, with their SSID names.
   * @throws When the request fails, reports an errorCode, or the payload
   *   shape is unsupported (validateWlanGroups()).
   */
  private async loadSsidGroups(): Promise<WlanGroup[]> {
    const response = await this.request<unknown>(
      `/${this.omadacId}/api/v2/sites/${this.siteId}/setting/ssids`,
      'GET'
    );

    if (response.errorCode !== 0) {
      throw new Error(response.msg || 'Error al obtener grupos WLAN');
    }

    // Validate/normalize at runtime instead of trusting a TypeScript cast
    return validateWlanGroups(response.result);
  } // End of function loadSsidGroups()

  /**
   * Move an access point into a group (AP group on 6.3+, WLAN group before)
   * with the internal `PATCH eaps/{mac} {wlanId}` call — the only move path,
   * live-verified on 6.3.0.45; a group without SSIDs is a valid target
   * @param mac MAC address of the access point.
   * @param wlanId Id of the group to assign (getWlanGroups() `wlanId`).
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
    this.rememberSessionSecrets();
  } // End of function relogin()

  /**
   * Low-level HTTP request to the Omada API through the injected transport.
   * Builds the headers (JSON content type, the CSRF token once logged in, and
   * the Cookie header from the jar), merges every response's Set-Cookie
   * header(s) into the jar as soon as the headers arrive (never replacing the
   * jar), and parses the body with parseOmadaResponse() — which rejects
   * non-2xx statuses and invalid JSON with a bounded excerpt. Timeouts and
   * the body-size cap are enforced by the transport (omada-transport.ts).
   * @param endpoint API path appended to the base URL.
   * @param method HTTP method.
   * @param body Optional JSON body.
   * @returns The parsed Omada API response.
   */
  private async rawRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH',
    body?: Record<string, unknown>
  ): Promise<OmadaApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    // Set headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.csrfToken) {
      headers['Csrf-Token'] = this.csrfToken;
    }

    // Build the Cookie header from the jar
    if (this.cookies.size > 0) {
      headers.Cookie = this.cookies.toHeader();
    }

    /**
     * Merges the response's cookies into the jar (never replaces it).
     * @param {ResponseHeaders} responseHeaders - Headers of the response.
     */
    const mergeResponseCookies = (responseHeaders: ResponseHeaders): void => {
      const setCookie = responseHeaders['set-cookie'];
      if (setCookie) {
        this.cookies.merge(setCookie);
        this.rememberSessionSecrets();
      }
    };

    const response = await this.transport.send(
      { method, url, headers, body: body ? JSON.stringify(body) : undefined },
      mergeResponseCookies
    );

    // An error excerpt is scrubbed of the session credentials before its cut
    return parseOmadaResponse<T>(response.statusCode, response.body, this.sessionSecrets());
  } // End of function rawRequest()
} // End of class OmadaController
