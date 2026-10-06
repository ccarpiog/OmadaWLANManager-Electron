// ============================================================================
// Access points view: pure selection, filtering and count helpers
// ============================================================================
//
// Pure (no DOM, no renderer state, no i18n): the Access points list
// (ap-list.ts), the sidebar counts (shell.ts) and the move flow
// (apply-change.ts) build on these, and the unit tests import this module
// directly (tests/unit/renderer-ap-selection.test.ts). Selections are sets of
// AP MAC addresses; "visible" lists are the MACs of the rows the current
// filters show, in display order.

import type { AccessPoint, WlanGroup } from '../shared/types';

// Status filter values besides a numeric statusCategory ('0'..'4')
export const STATUS_FILTER_ALL = 'all';
export const STATUS_FILTER_UNKNOWN = 'unknown';

// The statusCategory values the app knows (see AP_STATUS in ap-list.ts); any
// other value is the "unknown" status
export const KNOWN_STATUS_CATEGORIES: readonly number[] = [0, 1, 2, 3, 4];

// Group filter values of the Access points view besides a group id. Neither
// can collide with a group id: ids never are empty and never contain ':'
// (isValidWlanId() in validation.ts)
export const GROUP_FILTER_ALL = '';
export const GROUP_FILTER_UNASSIGNED = ':unassigned';

/**
 * The filters of the Access points list.
 */
export interface ApFilters {
  // Search text, matched case-insensitively against the AP name and its
  // group name (not trimmed, like the list filter always was)
  text: string;
  // STATUS_FILTER_ALL, STATUS_FILTER_UNKNOWN or a statusCategory as a string
  status: string;
  // Name of the group the AP must be in; '' for APs without a group; null
  // for no group filter
  groupName: string | null;
}

/**
 * Tells whether an AP's status category passes the status filter.
 * @param {number} statusCategory - The AP's statusCategory.
 * @param {string} filter - The status filter value.
 * @returns {boolean} True when the AP passes.
 */
export function matchesStatusFilter(statusCategory: number, filter: string): boolean {
  if (filter === STATUS_FILTER_ALL) {
    return true;
  }
  if (filter === STATUS_FILTER_UNKNOWN) {
    return !KNOWN_STATUS_CATEGORIES.includes(statusCategory);
  }
  return String(statusCategory) === filter;
}

/**
 * Tells whether any filter narrows the list.
 * @param {ApFilters} filters - The current filters.
 * @returns {boolean} True when at least one filter is active.
 */
export function isFilterActive(filters: ApFilters): boolean {
  return filters.text !== '' || filters.status !== STATUS_FILTER_ALL || filters.groupName !== null;
}

/**
 * Returns the APs the filters let through, in their original order.
 * @param {readonly AccessPoint[]} accessPoints - All loaded APs.
 * @param {ApFilters} filters - The current filters.
 * @returns {AccessPoint[]} The visible APs.
 */
export function filterAccessPoints(accessPoints: readonly AccessPoint[], filters: ApFilters): AccessPoint[] {
  const text = filters.text.toLowerCase();
  return accessPoints.filter(ap =>
    (text === '' || ap.name.toLowerCase().includes(text) || ap.wlanGroup.toLowerCase().includes(text)) &&
    matchesStatusFilter(ap.statusCategory, filters.status) &&
    (filters.groupName === null || ap.wlanGroup === filters.groupName)
  );
}

/**
 * Returns the MACs from the anchor row to the target row, both included, in
 * display order (Shift-click and Shift+Arrow range selection). Without an
 * anchor among the visible rows the range is the target alone; a target that
 * is not visible gives an empty range.
 * @param {readonly string[]} visibleMacs - The visible rows' MACs, in order.
 * @param {string | null} anchorMac - The range anchor (last plain toggle).
 * @param {string} targetMac - The row the range extends to.
 * @returns {string[]} The MACs of the range.
 */
