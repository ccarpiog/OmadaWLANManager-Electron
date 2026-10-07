// Tests for the pure logic of the "Broadcast on" editor of the renderer
// (src/renderer/network-bindings.ts, a DOM-free module; phase 19b): when the
// editor is offered (never with management off; read-only for "All access
// points" and an unknown scope), the freshness gate (the 18b gate plus the
// managed AP-group list), the options and their search, the diff and the
// before / after reach (the "at least" lower bound included), the
// client-side capacity pre-check (every failing group + band, unknown fails
// closed) checked against main's own rules (src/main/network-binding-plan.ts),
// the request check — "All access points" and unknown scope never produce a
// write request —, the reply validation (a malformed reply is refused), the
// es and en text of every code (exhaustive), the capacity problems named per
// group and band, and the rows and notes of the preview and the confirmation.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkBindingCapacity, diffBindings, planNetworkBindings, type BindingApGroup } from '../../src/main/network-binding-plan';
import type { AccessPoint, Language, ManagedApGroup, ManagedNetwork, NetworkBand, NetworkBindingsError, WlanGroup } from '../../src/shared/types';
import { formatMessage, translations, type Translations } from '../../src/renderer/i18n-strings';
import {
  bindingAvailability,
  bindingChangeNotes,
  bindingChangeRows,
  bindingErrorKey,
  bindingFailureText,
  bindingOptions,
  bindingPreview,
  bindingSelectionText,
  bindingWriteBlock,
  capacityProblemLines,
  checkBindingDraft,
  checkBindingSelection,
  clientCapacityProblems,
  diffBindingSets,
  filterBindingOptions,
  groupListText,
  groupNameLookup,
  isBindingStaleDataFailure,
  isNetworkBindingsError,
  MAX_CAPACITY_PROBLEMS,
  mloProblemNote,
  parseNetworkBindingsResult,
  planBindingChange,
  sameBindingOptions,
  type BindingFailure,
  type BindingFreshness,
} from '../../src/renderer/network-bindings';
import type { TextContext } from '../../src/renderer/network-editing';

// Every NetworkBindingsError main can answer with (src/shared/types.ts)
const ERRORS: NetworkBindingsError[] = [
  'notConnected',
  'superseded',
  'managementUnavailable',
  'groupsRequired',
  'nothingToChange',
  'networkListIncomplete',
  'networkNotFound',
  'scopeAllAccessPoints',
  'scopeUnknown',
  'groupNotFound',
  'groupListIncomplete',
  'networkStateUnknown',
  'capacityInsufficient',
  'requestFailed',
];

// The renderer's own failures (never one of main's codes)
const OWN: BindingFailure[] = ['dataStale', 'listStale', 'dataReading', 'groupsStale', 'groupsReading', 'networkChanged', 'groupsChanged', 'failed'];

// Four AP groups with 24-hex ids, one the lists lack, and a malformed id
const G1 = '6512a0e1f3b2c41d2e3f4a5b';
const G2 = '6512a0e1f3b2c41d2e3f4a5c';
const G3 = '6512a0e1f3b2c41d2e3f4a5d';
const G4 = '6512a0e1f3b2c41d2e3f4a5e';
const G_UNLISTED = '6512a0e1f3b2c41d2e3f4aff';
const NONCE = '0123456789abcdef0123456789abcdef';

/**
 * The text context of a language (the translator over its table).
 * @param {Language} language - The language.
 * @returns {TextContext} The context.
 */
function ctx(language: Language): TextContext {
  return { tr: (key, vars) => formatMessage(translations[language][key], vars ?? {}), language };
}

/**
 * Builds an internal group for the tests.
 * @param {string} wlanId - Group id.
 * @param {string} wlanName - Group name.
 * @returns {WlanGroup} The group.
 */
function group(wlanId: string, wlanName: string): WlanGroup {
  return { wlanId, wlanName, ssidList: [] };
}

/**
 * Builds an AP for the tests.
 * @param {number} n - Its number (for a unique MAC).
 * @param {string} wlanGroup - The name of its group ('' = none).
 * @returns {AccessPoint} The AP.
 */
function ap(n: number, wlanGroup: string): AccessPoint {
  return { mac: `AA-BB-CC-00-11-${n.toString(16).padStart(2, '0').toUpperCase()}`, name: `AP ${n}`, type: 'ap', wlanGroup, statusCategory: 1 };
}

/**
 * Builds a managed AP group with per-band remaining capacity.
 * @param {string} id - Its id.
 * @param {string} name - Its name.
 * @param {Partial<Record<NetworkBand, number>> | undefined} remaining - The remaining binding per band (undefined: none reported).
 * @returns {ManagedApGroup} The group.
 */
