// Renderer process - UI logic
// Types are available via preload script's global declaration

// ============================================================================
// Internationalization (inlined to avoid module loading issues in browser)
// ============================================================================

type Language = 'es' | 'en';

interface Translations {
  disconnected: string;
  connecting: string;
  connected: string;
  error: string;
  connectionError: string;
  connect: string;
  disconnect: string;
  apply: string;
  applying: string;
  save: string;
  cancel: string;
  confirm: string;
  settings: string;
  accessPoints: string;
  wlanGroups: string;
  noAccessPoints: string;
  noWlanGroups: string;
  connectToSeeAPs: string;
  connectToSeeWLANs: string;
  noResultsFor: string;
  selectApAndWlan: string;
  selectAp: string;
  selectWlan: string;
  wlanLabel: string;
  unassigned: string;
  noSsids: string;
  more: string;
  connectionSettings: string;
  controllerUrl: string;
  username: string;
  password: string;
  language: string;
  fillUrlAndUser: string;
  passwordRequired: string;
  passwordUnchanged: string;
  invalidUrl: string;
  saveError: string;
  confirmChange: string;
  confirmAssign: string;
  changeApplied: string;
  changeError: string;
  filter: string;
  refresh: string;
  loading: string;
  loadError: string;
  configLoadError: string;
  close: string;
  configIncomplete: string;
  connectFailed: string;
  configureHint: string;
}

const translations: Record<Language, Translations> = {
  es: {
    disconnected: 'Desconectado',
    connecting: 'Conectando...',
    connected: 'Conectado',
    error: 'Error',
    connectionError: 'Error de conexión',
    connect: 'Conectar',
    disconnect: 'Desconectar',
    apply: 'Aplicar cambio',
    applying: 'Aplicando...',
    save: 'Guardar',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    settings: 'Ajustes',
    accessPoints: 'Access Points',
    wlanGroups: 'Grupos WLAN',
    noAccessPoints: 'No hay access points disponibles',
    noWlanGroups: 'No hay grupos WLAN disponibles',
    connectToSeeAPs: 'Conecta al controlador para ver los access points',
    connectToSeeWLANs: 'Conecta al controlador para ver los grupos WLAN',
    noResultsFor: 'No hay resultados para',
    selectApAndWlan: 'Selecciona un AP y un grupo WLAN',
    selectAp: 'Selecciona un AP',
    selectWlan: 'Selecciona un grupo WLAN',
    wlanLabel: 'WLAN',
    unassigned: 'Sin asignar',
    noSsids: 'Sin SSIDs',
    more: 'más',
    connectionSettings: 'Ajustes de conexión',
    controllerUrl: 'URL del controlador',
    username: 'Usuario',
    password: 'Contraseña',
    language: 'Idioma',
    fillUrlAndUser: 'Por favor, completa la URL y el usuario',
    passwordRequired: 'Por favor, introduce la contraseña',
    passwordUnchanged: '(sin cambios)',
    invalidUrl: 'URL no válida: debe empezar por https:// y no contener credenciales ni fragmentos',
    saveError: 'Error al guardar la configuración',
    confirmChange: 'Confirmar cambio',
    confirmAssign: '¿Asignar "{wlan}" al AP "{ap}"?',
    changeApplied: 'Cambio aplicado correctamente',
    changeError: 'Error al aplicar el cambio',
    filter: 'Filtrar...',
    refresh: 'Actualizar',
    loading: 'Cargando...',
    loadError: 'Error al cargar los datos del controlador',
    configLoadError: 'Error al cargar la configuración',
    close: 'Cerrar',
    configIncomplete: 'Configuración incompleta. Por favor, configura la conexión.',
    connectFailed: 'No se pudo conectar al controlador.',
    configureHint: 'Configura la conexión en Ajustes para empezar',
  },
  en: {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    connected: 'Connected',
    error: 'Error',
    connectionError: 'Connection error',
    connect: 'Connect',
    disconnect: 'Disconnect',
    apply: 'Apply change',
    applying: 'Applying...',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    settings: 'Settings',
    accessPoints: 'Access Points',
    wlanGroups: 'WLAN Groups',
    noAccessPoints: 'No access points available',
    noWlanGroups: 'No WLAN groups available',
    connectToSeeAPs: 'Connect to the controller to see access points',
    connectToSeeWLANs: 'Connect to the controller to see WLAN groups',
    noResultsFor: 'No results for',
    selectApAndWlan: 'Select an AP and a WLAN group',
    selectAp: 'Select an AP',
    selectWlan: 'Select a WLAN group',
    wlanLabel: 'WLAN',
    unassigned: 'Unassigned',
    noSsids: 'No SSIDs',
    more: 'more',
    connectionSettings: 'Connection settings',
    controllerUrl: 'Controller URL',
    username: 'Username',
    password: 'Password',
    language: 'Language',
    fillUrlAndUser: 'Please fill in the URL and username',
    passwordRequired: 'Please enter the password',
    passwordUnchanged: '(unchanged)',
    invalidUrl: 'Invalid URL: it must start with https:// and contain no credentials or fragments',
    saveError: 'Error saving configuration',
    confirmChange: 'Confirm change',
    confirmAssign: 'Assign "{wlan}" to AP "{ap}"?',
    changeApplied: 'Change applied successfully',
    changeError: 'Error applying change',
    filter: 'Filter...',
    refresh: 'Refresh',
    loading: 'Loading...',
    loadError: 'Error loading data from the controller',
    configLoadError: 'Error loading the configuration',
    close: 'Close',
    configIncomplete: 'Configuration incomplete. Please set up the connection.',
    connectFailed: 'Could not connect to the controller.',
    configureHint: 'Set up the connection in Settings to get started',
  },
};

let currentLanguage: Language = 'es';

/**
 * Sets the active UI language and keeps the document language attribute in
 * sync (so assistive technology announces text with the right voice).
 * @param {Language} lang - The language to activate ('es' | 'en').
 */
function setLanguage(lang: Language): void {
  if (translations[lang]) {
    currentLanguage = lang;
    document.documentElement.lang = lang;
  }
}

function t(key: keyof Translations): string {
  return translations[currentLanguage][key];
}

function tFormat(key: keyof Translations, vars: Record<string, string>): string {
  let text = translations[currentLanguage][key];
  for (const [varName, value] of Object.entries(vars)) {
    text = text.replace(`{${varName}}`, value);
  }
  return text;
}

// ============================================================================
// Types
// ============================================================================

interface AccessPoint {
  mac: string;
  name: string;
  type: string;
  wlanGroup: string;
  statusCategory: number;
}

