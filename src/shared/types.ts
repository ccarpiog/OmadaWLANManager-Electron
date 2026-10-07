// Shared types for Omada WLAN Manager

// Supported languages
export type Language = 'es' | 'en';

// The optional Open API management access (todo.md 4.8) as the renderer may
// see it — never the Client Secret itself. `clientId` is the stored Client ID
// ('' when none; it is not a secret). `hasClientSecret` is true only when a
// usable secret exists: a safeStorage blob that decrypts, or a secret kept in
// main-process memory for this session only (`clientSecretSessionOnly`, set
// when safeStorage encryption is unavailable: such a secret is never written
// to disk and is gone after a restart). `canPersistClientSecret` tells whether
// a newly typed secret can be stored encrypted (false: it would be kept for
// this session only).
export interface ManagementAccessStatus {
  clientId: string;
  hasClientSecret: boolean;
  clientSecretSessionOnly: boolean;
  canPersistClientSecret: boolean;
}

// Sanitized configuration exposed to the renderer. The password and the Client
// Secret never leave the main process — the renderer only learns whether they
// are stored (plus the management-access flags above).
// `pinnedFingerprint` is the SHA-256 fingerprint of the trusted controller
// certificate (public data, shown in Settings), or null when no certificate is
// pinned for the configured controller.
export interface RendererConfig extends ManagementAccessStatus {
  url: string;
  username: string;
  language: Language;
  hasPassword: boolean;
  pinnedFingerprint: string | null;
}

// Payload the renderer sends when saving settings. `password` is present only
// when the user typed a new one; when absent, the main process keeps the
// previously stored (encrypted) password — but only while the controller URL
// is unchanged: a different URL always requires a typed password.
// Management access (all optional; absent = leave it as stored, except that a
// controller URL change drops the Client ID and the Client Secret):
// - `clientId`: the Client ID to store (trimmed and validated by main);
// - `clientSecret`: present only when the user typed one (needs `clientId`);
//   without it, the stored secret is kept only for the same URL AND the same
//   Client ID — a new Client ID or URL requires a typed secret;
// - `removeManagementAccess`: removes the Client ID and the Client Secret
//   (stored and session-only); sent alone, never with the two fields above.
export interface ConfigSavePayload {
  url: string;
  username: string;
  language: Language;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  removeManagementAccess?: true;
}

// Error codes a config save can fail with; the renderer maps them to i18n
// keys. 'invalidClientId': the Client ID is blank or not a plausible id;
// 'clientIdRequired': a Client Secret was sent without a Client ID;
// 'clientSecretRequired': a new Client ID, or a Client ID for a new controller
// URL, came without a typed Client Secret (an old secret is never reused).
export type ConfigSaveError =
  | 'invalidUrl'
  | 'passwordRequired'
  | 'saveFailed'
  | 'invalidClientId'
  | 'clientIdRequired'
  | 'clientSecretRequired';

// Result of a config save. `connectionReset` is true when the save changed the
// controller URL: the main process then invalidated every in-flight connect
// attempt, discarded any pending site selection / certificate trust decision
// and logged out the installed controller, so the renderer must drop its
// connected UI (it reconnects on its own after a successful save). On success,
// `managementAccess` reports the management-access state after the save
// (flags only, never the secret).
export interface ConfigSaveResult {
  success: boolean;
  error?: ConfigSaveError;
  connectionReset?: boolean;
  managementAccess?: ManagementAccessStatus;
}

// Access Point data from Omada API. `clientNum` (optional) is the number of
// clients connected to the AP, present only when the controller's device
// entry carries it as a non-negative integer (absent = unknown; the UI then
// shows no client count).
export interface AccessPoint {
  mac: string;
  name: string;
  type: string;
  wlanGroup: string;
  statusCategory: number;
  clientNum?: number;
}

