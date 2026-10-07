// ============================================================================
// Wi-Fi networks view (docs/management-design.md §4.5), from one of two
// sources:
// - the internal data (phase 14a; management off, or its capabilities still
//   unknown / being checked): a master list of the distinct network names
//   (the sidebar's count) with each network's scope "N groups · M APs" (a
//   lower bound, with the reason, while some APs' groups cannot be
//   identified), its own search over network AND group names, and the
//   selected network's detail: the groups broadcasting it and the APs that
//   broadcast it, as cross-links. The internal data has no security, bands
//   or enabled state, so the detail says they need management access
//   instead of inventing them;
// - the managed (Open API) list while Wi-Fi network management is on
//   (phase 17b, read by managed-networks.ts): one entry per network with
//   its enabled state, security, bands and scope ("All access points", "N
//   groups · M APs" or an explicit unknown scope), the same search, and a
//   detail with those facts, whether a password is set (never a key) and
//   the bound groups and their APs as cross-links. While its first read
//   runs the list shows the loading skeleton; a failed first read shows the
//   §4.6 error state with Retry and Settings instead of any list (never a
//   partial one); a failed re-read keeps the last good list, stale, with
//   the §4.6 refresh-error notice above the views while this view is on
//   screen (its time, the reason, Retry). Networks are told apart by id
//   there. While Wi-Fi network management is on (and only then: not while
//   a capability check runs, on a legacy controller or with a read-only
//   reason), "New network" sits above the list and the detail carries the
//   write actions (managed-networks-view.ts; run by network-flow.ts) and its
//   "Broadcast on" section (run by binding-flow.ts) — disabled, the detail
//   saying why, while the data on screen is not known to be fresh
//   (currentNetworkWriteBlock(): the internal data stale after a failed
//   refresh, the managed list stale or being read; for "Broadcast on" also
//   the managed AP-group list: currentBindingWriteBlock()).
// The 14a view has no write action. Until data is loaded the list
// shows the §4.6 state (content-state.ts). In the single-pane layout
// (700–799 px) picking a network drills into its detail, whose Back returns
// to the list (layout.ts). Pure logic: inventory-model.ts (internal),
// network-management.ts (managed); the managed DOM blocks:
// managed-networks-view.ts.
// ============================================================================

import { countDistinctSsids } from './ap-selection';
import { createSkeletonState, createStateBlock, currentContentState } from './content-state';
import { createEmptyState } from './dom-helpers';
import { networkDetail, networkList, networkListActions, networkListSummary, networkSearchInput } from './elements';
import { t, tFormat, tGroup } from './i18n';
import {
  buildNetworkRows,
  filterNetworkRows,
  groupLink,
  groupMembers,
  matchesNetworkSearch,
  networkBroadcasters,
  searchKeepingItem,
  type NetworkRow,
} from './inventory-model';
import {
  apCountOrUnknown,
  applyMasterRovingTabindex,
  createCrossLink,
  createDetailHeading,
  createDetailSection,
  createLinkList,
  createMeta,
  createNote,
  createSearchNoResults,
  displayName,
  findCrossLink,
  focusById,
  focusedCrossLink,
  focusMasterItem,
  handleMasterListKeydown,
  scopeText,
  setLiveText,
} from './inventory-ui';
import { applyPaneLayout, isSinglePane } from './layout';
import type { LinkTarget } from './nav-history';
import {
  buildManagedNetworkDetail,
  createBroadcastingApsSection,
  createManagedNetworkItem,
  createManagedNetworksFailure,
  createNetworkActionButton,
  NEW_NETWORK_BUTTON_ID,
  renderManagedNetworksStaleNotice,
} from './managed-networks-view';
import { bindingWriteBlock, type BindingWriteBlock } from './network-bindings';
import { networkWriteBlock, type NetworkWriteBlock } from './network-editing';
import {
  buildManagedNetworkRows,
  filterManagedNetworkRows,
  findManagedNetwork,
  isManagedListStale,
  managedNetworkScope,
  matchesManagedNetworkSearch,
  networkHistoryItem,
  networkManagementChecking,
  networkManagementOn,
  networksSourceSettled,
  networksViewMode,
  parseNetworkHistoryItem,
  resolveManagedSelection,
  type NetworkManagementInput,
  type NetworksViewMode,
} from './network-management';
import { state } from './state';

