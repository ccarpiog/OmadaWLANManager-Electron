// The data side of a cloud controller session (inbox item I-1b1; spec
// autoclaude/processed/10-tplink-cloud-controllers.md, "Architecture" and "AP
// moves on cloud controllers"; docs/omada-cloud-openapi.md §12). A
// ControllerSession built with `kind: 'cloud'` (controller-session.ts) runs on
// a CloudControllerBackend: a controller of the TP-Link cloud account, reached
// through the Open API only — OpenApiClient's cloud route
// (`{serverHost}/v1/cloudaccess/{deviceId}` + the self-hosted path). It has NO
// internal client: nothing here, or in the session for it, ever calls the
// internal API. From the capability checks on (AP groups, Wi-Fi networks,
// bindings) the session runs the very code of the local controller. Pure of
// Electron; unit-tested on fixtures (tests/unit/cloud-controller-session.test.ts).
// ConnectionManager installs one for a cloud target (cloud-connect.ts builds it
// from a fresh organization entry; phase I-1b2b1); no IPC channel switches to
// a cloud target yet (phase I-1b2b2).
//
// Inputs (injected, main only): the organization's omadacId, name and
// orgVersion (from the organization list, never /api/info) and a factory of
// cloud-route OpenApiClients for that organization. A factory rather than
// one client, because the session closes clients as the local one does: one
// data client per connect (sites, the AP and group lists, the moves) and one
// per capability check run (the management client, dropped by every
// invalidation). All of them share the account token and the credential's
// throttle (CloudAccountClient), so a new client costs no token request. A
// created client must be a cloud-route client of this omadacId; anything
// else is closed and refused.
//
// - Version: orgVersion through controller-version.ts (the rule of
//   /api/info's controllerVer). Below 6.3, or without a dotted version,
//   connect() refuses with 'versionTooOld' / 'versionUnknown' before any
//   request (fail-closed: the organization DTO already marks it not
//   connectable), and the capability checks answer 'legacyController'
//   without a request.
// - Sites: connect() reads `GET …/sites` (paged) and picks a site with the
//   local rule (pickSite(): the only one, or the remembered id while it is
//   listed; otherwise the user chooses through ConnectOutcome); selectSite()
//   accepts a listed id only. A listing not proven complete is
//   'listIncomplete' before anything else (a partial list could auto-select
//   the one site it saw); a complete but empty list is 'noSites'.
// - Access points: `GET …/sites/{siteId}/ap-groups/aps`, paged to totalRows
//   (a listing not proven complete is 'listIncomplete', never a shorter
//   list), mapped by toCloudAccessPoint(): a field the controller does not
//   report sanely is unknown, never a default that looks real (status -1,
//   no client count, no group id, '' as the group name).
// - Groups: `GET …/sites/{siteId}/ap-groups` (the call and validator of the
//   management views), mapped by toCloudGroupListing(): every group, empty
//   ones included, with the Open API ids (a move target id IS the Open API
//   id), the SSID names, the default flag and the per-band capacity.
// - AP moves: setApWlanGroup() checks the MAC and the group id with the IPC
//   guards (ipc-guards.ts) before any request, sends `PATCH
//   …/sites/{siteId}/aps/{apMac}/wlan-group` with exactly `{wlanGroupId}`,
//   then re-reads `ap-groups/aps`. The move counts only when a re-read lists
//   the AP in the destination group: up to CLOUD_MOVE_VERIFY_READS reads,
//   CLOUD_MOVE_VERIFY_DELAY_MS apart (injected sleep). Otherwise it fails
//   with a stable code: 'moveRequestFailed' (the PATCH failed),
//   'moveNotConfirmed' (the last read shows the AP in another group, or not
//   at all), 'moveUnverified' (the last read failed, was incomplete without
//   the AP, or reported no group for it). The candidate fallback `PATCH
//   ap-groups/{id}` with `{name, addApMacs}` is deliberately not implemented
//   (spec). The result keeps the shape of omada:set-wlan: true, or a
//   rejection whose message starts with the code.
// - Lifecycle (ManagedController): the session's close() drops the
//   management clients (the shared code); the data client keeps serving
//   until logout() — the release — closes it, as the local internal client
//   serves until its logout. Afterwards every call is 'notConnected'; a call
//   whose client closes while it runs ends as 'superseded'.
// - Errors: CloudSessionError, a stable code (CLOUD_SESSION_ERROR_CODES) and
//   a sanitized diagnostic (codes, plus TP-Link's redacted message for a
//   refusal: describeOpenApiFailure()); its message is "<code> (<diagnostic>)"
//   (describeCloudSessionError(): the code first — the connect result's
//   `detail` and the AP-move rejection both carry this text). `openApiCode`
//   keeps the failed call's OpenApiError code (e.g. 'invalidCredentials',
//   'rateLimited') for the I-1c messages.

