// ============================================================================
// Panel states of the Access points view: the empty/loading blocks shown in
// the AP list and the destination list (the AP groups and Wi-Fi networks
// lists pick their own state from the renderer state), and the group
// vocabulary of the destination list and the shell.
// ============================================================================

import { apList, destinationList } from './elements';
import { createEmptyState, createLoadingState } from './dom-helpers';
import { renderGroupsView } from './groups-view';
import { t, tGroup } from './i18n';
import { renderNetworksView } from './networks-view';
import { applyShellVocabulary } from './shell';
import { state } from './state';

/**
 * Shows a loading spinner in the AP list and the destination list while
 * data is being fetched, and lets the AP groups and Wi-Fi networks views
 * show theirs (they render a spinner during the first load).
 */
export function showLoadingStates(): void {
  apList.replaceChildren(createLoadingState());
  destinationList.replaceChildren(createLoadingState());
  renderGroupsView();
  renderNetworksView();
}

/**
 * Shows the initial empty states in both lists: a "configure the connection"
 * hint before any controller URL is stored (so a first-run user who closes
 * the settings modal is not left without guidance), or the usual "connect to
 * see data" messages afterwards.
 */
export function showEmptyStates(): void {
  if (!state.hasStoredConfig) {
    apList.replaceChildren(createEmptyState(t('configureHint')));
    destinationList.replaceChildren(createEmptyState(t('configureHint')));
    return;
  }
  apList.replaceChildren(createEmptyState(t('connectToSeeAPs')));
  destinationList.replaceChildren(createEmptyState(t('connectToSeeGroups')));
} // End of function showEmptyStates()

/**
 * Writes the destination list's accessible name and the shell's group texts
 * (sidebar entry, AP groups view title) in the vocabulary of the current group
 * model ("AP groups" on Omada 6.3+, "WLAN groups (legacy)" before — see
 * tGroup()). Called by applyTranslations() and whenever state.groupModel
 * changes (loadData() and clearData() in connection.ts).
 */
export function applyGroupVocabulary(): void {
  destinationList.setAttribute('aria-label', tGroup('groupsTitle'));
  applyShellVocabulary();
}
