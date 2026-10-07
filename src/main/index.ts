import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, session } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  clearCertificatePin,
  getCertificatePin,
  getCloudCredentials,
  getConfiguredUrl,
  getConnectionCredentials,
  getManagementCredentials,
  getRendererConfig,
  getStoredSiteId,
  saveCertificatePin,
  saveConfig,
  saveStoredSiteId
} from './config';
import { CertificateTrustSource, ControllerTlsSessions, installCertificateVerifyProc, isCertificateErrorAllowed } from './cert-verify';
import { CloudAccessService } from './cloud-access';
import { isCloudRegion } from './cloud-hosts';
import { createCloudSession } from './cloud-transport';
import { ConnectionManager } from './connection-manager';
import {
  applyManagementAccessChange,
  changeNetworkPasswordReply,
  ControllerSession,
  createApGroupReply,
  createNetworkReply,
  deleteApGroupReply,
  deleteNetworkReply,
  getSessionCapabilities,
  managedApGroupsReply,
  managedNetworksReply,
  renameApGroupReply,
  setNetworkEnabledReply,
  testManagementAccess,
  updateNetworkBindingsReply,
  updateNetworkReply
} from './controller-session';
import {
  MAC_REGEX,
  NONCE_REGEX,
  parseApGroupCreateRequest,
  parseApGroupDeleteRequest,
  parseApGroupRenameRequest,
  parseNetworkBindingsRequest,
  parseNetworkCreateRequest,
  parseNetworkDeleteRequest,
  parseNetworkEnableRequest,
  parseNetworkPasswordRequest,
  parseNetworkUpdateRequest,
  requireNoExtraArguments,
  requireSessionNonce,
  WLAN_ID_REGEX
} from './ipc-guards';
import { createTrustedIpcRegistrar } from './ipc-trust';
import { createCloudNetTransport, createNetTransport } from './net-transport';
import { redactErrorMessage } from './redact';
import {
  AccessPoint,
  ApGroupActionResult,
  CertificateActionResult,
  CloudAccessResult,
  ConfigSavePayload,
  ConfigSaveResult,
  IPC_CHANNELS,
  ConnectionResult,
  GroupListing,
  ManagedApGroupsResult,
  ManagedNetworksResult,
  ManagementCapabilitiesResult,
  NetworkActionResult,
  NetworkBindingsResult,
  RendererConfig
} from '../shared/types';

// Global reference to prevent garbage collection
let mainWindow: BrowserWindow | null = null;

// ============================================================================
// Controller connection state and certificate trust-on-first-use (todo.md
// 3.12, 1.11, 4.4)
// ============================================================================

// The session every controller request uses (created when the app is ready;
// see ControllerTlsSessions in cert-verify.ts for why it is replaceable)
let controllerTls: ControllerTlsSessions | null = null;

/**
 * Returns the current controller session (see controllerTls).
 * @returns {Electron.Session} The session controller requests must use.
 */
function getControllerSession(): Electron.Session {
  if (!controllerTls) {
    throw new Error('Controller session requested before the app was ready');
  }
  return controllerTls.session;
}

// Production transport: Electron's net module on the current controller
// session (net-transport.ts). Both clients of a ControllerSession — the
// internal one and the Open API one — use it, so every Open API call goes
// through the same pinned, replaceable session as the internal calls
const controllerTransport = createNetTransport(getControllerSession);

// The connection state machine (connection-manager.ts): connect generation,
// installed controller session, pending site selection, pending certificate
// trust and the pin-rejection bookkeeping, plus the atomic controller
// transitions run on a controller URL change and on a certificate reset. Each
// controller is a ControllerSession (controller-session.ts): the facade over
// the internal client and, once management access is verified, the Open API
// client, with the management capabilities. The IPC handlers below only
// check the sender and the payload shapes, then delegate to these two.
const connectionManager = new ConnectionManager<ControllerSession>({
  getCredentials: getConnectionCredentials,
  createController: (credentials) =>
    new ControllerSession({ ...credentials, transport: controllerTransport, getManagementCredentials, getConfiguredUrl }),
  getConfiguredUrl,
  getStoredSiteId,
  saveStoredSiteId,
  saveCertificatePin,
  clearCertificatePin,
  // ControllerTlsSessions.reset() switches sessions synchronously (the
  // contract resetControllerSession() requires) and retires the old one
  // after the drain
  resetControllerSession: (drain) => (controllerTls ? controllerTls.reset(drain) : Promise.resolve())
});

// ============================================================================
// TP-Link cloud access (inbox item I-1a, docs/omada-cloud-openapi.md)
// ============================================================================

// The cloud's own session (created when the app is ready): an in-memory
// partition with Chromium's normal certificate verification — no TOFU pin,
// no verify proc, no certificate dialog (cloud-transport.ts). The pinned
// controller session above never carries a cloud request, and this one never
// a controller request
let cloudSession: Electron.Session | null = null;

