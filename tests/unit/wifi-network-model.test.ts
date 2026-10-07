// Tests for the Wi-Fi network read model (src/main/wifi-network-model.ts):
// the validators of the v2 SSID catalog entry, the v1 detail and the v1
// AP-group bindings (malformed payloads rejected: wrong types, missing or
// contradictory ids, non-array and mixed lists), the two id rules (SSID ids:
// a path-safe sanity rule; bound AP-group ids: 24 hex digits, one bad id
// dropping the whole list and making the scope unknown), the field reports and their
// combination (unknown, never a default "enabled" or "all"), the spec §5
// enable-field fallback, scope detection, `hasPassphrase`, and that the DTO is
// built by allowlist: no sentinel secret of the fixtures — in securityKey,
// PSK / PPSK / RADIUS settings, nested objects and arrays, unknown keys —
// reaches a validated value or the DTO.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AP_GROUP_ID_REGEX } from '../../src/main/ap-group-policy';
import {
  combine,
  decideHasPassphrase,
  decideScope,
  isApGroupId,
  isSsidId,
  MAX_NETWORK_NAME_LENGTH,
  toManagedNetwork,
  UNRECOGNIZED,
  validateOpenApiSsid,
  validateOpenApiSsidDetail,
  validateSsidBindings,
  type OpenApiSsid,
  type OpenApiSsidBindings,
  type OpenApiSsidDetail
} from '../../src/main/wifi-network-model';
import type { ManagedNetwork } from '../../src/shared/types';
import fixtures from '../fixtures/openapi/ssids.json';

const SSID_ID = fixtures.ssidId;
const [DEFAULT_ID, GROUP_B_ID, EMPTY_ID] = ['6512a0e1f3b2c41d2e3f4a5b', '6512a0e1f3b2c41d2e3f4a5c', '6512a0e1f3b2c41d2e3f4a5e'];
const DTO_KEYS = ['apGroupIds', 'bands', 'enabled', 'hasPassphrase', 'id', 'name', 'scope', 'security'];
// Strings that are not AP-group ids (24 hex digits): non-hex of the right
// length, one digit short, one too many, a name, empty, white space, dashes
const BAD_GROUP_IDS = [
  'zz'.repeat(12),
  DEFAULT_ID.slice(1),
  `${DEFAULT_ID}0`,
  'Corrupto',
  '',
  'bad id!',
  ` ${DEFAULT_ID}`,
  '6512a0e1-f3b2-c41d-2e3f4a5b'
];

/**
 * A JSON round trip (drops undefined values, like the IPC structured clone of
 * a DTO would show them), for comparisons with the JSON fixtures.
 * @param {unknown} value - The value.
 * @returns {unknown} The plain copy.
 */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Validates a catalog entry that must be valid.
 * @param {unknown} raw - The raw entry.
 * @returns {OpenApiSsid} The validated entry.
 */
function entryOf(raw: unknown): OpenApiSsid {
  const entry = validateOpenApiSsid(raw);
  assert.ok(entry, JSON.stringify(raw));
  return entry;
}

/**
 * Validates a detail that must be valid.
 * @param {unknown} raw - The raw `result`.
 * @param {string} [id] - The requested SSID id.
 * @returns {OpenApiSsidDetail} The validated detail.
 */
function detailOf(raw: unknown, id = SSID_ID): OpenApiSsidDetail {
  const detail = validateOpenApiSsidDetail(raw, id);
  assert.ok(detail, JSON.stringify(raw));
  return detail;
}

/**
 * Validates bindings that must be valid.
 * @param {unknown} raw - The raw `result`.
 * @returns {OpenApiSsidBindings} The validated bindings.
 */
function bindingsOf(raw: unknown): OpenApiSsidBindings {
  const bindings = validateSsidBindings(raw);
  assert.ok(bindings, JSON.stringify(raw));
  return bindings;
}

/**
 * Builds the DTO of one network from raw catalog / detail / bindings payloads.
 * @param {Record<string, unknown>} entry - Catalog entry fields (the id and name are added).
 * @param {Record<string, unknown>} detail - Detail fields (the id is added).
 * @param {unknown} [bindings] - The bindings `result` (default: not reported).
 * @returns {ManagedNetwork} The DTO.
 */
