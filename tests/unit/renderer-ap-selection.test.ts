// Tests for the Access points view's pure helpers
// (src/renderer/ap-selection.ts, a DOM-free module): filtering by search
// text, status and group; Shift-click / Shift+Arrow range selection; the
// "N selected (M hidden by filters)" counts; pruning after a reload; the
// sidebar's distinct-SSID total; the per-AP network count; and the boundary
// check of the optional client count.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AccessPoint, WlanGroup } from '../../src/shared/types';
import {
  applySelection,
  countDistinctSsids,
  countSelection,
  distinctSsidCountKind,
  filterAccessPoints,
  GROUP_FILTER_UNASSIGNED,
  GROUP_FILTER_UNKNOWN,
  indexGroupsByName,
  isFilterActive,
  matchesStatusFilter,
  missingGroupKey,
  networkCountFor,
  networkListKeys,
  planRangeSelection,
  pruneSelection,
  rangeBetween,
  sanitizeClientCount,
  selectedAccessPoints,
  STATUS_FILTER_ALL,
  STATUS_FILTER_UNKNOWN,
  type ApFilters,
} from '../../src/renderer/ap-selection';
import { translations } from '../../src/renderer/i18n-strings';
import { hasUnknownGroup } from '../../src/renderer/move-plan';
import { isValidWlanId } from '../../src/renderer/validation';

/**
 * Builds an AccessPoint DTO for the tests.
 * @param {string} mac - MAC address.
 * @param {string} name - AP name.
 * @param {string} wlanGroup - Group name ('' = unassigned).
 * @param {number} statusCategory - Status category.
 * @returns {AccessPoint} The AP.
 */
function ap(mac: string, name: string, wlanGroup: string, statusCategory: number): AccessPoint {
  return { mac, name, type: 'ap', wlanGroup, statusCategory };
}

const APS: AccessPoint[] = [
  ap('AA-00-00-00-00-01', 'Aula 1', 'Grupo A', 1),
  ap('AA-00-00-00-00-02', 'Aula 2', 'Grupo A', 0),
  ap('AA-00-00-00-00-03', 'Biblioteca', 'zNinguna', 3),
  ap('AA-00-00-00-00-04', 'Patio', '', 9),
  ap('AA-00-00-00-00-05', 'Gimnasio', 'Grupo B', 2),
];
const MACS = APS.map(entry => entry.mac);

const GROUPS: WlanGroup[] = [
  { wlanId: 'g1', wlanName: 'Grupo A', ssidList: [{ ssidName: 'Colegio' }, { ssidName: 'Invitados' }] },
  { wlanId: 'g2', wlanName: 'Grupo B', ssidList: [{ ssidName: 'Colegio' }, { ssidName: 'Profesores' }, { ssidName: 'IoT' }] },
  { wlanId: 'g3', wlanName: 'zNinguna', ssidList: [] },
  { wlanId: 'g4', wlanName: 'Grupo A', ssidList: [{ ssidName: 'Duplicado' }] },
];

const NO_FILTERS: ApFilters = { text: '', status: STATUS_FILTER_ALL, groupName: null };

/**
 * Returns the names of a list of APs (readable assertions).
 * @param {AccessPoint[]} list - The APs.
 * @returns {string[]} Their names.
 */
function names(list: AccessPoint[]): string[] {
  return list.map(entry => entry.name);
}

