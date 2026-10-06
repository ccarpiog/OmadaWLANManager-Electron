// GUI smoke test (`npm run smoke`, which builds first). Launches Electron with
// Playwright's _electron API on the STUBBED main process (stub-main.cjs): the
// real preload and the real bundled renderer, fake IPC handlers fed from
// tests/fixtures/smoke/. Prints PASS/FAIL per named check and exits non-zero
// when any check fails.
//
// Isolation (invariant D4, docs/management-design.md §1): every launch gets
// HOME/USERPROFILE pointed at a fresh fs.mkdtempSync directory (the stub keeps
// Electron's userData inside it and refuses to start otherwise); the stub
// never loads the real main process, never touches the network (it cancels
// every non-file: request) and writes no files. No controller is contacted.
//
// Electron binary: ELECTRON_PATH (a binary or an .app bundle) when set,
// otherwise the `electron` npm package's binary if it was already downloaded
// and actually runs (the runner never triggers Electron 42+'s on-first-use
// download). Dropbox breaks node_modules/electron/dist (it strips symlinks and
// exec bits), so in a Dropbox checkout set ELECTRON_PATH to an Electron
// extracted elsewhere. Every launch must run the installed `electron`
// package's version (checked against the running process.versions.electron).
//
// Usage: [ELECTRON_PATH=/path/to/Electron] node tests/smoke/run-smoke.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { _electron as electron } from 'playwright-core';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const STUB_MAIN = path.join(projectRoot, 'tests', 'smoke', 'stub-main.cjs');
const PRELOAD_PATH = path.join(projectRoot, 'dist', 'main', 'preload.js');
const WAIT_MS = 5000;

const data = JSON.parse(readFileSync(path.join(projectRoot, 'tests', 'fixtures', 'smoke', 'controller-data.json'), 'utf8'));
const uiStrings = JSON.parse(readFileSync(path.join(projectRoot, 'tests', 'fixtures', 'smoke', 'ui-strings.json'), 'utf8'));

// Mirrors of the renderer's boundary guards (src/renderer/validation.ts)
const MAC_REGEX = /^[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}$/;
const WLAN_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

// Per-language strings for the dynamic parts the checks read (src/renderer/i18n.ts)
const TEXT = {
  es: {
    disconnected: 'Desconectado', connecting: 'Conectando...', connect: 'Conectar', disconnect: 'Desconectar',
    apply: 'Aplicar cambio', selectApAndWlan: 'Selecciona un AP y un grupo WLAN', unassigned: 'Sin asignar',
    noSsids: 'Sin SSIDs', more: 'más', configureHint: 'Configura la conexión en Ajustes para empezar',
    connectToSeeAPs: 'Conecta al controlador para ver los access points',
    connectToSeeWLANs: 'Conecta al controlador para ver los grupos WLAN',
    status: ['Desconectado', 'Conectado', 'Adoptando', 'Sin respuesta', 'Aislado'], statusUnknown: 'Estado desconocido',
  },
  en: {
    disconnected: 'Disconnected', connecting: 'Connecting...', connect: 'Connect', disconnect: 'Disconnect',
    apply: 'Apply change', selectApAndWlan: 'Select an AP and a WLAN group', unassigned: 'Unassigned',
    noSsids: 'No SSIDs', more: 'more', configureHint: 'Set up the connection in Settings to get started',
    connectToSeeAPs: 'Connect to the controller to see access points',
    connectToSeeWLANs: 'Connect to the controller to see WLAN groups',
    status: ['Disconnected', 'Connected', 'Adopting', 'Heartbeat missed', 'Isolated'], statusUnknown: 'Unknown status',
  },
};
const STATUS_CLASSES = ['offline', 'online', 'pending', 'warning', 'isolated'];
const CONTROLLER_URL = 'https://controller.invalid:8043';
const CONTROLLER_HOST = 'controller.invalid:8043';
const MOVE_AP = data.accessPoints.find((ap) => ap.name === 'EAP Carpio');
const MOVE_GROUP = data.wlanGroups.find((group) => group.wlanName === 'zGrupo B');
const EXPECTED_BRIDGE = ['connect', 'disconnect', 'getAccessPoints', 'getWlanGroups', 'loadConfig', 'platform', 'resetCertificate', 'saveConfig', 'selectSite', 'setApWlanGroup', 'trustCertificate'];
// One launch per run*() function in main()
const EXPECTED_LAUNCHES = 3;
// Fingerprints of the fake controller's self-signed certificates (launch 3)
const FINGERPRINT_A = Array.from({ length: 32 }, (_, index) => (index * 7 + 16).toString(16).toUpperCase().padStart(2, '0')).join(':');
const FINGERPRINT_B = Array.from({ length: 32 }, (_, index) => (255 - index).toString(16).toUpperCase().padStart(2, '0')).join(':');
// Certificate-related strings the checks read (src/renderer/i18n.ts)
const CERT_TEXT = {
  es: { pinNone: 'Ninguno', unchanged: '(sin cambios)', requiredNewUrl: '(obligatoria para la nueva URL)', passwordRequired: 'Por favor, introduce la contraseña' },
  en: {
    untrustedTitle: 'Verify the controller certificate', changedTitle: 'Controller certificate changed', host: 'Controller',
    fingerprint: 'SHA-256 fingerprint', pinned: 'Trusted fingerprint', presented: 'Presented fingerprint', trust: 'Trust and connect',
    cancel: 'Cancel', close: 'Close', changedStatus: 'Certificate changed: connection refused', pinNone: 'None',
    resetConfirm: 'Forget the trusted certificate? The next connection will ask you to verify the controller\'s certificate again.',
    resetConfirmConnected: 'Forget the trusted certificate? The current connection will be closed, and the next one will ask you to verify the controller\'s certificate again.',
    resetDone: 'Trusted certificate reset',
  },
};

const results = [];
const tempDirs = [];
const launches = [];
const playwrightConsoleErrors = [];
const playwrightPageErrors = [];

// ============================================================================
// Reporting
// ============================================================================

/**
 * Records and prints one check result.
 * @param {string} name - Check name.
 * @param {boolean} ok - Whether it passed.
 * @param {unknown} [detail] - Extra information printed on failure.
 */
function record(name, ok, detail) {
  results.push({ name, ok });
  let suffix = '';
  if (!ok && detail !== undefined) {
    const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
    suffix = `\n        -> ${text.length > 600 ? `${text.slice(0, 600)}...` : text}`;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${suffix}`);
}

/**
 * Runs one named check. The body returns a verdict ({ ok, detail }) or a
 * boolean; a thrown error (e.g. a wait timeout) is a failure.
 * @param {string} name - Check name.
 * @param {() => Promise<{ ok: boolean; detail?: unknown } | boolean>} body - The check body.
 * @returns {Promise<void>}
 */
async function check(name, body) {
  try {
    const outcome = await body();
    if (typeof outcome === 'boolean') {
      record(name, outcome);
    } else {
      record(name, outcome.ok, outcome.detail);
    }
  } catch (error) {
    record(name, false, String(error && error.message ? error.message : error).split('\n')[0]);
  }
} // End of function check()

/**
 * Builds a verdict object.
 * @param {unknown} ok - Truthy when the check passed.
 * @param {unknown} detail - Diagnostic detail printed on failure.
 * @returns {{ ok: boolean; detail: unknown }} The verdict.
 */
function verdict(ok, detail) {
  return { ok: Boolean(ok), detail };
}

/**
 * Prints an error and exits before any launch (setup problems).
 * @param {string} message - What went wrong and how to fix it.
 */
function fail(message) {
  console.error(`\nSmoke test cannot run: ${message}\n`);
  process.exit(1);
}

// ============================================================================
// Setup: built app and Electron binary
// ============================================================================

/**
 * Ensures the build output the stub loads exists.
 */
function assertBuilt() {
  const required = ['dist/main/preload.js', 'dist/main/url.js', 'dist/shared/types.js', 'dist/renderer/index.html', 'dist/renderer/renderer.js'];
  const missing = required.filter((file) => !existsSync(path.join(projectRoot, file)));
  if (missing.length > 0) {
    fail(`missing build output (${missing.join(', ')}). Run \`npm run build\` first (\`npm run smoke\` does it for you).`);
  }
}

