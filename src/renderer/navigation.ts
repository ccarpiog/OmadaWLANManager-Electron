// ============================================================================
// Cross-navigation between the views (docs/management-design.md §4.2):
// following a cross-link to an AP (its details pane in the Access points
// view), a group (selected in the AP groups view) or a network (selected in
// the Wi-Fi networks view) pushes the current location — view, item, the
// view's search, list and detail scroll offsets, and the link followed — on
// a Back history; "Back to <previous item>" pops it and brings that view back
// as it was, with focus on the link that was followed. The sidebar starts a
// fresh navigation (the history is emptied). Also re-renders the three
// read-only views together after a data load or a language change, and
// then reconciles the Back history with the loaded data (a location whose
// item is gone is dropped). Pure history helpers: nav-history.ts.
// ============================================================================

import { focusApDetailsHeading, renderApDetails } from './ap-details';
import {
  apDetailsContent,
  apDetailsPanelTitle,
  apList,
  backBar,
  backBtnLabel,
  closeApDetailsBtn,
  groupDetail,
  groupDetailPanelTitle,
  groupList,
  groupSearchInput,
  networkDetail,
  networkDetailPanelTitle,
  networkList,
  networkSearchInput,
} from './elements';
import { focusGroupDetailHeading, renderGroupsView, revealSelectedGroup } from './groups-view';
import { t, tFormat, tGroup } from './i18n';
import {
  buildGroupRows,
  buildNetworkRows,
  matchesGroupSearch,
  matchesNetworkSearch,
  searchKeepingItem,
} from './inventory-model';
import { displayName, findCrossLink } from './inventory-ui';
import {
  isCurrentLocation,
  isLinkKind,
  popLocation,
  pushLocation,
  reconcileHistory,
  sanitizeScroll,
  viewForLink,
  type AppView,
  type LinkTarget,
  type NavLocation,
} from './nav-history';
import { focusNetworkDetailHeading, renderNetworksView, revealSelectedNetwork } from './networks-view';
import { showView } from './shell';
import { state } from './state';

/**
 * Returns the scrolling list and detail containers of a view.
 * @param {AppView} view - The view.
 * @returns {{ list: HTMLElement; detail: HTMLElement }} Its two panes.
 */
function scrollPanes(view: AppView): { list: HTMLElement; detail: HTMLElement } {
  if (view === 'accessPoints') return { list: apList, detail: apDetailsContent };
  if (view === 'groups') return { list: groupList, detail: groupDetail };
  return { list: networkList, detail: networkDetail };
}

/**
 * Returns the item a view currently shows: the AP whose details are open,
 * the selected group id or the selected network name.
 * @param {AppView} view - The view.
 * @returns {string | null} The item, or null.
 */
function currentItem(view: AppView): string | null {
  if (view === 'accessPoints') return state.apDetailsMac;
  if (view === 'groups') return state.selectedGroupId;
  return state.selectedNetworkName;
}

/**
 * Returns the display name of a view's item (for "Back to <name>"), as the
 * loaded data has it now.
 * @param {AppView} view - The view.
 * @param {string | null} item - The item.
 * @returns {string | null} The name, or null when there is no item or it is
 *   no longer loaded (no AP with that MAC, no group with that id, no group
 *   broadcasting that network).
 */
function itemName(view: AppView, item: string | null): string | null {
  if (item === null) return null;
  if (view === 'accessPoints') {
    const ap = state.accessPoints.find(candidate => candidate.mac === item);
    return ap ? displayName(ap.name) : null;
  }
  if (view === 'groups') {
    const group = state.wlanGroups.find(candidate => candidate.wlanId === item);
    return group ? displayName(group.wlanName) : null;
  }
  const broadcast = state.wlanGroups.some(group => group.ssidList.some(ssid => ssid.ssidName === item));
  return broadcast ? displayName(item) : null;
} // End of function itemName()

/**
 * Captures where the user is: the current view, its item, its search, its
 * scroll offsets and the link being followed from it.
 * @param {LinkTarget | null} focusLink - The link being followed, or null.
 * @returns {NavLocation} The location.
 */
function captureLocation(focusLink: LinkTarget | null): NavLocation {
  const view = state.currentView;
  const item = currentItem(view);
  const panes = scrollPanes(view);
  let search = '';
  if (view === 'groups') search = state.groupSearchText;
  if (view === 'networks') search = state.networkSearchText;
  return {
    view,
    item,
    itemLabel: itemName(view, item),
    search,
    listScroll: sanitizeScroll(panes.list.scrollTop),
    detailScroll: sanitizeScroll(panes.detail.scrollTop),
    focusLink,
  };
} // End of function captureLocation()

