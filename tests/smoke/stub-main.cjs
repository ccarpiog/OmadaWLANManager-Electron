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
// network or touches the user's config. It only requires seven pure compiled
// modules (shared/types.js for the channel table, main/url.js for URL
// normalization and the same-controller check, main/controller-version.js for
// the version -> group-model rule, main/ap-group-policy.js and
// main/ipc-guards.js for the AP-group name rules, delete policy, DTO and IPC
// shape guards, main/wifi-network-model.js for the Wi-Fi network validators
// and DTO, main/wifi-network-write.js for the Wi-Fi network write rules,
// bodies and the security / band derivation, incl. its 'securityBandConflict'
// refusals with their diagnostic), refuses to start unless HOME points away from the real
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
const { AP_GROUP_ID_REGEX, checkApGroupDeletion, hasApGroupNameConflict, toApGroupSsidLimits, toManagedApGroup, validateApGroupName } = require(
  path.join(distDir, 'main', 'ap-group-policy.js')
);
const {
  parseApGroupCreateRequest,
  parseApGroupDeleteRequest,
  parseApGroupRenameRequest,
  parseNetworkCreateRequest,
  parseNetworkDeleteRequest,
  parseNetworkEnableRequest,
  parseNetworkPasswordRequest,
  parseNetworkUpdateRequest,
  requireSessionNonce,
} = require(path.join(distDir, 'main', 'ipc-guards.js'));
const { MAX_MANAGED_NETWORKS, toManagedNetwork, validateOpenApiSsid, validateOpenApiSsidDetail, validateSsidBindings } = require(
  path.join(distDir, 'main', 'wifi-network-model.js')
);
const { buildCreateSsidBody, checkNetworkCreate, checkNetworkEdits, isTypedPassphrase, mergeBasicConfig } = require(
  path.join(distDir, 'main', 'wifi-network-write.js')
);

// Format guards mirrored from src/main/index.ts (keep in sync)
const MAC_REGEX = /^[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}$/;
const WLAN_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const SITE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const SELECTION_NONCE_REGEX = /^[0-9a-f]{32}$/;
const TRUST_NONCE_REGEX = /^[0-9a-f]{32}$/;
const SESSION_NONCE_REGEX = /^[0-9a-f]{32}$/;
const MAX_URL_LENGTH = 2048;
const MAX_USERNAME_LENGTH = 256;
const MAX_PASSWORD_LENGTH = 512;
const MAX_CLIENT_ID_LENGTH = 256;
const MAX_CLIENT_SECRET_LENGTH = 512;
const CONFIG_SAVE_KEYS = new Set(['url', 'username', 'language', 'password', 'clientId', 'clientSecret', 'removeManagementAccess']);
// Mirrored from CLIENT_ID_REGEX in src/main/config-model.ts (keep in sync)
const CLIENT_ID_REGEX = /^[A-Za-z0-9._-]{1,128}$/;
// The management-access flags of a RendererConfig with nothing stored
// (ManagementAccessStatus in src/shared/types.ts)
const NO_MANAGEMENT_ACCESS = { clientId: '', hasClientSecret: false, clientSecretSessionOnly: false };

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
    // CERT_TRUST and CERT_RESET; pinnedFingerprint mirrors the stored TOFU pin).
    // Its management-access flags (clientId, hasClientSecret,
    // clientSecretSessionOnly) default to "nothing stored", and
    // canPersistClientSecret to true; set it to false to play a session
    // without safeStorage (a typed Client Secret is then session-only). The
    // stub never keeps a Client Secret, only these flags
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
    // The site name a { success: true } connect reports (the single site of
    // the controller, like ControllerSession.activate()); null reports none.
    // A multi-site connect reports the chosen or remembered site's name
    siteName: null,
    // Management capabilities (MANAGEMENT_CAPABILITIES / MANAGEMENT_TEST),
    // mirroring the check order of ControllerSession: a legacy controller
    // version -> legacyController; no Client ID or no Client Secret in the
    // config -> managementNotConfigured; else this reason code (null = every
    // check passed) with managementDiagnostic as its codes-only diagnostic
    managementReason: null,
    managementDiagnostic: null,
    // When set, both management channels return this verbatim (e.g.
    // { success: false, error: 'superseded' })
    managementResult: null,
    // AP-group management (management:ap-groups / -create / -rename /
    // -delete). The fake controller's AP groups ARE `wlanGroups` (what
    // OMADA_GET_WLANS lists), so a create / rename / delete shows on the next
    // reload as on a real controller. Each group's Open API view is derived
    // (openApiGroups()): apNum = the fixture APs reporting its name,
    // ssidNameList = its ssidList names, primary = isDefault, and per band
    // remainingBinding = apGroupSsidLimits minus its networks.
    // apGroupOverrides (group id -> fields) replaces any of them; null
    // removes one ("not reported"), e.g. { '<id>': { apNum: 2 } } plays fresh
    // data showing APs in a group the renderer thought empty. An insane value
    // (e.g. ssidNameList: [null]) reaches the real rules unvalidated; they
    // fail closed on it like OpenApiClient's validator (groupStateUnknown,
    // left out of the DTO)
    apGroupOverrides: {},
    // The per-group SSID limits the fake ap-groups page reports (DTO shape)
    apGroupSsidLimits: { band2g: 8, band5g: 8, band6g: 8, mlo: 4 },
    // Per AP-group channel, a reply returned verbatim once the guards, the
    // session, capability, name and policy checks passed — i.e. the
    // controller's answer to the write (e.g. { 'management:ap-group-create':
    // { success: false, error: 'groupLimitReached', diagnostic: 'apiError,
    // errorCode -33201' } }); nothing is applied then
    apGroupResults: {},
    // Wi-Fi network read (management:networks, phase 17a): the fake
    // controller's networks as RAW Open API payloads, each { entry, detail,
    // bindings } — `entry` one entry of the v2 catalog, `detail` the v1 detail
    // `result`, `bindings` the v1 …/ap-groups `result`. The stub runs them
    // through the REAL validators and DTO builder (wifi-network-model.js) in
    // the order ControllerSession.listManagedNetworks() reads them, so a
    // malformed payload is refused with the same code and diagnostic (e.g.
    // 'ssids: malformedResponse'), and a secret in a payload never reaches the
    // reply. null (default): derived from wlanGroups (fakeNetworks())
    networks: null,
    // When set, management:networks returns this verbatim once the guard and
    // the session and capability checks passed — the controller's answer
    // (e.g. { success: false, error: 'requestFailed', diagnostic: 'ssids:
    // httpError, HTTP 503' })
    networksResult: null,
    // Wi-Fi network writes (management:network-create / -update / -password
    // / -enable / -delete, phase 18a): applied to the fake controller's
    // networks — the derived ones are materialized into `networks` on the
    // first write, so the ids stay stable — and so shown on the next read.
    // Per write channel, a reply returned verbatim once the guards, the
    // session, the write rules, the capability and the fresh-data checks
    // passed — the controller's answer to the write (e.g. {
    // 'management:network-update': { success: false, error: 'nameTaken',
    // diagnostic: 'ssid basic-config: apiError, errorCode -33219' } });
    // nothing is applied then
    networkResults: {},
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
    // (a partially failing bulk move whose failure carries no message)
    setWlanFailMacs: [],
    // MACs whose OMADA_SET_WLAN throws, mapped to the error message, like the
    // real handler when the controller rejects the PATCH (it throws the
    // response's `msg`); checked before setWlanFailMacs
    setWlanErrors: {},
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
  // The session nonce of the installed controller session (null when none),
  // and every session nonce handed out by a successful connect or site
  // selection, in order
  sessionNonce: null,
  issuedSessionNonces: [],
  // AP-group writes the fake controller applied, in order:
  // { op: 'create' | 'rename' | 'delete', apGroupId, name? }
  apGroupWrites: [],
  // Wi-Fi network writes the fake controller applied, in order: { op:
  // 'create' | 'update' | 'password', networkId, body } (body = exactly what
  // the real builders produced, i.e. what main would send — a typed
  // passphrase included, as the controller would receive it) or { op:
  // 'enable', networkId, enabled } or { op: 'delete', networkId }
  networkWrites: [],
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
      sessionNonce: this.sessionNonce,
      issuedSessionNonces: this.issuedSessionNonces,
      apGroupWrites: this.apGroupWrites,
      networkWrites: this.networkWrites,
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
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }
  if (Object.keys(payload).some((key) => !CONFIG_SAVE_KEYS.has(key))) {
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
  if (payload.clientId !== undefined && (typeof payload.clientId !== 'string' || payload.clientId.length === 0 || payload.clientId.length > MAX_CLIENT_ID_LENGTH)) {
    return false;
  }
  if (
    payload.clientSecret !== undefined &&
    (typeof payload.clientSecret !== 'string' || payload.clientSecret.length === 0 || payload.clientSecret.length > MAX_CLIENT_SECRET_LENGTH)
  ) {
    return false;
  }
  if (payload.removeManagementAccess !== undefined && (payload.removeManagementAccess !== true || payload.clientId !== undefined || payload.clientSecret !== undefined)) {
    return false;
  }
  return true;
} // End of function isValidConfigSavePayload()

