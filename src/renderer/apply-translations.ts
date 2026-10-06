// ============================================================================
// Internationalization: applies the active language's strings to the static
// UI (index.html ships without text) and re-renders the dynamic content.
// ============================================================================

import {
  apFilterInput,
  apList,
  apPanelTitle,
  applyBtn,
  cancelCertBtn,
  cancelCertResetBtn,
  cancelConfirmBtn,
  cancelSettingsBtn,
  cancelSiteBtn,
  certModalTitle,
  closeSettingsBtn,
  confirmCertBtn,
  confirmCertResetBtn,
  confirmConfirmBtn,
  confirmModalTitle,
  connectBtn,
  labelCertPin,
  labelLanguage,
  labelPassword,
  labelUrl,
  labelUsername,
  refreshBtn,
  resetCertBtn,
  saveSettingsBtn,
  settingsBtn,
  settingsModalTitle,
  siteModalMessage,
  siteModalTitle,
  statusText,
  wlanFilterInput,
  wlanList,
  wlanPanelTitle,
} from './elements';
import { renderApList } from './ap-list';
import { t } from './i18n';
import { showEmptyStates, updateSelectionInfo } from './panels';
import { state } from './state';
import { renderWlanList } from './wlan-list';

/**
 * Writes every user-facing string of the static UI (titles, labels, button
 * texts, placeholders, accessible names) in the active language, then
 * re-renders the lists (or the empty states) and the selection info so the
 * dynamic content follows the language too. Called at startup and after a
 * settings save that may have changed the language.
 */
export function applyTranslations() {
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
  if (state.isConnected) {
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
  // Trusted-certificate section (the fingerprint value and the reset
  // question are filled per open / per click, see settings-modal.ts)
  labelCertPin.textContent = t('certPinLabel');
  resetCertBtn.textContent = t('certReset');
  cancelCertResetBtn.textContent = t('cancel');
  confirmCertResetBtn.textContent = t('certResetAction');

  // Confirm modal
  confirmModalTitle.textContent = t('confirmChange');
  cancelConfirmBtn.textContent = t('cancel');
  confirmConfirmBtn.textContent = t('confirm');

  // Site selection modal (its option buttons are built per-open from the
  // controller's site names, see showSiteSelection())
  siteModalTitle.textContent = t('siteSelectionTitle');
  siteModalMessage.textContent = t('siteSelectionMessage');
  cancelSiteBtn.textContent = t('cancel');

  // Certificate modal: first-use defaults (cert-modal.ts rewrites every text
  // for the variant it opens, so a language change in between is harmless)
  certModalTitle.textContent = t('certUntrustedTitle');
  cancelCertBtn.textContent = t('cancel');
  confirmCertBtn.textContent = t('certTrustAndConnect');

  // Status text (depends on state)
  if (!state.isConnected) {
    statusText.textContent = t('disconnected');
  }

  // Re-render dynamic content
  if (state.accessPoints.length > 0 || state.wlanGroups.length > 0) {
    renderApList();
    renderWlanList();
  } else {
    showEmptyStates();
  }
  updateSelectionInfo();
} // End of function applyTranslations()