// A group access points are assigned to: an AP group on Omada 6.3+, a WLAN
// group on older controllers. The field names are the internal API's: `wlanId`
// is the group id (the AP-group id on 6.3+, the value an AP move sends with
// PATCH eaps/{mac}) and `wlanName` its name. `ssidList` holds the Wi-Fi
// networks the group broadcasts; it is empty for a group without networks
// (assigning an AP to such a group silences it). `isDefault` is present, and
// true, only for the group the controller flags as its default one
// (`primary: true` in the internal setting/wlans list); it is absent for every
// other group and whenever the list came from the legacy setting/ssids
// fallback, which carries no such flag.
export interface WlanGroup {
  wlanId: string;
  wlanName: string;
  ssidList: Ssid[];
  isDefault?: boolean;
}

// One Wi-Fi network (SSID) broadcast by a group
export interface Ssid {
  ssidName: string;
}

// Group model of the connected controller (docs/management-design.md §2.2):
// 'apGroup' for Omada 6.3+, where WLAN groups became AP groups; 'wlanGroup'
// for an older controller, and also when the version is missing or cannot be
// parsed (defensive default). It selects the vocabulary the renderer shows
// ("AP groups" vs "WLAN groups (legacy)").
export type GroupModel = 'apGroup' | 'wlanGroup';

// What the app knows about the connected controller: `controllerVersion` is
// the `controllerVer` string /api/info reported (trimmed; null when absent or
// not a sane string) and `groupModel` the model derived from it.
export interface ControllerInfo {
  controllerVersion: string | null;
  groupModel: GroupModel;
}

// Result of getWlanGroups(): the group list together with the controller info
// it is expressed in, so the renderer always shows a list with the matching
// vocabulary.
export interface GroupListing extends ControllerInfo {
  groups: WlanGroup[];
}

// API response wrapper
export interface OmadaApiResponse<T> {
  errorCode: number;
  msg: string;
  result?: T;
}

// Error codes a connection attempt can fail with; the renderer maps them to
// i18n strings (never hardcoded user-facing text in the main process).
// 'connectionSuperseded': the attempt was discarded because a newer connect or
// a disconnect started while it was in flight (main-process serialization).
// 'siteUnavailable': a site selection targeted an id that is not in the
// authorized-site list, or arrived with no pending controller.
// 'certificateUntrusted': the controller presented a self-signed certificate
// and none is trusted yet (first use) — the result carries `certificate` and
// a `trustNonce` for trustCertificate(). Nothing was sent to the controller.
// 'certificateChanged': the controller presented a self-signed certificate
// that differs from the trusted one — the result carries both fingerprints;
// the connection is refused (the user may reset the pin in Settings).
export type ConnectionErrorCode =
  | 'configIncomplete'
  | 'connectFailed'
  | 'connectError'
  | 'connectionSuperseded'
  | 'siteUnavailable'
  | 'certificateUntrusted'
  | 'certificateChanged';

// The controller certificate a certificateUntrusted/certificateChanged result
// is about. `host` is the configured controller's host (with port);
// fingerprints are SHA-256 over the certificate's DER, colon-separated
// uppercase hex. `pinnedFingerprint` (certificateChanged only) is the trusted one.
export interface CertificateDetails {
  host: string;
  fingerprint: string;
  pinnedFingerprint?: string;
}

// Error codes of the certificate trust/reset actions: 'trustUnavailable' —
// no first-use confirmation is pending for this nonce (superseded by a newer
// connect, a disconnect, or a controller URL change); 'saveFailed' — the
// config could not be written.
export type CertificateActionError = 'trustUnavailable' | 'saveFailed';

// Result of trustCertificate() / resetCertificate(). `connectionReset` (set by
// resetCertificate(), even when the pin could not be removed) means the main
// process closed the connection on its own — any in-flight connect attempt
// was invalidated and the installed controller logged out — so the renderer
// must drop its connected UI.
export interface CertificateActionResult {
  success: boolean;
  error?: CertificateActionError;
  connectionReset?: boolean;
}

// One site of a (possibly multi-site) controller, as offered to the renderer
// for explicit selection. `name` is display-only; `id` addresses the site.
export interface SiteInfo {
  id: string;
  name: string;
}