/**
 * Checks that a binary is a working Electron by running it as Node
 * (ELECTRON_RUN_AS_NODE: no window, no profile) and reading its version.
 * @param {string} binary - Path to the Electron executable.
 * @returns {string | null} The Electron version, or null when it does not run.
 */
function probeElectron(binary) {
  const probeHome = mkdtempSync(path.join(os.tmpdir(), 'omada-smoke-probe-'));
  tempDirs.push(probeHome);
  const result = spawnSync(binary, ['-e', 'process.stdout.write(String(process.versions.electron || ""))'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOME: probeHome, USERPROFILE: probeHome },
    encoding: 'utf8',
    timeout: 30000,
  });
  const version = (result.stdout || '').trim();
  return result.status === 0 && /^\d+\.\d+\.\d+/.test(version) ? version : null;
}

/**
 * Returns the `electron` npm package's binary when it has ALREADY been
 * downloaded, without triggering a download. Since Electron 42 the package no
 * longer fetches its binary in postinstall: `require('electron')` (and
 * `npx electron`) download it on first use into node_modules/electron/dist.
 * The smoke must not start a ~100 MB download as a side effect (into Dropbox
 * here, which would break it anyway), so the package's path.txt is read
 * directly instead of requiring the package.
 * @returns {{ binary: string | null; reason: string }} The binary, or why there is none.
 */
function findDownloadedPackageBinary() {
  let packageDir;
  try {
    packageDir = path.dirname(require.resolve('electron/package.json'));
  } catch (error) {
    return { binary: null, reason: error.message };
  }
  const pathFile = path.join(packageDir, 'path.txt');
  if (!existsSync(pathFile)) {
    return { binary: null, reason: 'its binary was never downloaded (Electron 42+ downloads it on first use, e.g. `npx install-electron --no`)' };
  }
  const binary = path.join(packageDir, 'dist', readFileSync(pathFile, 'utf8').trim());
  return existsSync(binary) ? { binary, reason: '' } : { binary: null, reason: `binary not found (${binary})` };
} // End of function findDownloadedPackageBinary()

/**
 * Resolves the Electron executable: ELECTRON_PATH (binary or .app bundle)
 * first, then the `electron` npm package's already-downloaded binary; exits
 * with a clear message when neither works.
 * @returns {{ binary: string; version: string; source: string }} The binary to launch.
 */
function resolveElectron() {
  const fromEnv = process.env.ELECTRON_PATH;
  if (fromEnv) {
    let binary = fromEnv;
    if (binary.endsWith('.app') && existsSync(binary) && statSync(binary).isDirectory()) {
      binary = path.join(binary, 'Contents', 'MacOS', 'Electron');
    }
    if (!existsSync(binary)) {
      fail(`ELECTRON_PATH points at a missing file: ${binary}`);
    }
    const version = probeElectron(binary);
    if (!version) {
      fail(`ELECTRON_PATH is not a runnable Electron binary: ${binary}`);
    }
    return { binary, version, source: 'ELECTRON_PATH' };
  } // End of the ELECTRON_PATH branch

  const packaged = findDownloadedPackageBinary();
  let reason = packaged.reason;
  if (packaged.binary) {
    const version = probeElectron(packaged.binary);
    if (version) {
      return { binary: packaged.binary, version, source: 'electron npm package' };
    }
    reason = `${packaged.binary} does not run`;
  }
  fail(
    `the electron npm package's binary is unusable (${reason}).\n` +
    'Set ELECTRON_PATH to a working Electron executable (or .app bundle), e.g.\n' +
    '  ELECTRON_PATH=/private/tmp/electron/Electron.app/Contents/MacOS/Electron npm run smoke\n' +
    'In a Dropbox checkout node_modules/electron/dist is broken (Dropbox strips symlinks and exec bits):\n' +
    'extract the matching Electron release outside Dropbox and point ELECTRON_PATH at it.'
  );
  return null;
} // End of function resolveElectron()

// ============================================================================
// Launch and stub helpers
// ============================================================================

/**
 * Launches the stubbed app with a fresh temp HOME and an initial scenario,
 * and prints the running main process's Electron/Chromium/Node versions.
 * @param {{ binary: string }} electronInfo - Resolved Electron binary.
 * @param {string} label - Short launch label used in check names.
 * @param {object} scenario - Initial stub scenario (merged over the defaults).
 * @returns {Promise<{ label: string; app: import('playwright-core').ElectronApplication; page: import('playwright-core').Page; home: string; mainOutput: string[]; runningVersions: { electron: string; chrome: string; node: string } }>}
 */
async function launch(electronInfo, label, scenario) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'omada-smoke-home-'));
  tempDirs.push(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, OMADA_SMOKE_SCENARIO: JSON.stringify(scenario) };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ executablePath: electronInfo.binary, args: [STUB_MAIN], env, cwd: projectRoot, timeout: 30000 });
  const mainOutput = [];
  app.process().stdout?.on('data', (chunk) => mainOutput.push(String(chunk)));
  app.process().stderr?.on('data', (chunk) => mainOutput.push(String(chunk)));

  // The versions of the Electron main process actually running (not just the
  // ELECTRON_RUN_AS_NODE probe of the binary), printed so the run proves which
  // Electron it used and checked in runGlobalChecks()
  const runningVersions = await app.evaluate(() => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }));
  console.log(`[${label}] running Electron ${runningVersions.electron} (Chromium ${runningVersions.chrome}, Node ${runningVersions.node})`);

  const page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() === 'error') {
      playwrightConsoleErrors.push(`[${label}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => playwrightPageErrors.push(`[${label}] ${error}`));
  await page.waitForLoadState('domcontentloaded');

  const session = { label, app, page, home, mainOutput, runningVersions };
  launches.push(session);
  return session;
} // End of function launch()

/**
 * Returns a snapshot of the stub's state (calls, scenario, environment...).
 * @param {{ app: import('playwright-core').ElectronApplication }} session - The launch.
 * @returns {Promise<object>} The snapshot.
 */
function stubState(session) {
  return session.app.evaluate(() => globalThis.__omadaStub.snapshot());
}

/**
 * Replaces top-level scenario fields of the running stub.
 * @param {{ app: import('playwright-core').ElectronApplication }} session - The launch.
 * @param {object} patch - Scenario fields to replace.
 * @returns {Promise<object>} The resulting scenario.
 */
function configureStub(session, patch) {
  return session.app.evaluate((_electron, scenarioPatch) => globalThis.__omadaStub.configure(scenarioPatch), patch);
}

/**
 * Filters a snapshot's IPC calls by channel.
 * @param {object} snapshot - A stub snapshot.
 * @param {string} channel - IPC channel name.
 * @returns {Array<{ channel: string; args: unknown[] }>} The calls on that channel.
 */
function callsTo(snapshot, channel) {
  return snapshot.calls.filter((call) => call.channel === channel);
}

// ============================================================================
// Renderer probes
// ============================================================================

/**
 * Reads the static UI strings listed in a ui-strings.json language table.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {Record<string, string>} table - Selector (or "selector@attr") → expected text.
 * @returns {Promise<Record<string, string | null>>} Selector → actual text.
 */
function readStaticStrings(page, table) {
  return page.evaluate((keys) => {
    const actual = {};
    for (const key of keys) {
      const [selector, attribute] = key.split('@');
      const element = document.querySelector(selector);
      actual[key] = element === null ? null : attribute ? element.getAttribute(attribute) : (element.textContent || '').trim();
    }
    return actual;
  }, Object.keys(table));
}

/**
 * Lists labels, buttons and headings that carry no text and no accessible
 * name (blank or untranslated UI).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<string[]>} Identifiers of the blank elements.
 */
function findBlankUi(page) {
  return page.evaluate(() => {
    const blank = [];
    for (const element of document.querySelectorAll('button, label, h1, h2, h3, .panel-title, .status-text')) {
      const text = (element.textContent || '').trim();
      const name = (element.getAttribute('aria-label') || '').trim();
      if (text === '' && name === '') {
        blank.push(element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}.${element.className}`);
      }
    }
    return blank;
  });
} // End of function findBlankUi()

/**
 * Reads the rendered AP list items.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<Array<{ mac: string; name: string; subtitle: string; statusClass: string; statusLabel: string; selected: string }>>}
 */
