// ============================================================================
// Moving access points: pure planning, search and result helpers
// (docs/management-design.md §4.3, destination pane and review)
// ============================================================================
//
// Pure (no DOM, no renderer state, no i18n): the destination pane
// (destination-pane.ts), the review dialog (move-dialog.ts) and the move flow
// (move-flow.ts) build on these, and the unit tests import this module
// directly (tests/unit/renderer-move-plan.test.ts).
//
// Everything here is derived from what the internal API reports: which group
// each AP is in (by name, `wlanGroup`) and which Wi-Fi network (SSID) names
// each group broadcasts (`ssidList`). Per-AP network overrides and per-network
// client counts are not reported, so nothing here claims them: a network
// "gained" or "lost" is a group-level fact about the moving APs. Because APs
// name their group, a group whose name another group shares is "ambiguous":
// its members cannot be identified, so it is never a move destination.
//
// A group whose network list the controller did not report
// (`ssidListUnknown`, set only by the cloud session; its `ssidList` is then
// empty) has UNKNOWN networks, never "no networks" (hasUnknownNetworks()):
// a move from or into it claims no network gained or lost for the APs it
// concerns (they are counted apart, `unreportedSourceCount`), it is never
// pinned under "Silence", and the destination search matches it by its own
// name only (it has no network name to match). Local data never sets the
// flag, so every result for it is unchanged.

import type { AccessPoint, WlanGroup } from '../shared/types';

// Longest controller error message shown in the per-AP results
const MAX_ERROR_LENGTH = 200;

// Prefix Electron adds to an error thrown by an ipcMain.handle() handler,
// e.g. "Error invoking remote method 'omada:set-wlan': Error: Device busy"
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']*': /;
// Leading error-class name of a serialized error ("Error: ", "TypeError: ")
const ERROR_NAME_PREFIX = /^[A-Za-z]*Error: /;

/**
 * One Wi-Fi network a move adds or removes, with the number of moving APs
 * (with a known current group) it applies to.
 */
export interface NetworkChange {
  name: string;
  apCount: number;
}

/**
 * The Wi-Fi networks of the moving APs before and after a move, by name:
 * `gained` are the destination's networks some moving AP does not broadcast
 * now; `lost` the networks some moving AP broadcasts now that the
 * destination does not have; `unchanged` the destination's networks every
 * moving AP already broadcasts. Only APs whose current group is known count.
 */
export interface NetworkDiff {
  gained: NetworkChange[];
  lost: NetworkChange[];
  unchanged: string[];
}

/**
 * A group the moving APs currently are in, with how many of them ('' is the
 * name of "no group").
 */
export interface SourceGroup {
  name: string;
  count: number;
}

/**
 * Clients connected to the moving APs: the sum over the APs that report a
 * count (`reporting`), and how many moving APs report none (`missing`).
 */
export interface ClientTotals {
  total: number;
  reporting: number;
  missing: number;
}

/**
 * What moving the selected APs into a destination group means.
 */
export interface MovePlan {
  destination: WlanGroup;
  // True when another listed group has the destination's name: nothing is
  // planned then (`moving` and `alreadyThere` are empty), so no move can
  // target it (see isAmbiguousGroup())
  ambiguousDestination: boolean;
  // Selected APs that are not in the destination yet, in list order: the
  // only ones the move PATCHes
  moving: AccessPoint[];
  // Selected APs already in the destination (skipped, never PATCHed)
  alreadyThere: AccessPoint[];
  // The current groups of the moving APs, in order of first appearance
  sources: SourceGroup[];
  // Moving APs whose network change is known (their group is listed under a
  // unique name, and both its network list and the destination's are
  // reported) and whose current networks are unknown (no group, an unlisted
  // group, or a name several groups share)
  knownSourceCount: number;
  unknownSourceCount: number;
  // Moving APs whose group is identified but whose network change is
  // unknown because the controller did not report their group's network
  // list or the destination's (hasUnknownNetworks()). Present only when
  // non-zero; known + unknown + unreported = moving.length
  unreportedSourceCount?: number;
  // Present (true) only when the destination's network list was not
  // reported: no moving AP's network change is known then, so `networks`
  // claims nothing and every identified AP is in `unreportedSourceCount`
  destinationNetworksUnknown?: true;
  networks: NetworkDiff;
  clients: ClientTotals;
}