/**
 * Returns the current RendererConfig with the management-access defaults
 * filled in (nothing stored; the secret can be persisted).
 * @returns {object} The RendererConfig.
 */
function currentRendererConfig() {
  return { pinnedFingerprint: null, ...NO_MANAGEMENT_ACCESS, canPersistClientSecret: true, ...stub.scenario.config };
}

/**
 * Mirrors applyManagementAccessSave() in src/main/config-model.ts on the
 * management-access FLAGS only (the stub never keeps a Client Secret): a
 * removal or a URL change without new credentials clears them; a typed secret
 * needs a valid Client ID and is session-only when the scenario cannot
 * persist it; a blank secret keeps the stored one only for the same URL and
 * Client ID.
 * @param {object} payload - The (shape-checked) ConfigSavePayload.
 * @param {object} current - The current RendererConfig.
 * @param {boolean} urlChanged - Whether the save changes the controller URL.
 * @returns {{ ok: true; management: object } | { ok: false; error: string }} The outcome.
 */
function applyManagementSave(payload, current, urlChanged) {
  const typedSecret = typeof payload.clientSecret === 'string' && payload.clientSecret.length > 0;
  if (payload.removeManagementAccess === true) {
    return { ok: true, management: { ...NO_MANAGEMENT_ACCESS } };
  }
  if (payload.clientId === undefined) {
    if (typedSecret) {
      return { ok: false, error: 'clientIdRequired' };
    }
    if (urlChanged) {
      return { ok: true, management: { ...NO_MANAGEMENT_ACCESS } };
    }
    return { ok: true, management: { clientId: current.clientId, hasClientSecret: current.hasClientSecret, clientSecretSessionOnly: current.clientSecretSessionOnly } };
  }
  const clientId = payload.clientId.trim();
  if (!CLIENT_ID_REGEX.test(clientId)) {
    return { ok: false, error: 'invalidClientId' };
  }
  if (typedSecret) {
    return { ok: true, management: { clientId, hasClientSecret: true, clientSecretSessionOnly: current.canPersistClientSecret === false } };
  }
  if (!urlChanged && clientId === current.clientId) {
    return { ok: true, management: { clientId, hasClientSecret: current.hasClientSecret, clientSecretSessionOnly: current.clientSecretSessionOnly } };
  }
  return { ok: false, error: 'clientSecretRequired' };
} // End of function applyManagementSave()