/**
 * Returns the cloud session (see cloudSession).
 * @returns {Electron.Session} The session cloud requests must use.
 */
function getCloudSession(): Electron.Session {
  if (!cloudSession) {
    throw new Error('Cloud session requested before the app was ready');
  }
  return cloudSession;
}

// The cloud access: one CloudAccountClient (and throttle) per saved cloud
// credential, over the cloud transport (its own session, the cloud origin
// allowlist enforced before anything is sent, redirects refused)
const cloudAccess = new CloudAccessService({ getCredentials: getCloudCredentials, transport: createCloudNetTransport(getCloudSession) });

// Trust inputs of the certificate hooks: the configured URL and the pin come
// from the in-memory config cache (the verify proc is a hot path and must
// never touch the filesystem); rejections are recorded for OMADA_CONNECT
const certificateTrustSource: CertificateTrustSource = {
  getConfiguredUrl,
  getCertificatePin,
  onPinRejection: (rejection) => connectionManager.recordPinRejection(rejection)
};

// ============================================================================
// IPC boundary validation
// ============================================================================

// Absolute path of the packaged renderer HTML. Every IPC call must originate
// from a frame whose file: URL resolves to exactly this file
const RENDERER_HTML_PATH = path.normalize(path.join(__dirname, '../renderer/index.html'));

// Format guards for identifiers crossing the IPC boundary. The renderer
// applies the same patterns (src/renderer/validation.ts — keep both in sync).
// The AP-move guards, MAC_REGEX and WLAN_ID_REGEX, come from ipc-guards.ts
// (the cloud controller session checks a move with them too)
const SITE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
// The opaque nonces (site selection, certificate trust, the controller
// session) are checked with NONCE_REGEX, and the session-owned management
// payloads with the guards of ipc-guards.ts (pure, unit-tested, shared with
// the smoke stub)

// Length caps for strings arriving over IPC (defense against absurd payloads)
const MAX_URL_LENGTH = 2048;
const MAX_USERNAME_LENGTH = 256;
const MAX_PASSWORD_LENGTH = 512;
// Open API management access and TP-Link cloud access: the raw Client ID
// fields (trimmed and validated against CLIENT_ID_REGEX by config-model.ts)
// and the Client Secrets
const MAX_CLIENT_ID_LENGTH = 256;
const MAX_CLIENT_SECRET_LENGTH = 512;

// The only keys a config-save payload may carry (ConfigSavePayload)
const CONFIG_SAVE_KEYS = new Set([
  'url',
  'username',
  'language',
  'password',
  'clientId',
  'clientSecret',
  'removeManagementAccess',
  'cloudRegion',
  'cloudClientId',
  'cloudClientSecret',
  'removeCloudAccess'
]);

/**
 * Returns true when an IPC call originates from the app's own renderer: the
 * sender frame's URL must be a file: URL that resolves to the packaged
 * index.html. Comparing decoded filesystem paths (instead of raw URL strings)
 * avoids false negatives from percent-encoding differences. Calls from any
 * other frame, or with a missing/unparseable sender URL, are untrusted.
 * @param {IpcMainInvokeEvent} event - The IPC invoke event.
 * @returns {boolean} True when the sender frame is the app's renderer.
 */
function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) {
    return false;
  }
  try {
    const senderUrl = new URL(frame.url);
    if (senderUrl.protocol !== 'file:') {
      return false;
    }
    return path.normalize(fileURLToPath(senderUrl.href)) === RENDERER_HTML_PATH;
  } catch {
    return false;
  }
} // End of function isTrustedIpcSender()

/**
 * The stored secrets a failing IPC handler's message is scrubbed of by value
 * (ipc-trust.ts): the controller password, the Open API Client Secret, the
 * cloud Client Secret, and the live cloud secret and account tokens of the
 * cloud access. Read only on an error path; never throws.
 * @returns {string[]} The secrets configured now (none when not configured
 *   or unreadable).
 */
function storedSecrets(): string[] {
  try {
    const secrets = [getConnectionCredentials().password];
    const management = getManagementCredentials();
    if (management) {
      secrets.push(management.clientSecret);
    }
    const cloud = getCloudCredentials();
    if (cloud) {
      secrets.push(cloud.clientSecret);
    }
    secrets.push(...cloudAccess.liveSecrets());
    return secrets;
  } catch {
    return [];
  }
} // End of function storedSecrets()