function readApItems(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#apList .list-item')).map((item) => {
    const status = item.querySelector('.item-status');
    return {
      mac: item.dataset.mac,
      name: item.querySelector('.item-name')?.textContent || '',
      subtitle: item.querySelector('.item-subtitle')?.textContent || '',
      statusClass: status ? Array.from(status.classList).filter((cls) => cls !== 'item-status').join(' ') : '',
      statusLabel: status?.getAttribute('aria-label') || '',
      selected: item.getAttribute('aria-selected'),
    };
  }));
} // End of function readApItems()

/**
 * Reads the rendered WLAN group list items.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<Array<{ wlanId: string; name: string; subtitle: string; selected: string }>>}
 */
function readWlanItems(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#wlanList .list-item')).map((item) => ({
    wlanId: item.dataset.wlanId,
    name: item.querySelector('.item-name')?.textContent || '',
    subtitle: item.querySelector('.item-subtitle')?.textContent || '',
    selected: item.getAttribute('aria-selected'),
  })));
}

/**
 * Reads the status bar, buttons, panel placeholders and selection bar.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The current shell state.
 */
function readShell(page) {
  return page.evaluate(() => ({
    lang: document.documentElement.lang,
    status: document.getElementById('statusText')?.textContent || '',
    indicator: document.getElementById('statusIndicator')?.className || '',
    connect: document.getElementById('connectBtn')?.textContent || '',
    connectDisabled: document.getElementById('connectBtn')?.disabled,
    settingsDisabled: document.getElementById('settingsBtn')?.disabled,
    refreshDisabled: document.getElementById('refreshBtn')?.disabled,
    refreshSpinning: document.getElementById('refreshBtn')?.classList.contains('spinning'),
    apply: document.getElementById('applyBtn')?.textContent || '',
    applyDisabled: document.getElementById('applyBtn')?.disabled,
    apEmpty: document.querySelector('#apList .empty-state p')?.textContent ?? null,
    wlanEmpty: document.querySelector('#wlanList .empty-state p')?.textContent ?? null,
    selectionPlaceholder: document.querySelector('#selectionInfo .selection-placeholder')?.textContent ?? null,
    selectionAp: document.querySelector('#selectionInfo .ap-name')?.textContent ?? null,
    selectionWlan: document.querySelector('#selectionInfo .wlan-name')?.textContent ?? null,
    inert: document.querySelector('.app-container')?.hasAttribute('inert'),
    activeId: document.activeElement?.id || '',
    settingsOpen: document.getElementById('settingsModal')?.classList.contains('visible'),
    confirmOpen: document.getElementById('confirmModal')?.classList.contains('visible'),
    siteOpen: document.getElementById('siteModal')?.classList.contains('visible'),
    certOpen: document.getElementById('certModal')?.classList.contains('visible'),
  })); // End of the in-page shell probe
} // End of function readShell()

/**
 * Reads the certificate modal: title, message, detail rows, hint and buttons.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The modal's visible content.
 */
function readCertModal(page) {
  return page.evaluate(() => {
    const terms = Array.from(document.querySelectorAll('#certDetails dt')).map((element) => element.textContent);
    const values = Array.from(document.querySelectorAll('#certDetails dd')).map((element) => ({
      text: element.textContent, fingerprint: element.classList.contains('cert-fingerprint'),
    }));
    const hint = document.getElementById('certModalHint');
    const confirm = document.getElementById('confirmCertBtn');
    return {
      title: document.getElementById('certModalHeading')?.textContent || '',
      message: document.getElementById('certModalMessage')?.textContent || '',
      rows: terms.map((term, index) => ({ term, value: values[index]?.text, fingerprint: values[index]?.fingerprint })),
      hintShown: Boolean(hint && !hint.hidden && hint.textContent),
      confirmShown: Boolean(confirm && !confirm.hidden),
      confirmText: confirm?.textContent || '',
      cancelText: document.getElementById('cancelCertBtn')?.textContent || '',
      activeId: document.activeElement?.id || '',
      inert: document.querySelector('.app-container')?.hasAttribute('inert'),
      role: document.getElementById('certModal')?.getAttribute('role'),
      ariaModal: document.getElementById('certModal')?.getAttribute('aria-modal'),
    };
  }); // End of the in-page certificate modal probe
} // End of function readCertModal()

/**
 * Reads the trusted-certificate section of the settings modal.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} Pin value, reset button and inline confirmation state.
 */
function readCertPinSection(page) {
  return page.evaluate(() => ({
    value: document.getElementById('certPinValue')?.textContent || '',
    resetDisabled: document.getElementById('resetCertBtn')?.disabled,
    resetHidden: document.getElementById('resetCertBtn')?.hidden,
    confirmShown: !document.getElementById('certResetConfirm')?.hidden,
    confirmMessage: document.getElementById('certResetMessage')?.textContent || '',
    activeId: document.activeElement?.id || '',
  }));
}

/**
 * Waits until a toast of the given type with exactly the given text is shown.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {'success' | 'error' | 'info'} type - Toast type.
 * @param {string} text - Expected text (a prefix when it ends with "…").
 * @returns {Promise<void>}
 */
async function waitForToast(page, type, text) {
  await page.waitForFunction(({ toastType, expected }) => {
    const prefix = expected.endsWith('…') ? expected.slice(0, -1) : null;
    return Array.from(document.querySelectorAll(`#toastContainer .toast.toast-${toastType}`)).some((toast) =>
      prefix !== null ? toast.textContent.startsWith(prefix) : toast.textContent === expected);
  }, { toastType: type, expected: text }, { timeout: WAIT_MS });
}

/**
 * Waits until the status bar shows the given text.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} text - Expected status text.
 * @returns {Promise<void>}
 */
async function waitForStatus(page, text) {
  await page.waitForFunction((expected) => document.getElementById('statusText')?.textContent === expected, text, { timeout: WAIT_MS });
}

/**
 * Waits until the AP list shows the given number of items.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {number} count - Expected item count.
 * @returns {Promise<void>}
 */
async function waitForApCount(page, count) {
  await page.waitForFunction((expected) => document.querySelectorAll('#apList .list-item').length === expected, count, { timeout: WAIT_MS });
}

// ============================================================================
// Expected values derived from the fixtures
// ============================================================================

/**
 * The AP rows the renderer must show for a set of AP DTOs: malformed MACs
 * dropped, sorted by name like the main process, labels per language.
 * @param {object[]} accessPoints - AccessPoint DTOs served by the stub.
 * @param {'es' | 'en'} language - UI language.
 * @returns {Array<{ name: string; subtitle: string; statusClass: string; statusLabel: string }>}
 */
function expectedApRows(accessPoints, language) {
  const text = TEXT[language];
  return accessPoints
    .filter((ap) => MAC_REGEX.test(ap.mac))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((ap) => ({
      name: ap.name,
      subtitle: `WLAN: ${ap.wlanGroup || text.unassigned}`,
      statusClass: STATUS_CLASSES[ap.statusCategory] ?? 'unknown',
      statusLabel: text.status[ap.statusCategory] ?? text.statusUnknown,
    }));
} // End of function expectedApRows()

/**
 * The WLAN rows the renderer must show: malformed ids dropped, sorted by
 * name, SSID preview "a, b, c +N more" or the no-SSIDs label.
 * @param {object[]} wlanGroups - WlanGroup DTOs served by the stub.
 * @param {'es' | 'en'} language - UI language.
 * @returns {Array<{ name: string; subtitle: string }>}
 */
function expectedWlanRows(wlanGroups, language) {
  const text = TEXT[language];
  return wlanGroups
    .filter((group) => WLAN_ID_REGEX.test(group.wlanId))
    .sort((a, b) => a.wlanName.localeCompare(b.wlanName))
    .map((group) => {
      const ssids = group.ssidList.map((ssid) => ssid.ssidName);
      const preview = ssids.length > 3 ? `${ssids.slice(0, 3).join(', ')} +${ssids.length - 3} ${text.more}` : ssids.join(', ');
      return { name: group.wlanName, subtitle: preview || text.noSsids };
    });
}

/**
 * Compares rendered AP items with the expected rows.
 * @param {object[]} items - Items read by readApItems().
 * @param {object[]} expected - Rows from expectedApRows().
 * @returns {{ ok: boolean; detail: unknown }} The verdict.
 */
function compareApRows(items, expected) {
  const actual = items.map(({ name, subtitle, statusClass, statusLabel }) => ({ name, subtitle, statusClass, statusLabel }));
  return verdict(isDeepStrictEqual(actual, expected), { actual, expected });
}

// ============================================================================
// Shared checks
// ============================================================================