interface WlanGroup {
  wlanId: string;
  wlanName: string;
  ssidList: { ssidName: string }[];
}

// State
let accessPoints: AccessPoint[] = [];
let wlanGroups: WlanGroup[] = [];
let selectedAp: AccessPoint | null = null;
let selectedWlan: WlanGroup | null = null;
let isConnected = false;
let apFilterText = '';
let wlanFilterText = '';
// True while loadData() is fetching (drives the Refresh button/spinners)
let isLoadingData = false;
// True when a controller URL is stored; before first configuration the empty
// states show a "configure the connection" hint instead of "connect to see"
let hasStoredConfig = false;

// Monotonic token identifying the current connection session. It is bumped by
// invalidateSession() on every connect and disconnect; async operations
// capture it before awaiting and discard their results (no UI commit, no
// state flips) when it has moved on — e.g. a refresh that finishes after a
// disconnect must not repopulate the disconnected UI.
let sessionGeneration = 0;

// Per-operation in-flight flags serializing connect/disconnect/save/apply/
// refresh so they can never overlap (see isOperationInProgress())
let isConnecting = false;
let isDisconnecting = false;
let isSavingSettings = false;
let isApplyingChange = false;

/**
 * Reports whether any exclusive operation (connect, disconnect, settings
 * save, apply, or data load) is currently in flight. Used to serialize the
 * operations: while one is pending, starting another is a no-op.
 * @returns {boolean} True when an operation is in progress.
 */
function isOperationInProgress(): boolean {
  return isConnecting || isDisconnecting || isSavingSettings || isApplyingChange || isLoadingData;
}

/**
 * Invalidates the current session: bumps the generation token (so any
 * in-flight load or apply discards its result when it completes) and resets
 * the loading indicators that a discarded operation will no longer clean up.
 * Called at the start of connect() and disconnect().
 */
function invalidateSession(): void {
  sessionGeneration++;
  isLoadingData = false;
  refreshBtn.classList.remove('spinning');
}

// DOM Elements
// Background app shell: made inert while a modal is open (see
// updateBackgroundInert()); the modals and toasts are siblings, not children
const appContainer = document.querySelector('.app-container') as HTMLElement;
const statusIndicator = document.getElementById('statusIndicator') as HTMLElement;
const statusText = document.getElementById('statusText') as HTMLElement;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const toastContainer = document.getElementById('toastContainer') as HTMLElement;
const apList = document.getElementById('apList') as HTMLElement;
const wlanList = document.getElementById('wlanList') as HTMLElement;
const apFilterInput = document.getElementById('apFilter') as HTMLInputElement;
const wlanFilterInput = document.getElementById('wlanFilter') as HTMLInputElement;
const selectionInfo = document.getElementById('selectionInfo') as HTMLElement;
const applyBtn = document.getElementById('applyBtn') as HTMLButtonElement;

// Panel titles
const apPanelTitle = document.querySelector('.panel:first-child .panel-title') as HTMLElement;
const wlanPanelTitle = document.querySelector('.panel:last-child .panel-title') as HTMLElement;

// Settings Modal
const settingsModal = document.getElementById('settingsModal') as HTMLElement;
const settingsModalTitle = settingsModal.querySelector('.modal-header h2') as HTMLElement;
const closeSettingsBtn = document.getElementById('closeSettingsBtn') as HTMLButtonElement;
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn') as HTMLButtonElement;
const saveSettingsBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement;
const urlInput = document.getElementById('urlInput') as HTMLInputElement;
const usernameInput = document.getElementById('usernameInput') as HTMLInputElement;
const passwordInput = document.getElementById('passwordInput') as HTMLInputElement;
const languageSelect = document.getElementById('languageSelect') as HTMLSelectElement;

// Settings labels
const labelUrl = document.querySelector('label[for="urlInput"]') as HTMLElement;
const labelUsername = document.querySelector('label[for="usernameInput"]') as HTMLElement;
const labelPassword = document.getElementById('labelPassword') as HTMLElement;
const labelLanguage = document.getElementById('labelLanguage') as HTMLElement;

// Confirm Modal
const confirmModal = document.getElementById('confirmModal') as HTMLElement;
const confirmModalTitle = confirmModal.querySelector('.modal-header h2') as HTMLElement;
const confirmMessage = document.getElementById('confirmMessage') as HTMLElement;
const cancelConfirmBtn = document.getElementById('cancelConfirmBtn') as HTMLButtonElement;
const confirmConfirmBtn = document.getElementById('confirmConfirmBtn') as HTMLButtonElement;

// ============================================================================
// Internationalization
// ============================================================================

function applyTranslations() {
  // Panel titles
  apPanelTitle.textContent = t('accessPoints');
  wlanPanelTitle.textContent = t('wlanGroups');

  // Listbox labels for the (keyboard-navigable) list panels
  apList.setAttribute('aria-label', t('accessPoints'));
  wlanList.setAttribute('aria-label', t('wlanGroups'));

  // Filter placeholders
  apFilterInput.placeholder = t('filter');
  wlanFilterInput.placeholder = t('filter');

  // Icon-only buttons: tooltip + accessible name
  settingsBtn.title = t('settings');
  settingsBtn.setAttribute('aria-label', t('settings'));
  refreshBtn.title = t('refresh');
  refreshBtn.setAttribute('aria-label', t('refresh'));
  closeSettingsBtn.title = t('close');
  closeSettingsBtn.setAttribute('aria-label', t('close'));

  // Connect button (depends on state)
  if (isConnected) {
    connectBtn.textContent = t('disconnect');
  } else {
    connectBtn.textContent = t('connect');
  }

  // Apply button
  applyBtn.textContent = t('apply');

  // Settings modal
  settingsModalTitle.textContent = t('connectionSettings');
  labelUrl.textContent = t('controllerUrl');
  labelUsername.textContent = t('username');
  labelPassword.textContent = t('password');
  labelLanguage.textContent = t('language');
  cancelSettingsBtn.textContent = t('cancel');
  saveSettingsBtn.textContent = t('save');

  // Confirm modal
  confirmModalTitle.textContent = t('confirmChange');
  cancelConfirmBtn.textContent = t('cancel');
  confirmConfirmBtn.textContent = t('confirm');

  // Status text (depends on state)
  if (!isConnected) {
    statusText.textContent = t('disconnected');
  }

  // Re-render dynamic content
  if (accessPoints.length > 0 || wlanGroups.length > 0) {
    renderApList();
    renderWlanList();
  } else {
    showEmptyStates();
  }
  updateSelectionInfo();
}

// ============================================================================
// Status Management
// ============================================================================

