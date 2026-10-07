// ============================================================================
// Access points list: the current filters, read from the renderer state.
// Shared by the list (ap-list.ts) and the destination pane
// (destination-pane.ts), which states how many moving APs the filters hide;
// the filtering itself is the pure filterAccessPoints() (ap-selection.ts).
// ============================================================================

import { filterAccessPoints, GROUP_FILTER_ALL, GROUP_FILTER_UNASSIGNED, GROUP_FILTER_UNKNOWN, type ApFilters } from './ap-selection';
import { state } from './state';

/**
 * Resolves the group filter (a group id, or one of the special values) to
 * the group name APs carry: null for no group filter (and for "Unknown
 * group", see currentApFilters()), '' for "unassigned".
 * @returns {string | null} The group name the APs must have, or null.
 */
function resolveGroupFilterName(): string | null {
  if (state.apGroupFilter === GROUP_FILTER_ALL || state.apGroupFilter === GROUP_FILTER_UNKNOWN) return null;
  if (state.apGroupFilter === GROUP_FILTER_UNASSIGNED) return '';
  const group = state.wlanGroups.find(candidate => candidate.wlanId === state.apGroupFilter);
  return group ? group.wlanName : null;
}

/**
 * Returns the current filters of the Access points list (the "Unknown group"
 * filter of inbox I-1c2a as `groupUnknown`).
 * @returns {ApFilters} Search text, status filter and resolved group filter.
 */
export function currentApFilters(): ApFilters {
  const filters: ApFilters = { text: state.apFilterText, status: state.apStatusFilter, groupName: resolveGroupFilterName() };
  if (state.apGroupFilter === GROUP_FILTER_UNKNOWN) {
    filters.groupUnknown = true;
  }
  return filters;
}

/**
 * Returns the MACs of the APs the current filters show, in display order.
 * @returns {string[]} The visible MACs.
 */
export function visibleApMacs(): string[] {
  return filterAccessPoints(state.accessPoints, currentApFilters()).map(ap => ap.mac);
}