// Connection result. `detail` optionally carries the underlying technical
// message (e.g. an HTTP error from the API client) for display/diagnostics.
// A success (connect, or selectSite completing a pending connect) carries
// `siteName`, the display name of the site the connection uses (also for a
// single-site controller and a remembered site), and `sessionNonce`, an
// opaque token identifying the installed controller session: the renderer
// echoes it back verbatim with the management-access calls
// (getManagementCapabilities(), testManagementAccess(), the AP-group calls
// and the Wi-Fi network calls), so they only ever act on the session it is
// showing.
// When authentication succeeds but the controller manages several sites and
// none could be picked automatically, `success` is false with no `error`,
// `needsSiteSelection` is true, `sites` lists the authorized sites, and
// `selectionNonce` carries an opaque one-time token; the renderer then
// answers with a selectSite() call that echoes the nonce back verbatim (it
// never interprets it), tying the selection to this exact pending connect in
// the main process.
// Certificate errors (see ConnectionErrorCode) carry `certificate`; a
// first-use result also carries `trustNonce`, an opaque one-time token the
// renderer echoes back verbatim through trustCertificate() — main then pins
// the fingerprint IT recorded, never one supplied by the renderer.
export interface ConnectionResult {
  success: boolean;
  error?: ConnectionErrorCode;
  detail?: string;
  needsSiteSelection?: boolean;
  sites?: SiteInfo[];
  selectionNonce?: string;
  certificate?: CertificateDetails;
  trustNonce?: string;
  siteName?: string;
  sessionNonce?: string;
}

// Why management of AP groups and Wi-Fi networks is off for the connected
// controller (docs/management-design.md §2.2). Main runs the checks in this
// order after a successful connect and reports the first one that fails:
// 'legacyController' — the controller is not Omada 6.3+ (groupModel is not
//   'apGroup'); no Open API request is made;
// 'managementNotConfigured' — no Client ID and Client Secret are configured;
// 'invalidCredentials' — the token endpoint rejected the Client ID / Secret;
// 'tokenFailed' — no access token could be obtained for another reason (no
//   answer, timeout, an HTTP error or an unexpected answer);
// 'siteNotFound' — the Open API site list does not contain the selected
//   site's id (internal and Open API site ids differ, or the application has
//   no access to the site);
// 'apGroupsMismatch' — the Open API AP-group id set differs from the id set
//   of the internal group list (setting/wlans); groups are never matched by name;
// 'probeFailed' — the site or AP-group read probe (or the internal group
//   list it is compared with) could not be read.
export type ManagementReason =
  | 'legacyController'
  | 'managementNotConfigured'
  | 'invalidCredentials'
  | 'tokenFailed'
  | 'siteNotFound'
  | 'apGroupsMismatch'
  | 'probeFailed';

// The management capabilities of the connected controller, computed in main
// (flags plus a reason code — never a raw controller response).
// `manageApGroups` (phase 16) and `manageWifiNetworks` (phases 17–19; the
// network read of getManagedNetworks() and the network writes require it) are
// true only when every §2.2 check passed; `reason` says why they are off
// (null when they are on). `diagnostic` optionally adds a short technical
// detail built by main from error codes and counts only (e.g. "httpError,
// HTTP 404"), never from controller text.
export interface ManagementCapabilities {
  manageApGroups: boolean;
  manageWifiNetworks: boolean;
  reason: ManagementReason | null;
  diagnostic?: string;
}

// Why a management-access call returned no capabilities: 'notConnected' — no
// controller session is installed (not connected, or a site still to pick);
// 'superseded' — the session nonce does not belong to the installed session,
// or the session was replaced or closed while the checks ran.
export type ManagementCheckError = 'notConnected' | 'superseded';

// Result of getManagementCapabilities() / testManagementAccess().
export interface ManagementCapabilitiesResult {
  success: boolean;
  error?: ManagementCheckError;
  capabilities?: ManagementCapabilities;
}

