// Entry point for the TLS probe's end-to-end part (run-tls-probe.mjs): runs
// the REAL compiled main process (dist/main/index.js — config, IPC handlers,
// certificate verify proc, controller sessions) with the real preload and
// renderer, inside a throwaway HOME.
//
// Two adjustments, both made before the app code loads:
// - Electron's userData goes inside the temp HOME (as in the smoke stub);
// - safeStorage reports encryption as unavailable, so config.ts uses its
//   documented plaintext fallback and the probe never touches the macOS
//   Keychain (encryption itself is not what this probe tests).
// Refuses to start with the real home directory (invariant D4).

'use strict';

const { app, safeStorage } = require('electron');
const os = require('node:os');
const path = require('node:path');

if (path.resolve(os.homedir()) === path.resolve(os.userInfo().homedir)) {
  console.error('[tls-probe app] Refusing to start: HOME must point at a fresh temp directory');
  process.exit(2);
}
app.setPath('userData', path.join(os.homedir(), 'electron-user-data'));
safeStorage.isEncryptionAvailable = () => false;

require(path.join(__dirname, '..', '..', 'dist', 'main', 'index.js'));