/**
 * Checks that the window was created like the real app's (createWindow() in
 * src/main/index.ts): one window with the real preload, sandbox + context
 * isolation and no Node integration in the preferences the webContents
 * actually runs with (webContents.getLastWebPreferences(): undocumented and
 * absent from electron.d.ts, but present at runtime; a missing method fails
 * the check), a renderer process the OS reports as sandboxed (macOS/Windows;
 * Linux reports nothing), the bundled renderer, the full omadaAPI bridge and
 * no Node globals in the page. The options the stub recorded must match the
 * real app's too, including the preload path and window size, which the
 * effective preferences do not report.
 * @param {object} session - The launch.
 * @returns {Promise<void>}
 */
async function checkWindowLikeRealApp(session) {
  await check(`[${session.label}] window built like the real app (real preload, sandbox, one bundled renderer script, full bridge)`, async () => {
    const main = await session.app.evaluate(({ app, BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      const contents = windows[0].webContents;
      const pid = contents.getOSProcessId();
      const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
      const effective = typeof contents.getLastWebPreferences === 'function' ? contents.getLastWebPreferences() : null;
      return {
        windows: windows.length,
        url: contents.getURL(),
        rendererSandboxed: metric ? metric.sandboxed : null,
        effectivePreferences: effective && {
          sandbox: effective.sandbox,
          contextIsolation: effective.contextIsolation,
          nodeIntegration: effective.nodeIntegration,
        },
      };
    }); // End of the main-process evaluation
    const { windowOptions, environment } = await stubState(session);
    const preferences = windowOptions?.webPreferences || {};
    const effective = main.effectivePreferences || {};
    const renderer = await session.page.evaluate(() => ({
      scripts: Array.from(document.scripts).map((script) => script.src),
      bridge: Object.keys(window.omadaAPI || {}).sort(),
      require: typeof window.require,
      process: typeof window.process,
      bodyClass: document.body.className,
    }));
    return verdict(
      main.windows === 1 && main.url.endsWith('/dist/renderer/index.html') && main.rendererSandboxed !== false &&
      effective.sandbox === true && effective.contextIsolation === true && effective.nodeIntegration === false &&
      preferences.preload === PRELOAD_PATH && preferences.sandbox === true && preferences.contextIsolation === true &&
      preferences.nodeIntegration === false &&
      windowOptions.width === 900 && windowOptions.height === 650 && windowOptions.minWidth === 700 && windowOptions.minHeight === 500 &&
      renderer.scripts.length === 1 && renderer.scripts[0].endsWith('/dist/renderer/renderer.js') &&
      isDeepStrictEqual(renderer.bridge, EXPECTED_BRIDGE) && renderer.require === 'undefined' &&
      renderer.process === 'undefined' && renderer.bodyClass.split(' ').includes(`platform-${environment.platform}`),
      { main, windowOptions, renderer }
    );
  }); // End of check "[label] window built like the real app"
} // End of function checkWindowLikeRealApp()

/**
 * Checks the language: UI revealed, lang attribute, every static string from
 * ui-strings.json, and no blank label/button/heading.
 * @param {object} session - The launch.
 * @param {'es' | 'en'} language - Expected UI language.
 * @returns {Promise<void>}
 */
async function checkTranslations(session, language) {
  const name = language === 'es' ? 'Spanish' : 'English';
  await check(`[${session.label}] startup in ${name}: UI revealed and every static string translated`, async () => {
    await session.page.waitForFunction(() => !document.body.classList.contains('pre-init'), null, { timeout: WAIT_MS });
    const table = uiStrings[language];
    const actual = await readStaticStrings(session.page, table);
    const mismatches = Object.keys(table).filter((key) => actual[key] !== table[key]).map((key) => ({ key, expected: table[key], actual: actual[key] }));
    const lang = await session.page.evaluate(() => document.documentElement.lang);
    return verdict(lang === language && mismatches.length === 0, { lang, mismatches });
  });
  await check(`[${session.label}] no blank or untranslated labels, buttons or headings`, async () => {
    const blank = await findBlankUi(session.page);
    return verdict(blank.length === 0, blank);
  });
} // End of function checkTranslations()

// ============================================================================
// Launch 1: Spanish, first run, single site
// ============================================================================

/**
 * Spanish first-run launch: settings modal, save, connect, lists, AP move
 * (cancel + confirm), refresh, disconnect, connect failure and recovery,
 * save rejected by main.
 * @param {{ binary: string }} electronInfo - Resolved Electron binary.
 * @returns {Promise<void>}
 */
async function runSpanishFirstRun(electronInfo) {
  const session = await launch(electronInfo, 'es', {
    config: { url: '', username: '', language: 'es', hasPassword: false },
    connect: { success: true },
    accessPoints: data.accessPoints,
    wlanGroups: data.wlanGroups,
  });
  const { page } = session;
  const es = TEXT.es;

  try {
    await checkWindowLikeRealApp(session);
    await checkTranslations(session, 'es');

    await check('[es] first run: settings modal auto-opens with focus in the URL field and an inert background', async () => {
      await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
      await page.waitForFunction(() => document.activeElement?.id === 'urlInput', null, { timeout: WAIT_MS });
      const shell = await readShell(page);
      const focusInside = await page.evaluate(() => document.getElementById('settingsModal').contains(document.activeElement));
      return verdict(focusInside && shell.inert === true, { focusInside, shell });
    });

    await check('[es] first run: status, buttons and "configure" hints are in Spanish', async () => {
      const shell = await readShell(page);
      return verdict(
        shell.status === es.disconnected && shell.connect === es.connect && shell.apply === es.apply &&
        shell.applyDisabled === true && shell.refreshDisabled === true && shell.apEmpty === es.configureHint &&
        shell.wlanEmpty === es.configureHint && shell.selectionPlaceholder === es.selectApAndWlan,
        shell
      );
    });

    await check('[es] first run: the trusted-certificate section shows "Ninguno" and its reset button is disabled', async () => {
      const section = await readCertPinSection(page);
      return verdict(section.value === CERT_TEXT.es.pinNone && section.resetDisabled === true && section.confirmShown === false, section);
    });

    await check('[es] settings: a non-https URL is rejected in the renderer (error toast, nothing saved)', async () => {
      await page.fill('#urlInput', 'http://controller.invalid:8043');
      await page.fill('#usernameInput', 'admin');
      await page.fill('#passwordInput', 'smoke-password');
      await page.click('#saveSettingsBtn');
      await waitForToast(page, 'error', 'URL no válida…');
      const saves = callsTo(await stubState(session), 'config:save');
      const shell = await readShell(page);
      return verdict(saves.length === 0 && shell.settingsOpen === true, { saves, settingsOpen: shell.settingsOpen });
    });

    await check('[es] settings: Save sends the normalized URL, username, language and typed password, then closes', async () => {
      await page.fill('#urlInput', `${CONTROLLER_URL}/`);
      await page.click('#saveSettingsBtn');
      await page.waitForFunction(() => !document.getElementById('settingsModal').classList.contains('visible'), null, { timeout: WAIT_MS });
      const saves = callsTo(await stubState(session), 'config:save');
      const expected = { url: CONTROLLER_URL, username: 'admin', language: 'es', password: 'smoke-password' };
      return verdict(saves.length === 1 && isDeepStrictEqual(saves[0].args, [expected]), saves);
    });

    await check('[es] connect after save: OMADA_CONNECT called once, status shows the controller host', async () => {
      await waitForStatus(page, CONTROLLER_HOST);
      const shell = await readShell(page);
      const connects = callsTo(await stubState(session), 'omada:connect');
      return verdict(
        connects.length === 1 && shell.indicator.split(' ').includes('connected') && shell.connect === es.disconnect,
        { connects: connects.length, shell }
      );
    });

    const expectedAps = expectedApRows(data.accessPoints, 'es');
    await check('[es] AP list rendered from the fixtures (sorted, malformed MAC dropped, translated status and group)', async () => {
      await waitForApCount(page, expectedAps.length);
      return compareApRows(await readApItems(page), expectedAps);
    });

    await check('[es] WLAN group list rendered from the fixtures (sorted, malformed id dropped, SSID previews)', async () => {
      const expected = expectedWlanRows(data.wlanGroups, 'es');
      const actual = (await readWlanItems(page)).map(({ name, subtitle }) => ({ name, subtitle }));
      const shell = await readShell(page);
      return verdict(isDeepStrictEqual(actual, expected) && shell.refreshDisabled === false, { actual, expected, refreshDisabled: shell.refreshDisabled });
    });

    await check('[es] AP move: picking an AP and a group fills the selection bar and enables Apply', async () => {
      await page.click(`#apList .list-item[data-mac="${MOVE_AP.mac}"]`);
      await page.click(`#wlanList .list-item[data-wlan-id="${MOVE_GROUP.wlanId}"]`);
      const shell = await readShell(page);
      const apSelected = (await readApItems(page)).find((item) => item.mac === MOVE_AP.mac)?.selected;
      const wlanSelected = (await readWlanItems(page)).find((item) => item.wlanId === MOVE_GROUP.wlanId)?.selected;
      return verdict(
        shell.selectionAp === MOVE_AP.name && shell.selectionWlan === MOVE_GROUP.wlanName && shell.applyDisabled === false &&
        apSelected === 'true' && wlanSelected === 'true',
        { shell, apSelected, wlanSelected }
      );
    }); // End of check "[es] AP move: picking an AP and a group fills the selection bar and..."

    await check('[es] AP move: Apply opens the confirm modal with the right question and focus on Confirm', async () => {
      await page.click('#applyBtn');
      await page.waitForSelector('#confirmModal.visible', { timeout: WAIT_MS });
      await page.waitForFunction(() => document.activeElement?.id === 'confirmConfirmBtn', null, { timeout: WAIT_MS });
      const message = await page.textContent('#confirmMessage');
      const shell = await readShell(page);
      const expected = `¿Asignar "${MOVE_GROUP.wlanName}" al AP "${MOVE_AP.name}"?`;
      return verdict(message === expected && shell.inert === true, { message, expected, inert: shell.inert });
    });

    await check('[es] AP move -> Cancel: modal closes, no OMADA_SET_WLAN call, selection kept', async () => {
      await page.click('#cancelConfirmBtn');
      await page.waitForFunction(() => !document.getElementById('confirmModal').classList.contains('visible'), null, { timeout: WAIT_MS });
      const sets = callsTo(await stubState(session), 'omada:set-wlan');
      const shell = await readShell(page);
      return verdict(
        sets.length === 0 && shell.selectionAp === MOVE_AP.name && shell.selectionWlan === MOVE_GROUP.wlanName &&
        shell.applyDisabled === false && shell.inert === false,
        { sets, shell }
      );
    });

    await check('[es] AP move via keyboard: Enter on Apply opens the confirm modal focused, Escape cancels (no IPC)', async () => {
      await page.focus('#applyBtn');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#confirmModal.visible', { timeout: WAIT_MS });
      await page.waitForFunction(() => document.activeElement?.id === 'confirmConfirmBtn', null, { timeout: WAIT_MS });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('confirmModal').classList.contains('visible'), null, { timeout: WAIT_MS });
      await page.waitForFunction(() => document.activeElement?.id === 'applyBtn', null, { timeout: WAIT_MS });
      const sets = callsTo(await stubState(session), 'omada:set-wlan');
      const shell = await readShell(page);
      return verdict(sets.length === 0 && shell.inert === false && shell.selectionAp === MOVE_AP.name, { sets, shell });
    }); // End of check "[es] AP move via keyboard: Enter on Apply opens the confirm modal f..."

    await check('[es] AP move -> Confirm: OMADA_SET_WLAN called once with the AP MAC and the group id', async () => {
      await page.click('#applyBtn');
      await page.waitForSelector('#confirmModal.visible', { timeout: WAIT_MS });
      await page.click('#confirmConfirmBtn');
      await waitForToast(page, 'success', 'Cambio aplicado correctamente');
      const sets = callsTo(await stubState(session), 'omada:set-wlan');
      return verdict(sets.length === 1 && isDeepStrictEqual(sets[0].args, [MOVE_AP.mac, MOVE_GROUP.wlanId]), sets);
    });

    await check('[es] AP move -> UI updates: lists reloaded, the AP shows its new group, selection reset', async () => {
      await page.waitForFunction(({ mac, subtitle }) =>
        document.querySelector(`#apList .list-item[data-mac="${mac}"] .item-subtitle`)?.textContent === subtitle,
      { mac: MOVE_AP.mac, subtitle: `WLAN: ${MOVE_GROUP.wlanName}` }, { timeout: WAIT_MS });
      await page.waitForFunction(() => !document.getElementById('refreshBtn').classList.contains('spinning'), null, { timeout: WAIT_MS });
      const snapshot = await stubState(session);
      const shell = await readShell(page);
      return verdict(
        callsTo(snapshot, 'omada:get-aps').length === 2 && callsTo(snapshot, 'omada:get-wlans').length === 2 &&
        shell.selectionPlaceholder === es.selectApAndWlan && shell.applyDisabled === true && shell.apply === es.apply,
        { getAps: callsTo(snapshot, 'omada:get-aps').length, getWlans: callsTo(snapshot, 'omada:get-wlans').length, shell }
      );
    }); // End of check "[es] AP move -> UI updates: lists reloaded, the AP shows its new gr..."

    await check('[es] Refresh: spinner while loading, then both lists reload with the controller\'s current data', async () => {
      const before = await stubState(session);
      await configureStub(session, { accessPoints: [...before.scenario.accessPoints, data.newAccessPoint], delays: { 'omada:get-aps': 400 } });
      await page.click('#refreshBtn');
      await page.waitForFunction(() =>
        document.getElementById('refreshBtn').classList.contains('spinning') && document.querySelector('#apList .loading') !== null,
      null, { timeout: WAIT_MS });
      await page.waitForFunction((name) => Array.from(document.querySelectorAll('#apList .item-name')).some((el) => el.textContent === name),
        data.newAccessPoint.name, { timeout: WAIT_MS });
      await configureStub(session, { delays: {} });
      const after = await stubState(session);
      const shell = await readShell(page);
      return verdict(
        callsTo(after, 'omada:get-aps').length === callsTo(before, 'omada:get-aps').length + 1 &&
        callsTo(after, 'omada:get-wlans').length === callsTo(before, 'omada:get-wlans').length + 1 &&
        shell.refreshSpinning === false && shell.refreshDisabled === false,
        { shell }
      );
    }); // End of check "[es] Refresh: spinner while loading, then both lists reload with th..."

    await check('[es] Disconnect: OMADA_DISCONNECT called, lists cleared, status back to disconnected', async () => {
      await page.click('#connectBtn');
      await waitForStatus(page, es.disconnected);
      const snapshot = await stubState(session);
      const disconnects = callsTo(snapshot, 'omada:disconnect');
      const shell = await readShell(page);
      return verdict(
        disconnects.length === 1 && disconnects[0].args[0] == null && snapshot.connected === false &&
        shell.apEmpty === es.connectToSeeAPs && shell.wlanEmpty === es.connectToSeeWLANs && shell.connect === es.connect &&
        shell.refreshDisabled === true && shell.applyDisabled === true,
        { disconnects, shell }
      );
    }); // End of check "[es] Disconnect: OMADA_DISCONNECT called, lists cleared, status bac..."

    await check('[es] connect failure: error shown in the status bar, controller released, no crash', async () => {
      await configureStub(session, { connect: { success: false, error: 'connectError', detail: 'HTTP 503: Service Unavailable' } });
      await page.click('#connectBtn');
      await page.waitForSelector('#statusIndicator.error', { timeout: WAIT_MS });
      await page.waitForFunction(() => document.getElementById('connectBtn').disabled === false, null, { timeout: WAIT_MS });
      const snapshot = await stubState(session);
      const disconnects = callsTo(snapshot, 'omada:disconnect');
      const shell = await readShell(page);
      return verdict(
        shell.status === 'Error de conexión (HTTP 503: Service Unavailable)' && shell.connect === es.connect &&
        shell.settingsDisabled === false && shell.apEmpty === es.connectToSeeAPs &&
        disconnects.length === 2 && disconnects[1].args[0] == null,
        { shell, disconnects }
      );
    }); // End of check "[es] connect failure: error shown in the status bar, controller rel..."

    await check('[es] recovers after the failure: reconnecting renders the lists again', async () => {
      await configureStub(session, { connect: { success: true } });
      await page.click('#connectBtn');
      await waitForStatus(page, CONTROLLER_HOST);
      const scenario = (await stubState(session)).scenario;
      const expected = expectedApRows(scenario.accessPoints, 'es');
      await waitForApCount(page, expected.length);
      return compareApRows(await readApItems(page), expected);
    });

    await check('[es] settings opened from the gear button: focus moves into the URL field, background inert', async () => {
      await page.click('#settingsBtn');
      await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
      await page.waitForFunction(() => document.activeElement?.id === 'urlInput', null, { timeout: WAIT_MS });
      const shell = await readShell(page);
      return verdict(shell.inert === true, shell);
    });

    await check('[es] URL-scoped password: editing the URL drops "(sin cambios)", a blank password is refused (no save), restoring the URL brings it back', async () => {
      const savesBefore = callsTo(await stubState(session), 'config:save').length;
      await page.fill('#urlInput', 'https://otro-controlador.invalid:8043');
      const changed = await page.evaluate(() => document.getElementById('passwordInput').placeholder);
      await page.click('#saveSettingsBtn');
      await waitForToast(page, 'error', CERT_TEXT.es.passwordRequired);
      const savesAfter = callsTo(await stubState(session), 'config:save').length;
      await page.fill('#urlInput', `${CONTROLLER_URL}/`);
      const restored = await page.evaluate(() => document.getElementById('passwordInput').placeholder);
      const shell = await readShell(page);
      return verdict(
        changed === CERT_TEXT.es.requiredNewUrl && restored === CERT_TEXT.es.unchanged && savesAfter === savesBefore && shell.settingsOpen === true,
        { changed, restored, savesBefore, savesAfter, settingsOpen: shell.settingsOpen }
      );
    }); // End of check "[es] URL-scoped password: editing the URL drops ..."

    await check('[es] save rejected by the main process: error toast, password never echoed, settings stay open', async () => {
      await configureStub(session, { saveResult: { success: false, error: 'saveFailed' } });
      await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
      await page.fill('#urlInput', CONTROLLER_URL);
      const form = await page.evaluate(() => ({
        url: document.getElementById('urlInput').value,
        password: document.getElementById('passwordInput').value,
        placeholder: document.getElementById('passwordInput').placeholder,
      }));
      await page.click('#saveSettingsBtn');
      await waitForToast(page, 'error', 'Error al guardar la configuración');
      const saves = callsTo(await stubState(session), 'config:save');
      const shell = await readShell(page);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('settingsModal').classList.contains('visible'), null, { timeout: WAIT_MS });
      await configureStub(session, { saveResult: null });
      const lastSave = saves[saves.length - 1]?.args[0];
      return verdict(
        form.url === CONTROLLER_URL && form.password === '' && form.placeholder === '(sin cambios)' &&
        saves.length === 2 && lastSave && !('password' in lastSave) && shell.settingsOpen === true,
        { form, saves, settingsOpen: shell.settingsOpen }
      );
    }); // End of check "[es] save rejected by the main process: error toast, password never..."
  } finally {
    session.finalState = await stubState(session).catch((error) => ({ error: String(error) }));
    await session.app.close().catch(() => {});
  }
} // End of function runSpanishFirstRun()

