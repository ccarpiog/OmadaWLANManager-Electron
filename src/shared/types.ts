// Shared types for Omada WLAN Manager

// Supported languages
export type Language = 'es' | 'en';

// Sanitized configuration exposed to the renderer. The password itself never
// leaves the main process — the renderer only learns whether one is stored.
// `pinnedFingerprint` is the SHA-256 fingerprint of the trusted controller
// certificate (public data, shown in Settings), or null when no certificate is
// pinned for the configured controller.
export interface RendererConfig {
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
export interface ConfigSavePayload {
  url: string;
  username: string;
  language: Language;
  password?: string;
}

// Error codes a config save can fail with; the renderer maps them to i18n keys
export type ConfigSaveError = 'invalidUrl' | 'passwordRequired' | 'saveFailed';

// Result of a config save. `connectionReset` is true when the save changed the
// controller URL: the main process then invalidated every in-flight connect
// attempt, discarded any pending site selection / certificate trust decision
// and logged out the installed controller, so the renderer must drop its
// connected UI (it reconnects on its own after a successful save).
export interface ConfigSaveResult {
  success: boolean;
  error?: ConfigSaveError;
  connectionReset?: boolean;
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
} as const;

// Type for IPC channel values
export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
