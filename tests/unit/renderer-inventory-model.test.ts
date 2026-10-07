// Tests for the view models of the read-only AP groups and Wi-Fi networks
// views and the AP details pane (src/renderer/inventory-model.ts, a DOM-free
// module): an AP's group resolved by name (unique, unassigned, unlisted,
// shared name), the group rows (AP and network counts, the Empty and Default
// flags, a shared name making the members unknown), the network rows (one
// per distinct name, sorted, scope "N groups · M APs", a lower bound or
// unknown while APs that may broadcast it cannot be placed), the searches
// of both views, who broadcast a network (APs whose group cannot be
// identified counted apart, only when they may broadcast it), an AP's
// effective networks, and the cross-link targets.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AccessPoint, WlanGroup } from '../../src/shared/types';
import {
  apGroupLink,
  apLink,
  buildGroupRows,
  buildNetworkRows,
  describeApDetails,
  filterGroupRows,
  filterNetworkRows,
  groupLink,
  groupMembers,
  matchesGroupSearch,
  matchesNetworkSearch,
  networkBroadcasters,
  networkLink,
  networkScopeKind,
  resolveApGroup,
  searchKeepingItem,
} from '../../src/renderer/inventory-model';

/**
 * Builds a group for the tests.
 * @param {string} wlanId - Group id.
 * @param {string} wlanName - Group name.
 * @param {string[]} ssids - Network names.
 * @param {boolean} [isDefault] - True for the controller's default group.
 * @returns {WlanGroup} The group.
 */
