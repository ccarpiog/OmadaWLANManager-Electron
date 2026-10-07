// ============================================================================
// AP groups and Wi-Fi networks views, AP details: pure view-model derivations
// (docs/management-design.md §4.3 AP details, §4.4, §4.5 — read-only parts)
// ============================================================================
//
// Pure (no DOM, no renderer state, no i18n): the AP groups view
// (groups-view.ts), the Wi-Fi networks view (networks-view.ts) and the AP
// details pane (ap-details.ts) build on these, and the unit tests import this
// module directly (tests/unit/renderer-inventory-model.test.ts).
//
// Everything is derived from what the internal API reports and the renderer
// already loads: which group each AP is in (by NAME, `wlanGroup`), the group
// list with the Wi-Fi network (SSID) names each group broadcasts, and the
// default flag of a group (`isDefault`, from setting/wlans `primary`). Nothing
// is invented: per-band capacity, a network's security, bands and enabled
// state, and per-AP SSID overrides are not in this data.
//
// - A network is identified by its NAME (the internal group listing carries
//   only SSID names), consistently with the sidebar's distinct-name count.
// - An AP's group is resolved by name; a name several groups share is
//   "ambiguous" (its members cannot be told apart), a name the listing does
//   not have is "unlisted", and '' means the AP reports no group. APs whose
//   group cannot be resolved are never counted as members of any group or
//   broadcasters of any network. For a network they are counted apart as
//   APs that MAY broadcast it (unknown), unless none of the groups with
//   their name broadcasts it; while any such AP exists, a network's AP count
//   is only a lower bound (networkScopeKind()), never an exact count or a
//   "no APs" statement.
// - A group whose network list the controller did not report
//   (`ssidListUnknown`, cloud session only: hasUnknownNetworks()) has
//   unknown networks, never "no networks": its row is not Empty and says so
//   (`networksUnknown`), an AP in it has unknown networks, and since it may
//   broadcast any network, every network's group and AP counts become lower
//   bounds while such a group exists (`unreportedGroupCount`,
//   `unreportedApCount`). Counts that combine known and unknown groups are
//   always shown as lower bounds ("at least N"; unknown when N is 0), never
//   as exact. Local data never sets the flag: every result for it is
//   unchanged (the optional fields are then absent).

import type { AccessPoint, WlanGroup } from '../shared/types';
import { hasUnknownNetworks, networkNames, normalizeSearch } from './move-plan';
import type { LinkTarget } from './nav-history';

/**
 * How an AP's group resolves against the group listing.
 */
export type ApGroupResolution =
  | { kind: 'group'; group: WlanGroup }
  | { kind: 'unassigned' }
  | { kind: 'unlisted'; name: string }
  | { kind: 'ambiguous'; name: string };

/**
 * One row of the AP groups master list.
 */
export interface GroupRow {
  group: WlanGroup;
  // APs in the group, or null when another group has the same name (its
  // members cannot be identified)
  apCount: number | null;
  // The group's distinct network names, in listing order
  networks: string[];
  // True when the group broadcasts no Wi-Fi network (the §4.1 empty group:
  // "No Wi-Fi networks — silences these APs"); never for unknown networks
  isEmpty: boolean;
  // True only when the controller flags the group as its default one
  isDefault: boolean;
  // True when another listed group has the same name
  ambiguous: boolean;
  // Present (true) only when the controller did not report the group's
  // network list: `networks` is then empty and means "unknown"
  networksUnknown?: true;
}

/**
 * One row of the Wi-Fi networks master list.
 */
export interface NetworkRow {
  name: string;
  // The groups broadcasting it, in listing order
  groups: WlanGroup[];
  // APs whose group resolves to one of those groups ("M APs" of the scope;
  // a lower bound while unknownApCount > 0)
  apCount: number;
  // APs that may broadcast it but whose group cannot be resolved (no group,
  // unlisted, or a shared name one of whose groups broadcasts it)
  unknownApCount: number;
  // Present only while some listed group's network list is unknown (it may
  // broadcast this network too): how many such groups (`groups.length` is
  // then a lower bound) and how many APs are in one of them (more APs that
  // may broadcast it)
  unreportedGroupCount?: number;
  unreportedApCount?: number;
}