// assertTrustedIpcSender(): every invoke channel is registered through this
// registrar (ipc-trust.ts), which runs isTrustedIpcSender() before the
// handler body and lets a failure cross to the renderer (and into Electron's
// "Error occurred in handler" log line) only as a redacted message, with the
// stored secrets and the call's own secrets scrubbed by value.
// tests/unit/ipc-surface.test.ts checks that index.ts registers every
// IPC_CHANNELS channel through it exactly once and nothing through ipcMain
// directly
const handleTrusted = createTrustedIpcRegistrar<IpcMainInvokeEvent>(ipcMain, isTrustedIpcSender, storedSecrets).handle;

/**
 * Runtime shape guard for the config-save payload arriving over IPC: it must
 * be a plain object carrying only ConfigSavePayload keys, with non-empty
 * string url/username within the length caps, a supported language, and —
 * when present — a string password, a non-empty string clientId and a
 * non-empty string clientSecret within their length caps, and
 * removeManagementAccess only as the literal true and never together with
 * clientId/clientSecret; the same for the cloud fields (cloudRegion one of the
 * regions, cloudClientId / cloudClientSecret non-empty strings within the
 * caps, removeCloudAccess only as the literal true and never with the other
 * three). Detailed value validation (URL normalization, the password,
 * management-access and cloud-access keep/require rules, the Client ID
 * formats) stays in saveConfig().
 * @param {unknown} payload - The raw IPC payload.
 * @returns {payload is ConfigSavePayload} True when the shape is valid.
 */
function isValidConfigSavePayload(payload: unknown): payload is ConfigSavePayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }
  const raw = payload as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !CONFIG_SAVE_KEYS.has(key))) {
    return false;
  }
  if (typeof raw.url !== 'string' || raw.url.length === 0 || raw.url.length > MAX_URL_LENGTH) {
    return false;
  }
  if (typeof raw.username !== 'string' || raw.username.length === 0 || raw.username.length > MAX_USERNAME_LENGTH) {
    return false;
  }
  // Supported languages (see Language in shared/types.ts)
  if (raw.language !== 'es' && raw.language !== 'en') {
    return false;
  }
  if (raw.password !== undefined && (typeof raw.password !== 'string' || raw.password.length > MAX_PASSWORD_LENGTH)) {
    return false;
  }
  if (raw.clientId !== undefined && (typeof raw.clientId !== 'string' || raw.clientId.length === 0 || raw.clientId.length > MAX_CLIENT_ID_LENGTH)) {
    return false;
  }
  if (
    raw.clientSecret !== undefined &&
    (typeof raw.clientSecret !== 'string' || raw.clientSecret.length === 0 || raw.clientSecret.length > MAX_CLIENT_SECRET_LENGTH)
  ) {
    return false;
  }
  if (raw.removeManagementAccess !== undefined && (raw.removeManagementAccess !== true || raw.clientId !== undefined || raw.clientSecret !== undefined)) {
    return false;
  }
  if (raw.cloudRegion !== undefined && !isCloudRegion(raw.cloudRegion)) {
    return false;
  }
  if (
    raw.cloudClientId !== undefined &&
    (typeof raw.cloudClientId !== 'string' || raw.cloudClientId.length === 0 || raw.cloudClientId.length > MAX_CLIENT_ID_LENGTH)
  ) {
    return false;
  }
  if (
    raw.cloudClientSecret !== undefined &&
    (typeof raw.cloudClientSecret !== 'string' || raw.cloudClientSecret.length === 0 || raw.cloudClientSecret.length > MAX_CLIENT_SECRET_LENGTH)
  ) {
    return false;
  }
  if (
    raw.removeCloudAccess !== undefined &&
    (raw.removeCloudAccess !== true || raw.cloudRegion !== undefined || raw.cloudClientId !== undefined || raw.cloudClientSecret !== undefined)
  ) {
    return false;
  }
  return true;
} // End of function isValidConfigSavePayload()

