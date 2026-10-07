// Tests for the move planning helpers (src/renderer/move-plan.ts, a DOM-free
// module): group resolution by name (unique names only), ambiguous
// (same-named) groups refused as destinations, which selected APs move and
// which are already in the destination (mixed selections and no-op moves),
// the networks gained / lost / unchanged, the clients on the moving APs, the
// destination search (group AND network names) with the "Silence"
// partition, the error text of a failed move, the result aggregation, and
// the "Retry failed" contract checked after the reload; and groups whose
// network list the controller did not report (`ssidListUnknown`): never "no
// networks", no claimed reach diff, never pinned under "Silence".

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AccessPoint, WlanGroup } from '../../src/shared/types';
import {
  applyMovedGroup,
  checkRetry,
  countHiddenAps,
  describeMoveError,
  diffNetworks,
  findUniqueGroupByName,
  hasUnknownNetworks,
  isAmbiguousGroup,
  isApInGroup,
  matchesDestinationSearch,
  networkNames,
  normalizeSearch,
  orderNetworksForSearch,
  partitionDestinations,
  planMove,
  summarizeMoveOutcomes,
  type MoveOutcome,
} from '../../src/renderer/move-plan';

/**
 * Builds a group for the tests.
 * @param {string} wlanId - Group id.
 * @param {string} wlanName - Group name.
 * @param {string[]} ssids - Network names.
 * @returns {WlanGroup} The group.
 */
function group(wlanId: string, wlanName: string, ssids: string[]): WlanGroup {
  return { wlanId, wlanName, ssidList: ssids.map(ssidName => ({ ssidName })) };
}

/**
 * Builds an access point for the tests.
 * @param {string} mac - MAC address.
 * @param {string} name - AP name.
 * @param {string} wlanGroup - Current group name ('' = none).
 * @param {number} [clientNum] - Optional client count.
 * @returns {AccessPoint} The AP.
 */
function ap(mac: string, name: string, wlanGroup: string, clientNum?: number): AccessPoint {
  const entry: AccessPoint = { mac, name, type: 'ap', wlanGroup, statusCategory: 1 };
  return clientNum === undefined ? entry : { ...entry, clientNum };
}

const DEFAULT = group('g1', 'Default', ['Casa', 'Invitados']);
const OFFICE = group('g2', 'Oficina', ['Casa', 'Trabajo', 'IoT']);
const SILENT = group('g3', 'zNinguna', []);
const TWIN_A = group('g4', 'Gemelo', ['A']);
const TWIN_B = group('g5', 'Gemelo', ['B']);
const GROUPS: WlanGroup[] = [DEFAULT, OFFICE, SILENT, TWIN_A, TWIN_B];

/**
 * Builds a group whose network list the controller did not report (the
 * cloud session's `ssidList: []` + `ssidListUnknown: true`).
 * @param {string} wlanId - Group id.
 * @param {string} wlanName - Group name.
 * @param {string[]} [ssids] - A stray list (must be ignored); empty by default.
 * @returns {WlanGroup} The group.
 */
function unknownGroup(wlanId: string, wlanName: string, ssids: string[] = []): WlanGroup {
  return { ...group(wlanId, wlanName, ssids), ssidListUnknown: true };
}

describe('findUniqueGroupByName()', () => {
  test('resolves a name exactly one group has', () => {
    assert.equal(findUniqueGroupByName(GROUPS, 'Oficina'), OFFICE);
  });

  test('a missing name, no group ("") and a name two groups share do not resolve', () => {
    assert.equal(findUniqueGroupByName(GROUPS, 'Nada'), null);
    assert.equal(findUniqueGroupByName(GROUPS, ''), null);
    assert.equal(findUniqueGroupByName(GROUPS, 'Gemelo'), null);
  });
});

describe('isApInGroup()', () => {
  test('true only when the AP names the group and the name is unique', () => {
    assert.equal(isApInGroup(ap('m1', 'A1', 'Default'), DEFAULT, GROUPS), true);
    assert.equal(isApInGroup(ap('m1', 'A1', 'Oficina'), DEFAULT, GROUPS), false);
    assert.equal(isApInGroup(ap('m1', 'A1', ''), DEFAULT, GROUPS), false);
  });

  test('an ambiguous destination name never counts as "already there" (planMove() refuses such destinations altogether)', () => {
    assert.equal(isApInGroup(ap('m1', 'A1', 'Gemelo'), TWIN_A, GROUPS), false);
    assert.equal(isApInGroup(ap('m1', 'A1', 'Gemelo'), TWIN_B, GROUPS), false);
  });

  test('compares by id: a copy of the destination object still matches', () => {
    assert.equal(isApInGroup(ap('m1', 'A1', 'Default'), { ...DEFAULT }, GROUPS), true);
  });
});