describe('filterAccessPoints / isFilterActive', () => {
  test('no filter keeps every AP in order and is not active', () => {
    assert.deepEqual(filterAccessPoints(APS, NO_FILTERS), APS);
    assert.equal(isFilterActive(NO_FILTERS), false);
  });

  test('search text matches the AP name or its group name, case-insensitively', () => {
    assert.deepEqual(names(filterAccessPoints(APS, { ...NO_FILTERS, text: 'AULA' })), ['Aula 1', 'Aula 2']);
    assert.deepEqual(names(filterAccessPoints(APS, { ...NO_FILTERS, text: 'grupo b' })), ['Gimnasio']);
    assert.deepEqual(names(filterAccessPoints(APS, { ...NO_FILTERS, text: 'nothing' })), []);
    assert.equal(isFilterActive({ ...NO_FILTERS, text: 'a' }), true);
  });

  test('status filter: one category, or "unknown" for categories the app does not know', () => {
    assert.deepEqual(names(filterAccessPoints(APS, { ...NO_FILTERS, status: '1' })), ['Aula 1']);
    assert.deepEqual(names(filterAccessPoints(APS, { ...NO_FILTERS, status: '0' })), ['Aula 2']);
    assert.deepEqual(names(filterAccessPoints(APS, { ...NO_FILTERS, status: STATUS_FILTER_UNKNOWN })), ['Patio']);
    assert.equal(isFilterActive({ ...NO_FILTERS, status: '2' }), true);
  });

  test('matchesStatusFilter: "all" passes everything, numbers compare exactly', () => {
    assert.equal(matchesStatusFilter(7, STATUS_FILTER_ALL), true);
    assert.equal(matchesStatusFilter(4, '4'), true);
    assert.equal(matchesStatusFilter(4, '1'), false);
    assert.equal(matchesStatusFilter(4, STATUS_FILTER_UNKNOWN), false);
  });

  test('group filter: by group name, and "" for APs without a group', () => {
    assert.deepEqual(names(filterAccessPoints(APS, { ...NO_FILTERS, groupName: 'Grupo A' })), ['Aula 1', 'Aula 2']);
    assert.deepEqual(names(filterAccessPoints(APS, { ...NO_FILTERS, groupName: 'zNinguna' })), ['Biblioteca']);
    assert.deepEqual(names(filterAccessPoints(APS, { ...NO_FILTERS, groupName: '' })), ['Patio']);
    assert.equal(isFilterActive({ ...NO_FILTERS, groupName: '' }), true);
  });

  test('filters combine (AND)', () => {
    assert.deepEqual(names(filterAccessPoints(APS, { text: 'aula', status: '0', groupName: 'Grupo A' })), ['Aula 2']);
    assert.deepEqual(names(filterAccessPoints(APS, { text: 'aula', status: '3', groupName: null })), []);
  });

  test('the "unassigned" group filter value can never be a group id', () => {
    assert.equal(isValidWlanId(GROUP_FILTER_UNASSIGNED), false);
  });
}); // End of describe filterAccessPoints

describe('an AP whose group the controller did not report (cloud, inbox I-1c2a)', () => {
  // A cloud AP without a reported group name: '' plus the flag, never "no group"
  const unreported: AccessPoint = { ...ap('AA-00-00-00-00-06', 'Nube', '', 1), wlanGroupUnknown: true };
  const mixed: AccessPoint[] = [...APS, unreported];

  test('hasUnknownGroup() / missingGroupKey(): the flag only with an empty name; local data never reads as unknown', () => {
    assert.equal(hasUnknownGroup(unreported), true);
    assert.equal(hasUnknownGroup({ ...unreported, wlanGroup: 'Grupo A' }), false, 'a reported name wins');
    assert.equal(hasUnknownGroup({ ...unreported, wlanGroupUnknown: 'yes' as unknown as true }), false, 'only the literal true');
    assert.ok(APS.every((entry) => !hasUnknownGroup(entry)));
    assert.equal(missingGroupKey(unreported), 'apGroupUnknown');
    assert.equal(missingGroupKey(APS[3]), 'unassigned');
    assert.equal(missingGroupKey(APS[0]), null);
    assert.equal(translations.en.apGroupUnknown, 'Unknown group');
    assert.equal(translations.es.apGroupUnknown, 'Grupo desconocido');
  });

  test('the "Unknown group" filter shows only those APs; "unassigned" ("") and a group name never include them', () => {
    assert.deepEqual(names(filterAccessPoints(mixed, { ...NO_FILTERS, groupName: null, groupUnknown: true })), ['Nube']);
    assert.deepEqual(names(filterAccessPoints(mixed, { ...NO_FILTERS, groupName: '' })), ['Patio']);
    assert.deepEqual(names(filterAccessPoints(mixed, { ...NO_FILTERS, groupName: 'Grupo A' })), ['Aula 1', 'Aula 2']);
    assert.deepEqual(names(filterAccessPoints(mixed, NO_FILTERS)), names(mixed));
    assert.equal(isFilterActive({ ...NO_FILTERS, groupUnknown: true }), true);
    assert.equal(isValidWlanId(GROUP_FILTER_UNKNOWN), false);
    assert.notEqual(GROUP_FILTER_UNKNOWN, GROUP_FILTER_UNASSIGNED);
  });

  test('local data filters exactly as before (no flag, no groupUnknown)', () => {
    for (const filters of [NO_FILTERS, { ...NO_FILTERS, groupName: '' }, { ...NO_FILTERS, groupName: 'Grupo B' }, { ...NO_FILTERS, text: 'a' }]) {
      const before = APS.filter((entry) => filters.groupName === null || entry.wlanGroup === filters.groupName);
      assert.deepEqual(names(filterAccessPoints(APS, filters)), names(before.filter((entry) => filters.text === '' || entry.name.toLowerCase().includes(filters.text) || entry.wlanGroup.toLowerCase().includes(filters.text))));
    }
    assert.equal(networkCountFor(unreported.wlanGroup, indexGroupsByName(GROUPS)), null, 'its networks are unknown, never a count');
  });
}); // End of describe "an AP whose group the controller did not report"

