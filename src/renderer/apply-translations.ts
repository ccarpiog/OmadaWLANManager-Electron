// ============================================================================
// Internationalization: applies the active language's strings to the static
// UI (index.html ships without text) and re-renders the dynamic content.
// ============================================================================

import {
  apFilterInput,
  apList,
  apPanelTitle,
  cancelCertBtn,
  cancelCertResetBtn,
  cancelMoveBtn,
  cancelSettingsBtn,
  cancelSiteBtn,
  certModalTitle,
  closeMoveBtn,
  closeSettingsBtn,
  confirmCertBtn,
  confirmCertResetBtn,
  confirmMoveBtn,
  connectBtn,
  destinationPanelTitle,
  destinationSearchInput,
  labelCertPin,
  labelLanguage,
  labelPassword,
  labelUrl,
  labelUsername,
  moveModalTitle,
  refreshBtn,
  resetCertBtn,
  retryFailedBtn,
  saveSettingsBtn,
  settingsBtn,
  settingsModalTitle,
  siteModalMessage,
  siteModalTitle,
  statusText,
} from './elements';
import { renderApFilterOptions, renderApList, renderApSelectionControls } from './ap-list';
import { renderDestinationList, renderMovePreview } from './destination-pane';
import { t } from './i18n';
import { moveActionLabel } from './move-text';
import { applyGroupVocabulary, showEmptyStates } from './panels';
import { applyShellTranslations } from './shell';
import { state } from './state';
import { renderHeaderMeta } from './status';

/**
 * Writes every user-facing string of the static UI (titles, labels, button
 * texts, placeholders, accessible names) in the active language, then
 * re-renders the shell (sidebar, header details), the filter options, the
 * lists (or the empty states) and the move preview so the dynamic content
 * follows the language too. Called at startup and after a settings save that
 * may have changed the language.
 */
export function applyTranslations() {
  // App shell: sidebar entries and counts, Settings entry, placeholder views
  applyShellTranslations();

  // Panel titles and list labels; the destination list's follows the
  // controller's group model
  apPanelTitle.textContent = t('accessPoints');
  apList.setAttribute('aria-label', t('accessPoints'));
  destinationPanelTitle.textContent = t('destinationTitle');
  applyGroupVocabulary();

  // Search placeholders and accessible names (neither search has a visible label)
  apFilterInput.placeholder = t('searchAps');
  apFilterInput.setAttribute('aria-label', t('searchApsLabel'));
  destinationSearchInput.placeholder = t('destinationSearch');
  destinationSearchInput.setAttribute('aria-label', t('destinationSearchLabel'));
  renderApFilterOptions();

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

  // Move dialog: review defaults (move-dialog.ts rewrites the title and the
  // move button's label for each phase and plan)
  moveModalTitle.textContent = t('moveReviewTitle');
  cancelMoveBtn.textContent = t('cancel');
  confirmMoveBtn.textContent = moveActionLabel(1);
  retryFailedBtn.textContent = t('retryFailed');
  closeMoveBtn.textContent = t('close');

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

  // Status text (depends on state) and the header details
  statusText.textContent = state.isConnected ? t('connected') : t('disconnected');
  statusText.title = statusText.textContent;
  renderHeaderMeta();

  // Re-render dynamic content (the move preview also writes the move
  // button's label)
  if (state.accessPoints.length > 0 || state.wlanGroups.length > 0) {
    renderApList();
    renderDestinationList();
  } else {
    showEmptyStates();
    renderApSelectionControls();
  }
  renderMovePreview();
} // End of function applyTranslations()
