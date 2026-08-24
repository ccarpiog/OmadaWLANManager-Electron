import { contextBridge, ipcRenderer } from 'electron';
import {
  ConfigSavePayload,
  ConfigSaveResult,
  ConnectionResult,
  AccessPoint,
  WlanGroup,
  IPC_CHANNELS,
  RendererConfig
} from '../shared/types';

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('omadaAPI', {
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

  disconnect: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OMADA_DISCONNECT);
  }
});

// Type declaration for the exposed API (for TypeScript support in renderer)
export interface OmadaAPI {
  loadConfig(): Promise<RendererConfig>;
  saveConfig(config: ConfigSavePayload): Promise<ConfigSaveResult>;
  connect(): Promise<ConnectionResult>;
  getAccessPoints(): Promise<AccessPoint[]>;
  getWlanGroups(): Promise<WlanGroup[]>;
  setApWlanGroup(mac: string, wlanId: string): Promise<boolean>;
  disconnect(): Promise<void>;
}

declare global {
  interface Window {
    omadaAPI: OmadaAPI;
  }
}