import type { AccessPoint, ControllerInfo, GroupListing, SiteInfo, WlanGroup } from '../shared/types';
import { toManagedApGroup } from './ap-group-policy';
import { isOmadacId } from './cloud-account-model';
import type { ControllerBackend, ManagementAccess } from './controller-session';
import { describeController, parseControllerVersion } from './controller-version';
import { MAC_REGEX, WLAN_ID_REGEX } from './ipc-guards';
import { ConnectOutcome, pickSite } from './omada-api';
import {
  apMacKey,
  describeOpenApiFailure,
  MAX_DIAGNOSTIC_CHARS,
  OpenApiApGroup,
  OpenApiApGroupAp,
  OpenApiApGroupList,
  OpenApiClient,
  OpenApiError,
  OpenApiErrorCode,
  OpenApiSite,
  PagedList
} from './openapi-client';
import { redactText } from './redact';

// How many times a move re-reads `ap-groups/aps` at most (the first read
// right after the PATCH), and the pause between two reads (the controller
// may apply the change a moment after accepting it)
export const CLOUD_MOVE_VERIFY_READS = 3;
export const CLOUD_MOVE_VERIFY_DELAY_MS = 1000;

// The statusCategory of an AP whose status the controller does not report:
// a value outside 0–4, which the renderer shows as "unknown" (never as
// disconnected, the internal list's default)
export const UNKNOWN_STATUS_CATEGORY = -1;

// The `deviceType` values of `ap-groups/aps` rows that are no access point
// (the ops doc: "Device type, such as EAP, Gateway"); every other row,
// one without the field included, counts as an AP (the endpoint lists the
// members of AP groups). The real values are unverified live
const NON_AP_DEVICE_TYPES = /^(gateway|switch)$/i;

// Every stable code a cloud session failure can carry (each has an es / en
// text in src/renderer/i18n-strings.ts: cloudSessionError + the code):
// - 'versionTooOld' / 'versionUnknown': orgVersion below 6.3 / not a dotted
//   version; nothing is sent;
// - 'notConnected': no connect, no site selected, or after logout();
// - 'superseded': the call's client was closed (logout, a newer connect, the
//   cloud credential changed) while it ran: its answer is discarded;
// - 'noSites': the controller lists no site;
// - 'listIncomplete': the site, AP or group list could not be proven complete;
// - 'requestFailed': an Open API call failed (diagnostic: the call and codes);
// - 'moveRequestFailed' / 'moveNotConfirmed' / 'moveUnverified': see the header.
export const CLOUD_SESSION_ERROR_CODES = [
  'versionTooOld',
  'versionUnknown',
  'notConnected',
  'superseded',
  'noSites',
  'listIncomplete',
  'requestFailed',
  'moveRequestFailed',
  'moveNotConfirmed',
  'moveUnverified'
] as const;

/** A stable code of CloudSessionError (see CLOUD_SESSION_ERROR_CODES). */
export type CloudSessionErrorCode = (typeof CLOUD_SESSION_ERROR_CODES)[number];