function group(wlanId: string, wlanName: string, ssids: string[], isDefault?: boolean): WlanGroup {
  const entry: WlanGroup = { wlanId, wlanName, ssidList: ssids.map(ssidName => ({ ssidName })) };
  return isDefault === undefined ? entry : { ...entry, isDefault };
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

const DEFAULT = group('g1', 'Default', ['Casa', 'Invitados'], true);
const OFFICE = group('g2', 'Oficina', ['Casa', 'Trabajo', 'Casa']);
const SILENT = group('g3', 'zNinguna', []);
const EMPTY_NO_APS = group('g4', 'Exterior', []);
const TWIN_A = group('g5', 'Gemelo', ['Gemela']);
const TWIN_B = group('g6', 'Gemelo', ['Trabajo']);
const GROUPS = [DEFAULT, OFFICE, SILENT, EMPTY_NO_APS, TWIN_A, TWIN_B];

const SALON = ap('AA-00-00-00-00-01', 'Salón', 'Default', 12);
const CARPIO = ap('AA-00-00-00-00-02', 'EAP Carpio', 'Default');
const ALTILLO = ap('AA-00-00-00-00-03', 'Altillo', 'Oficina');
const BODEGA = ap('AA-00-00-00-00-04', 'Bodega', '');
const JARDIN = ap('AA-00-00-00-00-05', 'Jardín', 'zNinguna');
const GONE = ap('AA-00-00-00-00-06', 'Perdido', 'Grupo borrado');
const TWIN_AP = ap('AA-00-00-00-00-07', 'Gemelo AP', 'Gemelo');
const APS = [ALTILLO, BODEGA, CARPIO, TWIN_AP, JARDIN, GONE, SALON];

describe('resolveApGroup', () => {
  test('a name exactly one listed group has resolves to that group', () => {
    assert.deepEqual(resolveApGroup(SALON, GROUPS), { kind: 'group', group: DEFAULT });
  });

  test('no group, an unlisted name and a shared name are reported as such (never guessed)', () => {
    assert.deepEqual(resolveApGroup(BODEGA, GROUPS), { kind: 'unassigned' });
    assert.deepEqual(resolveApGroup(GONE, GROUPS), { kind: 'unlisted', name: 'Grupo borrado' });
    assert.deepEqual(resolveApGroup(TWIN_AP, GROUPS), { kind: 'ambiguous', name: 'Gemelo' });
  });
});

describe('group rows (AP groups master list)', () => {
  const rows = buildGroupRows(GROUPS, APS);

  test('one row per group in listing order, with AP and distinct network counts', () => {
    assert.deepEqual(rows.map(row => [row.group.wlanName, row.apCount, row.networks]), [
      ['Default', 2, ['Casa', 'Invitados']],
      ['Oficina', 1, ['Casa', 'Trabajo']],
      ['zNinguna', 1, []],
      ['Exterior', 0, []],
      ['Gemelo', null, ['Gemela']],
      ['Gemelo', null, ['Trabajo']],
    ]);
  });

  test('Empty means no Wi-Fi networks (the §4.1 empty group), whatever the AP count', () => {
    assert.deepEqual(rows.filter(row => row.isEmpty).map(row => row.group.wlanName), ['zNinguna', 'Exterior']);
  });

  test('Default only for the group the controller flags (never inferred from the name or position)', () => {
    assert.deepEqual(rows.filter(row => row.isDefault).map(row => row.group.wlanId), ['g1']);
    const unflagged = buildGroupRows([group('x', 'Default', ['A']), group('y', 'Other', [])], []);
    assert.deepEqual(unflagged.map(row => row.isDefault), [false, false]);
    const notTrue = buildGroupRows([{ ...group('z', 'Z', []), isDefault: false }], []);
    assert.equal(notTrue[0].isDefault, false);
  });

  test('a name another group shares makes both groups ambiguous with unknown members', () => {
    assert.deepEqual(rows.filter(row => row.ambiguous).map(row => row.group.wlanId), ['g5', 'g6']);
    assert.equal(groupMembers(TWIN_A, GROUPS, APS), null);
  });

  test('groupMembers lists the APs in AP list order', () => {
    assert.deepEqual(groupMembers(DEFAULT, GROUPS, APS), [CARPIO, SALON]);
    assert.deepEqual(groupMembers(EMPTY_NO_APS, GROUPS, APS), []);
  });

  test('the search matches group names and network names, case-insensitively and trimmed', () => {
    assert.deepEqual(filterGroupRows(rows, 'ofi').map(row => row.group.wlanId), ['g2']);
    assert.deepEqual(filterGroupRows(rows, '  CASA ').map(row => row.group.wlanId), ['g1', 'g2']);
    assert.deepEqual(filterGroupRows(rows, 'trabajo').map(row => row.group.wlanId), ['g2', 'g6']);
    assert.equal(filterGroupRows(rows, '').length, rows.length);
    assert.equal(filterGroupRows(rows, 'zzz').length, 0);
    assert.equal(matchesGroupSearch(rows[2], 'ningu'), true);
  });
}); // End of the describe block for group rows

describe('network rows (Wi-Fi networks master list)', () => {
  const rows = buildNetworkRows(GROUPS, APS);

  test('one row per distinct network name (the sidebar count), sorted by name', () => {
    assert.deepEqual(rows.map(row => row.name), ['Casa', 'Gemela', 'Invitados', 'Trabajo']);
  });

  test('the scope: the groups broadcasting it, the APs whose group resolves to one of them, and the APs that may broadcast it', () => {
    const scope = Object.fromEntries(rows.map(row => [row.name, [row.groups.map(item => item.wlanId), row.apCount, row.unknownApCount]]));
    assert.deepEqual(scope, {
      // Bodega (no group) and Perdido (unlisted) may broadcast every network;
      // Gemelo AP only those one of the two "Gemelo" groups broadcasts
      Casa: [['g1', 'g2'], 3, 2],
      Gemela: [['g5'], 0, 3],
      Invitados: [['g1'], 2, 2],
      Trabajo: [['g2', 'g6'], 1, 3],
    });
  });

  test('regression (phase 14a review): unresolved APs make the count a lower bound or unknown, never an exact count or "no APs"', () => {
    const kinds = Object.fromEntries(rows.map(row => [row.name, networkScopeKind(row.apCount, row.unknownApCount)]));
    assert.deepEqual(kinds, { Casa: 'atLeast', Gemela: 'unknown', Invitados: 'atLeast', Trabajo: 'atLeast' });
  });

  test('with every AP placed the scope is exact (0 included: "no APs" is then true)', () => {
    const placed = buildNetworkRows(GROUPS, [ALTILLO, CARPIO, JARDIN, SALON]);
    assert.deepEqual(placed.map(row => [row.name, row.apCount, row.unknownApCount, networkScopeKind(row.apCount, row.unknownApCount)]), [
      ['Casa', 3, 0, 'exact'],
      ['Gemela', 0, 0, 'exact'],
      ['Invitados', 2, 0, 'exact'],
      ['Trabajo', 1, 0, 'exact'],
    ]);
  });

  test('an AP in a shared name never counts as a broadcaster, even when every group with that name broadcasts the network', () => {
    const pair = [group('p1', 'Par', ['Común']), group('p2', 'Par', ['Común', 'Solo'])];
    const pairAp = ap('AA-00-00-00-00-08', 'Par AP', 'Par');
    assert.deepEqual(buildNetworkRows(pair, [pairAp]).map(row => [row.name, row.apCount, row.unknownApCount]), [['Común', 0, 1], ['Solo', 0, 1]]);
    // A network none of the groups with its name broadcasts: certainly not
    assert.deepEqual(buildNetworkRows([...pair, group('p3', 'Otro', ['Ajena'])], [pairAp]).find(row => row.name === 'Ajena')?.unknownApCount, 0);
  });

  test('networkScopeKind: exact without unknown APs, a lower bound with some known, unknown with none known', () => {
    assert.equal(networkScopeKind(0, 0), 'exact');
    assert.equal(networkScopeKind(4, 0), 'exact');
    assert.equal(networkScopeKind(4, 1), 'atLeast');
    assert.equal(networkScopeKind(0, 1), 'unknown');
  });

  test('no groups or no networks: no rows', () => {
    assert.deepEqual(buildNetworkRows([], APS), []);
    assert.deepEqual(buildNetworkRows([SILENT, EMPTY_NO_APS], APS), []);
  });

  test('the search matches network names and the names of the groups broadcasting them', () => {
    assert.deepEqual(filterNetworkRows(rows, 'inv').map(row => row.name), ['Invitados']);
    assert.deepEqual(filterNetworkRows(rows, 'OFICINA').map(row => row.name), ['Casa', 'Trabajo']);
    assert.deepEqual(filterNetworkRows(rows, 'gemel').map(row => row.name), ['Gemela', 'Trabajo']);
    assert.equal(matchesNetworkSearch(rows[0], ''), true);
    assert.equal(filterNetworkRows(rows, 'zzz').length, 0);
  });
}); // End of the describe block for network rows

describe('networkBroadcasters (network detail)', () => {
  test('the groups and the APs that broadcast it, plus the APs that may broadcast it but whose group cannot be identified', () => {
    const casa = networkBroadcasters('Casa', GROUPS, APS);
    assert.deepEqual(casa?.groups.map(item => item.wlanId), ['g1', 'g2']);
    assert.deepEqual(casa?.aps, [ALTILLO, CARPIO, SALON]);
    // Bodega (no group) and Perdido (unlisted); not Gemelo AP: neither
    // "Gemelo" group broadcasts Casa
    assert.equal(casa?.unknownApCount, 2);
  });

  test('a network only an ambiguous group broadcasts has no identified AP, and that group\'s AP may broadcast it', () => {
    const gemela = networkBroadcasters('Gemela', GROUPS, APS);
    assert.deepEqual(gemela?.groups.map(item => item.wlanId), ['g5']);
    assert.deepEqual(gemela?.aps, []);
    // Bodega, Gemelo AP and Perdido
    assert.equal(gemela?.unknownApCount, 3);
  });

  test('the detail agrees with the network\'s row (same AP and unknown counts)', () => {
    for (const row of buildNetworkRows(GROUPS, APS)) {
      const detail = networkBroadcasters(row.name, GROUPS, APS);
      assert.deepEqual([detail?.aps.length, detail?.unknownApCount], [row.apCount, row.unknownApCount], row.name);
    }
  });

  test('a network no listed group broadcasts is gone (null)', () => {
    assert.equal(networkBroadcasters('Huérfana', GROUPS, APS), null);
  });
}); // End of the describe block for networkBroadcasters

describe('describeApDetails (AP details pane)', () => {
  test('the effective networks are its group\'s networks, without repetitions', () => {
    const details = describeApDetails(ALTILLO, GROUPS);
    assert.deepEqual(details.group, { kind: 'group', group: OFFICE });
    assert.deepEqual(details.networks, ['Casa', 'Trabajo']);
  });

  test('an AP in a group without networks broadcasts nothing', () => {
    assert.deepEqual(describeApDetails(JARDIN, GROUPS).networks, []);
  });

  test('an AP whose group cannot be identified has unknown networks (null), never guessed', () => {
    assert.equal(describeApDetails(BODEGA, GROUPS).networks, null);
    assert.equal(describeApDetails(GONE, GROUPS).networks, null);
    assert.equal(describeApDetails(TWIN_AP, GROUPS).networks, null);
  });
});

describe('cross-link targets', () => {
  test('APs by MAC, groups by id, networks by name', () => {
    assert.deepEqual(apLink(SALON), { kind: 'ap', target: SALON.mac });
    assert.deepEqual(groupLink(OFFICE), { kind: 'group', target: 'g2' });
    assert.deepEqual(networkLink('Casa'), { kind: 'network', target: 'Casa' });
  });

  test('an AP links to its group only when the group resolves uniquely', () => {
    assert.deepEqual(apGroupLink(resolveApGroup(SALON, GROUPS)), { kind: 'group', target: 'g1' });
    assert.equal(apGroupLink(resolveApGroup(BODEGA, GROUPS)), null);
    assert.equal(apGroupLink(resolveApGroup(GONE, GROUPS)), null);
    assert.equal(apGroupLink(resolveApGroup(TWIN_AP, GROUPS)), null);
  });

  test('a link keeps the target view\'s search unless it would hide the target', () => {
    assert.equal(searchKeepingItem('cas', true), 'cas');
    assert.equal(searchKeepingItem('zzz', false), '');
  });
}); // End of the describe block for cross-link targets