function network(entry: Record<string, unknown>, detail: Record<string, unknown>, bindings: unknown = {}): ManagedNetwork {
  return toManagedNetwork(entryOf({ id: SSID_ID, name: 'Casa', ...entry }), detailOf({ id: SSID_ID, ...detail }), bindingsOf(bindings));
}

describe('validateOpenApiSsid(): the v2 catalog entry', () => {
  test('the documented page: allowlisted reports, enable state from description (spec §5)', () => {
    assert.deepEqual(plain(fixtures.catalog.page.data.map(entryOf)), fixtures.catalog.expected);
  });

  test('valid entries (fixture cases): ssidEnable before description, text descriptions ignored, ssidId fallback, unrecognized values marked', () => {
    for (const { name, entry, expected } of fixtures.validators.catalogValid) {
      assert.deepEqual(plain(validateOpenApiSsid(entry)), expected, name);
    }
  });

  test('malformed entries are rejected: wrong types, missing / unusable / contradictory ids, missing or empty names', () => {
    for (const { name, entry } of fixtures.validators.catalogInvalid) {
      assert.equal(validateOpenApiSsid(entry), null, name);
    }
    const id = '5f00c0ffee0000000000c001';
    assert.ok(validateOpenApiSsid({ id, name: 'x'.repeat(MAX_NETWORK_NAME_LENGTH) }));
    assert.equal(validateOpenApiSsid({ id, name: 'x'.repeat(MAX_NETWORK_NAME_LENGTH + 1) }), null, 'over-long name');
    assert.equal(validateOpenApiSsid({ id: 'a'.repeat(129), name: 'Casa' }), null, 'over-long id');
    assert.equal(validateOpenApiSsid(Object.assign(Object.create(null), { id, name: 'Casa' }))?.id, id, 'a null-prototype object is still an object');
  });
}); // End of the describe block for the catalog entry

describe('validateOpenApiSsidDetail(): the v1 detail', () => {
  test('the documented detail: allowlisted reports plus hasSecurityKey, never the key', () => {
    const detail = detailOf(fixtures.detail.result);
    assert.deepEqual(plain(detail), fixtures.detail.expected);
    assert.ok(!JSON.stringify(detail).includes(fixtures.detail.result.pskSetting.securityKey));
  });

  test('hasSecurityKey only for a non-empty string securityKey inside a pskSetting object', () => {
    const cases: Array<[unknown, boolean]> = [
      [{ securityKey: 'x' }, true],
      [{ securityKey: '' }, false],
      [{ securityKey: 42 }, false],
      [{ securityKey: null }, false],
      [{}, false],
      [null, false],
      ['securityKey', false],
      [[{ securityKey: 'x' }], false]
    ];
    for (const [pskSetting, expected] of cases) {
      assert.equal(detailOf({ id: SSID_ID, pskSetting }).hasSecurityKey, expected, JSON.stringify(pskSetting));
    }
    assert.equal(detailOf({ id: SSID_ID, securityKey: 'top-level' }).hasSecurityKey, false, 'only pskSetting.securityKey counts');
  }); // End of test "hasSecurityKey only for a non-empty string..."

  test('malformed details are rejected: not an object, no id, another SSID, contradictory ids', () => {
    for (const { name, result } of fixtures.validators.detailInvalid) {
      assert.equal(validateOpenApiSsidDetail(result, SSID_ID), null, name);
    }
    assert.equal(detailOf({ ssidId: SSID_ID }).id, SSID_ID, 'the deprecated ssidId alone names it');
  });

  test('apGroupIds is kept whole or marked unrecognized (mixed list, non-array), never filtered; duplicates deduplicated', () => {
    assert.deepEqual(detailOf({ id: SSID_ID, apGroupIds: [DEFAULT_ID, DEFAULT_ID, GROUP_B_ID] }).apGroupIds, [DEFAULT_ID, GROUP_B_ID]);
    assert.deepEqual(detailOf({ id: SSID_ID, apGroupIds: [] }).apGroupIds, []);
    for (const apGroupIds of [[DEFAULT_ID, null], [42], [DEFAULT_ID, 'bad id'], DEFAULT_ID, { id: DEFAULT_ID }]) {
      assert.equal(detailOf({ id: SSID_ID, apGroupIds }).apGroupIds, UNRECOGNIZED, JSON.stringify(apGroupIds));
    }
    for (const bad of BAD_GROUP_IDS) {
      for (const apGroupIds of [[bad], [DEFAULT_ID, bad], [bad, GROUP_B_ID, DEFAULT_ID]]) {
        assert.equal(detailOf({ id: SSID_ID, apGroupIds }).apGroupIds, UNRECOGNIZED, `not 24 hex digits: ${JSON.stringify(apGroupIds)}`);
      }
    }
    assert.equal(detailOf({ id: SSID_ID, apGroupIds: null }).apGroupIds, undefined);
  });

  test('the detail\'s enable state: ssidEnable boolean, absent = not reported, anything else unrecognized', () => {
    assert.equal(detailOf({ id: SSID_ID, ssidEnable: false }).enabled, false);
    assert.equal(detailOf({ id: SSID_ID }).enabled, undefined);
    assert.equal(detailOf({ id: SSID_ID, ssidEnable: 'true' }).enabled, UNRECOGNIZED);
    assert.equal(detailOf({ id: SSID_ID, ssidEnable: 1 }).enabled, UNRECOGNIZED);
    assert.equal(detailOf({ id: SSID_ID, description: true }).enabled, undefined, 'the §5 description fallback is the catalog\'s');
  });
}); // End of the describe block for the detail