function setStatus(status: 'disconnected' | 'connecting' | 'connected' | 'error', message?: string) {
  statusIndicator.className = 'status-indicator';

  switch (status) {
    case 'disconnected':
      statusText.textContent = t('disconnected');
      isConnected = false;
      break;
    case 'connecting':
      statusIndicator.classList.add('connecting');
      statusText.textContent = t('connecting');
      break;
    case 'connected': {
      statusIndicator.classList.add('connected');
      // Show server URL (extract hostname from URL, falling back to the raw
      // string if it is not a parseable URL)
      let serverDisplay = t('connected');
      if (message) {
        try {
          serverDisplay = new URL(message).host;
        } catch {
          serverDisplay = message;
        }
      }
      statusText.textContent = serverDisplay;
      isConnected = true;
      break;
    }
    case 'error':
      statusIndicator.classList.add('error');
      statusText.textContent = message || t('error');
      isConnected = false;
      break;
  }

  // Refresh is only meaningful with a live connection
  refreshBtn.disabled = status !== 'connected';
} // End of function setStatus()

/**
 * Shows a non-blocking toast notification that auto-dismisses. Replaces the
 * former alert() calls (which block the renderer and, on macOS, leave the
 * window without keyboard focus after closing). Built with DOM APIs only.
 * @param {string} message - The localized message to display.
 * @param {'success' | 'error' | 'info'} type - Visual style of the toast.
 */
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const TOAST_DURATION_MS = 4000;
  const TOAST_FADE_MS = 300;
  const MAX_TOASTS = 3;

  // Cap the stack: drop the oldest toast(s) so the pile can never grow over
  // other UI (the container is also fully click-through, see styles.css)
  while (toastContainer.children.length >= MAX_TOASTS) {
    toastContainer.firstElementChild?.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  // Enter transition on the next frame (so the initial state is painted)
  requestAnimationFrame(() => toast.classList.add('visible'));

  // Auto-dismiss: fade out, then remove the node once the transition ends
  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), TOAST_FADE_MS);
  }, TOAST_DURATION_MS);
} // End of function showToast()

// ============================================================================
// Boundary Validation
// ============================================================================

// Format guards for identifiers crossing the IPC boundary (from the
// controller via the main process, and back when applying a change). The main
// process enforces the same patterns (src/main/index.ts — keep both in sync).
const MAC_REGEX = /^[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}$/;
const WLAN_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validates a MAC address format (six hex pairs separated by ':' or '-').
 * @param {unknown} mac - Candidate MAC address.
 * @returns {mac is string} True when the value is a well-formed MAC string.
 */
function isValidMac(mac: unknown): mac is string {
  return typeof mac === 'string' && MAC_REGEX.test(mac);
}

/**
 * Validates a WLAN group id format (alphanumeric Omada object id, plus '_'/'-').
 * @param {unknown} id - Candidate WLAN group id.
 * @returns {id is string} True when the value is a well-formed WLAN id string.
 */
function isValidWlanId(id: unknown): id is string {
  return typeof id === 'string' && WLAN_ID_REGEX.test(id);
}

// ============================================================================
// List Rendering
// ============================================================================

/**
 * Creates an empty-state block (a muted message) for a list panel. Built with
 * DOM APIs, never HTML strings.
 * @param {string} message - The message to display.
 * @returns {HTMLElement} The empty-state element.
 */
function createEmptyState(message: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'empty-state';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  container.appendChild(paragraph);
  return container;
}

/**
 * Creates a loading block (spinner) for a list panel while data is fetched.
 * @returns {HTMLElement} The loading element.
 */
function createLoadingState(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'loading';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-label', t('loading'));
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  container.appendChild(spinner);
  return container;
}

/**
 * Restores keyboard focus to a just-re-rendered list item identified by a
 * dataset key/value pair. Re-rendering a list replaces every node, so the
 * previously focused element is gone; without this, a keyboard selection
 * would throw focus back to <body>. The refocused item also becomes the
 * single roving tab stop of its listbox.
 * @param {HTMLElement} listElement - The list container (apList or wlanList).
 * @param {'mac' | 'wlanId'} dataKey - The dataset key identifying the item.
 * @param {string} value - The identifier value to look for.
 */
function focusListItemByData(listElement: HTMLElement, dataKey: 'mac' | 'wlanId', value: string): void {
  for (const child of Array.from(listElement.children)) {
    if (child instanceof HTMLElement && child.dataset[dataKey] === value) {
      // Move the roving tab stop onto the item that receives focus
      for (const sibling of Array.from(listElement.children)) {
        if (sibling instanceof HTMLElement && sibling.getAttribute('role') === 'option') {
          sibling.tabIndex = sibling === child ? 0 : -1;
        }
      }
      child.focus();
      return;
    }
  }
} // End of function focusListItemByData()

/**
 * Applies roving tabindex to a listbox's options: the selected option (or the
 * first one when nothing is selected) is the single Tab stop (tabindex 0),
 * every other option gets tabindex -1. Called after each list render.
 * @param {HTMLElement} listElement - The listbox container (apList/wlanList).
 */
function applyRovingTabindex(listElement: HTMLElement): void {
  const options = Array.from(listElement.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute('role') === 'option'
  );
  if (options.length === 0) return;
  const selected = options.find(option => option.getAttribute('aria-selected') === 'true');
  const tabStop = selected || options[0];
  for (const option of options) {
    option.tabIndex = option === tabStop ? 0 : -1;
  }
} // End of function applyRovingTabindex()

/**
 * Moves keyboard focus from one listbox option to its neighbor (ArrowUp/
 * ArrowDown navigation, no wrap-around). The newly focused option becomes
 * the single roving Tab stop of the listbox.
 * @param {HTMLElement} listElement - The listbox container (apList/wlanList).
 * @param {HTMLElement} current - The option that currently has focus.
 * @param {1 | -1} direction - +1 for the next option, -1 for the previous.
 */
function moveOptionFocus(listElement: HTMLElement, current: HTMLElement, direction: 1 | -1): void {
  const options = Array.from(listElement.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute('role') === 'option'
  );
  const index = options.indexOf(current);
  if (index === -1) return;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= options.length) return;
  const next = options[nextIndex];
  current.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
} // End of function moveOptionFocus()

/**
 * Builds one AP list item entirely with DOM APIs (createElement/textContent/
 * dataset — no HTML strings), so values coming from the controller can never
 * be interpreted as markup. The item acts as a listbox option (which, unlike
 * a radio, legitimately supports an empty selection and toggling): clickable,
 * keyboard focusable via roving tabindex (see applyRovingTabindex()), toggled
 * with Enter/Space, with ArrowUp/ArrowDown moving focus between options.
 * @param {AccessPoint} ap - The access point to render.
 * @returns {HTMLElement} The list-item element with its handlers attached.
 */