/**
 * The outcome of one AP's move.
 */
export interface MoveOutcome {
  mac: string;
  name: string;
  ok: boolean;
  // The controller's (or the IPC layer's) error message for a failed move;
  // null when there is none (e.g. the change was not accepted)
  error: string | null;
}

/**
 * The aggregate of a move run.
 */
export interface MoveSummary {
  total: number;
  succeededMacs: string[];
  failedMacs: string[];
}

/**
 * Why "Retry failed" cannot run after a move: the destination is no longer
 * listed, another group now has its name, or no failed AP is left to retry
 * (they are no longer listed, or already report the destination).
 */
export type RetryBlock = 'destinationGone' | 'destinationAmbiguous' | 'nothingLeft';

/**
 * The retry contract of a move run (its failed MACs and the destination id)
 * checked against the lists loaded after the run.
 */
export interface RetryCheck {
  // The failed APs "Retry failed" moves, in run order: still listed, and not
  // reporting the destination already
  retryMacs: string[];
  // Failed APs the lists no longer have
  missingCount: number;
  // Failed APs that now report the destination (counted only while the
  // destination resolves)
  inDestinationCount: number;
  // The destination as listed now (same id; its name may have changed), or
  // null when it is gone or ambiguous
  destination: WlanGroup | null;
  // Why the retry cannot run, or null when it can
  blocked: RetryBlock | null;
}

/**
 * Tells whether another listed group (another id) has the group's name. APs
 * name their group and never carry its id, so the members of such a group
 * cannot be told apart from the other's: it is not offered as a move
 * destination (no-op detection and the preview would be unverifiable).
 * @param {WlanGroup} group - The group.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {boolean} True when the group's name is ambiguous.
 */
export function isAmbiguousGroup(group: WlanGroup, groups: readonly WlanGroup[]): boolean {
  return groups.some(other => other.wlanId !== group.wlanId && other.wlanName === group.wlanName);
}

/**
 * Returns the group with the given name when exactly one listed group has
 * it. APs name their group (they do not carry its id), so a name several
 * groups share cannot be resolved, and neither can '' (no group).
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @param {string} name - A group name (an AP's `wlanGroup`).
 * @returns {WlanGroup | null} The group, or null when absent or ambiguous.
 */
export function findUniqueGroupByName(groups: readonly WlanGroup[], name: string): WlanGroup | null {
  if (name === '') {
    return null;
  }
  let found: WlanGroup | null = null;
  for (const group of groups) {
    if (group.wlanName === name) {
      if (found !== null) {
        return null;
      }
      found = group;
    }
  }
  return found;
} // End of function findUniqueGroupByName()

/**
 * Tells whether an AP is certainly in a group already: it names the group,
 * and no other listed group has that name. An ambiguous name never counts as
 * "in the group" (planMove() refuses ambiguous destinations altogether).
 * @param {AccessPoint} ap - The access point.
 * @param {WlanGroup} group - The group.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {boolean} True when the AP is in the group.
 */
export function isApInGroup(ap: AccessPoint, group: WlanGroup, groups: readonly WlanGroup[]): boolean {
  return ap.wlanGroup === group.wlanName && findUniqueGroupByName(groups, group.wlanName)?.wlanId === group.wlanId;
}

/**
 * Tells whether a group's network list is unknown: the controller did not
 * report it (`ssidListUnknown`, cloud session only). Its empty `ssidList`
 * then means "unknown", never "no networks", so no consumer may read it as
 * an empty group, a network count or a reach diff.
 * @param {WlanGroup} group - The group.
 * @returns {boolean} True when the group's networks are unknown.
 */
export function hasUnknownNetworks(group: WlanGroup): boolean {
  return group.ssidListUnknown === true;
}

/**
 * Returns a group's Wi-Fi network names, in order, without repetitions
 * (none for a group whose list is unknown: hasUnknownNetworks() tells that
 * apart from a group without networks).
 * @param {WlanGroup} group - The group.
 * @returns {string[]} The distinct SSID names.
 */
export function networkNames(group: WlanGroup): string[] {
  if (hasUnknownNetworks(group)) {
    return [];
  }
  return Array.from(new Set(group.ssidList.map(ssid => ssid.ssidName)));
}