function managed(id: string, name: string, remaining: Partial<Record<NetworkBand, number>> | undefined): ManagedApGroup {
  const result: ManagedApGroup = { id, name, isDefault: false };
  if (remaining !== undefined) result.remainingBinding = { ...remaining };
  return result;
}

/**
 * The same group as main's fresh AP-group list carries it (remainingBinding
 * keys 0 / 1 / 2 = 2.4 / 5 / 6 GHz).
 * @param {ManagedApGroup} group - The renderer's group.
 * @returns {BindingApGroup} Main's view.
 */
function mainGroup(group: ManagedApGroup): BindingApGroup {
  if (group.remainingBinding === undefined) return { id: group.id };
  const keys: Record<NetworkBand, string> = { band2g: '0', band5g: '1', band6g: '2' };
  const record: Record<string, number> = {};
  for (const [band, value] of Object.entries(group.remainingBinding)) {
    record[keys[band as NetworkBand]] = value as number;
  }
  return { id: group.id, remainingBinding: record };
}

/**
 * Builds a managed network (WPA-Personal, 2.4 + 5 GHz, enabled, bound to
 * G1), with the given fields overridden.
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

// The internal data: Default (2 APs), Aulas (1 AP), Patio (no AP), Tienda
// (1 AP); plus an AP with no group
const GROUPS = [group(G1, 'Default'), group(G2, 'Aulas'), group(G3, 'Patio'), group(G4, 'Tienda')];
const APS = [ap(1, 'Default'), ap(2, 'Default'), ap(3, 'Aulas'), ap(4, 'Tienda')];

// The managed AP groups: Default and Aulas with room; Patio full on 5 GHz;
// Tienda reporting 2.4 GHz only
const MANAGED = [
  managed(G1, 'Default', { band2g: 7, band5g: 7, band6g: 7 }),
  managed(G2, 'Aulas', { band2g: 3, band5g: 2, band6g: 1 }),
  managed(G3, 'Patio', { band2g: 4, band5g: 0, band6g: 2 }),
  managed(G4, 'Tienda', { band2g: 5 }),
];

/**
 * A freshness input with every list read and fresh.
 * @param {Partial<BindingFreshness>} [overrides] - Fields to set.
 * @returns {BindingFreshness} The input.
 */
function freshness(overrides: Partial<BindingFreshness> = {}): BindingFreshness {
  return { refreshError: false, listStatus: 'ready', hasList: true, groupsStatus: 'ready', hasGroups: true, ...overrides };
}

describe('bindingAvailability()', () => {
  test('nothing at all while Wi-Fi network management is off (also while a check runs)', () => {
    assert.equal(bindingAvailability(network(), false), null);
    assert.equal(bindingAvailability(network({ scope: 'allAccessPoints' }), false), null);
  });

  test('"All access points" is read-only with its reason — never converted into a group list', () => {
    assert.deepEqual(bindingAvailability(network({ scope: 'allAccessPoints', apGroupIds: [] }), true), { kind: 'readOnly', reason: 'allAccessPoints' });
    assert.deepEqual(bindingAvailability(network({ scope: 'allAccessPoints', apGroupIds: [G1, G2] }), true), { kind: 'readOnly', reason: 'allAccessPoints' });
  });

  test('an unknown scope is read-only with its reason (also "AP groups" without known bindings)', () => {
    assert.deepEqual(bindingAvailability(network({ scope: 'unknown', apGroupIds: null }), true), { kind: 'readOnly', reason: 'unknown' });
    assert.deepEqual(bindingAvailability(network({ scope: 'unknown', apGroupIds: [G1] }), true), { kind: 'readOnly', reason: 'unknown' });
    assert.deepEqual(bindingAvailability(network({ scope: 'apGroups', apGroupIds: null }), true), { kind: 'readOnly', reason: 'unknown' });
  });

  test('editable for a network bound to known AP groups, whatever its security (D3), also bound to none', () => {
    for (const security of ['open', 'wpaPersonal', 'wpaEnterprise', 'ppskWithoutRadius', 'ppskWithRadius', 'unknown'] as const) {
      assert.deepEqual(bindingAvailability(network({ security }), true), { kind: 'editable' }, security);
    }
    assert.deepEqual(bindingAvailability(network({ apGroupIds: [] }), true), { kind: 'editable' });
  });
});