// Id of the detail's heading (the network's name)
const HEADING_ID = 'networkDetailName';

/**
 * Builds one master item: a native button (the current one carries
 * aria-current="true") with the network name and its scope.
 * @param {NetworkRow} row - The network's row.
 * @returns {HTMLLIElement} The list item.
 */
function createNetworkItem(row: NetworkRow): HTMLLIElement {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'master-item';
  button.dataset.networkName = row.name;
  button.tabIndex = -1;
  if (row.name === state.selectedNetworkName) {
    button.setAttribute('aria-current', 'true');
  }
  const header = document.createElement('span');
  header.className = 'master-item-header';
  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = displayName(row.name);
  header.appendChild(name);
  const scope = document.createElement('span');
  scope.className = 'item-subtitle master-item-meta network-scope';
  scope.textContent = scopeText(row.groups.length, row.apCount, row.unknownApCount);
  button.appendChild(header);
  button.appendChild(scope);
  item.appendChild(button);
  return item;
} // End of function createNetworkItem()

/**
 * The renderer state the managed source is decided from.
 * @returns {NetworkManagementInput} The input of networkManagementOn() / networkManagementChecking().
 */
function managementInput(): NetworkManagementInput {
  return {
    isConnected: state.isConnected,
    hasSessionNonce: state.sessionNonce !== null,
    hasData: state.lastUpdatedAt !== null,
    groupModel: state.groupModel,
    capabilities: state.managementCapabilities,
  };
}

/**
 * Tells whether the Wi-Fi networks view reads the managed source for the
 * session on screen (networkManagementOn(): connected with a session nonce
 * and data, no read-only reason, Wi-Fi network management on).
 * @returns {boolean} True while the managed source is used.
 */
export function isNetworkManagementOn(): boolean {
  return networkManagementOn(managementInput());
}

/**
 * Why every Wi-Fi network write is held back now (networkWriteBlock(): the
 * internal data stale after a failed refresh, the managed list stale after a
 * failed read or being read), or null when the data on screen may be
 * written from. The actions render disabled with the reason, and a flow
 * checks it again at its start and right before every write.
 * @returns {NetworkWriteBlock | null} The reason, or null.
 */
export function currentNetworkWriteBlock(): NetworkWriteBlock | null {
  return networkWriteBlock({ refreshError: state.refreshError, listStatus: state.managedNetworksStatus, hasList: state.managedNetworks !== null });
}

/**
 * Why the "Broadcast on" write is held back now (bindingWriteBlock(): every
 * reason of currentNetworkWriteBlock(), plus the managed AP-group list — the
 * editor's options and capacity — failed or not read yet), or null. The
 * "Change AP groups" action renders disabled with the reason, and the
 * binding flow checks it again at its start and right before the write.
 * @returns {BindingWriteBlock | null} The reason, or null.
 */
export function currentBindingWriteBlock(): BindingWriteBlock | null {
  return bindingWriteBlock({
    refreshError: state.refreshError,
    listStatus: state.managedNetworksStatus,
    hasList: state.managedNetworks !== null,
    groupsStatus: state.managedGroupsStatus,
    hasGroups: state.managedApGroups !== null,
  });
}

/**
 * What the view shows once data is loaded (networksViewMode()): the 14a
 * view, or the managed list, its loading skeleton or its error state.
 * @returns {NetworksViewMode} The mode now.
 */
export function currentNetworksMode(): NetworksViewMode {
  return networksViewMode(isNetworkManagementOn(), state.managedNetworksStatus, state.managedNetworks !== null);
}

/**
 * The Wi-Fi networks total for the sidebar: the managed list's length while
 * it is shown, else the distinct network names of the internal data.
 * @returns {number} The count.
 */
export function networksNavCount(): number {
  if (state.managedNetworks !== null && currentNetworksMode() === 'managedReady') {
    return state.managedNetworks.length;
  }
  return countDistinctSsids(state.wlanGroups);
}