/**
 * How exact a network's AP count is: 'exact' when every AP is placed,
 * 'atLeast' when some APs may also broadcast it (the count is a lower
 * bound), 'unknown' when no AP is known to broadcast it but some may (never
 * shown as "no APs").
 */
export type NetworkScopeKind = 'exact' | 'atLeast' | 'unknown';

/**
 * The broadcasters of one network (the network detail).
 */
export interface NetworkBroadcasters {
  name: string;
  groups: WlanGroup[];
  // The APs that broadcast it, in AP list order
  aps: AccessPoint[];
  // APs whose group cannot be resolved (no group, unlisted, or a shared name
  // one of whose groups broadcasts it): they may broadcast the network
  unknownApCount: number;
  // As in NetworkRow: present only while some listed group's network list
  // is unknown
  unreportedGroupCount?: number;
  unreportedApCount?: number;
}

/**
 * What the AP details pane shows about one AP's networks.
 */
export interface ApDetailsModel {
  ap: AccessPoint;
  group: ApGroupResolution;
  // The networks its group broadcasts (the AP's effective networks as far as
  // the group listing tells), or null when they are unknown: its group
  // cannot be resolved (`group.kind` is not 'group') or the controller did
  // not report its group's network list (`group.kind` is 'group')
  networks: string[] | null;
}

/**
 * Resolves an AP's group (APs name their group; they carry no group id).
 * @param {AccessPoint} ap - The access point.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {ApGroupResolution} The group, or why it cannot be resolved.
 */
export function resolveApGroup(ap: AccessPoint, groups: readonly WlanGroup[]): ApGroupResolution {
  if (ap.wlanGroup === '') {
    return { kind: 'unassigned' };
  }
  const matches = groups.filter(group => group.wlanName === ap.wlanGroup);
  if (matches.length === 0) {
    return { kind: 'unlisted', name: ap.wlanGroup };
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', name: ap.wlanGroup };
  }
  return { kind: 'group', group: matches[0] };
} // End of function resolveApGroup()

/**
 * Tells whether another listed group (another id) has the group's name.
 * @param {WlanGroup} group - The group.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {boolean} True when the name is shared.
 */
function hasSharedName(group: WlanGroup, groups: readonly WlanGroup[]): boolean {
  return groups.some(other => other.wlanId !== group.wlanId && other.wlanName === group.wlanName);
}

/**
 * Returns the APs in a group, in AP list order, or null when another group
 * has the same name (APs name their group, so its members are unknown).
 * @param {WlanGroup} group - The group.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @param {readonly AccessPoint[]} accessPoints - The loaded APs.
 * @returns {AccessPoint[] | null} The members, or null when unknown.
 */
export function groupMembers(group: WlanGroup, groups: readonly WlanGroup[], accessPoints: readonly AccessPoint[]): AccessPoint[] | null {
  if (hasSharedName(group, groups)) {
    return null;
  }
  return accessPoints.filter(ap => ap.wlanGroup === group.wlanName);
}

/**
 * Builds the AP groups master list, in listing order: per group its AP
 * count (null when the name is shared), its distinct network names, and the
 * Empty (no Wi-Fi networks) and Default flags. A group whose network list
 * is unknown is not Empty: its row carries `networksUnknown` instead.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @param {readonly AccessPoint[]} accessPoints - The loaded APs.
 * @returns {GroupRow[]} One row per group.
 */
export function buildGroupRows(groups: readonly WlanGroup[], accessPoints: readonly AccessPoint[]): GroupRow[] {
  return groups.map(group => {
    const members = groupMembers(group, groups, accessPoints);
    const networks = networkNames(group);
    const unknown = hasUnknownNetworks(group);
    const row: GroupRow = {
      group,
      apCount: members === null ? null : members.length,
      networks,
      isEmpty: networks.length === 0 && !unknown,
      isDefault: group.isDefault === true,
      ambiguous: members === null,
    };
    if (unknown) {
      row.networksUnknown = true;
    }
    return row;
  }); // End of the group mapping
} // End of function buildGroupRows()

/**
 * Tells whether a group row matches the AP groups search: by the group name
 * or the name of any network it broadcasts (case-insensitive substring).
 * @param {GroupRow} row - The row.
 * @param {string} query - The search text as typed.
 * @returns {boolean} True when it matches (always for an empty search).
 */
