// ============================================================================
// Access points list (docs/management-design.md §4.3, list part): filters
// (search, status, group), rows with a native checkbox each, multi-select
// with Shift-click / Shift+Arrow ranges, "Select all N filtered APs", "Clear
// selection", and the selection summary ("3 selected (1 hidden by filters)")
// announced through an aria-live region. The selection lives in
// state.selectedApMacs and survives filtering; the pure logic is in
// ap-selection.ts. Every selection or filter change also refreshes the
// destination pane's move preview (destination-pane.ts). Row clicks toggle
// the checkbox (an AP details pane is planned for phase 14, todo.md 4.7).
// ============================================================================

import type { AccessPoint, WlanGroup } from '../shared/types';
import { currentApFilters, visibleApMacs } from './ap-filters';
import {
  applySelection,
  countSelection,
  filterAccessPoints,
  GROUP_FILTER_ALL,
  GROUP_FILTER_UNASSIGNED,
  indexGroupsByName,
  isFilterActive,
  networkCountFor,
  planRangeSelection,
  STATUS_FILTER_ALL,
  STATUS_FILTER_UNKNOWN,
} from './ap-selection';
import { renderMovePreview } from './destination-pane';
import { createEmptyState } from './dom-helpers';
import {
  apFilterInput,
  apGroupFilterSelect,
  apList,
  apSelectionSummary,
  apSelectionToolbar,
  apStatusFilterSelect,
  clearApSelectionBtn,
  selectAllApsBtn,
} from './elements';
import { t, tFormat, tGroup, type Translations } from './i18n';
import { state } from './state';

/**
 * Presentation for each Omada AP `statusCategory`, keyed by the numeric value
 * the controller reports:
 *
 *   0 disconnected — the controller has lost the AP entirely
 *   1 connected    — normal working state
 *   2 pending      — being adopted; reachable but not yet managed
 *   3 heartbeat missed — adopted, but the controller stopped hearing from it
 *   4 isolated     — adopted and reachable, but cut off from its uplink
 *
 * Previously categories 1 and 2 were both painted green as "online" and
 * everything else red as "offline", which claimed a pending AP was working and
 * hid the difference between a dead AP and one that had merely gone quiet.
 * Each state now gets its own colour and its own label (see the statusAp*
 * translation keys).
 */
const AP_STATUS: Record<number, { className: string; labelKey: keyof Translations }> = {
  0: { className: 'offline', labelKey: 'statusApDisconnected' },
  1: { className: 'online', labelKey: 'statusApConnected' },
  2: { className: 'pending', labelKey: 'statusApPending' },
  3: { className: 'warning', labelKey: 'statusApHeartbeatMissed' },
  4: { className: 'isolated', labelKey: 'statusApIsolated' },
};

// Order of the per-status options in the status filter
const STATUS_FILTER_ORDER = [1, 2, 3, 4, 0];

/**
 * Maps an AP's `statusCategory` to its colour class and label key, falling
 * back to a neutral "unknown" state for any value the controller reports that
 * is not in AP_STATUS — a newer firmware adding a category must not make an AP
 * look disconnected.
 * @param {number} statusCategory - The category reported by the controller.
 * @returns {{ className: string; labelKey: keyof Translations }} Presentation
 *   for that state.
 */
function getApStatus(statusCategory: number): { className: string; labelKey: keyof Translations } {
  return AP_STATUS[statusCategory] ?? { className: 'unknown', labelKey: 'statusApUnknown' };
} // End of function getApStatus()

// ============================================================================
// Filters (the current filters themselves are read by ap-filters.ts)
// ============================================================================

/**
 * Creates one <option> element.
 * @param {string} value - The option value.
 * @param {string} label - The visible label.
 * @returns {HTMLOptionElement} The option.
 */
function createOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

/**
 * Rebuilds the status and group filter options in the active language: every
 * status (plus "unknown"), and every loaded group (plus "Unassigned" when an
 * AP has no group). A group filter whose group is gone after a reload falls
 * back to "All groups". Called after each data load, on clearing the data,
 * and by applyTranslations().
 */