/**
 * "Installs" a controller session like ConnectionManager.install() +
 * ControllerSession.activate(): marks the stub connected, hands out a fresh
 * session nonce and returns the success result with the site name (when one
 * is known) and the nonce.
 * @param {string | null} siteName - The name of the site the session uses.
 * @returns {object} The ConnectionResult.
 */
function installSession(siteName) {
  stub.connected = true;
  stub.sessionNonce = randomBytes(16).toString('hex');
  stub.issuedSessionNonces.push(stub.sessionNonce);
  return siteName ? { success: true, siteName, sessionNonce: stub.sessionNonce } : { success: true, sessionNonce: stub.sessionNonce };
}

/**
 * Drops the installed controller session (disconnect, controller transition).
 */
function dropSession() {
  stub.connected = false;
  stub.sessionNonce = null;
}

/**
 * The management capabilities of the installed session, in the check order of
 * ControllerSession (see managementReason in the scenario).
 * @returns {object} The ManagementCapabilities.
 */
function currentCapabilities() {
  const off = (reason, diagnostic) =>
    diagnostic ? { manageApGroups: false, manageWifiNetworks: false, reason, diagnostic } : { manageApGroups: false, manageWifiNetworks: false, reason };
  if (groupModelForVersion(normalizeControllerVersion(stub.scenario.controllerVersion)) !== 'apGroup') {
    return off('legacyController');
  }
  const config = currentRendererConfig();
  if (!config.clientId || !config.hasClientSecret) {
    return off('managementNotConfigured');
  }
  if (stub.scenario.managementReason) {
    return off(stub.scenario.managementReason, stub.scenario.managementDiagnostic);
  }
  return { manageApGroups: true, manageWifiNetworks: true, reason: null };
} // End of function currentCapabilities()

/**
 * The reply of both management channels, with the same guards as the real
 * handlers (requireSessionNonce() in src/main/index.ts) and the session
 * ownership of getSessionCapabilities() in src/main/controller-session.ts.
 * @param {unknown} sessionNonce - The session nonce echoed by the renderer.
 * @param {unknown[]} extra - Further arguments (must be none).
 * @returns {object} The ManagementCapabilitiesResult.
 */
function managementReply(sessionNonce, extra) {
  if (extra.length > 0) {
    throw new Error('IPC call rejected: unexpected arguments');
  }
  if (typeof sessionNonce !== 'string' || !SESSION_NONCE_REGEX.test(sessionNonce)) {
    throw new Error('IPC call rejected: invalid session nonce format');
  }
  if (stub.scenario.managementResult) {
    return structuredClone(stub.scenario.managementResult);
  }
  if (!stub.connected || stub.sessionNonce === null) {
    return { success: false, error: 'notConnected' };
  }
  if (sessionNonce !== stub.sessionNonce) {
    return { success: false, error: 'superseded' };
  }
  return { success: true, capabilities: currentCapabilities() };
} // End of function managementReply()

/**
 * The fake controller's AP groups as `GET …/ap-groups` would list them after
 * OpenApiClient validation (see apGroupOverrides in the scenario).
 * @returns {object[]} The groups (PolicyApGroup shape of ap-group-policy.ts).
 */
function openApiGroups() {
  const limits = stub.scenario.apGroupSsidLimits || {};
  const overrides = stub.scenario.apGroupOverrides || {};
  return stub.scenario.wlanGroups.map((group) => {
    const networks = (group.ssidList || []).map((ssid) => ssid.ssidName);
    const remainingBinding = {};
    for (const [key, band] of [['0', 'band2g'], ['1', 'band5g'], ['2', 'band6g']]) {
      if (typeof limits[band] === 'number') {
        remainingBinding[key] = Math.max(0, limits[band] - networks.length);
      }
    }
    const view = {
      id: group.wlanId,
      name: group.wlanName,
      apNum: stub.scenario.accessPoints.filter((ap) => ap.wlanGroup === group.wlanName).length,
      ssidNameList: networks,
      remainingBinding,
    };
    if (group.isDefault === true) {
      view.isDefault = true;
    }
    for (const [field, value] of Object.entries(overrides[group.wlanId] || {})) {
      if (value === null) {
        delete view[field];
      } else {
        view[field] = structuredClone(value);
      }
    }
    return view;
  }); // End of the per-group mapping
} // End of function openApiGroups()

/**
 * The session-ownership and capability checks of an AP-group call, like
 * apGroupReply() + ControllerSession's management context in
 * src/main/controller-session.ts, with the name of a create / rename
 * validated between the two, in the same order as there.
 * @param {string} sessionNonce - The shape-checked nonce.
 * @param {string | null} rawName - The name to validate first (create/rename), or null.
 * @returns {{ failure: object } | { name: string | null }} The failure reply, or the trimmed name.
 */
function apGroupPreconditions(sessionNonce, rawName) {
  if (!stub.connected || stub.sessionNonce === null) {
    return { failure: { success: false, error: 'notConnected' } };
  }
  if (sessionNonce !== stub.sessionNonce) {
    return { failure: { success: false, error: 'superseded' } };
  }
  let name = null;
  if (rawName !== null) {
    const checked = validateApGroupName(rawName);
    if (!checked.ok) {
      return { failure: { success: false, error: checked.error } };
    }
    name = checked.name;
  }
  if (!currentCapabilities().manageApGroups) {
    return { failure: { success: false, error: 'managementUnavailable' } };
  }
  return { name };
} // End of function apGroupPreconditions()

/**
 * The scenario's verbatim controller answer for an AP-group channel, if any.
 * @param {string} channel - The IPC channel.
 * @returns {object | null} The reply, or null.
 */
