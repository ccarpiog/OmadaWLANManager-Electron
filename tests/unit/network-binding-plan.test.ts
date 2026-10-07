// Tests for the pure binding rules of src/main/network-binding-plan.ts (todo.md
// 4.12, phase 19a), over payloads run through the real read-model validators
// (wifi-network-model.ts) and over hand-made ones (defense in depth):
// - the request: ids deduplicated, at least one, 24-hex ids only;
// - the facts and the scope, by the read model's own rules (catalog entry,
//   detail and bindings through toManagedNetwork()): "All access points"
//   (chooseDevices 0), AP groups (chooseDevices 1 with known bindings),
//   unknown for everything else — a missing / unrecognized device selection,
//   the catalog and the detail disagreeing (device selection; bands become
//   unknown), an entry naming another network, bindings disagreeing with the
//   detail's apGroupIds, a bound id that is not 24 hex digits, garbage;
// - the MLO state: the detail's raw mloEnable when a boolean, else unknown;
// - the diff (added / removed / kept, compared as sets);
// - the capacity of ADDED groups only, on every band the network uses (and
//   MLO for an MLO network): every failing group + band named (not just the
//   first), a band reported at 0 is 'full', a missing / insane value or no
//   remainingBinding at all is 'unknown' (fail closed), MLO 'unknown' while
//   no MLO key is documented;
// - the plan's refusal order, ids absent from the fresh list (kept ones
//   included), the no-op, unknown bands or MLO state only mattering when
//   groups are added;
// - the reply, the exact body and the client's sanity check.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  bindingRefusalReply,
  buildBindingsBody,
  capacityDiagnostic,
  checkBindingCapacity,
  checkBindingRequest,
  checkBindingScope,
  diffBindings,
  isSaneBindingIds,
  MLO_REMAINING_BINDING_KEY,
  mloRemainingBinding,
  networkBindingFacts,
  planNetworkBindings,
  type BindingApGroup,
  type NetworkBindingFacts
} from '../../src/main/network-binding-plan';
import {
  UNRECOGNIZED,
  validateOpenApiSsid,
  validateOpenApiSsidDetail,
  validateSsidBindings,
  type OpenApiSsid,
  type OpenApiSsidBindings,
  type OpenApiSsidDetail
} from '../../src/main/wifi-network-model';

const SSID_ID = '5f00c0ffee0000000000c001';
const [A, B, C, D] = ['6512a0e1f3b2c41d2e3f4a5b', '6512a0e1f3b2c41d2e3f4a5c', '6512a0e1f3b2c41d2e3f4a5d', '6512a0e1f3b2c41d2e3f4a5e'];
// The raw fields the catalog entry and the detail of the test network share
const BASE: Record<string, unknown> = { id: SSID_ID, name: 'Casa', security: 3, band: 3, chooseDevices: 1 };
// A hypothetical MLO key of remainingBinding (none is documented: only for
// exercising the MLO count rule of checkBindingCapacity())
const TRIAL_MLO_KEY = '3';

/**
 * A validated fresh catalog entry of the test network.
 * @param {Record<string, unknown>} [fields] - Raw entry fields (over chooseDevices 1, 2.4 + 5 GHz).
 * @returns {OpenApiSsid} The validated entry.
 */
function entry(fields: Record<string, unknown> = {}): OpenApiSsid {
  const validated = validateOpenApiSsid({ ...BASE, description: true, ...fields });
  assert.ok(validated, 'a valid catalog entry');
  return validated;
}

/**
 * A validated fresh detail of the test network.
 * @param {Record<string, unknown>} [fields] - Raw detail fields (over chooseDevices 1, 2.4 + 5 GHz, bound to A).
 * @returns {OpenApiSsidDetail} The validated detail.
 */
function detail(fields: Record<string, unknown> = {}): OpenApiSsidDetail {
  const validated = validateOpenApiSsidDetail({ ...BASE, apGroupIds: [A], ...fields }, SSID_ID);
  assert.ok(validated, 'a valid detail');
  return validated;
}

