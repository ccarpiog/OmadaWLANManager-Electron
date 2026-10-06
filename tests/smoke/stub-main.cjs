// Stubbed Electron main process for the GUI smoke test (tests/smoke/run-smoke.mjs).
//
// It creates the window exactly like src/main/index.ts createWindow() does —
// the REAL compiled preload (dist/main/preload.js, sandboxed, context
// isolation) and the REAL bundled renderer (dist/renderer/index.html) — but
// answers every IPC channel in src/shared/types.ts IPC_CHANNELS with fake,
// fixture-driven responses that mirror the real handlers' shapes, guards and
// state transitions. The runner reconfigures the fakes at runtime through
// `globalThis.__omadaStub` (electronApp.evaluate).
//
// Invariant D4 (docs/management-design.md §1): this file never loads
// dist/main/index.js, config.js, net-transport.js or anything else that does
// network or touches the user's config. It only requires three pure compiled
// modules (shared/types.js for the channel table, main/url.js for URL
// normalization and the same-controller check, main/controller-version.js for
// the version -> group-model rule), refuses to start unless HOME points away from the real
// home directory, keeps Electron's userData under that temp HOME, writes no
// files, and cancels every non-file: request the window makes.

'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const { randomBytes } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const projectRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(projectRoot, 'dist');
const PRELOAD_PATH = path.join(distDir, 'main', 'preload.js');
const RENDERER_HTML_PATH = path.normalize(path.join(distDir, 'renderer', 'index.html'));

// Pure compiled modules only (see the D4 note above)
const { IPC_CHANNELS } = require(path.join(distDir, 'shared', 'types.js'));
const { isSameControllerUrl, normalizeControllerUrl } = require(path.join(distDir, 'main', 'url.js'));
const { groupModelForVersion, normalizeControllerVersion } = require(path.join(distDir, 'main', 'controller-version.js'));

// Format guards mirrored from src/main/index.ts (keep in sync)
const MAC_REGEX = /^[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}$/;
const WLAN_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const SITE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const SELECTION_NONCE_REGEX = /^[0-9a-f]{32}$/;
const TRUST_NONCE_REGEX = /^[0-9a-f]{32}$/;
const MAX_URL_LENGTH = 2048;
const MAX_USERNAME_LENGTH = 256;
const MAX_PASSWORD_LENGTH = 512;

// ============================================================================
// D4 guard: never run against the real home directory
// ============================================================================

if (path.resolve(os.homedir()) === path.resolve(os.userInfo().homedir)) {
  console.error('[stub-main] Refusing to start: HOME must point at a fresh temp directory (see tests/smoke/run-smoke.mjs)');
  process.exit(2);
}

// Chromium profile data (cache, local storage, ...) stays inside the temp HOME
app.setPath('userData', path.join(os.homedir(), 'electron-user-data'));

// ============================================================================
// Stub state (reachable from the runner as globalThis.__omadaStub)
// ============================================================================

/**
 * Returns the default scenario: first run (no config), connect succeeds, no data.
 * @returns {object} A fresh default scenario.
 */