export function renderApFilterOptions(): void {
  apStatusFilterSelect.replaceChildren(
    createOption(STATUS_FILTER_ALL, t('statusFilterAll')),
    ...STATUS_FILTER_ORDER.map(category => createOption(String(category), t(getApStatus(category).labelKey))),
    createOption(STATUS_FILTER_UNKNOWN, t('statusApUnknown'))
  );
  apStatusFilterSelect.value = state.apStatusFilter;
  apStatusFilterSelect.setAttribute('aria-label', t('statusFilterLabel'));
  apStatusFilterSelect.title = t('statusFilterLabel');

  const groupOptions = [
    createOption(GROUP_FILTER_ALL, t('groupFilterAll')),
    ...state.wlanGroups.map((group: WlanGroup) => createOption(group.wlanId, group.wlanName)),
  ];
  if (state.accessPoints.some(ap => ap.wlanGroup === '')) {
    groupOptions.push(createOption(GROUP_FILTER_UNASSIGNED, t('unassigned')));
  }
  apGroupFilterSelect.replaceChildren(...groupOptions);
  if (!groupOptions.some(option => option.value === state.apGroupFilter)) {
    state.apGroupFilter = GROUP_FILTER_ALL;
  }
  apGroupFilterSelect.value = state.apGroupFilter;
  apGroupFilterSelect.setAttribute('aria-label', t('groupFilterLabel'));
  apGroupFilterSelect.title = t('groupFilterLabel');
} // End of function renderApFilterOptions()

/**
 * Resets the search text and the status and group filters, then re-renders
 * the list and returns focus to the search field ("Clear filters" in the
 * no-results state).
 */
export function clearApFilters(): void {
  state.apFilterText = '';
  state.apStatusFilter = STATUS_FILTER_ALL;
  state.apGroupFilter = GROUP_FILTER_ALL;
  apFilterInput.value = '';
  apStatusFilterSelect.value = STATUS_FILTER_ALL;
  apGroupFilterSelect.value = GROUP_FILTER_ALL;
  renderApList();
  apFilterInput.focus();
} // End of function clearApFilters()

// ============================================================================
// Rows
// ============================================================================

/**
 * Builds the counts part of a row's details: the number of Wi-Fi networks of
 * the AP's group ("No networks" for a group without networks; omitted when
 * the group is unknown) and the client count when the controller reported
 * one.
 * @param {AccessPoint} ap - The access point.
 * @param {ReadonlyMap<string, WlanGroup>} groupsByName - Groups by name.
 * @returns {string} The counts text, e.g. "2 networks · 12 clients" ('' if none).
 */
function describeApCounts(ap: AccessPoint, groupsByName: ReadonlyMap<string, WlanGroup>): string {
  const parts: string[] = [];
  const networks = networkCountFor(ap.wlanGroup, groupsByName);
  if (networks !== null) {
    if (networks === 0) {
      parts.push(t('networkCountNone'));
    } else {
      parts.push(networks === 1 ? t('networkCountOne') : tFormat('networkCountMany', { count: String(networks) }));
    }
  }
  if (ap.clientNum !== undefined) {
    parts.push(ap.clientNum === 1 ? t('clientCountOne') : tFormat('clientCountMany', { count: String(ap.clientNum) }));
  }
  return parts.join(' · ');
} // End of function describeApCounts()

/**
 * Builds one AP row entirely with DOM APIs (createElement/textContent/
 * dataset — no HTML strings), so values coming from the controller can never
 * be interpreted as markup. The row holds a native checkbox (named by the AP
 * name, described by its status and details), the status as coloured dot +
 * text, the AP name, its group, the network count of the group and the client
 * count. Clicks and keys are handled by the list's delegated handlers.
 * @param {AccessPoint} ap - The access point to render.
 * @param {number} index - Row index (for the element ids).
 * @param {ReadonlyMap<string, WlanGroup>} groupsByName - Groups by name.
 * @returns {HTMLLIElement} The row element.
 */