describe('isAmbiguousGroup()', () => {
  test('true when another group (another id) has the same name', () => {
    assert.equal(isAmbiguousGroup(TWIN_A, GROUPS), true);
    assert.equal(isAmbiguousGroup(TWIN_B, GROUPS), true);
  });

  test('false for a unique name, for a group missing from the listing, and for the same group listed twice', () => {
    assert.equal(isAmbiguousGroup(DEFAULT, GROUPS), false);
    assert.equal(isAmbiguousGroup(group('g9', 'Nueva', []), GROUPS), false);
    assert.equal(isAmbiguousGroup(DEFAULT, [DEFAULT, { ...DEFAULT }]), false);
  });
});

describe('networkNames()', () => {
  test('keeps the order and drops repeated names', () => {
    assert.deepEqual(networkNames(group('x', 'X', ['B', 'A', 'B', 'C', 'A'])), ['B', 'A', 'C']);
    assert.deepEqual(networkNames(SILENT), []);
  });
});

describe('diffNetworks()', () => {
  test('one source: gained = destination only, lost = source only, unchanged = both', () => {
    assert.deepEqual(diffNetworks([['Casa', 'Invitados']], ['Casa', 'Trabajo', 'IoT']), {
      gained: [{ name: 'Trabajo', apCount: 1 }, { name: 'IoT', apCount: 1 }],
      lost: [{ name: 'Invitados', apCount: 1 }],
      unchanged: ['Casa'],
    });
  });

  test('several sources: a network some APs already broadcast is gained by the others only; lost counts the APs that had it', () => {
    const diff = diffNetworks([['Casa', 'Invitados'], ['Casa', 'Trabajo'], ['Trabajo']], ['Casa', 'Trabajo']);
    assert.deepEqual(diff.gained, [{ name: 'Casa', apCount: 1 }, { name: 'Trabajo', apCount: 1 }]);
    assert.deepEqual(diff.lost, [{ name: 'Invitados', apCount: 1 }]);
    assert.deepEqual(diff.unchanged, []);
  });

  test('every AP already broadcasting a destination network makes it unchanged', () => {
    assert.deepEqual(diffNetworks([['Casa'], ['Casa', 'X']], ['Casa']), {
      gained: [],
      lost: [{ name: 'X', apCount: 1 }],
      unchanged: ['Casa'],
    });
  });

  test('a destination without networks loses everything (silencing)', () => {
    assert.deepEqual(diffNetworks([['Casa', 'Invitados'], ['Casa']], []), {
      gained: [],
      lost: [{ name: 'Casa', apCount: 2 }, { name: 'Invitados', apCount: 1 }],
      unchanged: [],
    });
  });

  test('lost networks follow their first appearance across the APs; repeated destination names count once', () => {
    const diff = diffNetworks([['B', 'A'], ['C', 'A']], ['Z', 'Z']);
    assert.deepEqual(diff.lost.map(change => change.name), ['B', 'A', 'C']);
    assert.deepEqual(diff.gained, [{ name: 'Z', apCount: 2 }]);
  });

  test('without any known source nothing is claimed', () => {
    assert.deepEqual(diffNetworks([], ['Casa']), { gained: [], lost: [], unchanged: [] });
  });
});