function defaultScenario() {
  return {
    // RendererConfig returned by CONFIG_LOAD (updated by a successful CONFIG_SAVE,
    // CERT_TRUST and CERT_RESET; pinnedFingerprint mirrors the stored TOFU pin)
    config: { url: '', username: '', language: 'es', hasPassword: false, pinnedFingerprint: null },
    // Fingerprint of the self-signed certificate the fake controller presents,
    // or null when certificate pinning is not involved (as if CA-trusted).
    // With a value, OMADA_CONNECT mirrors certificateRejectionResult() in
    // src/main/index.ts: no pin -> certificateUntrusted (+ trust nonce), a
    // different pin -> certificateChanged, the same pin -> the normal flow
    presentedFingerprint: null,
    // OMADA_CONNECT outcome template: { success: true }, a failure such as
    // { success: false, error: 'connectError', detail: '...' }, or
    // { needsSiteSelection: true } (the stub then offers `sites` with a nonce)
    connect: { success: true },
    sites: [],
    accessPoints: [],
    // The controllerVer the fake controller's /api/info reports (null = absent:
    // the legacy group model, like the real defensive default). OMADA_GET_WLANS
    // derives the group model from it with the real rule (controller-version.js)
    controllerVersion: null,
    // GroupListing groups, i.e. what OmadaController.getWlanGroups() returns
    // after joining setting/wlans with setting/ssids (empty groups included)
    wlanGroups: [],
    // Value OMADA_SET_WLAN resolves with (the real handler resolves true or throws)
    setWlanResult: true,
    // MACs whose OMADA_SET_WLAN resolves false whatever setWlanResult says
    // (a partially failing bulk move)
    setWlanFailMacs: [],
    // IPC channels that throw a simulated controller error (e.g. a refresh
    // that fails: ['omada:get-aps'])
    failChannels: [],
    // When set, CONFIG_SAVE returns this verbatim instead of applying the real rules
    saveResult: null,
    // Optional per-channel response delays in ms, e.g. { 'omada:get-aps': 400 }
    delays: {},
  };
} // End of function defaultScenario()

const stub = {
  scenario: { ...defaultScenario(), ...JSON.parse(process.env.OMADA_SMOKE_SCENARIO || '{}') },
  // Every IPC call: { channel, args, trusted, at }
  calls: [],
  untrustedCalls: 0,
  // Nonces handed out by OMADA_CONNECT, in order
  issuedNonces: [],
  // Requests the window tried to make outside file: (all cancelled)
  blockedRequests: [],
  // Renderer console messages at error level, preload errors, crashes, load failures
  rendererErrors: [],
  // Mirrors "a controller is installed globally" in src/main/index.ts
  connected: false,
  // Mirrors pendingSiteSelection: { nonce, sites } or null
  pendingSelection: null,
  // Mirrors the site id persisted by OMADA_SELECT_SITE (in memory only)
  storedSiteId: '',
  // Mirrors pendingCertificateTrust: { nonce, fingerprint, url } or null
  pendingTrust: null,
  // Trust nonces handed out by OMADA_CONNECT, in order
  issuedTrustNonces: [],
  registeredChannels: [],
  environment: { home: os.homedir(), userData: app.getPath('userData'), platform: process.platform },
  // BrowserWindow options used by createWindow() (checked against the real app's)
  windowOptions: null,

  /**
   * Merges a partial scenario into the current one (top-level keys replace).
   * @param {object} patch - Scenario fields to replace.
   * @returns {object} A copy of the resulting scenario.
   */
  configure(patch) {
    Object.assign(this.scenario, structuredClone(patch));
    return structuredClone(this.scenario);
  },

  /**
   * Returns a serializable copy of the whole stub state for assertions.
   * @returns {object} The snapshot.
   */
  snapshot() {
    return structuredClone({
      scenario: this.scenario,
      calls: this.calls,
      untrustedCalls: this.untrustedCalls,
      issuedNonces: this.issuedNonces,
      blockedRequests: this.blockedRequests,
      rendererErrors: this.rendererErrors,
      connected: this.connected,
      pendingSelection: this.pendingSelection,
      storedSiteId: this.storedSiteId,
      pendingTrust: this.pendingTrust,
      issuedTrustNonces: this.issuedTrustNonces,
      registeredChannels: this.registeredChannels,
      environment: this.environment,
      windowOptions: this.windowOptions,
    });
  }, // End of function snapshot()
}; // End of the stub state object
globalThis.__omadaStub = stub;

// ============================================================================
// Helpers mirrored from src/main/index.ts
// ============================================================================

/**
 * Same check as isTrustedIpcSender() in src/main/index.ts: the sender frame
 * must be a file: URL resolving to the packaged renderer index.html.
 * @param {Electron.IpcMainInvokeEvent} event - The IPC invoke event.
 * @returns {boolean} True when the call comes from the app's own renderer.
 */
