// ============================================================================
// AP groups view (docs/management-design.md §4.4), read-only from the
// internal data: a master list (name, AP count, network count; the Default
// badge only for the group the controller flags as default; groups without
// Wi-Fi networks carry the §4.1 empty-group label) with its own search over
// group AND network names, and the selected group's detail: an overview, the
// APs in the group (cross-links to their details) and the Wi-Fi networks
// bound to it (cross-links to the network). No rename / new / delete
// controls (phase 16) and no per-band capacity (not loaded). Legacy
// controllers keep the "WLAN groups (legacy)" wording through tGroup().
// Until data is loaded the list shows the §4.6 state (content-state.ts). In
// the single-pane layout (700–799 px) picking a group drills into its
// detail, whose Back returns to the list (layout.ts). Pure logic:
// inventory-model.ts.
// ============================================================================

import type { WlanGroup } from '../shared/types';
import { createStatusElement } from './ap-status';
import { createStateBlock, currentContentState } from './content-state';
import { createEmptyState } from './dom-helpers';
import { groupDetail, groupList, groupListSummary, groupSearchInput } from './elements';
import { t, tFormat, tGroup } from './i18n';
import {
  apLink,
  buildGroupRows,
  filterGroupRows,
  groupMembers,
  networkLink,
  type GroupRow,
} from './inventory-model';
import {
  apCountOrUnknown,
  applyMasterRovingTabindex,
  createBadge,
  createCrossLink,
  createDetailHeading,
  createDetailSection,
  createLinkList,
  createNote,
  createSearchNoResults,
  displayName,
  findCrossLink,
  focusById,
  focusedCrossLink,
  focusMasterItem,
  handleMasterListKeydown,
  setLiveText,
} from './inventory-ui';
import { applyPaneLayout, isSinglePane } from './layout';
import { networkCountText } from './move-text';
import { state } from './state';

// Id of the detail's heading (the group's name)
const HEADING_ID = 'groupDetailName';

/**
 * Returns the selected group, when it is still loaded.
 * @returns {WlanGroup | null} The group, or null.
 */
function selectedGroup(): WlanGroup | null {
  return state.wlanGroups.find(group => group.wlanId === state.selectedGroupId) ?? null;
}

/**
 * Builds the counts line of a group: "N APs · M networks", or the AP count
 * followed by the strong §4.1 empty-group label for a group without networks.
 * @param {GroupRow} row - The group's row.
 * @param {string} className - The element's class.
 * @returns {HTMLSpanElement} The counts element.
 */
function createGroupCounts(row: GroupRow, className: string): HTMLSpanElement {
  const counts = document.createElement('span');
  counts.className = className;
  const aps = document.createElement('span');
  aps.className = 'group-ap-count';
  aps.textContent = apCountOrUnknown(row.apCount);
  counts.appendChild(aps);
  const networks = document.createElement('span');
  networks.className = row.isEmpty ? 'group-network-count is-silence' : 'group-network-count';
  networks.textContent = ` · ${row.isEmpty ? t('emptyGroup') : networkCountText(row.networks.length)}`;
  counts.appendChild(networks);
  counts.title = counts.textContent ?? '';
  return counts;
} // End of function createGroupCounts()

/**
 * Builds one master item: a native button (the current one carries
 * aria-current="true") with the group name, the Default badge when the
 * controller flags it, and the counts line.
 * @param {GroupRow} row - The group's row.
 * @returns {HTMLLIElement} The list item.
 */
function createGroupItem(row: GroupRow): HTMLLIElement {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'master-item';
  button.dataset.groupId = row.group.wlanId;
  button.tabIndex = -1;
  if (row.group.wlanId === state.selectedGroupId) {
    button.setAttribute('aria-current', 'true');
  }
  const header = document.createElement('span');
  header.className = 'master-item-header';
  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = displayName(row.group.wlanName);
  header.appendChild(name);
  if (row.isDefault) {
    header.appendChild(createBadge(t('badgeDefault'), 'badge-default'));
  }
  button.appendChild(header);
  button.appendChild(createGroupCounts(row, 'item-subtitle master-item-meta'));
  item.appendChild(button);
  return item;
} // End of function createGroupItem()

/**
 * Renders the master list for the current data and search, and the aria-live
 * results summary ("Showing N of M" while a search narrows the list). Before
 * any data is loaded it shows the view's §4.6 state (first run,
 * disconnected, loading skeleton or initial-load error, with its action).
 * Keyboard focus on an item survives the re-render.
 */
