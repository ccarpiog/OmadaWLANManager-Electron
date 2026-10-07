// Tests for the pure logic of the Wi-Fi networks view on its managed (Open
// API) source (src/renderer/network-management.ts, a DOM-free module; phase
// 17b): when the managed source is used and which state the view shows
// (also a stale list after a failed re-read), when the source is settled
// for the Back history (not while a capability check runs), the
// stale-reply decision (session generation, nonce, read number), what a
// taken reply leaves (a failed re-read keeps the last good list of the same
// session, whole; a failed first read holds none), the boundary validation
// of getManagedNetworks() replies (copied by allowlist, refused whole —
// never a partial list — when one network breaks the DTO contract; checked
// against main's own DTO builder and constants), the message key of every
// failure, the scopes ("All access points", "N groups · M APs" exact or as
// a lower bound, an unknown scope never guessed), the rows, search and
// selection lookup by typed key (an id and a name never resolve as each
// other; a shared name designates none) and its Back-history items, and the
// value keys (unknown stays unknown; the passphrase only as set / none).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MAX_MANAGED_NETWORKS as MAIN_MAX_MANAGED_NETWORKS,
  MAX_NETWORK_NAME_LENGTH as MAIN_MAX_NETWORK_NAME_LENGTH,
  SSID_ID_REGEX,
  toManagedNetwork,
  validateOpenApiSsid,
  validateOpenApiSsidDetail,
  validateSsidBindings,
} from '../../src/main/wifi-network-model';
import type { AccessPoint, ManagedNetwork, ManagedNetworksError, ManagementCapabilities, WlanGroup } from '../../src/shared/types';
import {
  bandKeys,
  buildManagedNetworkRows,
  enabledKey,
  filterManagedNetworkRows,
  findManagedNetwork,
  isCurrentNetworkRead,
  isHeldForSession,
  isManagedListStale,
  isManagedNetworksError,
  managedNetworkScope,
  matchesManagedNetworkSearch,
  MAX_MANAGED_NETWORKS,
  MAX_NETWORK_NAME_LENGTH,
  NETWORK_ID_REGEX,
  networkFailureKey,
  networkHistoryItem,
  networkManagementChecking,
  networkManagementOn,
  networkSelectionKey,
  networksSourceSettled,
  networksViewMode,
  parseManagedNetworksResult,
  parseNetworkHistoryItem,
  passphraseKey,
  resolveManagedSelection,
  securityKey,
  settleNetworkRead,
  summarizeScope,
  type HeldManagedNetworks,
  type NetworkFailure,
  type NetworkManagementInput,
  type NetworksViewMode,
} from '../../src/renderer/network-management';

// Every ManagedNetworksError main can answer with (src/shared/types.ts)
const ERRORS: ManagedNetworksError[] = ['notConnected', 'superseded', 'managementUnavailable', 'networkListIncomplete', 'requestFailed'];

// Three AP groups with 24-hex ids, and one more the group list may lack
const G1 = '6512a0e1f3b2c41d2e3f4a5b';
const G2 = '6512a0e1f3b2c41d2e3f4a5c';
const G3 = '6512a0e1f3b2c41d2e3f4a5d';
const G_UNLISTED = '6512a0e1f3b2c41d2e3f4aff';

/**
 * Builds a group for the tests.
 * @param {string} wlanId - Group id.
 * @param {string} wlanName - Group name.
 * @returns {WlanGroup} The group.
 */
function group(wlanId: string, wlanName: string): WlanGroup {
  return { wlanId, wlanName, ssidList: [] };
}

/**
 * Builds an AP for the tests (its MAC is derived from its name's characters).
 * @param {string} name - AP name.
 * @param {string} wlanGroup - The name of its group ('' = none).
 * @returns {AccessPoint} The AP.
 */
function ap(name: string, wlanGroup: string): AccessPoint {
  const code = Array.from(name).reduce((sum, character, index) => (sum + character.charCodeAt(0) * (index + 1)) % 65536, 0);
  const mac = `AA-BB-CC-00-${(code >> 8).toString(16).padStart(2, '0')}-${(code & 255).toString(16).padStart(2, '0')}`.toUpperCase();
  return { mac, name, type: 'ap', wlanGroup, statusCategory: 1 };
}

