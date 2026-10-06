// Renderer process - entry module. esbuild bundles it, together with every
// module it imports, into one IIFE script (dist/renderer/renderer.js, loaded by
// index.html; see scripts/build-renderer.mjs). This file only wires the static
// UI's event listeners and runs the startup sequence; the logic lives in:
//   state.ts              mutable state, operation flags, session generation
//   elements.ts           DOM element references
//   i18n.ts               es/en string tables, t(), tFormat(), setLanguage()
//   apply-translations.ts writes the active language into the static UI
//   status.ts             title-bar connection status
//   toast.ts              toast notifications
//   validation.ts         format guards (MAC, WLAN/site id, fingerprint),
//                         controller-URL mirror of src/main/url.ts
//   dom-helpers.ts        empty/loading blocks, listbox roving tabindex
//   panels.ts             panel empty/loading states, selection info bar
//   ap-list.ts            access-point list panel
//   wlan-list.ts          WLAN group list panel
//   modal-focus.ts        modal Tab focus trap and inert background
//   settings-modal.ts     settings modal (open/close/save, certificate reset)
//   confirm-modal.ts      confirm modal
//   site-modal.ts         site-selection modal (multi-site controllers)
//   cert-modal.ts         certificate first-use / "certificate changed" modal
//   connection.ts         connect/disconnect, site selection, certificate
//                         trust, load/refresh
//   apply-change.ts       assign a WLAN group to an AP
// Shared types come from src/shared/types.ts (type-only imports), and the
// window.omadaAPI bridge typing from global.d.ts.

import { renderApList } from './ap-list';
import { applyChange } from './apply-change';
import { applyTranslations } from './apply-translations';
import { connect, refreshData, toggleConnection } from './connection';
import {
  apFilterInput,
  applyBtn,
  cancelCertResetBtn,
  cancelSettingsBtn,
  closeSettingsBtn,
  confirmCertResetBtn,
  connectBtn,
  passwordInput,
  refreshBtn,
  resetCertBtn,
  saveSettingsBtn,
  settingsBtn,
  settingsModal,
  urlInput,
  usernameInput,
  wlanFilterInput,
} from './elements';
import { setLanguage, t } from './i18n';
import {
  cancelCertificateReset,
  closeSettings,
  confirmCertificateReset,
  openSettings,
  requestCertificateReset,
  saveSettings,
  updatePasswordAffordance,
} from './settings-modal';
import { state } from './state';
import { setStatus } from './status';
import { showToast } from './toast';
import { renderWlanList } from './wlan-list';

// ============================================================================
// Event Listeners
// ============================================================================

connectBtn.addEventListener('click', toggleConnection);
refreshBtn.addEventListener('click', refreshData);
settingsBtn.addEventListener('click', openSettings);

// Filter inputs
apFilterInput.addEventListener('input', () => {
  state.apFilterText = apFilterInput.value;
  renderApList();
});

wlanFilterInput.addEventListener('input', () => {
  state.wlanFilterText = wlanFilterInput.value;
  renderWlanList();
});

closeSettingsBtn.addEventListener('click', closeSettings);
cancelSettingsBtn.addEventListener('click', closeSettings);
saveSettingsBtn.addEventListener('click', saveSettings);
applyBtn.addEventListener('click', applyChange);

// Credentials are URL-scoped: editing the URL updates what a blank password
// field means ("unchanged" vs "required for the new URL")
urlInput.addEventListener('input', updatePasswordAffordance);

// Trusted certificate (Settings): reset with an inline confirmation
resetCertBtn.addEventListener('click', requestCertificateReset);
cancelCertResetBtn.addEventListener('click', cancelCertificateReset);
confirmCertResetBtn.addEventListener('click', confirmCertificateReset);

// Close modal on overlay click
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

// Close the settings modal on Escape key. The confirm, site-selection and
// certificate modals are NOT handled here: each installs its own Escape
// listener that routes through its cancel path, so its pending promise is
// always resolved (and they never open on top of the settings modal).
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
  state.hasStoredConfig = Boolean(config?.url);

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