describe('planMove()', () => {
  test('mixed selection: APs already in the destination are skipped, the rest move in list order', () => {
    const selected = [ap('m1', 'A1', 'Oficina'), ap('m2', 'A2', 'Default'), ap('m3', 'A3', 'Oficina'), ap('m4', 'A4', 'zNinguna')];
    const plan = planMove(selected, OFFICE, GROUPS);
    assert.deepEqual(plan.moving.map(entry => entry.mac), ['m2', 'm4']);
    assert.deepEqual(plan.alreadyThere.map(entry => entry.mac), ['m1', 'm3']);
    assert.equal(plan.destination, OFFICE);
  });

  test('no-op: when every selected AP is already in the destination nothing moves', () => {
    const plan = planMove([ap('m1', 'A1', 'Default'), ap('m2', 'A2', 'Default')], DEFAULT, GROUPS);
    assert.equal(plan.moving.length, 0);
    assert.equal(plan.alreadyThere.length, 2);
    assert.deepEqual(plan.sources, []);
    assert.deepEqual(plan.networks, { gained: [], lost: [], unchanged: [] });
    assert.deepEqual(plan.clients, { total: 0, reporting: 0, missing: 0 });
  });

  test('sources: the moving APs\' current groups with counts, in order of first appearance ("" = no group)', () => {
    const selected = [ap('m1', 'A1', 'Oficina'), ap('m2', 'A2', ''), ap('m3', 'A3', 'Oficina'), ap('m4', 'A4', 'Default')];
    const plan = planMove(selected, SILENT, GROUPS);
    assert.deepEqual(plan.sources, [{ name: 'Oficina', count: 2 }, { name: '', count: 1 }, { name: 'Default', count: 1 }]);
  });

  test('networks: computed from the APs whose group is known; no group, unlisted and ambiguous groups count as unknown', () => {
    const selected = [ap('m1', 'A1', 'Default'), ap('m2', 'A2', ''), ap('m3', 'A3', 'Borrado'), ap('m4', 'A4', 'Gemelo'), ap('m5', 'A5', 'zNinguna')];
    const plan = planMove(selected, OFFICE, GROUPS);
    assert.equal(plan.knownSourceCount, 2);
    assert.equal(plan.unknownSourceCount, 3);
    assert.deepEqual(plan.networks, {
      gained: [{ name: 'Casa', apCount: 1 }, { name: 'Trabajo', apCount: 2 }, { name: 'IoT', apCount: 2 }],
      lost: [{ name: 'Invitados', apCount: 1 }],
      unchanged: [],
    });
  });

  test('moving into an empty group loses every current network', () => {
    const plan = planMove([ap('m1', 'A1', 'Default')], SILENT, GROUPS);
    assert.deepEqual(plan.networks, { gained: [], lost: [{ name: 'Casa', apCount: 1 }, { name: 'Invitados', apCount: 1 }], unchanged: [] });
  });

  test('clients: the sum over the moving APs that report a count, and how many report none (never invented)', () => {
    const selected = [ap('m1', 'A1', 'Default', 12), ap('m2', 'A2', 'Default', 0), ap('m3', 'A3', 'Default'), ap('m4', 'A4', 'Oficina', 5)];
    const plan = planMove(selected, OFFICE, GROUPS);
    // m4 is already in Oficina: its 5 clients do not move
    assert.deepEqual(plan.clients, { total: 12, reporting: 2, missing: 1 });
  });

  test('an ambiguous destination is refused: nothing moves, nothing is "already there", no preview facts', () => {
    // m2 names "Gemelo": it may or may not be in TWIN_A, which cannot be told
    const selected = [ap('m1', 'A1', 'Default', 4), ap('m2', 'A2', 'Gemelo', 2), ap('m3', 'A3', '')];
    for (const destination of [TWIN_A, TWIN_B]) {
      const plan = planMove(selected, destination, GROUPS);
      assert.equal(plan.ambiguousDestination, true);
      assert.equal(plan.destination, destination);
      assert.deepEqual(plan.moving, []);
      assert.deepEqual(plan.alreadyThere, []);
      assert.deepEqual(plan.sources, []);
      assert.equal(plan.knownSourceCount, 0);
      assert.equal(plan.unknownSourceCount, 0);
      assert.deepEqual(plan.networks, { gained: [], lost: [], unchanged: [] });
      assert.deepEqual(plan.clients, { total: 0, reporting: 0, missing: 0 });
    } // End of the loop over both twin destinations
  });

  test('a unique destination is not ambiguous, even when the selection includes APs of an ambiguous group', () => {
    assert.equal(planMove([ap('m1', 'A1', 'Gemelo')], OFFICE, GROUPS).ambiguousDestination, false);
  });

  test('an AP in an ambiguous-named group moving to a unique destination is a real move, its current networks unknown', () => {
    const plan = planMove([ap('m1', 'A1', 'Gemelo', 7)], OFFICE, GROUPS);
    assert.deepEqual(plan.moving.map(entry => entry.mac), ['m1']);
    assert.deepEqual(plan.alreadyThere, []);
    assert.deepEqual(plan.sources, [{ name: 'Gemelo', count: 1 }]);
    assert.equal(plan.knownSourceCount, 0);
    assert.equal(plan.unknownSourceCount, 1);
    // No known source: nothing is claimed about gains or losses
    assert.deepEqual(plan.networks, { gained: [], lost: [], unchanged: [] });
    assert.deepEqual(plan.clients, { total: 7, reporting: 1, missing: 0 });
  });

  test('preview honesty: with a known and an ambiguous-named source, only the known AP\'s networks are compared (neither twin\'s networks is claimed)', () => {
    const plan = planMove([ap('m1', 'A1', 'Default'), ap('m2', 'A2', 'Gemelo')], OFFICE, GROUPS);
    assert.equal(plan.knownSourceCount, 1);
    assert.equal(plan.unknownSourceCount, 1);
    assert.deepEqual(plan.networks, {
      gained: [{ name: 'Trabajo', apCount: 1 }, { name: 'IoT', apCount: 1 }],
      lost: [{ name: 'Invitados', apCount: 1 }],
      unchanged: ['Casa'],
    });
    const named = [...plan.networks.gained, ...plan.networks.lost].map(change => change.name).concat(plan.networks.unchanged);
    assert.equal(named.includes('A') || named.includes('B'), false);
  });
});

