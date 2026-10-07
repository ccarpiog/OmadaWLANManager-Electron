// The controller session facade (docs/management-design.md §2.1, §2.2;
// todo.md 4.8): one connected Omada controller as the IPC handlers see it.
// A ControllerSession wraps the internal client (OmadaController: /api/info,
// login, sites, the data and every AP move) and, once management access is
// verified, an OpenApiClient; it knows the normalized URL, the controller id
// (omadacId), the selected site (id + name), the controller version, the
// group model and the management capabilities. ConnectionManager
// (connection-manager.ts) installs, detaches and closes sessions like any
// ManagedController; index.ts only shape-checks payloads and calls in here.
//
// Capability checks (spec §2.2) run in the background when a session becomes
// the installed one (activate()) — so they never delay or fail the connect
// or the AP list — and again on "Test management access". A
// management-credentials save (controller URL unchanged) starts no run of its
// own (applyManagementAccessChange()): it drops the installed session's Open
// API client and capabilities at once, and the reconnect the Settings flow
// performs after every successful save runs the checks once, on the new
// session (when no reconnect follows, the next capabilities or Test request
// runs them). In order, the first failing check decides:
//   1. groupModel === 'apGroup'                         else 'legacyController'
//   2. a Client ID and a Client Secret are configured   else 'managementNotConfigured'
//   3. an access token is acquired                      else 'invalidCredentials' / 'tokenFailed'
//   4. GET /openapi/v1/{omadacId}/sites lists the selected site id   else 'siteNotFound'
//   5. GET …/sites/{siteId}/ap-groups has exactly the id set of the internal
//      setting/wlans list (never matched by name)       else 'apGroupsMismatch'
//   (a read probe of 4 or 5 that cannot be read:        'probeFailed')
//
// Security: the Open API client is created only by a check run of an
// installed session — i.e. after the internal /api/info handshake and login
// passed the certificate pin check — with the same transport (the net
// transport on the pinned ControllerTlsSessions session), and only while the
// configured URL is still this session's URL. close() (called by
// ConnectionManager on every detach/release — URL change, certificate reset
// or trust, disconnect, superseded connect — and as soon as a newer connect
// attempt starts while this session is installed) synchronously closes
// every Open API client the session created (their tokens are dropped) and
// discards the checks in flight: their late results are ignored (sequence +
// closed checks after every await) and nothing more is sent for them; the
// management-access replies then answer notConnected for it at once
// (capabilitiesReply()). The capabilities and
// every reply built here carry flags, reason codes and a diagnostic made of
// error codes and counts only — never the Client Secret, a token or
// controller text. Electron-free (unit-tested in
// tests/unit/controller-session.test.ts).

import type {
  AccessPoint,
  ConfigSavePayload,
  GroupListing,
  GroupModel,
  ManagementCapabilities,
  ManagementCapabilitiesResult,
  ManagementReason,
  SiteInfo
} from '../shared/types';
import { ConnectionManager, createNonce, InstalledDetails, ManagedController } from './connection-manager';
import { ConnectOutcome, OmadaController } from './omada-api';
import type { OmadaTransport } from './omada-transport';
import { OpenApiClient, OpenApiClientOptions, OpenApiError } from './openapi-client';
import { redactText } from './redact';

/** The Open API credentials (main process only — never over IPC or in a log). */
export interface ManagementCredentials {
  clientId: string;
  clientSecret: string;
}

/** Constructor options of ControllerSession (index.ts passes config.ts and the net transport). */
export interface ControllerSessionOptions {
  // The configured controller URL (normalized) and the login credentials
  url: string;
  username: string;
  password: string;
  // The transport of both clients (production: the net transport on the
  // pinned controller session)
  transport: OmadaTransport;
  // The configured management credentials (the session-only secret when that
  // is all there is), read at check time; null when not configured
  getManagementCredentials(): ManagementCredentials | null;
  // The configured controller URL now: credentials are used only while it is
  // still this session's URL
  getConfiguredUrl(): string;
  // Creates the Open API client (the unit tests wrap it to observe the clients)
  createOpenApiClient?(options: OpenApiClientOptions): OpenApiClient;
}

/** A promise with its resolve function exposed. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

/**
 * Creates a deferred promise (never rejects).
 * @returns {Deferred<T>} The promise and its resolve function.
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** The outcome of one check run: the capabilities, and the client to keep (management on only). */
interface CheckOutcome {
  capabilities: ManagementCapabilities;
  client: OpenApiClient | null;
}

