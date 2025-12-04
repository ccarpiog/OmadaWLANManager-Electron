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
let currentServerUrl = '';

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
    case 'connected':
      statusIndicator.classList.add('connected');
      // Show server URL (extract hostname from URL)
      const serverDisplay = message ? new URL(message).host : t('connected');
      statusText.textContent = serverDisplay;
      currentServerUrl = message || '';
      isConnected = true;
      break;
    case 'error':
      statusIndicator.classList.add('error');
      statusText.textContent = message || t('error');
      isConnected = false;
      break;
  }
}

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

async function connect() {
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
      showEmptyStates();
    }
  } catch (error) {
    setStatus('error', t('connectionError'));
    connectBtn.textContent = t('connect');
    showEmptyStates();
  } finally {
    connectBtn.disabled = false;
  }
}

function disconnect() {
  isConnected = false;
  setStatus('disconnected');
  connectBtn.textContent = t('connect');

  // Clear data
  accessPoints = [];
  wlanGroups = [];
  selectedAp = null;
  selectedWlan = null;
  apFilterText = '';
  wlanFilterText = '';
  apFilterInput.value = '';
  wlanFilterInput.value = '';
  currentServerUrl = '';

  showEmptyStates();
  updateSelectionInfo();
}

function toggleConnection() {
  if (isConnected) {
    disconnect();
  } else {
    connect();
  }
}

async function loadData() {
  try {
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
  } catch (error) {
    console.error('Error loading data:', error);
    setStatus('error', t('connectionError'));
  }
}

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

async function openSettings() {
  const config = await window.omadaAPI.loadConfig();
  urlInput.value = config.url;
  usernameInput.value = config.username;
  passwordInput.value = config.password;
  languageSelect.value = config.language || 'es';
  settingsModal.classList.add('visible');
  urlInput.focus();
}

function closeSettings() {
  settingsModal.classList.remove('visible');
}

async function saveSettings() {
  const config = {
    url: urlInput.value.trim(),
    username: usernameInput.value.trim(),
    password: passwordInput.value,
    language: languageSelect.value as Language
  };

  if (!config.url || !config.username) {
    alert(t('fillUrlAndUser'));
    return;
  }

  const saved = await window.omadaAPI.saveConfig(config);

  if (saved) {
    // Apply language change
    setLanguage(config.language);
    applyTranslations();

    closeSettings();
    // Auto-connect after saving
    connect();
  } else {
    alert(t('saveError'));
  }
}

// ============================================================================
// Confirm Modal
// ============================================================================

function showConfirm(message: string): Promise<boolean> {
  return new Promise(resolve => {
    confirmMessage.textContent = message;
    confirmModal.classList.add('visible');

    const handleConfirm = () => {
      confirmModal.classList.remove('visible');
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      confirmModal.classList.remove('visible');
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      confirmConfirmBtn.removeEventListener('click', handleConfirm);
      cancelConfirmBtn.removeEventListener('click', handleCancel);
    };

    confirmConfirmBtn.addEventListener('click', handleConfirm);
    cancelConfirmBtn.addEventListener('click', handleCancel);
  });
}

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

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSettings();
    confirmModal.classList.remove('visible');
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