describe('destination search', () => {
  test('normalizeSearch() trims and lower-cases', () => {
    assert.equal(normalizeSearch('  OfIcInA '), 'oficina');
  });

  test('matches group names and network names, case-insensitively; an empty search matches everything', () => {
    assert.equal(matchesDestinationSearch(OFFICE, 'ofic'), true);
    assert.equal(matchesDestinationSearch(OFFICE, 'TRABAJO'), true);
    assert.equal(matchesDestinationSearch(DEFAULT, 'trabajo'), false);
    assert.equal(matchesDestinationSearch(SILENT, '   '), true);
    assert.equal(matchesDestinationSearch(SILENT, 'casa'), false);
  });

  test('partitionDestinations(): groups with networks and the empty ones ("Silence"), each in listing order', () => {
    assert.deepEqual(partitionDestinations(GROUPS, ''), { networks: [DEFAULT, OFFICE, TWIN_A, TWIN_B], silence: [SILENT] });
    assert.deepEqual(partitionDestinations(GROUPS, 'casa'), { networks: [DEFAULT, OFFICE], silence: [] });
    assert.deepEqual(partitionDestinations(GROUPS, 'ningu'), { networks: [], silence: [SILENT] });
    assert.deepEqual(partitionDestinations(GROUPS, 'zzz'), { networks: [], silence: [] });
  });

  test('orderNetworksForSearch(): matching names first, the relative order kept', () => {
    assert.deepEqual(orderNetworksForSearch(['Oficina', 'Taller', 'Almacén', 'Tienda', 'IoT'], 'ti'), ['Tienda', 'Oficina', 'Taller', 'Almacén', 'IoT']);
    assert.deepEqual(orderNetworksForSearch(['B', 'A'], ''), ['B', 'A']);
  });
});

describe('countHiddenAps()', () => {
  test('counts the APs that are not among the visible rows', () => {
    const aps = [ap('m1', 'A1', ''), ap('m2', 'A2', ''), ap('m3', 'A3', '')];
    assert.equal(countHiddenAps(aps, ['m2']), 2);
    assert.equal(countHiddenAps(aps, ['m1', 'm2', 'm3']), 0);
    assert.equal(countHiddenAps([], []), 0);
  });
});

describe('describeMoveError()', () => {
  test('strips Electron\'s IPC prefix and the error class name, keeping the controller\'s message', () => {
    assert.equal(describeMoveError(new Error("Error invoking remote method 'omada:set-wlan': Error: Device is busy")), 'Device is busy');
    assert.equal(describeMoveError(new Error("Error invoking remote method 'omada:set-wlan': TypeError: Error: nested")), 'nested');
    assert.equal(describeMoveError(new Error('Not connected to the controller')), 'Not connected to the controller');
    assert.equal(describeMoveError('Error: plain string'), 'plain string');
  });

  test('collapses whitespace and caps the length', () => {
    assert.equal(describeMoveError(new Error('line one\n\n  line   two ')), 'line one line two');
    const long = describeMoveError(new Error('x'.repeat(500)));
    assert.equal(long?.length, 200);
    assert.equal(long?.endsWith('…'), true);
  });

  test('nothing usable gives null (the UI then says the change was not accepted)', () => {
    assert.equal(describeMoveError(undefined), null);
    assert.equal(describeMoveError({ message: 'not an Error' }), null);
    assert.equal(describeMoveError(new Error('')), null);
    assert.equal(describeMoveError(new Error("Error invoking remote method 'omada:set-wlan': Error: ")), null);
  });
});

