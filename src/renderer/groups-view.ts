// ============================================================================
// AP groups view (docs/management-design.md §4.4): a master list (name, AP
// count, network count; the Default badge only for the group the controller
// flags as default; groups without Wi-Fi networks carry the §4.1 empty-group
// label) with its own search over group AND network names, and the selected
// group's detail: an overview, the APs in the group (cross-links to their
// details) with "Move access points here" (the phase-13 move flow over the
// internal API: group-flow.ts preselects the group as the destination in
// the Access points view), and the Wi-Fi networks bound to it (read-only
// cross-links). Only while AP-group management is on (readOnlyReason() gives
// no reason — otherwise the read-only banner explains why and no write
// action is shown): "New group" above the list, Rename and Delete in the
// detail (Delete hidden for the default group, otherwise disabled with the
// reason: has APs, has networks, state unknown, still checking; a group
// whose id main would refuse gets no write action, with a note), the
// per-band capacity from the fresh Open API view (managed-groups.ts; "not
// reported" when absent), and in the master list the Capacity warning
// badge of a group that view reports full (0 remaining) on a band, naming
// the band(s) in its tooltip and accessible text. The actions carry
// data-group-action and are run by group-flow.ts (delegated in
// renderer.ts). Legacy controllers keep the "WLAN groups (legacy)" wording
// through tGroup(). Until data is loaded the list shows the §4.6 state
// (content-state.ts). In the single-pane layout (700–799 px) picking a group
// drills into its detail, whose Back returns to the list (layout.ts). Pure
// logic: inventory-model.ts, group-management.ts.
// ============================================================================

import type { ManagedApGroup, WlanGroup } from '../shared/types';
import { createStatusElement } from './ap-status';
import { createStateBlock, currentContentState } from './content-state';
import { createEmptyState } from './dom-helpers';
import { groupDetail, groupList, groupListActions, groupListSummary, groupSearchInput } from './elements';
import {
  capacityRows,
  capacityText,
  deleteBlockKey,
  deleteBlocks,
  fullCapacityBands,
  groupErrorKey,
  isWritableGroupId,
  type CapacityBand,
} from './group-management';
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
import { isAmbiguousGroup } from './move-plan';
import { networkCountText } from './move-text';
import { state } from './state';
import { readOnlyReason } from './view-state';

// Id of the detail's heading (the group's name)
const HEADING_ID = 'groupDetailName';

// Ids of the action controls (stable, so focus can return to them after a
// re-render or a reload)
export const NEW_GROUP_BUTTON_ID = 'newGroupBtn';
export const RENAME_BUTTON_ID = 'groupRenameBtn';
const DELETE_BUTTON_ID = 'groupDeleteBtn';
const MOVE_HERE_BUTTON_ID = 'groupMoveHereBtn';
const DELETE_REASON_ID = 'groupDeleteReason';
const MOVE_HERE_REASON_ID = 'groupMoveHereReason';

// The label of each capacity band
const BAND_LABELS: Record<CapacityBand, 'band2g' | 'band5g' | 'band6g' | 'bandMlo'> = {
  band2g: 'band2g',
  band5g: 'band5g',
  band6g: 'band6g',
  mlo: 'bandMlo',
};

/**
 * Tells whether AP-group management is on for the data on screen: connected
 * with a session nonce, and readOnlyReason() — the read-only banner's one
 * source — gives no reason (Omada 6.3+ and every management check passed).
 * The write actions and the capacity exist only then.
 * @returns {boolean} True while management is on.
 */
export function isGroupManagementOn(): boolean {
  if (!state.isConnected || state.sessionNonce === null) return false;
  return readOnlyReason({ hasData: state.lastUpdatedAt !== null, groupModel: state.groupModel, capabilities: state.managementCapabilities }) === null;
}

/**
 * Returns the selected group, when it is still loaded.
 * @returns {WlanGroup | null} The group, or null.
 */
function selectedGroup(): WlanGroup | null {
  return state.wlanGroups.find(group => group.wlanId === state.selectedGroupId) ?? null;
}