describe('validateSsidBindings(): the v1 AP-group bindings', () => {
  test('the documented answer: only the group ids, in answer order', () => {
    assert.deepEqual(bindingsOf(fixtures.bindings.result), fixtures.bindings.expected);
  });

  test('valid cases: empty list, duplicates, apGroups absent or null (not reported)', () => {
    for (const { name, result, expected } of fixtures.validators.bindingsValid) {
      assert.deepEqual(plain(validateSsidBindings(result)), expected, name);
    }
  });

  test('malformed answers are rejected whole: not an object, non-array lists, mixed lists, entries without a string id', () => {
    for (const { name, result } of fixtures.validators.bindingsInvalid) {
      assert.equal(validateSsidBindings(result), null, name);
    }
  });

  test('bound AP-group ids must be 24 hex digits: one non-hex, wrong-length or otherwise malformed id drops the WHOLE list (unrecognized), never filtered', () => {
    for (const bad of BAD_GROUP_IDS) {
      for (const ids of [[bad], [DEFAULT_ID, bad], [bad, GROUP_B_ID, DEFAULT_ID]]) {
        assert.deepEqual(validateSsidBindings({ apGroups: ids.map((id) => ({ id })) }), { apGroupIds: UNRECOGNIZED }, JSON.stringify(ids));
      }
    }
    assert.deepEqual(validateSsidBindings({ apGroups: [{ id: DEFAULT_ID.toUpperCase() }] }), { apGroupIds: [DEFAULT_ID.toUpperCase()] }, 'hex digits in either case');
  });
}); // End of the describe block for the bindings

describe('the two id rules: SSID ids vs bound AP-group ids', () => {
  test('SSID ids keep their own path-safe rule (the ops doc states no format; an SSID id never describes a scope); bound AP-group ids use the shared 24-hex rule', () => {
    for (const id of ['ssid_1', 'Casa-5G', 'a', 'x'.repeat(128), SSID_ID]) {
      assert.equal(isSsidId(id), true, id);
      assert.equal(validateOpenApiSsid({ id, name: 'Casa' })?.id, id, id);
    }
    for (const id of ['', '../x', 'a b', 'x'.repeat(129), 'a\n', 42, null, undefined]) {
      assert.equal(isSsidId(id), false, JSON.stringify(id));
    }
    for (const sample of [DEFAULT_ID, DEFAULT_ID.toUpperCase(), ...BAD_GROUP_IDS, 'ssid_1', SSID_ID]) {
      assert.equal(isApGroupId(sample), AP_GROUP_ID_REGEX.test(sample), sample);
    }
    assert.equal(isApGroupId(42), false);
    assert.equal(isApGroupId(null), false);
  }); // End of test "SSID ids keep their own path-safe rule..."
}); // End of the describe block for the id rules

