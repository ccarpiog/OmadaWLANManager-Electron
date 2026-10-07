// Renderer process - entry module. esbuild bundles it, together with every
// module it imports, into one IIFE script (dist/renderer/renderer.js, loaded by
// index.html; see scripts/build-renderer.mjs). This file only wires the static
// UI's event listeners and runs the startup sequence; the logic lives in:
//   state.ts              mutable state, operation flags, session generation
//   elements.ts           DOM element references
//   i18n.ts               es/en string tables, t(), tFormat(), setLanguage()
//   apply-translations.ts writes the active language into the static UI
//   status.ts             header: connection status, site, controller host,
//                         "Updated hh:mm", controller version
//   shell.ts              sidebar navigation, view switching, total counts
//   view-state.ts         pure §4.6/§4.7 logic: content state, read-only
//                         reason, Escape priority, Cmd/Ctrl+F, single-pane
//                         pane choice
//   content-state.ts      the views' first-run / disconnected / loading /
//                         initial-load-error blocks
//   notices.ts            read-only banner, refresh-error notice
//   layout.ts             single-pane layout (700–799 px): panes on stage,
//                         drill-in Back labels, focus on resize
//   keyboard.ts           Cmd/Ctrl+F and the Escape order
//   toast.ts              toast notifications
//   validation.ts         format guards (MAC, WLAN/site id, fingerprint),
//                         controller-URL mirror of src/main/url.ts
//   dom-helpers.ts        empty-state block
//   panels.ts             re-renders every view's content, group vocabulary
//   ap-selection.ts       pure AP filtering, range selection and counts
//   ap-filters.ts         the AP list's current filters (from the state)
//   ap-status.ts          AP status colour + label
//   ap-focus.ts           focus inside the AP list (roving checkbox)
//   ap-list.ts            Access points list (checkbox multi-select; a row
//                         click opens the AP details pane)
//   ap-details.ts         AP details pane (in the destination pane's place)
//   inventory-model.ts    pure view models of the AP groups / Wi-Fi networks
//                         views and the AP details (rows, scopes, links)
//   inventory-ui.ts       shared DOM blocks of those views (cross-links,
//                         badges, notes, master-list keyboard)
//   groups-view.ts        AP groups view (master list + detail; New group,
//                         Rename, Delete and the per-band capacity while
//                         AP-group management is on; Move access points here)
//   group-management.ts   pure AP-group rules mirror (writable ids, name
//                         check), delete reasons, capacity rows, reply
//                         validation and error-code messages
//   managed-groups.ts     the fresh Open API view of the AP groups (read
//                         with the session nonce, late replies discarded)
//   group-dialog.ts       New group / Rename / Delete dialog
//   group-flow.ts         the AP-group write flows (dialog, write, reload,
//                         focus) and "Move access points here"
//   networks-view.ts      Wi-Fi networks view (read-only master list +
//                         detail; the 14a internal data, or the managed
//                         list while Wi-Fi network management is on)
//   network-management.ts pure managed-networks logic: source and view
//                         mode, stale-reply check, settling a reply (a
//                         failed re-read keeps the list, stale), reply
//                         validation, scopes, typed selection keys, value
//                         and failure message keys
//   managed-networks-view.ts the managed list's items, detail, scope text,
//                         error state (Retry, Settings) and stale notice
//   managed-networks.ts   the managed list of the Wi-Fi networks (read with
//                         the session nonce, late replies discarded)
//   nav-history.ts        pure Back-history helpers
//   navigation.ts         cross-links, "Back to …", re-rendering the views
//   move-plan.ts          pure move planning (gains/losses, mixed
//                         selections), destination search, move results
//   move-text.ts          localized texts of a move plan
//   destination-pane.ts   destination pane (group radios, search, Silence
//                         section, move preview, move button)
//   modal-focus.ts        modal Tab focus trap and inert background
//   management-form.ts    pure management-access form rules (Client ID /
//                         Client Secret save plan, secret placeholder, the
//                         test's outcome and its unsaved-changes guard)
//   management.ts         management capabilities of the session (they
//                         feed the read-only banner), "Test management access"
//   settings-modal.ts     settings modal (open/close/save, certificate reset,
//                         the management-access section)
//   move-dialog.ts        move review / progress / per-AP results dialog
//   site-modal.ts         site-selection modal (multi-site controllers)
//   cert-modal.ts         certificate first-use / "certificate changed" modal
//   connection.ts         connect/disconnect, site selection, certificate
//                         trust, load/refresh
//   move-flow.ts          moves the selected APs (review, sequential run,
//                         results, Retry failed)
// Shared types come from src/shared/types.ts (type-only imports), and the
// window.omadaAPI bridge typing from global.d.ts.