export function matchesGroupSearch(row: GroupRow, query: string): boolean {
  const needle = normalizeSearch(query);
  return needle === '' ||
    row.group.wlanName.toLowerCase().includes(needle) ||
    row.networks.some(name => name.toLowerCase().includes(needle));
}

/**
 * Returns the group rows matching the search, in order.
 * @param {readonly GroupRow[]} rows - All rows.
 * @param {string} query - The search text as typed.
 * @returns {GroupRow[]} The matching rows.
 */
export function filterGroupRows(rows: readonly GroupRow[], query: string): GroupRow[] {
  return rows.filter(row => matchesGroupSearch(row, query));
}

/**
 * Indexes the groups by name; several groups may share one (APs name their
 * group, so such a name does not tell which of them an AP is in).
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {Map<string, WlanGroup[]>} Group name to the groups with it, in
 *   listing order.
 */
function indexGroupsByName(groups: readonly WlanGroup[]): Map<string, WlanGroup[]> {
  const index = new Map<string, WlanGroup[]>();
  for (const group of groups) {
    const named = index.get(group.wlanName) ?? [];
    named.push(group);
    index.set(group.wlanName, named);
  }
  return index;
}

/**
 * Tells whether a group is known to broadcast a network (by name): never a
 * group whose network list is unknown (it only MAY broadcast it).
 * @param {WlanGroup} group - The group.
 * @param {string} name - The network name.
 * @returns {boolean} True when the group has the network.
 */
function broadcasts(group: WlanGroup, name: string): boolean {
  return !hasUnknownNetworks(group) && group.ssidList.some(ssid => ssid.ssidName === name);
}

/**
 * Tells whether an AP broadcasts a network, as far as its group name tells:
 * 'yes' or 'no' when the name resolves to exactly one listed group whose
 * network list is known, 'unreported' when that one group's list is unknown
 * (it may broadcast the network); for a name several groups share, 'no'
 * when none of them broadcasts it or may (an unknown list), and 'maybe'
 * otherwise (the AP could be in any of them, as the AP details pane states
 * its networks as unknown); 'maybe' for an AP that reports no group or a
 * group the listing does not have.
 * @param {AccessPoint} ap - The access point.
 * @param {string} name - The network name.
 * @param {ReadonlyMap<string, readonly WlanGroup[]>} groupsByName - From indexGroupsByName().
 * @returns {'yes' | 'no' | 'maybe' | 'unreported'} Whether it broadcasts the network.
 */
function apBroadcasts(ap: AccessPoint, name: string, groupsByName: ReadonlyMap<string, readonly WlanGroup[]>): 'yes' | 'no' | 'maybe' | 'unreported' {
  const named = ap.wlanGroup === '' ? undefined : groupsByName.get(ap.wlanGroup);
  if (named === undefined || named.length === 0) {
    return 'maybe';
  }
  if (named.length === 1 && hasUnknownNetworks(named[0])) {
    return 'unreported';
  }
  if (!named.some(group => broadcasts(group, name) || hasUnknownNetworks(group))) {
    return 'no';
  }
  return named.length === 1 ? 'yes' : 'maybe';
} // End of function apBroadcasts()

/**
 * Where every AP stands against one network (placeAps()).
 */
interface ApPlacement {
  // The APs that broadcast it, in AP list order
  aps: AccessPoint[];
  // APs that may broadcast it without their group resolving
  unknownApCount: number;
  // APs in a (uniquely resolved) group whose network list is unknown
  unreportedApCount: number;
}

/**
 * Places every AP against one network: the APs that broadcast it (in AP
 * list order), how many may broadcast it without their group resolving, and
 * how many are in a group whose network list is unknown.
 * @param {string} name - The network name.
 * @param {ReadonlyMap<string, readonly WlanGroup[]>} groupsByName - From indexGroupsByName().
 * @param {readonly AccessPoint[]} accessPoints - The loaded APs, in list order.
 * @returns {ApPlacement} The placement.
 */