function scriptedApGroupResult(channel) {
  const result = (stub.scenario.apGroupResults || {})[channel];
  return result ? structuredClone(result) : null;
}

/**
 * The fake controller's Wi-Fi networks as raw Open API payloads (see
 * `networks` in the scenario). Derived by default from wlanGroups: one
 * WPA-Personal network (2.4 + 5 GHz, enabled, a throwaway passphrase that
 * must never reach the renderer) per distinct SSID name, sorted by name,
 * bound to the groups listing it — only groups whose id passes the same
 * AP-group id rule as the real validators (AP_GROUP_ID_REGEX, 24 hex digits:
 * the fixture's malformed-id group is left out, since one such id would make
 * the whole binding list, and so the scope, unknown).
 * @returns {Array<{ entry: unknown; detail: unknown; bindings: unknown }>} The networks.
 */
function fakeNetworks() {
  if (Array.isArray(stub.scenario.networks)) {
    return structuredClone(stub.scenario.networks);
  }
  const groups = stub.scenario.wlanGroups.filter((group) => AP_GROUP_ID_REGEX.test(group.wlanId));
  const names = [...new Set(groups.flatMap((group) => (group.ssidList || []).map((ssid) => ssid.ssidName)))].sort((a, b) => a.localeCompare(b));
  return names.map((name, index) => {
    const id = `5f00c0ffee${String(index + 1).padStart(14, '0')}`;
    const groupIds = groups.filter((group) => (group.ssidList || []).some((ssid) => ssid.ssidName === name)).map((group) => group.wlanId);
    return {
      entry: { id, ssidId: id, name, description: true, chooseDevices: 1, band: 3, security: 3, broadcast: true },
      // The detail also reports every setting a basic-config save must carry
      // (guest, broadcast, VLAN, MLO, PMF, 802.11r, …), so the derived
      // networks can be edited through the real read-merge-write
      detail: {
        id, name, ssidEnable: true, chooseDevices: 1, band: 3, security: 3, apGroupIds: groupIds,
        guestNetEnable: false, broadcast: true, vlanEnable: false, mloEnable: false, pmfMode: 2, enable11r: false, hidePwd: false,
        pskSetting: { securityKey: 'stub-passphrase-never-shown', versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: false },
      },
      bindings: { apGroups: groupIds.map((groupId) => ({ id: groupId })) },
    };
  }); // End of the per-name mapping
} // End of function fakeNetworks()

/**
 * The reply of a successful-session network read, like
 * ControllerSession.listManagedNetworks(): the catalog entries validated
 * (one malformed entry fails the read, duplicates by id dropped), the size
 * cap, then per network its detail and its bindings validated, in catalog
 * order, and the real DTO builder; the first malformed payload ends the read
 * with the session's codes-only diagnostic.
 * @returns {object} The ManagedNetworksResult.
 */
function readFakeNetworks() {
  const fakes = fakeNetworks();
  const listed = [];
  const seen = new Set();
  for (const fake of fakes) {
    const entry = validateOpenApiSsid(fake.entry);
    if (entry === null) {
      return { success: false, error: 'requestFailed', diagnostic: 'ssids: malformedResponse' };
    }
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      listed.push({ entry, fake });
    }
  } // End of the loop that validates the catalog
  if (listed.length > MAX_MANAGED_NETWORKS) {
    return { success: false, error: 'networkListIncomplete', diagnostic: `ssids ${listed.length}, over ${MAX_MANAGED_NETWORKS}` };
  }
  const networks = [];
  for (const { entry, fake } of listed) {
    const detail = validateOpenApiSsidDetail(fake.detail, entry.id);
    if (detail === null) {
      return { success: false, error: 'requestFailed', diagnostic: 'ssid detail: malformedResponse' };
    }
    const bindings = validateSsidBindings(fake.bindings);
    if (bindings === null) {
      return { success: false, error: 'requestFailed', diagnostic: 'ssid ap-groups: malformedResponse' };
    }
    networks.push(toManagedNetwork(entry, detail, bindings));
  } // End of the loop that reads each network's detail and bindings
  return { success: true, networks };
} // End of function readFakeNetworks()

/**
 * The fake controller's networks as a mutable list (see `networkResults` in
 * the scenario): the derived networks are materialized into
 * scenario.networks on the first write, so a write and the next read see the
 * same ids.
 * @returns {Array<{ entry: object; detail: object; bindings: object }>} The live list.
 */
function liveNetworks() {
  if (!Array.isArray(stub.scenario.networks)) {
    stub.scenario.networks = fakeNetworks();
  }
  return stub.scenario.networks;
}

/**
 * The fresh detail of one network as ControllerSession reads it before a
 * write (getSsidWriteDetail(): validated, it must name the network): the
 * live record, or the session's failure when the fake controller has none.
 * @param {string} networkId - The SSID id.
 * @returns {{ network: object } | { failure: object }} The live record, or the failure reply.
 */
function freshNetwork(networkId) {
  const network = liveNetworks().find((candidate) => {
    const entry = validateOpenApiSsid(candidate.entry);
    return entry !== null && entry.id === networkId;
  });
  if (!network || validateOpenApiSsidDetail(network.detail, networkId) === null) {
    return { failure: { success: false, error: 'requestFailed', diagnostic: 'ssid detail: malformedResponse' } };
  }
  return { network };
} // End of function freshNetwork()

/**
 * The reply of a refused Wi-Fi network write rule (the real rules of
 * wifi-network-write.js): its stable code, plus — like
 * ControllerSession's networkWriteFailure() — the codes-only diagnostic a
 * refusal carries (e.g. 'conflict: enhancedIotConnectivity' with
 * 'securityBandConflict').
 * @param {{ error: string; diagnostic?: string }} refusal - The rule's refusal.
 * @returns {object} The NetworkActionResult.
 */