export function renderGroupList(): void {
  const active = document.activeElement;
  const focusedId = active instanceof HTMLButtonElement && groupList.contains(active) ? active.dataset.groupId ?? null : null;
  groupList.setAttribute('aria-label', tGroup('groupsTitle'));

  const contentState = currentContentState();
  if (contentState !== 'ready') {
    groupList.replaceChildren(createStateBlock('groups', contentState));
    setLiveText(groupListSummary, '');
    return;
  }
  if (state.wlanGroups.length === 0) {
    groupList.replaceChildren(createEmptyState(tGroup('noGroups')));
    setLiveText(groupListSummary, '');
    return;
  }

  const rows = buildGroupRows(state.wlanGroups, state.accessPoints);
  const visible = filterGroupRows(rows, state.groupSearchText);
  if (visible.length === 0) {
    const message = tFormat('noMatchingGroups', { query: state.groupSearchText.trim() });
    groupList.replaceChildren(createSearchNoResults(message, 'clearGroupSearchBtn', clearGroupSearch));
  } else {
    const list = document.createElement('ul');
    list.className = 'master-items';
    list.replaceChildren(...visible.map(createGroupItem));
    groupList.replaceChildren(list);
    applyMasterRovingTabindex(groupList);
  }
  const searching = state.groupSearchText.trim() !== '';
  setLiveText(groupListSummary, searching ? tFormat('searchResultsCount', { shown: String(visible.length), total: String(rows.length) }) : '');

  if (focusedId !== null) {
    const button = Array.from(groupList.querySelectorAll<HTMLButtonElement>('.master-item')).find(item => item.dataset.groupId === focusedId);
    if (button) focusMasterItem(groupList, button);
  }
} // End of function renderGroupList()

/**
 * Builds the APs section of the detail: the members as cross-links with
 * their status, "No access points are in this group", or — for a name
 * another group shares — why the members cannot be told.
 * @param {WlanGroup} group - The group.
 * @returns {HTMLElement} The section.
 */
function createApsSection(group: WlanGroup): HTMLElement {
  const members = groupMembers(group, state.wlanGroups, state.accessPoints);
  if (members === null) {
    return createDetailSection('aps', t('accessPoints'), [createNote(t('groupAmbiguousAps'), 'ambiguous')]);
  }
  const title = `${t('accessPoints')} (${members.length})`;
  if (members.length === 0) {
    return createDetailSection('aps', title, [createNote(t('noApsInGroup'), 'noAps')]);
  }
  const rows = members.map(ap => [createCrossLink(apLink(ap), ap.name), createStatusElement(ap.statusCategory)]);
  return createDetailSection('aps', title, [createLinkList(rows)]);
} // End of function createApsSection()

/**
 * Builds the networks section of the detail: the networks bound to the
 * group as read-only cross-links, or the strong empty-group label.
 * @param {GroupRow} row - The group's row.
 * @returns {HTMLElement} The section.
 */
function createNetworksSection(row: GroupRow): HTMLElement {
  const title = `${t('wifiNetworks')} (${row.networks.length})`;
  if (row.isEmpty) {
    return createDetailSection('networks', title, [createNote(t('emptyGroup'), 'emptyGroup', 'is-silence')]);
  }
  const rows = row.networks.map(name => [createCrossLink(networkLink(name), name)]);
  return createDetailSection('networks', title, [createLinkList(rows)]);
}

/**
 * Renders the selected group's detail (a prompt while none is selected;
 * nothing before data is loaded). A selection whose group is gone is
 * cleared (the single-pane layout then shows the list again). Keyboard
 * focus on a cross-link or the heading survives the re-render.
 */