describe('bindingWriteBlock() — the 18b gate plus the managed AP-group list', () => {
  test('goes ahead only with every list fresh', () => {
    assert.equal(bindingWriteBlock(freshness()), null);
  });

  test('the network gate comes first: stale internal data, a stale or unread managed network list', () => {
    assert.equal(bindingWriteBlock(freshness({ refreshError: true, groupsStatus: 'failed' })), 'dataStale');
    assert.equal(bindingWriteBlock(freshness({ listStatus: 'failed', groupsStatus: 'failed' })), 'listStale');
    assert.equal(bindingWriteBlock(freshness({ listStatus: 'loading' })), 'dataReading');
    assert.equal(bindingWriteBlock(freshness({ hasList: false })), 'dataReading');
  });

  test('a failed AP-group read holds it back (its capacity is unknown); so does an unread or first-loading one', () => {
    assert.equal(bindingWriteBlock(freshness({ groupsStatus: 'failed', hasGroups: false })), 'groupsStale');
    assert.equal(bindingWriteBlock(freshness({ groupsStatus: 'loading', hasGroups: false })), 'groupsReading');
    assert.equal(bindingWriteBlock(freshness({ groupsStatus: 'idle', hasGroups: false })), 'groupsReading');
    assert.equal(bindingWriteBlock(freshness({ groupsStatus: 'ready', hasGroups: false })), 'groupsReading');
  });
});

describe('the options and their search', () => {
  test('the managed groups main can bind, sorted by name, with the internal AP counts (unknown when the internal list lacks the group or shares its name)', () => {
    const groups = [...GROUPS, group(G_UNLISTED, 'Tienda')];
    const list = [...MANAGED, managed('bad id!', 'Corrupto', undefined), managed('6512a0e1f3b2c41d2e3f4a60', 'Bodega', undefined)];
    assert.deepEqual(bindingOptions(list, groups, APS), [
      { id: G2, name: 'Aulas', apCount: 1 },
      { id: '6512a0e1f3b2c41d2e3f4a60', name: 'Bodega', apCount: null },
      { id: G1, name: 'Default', apCount: 2 },
      { id: G3, name: 'Patio', apCount: 0 },
      { id: G4, name: 'Tienda', apCount: null },
    ]);
  });

  test('the search matches group names case-insensitively; an empty search shows all', () => {
    const options = bindingOptions(MANAGED, GROUPS, APS);
    assert.deepEqual(filterBindingOptions(options, ''), [G2, G1, G3, G4]);
    assert.deepEqual(filterBindingOptions(options, '  ULA '), [G2]);
    assert.deepEqual(filterBindingOptions(options, 'au'), [G2, G1]);
    assert.deepEqual(filterBindingOptions(options, 'TIE'), [G4]);
    assert.deepEqual(filterBindingOptions(options, 'zzz'), []);
  });

  test('sameBindingOptions() compares ids and names in order (not the AP counts)', () => {
    const options = bindingOptions(MANAGED, GROUPS, APS);
    assert.ok(sameBindingOptions(options, bindingOptions(MANAGED, GROUPS, [])));
    assert.ok(!sameBindingOptions(options, bindingOptions(MANAGED.slice(1), GROUPS, APS)));
    assert.ok(!sameBindingOptions(options, bindingOptions([managed(G1, 'Renamed', undefined), ...MANAGED.slice(1)], GROUPS, APS)));
  });

  test('groupNameLookup() prefers the managed name, falls back on the internal one, null for neither', () => {
    const nameOf = groupNameLookup([managed(G1, 'Default (6.3)', undefined)], GROUPS);
    assert.equal(nameOf(G1), 'Default (6.3)');
    assert.equal(nameOf(G2), 'Aulas');
    assert.equal(nameOf(G_UNLISTED), null);
  });
});

describe('the diff and the reach', () => {
  test('added / removed / kept in main\'s orders, duplicates once — the same as main\'s diffBindings()', () => {
    const samples: [string[], string[]][] = [
      [[G1], [G1, G2]],
      [[G1, G2], [G2]],
      [[G1, G2], [G3, G2, G3]],
      [[], [G1]],
      [[G1], [G1]],
    ];
    for (const [current, selected] of samples) {
      assert.deepEqual(diffBindingSets(current, selected), diffBindings(current, selected), JSON.stringify([current, selected]));
    }
    assert.deepEqual(diffBindingSets([G1, G2], [G3, G2, G3]), { added: [G3], removed: [G1], kept: [G2] });
  });

  test('the reach before and after in groups and APs, as the list states it', () => {
    const change = planBindingChange(network(), [G1, G2], GROUPS, APS);
    const tr = ctx('en');
    const rows = bindingChangeRows(change, groupNameLookup(MANAGED, GROUPS), tr);
    assert.deepEqual(rows.map(row => [row.kind, row.value]), [
      ['before', '1 group · 2 APs'],
      ['after', '2 groups · 3 APs'],
      ['added', 'Aulas'],
      ['removed', 'None'],
      ['kept', 'Default'],
    ]);
  });

  test('a lower bound reads "at least M APs" with its reason, never exact (an AP whose group is unknown; a group the list lacks)', () => {
    const aps = [...APS, ap(9, '')];
    const change = planBindingChange(network(), [G1, G_UNLISTED], GROUPS, aps);
    const en = bindingChangeRows(change, groupNameLookup(MANAGED, GROUPS), ctx('en'));
    assert.equal(en[0].value, '1 group · at least 2 APs; 1 AP\'s group cannot be identified');
    assert.equal(en[1].value, '2 groups · at least 2 APs; 1 AP\'s group cannot be identified; 1 bound group is not in the group list');
    assert.equal(en[2].value, '1 group not in the group list');
    const es = bindingChangeRows(change, groupNameLookup(MANAGED, GROUPS), ctx('es'));
    assert.equal(es[0].value, '1 grupo · al menos 2 AP; no se puede identificar el grupo de 1 AP');
  });

  test('an "All access points" or unknown-scope network keeps its own scope on both sides and changes nothing', () => {
    for (const shown of [network({ scope: 'allAccessPoints', apGroupIds: [] }), network({ scope: 'unknown', apGroupIds: null })]) {
      const change = planBindingChange(shown, [G1, G2], GROUPS, APS);
      assert.deepEqual(change.after, change.before);
      assert.deepEqual(change.diff, { added: [], removed: [], kept: [] });
    }
  });
});