function networkRuleRefusal(refusal) {
  return refusal.diagnostic ? { success: false, error: refusal.error, diagnostic: refusal.diagnostic } : { success: false, error: refusal.error };
}

/**
 * The session-ownership check of a Wi-Fi network write (sessionOwnedReply()).
 * @param {string} sessionNonce - The shape-checked nonce.
 * @returns {object | null} The failure reply, or null.
 */
function networkOwnership(sessionNonce) {
  if (!stub.connected || stub.sessionNonce === null) {
    return { success: false, error: 'notConnected' };
  }
  return sessionNonce === stub.sessionNonce ? null : { success: false, error: 'superseded' };
}

/**
 * The scenario's verbatim controller answer for a Wi-Fi network write channel, if any.
 * @param {string} channel - The IPC channel.
 * @returns {object | null} The reply, or null.
 */
function scriptedNetworkResult(channel) {
  const result = (stub.scenario.networkResults || {})[channel];
  return result ? structuredClone(result) : null;
}

/**
 * Renames (or drops, with `to` null) a network name in every fake group's
 * ssidList, so the internal group data (OMADA_GET_WLANS) follows the writes.
 * @param {string} from - The old name.
 * @param {string | null} to - The new name, or null to remove it.
 */
function renameInGroups(from, to) {
  for (const group of stub.scenario.wlanGroups) {
    const list = group.ssidList || [];
    group.ssidList = to === null ? list.filter((ssid) => ssid.ssidName !== from) : list.map((ssid) => (ssid.ssidName === from ? { ssidName: to } : ssid));
  }
}

/**
 * Applies a basic-config body to a live network like the controller would:
 * the body's settings replace the detail's, the catalog entry follows, an
 * open result drops the WPA-Personal settings, and a new name is renamed in
 * the groups' ssidList.
 * @param {{ entry: object; detail: object }} network - The live record.
 * @param {object} body - The merged basic-config body.
 */
function applyBasicConfig(network, body) {
  const oldName = network.entry.name;
  Object.assign(network.detail, structuredClone(body));
  if (body.security === 0) {
    delete network.detail.pskSetting;
  }
  Object.assign(network.entry, { name: body.name, band: body.band, security: body.security });
  if (oldName !== body.name) {
    renameInGroups(oldName, body.name);
  }
} // End of function applyBasicConfig()

/**
 * The read-merge-write of a basic-config save in the stub, in the session's
 * order after the rule check: the capability, the fresh detail, the real
 * merge (mergeBasicConfig()), the scripted answer, then the fake controller
 * applies the body and records the write.
 * @param {'update' | 'password'} op - The write.
 * @param {string} channel - The IPC channel.
 * @param {string} networkId - The SSID id.
 * @param {object} edits - The checked edits (checkNetworkEdits()).
 * @returns {object} The NetworkActionResult.
 */
