import { contextBridge, ipcRenderer } from 'electron';
import type {
  ApGroupActionResult,
  ApGroupCreateRequest,
  ApGroupDeleteRequest,
  ApGroupRenameRequest,
  CertificateActionResult,
  ConfigSavePayload,
  ConfigSaveResult,
  ConnectionResult,
  AccessPoint,
  GroupListing,
  IPC_CHANNELS as SHARED_IPC_CHANNELS,
  ManagedApGroupsResult,
  ManagedNetworksResult,
  ManagementCapabilitiesResult,
  NetworkActionResult,
  NetworkBindingsRequest,
  NetworkBindingsResult,
  NetworkCreateRequest,
  NetworkDeleteRequest,
  NetworkEnableRequest,
  NetworkPasswordRequest,
  NetworkUpdateRequest,
  OmadaAPI,
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
  CERT_TRUST: 'cert:trust',
  CERT_RESET: 'cert:reset',
  MANAGEMENT_CAPABILITIES: 'management:capabilities',
  MANAGEMENT_TEST: 'management:test',
  MANAGEMENT_AP_GROUPS: 'management:ap-groups',
  MANAGEMENT_AP_GROUP_CREATE: 'management:ap-group-create',
  MANAGEMENT_AP_GROUP_RENAME: 'management:ap-group-rename',
  MANAGEMENT_AP_GROUP_DELETE: 'management:ap-group-delete',
  MANAGEMENT_NETWORKS: 'management:networks',
  MANAGEMENT_NETWORK_CREATE: 'management:network-create',
  MANAGEMENT_NETWORK_UPDATE: 'management:network-update',
  MANAGEMENT_NETWORK_PASSWORD: 'management:network-password',
  MANAGEMENT_NETWORK_ENABLE: 'management:network-enable',
  MANAGEMENT_NETWORK_DELETE: 'management:network-delete',
  MANAGEMENT_NETWORK_BINDINGS: 'management:network-bindings',
};

// Expose a safe API to the renderer process. `satisfies OmadaAPI` (type-only,
// erased at compile time) checks this object against the shared interface the
// renderer is typed with (src/shared/types.ts), so the two cannot drift.
contextBridge.exposeInMainWorld('omadaAPI', {
  // OS platform ('darwin' | 'win32' | 'linux' | ...), captured once at
  // preload time so the renderer can scope platform-specific styling (e.g.
  // the macOS traffic-light padding) without an IPC round-trip. Sandboxed
  // preloads get a polyfilled `process` that includes `platform`
  platform: process.platform,

  // Configuration. loadConfig() returns a sanitized view: the stored
  // password and Open API Client Secret never cross the bridge, only the
  // hasPassword / hasClientSecret flags (and the Client ID, not a secret).
  // saveConfig() sends a password or a Client Secret only when the user typed
  // a new one (renderer → main, once).
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

  // The group list plus the controller version and group model it belongs to
  getWlanGroups: (): Promise<GroupListing> => {
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
  },

  // Certificate pinning. trustCertificate() answers a certificateUntrusted
  // connect result: it sends ONLY the opaque trust nonce that result carried
  // (echoed back verbatim) — the main process pins the fingerprint it
  // recorded itself, never one supplied by the renderer. resetCertificate()
  // forgets the pinned certificate of the configured controller
  trustCertificate: (trustNonce: string): Promise<CertificateActionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CERT_TRUST, trustNonce);
  },

  resetCertificate: (): Promise<CertificateActionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CERT_RESET);
  },

  // Open API management access of the connected controller session: the
  // capabilities (flags + reason code) and "Test management access". Both
  // send only the opaque session nonce of the connect result (echoed back
  // verbatim); the Client Secret never crosses the bridge
  getManagementCapabilities: (sessionNonce: string): Promise<ManagementCapabilitiesResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_CAPABILITIES, sessionNonce);
  },

  testManagementAccess: (sessionNonce: string): Promise<ManagementCapabilitiesResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_TEST, sessionNonce);
  },

  // AP-group management (management on only): the site's AP groups with
  // their capacity, and create / rename / delete. Each sends the session
  // nonce of the connect result (echoed back verbatim) and the request as
  // given; main trims and validates names and re-checks every rule (the
  // delete policy on fresh controller data) itself
  getManagedApGroups: (sessionNonce: string): Promise<ManagedApGroupsResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_AP_GROUPS, sessionNonce);
  },

  createApGroup: (request: ApGroupCreateRequest): Promise<ApGroupActionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_AP_GROUP_CREATE, request);
  },

  renameApGroup: (request: ApGroupRenameRequest): Promise<ApGroupActionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_AP_GROUP_RENAME, request);
  },

  deleteApGroup: (request: ApGroupDeleteRequest): Promise<ApGroupActionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_AP_GROUP_DELETE, request);
  },

  // Wi-Fi network read model (management on only): the site's networks with
  // their scope and bound AP-group ids. Sends only the session nonce of the
  // connect result (echoed back verbatim); the reply never carries a
  // passphrase (only `hasPassphrase`)
  getManagedNetworks: (sessionNonce: string): Promise<ManagedNetworksResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_NETWORKS, sessionNonce);
  },

  // Wi-Fi network writes (management on only): create (open / WPA-Personal,
  // disabled), save the edited basic settings, change the passphrase,
  // enable / disable, delete. Each sends the session nonce of the connect
  // result (echoed back verbatim) and the request as given; main checks every
  // rule and merges a save onto fresh controller data itself. A typed
  // passphrase crosses here renderer → main only: no reply carries one
  createNetwork: (request: NetworkCreateRequest): Promise<NetworkActionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_NETWORK_CREATE, request);
  },

  updateNetwork: (request: NetworkUpdateRequest): Promise<NetworkActionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_NETWORK_UPDATE, request);
  },

  changeNetworkPassword: (request: NetworkPasswordRequest): Promise<NetworkActionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_NETWORK_PASSWORD, request);
  },

  setNetworkEnabled: (request: NetworkEnableRequest): Promise<NetworkActionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_NETWORK_ENABLE, request);
  },

  deleteNetwork: (request: NetworkDeleteRequest): Promise<NetworkActionResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_NETWORK_DELETE, request);
  },

  // A network's AP-group bindings ("Broadcast on", management on only):
  // sends the session nonce of the connect result (echoed back verbatim), the
  // network id and the complete new set of AP-group ids; main plans the change
  // on fresh controller data itself (scope, groups, capacity)
  updateNetworkBindings: (request: NetworkBindingsRequest): Promise<NetworkBindingsResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_NETWORK_BINDINGS, request);
  }
} satisfies OmadaAPI);