export function renderGroupDetail(): void {
  const group = selectedGroup();
  if (group === null) {
    state.selectedGroupId = null;
  }
  applyPaneLayout();
  const focusLink = focusedCrossLink(groupDetail);
  const headingFocused = document.activeElement?.id === HEADING_ID;

  if (group === null) {
    groupDetail.replaceChildren(...(state.lastUpdatedAt === null || state.wlanGroups.length === 0 ? [] : [createEmptyState(t('groupDetailPrompt'))]));
    return;
  }
  const row = buildGroupRows(state.wlanGroups, state.accessPoints).find(candidate => candidate.group.wlanId === group.wlanId);
  if (row === undefined) return;

  const header = document.createElement('div');
  header.className = 'detail-header';
  header.appendChild(createDetailHeading(HEADING_ID, group.wlanName));
  if (row.isDefault) {
    header.appendChild(createBadge(t('badgeDefault'), 'badge-default'));
  }
  const summary = document.createElement('p');
  summary.className = 'detail-summary';
  summary.appendChild(createGroupCounts(row, 'detail-counts'));

  groupDetail.replaceChildren(header, summary, createApsSection(group), createNetworksSection(row));

  const link = focusLink === null ? null : findCrossLink(groupDetail, focusLink);
  if (link) {
    link.focus({ preventScroll: true });
  } else if (headingFocused) {
    focusById(HEADING_ID);
  }
} // End of function renderGroupDetail()

/**
 * Renders the whole view: the master list and the detail.
 */
export function renderGroupsView(): void {
  renderGroupList();
  renderGroupDetail();
}

/**
 * Selects a group (or none): marks its master item as current (the list is
 * not re-rendered, so focus stays put) and renders its detail.
 * @param {string | null} groupId - The group id, or null.
 */
export function selectGroup(groupId: string | null): void {
  state.selectedGroupId = groupId;
  for (const item of groupList.querySelectorAll<HTMLButtonElement>('.master-item')) {
    if (item.dataset.groupId === groupId) {
      item.setAttribute('aria-current', 'true');
    } else {
      item.removeAttribute('aria-current');
    }
  }
  renderGroupDetail();
} // End of function selectGroup()

/**
 * Delegated click handler of the master list (Enter and Space too: the
 * items are buttons): a click on an item selects its group, and it stays
 * the list's Tab stop. In the single-pane layout the group's detail
 * replaces the list, with focus on its heading.
 * @param {MouseEvent} e - The click event.
 */
export function handleGroupListClick(e: MouseEvent): void {
  const item = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.master-item') : null;
  if (!item || !groupList.contains(item) || item.dataset.groupId === undefined) return;
  state.groupDetailOpen = true;
  selectGroup(item.dataset.groupId);
  if (isSinglePane()) {
    for (const other of groupList.querySelectorAll<HTMLButtonElement>('.master-item')) {
      other.tabIndex = other === item ? 0 : -1;
    }
    focusGroupDetailHeading();
  } else {
    focusMasterItem(groupList, item);
  }
} // End of function handleGroupListClick()

/**
 * Single-pane layout: the detail's Back — the list comes back with focus on
 * the selected group (still selected), else on the search field.
 */
export function closeGroupDetailPane(): void {
  state.groupDetailOpen = false;
  applyPaneLayout();
  const item = groupList.querySelector<HTMLButtonElement>('.master-item[aria-current="true"]');
  if (item) {
    focusMasterItem(groupList, item);
  } else {
    groupSearchInput.focus();
  }
} // End of function closeGroupDetailPane()

/**
 * Keydown handler of the master list (arrow keys, Home, End).
 * @param {KeyboardEvent} e - The keydown event.
 */
export function handleGroupListKeydown(e: KeyboardEvent): void {
  handleMasterListKeydown(e, groupList);
}

/**
 * Input handler of the view's search (group and network names).
 */
export function handleGroupSearchInput(): void {
  state.groupSearchText = groupSearchInput.value;
  renderGroupList();
}

/**
 * Empties the search, re-renders the list and returns focus to the search
 * field (Escape in the field, "Clear search").
 */
export function clearGroupSearch(): void {
  groupSearchInput.value = '';
  state.groupSearchText = '';
  renderGroupList();
  groupSearchInput.focus();
}

/**
 * Keydown handler of the search: Escape clears a non-empty search.
 * @param {KeyboardEvent} e - The keydown event.
 */
export function handleGroupSearchKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && groupSearchInput.value !== '') {
    e.preventDefault();
    clearGroupSearch();
  }
}

/**
 * Moves keyboard focus to the detail's heading (the selected group's name).
 * @returns {boolean} True when the heading received focus.
 */
export function focusGroupDetailHeading(): boolean {
  return focusById(HEADING_ID);
}

/**
 * Scrolls the selected group's master item into view, when rendered.
 */
export function revealSelectedGroup(): void {
  const item = groupList.querySelector<HTMLButtonElement>('.master-item[aria-current="true"]');
  item?.scrollIntoView({ block: 'nearest' });
}
