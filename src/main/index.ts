import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'path';
import { getConfiguredUrl, getConnectionCredentials, getRendererConfig, saveConfig } from './config';
import { OmadaController } from './omada-api';
import { ConfigSavePayload, ConfigSaveResult, IPC_CHANNELS, ConnectionResult, RendererConfig } from '../shared/types';

// Global reference to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let omadaController: OmadaController | null = null;

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
      sandbox: false // Required for preload to work properly with contextBridge
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
  // in-memory config cache — no filesystem access here)
  const configUrl = getConfiguredUrl();
  if (configUrl && url.startsWith(configUrl)) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// App ready
app.whenReady().then(() => {
  // Bypass SSL certificate validation only for the configured Omada controller
  // This is required because Omada controllers use self-signed certificates
  // This callback runs on every TLS verification, so it must read the URL
  // from the in-memory config cache, never from disk
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const configUrl = getConfiguredUrl();
    if (configUrl) {
      try {
        // Use .hostname (not .host) to compare without port
        const configHostname = new URL(configUrl).hostname;
        const requestHostname = request.hostname || '';
        if (configHostname && configHostname === requestHostname) {
          // Accept certificate for Omada controller
          callback(0); // 0 = OK
          return;
        }
      } catch {
        // Invalid URL, fall through to default verification
      }
    }
    // Use default Chrome verification for all other requests
    callback(-3); // -3 = use Chrome's default verification
  });

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

// Load configuration (sanitized: the renderer never receives the password,
// only a hasPassword flag)
ipcMain.handle(IPC_CHANNELS.CONFIG_LOAD, async (): Promise<RendererConfig> => {
  return getRendererConfig();
});

// Save configuration. saveConfig() validates/normalizes the URL, enforces
// the password rules (keep the stored one when absent, reject when none at
// all), and returns error codes instead of throwing raw errors.
ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, async (_event, payload: ConfigSavePayload): Promise<ConfigSaveResult> => {
  try {
    return saveConfig(payload);
  } catch (error) {
    console.error('Unexpected error saving config:', error);
    return { success: false, error: 'saveFailed' };
  }
});

// Connect to Omada controller (the password is decrypted here in the main
// process; the renderer is never involved in credential handling)
ipcMain.handle(IPC_CHANNELS.OMADA_CONNECT, async (): Promise<ConnectionResult> => {
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
ipcMain.handle(IPC_CHANNELS.OMADA_GET_APS, async () => {
  if (!omadaController) {
    throw new Error('No conectado al controlador');
  }
  return omadaController.getAccessPoints();
});

// Get WLAN groups
ipcMain.handle(IPC_CHANNELS.OMADA_GET_WLANS, async () => {
  if (!omadaController) {
    throw new Error('No conectado al controlador');
  }
  return omadaController.getWlanGroups();
});

// Set WLAN group for an AP
ipcMain.handle(IPC_CHANNELS.OMADA_SET_WLAN, async (_event, mac: string, wlanId: string): Promise<boolean> => {
  if (!omadaController) {
    throw new Error('No conectado al controlador');
  }
  return omadaController.setApWlanGroup(mac, wlanId);
});

// Disconnect from controller (best-effort server-side logout, then drop
// the controller reference; logout() swallows network errors itself)
ipcMain.handle(IPC_CHANNELS.OMADA_DISCONNECT, async (): Promise<void> => {
  if (omadaController) {
    const controller = omadaController;
    omadaController = null;
    await controller.logout();
  }
});