describe('clientCapacityProblems() — the pre-check, fail closed', () => {
  test('every failing group + band of the added groups: reported 0 is full, not reported is unknown (never room)', () => {
    const list = [...MANAGED, managed('6512a0e1f3b2c41d2e3f4a60', 'Nada', undefined)];
    assert.deepEqual(clientCapacityProblems([G2, G3, G4, '6512a0e1f3b2c41d2e3f4a60', G_UNLISTED], ['band2g', 'band5g', 'band6g'], list), [
      { apGroupId: G3, band: 'band5g', reason: 'full' },
      { apGroupId: G4, band: 'band5g', reason: 'unknown' },
      { apGroupId: G4, band: 'band6g', reason: 'unknown' },
      { apGroupId: '6512a0e1f3b2c41d2e3f4a60', band: 'band2g', reason: 'unknown' },
      { apGroupId: '6512a0e1f3b2c41d2e3f4a60', band: 'band5g', reason: 'unknown' },
      { apGroupId: '6512a0e1f3b2c41d2e3f4a60', band: 'band6g', reason: 'unknown' },
      { apGroupId: G_UNLISTED, band: 'band2g', reason: 'unknown' },
      { apGroupId: G_UNLISTED, band: 'band5g', reason: 'unknown' },
      { apGroupId: G_UNLISTED, band: 'band6g', reason: 'unknown' },
    ]);
  });

  test('only the network\'s bands count: a 2.4 GHz network fits where only 5 GHz is full', () => {
    assert.deepEqual(clientCapacityProblems([G3, G4], ['band2g'], MANAGED), []);
    assert.deepEqual(clientCapacityProblems([G3], ['band5g'], MANAGED), [{ apGroupId: G3, band: 'band5g', reason: 'full' }]);
  });

  test('the same problems as main\'s checkBindingCapacity() for the radio bands (an MLO-free network)', () => {
    const bandSets: NetworkBand[][] = [['band2g'], ['band5g'], ['band2g', 'band5g'], ['band6g'], ['band2g', 'band5g', 'band6g']];
    const addedSets = [[G2], [G3], [G4], [G2, G3, G4], [G_UNLISTED, G3]];
    for (const bands of bandSets) {
      for (const added of addedSets) {
        assert.deepEqual(clientCapacityProblems(added, bands, MANAGED), checkBindingCapacity(added, bands, MANAGED.map(mainGroup), false), JSON.stringify({ bands, added }));
      }
    }
  });
});