function createApListItem(ap: AccessPoint): HTMLElement {
  const isOnline = ap.statusCategory === 1 || ap.statusCategory === 2;
  const isSelected = selectedAp?.mac === ap.mac;

  const item = document.createElement('div');
  item.className = isSelected ? 'list-item selected' : 'list-item';
  item.dataset.mac = ap.mac;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(isSelected));

  const radio = document.createElement('div');
  radio.className = 'item-radio';

  const content = document.createElement('div');
  content.className = 'item-content';

  const header = document.createElement('div');
  header.className = 'item-header';

  const status = document.createElement('span');
  status.className = isOnline ? 'item-status online' : 'item-status offline';
  status.textContent = '●';

  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = ap.name;

  const subtitle = document.createElement('div');
  subtitle.className = 'item-subtitle';
  subtitle.textContent = `${t('wlanLabel')}: ${ap.wlanGroup || t('unassigned')}`;

  header.appendChild(status);
  header.appendChild(name);
  content.appendChild(header);
  content.appendChild(subtitle);
  item.appendChild(radio);
  item.appendChild(content);

  /**
   * Toggles this AP's selection and re-renders. When triggered from the
   * keyboard, focus is restored to the re-rendered item.
   * @param {boolean} refocus - True to restore focus after the re-render.
   */
  const toggleSelection = (refocus: boolean): void => {
    selectedAp = selectedAp?.mac === ap.mac ? null : ap;
    renderApList();
    updateSelectionInfo();
    if (refocus) {
      focusListItemByData(apList, 'mac', ap.mac);
    }
  };

  item.addEventListener('click', () => toggleSelection(false));
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Space must not scroll the panel
      toggleSelection(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); // Arrows must move focus, not scroll the panel
      moveOptionFocus(apList, item, e.key === 'ArrowDown' ? 1 : -1);
    }
  });

  return item;
} // End of function createApListItem()

/**
 * Builds one WLAN group list item entirely with DOM APIs (createElement/
 * textContent/dataset — no HTML strings). The item acts as a listbox option
 * (which, unlike a radio, legitimately supports an empty selection and
 * toggling): clickable, keyboard focusable via roving tabindex (see
 * applyRovingTabindex()), toggled with Enter/Space, with ArrowUp/ArrowDown
 * moving focus between options.
 * @param {WlanGroup} wlan - The WLAN group to render.
 * @returns {HTMLElement} The list-item element with its handlers attached.
 */
function createWlanListItem(wlan: WlanGroup): HTMLElement {
  const isSelected = selectedWlan?.wlanId === wlan.wlanId;
  const ssids = wlan.ssidList.map(s => s.ssidName);
  const ssidPreview = ssids.length > 3
    ? `${ssids.slice(0, 3).join(', ')} +${ssids.length - 3} ${t('more')}`
    : ssids.join(', ');

  const item = document.createElement('div');
  item.className = isSelected ? 'list-item selected' : 'list-item';
  item.dataset.wlanId = wlan.wlanId;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(isSelected));

  const radio = document.createElement('div');
  radio.className = 'item-radio';

  const content = document.createElement('div');
  content.className = 'item-content';

  const header = document.createElement('div');
  header.className = 'item-header';

  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = wlan.wlanName;

  const subtitle = document.createElement('div');
  subtitle.className = 'item-subtitle';
  subtitle.textContent = ssidPreview || t('noSsids');

  header.appendChild(name);
  content.appendChild(header);
  content.appendChild(subtitle);
  item.appendChild(radio);
  item.appendChild(content);

  /**
   * Toggles this WLAN group's selection and re-renders. When triggered from
   * the keyboard, focus is restored to the re-rendered item.
   * @param {boolean} refocus - True to restore focus after the re-render.
   */
  const toggleSelection = (refocus: boolean): void => {
    selectedWlan = selectedWlan?.wlanId === wlan.wlanId ? null : wlan;
    renderWlanList();
    updateSelectionInfo();
    if (refocus) {
      focusListItemByData(wlanList, 'wlanId', wlan.wlanId);
    }
  };

  item.addEventListener('click', () => toggleSelection(false));
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Space must not scroll the panel
      toggleSelection(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); // Arrows must move focus, not scroll the panel
      moveOptionFocus(wlanList, item, e.key === 'ArrowDown' ? 1 : -1);
    }
  });

  return item;
} // End of function createWlanListItem()

/**
 * Renders the access-point list (applying the current filter) using DOM APIs.
 */
function renderApList(): void {
  const filteredAps = accessPoints.filter(ap =>
    ap.name.toLowerCase().includes(apFilterText.toLowerCase()) ||
    (ap.wlanGroup && ap.wlanGroup.toLowerCase().includes(apFilterText.toLowerCase()))
  );

  if (accessPoints.length === 0) {
    apList.replaceChildren(createEmptyState(t('noAccessPoints')));
    return;
  }

  if (filteredAps.length === 0) {
    apList.replaceChildren(createEmptyState(`${t('noResultsFor')} "${apFilterText}"`));
    return;
  }

  apList.replaceChildren(...filteredAps.map(createApListItem));
  applyRovingTabindex(apList);
} // End of function renderApList()

/**
 * Renders the WLAN group list (applying the current filter) using DOM APIs.
 */
function renderWlanList(): void {
  const filteredWlans = wlanGroups.filter(wlan =>
    wlan.wlanName.toLowerCase().includes(wlanFilterText.toLowerCase()) ||
    wlan.ssidList.some(s => s.ssidName.toLowerCase().includes(wlanFilterText.toLowerCase()))
  );

  if (wlanGroups.length === 0) {
    wlanList.replaceChildren(createEmptyState(t('noWlanGroups')));
    return;
  }

  if (filteredWlans.length === 0) {
    wlanList.replaceChildren(createEmptyState(`${t('noResultsFor')} "${wlanFilterText}"`));
    return;
  }

  wlanList.replaceChildren(...filteredWlans.map(createWlanListItem));
  applyRovingTabindex(wlanList);
} // End of function renderWlanList()

/**
 * Rebuilds the selection info bar with DOM APIs (no HTML strings, no inline
 * style attributes — muted parts use the .muted-text CSS class, which keeps
 * the CSP free of style-src 'unsafe-inline') and enables the Apply button
 * only when both an AP and a WLAN group are selected.
 */
