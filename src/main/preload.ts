import { contextBridge, ipcRenderer } from 'electron';
import type {
  ConfigSavePayload,
  ConfigSaveResult,
  ConnectionResult,
  AccessPoint,
  WlanGroup,
  IPC_CHANNELS as SHARED_IPC_CHANNELS,
  RendererConfig
} from '../shared/types';

// Local copy of the IPC channel names. This preload runs sandboxed
// (webPreferences.sandbox: true), and a sandboxed preload's polyfilled
// require() can only load a small set of built-in modules — never local
// project files — so the values in shared/types.ts cannot be imported at
// runtime here (all imports above are type-only and erased at compile time).
// The `typeof SHARED_IPC_CHANNELS` annotation checks this copy against the
// shared table, so any drift in names or values fails the build.
const IPC_CHANNELS: typeof SHARED_IPC_CHANNELS = {
  CONFIG_LOAD: 'config:load',
  CONFIG_SAVE: 'config:save',
  OMADA_CONNECT: 'omada:connect',
  OMADA_GET_APS: 'omada:get-aps',
  OMADA_GET_WLANS: 'omada:get-wlans',
  OMADA_SET_WLAN: 'omada:set-wlan',
  OMADA_SELECT_SITE: 'omada:select-site',
  OMADA_DISCONNECT: 'omada:disconnect',
};

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('omadaAPI', {
  // OS platform ('darwin' | 'win32' | 'linux' | ...), captured once at
  // preload time so the renderer can scope platform-specific styling (e.g.
  // the macOS traffic-light padding) without an IPC round-trip. Sandboxed
  // preloads get a polyfilled `process` that includes `platform`
  platform: process.platform,

  // Configuration. loadConfig() returns a sanitized view: the stored
  // password never crosses the bridge, only a hasPassword flag. saveConfig()
  // sends a password only when the user typed a new one (renderer → main).
  loadConfig: (): Promise<RendererConfig> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_LOAD);
  },

  saveConfig: (config: ConfigSavePayload): Promise<ConfigSaveResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE, config);
  },

  // Omada Controller
  connect: (): Promise<ConnectionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OMADA_CONNECT);
  },

  getAccessPoints: (): Promise<AccessPoint[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OMADA_GET_APS);
  },

  getWlanGroups: (): Promise<WlanGroup[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OMADA_GET_WLANS);
  },

  setApWlanGroup: (mac: string, wlanId: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OMADA_SET_WLAN, mac, wlanId);
  },

  // Complete a connection to a multi-site controller: the renderer sends the
  // site id the user chose from the list a connect() result carried, plus the
  // opaque selection nonce that same result carried (echoed back verbatim —
  // the renderer never interprets it)
  selectSite: (siteId: string, selectionNonce: string): Promise<ConnectionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OMADA_SELECT_SITE, siteId, selectionNonce);
  },

  // Disconnect. Without an argument this is the unconditional user-initiated
  // disconnect; with a selection nonce it only aborts the pending site
  // selection owning that nonce (a stale caller's call is a no-op in main)
  disconnect: (selectionNonce?: string): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OMADA_DISCONNECT, selectionNonce);
  }
});

// Type declaration for the exposed API (for TypeScript support in renderer)
export interface OmadaAPI {
  readonly platform: NodeJS.Platform;
  loadConfig(): Promise<RendererConfig>;
  saveConfig(config: ConfigSavePayload): Promise<ConfigSaveResult>;
  connect(): Promise<ConnectionResult>;
  getAccessPoints(): Promise<AccessPoint[]>;
  getWlanGroups(): Promise<WlanGroup[]>;
  setApWlanGroup(mac: string, wlanId: string): Promise<boolean>;
  selectSite(siteId: string, selectionNonce: string): Promise<ConnectionResult>;
  disconnect(selectionNonce?: string): Promise<void>;
}

declare global {
  interface Window {
    omadaAPI: OmadaAPI;
  }
}