/**
 * Compares the networks of the moving APs (one name list per AP whose
 * current group is known) with the destination's networks. A destination
 * network some APs already broadcast and others do not is "gained" with the
 * count of APs that gain it; a current network the destination lacks is
 * "lost" with the count of APs that broadcast it now. Without any known
 * source nothing can be compared, so the diff is empty.
 * @param {ReadonlyArray<readonly string[]>} sourceNetworks - The current
 *   network names of each moving AP with a known group.
 * @param {readonly string[]} destinationNetworks - The destination's network names.
 * @returns {NetworkDiff} Gained and lost (destination order, then order of
 *   first appearance) and unchanged networks.
 */
export function diffNetworks(sourceNetworks: ReadonlyArray<readonly string[]>, destinationNetworks: readonly string[]): NetworkDiff {
  if (sourceNetworks.length === 0) {
    return { gained: [], lost: [], unchanged: [] };
  }
  const destination = Array.from(new Set(destinationNetworks));
  const destinationSet = new Set(destination);
  const sourceSets = sourceNetworks.map(names => new Set(names));

  const gained: NetworkChange[] = [];
  const unchanged: string[] = [];
  for (const name of destination) {
    const gainers = sourceSets.filter(names => !names.has(name)).length;
    if (gainers === 0) {
      unchanged.push(name);
    } else {
      gained.push({ name, apCount: gainers });
    }
  }

  // A Map keeps insertion order: the lost networks follow the order of their
  // first appearance across the moving APs
  const lostCounts = new Map<string, number>();
  for (const names of sourceSets) {
    for (const name of names) {
      if (!destinationSet.has(name)) {
        lostCounts.set(name, (lostCounts.get(name) ?? 0) + 1);
      }
    }
  }
  const lost = Array.from(lostCounts, ([name, apCount]) => ({ name, apCount }));
  return { gained, lost, unchanged };
} // End of function diffNetworks()

/**
 * Plans moving the selected APs into a destination: which APs move (the
 * ones not in it yet) and which are skipped, their current groups, the
 * networks gained / lost / unchanged, and the clients on the moving APs.
 * An ambiguous destination (isAmbiguousGroup()) is refused: the plan moves
 * nothing and says why (`ambiguousDestination`), whatever the caller is. APs
 * whose own group name is ambiguous can still move into a unique
 * destination (they cannot be in it already); their current networks count
 * as unknown. When the network list of an AP's group, or the destination's,
 * was not reported (hasUnknownNetworks()), the AP's network change is
 * unknown: it is left out of the diff and counted in
 * `unreportedSourceCount` (and an unreported destination is flagged with
 * `destinationNetworksUnknown`), so no network is claimed gained or lost.
 * @param {readonly AccessPoint[]} selectedAps - The selected APs, in list
 *   order (visible or hidden by filters).
 * @param {WlanGroup} destination - The destination group.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @returns {MovePlan} The plan.
 */
export function planMove(selectedAps: readonly AccessPoint[], destination: WlanGroup, groups: readonly WlanGroup[]): MovePlan {
  if (isAmbiguousGroup(destination, groups)) {
    return {
      destination,
      ambiguousDestination: true,
      moving: [],
      alreadyThere: [],
      sources: [],
      knownSourceCount: 0,
      unknownSourceCount: 0,
      networks: { gained: [], lost: [], unchanged: [] },
      clients: { total: 0, reporting: 0, missing: 0 },
    };
  }

  const moving: AccessPoint[] = [];
  const alreadyThere: AccessPoint[] = [];
  for (const ap of selectedAps) {
    (isApInGroup(ap, destination, groups) ? alreadyThere : moving).push(ap);
  }

  const destinationUnknown = hasUnknownNetworks(destination);
  const sourceCounts = new Map<string, number>();
  const sourceNetworks: string[][] = [];
  let unreportedSourceCount = 0;
  const clients: ClientTotals = { total: 0, reporting: 0, missing: 0 };
  for (const ap of moving) {
    sourceCounts.set(ap.wlanGroup, (sourceCounts.get(ap.wlanGroup) ?? 0) + 1);
    const source = findUniqueGroupByName(groups, ap.wlanGroup);
    if (source !== null && (destinationUnknown || hasUnknownNetworks(source))) {
      unreportedSourceCount++;
    } else if (source !== null) {
      sourceNetworks.push(networkNames(source));
    }
    if (ap.clientNum !== undefined) {
      clients.total += ap.clientNum;
      clients.reporting++;
    } else {
      clients.missing++;
    }
  } // End of the loop that tallies the moving APs

  const plan: MovePlan = {
    destination,
    ambiguousDestination: false,
    moving,
    alreadyThere,
    sources: Array.from(sourceCounts, ([name, count]) => ({ name, count })),
    knownSourceCount: sourceNetworks.length,
    unknownSourceCount: moving.length - sourceNetworks.length - unreportedSourceCount,
    networks: diffNetworks(sourceNetworks, networkNames(destination)),
    clients,
  };
  // The two optional facts exist only when a network list is unknown, so a
  // plan from local data (which never sets the flag) is unchanged
  if (unreportedSourceCount > 0) {
    plan.unreportedSourceCount = unreportedSourceCount;
  }
  if (destinationUnknown) {
    plan.destinationNetworksUnknown = true;
  }
  return plan;
} // End of function planMove()

