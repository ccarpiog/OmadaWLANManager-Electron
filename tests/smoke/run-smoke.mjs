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
    // Read-only AP groups / Wi-Fi networks views, AP details pane, cross-navigation (phase 14a)
    apNone: 'Sin AP', apCountUnknown: 'Nº de AP desconocido', groupOne: '1 grupo', groupMany: '{count} grupos', badgeDefault: 'Predeterminado',
    searchCount: 'Se muestran {shown} de {total}', noMatchingGroups: 'Ningún grupo ni red coincide con "{query}"',
    groupDetailPrompt: 'Selecciona un grupo para ver sus puntos de acceso y sus redes Wi-Fi',
    networkDetailPrompt: 'Selecciona una red para ver los grupos y los puntos de acceso que la emiten',
    noApsInGroup: 'Ningún punto de acceso está en este grupo',
    networkUnknownOne: 'No se incluye 1 punto de acceso que puede emitirla: la aplicación no puede identificar su grupo (sin grupo, con un grupo que no está en la lista o con un nombre que comparten varios grupos).',
    networkUnknownMany: 'No se incluyen {count} puntos de acceso que pueden emitirla: la aplicación no puede identificar su grupo (sin grupo, con un grupo que no está en la lista o con un nombre que comparten varios grupos).',
    networkNoAps: 'Ningún punto de acceso está en los grupos que la emiten',
    // Phase 14a review fixes: a network's AP count as a lower bound (or unknown) with the reason
    apAtLeastOne: 'al menos 1 AP', apAtLeastMany: 'al menos {count} AP',
    scopeUnknownOne: 'no se puede identificar el grupo de 1 AP', scopeUnknownMany: 'no se puede identificar el grupo de {count} AP',
    managementOnly: 'No se muestran la seguridad, las bandas ni si la red está activada: requieren acceso de gestión.',
    apDetailsTitle: 'Detalles del AP', closeDetails: 'Cerrar detalles', statusLabel: 'Estado', macLabel: 'MAC', clientsLabel: 'Clientes',
    clientsNotReported: 'El controlador no informa de ellos',
    apNetworksUnknown: 'Sus redes Wi-Fi son desconocidas: la aplicación no puede identificar su grupo.',
    apOverrides: 'Estas son las redes de su grupo. Las redes personalizadas de este AP no se muestran (la aplicación aún no las lee): si tiene alguna en Omada, lo que emite realmente puede ser distinto.',
    backTo: 'Volver a {target}',
    // View states, read-only banner, single-pane layout (phase 14b)
    configureConnection: 'Configurar la conexión', connectToController: 'Conectar al controlador', retry: 'Reintentar', settings: 'Ajustes',
    connectToSeeNetworks: 'Conecta al controlador para ver las redes Wi-Fi', loading: 'Cargando...',
    refreshFailed: 'No se pudieron actualizar los datos. Se muestran los de las {time}.',
    readOnly63: 'No hay credenciales de Open API configuradas — puedes consultar los datos. Añádelas en Ajustes → Acceso de gestión.',
    readOnlyLegacy: 'Controlador heredado — puedes mover AP; editar grupos y redes requiere Omada Controller 6.3 o posterior.',
    chooseDestination: 'Elegir destino', backToAps: 'Volver a Puntos de acceso',
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
    // Read-only views, AP details pane, cross-navigation (phase 14a)
    apOne: '1 AP', apMany: '{count} APs', apNone: 'No APs', apCountUnknown: 'AP count unknown', groupOne: '1 group', groupMany: '{count} groups',
    badgeDefault: 'Default',
    networkUnknownMany: 'Not included: {count} access points that may broadcast it, whose group the app cannot identify (no group, a group not in the list, or a name several groups share).',
    // Phase 14a review fixes: a network's AP count as a lower bound (or unknown) with the reason
    apAtLeastOne: 'at least 1 AP', apAtLeastMany: 'at least {count} APs',
    scopeUnknownOne: '1 AP\'s group cannot be identified', scopeUnknownMany: '{count} APs\' groups cannot be identified',
    managementOnly: 'Security, bands and whether the network is enabled are not shown: they need management access.',
    apDetailsTitle: 'AP details', closeDetails: 'Close details', statusLabel: 'Status', clientsLabel: 'Clients',
    apGroupUnlisted: '{group} (not in the group list)',
    apNetworksUnknown: 'Its Wi-Fi networks are unknown: the app cannot identify its group.',
    apOverrides: 'These are its group\'s networks. Per-AP Wi-Fi network overrides are not shown (the app does not read them yet): if this AP has any in Omada, what it actually broadcasts may differ.',
    backTo: 'Back to {target}',
    // View states, read-only banner (phase 14b)
    connectToController: 'Connect to controller', loading: 'Loading...',
    readOnly63: 'Open API credentials are not configured — viewing is available. Add them in Settings → Management access.',
    readOnlyLegacy: 'Legacy controller — moving APs is available; editing groups and networks requires Omada Controller 6.3 or later.',
  },
};
const STATUS_CLASSES = ['offline', 'online', 'pending', 'warning', 'isolated'];
// Cmd+F on macOS, Ctrl+F elsewhere (keyboard.ts: focuses the view's search)
const FIND_KEY = process.platform === 'darwin' ? 'Meta+f' : 'Control+f';
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
const EXPECTED_BRIDGE = [
  'changeNetworkPassword', 'connect', 'createApGroup', 'createNetwork', 'deleteApGroup', 'deleteNetwork', 'disconnect', 'getAccessPoints',
  'getManagedApGroups', 'getManagedNetworks', 'getManagementCapabilities', 'getWlanGroups', 'loadConfig', 'platform', 'renameApGroup',
  'resetCertificate', 'saveConfig', 'selectSite', 'setApWlanGroup', 'setNetworkEnabled', 'testManagementAccess', 'trustCertificate',
  'updateNetwork',
];
// The keys of a ManagedNetwork DTO (src/shared/types.ts), sorted: nothing else may cross
const NETWORK_DTO_KEYS = ['apGroupIds', 'bands', 'enabled', 'hasPassphrase', 'id', 'name', 'scope', 'security'];
// One launch per run*() function in main()
const EXPECTED_LAUNCHES = 7;
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
  const required = [
    'dist/main/preload.js', 'dist/main/url.js', 'dist/main/controller-version.js', 'dist/main/ap-group-policy.js', 'dist/main/ipc-guards.js',
    'dist/shared/types.js', 'dist/renderer/index.html', 'dist/renderer/renderer.js',
  ];
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
    apSkeleton: document.querySelector('#apList .skeleton-list') !== null,
    destinationSkeleton: document.querySelector('#destinationList .skeleton-list') !== null,
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
 * aria-current, which view is shown, the titles of the AP groups and Wi-Fi
 * networks views, and any leftover placeholder element (phase 13a's).
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
      groupsTitle: document.getElementById('groupsPanelTitle')?.textContent ?? null,
      networksTitle: document.getElementById('networksPanelTitle')?.textContent ?? null,
      placeholders: document.querySelectorAll('#viewGroupsText, #viewNetworksText, .view-placeholder').length,
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

/**
 * Reads the AP groups master list: per item its group id, element and type,
 * name, badges (and the Capacity warning badge's details), counts line, the
 * strong empty-group label, aria-current and tabindex.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<Array<{ id: string; tag: string; type: string | null; name: string; badges: string[]; capacity: object | null; meta: string; silence: string | null; current: string | null; tabIndex: number }>>}
 */
function readGroupItems(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#groupList .master-item')).map((item) => ({
    id: item.dataset.groupId,
    tag: item.tagName.toLowerCase(),
    type: item.getAttribute('type'),
    name: item.querySelector('.item-name')?.textContent ?? '',
    badges: Array.from(item.querySelectorAll('.badge')).map((badge) => badge.textContent),
    // The Capacity warning badge (AP-group management, phase 16b): visible
    // label, tooltip, full bands, visually hidden text (and that it is
    // clipped to at most 1 px), or null
    capacity: (() => {
      const badge = item.querySelector('.badge-capacity');
      const hidden = badge?.querySelector('.visually-hidden') ?? null;
      return badge ? {
        label: badge.firstChild?.nodeValue ?? '',
        title: badge.title,
        bands: badge.dataset.bands ?? '',
        hidden: hidden?.textContent ?? null,
        hiddenClipped: hidden !== null && getComputedStyle(hidden).clipPath !== 'none' && hidden.getBoundingClientRect().width <= 1,
      } : null;
    })(),
    meta: item.querySelector('.master-item-meta')?.textContent ?? '',
    silence: item.querySelector('.is-silence')?.textContent ?? null,
    current: item.getAttribute('aria-current'),
    tabIndex: item.tabIndex,
  })));
} // End of function readGroupItems()

/**
 * Reads the Wi-Fi networks master list: per item its network name (data
 * attribute), element, label, scope, aria-current and tabindex.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<Array<{ name: string; tag: string; label: string; scope: string; current: string | null; tabIndex: number }>>}
 */
function readNetworkItems(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#networkList .master-item')).map((item) => ({
    name: item.dataset.networkName,
    tag: item.tagName.toLowerCase(),
    label: item.querySelector('.item-name')?.textContent ?? '',
    scope: item.querySelector('.network-scope')?.textContent ?? '',
    current: item.getAttribute('aria-current'),
    tabIndex: item.tabIndex,
  })));
} // End of function readNetworkItems()

/**
 * Reads a master list's state: its empty / no-results text, the Clear
 * search button, the aria-live results summary, the search field's value
 * and the focused element's id.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {{ list: string; summary: string; search: string; clear: string }} ids - Element ids.
 * @returns {Promise<{ empty: string | null; clear: string | null; summary: string; live: string | null; search: string | null; focus: string }>}
 */
function readListState(page, ids) {
  return page.evaluate((elementIds) => ({
    empty: document.querySelector(`#${elementIds.list} .empty-state p`)?.textContent ?? null,
    clear: document.getElementById(elementIds.clear)?.textContent ?? null,
    summary: document.getElementById(elementIds.summary)?.textContent ?? '',
    live: document.getElementById(elementIds.summary)?.getAttribute('aria-live') ?? null,
    search: document.getElementById(elementIds.search)?.value ?? null,
    focus: document.activeElement?.id || '',
  }), ids);
} // End of function readListState()

/**
 * Reads a detail pane (the AP details, a group's or a network's detail):
 * the heading (text and tag), badges, summary line, facts (label, value,
 * status label, link), sections (title, rows with link text / status /
 * meta, links with kind, target, text and element, notes, strong
 * empty-group notes), the top-level notes and the empty-state text.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} selector - CSS selector of the pane's content element.
 * @returns {Promise<object | null>} The pane's content, or null when absent.
 */
function readDetailPane(page, selector) {
  return page.evaluate((paneSelector) => {
    const root = document.querySelector(paneSelector);
    if (!root) return null;
    /**
     * Reads the cross-links inside an element.
     * @param {Element} container - The element.
     * @returns {object[]} Kind, target, text, tag and type of each link.
     */
    const linksOf = (container) => Array.from(container.querySelectorAll('.cross-link')).map((link) => ({
      kind: link.dataset.linkKind, target: link.dataset.linkTarget, text: link.textContent, tag: link.tagName.toLowerCase(), type: link.getAttribute('type'),
    }));
    const sections = {};
    for (const section of root.querySelectorAll('.detail-section')) {
      sections[section.dataset.section] = {
        title: section.querySelector('.detail-section-title')?.textContent ?? '',
        rows: Array.from(section.querySelectorAll('.detail-link-row')).map((row) => ({
          link: row.querySelector('.cross-link')?.textContent ?? null,
          status: row.querySelector('.status-label')?.textContent ?? null,
          meta: row.querySelector('.detail-meta')?.textContent ?? null,
        })),
        links: linksOf(section),
        notes: Array.from(section.querySelectorAll('.detail-note')).map((note) => note.textContent),
        silence: Array.from(section.querySelectorAll('.detail-note.is-silence')).map((note) => note.textContent),
      };
    } // End of the loop over the sections
    const facts = {};
    for (const fact of root.querySelectorAll('.detail-fact')) {
      const value = fact.querySelector('dd');
      const link = value?.querySelector('.cross-link');
      facts[fact.dataset.fact] = {
        label: fact.querySelector('dt')?.textContent ?? '',
        value: value?.textContent ?? '',
        status: value?.querySelector('.status-label')?.textContent ?? null,
        link: link ? { kind: link.dataset.linkKind, target: link.dataset.linkTarget } : null,
      };
    }
    const heading = root.querySelector('.detail-name');
    return {
      heading: heading?.textContent ?? null,
      headingTag: heading?.tagName.toLowerCase() ?? null,
      badges: Array.from(root.querySelectorAll('.detail-header .badge')).map((badge) => badge.textContent),
      summary: root.querySelector('.detail-summary')?.textContent ?? null,
      facts,
      sections,
      notes: Array.from(root.querySelectorAll(':scope > .detail-note')).map((note) => ({ kind: note.dataset.note, text: note.textContent })),
      empty: root.querySelector('.empty-state p')?.textContent ?? null,
    };
  }, selector); // End of the in-page detail probe
} // End of function readDetailPane()

/**
 * Reads the cross-navigation state: the shown view, the Back bar, the AP
 * details and destination panes, the AP rows marked as viewed, the views'
 * searches and selections, the AP list's scroll offset and the focused
 * element (id, link kind and target, nearest ancestor with an id, data keys).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The state.
 */
function readInventory(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    return {
      shown: ['viewAccessPoints', 'viewGroups', 'viewNetworks'].filter((id) => !document.getElementById(id)?.hidden),
      backHidden: Boolean(document.getElementById('backBar')?.hidden),
      backLabel: document.getElementById('backBtnLabel')?.textContent ?? null,
      apDetailsHidden: Boolean(document.getElementById('apDetailsPanel')?.hidden),
      destinationHidden: Boolean(document.getElementById('destinationPanel')?.hidden),
      apDetailsTitle: document.getElementById('apDetailsPanelTitle')?.textContent ?? null,
      closeText: document.getElementById('closeApDetailsBtn')?.textContent ?? null,
      viewingMacs: Array.from(document.querySelectorAll('#apList .ap-row.is-viewing')).map((row) => row.dataset.mac),
      groupSearch: document.getElementById('groupSearch')?.value ?? null,
      networkSearch: document.getElementById('networkSearch')?.value ?? null,
      currentGroup: document.querySelector('#groupList .master-item[aria-current="true"]')?.dataset.groupId ?? null,
      currentNetwork: document.querySelector('#networkList .master-item[aria-current="true"]')?.dataset.networkName ?? null,
      apListScroll: document.getElementById('apList')?.scrollTop ?? null,
      focus: {
        id: active?.id || '',
        linkKind: active?.dataset?.linkKind ?? null,
        linkTarget: active?.dataset?.linkTarget ?? null,
        inside: active?.parentElement?.closest('[id]')?.id ?? null,
        groupId: active?.dataset?.groupId ?? null,
        mac: active?.dataset?.mac ?? null,
      },
    };
  }); // End of the in-page cross-navigation probe
} // End of function readInventory()

/**
 * Reads the §4.6 state of each list (AP list, destination list, AP groups
 * list, Wi-Fi networks list): the state block's state (data-state, or
 * 'loading' for the skeleton), its message (first paragraph), its actions
 * (data-state-action and text), whether it is an alert, and the skeleton's
 * role and accessible name.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<Record<string, { state: string | null; text: string | null; actions: string[][]; alert: boolean; skeletonRole: string | null; skeletonLabel: string | null; skeletonRows: number }>>}
 */
function readStateBlocks(page) {
  return page.evaluate(() => Object.fromEntries(['apList', 'destinationList', 'groupList', 'networkList'].map((id) => {
    const list = document.getElementById(id);
    const block = list?.querySelector('.state-block') ?? null;
    const skeleton = list?.querySelector('.skeleton-list') ?? null;
    return [id, {
      state: block?.dataset.state ?? (skeleton ? 'loading' : null),
      text: block?.querySelector('p')?.textContent ?? null,
      actions: Array.from(block?.querySelectorAll('[data-state-action]') ?? []).map((button) => [button.dataset.stateAction, button.textContent]),
      alert: block?.getAttribute('role') === 'alert',
      skeletonRole: skeleton?.getAttribute('role') ?? null,
      skeletonLabel: skeleton?.getAttribute('aria-label') ?? null,
      skeletonRows: skeleton?.querySelectorAll('.skeleton-row').length ?? 0,
    }];
  }))); // End of the in-page state-block probe
} // End of function readStateBlocks()

/**
 * Reads the notices above the views — the read-only banner (shown, reason
 * code, text, role) and the refresh notice (shown, text, Retry) — and the
 * header's stale mark on "Updated hh:mm" (class and tooltip).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The notices.
 */
function readNotices(page) {
  return page.evaluate(() => {
    const banner = document.getElementById('readOnlyBanner');
    const notice = document.getElementById('refreshNotice');
    const updated = document.getElementById('lastUpdated');
    return {
      bannerShown: Boolean(banner && !banner.hidden),
      bannerReason: banner?.dataset.reason ?? null,
      bannerText: document.getElementById('readOnlyBannerText')?.textContent ?? '',
      bannerRole: banner?.getAttribute('role') ?? null,
      noticeShown: Boolean(notice && !notice.hidden),
      noticeText: document.getElementById('refreshNoticeText')?.textContent ?? '',
      noticeRetry: document.getElementById('refreshNoticeRetryBtn')?.textContent ?? '',
      stale: Boolean(updated?.classList.contains('is-stale')),
      staleTitle: updated?.title ?? '',
    };
  }); // End of the in-page notices probe
} // End of function readNotices()

/**
 * Reads the responsive layout: the window size, horizontal overflow (the
 * document, and every shown header, sidebar, view area, panel, notice or
 * Back bar whose content is wider than its box), the sidebar's and the view
 * area's boxes, the first sidebar entry's label (box, text), tooltip, icon
 * and count, the boxes of the panes actually shown (visible, not off stage),
 * the single-pane controls ("Choose destination", the drill-in Backs, Close
 * details) and the focused element.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The layout.
 */
function readLayout(page) {
  return page.evaluate(() => {
    /**
     * Tells whether an element is rendered and visible (not hidden, not
     * display:none, not visibility:hidden, with a size).
     * @param {Element | null} element - The element.
     * @returns {boolean} True when visible.
     */
    const visible = (element) => Boolean(element && element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }) &&
      element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
    /**
     * Returns an element's rounded box.
     * @param {Element} element - The element.
     * @returns {{ left: number; top: number; right: number; bottom: number; width: number; height: number }} Its box.
     */
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const panes = {};
    for (const id of ['apPanel', 'destinationPanel', 'apDetailsPanel', 'groupMasterPanel', 'groupDetailPanel', 'networkMasterPanel', 'networkDetailPanel']) {
      const element = document.getElementById(id);
      panes[id] = visible(element) ? box(element) : null;
    }
    const overflowing = Array.from(document.querySelectorAll('.title-bar, .sidebar, .view-area, .panel, .view-notice, .back-bar'))
      .filter((element) => visible(element) && element.scrollWidth > element.clientWidth + 1)
      .map((element) => `${element.id || element.className} (${element.scrollWidth} > ${element.clientWidth})`);
    const nav = document.getElementById('navAccessPoints');
    const label = nav.querySelector('.nav-label');
    const active = document.activeElement;
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      docScrollHeight: document.documentElement.scrollHeight,
      docClientHeight: document.documentElement.clientHeight,
      overflowing,
      sidebar: box(document.getElementById('viewNav')),
      viewArea: box(document.getElementById('viewArea')),
      label: box(label),
      labelText: label.textContent,
      navTitle: nav.title,
      icon: visible(nav.querySelector('.nav-icon')),
      count: visible(nav.querySelector('.nav-count')),
      settings: visible(document.getElementById('settingsBtn')) ? box(document.getElementById('settingsBtn')) : null,
      panes,
      openDestination: visible(document.getElementById('openDestinationBtn')),
      backs: Object.fromEntries(['destinationBackBtn', 'apDetailsBackBtn', 'groupDetailBackBtn', 'networkDetailBackBtn'].map((id) => [id, visible(document.getElementById(id))])),
      closeDetails: visible(document.getElementById('closeApDetailsBtn')),
      activeId: active?.id || '',
      activePanel: active?.closest('.panel')?.id ?? null,
      activeGroupId: active?.dataset?.groupId ?? null,
      activeMac: active?.dataset?.mac ?? null,
    };
  }); // End of the in-page layout probe
} // End of function readLayout()

/**
 * Resizes the window's content area and waits until the page lays out at
 * the new width.
 * @param {object} session - The launch.
 * @param {number} width - Content width in px.
 * @param {number} height - Content height in px.
 * @returns {Promise<void>}
 */
async function resizeContent(session, width, height) {
  await session.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
  await session.page.waitForFunction((expected) => window.innerWidth === expected.width && window.innerHeight === expected.height, { width, height }, { timeout: WAIT_MS });
}

/**
 * Resizes the window's content area, then waits two more animation frames
 * so the layout's media-query listener (which relocates focus a resize
 * hides) has run.
 * @param {object} session - The launch.
 * @param {number} width - Content width in px.
 * @param {number} height - Content height in px.
 * @returns {Promise<void>}
 */
async function resizeAndSettle(session, width, height) {
  await resizeContent(session, width, height);
  await session.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * Reads where keyboard focus is and whether the user can see it: the
 * focused element (null when focus fell back to <body>), its panel and data
 * attributes, and whether it is visible — rendered with boxes, not
 * display:none or visibility:hidden, and outside any inert or hidden
 * subtree and (below 800 px) any off-stage pane.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The focus probe.
 */
function readFocus(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const element = active instanceof HTMLElement && active !== document.body ? active : null;
    const singlePane = window.matchMedia('(max-width: 799px)').matches;
    const rects = element ? element.getClientRects().length : 0;
    const cssVisible = Boolean(element?.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }));
    const hiddenSubtree = Boolean(element && (element.closest('[inert], [hidden]') !== null || (singlePane && element.closest('.is-offstage') !== null)));
    return {
      width: window.innerWidth,
      id: element?.id || '',
      checkbox: Boolean(element?.classList.contains('ap-checkbox')),
      panel: element?.closest('.panel')?.id ?? null,
      groupId: element?.dataset.groupId ?? null,
      networkName: element?.dataset.networkName ?? null,
      current: element?.getAttribute('aria-current') === 'true',
      rects,
      cssVisible,
      hiddenSubtree,
      visible: element !== null && rects > 0 && cssVisible && !hiddenSubtree,
    };
  }); // End of the in-page focus probe
} // End of function readFocus()

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
 * An AP count label: "No APs" / "1 AP" / "N APs", or "AP count unknown" for
 * null (src/renderer/inventory-ui.ts apCountOrUnknown()).
 * @param {'es' | 'en'} language - UI language.
 * @param {number | null} count - The count.
 * @returns {string} The label.
 */
function apCountLabel(language, count) {
  const text = TEXT[language];
  if (count === null) return text.apCountUnknown;
  if (count === 0) return text.apNone;
  return count === 1 ? text.apOne : fmt(text.apMany, { count });
}

/**
 * The AP groups master list the view must show: valid groups sorted by
 * name, each with its AP count (unknown when another group has its name),
 * "N networks" or the §4.1 empty-group label, and the Default badge only
 * for a group the fixture flags with isDefault.
 * @param {object[]} accessPoints - AccessPoint DTOs served by the stub.
 * @param {object[]} wlanGroups - WlanGroup DTOs served by the stub.
 * @param {'es' | 'en'} language - UI language.
 * @returns {Array<{ id: string; name: string; badges: string[]; meta: string }>}
 */
function expectedGroupItems(accessPoints, wlanGroups, language) {
  const text = TEXT[language];
  const groups = wlanGroups.filter((group) => WLAN_ID_REGEX.test(group.wlanId)).sort((a, b) => a.wlanName.localeCompare(b.wlanName));
  const aps = accessPoints.filter((ap) => MAC_REGEX.test(ap.mac));
  return groups.map((group) => {
    const shared = groups.filter((other) => other.wlanName === group.wlanName).length > 1;
    const count = shared ? null : aps.filter((ap) => ap.wlanGroup === group.wlanName).length;
    const names = new Set(group.ssidList.map((ssid) => ssid.ssidName));
    let networks = text.emptyGroup;
    if (names.size > 0) {
      networks = names.size === 1 ? text.networksOne : fmt(text.networksMany, { count: names.size });
    }
    return { id: group.wlanId, name: group.wlanName, badges: group.isDefault === true ? [text.badgeDefault] : [], meta: `${apCountLabel(language, count)} · ${networks}` };
  }); // End of the expected-group mapping
} // End of function expectedGroupItems()

/**
 * A network's scope (src/renderer/inventory-ui.ts scopeText()): "N groups ·
 * M APs" when every AP is placed; otherwise "at least M APs" (or "AP count
 * unknown" when M is 0) followed by how many APs' groups cannot be identified.
 * @param {'es' | 'en'} language - UI language.
 * @param {number} groupCount - Groups broadcasting the network.
 * @param {number} apCount - APs known to broadcast it.
 * @param {number} unknownCount - APs that may broadcast it.
 * @returns {string} The scope.
 */
function scopeLabel(language, groupCount, apCount, unknownCount) {
  const text = TEXT[language];
  const groups = groupCount === 1 ? text.groupOne : fmt(text.groupMany, { count: groupCount });
  if (unknownCount === 0) return `${groups} · ${apCountLabel(language, apCount)}`;
  let aps = text.apCountUnknown;
  if (apCount > 0) {
    aps = apCount === 1 ? text.apAtLeastOne : fmt(text.apAtLeastMany, { count: apCount });
  }
  const reason = unknownCount === 1 ? text.scopeUnknownOne : fmt(text.scopeUnknownMany, { count: unknownCount });
  return `${groups} · ${aps}; ${reason}`;
} // End of function scopeLabel()

/**
 * The Wi-Fi networks master list the view must show: one entry per distinct
 * network name of the valid groups, sorted, with its scope: the APs whose
 * group name no other group shares and that group broadcasts the network,
 * and the APs that may broadcast it (no group, a group not listed, or a
 * shared name one of whose groups broadcasts it).
 * @param {object[]} accessPoints - AccessPoint DTOs served by the stub.
 * @param {object[]} wlanGroups - WlanGroup DTOs served by the stub.
 * @param {'es' | 'en'} language - UI language.
 * @returns {Array<{ name: string; label: string; scope: string }>}
 */
function expectedNetworkItems(accessPoints, wlanGroups, language) {
  const groups = wlanGroups.filter((group) => WLAN_ID_REGEX.test(group.wlanId));
  const aps = accessPoints.filter((ap) => MAC_REGEX.test(ap.mac));
  const byNetwork = new Map();
  for (const group of groups) {
    for (const name of new Set(group.ssidList.map((ssid) => ssid.ssidName))) {
      byNetwork.set(name, [...(byNetwork.get(name) ?? []), group]);
    }
  } // End of the loop that indexes the groups by network name
  /**
   * Whether an AP broadcasts a network: 'yes', 'no' or 'maybe'.
   * @param {object} ap - The AP.
   * @param {object[]} broadcasting - The groups broadcasting the network.
   * @returns {string} The placement.
   */
  const placement = (ap, broadcasting) => {
    const named = groups.filter((group) => group.wlanName === ap.wlanGroup);
    if (ap.wlanGroup === '' || named.length === 0) return 'maybe';
    if (!named.some((group) => broadcasting.includes(group))) return 'no';
    return named.length === 1 ? 'yes' : 'maybe';
  };
  return Array.from(byNetwork)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, broadcasting]) => {
      const placements = aps.map((ap) => placement(ap, broadcasting));
      const apCount = placements.filter((value) => value === 'yes').length;
      const unknownCount = placements.filter((value) => value === 'maybe').length;
      return { name, label: name, scope: scopeLabel(language, broadcasting.length, apCount, unknownCount) };
    });
} // End of function expectedNetworkItems()

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
 * Spanish launch, the read-only AP groups and Wi-Fi networks views, the AP
 * details pane and cross-navigation (phase 14a): the group list (counts,
 * the Default badge, the empty groups with the §4.1 label), its search and
 * detail (linked APs and networks, an empty group, no edit controls), the
 * network list (one entry per distinct name, scopes), its search and detail
 * (linked groups and APs, the unidentified AP stated apart, the fields that
 * need management access stated), the AP details pane opened by a row click
 * (the checkbox alone toggles; Enter on a checkbox opens the details;
 * Close), a cross-navigation round trip at 700×500 whose Back restores view,
 * selection, search, scroll and focus, and the sidebar emptying the Back
 * history; then the phase 14a review regressions: a twin group making the
 * network scopes lower bounds / unknown with their reason, and a refresh
 * that removes an AP kept in the Back history (Back skips it). Runs on the
 * fixture data before any move (each regression check restores it); ends
 * on the Access points view with no selection, no details pane, no Back
 * history and no view search.
 * @param {object} session - The Spanish launch.
 * @returns {Promise<void>}
 */