/**
 * Builds a valid managed network (WPA-Personal, 2.4 + 5 GHz, enabled, bound
 * to G1), with the given fields overridden.
 * @param {Partial<ManagedNetwork>} [overrides] - Fields to set.
 * @returns {ManagedNetwork} The network.
 */
function network(overrides: Partial<ManagedNetwork> = {}): ManagedNetwork {
  return {
    id: '5f00c0ffee0000000000c0a1',
    name: 'Casa',
    security: 'wpaPersonal',
    bands: ['band2g', 'band5g'],
    enabled: true,
    hasPassphrase: true,
    scope: 'apGroups',
    apGroupIds: [G1],
    ...overrides,
  };
}

/**
 * The management input of a connected 6.3 session with every check passed.
 * @param {Partial<NetworkManagementInput>} [overrides] - Fields to set.
 * @returns {NetworkManagementInput} The input.
 */
function managementInput(overrides: Partial<NetworkManagementInput> = {}): NetworkManagementInput {
  return {
    isConnected: true,
    hasSessionNonce: true,
    hasData: true,
    groupModel: 'apGroup',
    capabilities: { manageApGroups: true, manageWifiNetworks: true, reason: null },
    ...overrides,
  };
}

describe('mirror of the main-side constants', () => {
  test('the network id rule, the name length and the list cap equal src/main/wifi-network-model.ts', () => {
    assert.equal(NETWORK_ID_REGEX.source, SSID_ID_REGEX.source);
    assert.equal(MAX_NETWORK_NAME_LENGTH, MAIN_MAX_NETWORK_NAME_LENGTH);
    assert.equal(MAX_MANAGED_NETWORKS, MAIN_MAX_MANAGED_NETWORKS);
  });
});

describe('networkManagementOn()', () => {
  test('on for a connected 6.3 session with data whose every check passed', () => {
    assert.equal(networkManagementOn(managementInput()), true);
  });

  test('off while not connected, without a session nonce or data, on a legacy controller, while checking, or with a failing check', () => {
    const off: ManagementCapabilities = { manageApGroups: false, manageWifiNetworks: false, reason: 'siteNotFound' };
    const cases: Array<Partial<NetworkManagementInput>> = [
      { isConnected: false },
      { hasSessionNonce: false },
      { hasData: false },
      { groupModel: 'wlanGroup' },
      { groupModel: null },
      { capabilities: null },
      { capabilities: off },
      { capabilities: { manageApGroups: true, manageWifiNetworks: false, reason: null } },
    ];
    for (const overrides of cases) {
      assert.equal(networkManagementOn(managementInput(overrides)), false, JSON.stringify(overrides));
    }
  });
});

describe('networksViewMode()', () => {
  test('the 14a view while management is off, whatever the managed state', () => {
    for (const status of ['idle', 'loading', 'ready', 'failed'] as const) {
      assert.equal(networksViewMode(false, status, true), 'internal');
      assert.equal(networksViewMode(false, status, false), 'internal');
    }
  });

  test('with management on: the skeleton before the first list, the list (also during a re-read), the error after a failed first read', () => {
    assert.equal(networksViewMode(true, 'idle', false), 'managedLoading');
    assert.equal(networksViewMode(true, 'loading', false), 'managedLoading');
    assert.equal(networksViewMode(true, 'loading', true), 'managedReady');
    assert.equal(networksViewMode(true, 'ready', true), 'managedReady');
    assert.equal(networksViewMode(true, 'failed', false), 'managedFailed');
  });

  test('a failed re-read keeps the list on screen (not the error state), stale; only then', () => {
    assert.equal(networksViewMode(true, 'failed', true), 'managedReady');
    assert.equal(isManagedListStale('managedReady', 'failed'), true);
    for (const status of ['idle', 'loading', 'ready'] as const) {
      assert.equal(isManagedListStale('managedReady', status), false, status);
    }
    for (const mode of ['internal', 'managedLoading', 'managedFailed'] as const) {
      assert.equal(isManagedListStale(mode, 'failed'), false, mode);
    }
  });
});

