import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, session } from 'electron';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getConfiguredUrl, getConnectionCredentials, getRendererConfig, getStoredSiteId, saveConfig, saveStoredSiteId } from './config';
import { OmadaController } from './omada-api';
import { ConfigSavePayload, ConfigSaveResult, IPC_CHANNELS, ConnectionResult, RendererConfig } from '../shared/types';

// Global reference to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let omadaController: OmadaController | null = null;

// Serializes connection attempts in the main process (todo.md 3.12): every
// OMADA_CONNECT bumps this counter and captures its value; when the value has
// moved on after the (awaited) authentication — because a newer connect or a
// disconnect started meanwhile — the finished attempt is discarded instead of
// installing its controller. OMADA_DISCONNECT and the quit path bump it too,
// so an in-flight connect can never resurrect a session the user just closed.
let connectGeneration = 0;

// A connect that authenticated but still needs the user to pick a site parks
// its controller here instead of installing it globally. The record ties the
// eventual OMADA_SELECT_SITE call to this exact pending connect: `generation`
// is the connect generation the attempt captured, and `nonce` is an opaque
// one-time token the renderer must echo back verbatim. The controller is
// installed globally only after the selection succeeds; the record is cleared
// (and its controller released) on disconnect, on supersession by a newer
// connect, on cancellation (nonce-scoped disconnect), and on quit.
interface PendingSiteSelection {
  controller: OmadaController;
  generation: number;
  nonce: string;
}
let pendingSiteSelection: PendingSiteSelection | null = null;

// ============================================================================
// IPC boundary validation
// ============================================================================

// Absolute path of the packaged renderer HTML. Every IPC call must originate
// from a frame whose file: URL resolves to exactly this file
const RENDERER_HTML_PATH = path.normalize(path.join(__dirname, '../renderer/index.html'));

// Format guards for identifiers crossing the IPC boundary. The renderer
// applies the same patterns (src/renderer/renderer.ts — keep both in sync)
const MAC_REGEX = /^[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}$/;
const WLAN_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const SITE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
// Format guard for the opaque site-selection nonce: exactly 32 lowercase hex
// characters (16 random bytes — see createSelectionNonce())
const SELECTION_NONCE_REGEX = /^[0-9a-f]{32}$/;

// Length caps for strings arriving over IPC (defense against absurd payloads)
const MAX_URL_LENGTH = 2048;
const MAX_USERNAME_LENGTH = 256;
const MAX_PASSWORD_LENGTH = 512;

// Chromium verification results the certificate verify proc may bypass for
// the configured controller hostname: the failure classes a self-signed
// Omada controller cert actually produces (untrusted issuer, name mismatch,
// expired). Anything else — revoked, weak signature, etc. — is never bypassed
const SELF_SIGNED_VERIFICATION_ERRORS = [
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID',
  'ERR_CERT_DATE_INVALID'
];

/**
 * Returns true when a Chromium certificate verification result is one of the
 * failure classes expected from a self-signed controller certificate.
 * Substring match so the check tolerates the "net::" prefix Chromium adds.
 * @param {string} verificationResult - Result string from the verify proc.
 * @returns {boolean} True when the failure class may be bypassed.
 */
function isSelfSignedVerificationResult(verificationResult: string): boolean {
  return SELF_SIGNED_VERIFICATION_ERRORS.some((code) => verificationResult.includes(code));
}

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
 * Throws when an IPC call does not come from the app's own renderer frame.
 * Every ipcMain.handle callback calls this first. The message is not
 * user-facing: the renderer maps rejections to generic i18n error messages.
 * @param {IpcMainInvokeEvent} event - The IPC invoke event.
 */
function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedIpcSender(event)) {
    throw new Error('IPC call rejected: untrusted sender frame');
  }
}

/**
 * Runtime shape guard for the config-save payload arriving over IPC: it must
 * be an object with non-empty string url/username within the length caps, a
 * supported language, and — when present — a string password within the
 * length cap. Detailed value validation (URL normalization, password keep/
 * require rules) stays in saveConfig().
 * @param {unknown} payload - The raw IPC payload.
 * @returns {payload is ConfigSavePayload} True when the shape is valid.
 */
function isValidConfigSavePayload(payload: unknown): payload is ConfigSavePayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const raw = payload as Record<string, unknown>;
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
  return true;
} // End of function isValidConfigSavePayload()

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
    console.error('Failed to load renderer HTML:', error);
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
  // (file:// URLs have origin "null", so compare the protocol instead)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'file:') {
      event.preventDefault();
    }
  });

  // Security: Prevent new windows
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
}