/**
 * The text a cloud session failure reaches the renderer with: the connect
 * result's `detail` (ConnectionManager) and the AP-move rejection's message
 * (CloudSessionError.message, through the IPC registrar). The stable code
 * comes first; then, in parentheses, the failed call's OpenApiError code when
 * the diagnostic does not name it already (describeOpenApiFailure() puts it
 * first), and the diagnostic. The diagnostic is already sanitized: redacted,
 * and on the cloud route scrubbed of the account's secret and tokens and of
 * the routing identifiers (deviceId, serverHost, tunnel URL; phase I-1b1).
 * @param {CloudSessionErrorCode} code - The stable code.
 * @param {string} diagnostic - The sanitized diagnostic ('' for none).
 * @param {OpenApiErrorCode | null} openApiCode - The failed call's code.
 * @returns {string} "<code>", or "<code> (<openApiCode>; <diagnostic>)" without the parts that are empty or repeated.
 */
export function describeCloudSessionError(code: CloudSessionErrorCode, diagnostic: string, openApiCode: OpenApiErrorCode | null): string {
  const parts: string[] = [];
  if (openApiCode !== null && !diagnostic.split(/[^A-Za-z]+/).includes(openApiCode)) {
    parts.push(openApiCode);
  }
  if (diagnostic !== '') {
    parts.push(diagnostic);
  }
  return parts.length === 0 ? code : `${code} (${parts.join('; ')})`;
} // End of function describeCloudSessionError()

/**
 * The failure of a cloud session call: a stable code, a sanitized diagnostic
 * (redacted, at most MAX_DIAGNOSTIC_CHARS characters; codes plus, for a
 * refusal, TP-Link's redacted message) and the failed call's OpenApiError
 * code when there was one. The message is describeCloudSessionError():
 * "<code> (<diagnostic>)", or the code alone.
 */
export class CloudSessionError extends Error {
  readonly code: CloudSessionErrorCode;
  readonly diagnostic: string;
  readonly openApiCode: OpenApiErrorCode | null;

  /**
   * Creates the error; the diagnostic is redacted again here.
   * @param {CloudSessionErrorCode} code - The stable code.
   * @param {string} [diagnostic] - The diagnostic (codes, a scrubbed message).
   * @param {OpenApiErrorCode | null} [openApiCode] - The failed call's code.
   */
  constructor(code: CloudSessionErrorCode, diagnostic = '', openApiCode: OpenApiErrorCode | null = null) {
    const safeDiagnostic = redactText(diagnostic).slice(0, MAX_DIAGNOSTIC_CHARS);
    super(describeCloudSessionError(code, safeDiagnostic, openApiCode));
    this.name = 'CloudSessionError';
    this.code = code;
    this.diagnostic = safeDiagnostic;
    this.openApiCode = openApiCode;
  }
} // End of class CloudSessionError

/**
 * Options of a cloud ControllerSession (`new ControllerSession({kind: 'cloud', …})`).
 * Main only: built from a connectable organization of the cloud account.
 */
export interface CloudControllerSessionOptions {
  kind: 'cloud';
  // The organization (CloudOrganization of cloud-account-model.ts): its
  // omadacId, its display name and its orgVersion (raw or normalized; null
  // when not reported)
  omadacId: string;
  name: string;
  orgVersion: string | null;
  // Creates a cloud-route OpenApiClient for this organization (production:
  // `new OpenApiClient({route: 'cloud', target, tokenProvider, throttle, transport})`
  // with the account client and its throttle)
  createOpenApiClient(): OpenApiClient;
  // The pause between the re-reads of a move (tests inject a fake)
  sleep?: (ms: number) => Promise<void>;
}

/** What one re-read after a move shows (checkMoveRead()). */
export type MoveReadOutcome =
  | { confirmed: true }
  | { confirmed: false; code: 'moveNotConfirmed' | 'moveUnverified'; diagnostic: string };