describe('networkManagementChecking() and networksSourceSettled() — the Back history across a capability check', () => {
  test('checking while a connected 6.3 session with data has no capabilities yet (a first check, or "Test management access" again)', () => {
    assert.equal(networkManagementChecking(managementInput({ capabilities: null })), true);
  });

  test('not checking once the capabilities are known (on or off), on a legacy controller, without data, a nonce or a connection', () => {
    const off: ManagementCapabilities = { manageApGroups: false, manageWifiNetworks: false, reason: 'siteNotFound' };
    const cases: Array<Partial<NetworkManagementInput>> = [
      {},
      { capabilities: off },
      { capabilities: null, groupModel: 'wlanGroup' },
      { capabilities: null, groupModel: null },
      { capabilities: null, hasData: false },
      { capabilities: null, hasSessionNonce: false },
      { capabilities: null, isConnected: false },
    ];
    for (const overrides of cases) {
      assert.equal(networkManagementChecking(managementInput(overrides)), false, JSON.stringify(overrides));
    }
  });

  test('settled: the managed list on screen, or the 14a view once management is definitively off', () => {
    assert.equal(networksSourceSettled('managedReady', false), true);
    assert.equal(networksSourceSettled('managedReady', true), true);
    assert.equal(networksSourceSettled('internal', false), true);
  });

  test('not settled while the 14a view is only a capability check\'s fallback, nor while the managed list is loading or failed', () => {
    assert.equal(networksSourceSettled('internal', true), false);
    const unsettled: NetworksViewMode[] = ['managedLoading', 'managedFailed'];
    for (const mode of unsettled) {
      assert.equal(networksSourceSettled(mode, false), false, mode);
      assert.equal(networksSourceSettled(mode, true), false, mode);
    }
  });
});

describe('isCurrentNetworkRead() — stale replies', () => {
  const ticket = { generation: 3, nonce: 'a'.repeat(32), request: 7 };

  test('the reply of the latest read of the same session and nonce is taken', () => {
    assert.equal(isCurrentNetworkRead(ticket, { generation: 3, nonce: 'a'.repeat(32), request: 7 }), true);
  });

  test('a reply for another session generation, another nonce, no session any more, or an older read is discarded', () => {
    assert.equal(isCurrentNetworkRead(ticket, { generation: 4, nonce: 'a'.repeat(32), request: 7 }), false);
    assert.equal(isCurrentNetworkRead(ticket, { generation: 3, nonce: 'b'.repeat(32), request: 7 }), false);
    assert.equal(isCurrentNetworkRead(ticket, { generation: 3, nonce: null, request: 7 }), false);
    assert.equal(isCurrentNetworkRead(ticket, { generation: 3, nonce: 'a'.repeat(32), request: 8 }), false);
  });
});

describe('settleNetworkRead() — what a taken reply leaves', () => {
  const nonce = 'a'.repeat(32);
  const ticket = { generation: 3, nonce, request: 7 };
  const oldList = [network({ id: 'n1', name: 'Casa' }), network({ id: 'n2', name: 'Taller' })];
  const held: HeldManagedNetworks = { networks: oldList, generation: 3, nonce, readAt: 1000 };
  const failures = [
    { ok: false as const, error: 'requestFailed' as const, diagnostic: 'ssids: httpError, HTTP 503' },
    { ok: false as const, error: 'networkListIncomplete' as const, diagnostic: null },
    // A malformed reply (parseManagedNetworksResult() refused it whole)
    { ok: false as const, error: 'invalidReply' as const, diagnostic: null },
    // The call threw
    { ok: false as const, error: 'failed' as const, diagnostic: null },
  ];

  test('a validated list replaces the held one WHOLE, stamped with the read\'s session and time', () => {
    const fresh = [network({ id: 'n3', name: 'Nueva' })];
    assert.deepEqual(settleNetworkRead(held, ticket, { ok: true, networks: fresh }, 2000), {
      status: 'ready', held: { networks: fresh, generation: 3, nonce, readAt: 2000 }, failure: null,
    });
    assert.deepEqual(settleNetworkRead(null, ticket, { ok: true, networks: [] }, 2000), {
      status: 'ready', held: { networks: [], generation: 3, nonce, readAt: 2000 }, failure: null,
    });
  });

  test('a failed re-read (every failure: an error code, a throw, a malformed reply) keeps the last good list of the same session as it was, with the failure', () => {
    for (const parsed of failures) {
      const settled = settleNetworkRead(held, ticket, parsed, 2000);
      assert.equal(settled.status, 'failed', parsed.error);
      // The very list held — never mixed with anything of the failed reply —
      // and its own time
      assert.equal(settled.held, held, parsed.error);
      assert.deepEqual(settled.held?.networks, oldList, parsed.error);
      assert.equal(settled.held?.readAt, 1000, parsed.error);
      assert.deepEqual(settled.failure, { error: parsed.error, diagnostic: parsed.diagnostic });
    }
  });

  test('a failed first read holds no list (the error state with Retry)', () => {
    for (const parsed of failures) {
      assert.deepEqual(settleNetworkRead(null, ticket, parsed, 2000), { status: 'failed', held: null, failure: { error: parsed.error, diagnostic: parsed.diagnostic } });
    }
  });

  test('a list read for another session generation or nonce is never kept', () => {
    for (const other of [{ ...held, generation: 2 }, { ...held, nonce: 'b'.repeat(32) }]) {
      const settled = settleNetworkRead(other, ticket, failures[0], 2000);
      assert.equal(settled.status, 'failed');
      assert.equal(settled.held, null);
    }
  });

  test('isHeldForSession(): the same session generation and nonce; nothing held is never held', () => {
    assert.equal(isHeldForSession(held, { generation: 3, nonce }), true);
    assert.equal(isHeldForSession(held, { generation: 4, nonce }), false);
    assert.equal(isHeldForSession(held, { generation: 3, nonce: 'b'.repeat(32) }), false);
    assert.equal(isHeldForSession(null, { generation: 3, nonce }), false);
  });
});

