// Fixture-driven tests for the Omada response validators
// (src/main/omada-validators.ts). Each fixture file under
// tests/fixtures/validators/ lists valid payloads with their expected
// normalized output and invalid payloads that must be rejected with the
// validator's "Unsupported API response (...)" error. The group-list join
// (setting/wlans + setting/ssids) is tested against the 6.3 and legacy payload
// fixtures in tests/fixtures/controller/.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  joinGroupsWithSsids,
  validateAccessPoints,
  validateGroupList,
  validateSitePage,
  validateWlanGroups,
} from '../../src/main/omada-validators';
import groups63 from '../fixtures/controller/groups-6.3.json';
import groupsLegacy from '../fixtures/controller/groups-legacy.json';
import accessPointFixtures from '../fixtures/validators/access-points.json';
import groupListFixtures from '../fixtures/validators/group-list.json';
import siteFixtures from '../fixtures/validators/sites.json';
import wlanGroupFixtures from '../fixtures/validators/wlan-groups.json';

/**
 * Shape shared by every validator fixture file.
 */
interface ValidatorFixture {
  validator: string;
  error: string;
  valid: Array<{ name: string; result: unknown; expected: unknown }>;
  // `result` may be absent on purpose (the validator then receives undefined)
  invalid: Array<{ name: string; result?: unknown }>;
}

/**
 * Registers one describe block per validator: a test per valid case (deep
 * equality with the expected normalized output) and a test per invalid case
 * (must throw exactly the fixture's error message).
 * @param {unknown} rawFixture - The imported fixture JSON.
 * @param {(result: unknown) => unknown} validate - The validator under test.
 */
function registerValidatorFixtures(rawFixture: unknown, validate: (result: unknown) => unknown): void {
  const fixture = rawFixture as ValidatorFixture;

  describe(fixture.validator, () => {
    test('fixture has valid and invalid cases', () => {
      assert.ok(fixture.valid.length >= 1, 'at least one valid case');
      assert.ok(fixture.invalid.length >= 1, 'at least one invalid case');
    });

    for (const validCase of fixture.valid) {
      test(`accepts: ${validCase.name}`, () => {
        assert.deepEqual(validate(validCase.result), validCase.expected);
      });
    }

    for (const invalidCase of fixture.invalid) {
      test(`rejects: ${invalidCase.name}`, () => {
        assert.throws(() => validate(invalidCase.result), { message: fixture.error });
      });
    }
  }); // End of the describe block for one validator
} // End of function registerValidatorFixtures()

registerValidatorFixtures(accessPointFixtures, validateAccessPoints);
registerValidatorFixtures(wlanGroupFixtures, validateWlanGroups);
registerValidatorFixtures(groupListFixtures, validateGroupList);
registerValidatorFixtures(siteFixtures, validateSitePage);

/**
 * Validates a raw setting/wlans and setting/ssids `result` pair and joins
 * them, like OmadaController.getWlanGroups() does (minus the sorting).
 * @param {unknown} wlansResult - Raw `result` of setting/wlans.
 * @param {unknown} ssidsResult - Raw `result` of setting/ssids.
 * @returns {ReturnType<typeof joinGroupsWithSsids>} The join result.
 */
function join(wlansResult: unknown, ssidsResult: unknown): ReturnType<typeof joinGroupsWithSsids> {
  return joinGroupsWithSsids(validateGroupList(wlansResult), validateWlanGroups(ssidsResult));
}