// Bypass SSL for self-signed certificates (Omada controllers use self-signed certs)
app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  // Only bypass for the configured Omada controller URL (read from the
  // in-memory config cache — no filesystem access here). Compare parsed
  // origins (scheme + host + port): a prefix match would also accept e.g.
  // https://192.168.1.100 when https://192.168.1.1 is configured, or
  // https://controller.attacker.example when https://controller is
  const configUrl = getConfiguredUrl();
  if (configUrl) {
    try {
      if (new URL(configUrl).origin === new URL(url).origin) {
        event.preventDefault();
        callback(true);
        return;
      }
    } catch {
      // Malformed URL: fall through to rejection
    }
  }
  callback(false);
}); // End of the certificate-error handler

// App ready
app.whenReady().then(() => {
  // Bypass SSL certificate validation only for the configured Omada controller
  // This is required because Omada controllers use self-signed certificates.
  // This proc is what lets net.request() reach the controller (the app-level
  // certificate-error event only covers webContents loads, not the net
  // module), and it runs on every TLS verification, so it must read the URL
  // from the in-memory config cache, never from disk.
  // LIMITATION: the verify-proc request exposes only the hostname — no port —
  // so the bypass cannot be scoped to the full configured origin here; it is
  // narrowed instead to the certificate failure classes a self-signed
  // controller cert actually produces. Full identity binding is the deferred
  // trust-on-first-use pinning item (todo.md 2.3b).
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const configUrl = getConfiguredUrl();
    if (configUrl) {
      try {
        // Use .hostname (not .host): the request carries no port to compare
        const configHostname = new URL(configUrl).hostname;
        const requestHostname = request.hostname || '';
        if (
          configHostname &&
          configHostname === requestHostname &&
          isSelfSignedVerificationResult(request.verificationResult)
        ) {
          // Accept the self-signed certificate for the Omada controller
          callback(0); // 0 = OK
          return;
        }
      } catch {
        // Invalid URL, fall through to default verification
      }
    }
    // Use default Chrome verification for all other requests
    callback(-3); // -3 = use Chrome's default verification
  }); // End of the certificate verify proc

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
  // Invalidate any in-flight connect attempt (see connectGeneration)
  connectGeneration++;
  // Take ownership of a parked pending-selection controller too: it holds a
  // live server session that deserves the same bounded logout on quit
  const pending = pendingSiteSelection;
  pendingSiteSelection = null;
  if ((omadaController || pending) && !quitLogoutStarted) {
    quitLogoutStarted = true;
    event.preventDefault();
    const controller = omadaController;
    omadaController = null;
    const logouts: Promise<void>[] = [];
    if (controller) {
      logouts.push(controller.logout());
    }
    if (pending) {
      logouts.push(pending.controller.logout());
    }
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

// Every handler first verifies the sender frame is the app's own renderer
// (assertTrustedIpcSender) and runtime-guards its payload before use.

// Load configuration (sanitized: the renderer never receives the password,
// only a hasPassword flag)
ipcMain.handle(IPC_CHANNELS.CONFIG_LOAD, async (event): Promise<RendererConfig> => {
  assertTrustedIpcSender(event);
  return getRendererConfig();
});

// Save configuration. The handler shape-checks the payload (types, lengths,
// language enum); saveConfig() then validates/normalizes the URL, enforces
// the password rules (keep the stored one when absent, reject when none at
// all), and returns error codes instead of throwing raw errors.
ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, async (event, payload: unknown): Promise<ConfigSaveResult> => {
  assertTrustedIpcSender(event);
  if (!isValidConfigSavePayload(payload)) {
    return { success: false, error: 'saveFailed' };
  }
  try {
    return saveConfig(payload);
  } catch (error) {
    console.error('Unexpected error saving config:', error);
    return { success: false, error: 'saveFailed' };
  }
}); // End of the CONFIG_SAVE handler

/**
 * Best-effort release of a controller instance that lost its right to be the
 * global one (superseded attempt, replaced predecessor, failed connect).
 * logout() swallows network errors itself; this guard only exists so an
 * unexpected rejection can never surface as an unhandled promise.
 * @param {OmadaController} controller - The controller to log out and drop.
 */