describe('parseManagedNetworksResult() — reply validation', () => {
  test('a valid reply is copied field by field: unknown keys (a passphrase, a key) never cross, the bands come in 2.4 / 5 / 6 GHz order', () => {
    const parsed = parseManagedNetworksResult({
      success: true,
      networks: [
        { ...network(), bands: ['band6g', 'band2g'], passphrase: 'SENTINEL-renderer-1', securityKey: 'SENTINEL-renderer-2', pskSetting: { securityKey: 'SENTINEL-renderer-3' } },
        network({ id: 'ssid_2', name: 'Abierta', security: 'open', bands: null, enabled: null, hasPassphrase: false, scope: 'allAccessPoints', apGroupIds: [] }),
        network({ id: 'ssid-3', name: 'Rara', security: 'unknown', bands: null, enabled: false, hasPassphrase: null, scope: 'unknown', apGroupIds: null }),
      ],
      extra: 'SENTINEL-renderer-4',
    });
    assert.deepEqual(parsed, {
      ok: true,
      networks: [
        network({ bands: ['band2g', 'band6g'] }),
        network({ id: 'ssid_2', name: 'Abierta', security: 'open', bands: null, enabled: null, hasPassphrase: false, scope: 'allAccessPoints', apGroupIds: [] }),
        network({ id: 'ssid-3', name: 'Rara', security: 'unknown', bands: null, enabled: false, hasPassphrase: null, scope: 'unknown', apGroupIds: null }),
      ],
    });
    assert.ok(!JSON.stringify(parsed).includes('SENTINEL'));
  });

  test('an empty list is a valid (empty) reply', () => {
    assert.deepEqual(parseManagedNetworksResult({ success: true, networks: [] }), { ok: true, networks: [] });
  });

  test('one network breaking the contract refuses the WHOLE reply (invalidReply) — never a partial list', () => {
    const bad: Array<Record<string, unknown>> = [
      { id: '' },
      { id: 'has space' },
      { id: 'x'.repeat(129) },
      { id: 42 },
      { name: '' },
      { name: 'n'.repeat(MAX_NETWORK_NAME_LENGTH + 1) },
      { name: null },
      { security: 'wep' },
      { security: 3 },
      { scope: 'everywhere' },
      { scope: 0 },
      { bands: [] },
      { bands: ['band2g', 'band2g'] },
      { bands: ['band9g'] },
      { bands: 'band2g' },
      { bands: ['band2g', 'band5g', 'band6g', 'band2g'] },
      { enabled: 'yes' },
      { enabled: 1 },
      { hasPassphrase: 'true' },
      { hasPassphrase: undefined },
      { apGroupIds: ['not-an-ap-group-id-00000'] },
      { apGroupIds: [G1, G1] },
      { apGroupIds: [G1, 7] },
      { apGroupIds: G1 },
      { scope: 'apGroups', apGroupIds: null },
    ];
    for (const fields of bad) {
      const reply = { success: true, networks: [network({ id: 'ok1', name: 'Buena' }), { ...network(), ...fields }] };
      assert.deepEqual(parseManagedNetworksResult(reply), { ok: false, error: 'invalidReply', diagnostic: null }, JSON.stringify(fields));
    }
    for (const entry of [null, 'x', [network()], 7]) {
      assert.equal(parseManagedNetworksResult({ success: true, networks: [entry] }).ok, false);
    }
  });

  test('two networks with the same id, more networks than main ever sends, or no list are refused whole', () => {
    assert.deepEqual(parseManagedNetworksResult({ success: true, networks: [network(), network({ name: 'Otra' })] }), { ok: false, error: 'invalidReply', diagnostic: null });
    const many = Array.from({ length: MAX_MANAGED_NETWORKS + 1 }, (_, index) => network({ id: `n${index}`, name: `Red ${index}` }));
    assert.equal(parseManagedNetworksResult({ success: true, networks: many }).ok, false);
    assert.equal(parseManagedNetworksResult({ success: true, networks: many.slice(0, MAX_MANAGED_NETWORKS) }).ok, true);
    for (const raw of [{ success: true }, { success: true, networks: {} }, { success: 'true', networks: [] }, {}, null, 'ok', [], 42]) {
      assert.deepEqual(parseManagedNetworksResult(raw), { ok: false, error: 'invalidReply', diagnostic: null }, JSON.stringify(raw));
    }
  });

  test('failures keep main\'s code and its codes-only diagnostic; an unknown code is "failed"; a diagnostic that is not codes-only is dropped', () => {
    for (const error of ERRORS) {
      assert.deepEqual(parseManagedNetworksResult({ success: false, error }), { ok: false, error, diagnostic: null });
    }
    assert.deepEqual(parseManagedNetworksResult({ success: false, error: 'requestFailed', diagnostic: 'ssid detail: malformedResponse' }), {
      ok: false, error: 'requestFailed', diagnostic: 'ssid detail: malformedResponse',
    });
    assert.deepEqual(parseManagedNetworksResult({ success: false, error: 'malformedResponse' }), { ok: false, error: 'failed', diagnostic: null });
    assert.deepEqual(parseManagedNetworksResult({ success: false }), { ok: false, error: 'failed', diagnostic: null });
    assert.deepEqual(parseManagedNetworksResult({ success: false, error: 'requestFailed', diagnostic: 'key="SENTINEL"' }), { ok: false, error: 'requestFailed', diagnostic: null });
    assert.equal(isManagedNetworksError('networkListIncomplete'), true);
    assert.equal(isManagedNetworksError('invalidReply'), false);
    assert.equal(isManagedNetworksError(undefined), false);
  });

  test('the DTOs main\'s own builder makes (toManagedNetwork()) pass unchanged', () => {
    const payloads = [
      {
        entry: { id: '5f00c0ffee0000000000c0a1', name: 'Todos', description: false, chooseDevices: 0, band: 7, security: 0 },
        detail: { id: '5f00c0ffee0000000000c0a1', chooseDevices: 0, band: 7, security: 0 },
        bindings: { apGroups: [] },
      },
      {
        entry: { id: '5f00c0ffee0000000000c0a2', name: 'Grupos', ssidEnable: true, chooseDevices: 1, band: 3, security: 3 },
        detail: { id: '5f00c0ffee0000000000c0a2', ssidEnable: true, chooseDevices: 1, band: 3, security: 3, apGroupIds: [G2, G1], pskSetting: { securityKey: 'SENTINEL-main-key' } },
        bindings: { apGroups: [{ id: G1 }, { id: G2 }] },
      },
      {
        entry: { id: '5f00c0ffee0000000000c0a3', name: 'Rara', chooseDevices: 7, band: 0, security: 9 },
        detail: { id: '5f00c0ffee0000000000c0a3', chooseDevices: 7 },
        bindings: {},
      },
    ];
    const networks = payloads.map(({ entry, detail, bindings }) => {
      const validEntry = validateOpenApiSsid(entry);
      assert.ok(validEntry);
      const validDetail = validateOpenApiSsidDetail(detail, validEntry.id);
      const validBindings = validateSsidBindings(bindings);
      assert.ok(validDetail && validBindings);
      return toManagedNetwork(validEntry, validDetail, validBindings);
    });
    const parsed = parseManagedNetworksResult(JSON.parse(JSON.stringify({ success: true, networks })));
    assert.deepEqual(parsed, { ok: true, networks });
    assert.ok(!JSON.stringify(parsed).includes('SENTINEL'));
  });
});