// Why an AP-group management call (todo.md 4.9) failed. Main decides every
// one of them from fresh controller data; the renderer maps them to text.
// Session: 'notConnected' / 'superseded' as for the capabilities (the nonce
//   names no installed session, or the session was replaced, closed or
//   re-checked while the call ran — a late result is discarded);
// 'managementUnavailable' — the capabilities say AP-group management is off;
// Names (create, rename): 'nameRequired' (blank after trimming), 'nameTooLong'
//   (over 128 characters), 'nameInvalid' (control or bidirectional-control
//   characters), 'nameTaken' (another group already has this name, compared
//   case-insensitively — same-named groups cannot be move targets — or the
//   controller reported it as already created), 'nameUnchanged' (a rename to
//   the group's current name: nothing is sent);
// Groups: 'groupNotFound' (the id is not in the controller's AP-group list),
//   'groupIsDefault' (the default group cannot be deleted), 'groupNotEmpty'
//   (it has access points), 'groupHasNetworks' (Wi-Fi networks are bound to
//   it), 'groupStateUnknown' (the controller did not report its AP count or
//   its networks sanely — e.g. a network list with a non-string entry — so
//   the delete policy cannot be verified), 'groupLimitReached'
//   (the controller's AP-group limit), 'groupListIncomplete' (the AP-group list
//   could not be read completely, so the name or delete rules cannot be
//   verified);
// 'requestFailed' — the controller could not be asked or refused for another
//   reason (`diagnostic` carries error codes only).
export type ApGroupOperationError =
  | ManagementCheckError
  | 'managementUnavailable'
  | 'nameRequired'
  | 'nameTooLong'
  | 'nameInvalid'
  | 'nameTaken'
  | 'nameUnchanged'
  | 'groupNotFound'
  | 'groupIsDefault'
  | 'groupNotEmpty'
  | 'groupHasNetworks'
  | 'groupStateUnknown'
  | 'groupLimitReached'
  | 'groupListIncomplete'
  | 'requestFailed';

// Per-band numbers of one AP group (2.4, 5 and 6 GHz). A band is present only
// when the controller reported a sane non-negative integer for it.
export interface ApGroupBandValues {
  band2g?: number;
  band5g?: number;
  band6g?: number;
}

// The controller's per-group SSID limits (the same for every group of the
// site), per band plus MLO; each present only when reported sanely.
export interface ApGroupSsidLimits extends ApGroupBandValues {
  mlo?: number;
}

// One AP group as the management views see it (Open API data, validated in
// main). `id` addresses the group (the same value as the internal `wlanId`:
// the capability checks verified the two id sets are equal). `isDefault` is
// true only when the controller flags the group as the default one.
// `apCount` (APs in the group), `networkNames` (the Wi-Fi networks bound to
// it) and `remainingBinding` (how many more networks each band can take) are
// absent when the controller did not report them sanely — never invented.
export interface ManagedApGroup {
  id: string;
  name: string;
  isDefault: boolean;
  apCount?: number;
  networkNames?: string[];
  remainingBinding?: ApGroupBandValues;
}

// Result of getManagedApGroups(): the site's AP groups with their capacity,
// plus the per-group SSID limits when reported.
export interface ManagedApGroupsResult {
  success: boolean;
  error?: ApGroupOperationError;
  diagnostic?: string;
  groups?: ManagedApGroup[];
  ssidLimits?: ApGroupSsidLimits;
}

// Payloads of the AP-group write calls. Each carries the session nonce of the
// connect result (echoed back verbatim) and nothing else than listed here;
// main trims and validates the name and checks every rule itself.
export interface ApGroupCreateRequest {
  sessionNonce: string;
  name: string;
}

export interface ApGroupRenameRequest {
  sessionNonce: string;
  apGroupId: string;
  name: string;
}

export interface ApGroupDeleteRequest {
  sessionNonce: string;
  apGroupId: string;
}

// Result of createApGroup() / renameApGroup() / deleteApGroup(). A successful
// create carries `apGroupId` when main could identify the new group (from the
// controller's answer, else from a fresh list); without it the renderer
// reloads and finds the group by its name.
export interface ApGroupActionResult {
  success: boolean;
  error?: ApGroupOperationError;
  diagnostic?: string;
  apGroupId?: string;
}

// The security mode of a Wi-Fi network (Open API `security`: 0 open, 2
// WPA-Enterprise, 3 WPA-Personal, 4 PPSK without RADIUS, 5 PPSK with RADIUS).
// 'unknown' when the controller reported it in no sane way, reported another
// value, or its catalog and detail disagree — never guessed.
export type NetworkSecurity = 'open' | 'wpaEnterprise' | 'wpaPersonal' | 'ppskWithoutRadius' | 'ppskWithRadius' | 'unknown';

