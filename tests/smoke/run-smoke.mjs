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
// The group vocabulary has an "AP groups" (apGroup, Omada 6.3+) and a legacy
// "WLAN groups" (wlanGroup) variant per concept (docs/management-design.md §4.1)
const TEXT = {
  es: {
    disconnected: 'Desconectado', connecting: 'Conectando...', connect: 'Conectar', disconnect: 'Desconectar', connected: 'Conectado',
    unassigned: 'Sin asignar', cancel: 'Cancelar', close: 'Cerrar',
    emptyGroup: 'Sin redes Wi-Fi — silencia estos AP', more: 'más', configureHint: 'Configura la conexión en Ajustes para empezar',
    connectToSeeAPs: 'Conecta al controlador para ver los puntos de acceso',
    connectToSeeGroups: 'Conecta al controlador para ver los grupos de AP',
    groupsTitle: { apGroup: 'Grupos de AP', wlanGroup: 'Grupos WLAN (heredado)' },
    selectGroup: { apGroup: 'Selecciona un grupo de AP', wlanGroup: 'Selecciona un grupo WLAN' },
    groupLabel: { apGroup: 'Grupo de AP', wlanGroup: 'WLAN' },
    status: ['Desconectado', 'Conectado', 'Adoptando', 'Sin respuesta', 'Aislado'], statusUnknown: 'Estado desconocido',
    // App shell and Access points list (phase 13a)
    accessPoints: 'Puntos de acceso', wifiNetworks: 'Redes Wi-Fi', updated: 'Actualizado {time}', refreshing: 'Actualizando…',
    site: 'Sitio: {site}', version: 'Omada {version}',
    comingSoon: 'Esta vista llegará en una versión posterior. Mientras tanto, mueve los puntos de acceso entre grupos desde la vista Puntos de acceso.',
    networksOne: '1 red', networksMany: '{count} redes', networksNone: 'Sin redes', clientsOne: '1 cliente', clientsMany: '{count} clientes',
    selNone: 'Ningún AP seleccionado', selOne: '1 seleccionado', selMany: '{count} seleccionados',
    hiddenOne: '1 oculto por los filtros', hiddenMany: '{count} ocultos por los filtros',
    selectAll: 'Seleccionar los {count} AP', selectAllFiltered: 'Seleccionar los {count} AP filtrados',
    noMatching: 'Ningún punto de acceso coincide con los filtros', clearFilters: 'Borrar filtros',
    loadError: 'Error al cargar los datos del controlador',
    // Destination pane, review dialog and per-AP results (phase 13b)
    destinationTitle: 'Mover los AP seleccionados', silence: 'Silenciar',
    noDestinationResults: 'Ningún grupo ni red coincide con "{query}"', clearSearch: 'Borrar búsqueda',
    moveNoSelection: 'Selecciona los puntos de acceso que quieres mover', moveDestination: 'Destino: {group}',
    alreadyOne: '1 ya está en este grupo', alreadyMany: '{count} ya están en este grupo', willMoveOne: '1 se moverá', willMoveMany: '{count} se moverán',
    allAlreadyOne: 'El AP seleccionado ya está en este grupo', allAlreadyMany: 'Los {count} AP seleccionados ya están en este grupo',
    hiddenNoteOne: 'Incluye 1 AP oculto por los filtros', hiddenNoteMany: 'Incluye {count} AP ocultos por los filtros',
    gains: 'Gana', loses: 'Pierde', unchanged: 'Sin cambios', none: 'Ninguna', partialNetwork: '{name} ({count} de {total})',
    unknownOne: 'No se conocen las redes actuales de 1 AP (sin grupo o con un grupo no reconocido): no se incluye arriba',
    moveNone: 'Mover AP', moveOne: 'Mover AP', moveMany: 'Mover {count} AP',
    reviewTitle: 'Revisar el movimiento', reviewOne: '"{ap}" se moverá a "{group}".', reviewMany: 'Se moverán {count} AP a "{group}".',
    from: 'Desde', to: 'Hacia', apOne: '1 AP', apMany: '{count} AP',
    skippedOne: '1 ya está en este grupo y no se moverá', skippedMany: '{count} ya están en este grupo y no se moverán',
    clientsMissingOne: '(1 AP no informa de sus clientes)', clientsMissingMany: '({count} AP no informan de sus clientes)',
    notAtomic: 'Los AP se mueven de uno en uno y la operación no es atómica: si alguno falla, los demás se mueven igualmente.',
    overrides: 'No se pueden mostrar las redes personalizadas de cada AP: la API interna del controlador no informa de ellas.',
    resultsTitle: 'Resultado del movimiento', resultsAllOne: 'Se movió el AP a "{group}".', resultsAllMany: 'Se movieron los {count} AP a "{group}".',
    resultsPartial: 'Se movieron {moved} de {total} AP a "{group}". Los que fallaron siguen seleccionados.',
    resultOk: 'Movido', resultFailed: 'Error', rejected: 'El controlador no aceptó el cambio', retryFailed: 'Reintentar los fallidos',
    // Phase 13b review fixes: ambiguous (same-named) groups and the retry contract after the reload
    ambiguous: 'Otro grupo tiene el mismo nombre — cambia el nombre de uno en Omada para mover AP aquí',
    retryMissingOne: '1 AP fallido ya no está en el controlador y no se reintentará.',
    retryRemainingOne: '"{action}" solo reintentará el AP restante.',
    retryDestinationGone: 'No se puede reintentar: el grupo "{group}" ya no está en el controlador.',
  },
  en: {
    disconnected: 'Disconnected', connecting: 'Connecting...', connect: 'Connect', disconnect: 'Disconnect', connected: 'Connected',
    unassigned: 'Unassigned', cancel: 'Cancel', close: 'Close',
    emptyGroup: 'No Wi-Fi networks — silences these APs', more: 'more', configureHint: 'Set up the connection in Settings to get started',
    connectToSeeAPs: 'Connect to the controller to see access points',
    connectToSeeGroups: 'Connect to the controller to see AP groups',
    groupsTitle: { apGroup: 'AP groups', wlanGroup: 'WLAN groups (legacy)' },
    selectGroup: { apGroup: 'Select an AP group', wlanGroup: 'Select a WLAN group' },
    groupLabel: { apGroup: 'AP group', wlanGroup: 'WLAN' },
    status: ['Disconnected', 'Connected', 'Adopting', 'Heartbeat missed', 'Isolated'], statusUnknown: 'Unknown status',
    // App shell and Access points list (phase 13a)
    accessPoints: 'Access points', wifiNetworks: 'Wi-Fi networks', updated: 'Updated {time}', refreshing: 'Refreshing…',
    site: 'Site: {site}', version: 'Omada {version}',
    comingSoon: 'This view arrives in a later version. Meanwhile, move access points between groups from the Access points view.',
    networksOne: '1 network', networksMany: '{count} networks', networksNone: 'No networks', clientsOne: '1 client', clientsMany: '{count} clients',
    selNone: 'No APs selected', selOne: '1 selected', selMany: '{count} selected',
    hiddenOne: '1 hidden by filters', hiddenMany: '{count} hidden by filters',
    selectAll: 'Select all {count} APs', selectAllFiltered: 'Select all {count} filtered APs',
    noMatching: 'No access points match the filters', clearFilters: 'Clear filters',
    loadError: 'Error loading data from the controller',
    // Destination pane (phase 13b)
    destinationTitle: 'Move selected APs', silence: 'Silence',
    moveNoSelection: 'Select the access points to move', moveDestination: 'Destination: {group}',
    moveNone: 'Move APs', moveOne: 'Move AP', moveMany: 'Move {count} APs',
    ambiguous: 'Another group has the same name — rename one in Omada to move APs here',
  },
};
const STATUS_CLASSES = ['offline', 'online', 'pending', 'warning', 'isolated'];
const CONTROLLER_URL = 'https://controller.invalid:8043';
const CONTROLLER_HOST = 'controller.invalid:8043';
const MOVE_AP = data.accessPoints.find((ap) => ap.name === 'EAP Carpio');
const MOVE_GROUP = data.wlanGroups.find((group) => group.wlanName === 'zGrupo B');
// An AP group without Wi-Fi networks (listed since the group list comes from setting/wlans)
const EMPTY_GROUP = data.wlanGroups.find((group) => group.wlanName === 'zNinguna');
// Fixture APs and 6.3 groups by name (selection and bulk-move checks)
const AP = Object.fromEntries(data.accessPoints.map((ap) => [ap.name, ap]));
const GROUP = Object.fromEntries(data.wlanGroups.map((group) => [group.wlanName, group]));
const LEGACY_GROUP = Object.fromEntries(data.legacyWlanGroups.map((group) => [group.wlanName, group]));
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
  const required = ['dist/main/preload.js', 'dist/main/url.js', 'dist/main/controller-version.js', 'dist/shared/types.js', 'dist/renderer/index.html', 'dist/renderer/renderer.js'];
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
 * Reads the rendered AP rows: name, group, counts, status (class and text),
 * the native checkbox's state and accessible name (its aria-labelledby text).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<Array<{ mac: string; name: string; group: string; counts: string; statusClass: string; statusLabel: string; checked: boolean | null; checkboxType: string | null; checkboxName: string | null }>>}
 */
function readApItems(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#apList .ap-row')).map((row) => {
    const status = row.querySelector('.item-status');
    const checkbox = row.querySelector('input.ap-checkbox');
    const labelId = checkbox?.getAttribute('aria-labelledby');
    return {
      mac: row.dataset.mac,
      name: row.querySelector('.item-name')?.textContent || '',
      group: row.querySelector('.ap-row-group')?.textContent || '',
      counts: row.querySelector('.ap-row-counts')?.textContent || '',
      statusClass: status ? Array.from(status.classList).filter((cls) => cls !== 'item-status').join(' ') : '',
      statusLabel: status?.querySelector('.status-label')?.textContent || '',
      checked: checkbox ? checkbox.checked : null,
      checkboxType: checkbox ? checkbox.type : null,
      checkboxName: labelId ? document.getElementById(labelId)?.textContent ?? null : null,
    };
  }));
} // End of function readApItems()

/**
 * Reads the destination pane's options: group id, name, details, section
 * ('networks' or the pinned 'silence'), the native radio's type, name,
 * state (checked, disabled) and accessible name (its aria-labelledby text),
 * the reason shown for a disabled (ambiguous) group, and the radio's
 * description (its aria-describedby texts, space-joined).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<Array<{ wlanId: string; name: string; detail: string; section: string; checked: boolean | null; disabled: boolean | null; type: string | null; radioName: string | null; accessibleName: string | null; reason: string | null; description: string }>>}
 */
function readDestinations(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#destinationList .destination-option')).map((option) => {
    const radio = option.querySelector('input');
    const labelId = radio?.getAttribute('aria-labelledby');
    const describedBy = (radio?.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    return {
      wlanId: option.dataset.wlanId,
      name: option.querySelector('.destination-name')?.textContent || '',
      detail: option.querySelector('.destination-detail')?.textContent || '',
      section: option.closest('.destination-silence') ? 'silence' : 'networks',
      checked: radio ? radio.checked : null,
      disabled: radio ? radio.disabled : null,
      type: radio?.type ?? null,
      radioName: radio?.name ?? null,
      accessibleName: labelId ? document.getElementById(labelId)?.textContent ?? null : null,
      reason: option.querySelector('.destination-reason')?.textContent ?? null,
      description: describedBy.map((id) => document.getElementById(id)?.textContent ?? '').join(' '),
    };
  })); // End of the in-page destination probe
} // End of function readDestinations()

/**
 * Reads the destination pane's structure: the "Silence" heading, listbox
 * remnants, the empty / no-results state and the search field.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The pane's state.
 */
function readDestinationPane(page) {
  return page.evaluate(() => ({
    silenceTitle: document.querySelector('#destinationList .destination-silence .destination-section-title')?.textContent ?? null,
    silenceLabelledBy: document.querySelector('#destinationList .destination-silence')?.getAttribute('aria-labelledby') ?? null,
    listboxes: document.querySelectorAll('#destinationList [role="listbox"], #destinationList [role="option"]').length,
    emptyText: document.querySelector('#destinationList .empty-state p')?.textContent ?? null,
    clearSearch: document.getElementById('clearDestinationSearchBtn')?.textContent ?? null,
    search: document.getElementById('destinationSearch')?.value ?? null,
    activeId: document.activeElement?.id || '',
  }));
} // End of function readDestinationPane()

/**
 * Reads the move preview and the move button: the aria-live status line,
 * the destination line, the notes, the networks diff rows (label and value
 * per kind) and the button's label and state.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The preview.
 */
function readPreview(page) {
  return page.evaluate(() => {
    const preview = document.getElementById('movePreview');
    const diff = {};
    for (const row of preview.querySelectorAll('.move-diff-row')) {
      const kind = ['gained', 'lost', 'unchanged'].find((name) => row.classList.contains(`is-${name}`));
      diff[kind] = { label: row.querySelector('dt')?.textContent ?? '', value: row.querySelector('dd')?.textContent ?? '' };
    }
    const button = document.getElementById('moveBtn');
    return {
      status: document.getElementById('moveStatus')?.textContent ?? '',
      live: document.getElementById('moveStatus')?.getAttribute('aria-live') ?? null,
      destination: preview.querySelector('.move-destination')?.textContent ?? null,
      hiddenNote: preview.querySelector('.move-hidden-note')?.textContent ?? null,
      unknownNote: preview.querySelector('.move-unknown-note')?.textContent ?? null,
      warning: preview.querySelector('.move-warning')?.textContent ?? null,
      diff: Object.keys(diff).length > 0 ? diff : null,
      button: button?.textContent ?? '',
      disabled: button?.disabled ?? null,
    };
  }); // End of the in-page preview probe
} // End of function readPreview()

/**
 * Reads the move dialog: its dialog attributes, title, summary, review rows
 * (label, value, details and warnings by data-row), per-AP results, notes,
 * visible buttons (text, or null when hidden) and the focused element.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The dialog's content.
 */