/**
 * Brings the selection in line with the source on screen: on the 14a view
 * no managed id is held; on the managed list the selection is resolved (by
 * its id — selected there or waiting from Back —, else by its unique name —
 * a cross-link or the 14a view's selection; resolveManagedSelection()) and
 * the selected network's name is mirrored, or the selection is cleared when
 * it designates no network; while the managed list is loading or failed,
 * the selection waits.
 * @param {NetworksViewMode} mode - The view's mode.
 */
function syncNetworkSelection(mode: NetworksViewMode): void {
  if (mode === 'internal') {
    state.selectedManagedNetworkId = null;
    return;
  }
  if (mode !== 'managedReady' || state.managedNetworks === null) return;
  const network = resolveManagedSelection(state.managedNetworks, state.selectedManagedNetworkId, state.selectedNetworkName);
  state.selectedManagedNetworkId = network === null ? null : network.id;
  state.selectedNetworkName = network === null ? null : network.name;
} // End of function syncNetworkSelection()

/**
 * Returns the id of the focused element inside a container (to give focus
 * back to the same control after a re-render).
 * @param {HTMLElement} container - The container.
 * @returns {string | null} The id, or null.
 */
function focusedIdInside(container: HTMLElement): string | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.id !== '' && container.contains(active) ? active.id : null;
}

/**
 * Renders the master list's action slot: "New network" while Wi-Fi network
 * management is on and data is loaded (nothing otherwise — also while a
 * capability check runs), disabled while the data on screen is not known to
 * be fresh (the refresh notice, the list's stale notice or its state says
 * why). Keyboard focus on it survives the re-render (on the search field
 * when it became disabled).
 */
function renderNetworkListActions(): void {
  const focusedId = focusedIdInside(networkListActions);
  if (currentContentState() !== 'ready' || !isNetworkManagementOn()) {
    networkListActions.replaceChildren();
    return;
  }
  const blocked = currentNetworkWriteBlock() !== null;
  networkListActions.replaceChildren(createNetworkActionButton(NEW_NETWORK_BUTTON_ID, 'create', t('newNetwork'), 'btn-primary', blocked));
  if (focusedId !== null && !focusById(focusedId)) {
    networkSearchInput.focus();
  }
} // End of function renderNetworkListActions()

/**
 * Renders the 14a master list from the internal data and the search, and
 * the aria-live results summary ("Showing N of M" while a search narrows
 * the list).
 * @param {string | null} focusedName - The network whose item had keyboard focus, or null.
 */
function renderInternalNetworkList(focusedName: string | null): void {
  const rows = buildNetworkRows(state.wlanGroups, state.accessPoints);
  if (rows.length === 0) {
    networkList.replaceChildren(createEmptyState(t('noNetworks')));
    setLiveText(networkListSummary, '');
    return;
  }

  const visible = filterNetworkRows(rows, state.networkSearchText);
  if (visible.length === 0) {
    const message = tFormat('noMatchingNetworks', { query: state.networkSearchText.trim() });
    networkList.replaceChildren(createSearchNoResults(message, 'clearNetworkSearchBtn', clearNetworkSearch));
  } else {
    const list = document.createElement('ul');
    list.className = 'master-items';
    list.replaceChildren(...visible.map(createNetworkItem));
    networkList.replaceChildren(list);
    applyMasterRovingTabindex(networkList);
  }
  const searching = state.networkSearchText.trim() !== '';
  setLiveText(networkListSummary, searching ? tFormat('searchResultsCount', { shown: String(visible.length), total: String(rows.length) }) : '');

  if (focusedName !== null) {
    const button = Array.from(networkList.querySelectorAll<HTMLButtonElement>('.master-item')).find(item => item.dataset.networkName === focusedName);
    if (button) focusMasterItem(networkList, button);
  }
} // End of function renderInternalNetworkList()

/**
 * Renders the managed master list: the loading skeleton while the first
 * read runs, the error state with Retry after a failed first read,
 * otherwise the networks matching the search (or "no networks" / "no
 * results") with the aria-live results summary — also a stale list kept
 * after a failed re-read (its notice is rendered by renderNetworkList()).
 * @param {NetworksViewMode} mode - The view's managed mode.
 * @param {string | null} focusedId - The network whose item had keyboard focus, or null.
 */