/**
 * The catalog fields that agree with these raw detail fields: the device
 * selection, the bands and the security, whenever the detail fields set them
 * (an explicit undefined included).
 * @param {Record<string, unknown>} fields - Raw detail fields.
 * @returns {Record<string, unknown>} The matching raw catalog fields.
 */
function agreeing(fields: Record<string, unknown>): Record<string, unknown> {
  const catalog: Record<string, unknown> = {};
  for (const key of ['chooseDevices', 'band', 'security']) {
    if (key in fields) {
      catalog[key] = fields[key];
    }
  }
  return catalog;
}

/**
 * The facts of the test network from a catalog entry that AGREES with the
 * detail (unless `catalog` says otherwise) and an MLO state (default off).
 * @param {Record<string, unknown>} fields - Raw detail fields.
 * @param {OpenApiSsidBindings} bound - The validated bindings.
 * @param {{ catalog?: Record<string, unknown>; mloEnable?: unknown }} [options] - Raw catalog fields (default: agreeing()) and the raw mloEnable (default false).
 * @returns {NetworkBindingFacts} The facts.
 */
function factsOf(fields: Record<string, unknown>, bound: OpenApiSsidBindings, options: { catalog?: Record<string, unknown>; mloEnable?: unknown } = {}): NetworkBindingFacts {
  const mloEnable = 'mloEnable' in options ? options.mloEnable : false;
  return networkBindingFacts(entry(options.catalog ?? agreeing(fields)), detail(fields), bound, mloEnable);
}

/**
 * Validated fresh bindings.
 * @param {unknown} apGroups - The raw `apGroups` list (ids or entries).
 * @returns {OpenApiSsidBindings} The validated bindings.
 */
function bindings(apGroups: unknown): OpenApiSsidBindings {
  const raw = Array.isArray(apGroups) ? apGroups.map((entry) => (typeof entry === 'string' ? { id: entry, name: entry } : entry)) : apGroups;
  const validated = validateSsidBindings({ apGroups: raw });
  assert.ok(validated, 'valid bindings');
  return validated;
}

/**
 * The facts of a network bound to `ids` on the given bands, with MLO off
 * (unless `mloEnable` says otherwise).
 * @param {string[]} ids - The bound ids.
 * @param {number} [band] - The band mask.
 * @param {unknown} [mloEnable] - The detail's raw mloEnable.
 * @returns {NetworkBindingFacts} The facts.
 */
function boundTo(ids: string[], band = 3, mloEnable: unknown = false): NetworkBindingFacts {
  return factsOf({ apGroupIds: ids, band }, bindings(ids), { mloEnable });
}

/**
 * A fresh AP group with per-band remaining bindings (keys 0 / 1 / 2).
 * @param {string} id - The group id.
 * @param {Record<string, unknown> | null} [remainingBinding] - The record (null: not reported; default: room on every band).
 * @returns {BindingApGroup} The group.
 */
function group(id: string, remainingBinding: Record<string, unknown> | null = { 0: 5, 1: 5, 2: 5 }): BindingApGroup {
  return remainingBinding === null ? { id } : { id, remainingBinding: remainingBinding as Record<string, number> };
}

describe('checkBindingRequest(): the rules that need no controller data', () => {
  test('ids are deduplicated in request order; at least one; only 24-hex ids', () => {
    assert.deepEqual(checkBindingRequest([B, A, B, A]), { ok: true, apGroupIds: [B, A] });
    assert.deepEqual(checkBindingRequest([]), { ok: false, error: 'groupsRequired' });
    assert.deepEqual(checkBindingRequest(undefined), { ok: false, error: 'groupsRequired' });
    assert.deepEqual(checkBindingRequest('not a list'), { ok: false, error: 'groupsRequired' });
    for (const bad of [[A, 'bad id!'], [A, 7], [`${A}0`], [null]]) {
      assert.deepEqual(checkBindingRequest(bad), { ok: false, error: 'groupNotFound' }, JSON.stringify(bad));
    }
  });
}); // End of the describe block for checkBindingRequest()