function readMoveModal(page) {
  return page.evaluate(() => {
    const modal = document.getElementById('moveModal');
    /**
     * A footer button's text while it is shown, else null.
     * @param {string} id - The button id.
     * @returns {string | null} The text or null.
     */
    const shown = (id) => {
      const button = document.getElementById(id);
      return button && !button.hidden ? button.textContent : null;
    };
    const rows = {};
    for (const row of document.querySelectorAll('#moveReview .move-review-row')) {
      rows[row.dataset.row] = {
        label: row.querySelector('dt')?.textContent ?? '',
        value: row.querySelector('.move-review-value')?.textContent ?? null,
        details: Array.from(row.querySelectorAll('.move-review-detail')).map((element) => element.textContent),
        warnings: Array.from(row.querySelectorAll('.move-review-detail.is-warning')).map((element) => element.textContent),
      };
    }
    const active = document.activeElement;
    return {
      open: Boolean(modal?.classList.contains('visible')),
      role: modal?.getAttribute('role') ?? null,
      ariaModal: modal?.getAttribute('aria-modal') ?? null,
      labelledBy: modal?.getAttribute('aria-labelledby') ?? null,
      describedBy: modal?.getAttribute('aria-describedby') ?? null,
      title: document.getElementById('moveModalHeading')?.textContent ?? '',
      summary: document.getElementById('moveModalSummary')?.textContent ?? '',
      rows,
      results: Array.from(document.querySelectorAll('#moveResults .move-result')).map((item) => ({
        mac: item.dataset.mac,
        ok: item.classList.contains('is-ok'),
        status: item.querySelector('.move-result-status')?.textContent ?? '',
        name: item.querySelector('.move-result-name')?.textContent ?? '',
        macText: item.querySelector('.move-result-mac')?.textContent ?? '',
        error: item.querySelector('.move-result-error')?.textContent ?? null,
      })),
      notes: Array.from(document.querySelectorAll('#moveNotes .move-note')).map((element) => element.textContent),
      buttons: { cancel: shown('cancelMoveBtn'), confirm: shown('confirmMoveBtn'), retry: shown('retryFailedBtn'), close: shown('closeMoveBtn') },
      activeId: active?.id || '',
      activeVisible: active instanceof HTMLElement && getComputedStyle(active).visibility === 'visible',
      inert: document.querySelector('.app-container')?.hasAttribute('inert'),
    };
  }); // End of the in-page move dialog probe
} // End of function readMoveModal()

/**
 * Reads the status bar, buttons, list placeholders, the destination pane's
 * labels, the move button and which modals are open.
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
    host: document.getElementById('controllerHost')?.hidden ? null : document.getElementById('controllerHost')?.textContent ?? null,
    site: document.getElementById('siteName')?.hidden ? null : document.getElementById('siteName')?.textContent ?? null,
    move: document.getElementById('moveBtn')?.textContent || '',
    moveDisabled: document.getElementById('moveBtn')?.disabled,
    moveStatus: document.getElementById('moveStatus')?.textContent ?? '',
    apEmpty: document.querySelector('#apList .empty-state p')?.textContent ?? null,
    destinationEmpty: document.querySelector('#destinationList .empty-state p')?.textContent ?? null,
    destinationTitle: document.getElementById('destinationPanelTitle')?.textContent ?? null,
    destinationListLabel: document.getElementById('destinationList')?.getAttribute('aria-label') ?? null,
    inert: document.querySelector('.app-container')?.hasAttribute('inert'),
    activeId: document.activeElement?.id || '',
    settingsOpen: document.getElementById('settingsModal')?.classList.contains('visible'),
    moveOpen: document.getElementById('moveModal')?.classList.contains('visible'),
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
  await page.waitForFunction((expected) => document.querySelectorAll('#apList .ap-row').length === expected, count, { timeout: WAIT_MS });
}

/**
 * Waits until the header shows the connected state for the fake controller:
 * the green indicator and the controller host (the status text itself reads
 * "Conectado"/"Connected").
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<void>}
 */
async function waitForConnected(page) {
  await page.waitForFunction((host) =>
    document.getElementById('statusIndicator')?.classList.contains('connected') &&
    document.getElementById('controllerHost')?.textContent === host,
  CONTROLLER_HOST, { timeout: WAIT_MS });
}

/**
 * Waits until no data load is in flight (Refresh button no longer spinning).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<void>}
 */
async function waitForLoadIdle(page) {
  await page.waitForFunction(() => !document.getElementById('refreshBtn').classList.contains('spinning'), null, { timeout: WAIT_MS });
}

/**
 * Substitutes the `{name}` placeholders of a TEXT template.
 * @param {string} template - The template.
 * @param {Record<string, string | number>} vars - Placeholder values.
 * @returns {string} The formatted text.
 */
function fmt(template, vars) {
  return Object.entries(vars).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template);
}

/**
 * The selection summary the Access points list must show.
 * @param {'es' | 'en'} language - UI language.
 * @param {number} selected - Selected APs.
 * @param {number} hidden - Selected APs the filters hide.
 * @returns {string} E.g. "3 seleccionados (1 oculto por los filtros)".
 */
function expectedSummary(language, selected, hidden) {
  const text = TEXT[language];
  let summary = selected === 0 ? text.selNone : selected === 1 ? text.selOne : fmt(text.selMany, { count: selected });
  if (hidden > 0) {
    summary += ` (${hidden === 1 ? text.hiddenOne : fmt(text.hiddenMany, { count: hidden })})`;
  }
  return summary;
}

/**
 * Reads the Access points list's selection controls and summary.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<{ summary: string; live: string | null; selectAll: string; selectAllHidden: boolean; toolbarHidden: boolean; checked: string[]; activeMac: string | null }>}
 */
function readSelection(page) {
  return page.evaluate(() => ({
    summary: document.getElementById('apSelectionSummary')?.textContent ?? '',
    live: document.getElementById('apSelectionSummary')?.getAttribute('aria-live') ?? null,
    selectAll: document.getElementById('selectAllApsBtn')?.textContent ?? '',
    selectAllHidden: Boolean(document.getElementById('selectAllApsBtn')?.hidden),
    toolbarHidden: Boolean(document.getElementById('apSelectionToolbar')?.hidden),
    checked: Array.from(document.querySelectorAll('#apList .ap-checkbox')).filter((box) => box.checked).map((box) => box.dataset.mac),
    activeMac: document.activeElement?.classList.contains('ap-checkbox') ? document.activeElement.dataset.mac : null,
  }));
} // End of function readSelection()

/**
 * Reads the sidebar and the views: per entry its element, label, count and
 * aria-current, plus which view is shown.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The sidebar state.
 */
function readNav(page) {
  return page.evaluate(() => {
    /**
     * Reads one sidebar entry.
     * @param {string} id - The sidebar button id.
     * @returns {object} Its element, type, label, count and aria-current.
     */
    const entry = (id) => {
      const button = document.getElementById(id);
      const count = button?.querySelector('.nav-count');
      return {
        tag: button?.tagName.toLowerCase() ?? null,
        type: button?.getAttribute('type') ?? null,
        label: button?.querySelector('.nav-label')?.textContent ?? null,
        count: count && !count.hidden ? count.textContent : null,
        current: button?.getAttribute('aria-current') ?? null,
      };
    };
    return {
      accessPoints: entry('navAccessPoints'),
      groups: entry('navGroups'),
      networks: entry('navNetworks'),
      shown: ['viewAccessPoints', 'viewGroups', 'viewNetworks'].filter((id) => !document.getElementById(id)?.hidden),
      navLabel: document.getElementById('viewNav')?.getAttribute('aria-label') ?? null,
      groupsTitle: document.getElementById('viewGroupsTitle')?.textContent ?? null,
      groupsText: document.getElementById('viewGroupsText')?.textContent ?? null,
      networksTitle: document.getElementById('viewNetworksTitle')?.textContent ?? null,
      networksText: document.getElementById('viewNetworksText')?.textContent ?? null,
    };
  }); // End of the in-page sidebar probe
} // End of function readNav()

/**
 * Reads the header details: status, host, site, "Updated hh:mm" (and whether
 * its text matches the hh:mm rendering of its data-updated-at timestamp in
 * the page language), and the controller version.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The header state.
 */
function readHeader(page) {
  return page.evaluate(() => {
    /**
     * Returns an element's text while it is shown, else null.
     * @param {string} id - The element id.
     * @returns {string | null} The text, or null when hidden or absent.
     */
    const visibleText = (id) => {
      const element = document.getElementById(id);
      return element && !element.hidden ? element.textContent : null;
    };
    const updated = document.getElementById('lastUpdated');
    const updatedAt = updated?.dataset.updatedAt ? Number(updated.dataset.updatedAt) : null;
    const time = updatedAt === null ? null : new Intl.DateTimeFormat(document.documentElement.lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(updatedAt));
    return {
      status: document.getElementById('statusText')?.textContent ?? '',
      indicator: document.getElementById('statusIndicator')?.className ?? '',
      host: visibleText('controllerHost'),
      site: visibleText('siteName'),
      updated: visibleText('lastUpdated'),
      updatedAt,
      time,
      version: visibleText('controllerVersion'),
    };
  }); // End of the in-page header probe
} // End of function readHeader()

// ============================================================================
// Expected values derived from the fixtures
// ============================================================================

/**
 * The sidebar's total counts for a data set: valid APs, valid groups (empty
 * ones included) and distinct SSID names across the valid groups.
 * @param {object[]} accessPoints - AccessPoint DTOs served by the stub.
 * @param {object[]} wlanGroups - WlanGroup DTOs served by the stub.
 * @returns {{ aps: string; groups: string; networks: string }} The counts as rendered.
 */
function expectedNavCounts(accessPoints, wlanGroups) {
  const groups = wlanGroups.filter((group) => WLAN_ID_REGEX.test(group.wlanId));
  const ssids = new Set(groups.flatMap((group) => group.ssidList.map((ssid) => ssid.ssidName)));
  return {
    aps: String(accessPoints.filter((ap) => MAC_REGEX.test(ap.mac)).length),
    groups: String(groups.length),
    networks: String(ssids.size),
  };
} // End of function expectedNavCounts()

/**
 * The AP rows the renderer must show for a set of AP DTOs: malformed MACs
 * dropped, sorted by name like the main process, labels per language, the
 * group label of the controller's group model ("AP group:" / "WLAN:"), and
 * the counts: networks of the AP's group (from the listing; omitted when the
 * group is unknown) and clients (only a non-negative integer clientNum).
 * @param {object[]} accessPoints - AccessPoint DTOs served by the stub.
 * @param {'es' | 'en'} language - UI language.
 * @param {'apGroup' | 'wlanGroup'} groupModel - The controller's group model.
 * @param {object[]} wlanGroups - The group listing served with the APs.
 * @returns {Array<{ name: string; group: string; counts: string; statusClass: string; statusLabel: string }>}
 */
function expectedApRows(accessPoints, language, groupModel, wlanGroups) {
  const text = TEXT[language];
  const groupsByName = new Map();
  for (const group of wlanGroups.filter((candidate) => WLAN_ID_REGEX.test(candidate.wlanId))) {
    if (!groupsByName.has(group.wlanName)) groupsByName.set(group.wlanName, group);
  }
  return accessPoints
    .filter((ap) => MAC_REGEX.test(ap.mac))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((ap) => {
      const parts = [];
      const group = ap.wlanGroup ? groupsByName.get(ap.wlanGroup) : undefined;
      if (group) {
        const networks = group.ssidList.length;
        parts.push(networks === 0 ? text.networksNone : networks === 1 ? text.networksOne : fmt(text.networksMany, { count: networks }));
      }
      if (Number.isSafeInteger(ap.clientNum) && ap.clientNum >= 0) {
        parts.push(ap.clientNum === 1 ? text.clientsOne : fmt(text.clientsMany, { count: ap.clientNum }));
      }
      return {
        name: ap.name,
        group: `${text.groupLabel[groupModel]}: ${ap.wlanGroup || text.unassigned}`,
        counts: parts.length > 0 ? ` · ${parts.join(' · ')}` : '',
        statusClass: STATUS_CLASSES[ap.statusCategory] ?? 'unknown',
        statusLabel: text.status[ap.statusCategory] ?? text.statusUnknown,
      };
    }); // End of the expected-row mapping
} // End of function expectedApRows()

/**
 * The destination options the pane must show: malformed ids dropped, sorted
 * by name, the groups with networks first ("N networks · a, b, c +N more"),
 * then the empty ones in the "Silence" section with the strong label.
 * @param {object[]} wlanGroups - WlanGroup DTOs served by the stub.
 * @param {'es' | 'en'} language - UI language.
 * @returns {Array<{ name: string; detail: string; section: string }>}
 */
function expectedDestinations(wlanGroups, language) {
  const text = TEXT[language];
  const groups = wlanGroups
    .filter((group) => WLAN_ID_REGEX.test(group.wlanId))
    .sort((a, b) => a.wlanName.localeCompare(b.wlanName));
  /**
   * One option's expected details.
   * @param {object} group - The group.
   * @returns {string} The details text.
   */
  const detail = (group) => {
    const names = [...new Set(group.ssidList.map((ssid) => ssid.ssidName))];
    if (names.length === 0) return text.emptyGroup;
    const count = names.length === 1 ? text.networksOne : fmt(text.networksMany, { count: names.length });
    const shown = names.slice(0, 3).join(', ');
    return `${count} · ${names.length > 3 ? `${shown} +${names.length - 3} ${text.more}` : shown}`;
  };
  return [
    ...groups.filter((group) => group.ssidList.length > 0).map((group) => ({ name: group.wlanName, detail: detail(group), section: 'networks' })),
    ...groups.filter((group) => group.ssidList.length === 0).map((group) => ({ name: group.wlanName, detail: detail(group), section: 'silence' })),
  ];
} // End of function expectedDestinations()