function renderManagedNetworkList(mode: NetworksViewMode, focusedId: string | null): void {
  if (mode === 'managedLoading' || mode === 'managedFailed' || state.managedNetworks === null) {
    networkList.replaceChildren(mode === 'managedFailed' ? createManagedNetworksFailure(state.managedNetworksFailure) : createSkeletonState());
    setLiveText(networkListSummary, '');
    return;
  }
  const rows = buildManagedNetworkRows(state.managedNetworks, state.wlanGroups, state.accessPoints);
  if (rows.length === 0) {
    networkList.replaceChildren(createEmptyState(t('noNetworks')));
    setLiveText(networkListSummary, '');
    return;
  }

  const visible = filterManagedNetworkRows(rows, state.networkSearchText);
  if (visible.length === 0) {
    const message = tFormat('noMatchingNetworks', { query: state.networkSearchText.trim() });
    networkList.replaceChildren(createSearchNoResults(message, 'clearNetworkSearchBtn', clearNetworkSearch));
  } else {
    const list = document.createElement('ul');
    list.className = 'master-items';
    list.replaceChildren(...visible.map(row => createManagedNetworkItem(row, state.selectedManagedNetworkId)));
    networkList.replaceChildren(list);
    applyMasterRovingTabindex(networkList);
  }
  const searching = state.networkSearchText.trim() !== '';
  setLiveText(networkListSummary, searching ? tFormat('searchResultsCount', { shown: String(visible.length), total: String(rows.length) }) : '');

  if (focusedId !== null) {
    const button = Array.from(networkList.querySelectorAll<HTMLButtonElement>('.master-item')).find(item => item.dataset.networkId === focusedId);
    if (button) focusMasterItem(networkList, button);
  }
} // End of function renderManagedNetworkList()

/**
 * Renders the refresh-error notice of the managed list above the views
 * (renderManagedNetworksStaleNotice()): shown while the Wi-Fi networks view
 * is the one on screen and its managed list is stale (a failed re-read kept
 * the last good list), hidden otherwise. Called by renderNetworkList() and
 * on every view switch (showView() in shell.ts).
 */
export function renderNetworksStaleNotice(): void {
  const stale = state.currentView === 'networks' && currentContentState() === 'ready' && isManagedListStale(currentNetworksMode(), state.managedNetworksStatus);
  renderManagedNetworksStaleNotice(stale ? state.managedNetworksFailure : null, stale ? (state.managedNetworksStamp?.readAt ?? null) : null);
}

/**
 * Renders the master list for the current source, data and search. Before
 * any data is loaded it shows the view's §4.6 state (first run,
 * disconnected, loading skeleton or initial-load error, with its action).
 * The list carries the mode as data-networks-mode ('internal',
 * 'managedLoading', 'managedReady' or 'managedFailed'), and the
 * refresh-error notice above the view and the "New network" slot follow
 * (renderNetworksStaleNotice(), renderNetworkListActions()). Keyboard focus
 * on an item survives the re-render.
 */
export function renderNetworkList(): void {
  const active = document.activeElement;
  const focused = active instanceof HTMLButtonElement && networkList.contains(active) ? active : null;
  networkList.setAttribute('aria-label', t('wifiNetworks'));

  renderNetworksStaleNotice();
  renderNetworkListActions();
  const contentState = currentContentState();
  if (contentState !== 'ready') {
    delete networkList.dataset.networksMode;
    networkList.replaceChildren(createStateBlock('networks', contentState));
    setLiveText(networkListSummary, '');
    return;
  }
  const mode = currentNetworksMode();
  syncNetworkSelection(mode);
  networkList.dataset.networksMode = mode;
  if (mode === 'internal') {
    renderInternalNetworkList(focused?.dataset.networkName ?? null);
  } else {
    renderManagedNetworkList(mode, focused?.dataset.networkId ?? null);
  }
} // End of function renderNetworkList()

