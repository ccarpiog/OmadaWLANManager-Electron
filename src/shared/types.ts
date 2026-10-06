// Shared types for Omada WLAN Manager

// Supported languages
export type Language = 'es' | 'en';

// Sanitized configuration exposed to the renderer. The password itself never
// leaves the main process — the renderer only learns whether one is stored.
export interface RendererConfig {
  url: string;
  username: string;
  language: Language;
  hasPassword: boolean;
}

// Payload the renderer sends when saving settings. `password` is present only
// when the user typed a new one; when absent, the main process keeps the
// previously stored (encrypted) password.
export interface ConfigSavePayload {
  url: string;
  username: string;
  language: Language;
  password?: string;
}

// Error codes a config save can fail with; the renderer maps them to i18n keys
export type ConfigSaveError = 'invalidUrl' | 'passwordRequired' | 'saveFailed';

// Result of a config save
export interface ConfigSaveResult {
  success: boolean;
  error?: ConfigSaveError;
}

// Access Point data from Omada API
export interface AccessPoint {
  mac: string;
  name: string;
  type: string;
  wlanGroup: string;
  statusCategory: number;
}

// WLAN Group data from Omada API
export interface WlanGroup {
  wlanId: string;
  wlanName: string;
  ssidList: Ssid[];
}

// SSID within a WLAN Group
export interface Ssid {
  ssidName: string;
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
export type ConnectionErrorCode =
  | 'configIncomplete'
  | 'connectFailed'
  | 'connectError'
  | 'connectionSuperseded'
  | 'siteUnavailable';

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
export interface ConnectionResult {
  success: boolean;
  error?: ConnectionErrorCode;
  detail?: string;
  needsSiteSelection?: boolean;
  sites?: SiteInfo[];
  selectionNonce?: string;
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
  getWlanGroups(): Promise<WlanGroup[]>;
  setApWlanGroup(mac: string, wlanId: string): Promise<boolean>;
  selectSite(siteId: string, selectionNonce: string): Promise<ConnectionResult>;
  disconnect(selectionNonce?: string): Promise<void>;
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
} as const;

// Type for IPC channel values
export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