describe('networkFailureKey()', () => {
  test('every failure (main\'s codes, invalidReply, failed) has its own message key', () => {
    const failures: NetworkFailure[] = [...ERRORS, 'invalidReply', 'failed'];
    const keys = failures.map(networkFailureKey);
    assert.ok(keys.every(key => typeof key === 'string' && key.startsWith('managedNetworksError')));
    assert.equal(new Set(keys).size, failures.length);
  });
});

describe('managedNetworkScope() and summarizeScope() — the scope text', () => {
  const groups = [group(G1, 'Default'), group(G2, 'zGrupo B'), group(G3, 'Exterior')];
  const aps = [ap('Salón', 'Default'), ap('EAP Carpio', 'Default'), ap('Altillo', 'zGrupo B'), ap('Jardín', 'Exterior')];

  test('"All access points" comes from the DTO alone', () => {
    const scope = managedNetworkScope(network({ scope: 'allAccessPoints', apGroupIds: [] }), groups, [...aps, ap('Bodega', '')]);
    assert.deepEqual(scope, { kind: 'allAccessPoints' });
    assert.deepEqual(summarizeScope(scope), { kind: 'allAccessPoints' });
  });

  test('an unknown scope stays unknown even with bound ids reported (never guessed)', () => {
    assert.deepEqual(managedNetworkScope(network({ scope: 'unknown', apGroupIds: [G1] }), groups, aps), { kind: 'unknown' });
    assert.deepEqual(managedNetworkScope(network({ scope: 'unknown', apGroupIds: null }), groups, aps), { kind: 'unknown' });
    assert.deepEqual(managedNetworkScope(network({ scope: 'apGroups', apGroupIds: null }), groups, aps), { kind: 'unknown' });
    assert.deepEqual(summarizeScope({ kind: 'unknown' }), { kind: 'unknown' });
  });

  test('"N groups · M APs" exact when every AP is placed: the APs of the bound groups, in list order', () => {
    const scope = managedNetworkScope(network({ apGroupIds: [G2, G1] }), groups, aps);
    assert.equal(scope.kind, 'apGroups');
    if (scope.kind !== 'apGroups') return;
    assert.deepEqual(scope.groups.map(entry => entry.wlanName), ['Default', 'zGrupo B']);
    assert.deepEqual(scope.aps.map(entry => entry.name), ['Salón', 'EAP Carpio', 'Altillo']);
    assert.deepEqual(summarizeScope(scope), { kind: 'apGroups', groupCount: 2, apCount: 3, countKind: 'exact', unknownApCount: 0, unresolvedGroupCount: 0 });
  });

  test('a lower bound while some APs\' groups cannot be identified (no group, a group not in the list)', () => {
    const scope = managedNetworkScope(network({ apGroupIds: [G1] }), groups, [...aps, ap('Bodega', ''), ap('Desván', 'Borrado')]);
    assert.deepEqual(summarizeScope(scope), { kind: 'apGroups', groupCount: 1, apCount: 2, countKind: 'atLeast', unknownApCount: 2, unresolvedGroupCount: 0 });
  });

  test('a name several groups share: its APs may broadcast it only when one of those groups is bound', () => {
    const twins = [...groups, group('6512a0e1f3b2c41d2e3f4a70', 'Exterior')];
    const bound = summarizeScope(managedNetworkScope(network({ apGroupIds: [G3] }), twins, aps));
    assert.deepEqual(bound, { kind: 'apGroups', groupCount: 1, apCount: 0, countKind: 'unknown', unknownApCount: 1, unresolvedGroupCount: 0 });
    const unbound = summarizeScope(managedNetworkScope(network({ apGroupIds: [G1] }), twins, aps));
    assert.deepEqual(unbound, { kind: 'apGroups', groupCount: 1, apCount: 2, countKind: 'exact', unknownApCount: 0, unresolvedGroupCount: 0 });
  });

  test('a bound group the list does not have makes the count a lower bound (or unknown), never exact', () => {
    const scope = managedNetworkScope(network({ apGroupIds: [G1, G_UNLISTED] }), groups, aps);
    assert.equal(scope.kind === 'apGroups' && scope.groups.length, 1);
    assert.deepEqual(summarizeScope(scope), { kind: 'apGroups', groupCount: 2, apCount: 2, countKind: 'atLeast', unknownApCount: 0, unresolvedGroupCount: 1 });
    const none = summarizeScope(managedNetworkScope(network({ apGroupIds: [G_UNLISTED] }), groups, aps));
    assert.deepEqual(none, { kind: 'apGroups', groupCount: 1, apCount: 0, countKind: 'unknown', unknownApCount: 0, unresolvedGroupCount: 1 });
  });

  test('bound to no group: "0 groups · no APs", exact, whatever APs cannot be placed', () => {
    const scope = summarizeScope(managedNetworkScope(network({ apGroupIds: [] }), groups, [...aps, ap('Bodega', '')]));
    assert.deepEqual(scope, { kind: 'apGroups', groupCount: 0, apCount: 0, countKind: 'exact', unknownApCount: 0, unresolvedGroupCount: 0 });
  });
});