describe('rangeBetween (Shift-click / Shift+Arrow ranges)', () => {
  test('forward and backward ranges include both ends', () => {
    assert.deepEqual(rangeBetween(MACS, MACS[1], MACS[3]), MACS.slice(1, 4));
    assert.deepEqual(rangeBetween(MACS, MACS[3], MACS[1]), MACS.slice(1, 4));
  });

  test('anchor equal to target gives that one row', () => {
    assert.deepEqual(rangeBetween(MACS, MACS[2], MACS[2]), [MACS[2]]);
  });

  test('no anchor, or an anchor hidden by the filters, gives the target alone', () => {
    assert.deepEqual(rangeBetween(MACS, null, MACS[2]), [MACS[2]]);
    assert.deepEqual(rangeBetween(MACS.slice(2), MACS[0], MACS[4]), [MACS[4]]);
  });

  test('a target that is not visible gives an empty range', () => {
    assert.deepEqual(rangeBetween(MACS.slice(0, 2), MACS[0], MACS[4]), []);
  });

  test('a range only spans visible rows (hidden APs are never added)', () => {
    const visible = [MACS[0], MACS[2], MACS[4]];
    assert.deepEqual(rangeBetween(visible, MACS[0], MACS[4]), visible);
  });
}); // End of describe rangeBetween

describe('planRangeSelection (anchor handling of Shift-click / Shift+Arrow)', () => {
  test('a visible anchor gives the range to the target and is kept', () => {
    assert.deepEqual(planRangeSelection(MACS, MACS[1], MACS[3]), { macs: MACS.slice(1, 4), anchorMac: MACS[1] });
    assert.deepEqual(planRangeSelection(MACS, MACS[3], MACS[1]), { macs: MACS.slice(1, 4), anchorMac: MACS[3] });
  });

  test('no anchor: the target changes alone and becomes the anchor', () => {
    assert.deepEqual(planRangeSelection(MACS, null, MACS[2]), { macs: [MACS[2]], anchorMac: MACS[2] });
  });

  test('an anchor hidden by the filters is replaced by the target, so the next Shift-click spans a range again', () => {
    // A filter shows rows 2..4; the old anchor (row 0) is hidden
    const visible = MACS.slice(2);
    const first = planRangeSelection(visible, MACS[0], MACS[2]);
    assert.deepEqual(first, { macs: [MACS[2]], anchorMac: MACS[2] });
    const second = planRangeSelection(visible, first.anchorMac, MACS[4]);
    assert.deepEqual(second, { macs: MACS.slice(2, 5), anchorMac: MACS[2] });
  });

  test('an anchor a reload removed is replaced too', () => {
    assert.deepEqual(planRangeSelection(MACS, 'AA-00-00-00-00-99', MACS[1]), { macs: [MACS[1]], anchorMac: MACS[1] });
  });

  test('Shift+Arrow fallback: with no visible anchor the row being left anchors the range', () => {
    const visible = MACS.slice(1);
    assert.deepEqual(planRangeSelection(visible, MACS[0], MACS[3], MACS[2]), { macs: [MACS[2], MACS[3]], anchorMac: MACS[2] });
    assert.deepEqual(planRangeSelection(visible, null, MACS[1], MACS[2]), { macs: [MACS[1], MACS[2]], anchorMac: MACS[2] });
    // A visible anchor wins over the fallback
    assert.deepEqual(planRangeSelection(visible, MACS[4], MACS[3], MACS[2]), { macs: [MACS[3], MACS[4]], anchorMac: MACS[4] });
  });

  test('a target that is not visible changes alone', () => {
    assert.deepEqual(planRangeSelection(MACS.slice(0, 2), MACS[0], MACS[4]), { macs: [MACS[4]], anchorMac: MACS[0] });
  });
}); // End of describe planRangeSelection

