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

// Connection result
export interface ConnectionResult {
  success: boolean;
  error?: string;
}

// Data loaded from controller
export interface ControllerData {
  accessPoints: AccessPoint[];
  wlanGroups: WlanGroup[];
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
  OMADA_DISCONNECT: 'omada:disconnect',
} as const;

// Type for IPC channel values
export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