describe('rows, search and selection', () => {
  const groups = [group(G1, 'Default'), group(G2, 'zGrupo B')];
  const networks = [
    network({ id: 'n1', name: 'Taller', apGroupIds: [G2] }),
    network({ id: 'n2', name: 'Casa', apGroupIds: [G1] }),
    network({ id: 'n3', name: 'Casa', scope: 'allAccessPoints', apGroupIds: [] }),
    network({ id: 'n4', name: 'Almacén', scope: 'unknown', apGroupIds: null }),
  ];

  test('rows are sorted by name; networks with the same name keep the controller\'s order', () => {
    assert.deepEqual(buildManagedNetworkRows(networks, groups, []).map(row => row.network.id), ['n4', 'n2', 'n3', 'n1']);
  });

  test('the search matches the network name or a bound group\'s name, case-insensitively', () => {
    const rows = buildManagedNetworkRows(networks, groups, []);
    assert.deepEqual(filterManagedNetworkRows(rows, '  CASA ').map(row => row.network.id), ['n2', 'n3']);
    assert.deepEqual(filterManagedNetworkRows(rows, 'grupo b').map(row => row.network.id), ['n1']);
    assert.deepEqual(filterManagedNetworkRows(rows, 'default').map(row => row.network.id), ['n2']);
    assert.equal(filterManagedNetworkRows(rows, '').length, 4);
    assert.equal(matchesManagedNetworkSearch(rows[0], 'zzz'), false);
  });

  test('findManagedNetwork(): an id key by id, a name key the ONE network with that name', () => {
    assert.equal(findManagedNetwork(networks, { kind: 'id', value: 'n1' })?.id, 'n1');
    assert.equal(findManagedNetwork(networks, { kind: 'name', value: 'Taller' })?.id, 'n1');
    assert.equal(findManagedNetwork(networks, { kind: 'id', value: 'gone' }), null);
    assert.equal(findManagedNetwork(networks, { kind: 'name', value: 'Nada' }), null);
    assert.equal(findManagedNetwork(networks, null), null);
  });

  // Valid network names that are also valid network ids: each key resolves
  // only in its own namespace
  const crossed = [
    network({ id: 'Lab', name: 'Planta' }),
    network({ id: 'p2', name: 'Lab' }),
    network({ id: 'Taller', name: 'Oficina' }),
  ];

  test('an id equal to another network\'s name: the id key finds the network with that id, the name key the one with that name', () => {
    assert.equal(findManagedNetwork(crossed, { kind: 'id', value: 'Lab' })?.name, 'Planta');
    assert.equal(findManagedNetwork(crossed, { kind: 'name', value: 'Lab' })?.id, 'p2');
  });

  test('a name equal to another network\'s id never selects that network; an id never matches a name', () => {
    // 'Taller' is only an id here: no network is named so
    assert.equal(findManagedNetwork(crossed, { kind: 'name', value: 'Taller' }), null);
    assert.equal(findManagedNetwork(crossed, { kind: 'id', value: 'Taller' })?.name, 'Oficina');
    // 'Oficina' is only a name: no network has that id
    assert.equal(findManagedNetwork(crossed, { kind: 'id', value: 'Oficina' }), null);
    assert.equal(resolveManagedSelection(crossed, null, 'Taller'), null);
    assert.equal(resolveManagedSelection(crossed, 'Oficina', null), null);
  });

  test('a name several networks share designates none (no guess), whatever their ids', () => {
    assert.equal(findManagedNetwork(networks, { kind: 'name', value: 'Casa' }), null);
    const twins = [network({ id: 'Casa', name: 'Casa' }), network({ id: 'c2', name: 'Casa' })];
    assert.equal(findManagedNetwork(twins, { kind: 'name', value: 'Casa' }), null);
    assert.equal(resolveManagedSelection(twins, null, 'Casa'), null);
    // Each of them stays reachable by its id
    assert.equal(findManagedNetwork(twins, { kind: 'id', value: 'c2' })?.id, 'c2');
  });

  test('resolveManagedSelection(): a held id resolves by id only (a gone network is not replaced by its namesake); otherwise the name, by name only', () => {
    assert.equal(resolveManagedSelection(networks, 'n2', 'Taller')?.id, 'n2');
    assert.equal(resolveManagedSelection(networks, 'gone', 'Taller'), null);
    assert.equal(resolveManagedSelection(networks, 'gone', 'Casa'), null);
    assert.equal(resolveManagedSelection(networks, null, 'Taller')?.id, 'n1');
    assert.equal(resolveManagedSelection(networks, null, 'n3'), null);
    assert.equal(resolveManagedSelection(networks, null, 'Casa'), null);
    assert.equal(resolveManagedSelection(networks, null, null), null);
  });

  test('networkSelectionKey(): the id when one is held, else the name, else none', () => {
    assert.deepEqual(networkSelectionKey('n2', 'Casa'), { kind: 'id', value: 'n2' });
    assert.deepEqual(networkSelectionKey(null, 'Casa'), { kind: 'name', value: 'Casa' });
    assert.equal(networkSelectionKey(null, null), null);
  });

  test('Back-history items keep the key\'s namespace: "id:…" / "name:…" round-trip (also names with a colon or a prefix), anything else is no key', () => {
    const keys = [
      { kind: 'id' as const, value: 'n1' },
      { kind: 'name' as const, value: 'Casa' },
      { kind: 'name' as const, value: 'id:n1' },
      { kind: 'name' as const, value: 'Red: invitados' },
      { kind: 'name' as const, value: '' },
    ];
    for (const key of keys) {
      assert.deepEqual(parseNetworkHistoryItem(networkHistoryItem(key)), key);
    }
    assert.equal(networkHistoryItem({ kind: 'id', value: 'Lab' }) === networkHistoryItem({ kind: 'name', value: 'Lab' }), false);
    for (const item of ['Casa', 'n1', 'ID:n1', 'Name:Casa', '']) {
      assert.equal(parseNetworkHistoryItem(item), null, item);
    }
  });
});