export function rangeBetween(visibleMacs: readonly string[], anchorMac: string | null, targetMac: string): string[] {
  const targetIndex = visibleMacs.indexOf(targetMac);
  if (targetIndex === -1) {
    return [];
  }
  const anchorIndex = anchorMac === null ? -1 : visibleMacs.indexOf(anchorMac);
  if (anchorIndex === -1) {
    return [targetMac];
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return visibleMacs.slice(start, end + 1);
} // End of function rangeBetween()

/**
 * What a range gesture changes: the MACs to (de)select and the anchor to keep
 * for the next range.
 */
export interface RangeSelection {
  macs: string[];
  anchorMac: string;
}

/**
 * Plans a range selection (Shift-click, Shift+Arrow): the visible range from
 * the anchor to the target while the anchor is among the visible rows, the
 * anchor unchanged. A missing anchor, or one the filters hide (or a reload
 * removed), is replaced by `fallbackMac` — otherwise every later range would
 * collapse to the target alone, since only a plain toggle sets an anchor.
 * With the default fallback (Shift-click) the target then changes alone and
 * becomes the new anchor; Shift+Arrow passes the row being left instead.
 * A target that is not visible changes alone.
 * @param {readonly string[]} visibleMacs - The visible rows' MACs, in order.
 * @param {string | null} anchorMac - The current range anchor.
 * @param {string} targetMac - The row the range extends to.
 * @param {string} [fallbackMac] - The anchor to use when `anchorMac` is not
 *   visible; defaults to the target.
 * @returns {RangeSelection} The MACs to change and the anchor to keep.
 */
export function planRangeSelection(
  visibleMacs: readonly string[],
  anchorMac: string | null,
  targetMac: string,
  fallbackMac: string = targetMac
): RangeSelection {
  const anchor = anchorMac !== null && visibleMacs.includes(anchorMac) ? anchorMac : fallbackMac;
  const range = rangeBetween(visibleMacs, anchor, targetMac);
  return { macs: range.length > 0 ? range : [targetMac], anchorMac: anchor };
} // End of function planRangeSelection()

/**
 * Returns a copy of a selection with the given MACs added or removed.
 * @param {ReadonlySet<string>} selection - The current selection.
 * @param {readonly string[]} macs - The MACs to change.
 * @param {boolean} selected - True to add them, false to remove them.
 * @returns {Set<string>} The new selection.
 */
export function applySelection(selection: ReadonlySet<string>, macs: readonly string[], selected: boolean): Set<string> {
  const next = new Set(selection);
  for (const mac of macs) {
    if (selected) {
      next.add(mac);
    } else {
      next.delete(mac);
    }
  }
  return next;
} // End of function applySelection()

/**
 * Keeps only the selected MACs that still exist (after a reload, an AP that
 * disappeared from the controller cannot stay selected).
 * @param {ReadonlySet<string>} selection - The current selection.
 * @param {readonly string[]} existingMacs - The MACs of the loaded APs.
 * @returns {Set<string>} The pruned selection.
 */
export function pruneSelection(selection: ReadonlySet<string>, existingMacs: readonly string[]): Set<string> {
  const existing = new Set(existingMacs);
  return new Set(Array.from(selection).filter(mac => existing.has(mac)));
}

/**
 * Counts the selection and the part of it the filters hide ("3 selected
 * (1 hidden by filters)").
 * @param {ReadonlySet<string>} selection - The current selection.
 * @param {readonly string[]} visibleMacs - The visible rows' MACs.
 * @returns {{ selected: number; hidden: number }} Both counts.
 */
export function countSelection(selection: ReadonlySet<string>, visibleMacs: readonly string[]): { selected: number; hidden: number } {
  const visible = new Set(visibleMacs);
  let hidden = 0;
  for (const mac of selection) {
    if (!visible.has(mac)) {
      hidden++;
    }
  }
  return { selected: selection.size, hidden };
} // End of function countSelection()

/**
 * Returns the selected APs in list order (the order a move processes them).
 * @param {readonly AccessPoint[]} accessPoints - All loaded APs.
 * @param {ReadonlySet<string>} selection - The current selection.
 * @returns {AccessPoint[]} The selected APs, visible or hidden by filters.
 */
export function selectedAccessPoints(accessPoints: readonly AccessPoint[], selection: ReadonlySet<string>): AccessPoint[] {
  return accessPoints.filter(ap => selection.has(ap.mac));
}

/**
 * Counts the distinct Wi-Fi network (SSID) names across a group listing (the
 * sidebar's Wi-Fi networks total: a network bound to several groups counts
 * once).
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {number} The number of distinct SSID names.
 */
export function countDistinctSsids(groups: readonly WlanGroup[]): number {
  const names = new Set<string>();
  for (const group of groups) {
    for (const ssid of group.ssidList) {
      names.add(ssid.ssidName);
    }
  }
  return names.size;
}

/**
 * Indexes groups by name (APs name their group, they do not carry its id).
 * When two groups share a name the first one wins.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {Map<string, WlanGroup>} Group name to group.
 */
export function indexGroupsByName(groups: readonly WlanGroup[]): Map<string, WlanGroup> {
  const index = new Map<string, WlanGroup>();
  for (const group of groups) {
    if (!index.has(group.wlanName)) {
      index.set(group.wlanName, group);
    }
  }
  return index;
}

/**
 * Returns the number of Wi-Fi networks an AP's group broadcasts, or null when
 * it is unknown (the AP has no group, or its group is not in the listing).
 * @param {string} groupName - The AP's group name (`wlanGroup`).
 * @param {ReadonlyMap<string, WlanGroup>} groupsByName - From indexGroupsByName().
 * @returns {number | null} The network count, or null when unknown.
 */
export function networkCountFor(groupName: string, groupsByName: ReadonlyMap<string, WlanGroup>): number | null {
  if (groupName === '') {
    return null;
  }
  const group = groupsByName.get(groupName);
  return group ? group.ssidList.length : null;
}

/**
 * Boundary check for the optional client count of an AP received over IPC.
 * @param {unknown} value - The raw `clientNum` value.
 * @returns {number | undefined} The count, or undefined when absent/invalid.
 */
export function sanitizeClientCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