import { closeApDetails } from './ap-details';
import {
  clearApSelection,
  handleApListClick,
  handleApListKeydown,
  renderApList,
  selectAllFilteredAps,
} from './ap-list';
import { applyTranslations } from './apply-translations';
import { connect, refreshData, retryLoad, toggleConnection } from './connection';
import {
  closeDestinationPane,
  handleDestinationChange,
  handleDestinationSearchInput,
  handleDestinationSearchKeydown,
  isDestinationRadio,
  openDestinationPane,
  selectDestinationForMove,
} from './destination-pane';
import {
  apDetailsBackBtn,
  apFilterInput,
  apGroupFilterSelect,
  apList,
  apStatusFilterSelect,
  backBtn,
  cancelCertResetBtn,
  cancelManagementRemoveBtn,
  cancelSettingsBtn,
  clearApSelectionBtn,
  clientIdInput,
  clientSecretInput,
  closeApDetailsBtn,
  closeSettingsBtn,
  confirmCertResetBtn,
  confirmManagementRemoveBtn,
  connectBtn,
  destinationBackBtn,
  destinationList,
  destinationSearchInput,
  groupDetailBackBtn,
  groupList,
  groupSearchInput,
  moveBtn,
  networkDetailBackBtn,
  networkList,
  networkSearchInput,
  openDestinationBtn,
  passwordInput,
  refreshBtn,
  removeManagementBtn,
  resetCertBtn,
  saveSettingsBtn,
  selectAllApsBtn,
  settingsBtn,
  settingsModal,
  testManagementBtn,
  undoManagementRemovalBtn,
  urlInput,
  usernameInput,
  viewArea,
  viewGroups,
  viewNav,
} from './elements';
import { handleGroupActionClick } from './group-flow';
import {
  closeGroupDetailPane,
  handleGroupListClick,
  handleGroupListKeydown,
  handleGroupSearchInput,
  handleGroupSearchKeydown,
} from './groups-view';
import { setLanguage, t } from './i18n';
import { handleGlobalKeydown } from './keyboard';
import { installResponsiveLayout } from './layout';
import { retryManagedNetworks } from './managed-networks';
import { runManagementTest } from './management';
import { startMove } from './move-flow';
import { goBack, handleCrossLinkClick, navigateToView } from './navigation';
import {
  closeNetworkDetailPane,
  handleNetworkListClick,
  handleNetworkListKeydown,
  handleNetworkSearchInput,
  handleNetworkSearchKeydown,
} from './networks-view';
import {
  cancelCertificateReset,
  cancelManagementRemoval,
  closeSettings,
  confirmCertificateReset,
  confirmManagementRemoval,
  openSettings,
  requestCertificateReset,
  requestManagementRemoval,
  saveSettings,
  undoManagementRemoval,
  updateManagementAffordance,
  updatePasswordAffordance,
} from './settings-modal';
import { isAppView } from './shell';
import { state } from './state';
import { setStatus } from './status';
import { showToast } from './toast';

// ============================================================================
// Event Listeners
// ============================================================================

connectBtn.addEventListener('click', toggleConnection);
refreshBtn.addEventListener('click', refreshData);
settingsBtn.addEventListener('click', openSettings);

// Sidebar navigation: one native button per view (delegated); it starts a
// fresh navigation (the "Back to …" history is emptied)
viewNav.addEventListener('click', (e) => {
  const button = e.target instanceof Element ? e.target.closest<HTMLElement>('.nav-item[data-view]') : null;
  const view = button?.dataset.view;
  if (isAppView(view)) {
    navigateToView(view);
  }
});

// Cross-navigation: every cross-link in the views (AP details, group and
// network details) is followed by one delegated handler; "Back to …"
viewArea.addEventListener('click', handleCrossLinkClick);
backBtn.addEventListener('click', goBack);

// AP details pane (opened by a row click, see ap-list.ts): Close brings the
// destination pane back, focus returns to the AP's checkbox
closeApDetailsBtn.addEventListener('click', () => closeApDetails(true));

// §4.6 state actions inside the views (content-state.ts, notices.ts,
// managed-networks-view.ts): "Configure connection" and Settings open the
// settings modal, "Connect to controller" connects, Retry reloads (or
// reconnects), the Wi-Fi networks view's Retry reads its managed list again
viewArea.addEventListener('click', (e) => {
  const button = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('[data-state-action]') : null;
  switch (button?.dataset.stateAction) {
    case 'configure':
    case 'settings':
      openSettings();
      break;
    case 'connect':
      connect();
      break;
    case 'retry':
      retryLoad();
      break;
    case 'retryNetworks':
      retryManagedNetworks();
      break;
    default:
      break;
  }
}); // End of the state-action click handler

// Single-pane layout (700–799 px, layout.ts): "Choose destination" opens the
// destination picker in the AP list's place; each drill-in pane's Back
// returns to its list
openDestinationBtn.addEventListener('click', openDestinationPane);
destinationBackBtn.addEventListener('click', closeDestinationPane);
apDetailsBackBtn.addEventListener('click', () => closeApDetails(true));
groupDetailBackBtn.addEventListener('click', closeGroupDetailPane);
networkDetailBackBtn.addEventListener('click', closeNetworkDetailPane);