describe('summarizeMoveOutcomes() and applyMovedGroup()', () => {
  const outcomes: MoveOutcome[] = [
    { mac: 'm1', name: 'A1', ok: true, error: null },
    { mac: 'm2', name: 'A2', ok: false, error: 'Device is busy' },
    { mac: 'm3', name: 'A3', ok: true, error: null },
    { mac: 'm4', name: 'A4', ok: false, error: null },
  ];

  test('splits the MACs into succeeded and failed, in run order', () => {
    assert.deepEqual(summarizeMoveOutcomes(outcomes), { total: 4, succeededMacs: ['m1', 'm3'], failedMacs: ['m2', 'm4'] });
    assert.deepEqual(summarizeMoveOutcomes([]), { total: 0, succeededMacs: [], failedMacs: [] });
  });

  test('the moved APs report the destination; the others and the input list stay untouched', () => {
    const before = [ap('m1', 'A1', 'Default'), ap('m2', 'A2', 'Oficina'), ap('m3', 'A3', '')];
    const after = applyMovedGroup(before, ['m1', 'm3'], 'zNinguna');
    assert.deepEqual(after.map(entry => entry.wlanGroup), ['zNinguna', 'Oficina', 'zNinguna']);
    assert.deepEqual(before.map(entry => entry.wlanGroup), ['Default', 'Oficina', '']);
    assert.equal(after[1], before[1]);
  });
});

describe('checkRetry() (the "Retry failed" contract after the reload)', () => {
  // The lists as reloaded after a run into OFFICE where m1, m2 and m3 failed
  const RELOADED_APS = [ap('m1', 'A1', 'Default'), ap('m2', 'A2', ''), ap('m3', 'A3', 'zNinguna'), ap('m4', 'A4', 'Oficina')];

  test('every failed AP and the destination still listed: all are retried, nothing blocks', () => {
    assert.deepEqual(checkRetry(['m1', 'm2', 'm3'], OFFICE.wlanId, RELOADED_APS, GROUPS), {
      retryMacs: ['m1', 'm2', 'm3'], missingCount: 0, inDestinationCount: 0, destination: OFFICE, blocked: null,
    });
  });

  test('some failed APs vanished: they are counted, only the rest is retried (run order kept)', () => {
    const aps = RELOADED_APS.filter(entry => entry.mac !== 'm2');
    assert.deepEqual(checkRetry(['m1', 'm2', 'm3'], OFFICE.wlanId, aps, GROUPS), {
      retryMacs: ['m1', 'm3'], missingCount: 1, inDestinationCount: 0, destination: OFFICE, blocked: null,
    });
  });

  test('no failed AP is listed any more: nothing left to retry', () => {
    const check = checkRetry(['m1', 'm2'], OFFICE.wlanId, [ap('m4', 'A4', 'Oficina')], GROUPS);
    assert.deepEqual(check.retryMacs, []);
    assert.equal(check.missingCount, 2);
    assert.equal(check.blocked, 'nothingLeft');
    assert.equal(check.destination, OFFICE);
  });

  test('a failed AP that now reports the destination is not retried; when all do, nothing is left', () => {
    const aps = [ap('m1', 'A1', 'Oficina'), ap('m2', 'A2', '')];
    assert.deepEqual(checkRetry(['m1', 'm2'], OFFICE.wlanId, aps, GROUPS), {
      retryMacs: ['m2'], missingCount: 0, inDestinationCount: 1, destination: OFFICE, blocked: null,
    });
    const allThere = checkRetry(['m1'], OFFICE.wlanId, aps, GROUPS);
    assert.equal(allThere.inDestinationCount, 1);
    assert.equal(allThere.blocked, 'nothingLeft');
  });

  test('the destination is gone: blocked, whatever the APs (and it wins over "nothing left")', () => {
    const groups = GROUPS.filter(entry => entry.wlanId !== OFFICE.wlanId);
    const check = checkRetry(['m1', 'm9'], OFFICE.wlanId, RELOADED_APS, groups);
    assert.equal(check.blocked, 'destinationGone');
    assert.equal(check.destination, null);
    assert.equal(check.missingCount, 1);
    assert.equal(checkRetry(['m9'], OFFICE.wlanId, RELOADED_APS, groups).blocked, 'destinationGone');
  });

  test('another group now has the destination\'s name: blocked as ambiguous', () => {
    const groups = [...GROUPS, group('g8', 'Oficina', ['Otra'])];
    const check = checkRetry(['m1'], OFFICE.wlanId, RELOADED_APS, groups);
    assert.equal(check.blocked, 'destinationAmbiguous');
    assert.equal(check.destination, null);
    assert.equal(check.inDestinationCount, 0);
  });

  test('the destination is resolved by id: a renamed (still unique) destination is retried under its new name', () => {
    const renamed = group(OFFICE.wlanId, 'Oficina 2', ['Casa']);
    const groups = GROUPS.map(entry => (entry.wlanId === OFFICE.wlanId ? renamed : entry));
    const check = checkRetry(['m1', 'm4'], OFFICE.wlanId, RELOADED_APS, groups);
    // m4 still names the old "Oficina", which no listed group has now
    assert.deepEqual(check, { retryMacs: ['m1', 'm4'], missingCount: 0, inDestinationCount: 0, destination: renamed, blocked: null });
  });
});

