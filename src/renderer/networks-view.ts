// ============================================================================
// Wi-Fi networks view (docs/management-design.md §4.5), read-only from the
// internal data: a master list of the distinct network names (the sidebar's
// count) with each network's scope "N groups · M APs" (a lower bound, with
// the reason, while some APs' groups cannot be identified), its own search
// over network AND group names, and the selected network's detail: the
// groups broadcasting it and the APs that broadcast it, as cross-links. The
// internal data has no security, bands or enabled state, so the detail says
// they need management access instead of inventing them; there are no edit
// controls (phases 17–19). Pure logic: inventory-model.ts.
// ============================================================================

import { createStatusElement } from './ap-status';
import { createEmptyState, createLoadingState } from './dom-helpers';
import { networkDetail, networkList, networkListSummary, networkSearchInput } from './elements';
import { t, tFormat, tGroup } from './i18n';
import {
  apLink,
  buildNetworkRows,
  filterNetworkRows,
  groupLink,
  groupMembers,
  networkBroadcasters,
  type NetworkBroadcasters,
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
 * Renders the master list for the current data and search, and the aria-live
 * results summary ("Showing N of M" while a search narrows the list). Before
 * any data is loaded it shows the loading spinner (first load) or the
 * connect / configure hint. Keyboard focus on an item survives the re-render.
 */
export function renderNetworkList(): void {
  const active = document.activeElement;
  const focusedName = active instanceof HTMLButtonElement && networkList.contains(active) ? active.dataset.networkName ?? null : null;
  networkList.setAttribute('aria-label', t('wifiNetworks'));

  if (state.lastUpdatedAt === null) {
    const hint = state.hasStoredConfig ? t('connectToSeeNetworks') : t('configureHint');
    networkList.replaceChildren(state.isLoadingData ? createLoadingState() : createEmptyState(hint));
    setLiveText(networkListSummary, '');
    return;
  }
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
} // End of function renderNetworkList()

/**
 * Builds the APs section of a network's detail: the APs that broadcast it
 * as cross-links with their status, then — when some APs may broadcast it
 * but their group cannot be identified — a note saying how many (the
 * title then carries no count, and "no access points" is never stated);
 * with every AP placed and none broadcasting it, the no-APs note.
 * @param {NetworkBroadcasters} broadcasters - The network's broadcasters.
 * @returns {HTMLElement} The section.
 */
function createApsSection(broadcasters: NetworkBroadcasters): HTMLElement {
  const { aps, unknownApCount } = broadcasters;
  const content: HTMLElement[] = [];
  if (aps.length > 0) {
    content.push(createLinkList(aps.map(ap => [createCrossLink(apLink(ap), ap.name), createStatusElement(ap.statusCategory)])));
  }
  if (unknownApCount > 0) {
    const note = unknownApCount === 1 ? t('networkUnknownApsOne') : tFormat('networkUnknownApsMany', { count: String(unknownApCount) });
    content.push(createNote(note, 'unknownAps'));
    return createDetailSection('aps', t('accessPoints'), content);
  }
  if (aps.length === 0) {
    content.push(createNote(t('networkNoAps'), 'noAps'));
  }
  return createDetailSection('aps', `${t('accessPoints')} (${aps.length})`, content);
} // End of function createApsSection()

/**
 * Renders the selected network's detail (a prompt while none is selected;
 * nothing before data is loaded): its scope, the groups broadcasting it
 * (each with its AP count), the APs that broadcast it with the APs whose
 * group cannot be identified stated in the same section, and that
 * security, bands and enabled state need management access. A selection no
 * group broadcasts any more is cleared. Keyboard focus on a cross-link or
 * the heading survives the re-render.
 */
export function renderNetworkDetail(): void {
  const name = state.selectedNetworkName;
  const broadcasters = name === null ? null : networkBroadcasters(name, state.wlanGroups, state.accessPoints);
  if (broadcasters === null) {
    state.selectedNetworkName = null;
  }
  const focusLink = focusedCrossLink(networkDetail);
  const headingFocused = document.activeElement?.id === HEADING_ID;

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
    createApsSection(broadcasters),
    createNote(t('networkManagementOnly'), 'managementOnly'),
  );

  const link = focusLink === null ? null : findCrossLink(networkDetail, focusLink);
  if (link) {
    link.focus({ preventScroll: true });
  } else if (headingFocused) {
    focusById(HEADING_ID);
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
 * Selects a network (or none): marks its master item as current (the list
 * is not re-rendered, so focus stays put) and renders its detail.
 * @param {string | null} name - The network name, or null.
 */
export function selectNetwork(name: string | null): void {
  state.selectedNetworkName = name;
  for (const item of networkList.querySelectorAll<HTMLButtonElement>('.master-item')) {
    if (item.dataset.networkName === name) {
      item.setAttribute('aria-current', 'true');
    } else {
      item.removeAttribute('aria-current');
    }
  }
  renderNetworkDetail();
} // End of function selectNetwork()

/**
 * Delegated click handler of the master list: a click on an item selects
 * its network (it stays the list's Tab stop).
 * @param {MouseEvent} e - The click event.
 */
export function handleNetworkListClick(e: MouseEvent): void {
  const item = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.master-item') : null;
  if (!item || !networkList.contains(item) || item.dataset.networkName === undefined) return;
  selectNetwork(item.dataset.networkName);
  focusMasterItem(networkList, item);
}

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
 * Scrolls the selected network's master item into view, when rendered.
 */
export function revealSelectedNetwork(): void {
  const item = networkList.querySelector<HTMLButtonElement>('.master-item[aria-current="true"]');
  item?.scrollIntoView({ block: 'nearest' });
}