function createApRow(ap: AccessPoint, index: number, groupsByName: ReadonlyMap<string, WlanGroup>): HTMLLIElement {
  const apStatus = getApStatus(ap.statusCategory);
  const isSelected = state.selectedApMacs.has(ap.mac);
  const nameId = `ap-row-${index}-name`;
  const statusId = `ap-row-${index}-status`;
  const detailsId = `ap-row-${index}-details`;

  const row = document.createElement('li');
  row.className = isSelected ? 'ap-row selected' : 'ap-row';
  row.dataset.mac = ap.mac;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'ap-checkbox';
  checkbox.checked = isSelected;
  checkbox.tabIndex = -1;
  checkbox.dataset.mac = ap.mac;
  checkbox.setAttribute('aria-labelledby', nameId);
  checkbox.setAttribute('aria-describedby', `${statusId} ${detailsId}`);

  const content = document.createElement('div');
  content.className = 'ap-row-content';

  const header = document.createElement('div');
  header.className = 'ap-row-header';

  const name = document.createElement('span');
  name.className = 'item-name';
  name.id = nameId;
  name.textContent = ap.name;

  // Status as text + colour: the dot is decorative, the label carries the state
  const status = document.createElement('span');
  status.className = `item-status ${apStatus.className}`;
  status.id = statusId;
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.textContent = '●';
  const statusLabel = document.createElement('span');
  statusLabel.className = 'status-label';
  statusLabel.textContent = t(apStatus.labelKey);
  status.appendChild(dot);
  status.appendChild(statusLabel);

  const details = document.createElement('div');
  details.className = 'ap-row-meta item-subtitle';
  details.id = detailsId;
  const group = document.createElement('span');
  group.className = 'ap-row-group';
  // "AP group: <name>" on Omada 6.3+, "WLAN: <name>" before (tGroup())
  group.textContent = `${tGroup('groupLabel')}: ${ap.wlanGroup || t('unassigned')}`;
  details.appendChild(group);
  const countsText = describeApCounts(ap, groupsByName);
  if (countsText !== '') {
    const counts = document.createElement('span');
    counts.className = 'ap-row-counts';
    counts.textContent = ` · ${countsText}`;
    details.appendChild(counts);
  }
  // A narrow window ellipsizes the details: the tooltip keeps them whole
  details.title = details.textContent ?? '';

  header.appendChild(name);
  header.appendChild(status);
  content.appendChild(header);
  content.appendChild(details);
  row.appendChild(checkbox);
  row.appendChild(content);
  return row;
} // End of function createApRow()

/**
 * Builds the "no results" state: a message and a "Clear filters" button.
 * @returns {HTMLElement} The empty-state element.
 */
function createNoResultsState(): HTMLElement {
  const container = createEmptyState(t('noMatchingAps'));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary btn-compact';
  button.id = 'clearApFiltersBtn';
  button.textContent = t('clearFilters');
  button.addEventListener('click', clearApFilters);
  container.appendChild(button);
  return container;
} // End of function createNoResultsState()

/**
 * Makes one checkbox the list's single Tab stop: the one of state.apFocusMac
 * when it is visible, else the first selected visible row, else the first
 * row. Every other checkbox gets tabindex -1 (arrows move between them).
 */
function applyApRovingTabindex(): void {
  const checkboxes = Array.from(apList.querySelectorAll<HTMLInputElement>('.ap-checkbox'));
  if (checkboxes.length === 0) return;
  const tabStop =
    checkboxes.find(checkbox => checkbox.dataset.mac === state.apFocusMac) ??
    checkboxes.find(checkbox => checkbox.checked) ??
    checkboxes[0];
  for (const checkbox of checkboxes) {
    checkbox.tabIndex = checkbox === tabStop ? 0 : -1;
  }
} // End of function applyApRovingTabindex()

/**
 * Moves keyboard focus to a row's checkbox and makes it the Tab stop.
 * @param {HTMLInputElement} checkbox - The checkbox to focus.
 */
function focusApCheckbox(checkbox: HTMLInputElement): void {
  for (const other of apList.querySelectorAll<HTMLInputElement>('.ap-checkbox')) {
    other.tabIndex = other === checkbox ? 0 : -1;
  }
  state.apFocusMac = checkbox.dataset.mac ?? null;
  checkbox.focus();
}