function updateSelectionInfo(): void {
  if (!selectedAp && !selectedWlan) {
    const placeholder = document.createElement('span');
    placeholder.className = 'selection-placeholder';
    placeholder.textContent = t('selectApAndWlan');
    selectionInfo.replaceChildren(placeholder);
    applyBtn.disabled = true;
    return;
  }

  const detail = document.createElement('div');
  detail.className = 'selection-detail';

  const apPart = document.createElement('span');
  if (selectedAp) {
    apPart.className = 'ap-name';
    apPart.textContent = selectedAp.name;
  } else {
    apPart.className = 'muted-text';
    apPart.textContent = t('selectAp');
  }

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '→';

  const wlanPart = document.createElement('span');
  if (selectedWlan) {
    wlanPart.className = 'wlan-name';
    wlanPart.textContent = selectedWlan.wlanName;
  } else {
    wlanPart.className = 'muted-text';
    wlanPart.textContent = t('selectWlan');
  }

  detail.appendChild(apPart);
  detail.appendChild(arrow);
  detail.appendChild(wlanPart);
  selectionInfo.replaceChildren(detail);

  applyBtn.disabled = !(selectedAp && selectedWlan);
} // End of function updateSelectionInfo()

// ============================================================================
// Connection
// ============================================================================

/**
 * Maps a failed connection result (stable error codes sent by the main
 * process over IPC — see the OMADA_CONNECT handler in src/main/index.ts) to a
 * localized message. An unknown/absent code falls back to the generic
 * connection error; the optional technical detail is appended when present.
 * @param {{ error?: string; detail?: string }} result - The failed result.
 * @returns {string} The localized error message to display.
 */
function connectionErrorMessage(result: { error?: string; detail?: string }): string {
  let message: string;
  switch (result.error) {
    case 'configIncomplete':
      message = t('configIncomplete');
      break;
    case 'connectFailed':
      message = t('connectFailed');
      break;
    default:
      message = t('connectionError');
      break;
  }
  if (result.detail) {
    message = `${message} (${result.detail})`;
  }
  return message;
} // End of function connectionErrorMessage()

/**
 * Connects to the Omada controller and loads its data. If any step fails
 * (including loadData(), which is allowed to throw), the whole UI state is
 * reset consistently and the main-process controller is released. A no-op
 * while another exclusive operation is in flight; starting a connection
 * begins a new session generation, so any stale in-flight load from a
 * previous session discards its result. Its own generation is re-checked
 * after every await: should this session ever be superseded while awaiting,
 * no stale UI commit (status, button label, data) goes through.
 * @returns {Promise<void>}
 */
async function connect(): Promise<void> {
  if (isOperationInProgress()) return;
  invalidateSession();
  // This connection's session generation: every post-await UI commit below
  // is discarded when it no longer matches (belt-and-braces on top of the
  // in-flight serialization)
  const generation = sessionGeneration;
  isConnecting = true;
  setStatus('connecting');
  connectBtn.disabled = true;
  connectBtn.textContent = t('connecting');

  try {
    const result = await window.omadaAPI.connect();

    // Stale result (session superseded while awaiting): discard it
    if (generation !== sessionGeneration) return;

    if (result.success) {
      const config = await window.omadaAPI.loadConfig();
      // Stale result: a newer session owns the UI now
      if (generation !== sessionGeneration) return;
      setStatus('connected', config.url);
      connectBtn.textContent = t('disconnect');
      await loadData();
    } else {
      setStatus('error', connectionErrorMessage(result));
      connectBtn.textContent = t('connect');
      clearData();
      // Release the main-process controller so stale sessions cannot linger
      try {
        await window.omadaAPI.disconnect();
      } catch (disconnectError) {
        console.error('Error disconnecting after connection failure:', disconnectError);
      }
    }
  } catch (error) {
    console.error('Error connecting:', error);
    // A stale failure must neither flip the newer session's UI nor release
    // a controller that the newer session may own
    if (generation !== sessionGeneration) return;
    setStatus('error', t('connectionError'));
    connectBtn.textContent = t('connect');
    clearData();
    // Release the main-process controller so stale sessions cannot linger
    try {
      await window.omadaAPI.disconnect();
    } catch (disconnectError) {
      console.error('Error disconnecting after connection failure:', disconnectError);
    }
  } finally {
    isConnecting = false;
    // Only the current session owner may re-enable the button; when stale,
    // the superseding operation manages the button lifecycle itself
    if (generation === sessionGeneration) {
      connectBtn.disabled = false;
    }
  }
} // End of function connect()

/**
 * Clears all loaded AP/WLAN data, selections, and filters, then re-renders
 * the empty states and the selection info (which disables the Apply button).
 */
function clearData(): void {
  accessPoints = [];
  wlanGroups = [];
  selectedAp = null;
  selectedWlan = null;
  apFilterText = '';
  wlanFilterText = '';
  apFilterInput.value = '';
  wlanFilterInput.value = '';

  showEmptyStates();
  updateSelectionInfo();
} // End of function clearData()

/**
 * Disconnects from the controller: releases the main-process controller via
 * IPC and clears the UI state, even if the IPC call fails. The single public
 * guarded entry point (Disconnect button): a no-op while any exclusive
 * operation is in flight, so a disconnect can never overlap a pending
 * connect/save/apply/refresh. Internal cleanup paths that must always run
 * (e.g. the failure paths inside connect()) call window.omadaAPI.disconnect()
 * directly instead. The session generation is bumped FIRST, so a data load
 * still in flight discards its result instead of repopulating the
 * disconnected UI; the disconnected-UI commit itself is generation-checked
 * too, so it can never clobber a session that superseded this one.
 * @returns {Promise<void>}
 */
async function disconnect(): Promise<void> {
  if (isOperationInProgress()) return;
  isDisconnecting = true;
  invalidateSession();
  // This disconnect's session generation (see the finally block below)
  const generation = sessionGeneration;
  try {
    await window.omadaAPI.disconnect();
  } catch (error) {
    console.error('Error disconnecting:', error);
  } finally {
    isDisconnecting = false;
    // Only commit the disconnected UI while this is still the current
    // session; when superseded, the newer operation owns the UI
    if (generation === sessionGeneration) {
      isConnected = false;
      setStatus('disconnected');
      connectBtn.textContent = t('connect');
      connectBtn.disabled = false;
      clearData();
    }
  }
} // End of function disconnect()

function toggleConnection() {
  if (isConnected) {
    disconnect();
  } else {
    connect();
  }
}