/**
 * Renders the selected network's detail from the internal data (a prompt
 * while none is selected; nothing before data is loaded): its scope, the
 * groups broadcasting it (each with its AP count), the APs that broadcast
 * it with the APs whose group cannot be identified stated in the same
 * section, and that security, bands and enabled state need management
 * access. A selection no group broadcasts any more is cleared (the
 * single-pane layout then shows the list again).
 * @param {LinkTarget | null} focusLink - The cross-link that had keyboard focus, or null.
 * @param {boolean} headingFocused - The heading had keyboard focus.
 */
function renderInternalNetworkDetail(focusLink: LinkTarget | null, headingFocused: boolean): void {
  const name = state.selectedNetworkName;
  const broadcasters = name === null ? null : networkBroadcasters(name, state.wlanGroups, state.accessPoints);
  if (broadcasters === null) {
    state.selectedNetworkName = null;
  }
  applyPaneLayout();

  if (broadcasters === null) {
    const loaded = state.lastUpdatedAt !== null && buildNetworkRows(state.wlanGroups, []).length > 0;
    networkDetail.replaceChildren(...(loaded ? [createEmptyState(t('networkDetailPrompt'))] : []));
    return;
  }

  const scope = document.createElement('p');
  scope.className = 'detail-summary detail-scope';
  scope.textContent = scopeText(broadcasters.groups.length, broadcasters.aps.length, broadcasters.unknownApCount);

  const groupRows = broadcasters.groups.map(group => {
    const members = groupMembers(group, state.wlanGroups, state.accessPoints);
    return [createCrossLink(groupLink(group), group.wlanName), createMeta(apCountOrUnknown(members === null ? null : members.length))];
  });
  const groupsSection = createDetailSection('groups', `${tGroup('groupsTitle')} (${broadcasters.groups.length})`, [createLinkList(groupRows)]);

  networkDetail.replaceChildren(
    createDetailHeading(HEADING_ID, broadcasters.name),
    scope,
    groupsSection,
    createBroadcastingApsSection(broadcasters.aps, broadcasters.unknownApCount),
    createNote(t('networkManagementOnly'), 'managementOnly'),
  );
  restoreDetailFocus(focusLink, headingFocused);
} // End of function renderInternalNetworkDetail()

/**
 * Renders the selected network's detail from the managed list (a prompt
 * while none is selected): its name, scope, facts (enabled state,
 * security, bands, whether a password is set), the write actions while
 * Wi-Fi network management is on (disabled, with the reason, while the data
 * on screen is not known to be fresh), and by scope the bound groups and their
 * APs as cross-links or the scope's note. While the managed list is loading
 * or failed the detail is empty and the single-pane layout shows the list's
 * state (the drill-in is closed; the selection waits for the list).
 * Keyboard focus on an action survives the re-render (an action that is
 * gone hands it to the heading).
 * @param {NetworksViewMode} mode - The view's managed mode.
 * @param {LinkTarget | null} focusLink - The cross-link that had keyboard focus, or null.
 * @param {boolean} headingFocused - The heading had keyboard focus.
 */
function renderManagedNetworkDetail(mode: NetworksViewMode, focusLink: LinkTarget | null, headingFocused: boolean): void {
  const focusedAction = focusedIdInside(networkDetail);
  if (mode !== 'managedReady' || state.managedNetworks === null) {
    state.networkDetailOpen = false;
    applyPaneLayout();
    networkDetail.replaceChildren();
    return;
  }
  const network = state.managedNetworks.find(candidate => candidate.id === state.selectedManagedNetworkId) ?? null;
  applyPaneLayout();
  if (network === null) {
    networkDetail.replaceChildren(...(state.managedNetworks.length > 0 ? [createEmptyState(t('networkDetailPrompt'))] : []));
    return;
  }
  const row = { network, scope: managedNetworkScope(network, state.wlanGroups, state.accessPoints) };
  networkDetail.replaceChildren(
    createDetailHeading(HEADING_ID, network.name),
    ...buildManagedNetworkDetail(row, isNetworkManagementOn(), currentNetworkWriteBlock(), currentBindingWriteBlock()),
  );
  if (focusedAction !== null && focusedAction !== HEADING_ID) {
    if (!focusById(focusedAction)) focusById(HEADING_ID);
    return;
  }
  restoreDetailFocus(focusLink, headingFocused);
} // End of function renderManagedNetworkDetail()