/**
 * The capabilities when every check passed.
 * @returns {ManagementCapabilities} Both flags on, no reason.
 */
export function managementOn(): ManagementCapabilities {
  return { manageApGroups: true, manageWifiNetworks: true, reason: null };
}

/**
 * The capabilities when a check failed.
 * @param {ManagementReason} reason - The failing check's reason code.
 * @param {string} [diagnostic] - Technical detail (codes and counts only).
 * @returns {ManagementCapabilities} Both flags off, with the reason.
 */
export function managementOff(reason: ManagementReason, diagnostic?: string): ManagementCapabilities {
  const capabilities: ManagementCapabilities = { manageApGroups: false, manageWifiNetworks: false, reason };
  if (diagnostic) {
    capabilities.diagnostic = diagnostic;
  }
  return capabilities;
}

/**
 * Builds the diagnostic of a failed Open API call from its stable code, HTTP
 * status and controller errorCode only (never its message, which may quote
 * controller text), e.g. "httpError, HTTP 404" or "apiError, errorCode -1".
 * Anything that is not an OpenApiError is reported as "unexpected".
 * @param {unknown} error - The thrown value.
 * @returns {string} The diagnostic.
 */
export function describeOpenApiFailure(error: unknown): string {
  if (!(error instanceof OpenApiError)) {
    return 'unexpected';
  }
  const parts: string[] = [error.code];
  if (error.httpStatus !== null) {
    parts.push(`HTTP ${error.httpStatus}`);
  }
  if (error.controllerErrorCode !== null) {
    parts.push(`errorCode ${error.controllerErrorCode}`);
  }
  return parts.join(', ');
} // End of function describeOpenApiFailure()

/**
 * Compares the Open API AP-group ids with the internal group-list ids as SETS
 * (order and duplicates do not matter; names are never involved).
 * @param {readonly string[]} openApiIds - Ids from GET …/ap-groups.
 * @param {readonly string[]} internalIds - Ids from the internal setting/wlans.
 * @returns {{ equal: boolean; openApiOnly: number; internalOnly: number; shared: number }}
 *   Whether the sets are equal, and the counts of ids in one set only / in both.
 */
export function compareIdSets(
  openApiIds: readonly string[],
  internalIds: readonly string[]
): { equal: boolean; openApiOnly: number; internalOnly: number; shared: number } {
  const openApi = new Set(openApiIds);
  const internal = new Set(internalIds);
  let shared = 0;
  for (const id of openApi) {
    if (internal.has(id)) {
      shared++;
    }
  }
  const openApiOnly = openApi.size - shared;
  const internalOnly = internal.size - shared;
  return { equal: openApiOnly === 0 && internalOnly === 0, openApiOnly, internalOnly, shared };
} // End of function compareIdSets()

/**
 * Tells whether a config save touches the management access (a Client ID, a
 * Client Secret or a removal): the installed session's management state,
 * built with the old credentials, is then dropped (applyManagementAccessChange()).
 * @param {ConfigSavePayload} payload - The (shape-checked) payload.
 * @returns {boolean} True when a management field is present.
 */
export function touchesManagementAccess(payload: ConfigSavePayload): boolean {
  return payload.clientId !== undefined || payload.clientSecret !== undefined || payload.removeManagementAccess !== undefined;
}

/**
 * CONFIG_SAVE follow-up for a successful save that KEPT the controller URL
 * (a URL change is a controller transition instead): when the save touches
 * the management access, the installed session's Open API client — built
 * with the old credentials, its token dropped — and its capabilities are
 * discarded at once (ControllerSession.invalidateCapabilities()), so neither
 * old credentials nor an old verdict outlive the save. No check run starts
 * here: the Settings flow reconnects after every successful save, and the
 * new session's checks (activate()) own the result — exactly one
 * secret-bearing run per save. When no reconnect follows, the next
 * MANAGEMENT_CAPABILITIES or MANAGEMENT_TEST request for this session runs
 * the checks with the new credentials.
 * @param {ConnectionManager<ControllerSession>} manager - The connection state machine.
 * @param {ConfigSavePayload} payload - The saved (shape-checked) payload.
 */
export function applyManagementAccessChange(manager: ConnectionManager<ControllerSession>, payload: ConfigSavePayload): void {
  if (touchesManagementAccess(payload)) {
    manager.controller?.invalidateCapabilities();
  }
}

