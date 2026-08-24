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
  },
};

let currentLanguage: Language = 'es';

function setLanguage(lang: Language): void {
  if (translations[lang]) {
    currentLanguage = lang;
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

// DOM Elements
const statusIndicator = document.getElementById('statusIndicator') as HTMLElement;
const statusText = document.getElementById('statusText') as HTMLElement;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
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

  // Filter placeholders
  apFilterInput.placeholder = t('filter');
  wlanFilterInput.placeholder = t('filter');

  // Settings button title
  settingsBtn.title = t('settings');

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
} // End of function setStatus()

// ============================================================================
// List Rendering
// ============================================================================

function renderApList() {
  const filteredAps = accessPoints.filter(ap =>
    ap.name.toLowerCase().includes(apFilterText.toLowerCase()) ||
    (ap.wlanGroup && ap.wlanGroup.toLowerCase().includes(apFilterText.toLowerCase()))
  );

  if (accessPoints.length === 0) {
    apList.innerHTML = `
      <div class="empty-state">
        <p>${t('noAccessPoints')}</p>
      </div>
    `;
    return;
  }

  if (filteredAps.length === 0) {
    apList.innerHTML = `
      <div class="empty-state">
        <p>${t('noResultsFor')} "${escapeHtml(apFilterText)}"</p>
      </div>
    `;
    return;
  }

  apList.innerHTML = filteredAps.map(ap => {
    const isOnline = ap.statusCategory === 1 || ap.statusCategory === 2;
    const isSelected = selectedAp?.mac === ap.mac;
    const wlanDisplay = ap.wlanGroup || t('unassigned');

    return `
      <div class="list-item ${isSelected ? 'selected' : ''}" data-mac="${ap.mac}">
        <div class="item-radio"></div>
        <div class="item-content">
          <div class="item-header">
            <span class="item-status ${isOnline ? 'online' : 'offline'}">${isOnline ? '●' : '●'}</span>
            <span class="item-name">${escapeHtml(ap.name)}</span>
          </div>
          <div class="item-subtitle">${t('wlanLabel')}: ${escapeHtml(wlanDisplay)}</div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  apList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => {
      const mac = item.getAttribute('data-mac');
      const ap = accessPoints.find(a => a.mac === mac);
      if (ap) {
        // Toggle selection: unselect if already selected
        selectedAp = selectedAp?.mac === ap.mac ? null : ap;
        renderApList();
        updateSelectionInfo();
      }
    });
  });
}

function renderWlanList() {
  const filteredWlans = wlanGroups.filter(wlan =>
    wlan.wlanName.toLowerCase().includes(wlanFilterText.toLowerCase()) ||
    wlan.ssidList.some(s => s.ssidName.toLowerCase().includes(wlanFilterText.toLowerCase()))
  );

  if (wlanGroups.length === 0) {
    wlanList.innerHTML = `
      <div class="empty-state">
        <p>${t('noWlanGroups')}</p>
      </div>
    `;
    return;
  }

  if (filteredWlans.length === 0) {
    wlanList.innerHTML = `
      <div class="empty-state">
        <p>${t('noResultsFor')} "${escapeHtml(wlanFilterText)}"</p>
      </div>
    `;
    return;
  }

  wlanList.innerHTML = filteredWlans.map(wlan => {
    const isSelected = selectedWlan?.wlanId === wlan.wlanId;
    const ssids = wlan.ssidList.map(s => s.ssidName);
    const ssidPreview = ssids.length > 3
      ? `${ssids.slice(0, 3).join(', ')} +${ssids.length - 3} ${t('more')}`
      : ssids.join(', ');

    return `
      <div class="list-item ${isSelected ? 'selected' : ''}" data-wlan-id="${wlan.wlanId}">
        <div class="item-radio"></div>
        <div class="item-content">
          <div class="item-header">
            <span class="item-name">${escapeHtml(wlan.wlanName)}</span>
          </div>
          <div class="item-subtitle">${escapeHtml(ssidPreview) || t('noSsids')}</div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  wlanList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => {
      const wlanId = item.getAttribute('data-wlan-id');
      const wlan = wlanGroups.find(w => w.wlanId === wlanId);
      if (wlan) {
        // Toggle selection: unselect if already selected
        selectedWlan = selectedWlan?.wlanId === wlan.wlanId ? null : wlan;
        renderWlanList();
        updateSelectionInfo();
      }
    });
  });
}