/**
 * Why a cloud controller cannot be connected for its version (the order of
 * cloudControllerReason(): no dotted version first, then below 6.3).
 * @param {ControllerInfo} info - The version and group model from orgVersion.
 * @returns {'versionTooOld' | 'versionUnknown' | null} The refusal, or null for 6.3+.
 */
export function cloudVersionRefusal(info: ControllerInfo): 'versionTooOld' | 'versionUnknown' | null {
  if (parseControllerVersion(info.controllerVersion) === null) {
    return 'versionUnknown';
  }
  return info.groupModel === 'apGroup' ? null : 'versionTooOld';
}

/**
 * Tells whether an `ap-groups/aps` row is an access point (see
 * NON_AP_DEVICE_TYPES: only a row naming a gateway or a switch is not).
 * @param {OpenApiApGroupAp} row - The validated row.
 * @returns {boolean} True for an AP.
 */
export function isApRow(row: OpenApiApGroupAp): boolean {
  return row.deviceType === undefined || !NON_AP_DEVICE_TYPES.test(row.deviceType);
}

/**
 * Maps one validated `ap-groups/aps` row to the renderer's AccessPoint, the
 * shape the internal list has. A missing field is unknown, never a default
 * that looks real: no name → the MAC (as the internal list does), no status
 * → UNKNOWN_STATUS_CATEGORY, no client count → absent, no group id → no
 * `wlanId`, no group name → ''.
 * @param {OpenApiApGroupAp} row - The validated row.
 * @returns {AccessPoint} The access point.
 */
export function toCloudAccessPoint(row: OpenApiApGroupAp): AccessPoint {
  const ap: AccessPoint = {
    mac: row.mac,
    name: row.name ?? row.mac,
    type: 'ap',
    wlanGroup: row.apGroupName ?? '',
    statusCategory: row.statusCategory ?? UNKNOWN_STATUS_CATEGORY
  };
  if (row.clientNum !== undefined) {
    ap.clientNum = row.clientNum;
  }
  if (row.apGroupId !== undefined) {
    ap.wlanId = row.apGroupId;
  }
  return ap;
} // End of function toCloudAccessPoint()

/**
 * Builds the renderer's GroupListing from the validated Open API AP groups,
 * through the management views' own DTO rules (toManagedApGroup()): every
 * group (empty ones included), `wlanId` = the Open API id, the SSID names
 * (`ssidListUnknown` when the controller did not report them sanely: the
 * list is then empty and means unknown), the default flag and the per-band
 * remaining capacity; sorted by name as the internal listing is.
 * @param {readonly OpenApiApGroup[]} groups - The validated groups.
 * @param {ControllerInfo} info - The controller's version and group model.
 * @returns {GroupListing} The listing.
 */
export function toCloudGroupListing(groups: readonly OpenApiApGroup[], info: ControllerInfo): GroupListing {
  const listed = groups.map((group): WlanGroup => {
    const managed = toManagedApGroup(group);
    const wlan: WlanGroup = { wlanId: managed.id, wlanName: managed.name, ssidList: (managed.networkNames ?? []).map((ssidName) => ({ ssidName })) };
    if (managed.isDefault) {
      wlan.isDefault = true;
    }
    if (managed.networkNames === undefined) {
      wlan.ssidListUnknown = true;
    }
    if (managed.remainingBinding !== undefined) {
      wlan.remainingBinding = { ...managed.remainingBinding };
    }
    return wlan;
  }); // End of the mapping of each AP group
  listed.sort((a, b) => a.wlanName.localeCompare(b.wlanName));
  return { controllerVersion: info.controllerVersion, groupModel: info.groupModel, groups: listed };
} // End of function toCloudGroupListing()