/**
 * Loads access points and WLAN groups from the controller and renders them.
 * Shows a spinner in both panels while fetching (and spins the Refresh
 * button). The session generation is captured before awaiting: if it moves on
 * meanwhile (disconnect/reconnect), the result — success or error — is
 * discarded without committing anything to the UI, and the loading state is
 * left alone (invalidateSession() already reset it for the new session).
 * Current-session errors are intentionally not caught here: the caller
 * handles them so the whole UI state stays consistent (see connect(),
 * refreshData(), and applyChange()).
 * @returns {Promise<void>}
 */
async function loadData(): Promise<void> {
  const generation = sessionGeneration;
  isLoadingData = true;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');
  showLoadingStates();

  try {
    const [aps, wlans] = await Promise.all([
      window.omadaAPI.getAccessPoints(),
      window.omadaAPI.getWlanGroups()
    ]);

    // Stale result (the session changed while awaiting): discard it
    if (generation !== sessionGeneration) return;

    // Keep only entries whose identifiers have a valid format: they cross the
    // IPC boundary again when a change is applied, and a malformed id coming
    // from a compromised controller must never reach the UI or the main process
    accessPoints = aps.filter(ap => {
      if (!isValidMac(ap.mac)) {
        console.warn('Ignoring access point with invalid MAC format:', ap.mac);
        return false;
      }
      return true;
    });
    wlanGroups = wlans.filter(wlan => {
      if (!isValidWlanId(wlan.wlanId)) {
        console.warn('Ignoring WLAN group with invalid id format:', wlan.wlanId);
        return false;
      }
      return true;
    });

    // Reset selection
    selectedAp = null;
    selectedWlan = null;

    renderApList();
    renderWlanList();
    updateSelectionInfo();
  } catch (error) {
    // Stale failure: swallow it (the disconnected/new UI must not react)
    if (generation !== sessionGeneration) {
      console.warn('Discarding data-load error from a stale session:', error);
      return;
    }
    throw error;
  } finally {
    // Only the operation that owns the current session may clear the loading
    // state; a stale load must not re-enable Refresh for a newer session
    if (generation === sessionGeneration) {
      isLoadingData = false;
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = !isConnected;
    }
  }
} // End of function loadData()

/**
 * Reloads APs and WLAN groups on demand (Refresh button). A no-op while any
 * exclusive operation (connect/save/apply/load) is pending. On failure the
 * previously loaded data is re-rendered (loadData() leaves the spinners in
 * place when it throws) and an error toast is shown.
 * @returns {Promise<void>}
 */
async function refreshData(): Promise<void> {
  if (!isConnected || isOperationInProgress()) return;

  try {
    await loadData();
  } catch (error) {
    console.error('Error refreshing data:', error);
    showToast(t('loadError'), 'error');
    renderApList();
    renderWlanList();
    updateSelectionInfo();
  }
} // End of function refreshData()

/**
 * Shows a loading spinner in both list panels while data is being fetched.
 */
function showLoadingStates(): void {
  apList.replaceChildren(createLoadingState());
  wlanList.replaceChildren(createLoadingState());
}

/**
 * Shows the initial empty states in both panels: a "configure the connection"
 * hint before any controller URL is stored (so a first-run user who closes
 * the settings modal is not left without guidance), or the usual "connect to
 * see data" messages afterwards.
 */
function showEmptyStates(): void {
  if (!hasStoredConfig) {
    apList.replaceChildren(createEmptyState(t('configureHint')));
    wlanList.replaceChildren(createEmptyState(t('configureHint')));
    return;
  }
  apList.replaceChildren(createEmptyState(t('connectToSeeAPs')));
  wlanList.replaceChildren(createEmptyState(t('connectToSeeWLANs')));
} // End of function showEmptyStates()

// ============================================================================
// Modal Focus Containment
// ============================================================================

/**
 * Collects the keyboard-focusable elements currently inside a modal, in DOM
 * order. Recomputed on every Tab press so disabled/enabled changes (e.g. the
 * Save button while saving) are respected.
 * @param {HTMLElement} modal - The modal overlay element to search.
 * @returns {HTMLElement[]} The focusable elements inside the modal.
 */
function getFocusableElements(modal: HTMLElement): HTMLElement[] {
  const selector = 'button, input, select, textarea, [tabindex]';
  return Array.from(modal.querySelectorAll<HTMLElement>(selector)).filter(
    el => !el.hasAttribute('disabled') && el.tabIndex >= 0
  );
}

/**
 * Creates a keydown handler implementing a Tab focus trap for a modal: Tab on
 * the last focusable element wraps to the first, Shift+Tab on the first wraps
 * to the last, and focus found outside the modal is pulled back in. Install
 * it on document while the modal is open; remove it on close.
 * @param {HTMLElement} modal - The modal overlay element to contain focus in.
 * @returns {(e: KeyboardEvent) => void} The keydown handler to (un)install.
 */
function createFocusTrap(modal: HTMLElement): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const focusable = getFocusableElements(modal);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !modal.contains(active)) {
      // Focus escaped (or never entered): pull it back into the modal
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }; // End of the returned keydown handler
} // End of function createFocusTrap()

/**
 * Syncs the inert state of the background app container with modal
 * visibility: while either modal is open, the background is inert — its
 * controls can be neither Tab-focused nor clicked (Electron 28's Chromium
 * supports the inert attribute natively). This complements the Tab focus
 * trap and the opener-focus restoration. Call after every modal open/close
 * transition; on close, call it BEFORE refocusing the opener (focus cannot
 * enter an inert subtree).
 */
function updateBackgroundInert(): void {
  const anyModalOpen =
    settingsModal.classList.contains('visible') || confirmModal.classList.contains('visible');
  if (anyModalOpen) {
    appContainer.setAttribute('inert', '');
  } else {
    appContainer.removeAttribute('inert');
  }
} // End of function updateBackgroundInert()

// ============================================================================
// Settings Modal
// ============================================================================

// Focus trap for the settings modal (installed on open, removed on close)
// and the element that opened it (focus returns there on close)
const settingsFocusTrap = createFocusTrap(settingsModal);
let settingsOpener: HTMLElement | null = null;
// True from the moment openSettings() starts until the modal is visible (or
// the open fails). Set SYNCHRONOUSLY before the config load await, so a
// concurrent second invocation is a no-op and cannot overwrite the opener
let isSettingsOpening = false;

/**
 * Opens the settings modal populated from the stored config. The password
 * never reaches the renderer: the field is always shown empty, with an
 * "(unchanged)" placeholder when a password is already stored (leaving it
 * blank keeps the stored one, see saveSettings()). The "opening" flag and the
 * opener element are captured synchronously BEFORE the config-load await
 * (see isSettingsOpening above); if that load fails, both are rolled back
 * and an error toast is shown. On success it installs the Tab focus trap and
 * makes the background app container inert.
 * @returns {Promise<void>}
 */