describe('applySelection / pruneSelection / selectedAccessPoints', () => {
  test('adds and removes without mutating the input', () => {
    const start = new Set([MACS[0]]);
    const added = applySelection(start, [MACS[1], MACS[2]], true);
    assert.deepEqual([...added].sort(), [MACS[0], MACS[1], MACS[2]].sort());
    assert.deepEqual([...start], [MACS[0]]);
    const removed = applySelection(added, [MACS[0], MACS[4]], false);
    assert.deepEqual([...removed].sort(), [MACS[1], MACS[2]].sort());
  });

  test('pruning drops APs that disappeared after a reload', () => {
    const pruned = pruneSelection(new Set([MACS[0], 'AA-00-00-00-00-99']), MACS);
    assert.deepEqual([...pruned], [MACS[0]]);
  });

  test('selected APs come back in list order, hidden ones included', () => {
    const selection = new Set([MACS[4], MACS[0]]);
    assert.deepEqual(names(selectedAccessPoints(APS, selection)), ['Aula 1', 'Gimnasio']);
  });
}); // End of describe applySelection

describe('countSelection ("N selected (M hidden by filters)")', () => {
  test('nothing selected', () => {
    assert.deepEqual(countSelection(new Set(), MACS), { selected: 0, hidden: 0 });
  });

  test('every selected AP visible', () => {
    assert.deepEqual(countSelection(new Set([MACS[0], MACS[1]]), MACS), { selected: 2, hidden: 0 });
  });

  test('the selection survives filtering: hidden APs are counted, not dropped', () => {
    const selection = new Set([MACS[0], MACS[1], MACS[2]]);
    const visible = names(filterAccessPoints(APS, { ...NO_FILTERS, text: 'aula' }));
    assert.deepEqual(visible, ['Aula 1', 'Aula 2']);
    assert.deepEqual(countSelection(selection, [MACS[0], MACS[1]]), { selected: 3, hidden: 1 });
    assert.deepEqual(countSelection(selection, []), { selected: 3, hidden: 3 });
  });
}); // End of describe countSelection

describe('group-derived counts', () => {
  test('distinct SSID names across the listing (a shared network counts once)', () => {
    assert.equal(countDistinctSsids(GROUPS), 5);
    assert.equal(countDistinctSsids([]), 0);
    assert.equal(countDistinctSsids([GROUPS[2]]), 0);
  });

  test('network count of an AP\'s group: known, empty, unassigned, unknown group, duplicate names', () => {
    const index = indexGroupsByName(GROUPS);
    assert.equal(networkCountFor('Grupo B', index), 3);
    assert.equal(networkCountFor('zNinguna', index), 0);
    assert.equal(networkCountFor('', index), null);
    assert.equal(networkCountFor('Desconocido', index), null);
    // Two groups named "Grupo A": the first one wins
    assert.equal(networkCountFor('Grupo A', index), 2);
  });

  test('flag absent: the total is exact and the first same-named group wins', () => {
    assert.equal(distinctSsidCountKind(GROUPS), 'exact');
    assert.equal(distinctSsidCountKind([]), 'exact');
    assert.equal(distinctSsidCountKind([GROUPS[2]]), 'exact');
    assert.deepEqual([...indexGroupsByName(GROUPS).values()].map(group => group.wlanId), ['g1', 'g2', 'g3']);
  });
}); // End of describe group-derived counts