/**
 * Judges one re-read after a move: confirmed only when the list holds the
 * AP (by MAC, apMacKey()) with the destination group's id. An AP in another
 * group, or missing from a complete list, is 'moveNotConfirmed'; missing
 * from an incomplete list, or listed without a group id, 'moveUnverified'.
 * @param {PagedList<OpenApiApGroupAp>} listed - The re-read.
 * @param {string} apMac - The moved AP's MAC.
 * @param {string} wlanGroupId - The destination group id.
 * @returns {MoveReadOutcome} The outcome.
 */
export function checkMoveRead(listed: PagedList<OpenApiApGroupAp>, apMac: string, wlanGroupId: string): MoveReadOutcome {
  const key = apMacKey(apMac);
  const row = listed.items.find((entry) => apMacKey(entry.mac) === key);
  if (row === undefined) {
    return listed.truncated
      ? { confirmed: false, code: 'moveUnverified', diagnostic: 'AP missing from an incomplete list' }
      : { confirmed: false, code: 'moveNotConfirmed', diagnostic: 'AP not listed' };
  }
  if (row.apGroupId === undefined) {
    return { confirmed: false, code: 'moveUnverified', diagnostic: 'AP listed without a group id' };
  }
  if (row.apGroupId !== wlanGroupId) {
    return { confirmed: false, code: 'moveNotConfirmed', diagnostic: 'AP listed in another group' };
  }
  return { confirmed: true };
} // End of function checkMoveRead()

/**
 * The default pause between the re-reads of a move.
 * @param {number} ms - Milliseconds.
 * @returns {Promise<void>} Resolves after the pause.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The data side of a cloud controller session (see the header).
 */
export class CloudControllerBackend implements ControllerBackend {
  readonly kind = 'cloud';
  readonly name: string;
  readonly #omadacId: string;
  readonly #info: ControllerInfo;
  readonly #refusal: 'versionTooOld' | 'versionUnknown' | null;
  readonly #createClient: () => OpenApiClient;
  readonly #sleep: (ms: number) => Promise<void>;
  // The data client of the current connect (null before connect() and after logout())
  #client: OpenApiClient | null = null;
  // The sites the connect listed, and the selected one
  #sites: SiteInfo[] = [];
  #siteId: string | null = null;
  // Set by logout(): the backend never serves again
  #ended = false;

  /**
   * Creates the backend. Nothing is sent until connect().
   * @param {CloudControllerSessionOptions} options - The organization and the client factory.
   * @throws {Error} When the omadacId is unusable or the factory is missing
   *   (fixed text; a programming error of the caller).
   */
  constructor(options: CloudControllerSessionOptions) {
    if (!isOmadacId(options.omadacId)) {
      throw new Error('Cloud controller session needs the organization\'s omadacId');
    }
    if (typeof options.createOpenApiClient !== 'function') {
      throw new Error('Cloud controller session needs a cloud-route Open API client factory');
    }
    this.#omadacId = options.omadacId;
    this.name = typeof options.name === 'string' && options.name !== '' ? options.name : options.omadacId;
    this.#info = describeController(options.orgVersion);
    this.#refusal = cloudVersionRefusal(this.#info);
    this.#createClient = options.createOpenApiClient;
    this.#sleep = options.sleep ?? defaultSleep;
  } // End of constructor

  /**
   * The organization's omadacId (known before any request).
   * @returns {string} The controller id.
   */
  get omadacId(): string {
    return this.#omadacId;
  }

  /**
   * The selected site, or null while none is selected (and after logout()).
   * @returns {SiteInfo | null} A copy of the site.
   */
  get site(): SiteInfo | null {
    const site = this.#sites.find((candidate) => candidate.id === this.#siteId);
    return site ? { ...site } : null;
  }