/**
 * Gives keyboard focus back after the detail was re-rendered: to the same
 * cross-link, else to the heading when it had focus.
 * @param {LinkTarget | null} focusLink - The cross-link that had focus, or null.
 * @param {boolean} headingFocused - The heading had focus.
 */
function restoreDetailFocus(focusLink: LinkTarget | null, headingFocused: boolean): void {
  const link = focusLink === null ? null : findCrossLink(networkDetail, focusLink);
  if (link) {
    link.focus({ preventScroll: true });
  } else if (headingFocused) {
    focusById(HEADING_ID);
  }
}

/**
 * Renders the selected network's detail for the current source (the 14a
 * internal data or the managed list; see the two renderers above). Keyboard
 * focus on a cross-link or the heading survives the re-render.
 */
export function renderNetworkDetail(): void {
  const focusLink = focusedCrossLink(networkDetail);
  const headingFocused = document.activeElement?.id === HEADING_ID;
  const mode = currentContentState() === 'ready' ? currentNetworksMode() : 'internal';
  syncNetworkSelection(mode);
  if (mode === 'internal') {
    renderInternalNetworkDetail(focusLink, headingFocused);
  } else {
    renderManagedNetworkDetail(mode, focusLink, headingFocused);
  }
} // End of function renderNetworkDetail()

/**
 * Renders the whole view: the master list and the detail.
 */
export function renderNetworksView(): void {
  renderNetworkList();
  renderNetworkDetail();
}

/**
 * Marks the master item of the selection as current (the list is not
 * re-rendered, so focus stays put) and renders the detail.
 * @param {(item: HTMLButtonElement) => boolean} isSelected - Whether an item is the selected one.
 */
function markSelectedItem(isSelected: (item: HTMLButtonElement) => boolean): void {
  for (const item of networkList.querySelectorAll<HTMLButtonElement>('.master-item')) {
    if (isSelected(item)) {
      item.setAttribute('aria-current', 'true');
    } else {
      item.removeAttribute('aria-current');
    }
  }
  renderNetworkDetail();
}

/**
 * Selects a network of the 14a view by name (or none).
 * @param {string | null} name - The network name, or null.
 */
export function selectNetwork(name: string | null): void {
  state.selectedNetworkName = name;
  state.selectedManagedNetworkId = null;
  markSelectedItem(item => item.dataset.networkName === name);
}

/**
 * Selects a network of the managed list by id (its name is mirrored for
 * the layout and a later switch to the 14a view).
 * @param {string} id - The network's id.
 */
export function selectManagedNetwork(id: string): void {
  const network = state.managedNetworks?.find(candidate => candidate.id === id) ?? null;
  state.selectedManagedNetworkId = network === null ? null : network.id;
  state.selectedNetworkName = network === null ? null : network.name;
  markSelectedItem(item => network !== null && item.dataset.networkId === network.id);
}

/**
 * Delegated click handler of the master list (Enter and Space too: the
 * items are buttons): a click on an item selects its network (by id on the
 * managed list, by name on the 14a view), and it stays the list's Tab stop.
 * In the single-pane layout the network's detail replaces the list, with
 * focus on its heading.
 * @param {MouseEvent} e - The click event.
 */
export function handleNetworkListClick(e: MouseEvent): void {
  const item = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.master-item') : null;
  if (!item || !networkList.contains(item) || item.dataset.networkName === undefined) return;
  state.networkDetailOpen = true;
  if (item.dataset.networkId !== undefined) {
    selectManagedNetwork(item.dataset.networkId);
  } else {
    selectNetwork(item.dataset.networkName);
  }
  if (isSinglePane()) {
    for (const other of networkList.querySelectorAll<HTMLButtonElement>('.master-item')) {
      other.tabIndex = other === item ? 0 : -1;
    }
    focusNetworkDetailHeading();
  } else {
    focusMasterItem(networkList, item);
  }
} // End of function handleNetworkListClick()