function isTrustedIpcSender(event) {
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
 * Same shape guard as isValidConfigSavePayload() in src/main/index.ts.
 * @param {unknown} payload - The raw IPC payload.
 * @returns {boolean} True when the shape is valid.
 */
function isValidConfigSavePayload(payload) {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  if (typeof payload.url !== 'string' || payload.url.length === 0 || payload.url.length > MAX_URL_LENGTH) {
    return false;
  }
  if (typeof payload.username !== 'string' || payload.username.length === 0 || payload.username.length > MAX_USERNAME_LENGTH) {
    return false;
  }
  if (payload.language !== 'es' && payload.language !== 'en') {
    return false;
  }
  if (payload.password !== undefined && (typeof payload.password !== 'string' || payload.password.length > MAX_PASSWORD_LENGTH)) {
    return false;
  }
  return true;
} // End of function isValidConfigSavePayload()

/**
 * Returns a copy of a list sorted by a string field with localeCompare, like
 * OmadaController.getAccessPoints()/getWlanGroups() do.
 * @param {object[]} list - The list to sort.
 * @param {string} field - The string field to sort by.
 * @returns {object[]} The sorted copy.
 */
function sortedCopy(list, field) {
  return structuredClone(list).sort((a, b) => String(a[field]).localeCompare(String(b[field])));
}

/**
 * Waits for the given number of milliseconds.
 * @param {number} ms - Delay.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Fake IPC handlers (one per IPC_CHANNELS entry)
// ============================================================================

const handlers = {
  /**
   * CONFIG_LOAD: the sanitized RendererConfig (never a password; the pinned
   * fingerprint is public data).
   * @returns {object} The configured RendererConfig.
   */
  [IPC_CHANNELS.CONFIG_LOAD]: () => structuredClone({ pinnedFingerprint: null, ...stub.scenario.config }),

  /**
   * CONFIG_SAVE: mirrors the handler's shape guard and applyConfigSave()'s
   * rules (URL normalization, password keep/require, URL-scoped credentials:
   * a URL change requires a typed password and drops the site id and the
   * certificate pin) but only updates the in-memory scenario — nothing is
   * written to disk. A URL change is also a controller transition in main
   * (ConnectionManager.applyConfigSave()): the controller and any pending
   * decision are dropped and the result carries connectionReset.
   * @param {unknown} payload - The ConfigSavePayload sent by the renderer.
   * @returns {object} The ConfigSaveResult.
   */
  [IPC_CHANNELS.CONFIG_SAVE]: (payload) => {
    if (stub.scenario.saveResult) {
      return structuredClone(stub.scenario.saveResult);
    }
    if (!isValidConfigSavePayload(payload)) {
      return { success: false, error: 'saveFailed' };
    }
    const url = normalizeControllerUrl(payload.url);
    if (!url) {
      return { success: false, error: 'invalidUrl' };
    }
    if (!payload.username.trim()) {
      return { success: false, error: 'saveFailed' };
    }
    const typedPassword = typeof payload.password === 'string' && payload.password.length > 0;
    const urlChanged = !isSameControllerUrl(stub.scenario.config.url, url);
    if (!typedPassword && (urlChanged || !stub.scenario.config.hasPassword)) {
      return { success: false, error: 'passwordRequired' };
    }
    let pinnedFingerprint = stub.scenario.config.pinnedFingerprint || null;
    if (urlChanged) {
      stub.storedSiteId = '';
      stub.pendingTrust = null;
      stub.pendingSelection = null;
      stub.connected = false;
      pinnedFingerprint = null;
    }
    stub.scenario.config = { url, username: payload.username.trim(), language: payload.language, hasPassword: true, pinnedFingerprint };
    return urlChanged ? { success: true, connectionReset: true } : { success: true };
  }, // End of the CONFIG_SAVE handler

  /**
   * OMADA_CONNECT: mirrors the real result shapes — configIncomplete, a
   * failure template, success, or needsSiteSelection with the sites and a
   * fresh 32-hex nonce (a still-authorized remembered site is reused silently,
   * like OmadaController.connect(preferredSiteId)).
   * @returns {object} The ConnectionResult.
   */
  [IPC_CHANNELS.OMADA_CONNECT]: () => {
    // A newer connect supersedes any pending selection (discardPendingSiteSelection)
    // and any pending certificate trust decision
    stub.pendingSelection = null;
    stub.pendingTrust = null;
    const config = stub.scenario.config;
    if (!config.url || !config.username || !config.hasPassword) {
      return { success: false, error: 'configIncomplete' };
    }
    // Certificate pinning: the TLS handshake of the first request fails
    // before anything (the password included) is sent
    const presented = stub.scenario.presentedFingerprint;
    if (presented) {
      const host = new URL(config.url).host;
      const pinned = config.pinnedFingerprint || null;
      if (!pinned) {
        const trustNonce = randomBytes(16).toString('hex');
        stub.issuedTrustNonces.push(trustNonce);
        stub.pendingTrust = { nonce: trustNonce, fingerprint: presented, url: config.url };
        return { success: false, error: 'certificateUntrusted', certificate: { host, fingerprint: presented }, trustNonce };
      }
      if (pinned !== presented) {
        return { success: false, error: 'certificateChanged', certificate: { host, fingerprint: presented, pinnedFingerprint: pinned } };
      }
    } // End of the certificate pinning branch
    const template = stub.scenario.connect;
    if (template.needsSiteSelection) {
      const sites = structuredClone(stub.scenario.sites);
      // The previously installed controller is released either way
      stub.connected = false;
      if (stub.storedSiteId && sites.some((site) => site.id === stub.storedSiteId)) {
        stub.connected = true;
        return { success: true };
      }
      const nonce = randomBytes(16).toString('hex');
      stub.issuedNonces.push(nonce);
      stub.pendingSelection = { nonce, sites };
      return { success: false, needsSiteSelection: true, sites, selectionNonce: nonce };
    }
    if (template.success) {
      stub.connected = true;
      return { success: true };
    }
    // A failed attempt installs nothing (any previous controller is untouched)
    return structuredClone(template);
  }, // End of the OMADA_CONNECT handler

  /**
   * OMADA_GET_APS: the fixture APs sorted by name; throws when not connected.
   * @returns {object[]} The AccessPoint DTOs.
   */
  [IPC_CHANNELS.OMADA_GET_APS]: () => {
    if (!stub.connected) {
      throw new Error('Not connected to the controller');
    }
    return sortedCopy(stub.scenario.accessPoints, 'name');
  },

  /**
   * OMADA_GET_WLANS: the GroupListing shape of the real handler — the fixture
   * groups sorted by name plus the scenario's controller version and the group
   * model the real rule derives from it; throws when not connected.
   * @returns {object} The GroupListing DTO.
   */
  [IPC_CHANNELS.OMADA_GET_WLANS]: () => {
    if (!stub.connected) {
      throw new Error('Not connected to the controller');
    }
    const controllerVersion = normalizeControllerVersion(stub.scenario.controllerVersion);
    return {
      controllerVersion,
      groupModel: groupModelForVersion(controllerVersion),
      groups: sortedCopy(stub.scenario.wlanGroups, 'wlanName'),
    };
  }, // End of the OMADA_GET_WLANS handler

  /**
   * OMADA_SET_WLAN: same format guards as the real handler; on success the
   * stub "applies" the move (the AP now reports the group's name), so a
   * reload shows the change like a real controller would.
   * @param {unknown} mac - AP MAC address.
   * @param {unknown} wlanId - Target group id.
   * @returns {boolean} The configured result.
   */
  [IPC_CHANNELS.OMADA_SET_WLAN]: (mac, wlanId) => {
    if (typeof mac !== 'string' || !MAC_REGEX.test(mac)) {
      throw new Error('IPC call rejected: invalid MAC address format');
    }
    if (typeof wlanId !== 'string' || !WLAN_ID_REGEX.test(wlanId)) {
      throw new Error('IPC call rejected: invalid WLAN id format');
    }
    if (!stub.connected) {
      throw new Error('Not connected to the controller');
    }
    if ((stub.scenario.setWlanFailMacs || []).includes(mac)) {
      return false;
    }
    if (stub.scenario.setWlanResult === true) {
      const group = stub.scenario.wlanGroups.find((candidate) => candidate.wlanId === wlanId);
      const accessPoint = stub.scenario.accessPoints.find((candidate) => candidate.mac === mac);
      if (group && accessPoint) {
        accessPoint.wlanGroup = group.wlanName;
      }
    }
    return stub.scenario.setWlanResult;
  }, // End of the OMADA_SET_WLAN handler

  /**
   * OMADA_SELECT_SITE: same format guards; succeeds only for the current
   * pending nonce and one of its sites, then "installs" the controller and
   * remembers the site.
   * @param {unknown} siteId - Chosen site id.
   * @param {unknown} nonce - Selection nonce echoed by the renderer.
   * @returns {object} The ConnectionResult.
   */
  [IPC_CHANNELS.OMADA_SELECT_SITE]: (siteId, nonce) => {
    if (typeof siteId !== 'string' || !SITE_ID_REGEX.test(siteId)) {
      throw new Error('IPC call rejected: invalid site id format');
    }
    if (typeof nonce !== 'string' || !SELECTION_NONCE_REGEX.test(nonce)) {
      throw new Error('IPC call rejected: invalid selection nonce format');
    }
    const pending = stub.pendingSelection;
    if (!pending || pending.nonce !== nonce || !pending.sites.some((site) => site.id === siteId)) {
      return { success: false, error: 'siteUnavailable' };
    }
    stub.pendingSelection = null;
    stub.connected = true;
    stub.storedSiteId = siteId;
    return { success: true };
  }, // End of the OMADA_SELECT_SITE handler

  /**
   * OMADA_DISCONNECT: without a nonce, an unconditional disconnect; with a
   * nonce, an abort of the matching pending selection only (stale = no-op).
   * @param {unknown} nonce - Optional selection nonce.
   * @returns {void}
   */
  [IPC_CHANNELS.OMADA_DISCONNECT]: (nonce) => {
    if (nonce !== undefined && (typeof nonce !== 'string' || !SELECTION_NONCE_REGEX.test(nonce))) {
      throw new Error('IPC call rejected: invalid selection nonce format');
    }
    if (nonce !== undefined) {
      if (stub.pendingSelection && stub.pendingSelection.nonce === nonce) {
        stub.pendingSelection = null;
      }
      return undefined;
    }
    stub.pendingSelection = null;
    stub.pendingTrust = null;
    stub.connected = false;
    return undefined;
  }, // End of the OMADA_DISCONNECT handler

  /**
   * CERT_TRUST: same guards as the real handler (no extra arguments, nonce
   * format, exact match with the current pending record while the configured
   * URL is unchanged); pins the fingerprint the stub itself recorded.
   * @param {unknown} nonce - Trust nonce echoed by the renderer.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The CertificateActionResult.
   */
  [IPC_CHANNELS.CERT_TRUST]: (nonce, ...extra) => {
    if (extra.length > 0) {
      throw new Error('IPC call rejected: unexpected arguments');
    }
    if (typeof nonce !== 'string' || !TRUST_NONCE_REGEX.test(nonce)) {
      throw new Error('IPC call rejected: invalid trust nonce format');
    }
    const pending = stub.pendingTrust;
    if (!pending || pending.nonce !== nonce || pending.url !== stub.scenario.config.url) {
      return { success: false, error: 'trustUnavailable' };
    }
    stub.pendingTrust = null;
    stub.scenario.config.pinnedFingerprint = pending.fingerprint;
    return { success: true };
  }, // End of the CERT_TRUST handler

  /**
   * CERT_RESET: no arguments allowed; forgets the pin and, like the real
   * controller transition (ConnectionManager.resetCertificate()), drops the
   * controller and any pending decision; the result carries connectionReset.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The CertificateActionResult.
   */
  [IPC_CHANNELS.CERT_RESET]: (...extra) => {
    if (extra.length > 0) {
      throw new Error('IPC call rejected: unexpected arguments');
    }
    stub.pendingTrust = null;
    stub.pendingSelection = null;
    stub.connected = false;
    stub.scenario.config.pinnedFingerprint = null;
    return { success: true, connectionReset: true };
  }, // End of the CERT_RESET handler
}; // End of the fake handlers table