  /**
   * The version and group model from orgVersion.
   * @returns {ControllerInfo} A copy.
   */
  get info(): ControllerInfo {
    return { ...this.#info };
  }

  /**
   * Lists the controller's sites through the cloud route and picks one with
   * the local rule (see the header). Refused before any request below 6.3.
   * A site list not proven complete is refused ('listIncomplete') before the
   * empty check and the pick, so no site is selected from a partial list.
   * @param {string} [preferredSiteId] - The remembered site id (I-1b2: `cloudSites`).
   * @returns {Promise<ConnectOutcome>} Whether a site is selected, and the sites.
   * @throws {CloudSessionError} 'versionTooOld', 'versionUnknown',
   *   'listIncomplete', 'noSites', 'requestFailed', 'superseded' or
   *   'notConnected'.
   */
  async connect(preferredSiteId?: string): Promise<ConnectOutcome> {
    if (this.#ended) {
      throw new CloudSessionError('notConnected', 'session ended');
    }
    if (this.#refusal !== null) {
      throw new CloudSessionError(this.#refusal, `orgVersion ${this.#info.controllerVersion ?? 'not reported'}`);
    }
    this.#client?.close();
    this.#client = null;
    this.#sites = [];
    this.#siteId = null;
    const client = this.#newClient();
    this.#client = client;
    let listed: PagedList<OpenApiSite>;
    try {
      listed = await client.listSites();
    } catch (error) {
      throw this.#callFailed('requestFailed', 'sites', error, client);
    }
    this.#assertCurrent(client);
    if (listed.truncated) {
      // Fail closed: pickSite() could auto-select the one site a partial list shows
      throw new CloudSessionError('listIncomplete', `sites truncated, ${listed.items.length} listed`);
    }
    const sites = listed.items.map((site) => ({ id: site.id, name: site.name }));
    if (sites.length === 0) {
      throw new CloudSessionError('noSites', 'sites 0');
    }
    this.#sites = sites;
    this.#siteId = pickSite(sites, preferredSiteId);
    return { siteSelected: this.#siteId !== null, sites: sites.map((site) => ({ ...site })) };
  } // End of function connect()

  /**
   * Selects one of the sites the connect listed (the id doubles as an
   * injection guard: it goes into request paths).
   * @param {string} siteId - The site id.
   * @returns {boolean} True when the id was listed.
   */
  selectSite(siteId: string): boolean {
    if (this.#ended || !this.#sites.some((site) => site.id === siteId)) {
      return false;
    }
    this.#siteId = siteId;
    return true;
  }

  /**
   * Ends the data side for good: the data client is closed (its token
   * references dropped; a call in flight ends as 'superseded') and the
   * sites are forgotten. No request: a cloud controller has no server-side
   * session of the app, and the account token belongs to the account client.
   * @returns {Promise<void>} Resolves at once.
   */
  logout(): Promise<void> {
    this.#ended = true;
    this.#client?.close();
    this.#client = null;
    this.#sites = [];
    this.#siteId = null;
    return Promise.resolve();
  }

  /**
   * The access points of the selected site (`ap-groups/aps`, see the header).
   * @returns {Promise<AccessPoint[]>} The access points, sorted by name.
   * @throws {CloudSessionError} 'notConnected', 'listIncomplete', 'requestFailed' or 'superseded'.
   */
  async getAccessPoints(): Promise<AccessPoint[]> {
    const { client, siteId } = this.#connected();
    let listed: PagedList<OpenApiApGroupAp>;
    try {
      listed = await client.listApGroupAps(siteId);
    } catch (error) {
      throw this.#callFailed('requestFailed', 'ap-groups/aps', error, client);
    }
    this.#assertCurrent(client);
    if (listed.truncated) {
      throw new CloudSessionError('listIncomplete', 'ap-groups/aps truncated');
    }
    return listed.items
      .filter(isApRow)
      .map(toCloudAccessPoint)
      .sort((a, b) => a.name.localeCompare(b.name));
  } // End of function getAccessPoints()

  /**
   * The group listing of the selected site (`ap-groups`, see the header).
   * @returns {Promise<GroupListing>} The groups, version and group model.
   * @throws {CloudSessionError} 'notConnected', 'listIncomplete', 'requestFailed' or 'superseded'.
   */
  async getWlanGroups(): Promise<GroupListing> {
    const { client, siteId } = this.#connected();
    let listed: OpenApiApGroupList;
    try {
      listed = await client.listApGroups(siteId);
    } catch (error) {
      throw this.#callFailed('requestFailed', 'ap-groups', error, client);
    }
    this.#assertCurrent(client);
    if (listed.truncated) {
      throw new CloudSessionError('listIncomplete', 'ap-groups truncated');
    }
    return toCloudGroupListing(listed.items, this.#info);
  } // End of function getWlanGroups()

  /**
   * Moves an access point into an AP group and verifies it (see the header):
   * the guards first, the PATCH, then the confirming re-reads.
   * @param {string} mac - The AP's MAC.
   * @param {string} wlanId - The destination AP-group id (an Open API id).
   * @returns {Promise<boolean>} True once a re-read shows the AP in the group.
   * @throws {Error} A guard's fixed text, before any request.
   * @throws {CloudSessionError} 'notConnected', 'moveRequestFailed',
   *   'moveNotConfirmed', 'moveUnverified' or 'superseded'.
   */
  async setApWlanGroup(mac: string, wlanId: string): Promise<boolean> {
    if (typeof mac !== 'string' || !MAC_REGEX.test(mac)) {
      throw new Error('Cloud move rejected: invalid MAC address format');
    }
    if (typeof wlanId !== 'string' || !WLAN_ID_REGEX.test(wlanId)) {
      throw new Error('Cloud move rejected: invalid group id format');
    }
    const { client, siteId } = this.#connected();
    const apMac = apMacKey(mac);
    try {
      await client.setApWlanGroup(siteId, apMac, wlanId);
    } catch (error) {
      throw this.#moveFailed(this.#callFailed('moveRequestFailed', 'aps wlan-group', error, client));
    }
    this.#assertCurrent(client);
    return this.#confirmMove(client, siteId, apMac, wlanId);
  } // End of function setApWlanGroup()

  /**
   * Check 2 of a capability run: the account's access, always configured for
   * a cloud controller (no secret of its own to scrub: the cloud route
   * scrubs the account's).
   * @returns {ManagementAccess} The access of the run.
   */
  managementAccess(): ManagementAccess {
    return {
      secrets: [],
      /**
       * Creates the run's cloud-route client.
       * @returns {OpenApiClient} The client.
       */
      createClient: () => this.#newClient()
    };
  }

  /**
   * Check 5 does not apply: a cloud controller has no internal group list.
   * @returns {null} Always null.
   */
  internalGroupIds(): null {
    return null;
  }

  /**
   * The re-reads after an accepted PATCH (see the header): true at the first
   * read that confirms; otherwise the last read decides the failure.
   * @param {OpenApiClient} client - The data client.
   * @param {string} siteId - The site id.
   * @param {string} apMac - The moved AP's MAC (apMacKey() form).
   * @param {string} wlanId - The destination group id.
   * @returns {Promise<boolean>} True when confirmed.
   * @throws {CloudSessionError} 'moveNotConfirmed', 'moveUnverified' or 'superseded'.
   */
  async #confirmMove(client: OpenApiClient, siteId: string, apMac: string, wlanId: string): Promise<boolean> {
    let last: Exclude<MoveReadOutcome, { confirmed: true }> = { confirmed: false, code: 'moveUnverified', diagnostic: 'not re-read' };
    for (let read = 1; read <= CLOUD_MOVE_VERIFY_READS; read++) {
      if (read > 1) {
        await this.#sleep(CLOUD_MOVE_VERIFY_DELAY_MS);
        this.#assertCurrent(client);
      }
      let listed: PagedList<OpenApiApGroupAp>;
      try {
        listed = await client.listApGroupAps(siteId);
      } catch (error) {
        const failure = this.#callFailed('moveUnverified', 'ap-groups/aps', error, client);
        if (failure.code === 'superseded') {
          throw failure;
        }
        last = { confirmed: false, code: 'moveUnverified', diagnostic: failure.diagnostic };
        continue;
      }
      this.#assertCurrent(client);
      const outcome = checkMoveRead(listed, apMac, wlanId);
      if (outcome.confirmed) {
        return true;
      }
      last = outcome;
    } // End of the loop that re-reads the AP list after the move
    throw this.#moveFailed(new CloudSessionError(last.code, `${last.diagnostic}, ${CLOUD_MOVE_VERIFY_READS} reads`));
  } // End of function #confirmMove()

  /**
   * Creates a client through the factory and checks it: a cloud-route
   * OpenApiClient of this organization's omadacId, else it is closed and
   * refused (nothing was sent with it).
   * @returns {OpenApiClient} The client.
   * @throws {CloudSessionError} 'requestFailed' when the factory fails or yields another client.
   */
  #newClient(): OpenApiClient {
    let client: unknown;
    try {
      client = this.#createClient();
    } catch {
      throw new CloudSessionError('requestFailed', 'cloud route unavailable');
    }
    if (!(client instanceof OpenApiClient) || client.route !== 'cloud' || client.omadacId !== this.#omadacId) {
      if (client instanceof OpenApiClient) {
        client.close();
      }
      throw new CloudSessionError('requestFailed', 'not a cloud-route client of this controller');
    }
    return client;
  } // End of function #newClient()

  /**
   * The data client and the selected site, or 'notConnected'.
   * @returns {{ client: OpenApiClient; siteId: string }} The client and site id.
   * @throws {CloudSessionError} 'notConnected'.
   */
  #connected(): { client: OpenApiClient; siteId: string } {
    const client = this.#client;
    if (this.#ended || client === null || client.isClosed || this.#siteId === null) {
      throw new CloudSessionError('notConnected');
    }
    return { client, siteId: this.#siteId };
  }

  /**
   * Whether a call made with `client` may still use its answer.
   * @param {OpenApiClient} client - The call's client.
   * @returns {boolean} True while it is the open data client.
   */
  #isCurrent(client: OpenApiClient): boolean {
    return !this.#ended && this.#client === client && !client.isClosed;
  }

  /**
   * Throws 'superseded' once `client` is no longer the open data client.
   * @param {OpenApiClient} client - The call's client.
   * @throws {CloudSessionError} 'superseded'.
   */
  #assertCurrent(client: OpenApiClient): void {
    if (!this.#isCurrent(client)) {
      throw new CloudSessionError('superseded');
    }
  }