describe('combine(): two sources, unknown unless they agree', () => {
  test('the rules', () => {
    /**
     * Equality of two numbers.
     * @param {number} a - One number.
     * @param {number} b - The other.
     * @returns {boolean} True when equal.
     */
    const same = (a: number, b: number): boolean => a === b;
    assert.equal(combine<number>(undefined, undefined, same), null, 'reported nowhere');
    assert.equal(combine<number>(1, undefined, same), 1);
    assert.equal(combine<number>(undefined, 1, same), 1);
    assert.equal(combine<number>(1, 1, same), 1);
    assert.equal(combine<number>(1, 2, same), null, 'contradiction');
    assert.equal(combine<number>(UNRECOGNIZED, 1, same), null, 'an unrecognized report poisons the field');
    assert.equal(combine<number>(1, UNRECOGNIZED, same), null);
    assert.equal(combine<number>(UNRECOGNIZED, undefined, same), null);
  }); // End of test "the rules"
}); // End of the describe block for combine()

describe('toManagedNetwork(): scope detection', () => {
  test('"All access points" only for chooseDevices 0; "N groups" for chooseDevices 1 with the bound ids', () => {
    const all = network({ chooseDevices: 0 }, { chooseDevices: 0 });
    assert.equal(all.scope, 'allAccessPoints');
    assert.equal(all.apGroupIds, null, 'bindings not reported');
    assert.equal(network({ chooseDevices: 0 }, {}, { apGroups: [{ id: DEFAULT_ID }] }).scope, 'allAccessPoints', 'the catalog alone may say so');
    const three = network({ chooseDevices: 1 }, { chooseDevices: 1, apGroupIds: [EMPTY_ID, DEFAULT_ID, GROUP_B_ID] }, { apGroups: [{ id: DEFAULT_ID }, { id: GROUP_B_ID }, { id: EMPTY_ID }] });
    assert.equal(three.scope, 'apGroups');
    assert.deepEqual(three.apGroupIds, [DEFAULT_ID, GROUP_B_ID, EMPTY_ID], 'the bindings answer\'s order; the detail agrees as a set');
    const none = network({ chooseDevices: 1 }, {}, { apGroups: [] });
    assert.equal(none.scope, 'apGroups');
    assert.deepEqual(none.apGroupIds, [], 'bound to no group: a known empty list');
  }); // End of test ""All access points" only for chooseDevices 0..."

  test('anything else is an explicit unknown scope — never "all"', () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, unknown]> = [
      ['not reported anywhere', {}, {}, { apGroups: [{ id: DEFAULT_ID }] }],
      ['an unrecognized value', { chooseDevices: 7 }, {}, { apGroups: [] }],
      ['a string "0"', { chooseDevices: '0' }, {}, { apGroups: [] }],
      ['an unrecognized detail value although the catalog says 0', { chooseDevices: 0 }, { chooseDevices: 2 }, {}],
      ['catalog and detail disagree', { chooseDevices: 0 }, { chooseDevices: 1 }, { apGroups: [] }],
      ['not all devices, but the bindings are not reported', { chooseDevices: 1 }, { chooseDevices: 1 }, {}],
      ['not all devices, bindings and detail apGroupIds disagree', { chooseDevices: 1 }, { apGroupIds: [DEFAULT_ID] }, { apGroups: [{ id: GROUP_B_ID }] }],
      ['not all devices, the detail apGroupIds is a mixed list', { chooseDevices: 1 }, { apGroupIds: [DEFAULT_ID, 42] }, { apGroups: [{ id: DEFAULT_ID }] }]
    ];
    for (const [label, entry, detail, bindings] of cases) {
      assert.equal(network(entry, detail, bindings).scope, 'unknown', label);
    }
    assert.equal(decideScope(null, [DEFAULT_ID]), 'unknown');
    assert.equal(decideScope('selected', null), 'unknown');
  }); // End of test "anything else is an explicit unknown scope..."

  test('malformed bound AP-group ids (non-hex, wrong length, one in a mixed list) make the scope unknown — in the bindings, the detail or both — never a filtered "N groups"', () => {
    for (const bad of BAD_GROUP_IDS) {
      const ids = [DEFAULT_ID, bad];
      const cases: Array<[string, Record<string, unknown>, unknown]> = [
        ['both', { apGroupIds: ids }, { apGroups: ids.map((id) => ({ id })) }],
        ['bindings only', {}, { apGroups: ids.map((id) => ({ id })) }],
        ['detail only', { apGroupIds: ids }, {}],
        ['detail only, valid bindings', { apGroupIds: ids }, { apGroups: [{ id: DEFAULT_ID }] }]
      ];
      for (const [where, detail, bindings] of cases) {
        const dto = network({ chooseDevices: 1 }, { chooseDevices: 1, ...detail }, bindings);
        assert.equal(dto.scope, 'unknown', `${where}: ${JSON.stringify(bad)}`);
        assert.equal(dto.apGroupIds, null, `${where}: ${JSON.stringify(bad)}`);
      }
    } // End of the loop over the malformed ids
  }); // End of test "malformed bound AP-group ids..."

  test('the bound ids: the detail\'s list when the bindings answer does not report one; unknown on any doubt', () => {
    assert.deepEqual(network({ chooseDevices: 1 }, { apGroupIds: [GROUP_B_ID] }, {}).apGroupIds, [GROUP_B_ID]);
    assert.equal(network({ chooseDevices: 1 }, { apGroupIds: [GROUP_B_ID] }, { apGroups: [{ id: DEFAULT_ID }] }).apGroupIds, null);
    assert.equal(network({ chooseDevices: 1 }, { apGroupIds: 'x' }, { apGroups: [{ id: DEFAULT_ID }] }).apGroupIds, null);
  });
}); // End of the describe block for scope detection