/**
 * Compares rendered AP items with the expected rows.
 * @param {object[]} items - Items read by readApItems().
 * @param {object[]} expected - Rows from expectedApRows().
 * @returns {{ ok: boolean; detail: unknown }} The verdict.
 */
function compareApRows(items, expected) {
  const actual = items.map(({ name, group, counts, statusClass, statusLabel }) => ({ name, group, counts, statusClass, statusLabel }));
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

/**
 * Checks the app shell right after a connection: the sidebar (native
 * buttons, labels, TOTAL counts — APs, groups including empty ones, distinct
 * network names — and the current view) and the header (connected state,
 * host, site, "Updated hh:mm", controller version).
 * @param {object} session - The launch.
 * @param {'es' | 'en'} language - UI language.
 * @param {{ aps: object[]; groups: object[]; version: string; groupModel: 'apGroup' | 'wlanGroup'; site: string | null }} expected - What was served.
 * @returns {Promise<void>}
 */
async function checkShellAfterConnect(session, language, expected) {
  const { page, label } = session;
  const text = TEXT[language];
  const counts = expectedNavCounts(expected.aps, expected.groups);
  const groupsLabel = text.groupsTitle[expected.groupModel];

  await check(`[${label}] sidebar: native buttons "${text.accessPoints} ${counts.aps}", "${groupsLabel} ${counts.groups}", "${text.wifiNetworks} ${counts.networks}" (totals: APs, groups incl. empty, distinct networks); ${text.accessPoints} is the current view`, async () => {
    const nav = await readNav(page);
    const entries = [nav.accessPoints, nav.groups, nav.networks];
    return verdict(
      entries.every((entry) => entry.tag === 'button' && entry.type === 'button') &&
      nav.accessPoints.label === text.accessPoints && nav.accessPoints.count === counts.aps && nav.accessPoints.current === 'page' &&
      nav.groups.label === groupsLabel && nav.groups.count === counts.groups && nav.groups.current === null &&
      nav.networks.label === text.wifiNetworks && nav.networks.count === counts.networks && nav.networks.current === null &&
      isDeepStrictEqual(nav.shown, ['viewAccessPoints']),
      { nav, counts }
    );
  }); // End of check "[label] sidebar..."

  const siteText = expected.site === null ? null : fmt(text.site, { site: expected.site });
  await check(`[${label}] header: "${text.connected}" with the green indicator, the controller host, ${siteText === null ? 'no site name (none reported)' : `"${siteText}"`}, "${fmt(text.updated, { time: 'hh:mm' })}" and "${fmt(text.version, { version: expected.version })}"`, async () => {
    const header = await readHeader(page);
    return verdict(
      header.status === text.connected && header.indicator.split(' ').includes('connected') && header.host === CONTROLLER_HOST &&
      header.site === siteText && header.updatedAt !== null && /^\d{2}:\d{2}$/.test(header.time || '') &&
      header.updated === fmt(text.updated, { time: header.time }) && header.version === fmt(text.version, { version: expected.version }),
      header
    );
  }); // End of check "[label] header..."
} // End of function checkShellAfterConnect()

/**
 * Checks a destination group in the pane (a click on its option's label).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} wlanId - The group id.
 * @returns {Promise<void>}
 */
async function pickDestination(page, wlanId) {
  await page.click(`#destinationList .destination-option[data-wlan-id="${wlanId}"]`);
}

/**
 * Waits until the move dialog shows its review phase with focus on Cancel.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<void>}
 */
async function waitForReview(page) {
  await page.waitForSelector('#moveModal.visible', { timeout: WAIT_MS });
  await page.waitForFunction(() => document.activeElement?.id === 'cancelMoveBtn' && !document.getElementById('confirmMoveBtn').hidden, null, { timeout: WAIT_MS });
}

/**
 * Clicks the move button and waits for the review.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<void>}
 */
async function openReview(page) {
  await page.click('#moveBtn');
  await waitForReview(page);
}

/**
 * Waits until the move dialog shows the per-AP results (after the run and
 * the reload) with focus on Close.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<void>}
 */
async function waitForResults(page) {
  await page.waitForFunction(() =>
    document.getElementById('moveModal').classList.contains('visible') &&
    !document.getElementById('closeMoveBtn').hidden && document.activeElement?.id === 'closeMoveBtn',
  null, { timeout: WAIT_MS });
}

/**
 * Waits until the move dialog is closed.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<void>}
 */
async function waitForMoveDialogClosed(page) {
  await page.waitForFunction(() => !document.getElementById('moveModal').classList.contains('visible'), null, { timeout: WAIT_MS });
}

/**
 * Closes the results with Close and waits until no load is in flight.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<void>}
 */
async function closeResults(page) {
  await page.click('#closeMoveBtn');
  await waitForMoveDialogClosed(page);
  await waitForLoadIdle(page);
}

/**
 * Spanish launch, Access points list selection: checkbox clicks, Shift-click
 * and Shift+Arrow ranges, Space, Clear selection, the selection surviving
 * the search/status/group filters ("N seleccionados (M ocultos por los
 * filtros)"), "Select all N filtered APs", the no-results state with
 * "Borrar filtros", and a Shift-click re-anchoring after a filter hid the
 * anchor (ends with no filter). Expects the fixture APs in their post-move groups:
 * Altillo zGrupo B, Bodega none, EAP Carpio zNinguna, Garaje Default, Jardín
 * zNinguna, Porche Default, Salón Default; nothing selected.
 * @param {object} session - The Spanish launch.
 * @returns {Promise<void>}
 */
async function runSelectionChecks(session) {
  const { page } = session;
  const es = TEXT.es;
  /**
   * Selector of a fixture AP's checkbox.
   * @param {string} name - AP name.
   * @returns {string} The CSS selector.
   */
  const box = (name) => `#apList .ap-checkbox[data-mac="${AP[name].mac}"]`;
  /**
   * MACs of fixture APs.
   * @param {string[]} names - AP names.
   * @returns {string[]} Their MACs, in the same order.
   */
  const macs = (names) => names.map((name) => AP[name].mac);

  await check('[es] checkbox selection: clicking a checkbox checks it, the aria-live summary goes from "Ningún AP seleccionado" to "1 seleccionado"; the destination pane asks for a group ("Mover AP" disabled)', async () => {
    const initial = await readSelection(page);
    await page.click(box('Altillo'));
    const selection = await readSelection(page);
    const preview = await readPreview(page);
    return verdict(
      initial.summary === expectedSummary('es', 0, 0) && initial.toolbarHidden === false && initial.selectAll === fmt(es.selectAll, { count: 7 }) &&
      selection.live === 'polite' && selection.summary === expectedSummary('es', 1, 0) &&
      isDeepStrictEqual(selection.checked, macs(['Altillo'])) && selection.activeMac === AP.Altillo.mac &&
      preview.status === es.selectGroup.apGroup && preview.live === 'polite' && preview.button === es.moveOne && preview.disabled === true,
      { initial, selection, preview }
    );
  }); // End of check "[es] checkbox selection..."

  await check('[es] Shift-click range: Shift-clicking Garaje\'s checkbox selects Altillo through Garaje; the move button says "Mover 4 AP"', async () => {
    await page.click(box('Garaje'), { modifiers: ['Shift'] });
    const selection = await readSelection(page);
    const preview = await readPreview(page);
    return verdict(
      isDeepStrictEqual(selection.checked, macs(['Altillo', 'Bodega', 'EAP Carpio', 'Garaje'])) &&
      selection.summary === expectedSummary('es', 4, 0) && preview.button === fmt(es.moveMany, { count: 4 }),
      { selection, preview }
    );
  }); // End of check "[es] Shift-click range..."

  await check('[es] keyboard selection: "Borrar selección" empties it; Space toggles the focused checkbox; ArrowDown only moves focus; Shift+ArrowDown extends the range from the anchor', async () => {
    await page.click('#clearApSelectionBtn');
    const cleared = await readSelection(page);
    await page.focus(box('Bodega'));
    await page.keyboard.press('Space');
    const afterSpace = await readSelection(page);
    await page.keyboard.press('ArrowDown');
    const afterArrow = await readSelection(page);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    const afterShift = await readSelection(page);
    return verdict(
      cleared.summary === expectedSummary('es', 0, 0) && cleared.checked.length === 0 &&
      isDeepStrictEqual(afterSpace.checked, macs(['Bodega'])) && afterSpace.activeMac === AP.Bodega.mac &&
      isDeepStrictEqual(afterArrow.checked, macs(['Bodega'])) && afterArrow.activeMac === AP['EAP Carpio'].mac &&
      isDeepStrictEqual(afterShift.checked, macs(['Bodega', 'EAP Carpio', 'Garaje', 'Jardín'])) &&
      afterShift.activeMac === AP['Jardín'].mac && afterShift.summary === expectedSummary('es', 4, 0),
      { cleared, afterSpace, afterArrow, afterShift }
    );
  }); // End of check "[es] keyboard selection..."

  await check('[es] the selection survives filtering: group filter zNinguna -> "3 seleccionados (1 oculto por los filtros)"; the search and the status filter hide more and the count follows', async () => {
    await page.click(box('Bodega'));
    await page.selectOption('#apGroupFilter', GROUP.zNinguna.wlanId);
    const byGroup = await readSelection(page);
    const rowsByGroup = (await readApItems(page)).map((item) => item.name);
    await page.fill('#apFilter', 'jar');
    const bySearch = await readSelection(page);
    await page.fill('#apFilter', '');
    await page.selectOption('#apStatusFilter', '4');
    const byStatus = await readSelection(page);
    const rowsByStatus = (await readApItems(page)).map((item) => item.name);
    await page.selectOption('#apStatusFilter', 'all');
    return verdict(
      isDeepStrictEqual(rowsByGroup, ['EAP Carpio', 'Jardín']) && isDeepStrictEqual(byGroup.checked, macs(['EAP Carpio', 'Jardín'])) &&
      byGroup.summary === '3 seleccionados (1 oculto por los filtros)' && byGroup.summary === expectedSummary('es', 3, 1) &&
      byGroup.live === 'polite' && bySearch.summary === expectedSummary('es', 3, 2) &&
      isDeepStrictEqual(rowsByStatus, ['Jardín']) && byStatus.summary === expectedSummary('es', 3, 2),
      { rowsByGroup, byGroup, bySearch, rowsByStatus, byStatus }
    );
  }); // End of check "[es] the selection survives filtering..."

  await check('[es] "Seleccionar los 3 AP filtrados" (group filter Default) adds the visible APs and keeps the hidden ones: "5 seleccionados (2 ocultos por los filtros)"', async () => {
    await page.selectOption('#apGroupFilter', GROUP.Default.wlanId);
    const before = await readSelection(page);
    await page.click('#selectAllApsBtn');
    const after = await readSelection(page);
    const preview = await readPreview(page);
    return verdict(
      before.selectAll === fmt(es.selectAllFiltered, { count: 3 }) && before.summary === expectedSummary('es', 3, 2) &&
      isDeepStrictEqual(after.checked, macs(['Garaje', 'Porche', 'Salón'])) && after.summary === expectedSummary('es', 5, 2) &&
      preview.button === fmt(es.moveMany, { count: 5 }),
      { before, after, preview }
    );
  }); // End of check "[es] Seleccionar los 3 AP filtrados..."

  await check('[es] no results: a search matching nothing says "Ningún punto de acceso coincide con los filtros"; "Borrar filtros" restores every row and filter, the selection stays', async () => {
    await page.fill('#apFilter', 'zzz');
    const empty = await page.evaluate(() => ({
      text: document.querySelector('#apList .empty-state p')?.textContent ?? null,
      button: document.getElementById('clearApFiltersBtn')?.textContent ?? null,
    }));
    const during = await readSelection(page);
    await page.click('#clearApFiltersBtn');
    const filters = await page.evaluate(() => ({
      text: document.getElementById('apFilter').value,
      status: document.getElementById('apStatusFilter').value,
      group: document.getElementById('apGroupFilter').value,
      focus: document.activeElement?.id,
    }));
    const after = await readSelection(page);
    const rows = (await readApItems(page)).length;
    return verdict(
      empty.text === es.noMatching && empty.button === es.clearFilters && during.selectAllHidden === true &&
      during.summary === expectedSummary('es', 5, 5) && filters.text === '' && filters.status === 'all' && filters.group === '' &&
      filters.focus === 'apFilter' && rows === 7 && after.summary === expectedSummary('es', 5, 0) && after.checked.length === 5,
      { empty, during, filters, after, rows }
    );
  }); // End of check "[es] no results..."

  await check('[es] Shift-click after a filter hid the anchor: the clicked AP toggles alone and becomes the new anchor, so the next Shift-click selects the range from it (Garaje through Salón)', async () => {
    await page.click('#clearApSelectionBtn');
    await page.click(box('Bodega'));
    await page.selectOption('#apGroupFilter', GROUP.Default.wlanId);
    const rows = (await readApItems(page)).map((item) => item.name);
    await page.click(box('Garaje'), { modifiers: ['Shift'] });
    const reanchored = await readSelection(page);
    await page.click(box('Salón'), { modifiers: ['Shift'] });
    const range = await readSelection(page);
    await page.selectOption('#apGroupFilter', '');
    const unfiltered = await readSelection(page);
    return verdict(
      isDeepStrictEqual(rows, ['Garaje', 'Porche', 'Salón']) &&
      isDeepStrictEqual(reanchored.checked, macs(['Garaje'])) && reanchored.summary === expectedSummary('es', 2, 1) &&
      isDeepStrictEqual(range.checked, macs(['Garaje', 'Porche', 'Salón'])) && range.summary === expectedSummary('es', 4, 1) &&
      isDeepStrictEqual(unfiltered.checked, macs(['Bodega', 'Garaje', 'Porche', 'Salón'])) && unfiltered.summary === expectedSummary('es', 4, 0),
      { rows, reanchored, range, unfiltered }
    );
  }); // End of check "[es] Shift-click after a filter hid the anchor..."
} // End of function runSelectionChecks()

/**
 * Spanish launch, moves through the destination pane and the move dialog
 * (review -> one OMADA_SET_WLAN per AP -> per-AP results): a bulk move with
 * an AP hidden by the group filter (all succeed), a bulk cancel from the
 * review opened with Enter on a destination radio (no PATCH), the no-op and
 * mixed selections ("2 ya están en este grupo; 1 se moverá", only the third
 * AP PATCHed), the destination search by network name, a keyboard-only move,
 * a partial failure with per-AP results and "Reintentar los fallidos", the
 * retry contract after a reload that dropped a failed AP or the destination,
 * Enter on a focused radio other than the checked (search-hidden) one, and
 * two same-named groups (disabled radios with the reason). The stub's
 * scenario is restored after each reconfiguration. Runs after
 * runSelectionChecks(); expects Altillo zGrupo B, Bodega none, EAP Carpio
 * zNinguna, Garaje Default, Jardín zNinguna, Porche Default, Salón Default,
 * and no destination checked.
 * @param {object} session - The Spanish launch.
 * @returns {Promise<void>}
 */
async function runBulkMoveChecks(session) {
  const { page } = session;
  const es = TEXT.es;
  /**
   * Selector of a fixture AP's checkbox.
   * @param {string} name - AP name.
   * @returns {string} The CSS selector.
   */
  const box = (name) => `#apList .ap-checkbox[data-mac="${AP[name].mac}"]`;
  /**
   * Every OMADA_SET_WLAN call the stub received so far.
   * @returns {Promise<Array<{ args: unknown[] }>>} The calls, in order.
   */
  const setCalls = async () => callsTo(await stubState(session), 'omada:set-wlan');
  /**
   * The group text of an AP row in the 6.3 vocabulary.
   * @param {string} name - Group name.
   * @returns {string} E.g. "Grupo de AP: Default".
   */
  const groupText = (name) => `${es.groupLabel.apGroup}: ${name}`;
  /**
   * A network annotated with how many of the moving APs it applies to.
   * @param {string} name - Network name.
   * @param {number} count - APs it applies to.
   * @param {number} total - Moving APs with a known group.
   * @returns {string} E.g. "Casa (1 de 2)".
   */
  const partial = (name, count, total) => fmt(es.partialNetwork, { name, count, total });

  await check('[es] bulk move with an AP hidden by the group filter: Altillo (zGrupo B) + Garaje (Default) -> Exterior (Silenciar); the preview says "Incluye 1 AP oculto por los filtros", the per-AP losses ("Oficina (1 de 2)") and the silence label; the review lists both sources, both APs and their clients', async () => {
    await page.click('#clearApSelectionBtn');
    await page.click(box('Altillo'));
    await page.click(box('Garaje'));
    await page.selectOption('#apGroupFilter', GROUP['zGrupo B'].wlanId);
    const rows = (await readApItems(page)).map((item) => item.name);
    await pickDestination(page, GROUP.Exterior.wlanId);
    const preview = await readPreview(page);
    await openReview(page);
    const modal = await readMoveModal(page);
    const lost = ['Oficina', 'Taller', 'Almacén', 'Tienda', 'IoT', 'Casa', 'Invitados'].map((name) => partial(name, 1, 2)).join(', ');
    return verdict(
      isDeepStrictEqual(rows, ['Altillo']) && preview.status === fmt(es.willMoveMany, { count: 2 }) &&
      preview.hiddenNote === es.hiddenNoteOne && preview.warning === es.emptyGroup && preview.unknownNote === null &&
      isDeepStrictEqual(preview.diff, {
        gained: { label: es.gains, value: es.none },
        lost: { label: es.loses, value: `−7 · ${lost}` },
        unchanged: { label: es.unchanged, value: es.none },
      }) && preview.button === fmt(es.moveMany, { count: 2 }) && preview.disabled === false &&
      modal.summary === fmt(es.reviewMany, { count: 2, group: 'Exterior' }) &&
      modal.rows.from?.value === `zGrupo B (${es.apOne}) · Default (${es.apOne})` &&
      isDeepStrictEqual(modal.rows.to, { label: es.to, value: 'Exterior', details: [es.emptyGroup], warnings: [es.emptyGroup] }) &&
      isDeepStrictEqual(modal.rows.aps, { label: `${es.accessPoints} (${fmt(es.apMany, { count: 2 })})`, value: 'Altillo, Garaje', details: [es.hiddenNoteOne], warnings: [] }) &&
      modal.rows.clients?.value === `${fmt(es.clientsMany, { count: 0 })} ${es.clientsMissingOne}` &&
      modal.buttons.confirm === fmt(es.moveMany, { count: 2 }) && modal.activeId === 'cancelMoveBtn',
      { rows, preview, modal }
    );
  }); // End of check "[es] bulk move with an AP hidden by the group filter..."

  await check('[es] that bulk move -> confirm: one OMADA_SET_WLAN per AP in list order (the hidden one included), then "Se movieron los 2 AP a "Exterior"." with two "Movido" rows and no "Reintentar"; after Close the selection is empty and both APs are in Exterior', async () => {
    const before = (await setCalls()).length;
    await page.click('#confirmMoveBtn');
    await waitForResults(page);
    const modal = await readMoveModal(page);
    const sets = (await setCalls()).slice(before);
    await closeResults(page);
    const selection = await readSelection(page);
    const preview = await readPreview(page);
    await page.click('#clearApFiltersBtn');
    const rows = await readApItems(page);
    /**
     * Group text of a row by AP name.
     * @param {string} name - AP name.
     * @returns {string | undefined} The row's group text.
     */
    const groupOf = (name) => rows.find((row) => row.name === name)?.group;
    return verdict(
      isDeepStrictEqual(sets.map((call) => call.args), [[AP.Altillo.mac, GROUP.Exterior.wlanId], [AP.Garaje.mac, GROUP.Exterior.wlanId]]) &&
      modal.title === es.resultsTitle && modal.summary === fmt(es.resultsAllMany, { count: 2, group: 'Exterior' }) &&
      isDeepStrictEqual(modal.results.map((row) => [row.name, row.macText, row.ok, row.status, row.error]), [
        ['Altillo', AP.Altillo.mac, true, es.resultOk, null], ['Garaje', AP.Garaje.mac, true, es.resultOk, null],
      ]) &&
      isDeepStrictEqual(modal.buttons, { cancel: null, confirm: null, retry: null, close: es.close }) && isDeepStrictEqual(modal.notes, [es.notAtomic]) &&
      selection.summary === expectedSummary('es', 0, 0) && preview.status === es.moveNoSelection && preview.disabled === true &&
      groupOf('Altillo') === groupText('Exterior') && groupOf('Garaje') === groupText('Exterior'),
      { sets, modal, selection, preview, rows }
    );
  }); // End of check "[es] that bulk move -> confirm..."

  await check('[es] bulk cancel: Bodega + Jardín -> Exterior; Enter on the checked Exterior radio opens the review with Cancel focused, a second Enter cancels (no OMADA_SET_WLAN), focus returns to the radio, selection and destination stay', async () => {
    const before = (await setCalls()).length;
    await page.click(box('Bodega'));
    await page.click(box('Jardín'));
    await pickDestination(page, GROUP.Exterior.wlanId);
    await page.focus(`#destinationList .destination-radio[value="${GROUP.Exterior.wlanId}"]`);
    await page.keyboard.press('Enter');
    await waitForReview(page);
    const modal = await readMoveModal(page);
    await page.keyboard.press('Enter');
    await waitForMoveDialogClosed(page);
    await page.waitForFunction((id) => document.activeElement?.classList.contains('destination-radio') && document.activeElement.value === id,
      GROUP.Exterior.wlanId, { timeout: WAIT_MS });
    const sets = (await setCalls()).slice(before);
    const selection = await readSelection(page);
    const preview = await readPreview(page);
    const shell = await readShell(page);
    await page.click('#clearApSelectionBtn');
    return verdict(
      modal.summary === fmt(es.reviewMany, { count: 2, group: 'Exterior' }) && modal.rows.aps?.value === 'Bodega, Jardín' &&
      modal.activeId === 'cancelMoveBtn' && sets.length === 0 &&
      isDeepStrictEqual(selection.checked, [AP.Bodega.mac, AP['Jardín'].mac]) && preview.destination === fmt(es.moveDestination, { group: 'Exterior' }) &&
      preview.button === fmt(es.moveMany, { count: 2 }) && preview.disabled === false && shell.moveOpen === false && shell.inert === false,
      { modal, sets, selection, preview, shell }
    );
  }); // End of check "[es] bulk cancel..."

  await check('[es] no-op move: Altillo + Garaje are both in Exterior already -> "Los 2 AP seleccionados ya están en este grupo", no networks diff, the move button disabled', async () => {
    await page.click(box('Altillo'));
    await page.click(box('Garaje'));
    const preview = await readPreview(page);
    return verdict(
      preview.status === fmt(es.allAlreadyMany, { count: 2 }) && preview.disabled === true && preview.button === es.moveNone &&
      preview.diff === null && preview.destination === fmt(es.moveDestination, { group: 'Exterior' }),
      preview
    );
  }); // End of check "[es] no-op move..."

  await check('[es] mixed selection: adding Salón says "2 ya están en este grupo; 1 se moverá"; the review says the 2 are skipped, and the move PATCHes only Salón', async () => {
    const before = (await setCalls()).length;
    await page.click(box('Salón'));
    const preview = await readPreview(page);
    await openReview(page);
    const modal = await readMoveModal(page);
    await page.click('#confirmMoveBtn');
    await waitForResults(page);
    const results = await readMoveModal(page);
    await closeResults(page);
    const sets = (await setCalls()).slice(before);
    const selection = await readSelection(page);
    return verdict(
      preview.status === `${fmt(es.alreadyMany, { count: 2 })}; ${es.willMoveOne}` && preview.button === es.moveOne && preview.disabled === false &&
      modal.summary === fmt(es.reviewOne, { ap: 'Salón', group: 'Exterior' }) &&
      isDeepStrictEqual(modal.rows.aps, { label: `${es.accessPoints} (${es.apOne})`, value: 'Salón', details: [fmt(es.skippedMany, { count: 2 })], warnings: [] }) &&
      modal.rows.clients?.value === fmt(es.clientsMany, { count: 12 }) &&
      sets.length === 1 && isDeepStrictEqual(sets[0].args, [AP['Salón'].mac, GROUP.Exterior.wlanId]) &&
      results.summary === fmt(es.resultsAllOne, { group: 'Exterior' }) && isDeepStrictEqual(results.results.map((row) => row.mac), [AP['Salón'].mac]) &&
      selection.summary === expectedSummary('es', 0, 0),
      { preview, modal, sets, results, selection }
    );
  }); // End of check "[es] mixed selection..."

  await check('[es] destination search by network name: "taller" leaves only zGrupo B (its preview lists "Taller" first) and no Silence section; "NINGU" leaves only zNinguna under "Silenciar"; "zzz" says "Ningún grupo ni red coincide con "zzz"" with "Borrar búsqueda"; Escape clears a search', async () => {
    await page.fill('#destinationSearch', 'taller');
    const byNetwork = await readDestinations(page);
    const paneByNetwork = await readDestinationPane(page);
    await page.fill('#destinationSearch', 'NINGU');
    const bySilence = await readDestinations(page);
    const paneBySilence = await readDestinationPane(page);
    await page.fill('#destinationSearch', 'zzz');
    const none = await readDestinationPane(page);
    await page.click('#clearDestinationSearchBtn');
    const cleared = await readDestinations(page);
    const paneCleared = await readDestinationPane(page);
    await page.fill('#destinationSearch', 'casa');
    const byCasa = (await readDestinations(page)).map((item) => item.name);
    await page.keyboard.press('Escape');
    const afterEscape = await readDestinationPane(page);
    const all = (await readDestinations(page)).length;
    return verdict(
      isDeepStrictEqual(byNetwork.map((item) => [item.name, item.section, item.detail]), [
        ['zGrupo B', 'networks', `${fmt(es.networksMany, { count: 5 })} · Taller, Oficina, Almacén +2 ${es.more}`],
      ]) && paneByNetwork.silenceTitle === null &&
      isDeepStrictEqual(bySilence.map((item) => [item.name, item.section]), [['zNinguna', 'silence']]) && paneBySilence.silenceTitle === es.silence &&
      none.emptyText === fmt(es.noDestinationResults, { query: 'zzz' }) && none.clearSearch === es.clearSearch &&
      cleared.length === 4 && paneCleared.search === '' && paneCleared.activeId === 'destinationSearch' &&
      isDeepStrictEqual(byCasa, ['Default']) && afterEscape.search === '' && afterEscape.activeId === 'destinationSearch' && all === 4,
      { byNetwork, bySilence, none, cleared: cleared.length, paneCleared, byCasa, afterEscape, all }
    );
  }); // End of check "[es] destination search by network name..."

  await check('[es] keyboard-only move: Tab into the list, arrows to Porche, Space, Tab to the destination radios, ArrowDown to zGrupo B (the arrows check it), Tab to "Mover AP", Enter (Cancel has focus), Tab to the move button, Enter, then Enter on Close', async () => {
    const before = (await setCalls()).length;
    /**
     * Describes the focused element (id, AP checkbox MAC, destination radio value).
     * @returns {Promise<{ id: string; checkbox: boolean; mac: string | null; radio: string | null }>}
     */
    const active = () => page.evaluate(() => {
      const element = document.activeElement;
      return {
        id: element?.id || '',
        checkbox: Boolean(element?.classList.contains('ap-checkbox')),
        mac: element?.classList.contains('ap-checkbox') ? element.dataset.mac ?? null : null,
        radio: element?.classList.contains('destination-radio') ? element.value : null,
      };
    });
    /**
     * Presses a key until the focus satisfies a condition (bounded).
     * @param {string} key - Key to press.
     * @param {(focus: object) => boolean} done - Condition on active().
     * @param {number} [max] - Maximum presses.
     * @returns {Promise<boolean>} Whether the condition was reached.
     */
    const pressUntil = async (key, done, max = 12) => {
      for (let attempt = 0; attempt < max; attempt++) {
        if (done(await active())) return true;
        await page.keyboard.press(key);
      }
      return done(await active());
    };
    await page.focus('#apFilter');
    const reachedList = await pressUntil('Tab', (focus) => focus.checkbox);
    await page.keyboard.press('Home');
    const reachedAp = await pressUntil('ArrowDown', (focus) => focus.mac === AP.Porche.mac);
    await page.keyboard.press('Space');
    const checked = (await readSelection(page)).checked;
    const reachedRadios = await pressUntil('Tab', (focus) => focus.radio !== null);
    const reachedGroup = await pressUntil('ArrowDown', (focus) => focus.radio === MOVE_GROUP.wlanId);
    const radio = (await readDestinations(page)).find((item) => item.wlanId === MOVE_GROUP.wlanId)?.checked;
    const preview = await readPreview(page);
    const reachedMove = await pressUntil('Tab', (focus) => focus.id === 'moveBtn');
    await page.keyboard.press('Enter');
    await waitForReview(page);
    const modal = await readMoveModal(page);
    const reachedConfirm = await pressUntil('Tab', (focus) => focus.id === 'confirmMoveBtn', 3);
    const setsBeforeConfirm = (await setCalls()).length - before;
    await page.keyboard.press('Enter');
    await waitForResults(page);
    const results = await readMoveModal(page);
    await page.keyboard.press('Enter');
    await waitForMoveDialogClosed(page);
    await waitForLoadIdle(page);
    const sets = (await setCalls()).slice(before);
    const porche = (await readApItems(page)).find((row) => row.mac === AP.Porche.mac);
    const focusAfter = await active();
    return verdict(
      reachedList && reachedAp && isDeepStrictEqual(checked, [AP.Porche.mac]) && reachedRadios && reachedGroup && radio === true &&
      preview.destination === fmt(es.moveDestination, { group: MOVE_GROUP.wlanName }) && preview.button === es.moveOne && reachedMove &&
      modal.summary === fmt(es.reviewOne, { ap: 'Porche', group: MOVE_GROUP.wlanName }) && reachedConfirm && setsBeforeConfirm === 0 &&
      results.results.length === 1 && results.results[0].ok === true && sets.length === 1 &&
      isDeepStrictEqual(sets[0].args, [AP.Porche.mac, MOVE_GROUP.wlanId]) && porche?.group === groupText(MOVE_GROUP.wlanName) &&
      focusAfter.checkbox === true,
      { reachedList, reachedAp, checked, reachedRadios, reachedGroup, radio, preview, reachedMove, modal, reachedConfirm, setsBeforeConfirm, results, sets, porche, focusAfter }
    );
  }); // End of check "[es] keyboard-only move..."

  await check('[es] partial failure, preview and review: Bodega (no group), EAP Carpio + Jardín (zNinguna) and Porche (zGrupo B) -> Default: gains "Casa, Invitados", loses Porche\'s networks "(1 de 3)", the unknown networks of Bodega stated, "Mover 4 AP"; the review lists the three sources and the clients that are reported', async () => {
    await page.click(box('Bodega'));
    await page.click(box('EAP Carpio'));
    await page.click(box('Jardín'));
    await page.click(box('Porche'));
    await pickDestination(page, GROUP.Default.wlanId);
    const preview = await readPreview(page);
    await openReview(page);
    const modal = await readMoveModal(page);
    const lost = ['Oficina', 'Taller', 'Almacén', 'Tienda', 'IoT'].map((name) => partial(name, 1, 3)).join(', ');
    return verdict(
      preview.status === fmt(es.willMoveMany, { count: 4 }) && preview.button === fmt(es.moveMany, { count: 4 }) &&
      isDeepStrictEqual(preview.diff, {
        gained: { label: es.gains, value: '+2 · Casa, Invitados' },
        lost: { label: es.loses, value: `−5 · ${lost}` },
        unchanged: { label: es.unchanged, value: es.none },
      }) && preview.unknownNote === es.unknownOne && preview.warning === null && preview.hiddenNote === null &&
      modal.rows.from?.value === `${es.unassigned} (${es.apOne}) · zNinguna (${fmt(es.apMany, { count: 2 })}) · zGrupo B (${es.apOne})` &&
      modal.rows.aps?.value === 'Bodega, EAP Carpio, Jardín, Porche' &&
      isDeepStrictEqual(modal.rows.networks?.details, [
        `${es.gains}: +2 · Casa, Invitados`, `${es.loses}: −5 · ${lost}`, `${es.unchanged}: ${es.none}`, es.unknownOne,
      ]) &&
      modal.rows.clients?.value === `${fmt(es.clientsMany, { count: 4 })} ${fmt(es.clientsMissingMany, { count: 2 })}`,
      { preview, modal }
    );
  }); // End of check "[es] partial failure, preview and review..."

  await check('[es] partial failure -> confirm: 4 OMADA_SET_WLAN calls in list order; the results show Bodega failed ("El controlador no aceptó el cambio"), Jardín failed with the controller message, the other two moved; "Reintentar los fallidos" offered; the failed APs stay selected and the moved ones show Default', async () => {
    await configureStub(session, { setWlanFailMacs: [AP.Bodega.mac], setWlanErrors: { [AP['Jardín'].mac]: 'Device is busy' } });
    const before = (await setCalls()).length;
    await page.click('#confirmMoveBtn');
    await waitForResults(page);
    const modal = await readMoveModal(page);
    const sets = (await setCalls()).slice(before);
    const selection = await readSelection(page);
    const rows = await readApItems(page);
    /**
     * Group text of a row by AP name.
     * @param {string} name - AP name.
     * @returns {string | undefined} The row's group text.
     */
    const groupOf = (name) => rows.find((row) => row.name === name)?.group;
    return verdict(
      isDeepStrictEqual(sets.map((call) => call.args[0]), [AP.Bodega.mac, AP['EAP Carpio'].mac, AP['Jardín'].mac, AP.Porche.mac]) &&
      sets.every((call) => call.args[1] === GROUP.Default.wlanId) &&
      modal.summary === fmt(es.resultsPartial, { moved: 2, total: 4, group: 'Default' }) &&
      isDeepStrictEqual(modal.results.map((row) => [row.name, row.ok, row.status, row.error]), [
        ['Bodega', false, es.resultFailed, es.rejected],
        ['EAP Carpio', true, es.resultOk, null],
        ['Jardín', false, es.resultFailed, 'Device is busy'],
        ['Porche', true, es.resultOk, null],
      ]) &&
      isDeepStrictEqual(modal.buttons, { cancel: null, confirm: null, retry: es.retryFailed, close: es.close }) && modal.activeId === 'closeMoveBtn' &&
      isDeepStrictEqual(selection.checked, [AP.Bodega.mac, AP['Jardín'].mac]) &&
      groupOf('EAP Carpio') === groupText('Default') && groupOf('Porche') === groupText('Default') && groupOf('Jardín') === groupText('zNinguna'),
      { sets, modal, selection, rows }
    );
  }); // End of check "[es] partial failure -> confirm..."

  await check('[es] "Reintentar los fallidos" reruns only the failed APs through the same review (Cancel focused, "Se moverán 2 AP a "Default"."), two OMADA_SET_WLAN calls, all moved; after Close the selection is empty', async () => {
    await configureStub(session, { setWlanFailMacs: [], setWlanErrors: {} });
    const before = (await setCalls()).length;
    await page.click('#retryFailedBtn');
    await waitForReview(page);
    const modal = await readMoveModal(page);
    await page.click('#confirmMoveBtn');
    await waitForResults(page);
    const results = await readMoveModal(page);
    await closeResults(page);
    const sets = (await setCalls()).slice(before);
    const selection = await readSelection(page);
    const rows = await readApItems(page);
    return verdict(
      modal.title === es.reviewTitle && modal.summary === fmt(es.reviewMany, { count: 2, group: 'Default' }) &&
      modal.rows.aps?.value === 'Bodega, Jardín' && modal.activeId === 'cancelMoveBtn' &&
      isDeepStrictEqual(sets.map((call) => call.args), [[AP.Bodega.mac, GROUP.Default.wlanId], [AP['Jardín'].mac, GROUP.Default.wlanId]]) &&
      results.summary === fmt(es.resultsAllMany, { count: 2, group: 'Default' }) && results.results.every((row) => row.ok) &&
      selection.summary === expectedSummary('es', 0, 0) &&
      rows.find((row) => row.name === 'Bodega')?.group === groupText('Default') && rows.find((row) => row.name === 'Jardín')?.group === groupText('Default'),
      { modal, sets, results, selection }
    );
  }); // End of check "[es] Reintentar los fallidos..."

  await check('[es] retry after a reload that dropped a failed AP: Bodega + Jardín fail moving to zGrupo B and Bodega leaves the controller meanwhile -> the results say "1 AP fallido ya no está en el controlador…" and that the retry covers only the remaining AP; "Reintentar los fallidos" reviews and PATCHes only Jardín', async () => {
    const scenario = (await stubState(session)).scenario;
    const bodega = scenario.accessPoints.find((entry) => entry.mac === AP.Bodega.mac);
    await page.click(box('Bodega'));
    await page.click(box('Jardín'));
    await page.click(box('Porche'));
    await pickDestination(page, GROUP['zGrupo B'].wlanId);
    await openReview(page);
    // Both fail, and the reload after the run no longer lists Bodega
    await configureStub(session, {
      setWlanErrors: { [AP.Bodega.mac]: 'Device is busy', [AP['Jardín'].mac]: 'Device is busy' },
      accessPoints: scenario.accessPoints.filter((entry) => entry.mac !== AP.Bodega.mac),
    });
    const before = (await setCalls()).length;
    await page.click('#confirmMoveBtn');
    await waitForResults(page);
    const results = await readMoveModal(page);
    const selection = await readSelection(page);
    const sets = (await setCalls()).slice(before);
    await configureStub(session, { setWlanErrors: {} });
    await page.click('#retryFailedBtn');
    await waitForReview(page);
    const review = await readMoveModal(page);
    await page.click('#confirmMoveBtn');
    await waitForResults(page);
    const retried = await readMoveModal(page);
    const retrySets = (await setCalls()).slice(before + sets.length);
    await closeResults(page);
    // Bodega comes back (still in Default) for the checks that follow
    const current = (await stubState(session)).scenario.accessPoints;
    await configureStub(session, { accessPoints: [...current, bodega] });
    await page.click('#refreshBtn');
    await waitForApCount(page, 7);
    await waitForLoadIdle(page);
    const zB = GROUP['zGrupo B'].wlanId;
    return verdict(
      isDeepStrictEqual(sets.map((call) => call.args), [[AP.Bodega.mac, zB], [AP['Jardín'].mac, zB], [AP.Porche.mac, zB]]) &&
      results.summary === fmt(es.resultsPartial, { moved: 1, total: 3, group: 'zGrupo B' }) &&
      isDeepStrictEqual(results.results.map((row) => [row.name, row.ok]), [['Bodega', false], ['Jardín', false], ['Porche', true]]) &&
      isDeepStrictEqual(results.notes, [es.retryMissingOne, fmt(es.retryRemainingOne, { action: es.retryFailed }), es.notAtomic]) &&
      results.buttons.retry === es.retryFailed && isDeepStrictEqual(selection.checked, [AP['Jardín'].mac]) &&
      review.summary === fmt(es.reviewOne, { ap: 'Jardín', group: 'zGrupo B' }) && review.rows.aps?.value === 'Jardín' &&
      review.activeId === 'cancelMoveBtn' && isDeepStrictEqual(retrySets.map((call) => call.args), [[AP['Jardín'].mac, zB]]) &&
      retried.summary === fmt(es.resultsAllOne, { group: 'zGrupo B' }),
      { sets, results, selection, review, retrySets, retried }
    );
  }); // End of check "[es] retry after a reload that dropped a failed AP..."

  await check('[es] retry unavailable once the destination is gone: Jardín fails moving to Exterior and the reload no longer lists Exterior -> no "Reintentar los fallidos", the results say why; Exterior leaves the pane, the destination is cleared and Jardín stays selected', async () => {
    await page.click(box('Jardín'));
    await page.click(box('Porche'));
    await pickDestination(page, GROUP.Exterior.wlanId);
    await openReview(page);
    await configureStub(session, {
      setWlanErrors: { [AP['Jardín'].mac]: 'Device is busy' },
      wlanGroups: data.wlanGroups.filter((entry) => entry.wlanId !== GROUP.Exterior.wlanId),
    });
    const before = (await setCalls()).length;
    await page.click('#confirmMoveBtn');
    await waitForResults(page);
    const results = await readMoveModal(page);
    const sets = (await setCalls()).slice(before);
    const destinations = (await readDestinations(page)).map((item) => item.name);
    const preview = await readPreview(page);
    await closeResults(page);
    const selection = await readSelection(page);
    // The full group listing comes back for the checks that follow
    await configureStub(session, { setWlanErrors: {}, wlanGroups: data.wlanGroups });
    await page.click('#refreshBtn');
    await page.waitForSelector(`#destinationList .destination-option[data-wlan-id="${GROUP.Exterior.wlanId}"]`, { timeout: WAIT_MS });
    await waitForLoadIdle(page);
    await page.click('#clearApSelectionBtn');
    const exterior = GROUP.Exterior.wlanId;
    return verdict(
      isDeepStrictEqual(sets.map((call) => call.args), [[AP['Jardín'].mac, exterior], [AP.Porche.mac, exterior]]) &&
      results.summary === fmt(es.resultsPartial, { moved: 1, total: 2, group: 'Exterior' }) &&
      isDeepStrictEqual(results.notes, [fmt(es.retryDestinationGone, { group: 'Exterior' }), es.notAtomic]) &&
      isDeepStrictEqual(results.buttons, { cancel: null, confirm: null, retry: null, close: es.close }) && results.activeId === 'closeMoveBtn' &&
      !destinations.includes('Exterior') && destinations.length === 3 && preview.destination === null &&
      isDeepStrictEqual(selection.checked, [AP['Jardín'].mac]),
      { sets, results, destinations, preview, selection }
    );
  }); // End of check "[es] retry unavailable once the destination is gone..."

  await check('[es] Enter on a focused destination radio moves into THAT group: with Default checked and hidden by the search "taller", Enter on the focused zGrupo B radio checks it and opens the review naming zGrupo B (Cancel focused); Escape cancels (no PATCH) back to that radio; Enter on a radio whose move is a no-op (Exterior: Altillo is there) does nothing', async () => {
    const before = (await setCalls()).length;
    /**
     * The rendered destination options as [name, checked] pairs.
     * @returns {Promise<Array<[string, boolean | null]>>} The pairs, in order.
     */
    const radioStates = async () => (await readDestinations(page)).map((item) => [item.name, item.checked]);
    await page.click(box('Altillo'));
    await pickDestination(page, GROUP.Default.wlanId);
    await page.fill('#destinationSearch', 'taller');
    const hiddenRadios = await radioStates();
    const hiddenPreview = await readPreview(page);
    await page.focus(`#destinationList .destination-radio[value="${GROUP['zGrupo B'].wlanId}"]`);
    await page.keyboard.press('Enter');
    await waitForReview(page);
    const modal = await readMoveModal(page);
    const radios = await radioStates();
    const preview = await readPreview(page);
    await page.keyboard.press('Escape');
    await waitForMoveDialogClosed(page);
    await page.waitForFunction((id) => document.activeElement?.classList.contains('destination-radio') && document.activeElement.value === id,
      GROUP['zGrupo B'].wlanId, { timeout: WAIT_MS });
    await page.fill('#destinationSearch', 'exterior');
    await page.focus(`#destinationList .destination-radio[value="${GROUP.Exterior.wlanId}"]`);
    await page.keyboard.press('Enter');
    const noopShell = await readShell(page);
    const noopRadios = await radioStates();
    const noopPreview = await readPreview(page);
    const sets = (await setCalls()).slice(before);
    await page.fill('#destinationSearch', '');
    await page.click('#clearApSelectionBtn');
    return verdict(
      isDeepStrictEqual(hiddenRadios, [['zGrupo B', false]]) && hiddenPreview.destination === fmt(es.moveDestination, { group: 'Default' }) &&
      modal.summary === fmt(es.reviewOne, { ap: 'Altillo', group: 'zGrupo B' }) && modal.rows.to?.value === 'zGrupo B' &&
      modal.activeId === 'cancelMoveBtn' && isDeepStrictEqual(radios, [['zGrupo B', true]]) &&
      preview.destination === fmt(es.moveDestination, { group: 'zGrupo B' }) &&
      noopShell.moveOpen === false && isDeepStrictEqual(noopRadios, [['Exterior', false]]) &&
      noopPreview.destination === fmt(es.moveDestination, { group: 'zGrupo B' }) && sets.length === 0,
      { hiddenRadios, hiddenPreview, modal, radios, preview, noopShell, noopRadios, noopPreview, sets }
    );
  }); // End of check "[es] Enter on a focused destination radio..."

  await check('[es] two groups named "Default" (a twin appears on refresh): both radios stay listed but disabled, never checked, with "Otro grupo tiene el mismo nombre — …" shown and in their description; the checked Default destination is dropped ("Selecciona un grupo de AP", move disabled); clicking a twin checks nothing; an AP in the ambiguous Default can still move to the unique zGrupo B, its current networks stated as unknown', async () => {
    const twin = { wlanId: '6512a0e1f3b2c41d2e3f4a60', wlanName: 'Default', ssidList: [{ ssidName: 'Casa' }] };
    await page.click(box('Altillo'));
    await pickDestination(page, GROUP.Default.wlanId);
    const beforeTwin = await readPreview(page);
    await configureStub(session, { wlanGroups: [...data.wlanGroups, twin] });
    await page.click('#refreshBtn');
    await page.waitForSelector(`#destinationList .destination-option[data-wlan-id="${twin.wlanId}"]`, { timeout: WAIT_MS });
    await waitForLoadIdle(page);
    const options = await readDestinations(page);
    const preview = await readPreview(page);
    // A click on the twin's label (its radio is disabled) must check nothing
    await page.click(`#destinationList .destination-option[data-wlan-id="${GROUP.Default.wlanId}"]`, { force: true });
    const clickedOptions = await readDestinations(page);
    const clickedPreview = await readPreview(page);
    await page.click(box('EAP Carpio'));
    await pickDestination(page, GROUP['zGrupo B'].wlanId);
    const unique = await readPreview(page);
    // The listing without the twin comes back for the checks that follow
    await configureStub(session, { wlanGroups: data.wlanGroups });
    await page.click('#refreshBtn');
    await page.waitForFunction((id) => document.querySelector(`#destinationList .destination-option[data-wlan-id="${id}"]`) === null,
      twin.wlanId, { timeout: WAIT_MS });
    await waitForLoadIdle(page);
    const restored = await readDestinations(page);
    await page.click('#clearApSelectionBtn');
    const twins = options.filter((item) => item.name === 'Default');
    const others = options.filter((item) => item.name !== 'Default');
    return verdict(
      beforeTwin.status === es.willMoveOne && beforeTwin.disabled === false &&
      twins.length === 2 && twins.every((item) => item.disabled === true && item.checked === false && item.reason === es.ambiguous &&
        item.description === `${item.detail} ${es.ambiguous}`) &&
      others.length === 3 && others.every((item) => item.disabled === false && item.reason === null) &&
      preview.destination === null && preview.status === es.selectGroup.apGroup && preview.disabled === true &&
      clickedOptions.every((item) => item.checked === false) && clickedPreview.status === es.selectGroup.apGroup && clickedPreview.disabled === true &&
      unique.status === fmt(es.willMoveMany, { count: 2 }) && unique.unknownNote === es.unknownOne &&
      unique.button === fmt(es.moveMany, { count: 2 }) && unique.disabled === false &&
      restored.length === 4 && restored.every((item) => item.disabled === false && item.reason === null),
      { beforeTwin, options, preview, clickedOptions, clickedPreview, unique, restored }
    );
  }); // End of check "[es] two groups named Default..."
} // End of function runBulkMoveChecks()

// ============================================================================
// Launch 1: Spanish, first run, single site
// ============================================================================

/**
 * Spanish first-run launch: settings modal, save, connect, lists and the
 * destination pane, a single move through the review dialog (cancel, Escape,
 * confirm, results) and into the Silence section, the selection and bulk-move
 * checks, refresh, the 700×500 layout, disconnect, connect failure and
 * recovery, save rejected by main.
 * @param {{ binary: string }} electronInfo - Resolved Electron binary.
 * @returns {Promise<void>}
 */
async function runSpanishFirstRun(electronInfo) {
  const session = await launch(electronInfo, 'es', {
    config: { url: '', username: '', language: 'es', hasPassword: false },
    connect: { success: true },
    controllerVersion: data.controllerVersion,
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

    await check('[es] first run: status, buttons and "configure" hints are in Spanish; the move button is disabled ("Mover AP") and the move preview is empty', async () => {
      const shell = await readShell(page);
      return verdict(
        shell.status === es.disconnected && shell.connect === es.connect && shell.move === es.moveNone &&
        shell.moveDisabled === true && shell.refreshDisabled === true && shell.apEmpty === es.configureHint &&
        shell.destinationEmpty === es.configureHint && shell.moveStatus === '' && shell.destinationTitle === es.destinationTitle,
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

    await check('[es] connect after save: OMADA_CONNECT called once, the header says "Conectado" and shows the controller host', async () => {
      await waitForConnected(page);
      const shell = await readShell(page);
      const connects = callsTo(await stubState(session), 'omada:connect');
      return verdict(
        connects.length === 1 && shell.indicator.split(' ').includes('connected') && shell.connect === es.disconnect &&
        shell.status === es.connected && shell.host === CONTROLLER_HOST,
        { connects: connects.length, shell }
      );
    });

    const expectedAps = expectedApRows(data.accessPoints, 'es', 'apGroup', data.wlanGroups);
    await check('[es] AP list rendered from the fixtures (sorted, malformed MAC dropped, translated status and group)', async () => {
      await waitForApCount(page, expectedAps.length);
      return compareApRows(await readApItems(page), expectedAps);
    });

    await check('[es] destination pane rendered from the fixtures: one native radio per group (one radio group, named by the group, no listbox roles), sorted, malformed id dropped, network previews; the empty groups pinned under "Silenciar"', async () => {
      const expected = expectedDestinations(data.wlanGroups, 'es');
      const items = await readDestinations(page);
      const actual = items.map(({ name, detail, section }) => ({ name, detail, section }));
      const pane = await readDestinationPane(page);
      const shell = await readShell(page);
      return verdict(
        isDeepStrictEqual(actual, expected) && pane.listboxes === 0 &&
        items.every((item) => item.type === 'radio' && item.radioName === items[0].radioName && item.checked === false && item.accessibleName === item.name) &&
        pane.silenceTitle === es.silence && pane.silenceLabelledBy === 'destinationSilenceTitle' && shell.refreshDisabled === false,
        { actual, expected, items, pane, refreshDisabled: shell.refreshDisabled }
      );
    }); // End of check "[es] destination pane rendered from the fixtures..."

    await check('[es] Omada 6.3 vocabulary: the destination list is labelled "Grupos de AP", AP rows say "Grupo de AP:", the empty AP group zNinguna sits under "Silenciar" with "Sin redes Wi-Fi — silencia estos AP", and the preview asks for APs', async () => {
      const shell = await readShell(page);
      const empty = (await readDestinations(page)).find((item) => item.wlanId === EMPTY_GROUP.wlanId);
      const apRow = (await readApItems(page)).find((item) => item.mac === MOVE_AP.mac);
      const preview = await readPreview(page);
      return verdict(
        shell.destinationListLabel === es.groupsTitle.apGroup && preview.status === es.moveNoSelection && preview.disabled === true &&
        empty?.name === EMPTY_GROUP.wlanName && empty?.detail === es.emptyGroup && empty?.section === 'silence' && empty?.checked === false &&
        Boolean(apRow?.group.startsWith(`${es.groupLabel.apGroup}: `)),
        { shell, empty, apRow, preview }
      );
    }); // End of check "[es] Omada 6.3 vocabulary..."

    await checkShellAfterConnect(session, 'es', { aps: data.accessPoints, groups: data.wlanGroups, version: data.controllerVersion, groupModel: 'apGroup', site: null });

    await check('[es] AP rows: a native checkbox per AP named by the AP (no listbox/option roles), status as text, network count of its group (zNinguna: "Sin redes") and the optional client count', async () => {
      const items = await readApItems(page);
      const roles = await page.evaluate(() => ({
        listRole: document.getElementById('apList')?.getAttribute('role'),
        options: document.querySelectorAll('#apList [role="option"], #apList [role="listbox"]').length,
        checkboxes: document.querySelectorAll('#apList input[type="checkbox"]').length,
      }));
      const jardin = items.find((item) => item.mac === AP['Jardín'].mac);
      const garaje = items.find((item) => item.mac === AP.Garaje.mac);
      return verdict(
        roles.listRole === 'group' && roles.options === 0 && roles.checkboxes === items.length && items.length === expectedAps.length &&
        items.every((item) => item.checkboxType === 'checkbox' && item.checkboxName === item.name && item.checked === false && item.statusLabel !== '') &&
        jardin?.counts === ` · ${es.networksNone} · ${fmt(es.clientsMany, { count: 3 })}` &&
        garaje?.counts === ` · ${fmt(es.networksMany, { count: 2 })}`,
        { roles, jardin, garaje, items }
      );
    }); // End of check "[es] AP rows: a native checkbox per AP..."

    await check('[es] navigation: the AP groups and Wi-Fi networks entries show their placeholder views (aria-current follows), and Enter on "Puntos de acceso" brings the list back', async () => {
      await page.click('#navGroups');
      const groups = await readNav(page);
      await page.click('#navNetworks');
      const networks = await readNav(page);
      await page.focus('#navAccessPoints');
      await page.keyboard.press('Enter');
      const back = await readNav(page);
      const rows = (await readApItems(page)).length;
      return verdict(
        isDeepStrictEqual(groups.shown, ['viewGroups']) && groups.groups.current === 'page' && groups.accessPoints.current === null &&
        groups.groupsTitle === es.groupsTitle.apGroup && groups.groupsText === es.comingSoon &&
        isDeepStrictEqual(networks.shown, ['viewNetworks']) && networks.networks.current === 'page' && networks.groups.current === null &&
        networks.networksTitle === es.wifiNetworks && networks.networksText === es.comingSoon &&
        isDeepStrictEqual(back.shown, ['viewAccessPoints']) && back.accessPoints.current === 'page' && back.networks.current === null &&
        rows === expectedAps.length,
        { groups, networks, back, rows }
      );
    }); // End of check "[es] navigation..."

    await check('[es] single move: clicking an AP row checks it ("Selecciona un grupo de AP"); picking zGrupo B previews Default -> zGrupo B (gains +5, loses -2, unchanged none) and enables "Mover AP"', async () => {
      await page.click(`#apList .ap-row[data-mac="${MOVE_AP.mac}"] .item-name`);
      const apOnly = await readPreview(page);
      await pickDestination(page, MOVE_GROUP.wlanId);
      const preview = await readPreview(page);
      const apSelected = (await readApItems(page)).find((item) => item.mac === MOVE_AP.mac)?.checked;
      const radio = (await readDestinations(page)).find((item) => item.wlanId === MOVE_GROUP.wlanId)?.checked;
      return verdict(
        apOnly.status === es.selectGroup.apGroup && apOnly.disabled === true && apOnly.button === es.moveOne &&
        preview.status === es.willMoveOne && preview.destination === fmt(es.moveDestination, { group: MOVE_GROUP.wlanName }) &&
        isDeepStrictEqual(preview.diff, {
          gained: { label: es.gains, value: '+5 · Oficina, Taller, Almacén, Tienda, IoT' },
          lost: { label: es.loses, value: '−2 · Casa, Invitados' },
          unchanged: { label: es.unchanged, value: es.none },
        }) && preview.hiddenNote === null && preview.unknownNote === null && preview.warning === null &&
        preview.button === es.moveOne && preview.disabled === false && apSelected === true && radio === true,
        { apOnly, preview, apSelected, radio }
      );
    }); // End of check "[es] single move: clicking an AP row checks it..."

    await check('[es] single move: "Mover AP" opens the review dialog (role=dialog, aria-modal, described by its summary, inert background) with focus on Cancel, showing Default -> zGrupo B, the AP, the networks gained/lost/unchanged, its clients, and the not-atomic and no-overrides notes', async () => {
      await openReview(page);
      const modal = await readMoveModal(page);
      return verdict(
        modal.role === 'dialog' && modal.ariaModal === 'true' && modal.labelledBy === 'moveModalHeading' && modal.describedBy === 'moveModalSummary' &&
        modal.inert === true && modal.activeId === 'cancelMoveBtn' && modal.activeVisible === true &&
        modal.title === es.reviewTitle && modal.summary === fmt(es.reviewOne, { ap: MOVE_AP.name, group: MOVE_GROUP.wlanName }) &&
        isDeepStrictEqual(modal.rows.from, { label: es.from, value: `Default (${es.apOne})`, details: [], warnings: [] }) &&
        isDeepStrictEqual(modal.rows.to, { label: es.to, value: MOVE_GROUP.wlanName, details: [fmt(es.networksMany, { count: 5 })], warnings: [] }) &&
        isDeepStrictEqual(modal.rows.aps, { label: `${es.accessPoints} (${es.apOne})`, value: MOVE_AP.name, details: [], warnings: [] }) &&
        isDeepStrictEqual(modal.rows.networks?.details, [
          `${es.gains}: +5 · Oficina, Taller, Almacén, Tienda, IoT`, `${es.loses}: −2 · Casa, Invitados`, `${es.unchanged}: ${es.none}`,
        ]) &&
        modal.rows.clients?.value === es.clientsOne && isDeepStrictEqual(modal.notes, [es.notAtomic, es.overrides]) &&
        isDeepStrictEqual(modal.buttons, { cancel: es.cancel, confirm: es.moveOne, retry: null, close: null }),
        modal
      );
    }); // End of check "[es] single move: Mover AP opens the review dialog..."

    await check('[es] single move -> Cancel: the dialog closes, no OMADA_SET_WLAN call, focus back on the move button, selection and destination kept', async () => {
      await page.click('#cancelMoveBtn');
      await waitForMoveDialogClosed(page);
      await page.waitForFunction(() => document.activeElement?.id === 'moveBtn', null, { timeout: WAIT_MS });
      const sets = callsTo(await stubState(session), 'omada:set-wlan');
      const shell = await readShell(page);
      const preview = await readPreview(page);
      return verdict(
        sets.length === 0 && shell.inert === false && shell.moveOpen === false && preview.status === es.willMoveOne &&
        preview.destination === fmt(es.moveDestination, { group: MOVE_GROUP.wlanName }) && preview.disabled === false,
        { sets, shell, preview }
      );
    }); // End of check "[es] single move -> Cancel..."

    await check('[es] single move via keyboard: Enter on "Mover AP" opens the review with Cancel focused, Escape cancels (no IPC), focus returns to the button', async () => {
      await page.focus('#moveBtn');
      await page.keyboard.press('Enter');
      await waitForReview(page);
      await page.keyboard.press('Escape');
      await waitForMoveDialogClosed(page);
      await page.waitForFunction(() => document.activeElement?.id === 'moveBtn', null, { timeout: WAIT_MS });
      const sets = callsTo(await stubState(session), 'omada:set-wlan');
      const shell = await readShell(page);
      return verdict(sets.length === 0 && shell.inert === false && shell.moveOpen === false && shell.moveDisabled === false, { sets, shell });
    }); // End of check "[es] single move via keyboard..."

    await check('[es] single move -> "Mover AP" in the review: one OMADA_SET_WLAN with the AP MAC and the group id, then the results "Se movió el AP a "zGrupo B"." with one "Movido" row (name and MAC) and Close focused', async () => {
      await openReview(page);
      await page.click('#confirmMoveBtn');
      await waitForResults(page);
      const modal = await readMoveModal(page);
      const sets = callsTo(await stubState(session), 'omada:set-wlan');
      return verdict(
        sets.length === 1 && isDeepStrictEqual(sets[0].args, [MOVE_AP.mac, MOVE_GROUP.wlanId]) &&
        modal.title === es.resultsTitle && modal.summary === fmt(es.resultsAllOne, { group: MOVE_GROUP.wlanName }) &&
        isDeepStrictEqual(modal.results, [{ mac: MOVE_AP.mac, ok: true, status: es.resultOk, name: MOVE_AP.name, macText: MOVE_AP.mac, error: null }]) &&
        isDeepStrictEqual(modal.buttons, { cancel: null, confirm: null, retry: null, close: es.close }) && modal.activeId === 'closeMoveBtn',
        { sets, modal }
      );
    }); // End of check "[es] single move -> Mover AP in the review..."

    await check('[es] single move -> Close: lists reloaded, the AP shows its new group, selection and destination cleared ("Mover AP" disabled), focus back in the AP list', async () => {
      await closeResults(page);
      const snapshot = await stubState(session);
      const row = (await readApItems(page)).find((item) => item.mac === MOVE_AP.mac);
      const preview = await readPreview(page);
      const radios = await readDestinations(page);
      const focusInList = await page.evaluate(() => Boolean(document.activeElement?.classList.contains('ap-checkbox')));
      return verdict(
        callsTo(snapshot, 'omada:get-aps').length === 2 && callsTo(snapshot, 'omada:get-wlans').length === 2 &&
        row?.group === `${es.groupLabel.apGroup}: ${MOVE_GROUP.wlanName}` && row?.checked === false &&
        preview.status === es.moveNoSelection && preview.disabled === true && preview.button === es.moveNone && preview.destination === null &&
        radios.every((item) => item.checked === false) && focusInList,
        { getAps: callsTo(snapshot, 'omada:get-aps').length, getWlans: callsTo(snapshot, 'omada:get-wlans').length, row, preview, focusInList }
      );
    }); // End of check "[es] single move -> Close..."

    await check('[es] Silence as a move target: zNinguna (pinned under "Silenciar") is selectable; the preview shows every network lost and "Sin redes Wi-Fi — silencia estos AP", the review shows it as the destination warning', async () => {
      await page.click(`#apList .ap-row[data-mac="${MOVE_AP.mac}"]`);
      await pickDestination(page, EMPTY_GROUP.wlanId);
      const preview = await readPreview(page);
      const radio = (await readDestinations(page)).find((item) => item.wlanId === EMPTY_GROUP.wlanId);
      await openReview(page);
      const modal = await readMoveModal(page);
      return verdict(
        radio?.section === 'silence' && radio?.checked === true &&
        isDeepStrictEqual(preview.diff, {
          gained: { label: es.gains, value: es.none },
          lost: { label: es.loses, value: '−5 · Oficina, Taller, Almacén, Tienda, IoT' },
          unchanged: { label: es.unchanged, value: es.none },
        }) && preview.warning === es.emptyGroup && preview.button === es.moveOne && preview.disabled === false &&
        modal.summary === fmt(es.reviewOne, { ap: MOVE_AP.name, group: EMPTY_GROUP.wlanName }) &&
        isDeepStrictEqual(modal.rows.from, { label: es.from, value: `${MOVE_GROUP.wlanName} (${es.apOne})`, details: [], warnings: [] }) &&
        isDeepStrictEqual(modal.rows.to, { label: es.to, value: EMPTY_GROUP.wlanName, details: [es.emptyGroup], warnings: [es.emptyGroup] }),
        { preview, radio, modal }
      );
    }); // End of check "[es] Silence as a move target..."

    await check('[es] Silence move -> confirm: OMADA_SET_WLAN carries the empty group id (the unchanged move call) and the AP then reports the group', async () => {
      await page.click('#confirmMoveBtn');
      await waitForResults(page);
      const modal = await readMoveModal(page);
      await closeResults(page);
      await page.waitForFunction(({ mac, group }) =>
        document.querySelector(`#apList .ap-row[data-mac="${mac}"] .ap-row-group`)?.textContent === group,
      { mac: MOVE_AP.mac, group: `${es.groupLabel.apGroup}: ${EMPTY_GROUP.wlanName}` }, { timeout: WAIT_MS });
      const sets = callsTo(await stubState(session), 'omada:set-wlan');
      const row = (await readApItems(page)).find((item) => item.mac === MOVE_AP.mac);
      return verdict(
        sets.length === 2 && isDeepStrictEqual(sets[1].args, [MOVE_AP.mac, EMPTY_GROUP.wlanId]) &&
        modal.summary === fmt(es.resultsAllOne, { group: EMPTY_GROUP.wlanName }) && modal.results.length === 1 && modal.results[0].ok === true &&
        row?.counts === ` · ${es.networksNone} · ${es.clientsOne}`,
        { sets, modal, row }
      );
    }); // End of check "[es] Silence move -> confirm..."

    await runSelectionChecks(session);
    await runBulkMoveChecks(session);

    await check('[es] Refresh keeps the rows on screen (dimmed, aria-busy, "Actualizando…", spinning button), then shows the new data, the new AP total and a newer "Actualizado hh:mm"', async () => {
      const before = await stubState(session);
      const headerBefore = await readHeader(page);
      const rowsBefore = (await readApItems(page)).length;
      await configureStub(session, { accessPoints: [...before.scenario.accessPoints, data.newAccessPoint], delays: { 'omada:get-aps': 400 } });
      await page.click('#refreshBtn');
      await page.waitForFunction(() =>
        document.getElementById('refreshBtn').classList.contains('spinning') &&
        document.getElementById('apList').classList.contains('is-refreshing'),
      null, { timeout: WAIT_MS });
      const during = await page.evaluate(() => ({
        rows: document.querySelectorAll('#apList .ap-row').length,
        loading: document.querySelector('#apList .loading') !== null,
        busy: document.getElementById('apList').getAttribute('aria-busy'),
        groupsBusy: document.getElementById('destinationList').getAttribute('aria-busy'),
        updated: document.getElementById('lastUpdated').textContent,
      }));
      await page.waitForFunction((name) => Array.from(document.querySelectorAll('#apList .item-name')).some((el) => el.textContent === name),
        data.newAccessPoint.name, { timeout: WAIT_MS });
      await waitForLoadIdle(page);
      await configureStub(session, { delays: {} });
      const after = await stubState(session);
      const shell = await readShell(page);
      const header = await readHeader(page);
      const nav = await readNav(page);
      const busyAfter = await page.evaluate(() => document.getElementById('apList').hasAttribute('aria-busy') || document.getElementById('apList').classList.contains('is-refreshing'));
      return verdict(
        during.rows === rowsBefore && during.loading === false && during.busy === 'true' && during.groupsBusy === 'true' && during.updated === es.refreshing &&
        callsTo(after, 'omada:get-aps').length === callsTo(before, 'omada:get-aps').length + 1 &&
        callsTo(after, 'omada:get-wlans').length === callsTo(before, 'omada:get-wlans').length + 1 &&
        shell.refreshSpinning === false && shell.refreshDisabled === false && busyAfter === false &&
        header.updatedAt > headerBefore.updatedAt && header.updated === fmt(es.updated, { time: header.time }) &&
        nav.accessPoints.count === String(rowsBefore + 1),
        { during, rowsBefore, headerBefore, header, shell, navCount: nav.accessPoints.count }
      );
    }); // End of check "[es] Refresh keeps the rows on screen..."

    await check('[es] failed refresh: the rows, the sidebar totals and the previous "Actualizado hh:mm" stay, with the load-error toast; still connected', async () => {
      const headerBefore = await readHeader(page);
      const rowsBefore = await readApItems(page);
      const navBefore = await readNav(page);
      await configureStub(session, { failChannels: ['omada:get-aps'] });
      try {
        await page.click('#refreshBtn');
        await waitForToast(page, 'error', es.loadError);
        await waitForLoadIdle(page);
      } finally {
        await configureStub(session, { failChannels: [] });
      }
      const header = await readHeader(page);
      const rows = await readApItems(page);
      const nav = await readNav(page);
      const shell = await readShell(page);
      return verdict(
        isDeepStrictEqual(rows, rowsBefore) && header.updatedAt === headerBefore.updatedAt && header.updated === headerBefore.updated &&
        header.status === es.connected && shell.refreshDisabled === false && isDeepStrictEqual(nav, navBefore),
        { headerBefore, header, rows: rows.length, rowsBefore: rowsBefore.length, shell }
      );
    }); // End of check "[es] failed refresh..."

    await check('[es] 700×500 minimum window: no overflow; the sidebar (Settings included), AP rows, the selection summary, a destination radio, the move preview and the move button stay inside the window; the review dialog keeps Cancel and the move button visible', async () => {
      // A selection and a destination, so the preview is at its fullest
      await page.click(`#apList .ap-checkbox[data-mac="${AP.Altillo.mac}"]`);
      await pickDestination(page, GROUP.Default.wlanId);
      await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 500));
      try {
        await page.waitForFunction(() => window.innerWidth <= 700 && window.innerHeight <= 500, null, { timeout: WAIT_MS });
        const layout = await page.evaluate(() => {
          /**
           * Tells whether an element is rendered entirely inside the window.
           * @param {string} selector - CSS selector of the element.
           * @returns {boolean} True when it has a size and fits the viewport.
           */
          const inside = (selector) => {
            const rect = document.querySelector(selector)?.getBoundingClientRect();
            return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
              rect.right <= window.innerWidth && rect.bottom <= window.innerHeight);
          };
          /**
           * Tells whether at least one of the elements is fully visible inside
           * its scrolling container and the window.
           * @param {string} itemSelector - CSS selector of the items.
           * @param {DOMRect} box - The container's rectangle.
           * @returns {boolean} True when one item is in view.
           */
          const oneInView = (itemSelector, box) => Array.from(document.querySelectorAll(itemSelector)).some((item) => {
            const rect = item.getBoundingClientRect();
            return rect.top >= box.top && rect.bottom <= box.bottom && rect.left >= box.left && rect.right <= box.right && rect.bottom <= window.innerHeight;
          });
          const list = document.getElementById('apList').getBoundingClientRect();
          const destinations = document.getElementById('destinationList').getBoundingClientRect();
          return {
            scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
            width: window.innerWidth, height: window.innerHeight,
            settings: inside('#settingsBtn'), move: inside('#moveBtn'), preview: inside('.move-summary'), summary: inside('#apSelectionSummary'),
            nav: inside('#navNetworks'), refresh: inside('#refreshBtn'), connect: inside('#connectBtn'),
            rowInView: oneInView('#apList .ap-row', list), radioInView: oneInView('#destinationList .destination-option', destinations),
            listHeight: list.height, destinationHeight: destinations.height,
          };
        }); // End of the in-page layout probe
        await openReview(page);
        const dialog = await page.evaluate(() => {
          /**
           * Tells whether an element is rendered entirely inside the window.
           * @param {string} id - The element id.
           * @returns {boolean} True when it has a size and fits the viewport.
           */
          const inside = (id) => {
            const rect = document.getElementById(id)?.getBoundingClientRect();
            return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth);
          };
          return { cancel: inside('cancelMoveBtn'), confirm: inside('confirmMoveBtn') };
        });
        await page.keyboard.press('Escape');
        await waitForMoveDialogClosed(page);
        return verdict(
          layout.scrollWidth <= layout.width && layout.scrollHeight <= layout.height && layout.settings && layout.move && layout.preview &&
          layout.summary && layout.nav && layout.refresh && layout.connect && layout.rowInView && layout.radioInView &&
          layout.listHeight >= 100 && layout.destinationHeight >= 90 && dialog.cancel && dialog.confirm,
          { layout, dialog }
        );
      } finally {
        if (await page.evaluate(() => document.getElementById('moveModal').classList.contains('visible'))) {
          await page.keyboard.press('Escape');
        }
        await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
        await page.click('#clearApSelectionBtn');
      }
    }); // End of check "[es] 700×500 minimum window..."

    await check('[es] Disconnect: OMADA_DISCONNECT called, lists and destination cleared, the move button disabled, status back to disconnected', async () => {
      await page.click('#connectBtn');
      await waitForStatus(page, es.disconnected);
      const snapshot = await stubState(session);
      const disconnects = callsTo(snapshot, 'omada:disconnect');
      const shell = await readShell(page);
      const preview = await readPreview(page);
      return verdict(
        disconnects.length === 1 && disconnects[0].args[0] == null && snapshot.connected === false &&
        shell.apEmpty === es.connectToSeeAPs && shell.destinationEmpty === es.connectToSeeGroups && shell.connect === es.connect &&
        shell.refreshDisabled === true && shell.moveDisabled === true && shell.move === es.moveNone &&
        preview.status === '' && preview.destination === null,
        { disconnects, shell, preview }
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
      await waitForConnected(page);
      const scenario = (await stubState(session)).scenario;
      const expected = expectedApRows(scenario.accessPoints, 'es', 'apGroup', scenario.wlanGroups);
      await waitForApCount(page, expected.length);
      return compareApRows(await readApItems(page), expected);
    });

    await check('[es] legacy controller (5.x) after a refresh: the destination list says "Grupos WLAN (heredado)", AP rows say "WLAN:", the preview asks for a "grupo WLAN"', async () => {
      await page.waitForFunction(() => document.getElementById('refreshBtn').disabled === false, null, { timeout: WAIT_MS });
      await configureStub(session, { controllerVersion: data.legacyControllerVersion, wlanGroups: data.legacyWlanGroups });
      await page.click('#refreshBtn');
      await page.waitForFunction((title) => document.getElementById('destinationList')?.getAttribute('aria-label') === title,
        es.groupsTitle.wlanGroup, { timeout: WAIT_MS });
      await waitForLoadIdle(page);
      const scenario = (await stubState(session)).scenario;
      const apVerdict = compareApRows(await readApItems(page), expectedApRows(scenario.accessPoints, 'es', 'wlanGroup', data.legacyWlanGroups));
      const destinations = (await readDestinations(page)).map(({ name, detail, section }) => ({ name, detail, section }));
      const expectedGroups = expectedDestinations(data.legacyWlanGroups, 'es');
      const firstMac = (await readApItems(page))[0]?.mac;
      await page.click(`#apList .ap-checkbox[data-mac="${firstMac}"]`);
      const preview = await readPreview(page);
      await page.click(`#apList .ap-checkbox[data-mac="${firstMac}"]`);
      return verdict(
        apVerdict.ok && isDeepStrictEqual(destinations, expectedGroups) && preview.status === es.selectGroup.wlanGroup,
        { aps: apVerdict.detail, destinations, expectedGroups, preview }
      );
    }); // End of check "[es] legacy controller (5.x) after a refresh..."

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
    controllerVersion: data.legacyControllerVersion,
    accessPoints: data.accessPoints,
    wlanGroups: data.legacyWlanGroups,
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
      await waitForConnected(page);
      const snapshot = await stubState(session);
      const selections = callsTo(snapshot, 'omada:select-site');
      return verdict(
        selections.length === 1 && snapshot.issuedNonces.length === 2 &&
        isDeepStrictEqual(selections[0].args, [secondSite.id, snapshot.issuedNonces[1]]) && snapshot.storedSiteId === secondSite.id,
        { selections, issuedNonces: snapshot.issuedNonces }
      );
    }); // End of check "[en] picking a site calls OMADA_SELECT_SITE with the site id and th..."

    await check('[en] lists render after the site selection, with English status, legacy "WLAN:" group labels and the legacy groups as destinations (none empty, so no Silence section)', async () => {
      const expectedAps = expectedApRows(data.accessPoints, 'en', 'wlanGroup', data.legacyWlanGroups);
      await waitForApCount(page, expectedAps.length);
      const apVerdict = compareApRows(await readApItems(page), expectedAps);
      const expectedGroups = expectedDestinations(data.legacyWlanGroups, 'en');
      const destinations = (await readDestinations(page)).map(({ name, detail, section }) => ({ name, detail, section }));
      const pane = await readDestinationPane(page);
      return verdict(
        apVerdict.ok && isDeepStrictEqual(destinations, expectedGroups) && pane.silenceTitle === null,
        { aps: apVerdict.detail, destinations, expectedGroups, pane }
      );
    });

    await checkShellAfterConnect(session, 'en', {
      aps: data.accessPoints, groups: data.legacyWlanGroups, version: data.legacyControllerVersion, groupModel: 'wlanGroup', site: secondSite.name,
    });

    await check('[en] legacy controller (5.x): the destination list is labelled "WLAN groups (legacy)" under "Move selected APs"; the preview asks for APs, then for "a WLAN group"', async () => {
      const shell = await readShell(page);
      const preview = await readPreview(page);
      const firstMac = (await readApItems(page))[0]?.mac;
      await page.click(`#apList .ap-row[data-mac="${firstMac}"]`);
      const apOnly = await readPreview(page);
      await page.click(`#apList .ap-row[data-mac="${firstMac}"]`);
      return verdict(
        shell.destinationListLabel === en.groupsTitle.wlanGroup && shell.destinationTitle === en.destinationTitle &&
        preview.status === en.moveNoSelection && preview.button === en.moveNone && preview.disabled === true &&
        apOnly.status === en.selectGroup.wlanGroup && apOnly.button === en.moveOne && apOnly.disabled === true,
        { shell, preview, apOnly }
      );
    }); // End of check "[en] legacy controller (5.x)..."

    await check('[en] the selection survives filtering in English: "3 selected (1 hidden by filters)", "Select all 4 filtered APs" and "Move 3 APs"; Clear selection empties it', async () => {
      for (const name of ['Altillo', 'Garaje', 'Porche']) {
        await page.click(`#apList .ap-checkbox[data-mac="${AP[name].mac}"]`);
      }
      await page.selectOption('#apGroupFilter', LEGACY_GROUP.Default.wlanId);
      const selection = await readSelection(page);
      const preview = await readPreview(page);
      await page.selectOption('#apGroupFilter', '');
      await page.click('#clearApSelectionBtn');
      const cleared = await readSelection(page);
      return verdict(
        selection.summary === '3 selected (1 hidden by filters)' && selection.summary === expectedSummary('en', 3, 1) &&
        selection.selectAll === fmt(en.selectAllFiltered, { count: 4 }) && selection.live === 'polite' &&
        isDeepStrictEqual(selection.checked, [AP.Garaje.mac, AP.Porche.mac]) && preview.button === fmt(en.moveMany, { count: 3 }) &&
        cleared.summary === en.selNone && cleared.checked.length === 0,
        { selection, preview, cleared }
      );
    }); // End of check "[en] the selection survives filtering in English..."

    await check('[en] two legacy groups named "Aulas" (a twin appears on refresh): both radios disabled with "Another group has the same name — rename one in Omada to move APs here" (also in their description); the unique Default stays selectable', async () => {
      const twin = { wlanId: '5f1a0c0ffee0000000000b03', wlanName: 'Aulas', ssidList: [{ ssidName: 'Profesores' }] };
      await configureStub(session, { wlanGroups: [...data.legacyWlanGroups, twin] });
      await page.click('#refreshBtn');
      await page.waitForSelector(`#destinationList .destination-option[data-wlan-id="${twin.wlanId}"]`, { timeout: WAIT_MS });
      await waitForLoadIdle(page);
      const options = await readDestinations(page);
      // The listing without the twin comes back for the checks that follow
      await configureStub(session, { wlanGroups: data.legacyWlanGroups });
      await page.click('#refreshBtn');
      await page.waitForFunction((id) => document.querySelector(`#destinationList .destination-option[data-wlan-id="${id}"]`) === null,
        twin.wlanId, { timeout: WAIT_MS });
      await waitForLoadIdle(page);
      const restored = await readDestinations(page);
      const twins = options.filter((item) => item.name === 'Aulas');
      const unique = options.find((item) => item.name === 'Default');
      return verdict(
        twins.length === 2 && twins.every((item) => item.disabled === true && item.checked === false && item.reason === en.ambiguous &&
          item.description === `${item.detail} ${en.ambiguous}`) &&
        unique?.disabled === false && unique?.reason === null &&
        restored.length === 2 && restored.every((item) => item.disabled === false && item.reason === null),
        { options, restored }
      );
    }); // End of check "[en] two legacy groups named Aulas..."

    await check('[en] reconnect reuses the remembered site (no site modal, no new selection)', async () => {
      await page.click('#connectBtn');
      await waitForStatus(page, en.disconnected);
      await page.click('#connectBtn');
      await waitForConnected(page);
      await waitForApCount(page, expectedApRows(data.accessPoints, 'en', 'wlanGroup', data.legacyWlanGroups).length);
      const snapshot = await stubState(session);
      return verdict(
        callsTo(snapshot, 'omada:connect').length === 3 && snapshot.issuedNonces.length === 2 &&
        callsTo(snapshot, 'omada:select-site').length === 1 && callsTo(snapshot, 'omada:disconnect').length === 2,
        { connects: callsTo(snapshot, 'omada:connect').length, nonces: snapshot.issuedNonces.length }
      );
    }); // End of check "[en] reconnect reuses the remembered site (no site modal, no new se..."

    await check('[en] after the reconnect the header still names the remembered site ("Site: Oficina")', async () => {
      const header = await readHeader(page);
      return verdict(header.site === fmt(en.site, { site: secondSite.name }) && header.status === en.connected && header.host === CONTROLLER_HOST, header);
    });

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
          during.destinationListLabel === en.groupsTitle.apGroup && during.destinationEmpty === en.connectToSeeGroups && during.moveDisabled === true &&
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
    controllerVersion: data.controllerVersion,
    accessPoints: data.accessPoints,
    wlanGroups: data.wlanGroups,
  });
  const { page } = session;
  const en = TEXT.en;
  const text = CERT_TEXT.en;
  const expectedAps = expectedApRows(data.accessPoints, 'en', 'apGroup', data.wlanGroups);

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
      await waitForConnected(page);
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

    await check('[tofu] Omada 6.3 in English: the destination list is labelled "AP groups", and the empty group zNinguna sits under "Silence" with "No Wi-Fi networks — silences these APs"', async () => {
      const shell = await readShell(page);
      const items = await readDestinations(page);
      const pane = await readDestinationPane(page);
      const empty = items.find((item) => item.wlanId === EMPTY_GROUP.wlanId);
      const destinations = items.map(({ name, detail, section }) => ({ name, detail, section }));
      const expectedGroups = expectedDestinations(data.wlanGroups, 'en');
      return verdict(
        shell.destinationListLabel === en.groupsTitle.apGroup && pane.silenceTitle === en.silence &&
        empty?.detail === en.emptyGroup && empty?.section === 'silence' && isDeepStrictEqual(destinations, expectedGroups),
        { shell, pane, empty, destinations, expectedGroups }
      );
    }); // End of check "[tofu] Omada 6.3 in English..."

    await checkShellAfterConnect(session, 'en', {
      aps: data.accessPoints, groups: data.wlanGroups, version: data.controllerVersion, groupModel: 'apGroup', site: null,
    });

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
      await waitForConnected(page);
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