/**
 * Creates the main window: sandboxed renderer with context isolation and the
 * compiled preload, the bundled renderer HTML, and the navigation/new-window
 * guards. Shown on 'ready-to-show' (or right away when the HTML fails to
 * load, so the failure is visible).
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandboxed preloads can use contextBridge + ipcRenderer.invoke since
      // Electron 20; preload.ts avoids runtime require() of project files
      sandbox: true
    },
    // Hidden-inset title bar is a macOS-only look (traffic lights over the
    // app's own header). Windows/Linux keep the native frame and title bar
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false
  });

  // Load the renderer HTML; on failure, log and show the window so the
  // problem is visible instead of the app silently running with no window
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html')).catch((error) => {
    console.error('Failed to load renderer HTML:', redactErrorMessage(error));
    mainWindow?.show();
  });

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Security: Prevent navigation to external URLs
  // (file:// URLs have origin "null", so compare the protocol instead). The
  // target URL is read from the event details (the positional `url` argument
  // is deprecated)
  mainWindow.webContents.on('will-navigate', (event) => {
    const parsedUrl = new URL(event.url);
    if (parsedUrl.protocol !== 'file:') {
      event.preventDefault();
    }
  });

  // Security: Prevent new windows
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
} // End of function createWindow()

// Certificate errors of webContents loads (the renderer only loads file:
// URLs, so in practice this never fires for the controller; net.request()
// goes through the verify proc instead). Same TOFU decision as the verify
// proc (cert-verify.ts): allowed only when the URL's origin is exactly the
// configured origin (scheme + host + port, read from the in-memory config
// cache) AND the presented self-signed certificate matches the pin — and
// never for a TP-Link cloud API host (decideCertificate() in cert-pinning.ts)
app.on('certificate-error', (event, _webContents, url, error, certificate, callback) => {
  if (isCertificateErrorAllowed(certificateTrustSource, url, error, certificate)) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
}); // End of the certificate-error handler

// Never present a client certificate. Since Electron 44 this event also fires
// for net.request() (with a null webContents) and, when left unhandled,
// Electron answers with the first matching certificate from the system store;
// before, such a net request failed with ERR_SSL_CLIENT_AUTH_CERT_NEEDED. The
// app uses no client certificates (and its renderer only loads file: URLs),
// so it continues without one: a controller can never receive the user's
// certificate identity.
app.on('select-client-certificate', (event, _webContents, _url, _certificateList, callback) => {
  event.preventDefault();
  callback();
});

// App ready
app.whenReady().then(() => {
  // Omada controllers use self-signed certificates, which only the verify
  // proc can let net.request() accept (app 'certificate-error' covers
  // webContents loads only). The proc applies trust-on-first-use pinning
  // (cert-pinning.ts): a self-signed certificate for the configured hostname
  // is accepted only when its SHA-256 fingerprint equals the pin the user
  // confirmed; other hosts and CA-trusted certificates keep Chromium's
  // verdict. The verify request carries no port, but the pin binds the
  // certificate itself, so another port of the same host presenting a
  // different certificate is rejected. Controller requests use a dedicated,
  // replaceable session (controllerTls); the default session (renderer,
  // file: only) gets the same proc for parity
  installCertificateVerifyProc(session.defaultSession, certificateTrustSource);
  controllerTls = new ControllerTlsSessions((partition) => session.fromPartition(partition), certificateTrustSource);
  // The TP-Link cloud gets its own session with Chromium's own verification
  // (no verify proc at all; see cloudSession above)
  cloudSession = createCloudSession((partition) => session.fromPartition(partition));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  app.quit();
});

// Best-effort server-side logout when the app quits with a live session.
// The first pass prevents the quit, runs logout() (bounded so a slow or
// unreachable controller cannot block quitting), then re-enters app.quit()
let quitLogoutStarted = false;
app.on('before-quit', (event) => {
  // Invalidate any in-flight connect attempt and any pending certificate
  // trust decision, and take ownership of every live controller — the
  // installed one and a parked pending-selection one (connectionManager
  // .detachAll()): each holds a server session that deserves a bounded logout
  const detached = connectionManager.detachAll();
  if (detached.length > 0 && !quitLogoutStarted) {
    quitLogoutStarted = true;
    event.preventDefault();
    const logouts = detached.map((controller) => controller.logout());
    // Do not let the logout requests delay quitting for more than 3 seconds
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    Promise.race([Promise.allSettled(logouts).then(() => undefined), deadline]).finally(() => {
      app.quit();
    });
  }
}); // End of the before-quit handler

// ============================================================================
// IPC Handlers
// ============================================================================

// Every handler is registered through handleTrusted(), which verifies the
// sender frame is the app's own renderer before the handler runs and redacts
// any failure; each handler then runtime-guards its arguments (types, formats,
// lengths, no extra argument) before use.

// Load configuration (sanitized: the renderer never receives the password or
// the Client Secret, only the hasPassword / hasClientSecret flags)
handleTrusted(IPC_CHANNELS.CONFIG_LOAD, async (_event, ...extra: unknown[]): Promise<RendererConfig> => {
  requireNoExtraArguments(extra);
  return getRendererConfig();
});

// Save configuration. The handler shape-checks the payload (known keys only,
// types, lengths, language enum); saveConfig() then validates/normalizes the
// URL, enforces the password rules (keep the stored one when absent and the
// URL is unchanged; require one when nothing usable is stored or the URL
// changed — a URL change also drops the stored password, the Client ID and
// Client Secret, the site id and the certificate pin) and the management-
// access rules (the Client Secret only as a safeStorage blob, or session-only
// in memory), and returns error codes instead of throwing raw errors. The
// reply carries the management-access flags, never the secret.
// A URL change is also a controller transition, run by
// connectionManager.applyConfigSave() in the same synchronous step as the
// write: every in-flight connect becomes stale, the pending site selection
// and certificate trust decision are discarded, the installed controller is
// detached and logged out (its Open API client and token dropped), and the
// controller session is replaced. The reply then carries connectionReset so
// the renderer drops its connected UI. A save that keeps the URL but touches
// the management access (Client ID, Client Secret, removal) drops the
// installed session's Open API client and capabilities at once and starts NO
// check run here (applyManagementAccessChange()): the Settings flow
// reconnects after every successful save, so the new session's checks are
// the single run that recomputes the capabilities with the new credentials
// (without a reconnect, the next capabilities or Test request runs them).
// A save that changes or removes the TP-Link cloud credential (region, cloud
// Client ID, cloud secret) drops the cloud client and its tokens in the same
// synchronous step as the write (CloudAccessService.invalidate(): a cloud call
// in flight answers superseded); the reply carries the cloud-access flags,
// never the secret.
// The cloud account is not tied to the controller URL: a URL change keeps it.
handleTrusted(IPC_CHANNELS.CONFIG_SAVE, async (_event, payload: unknown, ...extra: unknown[]): Promise<ConfigSaveResult> => {
  requireNoExtraArguments(extra);
  if (!isValidConfigSavePayload(payload)) {
    return { success: false, error: 'saveFailed' };
  }
  let result: ReturnType<typeof saveConfig>;
  try {
    // The cloud client is invalidated in the same synchronous step as the
    // write, before applyConfigSave() awaits a controller transition, so no
    // cloud call can complete on the old credential after the save
    result = await connectionManager.applyConfigSave(() => {
      const saved = saveConfig(payload);
      if (saved.success && saved.cloudCredentialsChanged) {
        cloudAccess.invalidate();
      }
      return saved;
    });
  } catch (error) {
    console.error(
      'Unexpected error saving config:',
      redactErrorMessage(error, [payload.password, payload.clientSecret, payload.cloudClientSecret, ...storedSecrets()])
    );
    return { success: false, error: 'saveFailed' };
  }
  if (!result.success) {
    return { success: false, error: result.error };
  }
  const reply: ConfigSaveResult = { success: true, managementAccess: result.managementAccess, cloudAccess: result.cloudAccess };
  if (result.urlChanged) {
    reply.connectionReset = true;
  } else {
    applyManagementAccessChange(connectionManager, payload);
  }
  return reply;
}); // End of the CONFIG_SAVE handler

// Connect to Omada controller (the password is decrypted in the main process;
// the renderer is never involved in credential handling). Failures are
// reported as stable error codes — never user-facing text — which the
// renderer maps to its es/en i18n strings; `detail` carries the underlying
// technical message when one exists. Serialization, multi-site parking and
// certificate pinning: see ConnectionManager.connect() (connection-manager.ts).
// A success carries the site name and the session nonce, and starts the
// management capability checks in the background (ControllerSession
// .activate()): they never delay or fail the connect.
handleTrusted(IPC_CHANNELS.OMADA_CONNECT, async (_event, ...extra: unknown[]): Promise<ConnectionResult> => {
  requireNoExtraArguments(extra);
  return connectionManager.connect();
});

// Select a site on a multi-site controller, completing the specific pending
// connection that returned needsSiteSelection. The id is format-checked here
// and then exact-matched against the authorized-site list inside the pending
// controller; the call must also echo the opaque nonce of the CURRENT pending
// record — a call without a pending selection, with a non-matching nonce, or
// after a newer connect, a disconnect or a controller transition (URL change,
// certificate reset) superseded the record is rejected, so a delayed or
// out-of-order selection can never install a controller or persist a site id
// it does not own (ConnectionManager.selectSite()).
handleTrusted(IPC_CHANNELS.OMADA_SELECT_SITE, async (_event, siteId: unknown, nonce: unknown, ...extra: unknown[]): Promise<ConnectionResult> => {
  requireNoExtraArguments(extra);
  if (typeof siteId !== 'string' || !SITE_ID_REGEX.test(siteId)) {
    throw new Error('IPC call rejected: invalid site id format');
  }
  if (typeof nonce !== 'string' || !NONCE_REGEX.test(nonce)) {
    throw new Error('IPC call rejected: invalid selection nonce format');
  }
  return connectionManager.selectSite(siteId, nonce);
}); // End of the OMADA_SELECT_SITE handler

/**
 * Returns the installed controller session, or throws when none is (not
 * connected, or detached by a disconnect or a controller transition).
 * @returns {ControllerSession} The installed controller session.
 */