async function runInventoryChecks(session) {
  const { page } = session;
  const es = TEXT.es;
  /**
   * Selector of a group's master item.
   * @param {string} id - Group id.
   * @returns {string} The CSS selector.
   */
  const groupItem = (id) => `#groupList .master-item[data-group-id="${id}"]`;
  /**
   * Selector of a network's master item.
   * @param {string} name - Network name.
   * @returns {string} The CSS selector.
   */
  const networkItem = (name) => `#networkList .master-item[data-network-name="${name}"]`;
  /**
   * Selector of a fixture AP's checkbox.
   * @param {string} name - AP name.
   * @returns {string} The CSS selector.
   */
  const box = (name) => `#apList .ap-checkbox[data-mac="${AP[name].mac}"]`;
  /**
   * Selector of a part of a fixture AP's row outside its checkbox (the group text).
   * @param {string} name - AP name.
   * @returns {string} The CSS selector.
   */
  const rowGroup = (name) => `#apList .ap-row[data-mac="${AP[name].mac}"] .ap-row-group`;
  /**
   * The status label of a fixture AP.
   * @param {string} name - AP name.
   * @returns {string} The Spanish status label.
   */
  const statusOf = (name) => es.status[AP[name].statusCategory] ?? es.statusUnknown;
  /**
   * Lists the buttons and fields of a view other than its master items,
   * cross-links, search and single-pane Back (rename / new / delete / edit
   * controls must not exist).
   * @param {string} viewId - The view's id.
   * @returns {Promise<string[]>} Their ids or classes.
   */
  const otherControls = (viewId) => page.evaluate((id) => Array.from(document.querySelectorAll(`#${id} button, #${id} input, #${id} select`))
    .filter((element) => !element.classList.contains('master-item') && !element.classList.contains('cross-link') && !element.classList.contains('drill-back') && element.type !== 'text')
    .map((element) => element.id || element.className), viewId);
  // The APs of the Default group, in list order (sorted by name)
  const defaultAps = ['EAP Carpio', 'Garaje', 'Porche', 'Salón'];

  await check('[es] AP groups view: every group (empty ones included) as a native button with its AP and network counts, "Predeterminado" only on the group the controller flags as default, the §4.1 label on the groups without networks, one Tab stop, and a prompt in the detail', async () => {
    await page.click('#navGroups');
    const items = await readGroupItems(page);
    const expected = expectedGroupItems(data.accessPoints, data.wlanGroups, 'es');
    const detail = await readDetailPane(page, '#groupDetail');
    const nav = await readNav(page);
    const actual = items.map(({ id, name, badges, meta }) => ({ id, name, badges, meta }));
    return verdict(
      isDeepStrictEqual(actual, expected) && items.every((item) => item.tag === 'button' && item.type === 'button' && item.current === null) &&
      isDeepStrictEqual(items.filter((item) => item.silence !== null).map((item) => item.name), ['Exterior', 'zNinguna']) &&
      items.filter((item) => item.tabIndex === 0).length === 1 && detail?.empty === es.groupDetailPrompt &&
      isDeepStrictEqual(nav.shown, ['viewGroups']) && nav.groups.current === 'page' && nav.groupsTitle === es.groupsTitle.apGroup,
      { actual, expected, items, detail, nav }
    );
  }); // End of check "[es] AP groups view..."

  await check('[es] AP groups search over group and network names: "invit" finds Default by its network with "Se muestran 1 de 4" (aria-live); no match says so and "Borrar búsqueda" restores the list with focus in the search; Escape clears it too', async () => {
    const ids = { list: 'groupList', summary: 'groupListSummary', search: 'groupSearch', clear: 'clearGroupSearchBtn' };
    await page.fill('#groupSearch', 'invit');
    const byNetwork = await readListState(page, ids);
    const byNetworkNames = (await readGroupItems(page)).map((item) => item.name);
    await page.fill('#groupSearch', 'zzz');
    const none = await readListState(page, ids);
    await page.click('#clearGroupSearchBtn');
    const cleared = await readListState(page, ids);
    const clearedCount = (await readGroupItems(page)).length;
    await page.fill('#groupSearch', 'ningu');
    const narrowed = (await readGroupItems(page)).map((item) => item.name);
    await page.keyboard.press('Escape');
    const escaped = await readListState(page, ids);
    const escapedCount = (await readGroupItems(page)).length;
    return verdict(
      isDeepStrictEqual(byNetworkNames, ['Default']) && byNetwork.summary === fmt(es.searchCount, { shown: 1, total: 4 }) && byNetwork.live === 'polite' &&
      none.empty === fmt(es.noMatchingGroups, { query: 'zzz' }) && none.clear === es.clearSearch &&
      cleared.search === '' && cleared.focus === 'groupSearch' && cleared.summary === '' && clearedCount === 4 &&
      isDeepStrictEqual(narrowed, ['zNinguna']) && escaped.search === '' && escaped.summary === '' && escapedCount === 4,
      { byNetworkNames, byNetwork, none, cleared, clearedCount, narrowed, escaped, escapedCount }
    );
  }); // End of check "[es] AP groups search..."

  await check('[es] AP group detail (Default): selected (aria-current); its name as heading, "Predeterminado", "4 AP · 2 redes", its APs as links with their status, its Wi-Fi networks as read-only links; without management access no rename, new or delete control — the only action is "Mover puntos de acceso aquí" (moves never need it)', async () => {
    await page.click(groupItem(GROUP.Default.wlanId));
    const items = await readGroupItems(page);
    const detail = await readDetailPane(page, '#groupDetail');
    const controls = await otherControls('viewGroups');
    return verdict(
      isDeepStrictEqual(items.filter((item) => item.current === 'true').map((item) => item.id), [GROUP.Default.wlanId]) &&
      detail.heading === 'Default' && detail.headingTag === 'h3' && isDeepStrictEqual(detail.badges, [es.badgeDefault]) &&
      detail.summary === `${fmt(es.apMany, { count: 4 })} · ${fmt(es.networksMany, { count: 2 })}` &&
      detail.sections.aps?.title === `${es.accessPoints} (4)` &&
      isDeepStrictEqual(detail.sections.aps.rows, defaultAps.map((name) => ({ link: name, status: statusOf(name), meta: null }))) &&
      isDeepStrictEqual(detail.sections.aps.links.map((link) => [link.kind, link.target, link.tag, link.type]), defaultAps.map((name) => ['ap', AP[name].mac, 'button', 'button'])) &&
      detail.sections.networks?.title === `${es.wifiNetworks} (2)` &&
      isDeepStrictEqual(detail.sections.networks.links.map((link) => [link.kind, link.target, link.text]), [['network', 'Casa', 'Casa'], ['network', 'Invitados', 'Invitados']]) &&
      isDeepStrictEqual(controls, ['groupMoveHereBtn']),
      { items, detail, controls }
    );
  }); // End of check "[es] AP group detail (Default)..."

  await check('[es] empty AP groups by keyboard: ArrowDown + Enter select Exterior ("Sin AP · Sin redes Wi-Fi — silencia estos AP", "Ningún punto de acceso está en este grupo"), End + Enter select zNinguna ("1 AP", Jardín linked, the strong label instead of networks); focus stays in the list', async () => {
    await page.focus(groupItem(GROUP.Default.wlanId));
    await page.keyboard.press('ArrowDown');
    const afterArrow = await readInventory(page);
    await page.keyboard.press('Enter');
    const exterior = await readDetailPane(page, '#groupDetail');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    const ninguna = await readDetailPane(page, '#groupDetail');
    const after = await readInventory(page);
    return verdict(
      afterArrow.focus.groupId === GROUP.Exterior.wlanId &&
      exterior.heading === 'Exterior' && exterior.badges.length === 0 && exterior.summary === `${es.apNone} · ${es.emptyGroup}` &&
      exterior.sections.aps?.title === `${es.accessPoints} (0)` && isDeepStrictEqual(exterior.sections.aps.notes, [es.noApsInGroup]) &&
      exterior.sections.networks?.title === `${es.wifiNetworks} (0)` && isDeepStrictEqual(exterior.sections.networks.silence, [es.emptyGroup]) &&
      ninguna.heading === 'zNinguna' && ninguna.summary === `${es.apOne} · ${es.emptyGroup}` &&
      isDeepStrictEqual(ninguna.sections.aps?.rows, [{ link: 'Jardín', status: statusOf('Jardín'), meta: null }]) &&
      isDeepStrictEqual(ninguna.sections.networks?.silence, [es.emptyGroup]) && ninguna.sections.networks.links.length === 0 &&
      after.focus.groupId === GROUP.zNinguna.wlanId && after.currentGroup === GROUP.zNinguna.wlanId,
      { afterArrow: afterArrow.focus, exterior, ninguna, after: after.focus }
    );
  }); // End of check "[es] empty AP groups by keyboard..."

  await check('[es] Wi-Fi networks view: one native entry per distinct network name (the sidebar count), sorted, each with its scope "N grupos · M AP"; its own search matches network names ("casa") and group names ("zgrupo": "Se muestran 5 de 7"); the detail asks for a network', async () => {
    await page.click('#navNetworks');
    const items = await readNetworkItems(page);
    const expected = expectedNetworkItems(data.accessPoints, data.wlanGroups, 'es');
    const nav = await readNav(page);
    const detail = await readDetailPane(page, '#networkDetail');
    await page.fill('#networkSearch', 'casa');
    const byName = (await readNetworkItems(page)).map((item) => item.name);
    await page.fill('#networkSearch', 'zgrupo');
    const byGroup = (await readNetworkItems(page)).map((item) => item.name);
    const listState = await readListState(page, { list: 'networkList', summary: 'networkListSummary', search: 'networkSearch', clear: 'clearNetworkSearchBtn' });
    await page.fill('#networkSearch', '');
    const all = (await readNetworkItems(page)).length;
    const zGrupoNetworks = expected.map((item) => item.name).filter((name) => GROUP['zGrupo B'].ssidList.some((ssid) => ssid.ssidName === name));
    return verdict(
      isDeepStrictEqual(items.map(({ name, label, scope }) => ({ name, label, scope })), expected) && String(items.length) === nav.networks.count &&
      items.every((item) => item.tag === 'button' && item.current === null) && isDeepStrictEqual(nav.shown, ['viewNetworks']) &&
      nav.networksTitle === es.wifiNetworks && detail?.empty === es.networkDetailPrompt &&
      isDeepStrictEqual(byName, ['Casa']) && isDeepStrictEqual(byGroup, zGrupoNetworks) && zGrupoNetworks.length === 5 &&
      listState.summary === fmt(es.searchCount, { shown: 5, total: 7 }) && listState.live === 'polite' && all === 7,
      { items, expected, nav, detail, byName, byGroup, listState, all }
    );
  }); // End of check "[es] Wi-Fi networks view..."

  await check('[es] Wi-Fi network detail (Casa): "1 grupo · al menos 4 AP; no se puede identificar el grupo de 1 AP" (Bodega has no group); the group broadcasting it (Default, "4 AP") and the APs that broadcast it as links with their status, Bodega stated apart in the same section (no count in its title); security, bands and enabled state stated as needing management access (nothing invented, no edit control)', async () => {
    await page.click(networkItem('Casa'));
    const detail = await readDetailPane(page, '#networkDetail');
    const current = (await readNetworkItems(page)).filter((item) => item.current === 'true').map((item) => item.name);
    const controls = await otherControls('viewNetworks');
    return verdict(
      isDeepStrictEqual(current, ['Casa']) && detail.heading === 'Casa' &&
      detail.summary === `${es.groupOne} · ${fmt(es.apAtLeastMany, { count: 4 })}; ${es.scopeUnknownOne}` &&
      detail.sections.groups?.title === `${es.groupsTitle.apGroup} (1)` &&
      isDeepStrictEqual(detail.sections.groups.rows, [{ link: 'Default', status: null, meta: fmt(es.apMany, { count: 4 }) }]) &&
      isDeepStrictEqual(detail.sections.groups.links.map((link) => [link.kind, link.target]), [['group', GROUP.Default.wlanId]]) &&
      detail.sections.aps?.title === es.accessPoints &&
      isDeepStrictEqual(detail.sections.aps.rows, defaultAps.map((name) => ({ link: name, status: statusOf(name), meta: null }))) &&
      isDeepStrictEqual(detail.sections.aps.notes, [es.networkUnknownOne]) &&
      isDeepStrictEqual(detail.notes, [{ kind: 'managementOnly', text: es.managementOnly }]) &&
      controls.length === 0,
      { current, detail, controls }
    );
  }); // End of check "[es] Wi-Fi network detail (Casa)..."

  await check('[es] AP details by row click: a click on EAP Carpio\'s row (not its checkbox) opens "Detalles del AP" in the destination pane\'s place with focus on its name: status, MAC, its AP group as a link, clients, its group\'s networks as links and the statement that per-AP overrides cannot be shown; the checkbox stays unchecked', async () => {
    await page.click('#navAccessPoints');
    await page.click(rowGroup('EAP Carpio'));
    await page.waitForFunction(() => document.activeElement?.id === 'apDetailsName', null, { timeout: WAIT_MS });
    const inventory = await readInventory(page);
    const detail = await readDetailPane(page, '#apDetailsContent');
    const selection = await readSelection(page);
    return verdict(
      inventory.apDetailsHidden === false && inventory.destinationHidden === true && inventory.apDetailsTitle === es.apDetailsTitle &&
      inventory.closeText === es.closeDetails && isDeepStrictEqual(inventory.viewingMacs, [AP['EAP Carpio'].mac]) &&
      detail.heading === 'EAP Carpio' && detail.headingTag === 'h3' &&
      detail.facts.status?.label === es.statusLabel && detail.facts.status?.status === statusOf('EAP Carpio') &&
      detail.facts.mac?.label === es.macLabel && detail.facts.mac?.value === AP['EAP Carpio'].mac &&
      detail.facts.group?.label === es.groupLabel.apGroup && detail.facts.group?.value === 'Default' &&
      isDeepStrictEqual(detail.facts.group?.link, { kind: 'group', target: GROUP.Default.wlanId }) &&
      detail.facts.clients?.label === es.clientsLabel && detail.facts.clients?.value === es.clientsOne &&
      detail.sections.networks?.title === `${es.wifiNetworks} (2)` &&
      isDeepStrictEqual(detail.sections.networks.links.map((link) => [link.kind, link.target]), [['network', 'Casa'], ['network', 'Invitados']]) &&
      isDeepStrictEqual(detail.notes, [{ kind: 'overrides', text: es.apOverrides }]) &&
      selection.checked.length === 0 && selection.summary === expectedSummary('es', 0, 0),
      { inventory, detail, selection }
    );
  }); // End of check "[es] AP details by row click..."

  await check('[es] AP details: only the checkbox toggles the selection (a Shift-click range too) while the pane stays on EAP Carpio; Enter on Bodega\'s checkbox opens its details ("Sin asignar", networks unknown) without toggling it; "Cerrar detalles" brings the destination pane back with focus on Bodega\'s checkbox', async () => {
    await page.click(box('Altillo'));
    await page.click(box('EAP Carpio'), { modifiers: ['Shift'] });
    const ranged = await readSelection(page);
    const stillCarpio = (await readDetailPane(page, '#apDetailsContent'))?.heading;
    await page.click('#clearApSelectionBtn');
    await page.focus(box('Bodega'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'apDetailsName', null, { timeout: WAIT_MS });
    const bodega = await readDetailPane(page, '#apDetailsContent');
    const afterEnter = await readSelection(page);
    await page.click('#closeApDetailsBtn');
    const closed = await readInventory(page);
    const selection = await readSelection(page);
    return verdict(
      isDeepStrictEqual(ranged.checked, [AP.Altillo.mac, AP.Bodega.mac, AP['EAP Carpio'].mac]) && stillCarpio === 'EAP Carpio' &&
      bodega.heading === 'Bodega' && bodega.facts.group?.value === es.unassigned && bodega.facts.group?.link === null &&
      bodega.facts.clients?.value === es.clientsNotReported && bodega.sections.networks?.title === es.wifiNetworks &&
      isDeepStrictEqual(bodega.sections.networks.notes, [es.apNetworksUnknown]) && bodega.sections.networks.links.length === 0 &&
      afterEnter.checked.length === 0 &&
      closed.apDetailsHidden === true && closed.destinationHidden === false && closed.viewingMacs.length === 0 &&
      selection.activeMac === AP.Bodega.mac,
      { ranged, stillCarpio, bodega, afterEnter, closed, selection }
    );
  }); // End of check "[es] AP details: only the checkbox toggles the selection..."

  await check('[es] cross-navigation round trip at 700×500: AP details (EAP Carpio, the AP list scrolled) → its group (Default, "Volver a EAP Carpio") → one of its networks (Casa, "Volver a Default") → Back → Back restores each view with its selection, search and scroll, focus back on the link followed, no Back bar at the end; the checkbox selection (Altillo) is untouched and everything stays inside the window', async () => {
    await page.click(box('Altillo'));
    await page.click('#navGroups');
    await page.fill('#groupSearch', 'def');
    await page.click('#navAccessPoints');
    await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 500));
    try {
      await page.waitForFunction(() => window.innerWidth <= 700 && window.innerHeight <= 500, null, { timeout: WAIT_MS });
      await page.click(rowGroup('EAP Carpio'));
      await page.waitForFunction(() => document.activeElement?.id === 'apDetailsName', null, { timeout: WAIT_MS });
      const listScroll = await page.evaluate(() => {
        const list = document.getElementById('apList');
        list.scrollTop = list.scrollHeight;
        return list.scrollTop;
      });
      await page.click('#apDetailsContent .cross-link[data-link-kind="group"]');
      await page.waitForFunction(() => document.activeElement?.id === 'groupDetailName', null, { timeout: WAIT_MS });
      const atGroup = await readInventory(page);
      await page.click('#groupDetail .cross-link[data-link-kind="network"][data-link-target="Casa"]');
      await page.waitForFunction(() => document.activeElement?.id === 'networkDetailName', null, { timeout: WAIT_MS });
      const atNetwork = await readInventory(page);
      const layout = await page.evaluate(() => {
        /**
         * Tells whether an element is rendered entirely inside the window.
         * @param {string} id - The element id.
         * @returns {boolean} True when it has a size and fits the viewport.
         */
        const inside = (id) => {
          const rect = document.getElementById(id)?.getBoundingClientRect();
          return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight);
        };
        return {
          scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
          width: window.innerWidth, height: window.innerHeight,
          back: inside('backBtn'), heading: inside('networkDetailName'), search: inside('networkSearch'),
        };
      }); // End of the in-page layout probe
      await page.click('#backBtn');
      const backAtGroup = await readInventory(page);
      await page.click('#backBtn');
      const backAtAp = await readInventory(page);
      const apDetail = await readDetailPane(page, '#apDetailsContent');
      const selection = await readSelection(page);
      return verdict(
        listScroll > 0 &&
        isDeepStrictEqual(atGroup.shown, ['viewGroups']) && atGroup.currentGroup === GROUP.Default.wlanId && atGroup.groupSearch === 'def' &&
        atGroup.backHidden === false && atGroup.backLabel === fmt(es.backTo, { target: 'EAP Carpio' }) &&
        isDeepStrictEqual(atNetwork.shown, ['viewNetworks']) && atNetwork.currentNetwork === 'Casa' &&
        atNetwork.backLabel === fmt(es.backTo, { target: 'Default' }) &&
        layout.scrollWidth <= layout.width && layout.scrollHeight <= layout.height && layout.back && layout.heading && layout.search &&
        isDeepStrictEqual(backAtGroup.shown, ['viewGroups']) && backAtGroup.currentGroup === GROUP.Default.wlanId && backAtGroup.groupSearch === 'def' &&
        backAtGroup.focus.linkKind === 'network' && backAtGroup.focus.linkTarget === 'Casa' && backAtGroup.focus.inside === 'groupDetail' &&
        backAtGroup.backHidden === false && backAtGroup.backLabel === fmt(es.backTo, { target: 'EAP Carpio' }) &&
        isDeepStrictEqual(backAtAp.shown, ['viewAccessPoints']) && backAtAp.apDetailsHidden === false && apDetail?.heading === 'EAP Carpio' &&
        Math.abs(backAtAp.apListScroll - listScroll) <= 1 && backAtAp.focus.linkKind === 'group' && backAtAp.focus.linkTarget === GROUP.Default.wlanId &&
        backAtAp.focus.inside === 'apDetailsContent' && backAtAp.backHidden === true &&
        isDeepStrictEqual(selection.checked, [AP.Altillo.mac]),
        { listScroll, atGroup, atNetwork, layout, backAtGroup, backAtAp, apDetail: apDetail?.heading, selection }
      );
    } finally {
      await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
    }
  }); // End of check "[es] cross-navigation round trip at 700×500..."

  await check('[es] the sidebar starts a fresh navigation: after following a link the Back bar shows; a sidebar entry hides it (history emptied) and every view keeps its selection', async () => {
    await page.click('#apDetailsContent .cross-link[data-link-kind="group"]');
    await page.waitForFunction(() => document.activeElement?.id === 'groupDetailName', null, { timeout: WAIT_MS });
    const followed = await readInventory(page);
    await page.click('#navNetworks');
    const sidebar = await readInventory(page);
    await page.click('#navAccessPoints');
    const back = await readInventory(page);
    return verdict(
      followed.backHidden === false && isDeepStrictEqual(followed.shown, ['viewGroups']) &&
      sidebar.backHidden === true && isDeepStrictEqual(sidebar.shown, ['viewNetworks']) && sidebar.currentNetwork === 'Casa' &&
      back.backHidden === true && back.apDetailsHidden === false && back.currentGroup === GROUP.Default.wlanId,
      { followed, sidebar, back }
    );
  }); // End of check "[es] the sidebar starts a fresh navigation..."

  await check('[es] back to the Access points list for the move checks: details closed (the destination pane is back), nothing selected, no view search, no Back bar', async () => {
    await page.click('#closeApDetailsBtn');
    await page.click('#clearApSelectionBtn');
    await page.click('#navGroups');
    await page.fill('#groupSearch', '');
    await page.click('#navAccessPoints');
    const inventory = await readInventory(page);
    const selection = await readSelection(page);
    return verdict(
      isDeepStrictEqual(inventory.shown, ['viewAccessPoints']) && inventory.apDetailsHidden === true && inventory.destinationHidden === false &&
      inventory.groupSearch === '' && inventory.networkSearch === '' && inventory.backHidden === true && selection.checked.length === 0,
      { inventory, selection }
    );
  }); // End of check "[es] back to the Access points list..."

  await check('[es] regression (phase 14a review): a twin "Default" broadcasting Casa appears on refresh: every network scope reads as a lower bound or unknown with the reason ("2 grupos · Nº de AP desconocido; no se puede identificar el grupo de 5 AP", "1 grupo · al menos 1 AP; …"), never an exact count or "Sin AP"; Casa\'s detail lists no AP, states the 5 APs that may broadcast it (no "Ningún punto de acceso…" note) and both twins\' AP counts as unknown; the scopes come back once the twin is gone', async () => {
    const twin = { wlanId: '6512a0e1f3b2c41d2e3f4a60', wlanName: 'Default', ssidList: [{ ssidName: 'Casa' }] };
    const twinGroups = [...data.wlanGroups, twin];
    await page.click('#navNetworks');
    await configureStub(session, { wlanGroups: twinGroups });
    await page.click('#refreshBtn');
    await page.waitForSelector(groupItem(twin.wlanId), { state: 'attached', timeout: WAIT_MS });
    await waitForLoadIdle(page);
    const items = await readNetworkItems(page);
    const expected = expectedNetworkItems(data.accessPoints, twinGroups, 'es');
    await page.click(networkItem('Casa'));
    const detail = await readDetailPane(page, '#networkDetail');
    // The listing without the twin comes back for the checks that follow
    await configureStub(session, { wlanGroups: data.wlanGroups });
    await page.click('#refreshBtn');
    await page.waitForFunction((selector) => document.querySelector(selector) === null, groupItem(twin.wlanId), { timeout: WAIT_MS });
    await waitForLoadIdle(page);
    const restored = (await readNetworkItems(page)).map(({ name, label, scope }) => ({ name, label, scope }));
    const scopes = Object.fromEntries(items.map((item) => [item.name, item.scope]));
    await page.click('#navAccessPoints');
    return verdict(
      isDeepStrictEqual(items.map(({ name, label, scope }) => ({ name, label, scope })), expected) &&
      scopes.Casa === `${fmt(es.groupMany, { count: 2 })} · ${es.apCountUnknown}; ${fmt(es.scopeUnknownMany, { count: 5 })}` &&
      scopes.Invitados === `${es.groupOne} · ${es.apCountUnknown}; ${fmt(es.scopeUnknownMany, { count: 5 })}` &&
      scopes.Oficina === `${es.groupOne} · ${es.apAtLeastOne}; ${es.scopeUnknownOne}` &&
      items.every((item) => !item.scope.includes(es.apNone)) && detail.summary === scopes.Casa &&
      isDeepStrictEqual(detail.sections.groups?.rows.map((row) => [row.link, row.meta]), [['Default', es.apCountUnknown], ['Default', es.apCountUnknown]]) &&
      detail.sections.aps?.title === es.accessPoints && detail.sections.aps.rows.length === 0 &&
      isDeepStrictEqual(detail.sections.aps.notes, [fmt(es.networkUnknownMany, { count: 5 })]) && !detail.sections.aps.notes.includes(es.networkNoAps) &&
      isDeepStrictEqual(detail.notes, [{ kind: 'managementOnly', text: es.managementOnly }]) &&
      isDeepStrictEqual(restored, expectedNetworkItems(data.accessPoints, data.wlanGroups, 'es')),
      { items, expected, detail, restored }
    );
  }); // End of check "[es] regression (phase 14a review): a twin Default..."

  await check('[es] regression (phase 14a review): a refresh that removes an AP kept in the Back history drops it: Casa → Porche → Default ("Volver a Porche"); Porche leaves the controller and after Refresh the bar offers "Volver a Casa", whose Back shows Casa with no Back bar left', async () => {
    await page.click('#navNetworks');
    await page.click(networkItem('Casa'));
    await page.click(`#networkDetail .cross-link[data-link-kind="ap"][data-link-target="${AP.Porche.mac}"]`);
    await page.waitForFunction(() => document.activeElement?.id === 'apDetailsName', null, { timeout: WAIT_MS });
    const atAp = await readInventory(page);
    await page.click('#apDetailsContent .cross-link[data-link-kind="group"]');
    await page.waitForFunction(() => document.activeElement?.id === 'groupDetailName', null, { timeout: WAIT_MS });
    const atGroup = await readInventory(page);
    await configureStub(session, { accessPoints: data.accessPoints.filter((ap) => ap.mac !== AP.Porche.mac) });
    await page.click('#refreshBtn');
    await waitForApCount(page, 6);
    await waitForLoadIdle(page);
    const refreshed = await readInventory(page);
    await page.click('#backBtn');
    const back = await readInventory(page);
    // Porche comes back for the checks that follow, which start on the Access points list
    await configureStub(session, { accessPoints: data.accessPoints });
    await page.click('#refreshBtn');
    await waitForApCount(page, 7);
    await waitForLoadIdle(page);
    await page.click('#navAccessPoints');
    const end = await readInventory(page);
    return verdict(
      isDeepStrictEqual(atAp.shown, ['viewAccessPoints']) && atAp.backLabel === fmt(es.backTo, { target: 'Casa' }) &&
      isDeepStrictEqual(atGroup.shown, ['viewGroups']) && atGroup.backLabel === fmt(es.backTo, { target: 'Porche' }) &&
      atGroup.currentGroup === GROUP.Default.wlanId &&
      isDeepStrictEqual(refreshed.shown, ['viewGroups']) && refreshed.backHidden === false && refreshed.backLabel === fmt(es.backTo, { target: 'Casa' }) &&
      isDeepStrictEqual(back.shown, ['viewNetworks']) && back.currentNetwork === 'Casa' && back.backHidden === true &&
      isDeepStrictEqual(end.shown, ['viewAccessPoints']) && end.backHidden === true && end.apDetailsHidden === true && end.destinationHidden === false,
      { atAp, atGroup, refreshed, back, end }
    );
  }); // End of check "[es] regression (phase 14a review): a refresh that removes an AP..."
} // End of function runInventoryChecks()

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
 * Spanish first-run launch: settings modal, the first-run state of the
 * views (one "Configure connection" action each), save, connect, lists and
 * the destination pane, the read-only banner on 6.3, Cmd/Ctrl+F and the
 * Escape order, a single move through the review dialog (cancel, Escape,
 * confirm, results) and into the Silence section, the selection and
 * bulk-move checks, refresh, a failed refresh with its notice and Retry, the
 * 700×500 single-pane layout, the 1200 / 900 / 720 px layouts (focus after a
 * keyboard move at 720 px and across the 800 px breakpoint), disconnect
 * and the disconnected state, connect failure (inline error) and recovery,
 * an initial-load error recovered by Retry (with the loading skeletons), the
 * legacy wording and banner, save rejected by main.
 * @param {{ binary: string }} electronInfo - Resolved Electron binary.
 * @returns {Promise<void>}
 */
