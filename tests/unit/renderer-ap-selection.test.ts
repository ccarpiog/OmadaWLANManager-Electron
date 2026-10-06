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
  filterAccessPoints,
  GROUP_FILTER_UNASSIGNED,
  indexGroupsByName,
  isFilterActive,
  matchesStatusFilter,
  networkCountFor,
  planRangeSelection,
  pruneSelection,
  rangeBetween,
  sanitizeClientCount,
  selectedAccessPoints,
  STATUS_FILTER_ALL,
  STATUS_FILTER_UNKNOWN,
  type ApFilters,
} from '../../src/renderer/ap-selection';
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
}); // End of describe group-derived counts

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