function requireController(): ControllerSession {
  const controller = connectionManager.controller;
  if (!controller) {
    throw new Error('Not connected to the controller');
  }
  return controller;
}

// Get access points
handleTrusted(IPC_CHANNELS.OMADA_GET_APS, async (_event, ...extra: unknown[]): Promise<AccessPoint[]> => {
  requireNoExtraArguments(extra);
  return requireController().getAccessPoints();
});

// Get the group listing: the groups APs can be assigned to (AP groups on
// Omada 6.3+, WLAN groups before, empty groups included) plus the controller
// version and group model they belong to (OmadaController.getWlanGroups())
handleTrusted(IPC_CHANNELS.OMADA_GET_WLANS, async (_event, ...extra: unknown[]): Promise<GroupListing> => {
  requireNoExtraArguments(extra);
  return requireController().getWlanGroups();
});

// Set WLAN group for an AP. Both identifiers are format-checked before they
// reach the API client (they end up interpolated into the request path/body)
handleTrusted(IPC_CHANNELS.OMADA_SET_WLAN, async (_event, mac: unknown, wlanId: unknown, ...extra: unknown[]): Promise<boolean> => {
  requireNoExtraArguments(extra);
  if (typeof mac !== 'string' || !MAC_REGEX.test(mac)) {
    throw new Error('IPC call rejected: invalid MAC address format');
  }
  if (typeof wlanId !== 'string' || !WLAN_ID_REGEX.test(wlanId)) {
    throw new Error('IPC call rejected: invalid WLAN id format');
  }
  return requireController().setApWlanGroup(mac, wlanId);
}); // End of the OMADA_SET_WLAN handler