describe('networkBindingFacts() and checkBindingScope(): the scope from the fresh catalog entry, detail and bindings', () => {
  test('chooseDevices 0 is "All access points" (whatever the bindings say) and refused; chooseDevices 1 with agreeing bindings is "AP groups"', () => {
    for (const ids of [[], [A], [A, B, C, D]]) {
      const facts = factsOf({ chooseDevices: 0, apGroupIds: ids }, bindings(ids));
      assert.equal(facts.scope, 'allAccessPoints');
      assert.deepEqual(checkBindingScope(facts), { ok: false, error: 'scopeAllAccessPoints' });
    }
    const facts = boundTo([A, B]);
    assert.deepEqual(facts, { scope: 'apGroups', bands: ['band2g', 'band5g'], apGroupIds: [A, B], mloEnabled: false });
    assert.equal(checkBindingScope(facts), null);
    assert.deepEqual(factsOf({ apGroupIds: [B, A, A] }, bindings([A, B])).apGroupIds, [A, B], 'compared as sets');
    assert.equal(factsOf({ apGroupIds: undefined }, bindings([A])).scope, 'apGroups', 'the bindings alone when the detail omits apGroupIds');
    // One source silent, the other reporting: the read model takes the reporting one
    assert.equal(factsOf({ chooseDevices: undefined }, bindings([A]), { catalog: {} }).scope, 'apGroups', 'the catalog alone reports chooseDevices 1');
    assert.equal(factsOf({}, bindings([A]), { catalog: { chooseDevices: undefined } }).scope, 'apGroups', 'the detail alone reports chooseDevices 1');
  }); // End of test "chooseDevices 0 is "All access points"…"

  test('every unknown or contradictory state is "unknown" and refused — never "all", never "AP groups"', () => {
    const unknown: Array<[string, Record<string, unknown>, OpenApiSsidBindings]> = [
      ['no chooseDevices anywhere', { chooseDevices: undefined }, bindings([A])],
      ['chooseDevices 7', { chooseDevices: 7 }, bindings([A])],
      ['chooseDevices "1"', { chooseDevices: '1' }, bindings([A])],
      ['bindings disagree with the detail', { apGroupIds: [A, B] }, bindings([A])],
      ['a bound id that is not 24 hex digits', { apGroupIds: undefined }, bindings([A, 'legacy_group_01'])],
      ['a detail apGroupIds that is not a list', { apGroupIds: A }, bindings([A])],
      ['bindings and detail ids not reported', { apGroupIds: undefined }, { apGroupIds: undefined }]
    ];
    for (const [label, fields, bound] of unknown) {
      const facts = factsOf(fields, bound);
      assert.equal(facts.scope, 'unknown', label);
      assert.deepEqual(checkBindingScope(facts), { ok: false, error: 'scopeUnknown' }, label);
    }
  }); // End of test "every unknown or contradictory state…"

  test('the catalog and the detail disagreeing is "unknown" (the list\'s own rule) — never judged from the detail alone', () => {
    const disagreements: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ['catalog "all", detail "AP groups"', {}, { chooseDevices: 0 }],
      ['catalog "AP groups", detail "all"', { chooseDevices: 0 }, { chooseDevices: 1 }],
      ['catalog chooseDevices unrecognized', {}, { chooseDevices: 5 }],
      ['catalog chooseDevices a string', {}, { chooseDevices: '1' }]
    ];
    for (const [label, fields, catalog] of disagreements) {
      const facts = factsOf(fields, bindings([A]), { catalog });
      assert.equal(facts.scope, 'unknown', label);
      assert.deepEqual(checkBindingScope(facts), { ok: false, error: 'scopeUnknown' }, label);
    }
    // The bands disagreeing: unknown bands (adding is refused, see the plan)
    assert.equal(factsOf({}, bindings([A]), { catalog: { band: 1 } }).bands, null);
    assert.equal(factsOf({}, bindings([A]), { catalog: { band: 9 } }).bands, null, 'an unrecognized catalog band');
    // An entry naming another network: nothing is known
    const other = networkBindingFacts(entry({ id: '5f00c0ffee0000000000c0ff' }), detail(), bindings([A]), false);
    assert.deepEqual(other, { scope: 'unknown', bands: null, apGroupIds: null, mloEnabled: false });
  }); // End of test "the catalog and the detail disagreeing…"

  test('the MLO state is the detail\'s raw mloEnable when it is a boolean; absent, null or any other type is unknown', () => {
    assert.equal(boundTo([A], 3, true).mloEnabled, true);
    assert.equal(boundTo([A], 3, false).mloEnabled, false);
    for (const value of [undefined, null, 'true', 1, 0, {}, []]) {
      assert.equal(factsOf({}, bindings([A]), { mloEnable: value }).mloEnabled, null, JSON.stringify(value));
    }
  });

  test('hand-made garbage handed straight to the facts (not from the validators) is unknown, never a value', () => {
    const garbage = { id: SSID_ID, enabled: true, security: 'wpaPersonal', hasSecurityKey: false } as const;
    const cases: Array<[Partial<OpenApiSsidDetail>, Partial<OpenApiSsidBindings>]> = [
      [{ deviceSelection: 'everything' as never, bands: ['band2g'], apGroupIds: [A] }, { apGroupIds: [A] }],
      [{ deviceSelection: 'selected', bands: ['band2g'], apGroupIds: [A] }, { apGroupIds: ['nope'] as never }],
      [{ deviceSelection: 'selected', bands: ['band2g'], apGroupIds: [A] }, { apGroupIds: UNRECOGNIZED }]
    ];
    const silent = entry({ chooseDevices: undefined, band: undefined, security: undefined });
    for (const [fresh, bound] of cases) {
      assert.equal(networkBindingFacts(silent, { ...garbage, ...fresh } as OpenApiSsidDetail, bound as OpenApiSsidBindings, false).scope, 'unknown', JSON.stringify(fresh));
    }
    const badBands = networkBindingFacts(silent, { ...garbage, deviceSelection: 'selected', bands: ['band9g'] as never, apGroupIds: [A] }, { apGroupIds: [A] }, false);
    assert.equal(badBands.bands, null);
    assert.equal(factsOf({ band: 0 }, bindings([A])).bands, null, 'band 0 is unrecognized');
    assert.deepEqual(factsOf({ band: 7 }, bindings([A])).bands, ['band2g', 'band5g', 'band6g']);
  }); // End of test "hand-made garbage…"
}); // End of the describe block for the scope