function updateSelectionInfo() {
  if (selectedAp && selectedWlan) {
    selectionInfo.innerHTML = `
      <div class="selection-detail">
        <span class="ap-name">${escapeHtml(selectedAp.name)}</span>
        <span class="arrow">→</span>
        <span class="wlan-name">${escapeHtml(selectedWlan.wlanName)}</span>
      </div>
    `;
    applyBtn.disabled = false;
  } else if (selectedAp) {
    selectionInfo.innerHTML = `
      <div class="selection-detail">
        <span class="ap-name">${escapeHtml(selectedAp.name)}</span>
        <span class="arrow">→</span>
        <span style="color: var(--text-muted)">${t('selectWlan')}</span>
      </div>
    `;
    applyBtn.disabled = true;
  } else if (selectedWlan) {
    selectionInfo.innerHTML = `
      <div class="selection-detail">
        <span style="color: var(--text-muted)">${t('selectAp')}</span>
        <span class="arrow">→</span>
        <span class="wlan-name">${escapeHtml(selectedWlan.wlanName)}</span>
      </div>
    `;
    applyBtn.disabled = true;
  } else {
    selectionInfo.innerHTML = `<span class="selection-placeholder">${t('selectApAndWlan')}</span>`;
    applyBtn.disabled = true;
  }
}

// ============================================================================
// Connection
// ============================================================================

/**
 * Connects to the Omada controller and loads its data. If any step fails
 * (including loadData(), which is allowed to throw), the whole UI state is
 * reset consistently and the main-process controller is released.
 * @returns {Promise<void>}
 */