// Disconnect from controller (best-effort server-side logout; logout()
// swallows network errors itself). Two modes (ConnectionManager.disconnect()):
// - No argument: unconditional user-initiated disconnect — invalidates any
//   in-flight connect, discards a pending site selection and certificate
//   trust decision, and logs out the installed and parked controllers.
// - With a selection nonce: ownership-scoped abort of a pending site
//   selection — it acts only while the caller owns the CURRENT pending
//   record, so a stale flow's cleanup can never log out a session that a
//   newer connect installed or parked after superseding it.
handleTrusted(IPC_CHANNELS.OMADA_DISCONNECT, async (_event, nonce: unknown, ...extra: unknown[]): Promise<void> => {
  requireNoExtraArguments(extra);
  if (nonce !== undefined && (typeof nonce !== 'string' || !NONCE_REGEX.test(nonce))) {
    throw new Error('IPC call rejected: invalid selection nonce format');
  }
  await connectionManager.disconnect(nonce);
}); // End of the OMADA_DISCONNECT handler

// Trust the controller certificate a first-use connect result reported
// ("Trust and connect"). The renderer sends ONLY the opaque trust nonce; the
// pinned fingerprint is the one the verify proc recorded in the pending
// record, never a value from the renderer. Accepted only for the CURRENT
// pending record (exact nonce, unchanged connect generation — no newer
// connect, disconnect or controller transition since) and only while the
// configured origin is still the one the certificate was presented for. On
// success the controller session is replaced so the renderer's immediate
// reconnect is verified afresh against the new pin
// (ConnectionManager.trustCertificate()).
handleTrusted(IPC_CHANNELS.CERT_TRUST, async (_event, nonce: unknown, ...extra: unknown[]): Promise<CertificateActionResult> => {
  if (extra.length > 0) {
    throw new Error('IPC call rejected: unexpected arguments');
  }
  if (typeof nonce !== 'string' || !NONCE_REGEX.test(nonce)) {
    throw new Error('IPC call rejected: invalid trust nonce format');
  }
  return connectionManager.trustCertificate(nonce);
}); // End of the CERT_TRUST handler

// Forget the trusted certificate of the configured controller ("Reset
// trusted certificate" in Settings). Takes no arguments. Main implements the
// reset as an atomic controller transition on its own, whatever the renderer
// did before (ConnectionManager.resetCertificate()): the pin is removed and,
// in the same synchronous step, every in-flight connect becomes stale, the
// pending site selection and trust decision are discarded, the installed
// controller is detached and logged out, and the controller session is
// replaced — so neither a controller, a cached acceptance nor a pooled
// connection outlives the reset; the next connection is a first use again.
// The reply carries connectionReset so the renderer drops its connected UI.
handleTrusted(IPC_CHANNELS.CERT_RESET, async (_event, ...extra: unknown[]): Promise<CertificateActionResult> => {
  if (extra.length > 0) {
    throw new Error('IPC call rejected: unexpected arguments');
  }
  return connectionManager.resetCertificate();
}); // End of the CERT_RESET handler

