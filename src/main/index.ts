import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, session } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getConfiguredUrl, getConnectionCredentials, getRendererConfig, saveConfig } from './config';
import { OmadaController } from './omada-api';
import { ConfigSavePayload, ConfigSaveResult, IPC_CHANNELS, ConnectionResult, RendererConfig } from '../shared/types';

// Global reference to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let omadaController: OmadaController | null = null;

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
    titleBarStyle: 'hiddenInset',
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
  if (omadaController && !quitLogoutStarted) {
    quitLogoutStarted = true;
    event.preventDefault();
    const controller = omadaController;
    omadaController = null;
    // Do not let the logout request delay quitting for more than 3 seconds
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    Promise.race([controller.logout(), deadline]).finally(() => {
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

// Connect to Omada controller (the password is decrypted here in the main
// process; the renderer is never involved in credential handling)
ipcMain.handle(IPC_CHANNELS.OMADA_CONNECT, async (event): Promise<ConnectionResult> => {
  assertTrustedIpcSender(event);
  const config = getConnectionCredentials();

  if (!config.url || !config.username || !config.password) {
    return { success: false, error: 'Configuración incompleta. Por favor, configura la conexión.' };
  }

  try {
    omadaController = new OmadaController(config.url, config.username, config.password);
    const connected = await omadaController.connect();

    if (connected) {
      return { success: true };
    } else {
      return { success: false, error: 'No se pudo conectar al controlador.' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    return { success: false, error: errorMessage };
  }
});

// Get access points
ipcMain.handle(IPC_CHANNELS.OMADA_GET_APS, async (event) => {
  assertTrustedIpcSender(event);
  if (!omadaController) {
    throw new Error('No conectado al controlador');
  }
  return omadaController.getAccessPoints();
});

// Get WLAN groups
ipcMain.handle(IPC_CHANNELS.OMADA_GET_WLANS, async (event) => {
  assertTrustedIpcSender(event);
  if (!omadaController) {
    throw new Error('No conectado al controlador');
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
    throw new Error('No conectado al controlador');
  }
  return omadaController.setApWlanGroup(mac, wlanId);
}); // End of the OMADA_SET_WLAN handler

// Disconnect from controller (best-effort server-side logout, then drop
// the controller reference; logout() swallows network errors itself)
ipcMain.handle(IPC_CHANNELS.OMADA_DISCONNECT, async (event): Promise<void> => {
  assertTrustedIpcSender(event);
  if (omadaController) {
    const controller = omadaController;
    omadaController = null;
    await controller.logout();
  }
});