function placeAps(name: string, groupsByName: ReadonlyMap<string, readonly WlanGroup[]>, accessPoints: readonly AccessPoint[]): ApPlacement {
  const aps: AccessPoint[] = [];
  let unknownApCount = 0;
  let unreportedApCount = 0;
  for (const ap of accessPoints) {
    const placement = apBroadcasts(ap, name, groupsByName);
    if (placement === 'yes') {
      aps.push(ap);
    } else if (placement === 'maybe') {
      unknownApCount++;
    } else if (placement === 'unreported') {
      unreportedApCount++;
    }
  } // End of the loop over the APs
  return { aps, unknownApCount, unreportedApCount };
} // End of function placeAps()

/**
 * Adds the unknown-network-list facts to a network's row or detail, only
 * while some listed group's network list is unknown (so the result for
 * local data, which never sets the flag, is unchanged).
 * @param {T} target - The row or detail.
 * @param {number} unreportedGroupCount - Listed groups whose list is unknown.
 * @param {number} unreportedApCount - APs in one of those groups.
 * @returns {T} The same object.
 */
function withUnreported<T extends { unreportedGroupCount?: number; unreportedApCount?: number }>(target: T, unreportedGroupCount: number, unreportedApCount: number): T {
  if (unreportedGroupCount > 0) {
    target.unreportedGroupCount = unreportedGroupCount;
    target.unreportedApCount = unreportedApCount;
  }
  return target;
}

/**
 * Builds the Wi-Fi networks master list: one row per distinct network name
 * (the sidebar's count), sorted by name, with the groups broadcasting it,
 * the APs whose (uniquely resolved) group broadcasts it and the APs that may
 * also broadcast it — the scope "N groups · M APs" (M a lower bound while
 * some APs may also broadcast it; N too while some group's network list is
 * unknown). Only names a group is known to broadcast are listed: a network
 * only a group with an unknown list may broadcast is not known to exist.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @param {readonly AccessPoint[]} accessPoints - The loaded APs.
 * @returns {NetworkRow[]} One row per network name.
 */