// One radio band of a Wi-Fi network (the same keys as ApGroupBandValues)
export type NetworkBand = 'band2g' | 'band5g' | 'band6g';

// Where a Wi-Fi network is broadcast: 'allAccessPoints' — the controller
// reports "all devices" (`chooseDevices` 0); 'apGroups' — it reports "not all
// devices" (`chooseDevices` 1) and its bound AP groups are known
// (`apGroupIds`); 'unknown' — anything else (a missing, unrecognized or
// contradictory device selection, or unknown bindings), never "all".
export type NetworkScope = 'allAccessPoints' | 'apGroups' | 'unknown';

// One Wi-Fi network as the management views see it (Open API data, validated
// in main and built by allowlist: it never carries a passphrase, PSK / PPSK
// key, RADIUS secret or any other controller field). `null` means unknown
// (not reported sanely, or contradictory) — never a default:
// - `bands` — the bands it uses, in the order 2.4 / 5 / 6 GHz;
// - `enabled` — its enable state (spec §5 fallback);
// - `hasPassphrase` — true for a WPA-Personal network whose passphrase the
//   controller reports as set, false for an open network, null otherwise
//   (the passphrase itself never leaves main);
// - `apGroupIds` — the ids of the AP groups it is bound to (the same values
//   as the internal `wlanId`s), as the controller reports them, also for an
//   'allAccessPoints' network.
export interface ManagedNetwork {
  id: string;
  name: string;
  security: NetworkSecurity;
  bands: NetworkBand[] | null;
  enabled: boolean | null;
  hasPassphrase: boolean | null;
  scope: NetworkScope;
  apGroupIds: string[] | null;
}

// Why getManagedNetworks() failed. 'notConnected' / 'superseded' as for the
// capabilities (a late result is discarded); 'managementUnavailable' — the
// capabilities say Wi-Fi network management is off; 'networkListIncomplete'
// — the controller lists more networks than one read handles (or the list
// could not be read completely); 'requestFailed' — the controller could not
// be asked, refused, or answered something malformed (`diagnostic` carries
// the failed call and error codes only).
export type ManagedNetworksError = ManagementCheckError | 'managementUnavailable' | 'networkListIncomplete' | 'requestFailed';

// Result of getManagedNetworks(): the site's Wi-Fi networks, in the
// controller's catalog order.
export interface ManagedNetworksResult {
  success: boolean;
  error?: ManagedNetworksError;
  diagnostic?: string;
  networks?: ManagedNetwork[];
}

// The security modes a Wi-Fi network can be created with or edited to (todo.md
// 4.11): open and WPA-Personal only. Enterprise and PPSK networks can be
// enabled / disabled and deleted, never created or edited.
export type WritableNetworkSecurity = Extract<NetworkSecurity, 'open' | 'wpaPersonal'>;