describe('diffBindings(): added / removed / kept', () => {
  test('compared as sets, in request order (added, kept) and current order (removed)', () => {
    assert.deepEqual(diffBindings([A, B], [C, B, D]), { added: [C, D], removed: [A], kept: [B] });
    assert.deepEqual(diffBindings([A, B], [B, A]), { added: [], removed: [], kept: [B, A] });
    assert.deepEqual(diffBindings([], [A]), { added: [A], removed: [], kept: [] });
  });
});

describe('checkBindingCapacity(): every added group, every band the network uses', () => {
  test('names EVERY failing group + band, not just the first: 0 is "full", a missing band or record "unknown", in added-group then band order', () => {
    const groups = [group(A, { 0: 0, 1: 0, 2: 0 }), group(B, { 0: 3 }), group(C, null), group(D, { 0: 1, 1: 1 })];
    assert.deepEqual(checkBindingCapacity([A, B, C, D], ['band2g', 'band5g'], groups), [
      { apGroupId: A, band: 'band2g', reason: 'full' },
      { apGroupId: A, band: 'band5g', reason: 'full' },
      { apGroupId: B, band: 'band5g', reason: 'unknown' },
      { apGroupId: C, band: 'band2g', reason: 'unknown' },
      { apGroupId: C, band: 'band5g', reason: 'unknown' }
    ]);
  });

  test('insane values fail closed (unknown, never room left); only the bands the network uses count; a group missing from the list is unknown', () => {
    for (const value of [-1, 1.5, '3', null, Number.NaN, Number.POSITIVE_INFINITY, true]) {
      assert.deepEqual(checkBindingCapacity([A], ['band5g'], [group(A, { 0: 9, 1: value, 2: 9 })]), [{ apGroupId: A, band: 'band5g', reason: 'unknown' }], String(value));
    }
    assert.deepEqual(checkBindingCapacity([A], ['band5g'], [{ id: A, remainingBinding: 'x' as never }]), [{ apGroupId: A, band: 'band5g', reason: 'unknown' }]);
    assert.deepEqual(checkBindingCapacity([A], ['band2g'], [group(A, { 0: 1, 1: 0, 2: 0 })]), [], '5 / 6 GHz full do not matter for a 2.4 GHz network');
    assert.deepEqual(checkBindingCapacity([A], ['band6g'], [group(A, { 0: 4, 1: 4 })]), [{ apGroupId: A, band: 'band6g', reason: 'unknown' }]);
    assert.deepEqual(checkBindingCapacity([B], ['band2g'], [group(A)]), [{ apGroupId: B, band: 'band2g', reason: 'unknown' }]);
    assert.deepEqual(checkBindingCapacity([], ['band2g'], [group(A, { 0: 0 })]), []);
    assert.equal(capacityDiagnostic(checkBindingCapacity([A, B], ['band2g', 'band5g'], [group(A, { 0: 0, 1: 0 }), group(B, { 0: 2 })])), 'capacity: 2 full, 1 unknown');
  }); // End of test "insane values fail closed…"

  test('MLO, as shipped: no MLO key is documented, so EVERY added group of an MLO network has MLO "unknown" — even with room on every band and any extra key', () => {
    assert.equal(MLO_REMAINING_BINDING_KEY, null);
    const roomy = [group(A, { 0: 5, 1: 5, 2: 5, 3: 5, mlo: 5 }), group(B, { 0: 5, 1: 5 }), group(C, null)];
    assert.deepEqual(checkBindingCapacity([A, B, C], ['band2g', 'band5g'], roomy, true), [
      { apGroupId: A, band: 'mlo', reason: 'unknown' },
      { apGroupId: B, band: 'mlo', reason: 'unknown' },
      { apGroupId: C, band: 'band2g', reason: 'unknown' },
      { apGroupId: C, band: 'band5g', reason: 'unknown' },
      { apGroupId: C, band: 'mlo', reason: 'unknown' }
    ]);
    assert.deepEqual(checkBindingCapacity([A], ['band2g', 'band5g'], roomy, false), [], 'MLO off: no MLO check');
    assert.deepEqual(checkBindingCapacity([A], ['band2g', 'band5g'], roomy), [], 'MLO off by default');
    assert.equal(mloRemainingBinding({ 3: 5 }, MLO_REMAINING_BINDING_KEY), undefined);
  });

  test('MLO with a known key (TRIAL_MLO_KEY, hypothetical): with room passes, without room is "full", missing / insane is "unknown" — every failing group named, MLO after the bands', () => {
    const groups = [group(A, { 0: 5, 1: 5, [TRIAL_MLO_KEY]: 2 }), group(B, { 0: 5, 1: 0, [TRIAL_MLO_KEY]: 0 }), group(C, { 0: 5, 1: 5 }), group(D, { 0: 5, 1: 5, [TRIAL_MLO_KEY]: '4' })];
    assert.deepEqual(checkBindingCapacity([A], ['band2g', 'band5g'], groups, true, TRIAL_MLO_KEY), [], 'with room');
    assert.deepEqual(checkBindingCapacity([A, B, C, D], ['band2g', 'band5g'], groups, true, TRIAL_MLO_KEY), [
      { apGroupId: B, band: 'band5g', reason: 'full' },
      { apGroupId: B, band: 'mlo', reason: 'full' },
      { apGroupId: C, band: 'mlo', reason: 'unknown' },
      { apGroupId: D, band: 'mlo', reason: 'unknown' }
    ]);
    for (const value of [-1, 1.5, null, Number.NaN, true]) {
      assert.equal(mloRemainingBinding({ [TRIAL_MLO_KEY]: value }, TRIAL_MLO_KEY), undefined, String(value));
    }
    assert.equal(mloRemainingBinding(undefined, TRIAL_MLO_KEY), undefined);
    assert.equal(mloRemainingBinding('x', TRIAL_MLO_KEY), undefined);
    assert.equal(mloRemainingBinding(Object.create({ [TRIAL_MLO_KEY]: 3 }), TRIAL_MLO_KEY), undefined, 'an inherited key is not reported');
    assert.equal(mloRemainingBinding({ [TRIAL_MLO_KEY]: 0 }, TRIAL_MLO_KEY), 0);
  }); // End of test "MLO with a known key…"
}); // End of the describe block for checkBindingCapacity()

