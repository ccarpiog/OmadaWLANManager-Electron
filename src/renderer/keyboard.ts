// ============================================================================
// App-wide keys (docs/management-design.md §4.7), one document-level keydown
// handler installed at startup (renderer.ts):
//   - Cmd+F (macOS) / Ctrl+F focuses the current view's search (in the
//     single-pane layout, a drill-in pane without a search returns to its
//     list first; the destination picker has its own search);
//   - Escape, in priority order (escapeAction() in view-state.ts): clears
//     the current search, then exits edit mode (no view has one: the AP
//     group actions and the Wi-Fi network edit — staged in its dialog, where
//     Escape discards it — use dialogs; phase 19 may plug a view's edit mode
//     into isEditModeActive() / exitEditMode() below), then closes the top
//     dialog.
// The search fields that clear themselves on Escape (AP groups, Wi-Fi
// networks, destination) mark the event handled (preventDefault), so this
// handler skips it. The move, AP group, Wi-Fi network, site-selection and
// certificate dialogs close themselves on Escape through their own
// listeners (their pending promises must settle through their cancel
// paths); the settings modal is closed here.
// ============================================================================

import { closeApDetails } from './ap-details';
import { clearApSearch } from './ap-list';
import { clearDestinationSearch } from './destination-pane';
import { apFilterInput, destinationPanel, destinationSearchInput, groupSearchInput, networkSearchInput } from './elements';
import { clearGroupSearch, closeGroupDetailPane } from './groups-view';
import { isSinglePane } from './layout';
import { isAnyModalOpen } from './modal-focus';
import { clearNetworkSearch, closeNetworkDetailPane } from './networks-view';
import { closeSettings } from './settings-modal';
import { state } from './state';
import { accessPointsPane, escapeAction, isFindShortcut, masterDetailPane } from './view-state';

/**
 * A search field and how to clear it.
 */
interface SearchTarget {
  input: HTMLInputElement;
  clear: () => void;
}

/**
 * Returns the search of the pane the current view shows: the AP groups or
 * Wi-Fi networks list's search, the AP list's search or — when the
 * destination picker has focus (or is the pane shown in the single-pane
 * layout) — the destination search. A single-pane drill-in without a
 * search of its own (AP details, a group's or a network's detail) has none.
 * @returns {SearchTarget | null} The search, or null.
 */
function shownSearch(): SearchTarget | null {
  const single = isSinglePane();
  if (state.currentView === 'groups') {
    const drilled = single && masterDetailPane(state.groupDetailOpen, state.selectedGroupId !== null) === 'detail';
    return drilled ? null : { input: groupSearchInput, clear: clearGroupSearch };
  }
  if (state.currentView === 'networks') {
    const drilled = single && masterDetailPane(state.networkDetailOpen, state.selectedNetworkName !== null) === 'detail';
    return drilled ? null : { input: networkSearchInput, clear: clearNetworkSearch };
  }
  const destination = { input: destinationSearchInput, clear: clearDestinationSearch };
  if (single) {
    const pane = accessPointsPane(state.apDetailsMac !== null, state.destinationPaneOpen);
    if (pane === 'details') return null;
    if (pane === 'destination') return destination;
  } else if (destinationPanel.contains(document.activeElement)) {
    return destination;
  }
  return { input: apFilterInput, clear: clearApSearch };
} // End of function shownSearch()

/**
 * Single-pane layout: leaves the drill-in pane the current view shows (AP
 * details, a group's or a network's detail) for its list.
 */
function leaveDrillIn(): void {
  if (state.currentView === 'groups') {
    closeGroupDetailPane();
  } else if (state.currentView === 'networks') {
    closeNetworkDetailPane();
  } else {
    closeApDetails(false);
  }
}

/**
 * Cmd/Ctrl+F: focuses the current view's search and selects its text (a
 * drill-in pane without a search first returns to its list).
 */
function focusViewSearch(): void {
  let search = shownSearch();
  if (search === null) {
    leaveDrillIn();
    search = shownSearch();
  }
  search?.input.focus();
  search?.input.select();
}

/**
 * Tells whether the top context is in edit mode. No view has an edit mode
 * (the AP group actions and the Wi-Fi network edit use dialogs, which
 * handle their own Escape); the binding editor (phase 19) may report one
 * here.
 * @returns {boolean} False while no view has an edit mode.
 */
function isEditModeActive(): boolean {
  return false;
}

/**
 * Leaves the top context's edit mode (a view with an edit mode would plug
 * it in here; nothing to leave).
 */
function exitEditMode(): void {
  // No view has an edit mode (the Wi-Fi network edit is staged in its dialog)
}

/**
 * Closes the top dialog on Escape. Only the settings modal is closed here:
 * the move, AP group, Wi-Fi network, site-selection and certificate dialogs
 * close themselves through their own Escape listeners.
 */
function closeTopDialog(): void {
  closeSettings();
}

/**
 * Escape, in the §4.7 priority order: clear the current search, else exit
 * edit mode, else close the top dialog. With a dialog open, the background
 * view's search is not the top context's (no dialog has a search of its own
 * yet), so the dialog closes and the search stays.
 * @param {KeyboardEvent} e - The keydown event.
 */
function handleEscape(e: KeyboardEvent): void {
  const dialogOpen = isAnyModalOpen();
  const search = dialogOpen ? null : shownSearch();
  const action = escapeAction({
    dialogOpen,
    searchActive: search !== null && search.input.value !== '',
    editMode: isEditModeActive(),
  });
  if (action === 'clearSearch' && search !== null) {
    e.preventDefault();
    search.clear();
  } else if (action === 'exitEditMode') {
    e.preventDefault();
    exitEditMode();
  } else if (action === 'closeDialog') {
    closeTopDialog();
  }
} // End of function handleEscape()

/**
 * The document-level keydown handler: Cmd/Ctrl+F (ignored while a dialog is
 * open) and Escape (skipped when a field already handled it, or while an
 * input method is composing).
 * @param {KeyboardEvent} e - The keydown event.
 */
export function handleGlobalKeydown(e: KeyboardEvent): void {
  if (isFindShortcut(e, window.omadaAPI.platform)) {
    if (isAnyModalOpen()) return;
    e.preventDefault();
    focusViewSearch();
    return;
  }
  if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) {
    handleEscape(e);
  }
} // End of function handleGlobalKeydown()