// Why a Wi-Fi network write (todo.md 4.11) failed. Main decides every one of
// them, on FRESH controller data where the rule depends on it; the renderer
// maps them to text.
// Session: 'notConnected' / 'superseded' as for the capabilities (a late
//   result is discarded); 'managementUnavailable' — the capabilities say Wi-Fi
//   network management is off;
// Name: 'nameRequired' (blank after trimming), 'nameTooLong' (over 32 bytes
//   of UTF-8 — or the controller said so), 'nameInvalid' (control or
//   bidirectional-control characters), 'nameTaken' (the controller reports a
//   network with this name, or the emergency network's name);
// Passphrase: 'passphraseRequired' (a WPA-Personal create, or a save whose
//   result is WPA-Personal, came without a typed passphrase — spec §3: the
//   current one is never reused), 'passphraseInvalid' (not 8–63 printable
//   ASCII characters), 'passphraseNotApplicable' (a passphrase for a network
//   whose result is open);
// Settings: 'bandsRequired' (no band), 'groupsRequired' (a create bound to no
//   AP group), 'unsupportedSecurity' (Enterprise, PPSK or an unknown mode —
//   asked for by the renderer, or reported by the fresh detail, or refused by
//   the controller), 'nothingToChange' (an edit without any edited field),
//   'bandLimitReached' (the controller's per-band network limit),
//   'securityBandConflict' (the requested security / band combination
//   conflicts with a setting the app does not change — e.g. Enhanced IoT
//   Connectivity on a network gaining 5 / 6 GHz — or with what the create
//   request can carry — an open network on 6 GHz needs OWE; `diagnostic`
//   names the conflicting field);
// Fresh data: 'groupNotFound' (a create's AP group is not in the controller's
//   AP-group list), 'groupListIncomplete' (that list could not be read
//   completely), 'networkStateUnknown' (the fresh detail lacks a setting the
//   save must carry unchanged, or reports one with the wrong type, so it
//   cannot be merged safely);
// 'requestFailed' — the controller could not be asked, refused for another
//   reason or answered something malformed (`diagnostic` carries the failed
//   call and error codes only).
export type NetworkOperationError =
  | ManagementCheckError
  | 'managementUnavailable'
  | 'nameRequired'
  | 'nameTooLong'
  | 'nameInvalid'
  | 'nameTaken'
  | 'passphraseRequired'
  | 'passphraseInvalid'
  | 'passphraseNotApplicable'
  | 'bandsRequired'
  | 'groupsRequired'
  | 'unsupportedSecurity'
  | 'nothingToChange'
  | 'bandLimitReached'
  | 'securityBandConflict'
  | 'groupNotFound'
  | 'groupListIncomplete'
  | 'networkStateUnknown'
  | 'requestFailed';

// Payloads of the Wi-Fi network write calls (todo.md 4.11). Each carries the
// session nonce of the connect result (echoed back verbatim) and nothing else
// than listed here. `passphrase` is present only when the user typed one: it
// crosses IPC renderer → main only, and never comes back in any reply.
// `security` may name any NetworkSecurity value; main refuses every mode but
// 'open' and 'wpaPersonal' with 'unsupportedSecurity'. Main trims and
// validates the name, checks the passphrase and every rule itself.

// Create a network: disabled, bound to the given AP groups (24-hex ids).
export interface NetworkCreateRequest {
  sessionNonce: string;
  name: string;
  security: NetworkSecurity;
  bands: NetworkBand[];
  apGroupIds: string[];
  passphrase?: string;
}

// Save the basic settings of a network (read-merge-write in main): only the
// edited fields are present; every other setting is kept as the controller
// reports it. A save whose result is WPA-Personal needs `passphrase`.
export interface NetworkUpdateRequest {
  sessionNonce: string;
  networkId: string;
  name?: string;
  security?: NetworkSecurity;
  bands?: NetworkBand[];
  passphrase?: string;
}

// "Change password" of a WPA-Personal network
export interface NetworkPasswordRequest {
  sessionNonce: string;
  networkId: string;
  passphrase: string;
}

// Enable or disable a network (its dedicated endpoint; no passphrase needed)
export interface NetworkEnableRequest {
  sessionNonce: string;
  networkId: string;
  enabled: boolean;
}

// Delete a network
export interface NetworkDeleteRequest {
  sessionNonce: string;
  networkId: string;
}

// Result of every Wi-Fi network write. A successful create carries
// `networkId` when main could identify the new network (from the
// controller's answer, else the one catalog id that is new since the
// pre-create catalog read AND carries the requested name — never a name
// match alone); without it the renderer reloads and finds the network by its
// name. Never a passphrase.
export interface NetworkActionResult {
  success: boolean;
  error?: NetworkOperationError;
  diagnostic?: string;
  networkId?: string;
}

// Data loaded from controller
export interface ControllerData {
  accessPoints: AccessPoint[];
  wlanGroups: WlanGroup[];
}