// Every channel of the shared table must have a fake, and vice versa: a
// channel added in a later phase fails the smoke loudly until it is stubbed
const channelValues = Object.values(IPC_CHANNELS);
const missing = channelValues.filter((channel) => typeof handlers[channel] !== 'function');
const unknown = Object.keys(handlers).filter((channel) => !channelValues.includes(channel));
if (missing.length > 0 || unknown.length > 0) {
  console.error(`[stub-main] IPC stub out of sync with IPC_CHANNELS: missing ${JSON.stringify(missing)}, unknown ${JSON.stringify(unknown)}`);
  process.exit(3);
}

for (const channel of channelValues) {
  ipcMain.handle(channel, async (event, ...args) => {
    const trusted = isTrustedIpcSender(event);
    stub.calls.push({ channel, args: structuredClone(args), trusted, at: Date.now() });
    if (!trusted) {
      stub.untrustedCalls++;
      throw new Error('IPC call rejected: untrusted sender frame');
    }
    const delay = stub.scenario.delays[channel];
    if (typeof delay === 'number' && delay > 0) {
      await sleep(delay);
    }
    if ((stub.scenario.failChannels || []).includes(channel)) {
      throw new Error('Simulated controller failure');
    }
    return handlers[channel](...args);
  }); // End of the generic IPC handler wrapper
  stub.registeredChannels.push(channel);
} // End of the loop that registers one handler per IPC channel