describe('planNetworkBindings(): the rules on fresh data, in order', () => {
  const fresh = [group(A), group(B), group(C), group(D)];

  test('a valid change: the complete new set in request order, with its diff', () => {
    assert.deepEqual(planNetworkBindings([C, A, C], boundTo([A, B]), fresh), { ok: true, plan: { apGroupIds: [C, A], added: [C], removed: [B], kept: [A] } });
  });

  test('"All access points" and unknown scopes are refused before every other rule (even a request that would otherwise pass)', () => {
    const all = factsOf({ chooseDevices: 0, apGroupIds: [A] }, bindings([A]));
    const unknown = factsOf({ chooseDevices: 9 }, bindings([A]));
    for (const requested of [[A, B], [A], ['6512a0e1f3b2c41d2e3f4a00']]) {
      assert.deepEqual(planNetworkBindings(requested, all, fresh), { ok: false, error: 'scopeAllAccessPoints' });
      assert.deepEqual(planNetworkBindings(requested, unknown, fresh), { ok: false, error: 'scopeUnknown' });
    }
    assert.deepEqual(planNetworkBindings([], all, fresh), { ok: false, error: 'groupsRequired' }, 'the request rules come first');
  });

  test('every requested id must be in the FRESH AP-group list — kept ones included', () => {
    assert.deepEqual(planNetworkBindings([A, '6512a0e1f3b2c41d2e3f4a00'], boundTo([A]), fresh), { ok: false, error: 'groupNotFound' });
    // A is bound, but the fresh list no longer has it
    assert.deepEqual(planNetworkBindings([A, B], boundTo([A]), [group(B), group(C)]), { ok: false, error: 'groupNotFound' });
    assert.deepEqual(planNetworkBindings([B], boundTo([A]), [group(B), group(C)]), { ok: true, plan: { apGroupIds: [B], added: [B], removed: [A], kept: [] } });
  });

  test('the same set as the fresh bindings (any order, duplicates) is nothingToChange', () => {
    assert.deepEqual(planNetworkBindings([B, A, B], boundTo([A, B]), fresh), { ok: false, error: 'nothingToChange' });
  });

  test('capacity is checked for ADDED groups only: a full kept group passes; removals need no band data; additions with unknown bands are networkStateUnknown', () => {
    const tight = [group(A, { 0: 0, 1: 0 }), group(B, { 0: 0, 1: 2 }), group(C), group(D, { 0: 0, 1: 0 })];
    assert.deepEqual(planNetworkBindings([A, C], boundTo([A]), tight), { ok: true, plan: { apGroupIds: [A, C], added: [C], removed: [], kept: [A] } });
    assert.deepEqual(planNetworkBindings([A, B, D], boundTo([A]), tight), {
      ok: false,
      error: 'capacityInsufficient',
      diagnostic: 'capacity: 3 full, 0 unknown',
      capacityProblems: [
        { apGroupId: B, band: 'band2g', reason: 'full' },
        { apGroupId: D, band: 'band2g', reason: 'full' },
        { apGroupId: D, band: 'band5g', reason: 'full' }
      ]
    });
    const noBands = factsOf({ apGroupIds: [A, B], band: undefined }, bindings([A, B]));
    assert.equal(noBands.bands, null);
    assert.deepEqual(planNetworkBindings([A], noBands, tight), { ok: true, plan: { apGroupIds: [A], added: [], removed: [B], kept: [A] } });
    assert.deepEqual(planNetworkBindings([A, B, C], noBands, fresh), { ok: false, error: 'networkStateUnknown', diagnostic: 'bands unknown' });
    // The catalog's bands disagreeing with the detail's: unknown bands as well
    const disputed = factsOf({ apGroupIds: [A] }, bindings([A]), { catalog: { band: 7 } });
    assert.deepEqual(planNetworkBindings([A, B], disputed, fresh), { ok: false, error: 'networkStateUnknown', diagnostic: 'bands unknown' });
  }); // End of test "capacity is checked for ADDED groups only…"

  test('MLO: an unknown MLO state (absent, null, malformed) refuses additions only (networkStateUnknown "mlo unknown"); an MLO network can gain no group while MLO capacity is unknown; removals pass', () => {
    for (const value of [undefined, null, 'true', 1]) {
      const facts = factsOf({ apGroupIds: [A, B] }, bindings([A, B]), { mloEnable: value });
      assert.deepEqual(planNetworkBindings([A, B, C], facts, fresh), { ok: false, error: 'networkStateUnknown', diagnostic: 'mlo unknown' }, JSON.stringify(value));
      assert.deepEqual(planNetworkBindings([A], facts, fresh), { ok: true, plan: { apGroupIds: [A], added: [], removed: [B], kept: [A] } }, JSON.stringify(value));
    }
    // Unknown bands are reported first
    assert.deepEqual(planNetworkBindings([A, C], factsOf({ apGroupIds: [A], band: undefined }, bindings([A]), { mloEnable: 'x' }), fresh), {
      ok: false,
      error: 'networkStateUnknown',
      diagnostic: 'bands unknown'
    });
    // MLO on: every added group fails on MLO (no documented key), even with room on every band and an MLO-looking key
    const mlo = boundTo([A], 3, true);
    const roomy = [group(A), group(B, { 0: 5, 1: 5, 2: 5, 3: 5 }), group(C, { 0: 0, 1: 5 })];
    assert.deepEqual(planNetworkBindings([A, B, C], mlo, roomy), {
      ok: false,
      error: 'capacityInsufficient',
      diagnostic: 'capacity: 1 full, 2 unknown',
      capacityProblems: [
        { apGroupId: B, band: 'mlo', reason: 'unknown' },
        { apGroupId: C, band: 'band2g', reason: 'full' },
        { apGroupId: C, band: 'mlo', reason: 'unknown' }
      ]
    });
    assert.deepEqual(planNetworkBindings([B], boundTo([A, B], 3, true), roomy), { ok: true, plan: { apGroupIds: [B], added: [], removed: [A], kept: [B] } }, 'a removal needs no MLO capacity');
    // MLO off: the same additions pass on band capacity alone
    assert.deepEqual(planNetworkBindings([A, B], boundTo([A], 3, false), roomy), { ok: true, plan: { apGroupIds: [A, B], added: [B], removed: [], kept: [A] } });
  }); // End of test "MLO: an unknown MLO state…"
}); // End of the describe block for planNetworkBindings()