async function openSettings(): Promise<void> {
  if (isSettingsOpening || settingsModal.classList.contains('visible')) return;
  // Reserve the modal and remember the opener before any await: re-entry is
  // now a no-op, and the opener can never be a modal-internal element
  isSettingsOpening = true;
  settingsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  let config: Awaited<ReturnType<typeof window.omadaAPI.loadConfig>>;
  try {
    config = await window.omadaAPI.loadConfig();
  } catch (error) {
    // Roll back the reservation: the modal never opened
    console.error('Error loading configuration for the settings modal:', error);
    isSettingsOpening = false;
    settingsOpener = null;
    showToast(t('configLoadError'), 'error');
    return;
  }

  urlInput.value = config.url;
  usernameInput.value = config.username;
  passwordInput.value = '';
  passwordInput.placeholder = config.hasPassword ? t('passwordUnchanged') : '';
  languageSelect.value = config.language || 'es';
  document.addEventListener('keydown', settingsFocusTrap);
  settingsModal.classList.add('visible');
  updateBackgroundInert();
  isSettingsOpening = false;
  urlInput.focus();
} // End of function openSettings()

/**
 * Closes the settings modal (a no-op when it is not open), removes its Tab
 * focus trap, lifts the background inertness, and restores keyboard focus to
 * the element that opened it (in that order: focus cannot enter an inert
 * subtree). Covers every close path: the close/cancel buttons, the overlay
 * click, the Escape key, and the post-save close.
 */
function closeSettings(): void {
  if (!settingsModal.classList.contains('visible')) return;
  settingsModal.classList.remove('visible');
  document.removeEventListener('keydown', settingsFocusTrap);
  updateBackgroundInert();
  settingsOpener?.focus();
  settingsOpener = null;
} // End of function closeSettings()

/**
 * Validates and normalizes the controller URL. Mirrors the main-process rules
 * (normalizeControllerUrl() in src/main/config.ts — keep both in sync): it
 * must parse, use HTTPS, and carry no embedded credentials or fragment; a
 * trailing slash is stripped.
 * @param {string} raw - The URL as typed by the user.
 * @returns {string | null} The normalized URL, or null when invalid.
 */
function validateControllerUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  if (parsed.username || parsed.password || parsed.hash) {
    return null;
  }
  let normalized = parsed.toString();
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
} // End of function validateControllerUrl()

/**
 * Validates the settings form and saves the configuration. The password is
 * sent to the main process ONLY when the user typed one: a blank field keeps
 * the previously stored (encrypted) password, and is a validation error when
 * no password is stored yet (the main process enforces both rules too). The
 * URL is validated/normalized here and again in the main process. A no-op
 * while any exclusive operation is pending (including a previous save still
 * in flight — e.g. Enter-key repeat); the Save button is disabled while
 * saving so it cannot double-submit.
 * @returns {Promise<void>}
 */
async function saveSettings(): Promise<void> {
  if (isOperationInProgress()) return;
  isSavingSettings = true;
  saveSettingsBtn.disabled = true;
  // Session generation at save start: if a disconnect or another operation
  // supersedes the session while the save is awaiting, the auto-connect
  // below must not start
  const generation = sessionGeneration;
  // Set when the save succeeds: the auto-connect starts AFTER the in-flight
  // flag is released (connect() is itself guarded by isOperationInProgress())
  let connectAfterSave = false;

  try {
    const url = urlInput.value.trim();
    const username = usernameInput.value.trim();
    const typedPassword = passwordInput.value;

    if (!url || !username) {
      showToast(t('fillUrlAndUser'), 'error');
      return;
    }

    const normalizedUrl = validateControllerUrl(url);
    if (!normalizedUrl) {
      showToast(t('invalidUrl'), 'error');
      return;
    }

    if (!typedPassword) {
      const existingConfig = await window.omadaAPI.loadConfig();
      if (!existingConfig.hasPassword) {
        // Blank field and nothing stored: refuse to save an unusable config
        showToast(t('passwordRequired'), 'error');
        return;
      }
      // Blank field while editing: the main process keeps the stored password
    }

    const payload: { url: string; username: string; language: Language; password?: string } = {
      url: normalizedUrl,
      username,
      language: languageSelect.value as Language
    };
    // Send the password only when the user typed a new one
    if (typedPassword) {
      payload.password = typedPassword;
    }

    const result = await window.omadaAPI.saveConfig(payload);

    if (result.success) {
      // A usable configuration now exists: the empty states can suggest
      // connecting instead of configuring
      hasStoredConfig = true;

      // Apply language change
      setLanguage(payload.language);
      applyTranslations();

      closeSettings();
      connectAfterSave = true;
    } else if (result.error === 'invalidUrl') {
      showToast(t('invalidUrl'), 'error');
    } else if (result.error === 'passwordRequired') {
      showToast(t('passwordRequired'), 'error');
    } else {
      showToast(t('saveError'), 'error');
    }
  } finally {
    isSavingSettings = false;
    saveSettingsBtn.disabled = false;
  }

  // Auto-connect only when the save's session is still current and nothing
  // else is in flight: a save that completes after a disconnect (or after a
  // newer operation started) must not start a connection
  if (connectAfterSave && generation === sessionGeneration && !isOperationInProgress()) {
    // Auto-connect after saving (the main process reads its own stored
    // password; nothing credential-related comes from the renderer)
    connect();
  }
} // End of function saveSettings()

// ============================================================================
// Confirm Modal
// ============================================================================

/**
 * Shows the confirm modal with the given message and resolves with the user's
 * choice. Confirm, Cancel, and Escape all route through a single finish()
 * function that hides the modal, removes every listener (including the Escape
 * and focus-trap ones), restores focus to the opener, and resolves exactly
 * once — so no stale listeners or pending promises can leak.
 * @param {string} message - The question to display in the modal.
 * @returns {Promise<boolean>} True if the user confirmed, false otherwise.
 */