// ============================================================================
// Launch 2: English, stored config, multi-site controller
// ============================================================================

/**
 * English launch with a stored config on a multi-site controller: auto
 * connect, site modal (cancel, then pick), lists, remembered site.
 * @param {{ binary: string }} electronInfo - Resolved Electron binary.
 * @returns {Promise<void>}
 */
async function runEnglishMultiSite(electronInfo) {
  const session = await launch(electronInfo, 'en', {
    config: { url: CONTROLLER_URL, username: 'admin', language: 'en', hasPassword: true },
    connect: { needsSiteSelection: true },
    sites: data.sites,
    accessPoints: data.accessPoints,
    wlanGroups: data.wlanGroups,
  });
  const { page } = session;
  const en = TEXT.en;
  const [firstSite, secondSite] = data.sites;

  try {
    await checkWindowLikeRealApp(session);
    await checkTranslations(session, 'en');

    await check('[en] stored config: auto-connects on startup (no settings modal) and asks for a site', async () => {
      await page.waitForSelector('#siteModal.visible', { timeout: WAIT_MS });
      const connects = callsTo(await stubState(session), 'omada:connect');
      const shell = await readShell(page);
      return verdict(connects.length === 1 && shell.settingsOpen === false && shell.status === en.connecting, { connects: connects.length, shell });
    });

    await check('[en] multi-site: the site modal lists the fixture sites with focus on the first one', async () => {
      await page.waitForFunction((id) => document.activeElement?.dataset?.siteId === id, firstSite.id, { timeout: WAIT_MS });
      const options = await page.evaluate(() => Array.from(document.querySelectorAll('#siteList .site-option')).map((button) => ({
        id: button.dataset.siteId, name: button.textContent,
      })));
      const shell = await readShell(page);
      return verdict(isDeepStrictEqual(options, data.sites) && shell.inert === true, { options, inert: shell.inert });
    });

    await check('[en] site modal -> Cancel: nonce-scoped OMADA_DISCONNECT, back to disconnected', async () => {
      await page.click('#cancelSiteBtn');
      await waitForStatus(page, en.disconnected);
      const snapshot = await stubState(session);
      const disconnects = callsTo(snapshot, 'omada:disconnect');
      const shell = await readShell(page);
      return verdict(
        disconnects.length === 1 && disconnects[0].args[0] === snapshot.issuedNonces[0] && snapshot.pendingSelection === null &&
        shell.connect === en.connect && shell.siteOpen === false && callsTo(snapshot, 'omada:select-site').length === 0,
        { disconnects, issuedNonces: snapshot.issuedNonces, shell }
      );
    }); // End of check "[en] site modal -> Cancel: nonce-scoped OMADA_DISCONNECT, back to d..."

    await check('[en] site modal reopened from the Connect button: focus on the first site option', async () => {
      await page.click('#connectBtn');
      await page.waitForSelector('#siteModal.visible', { timeout: WAIT_MS });
      await page.waitForFunction((id) => document.activeElement?.dataset?.siteId === id, firstSite.id, { timeout: WAIT_MS });
      return true;
    });

    await check('[en] picking a site calls OMADA_SELECT_SITE with the site id and the selection nonce', async () => {
      await page.waitForSelector('#siteModal.visible', { timeout: WAIT_MS });
      await page.click(`#siteList .site-option[data-site-id="${secondSite.id}"]`);
      await waitForStatus(page, CONTROLLER_HOST);
      const snapshot = await stubState(session);
      const selections = callsTo(snapshot, 'omada:select-site');
      return verdict(
        selections.length === 1 && snapshot.issuedNonces.length === 2 &&
        isDeepStrictEqual(selections[0].args, [secondSite.id, snapshot.issuedNonces[1]]) && snapshot.storedSiteId === secondSite.id,
        { selections, issuedNonces: snapshot.issuedNonces }
      );
    }); // End of check "[en] picking a site calls OMADA_SELECT_SITE with the site id and th..."

    await check('[en] lists render after the site selection, with English status and group labels', async () => {
      const expectedAps = expectedApRows(data.accessPoints, 'en');
      await waitForApCount(page, expectedAps.length);
      const apVerdict = compareApRows(await readApItems(page), expectedAps);
      const expectedWlans = expectedWlanRows(data.wlanGroups, 'en');
      const wlans = (await readWlanItems(page)).map(({ name, subtitle }) => ({ name, subtitle }));
      return verdict(apVerdict.ok && isDeepStrictEqual(wlans, expectedWlans), { aps: apVerdict.detail, wlans, expectedWlans });
    });

    await check('[en] reconnect reuses the remembered site (no site modal, no new selection)', async () => {
      await page.click('#connectBtn');
      await waitForStatus(page, en.disconnected);
      await page.click('#connectBtn');
      await waitForStatus(page, CONTROLLER_HOST);
      await waitForApCount(page, expectedApRows(data.accessPoints, 'en').length);
      const snapshot = await stubState(session);
      return verdict(
        callsTo(snapshot, 'omada:connect').length === 3 && snapshot.issuedNonces.length === 2 &&
        callsTo(snapshot, 'omada:select-site').length === 1 && callsTo(snapshot, 'omada:disconnect').length === 2,
        { connects: callsTo(snapshot, 'omada:connect').length, nonces: snapshot.issuedNonces.length }
      );
    }); // End of check "[en] reconnect reuses the remembered site (no site modal, no new se..."

    await check('[en] Save with a different controller URL while connected: CONFIG_SAVE reports connectionReset, the old controller\'s lists are dropped at once (no stale rows while the auto-connect runs), the remembered site is forgotten', async () => {
      // Slow connect, so the state between the save and the reconnect is observable
      await configureStub(session, { delays: { 'omada:connect': 1500 } });
      try {
        await page.click('#settingsBtn');
        await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
        await page.fill('#urlInput', 'https://other-controller.invalid:8043');
        await page.fill('#passwordInput', 'other-password');
        await page.click('#saveSettingsBtn');
        await page.waitForFunction(() => !document.getElementById('settingsModal').classList.contains('visible'), null, { timeout: WAIT_MS });
        const during = await readShell(page);
        const rowsDuring = (await readApItems(page)).length;
        const afterSave = await stubState(session);
        // The auto-connect asks for a site again (the remembered one was dropped)
        await page.waitForSelector('#siteModal.visible', { timeout: WAIT_MS });
        await page.click('#cancelSiteBtn');
        await waitForStatus(page, en.disconnected);
        return verdict(
          rowsDuring === 0 && during.apEmpty === en.connectToSeeAPs && during.status === en.connecting &&
          afterSave.connected === false && afterSave.storedSiteId === '' &&
          afterSave.scenario.config.url === 'https://other-controller.invalid:8043',
          { rowsDuring, during, connected: afterSave.connected, storedSiteId: afterSave.storedSiteId }
        );
      } finally {
        await configureStub(session, { delays: {} });
      }
    }); // End of check "[en] Save with a different controller URL while connected..."
  } finally {
    session.finalState = await stubState(session).catch((error) => ({ error: String(error) }));
    await session.app.close().catch(() => {});
  }
} // End of function runEnglishMultiSite()

