// ============================================================================
// The content of the three views as a whole: re-rendering every list and
// detail for the current §4.6 state (each list renderer shows the first-run,
// disconnected, loading or initial-load-error block of content-state.ts
// until data is loaded), the notices above the views, and the group
// vocabulary of the destination list and the shell.
// ============================================================================

import { renderApList } from './ap-list';
import { renderDestinationList } from './destination-pane';
import { destinationList } from './elements';
import { renderGroupsView } from './groups-view';
import { tGroup } from './i18n';
import { renderNetworksView } from './networks-view';
import { renderNotices } from './notices';
import { applyShellVocabulary } from './shell';

/**
 * Re-renders the content of every view for the current state: the AP list
 * (with its selection controls and the move preview), the destination list,
 * the AP groups and Wi-Fi networks views, and the notices. Called whenever
 * the content state changes without a data load committing new data: a
 * connection attempt starting or ending, the first load starting, a
 * disconnect, a language change.
 */
export function renderContentViews(): void {
  renderApList();
  renderDestinationList();
  renderGroupsView();
  renderNetworksView();
  renderNotices();
}

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