/**
 * One connected controller: the internal client, the Open API client once
 * management access is verified, and the capabilities (see the header).
 */
export class ControllerSession implements ManagedController {
  readonly url: string;
  // Opaque token of this session: the renderer echoes it with the
  // management-access calls (see getSessionCapabilities())
  readonly sessionNonce: string;
  readonly #internal: OmadaController;
  readonly #transport: OmadaTransport;
  readonly #getManagementCredentials: () => ManagementCredentials | null;
  readonly #getConfiguredUrl: () => string;
  readonly #createOpenApiClient: (options: OpenApiClientOptions) => OpenApiClient;
  #closed = false;
  #activated = false;
  // The result of the latest completed check run (null: not checked yet,
  // checking, or closed)
  #capabilities: ManagementCapabilities | null = null;
  // Bumped by every check run and by close(): a run whose number is no longer
  // current is discarded
  #checkSequence = 0;
  // Settled by the newest check run (or with null by close()); every waiter
  // of a run superseded meanwhile gets the newest result
  #pending: Deferred<ManagementCapabilities | null> | null = null;
  // The client of the latest successful run (kept for the management calls
  // of phases 16–19), and the client of the run in flight
  #openApi: OpenApiClient | null = null;
  #checkClient: OpenApiClient | null = null;

  /**
   * Creates the session. Nothing is sent until connect().
   * @param {ControllerSessionOptions} options - URL, credentials, transport and config accessors.
   */
  constructor(options: ControllerSessionOptions) {
    this.url = options.url;
    this.sessionNonce = createNonce();
    this.#transport = options.transport;
    this.#internal = new OmadaController(options.url, options.username, options.password, options.transport);
    this.#getManagementCredentials = options.getManagementCredentials;
    this.#getConfiguredUrl = options.getConfiguredUrl;
    this.#createOpenApiClient = options.createOpenApiClient ?? ((clientOptions) => new OpenApiClient(clientOptions));
  }

  /**
   * Whether close() was called (the session was detached or released).
   * @returns {boolean} True once closed.
   */
  get isClosed(): boolean {
    return this.#closed;
  }

  /**
   * The controller id (`omadacId`), or null before the connect read it.
   * @returns {string | null} The controller id.
   */
  get omadacId(): string | null {
    return this.#internal.controllerId;
  }

  /**
   * The selected site (id + display name), or null while none is selected.
   * @returns {SiteInfo | null} The site.
   */
  get site(): SiteInfo | null {
    return this.#internal.selectedSite;
  }

  /**
   * The controllerVer /api/info reported (null when absent or not sane).
   * @returns {string | null} The controller version.
   */
  get controllerVersion(): string | null {
    return this.#internal.info.controllerVersion;
  }

  /**
   * The group model derived from the controller version.
   * @returns {GroupModel} 'apGroup' (6.3+) or 'wlanGroup'.
   */
  get groupModel(): GroupModel {
    return this.#internal.info.groupModel;
  }

  /**
   * The capabilities of the latest completed check run (a copy), or null
   * while none completed (not activated, checking) and once closed.
   * @returns {ManagementCapabilities | null} The capabilities.
   */
  get capabilities(): ManagementCapabilities | null {
    return this.#capabilities === null ? null : { ...this.#capabilities };
  }

  /**
   * The verified Open API client — only while the latest completed check run
   * enabled management (null otherwise, while checking and once closed).
   * @returns {OpenApiClient | null} The client.
   */
  get openApiClient(): OpenApiClient | null {
    return this.#openApi;
  }

  /**
   * Connects the internal client (/api/info, login, sites). The capability
   * checks wait for activate(): ConnectionManager activates only the session
   * it installs, never a stale or parked one.
   * @param {string} [preferredSiteId] - The remembered site id.
   * @returns {Promise<ConnectOutcome>} The connect outcome.
   */
  connect(preferredSiteId?: string): Promise<ConnectOutcome> {
    return this.#internal.connect(preferredSiteId);
  }

  /**
   * Selects an authorized site of the internal client.
   * @param {string} siteId - The site id.
   * @returns {boolean} True when accepted.
   */
  selectSite(siteId: string): boolean {
    return this.#internal.selectSite(siteId);
  }