/**
 * Renders the access-point list for the current filters using DOM APIs,
 * plus the selection controls and summary, and refreshes the move preview
 * (which states how many moving APs the filters hide). When a row's checkbox
 * had focus, focus returns to the same AP's checkbox if it is still visible
 * (re-rendering replaces every node).
 */
export function renderApList(): void {
  const active = document.activeElement;
  const focusedMac = active instanceof HTMLInputElement && apList.contains(active) ? active.dataset.mac ?? null : null;

  const visible = filterAccessPoints(state.accessPoints, currentApFilters());
  if (state.accessPoints.length === 0) {
    apList.replaceChildren(createEmptyState(t('noAccessPoints')));
  } else if (visible.length === 0) {
    apList.replaceChildren(createNoResultsState());
  } else {
    const groupsByName = indexGroupsByName(state.wlanGroups);
    const rows = document.createElement('ul');
    rows.className = 'ap-rows';
    rows.replaceChildren(...visible.map((ap, index) => createApRow(ap, index, groupsByName)));
    apList.replaceChildren(rows);
    applyApRovingTabindex();
  }
  renderApSelectionControls();
  renderMovePreview();

  if (focusedMac !== null) {
    const checkbox = apList.querySelector<HTMLInputElement>(`.ap-checkbox[data-mac="${CSS.escape(focusedMac)}"]`);
    if (checkbox) focusApCheckbox(checkbox);
  }
} // End of function renderApList()

// ============================================================================
// Selection
// ============================================================================

/**
 * Renders the selection controls for the current list: "Select all N
 * [filtered] APs" (hidden when no row is visible), "Clear selection", and the
 * selection summary, e.g. "3 selected (1 hidden by filters)". The summary is
 * an aria-live region, so its text is written only when it changes. Without
 * loaded APs the toolbar is hidden and the summary empty.
 */
export function renderApSelectionControls(): void {
  const filters = currentApFilters();
  const visible = filterAccessPoints(state.accessPoints, filters).map(ap => ap.mac);
  const filtered = isFilterActive(filters);

  // Labels first (also while hidden: no button is ever left without a name)
  if (visible.length === 1) {
    selectAllApsBtn.textContent = t(filtered ? 'selectOneApFiltered' : 'selectOneAp');
  } else {
    selectAllApsBtn.textContent = tFormat(filtered ? 'selectAllApsFiltered' : 'selectAllAps', { count: String(visible.length) });
  }
  selectAllApsBtn.hidden = visible.length === 0;
  clearApSelectionBtn.textContent = t('clearSelection');

  if (state.accessPoints.length === 0) {
    apSelectionToolbar.hidden = true;
    if (apSelectionSummary.textContent !== '') apSelectionSummary.textContent = '';
    return;
  }
  apSelectionToolbar.hidden = false;

  const { selected, hidden } = countSelection(state.selectedApMacs, visible);
  let summary: string;
  if (selected === 0) {
    summary = t('selectionNone');
  } else if (selected === 1) {
    summary = t('selectionOne');
  } else {
    summary = tFormat('selectionMany', { count: String(selected) });
  }
  if (hidden > 0) {
    summary += ` (${hidden === 1 ? t('hiddenByFiltersOne') : tFormat('hiddenByFiltersMany', { count: String(hidden) })})`;
  }
  if (apSelectionSummary.textContent !== summary) {
    apSelectionSummary.textContent = summary;
  }
} // End of function renderApSelectionControls()

/**
 * Brings the rendered rows in line with state.selectedApMacs without
 * re-rendering them (focus stays where it is), then refreshes the selection
 * controls and the destination pane's move preview.
 */
export function syncApSelection(): void {
  for (const row of apList.querySelectorAll<HTMLElement>('.ap-row')) {
    const selected = state.selectedApMacs.has(row.dataset.mac ?? '');
    row.classList.toggle('selected', selected);
    const checkbox = row.querySelector<HTMLInputElement>('.ap-checkbox');
    if (checkbox) checkbox.checked = selected;
  }
  renderApSelectionControls();
  renderMovePreview();
} // End of function syncApSelection()