// ============================================================================
// Window (same options and guards as createWindow() in src/main/index.ts)
// ============================================================================

/**
 * Creates the main window like the real app and records renderer-side
 * errors from the very first load on (console errors, preload errors,
 * crashes, failed loads) so none can slip past the runner.
 */
function createWindow() {
  const windowOptions = {
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  };
  stub.windowOptions = structuredClone(windowOptions);
  const mainWindow = new BrowserWindow(windowOptions);

  const contents = mainWindow.webContents;
  // Message details come on the event object (Electron 35 deprecated the
  // positional level/message/line/sourceId arguments; `level` is now a string)
  contents.on('console-message', (details) => {
    if (details.level === 'error') {
      stub.rendererErrors.push(`console.error: ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });
  contents.on('preload-error', (_event, preloadPath, error) => {
    stub.rendererErrors.push(`preload-error: ${preloadPath}: ${error && error.message}`);
  });
  contents.on('render-process-gone', (_event, details) => {
    stub.rendererErrors.push(`render-process-gone: ${details.reason}`);
  });
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    stub.rendererErrors.push(`did-fail-load: ${errorCode} ${errorDescription} ${validatedUrl}`);
  });

  mainWindow.loadFile(RENDERER_HTML_PATH).catch((error) => {
    stub.rendererErrors.push(`loadFile failed: ${error.message}`);
    mainWindow.show();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Same navigation / new-window guards as the real app
  contents.on('will-navigate', (event) => {
    if (new URL(event.url).protocol !== 'file:') {
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
} // End of function createWindow()

app.whenReady().then(() => {
  // No network, ever: cancel anything the window requests outside file:
  // (the CSP already limits it to 'self' plus data: images)
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith('file:') || details.url.startsWith('data:') || details.url.startsWith('devtools:')) {
      callback({});
      return;
    }
    stub.blockedRequests.push(details.url);
    callback({ cancel: true });
  });
  createWindow();
}); // End of the app ready handler

app.on('window-all-closed', () => {
  app.quit();
});
