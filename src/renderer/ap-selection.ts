// ============================================================================
// Access points view: pure selection, filtering and count helpers
// ============================================================================
//
// Pure (no DOM, no renderer state, no i18n): the Access points list
// (ap-list.ts), the sidebar counts (shell.ts) and the destination pane and
// move flow (destination-pane.ts, move-flow.ts) build on these, and the unit
// tests import this module directly (tests/unit/renderer-ap-selection.test.ts).
// Selections are sets of AP MAC addresses; "visible" lists are the MACs of the
// rows the current filters show, in display order.

import type { AccessPoint, WlanGroup } from '../shared/types';
import { networkScopeKind, type NetworkScopeKind } from './inventory-model';
import { hasUnknownNetworks } from './move-plan';

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
 * once). Only the known network lists count: while some group's list is
 * unknown the total is a lower bound (distinctSsidCountKind()).
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {number} The number of distinct SSID names.
 */
export function countDistinctSsids(groups: readonly WlanGroup[]): number {
  const names = new Set<string>();
  for (const group of groups) {
    if (hasUnknownNetworks(group)) continue;
    for (const ssid of group.ssidList) {
      names.add(ssid.ssidName);
    }
  }
  return names.size;
} // End of function countDistinctSsids()

/**
 * Tells how exact countDistinctSsids() is. A count that combines known and
 * unknown network lists is shown as a lower bound ("at least N"), never as
 * exact — the app's one rule for such counts (like a network's AP count,
 * networkScopeKind()): 'exact' when every group's list is known, 'atLeast'
 * when some list is unknown and some network is known, 'unknown' when some
 * list is unknown and no network is known.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {NetworkScopeKind} How the total reads.
 */
export function distinctSsidCountKind(groups: readonly WlanGroup[]): NetworkScopeKind {
  return networkScopeKind(countDistinctSsids(groups), groups.filter(hasUnknownNetworks).length);
}

/**
 * The string keys of the Wi-Fi networks list built from the internal data
 * (its rows are the countDistinctSsids() names).
 */
export interface NetworkListKeys {
  // The empty state when no network is listed: "No Wi-Fi networks
  // available" only when every group's list is known
  empty: 'noNetworks' | 'networksNotReported';
  // The search summary: "Showing N of M", or "Showing N of at least M"
  // while the total is a lower bound
  summary: 'searchResultsCount' | 'searchResultsCountAtLeast';
}

/**
 * Picks the texts of the Wi-Fi networks list (internal data) from how exact
 * its total is (distinctSsidCountKind()): with an unknown total the empty
 * list says the controller did not report the networks (never "no
 * networks"), and while the total is not exact the search summary presents
 * it as a lower bound. With every list known the keys are the usual ones.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {NetworkListKeys} The keys to use.
 */
export function networkListKeys(groups: readonly WlanGroup[]): NetworkListKeys {
  const kind = distinctSsidCountKind(groups);
  return {
    empty: kind === 'unknown' ? 'networksNotReported' : 'noNetworks',
    summary: kind === 'exact' ? 'searchResultsCount' : 'searchResultsCountAtLeast',
  };
} // End of function networkListKeys()

/**
 * Indexes groups by name (APs name their group, they do not carry its id).
 * When two groups share a name the first one wins, except that a group
 * whose network list is unknown wins over the ones whose list is known
 * (fail-closed: an AP with that name then reads "Networks unknown", never a
 * count it may not have).
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {Map<string, WlanGroup>} Group name to group.
 */
export function indexGroupsByName(groups: readonly WlanGroup[]): Map<string, WlanGroup> {
  const index = new Map<string, WlanGroup>();
  for (const group of groups) {
    const indexed = index.get(group.wlanName);
    if (indexed === undefined || (hasUnknownNetworks(group) && !hasUnknownNetworks(indexed))) {
      index.set(group.wlanName, group);
    }
  }
  return index;
}

/**
 * Returns the number of Wi-Fi networks an AP's group broadcasts; 'unknown'
 * when the controller did not report that group's network list (never 0);
 * null when the group itself is unknown (the AP has no group, or its group is
 * not in the listing).
 * @param {string} groupName - The AP's group name (`wlanGroup`).
 * @param {ReadonlyMap<string, WlanGroup>} groupsByName - From indexGroupsByName().
 * @returns {number | 'unknown' | null} The network count, 'unknown', or null.
 */
export function networkCountFor(groupName: string, groupsByName: ReadonlyMap<string, WlanGroup>): number | 'unknown' | null {
  if (groupName === '') {
    return null;
  }
  const group = groupsByName.get(groupName);
  if (group !== undefined && hasUnknownNetworks(group)) {
    return 'unknown';
  }
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