// The management capabilities of the installed controller session (spec
// §2.2: flags plus a reason code, never a raw response). Session-owned like a
// site selection: the renderer echoes the session nonce of its connect
// result; once a newer connect attempt has started (the installed session is
// closed) the answer is notConnected at once, and an answer for another
// session — or for one replaced or closed while the checks ran — is
// superseded (getSessionCapabilities()). Waits for the checks in flight.
handleTrusted(IPC_CHANNELS.MANAGEMENT_CAPABILITIES, async (_event, sessionNonce: unknown, ...extra: unknown[]): Promise<ManagementCapabilitiesResult> => {
  return getSessionCapabilities(connectionManager, requireSessionNonce(sessionNonce, extra));
}); // End of the MANAGEMENT_CAPABILITIES handler

// "Test management access" (Settings): runs the installed session's checks
// again with the configured credentials (stored, or session-only) and reports
// the result, which also becomes the session's capabilities; same session
// ownership as MANAGEMENT_CAPABILITIES (testManagementAccess()).
handleTrusted(IPC_CHANNELS.MANAGEMENT_TEST, async (_event, sessionNonce: unknown, ...extra: unknown[]): Promise<ManagementCapabilitiesResult> => {
  return testManagementAccess(connectionManager, requireSessionNonce(sessionNonce, extra));
}); // End of the MANAGEMENT_TEST handler

// AP-group management (todo.md 4.9; spec §3, §4.4). Every channel: the trusted
// sender, then a strict shape guard (ipc-guards.ts: exactly the listed keys,
// the 32-hex session nonce, 24-hex AP-group ids, a raw length cap on names),
// then the installed session named by the nonce (notConnected / superseded
// otherwise, also when it changes while the call runs). The session refuses
// unless the capabilities say AP-group management is on, validates names and
// re-checks the delete policy on fresh Open API data right before writing
// (ControllerSession in controller-session.ts). Replies carry stable codes
// and codes-only diagnostics, never controller text.

// The site's AP groups with their per-band capacity (read; one argument: the
// session nonce)
handleTrusted(IPC_CHANNELS.MANAGEMENT_AP_GROUPS, async (_event, sessionNonce: unknown, ...extra: unknown[]): Promise<ManagedApGroupsResult> => {
  return managedApGroupsReply(connectionManager, requireSessionNonce(sessionNonce, extra));
}); // End of the MANAGEMENT_AP_GROUPS handler

// Create an empty AP group ({sessionNonce, name})
handleTrusted(IPC_CHANNELS.MANAGEMENT_AP_GROUP_CREATE, async (_event, payload: unknown, ...extra: unknown[]): Promise<ApGroupActionResult> => {
  return createApGroupReply(connectionManager, parseApGroupCreateRequest(payload, extra));
}); // End of the MANAGEMENT_AP_GROUP_CREATE handler

// Rename an AP group ({sessionNonce, apGroupId, name})
handleTrusted(IPC_CHANNELS.MANAGEMENT_AP_GROUP_RENAME, async (_event, payload: unknown, ...extra: unknown[]): Promise<ApGroupActionResult> => {
  return renameApGroupReply(connectionManager, parseApGroupRenameRequest(payload, extra));
}); // End of the MANAGEMENT_AP_GROUP_RENAME handler

// Delete an AP group ({sessionNonce, apGroupId}) under the app's delete
// policy, re-checked in main on fresh data right before the DELETE
handleTrusted(IPC_CHANNELS.MANAGEMENT_AP_GROUP_DELETE, async (_event, payload: unknown, ...extra: unknown[]): Promise<ApGroupActionResult> => {
  return deleteApGroupReply(connectionManager, parseApGroupDeleteRequest(payload, extra));
}); // End of the MANAGEMENT_AP_GROUP_DELETE handler

// The Wi-Fi network read model (todo.md 4.10; spec §2.3, §3, §4.5): the
// site's networks with their security, bands, enable state, scope and bound
// AP-group ids. The trusted sender, then the pure guard (exactly one
// argument: the 32-hex session nonce), then the installed session named by
// it (notConnected / superseded otherwise, also when it changes while the
// read runs); 'managementUnavailable' unless Wi-Fi network management is on
// (ControllerSession.listManagedNetworks()). The reply is the allowlisted DTO
// — never a passphrase or another secret — with codes-only diagnostics.
handleTrusted(IPC_CHANNELS.MANAGEMENT_NETWORKS, async (_event, sessionNonce: unknown, ...extra: unknown[]): Promise<ManagedNetworksResult> => {
  return managedNetworksReply(connectionManager, requireSessionNonce(sessionNonce, extra));
}); // End of the MANAGEMENT_NETWORKS handler

// Wi-Fi network writes (todo.md 4.11; spec §3, §4.5). Every channel: the
// trusted sender, then a strict shape guard (ipc-guards.ts: exactly the
// listed keys — the optional ones only when present —, a plain object, the
// 32-hex session nonce, an SSID id, 24-hex AP-group ids, a known security
// mode and bands, booleans, raw length caps on the name and the passphrase;
// a rejection never quotes a value), then the installed session named by the
// nonce (notConnected / superseded otherwise, also when it changes while the
// write runs). The session refuses unless Wi-Fi network management is on,
// checks the write rules and reads fresh data right before writing
// (read-merge-write for basic settings; ControllerSession in
// controller-session.ts). A typed passphrase travels renderer → main only:
// no reply, error, diagnostic or log line carries it.