describe('the request check — the only producer of a write request', () => {
  test('a change: the request carries the nonce, the network id and the COMPLETE new set (deduplicated, kept groups included)', () => {
    const checked = checkBindingDraft(network(), [G1, G2, G2], MANAGED, NONCE);
    assert.ok(checked.ok);
    assert.deepEqual(checked.request, { sessionNonce: NONCE, networkId: '5f00c0ffee0000000000c0a1', apGroupIds: [G1, G2] });
    assert.deepEqual(checked.diff, { added: [G2], removed: [], kept: [G1] });
  });

  test('"All access points" and an unknown scope never produce a request — whatever is selected', () => {
    const selections = [[], [G1], [G1, G2], [G2, G3], ['bad id!']];
    const shown = [
      network({ scope: 'allAccessPoints', apGroupIds: [] }),
      network({ scope: 'allAccessPoints', apGroupIds: [G1] }),
      network({ scope: 'unknown', apGroupIds: null }),
      network({ scope: 'unknown', apGroupIds: [G1] }),
      network({ scope: 'apGroups', apGroupIds: null }),
    ];
    for (const item of shown) {
      for (const selected of selections) {
        const checked = checkBindingDraft(item, selected, MANAGED, NONCE);
        assert.equal(checked.ok, false);
        assert.ok(!('request' in checked));
        assert.equal(checked.ok ? null : checked.error, item.scope === 'allAccessPoints' ? 'scopeAllAccessPoints' : 'scopeUnknown');
      }
    }
  });

  test('refusals: no group, a malformed or unlisted group, nothing changed, unknown bands while adding, no confirmed room', () => {
    const error = (shown: ManagedNetwork, selected: string[]): string | null => {
      const checked = checkBindingDraft(shown, selected, MANAGED, NONCE);
      return checked.ok ? null : checked.error;
    };
    assert.equal(error(network(), []), 'groupsRequired');
    assert.equal(error(network(), ['bad id!']), 'groupNotFound');
    assert.equal(error(network(), [G1, G_UNLISTED]), 'groupNotFound');
    assert.equal(error(network(), [G1]), 'nothingToChange');
    assert.equal(error(network({ apGroupIds: [G1, G2] }), [G2, G1]), 'nothingToChange');
    assert.equal(error(network({ bands: null }), [G1, G2]), 'networkStateUnknown');
    assert.equal(error(network(), [G1, G3]), 'capacityInsufficient');
  });

  test('a capacity refusal names EVERY failing added group and band; a kept group is never checked', () => {
    const checked = checkBindingDraft(network({ bands: ['band2g', 'band5g', 'band6g'], apGroupIds: [G3] }), [G3, G4, G2], MANAGED, NONCE);
    assert.equal(checked.ok, false);
    assert.deepEqual(checked.ok ? null : checked.capacityProblems, [
      { apGroupId: G4, band: 'band5g', reason: 'unknown' },
      { apGroupId: G4, band: 'band6g', reason: 'unknown' },
    ]);
  });

  test('a removal-only change needs no capacity data and no known bands', () => {
    const shown = network({ bands: null, apGroupIds: [G1, G3, G4] });
    const checked = checkBindingDraft(shown, [G1], [managed(G1, 'Default', undefined), managed(G3, 'Patio', undefined), managed(G4, 'Tienda', undefined)], NONCE);
    assert.ok(checked.ok);
    assert.deepEqual(checked.diff, { added: [], removed: [G3, G4], kept: [G1] });
  });

  test('checkBindingSelection() refuses at request level without any AP-group data', () => {
    assert.deepEqual(checkBindingSelection(network(), []), { ok: false, error: 'groupsRequired', diagnostic: null, capacityProblems: [] });
    assert.deepEqual(checkBindingSelection(network(), [G1]), { ok: false, error: 'nothingToChange', diagnostic: null, capacityProblems: [] });
    assert.ok(checkBindingSelection(network(), [G_UNLISTED]).ok);
  });

  test('agrees with main\'s planNetworkBindings() on the same data (code, capacity problems, the new set)', () => {
    const selections = [[], [G1], [G2], [G1, G2], [G3], [G1, G3, G4], [G4], [G_UNLISTED], [G2, G2, G1]];
    const shown = [network(), network({ apGroupIds: [G1, G3] }), network({ bands: ['band6g'], apGroupIds: [] }), network({ bands: null }), network({ bands: ['band2g'] })];
    for (const item of shown) {
      for (const selected of selections) {
        const renderer = checkBindingDraft(item, selected, MANAGED, NONCE);
        const main = planNetworkBindings(selected, { scope: item.scope, bands: item.bands, apGroupIds: item.apGroupIds, mloEnabled: false }, MANAGED.map(mainGroup));
        const label = JSON.stringify({ bands: item.bands, bound: item.apGroupIds, selected });
        assert.equal(renderer.ok, main.ok, label);
        if (renderer.ok && main.ok) {
          assert.deepEqual(renderer.request.apGroupIds, main.plan.apGroupIds, label);
        } else if (!renderer.ok && !main.ok) {
          assert.equal(renderer.error, main.error, label);
          assert.deepEqual(renderer.capacityProblems, main.capacityProblems ?? [], label);
        }
      }
    }
  });
});