/**
 * Returns the fresh Open API view of a group, when it was read.
 * @param {string} groupId - The group id.
 * @returns {ManagedApGroup | undefined} The view, or undefined.
 */
function managedGroup(groupId: string): ManagedApGroup | undefined {
  return state.managedApGroups?.find(group => group.id === groupId);
}

/**
 * Builds one action button of the view (its click is delegated: renderer.ts
 * hands data-group-action to group-flow.ts).
 * @param {string} id - The button id.
 * @param {string} action - Its data-group-action value.
 * @param {string} label - Its text.
 * @param {string} variant - Its extra classes.
 * @returns {HTMLButtonElement} The button.
 */
function createActionButton(id: string, action: string, label: string, variant: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = id;
  button.className = `btn btn-compact ${variant}`;
  button.dataset.groupAction = action;
  button.textContent = label;
  // A write in flight (its dialog is open) disables the actions
  button.disabled = state.isManagingApGroup;
  return button;
} // End of function createActionButton()

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
 * Renders the master list's action slot: "New group" while AP-group
 * management is on (nothing otherwise). Keyboard focus on it survives the
 * re-render.
 */
function renderGroupListActions(): void {
  const focusedId = focusedIdInside(groupListActions);
  if (!isGroupManagementOn()) {
    groupListActions.replaceChildren();
    return;
  }
  groupListActions.replaceChildren(createActionButton(NEW_GROUP_BUTTON_ID, 'create', t('newGroup'), 'btn-primary'));
  if (focusedId !== null) {
    focusById(focusedId);
  }
} // End of function renderGroupListActions()

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
 * Builds the Capacity warning badge of a master item (spec §4.4): its
 * visible label, the bands that are full in its tooltip and in visually
 * hidden text (part of the item's accessible name), and the bands as
 * data-bands.
 * @param {CapacityBand[]} bands - The full bands (fullCapacityBands(), not empty).
 * @returns {HTMLSpanElement} The badge.
 */
function createCapacityBadge(bands: CapacityBand[]): HTMLSpanElement {
  const labels = bands.map(band => t(BAND_LABELS[band]));
  const detail = tFormat('capacityWarningDetail', { bands: new Intl.ListFormat(state.currentLanguage, { type: 'conjunction' }).format(labels) });
  const badge = createBadge(t('capacityWarningBadge'), 'badge-capacity');
  badge.title = detail;
  badge.dataset.bands = bands.join(' ');
  const hidden = document.createElement('span');
  hidden.className = 'visually-hidden';
  hidden.textContent = ` (${detail})`;
  badge.appendChild(hidden);
  return badge;
} // End of function createCapacityBadge()

/**
 * Builds one master item: a native button (the current one carries
 * aria-current="true") with the group name, the Default badge when the
 * controller flags it, the Capacity warning badge while AP-group management
 * is on and the fresh view reports a band of the group full, and the counts
 * line.
 * @param {GroupRow} row - The group's row.
 * @param {boolean} managing - AP-group management is on (isGroupManagementOn()).
 * @returns {HTMLLIElement} The list item.
 */
function createGroupItem(row: GroupRow, managing: boolean): HTMLLIElement {
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
  // Like the detail's capacity section: only while management is on, from
  // the fresh view (none read yet: no badge)
  const fullBands = managing ? fullCapacityBands(managedGroup(row.group.wlanId)) : [];
  if (fullBands.length > 0) {
    header.appendChild(createCapacityBadge(fullBands));
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
 * The "New group" slot above it follows the management state. Keyboard
 * focus on an item survives the re-render.
 */
export function renderGroupList(): void {
  const active = document.activeElement;
  const focusedId = active instanceof HTMLButtonElement && groupList.contains(active) ? active.dataset.groupId ?? null : null;
  groupList.setAttribute('aria-label', tGroup('groupsTitle'));
  renderGroupListActions();

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
    const managing = isGroupManagementOn();
    list.replaceChildren(...visible.map(row => createGroupItem(row, managing)));
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
 * Builds "Move access points here" (spec §4.1 / §4.4): it opens the Access
 * points view with the group as the destination of the phase-13 move flow.
 * A group whose name another group shares cannot be a destination (its APs
 * cannot be told apart): the button is then disabled with that reason.
 * @param {WlanGroup} group - The group.
 * @returns {HTMLElement[]} The button, and the reason when disabled.
 */
function createMoveHereBlock(group: WlanGroup): HTMLElement[] {
  const button = createActionButton(MOVE_HERE_BUTTON_ID, 'moveHere', t('moveApsHere'), 'btn-secondary detail-section-action');
  if (!isAmbiguousGroup(group, state.wlanGroups)) {
    return [button];
  }
  button.disabled = true;
  button.setAttribute('aria-describedby', MOVE_HERE_REASON_ID);
  const reason = createNote(t('destinationAmbiguous'), 'moveHereBlocked');
  reason.id = MOVE_HERE_REASON_ID;
  return [button, reason];
} // End of function createMoveHereBlock()

/**
 * Builds the APs section of the detail: "Move access points here", then the
 * members as cross-links with their status, "No access points are in this
 * group", or — for a name another group shares — why the members cannot be
 * told.
 * @param {WlanGroup} group - The group.
 * @returns {HTMLElement} The section.
 */
function createApsSection(group: WlanGroup): HTMLElement {
  const moveHere = createMoveHereBlock(group);
  const members = groupMembers(group, state.wlanGroups, state.accessPoints);
  if (members === null) {
    return createDetailSection('aps', t('accessPoints'), [...moveHere, createNote(t('groupAmbiguousAps'), 'ambiguous')]);
  }
  const title = `${t('accessPoints')} (${members.length})`;
  if (members.length === 0) {
    return createDetailSection('aps', title, [...moveHere, createNote(t('noApsInGroup'), 'noAps')]);
  }
  const rows = members.map(ap => [createCrossLink(apLink(ap), ap.name), createStatusElement(ap.statusCategory)]);
  return createDetailSection('aps', title, [...moveHere, createLinkList(rows)]);
} // End of function createApsSection()

/**
 * Builds the detail's write actions (AP-group management on only): Rename
 * and Delete. Delete is hidden for the default group (deleteBlocks() gives
 * null, spec §4.4); otherwise it is disabled, with the reasons as a visible
 * note it is described by, while deleteBlocks() gives any. A group whose id
 * main would refuse (not 24 hex digits) gets a note instead of the buttons.
 * @param {GroupRow} row - The group's row (internal data).
 * @returns {HTMLElement[]} The actions and their notes.
 */
function createWriteActions(row: GroupRow): HTMLElement[] {
  if (!isWritableGroupId(row.group.wlanId)) {
    return [createNote(t('groupNotWritable'), 'notWritable')];
  }
  const actions = document.createElement('div');
  actions.className = 'detail-actions';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', t('groupActionsLabel'));
  actions.appendChild(createActionButton(RENAME_BUTTON_ID, 'rename', t('renameGroup'), 'btn-secondary'));

  const blocks = deleteBlocks({
    managed: managedGroup(row.group.wlanId),
    managedStatus: state.managedGroupsStatus,
    isDefault: row.isDefault,
    apCount: row.apCount,
    networkCount: row.networks.length,
  });
  if (blocks === null) {
    return [actions];
  }
  const remove = createActionButton(DELETE_BUTTON_ID, 'delete', t('deleteGroup'), 'btn-danger-outline');
  actions.appendChild(remove);
  if (blocks.length === 0) {
    return [actions];
  }
  remove.disabled = true;
  remove.setAttribute('aria-describedby', DELETE_REASON_ID);
  const reason = createNote(blocks.map(block => t(deleteBlockKey(block))).join(' '), 'deleteBlocked');
  reason.id = DELETE_REASON_ID;
  reason.dataset.blocks = blocks.join(' ');
  return [actions, reason];
} // End of function createWriteActions()

/**
 * Builds the per-band capacity section (AP-group management on only): one
 * row per band (2.4 / 5 / 6 GHz, MLO) with how many more Wi-Fi networks the
 * group can take and the per-group limit, "Not reported" for what main did
 * not report; while the fresh view is read, "Reading…"; when it could not be
 * read, the reason.
 * @param {WlanGroup} group - The group.
 * @returns {HTMLElement} The section.
 */
function createCapacitySection(group: WlanGroup): HTMLElement {
  const title = t('capacityTitle');
  const failure = state.managedGroupsFailure;
  if (state.managedGroupsStatus === 'failed' && failure !== null) {
    const reason = t(groupErrorKey(failure.error));
    const text = tFormat('capacityFailed', { reason: failure.diagnostic === null ? reason : `${reason} (${failure.diagnostic})` });
    return createDetailSection('capacity', title, [createNote(text, 'capacityFailed')]);
  }
  if (state.managedApGroups === null) {
    return createDetailSection('capacity', title, [createNote(t('capacityLoading'), 'capacityLoading')]);
  }
  const list = document.createElement('dl');
  list.className = 'detail-facts capacity-list';
  for (const row of capacityRows(managedGroup(group.wlanId), state.managedSsidLimits)) {
    const fact = document.createElement('div');
    fact.className = row.remaining === null ? 'detail-fact is-unreported' : 'detail-fact';
    fact.dataset.fact = row.band;
    const label = document.createElement('dt');
    label.textContent = t(BAND_LABELS[row.band]);
    const value = document.createElement('dd');
    const text = capacityText(row);
    value.textContent = tFormat(text.key, text.vars);
    fact.append(label, value);
    list.appendChild(fact);
  } // End of the loop over the bands
  return createDetailSection('capacity', title, [createNote(t('capacityHelp'), 'capacityHelp'), list]);
} // End of function createCapacitySection()

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
 * cleared (the single-pane layout then shows the list again). While AP-group
 * management is on it adds the write actions under the overview and the
 * per-band capacity at the end. Keyboard focus on a cross-link, an action
 * or the heading survives the re-render (an action that is now disabled
 * hands it to the heading).
 */
export function renderGroupDetail(): void {
  const group = selectedGroup();
  if (group === null) {
    state.selectedGroupId = null;
  }
  applyPaneLayout();
  const focusLink = focusedCrossLink(groupDetail);
  const focusedId = focusedIdInside(groupDetail);

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

  const managing = isGroupManagementOn();
  groupDetail.replaceChildren(
    header,
    summary,
    ...(managing ? createWriteActions(row) : []),
    createApsSection(group),
    createNetworksSection(row),
    ...(managing ? [createCapacitySection(group)] : [])
  );

  const link = focusLink === null ? null : findCrossLink(groupDetail, focusLink);
  if (link) {
    link.focus({ preventScroll: true });
  } else if (focusedId !== null && !focusById(focusedId)) {
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

/**
 * Moves keyboard focus to a group's master item (made the list's Tab stop
 * and scrolled into view), when it is rendered.
 * @param {string} groupId - The group id.
 * @returns {boolean} True when the item received focus.
 */
export function focusGroupItem(groupId: string): boolean {
  const item = Array.from(groupList.querySelectorAll<HTMLButtonElement>('.master-item')).find(candidate => candidate.dataset.groupId === groupId);
  if (!item) {
    return false;
  }
  item.scrollIntoView({ block: 'nearest' });
  focusMasterItem(groupList, item);
  return document.activeElement === item;
} // End of function focusGroupItem()

/**
 * Moves keyboard focus into the AP groups list when the control that had
 * it is gone (e.g. a deleted group's detail): the list's Tab stop, else
 * "New group", else the search field. In the single-pane layout the list
 * is brought back first.
 */
export function focusGroupListFallback(): void {
  state.groupDetailOpen = false;
  applyPaneLayout();
  const tabStop = groupList.querySelector<HTMLButtonElement>('.master-item[tabindex="0"]');
  if (tabStop) {
    focusMasterItem(groupList, tabStop);
  } else if (!focusById(NEW_GROUP_BUTTON_ID)) {
    groupSearchInput.focus();
  }
} // End of function focusGroupListFallback()