describe('group-derived counts with unknown network lists (ssidListUnknown)', () => {
  const CLOUD: WlanGroup = { wlanId: 'c1', wlanName: 'Nube', ssidList: [], ssidListUnknown: true };

  test('the distinct SSID total counts the known lists only: a lower bound beside an unknown list, unknown when nothing is known', () => {
    assert.equal(countDistinctSsids([...GROUPS, CLOUD]), 5);
    assert.equal(distinctSsidCountKind([...GROUPS, CLOUD]), 'atLeast');
    assert.equal(countDistinctSsids([CLOUD]), 0);
    assert.equal(distinctSsidCountKind([CLOUD]), 'unknown');
    assert.equal(distinctSsidCountKind([GROUPS[2], CLOUD]), 'unknown');
    // A stray name in a flagged list never counts
    assert.equal(countDistinctSsids([{ ...CLOUD, ssidList: [{ ssidName: 'Fantasma' }] }]), 0);
  });

  test('an AP\'s network count is "unknown" (never 0) for a group whose list was not reported', () => {
    const index = indexGroupsByName([...GROUPS, CLOUD]);
    assert.equal(networkCountFor('Nube', index), 'unknown');
    assert.equal(networkCountFor('Nube', indexGroupsByName([{ ...CLOUD, ssidList: [{ ssidName: 'Fantasma' }] }])), 'unknown');
    // The others are unchanged
    assert.equal(networkCountFor('Grupo B', index), 3);
    assert.equal(networkCountFor('zNinguna', index), 0);
    assert.equal(networkCountFor('Grupo A', index), 2);
    assert.equal(networkCountFor('', index), null);
    assert.equal(networkCountFor('Desconocido', index), null);
  });

  test('a shared name with an unknown list reads "unknown" whatever the order (never a count it may not have)', () => {
    const unknownB: WlanGroup = { wlanId: 'c2', wlanName: 'Grupo B', ssidList: [], ssidListUnknown: true };
    assert.equal(networkCountFor('Grupo B', indexGroupsByName([...GROUPS, unknownB])), 'unknown');
    assert.equal(networkCountFor('Grupo B', indexGroupsByName([unknownB, ...GROUPS])), 'unknown');
    assert.equal(indexGroupsByName([unknownB, ...GROUPS]).get('Grupo B'), unknownB);
  });

  test('networkListKeys(): an unknown-only inventory never reads "No Wi-Fi networks available", and its summary is a lower bound', () => {
    assert.deepEqual(networkListKeys([CLOUD]), { empty: 'networksNotReported', summary: 'searchResultsCountAtLeast' });
    // A group without networks beside it: still nothing known
    assert.deepEqual(networkListKeys([GROUPS[2], CLOUD]), { empty: 'networksNotReported', summary: 'searchResultsCountAtLeast' });
  });

  test('networkListKeys(): a mixed inventory presents its total as a lower bound ("of at least M")', () => {
    assert.deepEqual(networkListKeys([...GROUPS, CLOUD]), { empty: 'noNetworks', summary: 'searchResultsCountAtLeast' });
  });

  test('networkListKeys(): flag absent, the keys are the usual ones (empty list, groups without networks, or networks)', () => {
    for (const groups of [[], [GROUPS[2]], GROUPS]) {
      assert.deepEqual(networkListKeys(groups), { empty: 'noNetworks', summary: 'searchResultsCount' });
    }
  });

  test('both summary keys exist in es and en with the same placeholders', () => {
    for (const language of [translations.es, translations.en]) {
      for (const key of ['searchResultsCount', 'searchResultsCountAtLeast'] as const) {
        assert.equal(language[key].includes('{shown}') && language[key].includes('{total}'), true, `${key}: ${language[key]}`);
      }
      assert.notEqual(language.networksNotReported, language.noNetworks);
    }
  });
}); // End of describe group-derived counts with unknown network lists

describe('sanitizeClientCount (optional client count at the IPC boundary)', () => {
  test('keeps non-negative integers', () => {
    assert.equal(sanitizeClientCount(0), 0);
    assert.equal(sanitizeClientCount(42), 42);
  });

  test('drops anything else', () => {
    for (const value of [undefined, null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, '3', {}]) {
      assert.equal(sanitizeClientCount(value), undefined, String(value));
    }
  });
}); // End of describe sanitizeClientCount