describe('toManagedNetwork(): enable state, security, bands, hasPassphrase', () => {
  test('enable state (spec §5): catalog ssidEnable, else catalog description, combined with the detail ssidEnable; unknown stays unknown', () => {
    assert.equal(network({ description: false }, {}).enabled, false, 'the description fallback');
    assert.equal(network({ ssidEnable: true, description: false }, {}).enabled, true, 'ssidEnable first');
    assert.equal(network({}, { ssidEnable: false }).enabled, false, 'the detail alone');
    assert.equal(network({ description: true }, { ssidEnable: true }).enabled, true, 'both agree');
    assert.equal(network({ description: true }, { ssidEnable: false }).enabled, null, 'contradiction: unknown, not "enabled"');
    assert.equal(network({}, {}).enabled, null, 'reported nowhere: unknown');
    assert.equal(network({ description: 'Red de casa' }, {}).enabled, null, 'a text description is not an enable state');
    assert.equal(network({ description: true }, { ssidEnable: 'yes' }).enabled, null, 'an unrecognized detail value: unknown');
  }); // End of test "enable state (spec §5)..."

  test('security: the documented modes; unrecognized or contradictory → "unknown"', () => {
    const modes: Array<[number, string]> = [[0, 'open'], [2, 'wpaEnterprise'], [3, 'wpaPersonal'], [4, 'ppskWithoutRadius'], [5, 'ppskWithRadius']];
    for (const [value, expected] of modes) {
      assert.equal(network({ security: value }, { security: value }).security, expected);
    }
    assert.equal(network({ security: 1 }, {}).security, 'unknown');
    assert.equal(network({ security: 3 }, { security: 0 }).security, 'unknown');
    assert.equal(network({}, {}).security, 'unknown');
  });

  test('bands: the bit mask 1–7 in canonical order; 0, higher bits, wrong types or a contradiction → null', () => {
    assert.deepEqual(network({ band: 1 }, {}).bands, ['band2g']);
    assert.deepEqual(network({ band: 6 }, { band: 6 }).bands, ['band5g', 'band6g']);
    assert.deepEqual(network({}, { band: 7 }).bands, ['band2g', 'band5g', 'band6g']);
    for (const [catalog, detail] of [[0, undefined], [8, undefined], [15, undefined], [2.5, undefined], ['3', undefined], [3, 1]]) {
      assert.equal(network({ band: catalog }, { band: detail }).bands, null, JSON.stringify([catalog, detail]));
    }
  });

  test('hasPassphrase: true for WPA-Personal with a reported key, null without (the detail may withhold it), false for open, null otherwise', () => {
    assert.equal(network({ security: 3 }, { pskSetting: { securityKey: 'k' } }).hasPassphrase, true);
    assert.equal(network({ security: 3 }, { pskSetting: {} }).hasPassphrase, null);
    assert.equal(network({ security: 0 }, {}).hasPassphrase, false);
    assert.equal(network({ security: 0 }, { pskSetting: { securityKey: 'k' } }).hasPassphrase, null, 'open, yet a key: contradiction');
    for (const security of [2, 4, 5, 1]) {
      assert.equal(network({ security }, { pskSetting: { securityKey: 'k' } }).hasPassphrase, null, String(security));
    }
    assert.equal(decideHasPassphrase('unknown', true), null);
  });
}); // End of the describe block for the field values