/**
 * Normalizes a destination search: trimmed and lower-cased.
 * @param {string} query - The search text as typed.
 * @returns {string} The normalized query ('' matches everything).
 */
export function normalizeSearch(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Tells whether a group matches the destination search: by its name or by
 * the name of any network it broadcasts (case-insensitive substring). A
 * group whose network list is unknown (hasUnknownNetworks()) matches by its
 * own name only: it has no network name to match, and its option shows
 * "Networks unknown" rather than names, so a network search hiding it never
 * contradicts what the pane shows.
 * @param {WlanGroup} group - The group.
 * @param {string} query - The search text as typed.
 * @returns {boolean} True when the group matches (always for an empty search).
 */
export function matchesDestinationSearch(group: WlanGroup, query: string): boolean {
  const needle = normalizeSearch(query);
  return needle === '' ||
    group.wlanName.toLowerCase().includes(needle) ||
    networkNames(group).some(name => name.toLowerCase().includes(needle));
}

/**
 * Splits the groups matching the destination search into the ones that
 * broadcast networks and the empty ones, which the pane pins in its
 * "Silence" section. A group whose network list is unknown is not known to
 * silence anything, so it stays with the others. Both keep the listing's
 * order.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @param {string} query - The search text as typed.
 * @returns {{ networks: WlanGroup[]; silence: WlanGroup[] }} The two sections.
 */
export function partitionDestinations(groups: readonly WlanGroup[], query: string): { networks: WlanGroup[]; silence: WlanGroup[] } {
  const networks: WlanGroup[] = [];
  const silence: WlanGroup[] = [];
  for (const group of groups) {
    if (matchesDestinationSearch(group, query)) {
      (group.ssidList.length === 0 && !hasUnknownNetworks(group) ? silence : networks).push(group);
    }
  }
  return { networks, silence };
} // End of function partitionDestinations()

/**
 * Orders network names for a group's preview so the ones matching the
 * search come first (a truncated preview then still shows why the group
 * matched); the relative order is kept otherwise.
 * @param {readonly string[]} names - The group's network names.
 * @param {string} query - The search text as typed.
 * @returns {string[]} The names, matches first.
 */
export function orderNetworksForSearch(names: readonly string[], query: string): string[] {
  const needle = normalizeSearch(query);
  if (needle === '') {
    return [...names];
  }
  const matching = names.filter(name => name.toLowerCase().includes(needle));
  const others = names.filter(name => !name.toLowerCase().includes(needle));
  return [...matching, ...others];
} // End of function orderNetworksForSearch()

/**
 * Counts the APs the current filters hide.
 * @param {readonly AccessPoint[]} aps - The APs (e.g. the moving ones).
 * @param {readonly string[]} visibleMacs - The visible rows' MACs.
 * @returns {number} How many of the APs are not visible.
 */
export function countHiddenAps(aps: readonly AccessPoint[], visibleMacs: readonly string[]): number {
  const visible = new Set(visibleMacs);
  return aps.filter(ap => !visible.has(ap.mac)).length;
}

/**
 * Turns the error a failed move threw into the message shown in the per-AP
 * results: the controller's text without Electron's IPC prefix or the error
 * class name, whitespace collapsed, capped in length.
 * @param {unknown} error - What the move call threw.
 * @returns {string | null} The message, or null when there is none.
 */
export function describeMoveError(error: unknown): string | null {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    return null;
  }
  message = message.replace(IPC_ERROR_PREFIX, '');
  // Both the main-process error and the IPC wrapper may add a class name
  for (let pass = 0; pass < 3 && ERROR_NAME_PREFIX.test(message); pass++) {
    message = message.replace(ERROR_NAME_PREFIX, '');
  }
  message = message.replace(/\s+/g, ' ').trim();
  if (message === '') {
    return null;
  }
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
} // End of function describeMoveError()