// ============================================================================
// Launch 3: English, stored config, self-signed certificate (TOFU pinning)
// ============================================================================

/**
 * English launch against a fake controller presenting a self-signed
 * certificate: first-use dialog (cancel, then trust -> connected), the pinned
 * fingerprint in Settings, the "certificate changed" dialog (stays
 * disconnected), the Settings reset (disconnected and connected), and first
 * use again after a reset.
 * @param {{ binary: string }} electronInfo - Resolved Electron binary.
 * @returns {Promise<void>}
 */
async function runCertificatePinning(electronInfo) {
  const session = await launch(electronInfo, 'tofu', {
    config: { url: CONTROLLER_URL, username: 'admin', language: 'en', hasPassword: true, pinnedFingerprint: null },
    connect: { success: true },
    presentedFingerprint: FINGERPRINT_A,
    accessPoints: data.accessPoints,
    wlanGroups: data.wlanGroups,
  });
  const { page } = session;
  const en = TEXT.en;
  const text = CERT_TEXT.en;
  const expectedAps = expectedApRows(data.accessPoints, 'en');

  try {
    await checkWindowLikeRealApp(session);

    await check('[tofu] auto-connect meets a self-signed certificate: first-use dialog with host and SHA-256 fingerprint, focus on Cancel, inert background, no data requested', async () => {
      await page.waitForSelector('#certModal.visible', { timeout: WAIT_MS });
      await page.waitForFunction(() => document.activeElement?.id === 'cancelCertBtn', null, { timeout: WAIT_MS });
      const modal = await readCertModal(page);
      const snapshot = await stubState(session);
      const shell = await readShell(page);
      return verdict(
        modal.title === text.untrustedTitle && modal.message.length > 0 && modal.role === 'dialog' && modal.ariaModal === 'true' &&
        isDeepStrictEqual(modal.rows, [
          { term: text.host, value: CONTROLLER_HOST, fingerprint: false },
          { term: text.fingerprint, value: FINGERPRINT_A, fingerprint: true },
        ]) &&
        modal.confirmShown && modal.confirmText === text.trust && modal.cancelText === text.cancel && modal.hintShown === false &&
        modal.inert === true && shell.status === en.connecting && callsTo(snapshot, 'omada:get-aps').length === 0 &&
        snapshot.issuedTrustNonces.length === 1 && snapshot.pendingTrust?.nonce === snapshot.issuedTrustNonces[0],
        { modal, status: shell.status, nonces: snapshot.issuedTrustNonces }
      );
    }); // End of check "[tofu] auto-connect meets a self-signed certificate..."

    await check('[tofu] first-use -> Cancel: disconnected, unconditional disconnect, nothing trusted', async () => {
      await page.click('#cancelCertBtn');
      await waitForStatus(page, en.disconnected);
      const snapshot = await stubState(session);
      const disconnects = callsTo(snapshot, 'omada:disconnect');
      const shell = await readShell(page);
      return verdict(
        disconnects.length === 1 && disconnects[0].args[0] == null && snapshot.pendingTrust === null &&
        callsTo(snapshot, 'cert:trust').length === 0 && snapshot.scenario.config.pinnedFingerprint === null &&
        shell.certOpen === false && shell.inert === false && shell.connect === en.connect,
        { disconnects, pendingTrust: snapshot.pendingTrust, shell }
      );
    }); // End of check "[tofu] first-use -> Cancel..."

    await check('[tofu] Connect again -> first-use dialog again; "Trust and connect" sends ONLY the new nonce, reconnects and renders the lists', async () => {
      await page.click('#connectBtn');
      await page.waitForSelector('#certModal.visible', { timeout: WAIT_MS });
      await page.click('#confirmCertBtn');
      await waitForStatus(page, CONTROLLER_HOST);
      await waitForApCount(page, expectedAps.length);
      const snapshot = await stubState(session);
      const trusts = callsTo(snapshot, 'cert:trust');
      const apVerdict = compareApRows(await readApItems(page), expectedAps);
      return verdict(
        trusts.length === 1 && isDeepStrictEqual(trusts[0].args, [snapshot.issuedTrustNonces[1]]) &&
        callsTo(snapshot, 'omada:connect').length === 3 && snapshot.scenario.config.pinnedFingerprint === FINGERPRINT_A &&
        snapshot.connected === true && apVerdict.ok,
        { trusts, nonces: snapshot.issuedTrustNonces, connects: callsTo(snapshot, 'omada:connect').length, aps: apVerdict.detail }
      );
    }); // End of check "[tofu] Connect again -> first-use dialog again..."

    await check('[tofu] Settings shows the pinned fingerprint and an enabled reset button', async () => {
      await page.click('#settingsBtn');
      await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
      const section = await readCertPinSection(page);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('settingsModal').classList.contains('visible'), null, { timeout: WAIT_MS });
      return verdict(section.value === FINGERPRINT_A && section.resetDisabled === false && section.confirmShown === false, section);
    });

    await check('[tofu] certificate changed: dialog shows trusted and presented fingerprints with a single Close button; the app stays disconnected', async () => {
      await page.click('#connectBtn');
      await waitForStatus(page, en.disconnected);
      await configureStub(session, { presentedFingerprint: FINGERPRINT_B });
      const before = await stubState(session);
      await page.click('#connectBtn');
      await page.waitForSelector('#certModal.visible', { timeout: WAIT_MS });
      await page.waitForFunction(() => document.activeElement?.id === 'cancelCertBtn', null, { timeout: WAIT_MS });
      const modal = await readCertModal(page);
      const during = await readShell(page);
      await page.click('#cancelCertBtn');
      await page.waitForFunction(() => !document.getElementById('certModal').classList.contains('visible'), null, { timeout: WAIT_MS });
      await page.waitForFunction(() => document.getElementById('connectBtn').disabled === false, null, { timeout: WAIT_MS });
      const after = await stubState(session);
      const shell = await readShell(page);
      return verdict(
        modal.title === text.changedTitle &&
        isDeepStrictEqual(modal.rows, [
          { term: text.host, value: CONTROLLER_HOST, fingerprint: false },
          { term: text.pinned, value: FINGERPRINT_A, fingerprint: true },
          { term: text.presented, value: FINGERPRINT_B, fingerprint: true },
        ]) &&
        modal.confirmShown === false && modal.cancelText === text.close && modal.hintShown === true &&
        during.status === text.changedStatus && during.indicator.split(' ').includes('error') &&
        shell.status === text.changedStatus && shell.connect === en.connect && after.connected === false &&
        callsTo(after, 'cert:trust').length === callsTo(before, 'cert:trust').length &&
        callsTo(after, 'omada:get-aps').length === callsTo(before, 'omada:get-aps').length &&
        after.scenario.config.pinnedFingerprint === FINGERPRINT_A && shell.inert === false,
        { modal, during: during.status, shell }
      );
    }); // End of check "[tofu] certificate changed..."

    await check('[tofu] Settings reset (disconnected): inline confirmation, CERT_RESET with no arguments, fingerprint shows "None"', async () => {
      await page.click('#settingsBtn');
      await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
      await page.click('#resetCertBtn');
      await page.waitForFunction(() => document.activeElement?.id === 'cancelCertResetBtn', null, { timeout: WAIT_MS });
      const asking = await readCertPinSection(page);
      await page.click('#confirmCertResetBtn');
      await waitForToast(page, 'success', text.resetDone);
      const section = await readCertPinSection(page);
      const snapshot = await stubState(session);
      const resets = callsTo(snapshot, 'cert:reset');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('settingsModal').classList.contains('visible'), null, { timeout: WAIT_MS });
      return verdict(
        asking.confirmShown === true && asking.resetHidden === true && asking.confirmMessage === text.resetConfirm &&
        resets.length === 1 && isDeepStrictEqual(resets[0].args, []) && snapshot.scenario.config.pinnedFingerprint === null &&
        section.value === text.pinNone && section.resetDisabled === true && section.confirmShown === false,
        { asking, section, resets }
      );
    }); // End of check "[tofu] Settings reset (disconnected)..."

    await check('[tofu] after the reset the next connect is a first use again (new certificate offered); Escape cancels', async () => {
      await page.click('#connectBtn');
      await page.waitForSelector('#certModal.visible', { timeout: WAIT_MS });
      const modal = await readCertModal(page);
      await page.keyboard.press('Escape');
      await waitForStatus(page, en.disconnected);
      const snapshot = await stubState(session);
      return verdict(
        modal.title === text.untrustedTitle && modal.rows[1]?.value === FINGERPRINT_B && snapshot.pendingTrust === null &&
        callsTo(snapshot, 'cert:trust').length === 1,
        { modal, pendingTrust: snapshot.pendingTrust }
      );
    }); // End of check "[tofu] after the reset the next connect is a first use again..."

    await check('[tofu] Settings reset while connected: the session is closed first (OMADA_DISCONNECT before CERT_RESET)', async () => {
      await page.click('#connectBtn');
      await page.waitForSelector('#certModal.visible', { timeout: WAIT_MS });
      await page.click('#confirmCertBtn');
      await waitForStatus(page, CONTROLLER_HOST);
      await waitForApCount(page, expectedAps.length);
      await page.click('#settingsBtn');
      await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
      await page.click('#resetCertBtn');
      const asking = await readCertPinSection(page);
      await page.click('#confirmCertResetBtn');
      await waitForToast(page, 'success', text.resetDone);
      const snapshot = await stubState(session);
      const channels = snapshot.calls.map((call) => call.channel);
      const disconnectIndex = channels.lastIndexOf('omada:disconnect');
      const resetIndex = channels.lastIndexOf('cert:reset');
      const shell = await readShell(page);
      await page.keyboard.press('Escape');
      return verdict(
        asking.confirmMessage === text.resetConfirmConnected && disconnectIndex >= 0 && resetIndex > disconnectIndex &&
        snapshot.calls[disconnectIndex].args[0] == null && callsTo(snapshot, 'cert:reset').length === 2 &&
        snapshot.connected === false && snapshot.scenario.config.pinnedFingerprint === null &&
        shell.status === en.disconnected && shell.apEmpty === en.connectToSeeAPs,
        { asking, disconnectIndex, resetIndex, shell }
      );
    }); // End of check "[tofu] Settings reset while connected..."
  } finally {
    session.finalState = await stubState(session).catch((error) => ({ error: String(error) }));
    await session.app.close().catch(() => {});
  }
} // End of function runCertificatePinning()