/**
 * Builds the location a link leads to, or null when its target is no longer
 * loaded. The target view keeps its search unless the search would hide the
 * target in its master list, and its list keeps its scroll offset (the
 * target's item is then scrolled into view).
 * @param {LinkTarget} link - The link.
 * @returns {NavLocation | null} The location, or null.
 */
function locationForLink(link: LinkTarget): NavLocation | null {
  const view = viewForLink(link.kind);
  const listScroll = sanitizeScroll(scrollPanes(view).list.scrollTop);
  const base = { view, item: link.target, itemLabel: null, listScroll, detailScroll: 0, focusLink: null };
  if (link.kind === 'ap') {
    return state.accessPoints.some(ap => ap.mac === link.target) ? { ...base, search: '' } : null;
  }
  if (link.kind === 'group') {
    const row = buildGroupRows(state.wlanGroups, state.accessPoints).find(candidate => candidate.group.wlanId === link.target);
    return row ? { ...base, search: searchKeepingItem(state.groupSearchText, matchesGroupSearch(row, state.groupSearchText)) } : null;
  }
  const row = buildNetworkRows(state.wlanGroups, state.accessPoints).find(candidate => candidate.name === link.target);
  return row ? { ...base, search: searchKeepingItem(state.networkSearchText, matchesNetworkSearch(row, state.networkSearchText)) } : null;
} // End of function locationForLink()

/**
 * Brings a location on screen: shows its view, restores its search and its
 * item (an item no longer loaded is dropped: no AP details, no selection),
 * re-renders the view and restores the scroll offsets of its panes. In the
 * single-pane layout the item's detail is the pane shown (a location with
 * an item is always a detail: cross-links live in the details).
 * @param {NavLocation} location - The location.
 */
function applyLocation(location: NavLocation): void {
  showView(location.view);
  if (location.view === 'accessPoints') {
    const loaded = location.item !== null && state.accessPoints.some(ap => ap.mac === location.item);
    state.apDetailsMac = loaded ? location.item : null;
    state.destinationPaneOpen = false;
    renderApDetails();
  } else if (location.view === 'groups') {
    state.groupSearchText = location.search;
    groupSearchInput.value = location.search;
    state.selectedGroupId = location.item;
    state.groupDetailOpen = location.item !== null;
    renderGroupsView();
  } else {
    state.networkSearchText = location.search;
    networkSearchInput.value = location.search;
    state.selectedNetworkName = location.item;
    state.networkDetailOpen = location.item !== null;
    renderNetworksView();
  }
  const panes = scrollPanes(location.view);
  panes.list.scrollTop = location.listScroll;
  panes.detail.scrollTop = location.detailScroll;
} // End of function applyLocation()

/**
 * Moves keyboard focus to the detail heading of a view (the AP, group or
 * network name).
 * @param {AppView} view - The view.
 * @returns {boolean} True when a heading received focus.
 */
function focusDetailHeading(view: AppView): boolean {
  if (view === 'accessPoints') return focusApDetailsHeading();
  if (view === 'groups') return focusGroupDetailHeading();
  return focusNetworkDetailHeading();
}

/**
 * Scrolls the item a cross-link opened into view in its master list (the
 * AP's row, the group or the network), when it is rendered.
 * @param {AppView} view - The view.
 */
function revealItem(view: AppView): void {
  if (view === 'groups') {
    revealSelectedGroup();
  } else if (view === 'networks') {
    revealSelectedNetwork();
  } else {
    const row = Array.from(apList.querySelectorAll<HTMLElement>('.ap-row')).find(candidate => candidate.dataset.mac === state.apDetailsMac);
    row?.scrollIntoView({ block: 'nearest' });
  }
} // End of function revealItem()

/**
 * The text of "Back to <target>": the location's item name, or the view's
 * name when it showed no item.
 * @param {NavLocation} location - The location to go back to.
 * @returns {string} The target text.
 */
function locationLabel(location: NavLocation): string {
  if (location.itemLabel !== null) return location.itemLabel;
  if (location.view === 'accessPoints') return t('accessPoints');
  if (location.view === 'groups') return tGroup('groupsTitle');
  return t('wifiNetworks');
}

/**
 * Renders the "Back to …" bar above the views: shown while the history has
 * an entry, labelled with the most recent one. (The button always carries a
 * text, also while hidden.)
 */
export function renderBackBar(): void {
  const top = state.navHistory[state.navHistory.length - 1];
  backBar.hidden = top === undefined;
  backBtnLabel.textContent = top === undefined ? t('back') : tFormat('backTo', { target: locationLabel(top) });
}

/**
 * Follows a cross-link: pushes the current location on the Back history,
 * opens the target in its view (selected, scrolled into view) and moves
 * focus to the target's detail heading. A link to where the user already is
 * only moves focus; a link whose target is no longer loaded does nothing.
 * @param {LinkTarget} link - The link.
 */