/**
 * Single-pane layout: the detail's Back — the list comes back with focus on
 * the selected network (still selected), else on the search field.
 */
export function closeNetworkDetailPane(): void {
  state.networkDetailOpen = false;
  applyPaneLayout();
  const item = networkList.querySelector<HTMLButtonElement>('.master-item[aria-current="true"]');
  if (item) {
    focusMasterItem(networkList, item);
  } else {
    networkSearchInput.focus();
  }
} // End of function closeNetworkDetailPane()

/**
 * Keydown handler of the master list (arrow keys, Home, End).
 * @param {KeyboardEvent} e - The keydown event.
 */
export function handleNetworkListKeydown(e: KeyboardEvent): void {
  handleMasterListKeydown(e, networkList);
}

/**
 * Input handler of the view's search (network and group names).
 */
export function handleNetworkSearchInput(): void {
  state.networkSearchText = networkSearchInput.value;
  renderNetworkList();
}

/**
 * Empties the search, re-renders the list and returns focus to the search
 * field (Escape in the field, "Clear search").
 */
export function clearNetworkSearch(): void {
  networkSearchInput.value = '';
  state.networkSearchText = '';
  renderNetworkList();
  networkSearchInput.focus();
}

/**
 * Keydown handler of the search: Escape clears a non-empty search.
 * @param {KeyboardEvent} e - The keydown event.
 */
export function handleNetworkSearchKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && networkSearchInput.value !== '') {
    e.preventDefault();
    clearNetworkSearch();
  }
}

/**
 * Moves keyboard focus to the detail's heading (the selected network's name).
 * @returns {boolean} True when the heading received focus.
 */
export function focusNetworkDetailHeading(): boolean {
  return focusById(HEADING_ID);
}

/**
 * Moves keyboard focus to a managed network's master item (made the list's
 * Tab stop and scrolled into view), when it is rendered.
 * @param {string} networkId - The network's id.
 * @returns {boolean} True when the item received focus.
 */
export function focusManagedNetworkItem(networkId: string): boolean {
  const item = Array.from(networkList.querySelectorAll<HTMLButtonElement>('.master-item')).find(candidate => candidate.dataset.networkId === networkId);
  if (!item) {
    return false;
  }
  item.scrollIntoView({ block: 'nearest' });
  focusMasterItem(networkList, item);
  return document.activeElement === item;
} // End of function focusManagedNetworkItem()

/**
 * Moves keyboard focus into the Wi-Fi networks list when the control that
 * had it is gone (e.g. a deleted network's detail): the list's Tab stop,
 * else "New network", else the search field. In the single-pane layout the
 * list is brought back first.
 */
export function focusNetworkListFallback(): void {
  state.networkDetailOpen = false;
  applyPaneLayout();
  const tabStop = networkList.querySelector<HTMLButtonElement>('.master-item[tabindex="0"]');
  if (tabStop) {
    focusMasterItem(networkList, tabStop);
  } else if (!focusById(NEW_NETWORK_BUTTON_ID)) {
    networkSearchInput.focus();
  }
} // End of function focusNetworkListFallback()

/**
 * Scrolls the selected network's master item into view, when rendered.
 */
export function revealSelectedNetwork(): void {
  const item = networkList.querySelector<HTMLButtonElement>('.master-item[aria-current="true"]');
  item?.scrollIntoView({ block: 'nearest' });
}

// ============================================================================
// Cross-navigation (navigation.ts): the view's item in the Back history is a
// typed network key (networkHistoryItem(): "name:<name>" on the 14a view or
// for a name still waiting to be resolved, "id:<id>" on the managed list),
// so an id and a name are never resolved as each other
// ============================================================================

/**
 * The item the view shows, for the Back history: on the managed source the
 * selected network's id when one is held (selected, or waiting from Back);
 * otherwise the selected network's name (the 14a view, or a name waiting
 * to be resolved on the managed list), or null.
 * @returns {string | null} The item ("id:…" or "name:…"), or null.
 */