/**
 * Aggregates the outcomes of a move run.
 * @param {readonly MoveOutcome[]} outcomes - One outcome per attempted AP.
 * @returns {MoveSummary} The total and the MACs that succeeded and failed.
 */
export function summarizeMoveOutcomes(outcomes: readonly MoveOutcome[]): MoveSummary {
  return {
    total: outcomes.length,
    succeededMacs: outcomes.filter(outcome => outcome.ok).map(outcome => outcome.mac),
    failedMacs: outcomes.filter(outcome => !outcome.ok).map(outcome => outcome.mac),
  };
}

/**
 * Returns the AP list with the moved APs reporting their new group (the
 * local update that keeps the list right even when the reload after a move
 * fails). The other APs are returned unchanged.
 * @param {readonly AccessPoint[]} accessPoints - All loaded APs.
 * @param {readonly string[]} movedMacs - The MACs that moved.
 * @param {string} groupName - The destination group's name.
 * @returns {AccessPoint[]} The updated list (new objects for the moved APs).
 */
export function applyMovedGroup(accessPoints: readonly AccessPoint[], movedMacs: readonly string[], groupName: string): AccessPoint[] {
  const moved = new Set(movedMacs);
  return accessPoints.map(ap => (moved.has(ap.mac) ? { ...ap, wlanGroup: groupName } : ap));
}

/**
 * Checks a run's retry contract (its failed MACs and the destination id, as
 * they were when the run ended) against the lists as loaded now — the reload
 * after a move may have dropped failed APs or the destination, or a rename
 * may have made the destination's name ambiguous. Each failed AP is retried
 * only while it is still listed and does not report the destination already;
 * the destination is resolved by id. The first reason that blocks the retry
 * wins: destination gone, destination ambiguous, then nothing left to retry.
 * @param {readonly string[]} failedMacs - The run's failed MACs, in run order.
 * @param {string} destinationId - The run's destination group id.
 * @param {readonly AccessPoint[]} accessPoints - The APs as loaded now.
 * @param {readonly WlanGroup[]} groups - The groups as loaded now.
 * @returns {RetryCheck} What the retry covers, or why it cannot run.
 */
export function checkRetry(
  failedMacs: readonly string[],
  destinationId: string,
  accessPoints: readonly AccessPoint[],
  groups: readonly WlanGroup[],
): RetryCheck {
  const listed = groups.find(group => group.wlanId === destinationId) ?? null;
  const destination = listed !== null && !isAmbiguousGroup(listed, groups) ? listed : null;
  const byMac = new Map(accessPoints.map(ap => [ap.mac, ap]));

  const retryMacs: string[] = [];
  let missingCount = 0;
  let inDestinationCount = 0;
  for (const mac of failedMacs) {
    const ap = byMac.get(mac);
    if (ap === undefined) {
      missingCount++;
    } else if (destination !== null && isApInGroup(ap, destination, groups)) {
      inDestinationCount++;
    } else {
      retryMacs.push(mac);
    }
  } // End of the loop that sorts the failed APs

  let blocked: RetryBlock | null = null;
  if (listed === null) {
    blocked = 'destinationGone';
  } else if (destination === null) {
    blocked = 'destinationAmbiguous';
  } else if (retryMacs.length === 0) {
    blocked = 'nothingLeft';
  }
  return { retryMacs, missingCount, inDestinationCount, destination, blocked };
} // End of function checkRetry()