describe('parseNetworkBindingsResult() — the reply at the boundary', () => {
  test('a success is exactly {success: true}; a contradictory or extended one is refused', () => {
    assert.deepEqual(parseNetworkBindingsResult({ success: true }), { ok: true });
    const problem = { apGroupId: G2, band: 'band5g', reason: 'full' };
    for (const raw of [
      { success: true, extra: 'ignored' },
      { success: true, error: 'requestFailed' },
      { success: true, error: 'capacityInsufficient', capacityProblems: [problem] },
      { success: true, capacityProblems: [] },
      { success: true, diagnostic: 'capacity: 1 full, 0 unknown' },
    ]) {
      assert.deepEqual(parseNetworkBindingsResult(raw), { ok: false, error: 'failed', diagnostic: null, capacityProblems: [] }, JSON.stringify(raw));
    }
  });

  test('a refusal with an unknown key, or capacity problems under another code, is refused', () => {
    const problem = { apGroupId: G2, band: 'band5g', reason: 'full' };
    for (const raw of [
      { success: false, error: 'requestFailed', extra: 1 },
      { success: false, error: 'requestFailed', capacityProblems: [problem] },
      { success: false, error: 'requestFailed', capacityProblems: [] },
      { success: false, error: 'scopeAllAccessPoints', capacityProblems: 'none' },
    ]) {
      assert.deepEqual(parseNetworkBindingsResult(raw), { ok: false, error: 'failed', diagnostic: null, capacityProblems: [] }, JSON.stringify(raw));
    }
  });

  test('a refusal keeps main\'s known code and its codes-only diagnostic', () => {
    assert.deepEqual(parseNetworkBindingsResult({ success: false, error: 'requestFailed', diagnostic: 'ssid bindings: apiError, errorCode -33000' }), {
      ok: false, error: 'requestFailed', diagnostic: 'ssid bindings: apiError, errorCode -33000', capacityProblems: [],
    });
    const problem = { apGroupId: G2, band: 'band5g', reason: 'full' };
    for (const error of ERRORS) {
      const raw = error === 'capacityInsufficient' ? { success: false, error, capacityProblems: [problem] } : { success: false, error };
      const parsed = parseNetworkBindingsResult(raw);
      assert.equal(parsed.ok ? null : parsed.error, error, error);
    }
  });

  test('an unknown code, one of the renderer\'s own codes, or a malformed diagnostic is not taken from main', () => {
    for (const error of ['nope', ...OWN, 42, null, undefined, 'toString', '__proto__']) {
      const parsed = parseNetworkBindingsResult({ success: false, error });
      assert.equal(parsed.ok ? null : parsed.error, 'failed', String(error));
    }
    const parsed = parseNetworkBindingsResult({ success: false, error: 'requestFailed', diagnostic: '<img src=x onerror=alert(1)>' });
    assert.equal(parsed.ok ? 'ok' : parsed.diagnostic, null);
  });

  test('a malformed reply is refused as "failed"', () => {
    for (const raw of [null, undefined, 'success', 42, [], [{ success: true }], {}, { success: 'true' }, { success: 1 }, { error: 'requestFailed' }]) {
      assert.deepEqual(parseNetworkBindingsResult(raw), { ok: false, error: 'failed', diagnostic: null, capacityProblems: [] }, JSON.stringify(raw));
    }
  });

  test('the capacity problems of a capacityInsufficient refusal are kept when every one is well-formed (mlo included)', () => {
    const problems = [
      { apGroupId: G2, band: 'band5g', reason: 'full' },
      { apGroupId: G2, band: 'mlo', reason: 'unknown' },
      { apGroupId: G3, band: 'band2g', reason: 'unknown' },
    ];
    assert.deepEqual(parseNetworkBindingsResult({ success: false, error: 'capacityInsufficient', diagnostic: 'capacity: 1 full, 2 unknown', capacityProblems: problems }), {
      ok: false, error: 'capacityInsufficient', diagnostic: 'capacity: 1 full, 2 unknown', capacityProblems: problems,
    });
    // A capacityInsufficient refusal without its problems (absent or empty) is unreadable
    for (const raw of [{ success: false, error: 'capacityInsufficient' }, { success: false, error: 'capacityInsufficient', capacityProblems: [] }]) {
      assert.deepEqual(parseNetworkBindingsResult(raw), { ok: false, error: 'failed', diagnostic: null, capacityProblems: [] }, JSON.stringify(raw));
    }
  });

  test('one malformed capacity problem (or a list that is not one, or too long) refuses the whole reply', () => {
    const good = { apGroupId: G2, band: 'band5g', reason: 'full' };
    const bad: unknown[] = [
      'not a list',
      { 0: good },
      [good, { apGroupId: 'bad id!', band: 'band5g', reason: 'full' }],
      [{ apGroupId: G2, band: 'band7g', reason: 'full' }],
      [{ apGroupId: G2, band: 'band5g', reason: 'maybe' }],
      [{ apGroupId: G2, band: 'band5g', reason: 'full', note: 'extra' }],
      [{ apGroupId: G2, band: 'band5g' }],
      [null],
      [[G2, 'band5g', 'full']],
      Array.from({ length: MAX_CAPACITY_PROBLEMS + 1 }, () => good),
    ];
    for (const capacityProblems of bad) {
      assert.deepEqual(parseNetworkBindingsResult({ success: false, error: 'capacityInsufficient', capacityProblems }), { ok: false, error: 'failed', diagnostic: null, capacityProblems: [] });
    }
    const atCap = parseNetworkBindingsResult({ success: false, error: 'capacityInsufficient', capacityProblems: Array.from({ length: MAX_CAPACITY_PROBLEMS }, () => good) });
    assert.equal(atCap.ok ? 0 : atCap.capacityProblems.length, MAX_CAPACITY_PROBLEMS);
  });

  test('isNetworkBindingsError() accepts main\'s codes only', () => {
    for (const error of ERRORS) assert.ok(isNetworkBindingsError(error), error);
    for (const error of OWN) assert.ok(!isNetworkBindingsError(error), error);
  });

  test('a refusal that means stale data re-reads the lists; the renderer\'s own and session ones do not', () => {
    for (const error of ['nothingToChange', 'networkNotFound', 'scopeAllAccessPoints', 'scopeUnknown', 'groupNotFound', 'networkStateUnknown', 'capacityInsufficient', 'requestFailed'] as const) {
      assert.ok(isBindingStaleDataFailure(error), error);
    }
    for (const error of ['notConnected', 'superseded', 'managementUnavailable', 'groupsRequired', 'groupListIncomplete', 'networkListIncomplete', ...OWN] as BindingFailure[]) {
      assert.ok(!isBindingStaleDataFailure(error), error);
    }
  });
});