describe('value keys — unknown stays unknown', () => {
  test('security modes; unknown is null (the caller states it)', () => {
    assert.equal(securityKey('open'), 'securityOpen');
    assert.equal(securityKey('wpaEnterprise'), 'securityWpaEnterprise');
    assert.equal(securityKey('wpaPersonal'), 'securityWpaPersonal');
    assert.equal(securityKey('ppskWithoutRadius'), 'securityPpskWithoutRadius');
    assert.equal(securityKey('ppskWithRadius'), 'securityPpskWithRadius');
    assert.equal(securityKey('unknown'), null);
  });

  test('enabled state and passphrase (only set / none, never a key); null is unknown', () => {
    assert.equal(enabledKey(true), 'networkEnabled');
    assert.equal(enabledKey(false), 'networkDisabled');
    assert.equal(enabledKey(null), null);
    assert.equal(passphraseKey(true), 'passphraseSet');
    assert.equal(passphraseKey(false), 'passphraseNone');
    assert.equal(passphraseKey(null), null);
  });

  test('bands in 2.4 / 5 / 6 GHz order; null or empty is unknown', () => {
    assert.deepEqual(bandKeys(['band6g', 'band2g']), ['band2g', 'band6g']);
    assert.deepEqual(bandKeys(['band5g']), ['band5g']);
    assert.equal(bandKeys(null), null);
    assert.equal(bandKeys([]), null);
  });
});