/**
 * Selects or deselects one AP, or — with `extendRange` and a visible anchor —
 * the whole visible range from the anchor to it. A plain toggle makes the AP
 * the new anchor; a range keeps the anchor. A Shift-click with no anchor, or
 * with one the filters hide, acts as a plain toggle (the AP becomes the new
 * anchor), so ranges keep working after the filters change.
 * @param {string} mac - The AP's MAC.
 * @param {boolean} selected - The new state.
 * @param {boolean} extendRange - True for Shift-click.
 */
function setApSelected(mac: string, selected: boolean, extendRange: boolean): void {
  const plan = extendRange
    ? planRangeSelection(visibleApMacs(), state.selectionAnchorMac, mac)
    : { macs: [mac], anchorMac: mac };
  state.selectedApMacs = applySelection(state.selectedApMacs, plan.macs, selected);
  state.selectionAnchorMac = plan.anchorMac;
  syncApSelection();
} // End of function setApSelected()

/**
 * Delegated click handler of the list: a click on a checkbox applies its new
 * state, a click anywhere else on a row toggles that row's checkbox; with
 * Shift held, the state applies to the range from the anchor. Focus moves to
 * the row's checkbox so the keyboard continues from there.
 * @param {MouseEvent} e - The click event.
 */
export function handleApListClick(e: MouseEvent): void {
  const target = e.target instanceof Element ? e.target : null;
  const row = target?.closest('.ap-row');
  if (!(row instanceof HTMLElement) || !row.dataset.mac) return;
  const checkbox = row.querySelector<HTMLInputElement>('.ap-checkbox');
  if (!checkbox) return;
  const onCheckbox = target === checkbox;
  const selected = onCheckbox ? checkbox.checked : !state.selectedApMacs.has(row.dataset.mac);
  setApSelected(row.dataset.mac, selected, e.shiftKey);
  focusApCheckbox(checkbox);
} // End of function handleApListClick()

/**
 * Delegated keydown handler of the list: ArrowUp/ArrowDown (and Home/End)
 * move focus between the rows' checkboxes; with Shift they also select the
 * range from the anchor to the newly focused row (the row being left becomes
 * the anchor when there is none among the visible rows). Space toggles the
 * focused checkbox natively (handled as a click).
 * @param {KeyboardEvent} e - The keydown event.
 */
export function handleApListKeydown(e: KeyboardEvent): void {
  const current = e.target;
  if (!(current instanceof HTMLInputElement) || !current.classList.contains('ap-checkbox')) return;
  const checkboxes = Array.from(apList.querySelectorAll<HTMLInputElement>('.ap-checkbox'));
  const index = checkboxes.indexOf(current);
  let nextIndex: number;
  switch (e.key) {
    case 'ArrowDown':
      nextIndex = index + 1;
      break;
    case 'ArrowUp':
      nextIndex = index - 1;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = checkboxes.length - 1;
      break;
    default:
      return;
  }
  // Arrows must move focus, not scroll the panel
  e.preventDefault();
  if (index === -1 || nextIndex < 0 || nextIndex >= checkboxes.length || nextIndex === index) return;
  const next = checkboxes[nextIndex];

  if (e.shiftKey && next.dataset.mac) {
    const visible = checkboxes.map(checkbox => checkbox.dataset.mac ?? '');
    // Without a visible anchor, the row being left becomes the anchor
    const plan = planRangeSelection(visible, state.selectionAnchorMac, next.dataset.mac, current.dataset.mac ?? next.dataset.mac);
    state.selectedApMacs = applySelection(state.selectedApMacs, plan.macs, true);
    state.selectionAnchorMac = plan.anchorMac;
    syncApSelection();
  }
  focusApCheckbox(next);
} // End of function handleApListKeydown()

/**
 * Adds every AP the current filters show to the selection ("Select all N
 * filtered APs"); selected APs hidden by the filters stay selected.
 */
export function selectAllFilteredAps(): void {
  state.selectedApMacs = applySelection(state.selectedApMacs, visibleApMacs(), true);
  syncApSelection();
}

/**
 * Empties the selection (visible and hidden APs alike) and drops the anchor.
 */
export function clearApSelection(): void {
  state.selectedApMacs = new Set<string>();
  state.selectionAnchorMac = null;
  syncApSelection();
}
