import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'path';
import { loadConfig, saveConfig, getConfigValue } from './config';
import { OmadaController } from './omada-api';
import { AppConfig, IPC_CHANNELS, ConnectionResult } from '../shared/types';

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

  // Load the renderer HTML
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Security: Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== 'file://') {
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
  // Only bypass for the configured Omada controller URL
  const configUrl = getConfigValue('url');
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
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const configUrl = getConfigValue('url');
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

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============================================================================
// IPC Handlers
// ============================================================================

// Load configuration
ipcMain.handle(IPC_CHANNELS.CONFIG_LOAD, async (): Promise<AppConfig> => {
  return loadConfig();
});

// Save configuration
ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, async (_event, config: AppConfig): Promise<boolean> => {
  return saveConfig(config);
});

// Connect to Omada controller
ipcMain.handle(IPC_CHANNELS.OMADA_CONNECT, async (): Promise<ConnectionResult> => {
  const config = loadConfig();

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

// Disconnect from controller
ipcMain.handle(IPC_CHANNELS.OMADA_DISCONNECT, async (): Promise<void> => {
  omadaController = null;
});