function releaseController(controller: OmadaController): void {
  controller.logout().catch((error) => {
    console.warn('Error releasing a controller session:', error);
  });
}

/**
 * Creates the opaque one-time nonce that ties a pending site selection to the
 * OMADA_CONNECT attempt that produced it: 16 random bytes, hex-encoded (32
 * lowercase hex characters — see SELECTION_NONCE_REGEX).
 * @returns {string} The freshly generated nonce.
 */
function createSelectionNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Discards the pending site-selection record, if any, releasing its parked
 * controller (best-effort logout). Called when a newer connect supersedes the
 * pending attempt, on an unconditional disconnect, and as a safety net on
 * quit — once discarded, any later OMADA_SELECT_SITE or nonce-scoped
 * disconnect call for that record is rejected as stale.
 */
function discardPendingSiteSelection(): void {
  if (pendingSiteSelection) {
    const pending = pendingSiteSelection;
    pendingSiteSelection = null;
    releaseController(pending.controller);
  }
}

// Connect to Omada controller (the password is decrypted here in the main
// process; the renderer is never involved in credential handling). Failures
// are reported as stable error codes — never user-facing text — which the
// renderer maps to its es/en i18n strings; `detail` carries the underlying
// technical message when one exists.
// Serialization (todo.md 3.12): the controller is created in a LOCAL variable
// and installed globally only after authentication succeeds; an attempt whose
// generation went stale while awaiting (a newer connect or a disconnect
// started) is logged out and discarded, so a slow first attempt can never
// clobber the session a later flow owns.
// Multi-site (todo.md 1.11): the stored site id is offered to connect(); when
// no site could be picked (several sites, no valid stored choice) the handler
// parks the controller as a pending site selection — NOT installed globally —
// and returns needsSiteSelection plus the authorized-site list and an opaque
// nonce; the renderer completes the connection through OMADA_SELECT_SITE,
// which requires that nonce while the record is still current.
ipcMain.handle(IPC_CHANNELS.OMADA_CONNECT, async (event): Promise<ConnectionResult> => {
  assertTrustedIpcSender(event);
  const generation = ++connectGeneration;
  // A newer connect supersedes any site selection still pending from an
  // earlier attempt: discard it (and release its parked controller) now
  discardPendingSiteSelection();
  const config = getConnectionCredentials();

  if (!config.url || !config.username || !config.password) {
    return { success: false, error: 'configIncomplete' };
  }

  const controller = new OmadaController(config.url, config.username, config.password);
  try {
    const outcome = await controller.connect(getStoredSiteId());

    if (generation !== connectGeneration) {
      // Superseded while authenticating: discard this attempt entirely
      releaseController(controller);
      return { success: false, error: 'connectionSuperseded' };
    }

    // This attempt owns the session now: release any previously installed
    // controller so repeated connects (e.g. reconnect after a settings save)
    // cannot leak sessions
    const previous = omadaController;
    omadaController = null;
    if (previous) {
      releaseController(previous);
    }

    if (!outcome.siteSelected) {
      // Park the controller as pending until the user picks a site: the
      // eventual OMADA_SELECT_SITE call must echo this nonce and succeeds
      // only while this exact record is still the current one
      const nonce = createSelectionNonce();
      pendingSiteSelection = { controller, generation, nonce };
      return { success: false, needsSiteSelection: true, sites: outcome.sites, selectionNonce: nonce };
    }

    omadaController = controller;
    return { success: true };
  } catch (error) {
    console.error('Error connecting to the Omada controller:', error);
    // The login may have partially succeeded before the failure: log the
    // local controller out best-effort (it was never installed globally)
    releaseController(controller);
    if (generation !== connectGeneration) {
      return { success: false, error: 'connectionSuperseded' };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { success: false, error: 'connectError', detail };
  }
}); // End of the OMADA_CONNECT handler

// Select a site on a multi-site controller, completing the specific pending
// connection that returned needsSiteSelection. The id is format-checked here
// and then exact-matched against the authorized-site list inside the pending
// controller; the call must also echo the opaque nonce of the CURRENT pending
// record — a call without a pending selection, with a non-matching nonce, or
// after a newer connect/disconnect superseded the record is rejected, so a
// delayed or out-of-order selection can never mutate a session it does not
// own. The controller is installed globally only here, after the selection
// succeeds; the chosen id is persisted so the next connect reuses it silently.
ipcMain.handle(IPC_CHANNELS.OMADA_SELECT_SITE, async (event, siteId: unknown, nonce: unknown): Promise<ConnectionResult> => {
  assertTrustedIpcSender(event);
  if (typeof siteId !== 'string' || !SITE_ID_REGEX.test(siteId)) {
    throw new Error('IPC call rejected: invalid site id format');
  }
  if (typeof nonce !== 'string' || !SELECTION_NONCE_REGEX.test(nonce)) {
    throw new Error('IPC call rejected: invalid selection nonce format');
  }
  const pending = pendingSiteSelection;
  if (!pending || pending.nonce !== nonce || pending.generation !== connectGeneration) {
    // No selection is pending, or the caller does not own the current one
    return { success: false, error: 'siteUnavailable' };
  }
  if (!pending.controller.selectSite(siteId)) {
    return { success: false, error: 'siteUnavailable' };
  }
  // Selection complete: consume the pending record and install its controller
  // globally. `previous` is null by construction (the connect that parked the
  // record released its predecessor, and any later connect or disconnect
  // would have invalidated the record) — released defensively regardless
  pendingSiteSelection = null;
  const previous = omadaController;
  omadaController = pending.controller;
  if (previous) {
    releaseController(previous);
  }
  saveStoredSiteId(siteId);
  return { success: true };
}); // End of the OMADA_SELECT_SITE handler

// Get access points
ipcMain.handle(IPC_CHANNELS.OMADA_GET_APS, async (event) => {
  assertTrustedIpcSender(event);
  if (!omadaController) {
    throw new Error('Not connected to the controller');
  }
  return omadaController.getAccessPoints();
});

// Get WLAN groups
ipcMain.handle(IPC_CHANNELS.OMADA_GET_WLANS, async (event) => {
  assertTrustedIpcSender(event);
  if (!omadaController) {
    throw new Error('Not connected to the controller');
  }
  return omadaController.getWlanGroups();
});

// Set WLAN group for an AP. Both identifiers are format-checked before they
// reach the API client (they end up interpolated into the request path/body)
ipcMain.handle(IPC_CHANNELS.OMADA_SET_WLAN, async (event, mac: unknown, wlanId: unknown): Promise<boolean> => {
  assertTrustedIpcSender(event);
  if (typeof mac !== 'string' || !MAC_REGEX.test(mac)) {
    throw new Error('IPC call rejected: invalid MAC address format');
  }
  if (typeof wlanId !== 'string' || !WLAN_ID_REGEX.test(wlanId)) {
    throw new Error('IPC call rejected: invalid WLAN id format');
  }
  if (!omadaController) {
    throw new Error('Not connected to the controller');
  }
  return omadaController.setApWlanGroup(mac, wlanId);
}); // End of the OMADA_SET_WLAN handler

// Disconnect from controller (best-effort server-side logout, then drop the
// controller reference; logout() swallows network errors itself). Two modes:
// - No argument: unconditional user-initiated disconnect — invalidates any
//   in-flight connect, discards a pending site selection, and logs out the
//   installed controller.
// - With a selection nonce: ownership-scoped abort of a pending site
//   selection — it acts only while the caller owns the CURRENT pending
//   record, so a stale flow's cleanup can never log out a session that a
//   newer connect installed or parked after superseding it.
ipcMain.handle(IPC_CHANNELS.OMADA_DISCONNECT, async (event, nonce: unknown): Promise<void> => {
  assertTrustedIpcSender(event);
  if (nonce !== undefined && (typeof nonce !== 'string' || !SELECTION_NONCE_REGEX.test(nonce))) {
    throw new Error('IPC call rejected: invalid selection nonce format');
  }
  if (nonce !== undefined) {
    const pending = pendingSiteSelection;
    if (!pending || pending.nonce !== nonce || pending.generation !== connectGeneration) {
      // Stale caller: it owns nothing that is installed or pending — no-op
      return;
    }
    // Abort the owned pending selection: invalidate the generation (so the
    // record can never be resurrected) and log its parked controller out
    connectGeneration++;
    pendingSiteSelection = null;
    await pending.controller.logout();
    return;
  }
  // Invalidate any in-flight connect attempt: were one to finish after this
  // disconnect, it must be discarded, not installed (see connectGeneration)
  connectGeneration++;
  discardPendingSiteSelection();
  if (omadaController) {
    const controller = omadaController;
    omadaController = null;
    await controller.logout();
  }
}); // End of the OMADA_DISCONNECT handler
