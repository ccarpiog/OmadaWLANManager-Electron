// Renderer process - UI logic
// Types are available via preload script's global declaration

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

// Settings Modal
const settingsModal = document.getElementById('settingsModal') as HTMLElement;
const closeSettingsBtn = document.getElementById('closeSettingsBtn') as HTMLButtonElement;
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn') as HTMLButtonElement;
const saveSettingsBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement;
const urlInput = document.getElementById('urlInput') as HTMLInputElement;
const usernameInput = document.getElementById('usernameInput') as HTMLInputElement;
const passwordInput = document.getElementById('passwordInput') as HTMLInputElement;

// Confirm Modal
const confirmModal = document.getElementById('confirmModal') as HTMLElement;
const confirmMessage = document.getElementById('confirmMessage') as HTMLElement;
const cancelConfirmBtn = document.getElementById('cancelConfirmBtn') as HTMLButtonElement;
const confirmConfirmBtn = document.getElementById('confirmConfirmBtn') as HTMLButtonElement;

// ============================================================================
// Status Management
// ============================================================================

function setStatus(status: 'disconnected' | 'connecting' | 'connected' | 'error', message?: string) {
  statusIndicator.className = 'status-indicator';

  switch (status) {
    case 'disconnected':
      statusText.textContent = 'Desconectado';
      isConnected = false;
      break;
    case 'connecting':
      statusIndicator.classList.add('connecting');
      statusText.textContent = 'Conectando...';
      break;
    case 'connected':
      statusIndicator.classList.add('connected');
      // Show server URL (extract hostname from URL)
      const serverDisplay = message ? new URL(message).host : 'Conectado';
      statusText.textContent = serverDisplay;
      isConnected = true;
      break;
    case 'error':
      statusIndicator.classList.add('error');
      statusText.textContent = message || 'Error';
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
        <p>No hay access points disponibles</p>
      </div>
    `;
    return;
  }

  if (filteredAps.length === 0) {
    apList.innerHTML = `
      <div class="empty-state">
        <p>No hay resultados para "${escapeHtml(apFilterText)}"</p>
      </div>
    `;
    return;
  }

  apList.innerHTML = filteredAps.map(ap => {
    const isOnline = ap.statusCategory === 1 || ap.statusCategory === 2;
    const isSelected = selectedAp?.mac === ap.mac;

    return `
      <div class="list-item ${isSelected ? 'selected' : ''}" data-mac="${ap.mac}">
        <div class="item-radio"></div>
        <div class="item-content">
          <div class="item-header">
            <span class="item-status ${isOnline ? 'online' : 'offline'}">${isOnline ? '●' : '●'}</span>
            <span class="item-name">${escapeHtml(ap.name)}</span>
          </div>
          <div class="item-subtitle">WLAN: ${escapeHtml(ap.wlanGroup || 'Sin asignar')}</div>
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
        <p>No hay grupos WLAN disponibles</p>
      </div>
    `;
    return;
  }

  if (filteredWlans.length === 0) {
    wlanList.innerHTML = `
      <div class="empty-state">
        <p>No hay resultados para "${escapeHtml(wlanFilterText)}"</p>
      </div>
    `;
    return;
  }

  wlanList.innerHTML = filteredWlans.map(wlan => {
    const isSelected = selectedWlan?.wlanId === wlan.wlanId;
    const ssids = wlan.ssidList.map(s => s.ssidName);
    const ssidPreview = ssids.length > 3
      ? `${ssids.slice(0, 3).join(', ')} +${ssids.length - 3} más`
      : ssids.join(', ');

    return `
      <div class="list-item ${isSelected ? 'selected' : ''}" data-wlan-id="${wlan.wlanId}">
        <div class="item-radio"></div>
        <div class="item-content">
          <div class="item-header">
            <span class="item-name">${escapeHtml(wlan.wlanName)}</span>
          </div>
          <div class="item-subtitle">${escapeHtml(ssidPreview) || 'Sin SSIDs'}</div>
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
        <span style="color: var(--text-muted)">Selecciona un grupo WLAN</span>
      </div>
    `;
    applyBtn.disabled = true;
  } else if (selectedWlan) {
    selectionInfo.innerHTML = `
      <div class="selection-detail">
        <span style="color: var(--text-muted)">Selecciona un AP</span>
        <span class="arrow">→</span>
        <span class="wlan-name">${escapeHtml(selectedWlan.wlanName)}</span>
      </div>
    `;
    applyBtn.disabled = true;
  } else {
    selectionInfo.innerHTML = `<span class="selection-placeholder">Selecciona un AP y un grupo WLAN</span>`;
    applyBtn.disabled = true;
  }
}

// ============================================================================
// Connection
// ============================================================================

async function connect() {
  setStatus('connecting');
  connectBtn.disabled = true;
  connectBtn.textContent = 'Conectando...';

  try {
    const result = await window.omadaAPI.connect();

    if (result.success) {
      const config = await window.omadaAPI.loadConfig();
      setStatus('connected', config.url);
      connectBtn.textContent = 'Desconectar';
      await loadData();
    } else {
      setStatus('error', result.error);
      connectBtn.textContent = 'Conectar';
      showEmptyStates();
    }
  } catch (error) {
    setStatus('error', 'Error de conexión');
    connectBtn.textContent = 'Conectar';
    showEmptyStates();
  } finally {
    connectBtn.disabled = false;
  }
}

function disconnect() {
  isConnected = false;
  setStatus('disconnected');
  connectBtn.textContent = 'Conectar';

  // Clear data
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
    setStatus('error', 'Error al cargar datos');
  }
}

function showEmptyStates() {
  apList.innerHTML = `
    <div class="empty-state">
      <p>Conecta al controlador para ver los access points</p>
    </div>
  `;
  wlanList.innerHTML = `
    <div class="empty-state">
      <p>Conecta al controlador para ver los grupos WLAN</p>
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
    password: passwordInput.value
  };

  if (!config.url || !config.username) {
    alert('Por favor, completa la URL y el usuario');
    return;
  }

  const saved = await window.omadaAPI.saveConfig(config);

  if (saved) {
    closeSettings();
    // Auto-connect after saving
    connect();
  } else {
    alert('Error al guardar la configuración');
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
    `¿Asignar "${selectedWlan.wlanName}" al AP "${selectedAp.name}"?`
  );

  if (!confirmed) return;

  applyBtn.disabled = true;
  applyBtn.textContent = 'Aplicando...';

  try {
    const success = await window.omadaAPI.setApWlanGroup(selectedAp.mac, selectedWlan.wlanId);

    if (success) {
      alert('Cambio aplicado correctamente');
      // Reload data to reflect changes
      await loadData();
    } else {
      alert('Error al aplicar el cambio');
    }
  } catch (error) {
    console.error('Error applying change:', error);
    alert('Error al aplicar el cambio');
  } finally {
    applyBtn.disabled = false;
    applyBtn.textContent = 'Aplicar cambio';
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
