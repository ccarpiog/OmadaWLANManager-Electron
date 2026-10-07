// ============================================================================
// Internationalization: applies the active language's strings to the static
// UI (index.html ships without text) and re-renders the dynamic content.
// ============================================================================

import {
  apFilterInput,
  apList,
  apPanelTitle,
  backBindingBtn,
  backNetworkBtn,
  bindingModalTitle,
  cancelBindingBtn,
  cancelCertBtn,
  cancelCertResetBtn,
  cancelMoveBtn,
  cancelGroupBtn,
  cancelNetworkBtn,
  cancelSettingsBtn,
  cancelManagementRemoveBtn,
  cancelSiteBtn,
  certModalTitle,
  closeMoveBtn,
  closeSettingsBtn,
  confirmCertBtn,
  confirmBindingBtn,
  confirmCertResetBtn,
  confirmGroupBtn,
  confirmManagementRemoveBtn,
  confirmMoveBtn,
  confirmNetworkBtn,
  connectBtn,
  destinationPanelTitle,
  destinationSearchInput,
  groupModalTitle,
  groupNameHint,
  groupNameLabel,
  labelCertPin,
  labelClientId,
  labelClientSecret,
  labelLanguage,
  labelPassword,
  labelUrl,
  labelUsername,
  managementHeading,
  managementHelp,
  managementRemovalNote,
  managementRemoveMessage,
  managementSessionNote,
  moveModalTitle,
  networkModalTitle,
  refreshBtn,
  removeManagementBtn,
  resetCertBtn,
  retryFailedBtn,
  saveSettingsBtn,
  settingsBtn,
  settingsModalTitle,
  siteModalMessage,
  siteModalTitle,
  statusText,
  testManagementBtn,
  undoManagementRemovalBtn,
} from './elements';
import { renderApFilterOptions, renderApList } from './ap-list';
import { renderDestinationList } from './destination-pane';
import { t } from './i18n';
import { moveActionLabel } from './move-text';
import { applyInventoryTranslations } from './navigation';
import { renderNotices } from './notices';
import { applyGroupVocabulary } from './panels';
import { applyShellTranslations } from './shell';
import { state } from './state';
import { renderHeaderMeta } from './status';

/**
 * Writes every user-facing string of the static UI (titles, labels, button
 * texts, placeholders, accessible names) in the active language, then
 * re-renders the shell (sidebar, header details), the filter options, the
 * lists (or the views' §4.6 states), the move preview, the notices, the AP
 * groups and Wi-Fi networks views, the AP details pane and the Back bar so
 * the dynamic content follows the language too. Called at startup and after
 * a settings save that may have changed the language.
 */
export function applyTranslations() {
  // App shell: sidebar entries and counts, Settings entry, view titles
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
  // Management-access section (the Client Secret placeholder depends on what
  // is stored and is refreshed per open / per edit, see settings-modal.ts;
  // the test's result line is written per run, see management.ts)
  managementHeading.textContent = t('managementTitle');
  managementHelp.textContent = t('managementHelp');
  labelClientId.textContent = t('clientId');
  labelClientSecret.textContent = t('clientSecret');
  managementSessionNote.textContent = t('managementSessionOnly');
  managementRemovalNote.textContent = t('managementRemovalPending');
  managementRemoveMessage.textContent = t('managementRemoveConfirm');
  removeManagementBtn.textContent = t('managementRemove');
  undoManagementRemovalBtn.textContent = t('managementUndoRemoval');
  cancelManagementRemoveBtn.textContent = t('cancel');
  confirmManagementRemoveBtn.textContent = t('managementRemoveAction');
  testManagementBtn.textContent = t('managementTest');

  // Move dialog: review defaults (move-dialog.ts rewrites the title and the
  // move button's label for each phase and plan)
  moveModalTitle.textContent = t('moveReviewTitle');
  cancelMoveBtn.textContent = t('cancel');
  confirmMoveBtn.textContent = moveActionLabel(1);
  retryFailedBtn.textContent = t('retryFailed');
  closeMoveBtn.textContent = t('close');

  // AP group dialog: the New group defaults (group-dialog.ts rewrites every
  // text for the write it opens for)
  groupModalTitle.textContent = t('createGroupTitle');
  groupNameLabel.textContent = t('groupNameLabel');
  groupNameHint.textContent = t('groupNameHint');
  cancelGroupBtn.textContent = t('cancel');
  confirmGroupBtn.textContent = t('createGroupAction');

  // Wi-Fi network dialog: the New network defaults (network-dialog.ts
  // rewrites every text, and builds the form, for the write it opens for)
  networkModalTitle.textContent = t('networkCreateTitle');
  cancelNetworkBtn.textContent = t('cancel');
  backNetworkBtn.textContent = t('networkBackAction');
  confirmNetworkBtn.textContent = t('networkCreateAction');

  // "Broadcast on" dialog: the editor's defaults (binding-dialog.ts rewrites
  // every text, and builds the editor, for the network it opens for)
  bindingModalTitle.textContent = t('bindingTitle');
  cancelBindingBtn.textContent = t('cancel');
  backBindingBtn.textContent = t('networkBackAction');
  confirmBindingBtn.textContent = t('bindingReviewAction');

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

  // Re-render dynamic content: the lists or their §4.6 states (the AP list
  // also renders the move preview, which writes the move button's label)
  // and the notices above the views
  renderApList();
  renderDestinationList();
  renderNotices();

  // AP groups and Wi-Fi networks views, AP details pane, Back bar
  applyInventoryTranslations();
} // End of function applyTranslations()