describe('joinGroupsWithSsids (setting/wlans outer-joined with setting/ssids)', () => {
  test('6.3 payload: every listed group is kept in list order, SSID names joined by id, empty groups with no SSIDs', () => {
    const { groups } = join(groups63.wlans.result, groups63.ssids.result);
    assert.deepEqual(groups.map((group) => group.wlanName), ['Default', 'zGrupo B', 'zNinguna', 'CHICarpio']);
    // Same content as the controller's sorted expectation
    const byName = [...groups].sort((a, b) => a.wlanName.localeCompare(b.wlanName));
    assert.deepEqual(byName, groups63.expectedGroups);
  });

  test('empty groups (omitted by setting/ssids) are present with an empty SSID list', () => {
    const { groups } = join(groups63.wlans.result, groups63.ssids.result);
    assert.deepEqual(groups.find((group) => group.wlanName === 'zNinguna'), { wlanId: '6512a0e1f3b2c41d2e3f4a5e', wlanName: 'zNinguna', ssidList: [] });
    assert.deepEqual(groups.find((group) => group.wlanName === 'CHICarpio')?.ssidList, []);
  });

  test('a group with SSIDs carries their names in payload order', () => {
    const { groups } = join(groups63.wlans.result, groups63.ssids.result);
    assert.deepEqual(groups.find((group) => group.wlanName === 'Default')?.ssidList, [{ ssidName: 'Casa' }, { ssidName: 'Invitados' }]);
  });

  test('an SSID entry for a group id missing from setting/wlans is ignored and reported', () => {
    const { groups, ignoredSsidGroupIds } = join(groups63.wlans.result, groups63.ssids.result);
    assert.deepEqual(ignoredSsidGroupIds, ['6512a0e1f3b2c41d2e3fdead']);
    assert.equal(groups.some((group) => group.wlanName === 'Grupo borrado'), false);
    assert.equal(groups.some((group) => group.ssidList.some((ssid) => ssid.ssidName === 'Huérfana')), false);
  });

  test('a non-AP (gateway) setting/ssids entry is dropped before the join', () => {
    const { groups, ignoredSsidGroupIds } = join(groups63.wlans.result, groups63.ssids.result);
    assert.equal(groups.some((group) => group.ssidList.some((ssid) => ssid.ssidName === 'Gateway WiFi')), false);
    assert.equal(ignoredSsidGroupIds.includes('6512a0e1f3b2c41d2e3f9999'), false);
  });

  test('an SSID entry referencing no group (AP entry without wlanId) rejects the payload', () => {
    const ssids = { ssids: [...groups63.ssids.result.ssids, { wlanName: 'Sin grupo', deviceType: 'ap', ssidList: [{ ssidName: 'Suelta' }] }] };
    assert.throws(() => join(groups63.wlans.result, ssids), { message: 'Unsupported API response (WLANs)' });
  });

  test('a malformed group list rejects the payload (no silent shrinking)', () => {
    assert.throws(() => join(groups63.wlansMalformed.result, groups63.ssids.result), { message: 'Unsupported API response (groups)' });
    assert.throws(() => join({ ssids: [] }, groups63.ssids.result), { message: 'Unsupported API response (groups)' });
  });

  test('several setting/ssids entries for one group are concatenated; a blank list name falls back to the ssids name', () => {
    const { groups, ignoredSsidGroupIds } = joinGroupsWithSsids(
      [{ id: 'g1', name: '' }, { id: 'g2', name: 'Two' }],
      [
        { wlanId: 'g1', wlanName: 'One', ssidList: [{ ssidName: 'A' }] },
        { wlanId: 'gX', wlanName: 'Unknown', ssidList: [{ ssidName: 'X' }] },
        { wlanId: 'g1', wlanName: 'One again', ssidList: [{ ssidName: 'B' }] },
        { wlanId: 'gX', wlanName: 'Unknown', ssidList: [] },
      ]
    );
    assert.deepEqual(groups, [
      { wlanId: 'g1', wlanName: 'One', ssidList: [{ ssidName: 'A' }, { ssidName: 'B' }] },
      { wlanId: 'g2', wlanName: 'Two', ssidList: [] },
    ]);
    assert.deepEqual(ignoredSsidGroupIds, ['gX'], 'each ignored id reported once');
  }); // End of test "several setting/ssids entries for one group are concatenated..."

  test('legacy payload served by setting/wlans: the empty WLAN group is listed too', () => {
    const { groups } = join(groupsLegacy.wlans.result, groupsLegacy.ssids.result);
    const byName = [...groups].sort((a, b) => a.wlanName.localeCompare(b.wlanName));
    assert.deepEqual(byName, groupsLegacy.expectedJoinedGroups);
  });

  test('the joined groups share no objects with the validated inputs', () => {
    const list = [{ id: 'g1', name: 'One' }];
    const ssidGroups = [{ wlanId: 'g1', wlanName: 'One', ssidList: [{ ssidName: 'A' }] }];
    const [group] = joinGroupsWithSsids(list, ssidGroups).groups;
    assert.notEqual(group.ssidList, ssidGroups[0].ssidList);
    assert.notEqual(group.ssidList[0], ssidGroups[0].ssidList[0]);
  });
}); // End of the describe block for joinGroupsWithSsids

describe('validator output independence', () => {
  test('validateWlanGroups returns fresh SSID arrays (never the raw payload objects)', () => {
    const raw = { ssids: [{ wlanId: 'abc', wlanName: 'Default', ssidList: [{ ssidName: 'Casa', secret: 'x' }] }] };
    const [group] = validateWlanGroups(raw);
    assert.notEqual(group.ssidList, raw.ssids[0].ssidList);
    assert.deepEqual(group.ssidList, [{ ssidName: 'Casa' }]);
  });

  test('validateAccessPoints drops every field outside the AccessPoint DTO', () => {
    const [ap] = validateAccessPoints([{ type: 'ap', mac: 'AA-BB-CC-00-11-22', name: 'EAP', ip: '192.0.2.1', password: 'x' }]);
    assert.deepEqual(Object.keys(ap).sort(), ['mac', 'name', 'statusCategory', 'type', 'wlanGroup']);
  });

  test('validateGroupList keeps only the id and the name', () => {
    const [group] = validateGroupList(groups63.wlans.result);
    assert.deepEqual(Object.keys(group).sort(), ['id', 'name']);
  });
}); // End of the describe block "validator output independence"