// AP groups and Wi-Fi networks views: their searches (Escape clears) and
// master lists (click selects; arrows, Home and End move focus)
groupSearchInput.addEventListener('input', handleGroupSearchInput);
groupSearchInput.addEventListener('keydown', handleGroupSearchKeydown);
groupList.addEventListener('click', handleGroupListClick);
groupList.addEventListener('keydown', handleGroupListKeydown);
networkSearchInput.addEventListener('input', handleNetworkSearchInput);
networkSearchInput.addEventListener('keydown', handleNetworkSearchKeydown);
networkList.addEventListener('click', handleNetworkListClick);
networkList.addEventListener('keydown', handleNetworkListKeydown);

// AP groups view actions (delegated, data-group-action): New group, Rename
// and Delete (AP-group management on only; each opens the AP group dialog)
// and "Move access points here" (the Access points view with the group as
// the move destination)
viewGroups.addEventListener('click', handleGroupActionClick);

// Access points list: filters, checkbox selection (delegated click and
// keyboard handlers), "Select all N filtered APs" and "Clear selection"
apFilterInput.addEventListener('input', () => {
  state.apFilterText = apFilterInput.value;
  renderApList();
});
apStatusFilterSelect.addEventListener('change', () => {
  state.apStatusFilter = apStatusFilterSelect.value;
  renderApList();
});
apGroupFilterSelect.addEventListener('change', () => {
  state.apGroupFilter = apGroupFilterSelect.value;
  renderApList();
});
apList.addEventListener('click', handleApListClick);
apList.addEventListener('keydown', handleApListKeydown);
selectAllApsBtn.addEventListener('click', selectAllFilteredAps);
clearApSelectionBtn.addEventListener('click', clearApSelection);

// Destination pane: the search (Escape clears it), the radios (delegated
// change handler; Enter on a radio starts the move like a form's implicit
// submission — into the FOCUSED radio's group, which becomes the checked
// destination first; nothing happens for a no-op move — and the review
// dialog still opens on Cancel) and the move button
destinationSearchInput.addEventListener('input', handleDestinationSearchInput);
destinationSearchInput.addEventListener('keydown', handleDestinationSearchKeydown);
destinationList.addEventListener('change', handleDestinationChange);
destinationList.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && isDestinationRadio(e.target)) {
    e.preventDefault();
    if (selectDestinationForMove(e.target)) {
      startMove();
    }
  }
});
moveBtn.addEventListener('click', startMove);

closeSettingsBtn.addEventListener('click', closeSettings);
cancelSettingsBtn.addEventListener('click', closeSettings);
saveSettingsBtn.addEventListener('click', saveSettings);

// Credentials are URL-scoped: editing the URL updates what a blank password
// field means ("unchanged" vs "required for the new URL"), and so does it for
// the Client Secret, which also belongs to the Client ID
urlInput.addEventListener('input', updatePasswordAffordance);
urlInput.addEventListener('input', updateManagementAffordance);
clientIdInput.addEventListener('input', updateManagementAffordance);

// Management access (Settings): "Remove management access" with an inline
// confirmation (the removal is staged and applied by Save), and "Test
// management access" (main runs the checks on the saved settings)
removeManagementBtn.addEventListener('click', requestManagementRemoval);
cancelManagementRemoveBtn.addEventListener('click', cancelManagementRemoval);
confirmManagementRemoveBtn.addEventListener('click', confirmManagementRemoval);
undoManagementRemovalBtn.addEventListener('click', undoManagementRemoval);
testManagementBtn.addEventListener('click', runManagementTest);

// Trusted certificate (Settings): reset with an inline confirmation
resetCertBtn.addEventListener('click', requestCertificateReset);
cancelCertResetBtn.addEventListener('click', cancelCertificateReset);
confirmCertResetBtn.addEventListener('click', confirmCertificateReset);

// Close modal on overlay click
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

// App-wide keys (keyboard.ts): Cmd/Ctrl+F focuses the current view's
// search; Escape clears the search, else exits edit mode, else closes the
// top dialog (the settings modal here; the move, AP group, site-selection
// and certificate modals install their own Escape listeners that route through
// their cancel paths, so their pending promises always resolve)
document.addEventListener('keydown', handleGlobalKeydown);

// Enter submits the settings form from any of its text fields (not only the
// password one), the management-access fields included
for (const settingsField of [urlInput, usernameInput, passwordInput, clientIdInput, clientSecretInput]) {
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

  // Before any config exists, the views show the first-run state with its
  // one "Configure connection" action (content-state.ts), and the header's
  // Connect stays disabled until a controller is configured
  state.hasStoredConfig = Boolean(config?.url);
  connectBtn.disabled = !state.hasStoredConfig;

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
installResponsiveLayout();
init().catch((error) => {
  // Last-resort guard: whatever happens, never leave the UI hidden behind
  // the pre-init class
  console.error('Initialization failed:', error);
  document.body.classList.remove('pre-init');
});