function showConfirm(message: string): Promise<boolean> {
  return new Promise(resolve => {
    confirmMessage.textContent = message;
    // Remember the opener (usually the Apply button) to restore focus later,
    // and build the Tab focus trap that keeps focus inside the modal
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTrap = createFocusTrap(confirmModal);
    confirmModal.classList.add('visible');
    updateBackgroundInert();

    let finished = false;

    /**
     * Hides the modal, removes all listeners, lifts the background
     * inertness, restores focus to the opener, and resolves exactly once.
     * @param {boolean} result - The value to resolve the promise with.
     */
    const finish = (result: boolean): void => {
      if (finished) return;
      finished = true;
      confirmModal.classList.remove('visible');
      confirmConfirmBtn.removeEventListener('click', handleConfirm);
      cancelConfirmBtn.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', focusTrap);
      // Lift the background inertness BEFORE refocusing the opener (focus
      // cannot enter an inert subtree), then return keyboard focus to the
      // control that opened the modal
      updateBackgroundInert();
      opener?.focus();
      resolve(result);
    }; // End of function finish()

    /** Confirm button handler: finishes with true. */
    const handleConfirm = (): void => finish(true);

    /** Cancel button handler: finishes with false. */
    const handleCancel = (): void => finish(false);

    /**
     * Escape key handler: routes through the cancel path.
     * @param {KeyboardEvent} e - The keydown event.
     */
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') handleCancel();
    };

    confirmConfirmBtn.addEventListener('click', handleConfirm);
    cancelConfirmBtn.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', focusTrap);

    // Move keyboard focus into the modal (Enter confirms, Escape cancels)
    confirmConfirmBtn.focus();
  });
} // End of function showConfirm()

// ============================================================================
// Apply Change
// ============================================================================

/**
 * Applies the selected WLAN group to the selected AP after user confirmation.
 * The identifiers are format-checked before crossing the IPC boundary (the
 * main process re-validates them too). A no-op while any exclusive operation
 * is pending; if the session changes while the change is in flight (e.g. the
 * user disconnects), the result is discarded without touching the UI.
 * @returns {Promise<void>}
 */
async function applyChange(): Promise<void> {
  if (!selectedAp || !selectedWlan) return;
  if (isOperationInProgress()) return;

  // Belt-and-braces: loadData() already filtered malformed ids, but never
  // send an invalid MAC or WLAN id over IPC
  if (!isValidMac(selectedAp.mac) || !isValidWlanId(selectedWlan.wlanId)) {
    console.error('Refusing to apply change: invalid MAC or WLAN id format');
    showToast(t('changeError'), 'error');
    return;
  }

  isApplyingChange = true;
  const generation = sessionGeneration;

  try {
    const confirmed = await showConfirm(
      tFormat('confirmAssign', { wlan: selectedWlan.wlanName, ap: selectedAp.name })
    );

    if (!confirmed) return;

    applyBtn.disabled = true;
    applyBtn.textContent = t('applying');

    const success = await window.omadaAPI.setApWlanGroup(selectedAp.mac, selectedWlan.wlanId);

    // Stale result (disconnected while awaiting): leave the UI alone
    if (generation !== sessionGeneration) return;

    if (success) {
      showToast(t('changeApplied'), 'success');
      // Reload data to reflect changes. A failed reload is a load error,
      // not a failed change — report it as such and keep the old lists
      try {
        await loadData();
      } catch (loadError) {
        console.error('Error reloading data after applying change:', loadError);
        showToast(t('loadError'), 'error');
        renderApList();
        renderWlanList();
        updateSelectionInfo();
      }
    } else {
      showToast(t('changeError'), 'error');
    }
  } catch (error) {
    console.error('Error applying change:', error);
    // A stale failure must not surface in the disconnected/new UI
    if (generation === sessionGeneration) {
      showToast(t('changeError'), 'error');
    }
  } finally {
    isApplyingChange = false;
    applyBtn.textContent = t('apply');
    // Recomputes applyBtn.disabled from the current selection
    updateSelectionInfo();
  }
} // End of function applyChange()

// ============================================================================
// Event Listeners
// ============================================================================

connectBtn.addEventListener('click', toggleConnection);
refreshBtn.addEventListener('click', refreshData);
settingsBtn.addEventListener('click', openSettings);

// Filter inputs
apFilterInput.addEventListener('input', () => {
  apFilterText = apFilterInput.value;
  renderApList();
});

wlanFilterInput.addEventListener('input', () => {
  wlanFilterText = wlanFilterInput.value;
  renderWlanList();
});

closeSettingsBtn.addEventListener('click', closeSettings);
cancelSettingsBtn.addEventListener('click', closeSettings);
saveSettingsBtn.addEventListener('click', saveSettings);
applyBtn.addEventListener('click', applyChange);

// Close modal on overlay click
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

// Close the settings modal on Escape key. The confirm modal is NOT handled
// here: showConfirm() installs its own Escape listener that routes through
// its cancel path, so the pending promise is always resolved.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSettings();
  }
});

// Enter submits the settings form from any of its text fields (not only the
// password one)
for (const settingsField of [urlInput, usernameInput, passwordInput]) {
  settingsField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveSettings();
  });
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Tags <body> with a platform class (e.g. "platform-darwin") so the
 * stylesheet can scope platform-specific rules — currently the macOS
 * traffic-light padding in the title bar. Runs synchronously at script
 * start, before first paint.
 */
function applyPlatformClass(): void {
  document.body.classList.add(`platform-${window.omadaAPI.platform}`);
}

/**
 * Initializes the app: loads the stored config, applies the language (all
 * user-facing text lives in the i18n tables — index.html ships without text,
 * so no wrong-language flash), reveals the UI (the pre-init class in
 * index.html keeps it hidden until every visible string is populated), and
 * either opens settings (first run) or auto-connects. If loading the config
 * fails, the UI is still revealed with default-language texts plus an error
 * toast — never left as a hidden/blank shell.
 * @returns {Promise<void>}
 */
async function init(): Promise<void> {
  let config: Awaited<ReturnType<typeof window.omadaAPI.loadConfig>> | null = null;
  try {
    config = await window.omadaAPI.loadConfig();
  } catch (error) {
    console.error('Error loading configuration during init:', error);
  }

  // Before any config exists, the empty states show a "configure the
  // connection" hint (see showEmptyStates())
  hasStoredConfig = Boolean(config?.url);

  // Set language from config (default when the config could not be loaded)
  setLanguage(config?.language || 'es');
  applyTranslations();
  setStatus('disconnected');

  // Every visible string is populated now: reveal the UI (see the pre-init
  // rule in styles.css — the CSP forbids doing this with inline styles)
  document.body.classList.remove('pre-init');

  if (!config) {
    // Config unreadable: leave the usable default UI up and report the error
    showToast(t('configLoadError'), 'error');
    return;
  }

  // If no config, open settings
  if (!config.url) {
    openSettings();
  } else {
    // Auto-connect on startup
    connect();
  }
} // End of function init()

// Start the app
applyPlatformClass();
init().catch((error) => {
  // Last-resort guard: whatever happens, never leave the UI hidden behind
  // the pre-init class
  console.error('Initialization failed:', error);
  document.body.classList.remove('pre-init');
});
