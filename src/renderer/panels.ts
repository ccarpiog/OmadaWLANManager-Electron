// ============================================================================
// Panel states of the Access points view: the empty/loading blocks shown in
// the AP list and the destination list, and the group vocabulary of the
// destination list and the shell.
// ============================================================================

import { apList, destinationList } from './elements';
import { createEmptyState, createLoadingState } from './dom-helpers';
import { t, tGroup } from './i18n';
import { applyShellVocabulary } from './shell';
import { state } from './state';

/**
 * Shows a loading spinner in the AP list and the destination list while
 * data is being fetched.
 */
export function showLoadingStates(): void {
  apList.replaceChildren(createLoadingState());
  destinationList.replaceChildren(createLoadingState());
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
 * (sidebar entry, placeholder view) in the vocabulary of the current group
 * model ("AP groups" on Omada 6.3+, "WLAN groups (legacy)" before — see
 * tGroup()). Called by applyTranslations() and whenever state.groupModel
 * changes (loadData() and clearData() in connection.ts).
 */
export function applyGroupVocabulary(): void {
  destinationList.setAttribute('aria-label', tGroup('groupsTitle'));
  applyShellVocabulary();
}