describe('unknown network lists (ssidListUnknown: the controller did not report a group\'s networks)', () => {
  const CLOUD = unknownGroup('c1', 'Nube');
  const CLOUD_B = unknownGroup('c2', 'Nube B');
  const CLOUD_GROUPS: WlanGroup[] = [...GROUPS, CLOUD, CLOUD_B];
  const NO_DIFF = { gained: [], lost: [], unchanged: [] };

  test('hasUnknownNetworks() is true only for the flag; such a group has no network name, even a stray one', () => {
    assert.equal(hasUnknownNetworks(CLOUD), true);
    for (const known of GROUPS) {
      assert.equal(hasUnknownNetworks(known), false, known.wlanName);
    }
    assert.deepEqual(networkNames(CLOUD), []);
    assert.deepEqual(networkNames(unknownGroup('x', 'X', ['Casa'])), []);
  });

  test('an unknown destination claims no network change: every identified AP is "unreported", the unidentified ones stay unknown', () => {
    const selected = [ap('m1', 'A1', 'Default', 3), ap('m2', 'A2', 'Oficina'), ap('m3', 'A3', ''), ap('m4', 'A4', 'Nube B')];
    const plan = planMove(selected, CLOUD, CLOUD_GROUPS);
    assert.equal(plan.destinationNetworksUnknown, true);
    assert.equal(plan.knownSourceCount, 0);
    assert.equal(plan.unknownSourceCount, 1);
    assert.equal(plan.unreportedSourceCount, 3);
    // Not "loses everything" (the empty-group reading) and not "no change"
    assert.deepEqual(plan.networks, NO_DIFF);
    // The rest of the plan is as usual
    assert.equal(plan.ambiguousDestination, false);
    assert.deepEqual(plan.moving.map(entry => entry.mac), ['m1', 'm2', 'm3', 'm4']);
    assert.deepEqual(plan.sources, [{ name: 'Default', count: 1 }, { name: 'Oficina', count: 1 }, { name: '', count: 1 }, { name: 'Nube B', count: 1 }]);
    assert.deepEqual(plan.clients, { total: 3, reporting: 1, missing: 3 });
  });

  test('an AP already in an unknown destination is skipped like any other', () => {
    const plan = planMove([ap('m1', 'A1', 'Nube'), ap('m2', 'A2', 'Default')], CLOUD, CLOUD_GROUPS);
    assert.deepEqual(plan.alreadyThere.map(entry => entry.mac), ['m1']);
    assert.deepEqual(plan.moving.map(entry => entry.mac), ['m2']);
    assert.equal(plan.unreportedSourceCount, 1);
    assert.deepEqual(plan.networks, NO_DIFF);
  });

  test('mixed sources: the known AP keeps its diff, the AP from an unknown group is flagged apart (never "loses nothing")', () => {
    const plan = planMove([ap('m1', 'A1', 'Default'), ap('m2', 'A2', 'Nube'), ap('m3', 'A3', 'Gemelo')], OFFICE, CLOUD_GROUPS);
    assert.equal(plan.knownSourceCount, 1);
    assert.equal(plan.unknownSourceCount, 1);
    assert.equal(plan.unreportedSourceCount, 1);
    assert.equal('destinationNetworksUnknown' in plan, false);
    // Exactly the diff of the known AP alone
    assert.deepEqual(plan.networks, {
      gained: [{ name: 'Trabajo', apCount: 1 }, { name: 'IoT', apCount: 1 }],
      lost: [{ name: 'Invitados', apCount: 1 }],
      unchanged: ['Casa'],
    });
    assert.deepEqual(plan.networks, planMove([ap('m1', 'A1', 'Default')], OFFICE, CLOUD_GROUPS).networks);
  });

  test('only unknown sources into a known destination: nothing known to compare, every AP flagged', () => {
    const plan = planMove([ap('m1', 'A1', 'Nube'), ap('m2', 'A2', 'Nube B')], SILENT, CLOUD_GROUPS);
    assert.equal(plan.knownSourceCount, 0);
    assert.equal(plan.unknownSourceCount, 0);
    assert.equal(plan.unreportedSourceCount, 2);
    // Not "loses every current network" (they are not known)
    assert.deepEqual(plan.networks, NO_DIFF);
  });

  test('known + unknown + unreported always add up to the moving APs', () => {
    const selected = [ap('m1', 'A1', 'Default'), ap('m2', 'A2', 'Nube'), ap('m3', 'A3', ''), ap('m4', 'A4', 'Borrado'), ap('m5', 'A5', 'Oficina')];
    for (const destination of [OFFICE, SILENT, CLOUD, CLOUD_B]) {
      const plan = planMove(selected, destination, CLOUD_GROUPS);
      assert.equal(plan.knownSourceCount + plan.unknownSourceCount + (plan.unreportedSourceCount ?? 0), plan.moving.length, destination.wlanName);
    }
  });

  test('flag absent: a plan carries no unreported facts and is the same whether unknown groups are listed or not', () => {
    const plan = planMove([ap('m1', 'A1', 'Default'), ap('m2', 'A2', '')], OFFICE, GROUPS);
    assert.deepEqual(Object.keys(plan), ['destination', 'ambiguousDestination', 'moving', 'alreadyThere', 'sources', 'knownSourceCount', 'unknownSourceCount', 'networks', 'clients']);
    assert.deepEqual(planMove([ap('m1', 'A1', 'Default'), ap('m2', 'A2', '')], OFFICE, CLOUD_GROUPS), plan);
  });

  test('an unknown destination another group names is still refused as ambiguous, with no unreported facts', () => {
    const twin = unknownGroup('c3', 'Oficina');
    const plan = planMove([ap('m1', 'A1', 'Default')], twin, [...GROUPS, twin]);
    assert.equal(plan.ambiguousDestination, true);
    assert.equal('unreportedSourceCount' in plan, false);
    assert.equal('destinationNetworksUnknown' in plan, false);
  });

  test('destination search: an unknown group matches by its own name only (it has no network name to match)', () => {
    assert.equal(matchesDestinationSearch(CLOUD, 'NUB'), true);
    assert.equal(matchesDestinationSearch(CLOUD, '  '), true);
    assert.equal(matchesDestinationSearch(CLOUD, 'casa'), false);
    assert.equal(matchesDestinationSearch(unknownGroup('x', 'X', ['Casa']), 'casa'), false);
  });

  test('partitionDestinations(): an unknown group is never pinned under "Silence"; the known groups are unchanged', () => {
    assert.deepEqual(partitionDestinations(CLOUD_GROUPS, ''), { networks: [DEFAULT, OFFICE, TWIN_A, TWIN_B, CLOUD, CLOUD_B], silence: [SILENT] });
    assert.deepEqual(partitionDestinations(CLOUD_GROUPS, 'nube b'), { networks: [CLOUD_B], silence: [] });
    assert.deepEqual(partitionDestinations(CLOUD_GROUPS, 'casa'), { networks: [DEFAULT, OFFICE], silence: [] });
  });
}); // End of the describe block for unknown network lists