function saveFakeBasicConfig(op, channel, networkId, edits) {
  if (!currentCapabilities().manageWifiNetworks) {
    return { success: false, error: 'managementUnavailable' };
  }
  const fresh = freshNetwork(networkId);
  if (fresh.failure) {
    return fresh.failure;
  }
  const merged = mergeBasicConfig(fresh.network.detail, edits);
  if (!merged.ok) {
    return networkRuleRefusal(merged);
  }
  const scripted = scriptedNetworkResult(channel);
  if (scripted) {
    return scripted;
  }
  applyBasicConfig(fresh.network, merged.body);
  stub.networkWrites.push({ op, networkId, body: structuredClone(merged.body) });
  return { success: true };
} // End of function saveFakeBasicConfig()

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
   * CONFIG_LOAD: the sanitized RendererConfig (never a password or a Client
   * Secret; the pinned fingerprint is public data).
   * @returns {object} The configured RendererConfig.
   */
  [IPC_CHANNELS.CONFIG_LOAD]: () => structuredClone(currentRendererConfig()),

  /**
   * CONFIG_SAVE: mirrors the handler's shape guard and applyConfigSave()'s
   * rules (URL normalization, password keep/require, URL-scoped credentials:
   * a URL change requires a typed password and drops the site id, the
   * certificate pin and the management access; the management-access rules
   * on flags, see applyManagementSave()) but only updates the in-memory
   * scenario — nothing is written to disk. A URL change is also a controller
   * transition in main (ConnectionManager.applyConfigSave()): the controller
   * and any pending decision are dropped and the result carries
   * connectionReset. A success carries managementAccess (flags only).
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
    const current = currentRendererConfig();
    const management = applyManagementSave(payload, current, urlChanged);
    if (!management.ok) {
      return { success: false, error: management.error };
    }
    let pinnedFingerprint = stub.scenario.config.pinnedFingerprint || null;
    if (urlChanged) {
      stub.storedSiteId = '';
      stub.pendingTrust = null;
      stub.pendingSelection = null;
      dropSession();
      pinnedFingerprint = null;
    }
    stub.scenario.config = {
      url,
      username: payload.username.trim(),
      language: payload.language,
      hasPassword: true,
      pinnedFingerprint,
      ...management.management,
      canPersistClientSecret: current.canPersistClientSecret,
    };
    const managementAccess = { ...management.management, canPersistClientSecret: current.canPersistClientSecret };
    return urlChanged ? { success: true, connectionReset: true, managementAccess } : { success: true, managementAccess };
  }, // End of the CONFIG_SAVE handler

  /**
   * OMADA_CONNECT: mirrors the real result shapes — configIncomplete, a
   * failure template, success (with the site name and a fresh session
   * nonce, see installSession()), or needsSiteSelection with the sites and a
   * fresh 32-hex nonce (a still-authorized remembered site is reused silently,
   * like OmadaController.connect(preferredSiteId)).
   * @returns {object} The ConnectionResult.
   */
  [IPC_CHANNELS.OMADA_CONNECT]: () => {
    // A newer connect supersedes any pending selection (discardPendingSiteSelection)
    // and any pending certificate trust decision
    stub.pendingSelection = null;
    stub.pendingTrust = null;
    // A new attempt closes the installed session's management side before
    // its first await (ConnectionManager.connect()): the old session nonce
    // answers notConnected from now on, while the internal controller
    // (stub.connected) stays installed until the attempt succeeds
    stub.sessionNonce = null;
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
      dropSession();
      const remembered = sites.find((site) => site.id === stub.storedSiteId);
      if (stub.storedSiteId && remembered) {
        return installSession(remembered.name);
      }
      const nonce = randomBytes(16).toString('hex');
      stub.issuedNonces.push(nonce);
      stub.pendingSelection = { nonce, sites };
      return { success: false, needsSiteSelection: true, sites, selectionNonce: nonce };
    }
    if (template.success) {
      return installSession(stub.scenario.siteName);
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
   * OMADA_SET_WLAN: same format guards as the real handler; a MAC listed in
   * setWlanErrors throws its message (a controller rejection) and one in
   * setWlanFailMacs resolves false; on success the stub "applies" the move
   * (the AP now reports the group's name), so a reload shows the change like
   * a real controller would.
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
    const errorMessage = (stub.scenario.setWlanErrors || {})[mac];
    if (typeof errorMessage === 'string') {
      throw new Error(errorMessage);
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
   * pending nonce and one of its sites, then "installs" the controller
   * session (site name + session nonce in the result) and remembers the site.
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
    const chosen = pending ? pending.sites.find((site) => site.id === siteId) : undefined;
    if (!pending || pending.nonce !== nonce || !chosen) {
      return { success: false, error: 'siteUnavailable' };
    }
    stub.pendingSelection = null;
    stub.storedSiteId = siteId;
    return installSession(chosen.name);
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
    dropSession();
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
    dropSession();
    stub.scenario.config.pinnedFingerprint = null;
    return { success: true, connectionReset: true };
  }, // End of the CERT_RESET handler

  /**
   * MANAGEMENT_CAPABILITIES: the capabilities of the installed session (see
   * managementReply() and currentCapabilities()).
   * @param {unknown} sessionNonce - The session nonce echoed by the renderer.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The ManagementCapabilitiesResult.
   */
  [IPC_CHANNELS.MANAGEMENT_CAPABILITIES]: (sessionNonce, ...extra) => managementReply(sessionNonce, extra),

  /**
   * MANAGEMENT_TEST ("Test management access"): the same reply (the stub
   * "runs the checks again" by recomputing them from the scenario).
   * @param {unknown} sessionNonce - The session nonce echoed by the renderer.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The ManagementCapabilitiesResult.
   */
  [IPC_CHANNELS.MANAGEMENT_TEST]: (sessionNonce, ...extra) => managementReply(sessionNonce, extra),

  /**
   * MANAGEMENT_AP_GROUPS: the real shape guard (requireSessionNonce()), the
   * session and capability checks, then the fake controller's groups as the
   * real DTO (toManagedApGroup()) plus the SSID limits.
   * @param {unknown} sessionNonce - The session nonce echoed by the renderer.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The ManagedApGroupsResult.
   */
  [IPC_CHANNELS.MANAGEMENT_AP_GROUPS]: (sessionNonce, ...extra) => {
    const nonce = requireSessionNonce(sessionNonce, extra);
    const checked = apGroupPreconditions(nonce, null);
    if (checked.failure) {
      return checked.failure;
    }
    const scripted = scriptedApGroupResult(IPC_CHANNELS.MANAGEMENT_AP_GROUPS);
    if (scripted) {
      return scripted;
    }
    const reply = { success: true, groups: openApiGroups().map(toManagedApGroup) };
    const ssidLimits = toApGroupSsidLimits(stub.scenario.apGroupSsidLimits || undefined);
    if (ssidLimits) {
      reply.ssidLimits = ssidLimits;
    }
    return reply;
  }, // End of the MANAGEMENT_AP_GROUPS handler

  /**
   * MANAGEMENT_AP_GROUP_CREATE: the real shape guard, the session, name and
   * capability checks, the name-conflict rule on the current groups; then a
   * new empty group with a fresh 24-hex id joins wlanGroups.
   * @param {unknown} payload - { sessionNonce, name }.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The ApGroupActionResult.
   */
  [IPC_CHANNELS.MANAGEMENT_AP_GROUP_CREATE]: (payload, ...extra) => {
    const request = parseApGroupCreateRequest(payload, extra);
    const checked = apGroupPreconditions(request.sessionNonce, request.name);
    if (checked.failure) {
      return checked.failure;
    }
    if (hasApGroupNameConflict(checked.name, openApiGroups())) {
      return { success: false, error: 'nameTaken' };
    }
    const scripted = scriptedApGroupResult(IPC_CHANNELS.MANAGEMENT_AP_GROUP_CREATE);
    if (scripted) {
      return scripted;
    }
    const apGroupId = randomBytes(12).toString('hex');
    stub.scenario.wlanGroups.push({ wlanId: apGroupId, wlanName: checked.name, ssidList: [] });
    stub.apGroupWrites.push({ op: 'create', apGroupId, name: checked.name });
    return { success: true, apGroupId };
  }, // End of the MANAGEMENT_AP_GROUP_CREATE handler

  /**
   * MANAGEMENT_AP_GROUP_RENAME: the real shape guard, the session, name and
   * capability checks, then groupNotFound / nameUnchanged / nameTaken on the
   * current groups; the rename also renames the group in the APs reporting it.
   * @param {unknown} payload - { sessionNonce, apGroupId, name }.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The ApGroupActionResult.
   */
  [IPC_CHANNELS.MANAGEMENT_AP_GROUP_RENAME]: (payload, ...extra) => {
    const request = parseApGroupRenameRequest(payload, extra);
    const checked = apGroupPreconditions(request.sessionNonce, request.name);
    if (checked.failure) {
      return checked.failure;
    }
    const groups = openApiGroups();
    const target = groups.find((group) => group.id === request.apGroupId);
    if (!target) {
      return { success: false, error: 'groupNotFound' };
    }
    if (target.name === checked.name) {
      return { success: false, error: 'nameUnchanged' };
    }
    if (hasApGroupNameConflict(checked.name, groups, request.apGroupId)) {
      return { success: false, error: 'nameTaken' };
    }
    const scripted = scriptedApGroupResult(IPC_CHANNELS.MANAGEMENT_AP_GROUP_RENAME);
    if (scripted) {
      return scripted;
    }
    const group = stub.scenario.wlanGroups.find((candidate) => candidate.wlanId === request.apGroupId);
    for (const accessPoint of stub.scenario.accessPoints) {
      if (accessPoint.wlanGroup === group.wlanName) {
        accessPoint.wlanGroup = checked.name;
      }
    }
    group.wlanName = checked.name;
    stub.apGroupWrites.push({ op: 'rename', apGroupId: request.apGroupId, name: checked.name });
    return { success: true };
  }, // End of the MANAGEMENT_AP_GROUP_RENAME handler

  /**
   * MANAGEMENT_AP_GROUP_DELETE: the real shape guard, the session and
   * capability checks, then the real delete policy (checkApGroupDeletion())
   * on the current groups — overrides included, so "fresh data says it has
   * APs" refuses although the renderer showed it empty; the group then leaves
   * wlanGroups.
   * @param {unknown} payload - { sessionNonce, apGroupId }.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The ApGroupActionResult.
   */
  [IPC_CHANNELS.MANAGEMENT_AP_GROUP_DELETE]: (payload, ...extra) => {
    const request = parseApGroupDeleteRequest(payload, extra);
    const checked = apGroupPreconditions(request.sessionNonce, null);
    if (checked.failure) {
      return checked.failure;
    }
    const refusal = checkApGroupDeletion(openApiGroups().find((group) => group.id === request.apGroupId));
    if (refusal) {
      return { success: false, error: refusal };
    }
    const scripted = scriptedApGroupResult(IPC_CHANNELS.MANAGEMENT_AP_GROUP_DELETE);
    if (scripted) {
      return scripted;
    }
    stub.scenario.wlanGroups = stub.scenario.wlanGroups.filter((group) => group.wlanId !== request.apGroupId);
    stub.apGroupWrites.push({ op: 'delete', apGroupId: request.apGroupId });
    return { success: true };
  }, // End of the MANAGEMENT_AP_GROUP_DELETE handler

  /**
   * MANAGEMENT_NETWORKS: the real shape guard (requireSessionNonce()), the
   * session ownership (notConnected / superseded) and the capability check
   * (manageWifiNetworks, else managementUnavailable), then the scripted
   * answer (networksResult) or the fake networks through the real
   * validators and DTO builder (readFakeNetworks()).
   * @param {unknown} sessionNonce - The session nonce echoed by the renderer.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The ManagedNetworksResult.
   */
  [IPC_CHANNELS.MANAGEMENT_NETWORKS]: (sessionNonce, ...extra) => {
    const nonce = requireSessionNonce(sessionNonce, extra);
    if (!stub.connected || stub.sessionNonce === null) {
      return { success: false, error: 'notConnected' };
    }
    if (nonce !== stub.sessionNonce) {
      return { success: false, error: 'superseded' };
    }
    if (!currentCapabilities().manageWifiNetworks) {
      return { success: false, error: 'managementUnavailable' };
    }
    if (stub.scenario.networksResult) {
      return structuredClone(stub.scenario.networksResult);
    }
    return readFakeNetworks();
  }, // End of the MANAGEMENT_NETWORKS handler

  /**
   * MANAGEMENT_NETWORK_CREATE: the real shape guard, the session ownership,
   * the real create rules (checkNetworkCreate()), the capability, every bound
   * group in the fake AP-group list (groupNotFound otherwise), the scripted
   * answer; then a new disabled network built from the real body
   * (buildCreateSsidBody()) joins the fake controller, bound to its groups.
   * @param {unknown} payload - { sessionNonce, name, security, bands, apGroupIds, passphrase? }.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The NetworkActionResult (never a passphrase).
   */
  [IPC_CHANNELS.MANAGEMENT_NETWORK_CREATE]: (payload, ...extra) => {
    const request = parseNetworkCreateRequest(payload, extra);
    const owner = networkOwnership(request.sessionNonce);
    if (owner) {
      return owner;
    }
    const checked = checkNetworkCreate(request);
    if (!checked.ok) {
      return networkRuleRefusal(checked);
    }
    if (!currentCapabilities().manageWifiNetworks) {
      return { success: false, error: 'managementUnavailable' };
    }
    const listed = new Set(openApiGroups().map((group) => group.id));
    if (!checked.create.apGroupIds.every((id) => listed.has(id))) {
      return { success: false, error: 'groupNotFound' };
    }
    const scripted = scriptedNetworkResult(IPC_CHANNELS.MANAGEMENT_NETWORK_CREATE);
    if (scripted) {
      return scripted;
    }
    const body = buildCreateSsidBody(checked.create);
    const networkId = randomBytes(12).toString('hex');
    liveNetworks().push({
      entry: { id: networkId, ssidId: networkId, name: body.name, ssidEnable: false, chooseDevices: 1, band: body.band, security: body.security },
      detail: { id: networkId, ...structuredClone(body) },
      bindings: { apGroups: body.apGroupIds.map((id) => ({ id })) },
    });
    for (const group of stub.scenario.wlanGroups) {
      if (body.apGroupIds.includes(group.wlanId)) {
        group.ssidList = [...(group.ssidList || []), { ssidName: body.name }];
      }
    }
    stub.networkWrites.push({ op: 'create', networkId, body: structuredClone(body) });
    return { success: true, networkId };
  }, // End of the MANAGEMENT_NETWORK_CREATE handler

  /**
   * MANAGEMENT_NETWORK_UPDATE: the real shape guard, the session ownership,
   * the real edit rules (checkNetworkEdits()), then the read-merge-write of
   * saveFakeBasicConfig().
   * @param {unknown} payload - { sessionNonce, networkId, name?, security?, bands?, passphrase? }.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The NetworkActionResult (never a passphrase).
   */
  [IPC_CHANNELS.MANAGEMENT_NETWORK_UPDATE]: (payload, ...extra) => {
    const request = parseNetworkUpdateRequest(payload, extra);
    const owner = networkOwnership(request.sessionNonce);
    if (owner) {
      return owner;
    }
    const checked = checkNetworkEdits(request);
    if (!checked.ok) {
      return networkRuleRefusal(checked);
    }
    return saveFakeBasicConfig('update', IPC_CHANNELS.MANAGEMENT_NETWORK_UPDATE, request.networkId, checked.edits);
  }, // End of the MANAGEMENT_NETWORK_UPDATE handler

  /**
   * MANAGEMENT_NETWORK_PASSWORD: the real shape guard, the session
   * ownership, a blank passphrase (passphraseRequired), the real edit rules
   * on the passphrase alone, then the read-merge-write of
   * saveFakeBasicConfig() (an open network: passphraseNotApplicable).
   * @param {unknown} payload - { sessionNonce, networkId, passphrase }.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The NetworkActionResult (never a passphrase).
   */
  [IPC_CHANNELS.MANAGEMENT_NETWORK_PASSWORD]: (payload, ...extra) => {
    const request = parseNetworkPasswordRequest(payload, extra);
    const owner = networkOwnership(request.sessionNonce);
    if (owner) {
      return owner;
    }
    if (!isTypedPassphrase(request.passphrase)) {
      return { success: false, error: 'passphraseRequired' };
    }
    const checked = checkNetworkEdits({ passphrase: request.passphrase });
    if (!checked.ok) {
      return networkRuleRefusal(checked);
    }
    return saveFakeBasicConfig('password', IPC_CHANNELS.MANAGEMENT_NETWORK_PASSWORD, request.networkId, checked.edits);
  }, // End of the MANAGEMENT_NETWORK_PASSWORD handler

  /**
   * MANAGEMENT_NETWORK_ENABLE: the real shape guard, the session ownership,
   * the capability, the fresh detail, the scripted answer; then the fake
   * network's enable state (detail and catalog) changes.
   * @param {unknown} payload - { sessionNonce, networkId, enabled }.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The NetworkActionResult.
   */
  [IPC_CHANNELS.MANAGEMENT_NETWORK_ENABLE]: (payload, ...extra) => {
    const request = parseNetworkEnableRequest(payload, extra);
    const owner = networkOwnership(request.sessionNonce);
    if (owner) {
      return owner;
    }
    if (!currentCapabilities().manageWifiNetworks) {
      return { success: false, error: 'managementUnavailable' };
    }
    const fresh = freshNetwork(request.networkId);
    if (fresh.failure) {
      return fresh.failure;
    }
    const scripted = scriptedNetworkResult(IPC_CHANNELS.MANAGEMENT_NETWORK_ENABLE);
    if (scripted) {
      return scripted;
    }
    fresh.network.detail.ssidEnable = request.enabled;
    fresh.network.entry.ssidEnable = request.enabled;
    if (typeof fresh.network.entry.description === 'boolean') {
      fresh.network.entry.description = request.enabled;
    }
    stub.networkWrites.push({ op: 'enable', networkId: request.networkId, enabled: request.enabled });
    return { success: true };
  }, // End of the MANAGEMENT_NETWORK_ENABLE handler

  /**
   * MANAGEMENT_NETWORK_DELETE: the real shape guard, the session ownership,
   * the capability, the fresh detail, the scripted answer; then the network
   * leaves the fake controller (and its name the groups' ssidList when no
   * other network has it).
   * @param {unknown} payload - { sessionNonce, networkId }.
   * @param {...unknown} extra - Must be empty.
   * @returns {object} The NetworkActionResult.
   */
  [IPC_CHANNELS.MANAGEMENT_NETWORK_DELETE]: (payload, ...extra) => {
    const request = parseNetworkDeleteRequest(payload, extra);
    const owner = networkOwnership(request.sessionNonce);
    if (owner) {
      return owner;
    }
    if (!currentCapabilities().manageWifiNetworks) {
      return { success: false, error: 'managementUnavailable' };
    }
    const fresh = freshNetwork(request.networkId);
    if (fresh.failure) {
      return fresh.failure;
    }
    const scripted = scriptedNetworkResult(IPC_CHANNELS.MANAGEMENT_NETWORK_DELETE);
    if (scripted) {
      return scripted;
    }
    const name = fresh.network.entry.name;
    stub.scenario.networks = liveNetworks().filter((network) => network !== fresh.network);
    if (!stub.scenario.networks.some((network) => network.entry.name === name)) {
      renameInGroups(name, null);
    }
    stub.networkWrites.push({ op: 'delete', networkId: request.networkId });
    return { success: true };
  }, // End of the MANAGEMENT_NETWORK_DELETE handler
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