describe('the texts (es / en)', () => {
  test('EVERY NetworkBindingsError and every renderer failure has its own non-empty text in both languages', () => {
    const keys = new Set<string>();
    for (const error of [...ERRORS, ...OWN]) {
      const key = bindingErrorKey(error);
      for (const language of ['es', 'en'] as const) {
        const text = translations[language][key];
        assert.equal(typeof text, 'string', `${language} ${key}`);
        assert.ok(text.trim().length > 0, `${language} ${key}`);
      }
      assert.notEqual(translations.es[key], translations.en[key], key);
      keys.add(key);
    }
    // main's codes each have their own message
    assert.equal(new Set(ERRORS.map(bindingErrorKey)).size, ERRORS.length);
    assert.ok(keys.size >= ERRORS.length);
  });

  test('a refusal reads its message with main\'s diagnostic in parentheses', () => {
    const failure = { error: 'capacityInsufficient' as const, diagnostic: 'capacity: 1 full, 0 unknown', capacityProblems: [] };
    assert.equal(bindingFailureText(failure, ctx('en')), `${translations.en.bindingErrorCapacityInsufficient} (capacity: 1 full, 0 unknown)`);
    assert.equal(bindingFailureText({ ...failure, diagnostic: null }, ctx('es')), translations.es.bindingErrorCapacityInsufficient);
    assert.equal(bindingFailureText({ error: 'groupsStale', diagnostic: null, capacityProblems: [] }, ctx('en')), translations.en.bindingErrorGroupsStale);
    assert.equal(bindingFailureText({ error: 'networkChanged', diagnostic: null, capacityProblems: [] }, ctx('es')), translations.es.networkErrorNetworkChanged);
  });

  test('the capacity problems are named per group and band (one line per group; MLO; a group no list has by its id)', () => {
    const problems = [
      { apGroupId: G3, band: 'band5g' as const, reason: 'full' as const },
      { apGroupId: G4, band: 'band5g' as const, reason: 'unknown' as const },
      { apGroupId: G4, band: 'band6g' as const, reason: 'unknown' as const },
      { apGroupId: G2, band: 'mlo' as const, reason: 'unknown' as const },
      { apGroupId: G_UNLISTED, band: 'band2g' as const, reason: 'full' as const },
    ];
    const nameOf = groupNameLookup(MANAGED, GROUPS);
    assert.deepEqual(capacityProblemLines(problems, nameOf, ctx('en')), [
      'Patio — 5 GHz: full',
      'Tienda — 5 GHz: not reported, 6 GHz: not reported',
      'Aulas — MLO: not reported',
      `${G_UNLISTED} — 2.4 GHz: full`,
    ]);
    assert.deepEqual(capacityProblemLines(problems, nameOf, ctx('es')), [
      'Patio — 5 GHz: sin hueco',
      'Tienda — 5 GHz: no informado, 6 GHz: no informado',
      'Aulas — MLO: no informado',
      `${G_UNLISTED} — 2,4 GHz: sin hueco`,
    ]);
    assert.deepEqual(capacityProblemLines([], nameOf, ctx('en')), []);
    assert.equal(mloProblemNote(problems, ctx('en')), translations.en.bindingMloNote);
    assert.equal(mloProblemNote(problems.slice(0, 3), ctx('en')), null);
  });

  test('group lists name the groups (an empty name as "(no name)"), count the ones no list has, "None" for none', () => {
    const nameOf = groupNameLookup([managed(G1, '', undefined), ...MANAGED.slice(1)], GROUPS);
    assert.equal(groupListText([], nameOf, ctx('en')), 'None');
    assert.equal(groupListText([G1, G2, G_UNLISTED, '6512a0e1f3b2c41d2e3f4a61'], nameOf, ctx('en')), '(no name), Aulas, 2 groups not in the group list');
    assert.equal(groupListText([G2, G_UNLISTED], nameOf, ctx('es')), 'Aulas, 1 grupo que no está en la lista');
  });

  test('the confirmation notes: removed groups stop broadcasting it; per-AP overrides cannot be shown', () => {
    const removing = planBindingChange(network({ apGroupIds: [G1, G2] }), [G1], GROUPS, APS);
    assert.deepEqual(bindingChangeNotes(removing, ctx('en')), [translations.en.bindingNoteRemoved, translations.en.overridesUnavailable]);
    const adding = planBindingChange(network(), [G1, G2], GROUPS, APS);
    assert.deepEqual(bindingChangeNotes(adding, ctx('es')), [translations.es.overridesUnavailable]);
  });

  test('the selection line: none / one / many, plus how many the search hides', () => {
    assert.equal(bindingSelectionText(0, 0, ctx('en')), 'No group selected');
    assert.equal(bindingSelectionText(1, 0, ctx('en')), '1 group selected');
    assert.equal(bindingSelectionText(3, 1, ctx('en')), '3 groups selected · 1 hidden by the search');
    assert.equal(bindingSelectionText(3, 2, ctx('es')), '3 grupos elegidos · 2 ocultos por la búsqueda');
  });

  test('every binding text exists in both languages (no empty string)', () => {
    const keys = (Object.keys(translations.es) as (keyof Translations)[]).filter(key => key.startsWith('binding'));
    assert.ok(keys.length >= 50);
    for (const key of keys) {
      assert.ok(translations.es[key].trim() !== '' && translations.en[key].trim() !== '', key);
    }
    assert.deepEqual(keys, (Object.keys(translations.en) as (keyof Translations)[]).filter(key => key.startsWith('binding')));
  });
});