export function buildNetworkRows(groups: readonly WlanGroup[], accessPoints: readonly AccessPoint[]): NetworkRow[] {
  const byName = new Map<string, WlanGroup[]>();
  for (const group of groups) {
    for (const name of networkNames(group)) {
      const broadcasters = byName.get(name) ?? [];
      broadcasters.push(group);
      byName.set(name, broadcasters);
    }
  } // End of the loop that indexes the groups by network name

  const groupsByName = indexGroupsByName(groups);
  const unreportedGroupCount = groups.filter(hasUnknownNetworks).length;
  const rows = Array.from(byName, ([name, broadcasters]) => {
    const { aps, unknownApCount, unreportedApCount } = placeAps(name, groupsByName, accessPoints);
    const row: NetworkRow = { name, groups: broadcasters, apCount: aps.length, unknownApCount };
    return withUnreported(row, unreportedGroupCount, unreportedApCount);
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
} // End of function buildNetworkRows()

/**
 * Tells how exact a network's AP count is (the scope "N groups · M APs"):
 * exact when no AP may also broadcast it; a lower bound ("at least M") when
 * some may; unknown when none is known to and some may (so "no APs" is
 * never stated while an AP's group cannot be resolved).
 * @param {number} apCount - APs known to broadcast it.
 * @param {number} unknownApCount - APs that may broadcast it.
 * @returns {NetworkScopeKind} How the count reads.
 */
export function networkScopeKind(apCount: number, unknownApCount: number): NetworkScopeKind {
  if (unknownApCount <= 0) return 'exact';
  return apCount > 0 ? 'atLeast' : 'unknown';
}

/**
 * Tells whether a network row matches the Wi-Fi networks search: by the
 * network name or the name of any group broadcasting it.
 * @param {NetworkRow} row - The row.
 * @param {string} query - The search text as typed.
 * @returns {boolean} True when it matches (always for an empty search).
 */
export function matchesNetworkSearch(row: NetworkRow, query: string): boolean {
  const needle = normalizeSearch(query);
  return needle === '' ||
    row.name.toLowerCase().includes(needle) ||
    row.groups.some(group => group.wlanName.toLowerCase().includes(needle));
}

/**
 * Returns the network rows matching the search, in order.
 * @param {readonly NetworkRow[]} rows - All rows.
 * @param {string} query - The search text as typed.
 * @returns {NetworkRow[]} The matching rows.
 */
export function filterNetworkRows(rows: readonly NetworkRow[], query: string): NetworkRow[] {
  return rows.filter(row => matchesNetworkSearch(row, query));
}

/**
 * Tells whether the Wi-Fi networks view (internal data) lists a network:
 * some listed group is known to broadcast it. A network only a group with
 * an unknown network list may broadcast is not listed (not known to exist),
 * consistently with buildNetworkRows() and networkBroadcasters().
 * @param {string} name - The network name.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {boolean} True when the network is listed.
 */
export function isNetworkListed(name: string, groups: readonly WlanGroup[]): boolean {
  return groups.some(group => broadcasts(group, name));
}

/**
 * Lists who broadcasts a network: the groups that have it, the APs whose
 * group (resolved uniquely) is one of them, and how many APs may broadcast
 * it without their group resolving (no group, an unlisted group, or a name
 * several groups share, one of which broadcasts it), plus — while some
 * group's network list is unknown — how many such groups and APs may
 * broadcast it too. Consistent with the network's row (same counts).
 * @param {string} name - The network name.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @param {readonly AccessPoint[]} accessPoints - The loaded APs, in list order.
 * @returns {NetworkBroadcasters | null} The broadcasters, or null when no
 *   listed group is known to broadcast the network (it is gone).
 */
export function networkBroadcasters(name: string, groups: readonly WlanGroup[], accessPoints: readonly AccessPoint[]): NetworkBroadcasters | null {
  const broadcasting = groups.filter(group => broadcasts(group, name));
  if (broadcasting.length === 0) {
    return null;
  }
  const { aps, unknownApCount, unreportedApCount } = placeAps(name, indexGroupsByName(groups), accessPoints);
  const detail: NetworkBroadcasters = { name, groups: broadcasting, aps, unknownApCount };
  return withUnreported(detail, groups.filter(hasUnknownNetworks).length, unreportedApCount);
} // End of function networkBroadcasters()

/**
 * Describes one AP for its details pane: how its group resolves and its
 * effective networks as far as the group listing tells (its group's
 * networks; null when the group cannot be resolved or its network list is
 * unknown). Per-AP SSID overrides are not part of the loaded data, so they
 * are never reflected here.
 * @param {AccessPoint} ap - The access point.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {ApDetailsModel} The details.
 */
export function describeApDetails(ap: AccessPoint, groups: readonly WlanGroup[]): ApDetailsModel {
  const group = resolveApGroup(ap, groups);
  const known = group.kind === 'group' && !hasUnknownNetworks(group.group);
  return { ap, group, networks: known ? networkNames(group.group) : null };
}

/**
 * The cross-link to an AP (opens its details pane).
 * @param {AccessPoint} ap - The access point.
 * @returns {LinkTarget} The link.
 */
export function apLink(ap: AccessPoint): LinkTarget {
  return { kind: 'ap', target: ap.mac };
}

/**
 * The cross-link to a group (selects it in the AP groups view).
 * @param {WlanGroup} group - The group.
 * @returns {LinkTarget} The link.
 */
export function groupLink(group: WlanGroup): LinkTarget {
  return { kind: 'group', target: group.wlanId };
}

/**
 * The cross-link to a network (selects it in the Wi-Fi networks view).
 * @param {string} name - The network name.
 * @returns {LinkTarget} The link.
 */
export function networkLink(name: string): LinkTarget {
  return { kind: 'network', target: name };
}

/**
 * The cross-link from an AP to its group: only when the group resolves
 * uniquely (an unlisted or shared name has no single target).
 * @param {ApGroupResolution} resolution - The AP's group resolution.
 * @returns {LinkTarget | null} The link, or null.
 */
export function apGroupLink(resolution: ApGroupResolution): LinkTarget | null {
  return resolution.kind === 'group' ? groupLink(resolution.group) : null;
}

/**
 * Tells whether a search hides an item, so that a cross-link to it must
 * clear the search of its view to show it selected in the list.
 * @param {string} query - The view's search text.
 * @param {boolean} matches - Whether the item matches that search.
 * @returns {string} The search to keep ('' when it would hide the item).
 */
export function searchKeepingItem(query: string, matches: boolean): string {
  return matches ? query : '';
}