describe('toManagedNetwork(): allowlist only, no secret at any depth', () => {
  test('the documented triple gives exactly the eight DTO fields', () => {
    const dto = toManagedNetwork(entryOf(fixtures.catalog.page.data[0]), detailOf(fixtures.detail.result), bindingsOf(fixtures.bindings.result));
    assert.deepEqual(dto, {
      id: SSID_ID,
      name: 'Casa',
      security: 'wpaPersonal',
      bands: ['band2g', 'band5g'],
      enabled: true,
      hasPassphrase: true,
      scope: 'apGroups',
      apGroupIds: [DEFAULT_ID, GROUP_B_ID]
    });
    assert.deepEqual(Object.keys(dto).sort(), DTO_KEYS);
    assert.ok(!JSON.stringify(dto).includes(fixtures.detail.result.pskSetting.securityKey));
  }); // End of test "the documented triple gives exactly..."

  test('sentinel secrets (securityKey, PSK / PPSK / RADIUS settings, nested arrays and objects, unknown keys) reach neither the validated values nor the DTO', () => {
    const { entry, detail, bindings, expected } = fixtures.secrets;
    const validated = [entryOf(entry), detailOf(detail, entry.id), bindingsOf(bindings)] as const;
    for (const value of validated) {
      assert.ok(!JSON.stringify(value).includes('SENTINEL'), JSON.stringify(value));
    }
    const dto = toManagedNetwork(...validated);
    assert.deepEqual(dto, expected);
    assert.ok(!JSON.stringify(dto).includes('SENTINEL'));
    assert.deepEqual(Object.keys(dto).sort(), DTO_KEYS);
  }); // End of test "sentinel secrets (securityKey, PSK / PPSK / RADIUS settings..."

  test('defense in depth: raw payloads handed straight to the builder still give no secret, and insane reports become unknown', () => {
    const { entry, detail, bindings } = fixtures.secrets;
    const raw = toManagedNetwork(
      { ...entry, enabled: 'SENTINEL-enabled', security: 'SENTINEL-security', bands: ['SENTINEL-band'], deviceSelection: 'all' } as unknown as OpenApiSsid,
      { ...detail, hasSecurityKey: 'SENTINEL-flag', apGroupIds: ['SENTINEL id'] } as unknown as OpenApiSsidDetail,
      { ...bindings, apGroupIds: [{ id: 'SENTINEL' }] } as unknown as OpenApiSsidBindings
    );
    assert.ok(!JSON.stringify(raw).includes('SENTINEL'), JSON.stringify(raw));
    assert.deepEqual(raw, {
      id: entry.id,
      name: entry.name,
      security: 'unknown',
      bands: null,
      enabled: null,
      hasPassphrase: null,
      scope: 'allAccessPoints',
      apGroupIds: null
    });
    assert.throws(() => toManagedNetwork({ ...entryOf(entry), id: '../x' }, detailOf(detail, entry.id), bindingsOf(bindings)), TypeError);
    assert.throws(() => toManagedNetwork(entryOf(entry), detailOf({ id: SSID_ID }), bindingsOf(bindings)), TypeError, 'a detail of another network');
  }); // End of test "defense in depth..."
}); // End of the describe block for the allowlist