// The API the preload exposes to the renderer as `window.omadaAPI` (see
// src/main/preload.ts, which checks its bridge object against this interface,
// and src/renderer/global.d.ts, which declares it on Window). `platform` is
// the Node `process.platform` value ('darwin' | 'win32' | 'linux' | ...),
// typed as a plain string so the renderer type-check needs no Node typings.
export interface OmadaAPI {
  readonly platform: string;
  loadConfig(): Promise<RendererConfig>;
  saveConfig(config: ConfigSavePayload): Promise<ConfigSaveResult>;
  connect(): Promise<ConnectionResult>;
  getAccessPoints(): Promise<AccessPoint[]>;
  getWlanGroups(): Promise<GroupListing>;
  setApWlanGroup(mac: string, wlanId: string): Promise<boolean>;
  selectSite(siteId: string, selectionNonce: string): Promise<ConnectionResult>;
  disconnect(selectionNonce?: string): Promise<void>;
  trustCertificate(trustNonce: string): Promise<CertificateActionResult>;
  resetCertificate(): Promise<CertificateActionResult>;
  getManagementCapabilities(sessionNonce: string): Promise<ManagementCapabilitiesResult>;
  testManagementAccess(sessionNonce: string): Promise<ManagementCapabilitiesResult>;
  getManagedApGroups(sessionNonce: string): Promise<ManagedApGroupsResult>;
  createApGroup(request: ApGroupCreateRequest): Promise<ApGroupActionResult>;
  renameApGroup(request: ApGroupRenameRequest): Promise<ApGroupActionResult>;
  deleteApGroup(request: ApGroupDeleteRequest): Promise<ApGroupActionResult>;
  getManagedNetworks(sessionNonce: string): Promise<ManagedNetworksResult>;
  createNetwork(request: NetworkCreateRequest): Promise<NetworkActionResult>;
  updateNetwork(request: NetworkUpdateRequest): Promise<NetworkActionResult>;
  changeNetworkPassword(request: NetworkPasswordRequest): Promise<NetworkActionResult>;
  setNetworkEnabled(request: NetworkEnableRequest): Promise<NetworkActionResult>;
  deleteNetwork(request: NetworkDeleteRequest): Promise<NetworkActionResult>;
}

// IPC channel names (type-safe)
export const IPC_CHANNELS = {
  // Config operations
  CONFIG_LOAD: 'config:load',
  CONFIG_SAVE: 'config:save',

  // Omada operations
  OMADA_CONNECT: 'omada:connect',
  OMADA_GET_APS: 'omada:get-aps',
  OMADA_GET_WLANS: 'omada:get-wlans',
  OMADA_SET_WLAN: 'omada:set-wlan',
  OMADA_SELECT_SITE: 'omada:select-site',
  OMADA_DISCONNECT: 'omada:disconnect',

  // Certificate pinning (trust on first use)
  CERT_TRUST: 'cert:trust',
  CERT_RESET: 'cert:reset',

  // Open API management access: the capabilities of the installed session,
  // and "Test management access" (runs the checks again)
  MANAGEMENT_CAPABILITIES: 'management:capabilities',
  MANAGEMENT_TEST: 'management:test',

  // AP-group management (Open API, management on only): the site's AP groups
  // with their capacity, and create / rename / delete
  MANAGEMENT_AP_GROUPS: 'management:ap-groups',
  MANAGEMENT_AP_GROUP_CREATE: 'management:ap-group-create',
  MANAGEMENT_AP_GROUP_RENAME: 'management:ap-group-rename',
  MANAGEMENT_AP_GROUP_DELETE: 'management:ap-group-delete',

  // Wi-Fi network read model (Open API, management on only): the site's
  // networks with their scope and bindings, never a passphrase
  MANAGEMENT_NETWORKS: 'management:networks',

  // Wi-Fi network writes (Open API, management on only): create (open /
  // WPA-Personal, disabled), save basic settings (read-merge-write), change
  // the passphrase, enable / disable, delete. A typed passphrase crosses
  // renderer → main only, never back
  MANAGEMENT_NETWORK_CREATE: 'management:network-create',
  MANAGEMENT_NETWORK_UPDATE: 'management:network-update',
  MANAGEMENT_NETWORK_PASSWORD: 'management:network-password',
  MANAGEMENT_NETWORK_ENABLE: 'management:network-enable',
  MANAGEMENT_NETWORK_DELETE: 'management:network-delete',
} as const;

// Type for IPC channel values
export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