  /**
   * Turns a failed Open API call into its CloudSessionError: 'superseded'
   * when the client closed meanwhile (the answer is discarded), else `code`
   * with "<call>: <codes>" (plus a refusal's scrubbed message).
   * @param {'requestFailed' | 'moveRequestFailed' | 'moveUnverified'} code - The code of the failure.
   * @param {string} call - The failed call (the diagnostic's prefix).
   * @param {unknown} error - The thrown value.
   * @param {OpenApiClient} client - The call's client.
   * @returns {CloudSessionError} The failure.
   */
  #callFailed(code: 'requestFailed' | 'moveRequestFailed' | 'moveUnverified', call: string, error: unknown, client: OpenApiClient): CloudSessionError {
    if (!this.#isCurrent(client) || (error instanceof OpenApiError && error.code === 'clientClosed')) {
      return new CloudSessionError('superseded');
    }
    return new CloudSessionError(code, `${call}: ${describeOpenApiFailure(error)}`, error instanceof OpenApiError ? error.code : null);
  }

  /**
   * Logs a failed move (its code and diagnostic, through the redactor;
   * 'superseded' is not logged) and returns the failure.
   * @param {CloudSessionError} failure - The failure.
   * @returns {CloudSessionError} The same failure.
   */
  #moveFailed(failure: CloudSessionError): CloudSessionError {
    if (failure.code !== 'superseded') {
      console.warn(redactText(`Cloud AP move failed: ${failure.message}`));
    }
    return failure;
  }
} // End of class CloudControllerBackend