describe('bindingPreview() — the editor\'s live preview', () => {
  const input = {
    network: network(),
    managed: MANAGED,
    groups: GROUPS,
    accessPoints: APS,
  };

  test('nothing changed yet: the review is not offered, a note says so', () => {
    const preview = bindingPreview({ ...input, selected: [G1], visible: [G1, G2, G3, G4] }, ctx('en'));
    assert.equal(preview.changed, false);
    assert.equal(preview.selection, '1 group selected');
    assert.deepEqual(preview.notes, [translations.en.bindingUnchanged]);
    assert.deepEqual(preview.capacity, []);
    assert.deepEqual(preview.rows.map(row => row.value), ['1 group · 2 APs', '1 group · 2 APs', 'None', 'None', 'Default']);
  });

  test('an added group without room: the pre-check names it per band; a hidden selected group is counted', () => {
    const preview = bindingPreview({ ...input, selected: [G1, G3, G4], visible: [G3] }, ctx('en'));
    assert.equal(preview.changed, true);
    assert.equal(preview.selection, '3 groups selected · 2 hidden by the search');
    assert.deepEqual(preview.capacity, ['Patio — 5 GHz: full', 'Tienda — 5 GHz: not reported']);
    assert.deepEqual(preview.notes, []);
    assert.equal(preview.rows[1].value, '3 groups · 3 APs');
  });

  test('unknown bands while adding: a note instead of capacity lines; a removal-only change has neither', () => {
    const unknownBands = bindingPreview({ ...input, network: network({ bands: null }), selected: [G1, G2], visible: [] }, ctx('es'));
    assert.deepEqual(unknownBands.notes, [translations.es.bindingBandsUnknownNote]);
    assert.deepEqual(unknownBands.capacity, []);
    const removal = bindingPreview({ ...input, network: network({ bands: null, apGroupIds: [G1, G2] }), selected: [G2], visible: [G2] }, ctx('es'));
    assert.equal(removal.changed, true);
    assert.deepEqual(removal.notes, []);
    assert.deepEqual(removal.capacity, []);
    assert.deepEqual(removal.rows.map(row => row.value), ['2 grupos · 3 AP', '1 grupo · 1 AP', 'Ninguno', 'Default', 'Aulas']);
  });

  test('no group selected is a change (refused at Review with its reason, never silently)', () => {
    const preview = bindingPreview({ ...input, selected: [], visible: [G1] }, ctx('en'));
    assert.equal(preview.changed, true);
    assert.equal(preview.selection, 'No group selected');
    const checked = checkBindingSelection(network(), []);
    assert.equal(checked.ok ? null : checked.error, 'groupsRequired');
  });
});