export function followLink(link: LinkTarget): void {
  const current = captureLocation(link);
  if (isCurrentLocation(current, link)) {
    focusDetailHeading(current.view);
    return;
  }
  const target = locationForLink(link);
  if (target === null) return;
  state.navHistory = pushLocation(state.navHistory, current);
  // The Back bar first: the panes get their final height before scrolling
  renderBackBar();
  applyLocation(target);
  revealItem(target.view);
  focusDetailHeading(target.view);
} // End of function followLink()

/**
 * "Back to …": restores the most recent location of the history (view,
 * item, search, scroll offsets) and returns focus to the link that was
 * followed from it — else to its detail heading, else to its list.
 */
export function goBack(): void {
  const { location, history } = popLocation(state.navHistory);
  if (location === null) return;
  state.navHistory = history;
  // The Back bar first (it may disappear): the panes get their final height
  // before their scroll offsets are restored
  renderBackBar();
  applyLocation(location);
  const panes = scrollPanes(location.view);
  const link = location.focusLink === null ? null : findCrossLink(panes.detail, location.focusLink);
  if (link) {
    link.focus({ preventScroll: true });
    if (document.activeElement === link) return;
  }
  if (focusDetailHeading(location.view)) return;
  const fallback = panes.list.querySelector<HTMLElement>('[tabindex="0"]');
  fallback?.focus({ preventScroll: true });
} // End of function goBack()

/**
 * Sidebar navigation: shows a view and starts a fresh navigation (the Back
 * history is emptied). Each view keeps its own selection and search.
 * @param {AppView} view - The view.
 */
export function navigateToView(view: AppView): void {
  state.navHistory = [];
  showView(view);
  renderBackBar();
}

/**
 * Delegated click handler for every cross-link in the view area (AP
 * details, group and network details).
 * @param {MouseEvent} e - The click event.
 */
export function handleCrossLinkClick(e: MouseEvent): void {
  const button = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.cross-link') : null;
  if (!button) return;
  const kind = button.dataset.linkKind;
  const target = button.dataset.linkTarget;
  if (!isLinkKind(kind) || target === undefined) return;
  followLink({ kind, target });
}

/**
 * Reconciles the Back history with the loaded data (nav-history.ts
 * reconcileHistory()): a location whose AP, group or network is gone is
 * dropped, the remaining item labels follow renames, and nothing on top
 * leads back to where the user is. Runs after the views dropped their own
 * gone selections, so the current place is up to date.
 */
function reconcileNavHistory(): void {
  const view = state.currentView;
  state.navHistory = reconcileHistory(state.navHistory, itemName, { view, item: currentItem(view) });
}

/**
 * Re-renders the three read-only parts together (after a data load, a move,
 * a disconnect or a language change): the AP groups view, the Wi-Fi networks
 * view, the AP details pane and the Back bar. Selections whose item is gone
 * are dropped by the renderers themselves; with data loaded (every
 * successful load ends here), the Back history is then reconciled with it
 * before the Back bar is drawn.
 */
export function renderInventoryViews(): void {
  renderGroupsView();
  renderNetworksView();
  renderApDetails();
  if (state.lastUpdatedAt !== null) {
    reconcileNavHistory();
  }
  renderBackBar();
} // End of function renderInventoryViews()

/**
 * Forgets every view selection, search, single-pane drill-in and the Back
 * history (a disconnect or a connection reset), then re-renders the views.
 */
export function resetInventoryViews(): void {
  state.apDetailsMac = null;
  state.selectedGroupId = null;
  state.selectedNetworkName = null;
  state.destinationPaneOpen = false;
  state.groupDetailOpen = false;
  state.networkDetailOpen = false;
  state.groupSearchText = '';
  state.networkSearchText = '';
  state.navHistory = [];
  groupSearchInput.value = '';
  networkSearchInput.value = '';
  renderInventoryViews();
} // End of function resetInventoryViews()

/**
 * Writes the static texts of the read-only views and the AP details pane in
 * the active language (titles, search placeholders and accessible names,
 * Close), then re-renders them. Called by applyTranslations().
 */
export function applyInventoryTranslations(): void {
  groupSearchInput.placeholder = t('groupSearch');
  groupSearchInput.setAttribute('aria-label', t('groupSearchLabel'));
  groupDetailPanelTitle.textContent = t('groupDetailsTitle');
  networkSearchInput.placeholder = t('networkSearch');
  networkSearchInput.setAttribute('aria-label', t('networkSearchLabel'));
  networkDetailPanelTitle.textContent = t('networkDetailsTitle');
  apDetailsPanelTitle.textContent = t('apDetailsTitle');
  closeApDetailsBtn.textContent = t('closeDetails');
  renderInventoryViews();
} // End of function applyInventoryTranslations()