async function connect(): Promise<void> {
  setStatus('connecting');
  connectBtn.disabled = true;
  connectBtn.textContent = t('connecting');

  try {
    const result = await window.omadaAPI.connect();

    if (result.success) {
      const config = await window.omadaAPI.loadConfig();
      setStatus('connected', config.url);
      connectBtn.textContent = t('disconnect');
      await loadData();
    } else {
      setStatus('error', result.error);
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
    connectBtn.disabled = false;
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
 * IPC and always clears the UI state, even if the IPC call fails.
 * @returns {Promise<void>}
 */
async function disconnect(): Promise<void> {
  try {
    await window.omadaAPI.disconnect();
  } catch (error) {
    console.error('Error disconnecting:', error);
  } finally {
    isConnected = false;
    setStatus('disconnected');
    connectBtn.textContent = t('connect');
    clearData();
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
 * Errors are intentionally not caught here: the caller handles failures so
 * the whole UI state is reset consistently (see connect()).
 * @returns {Promise<void>}
 */
async function loadData(): Promise<void> {
  const [aps, wlans] = await Promise.all([
    window.omadaAPI.getAccessPoints(),
    window.omadaAPI.getWlanGroups()
  ]);

  accessPoints = aps;
  wlanGroups = wlans;

  // Reset selection
  selectedAp = null;
  selectedWlan = null;

  renderApList();
  renderWlanList();
  updateSelectionInfo();
} // End of function loadData()

function showEmptyStates() {
  apList.innerHTML = `
    <div class="empty-state">
      <p>${t('connectToSeeAPs')}</p>
    </div>
  `;
  wlanList.innerHTML = `
    <div class="empty-state">
      <p>${t('connectToSeeWLANs')}</p>
    </div>
  `;
}

// ============================================================================
// Settings Modal
// ============================================================================

/**
 * Opens the settings modal populated from the stored config. The password
 * never reaches the renderer: the field is always shown empty, with an
 * "(unchanged)" placeholder when a password is already stored (leaving it
 * blank keeps the stored one, see saveSettings()).
 * @returns {Promise<void>}
 */
async function openSettings(): Promise<void> {
  const config = await window.omadaAPI.loadConfig();
  urlInput.value = config.url;
  usernameInput.value = config.username;
  passwordInput.value = '';
  passwordInput.placeholder = config.hasPassword ? t('passwordUnchanged') : '';
  languageSelect.value = config.language || 'es';
  settingsModal.classList.add('visible');
  urlInput.focus();
} // End of function openSettings()

function closeSettings() {
  settingsModal.classList.remove('visible');
}

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
 * URL is validated/normalized here and again in the main process.
 * @returns {Promise<void>}
 */
async function saveSettings(): Promise<void> {
  const url = urlInput.value.trim();
  const username = usernameInput.value.trim();
  const typedPassword = passwordInput.value;

  if (!url || !username) {
    alert(t('fillUrlAndUser'));
    return;
  }

  const normalizedUrl = validateControllerUrl(url);
  if (!normalizedUrl) {
    alert(t('invalidUrl'));
    return;
  }

  if (!typedPassword) {
    const existingConfig = await window.omadaAPI.loadConfig();
    if (!existingConfig.hasPassword) {
      // Blank field and nothing stored: refuse to save an unusable config
      alert(t('passwordRequired'));
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
    // Apply language change
    setLanguage(payload.language);
    applyTranslations();

    closeSettings();
    // Auto-connect after saving (the main process reads its own stored
    // password; nothing credential-related comes from the renderer)
    connect();
  } else if (result.error === 'invalidUrl') {
    alert(t('invalidUrl'));
  } else if (result.error === 'passwordRequired') {
    alert(t('passwordRequired'));
  } else {
    alert(t('saveError'));
  }
} // End of function saveSettings()

// ============================================================================
// Confirm Modal
// ============================================================================

/**
 * Shows the confirm modal with the given message and resolves with the user's
 * choice. Confirm, Cancel, and Escape all route through a single finish()
 * function that hides the modal, removes every listener (including the Escape
 * one), and resolves exactly once — so no stale listeners or pending promises
 * can leak.
 * @param {string} message - The question to display in the modal.
 * @returns {Promise<boolean>} True if the user confirmed, false otherwise.
 */
function showConfirm(message: string): Promise<boolean> {
  return new Promise(resolve => {
    confirmMessage.textContent = message;
    confirmModal.classList.add('visible');

    let finished = false;

    /**
     * Hides the modal, removes all listeners, and resolves exactly once.
     * @param {boolean} result - The value to resolve the promise with.
     */
    const finish = (result: boolean): void => {
      if (finished) return;
      finished = true;
      confirmModal.classList.remove('visible');
      confirmConfirmBtn.removeEventListener('click', handleConfirm);
      cancelConfirmBtn.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleEscape);
      resolve(result);
    };

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
  });
} // End of function showConfirm()

// ============================================================================
// Apply Change
// ============================================================================

async function applyChange() {
  if (!selectedAp || !selectedWlan) return;

  const confirmed = await showConfirm(
    tFormat('confirmAssign', { wlan: selectedWlan.wlanName, ap: selectedAp.name })
  );

  if (!confirmed) return;

  applyBtn.disabled = true;
  applyBtn.textContent = t('applying');

  try {
    const success = await window.omadaAPI.setApWlanGroup(selectedAp.mac, selectedWlan.wlanId);

    if (success) {
      alert(t('changeApplied'));
      // Reload data to reflect changes
      await loadData();
    } else {
      alert(t('changeError'));
    }
  } catch (error) {
    console.error('Error applying change:', error);
    alert(t('changeError'));
  } finally {
    applyBtn.disabled = false;
    applyBtn.textContent = t('apply');
    updateSelectionInfo();
  }
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// Event Listeners
// ============================================================================

connectBtn.addEventListener('click', toggleConnection);
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

// Enter key in settings form
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveSettings();
});

// ============================================================================
// Initialization
// ============================================================================

async function init() {
  const config = await window.omadaAPI.loadConfig();

  // Set language from config
  setLanguage(config.language || 'es');
  applyTranslations();

  // If no config, open settings
  if (!config.url) {
    openSettings();
  } else {
    // Auto-connect on startup
    connect();
  }
}

// Start the app
init();