  /**
   * Called by ConnectionManager when the session becomes the installed one:
   * starts the capability checks in the background (once) and returns what
   * the success result carries — the selected site's name and the session
   * nonce.
   * @returns {InstalledDetails} The site name and the session nonce.
   */
  activate(): InstalledDetails {
    if (!this.#activated && !this.#closed) {
      this.#activated = true;
      void this.refreshCapabilities();
    }
    const site = this.site;
    return site ? { siteName: site.name, sessionNonce: this.sessionNonce } : { sessionNonce: this.sessionNonce };
  } // End of function activate()

  /**
   * Synchronously drops everything but the server-side session: every Open
   * API client this session created is closed (its token forgotten), the
   * capabilities are cleared, the check run in flight is discarded (its late
   * result is ignored, nothing more is sent for it) and its waiters get null;
   * no check run can start afterwards. Idempotent. Called by
   * ConnectionManager on every detach / release, and when a newer connect
   * attempt starts while this session is installed (its internal client may
   * keep serving the data until that attempt succeeds).
   */
  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#discardManagementState();
  }

  /**
   * The management credentials changed (applyManagementAccessChange()):
   * synchronously closes every Open API client of this session (built with
   * the old credentials; their tokens forgotten), clears the capabilities
   * and discards the check run in flight (its waiters get null) WITHOUT
   * starting a new run — the next waitForCapabilities() or
   * refreshCapabilities() runs the checks with the credentials configured
   * then. A no-op once closed.
   */
  invalidateCapabilities(): void {
    if (this.#closed) {
      return;
    }
    this.#discardManagementState();
  }

  /**
   * Closes the session (close()) and logs the internal client out
   * (best-effort; network errors are swallowed by OmadaController.logout()).
   * @returns {Promise<void>} Settles when the logout attempt is over.
   */
  async logout(): Promise<void> {
    this.close();
    await this.#internal.logout();
  }

  /**
   * The access points (internal client).
   * @returns {Promise<AccessPoint[]>} The access points, sorted by name.
   */
  getAccessPoints(): Promise<AccessPoint[]> {
    return this.#internal.getAccessPoints();
  }

  /**
   * The group listing (internal client).
   * @returns {Promise<GroupListing>} The groups, version and group model.
   */
  getWlanGroups(): Promise<GroupListing> {
    return this.#internal.getWlanGroups();
  }

  /**
   * Moves an access point into a group (internal client, the only move path).
   * @param {string} mac - The AP's MAC (format-checked by index.ts).
   * @param {string} wlanId - The group id (format-checked by index.ts).
   * @returns {Promise<boolean>} True when the controller accepted it.
   */
  setApWlanGroup(mac: string, wlanId: string): Promise<boolean> {
    return this.#internal.setApWlanGroup(mac, wlanId);
  }

  /**
   * Runs the capability checks again (activation, "Test management access",
   * the first capabilities request after invalidateCapabilities()): the
   * previous Open API client is closed at once (management is off while
   * checking) and a fresh run starts with the credentials configured now. A
   * run still in flight is superseded; its waiters get this run's result.
   * @returns {Promise<ManagementCapabilities | null>} The result, or null when
   *   the session was closed first.
   */
  refreshCapabilities(): Promise<ManagementCapabilities | null> {
    if (this.#closed) {
      return Promise.resolve(null);
    }
    const sequence = ++this.#checkSequence;
    this.#dropOpenApiClients();
    this.#capabilities = null;
    if (this.#pending === null) {
      this.#pending = createDeferred<ManagementCapabilities | null>();
    }
    const pending = this.#pending;
    void this.#runChecks(sequence).then((outcome) => {
      if (outcome === null || sequence !== this.#checkSequence || this.#closed) {
        // Superseded: the newer run (or close()) settles the waiters, and
        // this run's client was closed already
        outcome?.client?.close();
        return;
      }
      this.#capabilities = outcome.capabilities;
      this.#openApi = outcome.client;
      this.#checkClient = null;
      this.#pending = null;
      pending.resolve({ ...outcome.capabilities });
    }); // End of the check run's completion handler
    return pending.promise;
  } // End of function refreshCapabilities()

  /**
   * The capabilities once known: the latest result, or the result of the run
   * in flight (null when the session is closed first). Starts a run when none
   * is known (a session not activated yet, or invalidated by a
   * management-credentials save).
   * @returns {Promise<ManagementCapabilities | null>} The capabilities, or null.
   */
  waitForCapabilities(): Promise<ManagementCapabilities | null> {
    if (this.#closed) {
      return Promise.resolve(null);
    }
    if (this.#pending !== null) {
      return this.#pending.promise;
    }
    if (this.#capabilities !== null) {
      return Promise.resolve({ ...this.#capabilities });
    }
    return this.refreshCapabilities();
  } // End of function waitForCapabilities()

  /**
   * Shared by close() and invalidateCapabilities(): discards the check run in
   * flight (sequence bump: its late result is ignored, nothing more is sent
   * for it), closes every Open API client, clears the capabilities and
   * settles the waiters with null.
   */
  #discardManagementState(): void {
    this.#checkSequence++;
    this.#dropOpenApiClients();
    this.#capabilities = null;
    const pending = this.#pending;
    this.#pending = null;
    pending?.resolve(null);
  }

  /**
   * Closes the current Open API client and the one of the run in flight.
   */
  #dropOpenApiClients(): void {
    this.#openApi?.close();
    this.#openApi = null;
    this.#checkClient?.close();
    this.#checkClient = null;
  }

  /**
   * Runs the checks; never rejects (an unexpected error turns management off
   * with 'probeFailed').
   * @param {number} sequence - This run's number.
   * @returns {Promise<CheckOutcome | null>} The outcome, or null when superseded.
   */
  async #runChecks(sequence: number): Promise<CheckOutcome | null> {
    try {
      return await this.#check(sequence);
    } catch (error) {
      console.warn('Management access check failed unexpectedly:', redactText(error instanceof Error ? error.name : 'unknown error'));
      return { capabilities: managementOff('probeFailed', 'unexpected'), client: null };
    }
  } // End of function #runChecks()

  /**
   * The checks of docs/management-design.md §2.2, in order (see the header).
   * After every await the run stops when it is no longer current (a newer
   * run or close()), so nothing more is sent and nothing is reported for it.
   * The run's Open API client is closed unless management ends up enabled.
   * @param {number} sequence - This run's number.
   * @returns {Promise<CheckOutcome | null>} The outcome, or null when superseded.
   */
  async #check(sequence: number): Promise<CheckOutcome | null> {
    /**
     * Whether this run may still act.
     * @returns {boolean} True while current.
     */
    const isCurrent = (): boolean => sequence === this.#checkSequence && !this.#closed;

    // Check 1: Omada 6.3+ (the version alone never enables management)
    if (this.groupModel !== 'apGroup') {
      return { capabilities: managementOff('legacyController'), client: null };
    }
    // Check 2: credentials configured — for THIS controller only
    const credentials = this.#getConfiguredUrl() === this.url ? this.#getManagementCredentials() : null;
    if (credentials === null) {
      return { capabilities: managementOff('managementNotConfigured'), client: null };
    }
    const omadacId = this.omadacId;
    const site = this.site;
    if (omadacId === null || site === null) {
      return { capabilities: managementOff('probeFailed', 'notConnected'), client: null };
    }

    const client = this.#createOpenApiClient({
      baseUrl: this.url,
      omadacId,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      transport: this.#transport
    });
    this.#checkClient = client;
    /**
     * Turns management off for a failed check and logs it: the reason and
     * the codes-only diagnostic (never controller text, which could echo a
     * credential), passed through the redactor all the same.
     * @param {ManagementReason} reason - The reason code.
     * @param {string} diagnostic - The codes-only diagnostic.
     * @returns {CheckOutcome} The outcome.
     */
    const failed = (reason: ManagementReason, diagnostic: string): CheckOutcome => {
      console.warn(redactText(`Management access check: ${reason} (${diagnostic})`, [credentials.clientSecret]));
      return { capabilities: managementOff(reason, diagnostic), client: null };
    };

    let keepClient = false;
    try {
      // Check 3: token acquisition
      try {
        await client.authorize();
      } catch (error) {
        if (!isCurrent()) return null;
        const reason = error instanceof OpenApiError && error.code === 'invalidCredentials' ? 'invalidCredentials' : 'tokenFailed';
        return failed(reason, describeOpenApiFailure(error));
      }
      if (!isCurrent()) return null;

      // Check 4: the Open API sees the selected internal site (by id)
      let siteIds: string[];
      let sitesTruncated: boolean;
      try {
        const sites = await client.listSites();
        siteIds = sites.items.map((entry) => entry.id);
        sitesTruncated = sites.truncated;
      } catch (error) {
        if (!isCurrent()) return null;
        return failed('probeFailed', `sites: ${describeOpenApiFailure(error)}`);
      }
      if (!isCurrent()) return null;
      if (!siteIds.includes(site.id)) {
        return failed('siteNotFound', sitesTruncated ? `sites ${siteIds.length}, truncated` : `sites ${siteIds.length}`);
      }

      // Check 5: the AP-group id set equals the internal group-list id set
      const [apGroups, internalIds] = await Promise.allSettled([client.listApGroups(site.id), this.#internal.listGroupIds()]);
      if (!isCurrent()) return null;
      if (apGroups.status === 'rejected') {
        return failed('probeFailed', `ap-groups: ${describeOpenApiFailure(apGroups.reason)}`);
      }
      if (internalIds.status === 'rejected') {
        return failed('probeFailed', 'internal group list');
      }
      const comparison = compareIdSets(apGroups.value.items.map((group) => group.id), internalIds.value);
      if (!comparison.equal || apGroups.value.truncated) {
        const truncated = apGroups.value.truncated ? ', truncated' : '';
        return failed(
          'apGroupsMismatch',
          `Open API only ${comparison.openApiOnly}, controller only ${comparison.internalOnly}, shared ${comparison.shared}${truncated}`
        );
      }

      keepClient = true;
      return { capabilities: managementOn(), client };
    } finally {
      if (!keepClient) {
        client.close();
      }
    }
  } // End of function #check()
} // End of class ControllerSession