async function runSpanishFirstRun(electronInfo) {
  const session = await launch(electronInfo, 'es', {
    config: { url: '', username: '', language: 'es', hasPassword: false },
    connect: { success: true },
    // A single-site controller: main reports its site's name (phase 15b)
    siteName: 'Casa',
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

    await check('[es] first run: Escape closes the settings modal (the top dialog); each view offers exactly one "Configurar la conexión" action under the hint (the destination list states the hint without one), the header\'s Connect is disabled, navigation works without a connection; the action opens Settings with focus in the URL field', async () => {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('settingsModal').classList.contains('visible'), null, { timeout: WAIT_MS });
      const shell = await readShell(page);
      const blocks = await readStateBlocks(page);
      const perView = await page.evaluate(() => ['viewAccessPoints', 'viewGroups', 'viewNetworks'].map((id) => document.querySelectorAll(`#${id} [data-state-action]`).length));
      await page.click('#navGroups');
      const groupsNav = await readNav(page);
      await page.click('#navNetworks');
      const networksNav = await readNav(page);
      await page.click('#navAccessPoints');
      const notices = await readNotices(page);
      await page.click('#apList [data-state-action="configure"]');
      await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
      await page.waitForFunction(() => document.activeElement?.id === 'urlInput', null, { timeout: WAIT_MS });
      const configure = [['configure', es.configureConnection]];
      return verdict(
        shell.settingsOpen === false && shell.connectDisabled === true &&
        blocks.apList.state === 'firstRun' && blocks.apList.text === es.configureHint && isDeepStrictEqual(blocks.apList.actions, configure) &&
        blocks.groupList.state === 'firstRun' && blocks.groupList.text === es.configureHint && isDeepStrictEqual(blocks.groupList.actions, configure) &&
        blocks.networkList.state === 'firstRun' && blocks.networkList.text === es.configureHint && isDeepStrictEqual(blocks.networkList.actions, configure) &&
        blocks.destinationList.state === 'firstRun' && blocks.destinationList.text === es.configureHint && blocks.destinationList.actions.length === 0 &&
        isDeepStrictEqual(perView, [1, 1, 1]) && isDeepStrictEqual(groupsNav.shown, ['viewGroups']) && isDeepStrictEqual(networksNav.shown, ['viewNetworks']) &&
        notices.bannerShown === false && notices.noticeShown === false,
        { shell, blocks, perView, groupsNav: groupsNav.shown, networksNav: networksNav.shown, notices }
      );
    }); // End of check "[es] first run: Escape closes the settings modal..."

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

    await checkShellAfterConnect(session, 'es', { aps: data.accessPoints, groups: data.wlanGroups, version: data.controllerVersion, groupModel: 'apGroup', site: 'Casa' });

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

    await check('[es] navigation: the AP groups and Wi-Fi networks entries show their real views (aria-current follows, one list entry per sidebar count, no placeholder left), and Enter on "Puntos de acceso" brings the list back', async () => {
      await page.click('#navGroups');
      const groups = await readNav(page);
      const groupItems = (await readGroupItems(page)).length;
      await page.click('#navNetworks');
      const networks = await readNav(page);
      const networkItems = (await readNetworkItems(page)).length;
      await page.focus('#navAccessPoints');
      await page.keyboard.press('Enter');
      const back = await readNav(page);
      const rows = (await readApItems(page)).length;
      return verdict(
        isDeepStrictEqual(groups.shown, ['viewGroups']) && groups.groups.current === 'page' && groups.accessPoints.current === null &&
        groups.groupsTitle === es.groupsTitle.apGroup && groups.placeholders === 0 && String(groupItems) === groups.groups.count &&
        isDeepStrictEqual(networks.shown, ['viewNetworks']) && networks.networks.current === 'page' && networks.groups.current === null &&
        networks.networksTitle === es.wifiNetworks && String(networkItems) === networks.networks.count &&
        isDeepStrictEqual(back.shown, ['viewAccessPoints']) && back.accessPoints.current === 'page' && back.networks.current === null &&
        rows === expectedAps.length,
        { groups, networks, back, rows, groupItems, networkItems }
      );
    }); // End of check "[es] navigation..."

    await check('[es] read-only banner on Omada 6.3: the AP groups and Wi-Fi networks views state the reason and the fix ("No hay credenciales de Open API configuradas — … Añádelas en Ajustes → Acceso de gestión."); the Access points view (moves work) shows none', async () => {
      await page.click('#navGroups');
      const groups = await readNotices(page);
      await page.click('#navNetworks');
      const networks = await readNotices(page);
      await page.click('#navAccessPoints');
      const aps = await readNotices(page);
      return verdict(
        groups.bannerShown === true && groups.bannerReason === 'managementNotConfigured' && groups.bannerText === es.readOnly63 && groups.bannerRole === 'note' &&
        networks.bannerShown === true && networks.bannerReason === 'managementNotConfigured' && networks.bannerText === es.readOnly63 &&
        aps.bannerShown === false && aps.noticeShown === false,
        { groups, networks, aps }
      );
    }); // End of check "[es] read-only banner on Omada 6.3..."

    await check('[es] keys: Cmd/Ctrl+F focuses the current view\'s search (from an AP checkbox; on AP groups); Escape clears the search first — also with focus outside the field — and then does nothing more; with the settings dialog open, Cmd/Ctrl+F leaves the dialog alone and Escape closes the dialog but keeps the view\'s search, which the next Escape clears', async () => {
      await page.focus(`#apList .ap-checkbox[data-mac="${AP.Garaje.mac}"]`);
      await page.keyboard.press(FIND_KEY);
      const apFocus = await page.evaluate(() => document.activeElement?.id || '');
      await page.keyboard.type('carpio');
      const filtered = (await readApItems(page)).map((item) => item.name);
      await page.focus(`#apList .ap-checkbox[data-mac="${MOVE_AP.mac}"]`);
      await page.keyboard.press('Escape');
      const cleared = await page.evaluate(() => ({ value: document.getElementById('apFilter').value, focus: document.activeElement?.id || '' }));
      const rowsAfter = (await readApItems(page)).length;
      await page.keyboard.press('Escape');
      const second = await readShell(page);
      await page.click('#navGroups');
      await page.keyboard.press(FIND_KEY);
      const groupFocus = await page.evaluate(() => document.activeElement?.id || '');
      await page.keyboard.type('def');
      await page.click('#settingsBtn');
      await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
      await page.waitForFunction(() => document.activeElement?.id === 'urlInput', null, { timeout: WAIT_MS });
      await page.keyboard.press(FIND_KEY);
      const findInDialog = await page.evaluate(() => ({ focus: document.activeElement?.id || '', open: document.getElementById('settingsModal').classList.contains('visible') }));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('settingsModal').classList.contains('visible'), null, { timeout: WAIT_MS });
      const afterDialog = await page.evaluate(() => ({ search: document.getElementById('groupSearch').value, focus: document.activeElement?.id || '' }));
      await page.keyboard.press('Escape');
      const afterSearch = await page.evaluate(() => ({ search: document.getElementById('groupSearch').value, focus: document.activeElement?.id || '' }));
      const groupCount = (await readGroupItems(page)).length;
      await page.click('#navAccessPoints');
      return verdict(
        apFocus === 'apFilter' && isDeepStrictEqual(filtered, [MOVE_AP.name]) &&
        cleared.value === '' && cleared.focus === 'apFilter' && rowsAfter === expectedAps.length &&
        second.settingsOpen === false && second.moveOpen === false && second.activeId === 'apFilter' &&
        groupFocus === 'groupSearch' && findInDialog.focus === 'urlInput' && findInDialog.open === true &&
        afterDialog.search === 'def' && afterDialog.focus !== 'groupSearch' &&
        afterSearch.search === '' && afterSearch.focus === 'groupSearch' && groupCount === 4,
        { apFocus, filtered, cleared, rowsAfter, second: second.activeId, groupFocus, findInDialog, afterDialog, afterSearch, groupCount }
      );
    }); // End of check "[es] keys: Cmd/Ctrl+F focuses the current view's search..."

    await runInventoryChecks(session);

    await check('[es] single move: clicking an AP\'s checkbox checks it ("Selecciona un grupo de AP"); picking zGrupo B previews Default -> zGrupo B (gains +5, loses -2, unchanged none) and enables "Mover AP"', async () => {
      await page.click(`#apList .ap-checkbox[data-mac="${MOVE_AP.mac}"]`);
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
    }); // End of check "[es] single move: clicking an AP's checkbox checks it..."

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

    // Data loads made before the single move (the connect and every refresh
    // so far): the move must add exactly one reload of each list
    let loadsBeforeMove = { aps: Number.NaN, wlans: Number.NaN };
    await check('[es] single move -> "Mover AP" in the review: one OMADA_SET_WLAN with the AP MAC and the group id, then the results "Se movió el AP a "zGrupo B"." with one "Movido" row (name and MAC) and Close focused', async () => {
      const beforeMove = await stubState(session);
      loadsBeforeMove = { aps: callsTo(beforeMove, 'omada:get-aps').length, wlans: callsTo(beforeMove, 'omada:get-wlans').length };
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
        callsTo(snapshot, 'omada:get-aps').length === loadsBeforeMove.aps + 1 && callsTo(snapshot, 'omada:get-wlans').length === loadsBeforeMove.wlans + 1 &&
        row?.group === `${es.groupLabel.apGroup}: ${MOVE_GROUP.wlanName}` && row?.checked === false &&
        preview.status === es.moveNoSelection && preview.disabled === true && preview.button === es.moveNone && preview.destination === null &&
        radios.every((item) => item.checked === false) && focusInList,
        { loadsBeforeMove, getAps: callsTo(snapshot, 'omada:get-aps').length, getWlans: callsTo(snapshot, 'omada:get-wlans').length, row, preview, focusInList }
      );
    }); // End of check "[es] single move -> Close..."

    await check('[es] Silence as a move target: zNinguna (pinned under "Silenciar") is selectable; the preview shows every network lost and "Sin redes Wi-Fi — silencia estos AP", the review shows it as the destination warning', async () => {
      await page.click(`#apList .ap-checkbox[data-mac="${MOVE_AP.mac}"]`);
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

    await check('[es] refresh error: the data stays with a notice naming its time ("No se pudieron actualizar los datos. Se muestran los de las hh:mm.") and "Reintentar", on every view; the header\'s "Actualizado hh:mm" is marked stale with the same text; Reintentar refreshes and clears both', async () => {
      const header = await readHeader(page);
      const aps = await readNotices(page);
      await page.click('#navGroups');
      const groups = await readNotices(page);
      await page.click('#navAccessPoints');
      const before = await stubState(session);
      await page.click('#refreshNoticeRetryBtn');
      await page.waitForFunction(() => document.getElementById('refreshNotice').hidden && !document.getElementById('refreshBtn').classList.contains('spinning'), null, { timeout: WAIT_MS });
      const after = await readNotices(page);
      const headerAfter = await readHeader(page);
      const snapshot = await stubState(session);
      const expected = fmt(es.refreshFailed, { time: header.time });
      return verdict(
        aps.noticeShown === true && aps.noticeText === expected && aps.noticeRetry === es.retry && aps.stale === true && aps.staleTitle === expected &&
        groups.noticeShown === true && groups.noticeText === expected &&
        after.noticeShown === false && after.stale === false && after.staleTitle === '' && headerAfter.updatedAt > header.updatedAt &&
        headerAfter.status === es.connected && callsTo(snapshot, 'omada:get-aps').length === callsTo(before, 'omada:get-aps').length + 1,
        { header, aps, groups, after, headerAfter }
      );
    }); // End of check "[es] refresh error..."

    await check('[es] 700×500 minimum window (single-pane layout): no overflow; the top view switcher (Settings included), AP rows, the selection summary and "Elegir destino" stay inside the window; "Elegir destino" opens the destination picker in the list\'s place with a radio, the move preview and the move button inside the window; the review dialog keeps Cancel and the move button visible; its Back returns to the list', async () => {
      // A selection and a destination, so the preview is at its fullest
      await page.click(`#apList .ap-checkbox[data-mac="${AP.Altillo.mac}"]`);
      await pickDestination(page, GROUP.Default.wlanId);
      await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 500));
      try {
        await page.waitForFunction(() => window.innerWidth <= 700 && window.innerHeight <= 500, null, { timeout: WAIT_MS });
        /**
         * Probes the Access points view at 700×500: which of its panes are
         * shown and whether its controls are visible inside the window.
         * @returns {Promise<object>} The probe.
         */
        const probe = () => page.evaluate(() => {
          /**
           * Tells whether an element is visible (not off stage) and rendered
           * entirely inside the window.
           * @param {string} selector - CSS selector of the element.
           * @returns {boolean} True when it is shown and fits the viewport.
           */
          const inside = (selector) => {
            const element = document.querySelector(selector);
            const rect = element?.getBoundingClientRect();
            return Boolean(rect && element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }) && rect.width > 0 && rect.height > 0 &&
              rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight);
          };
          /**
           * Tells whether at least one of the elements is shown entirely inside
           * its scrolling container and the window.
           * @param {string} itemSelector - CSS selector of the items.
           * @param {DOMRect} box - The container's rectangle.
           * @returns {boolean} True when one item is in view.
           */
          const oneInView = (itemSelector, box) => Array.from(document.querySelectorAll(itemSelector)).some((item) => {
            const rect = item.getBoundingClientRect();
            return item.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }) &&
              rect.top >= box.top && rect.bottom <= box.bottom && rect.left >= box.left && rect.right <= box.right && rect.bottom <= window.innerHeight;
          });
          const list = document.getElementById('apList').getBoundingClientRect();
          const destinations = document.getElementById('destinationList').getBoundingClientRect();
          return {
            scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
            width: window.innerWidth, height: window.innerHeight,
            settings: inside('#settingsBtn'), nav: inside('#navNetworks'), refresh: inside('#refreshBtn'), connect: inside('#connectBtn'),
            listShown: inside('#apPanel .panel-title'), summary: inside('#apSelectionSummary'), choose: inside('#openDestinationBtn'),
            pickerShown: inside('#destinationPanelTitle'), back: inside('#destinationBackBtn'), move: inside('#moveBtn'), preview: inside('.move-summary'),
            rowInView: oneInView('#apList .ap-row', list), radioInView: oneInView('#destinationList .destination-option', destinations),
            listHeight: list.height, destinationHeight: destinations.height, activeId: document.activeElement?.id || '',
          };
        }); // End of the 700×500 layout probe
        const atList = await probe();
        await page.click('#openDestinationBtn');
        const atPicker = await probe();
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
        await page.click('#destinationBackBtn');
        const back = await probe();
        return verdict(
          atList.scrollWidth <= atList.width && atList.scrollHeight <= atList.height && atList.settings && atList.nav && atList.refresh && atList.connect &&
          atList.listShown && atList.summary && atList.choose && atList.rowInView && atList.listHeight >= 100 && !atList.pickerShown && !atList.move &&
          atPicker.scrollWidth <= atPicker.width && atPicker.scrollHeight <= atPicker.height && atPicker.pickerShown && atPicker.back &&
          atPicker.move && atPicker.preview && atPicker.radioInView && atPicker.destinationHeight >= 90 && !atPicker.listShown && !atPicker.choose &&
          dialog.cancel && dialog.confirm && back.listShown && !back.pickerShown && back.activeId === 'openDestinationBtn',
          { atList, atPicker, dialog, back }
        );
      } finally {
        if (await page.evaluate(() => document.getElementById('moveModal').classList.contains('visible'))) {
          await page.keyboard.press('Escape');
        }
        if (await page.isVisible('#destinationBackBtn')) {
          await page.click('#destinationBackBtn');
        }
        await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
        await page.click('#clearApSelectionBtn');
      }
    }); // End of check "[es] 700×500 minimum window..."

    await check('[es] 1200 px: the full sidebar (labels, icons and counts), each view with its list and detail side by side, no single-pane control, no horizontal overflow', async () => {
      await resizeContent(session, 1200, 650);
      try {
        const views = {};
        for (const [view, nav] of [['groups', '#navGroups'], ['networks', '#navNetworks'], ['accessPoints', '#navAccessPoints']]) {
          await page.click(nav);
          views[view] = await readLayout(page);
        }
        const { accessPoints: aps, groups, networks } = views;
        return verdict(
          Object.values(views).every((layout) => layout.docScrollWidth <= layout.docClientWidth && layout.overflowing.length === 0 &&
            layout.sidebar.width >= 150 && layout.sidebar.right <= layout.viewArea.left + 1 && layout.label.width > 40 && layout.icon && layout.count &&
            !layout.openDestination && Object.values(layout.backs).every((shown) => !shown)) &&
          aps.panes.apPanel !== null && aps.panes.destinationPanel !== null && aps.panes.apPanel.right <= aps.panes.destinationPanel.left &&
          groups.panes.groupMasterPanel !== null && groups.panes.groupDetailPanel !== null && groups.panes.groupMasterPanel.right <= groups.panes.groupDetailPanel.left &&
          networks.panes.networkMasterPanel !== null && networks.panes.networkDetailPanel !== null &&
          networks.panes.networkMasterPanel.right <= networks.panes.networkDetailPanel.left,
          views
        );
      } finally {
        await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
      }
    }); // End of check "[es] 1200 px..."

    await check('[es] 900 px: the compact sidebar (icons and counts; each label visually hidden but still the button\'s text and its tooltip), each view with its list and detail side by side, no single-pane control, no horizontal overflow', async () => {
      await resizeContent(session, 900, 650);
      const views = {};
      for (const [view, nav] of [['groups', '#navGroups'], ['networks', '#navNetworks'], ['accessPoints', '#navAccessPoints']]) {
        await page.click(nav);
        views[view] = await readLayout(page);
      }
      const { accessPoints: aps, groups, networks } = views;
      return verdict(
        Object.values(views).every((layout) => layout.docScrollWidth <= layout.docClientWidth && layout.overflowing.length === 0 &&
          layout.sidebar.width < 100 && layout.sidebar.right <= layout.viewArea.left + 1 && layout.label.width <= 1 &&
          layout.labelText === es.accessPoints && layout.navTitle === es.accessPoints && layout.icon && layout.count &&
          !layout.openDestination && Object.values(layout.backs).every((shown) => !shown)) &&
        aps.panes.apPanel !== null && aps.panes.destinationPanel !== null && aps.panes.apPanel.right <= aps.panes.destinationPanel.left &&
        groups.panes.groupMasterPanel !== null && groups.panes.groupDetailPanel !== null && groups.panes.groupMasterPanel.right <= groups.panes.groupDetailPanel.left &&
        networks.panes.networkMasterPanel !== null && networks.panes.networkDetailPanel !== null &&
        networks.panes.networkMasterPanel.right <= networks.panes.networkDetailPanel.left,
        views
      );
    }); // End of check "[es] 900 px..."

    await check('[es] 720 px: a top view switcher and one pane at a time — "Elegir destino" opens the destination picker in the list\'s place and its Back returns (focus on the button); an AP row opens its details as a full pane whose Back returns to the list (focus on its checkbox); a group and a network open their details in place of their lists (the read-only banner stays), each Back returning to the list with focus on the item; Cmd/Ctrl+F in a detail returns to the list\'s search; no horizontal overflow at any step', async () => {
      await resizeContent(session, 720, 650);
      try {
        await page.click('#navAccessPoints');
        const list = await readLayout(page);
        await page.click('#openDestinationBtn');
        const picker = await readLayout(page);
        await page.click('#destinationBackBtn');
        const pickerBack = await readLayout(page);
        await page.click(`#apList .ap-row[data-mac="${AP.Garaje.mac}"] .ap-row-group`);
        await page.waitForFunction(() => document.activeElement?.id === 'apDetailsName', null, { timeout: WAIT_MS });
        const details = await readLayout(page);
        await page.click('#apDetailsBackBtn');
        const detailsBack = await readLayout(page);
        await page.click('#navGroups');
        // A group picked at a wider width stays open: start from the list
        if (await page.isVisible('#groupDetailBackBtn')) {
          await page.click('#groupDetailBackBtn');
        }
        const groups = await readLayout(page);
        await page.click(`#groupList .master-item[data-group-id="${GROUP.Default.wlanId}"]`);
        await page.waitForFunction(() => document.activeElement?.id === 'groupDetailName', null, { timeout: WAIT_MS });
        const group = { ...(await readLayout(page)), notices: await readNotices(page) };
        await page.keyboard.press(FIND_KEY);
        const found = await readLayout(page);
        await page.click(`#groupList .master-item[data-group-id="${GROUP.Default.wlanId}"]`);
        await page.waitForFunction(() => document.activeElement?.id === 'groupDetailName', null, { timeout: WAIT_MS });
        await page.click('#groupDetailBackBtn');
        const groupBack = await readLayout(page);
        await page.click('#navNetworks');
        if (await page.isVisible('#networkDetailBackBtn')) {
          await page.click('#networkDetailBackBtn');
        }
        await page.click('#networkList .master-item[data-network-name="Casa"]');
        await page.waitForFunction(() => document.activeElement?.id === 'networkDetailName', null, { timeout: WAIT_MS });
        const network = await readLayout(page);
        await page.click('#networkDetailBackBtn');
        const networkBack = await readLayout(page);
        const steps = { list, picker, pickerBack, details, detailsBack, groups, group, found, groupBack, network, networkBack };
        return verdict(
          Object.values(steps).every((step) => step.docScrollWidth <= step.docClientWidth && step.overflowing.length === 0) &&
          list.sidebar.bottom <= list.viewArea.top + 1 && list.sidebar.width >= 719 && list.label.width > 20 && list.icon &&
          list.settings !== null && list.settings.right <= 720 &&
          list.panes.apPanel !== null && list.panes.destinationPanel === null && list.openDestination === true && list.backs.destinationBackBtn === false &&
          picker.panes.apPanel === null && picker.panes.destinationPanel !== null && picker.backs.destinationBackBtn === true && picker.activePanel === 'destinationPanel' &&
          pickerBack.panes.apPanel !== null && pickerBack.panes.destinationPanel === null && pickerBack.activeId === 'openDestinationBtn' &&
          details.panes.apPanel === null && details.panes.apDetailsPanel !== null && details.backs.apDetailsBackBtn === true && details.closeDetails === false &&
          detailsBack.panes.apPanel !== null && detailsBack.panes.apDetailsPanel === null && detailsBack.panes.destinationPanel === null &&
          detailsBack.activeMac === AP.Garaje.mac &&
          groups.panes.groupMasterPanel !== null && groups.panes.groupDetailPanel === null &&
          group.panes.groupMasterPanel === null && group.panes.groupDetailPanel !== null && group.backs.groupDetailBackBtn === true &&
          group.notices.bannerShown === true &&
          found.panes.groupMasterPanel !== null && found.panes.groupDetailPanel === null && found.activeId === 'groupSearch' &&
          groupBack.panes.groupMasterPanel !== null && groupBack.panes.groupDetailPanel === null && groupBack.activeGroupId === GROUP.Default.wlanId &&
          network.panes.networkMasterPanel === null && network.panes.networkDetailPanel !== null && network.backs.networkDetailBackBtn === true &&
          networkBack.panes.networkMasterPanel !== null && networkBack.panes.networkDetailPanel === null,
          steps
        );
      } finally {
        for (const back of ['#destinationBackBtn', '#apDetailsBackBtn']) {
          if (await page.isVisible(back)) {
            await page.click(back);
          }
        }
        await page.click('#navAccessPoints');
        await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
      }
    }); // End of check "[es] 720 px..."

    await check('[es] 720 px, keyboard move: with the destination picker in the list\'s place, Enter on "Mover AP", confirm, then Enter on Close after a fully successful move brings the AP list back (the picker closes, the AP in its new group) with focus on a visible control in it, never inside a hidden pane; moving the AP back the same way ends the same', async () => {
      await resizeAndSettle(session, 720, 650);
      try {
        await page.click('#navAccessPoints');
        const scenario = (await stubState(session)).scenario;
        const currentName = scenario.accessPoints.find((ap) => ap.mac === MOVE_AP.mac)?.wlanGroup;
        const original = scenario.wlanGroups.find((group) => group.wlanName === currentName);
        const target = original?.wlanId === MOVE_GROUP.wlanId ? GROUP.Default : MOVE_GROUP;
        /**
         * Moves MOVE_AP from the destination picker into a group — the move
         * started with Enter on the move button and the results closed with
         * Enter on Close — and reads the focus and the panes afterwards.
         * @param {string} wlanId - The destination group id.
         * @returns {Promise<{ focus: object; layout: object; row: object | undefined }>} The probes.
         */
        const keyboardMove = async (wlanId) => {
          await page.check(`#apList .ap-checkbox[data-mac="${MOVE_AP.mac}"]`);
          await page.click('#openDestinationBtn');
          await pickDestination(page, wlanId);
          await page.focus('#moveBtn');
          await page.keyboard.press('Enter');
          await waitForReview(page);
          await page.click('#confirmMoveBtn');
          await waitForResults(page);
          await page.keyboard.press('Enter');
          await waitForMoveDialogClosed(page);
          await waitForLoadIdle(page);
          const focus = await readFocus(page);
          const layout = await readLayout(page);
          const row = (await readApItems(page)).find((item) => item.mac === MOVE_AP.mac);
          return { focus, layout, row };
        }; // End of function keyboardMove()
        const there = await keyboardMove(target.wlanId);
        const back = original === undefined ? null : await keyboardMove(original.wlanId);
        const sets = callsTo(await stubState(session), 'omada:set-wlan').slice(-2).map((call) => call.args);
        /**
         * Tells whether a move ended on the AP list with focus visible in it.
         * @param {{ focus: object; layout: object }} step - The probes after one move.
         * @param {string} groupName - The group the AP must now report.
         * @returns {boolean} True when focus is on a visible control of the shown AP list.
         */
        const endedInList = (step, groupName) => step !== null && step.focus.width === 720 && step.focus.visible &&
          step.focus.panel === 'apPanel' && step.layout.panes.apPanel !== null && step.layout.panes.destinationPanel === null &&
          step.row?.group === `${es.groupLabel.apGroup}: ${groupName}` && step.row?.checked === false;
        return verdict(
          original !== undefined && endedInList(there, target.wlanName) && endedInList(back, original.wlanName) &&
          isDeepStrictEqual(sets, [[MOVE_AP.mac, target.wlanId], [MOVE_AP.mac, original.wlanId]]),
          { original: original?.wlanName, target: target.wlanName, there, back, sets }
        );
      } finally {
        if (await page.evaluate(() => document.getElementById('moveModal').classList.contains('visible'))) {
          await page.keyboard.press('Escape');
          await waitForMoveDialogClosed(page);
        }
        if (await page.isVisible('#destinationBackBtn')) {
          await page.click('#destinationBackBtn');
        }
        if (await page.isVisible('#clearApSelectionBtn')) {
          await page.click('#clearApSelectionBtn');
        }
        await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
      }
    }); // End of check "[es] 720 px, keyboard move..."

    await check('[es] crossing 800 px never strands focus on a hidden control: focused at 720 px, the destination picker\'s Back → its search, "Elegir destino" → the AP list, the AP details\' Back → "Cerrar detalles", a group\'s and a network\'s Back → the selected item of their list once the window is 900 px wide; "Cerrar detalles" focused at 900 px → the details\' Back at 720 px', async () => {
      const steps = {};
      /**
       * Focuses a control at the current width, resizes the window and
       * reads the focus before and after.
       * @param {string} selector - CSS selector of the control to focus.
       * @param {number} width - The content width to resize to.
       * @returns {Promise<{ before: object; after: object }>} The focus probes.
       */
      const cross = async (selector, width) => {
        await page.focus(selector);
        const before = await readFocus(page);
        await resizeAndSettle(session, width, 650);
        return { before, after: await readFocus(page) };
      };
      try {
        await resizeAndSettle(session, 720, 650);
        await page.click('#navAccessPoints');
        await page.click('#openDestinationBtn');
        steps.picker = await cross('#destinationBackBtn', 900);
        await resizeAndSettle(session, 720, 650);
        await page.click('#destinationBackBtn');
        steps.choose = await cross('#openDestinationBtn', 900);
        await resizeAndSettle(session, 720, 650);
        await page.click(`#apList .ap-row[data-mac="${AP.Garaje.mac}"] .ap-row-group`);
        await page.waitForFunction(() => document.activeElement?.id === 'apDetailsName', null, { timeout: WAIT_MS });
        steps.details = await cross('#apDetailsBackBtn', 900);
        steps.closeDetails = await cross('#closeApDetailsBtn', 720);
        await page.click('#apDetailsBackBtn');
        await page.click('#navGroups');
        if (!(await page.isVisible('#groupDetailBackBtn'))) {
          await page.click(`#groupList .master-item[data-group-id="${GROUP.Default.wlanId}"]`);
          await page.waitForFunction(() => document.activeElement?.id === 'groupDetailName', null, { timeout: WAIT_MS });
        }
        steps.group = await cross('#groupDetailBackBtn', 900);
        await resizeAndSettle(session, 720, 650);
        await page.click('#navNetworks');
        if (!(await page.isVisible('#networkDetailBackBtn'))) {
          await page.click('#networkList .master-item[data-network-name="Casa"]');
          await page.waitForFunction(() => document.activeElement?.id === 'networkDetailName', null, { timeout: WAIT_MS });
        }
        steps.network = await cross('#networkDetailBackBtn', 900);
        return verdict(
          Object.values(steps).every((step) => step.before.visible && step.after.visible) &&
          steps.picker.before.id === 'destinationBackBtn' && steps.picker.after.id === 'destinationSearch' &&
          steps.choose.before.id === 'openDestinationBtn' && steps.choose.after.panel === 'apPanel' && steps.choose.after.checkbox &&
          steps.details.before.id === 'apDetailsBackBtn' && steps.details.after.id === 'closeApDetailsBtn' &&
          steps.closeDetails.before.id === 'closeApDetailsBtn' && steps.closeDetails.after.id === 'apDetailsBackBtn' &&
          steps.group.before.id === 'groupDetailBackBtn' && steps.group.after.panel === 'groupMasterPanel' &&
          steps.group.after.groupId !== null && steps.group.after.current &&
          steps.network.before.id === 'networkDetailBackBtn' && steps.network.after.panel === 'networkMasterPanel' &&
          steps.network.after.networkName !== null && steps.network.after.current,
          // One short line per step: "id@panel" before → after
          Object.fromEntries(Object.entries(steps).map(([name, step]) => [name, [step.before, step.after].map((focus) =>
            `${focus.id || focus.groupId || focus.networkName || (focus.checkbox ? 'ap-checkbox' : 'body')}@${focus.panel}/${focus.width}` +
            `${focus.visible ? '' : ' HIDDEN'}${focus.current ? ' current' : ''}`).join(' → ')]))
        );
      } finally {
        if (!(await page.evaluate(() => window.matchMedia('(max-width: 799px)').matches))) {
          await resizeAndSettle(session, 720, 650);
        }
        await page.click('#navAccessPoints');
        for (const back of ['#destinationBackBtn', '#apDetailsBackBtn']) {
          if (await page.isVisible(back)) {
            await page.click(back);
          }
        }
        await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
      }
    }); // End of check "[es] crossing 800 px..."

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

    await check('[es] disconnected: navigation stays and each view offers one "Conectar al controlador" action under its hint (the destination list states its hint without one); no read-only banner, no refresh notice', async () => {
      const blocks = await readStateBlocks(page);
      await page.click('#navGroups');
      const nav = await readNav(page);
      const notices = await readNotices(page);
      await page.click('#navAccessPoints');
      const connectAction = [['connect', es.connectToController]];
      return verdict(
        blocks.apList.state === 'disconnected' && blocks.apList.text === es.connectToSeeAPs && isDeepStrictEqual(blocks.apList.actions, connectAction) &&
        blocks.groupList.state === 'disconnected' && blocks.groupList.text === es.connectToSeeGroups && isDeepStrictEqual(blocks.groupList.actions, connectAction) &&
        blocks.networkList.state === 'disconnected' && blocks.networkList.text === es.connectToSeeNetworks && isDeepStrictEqual(blocks.networkList.actions, connectAction) &&
        blocks.destinationList.state === 'disconnected' && blocks.destinationList.text === es.connectToSeeGroups && blocks.destinationList.actions.length === 0 &&
        isDeepStrictEqual(nav.shown, ['viewGroups']) && nav.groups.current === 'page' && nav.groups.count === null &&
        notices.bannerShown === false && notices.noticeShown === false,
        { blocks, nav, notices }
      );
    }); // End of check "[es] disconnected: navigation stays..."

    await check('[es] connect failure: error shown in the status bar and inline in each view (a persistent alert with "Reintentar" and "Ajustes"; the destination list states it without actions), controller released, no crash', async () => {
      await configureStub(session, { connect: { success: false, error: 'connectError', detail: 'HTTP 503: Service Unavailable' } });
      await page.click('#connectBtn');
      await page.waitForSelector('#statusIndicator.error', { timeout: WAIT_MS });
      await page.waitForFunction(() => document.getElementById('connectBtn').disabled === false, null, { timeout: WAIT_MS });
      const snapshot = await stubState(session);
      const disconnects = callsTo(snapshot, 'omada:disconnect');
      const shell = await readShell(page);
      const blocks = await readStateBlocks(page);
      const message = 'Error de conexión (HTTP 503: Service Unavailable)';
      const errorActions = [['retry', es.retry], ['settings', es.settings]];
      return verdict(
        shell.status === message && shell.connect === es.connect &&
        shell.settingsDisabled === false && shell.apEmpty === message &&
        ['apList', 'groupList', 'networkList'].every((id) => blocks[id].state === 'loadError' && blocks[id].text === message &&
          blocks[id].alert === true && isDeepStrictEqual(blocks[id].actions, errorActions)) &&
        blocks.destinationList.state === 'loadError' && blocks.destinationList.text === message && blocks.destinationList.actions.length === 0 &&
        disconnects.length === 2 && disconnects[1].args[0] == null,
        { shell, blocks, disconnects }
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

    await check('[es] initial-load error: "Conectar al controlador" connects but the first data load fails — the status bar and each view say "Error al cargar los datos del controlador" inline (a persistent alert) with "Reintentar" and "Ajustes" (which opens Settings); "Reintentar" shows the loading skeletons in the layout, then recovers the data', async () => {
      await page.click('#connectBtn');
      await waitForStatus(page, es.disconnected);
      await configureStub(session, { failChannels: ['omada:get-wlans'] });
      let blocks;
      let shell;
      let settings;
      try {
        await page.click('#apList [data-state-action="connect"]');
        await page.waitForFunction(() => document.querySelector('#apList .state-block')?.dataset.state === 'loadError', null, { timeout: WAIT_MS });
        blocks = await readStateBlocks(page);
        shell = await readShell(page);
        await page.click('#navGroups');
        await page.click('#groupList [data-state-action="settings"]');
        await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
        settings = await readShell(page);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('settingsModal').classList.contains('visible'), null, { timeout: WAIT_MS });
        await page.click('#navAccessPoints');
      } finally {
        await configureStub(session, { failChannels: [], delays: { 'omada:get-aps': 800 } });
      }
      let loading;
      try {
        await page.click('#apList [data-state-action="retry"]');
        await page.waitForSelector('#apList .skeleton-list', { timeout: WAIT_MS });
        loading = await readStateBlocks(page);
        await waitForConnected(page);
        // The AP list the stub serves by now (a refresh check added one AP)
        const scenario = (await stubState(session)).scenario;
        await waitForApCount(page, expectedApRows(scenario.accessPoints, 'es', 'apGroup', scenario.wlanGroups).length);
        await waitForLoadIdle(page);
      } finally {
        await configureStub(session, { delays: {} });
      }
      const recovered = await readShell(page);
      const after = await readStateBlocks(page);
      const message = es.loadError;
      const errorActions = [['retry', es.retry], ['settings', es.settings]];
      return verdict(
        shell.status === message && shell.indicator.split(' ').includes('error') && shell.connect === es.connect &&
        ['apList', 'groupList', 'networkList'].every((id) => blocks[id].state === 'loadError' && blocks[id].text === message &&
          blocks[id].alert === true && isDeepStrictEqual(blocks[id].actions, errorActions)) &&
        blocks.destinationList.text === message && blocks.destinationList.actions.length === 0 && settings.settingsOpen === true &&
        ['apList', 'destinationList', 'groupList', 'networkList'].every((id) => loading[id].state === 'loading' && loading[id].skeletonRows > 0) &&
        loading.apList.skeletonRole === 'status' && loading.apList.skeletonLabel === es.loading &&
        recovered.status === es.connected && Object.values(after).every((block) => block.state === null),
        { blocks, shell, settings: settings?.settingsOpen, loading, recovered, after }
      );
    }); // End of check "[es] initial-load error..."

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

    await check('[es] legacy controller (5.x): the AP groups view keeps the legacy wording ("Grupos WLAN (heredado)") without any "Predeterminado" badge (the legacy list carries no default flag); a network\'s detail lists its "Grupos WLAN (heredado)"; the AP details call the group "WLAN"', async () => {
      await page.click('#navGroups');
      const nav = await readNav(page);
      const items = await readGroupItems(page);
      await page.click('#navNetworks');
      await page.click('#networkList .master-item[data-network-name="Colegio"]');
      const network = await readDetailPane(page, '#networkDetail');
      await page.click('#navAccessPoints');
      const firstMac = (await readApItems(page))[0]?.mac;
      await page.click(`#apList .ap-row[data-mac="${firstMac}"] .ap-row-group`);
      const details = await readDetailPane(page, '#apDetailsContent');
      await page.click('#closeApDetailsBtn');
      return verdict(
        nav.groupsTitle === es.groupsTitle.wlanGroup && isDeepStrictEqual(items.map((item) => item.name), ['Aulas', 'Default']) &&
        items.every((item) => item.badges.length === 0) && network.sections.groups?.title === `${es.groupsTitle.wlanGroup} (1)` &&
        details.facts.group?.label === es.groupLabel.wlanGroup,
        { groupsTitle: nav.groupsTitle, items, networkGroups: network.sections.groups, group: details.facts.group }
      );
    }); // End of check "[es] legacy controller (5.x): the AP groups view keeps the legacy wording..."

    await check('[es] read-only banner on a legacy controller: the AP groups and Wi-Fi networks views say "Controlador heredado — puedes mover AP; editar grupos y redes requiere Omada Controller 6.3 o posterior."; none on Access points', async () => {
      await page.click('#navGroups');
      const groups = await readNotices(page);
      await page.click('#navNetworks');
      const networks = await readNotices(page);
      await page.click('#navAccessPoints');
      const aps = await readNotices(page);
      return verdict(
        groups.bannerShown === true && groups.bannerReason === 'legacyController' && groups.bannerText === es.readOnlyLegacy &&
        networks.bannerShown === true && networks.bannerReason === 'legacyController' && networks.bannerText === es.readOnlyLegacy &&
        aps.bannerShown === false,
        { groups, networks, aps }
      );
    }); // End of check "[es] read-only banner on a legacy controller"

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

/**
 * English launch on a legacy controller, the read-only views and the AP
 * details pane in English (phase 14a; the legacy read-only banner, phase
 * 14b): the "WLAN groups (legacy)" list with
 * English counts and no Default badge (the legacy list carries no default
 * flag), the network scopes and a network's detail, the AP details of an AP
 * whose group the legacy list does not have and of one whose group it has,
 * and "Back to <AP>" after following the group link. Runs after the
 * selection checks (no move made); ends on the Access points view with the
 * details pane closed and no Back history.
 * @param {object} session - The English launch.
 * @returns {Promise<void>}
 */
async function runEnglishInventoryChecks(session) {
  const { page } = session;
  const en = TEXT.en;
  /**
   * Selector of a part of a fixture AP's row outside its checkbox (the group text).
   * @param {string} name - AP name.
   * @returns {string} The CSS selector.
   */
  const rowGroup = (name) => `#apList .ap-row[data-mac="${AP[name].mac}"] .ap-row-group`;

  await check('[en] read-only banner on a legacy controller in English: "Legacy controller — moving APs is available; editing groups and networks requires Omada Controller 6.3 or later." on the AP groups and Wi-Fi networks views; none on Access points', async () => {
    await page.click('#navGroups');
    const groups = await readNotices(page);
    await page.click('#navNetworks');
    const networks = await readNotices(page);
    await page.click('#navAccessPoints');
    const aps = await readNotices(page);
    return verdict(
      groups.bannerShown === true && groups.bannerReason === 'legacyController' && groups.bannerText === en.readOnlyLegacy &&
      networks.bannerShown === true && networks.bannerText === en.readOnlyLegacy && aps.bannerShown === false,
      { groups, networks, aps }
    );
  }); // End of check "[en] read-only banner on a legacy controller in English"

  await check('[en] AP groups view on a legacy controller: "WLAN groups (legacy)" listing "4 APs · 2 networks" and "No APs · 1 network", with no Default badge (the legacy list carries no default flag)', async () => {
    await page.click('#navGroups');
    const nav = await readNav(page);
    const items = await readGroupItems(page);
    const expected = expectedGroupItems(data.accessPoints, data.legacyWlanGroups, 'en');
    const actual = items.map(({ id, name, badges, meta }) => ({ id, name, badges, meta }));
    return verdict(
      nav.groupsTitle === en.groupsTitle.wlanGroup && isDeepStrictEqual(actual, expected) && items.every((item) => item.badges.length === 0) &&
      isDeepStrictEqual(actual.map((item) => item.meta), [`${en.apNone} · ${en.networksOne}`, `${fmt(en.apMany, { count: 4 })} · ${fmt(en.networksMany, { count: 2 })}`]),
      { nav: nav.groupsTitle, actual, expected }
    );
  }); // End of check "[en] AP groups view on a legacy controller..."

  await check('[en] Wi-Fi networks view in English: scopes such as "1 group · at least 4 APs; 3 APs\' groups cannot be identified"; Colegio\'s detail lists "WLAN groups (legacy) (1)", its 4 APs with the 3 APs whose group is unknown stated in the same section, and the management-access note', async () => {
    await page.click('#navNetworks');
    const items = await readNetworkItems(page);
    const expected = expectedNetworkItems(data.accessPoints, data.legacyWlanGroups, 'en');
    await page.click('#networkList .master-item[data-network-name="Colegio"]');
    const detail = await readDetailPane(page, '#networkDetail');
    return verdict(
      isDeepStrictEqual(items.map(({ name, label, scope }) => ({ name, label, scope })), expected) &&
      detail.heading === 'Colegio' && detail.summary === `${en.groupOne} · ${fmt(en.apAtLeastMany, { count: 4 })}; ${fmt(en.scopeUnknownMany, { count: 3 })}` &&
      detail.sections.groups?.title === `${en.groupsTitle.wlanGroup} (1)` && detail.sections.aps?.title === en.accessPoints &&
      detail.sections.aps.rows.length === 4 && isDeepStrictEqual(detail.sections.aps.notes, [fmt(en.networkUnknownMany, { count: 3 })]) &&
      isDeepStrictEqual(detail.notes, [{ kind: 'managementOnly', text: en.managementOnly }]),
      { items, expected, detail }
    );
  }); // End of check "[en] Wi-Fi networks view in English..."

  await check('[en] AP details in English: Altillo (its group is not in the legacy list) shows "zGrupo B (not in the group list)" and unknown networks; Salón links to its WLAN group, and following the link offers "Back to Salón", which returns to Salón\'s details with focus on the link', async () => {
    await page.click('#navAccessPoints');
    await page.click(rowGroup('Altillo'));
    await page.waitForFunction(() => document.activeElement?.id === 'apDetailsName', null, { timeout: WAIT_MS });
    const altillo = await readDetailPane(page, '#apDetailsContent');
    const inventory = await readInventory(page);
    await page.click(rowGroup('Salón'));
    await page.waitForFunction(() => document.getElementById('apDetailsName')?.textContent === 'Salón', null, { timeout: WAIT_MS });
    const salon = await readDetailPane(page, '#apDetailsContent');
    await page.click('#apDetailsContent .cross-link[data-link-kind="group"]');
    await page.waitForFunction(() => document.activeElement?.id === 'groupDetailName', null, { timeout: WAIT_MS });
    const atGroup = await readInventory(page);
    const group = await readDetailPane(page, '#groupDetail');
    await page.click('#backBtn');
    const back = await readInventory(page);
    await page.click('#closeApDetailsBtn');
    const closed = await readInventory(page);
    return verdict(
      altillo.heading === 'Altillo' && altillo.facts.group?.label === en.groupLabel.wlanGroup &&
      altillo.facts.group?.value === fmt(en.apGroupUnlisted, { group: 'zGrupo B' }) && altillo.facts.group?.link === null &&
      isDeepStrictEqual(altillo.sections.networks?.notes, [en.apNetworksUnknown]) && isDeepStrictEqual(altillo.notes, [{ kind: 'overrides', text: en.apOverrides }]) &&
      inventory.apDetailsTitle === en.apDetailsTitle && inventory.closeText === en.closeDetails &&
      salon.facts.status?.label === en.statusLabel && salon.facts.clients?.label === en.clientsLabel &&
      salon.facts.clients?.value === fmt(en.clientsMany, { count: 12 }) && salon.facts.group?.value === 'Default' &&
      isDeepStrictEqual(salon.sections.networks?.links.map((link) => link.text), ['Colegio', 'Invitados']) &&
      atGroup.backLabel === fmt(en.backTo, { target: 'Salón' }) && atGroup.currentGroup === LEGACY_GROUP.Default.wlanId &&
      group.heading === 'Default' && group.badges.length === 0 &&
      group.summary === `${fmt(en.apMany, { count: 4 })} · ${fmt(en.networksMany, { count: 2 })}` &&
      isDeepStrictEqual(back.shown, ['viewAccessPoints']) && back.backHidden === true &&
      back.focus.linkKind === 'group' && back.focus.linkTarget === LEGACY_GROUP.Default.wlanId &&
      closed.apDetailsHidden === true && closed.destinationHidden === false,
      { altillo, inventory, salon, atGroup, group, back, closed }
    );
  }); // End of check "[en] AP details in English..."
} // End of function runEnglishInventoryChecks()

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
      await page.click(`#apList .ap-checkbox[data-mac="${firstMac}"]`);
      const apOnly = await readPreview(page);
      await page.click(`#apList .ap-checkbox[data-mac="${firstMac}"]`);
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

    await runEnglishInventoryChecks(session);

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

    await check('[en] Save with a different controller URL while connected: CONFIG_SAVE reports connectionReset, the old controller\'s lists are dropped at once (no stale rows: the loading skeletons while the auto-connect runs), the remembered site is forgotten', async () => {
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
          rowsDuring === 0 && during.apEmpty === null && during.apSkeleton === true && during.status === en.connecting &&
          during.destinationListLabel === en.groupsTitle.apGroup && during.destinationSkeleton === true && during.moveDisabled === true &&
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
// Launch 4: management access in Settings (Open API Client ID / Secret)
// ============================================================================

// Client Secrets typed in launch 4: none may ever show up in a CONFIG_LOAD
// result, in the DOM or in an input after the modal closes
const MGMT_SECRETS = ['smoke-client-secret-1', 'smoke-client-secret-2', 'smoke-session-secret-3', 'smoke-session-secret-4'];

/**
 * Reads the management-access section of the settings modal.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} Texts, field values, placeholder, notes, buttons and focus.
 */
function readManagementSection(page) {
  return page.evaluate(() => {
    const byId = (id) => document.getElementById(id);
    const shown = (id) => Boolean(byId(id)) && byId(id).closest('[hidden]') === null;
    return {
      heading: byId('managementHeading')?.textContent || '',
      help: byId('managementHelp')?.textContent || '',
      clientIdLabel: byId('labelClientId')?.textContent || '',
      clientSecretLabel: byId('labelClientSecret')?.textContent || '',
      clientId: byId('clientIdInput')?.value ?? null,
      clientSecret: byId('clientSecretInput')?.value ?? null,
      secretType: byId('clientSecretInput')?.type ?? null,
      placeholder: byId('clientSecretInput')?.placeholder ?? null,
      idDisabled: byId('clientIdInput')?.disabled,
      secretDisabled: byId('clientSecretInput')?.disabled,
      secretDescribedBy: byId('clientSecretInput')?.getAttribute('aria-describedby') ?? null,
      sessionNote: shown('managementSessionNote') ? byId('managementSessionNote').textContent : null,
      removalNote: shown('managementRemovalNote') ? byId('managementRemovalNote').textContent : null,
      removeShown: shown('removeManagementBtn'),
      removeDisabled: byId('removeManagementBtn')?.disabled,
      removeText: byId('removeManagementBtn')?.textContent || '',
      undoShown: shown('undoManagementRemovalBtn'),
      confirmShown: shown('managementRemoveConfirm'),
      confirmMessage: byId('managementRemoveMessage')?.textContent || '',
      activeId: document.activeElement?.id || '',
      settingsOpen: byId('settingsModal')?.classList.contains('visible'),
    };
  }); // End of the in-page management-section probe
} // End of function readManagementSection()

/**
 * Lists the known test secrets found in the renderer: in the DOM, in any
 * input's current value, or in a fresh CONFIG_LOAD result.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<string[]>} The leaked secrets (empty when clean).
 */
function findRendererSecrets(page) {
  return page.evaluate(async (secrets) => {
    const config = JSON.stringify(await window.omadaAPI.loadConfig());
    const values = Array.from(document.querySelectorAll('input')).map((input) => input.value).join('\n');
    const html = document.documentElement.outerHTML;
    return secrets.filter((secret) => config.includes(secret) || values.includes(secret) || html.includes(secret));
  }, MGMT_SECRETS);
}

/**
 * Opens Settings once no connection or load is in flight (the button is
 * disabled while connecting) and waits for focus in the URL field.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<void>}
 */
async function openSettingsWhenIdle(page) {
  await page.waitForFunction(() => document.getElementById('statusIndicator')?.classList.contains('connected'), null, { timeout: WAIT_MS });
  await waitForLoadIdle(page);
  await page.click('#settingsBtn');
  await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
  await page.waitForFunction(() => document.activeElement?.id === 'urlInput', null, { timeout: WAIT_MS });
}

/**
 * Waits until the settings modal has closed.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<void>}
 */
async function waitForSettingsClosed(page) {
  await page.waitForFunction(() => !document.getElementById('settingsModal').classList.contains('visible'), null, { timeout: WAIT_MS });
}

/**
 * Returns the payload of the latest CONFIG_SAVE call and the number of calls.
 * @param {object} session - The launch.
 * @returns {Promise<{ count: number; payload: object | null; config: object }>} The latest save and the stub's config.
 */
async function latestSave(session) {
  const snapshot = await stubState(session);
  const saves = callsTo(snapshot, 'config:save');
  return { count: saves.length, payload: saves.length > 0 ? saves[saves.length - 1].args[0] : null, config: snapshot.scenario.config };
}

/**
 * Management-access launch (Spanish, then English): the "Management access
 * (optional)" section in Settings — rendering, saving a Client ID + Client
 * Secret (sent once, never returned), the "(unchanged)" hint driven by
 * hasClientSecret and its URL / Client ID variants, Enter in the new fields,
 * the session-only note and toast when safeStorage is unavailable, Remove
 * with its inline confirmation (staged, applied by Save, undoable), and a
 * controller URL change clearing the management access. The stub keeps flags
 * only; the real main-process rules are unit-tested (config-model.test.ts)
 * and exercised end to end by the TLS probe.
 * @param {{ binary: string }} electronInfo - Resolved Electron binary.
 * @returns {Promise<void>}
 */
async function runManagementAccess(electronInfo) {
  const session = await launch(electronInfo, 'mgmt', {
    config: { url: CONTROLLER_URL, username: 'admin', language: 'es', hasPassword: true },
    connect: { success: true },
    controllerVersion: data.controllerVersion,
    accessPoints: data.accessPoints,
    wlanGroups: data.wlanGroups,
  });
  const { page } = session;
  const esStrings = uiStrings.es;
  const enStrings = uiStrings.en;
  const base = { url: CONTROLLER_URL, username: 'admin' };

  try {
    await checkTranslations(session, 'es');

    await check('[mgmt] es: Settings shows "Acceso de gestión (opcional)" with its help line, Client ID and a password-type Client Secret; nothing stored: no placeholder, no session-only note, "Quitar el acceso de gestión" disabled', async () => {
      await openSettingsWhenIdle(page);
      const section = await readManagementSection(page);
      return verdict(
        section.heading === esStrings['#managementHeading'] && section.help === esStrings['#managementHelp'] &&
        section.clientIdLabel === 'Client ID' && section.clientSecretLabel === 'Client Secret' && section.clientId === '' &&
        section.clientSecret === '' && section.secretType === 'password' && section.placeholder === '' && section.sessionNote === null &&
        section.secretDescribedBy === null && section.removeShown === true && section.removeDisabled === true &&
        section.removeText === esStrings['#removeManagementBtn'] && section.undoShown === false && section.confirmShown === false &&
        section.removalNote === null,
        section
      );
    }); // End of check "[mgmt] es: Settings shows "Acceso de gestión (opcional)"..."

    await check('[mgmt] es: Save with a Client ID and a Client Secret sends both once (Client ID trimmed, no password: the stored one is kept), closes, and main then reports hasClientSecret; the secret is in no CONFIG_LOAD result, input or DOM', async () => {
      await page.fill('#clientIdInput', '  owm-client-1  ');
      await page.fill('#clientSecretInput', MGMT_SECRETS[0]);
      await page.click('#saveSettingsBtn');
      await waitForSettingsClosed(page);
      const save = await latestSave(session);
      const leaks = await findRendererSecrets(page);
      return verdict(
        save.count === 1 && isDeepStrictEqual(save.payload, { ...base, language: 'es', clientId: 'owm-client-1', clientSecret: MGMT_SECRETS[0] }) &&
        save.config.clientId === 'owm-client-1' && save.config.hasClientSecret === true && save.config.clientSecretSessionOnly === false &&
        leaks.length === 0,
        { save, leaks }
      );
    }); // End of check "[mgmt] es: Save with a Client ID and a Client Secret send..."

    await check('[mgmt] es: reopened, the stored Client ID is shown and the empty Client Secret says "(sin cambios)" (hasClientSecret); a new URL says "(obligatorio para la nueva URL)", a new Client ID "(obligatorio para el nuevo Client ID)", restoring both "(sin cambios)" again; Save then sends no management field', async () => {
      await openSettingsWhenIdle(page);
      const opened = await readManagementSection(page);
      await page.fill('#urlInput', 'https://other-controller.invalid:8043');
      const newUrl = (await readManagementSection(page)).placeholder;
      await page.fill('#urlInput', CONTROLLER_URL);
      const sameUrl = (await readManagementSection(page)).placeholder;
      await page.fill('#clientIdInput', 'owm-client-2');
      const newId = (await readManagementSection(page)).placeholder;
      await page.fill('#clientIdInput', 'owm-client-1');
      const restored = (await readManagementSection(page)).placeholder;
      await page.click('#saveSettingsBtn');
      await waitForSettingsClosed(page);
      const save = await latestSave(session);
      return verdict(
        opened.clientId === 'owm-client-1' && opened.clientSecret === '' && opened.placeholder === '(sin cambios)' && opened.removeDisabled === false &&
        newUrl === '(obligatorio para la nueva URL)' && sameUrl === '(sin cambios)' && newId === '(obligatorio para el nuevo Client ID)' &&
        restored === '(sin cambios)' && save.count === 2 && isDeepStrictEqual(save.payload, { ...base, language: 'es' }) &&
        save.config.hasClientSecret === true && save.config.clientId === 'owm-client-1',
        { opened, newUrl, sameUrl, newId, restored, save }
      );
    }); // End of check "[mgmt] es: reopened..."

    await check('[mgmt] es: Enter in the Client ID field saves like the other fields — a new Client ID without its secret is refused ("Introduce el Client Secret: …") and nothing is sent; Enter in the Client Secret field then saves both', async () => {
      await openSettingsWhenIdle(page);
      await page.fill('#clientIdInput', 'owm-client-2');
      await page.press('#clientIdInput', 'Enter');
      await waitForToast(page, 'error', 'Introduce el Client Secret: …');
      const refused = await latestSave(session);
      const stillOpen = (await readManagementSection(page)).settingsOpen;
      await page.fill('#clientSecretInput', MGMT_SECRETS[1]);
      await page.press('#clientSecretInput', 'Enter');
      await waitForSettingsClosed(page);
      const save = await latestSave(session);
      return verdict(
        refused.count === 2 && stillOpen === true && save.count === 3 &&
        isDeepStrictEqual(save.payload, { ...base, language: 'es', clientId: 'owm-client-2', clientSecret: MGMT_SECRETS[1] }),
        { refused: refused.count, stillOpen, save }
      );
    }); // End of check "[mgmt] es: Enter in the Client ID field saves like the ot..."

    await check('[mgmt] es: without safeStorage the session-only note shows before saving ("Este equipo no puede guardar el Client Secret…", describing the secret field); a typed secret is then kept for this session only (info toast), and the note stays with "(sin cambios)" when reopened', async () => {
      const current = (await stubState(session)).scenario.config;
      await configureStub(session, { config: { ...current, canPersistClientSecret: false } });
      await openSettingsWhenIdle(page);
      const before = await readManagementSection(page);
      await page.fill('#clientSecretInput', MGMT_SECRETS[2]);
      await page.click('#saveSettingsBtn');
      await waitForSettingsClosed(page);
      await waitForToast(page, 'info', 'El Client Secret solo se conserva durante esta sesión.');
      const save = await latestSave(session);
      await openSettingsWhenIdle(page);
      const after = await readManagementSection(page);
      await page.click('#cancelSettingsBtn');
      await waitForSettingsClosed(page);
      return verdict(
        before.sessionNote === esStrings['#managementSessionNote'] && before.secretDescribedBy === 'managementSessionNote' &&
        isDeepStrictEqual(save.payload, { ...base, language: 'es', clientId: 'owm-client-2', clientSecret: MGMT_SECRETS[2] }) &&
        save.config.clientSecretSessionOnly === true && save.config.hasClientSecret === true &&
        after.sessionNote === esStrings['#managementSessionNote'] && after.placeholder === '(sin cambios)' && after.clientSecret === '',
        { before, save, after }
      );
    }); // End of check "[mgmt] es: without safeStorage..."

    await check('[mgmt] es: "Quitar el acceso de gestión" asks inline (focus on Cancelar); Cancelar goes back; Quitar empties and disables both fields, says "El acceso de gestión se quitará al guardar." and focuses "Mantener…", which undoes it; confirmed again, Save sends removeManagementAccess alone and nothing is stored any more', async () => {
      await openSettingsWhenIdle(page);
      await page.click('#removeManagementBtn');
      await page.waitForFunction(() => document.activeElement?.id === 'cancelManagementRemoveBtn', null, { timeout: WAIT_MS });
      const asking = await readManagementSection(page);
      await page.click('#cancelManagementRemoveBtn');
      const cancelled = await readManagementSection(page);
      await page.click('#removeManagementBtn');
      await page.click('#confirmManagementRemoveBtn');
      const staged = await readManagementSection(page);
      await page.click('#undoManagementRemovalBtn');
      const undone = await readManagementSection(page);
      await page.click('#removeManagementBtn');
      await page.click('#confirmManagementRemoveBtn');
      await page.click('#saveSettingsBtn');
      await waitForSettingsClosed(page);
      const save = await latestSave(session);
      return verdict(
        asking.confirmShown === true && asking.confirmMessage === esStrings['#managementRemoveMessage'] && asking.removeShown === false &&
        cancelled.confirmShown === false && cancelled.removeShown === true && cancelled.activeId === 'removeManagementBtn' &&
        staged.clientId === '' && staged.idDisabled === true && staged.secretDisabled === true && staged.removalNote === esStrings['#managementRemovalNote'] &&
        staged.undoShown === true && staged.removeShown === false && staged.activeId === 'undoManagementRemovalBtn' && staged.placeholder === '' &&
        undone.clientId === 'owm-client-2' && undone.idDisabled === false && undone.removalNote === null && undone.removeShown === true &&
        undone.activeId === 'removeManagementBtn' &&
        isDeepStrictEqual(save.payload, { ...base, language: 'es', removeManagementAccess: true }) &&
        save.config.clientId === '' && save.config.hasClientSecret === false && save.config.clientSecretSessionOnly === false,
        { asking, cancelled, staged, undone, save }
      );
    }); // End of check "[mgmt] es: Quitar el acceso de gestión..."

    await check('[mgmt] es: reopened after the removal nothing is stored (empty Client ID, no placeholder, Remove disabled); switching the language to English is saved', async () => {
      await openSettingsWhenIdle(page);
      const section = await readManagementSection(page);
      await page.selectOption('#languageSelect', 'en');
      await page.click('#saveSettingsBtn');
      await waitForSettingsClosed(page);
      const save = await latestSave(session);
      const lang = await page.evaluate(() => document.documentElement.lang);
      return verdict(
        section.clientId === '' && section.placeholder === '' && section.removeDisabled === true &&
        isDeepStrictEqual(save.payload, { ...base, language: 'en' }) && lang === 'en',
        { section, save, lang }
      );
    }); // End of check "[mgmt] es: reopened after the removal nothing is stored (..."

    await check('[mgmt] en: the section in English ("Management access (optional)", help, "Remove management access", the session-only note); saving a Client ID + secret says "The Client Secret is kept for this session only." and, reopened, the secret field says "(unchanged)"', async () => {
      await openSettingsWhenIdle(page);
      const before = await readManagementSection(page);
      await page.fill('#clientIdInput', 'owm-client-en');
      await page.fill('#clientSecretInput', MGMT_SECRETS[3]);
      await page.click('#saveSettingsBtn');
      await waitForSettingsClosed(page);
      await waitForToast(page, 'info', 'The Client Secret is kept for this session only.');
      const save = await latestSave(session);
      await openSettingsWhenIdle(page);
      const after = await readManagementSection(page);
      return verdict(
        before.heading === enStrings['#managementHeading'] && before.help === enStrings['#managementHelp'] &&
        before.removeText === enStrings['#removeManagementBtn'] && before.sessionNote === enStrings['#managementSessionNote'] &&
        before.placeholder === '' &&
        isDeepStrictEqual(save.payload, { ...base, language: 'en', clientId: 'owm-client-en', clientSecret: MGMT_SECRETS[3] }) &&
        after.clientId === 'owm-client-en' && after.placeholder === '(unchanged)' && after.sessionNote === enStrings['#managementSessionNote'],
        { before, save, after }
      );
    }); // End of check "[mgmt] en: the section in English..."

    await check('[mgmt] en: a controller URL change clears the management access — with the old Client ID still in its field the secret says "(required for the new URL)" and Save is refused ("Enter the Client Secret: …", nothing sent); with the field cleared the save goes through (connectionReset) and, reopened, nothing is stored', async () => {
      // The modal is still open from the previous check
      await page.fill('#urlInput', 'https://other-controller.invalid:8043');
      await page.fill('#passwordInput', 'other-password');
      const newUrl = await readManagementSection(page);
      await page.click('#saveSettingsBtn');
      await waitForToast(page, 'error', 'Enter the Client Secret: …');
      const refused = await latestSave(session);
      await page.fill('#clientIdInput', '');
      await page.click('#saveSettingsBtn');
      await waitForSettingsClosed(page);
      const save = await latestSave(session);
      await openSettingsWhenIdle(page);
      const after = await readManagementSection(page);
      await page.click('#cancelSettingsBtn');
      await waitForSettingsClosed(page);
      const leaks = await findRendererSecrets(page);
      return verdict(
        newUrl.placeholder === '(required for the new URL)' && refused.count === save.count - 1 &&
        isDeepStrictEqual(save.payload, { url: 'https://other-controller.invalid:8043', username: 'admin', language: 'en', password: 'other-password' }) &&
        save.config.clientId === '' && save.config.hasClientSecret === false && save.config.clientSecretSessionOnly === false &&
        after.clientId === '' && after.placeholder === '' && after.removeDisabled === true && leaks.length === 0,
        { newUrl: newUrl.placeholder, refused: refused.count, save, after, leaks }
      );
    }); // End of check "[mgmt] en: a controller URL change..."
  } finally {
    session.finalState = await stubState(session).catch((error) => ({ error: String(error) }));
    await session.app.close().catch(() => {});
  }
} // End of function runManagementAccess()

// ============================================================================
// Launch 5: management capabilities — the read-only banner per reason code
// and "Test management access" (Spanish, then English)
// ============================================================================

// The test's result lines and the banner texts per reason (src/renderer/i18n.ts)
const CAPS_TEXT = {
  es: {
    running: 'Probando el acceso de gestión…',
    result: {
      ok: 'El acceso de gestión funciona: se superaron todas las comprobaciones.',
      legacyController: 'Este controlador es anterior a Omada Controller 6.3: no admite la gestión (mover AP sí funciona).',
      managementNotConfigured: 'No hay un Client ID y un Client Secret guardados.',
      invalidCredentials: 'El controlador rechazó el Client ID o el Client Secret.',
      tokenFailed: 'No se pudo obtener un token de acceso de Open API (sin respuesta o con una respuesta inesperada). Comprueba que Open API está activado en el controlador.',
      siteNotFound: 'La aplicación de Open API no ve el sitio conectado. Revisa a qué sitios tiene acceso en el controlador.',
      apGroupsMismatch: 'Open API muestra grupos de AP distintos de los del controlador, así que la gestión queda desactivada.',
      probeFailed: 'Open API no devolvió los sitios o los grupos de AP (sin respuesta o con un error).',
      notConnected: 'Conéctate primero al controlador: la prueba usa la conexión actual.',
      unsavedChanges: 'Guarda primero los cambios: la prueba usa los ajustes guardados.',
      superseded: 'La conexión cambió durante la prueba. Vuelve a intentarlo.',
    },
    banner: {
      managementChecking: 'Comprobando el acceso de gestión — mientras tanto puedes consultar los datos.',
      legacyController: TEXT.es.readOnlyLegacy,
      managementNotConfigured: TEXT.es.readOnly63,
      invalidCredentials: 'El controlador rechazó el Client ID o el Client Secret de Open API — puedes consultar los datos. Revísalos en Ajustes → Acceso de gestión.',
      tokenFailed: 'No se pudo obtener un token de Open API del controlador — puedes consultar los datos. Usa "Probar el acceso de gestión" en Ajustes → Acceso de gestión.',
      siteNotFound: 'La aplicación de Open API no ve este sitio — puedes consultar los datos. Revisa a qué sitios tiene acceso en el controlador.',
      apGroupsMismatch: 'Open API muestra grupos de AP distintos de los del controlador, así que la gestión está desactivada — puedes consultar los datos.',
      probeFailed: 'Open API no respondió a las comprobaciones — puedes consultar los datos. Usa "Probar el acceso de gestión" en Ajustes → Acceso de gestión.',
    },
  },
  en: {
    running: 'Testing management access…',
    result: {
      ok: 'Management access works: every check passed.',
      legacyController: 'This controller is older than Omada Controller 6.3: management is not available (moving APs works).',
      managementNotConfigured: 'No Client ID and Client Secret are saved.',
      invalidCredentials: 'The controller rejected the Client ID or the Client Secret.',
      tokenFailed: 'Could not get an Open API access token (no answer, or an unexpected one). Check that the Open API is enabled in the controller.',
      siteNotFound: 'The Open API application cannot see the connected site. Check which sites it can access in the controller.',
      apGroupsMismatch: 'The Open API shows different AP groups than the controller, so management stays off.',
      probeFailed: 'The Open API did not return the sites or the AP groups (no answer, or an error).',
      notConnected: 'Connect to the controller first: the test uses the current connection.',
      unsavedChanges: 'Save your changes first: the test uses the saved settings.',
      superseded: 'The connection changed during the test. Try again.',
    },
    banner: {
      managementChecking: 'Checking management access — viewing is available meanwhile.',
      legacyController: TEXT.en.readOnlyLegacy,
      managementNotConfigured: TEXT.en.readOnly63,
      invalidCredentials: 'The controller rejected the Open API Client ID or Client Secret — viewing is available. Check them in Settings → Management access.',
      tokenFailed: 'Could not get an Open API access token from the controller — viewing is available. Use "Test management access" in Settings → Management access.',
      siteNotFound: 'The Open API application cannot see this site — viewing is available. Check which sites it can access in the controller.',
      apGroupsMismatch: 'The Open API shows different AP groups than the controller, so management is off — viewing is available.',
      probeFailed: 'The Open API did not answer the checks — viewing is available. Use "Test management access" in Settings → Management access.',
    },
  },
};

// Every reason code the test must report, with the stub scenario that makes
// main report it and the codes-only diagnostic shown after the text
const CAPS_REASONS = [
  { reason: 'invalidCredentials', patch: { managementReason: 'invalidCredentials', managementDiagnostic: 'invalidCredentials, errorCode -44106' } },
  { reason: 'tokenFailed', patch: { managementReason: 'tokenFailed', managementDiagnostic: 'httpError, HTTP 404' } },
  { reason: 'siteNotFound', patch: { managementReason: 'siteNotFound', managementDiagnostic: 'sites 2' } },
  { reason: 'apGroupsMismatch', patch: { managementReason: 'apGroupsMismatch', managementDiagnostic: 'Open API only 1, controller only 0, shared 3' } },
  { reason: 'probeFailed', patch: { managementReason: 'probeFailed', managementDiagnostic: 'ap-groups: timeout' } },
  { reason: 'managementNotConfigured', patch: { managementReason: 'managementNotConfigured', managementDiagnostic: null } },
  { reason: 'legacyController', patch: { managementReason: null, managementDiagnostic: null, controllerVersion: data.legacyControllerVersion } },
];

/**
 * Reads "Test management access": its button and its result line.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} Button text / aria-disabled / description, line shown / text / data-result / data-tone / role, focus.
 */
function readManagementTest(page) {
  return page.evaluate(() => {
    const line = document.getElementById('managementTestResult');
    const button = document.getElementById('testManagementBtn');
    return {
      button: button?.textContent ?? '',
      ariaDisabled: button?.getAttribute('aria-disabled') ?? null,
      describedBy: button?.getAttribute('aria-describedby') ?? null,
      shown: Boolean(line && !line.hidden),
      text: line?.textContent ?? '',
      result: line?.dataset.result ?? null,
      tone: line?.dataset.tone ?? null,
      role: line?.getAttribute('role') ?? null,
      activeId: document.activeElement?.id || '',
    };
  }); // End of the in-page management-test probe
} // End of function readManagementTest()

/**
 * Waits until the test's result line shows the given final text (not the
 * "testing" line).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} text - Expected text.
 * @returns {Promise<void>}
 */
async function waitForTestResult(page, text) {
  await page.waitForFunction((expected) => {
    const line = document.getElementById('managementTestResult');
    return Boolean(line) && !line.hidden && line.dataset.result !== 'testing' && line.textContent === expected;
  }, text, { timeout: WAIT_MS });
}

/**
 * Runs the test once per reason code (CAPS_REASONS), then with every check
 * passing, reading the result line and the banner (of the view behind the
 * open Settings) after each run.
 * @param {object} session - The launch.
 * @param {'es' | 'en'} language - UI language.
 * @returns {Promise<{ rows: object[]; ok: object; okNotices: object }>} What was read.
 */
async function runTestPerReason(session, language) {
  const { page } = session;
  const text = CAPS_TEXT[language];
  const rows = [];
  for (const { reason, patch } of CAPS_REASONS) {
    await configureStub(session, patch);
    const expected = patch.managementDiagnostic ? `${text.result[reason]} (${patch.managementDiagnostic})` : text.result[reason];
    await page.click('#testManagementBtn');
    await waitForTestResult(page, expected);
    rows.push({ reason, expected, test: await readManagementTest(page), notices: await readNotices(page) });
  } // End of the loop over the reason codes
  await configureStub(session, { managementReason: null, managementDiagnostic: null, controllerVersion: data.controllerVersion });
  await page.click('#testManagementBtn');
  await waitForTestResult(page, text.result.ok);
  return { rows, ok: await readManagementTest(page), okNotices: await readNotices(page) };
} // End of function runTestPerReason()

/**
 * Verdict over runTestPerReason(): each reason's precise text (with the
 * diagnostic), tone and data-result, the banner following it with its own
 * text, then "every check passed" with no banner; every test call carried the
 * session nonce of the installed session.
 * @param {object} session - The launch.
 * @param {'es' | 'en'} language - UI language.
 * @param {{ rows: object[]; ok: object; okNotices: object }} outcome - What runTestPerReason() read.
 * @returns {Promise<{ ok: boolean; detail: unknown }>} The verdict.
 */
async function testPerReasonVerdict(session, language, outcome) {
  const text = CAPS_TEXT[language];
  const snapshot = await stubState(session);
  const calls = callsTo(snapshot, 'management:test').slice(-(CAPS_REASONS.length + 1));
  const rowsOk = outcome.rows.every(({ reason, expected, test, notices }) =>
    test.shown && test.text === expected && test.result === reason && test.tone === 'off' && test.role === 'status' &&
    notices.bannerShown && notices.bannerReason === reason && notices.bannerText === text.banner[reason]);
  return verdict(
    rowsOk && outcome.rows.length === CAPS_REASONS.length &&
    outcome.ok.text === text.result.ok && outcome.ok.result === 'ok' && outcome.ok.tone === 'ok' && outcome.okNotices.bannerShown === false &&
    calls.length === CAPS_REASONS.length + 1 && calls.every((call) => call.args.length === 1 && call.args[0] === snapshot.sessionNonce),
    { rows: outcome.rows, ok: outcome.ok, okNotices: outcome.okNotices, calls: calls.map((call) => call.args), nonce: snapshot.sessionNonce }
  );
} // End of function testPerReasonVerdict()

/**
 * Management-capabilities launch: a single-site Omada 6.3 controller with
 * management access configured. The header names the site; the AP groups /
 * Wi-Fi networks banner says "checking" while main checks, then follows the
 * reported capabilities — one text per reason code — and disappears when
 * every check passes; "Test management access" reports each outcome
 * precisely (with main's diagnostic), refuses unsaved changes and a missing
 * connection without asking main, and handles a superseded session. Spanish,
 * then English after a saved language switch. The real checks are
 * unit-tested (controller-session.test.ts) and run end to end against a
 * local server by the TLS probe.
 * @param {{ binary: string }} electronInfo - Resolved Electron binary.
 * @returns {Promise<void>}
 */
async function runManagementCapabilities(electronInfo) {
  const session = await launch(electronInfo, 'caps', {
    config: { url: CONTROLLER_URL, username: 'admin', language: 'es', hasPassword: true, clientId: 'owm-client-1', hasClientSecret: true },
    connect: { success: true },
    siteName: 'Casa',
    controllerVersion: data.controllerVersion,
    accessPoints: data.accessPoints,
    wlanGroups: data.wlanGroups,
    delays: { 'management:capabilities': 1500 },
  });
  const { page } = session;
  const es = CAPS_TEXT.es;
  const en = CAPS_TEXT.en;

  try {
    await checkTranslations(session, 'es');

    await check('[caps] es: the header names the single site ("Sitio: Casa"); while main checks the management access the AP groups banner says "Comprobando el acceso de gestión — …" (managementChecking); with every check passed no banner shows on AP groups or Wi-Fi networks; the capabilities call carried the connect\'s session nonce', async () => {
      await waitForConnected(page);
      await waitForApCount(page, expectedApRows(data.accessPoints, 'es', 'apGroup', data.wlanGroups).length);
      await page.click('#navGroups');
      await page.waitForFunction(() => document.getElementById('readOnlyBanner')?.dataset.reason === 'managementChecking', null, { timeout: WAIT_MS });
      const checking = await readNotices(page);
      await page.waitForFunction(() => document.getElementById('readOnlyBanner')?.hidden === true, null, { timeout: WAIT_MS });
      const groups = await readNotices(page);
      await page.click('#navNetworks');
      const networks = await readNotices(page);
      const header = await readHeader(page);
      const snapshot = await stubState(session);
      const calls = callsTo(snapshot, 'management:capabilities');
      await configureStub(session, { delays: {} });
      return verdict(
        checking.bannerShown && checking.bannerText === es.banner.managementChecking && checking.bannerRole === 'note' &&
        !groups.bannerShown && groups.bannerReason === null && !networks.bannerShown &&
        header.site === fmt(TEXT.es.site, { site: 'Casa' }) && snapshot.issuedSessionNonces.length === 1 &&
        calls.length === 1 && isDeepStrictEqual(calls[0].args, [snapshot.issuedSessionNonces[0]]),
        { checking, groups, networks, header, calls, nonces: snapshot.issuedSessionNonces }
      );
    }); // End of check "[caps] es: the header names the single site..."

    await check('[caps] es: "Probar el acceso de gestión" (in Settings, below the section) reports each reason code precisely with main\'s diagnostic — and the banner follows with its own text; every check passed: "El acceso de gestión funciona: …" and no banner', async () => {
      await openSettingsWhenIdle(page);
      const before = await readManagementTest(page);
      const outcome = await runTestPerReason(session, 'es');
      const result = await testPerReasonVerdict(session, 'es', outcome);
      return verdict(
        result.ok && before.shown === false && before.button === 'Probar el acceso de gestión' && before.describedBy === 'managementTestResult',
        { before, detail: result.detail }
      );
    }); // End of check "[caps] es: Probar el acceso de gestión reports each reason code..."

    await check('[caps] es: while main runs the checks the line says "Probando el acceso de gestión…" (role status), the button keeps focus and is aria-disabled, and a second activation sends nothing more', async () => {
      await configureStub(session, { delays: { 'management:test': 800 }, managementReason: 'siteNotFound', managementDiagnostic: 'sites 2' });
      try {
        const before = callsTo(await stubState(session), 'management:test').length;
        await page.focus('#testManagementBtn');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('managementTestResult')?.dataset.result === 'testing', null, { timeout: WAIT_MS });
        const running = await readManagementTest(page);
        await page.keyboard.press('Enter');
        await waitForTestResult(page, `${es.result.siteNotFound} (sites 2)`);
        const done = await readManagementTest(page);
        const after = callsTo(await stubState(session), 'management:test').length;
        return verdict(
          running.text === es.running && running.tone === 'busy' && running.role === 'status' && running.ariaDisabled === 'true' &&
          running.activeId === 'testManagementBtn' && done.ariaDisabled === 'false' && done.activeId === 'testManagementBtn' && after === before + 1,
          { running, done, before, after }
        );
      } finally {
        await configureStub(session, { delays: {}, managementReason: null, managementDiagnostic: null });
      }
    }); // End of check "[caps] es: while main runs the checks..."

    await check('[caps] es: with unsaved management changes (a typed Client Secret, another Client ID, a staged removal) the test says "Guarda primero los cambios: …" and asks main nothing', async () => {
      const before = callsTo(await stubState(session), 'management:test').length;
      const results = [];
      await page.fill('#clientSecretInput', 'smoke-unsaved-secret');
      await page.click('#testManagementBtn');
      results.push(await readManagementTest(page));
      await page.fill('#clientSecretInput', '');
      await page.fill('#clientIdInput', 'owm-client-2');
      await page.click('#testManagementBtn');
      results.push(await readManagementTest(page));
      await page.fill('#clientIdInput', 'owm-client-1');
      await page.click('#removeManagementBtn');
      await page.click('#confirmManagementRemoveBtn');
      await page.click('#testManagementBtn');
      results.push(await readManagementTest(page));
      await page.click('#undoManagementRemovalBtn');
      const after = callsTo(await stubState(session), 'management:test').length;
      return verdict(
        results.every((test) => test.text === es.result.unsavedChanges && test.result === 'unsavedChanges' && test.tone === 'info') && after === before,
        { results, before, after }
      );
    }); // End of check "[caps] es: with unsaved management changes..."

    await check('[caps] es: an answer about a replaced session says "La conexión cambió durante la prueba. Vuelve a intentarlo."', async () => {
      await configureStub(session, { managementResult: { success: false, error: 'superseded' } });
      try {
        await page.click('#testManagementBtn');
        await waitForTestResult(page, es.result.superseded);
        const test = await readManagementTest(page);
        return verdict(test.result === 'superseded' && test.tone === 'info', test);
      } finally {
        await configureStub(session, { managementResult: null });
      }
    });

    await check('[caps] es: disconnected, Settings opens without the old result; the test says "Conéctate primero al controlador: …" and asks main nothing; no banner without data', async () => {
      await page.click('#cancelSettingsBtn');
      await waitForSettingsClosed(page);
      await page.click('#connectBtn');
      await waitForStatus(page, TEXT.es.disconnected);
      await page.click('#settingsBtn');
      await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
      const opened = await readManagementTest(page);
      const before = callsTo(await stubState(session), 'management:test').length;
      await page.click('#testManagementBtn');
      const test = await readManagementTest(page);
      const after = callsTo(await stubState(session), 'management:test').length;
      const notices = await readNotices(page);
      return verdict(
        opened.shown === false && test.text === es.result.notConnected && test.result === 'notConnected' && after === before && notices.bannerShown === false,
        { opened, test, before, after, notices }
      );
    }); // End of check "[caps] es: disconnected..."

    await check('[caps] en: switching to English (saved, reconnected): the banner says "Checking management access — …" while main checks, then none (every check passed); the new session nonce is used', async () => {
      await configureStub(session, { delays: { 'management:capabilities': 1500 } });
      try {
        await page.selectOption('#languageSelect', 'en');
        await page.click('#saveSettingsBtn');
        await waitForSettingsClosed(page);
        await waitForConnected(page);
        await page.waitForFunction(() => document.getElementById('readOnlyBanner')?.dataset.reason === 'managementChecking', null, { timeout: WAIT_MS });
        const checking = await readNotices(page);
        await page.waitForFunction(() => document.getElementById('readOnlyBanner')?.hidden === true, null, { timeout: WAIT_MS });
        const snapshot = await stubState(session);
        const calls = callsTo(snapshot, 'management:capabilities');
        return verdict(
          checking.bannerShown && checking.bannerText === en.banner.managementChecking && snapshot.issuedSessionNonces.length === 2 &&
          isDeepStrictEqual(calls[calls.length - 1].args, [snapshot.issuedSessionNonces[1]]),
          { checking, calls: calls.map((call) => call.args), nonces: snapshot.issuedSessionNonces }
        );
      } finally {
        await configureStub(session, { delays: {} });
      }
    }); // End of check "[caps] en: switching to English..."

    await check('[caps] en: "Test management access" reports each reason code in English with main\'s diagnostic, the banner follows with its English text; every check passed: "Management access works: …" and no banner', async () => {
      await openSettingsWhenIdle(page);
      const before = await readManagementTest(page);
      const outcome = await runTestPerReason(session, 'en');
      const result = await testPerReasonVerdict(session, 'en', outcome);
      return verdict(result.ok && before.shown === false && before.button === 'Test management access', { before, detail: result.detail });
    });

    await check('[caps] en: unsaved changes ("Save your changes first: …") and a replaced session ("The connection changed during the test. Try again.") in English', async () => {
      await page.fill('#clientSecretInput', 'smoke-unsaved-secret');
      await page.click('#testManagementBtn');
      const unsaved = await readManagementTest(page);
      await page.fill('#clientSecretInput', '');
      await configureStub(session, { managementResult: { success: false, error: 'superseded' } });
      try {
        await page.click('#testManagementBtn');
        await waitForTestResult(page, en.result.superseded);
        const superseded = await readManagementTest(page);
        return verdict(unsaved.text === en.result.unsavedChanges && superseded.result === 'superseded', { unsaved, superseded });
      } finally {
        await configureStub(session, { managementResult: null });
        await page.click('#cancelSettingsBtn');
        await waitForSettingsClosed(page);
      }
    }); // End of check "[caps] en: unsaved changes and a replaced session..."

    await check('[caps] AP-group management bridge (phase 16a, no UI yet): the four new preload methods reach their channels with the session nonce, and the stub answers with the real guards, DTO and codes — list with per-band capacity; create (trimmed) → nameTaken (case-insensitive) / nameRequired; rename → nameUnchanged; delete refused for the default group, a group with APs, and the new group while fresh data shows APs, networks or no AP count, then deleted; management off, a stale nonce and malformed payloads refused', async () => {
      return apGroupBridgeVerdict(session);
    });

    await check('[caps] Wi-Fi network read bridge (phase 17a, no UI yet): getManagedNetworks() reaches management:networks with the session nonce and the stub answers through the real validators and DTO — the networks derived from the groups, then "All access points", one bound to 3 groups, an unknown scope and a binding list with a non-24-hex AP-group id (unknown scope, never filtered); no passphrase or sentinel secret in any reply; a malformed catalog / detail / bindings and a scripted error answered with codes; management off, a stale nonce and a malformed nonce refused', async () => {
      return networkBridgeVerdict(session);
    });

    await check('[caps] Wi-Fi network write bridge (phase 18a, no UI yet): the five new preload methods reach their channels with the session nonce, and the stub answers through the real guards, write rules, read-merge-write and DTO — create (trimmed, disabled, WPA-Personal, bound to 2 groups; the exact body) shows on the next read and in the groups; Enterprise / no passphrase / a 34-byte name / an unknown group refused; a rename without the re-typed passphrase refused, with it saved (every reported setting kept); to open (a passphrase refused), back to WPA-Personal, Change password (too short refused, then saved; refused on an open network), enabled; a scripted nameTaken; fresh data turning the network Enterprise refuses edits but not disable or delete; management off, a stale nonce, malformed payloads and an unknown network refused; no passphrase in any reply', async () => {
      return networkWriteBridgeVerdict(session);
    });
  } finally {
    session.finalState = await stubState(session).catch((error) => ({ error: String(error) }));
    await session.app.close().catch(() => {});
  }
} // End of function runManagementCapabilities()

/**
 * Calls one window.omadaAPI method from the renderer and reports its value
 * or the rejection message (never throws).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} method - The bridge method.
 * @param {unknown} arg - Its single argument.
 * @returns {Promise<{ value?: unknown; rejected?: string }>} The outcome.
 */
function callBridge(page, method, arg) {
  return page.evaluate(async ({ name, argument }) => {
    try {
      return { value: await window.omadaAPI[name](argument) };
    } catch (error) {
      return { rejected: String(error && error.message ? error.message : error) };
    }
  }, { name: method, argument: arg });
}

/**
 * The phase 16a AP-group bridge check of the [caps] launch: drives the four
 * new preload methods against the stub (no UI involved) and restores the
 * stub's groups afterwards (the created group is deleted again).
 * @param {object} session - The launch.
 * @returns {Promise<{ ok: boolean; detail: unknown }>} The verdict.
 */
async function apGroupBridgeVerdict(session) {
  const { page } = session;
  const before = await stubState(session);
  const nonce = before.sessionNonce;
  const groupsBefore = before.scenario.wlanGroups;
  const defaultGroup = groupsBefore.find((group) => group.isDefault === true);
  const busyGroup = groupsBefore.find((group) => group.isDefault !== true && before.scenario.accessPoints.some((ap) => ap.wlanGroup === group.wlanName));
  // The renderer reads the managed list itself since phase 16b: this check's
  // calls start after the ones it made
  const listCallsBefore = callsTo(before, 'management:ap-groups').length;
  const outcome = {};
  try {
    outcome.list = await callBridge(page, 'getManagedApGroups', nonce);
    outcome.created = await callBridge(page, 'createApGroup', { sessionNonce: nonce, name: '  Grupo de prueba  ' });
    const id = outcome.created.value && outcome.created.value.apGroupId;
    outcome.duplicate = await callBridge(page, 'createApGroup', { sessionNonce: nonce, name: 'GRUPO DE PRUEBA' });
    outcome.blank = await callBridge(page, 'createApGroup', { sessionNonce: nonce, name: '   ' });
    outcome.renamed = await callBridge(page, 'renameApGroup', { sessionNonce: nonce, apGroupId: id, name: 'Grupo renombrado' });
    outcome.unchanged = await callBridge(page, 'renameApGroup', { sessionNonce: nonce, apGroupId: id, name: ' Grupo renombrado ' });
    outcome.deleteDefault = await callBridge(page, 'deleteApGroup', { sessionNonce: nonce, apGroupId: defaultGroup.wlanId });
    outcome.deleteBusy = await callBridge(page, 'deleteApGroup', { sessionNonce: nonce, apGroupId: busyGroup.wlanId });
    // Fresh data the renderer has not seen: APs, networks, no AP count, a
    // network list with a non-string entry (unknown, never "no networks")
    const freshCases = [
      ['freshAps', { apNum: 2 }],
      ['freshNetworks', { ssidNameList: ['Casa'] }],
      ['freshUnknown', { apNum: null }],
      ['freshBadNetworks', { ssidNameList: [null] }],
    ];
    for (const [key, fields] of freshCases) {
      await configureStub(session, { apGroupOverrides: { [id]: fields } });
      outcome[key] = await callBridge(page, 'deleteApGroup', { sessionNonce: nonce, apGroupId: id });
    }
    await configureStub(session, { apGroupOverrides: {}, managementReason: 'apGroupsMismatch' });
    outcome.off = await callBridge(page, 'deleteApGroup', { sessionNonce: nonce, apGroupId: id });
    await configureStub(session, { managementReason: null });
    outcome.stale = await callBridge(page, 'getManagedApGroups', 'f'.repeat(32));
    outcome.extraKey = await callBridge(page, 'deleteApGroup', { sessionNonce: nonce, apGroupId: id, force: true });
    outcome.badId = await callBridge(page, 'deleteApGroup', { sessionNonce: nonce, apGroupId: 'Corrupto' });
    outcome.badNonce = await callBridge(page, 'createApGroup', { sessionNonce: 'ABC', name: 'x' });
    outcome.deleted = await callBridge(page, 'deleteApGroup', { sessionNonce: nonce, apGroupId: id });
  } finally {
    await configureStub(session, { apGroupOverrides: {}, managementReason: null });
  }
  const after = await stubState(session);
  const id = outcome.created.value && outcome.created.value.apGroupId;
  const list = outcome.list.value || {};
  const groups = list.groups || [];
  const empty = groups.find((group) => group.name === 'Exterior');
  /**
   * The error code of one recorded bridge outcome.
   * @param {string} key - The outcome's key.
   * @returns {string | undefined} The reply's `error`.
   */
  const code = (key) => outcome[key].value && outcome[key].value.error;
  const ok =
    list.success === true && groups.length === groupsBefore.length &&
    isDeepStrictEqual(groups.map((group) => group.id).sort(), groupsBefore.map((group) => group.wlanId).sort()) &&
    groups.filter((group) => group.isDefault).map((group) => group.id).join() === defaultGroup.wlanId &&
    isDeepStrictEqual(empty, { id: empty && empty.id, name: 'Exterior', isDefault: false, apCount: 0, networkNames: [], remainingBinding: { band2g: 8, band5g: 8, band6g: 8 } }) &&
    isDeepStrictEqual(list.ssidLimits, { band2g: 8, band5g: 8, band6g: 8, mlo: 4 }) &&
    outcome.created.value && outcome.created.value.success === true && /^[0-9a-f]{24}$/.test(id) &&
    code('duplicate') === 'nameTaken' && code('blank') === 'nameRequired' &&
    outcome.renamed.value && outcome.renamed.value.success === true && code('unchanged') === 'nameUnchanged' &&
    code('deleteDefault') === 'groupIsDefault' && code('deleteBusy') === 'groupNotEmpty' &&
    code('freshAps') === 'groupNotEmpty' && code('freshNetworks') === 'groupHasNetworks' && code('freshUnknown') === 'groupStateUnknown' &&
    code('freshBadNetworks') === 'groupStateUnknown' &&
    code('off') === 'managementUnavailable' && code('stale') === 'superseded' &&
    /invalid AP-group request keys/.test(outcome.extraKey.rejected || '') && /invalid AP group id format/.test(outcome.badId.rejected || '') &&
    /invalid session nonce format/.test(outcome.badNonce.rejected || '') &&
    outcome.deleted.value && outcome.deleted.value.success === true &&
    isDeepStrictEqual(after.apGroupWrites, [
      { op: 'create', apGroupId: id, name: 'Grupo de prueba' },
      { op: 'rename', apGroupId: id, name: 'Grupo renombrado' },
      { op: 'delete', apGroupId: id },
    ]) &&
    isDeepStrictEqual(after.scenario.wlanGroups, groupsBefore) &&
    callsTo(after, 'management:ap-groups')[listCallsBefore].args[0] === nonce;
  return verdict(ok, { outcome, writes: after.apGroupWrites });
} // End of function apGroupBridgeVerdict()

/**
 * The phase 17a Wi-Fi network bridge check of the [caps] launch: drives
 * getManagedNetworks() against the stub (no UI involved) with the networks
 * derived from the fixture groups, then scripted raw payloads (an "All
 * access points" network, one bound to three groups, one with values the ops
 * doc does not define, one whose bound AP-group ids include one that is not
 * 24 hex digits — the whole list dropped, an unknown scope —, sentinel
 * secrets at every depth), malformed payloads and errors; restores the
 * stub's network knobs afterwards.
 * @param {object} session - The launch.
 * @returns {Promise<{ ok: boolean; detail: unknown }>} The verdict.
 */
async function networkBridgeVerdict(session) {
  const { page } = session;
  const before = await stubState(session);
  const nonce = before.sessionNonce;
  const callsBefore = callsTo(before, 'management:networks').length;
  const [g1, g2, g3] = ['Default', 'zGrupo B', 'zNinguna'].map((name) => GROUP[name].wlanId);
  const ids = ['5f00c0ffee0000000000c0a1', '5f00c0ffee0000000000c0a2', '5f00c0ffee0000000000c0a3', '5f00c0ffee0000000000c0a4'];
  // 24 characters, but not hex digits: not an AP-group id
  const badGroupId = 'zGrupoCorrupto0000000000';
  const scripted = [
    {
      entry: { id: ids[0], name: 'Todos los AP', description: false, chooseDevices: 0, band: 7, security: 0 },
      detail: { id: ids[0], chooseDevices: 0, band: 7, security: 0 },
      bindings: { apGroups: [] },
    },
    {
      entry: { id: ids[1], name: 'Tres grupos', ssidEnable: true, chooseDevices: 1, band: 2, security: 3, securityKey: 'SENTINEL-smoke-catalog-key' },
      detail: {
        id: ids[1], ssidEnable: true, chooseDevices: 1, band: 2, security: 3, apGroupIds: [g3, g1, g2],
        pskSetting: { securityKey: 'SENTINEL-smoke-key', history: ['SENTINEL-smoke-old-key'] },
        entSetting: { radiusSecret: 'SENTINEL-smoke-radius' },
        ppskSetting: { keys: [{ key: 'SENTINEL-smoke-ppsk' }] },
        unknownKey: { deep: [{ token: 'SENTINEL-smoke-deep' }] },
      },
      bindings: { apGroups: [{ id: g1, name: 'SENTINEL-smoke-group-name' }, { id: g2 }, { id: g3 }], extra: 'SENTINEL-smoke-extra' },
    },
    {
      entry: { id: ids[2], name: 'Rara', description: 'SENTINEL-smoke-description', chooseDevices: 7, band: 0, security: 9 },
      detail: { id: ids[2], chooseDevices: 7 },
      bindings: {},
    },
    {
      entry: { id: ids[3], name: 'Grupo corrupto', ssidEnable: true, chooseDevices: 1, band: 1, security: 0 },
      detail: { id: ids[3], chooseDevices: 1, apGroupIds: [g1, badGroupId] },
      bindings: { apGroups: [{ id: g1 }, { id: badGroupId }] },
    },
  ];
  const valid = scripted[0];
  const outcome = {};
  try {
    outcome.derived = await callBridge(page, 'getManagedNetworks', nonce);
    await configureStub(session, { networks: scripted });
    outcome.scripted = await callBridge(page, 'getManagedNetworks', nonce);
    await configureStub(session, { networks: [{ entry: { name: 'Sin id' }, detail: {}, bindings: {} }] });
    outcome.badCatalog = await callBridge(page, 'getManagedNetworks', nonce);
    await configureStub(session, { networks: [{ ...valid, detail: { id: ids[1] } }] });
    outcome.badDetail = await callBridge(page, 'getManagedNetworks', nonce);
    await configureStub(session, { networks: [{ ...valid, bindings: { apGroups: [{ id: g1 }, null] } }] });
    outcome.badBindings = await callBridge(page, 'getManagedNetworks', nonce);
    await configureStub(session, { networks: null, networksResult: { success: false, error: 'requestFailed', diagnostic: 'ssids: httpError, HTTP 503' } });
    outcome.scriptedError = await callBridge(page, 'getManagedNetworks', nonce);
    await configureStub(session, { networksResult: null, managementReason: 'apGroupsMismatch' });
    outcome.off = await callBridge(page, 'getManagedNetworks', nonce);
    await configureStub(session, { managementReason: null });
    outcome.stale = await callBridge(page, 'getManagedNetworks', 'f'.repeat(32));
    outcome.badNonce = await callBridge(page, 'getManagedNetworks', 'ABC');
  } finally {
    await configureStub(session, { networks: null, networksResult: null, managementReason: null });
  }
  const after = await stubState(session);
  const derived = (outcome.derived.value && outcome.derived.value.networks) || [];
  const expectedNames = [...new Set(data.wlanGroups.flatMap((group) => group.ssidList.map((ssid) => ssid.ssidName)))];
  const derivedOk =
    outcome.derived.value.success === true && derived.length === expectedNames.length &&
    expectedNames.every((name) => {
      const network = derived.find((candidate) => candidate.name === name);
      const groupIds = data.wlanGroups.filter((group) => group.ssidList.some((ssid) => ssid.ssidName === name)).map((group) => group.wlanId);
      return network && network.scope === 'apGroups' && isDeepStrictEqual([...network.apGroupIds].sort(), groupIds.sort()) &&
        network.security === 'wpaPersonal' && network.enabled === true && network.hasPassphrase === true &&
        isDeepStrictEqual(network.bands, ['band2g', 'band5g']) && isDeepStrictEqual(Object.keys(network).sort(), NETWORK_DTO_KEYS);
    });
  /**
   * The error code and diagnostic of one recorded bridge outcome.
   * @param {string} key - The outcome's key.
   * @returns {string} "error | diagnostic".
   */
  const failure = (key) => (outcome[key].value ? `${outcome[key].value.error} | ${outcome[key].value.diagnostic}` : 'none');
  const replies = JSON.stringify(outcome);
  const ok =
    derivedOk &&
    isDeepStrictEqual(outcome.scripted.value, {
      success: true,
      networks: [
        { id: ids[0], name: 'Todos los AP', security: 'open', bands: ['band2g', 'band5g', 'band6g'], enabled: false, hasPassphrase: false, scope: 'allAccessPoints', apGroupIds: [] },
        { id: ids[1], name: 'Tres grupos', security: 'wpaPersonal', bands: ['band5g'], enabled: true, hasPassphrase: true, scope: 'apGroups', apGroupIds: [g1, g2, g3] },
        { id: ids[2], name: 'Rara', security: 'unknown', bands: null, enabled: null, hasPassphrase: null, scope: 'unknown', apGroupIds: null },
        { id: ids[3], name: 'Grupo corrupto', security: 'open', bands: ['band2g'], enabled: true, hasPassphrase: false, scope: 'unknown', apGroupIds: null },
      ],
    }) &&
    failure('badCatalog') === 'requestFailed | ssids: malformedResponse' &&
    failure('badDetail') === 'requestFailed | ssid detail: malformedResponse' &&
    failure('badBindings') === 'requestFailed | ssid ap-groups: malformedResponse' &&
    failure('scriptedError') === 'requestFailed | ssids: httpError, HTTP 503' &&
    failure('off') === 'managementUnavailable | undefined' && failure('stale') === 'superseded | undefined' &&
    /invalid session nonce format/.test(outcome.badNonce.rejected || '') &&
    !replies.includes('SENTINEL') && !replies.includes('stub-passphrase') &&
    callsTo(after, 'management:networks')[callsBefore].args[0] === nonce &&
    after.scenario.networks === null && after.scenario.networksResult === null;
  return verdict(ok, { outcome });
} // End of function networkBridgeVerdict()

/**
 * The phase 18a Wi-Fi network write bridge check of the [caps] launch: drives
 * the five new preload methods against the stub (no UI involved) — one
 * network created, edited, re-secured (the PMF mode derived for each
 * security change), re-keyed, enabled, given Enhanced IoT Connectivity by
 * "fresh data" (a band change then refused as securityBandConflict), turned
 * Enterprise by "fresh data", disabled and deleted; an open create on 6 GHz
 * refused — and restores the stub's networks,
 * groups and knobs afterwards. Sentinel passphrases must never come back in
 * a reply.
 * @param {object} session - The launch.
 * @returns {Promise<{ ok: boolean; detail: unknown }>} The verdict.
 */
async function networkWriteBridgeVerdict(session) {
  const { page } = session;
  const before = await stubState(session);
  const nonce = before.sessionNonce;
  const groupsBefore = before.scenario.wlanGroups;
  const writesBefore = before.networkWrites.length;
  const [g1, g2] = ['Default', 'zGrupo B'].map((name) => GROUP[name].wlanId);
  const [pass1, pass2, pass3] = ['SENTINEL-smoke-pass-1-18a', 'SENTINEL-smoke-pass-2-18a', 'SENTINEL-smoke-pass-3-18a'];
  const outcome = {};
  let id = null;
  let groupsAfterCreate = null;
  /**
   * Calls one network write with this launch's session nonce.
   * @param {string} method - The bridge method.
   * @param {object} fields - The request without the nonce.
   * @returns {Promise<{ value?: unknown; rejected?: string }>} The outcome.
   */
  const write = (method, fields) => callBridge(page, method, { sessionNonce: nonce, ...fields });
  try {
    outcome.created = await write('createNetwork', { name: '  Red de prueba  ', security: 'wpaPersonal', bands: ['band5g', 'band2g'], apGroupIds: [g1, g2], passphrase: pass1 });
    id = outcome.created.value && outcome.created.value.networkId;
    groupsAfterCreate = (await stubState(session)).scenario.wlanGroups;
    outcome.afterCreate = await callBridge(page, 'getManagedNetworks', nonce);
    outcome.enterprise = await write('createNetwork', { name: 'Empresa', security: 'wpaEnterprise', bands: ['band2g'], apGroupIds: [g1] });
    outcome.noPass = await write('createNetwork', { name: 'Sin clave', security: 'wpaPersonal', bands: ['band2g'], apGroupIds: [g1] });
    outcome.longName = await write('createNetwork', { name: 'é'.repeat(17), security: 'open', bands: ['band2g'], apGroupIds: [g1] });
    outcome.unknownGroup = await write('createNetwork', { name: 'Huérfana', security: 'open', bands: ['band2g'], apGroupIds: ['6512a0e1f3b2c41d2e3f4a00'] });
    outcome.open6g = await write('createNetwork', { name: 'Abierta 6 GHz', security: 'open', bands: ['band2g', 'band6g'], apGroupIds: [g1] });
    outcome.renameNoPass = await write('updateNetwork', { networkId: id, name: 'Red renombrada' });
    outcome.renamed = await write('updateNetwork', { networkId: id, name: 'Red renombrada', passphrase: pass1 });
    outcome.openWithPass = await write('updateNetwork', { networkId: id, security: 'open', passphrase: pass2 });
    outcome.opened = await write('updateNetwork', { networkId: id, security: 'open' });
    outcome.passOnOpen = await write('changeNetworkPassword', { networkId: id, passphrase: pass2 });
    outcome.toWpa = await write('updateNetwork', { networkId: id, security: 'wpaPersonal', bands: ['band2g'], passphrase: pass2 });
    outcome.shortPass = await write('changeNetworkPassword', { networkId: id, passphrase: 'corta' });
    outcome.password = await write('changeNetworkPassword', { networkId: id, passphrase: pass3 });
    outcome.enabled = await write('setNetworkEnabled', { networkId: id, enabled: true });
    outcome.afterEdits = await callBridge(page, 'getManagedNetworks', nonce);
    await configureStub(session, { networkResults: { 'management:network-update': { success: false, error: 'nameTaken', diagnostic: 'ssid basic-config: apiError, errorCode -33219' } } });
    outcome.scripted = await write('updateNetwork', { networkId: id, name: 'Casa', passphrase: pass3 });
    await configureStub(session, { networkResults: {} });
    // Fresh data the renderer has not seen: Enhanced IoT Connectivity is on,
    // so a band change adding 5 GHz conflicts with it (never flipped)
    const iot = (await stubState(session)).scenario.networks.map((network) =>
      network.entry.id === id ? { ...network, detail: { ...network.detail, enhancedIotConnectivity: true } } : network
    );
    await configureStub(session, { networks: iot });
    outcome.iotConflict = await write('updateNetwork', { networkId: id, bands: ['band2g', 'band5g'], passphrase: pass3 });
    // Fresh data the renderer has not seen: the network is Enterprise now
    const live = (await stubState(session)).scenario.networks.map((network) =>
      network.entry.id === id ? { ...network, entry: { ...network.entry, security: 2 }, detail: { ...network.detail, security: 2 } } : network
    );
    await configureStub(session, { networks: live });
    outcome.freshEnterprise = await write('updateNetwork', { networkId: id, name: 'Otra', passphrase: pass3 });
    outcome.freshEnterprisePass = await write('changeNetworkPassword', { networkId: id, passphrase: pass3 });
    outcome.disabled = await write('setNetworkEnabled', { networkId: id, enabled: false });
    await configureStub(session, { managementReason: 'apGroupsMismatch' });
    outcome.off = await write('deleteNetwork', { networkId: id });
    await configureStub(session, { managementReason: null });
    outcome.stale = await callBridge(page, 'deleteNetwork', { sessionNonce: 'f'.repeat(32), networkId: id });
    outcome.extraKey = await write('deleteNetwork', { networkId: id, force: true });
    outcome.badSecurity = await write('createNetwork', { name: 'x', security: 'wep', bands: ['band2g'], apGroupIds: [g1] });
    outcome.badEnabled = await write('setNetworkEnabled', { networkId: id, enabled: 'yes' });
    outcome.badId = await write('deleteNetwork', { networkId: '../x' });
    outcome.unknownNetwork = await write('deleteNetwork', { networkId: 'no-such-network' });
    outcome.deleted = await write('deleteNetwork', { networkId: id });
    outcome.afterDelete = await callBridge(page, 'getManagedNetworks', nonce);
  } finally {
    await configureStub(session, { networks: null, networkResults: {}, managementReason: null, wlanGroups: groupsBefore });
  }
  const after = await stubState(session);
  const writes = after.networkWrites.slice(writesBefore);
  /**
   * The error code of one recorded bridge outcome.
   * @param {string} key - The outcome's key.
   * @returns {string | undefined} The reply's `error`.
   */
  const code = (key) => outcome[key].value && outcome[key].value.error;
  /**
   * Whether one recorded bridge outcome is a plain success.
   * @param {string} key - The outcome's key.
   * @returns {boolean} True for { success: true }.
   */
  const succeeded = (key) => isDeepStrictEqual(outcome[key].value, { success: true });
  /**
   * The managed network with the created id in one recorded read.
   * @param {string} key - The outcome's key.
   * @returns {object | undefined} The DTO.
   */
  const created = (key) => ((outcome[key].value && outcome[key].value.networks) || []).find((network) => network.id === id);
  const kept = { guestNetEnable: false, broadcast: true, vlanEnable: false, mloEnable: false, pmfMode: 2, enable11r: false, hidePwd: false };
  const psk = (securityKey) => ({ securityKey, versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: false });
  const replies = JSON.stringify(outcome);
  const ok =
    /^[0-9a-f]{24}$/.test(id || '') && isDeepStrictEqual(outcome.created.value, { success: true, networkId: id }) &&
    isDeepStrictEqual(created('afterCreate'), { id, name: 'Red de prueba', security: 'wpaPersonal', bands: ['band2g', 'band5g'], enabled: false, hasPassphrase: true, scope: 'apGroups', apGroupIds: [g1, g2] }) &&
    [g1, g2].every((groupId) => groupsAfterCreate.find((group) => group.wlanId === groupId).ssidList.some((ssid) => ssid.ssidName === 'Red de prueba')) &&
    code('enterprise') === 'unsupportedSecurity' && code('noPass') === 'passphraseRequired' && code('longName') === 'nameTooLong' &&
    code('unknownGroup') === 'groupNotFound' && code('renameNoPass') === 'passphraseRequired' && succeeded('renamed') &&
    isDeepStrictEqual(outcome.open6g.value, { success: false, error: 'securityBandConflict', diagnostic: 'conflict: oweEnable' }) &&
    isDeepStrictEqual(outcome.iotConflict.value, { success: false, error: 'securityBandConflict', diagnostic: 'conflict: enhancedIotConnectivity' }) &&
    code('openWithPass') === 'passphraseNotApplicable' && succeeded('opened') && code('passOnOpen') === 'passphraseNotApplicable' &&
    succeeded('toWpa') && code('shortPass') === 'passphraseInvalid' && succeeded('password') && succeeded('enabled') &&
    isDeepStrictEqual(created('afterEdits'), { id, name: 'Red renombrada', security: 'wpaPersonal', bands: ['band2g'], enabled: true, hasPassphrase: true, scope: 'apGroups', apGroupIds: [g1, g2] }) &&
    isDeepStrictEqual(outcome.scripted.value, { success: false, error: 'nameTaken', diagnostic: 'ssid basic-config: apiError, errorCode -33219' }) &&
    code('freshEnterprise') === 'unsupportedSecurity' && code('freshEnterprisePass') === 'unsupportedSecurity' && succeeded('disabled') &&
    code('off') === 'managementUnavailable' && code('stale') === 'superseded' &&
    /invalid Wi-Fi network request keys/.test(outcome.extraKey.rejected || '') && /invalid Wi-Fi network security/.test(outcome.badSecurity.rejected || '') &&
    /invalid Wi-Fi network enable state/.test(outcome.badEnabled.rejected || '') && /invalid Wi-Fi network id format/.test(outcome.badId.rejected || '') &&
    isDeepStrictEqual(outcome.unknownNetwork.value, { success: false, error: 'requestFailed', diagnostic: 'ssid detail: malformedResponse' }) &&
    succeeded('deleted') && outcome.afterDelete.value.success === true && created('afterDelete') === undefined &&
    isDeepStrictEqual(writes, [
      {
        op: 'create', networkId: id,
        body: { name: 'Red de prueba', deviceType: 1, ssidEnable: false, chooseDevices: 1, apGroupIds: [g1, g2], band: 3, security: 3, ...kept, pskSetting: psk(pass1) },
      },
      { op: 'update', networkId: id, body: { name: 'Red renombrada', band: 3, security: 3, ...kept, pskSetting: psk(pass1) } },
      // WPA-Personal → open without OWE: PMF disabled (derived); open → WPA2-PSK keeps it (still valid)
      { op: 'update', networkId: id, body: { name: 'Red renombrada', band: 3, security: 0, ...kept, pmfMode: 3 } },
      { op: 'update', networkId: id, body: { name: 'Red renombrada', band: 1, security: 3, ...kept, pmfMode: 3, pskSetting: psk(pass2) } },
      { op: 'password', networkId: id, body: { name: 'Red renombrada', band: 1, security: 3, ...kept, pmfMode: 3, pskSetting: psk(pass3) } },
      { op: 'enable', networkId: id, enabled: true },
      { op: 'enable', networkId: id, enabled: false },
      { op: 'delete', networkId: id },
    ]) &&
    !replies.includes('SENTINEL') && !replies.includes('stub-passphrase') &&
    callsTo(after, 'management:network-create')[0].args[0].sessionNonce === nonce &&
    isDeepStrictEqual(after.scenario.wlanGroups, groupsBefore) && after.scenario.networks === null;
  return verdict(ok, { outcome, writes });
} // End of function networkWriteBridgeVerdict()

// ============================================================================
// Launch 6: AP group management (phase 16b) — New group, Rename, Delete with
// its reasons and confirmation (hidden for the default group), the per-band
// capacity and the Capacity warning badge, "Move access points here", the
// actions hidden while management is off or being re-checked (Spanish, then
// English)
// ============================================================================

// A group the internal list carries with an id main would refuse for a
// write (not 24 hex digits, but a valid internal group id)
const UNWRITABLE_GROUP = { wlanId: 'legacy_group_01', wlanName: 'Antiguo', ssidList: [] };
// The groups of the management launch: the fixture's plus that one
const MGMT_GROUPS = [...data.wlanGroups, UNWRITABLE_GROUP];
// The groups the renderer keeps (the fixture's malformed id is dropped)
const MGMT_VALID_GROUP_COUNT = MGMT_GROUPS.filter((group) => WLAN_ID_REGEX.test(group.wlanId)).length;
// The per-group SSID limits the stub reports by default (apGroupSsidLimits)
const DEFAULT_SSID_LIMITS = { band2g: 8, band5g: 8, band6g: 8, mlo: 4 };

// AP group management strings the checks read (src/renderer/i18n.ts;
// twoBands: how the badge's sentence joins 2.4 and 6 GHz, Intl.ListFormat)
const GROUPS_TEXT = {
  es: {
    newGroup: 'Nuevo grupo', rename: 'Cambiar nombre', delete: 'Eliminar', moveHere: 'Mover puntos de acceso aquí', actionsLabel: 'Acciones del grupo',
    notWritable: 'El identificador de este grupo tiene un formato inesperado: la aplicación no puede cambiarle el nombre ni eliminarlo.',
    blockedNotEmpty: 'Para eliminarlo, mueve antes sus puntos de acceso a otro grupo.',
    blockedHasNetworks: 'Para eliminarlo, desvincula antes sus redes Wi-Fi.',
    capacityTitle: 'Capacidad por banda', capacityHelp: 'Cuántas redes Wi-Fi más puede emitir este grupo en cada banda.',
    bands: { band2g: '2,4 GHz', band5g: '5 GHz', band6g: '6 GHz', mlo: 'MLO' },
    freeOf: '{remaining} libres de {limit}', notReportedLimit: 'No informado (límite: {limit})', notReported: 'No informado',
    capacityBadge: 'Aviso de capacidad', capacityDetail: 'Sin espacio para más redes Wi-Fi en {bands}', twoBands: '2,4 GHz y 6 GHz',
    createTitle: 'Nuevo grupo de AP',
    createMessage: 'El grupo se crea vacío, sin puntos de acceso ni redes Wi-Fi. Después puedes mover puntos de acceso a él.',
    nameLabel: 'Nombre del grupo', nameHint: 'De 1 a 128 caracteres, distinto del nombre de cualquier otro grupo (sin distinguir mayúsculas).',
    createAction: 'Crear grupo', cancel: 'Cancelar',
    renameTitle: 'Cambiar el nombre del grupo', renameMessage: 'Nombre actual: "{name}". Sus puntos de acceso y sus redes Wi-Fi no cambian.', renameAction: 'Cambiar nombre',
    deleteTitle: 'Eliminar el grupo', deleteMessage: '¿Eliminar el grupo de AP "{name}"? No tiene puntos de acceso ni redes Wi-Fi. No se puede deshacer.',
    deleteAction: 'Eliminar grupo',
    creating: 'Creando el grupo…', created: 'Se creó el grupo "{name}".', renamed: 'El grupo se llama ahora "{name}".', deleted: 'Se eliminó el grupo "{name}".',
    errNameRequired: 'Escribe un nombre para el grupo.', errNameTaken: 'Otro grupo de AP ya tiene este nombre (sin distinguir mayúsculas).',
    errNameUnchanged: 'El grupo ya tiene este nombre.', errLimit: 'Se alcanzó el límite de grupos de AP del controlador.',
    errNotEmpty: 'El controlador indica que este grupo tiene puntos de acceso: muévelos antes a otro grupo.',
    errManagementUnavailable: 'El acceso de gestión no está activo en esta conexión, así que no se pueden cambiar los grupos. Revisa Ajustes → Acceso de gestión.',
  },
  en: {
    newGroup: 'New group', rename: 'Rename', delete: 'Delete', moveHere: 'Move access points here',
    capacityTitle: 'Per-band capacity', bands: { band2g: '2.4 GHz', band5g: '5 GHz', band6g: '6 GHz', mlo: 'MLO' },
    freeOf: '{remaining} of {limit} free', notReportedLimit: 'Not reported (limit: {limit})',
    capacityBadge: 'Capacity warning', capacityDetail: 'No room for more Wi-Fi networks on {bands}', twoBands: '2.4 GHz and 6 GHz',
    createTitle: 'New AP group', nameLabel: 'Group name', createAction: 'Create group', cancel: 'Cancel',
    deleteTitle: 'Delete the group', deleteMessage: 'Delete the AP group "{name}"? It has no access points and no Wi-Fi networks. This cannot be undone.',
    deleteAction: 'Delete group',
    errNameTaken: 'Another AP group already has this name (ignoring case).', errRequestFailed: 'The controller could not complete the request.',
  },
};

/**
 * Reads the AP groups view's management controls: "New group", the detail's
 * Rename / Delete (text, disabled, description), why Delete is unavailable
 * (text and block codes), the not-writable note, "Move access points here"
 * (and its reason), the capacity section (title, notes, one fact per band)
 * and the focused element.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The controls.
 */
function readGroupControls(page) {
  return page.evaluate(() => {
    /**
     * Reads one action button, or null when absent.
     * @param {string} id - The button id.
     * @returns {object | null} Text, disabled, aria-describedby and data-group-action.
     */
    const button = (id) => {
      const element = document.getElementById(id);
      return element ? { text: element.textContent, disabled: element.disabled, describedBy: element.getAttribute('aria-describedby'), action: element.dataset.groupAction ?? null } : null;
    };
    const capacity = document.querySelector('#groupDetail .detail-section[data-section="capacity"]');
    const reason = document.getElementById('groupDeleteReason');
    return {
      newGroup: button('newGroupBtn'),
      rename: button('groupRenameBtn'),
      delete: button('groupDeleteBtn'),
      deleteReason: reason?.textContent ?? null,
      deleteBlocks: reason?.dataset.blocks ?? null,
      actionsLabel: document.querySelector('#groupDetail .detail-actions')?.getAttribute('aria-label') ?? null,
      notWritable: document.querySelector('#groupDetail [data-note="notWritable"]')?.textContent ?? null,
      moveHere: button('groupMoveHereBtn'),
      moveHereReason: document.getElementById('groupMoveHereReason')?.textContent ?? null,
      capacity: capacity === null ? null : {
        title: capacity.querySelector('.detail-section-title')?.textContent ?? '',
        notes: Array.from(capacity.querySelectorAll('.detail-note')).map((note) => ({ kind: note.dataset.note, text: note.textContent })),
        bands: Object.fromEntries(Array.from(capacity.querySelectorAll('.detail-fact')).map((fact) => [fact.dataset.fact, {
          label: fact.querySelector('dt')?.textContent ?? '', value: fact.querySelector('dd')?.textContent ?? '', unreported: fact.classList.contains('is-unreported'),
        }])),
      },
      heading: document.getElementById('groupDetailName')?.textContent ?? null,
      activeId: document.activeElement?.id || '',
    };
  }); // End of the in-page group controls probe
} // End of function readGroupControls()

/**
 * Reads the AP group dialog: dialog semantics, title, message, the name
 * field (shown, label, hint, value, read-only, invalid, selection), the
 * error and progress lines, the buttons, the focused element and the
 * background's inertness.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The dialog's state.
 */
function readGroupModal(page) {
  return page.evaluate(() => {
    const modal = document.getElementById('groupModal');
    const input = document.getElementById('groupNameInput');
    const error = document.getElementById('groupModalError');
    const confirm = document.getElementById('confirmGroupBtn');
    const cancel = document.getElementById('cancelGroupBtn');
    return {
      open: modal.classList.contains('visible'),
      role: modal.getAttribute('role'),
      ariaModal: modal.getAttribute('aria-modal'),
      describedBy: modal.getAttribute('aria-describedby'),
      busy: modal.getAttribute('aria-busy'),
      title: document.getElementById('groupModalHeading')?.textContent ?? '',
      message: document.getElementById('groupModalMessage')?.textContent ?? '',
      nameShown: !document.getElementById('groupNameField').hidden,
      label: document.getElementById('groupNameLabel')?.textContent ?? '',
      hint: document.getElementById('groupNameHint')?.textContent ?? '',
      value: input.value,
      readOnly: input.readOnly,
      invalid: input.getAttribute('aria-invalid'),
      selection: [input.selectionStart, input.selectionEnd],
      errorShown: !error.hidden,
      error: error.textContent,
      errorRole: error.getAttribute('role'),
      status: document.getElementById('groupModalStatus')?.textContent ?? '',
      confirm: confirm.textContent,
      confirmDisabled: confirm.disabled,
      confirmDanger: confirm.classList.contains('btn-danger'),
      cancel: cancel.textContent,
      cancelDisabled: cancel.disabled,
      activeId: document.activeElement?.id || '',
      inert: document.querySelector('.app-container')?.hasAttribute('inert'),
    };
  }); // End of the in-page group dialog probe
} // End of function readGroupModal()

/**
 * Waits until the AP group dialog is open.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<void>}
 */
async function waitForGroupModal(page) {
  await page.waitForSelector('#groupModal.visible', { timeout: WAIT_MS });
}

/**
 * Waits until the AP group dialog is closed.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<void>}
 */
async function waitForGroupModalClosed(page) {
  await page.waitForFunction(() => !document.getElementById('groupModal').classList.contains('visible'), null, { timeout: WAIT_MS });
}

/**
 * Waits until the AP group dialog's error line shows the given text.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} text - Expected text.
 * @returns {Promise<void>}
 */
async function waitForGroupError(page, text) {
  await page.waitForFunction((expected) => {
    const error = document.getElementById('groupModalError');
    return Boolean(error) && !error.hidden && error.textContent === expected;
  }, text, { timeout: WAIT_MS });
}

/**
 * Opens a group's detail (a click on its master item) and waits for its
 * heading.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} id - The group id.
 * @param {string} name - The group's name (the heading).
 * @returns {Promise<void>}
 */
async function openGroupDetail(page, id, name) {
  await page.click(`#groupList .master-item[data-group-id="${id}"]`);
  await page.waitForFunction((expected) => document.getElementById('groupDetailName')?.textContent === expected, name, { timeout: WAIT_MS });
}

/**
 * Waits until the capacity row of a band shows the given text.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} band - The band (band2g, band5g, band6g, mlo).
 * @param {string} text - Expected text.
 * @returns {Promise<void>}
 */
async function waitForBand(page, band, text) {
  await page.waitForFunction(({ key, expected }) => document.querySelector(`#groupDetail .detail-fact[data-fact="${key}"] dd`)?.textContent === expected,
    { key: band, expected: text }, { timeout: WAIT_MS });
}

/**
 * The capacity facts expected for a group with `networks` bound networks
 * and the default limits (8 per band, MLO limit 4; MLO's remaining value is
 * never reported).
 * @param {'es' | 'en'} language - UI language.
 * @param {number} networks - The group's networks.
 * @returns {object} The expected facts by band.
 */
function expectedCapacity(language, networks) {
  const text = GROUPS_TEXT[language];
  const free = fmt(text.freeOf, { remaining: 8 - networks, limit: 8 });
  return {
    band2g: { label: text.bands.band2g, value: free, unreported: false },
    band5g: { label: text.bands.band5g, value: free, unreported: false },
    band6g: { label: text.bands.band6g, value: free, unreported: false },
    mlo: { label: text.bands.mlo, value: fmt(text.notReportedLimit, { limit: 4 }), unreported: true },
  };
} // End of function expectedCapacity()

// Fresh-view overrides of the Capacity warning checks (apGroupOverrides):
// Exterior reports only its 5 GHz remaining capacity, 0; zGrupo B reports
// 2.4 and 6 GHz at 0 (5 GHz: 3 left); zNinguna reports no remaining
// capacity at all (absent, which must never count as full)
const FULL_BAND_OVERRIDES = {
  [GROUP.Exterior.wlanId]: { remainingBinding: { 1: 0 } },
  [GROUP['zGrupo B'].wlanId]: { remainingBinding: { 0: 0, 1: 3, 2: 0 } },
  [GROUP.zNinguna.wlanId]: { remainingBinding: null },
};

/**
 * The Capacity warning badge of every group with FULL_BAND_OVERRIDES applied
 * (null: no badge), as readGroupItems() reports it.
 * @param {'es' | 'en'} language - UI language.
 * @returns {Record<string, object | null>} The badges by group id.
 */
function expectedCapacityBadges(language) {
  const text = GROUPS_TEXT[language];
  /**
   * One expected badge.
   * @param {string} bands - Its data-bands.
   * @param {string} names - The full bands as the sentence names them.
   * @returns {object} The badge.
   */
  const badge = (bands, names) => {
    const detail = fmt(text.capacityDetail, { bands: names });
    return { label: text.capacityBadge, title: detail, bands, hidden: ` (${detail})`, hiddenClipped: true };
  };
  return {
    [GROUP.Exterior.wlanId]: badge('band5g', '5 GHz'),
    [GROUP['zGrupo B'].wlanId]: badge('band2g band6g', text.twoBands),
    [GROUP.zNinguna.wlanId]: null,
    [GROUP.Default.wlanId]: null,
    [UNWRITABLE_GROUP.wlanId]: null,
  };
} // End of function expectedCapacityBadges()

/**
 * Applies FULL_BAND_OVERRIDES (or removes every override) and refreshes,
 * then waits until the master list shows (or no longer shows) the Capacity
 * warning badge.
 * @param {object} session - The launch.
 * @param {boolean} full - True to apply the overrides, false to remove them.
 * @returns {Promise<void>}
 */
async function setFullBands(session, full) {
  const { page } = session;
  await configureStub(session, { apGroupOverrides: full ? FULL_BAND_OVERRIDES : {} });
  await waitForLoadIdle(page);
  await page.click('#refreshBtn');
  await page.waitForFunction((expected) => (document.querySelector('#groupList .badge-capacity') !== null) === expected, full, { timeout: WAIT_MS });
} // End of function setFullBands()

/**
 * Waits until the stub has received more calls on a channel than before.
 * @param {object} session - The launch.
 * @param {string} channel - The IPC channel.
 * @param {number} before - The count before.
 * @returns {Promise<void>}
 */
async function waitForStubCall(session, channel, before) {
  const deadline = Date.now() + WAIT_MS;
  while (callsTo(await stubState(session), channel).length <= before) {
    if (Date.now() > deadline) {
      throw new Error(`no new ${channel} call`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
} // End of function waitForStubCall()

/**
 * AP group management launch (phase 16b): an Omada 6.3 controller with
 * management access whose every check passes; the AP groups view offers
 * New group, Rename and Delete (hidden for the default group, otherwise
 * with the reasons it is unavailable), the per-band capacity with the
 * master list's Capacity warning badge, and "Move access points here".
 * Create → rename → the group made non-empty through "Move access points
 * here" (the phase-13 move flow) → delete blocked → emptied → a delete
 * refused by fresh data → deleted after the confirmation; a write refused by
 * the controller shown as text; a group main cannot write; 700×500; a late
 * managed-groups reply of an old session discarded; the actions gone when a
 * check fails and while a re-check runs (fail closed), and a dialog open
 * meanwhile sending nothing; English.
 * The real main-side rules are unit-tested (ap-group-management.test.ts).
 * @param {{ binary: string }} electronInfo - Resolved Electron binary.
 * @returns {Promise<void>}
 */
async function runApGroupManagement(electronInfo) {
  const session = await launch(electronInfo, 'groups', {
    config: { url: CONTROLLER_URL, username: 'admin', language: 'es', hasPassword: true, clientId: 'owm-client-1', hasClientSecret: true },
    connect: { success: true },
    siteName: 'Casa',
    controllerVersion: data.controllerVersion,
    accessPoints: data.accessPoints,
    wlanGroups: MGMT_GROUPS,
  });
  const { page } = session;
  const es = GROUPS_TEXT.es;
  const en = GROUPS_TEXT.en;
  const jardin = AP['Jardín'];
  // The group created by the create check (its id comes from the stub)
  let newId = null;

  try {
    await checkTranslations(session, 'es');

    await check('[groups] es: management on — no read-only banner; "Nuevo grupo" above the list; Default: "Cambiar nombre" and NO "Eliminar" (hidden for the default group, no reason note), "Mover puntos de acceso aquí", per-band capacity "6 libres de 8" (MLO "No informado (límite: 4)"); zGrupo B: Delete blocked by its APs and its networks, "3 libres de 8"; Exterior (empty): Delete enabled; every group has room left, so no Capacity warning badge; the managed list was read with the session nonce', async () => {
      await waitForConnected(page);
      await waitForApCount(page, expectedApRows(data.accessPoints, 'es', 'apGroup', MGMT_GROUPS).length);
      await page.click('#navGroups');
      await page.waitForSelector('#newGroupBtn', { timeout: WAIT_MS });
      const notices = await readNotices(page);
      await openGroupDetail(page, GROUP.Default.wlanId, 'Default');
      await waitForBand(page, 'band2g', fmt(es.freeOf, { remaining: 6, limit: 8 }));
      const defaults = await readGroupControls(page);
      const items = await readGroupItems(page);
      await openGroupDetail(page, GROUP['zGrupo B'].wlanId, 'zGrupo B');
      await waitForBand(page, 'band2g', fmt(es.freeOf, { remaining: 3, limit: 8 }));
      const busy = await readGroupControls(page);
      await openGroupDetail(page, GROUP.Exterior.wlanId, 'Exterior');
      await page.waitForSelector('#groupDeleteBtn:not([disabled])', { timeout: WAIT_MS });
      const empty = await readGroupControls(page);
      const snapshot = await stubState(session);
      const lists = callsTo(snapshot, 'management:ap-groups');
      return verdict(
        !notices.bannerShown &&
        defaults.newGroup?.text === es.newGroup && !defaults.newGroup.disabled && defaults.newGroup.action === 'create' &&
        defaults.rename?.text === es.rename && !defaults.rename.disabled && defaults.actionsLabel === es.actionsLabel &&
        defaults.delete === null && defaults.deleteReason === null && defaults.deleteBlocks === null &&
        defaults.moveHere?.text === es.moveHere && !defaults.moveHere.disabled &&
        defaults.capacity?.title === es.capacityTitle && isDeepStrictEqual(defaults.capacity.notes, [{ kind: 'capacityHelp', text: es.capacityHelp }]) &&
        isDeepStrictEqual(defaults.capacity.bands, expectedCapacity('es', 2)) &&
        busy.delete.disabled && busy.deleteReason === `${es.blockedNotEmpty} ${es.blockedHasNetworks}` && busy.deleteBlocks === 'groupNotEmpty groupHasNetworks' &&
        isDeepStrictEqual(busy.capacity.bands, expectedCapacity('es', 5)) &&
        !empty.delete.disabled && empty.deleteReason === null && empty.delete.describedBy === null && isDeepStrictEqual(empty.capacity.bands, expectedCapacity('es', 0)) &&
        items.length === MGMT_VALID_GROUP_COUNT && items.every((item) => item.capacity === null) &&
        lists.length >= 1 && lists.every((call) => isDeepStrictEqual(call.args, [snapshot.sessionNonce])),
        { notices, defaults, busy, empty, items, lists: lists.map((call) => call.args), nonce: snapshot.sessionNonce }
      );
    }); // End of check "[groups] es: management on..."

    await check('[groups] es: values the controller does not report stay absent: with only the 2.4 GHz remaining value and the 2.4 / 5 GHz limits, Exterior shows "7 libres de 8", "No informado (límite: 8)", "No informado" (6 GHz) and "No informado" (MLO), marked as unreported', async () => {
      await configureStub(session, { apGroupOverrides: { [GROUP.Exterior.wlanId]: { remainingBinding: { 0: 7 } } }, apGroupSsidLimits: { band2g: 8, band5g: 8 } });
      try {
        await waitForLoadIdle(page);
        await page.click('#refreshBtn');
        await waitForBand(page, 'band2g', fmt(es.freeOf, { remaining: 7, limit: 8 }));
        const partial = await readGroupControls(page);
        return verdict(
          isDeepStrictEqual(partial.capacity?.bands, {
            band2g: { label: es.bands.band2g, value: fmt(es.freeOf, { remaining: 7, limit: 8 }), unreported: false },
            band5g: { label: es.bands.band5g, value: fmt(es.notReportedLimit, { limit: 8 }), unreported: true },
            band6g: { label: es.bands.band6g, value: es.notReported, unreported: true },
            mlo: { label: es.bands.mlo, value: es.notReported, unreported: true },
          }) && partial.heading === 'Exterior' && !partial.delete.disabled,
          partial
        );
      } finally {
        await configureStub(session, { apGroupOverrides: {}, apGroupSsidLimits: DEFAULT_SSID_LIMITS });
        await waitForLoadIdle(page);
        await page.click('#refreshBtn');
        await waitForBand(page, 'band2g', fmt(es.freeOf, { remaining: 8, limit: 8 }));
      }
    }); // End of check "[groups] es: values the controller does not report..."

    await check('[groups] es: the master list\'s "Aviso de capacidad" badge marks a group the controller reports full (0 remaining) on a band, naming the band(s) in its tooltip and in visually hidden text — Exterior (only 5 GHz reported, at 0): "Sin espacio para más redes Wi-Fi en 5 GHz"; zGrupo B (2.4 and 6 GHz at 0): "… en 2,4 GHz y 6 GHz"; zNinguna (no remaining value reported) and the groups with room left get none; Exterior\'s detail agrees ("0 libres de 8" for 5 GHz, the other bands "No informado")', async () => {
      try {
        await setFullBands(session, true);
        const items = await readGroupItems(page);
        await openGroupDetail(page, GROUP.Exterior.wlanId, 'Exterior');
        await waitForBand(page, 'band5g', fmt(es.freeOf, { remaining: 0, limit: 8 }));
        const exterior = await readGroupControls(page);
        const badges = Object.fromEntries(items.map((item) => [item.id, item.capacity]));
        const defaultItem = items.find((item) => item.id === GROUP.Default.wlanId);
        return verdict(
          isDeepStrictEqual(badges, expectedCapacityBadges('es')) && isDeepStrictEqual(defaultItem?.badges, ['Predeterminado']) &&
          isDeepStrictEqual(exterior.capacity?.bands, {
            band2g: { label: es.bands.band2g, value: fmt(es.notReportedLimit, { limit: 8 }), unreported: true },
            band5g: { label: es.bands.band5g, value: fmt(es.freeOf, { remaining: 0, limit: 8 }), unreported: false },
            band6g: { label: es.bands.band6g, value: fmt(es.notReportedLimit, { limit: 8 }), unreported: true },
            mlo: { label: es.bands.mlo, value: fmt(es.notReportedLimit, { limit: 4 }), unreported: true },
          }),
          { badges, defaultBadges: defaultItem?.badges, exterior: exterior.capacity }
        );
      } finally {
        await setFullBands(session, false);
      }
    }); // End of check "[groups] es: the master list's Aviso de capacidad badge..."

    await check('[groups] es: "Nuevo grupo" opens the dialog (role dialog, aria-modal, background inert) on the name field; Enter on a blank name says "Escribe un nombre para el grupo."; a name another group has ("default") is refused as typed; neither asks main; Escape cancels and focus returns to "Nuevo grupo"', async () => {
      const creates = callsTo(await stubState(session), 'management:ap-group-create').length;
      await page.click('#newGroupBtn');
      await waitForGroupModal(page);
      const opened = await readGroupModal(page);
      await page.keyboard.press('Enter');
      await waitForGroupError(page, es.errNameRequired);
      const blank = await readGroupModal(page);
      await page.fill('#groupNameInput', 'default');
      await waitForGroupError(page, es.errNameTaken);
      const taken = await readGroupModal(page);
      await page.keyboard.press('Escape');
      await waitForGroupModalClosed(page);
      const after = await readGroupModal(page);
      const focus = await readFocus(page);
      const createsAfter = callsTo(await stubState(session), 'management:ap-group-create').length;
      return verdict(
        opened.open && opened.role === 'dialog' && opened.ariaModal === 'true' && opened.describedBy === 'groupModalMessage' && opened.inert &&
        opened.title === es.createTitle && opened.message === es.createMessage && opened.nameShown && opened.label === es.nameLabel &&
        opened.hint === es.nameHint && opened.value === '' && opened.confirm === es.createAction && !opened.confirmDanger && opened.cancel === es.cancel &&
        opened.activeId === 'groupNameInput' && !opened.errorShown &&
        blank.error === es.errNameRequired && blank.errorRole === 'alert' && blank.activeId === 'groupNameInput' && blank.invalid === 'true' &&
        taken.error === es.errNameTaken && taken.activeId === 'groupNameInput' &&
        !after.open && !after.inert && focus.id === 'newGroupBtn' && focus.visible && createsAfter === creates,
        { opened, blank, taken, after, focus, creates, createsAfter }
      );
    }); // End of check "[groups] es: Nuevo grupo opens the dialog..."

    await check('[groups] es: create "  Grupo nuevo  " with Enter: one createApGroup call with the trimmed name and the session nonce; while it runs the dialog shows "Creando el grupo…" with its buttons disabled; after the reload it closes, the toast says "Se creó el grupo "Grupo nuevo".", the group is listed, selected and focused, counted in the sidebar, offered under Silence in the destination pane, with Delete enabled and "8 libres de 8"', async () => {
      await configureStub(session, { delays: { 'management:ap-group-create': 700 } });
      try {
        await page.click('#newGroupBtn');
        await waitForGroupModal(page);
        await page.fill('#groupNameInput', '  Grupo nuevo  ');
        await page.keyboard.press('Enter');
        await page.waitForFunction((text) => document.getElementById('groupModalStatus')?.textContent === text, es.creating, { timeout: WAIT_MS });
        const busy = await readGroupModal(page);
        await page.keyboard.press('Escape');
        await waitForGroupModalClosed(page);
        await waitForToast(page, 'success', fmt(es.created, { name: 'Grupo nuevo' }));
        const snapshot = await stubState(session);
        const creates = callsTo(snapshot, 'management:ap-group-create');
        newId = snapshot.apGroupWrites[snapshot.apGroupWrites.length - 1]?.apGroupId ?? null;
        await waitForBand(page, 'band2g', fmt(es.freeOf, { remaining: 8, limit: 8 }));
        const items = await readGroupItems(page);
        const focus = await readFocus(page);
        const controls = await readGroupControls(page);
        const nav = await readNav(page);
        const radio = await page.evaluate((id) => {
          const element = document.querySelector(`#destinationList .destination-radio[value="${id}"]`);
          return element ? { silence: element.closest('.destination-silence') !== null, disabled: element.disabled } : null;
        }, newId);
        return verdict(
          busy.status === es.creating && busy.confirmDisabled && busy.cancelDisabled && busy.busy === 'true' && busy.readOnly && busy.activeId === 'groupModalStatus' &&
          creates.length === 1 && isDeepStrictEqual(creates[0].args, [{ sessionNonce: snapshot.sessionNonce, name: 'Grupo nuevo' }]) &&
          isDeepStrictEqual(snapshot.apGroupWrites, [{ op: 'create', apGroupId: newId, name: 'Grupo nuevo' }]) &&
          items.some((item) => item.id === newId && item.name === 'Grupo nuevo' && item.current === 'true') &&
          focus.groupId === newId && focus.visible && focus.panel === 'groupMasterPanel' &&
          controls.heading === 'Grupo nuevo' && !controls.delete.disabled && !controls.rename.disabled &&
          nav.groups.count === String(MGMT_VALID_GROUP_COUNT + 1) && radio?.silence === true && radio.disabled === false,
          { busy, creates: creates.map((call) => call.args), writes: snapshot.apGroupWrites, items, focus, controls, nav: nav.groups, radio }
        );
      } finally {
        await configureStub(session, { delays: {} });
      }
    }); // End of check "[groups] es: create..."

    await check('[groups] es: a create the controller refuses shows main\'s code as text with its diagnostic — "Se alcanzó el límite de grupos de AP del controlador. (apiError, errorCode -33201)" — and the dialog stays open on the name field; Cancel returns focus to "Nuevo grupo"; nothing is created', async () => {
      await configureStub(session, { apGroupResults: { 'management:ap-group-create': { success: false, error: 'groupLimitReached', diagnostic: 'apiError, errorCode -33201' } } });
      try {
        const writes = (await stubState(session)).apGroupWrites.length;
        await page.click('#newGroupBtn');
        await waitForGroupModal(page);
        await page.fill('#groupNameInput', 'Otro grupo');
        await page.click('#confirmGroupBtn');
        const expected = `${es.errLimit} (apiError, errorCode -33201)`;
        await waitForGroupError(page, expected);
        const refused = await readGroupModal(page);
        await page.click('#cancelGroupBtn');
        await waitForGroupModalClosed(page);
        const focus = await readFocus(page);
        const after = await stubState(session);
        return verdict(
          refused.open && refused.error === expected && refused.activeId === 'groupNameInput' && !refused.confirmDisabled && !refused.cancelDisabled &&
          refused.status === '' && refused.value === 'Otro grupo' && focus.id === 'newGroupBtn' && after.apGroupWrites.length === writes,
          { refused, focus, writes: after.apGroupWrites }
        );
      } finally {
        await configureStub(session, { apGroupResults: {} });
      }
    }); // End of check "[groups] es: a create the controller refuses..."

    await check('[groups] es: rename "Grupo nuevo": the dialog opens with the current name selected; the same name says "El grupo ya tiene este nombre." without asking main; "Grupo renombrado" is sent with the group id and the nonce; the detail shows the new name with focus back on "Cambiar nombre"; the toast says so', async () => {
      const renames = callsTo(await stubState(session), 'management:ap-group-rename').length;
      await page.click('#groupRenameBtn');
      await waitForGroupModal(page);
      const opened = await readGroupModal(page);
      await page.keyboard.press('Enter');
      await waitForGroupError(page, es.errNameUnchanged);
      const unchanged = await readGroupModal(page);
      const renamesUnchanged = callsTo(await stubState(session), 'management:ap-group-rename').length;
      await page.fill('#groupNameInput', 'Grupo renombrado');
      await page.keyboard.press('Enter');
      await waitForGroupModalClosed(page);
      await waitForToast(page, 'success', fmt(es.renamed, { name: 'Grupo renombrado' }));
      const controls = await readGroupControls(page);
      const items = await readGroupItems(page);
      const snapshot = await stubState(session);
      const calls = callsTo(snapshot, 'management:ap-group-rename');
      return verdict(
        opened.title === es.renameTitle && opened.message === fmt(es.renameMessage, { name: 'Grupo nuevo' }) && opened.confirm === es.renameAction &&
        opened.value === 'Grupo nuevo' && isDeepStrictEqual(opened.selection, [0, 'Grupo nuevo'.length]) && opened.activeId === 'groupNameInput' &&
        unchanged.error === es.errNameUnchanged && renamesUnchanged === renames &&
        calls.length === renames + 1 && isDeepStrictEqual(calls[calls.length - 1].args, [{ sessionNonce: snapshot.sessionNonce, apGroupId: newId, name: 'Grupo renombrado' }]) &&
        controls.heading === 'Grupo renombrado' && controls.activeId === 'groupRenameBtn' &&
        items.some((item) => item.id === newId && item.name === 'Grupo renombrado') && !items.some((item) => item.name === 'Grupo nuevo'),
        { opened, unchanged, controls, calls: calls.map((call) => call.args) }
      );
    }); // End of check "[groups] es: rename..."

    await check('[groups] es: "Mover puntos de acceso aquí" opens Access points with the group as the checked destination ("Destino: Grupo renombrado") and focus in the AP list; ticking Jardín and the move button reaches the review dialog ("Hacia: Grupo renombrado"); confirming moves it over the internal path only (omada:set-wlan, no AP-group write); back in AP groups, Delete is blocked: "Para eliminarlo, mueve antes sus puntos de acceso a otro grupo."', async () => {
      const before = await stubState(session);
      await page.click('#groupMoveHereBtn');
      await page.waitForFunction(() => !document.getElementById('viewAccessPoints').hidden, null, { timeout: WAIT_MS });
      const landed = await page.evaluate(() => ({
        checked: document.querySelector('#destinationList .destination-radio:checked')?.value ?? null,
        destination: document.querySelector('#movePreview .move-destination')?.textContent ?? null,
        status: document.getElementById('moveStatus')?.textContent ?? '',
        details: !document.getElementById('apDetailsPanel').hidden,
      }));
      const landedFocus = await readFocus(page);
      await page.check(`#apList .ap-checkbox[data-mac="${jardin.mac}"]`);
      await openReview(page);
      const review = await readMoveModal(page);
      await page.click('#confirmMoveBtn');
      await waitForResults(page);
      await closeResults(page);
      await page.click('#navGroups');
      await page.waitForFunction(() => document.getElementById('groupDeleteReason')?.dataset.blocks === 'groupNotEmpty', null, { timeout: WAIT_MS });
      const controls = await readGroupControls(page);
      const after = await stubState(session);
      const sets = callsTo(after, 'omada:set-wlan').slice(callsTo(before, 'omada:set-wlan').length);
      return verdict(
        landed.checked === newId && landed.destination === fmt(TEXT.es.moveDestination, { group: 'Grupo renombrado' }) &&
        landed.status === TEXT.es.moveNoSelection && !landed.details && landedFocus.panel === 'apPanel' && landedFocus.visible &&
        review.open && review.rows.to?.value === 'Grupo renombrado' && review.rows.aps?.value === 'Jardín' && review.activeId === 'cancelMoveBtn' &&
        isDeepStrictEqual(sets.map((call) => call.args), [[jardin.mac, newId]]) && after.apGroupWrites.length === before.apGroupWrites.length &&
        controls.heading === 'Grupo renombrado' && controls.delete.disabled && controls.deleteReason === es.blockedNotEmpty,
        { landed, landedFocus, review: { rows: review.rows, activeId: review.activeId }, sets: sets.map((call) => call.args), controls }
      );
    }); // End of check "[groups] es: Mover puntos de acceso aquí..."

    await check('[groups] es: once emptied again (Jardín moved back to zNinguna the same way) Delete is enabled; when the controller\'s fresh list reports APs the renderer has not seen, the confirmation (opening on Cancel) answers "El controlador indica que este grupo tiene puntos de acceso: …"; the detail follows the fresh data (Delete disabled) and Cancel puts focus on the group\'s heading; nothing is deleted', async () => {
      await openGroupDetail(page, GROUP.zNinguna.wlanId, 'zNinguna');
      await page.click('#groupMoveHereBtn');
      await page.waitForFunction(() => !document.getElementById('viewAccessPoints').hidden, null, { timeout: WAIT_MS });
      await page.check(`#apList .ap-checkbox[data-mac="${jardin.mac}"]`);
      await openReview(page);
      await page.click('#confirmMoveBtn');
      await waitForResults(page);
      await closeResults(page);
      await page.click('#navGroups');
      await openGroupDetail(page, newId, 'Grupo renombrado');
      await page.waitForSelector('#groupDeleteBtn:not([disabled])', { timeout: WAIT_MS });
      const emptied = await readGroupControls(page);
      const writes = (await stubState(session)).apGroupWrites.length;
      await configureStub(session, { apGroupOverrides: { [newId]: { apNum: 2 } } });
      try {
        await page.click('#groupDeleteBtn');
        await waitForGroupModal(page);
        const opened = await readGroupModal(page);
        await page.click('#confirmGroupBtn');
        await waitForGroupError(page, es.errNotEmpty);
        const refused = await readGroupModal(page);
        await page.waitForSelector('#groupDeleteBtn[disabled]', { state: 'attached', timeout: WAIT_MS });
        await page.click('#cancelGroupBtn');
        await waitForGroupModalClosed(page);
        const after = await readGroupControls(page);
        const snapshot = await stubState(session);
        return verdict(
          !emptied.delete.disabled && emptied.deleteReason === null &&
          opened.title === es.deleteTitle && opened.message === fmt(es.deleteMessage, { name: 'Grupo renombrado' }) && !opened.nameShown &&
          opened.confirm === es.deleteAction && opened.confirmDanger && opened.activeId === 'cancelGroupBtn' &&
          refused.error === es.errNotEmpty && refused.activeId === 'cancelGroupBtn' && !refused.confirmDisabled &&
          after.activeId === 'groupDetailName' && after.delete.disabled && after.deleteBlocks === 'groupNotEmpty' &&
          snapshot.apGroupWrites.length === writes && callsTo(snapshot, 'management:ap-group-delete').length >= 1,
          { emptied, opened, refused, after }
        );
      } finally {
        await configureStub(session, { apGroupOverrides: {} });
        await waitForLoadIdle(page);
        await page.click('#refreshBtn');
        await page.waitForSelector('#groupDeleteBtn:not([disabled])', { timeout: WAIT_MS });
      }
    }); // End of check "[groups] es: once emptied again..."

    await check('[groups] es: delete the empty group after the confirmation (Tab from Cancel to "Eliminar grupo", Enter): deleteApGroup with its id and the nonce; it leaves the list, the destination pane and the sidebar count; the toast says "Se eliminó el grupo "Grupo renombrado"."; focus lands on the list; the writes were create, rename, delete', async () => {
      await page.click('#groupDeleteBtn');
      await waitForGroupModal(page);
      await page.keyboard.press('Tab');
      const tabbed = await page.evaluate(() => document.activeElement?.id || '');
      await page.keyboard.press('Enter');
      await waitForGroupModalClosed(page);
      await waitForToast(page, 'success', fmt(es.deleted, { name: 'Grupo renombrado' }));
      const snapshot = await stubState(session);
      const deletes = callsTo(snapshot, 'management:ap-group-delete');
      const items = await readGroupItems(page);
      const focus = await readFocus(page);
      const nav = await readNav(page);
      const radio = await page.evaluate((id) => document.querySelector(`#destinationList .destination-radio[value="${id}"]`) !== null, newId);
      const detail = await readDetailPane(page, '#groupDetail');
      return verdict(
        tabbed === 'confirmGroupBtn' && isDeepStrictEqual(deletes[deletes.length - 1].args, [{ sessionNonce: snapshot.sessionNonce, apGroupId: newId }]) &&
        isDeepStrictEqual(snapshot.apGroupWrites, [
          { op: 'create', apGroupId: newId, name: 'Grupo nuevo' },
          { op: 'rename', apGroupId: newId, name: 'Grupo renombrado' },
          { op: 'delete', apGroupId: newId },
        ]) &&
        !items.some((item) => item.id === newId) && !radio && nav.groups.count === String(MGMT_VALID_GROUP_COUNT) &&
        focus.visible && focus.panel === 'groupMasterPanel' && focus.groupId !== null && detail?.empty === TEXT.es.groupDetailPrompt,
        { tabbed, deletes: deletes.map((call) => call.args), writes: snapshot.apGroupWrites, focus, nav: nav.groups, radio, detail }
      );
    }); // End of check "[groups] es: delete the empty group..."

    await check('[groups] es: a group whose id main would refuse ("Antiguo", not 24 hex digits) gets no Rename or Delete, with the reason, but keeps "Mover puntos de acceso aquí" and its capacity', async () => {
      await openGroupDetail(page, UNWRITABLE_GROUP.wlanId, 'Antiguo');
      await waitForBand(page, 'band2g', fmt(es.freeOf, { remaining: 8, limit: 8 }));
      const controls = await readGroupControls(page);
      return verdict(
        controls.rename === null && controls.delete === null && controls.notWritable === es.notWritable &&
        controls.moveHere?.text === es.moveHere && !controls.moveHere.disabled && controls.newGroup !== null,
        controls
      );
    });

    await check('[groups] es: 700×500 (single pane): "Nuevo grupo" and the group detail with its actions and capacity fit without horizontal overflow; the Rename dialog fits the window, Escape returns focus to "Cambiar nombre"; Back returns to the list on the group', async () => {
      await resizeAndSettle(session, 700, 500);
      try {
        await page.click('#navGroups');
        if (await page.isVisible('#groupDetailBackBtn')) {
          await page.click('#groupDetailBackBtn');
        }
        const list = await readLayout(page);
        const newGroupVisible = await page.isVisible('#newGroupBtn');
        await page.click(`#groupList .master-item[data-group-id="${GROUP.Default.wlanId}"]`);
        await page.waitForFunction(() => document.activeElement?.id === 'groupDetailName', null, { timeout: WAIT_MS });
        const detail = await readLayout(page);
        await page.click('#groupRenameBtn');
        await waitForGroupModal(page);
        const boxes = await page.evaluate(() => ['groupNameInput', 'cancelGroupBtn', 'confirmGroupBtn'].map((id) => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return { id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }));
        await page.keyboard.press('Escape');
        await waitForGroupModalClosed(page);
        const back = await readFocus(page);
        await page.click('#groupDetailBackBtn');
        const listAgain = await readFocus(page);
        return verdict(
          [list, detail].every((step) => step.docScrollWidth <= step.docClientWidth && step.overflowing.length === 0) &&
          list.panes.groupMasterPanel !== null && list.panes.groupDetailPanel === null && newGroupVisible &&
          detail.panes.groupDetailPanel !== null && detail.panes.groupMasterPanel === null &&
          boxes.every((box) => box.left >= 0 && box.right <= 700 && box.top >= 0 && box.bottom <= 500) &&
          back.id === 'groupRenameBtn' && back.visible && listAgain.groupId === GROUP.Default.wlanId && listAgain.visible,
          { list: list.overflowing, detail: detail.overflowing, boxes, back, listAgain }
        );
      } finally {
        if (await page.isVisible('#groupModal.visible')) {
          await page.keyboard.press('Escape');
        }
        await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
      }
    }); // End of check "[groups] es: 700×500..."

    await check('[groups] es: a managed-groups reply that arrives after a reconnect (old session nonce, answered "superseded") is discarded: the new session\'s capacity stays on screen, no failure is shown', async () => {
      await resizeAndSettle(session, 900, 650);
      await openGroupDetail(page, GROUP.Default.wlanId, 'Default');
      await waitForBand(page, 'band2g', fmt(es.freeOf, { remaining: 6, limit: 8 }));
      const before = await stubState(session);
      const oldNonce = before.sessionNonce;
      await configureStub(session, { delays: { 'management:ap-groups': 3000 } });
      try {
        await waitForLoadIdle(page);
        await page.click('#refreshBtn');
        await waitForStubCall(session, 'management:ap-groups', callsTo(before, 'management:ap-groups').length);
      } finally {
        await configureStub(session, { delays: {} });
      }
      await waitForLoadIdle(page);
      await page.click('#connectBtn');
      await waitForStatus(page, TEXT.es.disconnected);
      await page.click('#connectBtn');
      await waitForConnected(page);
      await page.waitForSelector('#newGroupBtn', { timeout: WAIT_MS });
      await openGroupDetail(page, GROUP.Default.wlanId, 'Default');
      await waitForBand(page, 'band2g', fmt(es.freeOf, { remaining: 6, limit: 8 }));
      // Let the old reply land
      await page.waitForTimeout(3300);
      const controls = await readGroupControls(page);
      const snapshot = await stubState(session);
      const stale = callsTo(snapshot, 'management:ap-groups').filter((call) => call.args[0] === oldNonce);
      return verdict(
        snapshot.sessionNonce !== oldNonce && stale.length >= 1 &&
        isDeepStrictEqual(controls.capacity?.bands, expectedCapacity('es', 2)) && controls.capacity.notes.every((note) => note.kind === 'capacityHelp'),
        { controls: controls.capacity, stale: stale.length, oldNonce, nonce: snapshot.sessionNonce }
      );
    }); // End of check "[groups] es: a managed-groups reply that arrives after a reconnect..."

    await check('[groups] es: when a management check fails ("siteNotFound" via "Probar el acceso de gestión"), the banner states the reason and no New group, Rename, Delete or capacity is shown — "Mover puntos de acceso aquí" stays; when it passes again they return', async () => {
      await configureStub(session, { managementReason: 'siteNotFound', managementDiagnostic: 'sites 2' });
      let off;
      let notices;
      try {
        await openSettingsWhenIdle(page);
        await page.click('#testManagementBtn');
        await waitForTestResult(page, `${CAPS_TEXT.es.result.siteNotFound} (sites 2)`);
        await page.click('#cancelSettingsBtn');
        await waitForSettingsClosed(page);
        await page.waitForFunction(() => document.getElementById('newGroupBtn') === null, null, { timeout: WAIT_MS });
        notices = await readNotices(page);
        off = await readGroupControls(page);
      } finally {
        await configureStub(session, { managementReason: null, managementDiagnostic: null });
        await openSettingsWhenIdle(page);
        await page.click('#testManagementBtn');
        await waitForTestResult(page, CAPS_TEXT.es.result.ok);
        await page.click('#cancelSettingsBtn');
        await waitForSettingsClosed(page);
      }
      await page.waitForSelector('#newGroupBtn', { timeout: WAIT_MS });
      await waitForBand(page, 'band2g', fmt(es.freeOf, { remaining: 6, limit: 8 }));
      const on = await readGroupControls(page);
      return verdict(
        notices.bannerShown && notices.bannerReason === 'siteNotFound' && notices.bannerText === CAPS_TEXT.es.banner.siteNotFound &&
        off.newGroup === null && off.rename === null && off.delete === null && off.capacity === null && off.heading === 'Default' &&
        off.moveHere?.text === es.moveHere && !off.moveHere.disabled &&
        on.newGroup !== null && on.rename !== null && on.delete === null && on.capacity !== null,
        { notices, off, on }
      );
    }); // End of check "[groups] es: when a management check fails..."

    await check('[groups] es: "Probar el acceso de gestión" fails closed: the moment main re-checks (its Open API client is dropped), the banner says "Comprobando el acceso de gestión — …" and New group, Rename, Delete, the capacity and the Capacity warning badges are gone — "Mover puntos de acceso aquí" stays; a failing re-check (invalid credentials) keeps them hidden and the banner states the reason; a passing one brings them back', async () => {
      /**
       * Reads the AP groups view behind Settings: its controls, the banner and the master items.
       * @returns {Promise<object>} The view.
       */
      const readView = async () => ({ controls: await readGroupControls(page), notices: await readNotices(page), items: await readGroupItems(page) });
      /**
       * Tells whether the view shows no management at all: no write action, no capacity, no badge.
       * @param {object} view - What readView() read.
       * @returns {boolean} True when nothing of AP-group management shows.
       */
      const nothingManaged = (view) =>
        view.controls.newGroup === null && view.controls.rename === null && view.controls.delete === null && view.controls.capacity === null &&
        view.controls.heading === 'Exterior' && view.controls.moveHere?.text === es.moveHere && view.items.every((item) => item.capacity === null);
      const invalid = { managementReason: 'invalidCredentials', managementDiagnostic: 'invalidCredentials, errorCode -44106' };
      try {
        await setFullBands(session, true);
        await openGroupDetail(page, GROUP.Exterior.wlanId, 'Exterior');
        await waitForBand(page, 'band5g', fmt(es.freeOf, { remaining: 0, limit: 8 }));
        const before = await readView();
        await configureStub(session, { ...invalid, delays: { 'management:test': 1500 } });
        await openSettingsWhenIdle(page);
        await page.click('#testManagementBtn');
        await page.waitForFunction(() => document.getElementById('managementTestResult')?.dataset.result === 'testing', null, { timeout: WAIT_MS });
        const during = await readView();
        await waitForTestResult(page, `${CAPS_TEXT.es.result.invalidCredentials} (${invalid.managementDiagnostic})`);
        await page.click('#cancelSettingsBtn');
        await waitForSettingsClosed(page);
        const after = await readView();
        await configureStub(session, { managementReason: null, managementDiagnostic: null, delays: {} });
        await openSettingsWhenIdle(page);
        await page.click('#testManagementBtn');
        await waitForTestResult(page, CAPS_TEXT.es.result.ok);
        await page.click('#cancelSettingsBtn');
        await waitForSettingsClosed(page);
        await page.waitForSelector('#newGroupBtn', { timeout: WAIT_MS });
        await waitForBand(page, 'band5g', fmt(es.freeOf, { remaining: 0, limit: 8 }));
        await page.waitForSelector(`#groupList .master-item[data-group-id="${GROUP.Exterior.wlanId}"] .badge-capacity`, { timeout: WAIT_MS });
        const on = await readView();
        /**
         * Tells whether the view shows management on: the actions, the capacity and Exterior's badge.
         * @param {object} view - What readView() read.
         * @returns {boolean} True when AP-group management shows.
         */
        const managed = (view) =>
          !view.notices.bannerShown && view.controls.newGroup !== null && !view.controls.newGroup.disabled && view.controls.rename !== null &&
          view.controls.delete !== null && view.controls.capacity !== null &&
          isDeepStrictEqual(view.items.find((item) => item.id === GROUP.Exterior.wlanId)?.capacity, expectedCapacityBadges('es')[GROUP.Exterior.wlanId]);
        return verdict(
          managed(before) && managed(on) &&
          during.notices.bannerShown && during.notices.bannerReason === 'managementChecking' && during.notices.bannerText === CAPS_TEXT.es.banner.managementChecking &&
          nothingManaged(during) &&
          after.notices.bannerShown && after.notices.bannerReason === 'invalidCredentials' && after.notices.bannerText === CAPS_TEXT.es.banner.invalidCredentials &&
          nothingManaged(after),
          { before, during, after, on }
        );
      } finally {
        await configureStub(session, { managementReason: null, managementDiagnostic: null, delays: {} });
        if (await page.isVisible('#settingsModal.visible')) {
          await page.click('#cancelSettingsBtn');
          await waitForSettingsClosed(page);
        }
        if (!(await page.isVisible('#newGroupBtn'))) {
          await openSettingsWhenIdle(page);
          await page.click('#testManagementBtn');
          await waitForTestResult(page, CAPS_TEXT.es.result.ok);
          await page.click('#cancelSettingsBtn');
          await waitForSettingsClosed(page);
          await page.waitForSelector('#newGroupBtn', { timeout: WAIT_MS });
        }
        await setFullBands(session, false);
      }
    }); // End of check "[groups] es: Probar el acceso de gestión fails closed..."

    await check('[groups] es: a write dialog that is open when management goes off sends nothing: with "Nuevo grupo" open and a name typed, a failing re-check (invalid credentials) runs — Settings opened over the dialog by script, no UI path allows it — then Enter shows "El acceso de gestión no está activo en esta conexión, …" and no createApGroup call is made; Cancel closes it with focus in the list', async () => {
      const invalid = { managementReason: 'invalidCredentials', managementDiagnostic: 'invalidCredentials, errorCode -44106' };
      const creates = callsTo(await stubState(session), 'management:ap-group-create').length;
      try {
        await page.click('#newGroupBtn');
        await waitForGroupModal(page);
        await page.fill('#groupNameInput', 'Grupo tardío');
        await configureStub(session, invalid);
        // The background is inert: script clicks reach the handlers anyway
        await page.evaluate(() => document.getElementById('settingsBtn').click());
        await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
        await page.evaluate(() => document.getElementById('testManagementBtn').click());
        await waitForTestResult(page, `${CAPS_TEXT.es.result.invalidCredentials} (${invalid.managementDiagnostic})`);
        await page.evaluate(() => document.getElementById('cancelSettingsBtn').click());
        await waitForSettingsClosed(page);
        const between = await readGroupModal(page);
        const notices = await readNotices(page);
        await page.focus('#groupNameInput');
        await page.keyboard.press('Enter');
        await waitForGroupError(page, es.errManagementUnavailable);
        const refused = await readGroupModal(page);
        const createsAfter = callsTo(await stubState(session), 'management:ap-group-create').length;
        await page.click('#cancelGroupBtn');
        await waitForGroupModalClosed(page);
        const focus = await readFocus(page);
        const controls = await readGroupControls(page);
        return verdict(
          between.open && between.value === 'Grupo tardío' && notices.bannerReason === 'invalidCredentials' &&
          refused.open && refused.error === es.errManagementUnavailable && refused.errorRole === 'alert' && refused.activeId === 'groupNameInput' &&
          !refused.confirmDisabled && createsAfter === creates &&
          focus.visible && focus.panel === 'groupMasterPanel' && focus.groupId !== null && controls.newGroup === null,
          { between, notices, refused, creates, createsAfter, focus, controls }
        );
      } finally {
        await configureStub(session, { managementReason: null, managementDiagnostic: null });
        if (await page.isVisible('#settingsModal.visible')) {
          await page.evaluate(() => document.getElementById('cancelSettingsBtn').click());
          await waitForSettingsClosed(page);
        }
        if (await page.isVisible('#groupModal.visible')) {
          await page.click('#cancelGroupBtn');
          await waitForGroupModalClosed(page);
        }
        await openSettingsWhenIdle(page);
        await page.click('#testManagementBtn');
        await waitForTestResult(page, CAPS_TEXT.es.result.ok);
        await page.click('#cancelSettingsBtn');
        await waitForSettingsClosed(page);
        await page.waitForSelector('#newGroupBtn', { timeout: WAIT_MS });
      }
    }); // End of check "[groups] es: a write dialog that is open when management goes off..."

    await check('[groups] en: after switching to English: "New group", "Rename" and no Delete for the default group, "Move access points here", "Per-band capacity" with "6 of 8 free" and "Not reported (limit: 4)"; "Delete" for Exterior; the New group dialog ("New AP group", "Group name", "Create group") refuses "EXTERIOR" with "Another AP group already has this name (ignoring case)."; a refused write reads "The controller could not complete the request. (httpError, HTTP 500)"; the delete confirmation for Exterior is in English and Escape returns focus to "Delete"', async () => {
      await openSettingsWhenIdle(page);
      await page.selectOption('#languageSelect', 'en');
      await page.click('#saveSettingsBtn');
      await waitForSettingsClosed(page);
      await waitForConnected(page);
      await page.click('#navGroups');
      await page.waitForSelector('#newGroupBtn', { timeout: WAIT_MS });
      await openGroupDetail(page, GROUP.Default.wlanId, 'Default');
      await waitForBand(page, 'band2g', fmt(en.freeOf, { remaining: 6, limit: 8 }));
      const controls = await readGroupControls(page);
      await configureStub(session, { apGroupResults: { 'management:ap-group-create': { success: false, error: 'requestFailed', diagnostic: 'httpError, HTTP 500' } } });
      try {
        await page.click('#newGroupBtn');
        await waitForGroupModal(page);
        const opened = await readGroupModal(page);
        await page.fill('#groupNameInput', 'EXTERIOR');
        await waitForGroupError(page, en.errNameTaken);
        const taken = await readGroupModal(page);
        await page.fill('#groupNameInput', 'Annex');
        await page.keyboard.press('Enter');
        const failedText = `${en.errRequestFailed} (httpError, HTTP 500)`;
        await waitForGroupError(page, failedText);
        const failed = await readGroupModal(page);
        await page.keyboard.press('Escape');
        await waitForGroupModalClosed(page);
        const createFocus = await readFocus(page);
        await openGroupDetail(page, GROUP.Exterior.wlanId, 'Exterior');
        await page.waitForSelector('#groupDeleteBtn:not([disabled])', { timeout: WAIT_MS });
        const exterior = await readGroupControls(page);
        await page.click('#groupDeleteBtn');
        await waitForGroupModal(page);
        const remove = await readGroupModal(page);
        await page.keyboard.press('Escape');
        await waitForGroupModalClosed(page);
        const deleteFocus = await readFocus(page);
        const snapshot = await stubState(session);
        return verdict(
          controls.newGroup?.text === en.newGroup && controls.rename?.text === en.rename && controls.delete === null &&
          controls.deleteReason === null && exterior.delete?.text === en.delete && !exterior.delete.disabled &&
          controls.moveHere?.text === en.moveHere && controls.capacity?.title === en.capacityTitle &&
          isDeepStrictEqual(controls.capacity.bands, expectedCapacity('en', 2)) &&
          opened.title === en.createTitle && opened.label === en.nameLabel && opened.confirm === en.createAction && opened.cancel === en.cancel &&
          taken.error === en.errNameTaken && failed.error === failedText && failed.activeId === 'groupNameInput' &&
          createFocus.id === 'newGroupBtn' &&
          remove.title === en.deleteTitle && remove.message === fmt(en.deleteMessage, { name: 'Exterior' }) && remove.confirm === en.deleteAction &&
          remove.activeId === 'cancelGroupBtn' && deleteFocus.id === 'groupDeleteBtn' &&
          snapshot.apGroupWrites.length === 3,
          { controls, exterior, opened, taken, failed, createFocus, remove, deleteFocus }
        );
      } finally {
        await configureStub(session, { apGroupResults: {} });
      }
    }); // End of check "[groups] en: after switching to English..."

    await check('[groups] en: the Capacity warning badge in English — Exterior: "No room for more Wi-Fi networks on 5 GHz"; zGrupo B: "… on 2.4 GHz and 6 GHz"; none for zNinguna (no remaining value reported) or the groups with room left', async () => {
      try {
        await setFullBands(session, true);
        const items = await readGroupItems(page);
        const badges = Object.fromEntries(items.map((item) => [item.id, item.capacity]));
        return verdict(isDeepStrictEqual(badges, expectedCapacityBadges('en')), badges);
      } finally {
        await setFullBands(session, false);
      }
    }); // End of check "[groups] en: the Capacity warning badge in English..."

    await check('[groups] en: renaming one of two same-named groups resolves the phase-13b leftover: before, its "Move access points here" and its destination radio are disabled with "Another group has the same name — …"; after renaming it to "Exterior 2" both are enabled and focus is back on "Rename"', async () => {
      const twin = { wlanId: '6512a0e1f3b2c41d2e3f4a70', wlanName: 'Exterior', ssidList: [] };
      /**
       * Tells whether the twin's destination radio is disabled (null when absent).
       * @returns {Promise<boolean | null>} The radio's disabled state.
       */
      const twinRadioDisabled = () => page.evaluate((id) => document.querySelector(`#destinationList .destination-radio[value="${id}"]`)?.disabled ?? null, twin.wlanId);
      await configureStub(session, { wlanGroups: [...MGMT_GROUPS, twin] });
      try {
        await waitForLoadIdle(page);
        await page.click('#refreshBtn');
        await page.waitForSelector(`#groupList .master-item[data-group-id="${twin.wlanId}"]`, { timeout: WAIT_MS });
        await openGroupDetail(page, twin.wlanId, 'Exterior');
        const before = await readGroupControls(page);
        const radioBefore = await twinRadioDisabled();
        await page.click('#groupRenameBtn');
        await waitForGroupModal(page);
        await page.fill('#groupNameInput', 'Exterior 2');
        await page.keyboard.press('Enter');
        await waitForGroupModalClosed(page);
        await page.waitForFunction(() => document.getElementById('groupDetailName')?.textContent === 'Exterior 2', null, { timeout: WAIT_MS });
        const after = await readGroupControls(page);
        const radioAfter = await twinRadioDisabled();
        const writes = (await stubState(session)).apGroupWrites;
        return verdict(
          before.moveHere?.disabled === true && before.moveHere.describedBy === 'groupMoveHereReason' && before.moveHereReason === TEXT.en.ambiguous &&
          radioBefore === true && after.moveHere?.disabled === false && after.moveHereReason === null && radioAfter === false &&
          after.activeId === 'groupRenameBtn' && isDeepStrictEqual(writes[writes.length - 1], { op: 'rename', apGroupId: twin.wlanId, name: 'Exterior 2' }),
          { before, radioBefore, after, radioAfter }
        );
      } finally {
        await configureStub(session, { wlanGroups: MGMT_GROUPS });
      }
    }); // End of check "[groups] en: renaming one of two same-named groups..."
  } finally {
    session.finalState = await stubState(session).catch((error) => ({ error: String(error) }));
    await session.app.close().catch(() => {});
  }
} // End of function runApGroupManagement()

// ============================================================================
// Launch 7: the Wi-Fi networks view on the managed source (phase 17b) — the
// managed list with its scopes and values, the details, cross-navigation,
// no secret in the DOM, a lower bound, the error state with Retry (also for
// a malformed or incomplete read, never a partial list), stale replies
// discarded, management off or being checked → the 14a view (Spanish, then
// English)
// ============================================================================

// The fixture APs without the one that reports no group (Bodega): every AP
// is placed, so the scopes are exact (a check adds Bodega back)
const NETS_APS = data.accessPoints.filter((ap) => ap.wlanGroup !== '');
// Sentinel secrets planted in the raw payloads of the [nets] launch (plus the
// stub's default passphrase): none may reach the DOM or a reply
const NETS_SECRETS = ['SENTINEL-nets-casa-key', 'SENTINEL-nets-oficina-key', 'SENTINEL-nets-radius', 'SENTINEL-nets-catalog', 'SENTINEL-nets-ppsk', 'stub-passphrase-never-shown'];

/**
 * The id of the n-th network of the [nets] launch.
 * @param {number} n - Its number (1–9).
 * @returns {string} The id.
 */
function netId(n) {
  return `5f00c0ffee00000000000e0${n}`;
}

// The fake controller's Wi-Fi networks for the [nets] launch, as RAW Open API
// payloads (the stub's `networks` knob; it runs them through main's real
// validators and DTO builder): Casa (WPA-Personal, 2.4 + 5 GHz, bound to
// Default), Invitados (open, every band, disabled, "All access points"),
// Oficina (WPA-Personal, 5 GHz, bound to zGrupo B and Default), IoT
// (WPA-Enterprise, 2.4 GHz, bound to zNinguna and Exterior) and Rara (values
// the ops doc does not define: an unknown scope, security, bands and state)
const NETS_NETWORKS = [
  {
    entry: { id: netId(1), name: 'Casa', ssidEnable: true, chooseDevices: 1, band: 3, security: 3, securityKey: 'SENTINEL-nets-catalog' },
    detail: { id: netId(1), ssidEnable: true, chooseDevices: 1, band: 3, security: 3, apGroupIds: [GROUP.Default.wlanId], pskSetting: { securityKey: 'SENTINEL-nets-casa-key' } },
    bindings: { apGroups: [{ id: GROUP.Default.wlanId }] },
  },
  {
    entry: { id: netId(2), name: 'Invitados', description: false, chooseDevices: 0, band: 7, security: 0 },
    detail: { id: netId(2), ssidEnable: false, chooseDevices: 0, band: 7, security: 0 },
    bindings: { apGroups: [] },
  },
  {
    entry: { id: netId(3), name: 'Oficina', ssidEnable: true, chooseDevices: 1, band: 2, security: 3 },
    detail: {
      id: netId(3), ssidEnable: true, chooseDevices: 1, band: 2, security: 3, apGroupIds: [GROUP['zGrupo B'].wlanId, GROUP.Default.wlanId],
      pskSetting: { securityKey: 'SENTINEL-nets-oficina-key' }, ppskSetting: { keys: [{ key: 'SENTINEL-nets-ppsk' }] },
    },
    bindings: { apGroups: [{ id: GROUP['zGrupo B'].wlanId }, { id: GROUP.Default.wlanId }] },
  },
  {
    entry: { id: netId(4), name: 'IoT', ssidEnable: true, chooseDevices: 1, band: 1, security: 2 },
    detail: { id: netId(4), ssidEnable: true, chooseDevices: 1, band: 1, security: 2, apGroupIds: [GROUP.zNinguna.wlanId, GROUP.Exterior.wlanId], entSetting: { radiusSecret: 'SENTINEL-nets-radius' } },
    bindings: { apGroups: [{ id: GROUP.zNinguna.wlanId }, { id: GROUP.Exterior.wlanId }] },
  },
  {
    entry: { id: netId(5), name: 'Rara', chooseDevices: 7, band: 0, security: 9 },
    detail: { id: netId(5), chooseDevices: 7 },
    bindings: {},
  },
];
// One more network (the stale-reply check): open, 2.4 GHz, "All access points"
const NETS_NEW_NETWORK = {
  entry: { id: netId(6), name: 'Nueva', ssidEnable: true, chooseDevices: 0, band: 1, security: 0 },
  detail: { id: netId(6), ssidEnable: true, chooseDevices: 0, band: 1, security: 0 },
  bindings: { apGroups: [] },
};
// A failed read as main answers it
const NETS_FAILURE = { success: false, error: 'requestFailed', diagnostic: 'ssids: httpError, HTTP 503' };

// Strings of the managed Wi-Fi networks view (src/renderer/i18n.ts)
const NETS_TEXT = {
  es: {
    all: 'Todos los puntos de acceso', unknownScope: 'Alcance desconocido',
    enabled: 'Activada', disabled: 'Desactivada', stateUnknown: 'Estado desconocido',
    open: 'Abierta', wpaPersonal: 'WPA-Personal', wpaEnterprise: 'WPA-Enterprise', securityUnknown: 'Seguridad desconocida', bandsUnknown: 'Bandas desconocidas',
    band2g: '2,4 GHz', band5g: '5 GHz', bands2g5g: '2,4 GHz y 5 GHz', bandsAll: '2,4 GHz, 5 GHz y 6 GHz',
    stateLabel: 'Estado', securityLabel: 'Seguridad', bandsLabel: 'Bandas', passphraseLabel: 'Contraseña',
    passphraseSet: 'Configurada', passphraseNone: 'Ninguna', valueUnknown: 'Se desconoce',
    allNote: 'Se emite en todos los puntos de acceso del sitio, también en los que se añadan más adelante.',
    unknownNote: 'El controlador no indica con claridad dónde se emite esta red, así que no se muestran sus grupos ni sus puntos de acceso.',
    errRequestFailed: 'El controlador no pudo enviar las redes Wi-Fi.',
    errListIncomplete: 'No se pudo leer la lista completa de redes Wi-Fi (o tiene más de las que la aplicación lee de una vez): no se muestra una lista parcial.',
    errInvalidReply: 'La respuesta sobre las redes Wi-Fi no es válida: no se muestra nada de ella.',
    errFailed: 'No se pudieron leer las redes Wi-Fi.',
    // The refresh-error notice of a stale list (a failed re-read kept it)
    stale: 'No se pudieron actualizar las redes Wi-Fi. Se muestra la lista de las {time}. {reason}',
  },
  en: {
    all: 'All access points', unknownScope: 'Unknown scope',
    enabled: 'Enabled', disabled: 'Disabled', stateUnknown: 'State unknown',
    open: 'Open', wpaPersonal: 'WPA-Personal', wpaEnterprise: 'WPA-Enterprise', securityUnknown: 'Security unknown', bandsUnknown: 'Bands unknown',
    band2g: '2.4 GHz', band5g: '5 GHz', bands2g5g: '2.4 GHz and 5 GHz', bandsAll: '2.4 GHz, 5 GHz, and 6 GHz',
    stateLabel: 'State', securityLabel: 'Security', bandsLabel: 'Bands', passphraseLabel: 'Password',
    passphraseSet: 'Set', passphraseNone: 'None', valueUnknown: 'Unknown',
    allNote: 'Broadcast on every access point of the site, including those added later.',
    unknownNote: 'The controller does not report clearly where this network is broadcast, so its AP groups and access points are not shown.',
    errRequestFailed: 'The controller could not send the Wi-Fi networks.',
    errListIncomplete: 'The complete list of Wi-Fi networks could not be read (or it has more than the app reads at once): a partial list is not shown.',
    errInvalidReply: 'The answer about the Wi-Fi networks is not valid: none of it is shown.',
    errFailed: 'The Wi-Fi networks could not be read.',
    // The refresh-error notice of a stale list (a failed re-read kept it)
    stale: 'Couldn\'t refresh the Wi-Fi networks. Showing the list from {time}. {reason}',
  },
};

/**
 * The managed master list the view must show for NETS_NETWORKS and
 * NETS_APS: per network (sorted by name) its id, name, enabled state /
 * security / bands line and scope.
 * @param {'es' | 'en'} language - UI language.
 * @returns {Array<{ id: string; name: string; props: string; scope: string }>}
 */
function expectedManagedItems(language) {
  const text = TEXT[language];
  const nets = NETS_TEXT[language];
  const groups = (count) => (count === 1 ? text.groupOne : fmt(text.groupMany, { count }));
  return [
    { id: netId(1), name: 'Casa', props: `${nets.enabled} · ${nets.wpaPersonal} · ${nets.bands2g5g}`, scope: `${groups(1)} · ${fmt(text.apMany, { count: 4 })}` },
    { id: netId(2), name: 'Invitados', props: `${nets.disabled} · ${nets.open} · ${nets.bandsAll}`, scope: nets.all },
    { id: netId(4), name: 'IoT', props: `${nets.enabled} · ${nets.wpaEnterprise} · ${nets.band2g}`, scope: `${groups(2)} · ${text.apOne}` },
    { id: netId(3), name: 'Oficina', props: `${nets.enabled} · ${nets.wpaPersonal} · ${nets.band5g}`, scope: `${groups(2)} · ${fmt(text.apMany, { count: 5 })}` },
    { id: netId(5), name: 'Rara', props: `${nets.stateUnknown} · ${nets.securityUnknown} · ${nets.bandsUnknown}`, scope: nets.unknownScope },
  ];
} // End of function expectedManagedItems()

/**
 * The facts of a managed network's detail as readDetailPane() reads them.
 * @param {'es' | 'en'} language - UI language.
 * @param {string} enabled - The enabled state's value.
 * @param {string} security - The security's value.
 * @param {string} bands - The bands' value.
 * @param {string} passphrase - The password's value.
 * @returns {object} The facts.
 */
function expectedFacts(language, enabled, security, bands, passphrase) {
  const nets = NETS_TEXT[language];
  const fact = (label, value) => ({ label, value, status: null, link: null });
  return {
    enabled: fact(nets.stateLabel, enabled),
    security: fact(nets.securityLabel, security),
    bands: fact(nets.bandsLabel, bands),
    passphrase: fact(nets.passphraseLabel, passphrase),
  };
} // End of function expectedFacts()

/**
 * Reads the Wi-Fi networks master list with its mode (data-networks-mode):
 * per item its network id (managed only), name, label, the enabled state /
 * security / bands line (managed only), scope and aria-current.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<{ mode: string | null; items: object[] }>}
 */
function readManagedList(page) {
  return page.evaluate(() => ({
    mode: document.getElementById('networkList')?.dataset.networksMode ?? null,
    items: Array.from(document.querySelectorAll('#networkList .master-item')).map((item) => ({
      id: item.dataset.networkId ?? null,
      name: item.dataset.networkName,
      label: item.querySelector('.item-name')?.textContent ?? '',
      props: item.querySelector('.network-properties')?.textContent ?? null,
      scope: item.querySelector('.network-scope')?.textContent ?? '',
      current: item.getAttribute('aria-current'),
    })),
  }));
} // End of function readManagedList()

/**
 * Waits until the Wi-Fi networks list is in the given mode.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} mode - 'internal', 'managedLoading', 'managedReady' or 'managedFailed'.
 * @returns {Promise<void>}
 */
async function waitForNetworksMode(page, mode) {
  await page.waitForFunction((expected) => document.getElementById('networkList')?.dataset.networksMode === expected, mode, { timeout: WAIT_MS });
}

/**
 * Waits until the managed list's error state shows the given text.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} text - Expected message.
 * @returns {Promise<void>}
 */
async function waitForNetworksError(page, text) {
  await page.waitForFunction((expected) => document.querySelector('#networkList .state-block[data-state="networksError"] p')?.textContent === expected, text, { timeout: WAIT_MS });
}

/**
 * Reads the managed list's refresh-error notice (#networksStaleNotice, a
 * stale list kept after a failed re-read): whether it is shown (and
 * actually visible), its role, text, failure code (data-error), the time of
 * the list it keeps (data-read-at, and formatted as the app formats it),
 * whether it carries the amber stale dot, and its Retry (action and text).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<object>} The notice.
 */
function readNetworksStaleNotice(page) {
  return page.evaluate(() => {
    const notice = document.getElementById('networksStaleNotice');
    const retry = document.getElementById('networksStaleRetryBtn');
    const dot = notice?.querySelector('.stale-dot') ?? null;
    const readAt = notice?.dataset.readAt ? Number(notice.dataset.readAt) : null;
    return {
      shown: Boolean(notice && !notice.hidden),
      visible: Boolean(notice?.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })),
      role: notice?.getAttribute('role') ?? null,
      text: document.getElementById('networksStaleNoticeText')?.textContent ?? '',
      error: notice?.dataset.error ?? null,
      readAt,
      time: readAt === null ? null : new Intl.DateTimeFormat(document.documentElement.lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(readAt)),
      dot: Boolean(dot?.checkVisibility() && dot.getAttribute('aria-hidden') === 'true' && getComputedStyle(dot).backgroundColor !== 'rgba(0, 0, 0, 0)'),
      retryAction: retry?.dataset.stateAction ?? null,
      retryText: retry?.textContent ?? '',
    };
  }); // End of the in-page stale-notice probe
} // End of function readNetworksStaleNotice()

/**
 * Waits until the managed list's refresh-error notice is shown for the
 * given failure code.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} error - The failure code (data-error).
 * @returns {Promise<void>}
 */
async function waitForNetworksStale(page, error) {
  await page.waitForFunction((expected) => {
    const notice = document.getElementById('networksStaleNotice');
    return Boolean(notice) && !notice.hidden && notice.dataset.error === expected;
  }, error, { timeout: WAIT_MS });
}

/**
 * Runs "Test management access" again from Settings and waits for its
 * result line, then closes Settings. While the check runs the session's
 * capabilities are cleared: the Wi-Fi networks view falls back to its 14a
 * view and forgets its managed list, so a passing check reads that list
 * again from scratch (a FIRST read: skeleton, then the list or the error
 * state).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} text - The expected result line.
 * @returns {Promise<void>}
 */
async function recheckManagement(page, text) {
  await openSettingsWhenIdle(page);
  await page.click('#testManagementBtn');
  await waitForTestResult(page, text);
  await page.click('#cancelSettingsBtn');
  await waitForSettingsClosed(page);
}

/**
 * Opens a network's detail from the master list and waits for its heading.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @param {string} name - The network name.
 * @returns {Promise<void>}
 */
async function openNetworkDetail(page, name) {
  await page.click(`#networkList .master-item[data-network-name="${name}"]`);
  await page.waitForFunction((expected) => document.getElementById('networkDetailName')?.textContent === expected, name, { timeout: WAIT_MS });
}

/**
 * Clicks Refresh once no load is in flight, and waits for the next
 * management:networks call to reach the stub.
 * @param {object} session - The launch.
 * @returns {Promise<void>}
 */
async function refreshNetworks(session) {
  const before = callsTo(await stubState(session), 'management:networks').length;
  await waitForLoadIdle(session.page);
  await session.page.click('#refreshBtn');
  await waitForStubCall(session, 'management:networks', before);
}

/**
 * Lists the [nets] sentinel secrets found in the renderer: in the markup
 * (attributes included) or in any input's value.
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<string[]>} The leaked secrets (empty when clean).
 */
function findNetworkSecrets(page) {
  return page.evaluate((secrets) => {
    const values = Array.from(document.querySelectorAll('input')).map((input) => input.value).join('\n');
    const html = document.documentElement.outerHTML;
    return secrets.filter((secret) => html.includes(secret) || values.includes(secret));
  }, NETS_SECRETS);
}

/**
 * Lists the buttons and fields of the Wi-Fi networks view other than its
 * master items, cross-links, search, single-pane Back and the error state's
 * actions (no edit control may exist before phase 18).
 * @param {import('playwright-core').Page} page - The renderer page.
 * @returns {Promise<string[]>} Their ids or classes.
 */
function networkViewControls(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#viewNetworks button, #viewNetworks input, #viewNetworks select, #viewNetworks textarea'))
    .filter((element) => !element.classList.contains('master-item') && !element.classList.contains('cross-link') && !element.classList.contains('drill-back') &&
      element.id !== 'networkSearch' && element.dataset.stateAction === undefined)
    .map((element) => element.id || element.className));
}

/**
 * Wi-Fi networks launch (phase 17b): an Omada 6.3 controller with management
 * access whose every check passes and scripted networks (NETS_NETWORKS); the
 * Wi-Fi networks view shows the managed list — scopes "All access points",
 * "N groups · M APs" and an explicit unknown scope, the enabled state,
 * security and bands, only whether a password is set — with the details and
 * cross-navigation; no secret reaches the DOM; an AP without a group makes
 * the count a lower bound; a failed, malformed or incomplete re-read keeps
 * the last good list whole, stale, with the refresh-error notice (its time,
 * the reason, Retry); a failed, malformed or incomplete first read shows the
 * error state with Retry (never a partial list); late replies of an older
 * read or session are discarded; while management is off or being checked
 * the 14a view is shown unchanged, and the Back history's managed entries
 * survive a check that passes again; English. The read path in main is
 * unit-tested (wifi-network-read.test.ts), the renderer logic too
 * (renderer-network-management.test.ts).
 * @param {{ binary: string }} electronInfo - Resolved Electron binary.
 * @returns {Promise<void>}
 */
async function runManagedNetworks(electronInfo) {
  const session = await launch(electronInfo, 'nets', {
    config: { url: CONTROLLER_URL, username: 'admin', language: 'es', hasPassword: true, clientId: 'owm-client-1', hasClientSecret: true },
    connect: { success: true },
    siteName: 'Casa',
    controllerVersion: data.controllerVersion,
    accessPoints: NETS_APS,
    wlanGroups: data.wlanGroups,
    networks: NETS_NETWORKS,
  });
  const { page } = session;
  const es = TEXT.es;
  const nets = NETS_TEXT.es;
  /**
   * The Spanish status label of a fixture AP.
   * @param {string} name - AP name.
   * @returns {string} The label.
   */
  const statusOf = (name) => es.status[AP[name].statusCategory] ?? es.statusUnknown;
  // The APs of the Default group, in list order (sorted by name)
  const defaultAps = ['EAP Carpio', 'Garaje', 'Porche', 'Salón'];
  const casaSelector = '#networkList .master-item[data-network-name="Casa"] .network-scope';

  try {
    await checkTranslations(session, 'es');

    await check('[nets] es: management on — the Wi-Fi networks view shows the managed list (getManagedNetworks() with the session nonce) instead of the 14a internal data: one entry per network (5, also the sidebar count), sorted, each with its enabled state, security and bands and its scope — Casa "1 grupo · 4 AP", Invitados "Todos los puntos de acceso", IoT "2 grupos · 1 AP", Oficina "2 grupos · 5 AP", Rara "Alcance desconocido" with "Estado desconocido · Seguridad desconocida · Bandas desconocidas"; no read-only banner', async () => {
      await waitForConnected(page);
      await waitForApCount(page, NETS_APS.filter((ap) => MAC_REGEX.test(ap.mac)).length);
      await page.click('#navNetworks');
      await waitForNetworksMode(page, 'managedReady');
      const list = await readManagedList(page);
      const nav = await readNav(page);
      const notices = await readNotices(page);
      const detail = await readDetailPane(page, '#networkDetail');
      const snapshot = await stubState(session);
      const reads = callsTo(snapshot, 'management:networks');
      return verdict(
        isDeepStrictEqual(list.items.map(({ id, name, props, scope }) => ({ id, name, props, scope })), expectedManagedItems('es')) &&
        list.items.every((item) => item.label === item.name && item.current === null) && nav.networks.count === '5' &&
        !notices.bannerShown && detail?.empty === es.networkDetailPrompt &&
        reads.length >= 1 && reads.every((call) => isDeepStrictEqual(call.args, [snapshot.sessionNonce])),
        { list, nav: nav.networks, notices, detail, reads: reads.map((call) => call.args), nonce: snapshot.sessionNonce }
      );
    }); // End of check "[nets] es: management on..."

    await check('[nets] es: the managed details, read-only — Casa: "Estado Activada", "Seguridad WPA-Personal", "Bandas 2,4 GHz y 5 GHz", "Contraseña Configurada" (only whether one is set), Default ("4 AP") and its 4 APs as links; Invitados: "Ninguna" and the "all access points" note, no group or AP list; IoT: "Contraseña Se desconoce", Exterior ("Sin AP") and zNinguna ("1 AP") with Jardín; Rara: every value "Se desconoce" and the unknown-scope note (never guessed); no edit control in the view', async () => {
      await openNetworkDetail(page, 'Casa');
      const casa = await readDetailPane(page, '#networkDetail');
      const current = (await readManagedList(page)).items.filter((item) => item.current === 'true').map((item) => item.id);
      await openNetworkDetail(page, 'Invitados');
      const invitados = await readDetailPane(page, '#networkDetail');
      await openNetworkDetail(page, 'IoT');
      const iot = await readDetailPane(page, '#networkDetail');
      await openNetworkDetail(page, 'Rara');
      const rara = await readDetailPane(page, '#networkDetail');
      const controls = await networkViewControls(page);
      const groupsTitle = (count) => `${es.groupsTitle.apGroup} (${count})`;
      return verdict(
        isDeepStrictEqual(current, [netId(1)]) &&
        casa.heading === 'Casa' && casa.headingTag === 'h3' && casa.summary === `${es.groupOne} · ${fmt(es.apMany, { count: 4 })}` &&
        isDeepStrictEqual(casa.facts, expectedFacts('es', nets.enabled, nets.wpaPersonal, nets.bands2g5g, nets.passphraseSet)) &&
        casa.sections.groups?.title === groupsTitle(1) &&
        isDeepStrictEqual(casa.sections.groups.rows, [{ link: 'Default', status: null, meta: fmt(es.apMany, { count: 4 }) }]) &&
        isDeepStrictEqual(casa.sections.groups.links.map((link) => [link.kind, link.target]), [['group', GROUP.Default.wlanId]]) &&
        casa.sections.aps?.title === `${es.accessPoints} (4)` &&
        isDeepStrictEqual(casa.sections.aps.rows, defaultAps.map((name) => ({ link: name, status: statusOf(name), meta: null }))) &&
        casa.notes.length === 0 &&
        invitados.summary === nets.all && isDeepStrictEqual(invitados.facts, expectedFacts('es', nets.disabled, nets.open, nets.bandsAll, nets.passphraseNone)) &&
        Object.keys(invitados.sections).length === 0 && isDeepStrictEqual(invitados.notes, [{ kind: 'allAccessPoints', text: nets.allNote }]) &&
        iot.summary === `${fmt(es.groupMany, { count: 2 })} · ${es.apOne}` &&
        isDeepStrictEqual(iot.facts, expectedFacts('es', nets.enabled, nets.wpaEnterprise, nets.band2g, nets.valueUnknown)) &&
        iot.sections.groups?.title === groupsTitle(2) &&
        isDeepStrictEqual(iot.sections.groups.rows, [{ link: 'Exterior', status: null, meta: es.apNone }, { link: 'zNinguna', status: null, meta: es.apOne }]) &&
        isDeepStrictEqual(iot.sections.aps?.rows, [{ link: 'Jardín', status: statusOf('Jardín'), meta: null }]) &&
        rara.summary === nets.unknownScope &&
        isDeepStrictEqual(rara.facts, expectedFacts('es', nets.valueUnknown, nets.valueUnknown, nets.valueUnknown, nets.valueUnknown)) &&
        Object.keys(rara.sections).length === 0 && isDeepStrictEqual(rara.notes, [{ kind: 'unknownScope', text: nets.unknownNote }]) &&
        controls.length === 0,
        { current, casa, invitados, iot, rara, controls }
      );
    }); // End of check "[nets] es: the managed details..."

    await check('[nets] es: no secret reaches the renderer — none of the sentinel passphrases, PPSK key and RADIUS secret planted in the raw payloads (nor the stub\'s default passphrase) appears anywhere in the DOM (markup, attributes, input values) after every managed detail was shown, nor in a getManagedNetworks() reply, which carries only the DTO keys', async () => {
      const leaks = [];
      for (const name of ['Casa', 'Invitados', 'IoT', 'Oficina', 'Rara']) {
        await openNetworkDetail(page, name);
        leaks.push(...(await findNetworkSecrets(page)));
      }
      const nonce = (await stubState(session)).sessionNonce;
      const reply = await callBridge(page, 'getManagedNetworks', nonce);
      const text = JSON.stringify(reply);
      const networks = reply.value?.networks ?? [];
      return verdict(
        leaks.length === 0 && reply.value?.success === true && networks.length === 5 &&
        networks.every((network) => isDeepStrictEqual(Object.keys(network).sort(), NETWORK_DTO_KEYS)) &&
        NETS_SECRETS.every((secret) => !text.includes(secret)),
        { leaks, reply: text.slice(0, 400) }
      );
    }); // End of check "[nets] es: no secret reaches the renderer..."

    await check('[nets] es: cross-navigation keeps working on the managed source — Casa\'s group link opens Default in AP groups with "Volver a Casa"; Default\'s network link "Invitados" opens the managed Invitados (its id selected, its facts shown) with "Volver a Default"; Back twice returns to Casa\'s managed detail with focus on its Default link', async () => {
      await openNetworkDetail(page, 'Casa');
      await page.click(`#networkDetail .cross-link[data-link-kind="group"][data-link-target="${GROUP.Default.wlanId}"]`);
      await page.waitForFunction(() => document.getElementById('groupDetailName')?.textContent === 'Default', null, { timeout: WAIT_MS });
      const toGroup = await readInventory(page);
      await page.click('#groupDetail .cross-link[data-link-kind="network"][data-link-target="Invitados"]');
      await page.waitForFunction(() => document.getElementById('networkDetailName')?.textContent === 'Invitados', null, { timeout: WAIT_MS });
      const toNetwork = await readInventory(page);
      const invitados = await readDetailPane(page, '#networkDetail');
      const current = (await readManagedList(page)).items.filter((item) => item.current === 'true').map((item) => item.id);
      await page.click('#backBtn');
      await page.waitForFunction(() => document.getElementById('groupDetailName')?.textContent === 'Default' && !document.getElementById('viewGroups').hidden, null, { timeout: WAIT_MS });
      const backOnce = await readInventory(page);
      await page.click('#backBtn');
      await page.waitForFunction(() => document.getElementById('networkDetailName')?.textContent === 'Casa' && !document.getElementById('viewNetworks').hidden, null, { timeout: WAIT_MS });
      const backTwice = await readInventory(page);
      const casa = await readDetailPane(page, '#networkDetail');
      return verdict(
        isDeepStrictEqual(toGroup.shown, ['viewGroups']) && toGroup.backLabel === fmt(es.backTo, { target: 'Casa' }) && toGroup.currentGroup === GROUP.Default.wlanId &&
        isDeepStrictEqual(toNetwork.shown, ['viewNetworks']) && toNetwork.backLabel === fmt(es.backTo, { target: 'Default' }) &&
        toNetwork.currentNetwork === 'Invitados' && isDeepStrictEqual(current, [netId(2)]) && invitados.facts.passphrase?.value === nets.passphraseNone &&
        isDeepStrictEqual(backOnce.shown, ['viewGroups']) && backOnce.backLabel === fmt(es.backTo, { target: 'Casa' }) &&
        isDeepStrictEqual(backTwice.shown, ['viewNetworks']) && backTwice.backHidden && backTwice.currentNetwork === 'Casa' &&
        backTwice.focus.linkKind === 'group' && backTwice.focus.linkTarget === GROUP.Default.wlanId &&
        isDeepStrictEqual(casa.facts, expectedFacts('es', nets.enabled, nets.wpaPersonal, nets.bands2g5g, nets.passphraseSet)),
        { toGroup, toNetwork, current, backOnce, backTwice: backTwice.focus }
      );
    }); // End of check "[nets] es: cross-navigation keeps working..."

    await check('[nets] es: a lower bound is never shown as exact — once an AP that reports no group (Bodega) is loaded (Refresh), Casa reads "1 grupo · al menos 4 AP; no se puede identificar el grupo de 1 AP" in the list and the detail (whose AP section then has no count, with the note), while "Todos los puntos de acceso" and "Alcance desconocido" stay', async () => {
      const expected = `${es.groupOne} · ${fmt(es.apAtLeastMany, { count: 4 })}; ${es.scopeUnknownOne}`;
      await configureStub(session, { accessPoints: data.accessPoints });
      try {
        await refreshNetworks(session);
        await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent === text, { selector: casaSelector, text: expected }, { timeout: WAIT_MS });
        await waitForNetworksMode(page, 'managedReady');
        const list = await readManagedList(page);
        const detail = await readDetailPane(page, '#networkDetail');
        const scopes = Object.fromEntries(list.items.map((item) => [item.name, item.scope]));
        return verdict(
          scopes.Casa === expected && scopes.Invitados === nets.all && scopes.Rara === nets.unknownScope &&
          detail.heading === 'Casa' && detail.summary === expected && detail.sections.aps?.title === es.accessPoints &&
          isDeepStrictEqual(detail.sections.aps.notes, [es.networkUnknownOne]),
          { scopes, detail: detail.sections.aps }
        );
      } finally {
        await configureStub(session, { accessPoints: NETS_APS });
        await refreshNetworks(session);
        await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent === text, { selector: casaSelector, text: `${es.groupOne} · ${fmt(es.apMany, { count: 4 })}` }, { timeout: WAIT_MS });
      }
    }); // End of check "[nets] es: a lower bound is never shown as exact..."

    await check('[nets] es: a failed RE-READ keeps the last good list (§4.6 refresh error) — after a good read, a refresh whose managed read fails ("requestFailed"), throws, or answers a reply breaking the DTO contract (a valid new network next to a "wep" one) keeps the same 5 networks on screen, whole (nothing of the failed reply mixed in), with Casa still selected and its detail, the sidebar count 5 and no error state; above the view a notice "No se pudieron actualizar las redes Wi-Fi. Se muestra la lista de las hh:mm. <motivo>" (the time of the last good read, the amber stale dot, "Reintentar"), only on this view; its "Reintentar" reads again (the list stays, the notice goes while it runs, focus moves to the search) and the successful read clears it', async () => {
      const validNew = { id: netId(6), name: 'Nueva', security: 'open', bands: ['band2g'], enabled: true, hasPassphrase: false, scope: 'allAccessPoints', apGroupIds: [] };
      const cases = [
        { patch: { networksResult: NETS_FAILURE }, error: 'requestFailed', reason: `${nets.errRequestFailed} (${NETS_FAILURE.diagnostic})` },
        { patch: { networksResult: null, failChannels: ['management:networks'] }, error: 'failed', reason: nets.errFailed },
        { patch: { failChannels: [], networksResult: { success: true, networks: [validNew, { ...validNew, id: netId(7), name: 'WEP', security: 'wep' }] } }, error: 'invalidReply', reason: nets.errInvalidReply },
      ];
      const seen = [];
      let otherView;
      let backOnView;
      let during;
      let duringNotice;
      let duringFocus;
      let after;
      let afterNotice;
      try {
        await openNetworkDetail(page, 'Casa');
        for (const { patch, error, reason } of cases) {
          const startedAt = Date.now();
          await configureStub(session, patch);
          await refreshNetworks(session);
          await waitForNetworksStale(page, error);
          const notice = await readNetworksStaleNotice(page);
          const list = await readManagedList(page);
          const blocks = await readStateBlocks(page);
          const detail = await readDetailPane(page, '#networkDetail');
          const nav = await readNav(page);
          seen.push({
            error, reason, startedAt, notice, mode: list.mode,
            items: list.items.map(({ id, name, props, scope }) => ({ id, name, props, scope })),
            current: list.items.filter((item) => item.current === 'true').map((item) => item.id),
            block: blocks.networkList.state, heading: detail.heading, passphrase: detail.facts.passphrase?.value ?? null, navCount: nav.networks.count,
          });
        } // End of the loop over the failing re-reads
        // The notice (above the views) belongs to the Wi-Fi networks view alone
        await page.click('#navGroups');
        otherView = await readNetworksStaleNotice(page);
        await page.click('#navNetworks');
        backOnView = await readNetworksStaleNotice(page);
        // Its Retry: held 800 ms, then a good read with one more network
        await configureStub(session, { networksResult: null, failChannels: [], delays: { 'management:networks': 800 }, networks: [...NETS_NETWORKS, NETS_NEW_NETWORK] });
        const before = callsTo(await stubState(session), 'management:networks').length;
        await page.click('#networksStaleRetryBtn');
        await waitForStubCall(session, 'management:networks', before);
        during = await readManagedList(page);
        duringNotice = await readNetworksStaleNotice(page);
        duringFocus = await readFocus(page);
        await page.waitForSelector('#networkList .master-item[data-network-name="Nueva"]', { timeout: WAIT_MS });
        after = await readManagedList(page);
        afterNotice = await readNetworksStaleNotice(page);
      } finally {
        await configureStub(session, { networksResult: null, failChannels: [], delays: {}, networks: NETS_NETWORKS });
        await refreshNetworks(session);
        await page.waitForFunction(() => document.querySelector('#networkList .master-item[data-network-name="Nueva"]') === null && document.getElementById('networksStaleNotice').hidden, null, { timeout: WAIT_MS });
      }
      const readAt = seen[0]?.notice.readAt ?? null;
      return verdict(
        seen.length === cases.length &&
        seen.every((entry) => entry.mode === 'managedReady' && isDeepStrictEqual(entry.items, expectedManagedItems('es')) && isDeepStrictEqual(entry.current, [netId(1)]) &&
          entry.block === null && entry.heading === 'Casa' && entry.passphrase === nets.passphraseSet && entry.navCount === '5' &&
          entry.notice.shown && entry.notice.visible && entry.notice.role === 'status' && entry.notice.error === entry.error && entry.notice.dot &&
          entry.notice.readAt === readAt && entry.notice.text === fmt(nets.stale, { time: entry.notice.time, reason: entry.reason }) &&
          entry.notice.retryAction === 'retryNetworks' && entry.notice.retryText === es.retry) &&
        readAt !== null && readAt < seen[0].startedAt &&
        !otherView.shown && !otherView.visible && backOnView.shown && backOnView.visible &&
        during.mode === 'managedReady' && during.items.length === 5 && !duringNotice.shown && duringFocus.id === 'networkSearch' &&
        after.mode === 'managedReady' && after.items.length === 6 && isDeepStrictEqual(after.items.filter((item) => item.current === 'true').map((item) => item.id), [netId(1)]) &&
        !afterNotice.shown && afterNotice.text === '' && afterNotice.error === null,
        { seen, otherView, backOnView, during: during?.items.length, duringNotice, duringFocus, after: after?.items.length, afterNotice }
      );
    }); // End of check "[nets] es: a failed RE-READ keeps the last good list..."

    await check('[nets] es: a failed FIRST read shows the §4.6 error state in the list\'s place — once "Probar el acceso de gestión" made the view read its list from scratch: a persistent alert "El controlador no pudo enviar las redes Wi-Fi. (ssids: httpError, HTTP 503)" with "Reintentar" and "Ajustes", no network listed, no stale notice and an empty detail; the sidebar falls back to the internal count (7); "Reintentar" reads again with the session nonce, shows the loading skeleton while it runs (focus moves to the search) and then the list, with Casa selected again', async () => {
      await configureStub(session, { networksResult: NETS_FAILURE });
      try {
        await recheckManagement(page, CAPS_TEXT.es.result.ok);
        const message = `${nets.errRequestFailed} (${NETS_FAILURE.diagnostic})`;
        await waitForNetworksError(page, message);
        const failed = await readManagedList(page);
        const blocks = await readStateBlocks(page);
        const detail = await readDetailPane(page, '#networkDetail');
        const nav = await readNav(page);
        const notice = await readNetworksStaleNotice(page);
        await configureStub(session, { networksResult: null, delays: { 'management:networks': 800 } });
        const before = callsTo(await stubState(session), 'management:networks').length;
        await page.click('#networkList [data-state-action="retryNetworks"]');
        await waitForNetworksMode(page, 'managedLoading');
        const loading = await readStateBlocks(page);
        const focus = await readFocus(page);
        await waitForNetworksMode(page, 'managedReady');
        const ready = await readManagedList(page);
        const again = await readDetailPane(page, '#networkDetail');
        const snapshot = await stubState(session);
        const retries = callsTo(snapshot, 'management:networks').slice(before);
        return verdict(
          failed.mode === 'managedFailed' && failed.items.length === 0 &&
          blocks.networkList.state === 'networksError' && blocks.networkList.text === message && blocks.networkList.alert &&
          isDeepStrictEqual(blocks.networkList.actions, [['retryNetworks', es.retry], ['settings', es.settings]]) &&
          detail.heading === null && detail.empty === null && nav.networks.count === '7' && !notice.shown &&
          loading.networkList.state === 'loading' && loading.networkList.skeletonRows > 0 && loading.networkList.skeletonRole === 'status' &&
          focus.id === 'networkSearch' &&
          isDeepStrictEqual(ready.items.map(({ id, name, props, scope }) => ({ id, name, props, scope })), expectedManagedItems('es')) &&
          isDeepStrictEqual(ready.items.filter((item) => item.current === 'true').map((item) => item.id), [netId(1)]) && again.heading === 'Casa' &&
          retries.length === 1 && isDeepStrictEqual(retries[0].args, [snapshot.sessionNonce]),
          { failed, blocks: blocks.networkList, detail, nav: nav.networks, notice, loading: loading.networkList, focus, ready: ready.items.length, again: again.heading, retries: retries.length }
        );
      } finally {
        await configureStub(session, { networksResult: null, delays: {} });
      }
    }); // End of check "[nets] es: a failed FIRST read shows the §4.6 error state..."

    await check('[nets] es: never a partial list on a first read — one network\'s malformed detail (main answers "ssid detail: malformedResponse"), a catalog too long to read ("networkListIncomplete") and a reply breaking the DTO contract (one network with an unknown security mode: "La respuesta sobre las redes Wi-Fi no es válida: no se muestra nada de ella.") each show the error state with "Reintentar" and no network at all (the first read from scratch after "Probar el acceso de gestión", the others while the error state holds no list)', async () => {
      const brokenDetail = NETS_NETWORKS.map((network, index) => (index === 2 ? { ...network, detail: { ...network.detail, id: netId(9) } } : network));
      const validCasa = { id: netId(1), name: 'Casa', security: 'wpaPersonal', bands: ['band2g'], enabled: true, hasPassphrase: true, scope: 'allAccessPoints', apGroupIds: [] };
      const cases = [
        { patch: { networks: brokenDetail }, error: 'requestFailed', text: `${nets.errRequestFailed} (ssid detail: malformedResponse)` },
        { patch: { networks: NETS_NETWORKS, networksResult: { success: false, error: 'networkListIncomplete', diagnostic: 'ssids 130, over 128' } }, error: 'networkListIncomplete', text: `${nets.errListIncomplete} (ssids 130, over 128)` },
        { patch: { networksResult: { success: true, networks: [validCasa, { ...validCasa, id: netId(7), name: 'WEP', security: 'wep' }] } }, error: 'invalidReply', text: nets.errInvalidReply },
      ];
      const seen = [];
      try {
        for (const [index, { patch, error, text }] of cases.entries()) {
          await configureStub(session, patch);
          if (index === 0) {
            await recheckManagement(page, CAPS_TEXT.es.result.ok);
          } else {
            await refreshNetworks(session);
          }
          await waitForNetworksError(page, text);
          const list = await readManagedList(page);
          const blocks = await readStateBlocks(page);
          const errorCode = await page.evaluate(() => document.querySelector('#networkList .state-block')?.dataset.error ?? null);
          seen.push({ error, errorCode, items: list.items.length, mode: list.mode, actions: blocks.networkList.actions });
        } // End of the loop over the failing reads
      } finally {
        await configureStub(session, { networks: NETS_NETWORKS, networksResult: null });
        await refreshNetworks(session);
        await waitForNetworksMode(page, 'managedReady');
      }
      return verdict(
        seen.length === cases.length &&
        seen.every((entry) => entry.errorCode === entry.error && entry.items === 0 && entry.mode === 'managedFailed' && entry.actions[0]?.[0] === 'retryNetworks'),
        seen
      );
    }); // End of check "[nets] es: never a partial list..."

    await check('[nets] es: a reply of an older read is discarded — the stub holds one read 2.5 s; a newer read answers at once with one more network ("Nueva", "Todos los puntos de acceso"); when the held read finally answers (with an error) the list stays as the newer read left it, with no error state and no stale notice', async () => {
      try {
        await configureStub(session, { delays: { 'management:networks': 2500 } });
        await refreshNetworks(session);
        await configureStub(session, { delays: {}, networks: [...NETS_NETWORKS, NETS_NEW_NETWORK] });
        await refreshNetworks(session);
        await page.waitForSelector('#networkList .master-item[data-network-name="Nueva"]', { timeout: WAIT_MS });
        await configureStub(session, { networksResult: NETS_FAILURE });
        // Let the held read land
        await page.waitForTimeout(2800);
        const list = await readManagedList(page);
        const blocks = await readStateBlocks(page);
        const notice = await readNetworksStaleNotice(page);
        const snapshot = await stubState(session);
        const reads = callsTo(snapshot, 'management:networks').slice(-2);
        return verdict(
          list.mode === 'managedReady' && list.items.length === 6 && list.items.some((item) => item.name === 'Nueva' && item.scope === nets.all) &&
          blocks.networkList.state === null && !notice.shown && reads.length === 2 && reads.every((call) => isDeepStrictEqual(call.args, [snapshot.sessionNonce])),
          { list: list.items.map((item) => item.name), mode: list.mode, block: blocks.networkList.state, notice, reads: reads.map((call) => call.args) }
        );
      } finally {
        await configureStub(session, { delays: {}, networks: NETS_NETWORKS, networksResult: null });
        await refreshNetworks(session);
        await page.waitForFunction(() => document.querySelector('#networkList .master-item[data-network-name="Nueva"]') === null, null, { timeout: WAIT_MS });
      }
    }); // End of check "[nets] es: a reply of an older read is discarded..."

    await check('[nets] es: a reply that arrives after a reconnect (old session nonce, answered "superseded") is discarded: the new session\'s managed list stays on screen, with no error state', async () => {
      const before = await stubState(session);
      const oldNonce = before.sessionNonce;
      try {
        await configureStub(session, { delays: { 'management:networks': 3000 } });
        await refreshNetworks(session);
      } finally {
        await configureStub(session, { delays: {} });
      }
      await waitForLoadIdle(page);
      await page.click('#connectBtn');
      await waitForStatus(page, es.disconnected);
      await page.click('#connectBtn');
      await waitForConnected(page);
      await waitForNetworksMode(page, 'managedReady');
      // Let the old reply land
      await page.waitForTimeout(3300);
      const list = await readManagedList(page);
      const blocks = await readStateBlocks(page);
      const snapshot = await stubState(session);
      const stale = callsTo(snapshot, 'management:networks').filter((call) => call.args[0] === oldNonce);
      return verdict(
        snapshot.sessionNonce !== oldNonce && stale.length >= 1 && list.mode === 'managedReady' && blocks.networkList.state === null &&
        isDeepStrictEqual(list.items.map(({ id, name, props, scope }) => ({ id, name, props, scope })), expectedManagedItems('es')),
        { mode: list.mode, block: blocks.networkList.state, stale: stale.length, oldNonce, nonce: snapshot.sessionNonce }
      );
    }); // End of check "[nets] es: a reply that arrives after a reconnect..."

    await check('[nets] es: management off or being checked → the 14a view, unchanged — while "Probar el acceso de gestión" re-checks the view falls back to the internal list at once; with a failing check ("siteNotFound") the banner states it and the view is the 14a one (one entry per network name with its 14a scope, no managed values, the sidebar counts 7; Casa\'s detail says security, bands and enabled state need management access) and no managed read is made; when the check passes again the managed list returns', async () => {
      let checking;
      let off;
      let offDetail;
      let offNav;
      let notices;
      let readsWhileOff;
      try {
        await configureStub(session, { delays: { 'management:test': 1000 } });
        await openSettingsWhenIdle(page);
        await page.click('#testManagementBtn');
        await page.waitForFunction(() => document.getElementById('readOnlyBanner')?.dataset.reason === 'managementChecking', null, { timeout: WAIT_MS });
        checking = await readManagedList(page);
        await waitForTestResult(page, CAPS_TEXT.es.result.ok);
        await configureStub(session, { delays: {}, managementReason: 'siteNotFound', managementDiagnostic: 'sites 2' });
        await page.click('#testManagementBtn');
        await waitForTestResult(page, `${CAPS_TEXT.es.result.siteNotFound} (sites 2)`);
        await page.click('#cancelSettingsBtn');
        await waitForSettingsClosed(page);
        await waitForNetworksMode(page, 'internal');
        const readsBefore = callsTo(await stubState(session), 'management:networks').length;
        await waitForLoadIdle(page);
        await page.click('#refreshBtn');
        await waitForLoadIdle(page);
        off = await readManagedList(page);
        offNav = await readNav(page);
        notices = await readNotices(page);
        await openNetworkDetail(page, 'Casa');
        offDetail = await readDetailPane(page, '#networkDetail');
        readsWhileOff = callsTo(await stubState(session), 'management:networks').length - readsBefore;
      } finally {
        await configureStub(session, { delays: {}, managementReason: null, managementDiagnostic: null });
        if (await page.isVisible('#settingsModal.visible')) {
          await page.click('#cancelSettingsBtn');
          await waitForSettingsClosed(page);
        }
        await openSettingsWhenIdle(page);
        await page.click('#testManagementBtn');
        await waitForTestResult(page, CAPS_TEXT.es.result.ok);
        await page.click('#cancelSettingsBtn');
        await waitForSettingsClosed(page);
      }
      await waitForNetworksMode(page, 'managedReady');
      const on = await readManagedList(page);
      const expected14a = expectedNetworkItems(NETS_APS, data.wlanGroups, 'es');
      return verdict(
        checking.mode === 'internal' && checking.items.every((item) => item.id === null && item.props === null) &&
        off.mode === 'internal' && isDeepStrictEqual(off.items.map(({ name, label, scope }) => ({ name, label, scope })), expected14a) &&
        off.items.every((item) => item.id === null && item.props === null) && offNav.networks.count === String(expected14a.length) &&
        notices.bannerShown && notices.bannerReason === 'siteNotFound' &&
        offDetail.heading === 'Casa' && isDeepStrictEqual(offDetail.notes, [{ kind: 'managementOnly', text: es.managementOnly }]) &&
        Object.keys(offDetail.facts).length === 0 && readsWhileOff === 0 &&
        isDeepStrictEqual(on.items.map(({ id, name, props, scope }) => ({ id, name, props, scope })), expectedManagedItems('es')),
        { checking, off, offNav: offNav.networks, notices, offDetail, readsWhileOff, on: on.items.length }
      );
    }); // End of check "[nets] es: management off or being checked..."

    await check('[nets] es: the Back history survives "Probar el acceso de gestión" — from Casa\'s managed detail its Default link opens AP groups with "Volver a Casa"; while the check runs (the Wi-Fi networks view falls back to its 14a view) and once it passes again "Volver a Casa" stays, and Back opens Casa\'s managed detail (its id selected) with focus on its Default link; when a check fails instead ("siteNotFound": management definitively off) that entry is dropped (the 14a view cannot show a managed network by its id)', async () => {
      /**
       * Follows the Default link of the network detail on screen and waits
       * for Default's detail in AP groups.
       * @returns {Promise<void>}
       */
      const toDefault = async () => {
        await page.click(`#networkDetail .cross-link[data-link-kind="group"][data-link-target="${GROUP.Default.wlanId}"]`);
        await page.waitForFunction(() => document.getElementById('groupDetailName')?.textContent === 'Default' && !document.getElementById('viewGroups').hidden, null, { timeout: WAIT_MS });
      };
      let toGroup;
      let checking;
      let checkingMode;
      let passed;
      let back;
      let backList;
      let again;
      let off;
      let offMode;
      try {
        await page.click('#navNetworks');
        await openNetworkDetail(page, 'Casa');
        await toDefault();
        toGroup = await readInventory(page);
        await configureStub(session, { delays: { 'management:test': 1000 } });
        await openSettingsWhenIdle(page);
        await page.click('#testManagementBtn');
        await page.waitForFunction(() => document.getElementById('readOnlyBanner')?.dataset.reason === 'managementChecking', null, { timeout: WAIT_MS });
        checking = await readInventory(page);
        checkingMode = (await readManagedList(page)).mode;
        await waitForTestResult(page, CAPS_TEXT.es.result.ok);
        await page.click('#cancelSettingsBtn');
        await waitForSettingsClosed(page);
        await waitForNetworksMode(page, 'managedReady');
        passed = await readInventory(page);
        await page.click('#backBtn');
        await page.waitForFunction(() => document.getElementById('networkDetailName')?.textContent === 'Casa' && !document.getElementById('viewNetworks').hidden, null, { timeout: WAIT_MS });
        back = await readInventory(page);
        backList = await readManagedList(page);
        // Once more, then a check that fails: management definitively off
        await toDefault();
        again = await readInventory(page);
        await configureStub(session, { delays: {}, managementReason: 'siteNotFound', managementDiagnostic: 'sites 2' });
        await recheckManagement(page, `${CAPS_TEXT.es.result.siteNotFound} (sites 2)`);
        await waitForNetworksMode(page, 'internal');
        off = await readInventory(page);
        offMode = (await readManagedList(page)).mode;
      } finally {
        await configureStub(session, { delays: {}, managementReason: null, managementDiagnostic: null });
        if (await page.isVisible('#settingsModal.visible')) {
          await page.click('#cancelSettingsBtn');
          await waitForSettingsClosed(page);
        }
        await recheckManagement(page, CAPS_TEXT.es.result.ok);
        await waitForNetworksMode(page, 'managedReady');
        // The next checks start on the Wi-Fi networks view
        await page.click('#navNetworks');
      }
      const backToCasa = fmt(es.backTo, { target: 'Casa' });
      return verdict(
        isDeepStrictEqual(toGroup.shown, ['viewGroups']) && !toGroup.backHidden && toGroup.backLabel === backToCasa &&
        checkingMode === 'internal' && !checking.backHidden && checking.backLabel === backToCasa &&
        isDeepStrictEqual(passed.shown, ['viewGroups']) && !passed.backHidden && passed.backLabel === backToCasa &&
        isDeepStrictEqual(back.shown, ['viewNetworks']) && back.backHidden && back.currentNetwork === 'Casa' &&
        isDeepStrictEqual(backList.items.filter((item) => item.current === 'true').map((item) => item.id), [netId(1)]) &&
        back.focus.linkKind === 'group' && back.focus.linkTarget === GROUP.Default.wlanId &&
        !again.backHidden && again.backLabel === backToCasa &&
        offMode === 'internal' && isDeepStrictEqual(off.shown, ['viewGroups']) && off.backHidden,
        { toGroup, checking, checkingMode, passed, back, backList: backList?.items, again, off, offMode }
      );
    }); // End of check "[nets] es: the Back history survives..."

    await check('[nets] en: after switching to English (saved, reconnected): Casa "1 group · 4 APs", Invitados "All access points", IoT "2 groups · 1 AP", Oficina "2 groups · 5 APs", Rara "Unknown scope" with "State unknown · Security unknown · Bands unknown"; Casa\'s facts "State Enabled", "Security WPA-Personal", "Bands 2.4 GHz and 5 GHz", "Password Set"; Invitados "Password None" with its note; a failed re-read keeps the list with "Couldn\'t refresh the Wi-Fi networks. Showing the list from hh:mm. The controller could not send the Wi-Fi networks. (ssids: httpError, HTTP 503)" and "Retry"; a failed first read reads "The controller could not send the Wi-Fi networks. (ssids: httpError, HTTP 503)" with "Retry" and "Settings"', async () => {
      const en = TEXT.en;
      const netsEn = NETS_TEXT.en;
      await openSettingsWhenIdle(page);
      await page.selectOption('#languageSelect', 'en');
      await page.click('#saveSettingsBtn');
      await waitForSettingsClosed(page);
      await waitForConnected(page);
      await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent === text, { selector: casaSelector, text: `${en.groupOne} · ${fmt(en.apMany, { count: 4 })}` }, { timeout: WAIT_MS });
      await waitForNetworksMode(page, 'managedReady');
      const list = await readManagedList(page);
      await openNetworkDetail(page, 'Casa');
      const casa = await readDetailPane(page, '#networkDetail');
      await openNetworkDetail(page, 'Invitados');
      const invitados = await readDetailPane(page, '#networkDetail');
      const reason = `${netsEn.errRequestFailed} (${NETS_FAILURE.diagnostic})`;
      let stale;
      let staleList;
      let blocks;
      try {
        await configureStub(session, { networksResult: NETS_FAILURE });
        await refreshNetworks(session);
        await waitForNetworksStale(page, 'requestFailed');
        stale = await readNetworksStaleNotice(page);
        staleList = await readManagedList(page);
        await recheckManagement(page, CAPS_TEXT.en.result.ok);
        await waitForNetworksError(page, reason);
        blocks = await readStateBlocks(page);
      } finally {
        await configureStub(session, { networksResult: null });
      }
      return verdict(
        isDeepStrictEqual(list.items.map(({ id, name, props, scope }) => ({ id, name, props, scope })), expectedManagedItems('en')) &&
        casa.summary === `${en.groupOne} · ${fmt(en.apMany, { count: 4 })}` &&
        isDeepStrictEqual(casa.facts, expectedFacts('en', netsEn.enabled, netsEn.wpaPersonal, netsEn.bands2g5g, netsEn.passphraseSet)) &&
        casa.sections.groups?.title === `${en.groupsTitle.apGroup} (1)` && casa.sections.aps?.title === `${en.accessPoints} (4)` &&
        invitados.summary === netsEn.all && isDeepStrictEqual(invitados.facts, expectedFacts('en', netsEn.disabled, netsEn.open, netsEn.bandsAll, netsEn.passphraseNone)) &&
        isDeepStrictEqual(invitados.notes, [{ kind: 'allAccessPoints', text: netsEn.allNote }]) &&
        stale.shown && stale.text === fmt(netsEn.stale, { time: stale.time, reason }) && stale.retryText === 'Retry' &&
        isDeepStrictEqual(staleList.items.map(({ id, name, props, scope }) => ({ id, name, props, scope })), expectedManagedItems('en')) &&
        blocks.networkList.state === 'networksError' && blocks.networkList.alert &&
        isDeepStrictEqual(blocks.networkList.actions, [['retryNetworks', 'Retry'], ['settings', 'Settings']]),
        { list: list.items, casa, invitados, stale, staleList: staleList?.items.length, blocks: blocks?.networkList }
      );
    }); // End of check "[nets] en: after switching to English..."
  } finally {
    session.finalState = await stubState(session).catch((error) => ({ error: String(error) }));
    await session.app.close().catch(() => {});
  }
} // End of function runManagedNetworks()

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
    for (const [label, runLaunch] of [
      ['es', runSpanishFirstRun],
      ['en', runEnglishMultiSite],
      ['tofu', runCertificatePinning],
      ['mgmt', runManagementAccess],
      ['caps', runManagementCapabilities],
      ['groups', runApGroupManagement],
      ['nets', runManagedNetworks],
    ]) {
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