describe('The reply, the body and the client sanity check', () => {
  test('bindingRefusalReply() copies the code, the diagnostic and the problems — nothing else', () => {
    const problems = [{ apGroupId: A, band: 'band2g' as const, reason: 'full' as const }];
    const reply = bindingRefusalReply({ ok: false, error: 'capacityInsufficient', diagnostic: 'capacity: 1 full, 0 unknown', capacityProblems: problems });
    assert.deepEqual(reply, { success: false, error: 'capacityInsufficient', diagnostic: 'capacity: 1 full, 0 unknown', capacityProblems: problems });
    assert.notEqual(reply.capacityProblems, problems);
    assert.deepEqual(bindingRefusalReply({ ok: false, error: 'scopeUnknown' }), { success: false, error: 'scopeUnknown' });
  });

  test('buildBindingsBody() is exactly {apGroupIds}, a copy; isSaneBindingIds() wants distinct 24-hex ids, at least one', () => {
    const ids = [A, B];
    const body = buildBindingsBody(ids);
    assert.deepEqual(body, { apGroupIds: [A, B] });
    assert.notEqual(body.apGroupIds, ids);
    assert.equal(isSaneBindingIds([A, B]), true);
    for (const bad of [[], [A, A], ['bad'], [A, 1], A, null, undefined]) {
      assert.equal(isSaneBindingIds(bad), false, JSON.stringify(bad));
    }
  });
}); // End of the describe block for the reply and the body