// Create a network, disabled ({sessionNonce, name, security, bands,
// apGroupIds} + passphrase when typed)
handleTrusted(IPC_CHANNELS.MANAGEMENT_NETWORK_CREATE, async (_event, payload: unknown, ...extra: unknown[]): Promise<NetworkActionResult> => {
  return createNetworkReply(connectionManager, parseNetworkCreateRequest(payload, extra));
}); // End of the MANAGEMENT_NETWORK_CREATE handler

// Save the edited basic settings ({sessionNonce, networkId} + the edited
// fields among name, security, bands, passphrase)
handleTrusted(IPC_CHANNELS.MANAGEMENT_NETWORK_UPDATE, async (_event, payload: unknown, ...extra: unknown[]): Promise<NetworkActionResult> => {
  return updateNetworkReply(connectionManager, parseNetworkUpdateRequest(payload, extra));
}); // End of the MANAGEMENT_NETWORK_UPDATE handler

// Change the passphrase of a WPA-Personal network ({sessionNonce, networkId, passphrase})
handleTrusted(IPC_CHANNELS.MANAGEMENT_NETWORK_PASSWORD, async (_event, payload: unknown, ...extra: unknown[]): Promise<NetworkActionResult> => {
  return changeNetworkPasswordReply(connectionManager, parseNetworkPasswordRequest(payload, extra));
}); // End of the MANAGEMENT_NETWORK_PASSWORD handler

// Enable or disable a network ({sessionNonce, networkId, enabled})
handleTrusted(IPC_CHANNELS.MANAGEMENT_NETWORK_ENABLE, async (_event, payload: unknown, ...extra: unknown[]): Promise<NetworkActionResult> => {
  return setNetworkEnabledReply(connectionManager, parseNetworkEnableRequest(payload, extra));
}); // End of the MANAGEMENT_NETWORK_ENABLE handler

// Delete a network ({sessionNonce, networkId})
handleTrusted(IPC_CHANNELS.MANAGEMENT_NETWORK_DELETE, async (_event, payload: unknown, ...extra: unknown[]): Promise<NetworkActionResult> => {
  return deleteNetworkReply(connectionManager, parseNetworkDeleteRequest(payload, extra));
}); // End of the MANAGEMENT_NETWORK_DELETE handler

// Replace the AP groups a network is broadcast on ({sessionNonce, networkId,
// apGroupIds}: the complete new set; todo.md 4.12, spec §4.5). Same chain as
// the writes above: the trusted sender, the strict shape guard (an SSID id, at
// most 256 deduplicated 24-hex ids, no other key), then the installed session
// named by the nonce, which plans the change on fresh data — never a binding
// PATCH for an "All access points" or unknown-scope network
handleTrusted(IPC_CHANNELS.MANAGEMENT_NETWORK_BINDINGS, async (_event, payload: unknown, ...extra: unknown[]): Promise<NetworkBindingsResult> => {
  return updateNetworkBindingsReply(connectionManager, parseNetworkBindingsRequest(payload, extra));
}); // End of the MANAGEMENT_NETWORK_BINDINGS handler

// TP-Link cloud account (inbox item I-1a; docs/omada-cloud-openapi.md,
// docs/security-audit.md §1). Both channels: the trusted sender, then the
// pure arity guard (no argument at all: no host, deviceId, serverHost or URL
// can come from the renderer), then CloudAccessService (cloud-access.ts),
// which uses the SAVED credentials only ('notConfigured' when none; the
// renderer asks to save first when its form holds unsaved cloud edits). No
// session nonce: a cloud call reads the account only, targets no controller
// and must work while disconnected from (or unable to reach) the local
// controller; a reply for credentials saved or removed meanwhile is
// 'superseded' instead. Replies: controller DTOs (never a deviceId,
// serverHost or token) or codes-only diagnostics, redacted.

// "Test cloud access": a fresh token plus the organization list
handleTrusted(IPC_CHANNELS.CLOUD_TEST, async (_event, ...extra: unknown[]): Promise<CloudAccessResult> => {
  requireNoExtraArguments(extra);
  return cloudAccess.test();
});

// The account's controllers (reusing a valid token)
handleTrusted(IPC_CHANNELS.CLOUD_CONTROLLERS, async (_event, ...extra: unknown[]): Promise<CloudAccessResult> => {
  requireNoExtraArguments(extra);
  return cloudAccess.controllers();
});