/**
 * Builds a management-access reply for the installed session the renderer
 * names by its session nonce: notConnected without an installed session or
 * when the installed one is closed already (a newer connect attempt is in
 * flight — answered at once, nothing is run or sent for it), superseded for
 * another session's nonce or when the session changes or closes while `run`
 * is awaited. The reply carries flags, a reason code and a codes-only
 * diagnostic — nothing else.
 * @param {ConnectionManager<ControllerSession>} manager - The connection state machine.
 * @param {string} sessionNonce - The nonce the renderer echoed (format-checked by index.ts).
 * @param {(session: ControllerSession) => Promise<ManagementCapabilities | null>} run - What to await.
 * @returns {Promise<ManagementCapabilitiesResult>} The reply.
 */
async function capabilitiesReply(
  manager: ConnectionManager<ControllerSession>,
  sessionNonce: string,
  run: (session: ControllerSession) => Promise<ManagementCapabilities | null>
): Promise<ManagementCapabilitiesResult> {
  const session = manager.controller;
  if (session === null || session.isClosed) {
    return { success: false, error: 'notConnected' };
  }
  if (session.sessionNonce !== sessionNonce) {
    return { success: false, error: 'superseded' };
  }
  const capabilities = await run(session);
  if (capabilities === null || manager.controller !== session || session.isClosed) {
    return { success: false, error: 'superseded' };
  }
  const reply: ManagementCapabilities = {
    manageApGroups: capabilities.manageApGroups,
    manageWifiNetworks: capabilities.manageWifiNetworks,
    reason: capabilities.reason
  };
  if (capabilities.diagnostic !== undefined) {
    reply.diagnostic = capabilities.diagnostic;
  }
  return { success: true, capabilities: reply };
} // End of function capabilitiesReply()

/**
 * MANAGEMENT_CAPABILITIES: the capabilities of the installed session (waits
 * for the check run in flight).
 * @param {ConnectionManager<ControllerSession>} manager - The connection state machine.
 * @param {string} sessionNonce - The session nonce from the connect result.
 * @returns {Promise<ManagementCapabilitiesResult>} The reply.
 */
export function getSessionCapabilities(manager: ConnectionManager<ControllerSession>, sessionNonce: string): Promise<ManagementCapabilitiesResult> {
  return capabilitiesReply(manager, sessionNonce, (session) => session.waitForCapabilities());
}

/**
 * MANAGEMENT_TEST ("Test management access"): runs the checks of the installed
 * session again with the configured credentials (stored, or session-only) and
 * reports the result, which also becomes the session's capabilities.
 * @param {ConnectionManager<ControllerSession>} manager - The connection state machine.
 * @param {string} sessionNonce - The session nonce from the connect result.
 * @returns {Promise<ManagementCapabilitiesResult>} The reply.
 */
export function testManagementAccess(manager: ConnectionManager<ControllerSession>, sessionNonce: string): Promise<ManagementCapabilitiesResult> {
  return capabilitiesReply(manager, sessionNonce, (session) => session.refreshCapabilities());
}
