// Fixture-driven tests for the Omada response validators
// (src/main/omada-validators.ts). Each fixture file under
// tests/fixtures/validators/ lists valid payloads with their expected
// normalized output and invalid payloads that must be rejected with the
// validator's "Unsupported API response (...)" error.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  validateAccessPoints,
  validateSitePage,
  validateWlanGroups,
} from '../../src/main/omada-validators';
import accessPointFixtures from '../fixtures/validators/access-points.json';
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
registerValidatorFixtures(siteFixtures, validateSitePage);

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
}); // End of the describe block "validator output independence"