export function currentNetworkItem(): string | null {
  const managed = currentContentState() === 'ready' && currentNetworksMode() !== 'internal';
  if (managed && state.selectedManagedNetworkId !== null) {
    return networkHistoryItem({ kind: 'id', value: state.selectedManagedNetworkId });
  }
  return state.selectedNetworkName === null ? null : networkHistoryItem({ kind: 'name', value: state.selectedNetworkName });
}

/**
 * The display name of a Back-history item of this view as the data on
 * screen has it now, or null when it is gone: on the 14a view a network
 * name some group broadcasts (an id cannot be shown there); on the managed
 * list the network with that id, or the one network with that name
 * (findManagedNetwork(): each key only in its own namespace); null while
 * the managed list is loading or failed.
 * @param {string} item - The item ("id:…" or "name:…").
 * @returns {string | null} The name, or null.
 */
export function networkItemLabel(item: string): string | null {
  const key = parseNetworkHistoryItem(item);
  if (key === null) return null;
  const mode = currentNetworksMode();
  if (mode === 'internal') {
    if (key.kind !== 'name') return null;
    const broadcast = state.wlanGroups.some(group => group.ssidList.some(ssid => ssid.ssidName === key.value));
    return broadcast ? displayName(key.value) : null;
  }
  if (mode !== 'managedReady' || state.managedNetworks === null) return null;
  const network = findManagedNetwork(state.managedNetworks, key);
  return network === null ? null : displayName(network.name);
} // End of function networkItemLabel()

/**
 * Tells whether the view's source is settled — the managed list on screen,
 * or the 14a view once management is definitively off — so its
 * Back-history items can be checked against it (networksSourceSettled():
 * not while the managed list is loading or failed, nor while the 14a view
 * is only the fallback of a capability check still running).
 * @returns {boolean} True when settled.
 */
export function isNetworksSourceSettled(): boolean {
  return networksSourceSettled(currentNetworksMode(), networkManagementChecking(managementInput()));
}

/**
 * Where a cross-link to a network (links name networks: the internal data
 * has no ids) leads in this view: the item to select and the search to keep
 * (cleared when it would hide the item), or null when the network is not
 * listed. On the managed list a name several networks share selects none
 * and searches for it instead (all of them listed, none picked); while the
 * managed list is loading or failed the name waits to be resolved.
 * @param {string} name - The network name.
 * @returns {{ item: string | null; search: string } | null} The target (its item "id:…" or "name:…"), or null.
 */
export function networkLinkTarget(name: string): { item: string | null; search: string } | null {
  const mode = currentNetworksMode();
  if (mode === 'internal') {
    const row = buildNetworkRows(state.wlanGroups, state.accessPoints).find(candidate => candidate.name === name);
    if (!row) return null;
    return { item: networkHistoryItem({ kind: 'name', value: row.name }), search: searchKeepingItem(state.networkSearchText, matchesNetworkSearch(row, state.networkSearchText)) };
  }
  if (mode !== 'managedReady' || state.managedNetworks === null) {
    return { item: networkHistoryItem({ kind: 'name', value: name }), search: '' };
  }
  const rows = buildManagedNetworkRows(state.managedNetworks, state.wlanGroups, state.accessPoints).filter(row => row.network.name === name);
  if (rows.length === 0) return null;
  if (rows.length > 1) return { item: null, search: name };
  const search = searchKeepingItem(state.networkSearchText, matchesManagedNetworkSearch(rows[0], state.networkSearchText));
  return { item: networkHistoryItem({ kind: 'id', value: rows[0].network.id }), search };
} // End of function networkLinkTarget()

/**
 * Takes the item of a Back-history location or a followed link as the
 * selection, each key in its own field: a name as the selected name (the
 * 14a view's selection, or resolved by name on the managed list), an id as
 * the managed selection's id (resolved by id only when the managed list
 * renders: syncNetworkSelection()).
 * @param {string | null} item - The item ("id:…" or "name:…"), or null for none.
 */
export function applyNetworkItem(item: string | null): void {
  const key = item === null ? null : parseNetworkHistoryItem(item);
  state.selectedNetworkName = key?.kind === 'name' ? key.value : null;
  state.selectedManagedNetworkId = key?.kind === 'id' ? key.value : null;
}