// ============================================================================
// Whole-run checks
// ============================================================================

/**
 * Checks that span every launch: the Electron version that ran, IPC table
 * coverage, console/page errors, network, sender trust and HOME isolation.
 * @returns {Promise<void>}
 */
async function runGlobalChecks() {
  const { IPC_CHANNELS } = require(path.join(projectRoot, 'dist', 'shared', 'types.js'));
  const channels = Object.values(IPC_CHANNELS).sort();
  const states = launches.map((session) => ({ session, state: session.finalState || {} }));

  // The installed electron package's version (its package.json is intact even
  // where Dropbox broke node_modules/electron/dist): every launch must have run
  // exactly that Electron, so a stale ELECTRON_PATH cannot pass silently
  const installedElectron = require('electron/package.json').version;
  await check(`every launch ran the installed Electron ${installedElectron} (process.versions.electron)`, () => {
    const running = launches.map((session) => ({ label: session.label, versions: session.runningVersions }));
    return verdict(
      running.length === EXPECTED_LAUNCHES && running.every(({ versions }) => versions && versions.electron === installedElectron),
      running
    );
  });

  await check(`stub registered a handler for every IPC channel (${channels.length}) on every launch`, () =>
    verdict(states.every(({ state }) => isDeepStrictEqual([...(state.registeredChannels || [])].sort(), channels)), {
      channels, registered: states.map(({ state }) => state.registeredChannels),
    }));

  await check('zero renderer console errors across the whole run', () => {
    const stubErrors = states.flatMap(({ session, state }) =>
      (state.rendererErrors || []).filter((entry) => entry.startsWith('console.error')).map((entry) => `[${session.label}] ${entry}`));
    const all = [...stubErrors, ...playwrightConsoleErrors];
    return verdict(all.length === 0, all);
  });

  await check('zero page errors, preload errors, renderer crashes or failed loads', () => {
    const other = states.flatMap(({ session, state }) =>
      (state.rendererErrors || []).filter((entry) => !entry.startsWith('console.error')).map((entry) => `[${session.label}] ${entry}`));
    const all = [...other, ...playwrightPageErrors];
    return verdict(all.length === 0, all);
  });

  await check('no network request left the app (nothing but file: was requested)', () => {
    const blocked = states.flatMap(({ state }) => state.blockedRequests || []);
    return verdict(blocked.length === 0, blocked);
  });

  await check('every IPC call came from the trusted renderer frame', () =>
    verdict(states.every(({ state }) => state.untrustedCalls === 0 && (state.calls || []).every((call) => call.trusted)), states.map(({ state }) => state.untrustedCalls)));

  await check('HOME and Electron userData were fresh temp dirs on every launch', () => {
    const detail = states.map(({ session, state }) => ({ home: session.home, seen: state.environment }));
    return verdict(
      states.length === EXPECTED_LAUNCHES && states.every(({ session, state }) =>
        state.environment && path.resolve(state.environment.home) === path.resolve(session.home) &&
        path.resolve(state.environment.userData).startsWith(path.resolve(session.home) + path.sep) &&
        path.resolve(session.home).startsWith(path.resolve(os.tmpdir()))),
      detail
    );
  });

  await check('nothing was written to the temp HOME config dir', () => {
    // The app's config dir name, resolved ONLY inside the throwaway HOMEs
    const written = launches.map((session) => path.join(session.home, '.omada-wlan-manager')).filter((dir) => existsSync(dir));
    return verdict(written.length === 0, written);
  });
} // End of function runGlobalChecks()

/**
 * Entry point: resolve Electron, run every launch and the global checks,
 * print the summary, clean up the temp dirs and set the exit code.
 * @returns {Promise<void>}
 */
async function main() {
  assertBuilt();
  const electronInfo = resolveElectron();
  console.log(`Electron ${electronInfo.version} (${electronInfo.source}): ${electronInfo.binary}\n`);

  try {
    for (const [label, runLaunch] of [['es', runSpanishFirstRun], ['en', runEnglishMultiSite], ['tofu', runCertificatePinning]]) {
      try {
        await runLaunch(electronInfo);
      } catch (error) {
        record(`[${label}] launch completed`, false, String(error && error.message ? error.message : error).split('\n')[0]);
      }
    }
    await runGlobalChecks();
  } finally {
    for (const session of launches) {
      const output = session.mainOutput.join('').trim();
      if (output) {
        console.log(`\n[${session.label}] main-process output:\n${output}`);
      }
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} smoke checks passed`);
  process.exitCode = failed > 0 ? 1 : 0;
} // End of function main()

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
