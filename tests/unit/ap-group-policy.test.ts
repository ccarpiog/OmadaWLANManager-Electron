// Tests for the AP-group management rules (src/main/ap-group-policy.ts): the
// name rules (trim, 1–128 UTF-16 code units, refused characters), the
// case-insensitive name-conflict rule, every delete-policy refusal and its
// precedence, and the renderer DTO (only known fields, bands mapped from the
// documented remainingBinding keys, never invented).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AP_GROUP_ID_REGEX,
  apGroupNameKey,
  checkApGroupDeletion,
  hasApGroupNameConflict,
  MAX_AP_GROUP_NAME_LENGTH,
  toApGroupSsidLimits,
  toBandValues,
  toManagedApGroup,
  validateApGroupName,
  type PolicyApGroup
} from '../../src/main/ap-group-policy';

const GROUPS = [
  { id: '6512a0e1f3b2c41d2e3f4a5b', name: 'Default' },
  { id: '6512a0e1f3b2c41d2e3f4a5c', name: 'Aulas' },
  { id: '6512a0e1f3b2c41d2e3f4a5e', name: 'Café' }
];

describe('validateApGroupName()', () => {
  test('trims and accepts 1–128 characters', () => {
    assert.deepEqual(validateApGroupName('  Aulas planta 2 \n'), { ok: true, name: 'Aulas planta 2' });
    assert.deepEqual(validateApGroupName('x'), { ok: true, name: 'x' });
    assert.deepEqual(validateApGroupName('x'.repeat(MAX_AP_GROUP_NAME_LENGTH)), { ok: true, name: 'x'.repeat(128) });
    assert.deepEqual(validateApGroupName(`  ${'x'.repeat(128)}  `), { ok: true, name: 'x'.repeat(128) });
    assert.deepEqual(validateApGroupName('Sala de profesores — 1ª planta 📶'), { ok: true, name: 'Sala de profesores — 1ª planta 📶' });
  });

  test('blank after trimming is nameRequired', () => {
    for (const name of ['', '   ', '\t\n', '\u{00a0}\u{3000}']) {
      assert.deepEqual(validateApGroupName(name), { ok: false, error: 'nameRequired' }, JSON.stringify(name));
    }
  });

  test('over 128 UTF-16 code units is nameTooLong (an emoji counts as two)', () => {
    assert.deepEqual(validateApGroupName('x'.repeat(129)), { ok: false, error: 'nameTooLong' });
    assert.deepEqual(validateApGroupName('📶'.repeat(64)), { ok: true, name: '📶'.repeat(64) });
    assert.deepEqual(validateApGroupName(`${'📶'.repeat(64)}x`), { ok: false, error: 'nameTooLong' });
  });

  test('control characters, unpaired surrogates, line separators and bidirectional controls are nameInvalid', () => {
    const refused = ['Aulas\tB', 'Aulas\nB', 'A\u0000B', 'A\u007fB', 'A\u0085B', 'A\u{2028}B', 'A\u{2029}B', 'A\u{202e}B', 'A\u{2066}B', 'A\u{200f}B', 'A\u{061c}B', 'A\ud800B', 'A\udc00B'];
    for (const name of refused) {
      assert.deepEqual(validateApGroupName(name), { ok: false, error: 'nameInvalid' }, JSON.stringify(name));
    }
  });
}); // End of the describe block for validateApGroupName()

describe('name conflicts (same-named groups cannot be move targets)', () => {
  test('apGroupNameKey(): trimmed, NFC and lower-cased', () => {
    assert.equal(apGroupNameKey('  AULAS '), 'aulas');
    assert.equal(apGroupNameKey('Café'), apGroupNameKey('Café'));
  });

  test('another group with the same name — in any case or normalization — is a conflict; the renamed group itself is not', () => {
    assert.equal(hasApGroupNameConflict('aulas', GROUPS), true);
    assert.equal(hasApGroupNameConflict('DEFAULT', GROUPS), true);
    assert.equal(hasApGroupNameConflict('Café', GROUPS), true);
    assert.equal(hasApGroupNameConflict('Aulas 2', GROUPS), false);
    assert.equal(hasApGroupNameConflict('AULAS', GROUPS, '6512a0e1f3b2c41d2e3f4a5c'), false, 'a case-only rename of the group itself');
    assert.equal(hasApGroupNameConflict('Default', GROUPS, '6512a0e1f3b2c41d2e3f4a5c'), true);
    assert.equal(hasApGroupNameConflict('x', []), false);
  });
}); // End of the describe block for name conflicts

describe('checkApGroupDeletion() — the app policy on fresh data', () => {
  const empty: PolicyApGroup = { id: '6512a0e1f3b2c41d2e3f4a5e', name: 'zNinguna', apNum: 0, ssidNameList: [] };

  test('an existing, non-default group with 0 APs and no networks may be deleted', () => {
    assert.equal(checkApGroupDeletion(empty), null);
  });

  test('each refusal: not listed, default, APs, networks, unknown AP count or network list', () => {
    assert.equal(checkApGroupDeletion(undefined), 'groupNotFound');
    assert.equal(checkApGroupDeletion({ ...empty, isDefault: true }), 'groupIsDefault');
    assert.equal(checkApGroupDeletion({ ...empty, apNum: 1 }), 'groupNotEmpty');
    assert.equal(checkApGroupDeletion({ ...empty, ssidNameList: ['Casa'] }), 'groupHasNetworks');
    assert.equal(checkApGroupDeletion({ ...empty, ssidNameList: [''] }), 'groupHasNetworks', 'any bound entry counts');
    assert.equal(checkApGroupDeletion({ id: empty.id, name: empty.name, ssidNameList: [] }), 'groupStateUnknown');
    assert.equal(checkApGroupDeletion({ id: empty.id, name: empty.name, apNum: 0 }), 'groupStateUnknown');
    assert.equal(checkApGroupDeletion({ id: empty.id, name: empty.name }), 'groupStateUnknown');
  });

  test('fail closed: an insane network list or AP count is unknown, never "no networks" or 0 (groupStateUnknown)', () => {
    // Unvalidated input (the smoke stub feeds the policy directly): cast past the type
    const insane = (fields: Record<string, unknown>): PolicyApGroup => ({ ...empty, ...fields }) as unknown as PolicyApGroup;
    for (const ssidNameList of [[null], [42], 'x', ['Casa', null], [undefined], {}]) {
      assert.equal(checkApGroupDeletion(insane({ ssidNameList })), 'groupStateUnknown', JSON.stringify(ssidNameList));
    }
    for (const apNum of ['0', -1, 1.5, null, true, Number.NaN]) {
      assert.equal(checkApGroupDeletion(insane({ apNum })), 'groupStateUnknown', String(apNum));
    }
    // A known reason still wins over an unknown list
    assert.equal(checkApGroupDeletion(insane({ apNum: 2, ssidNameList: [null] })), 'groupNotEmpty');
    assert.equal(checkApGroupDeletion(insane({ isDefault: true, ssidNameList: [42] })), 'groupIsDefault');
  }); // End of test "fail closed: an insane network list or AP count..."

  test('the most specific reason wins: default > APs > networks > unknown', () => {
    assert.equal(checkApGroupDeletion({ ...empty, isDefault: true, apNum: 3, ssidNameList: ['Casa'] }), 'groupIsDefault');
    assert.equal(checkApGroupDeletion({ ...empty, apNum: 3, ssidNameList: ['Casa'] }), 'groupNotEmpty');
    assert.equal(checkApGroupDeletion({ id: empty.id, name: empty.name, ssidNameList: ['Casa'] }), 'groupHasNetworks');
    assert.equal(checkApGroupDeletion({ id: empty.id, name: empty.name, apNum: 2 }), 'groupNotEmpty');
  });
}); // End of the describe block for checkApGroupDeletion()

describe('the renderer DTO', () => {
  test('toManagedApGroup(): id, name, default flag; AP count, networks and per-band capacity only when known', () => {
    assert.deepEqual(
      toManagedApGroup({
        id: '6512a0e1f3b2c41d2e3f4a5b',
        name: 'Default',
        isDefault: true,
        apNum: 4,
        ssidNameList: ['Casa', 'Invitados'],
        remainingBinding: { '0': 6, '1': 5, '2': 8 }
      }),
      { id: '6512a0e1f3b2c41d2e3f4a5b', name: 'Default', isDefault: true, apCount: 4, networkNames: ['Casa', 'Invitados'], remainingBinding: { band2g: 6, band5g: 5, band6g: 8 } }
    );
    assert.deepEqual(toManagedApGroup({ id: 'g1', name: '' }), { id: 'g1', name: '', isDefault: false });
  }); // End of test "toManagedApGroup(): id, name, default flag; AP..."

  test('toManagedApGroup(): an insane network list is left out whole, never shortened to the string entries', () => {
    for (const ssidNameList of [[null], [42], ['Casa', null], 'Casa']) {
      const group = { id: 'g1', name: 'A', apNum: 0, ssidNameList } as unknown as PolicyApGroup;
      assert.deepEqual(toManagedApGroup(group), { id: 'g1', name: 'A', isDefault: false, apCount: 0 }, JSON.stringify(ssidNameList));
    }
    assert.deepEqual(toManagedApGroup({ id: 'g1', name: 'A', ssidNameList: [] }), { id: 'g1', name: 'A', isDefault: false, networkNames: [] });
  });

  test('unknown remainingBinding keys and insane values are left out; nothing known → absent', () => {
    assert.deepEqual(toBandValues({ '0': 2, mlo: 4, '3': 1, '1': -1, '2': 1.5 }), { band2g: 2 });
    assert.equal(toBandValues({ mlo: 4 }), undefined);
    assert.equal(toBandValues(undefined), undefined);
    assert.deepEqual(toManagedApGroup({ id: 'g1', name: 'A', remainingBinding: { mlo: 4 } }), { id: 'g1', name: 'A', isDefault: false });
  });

  test('toApGroupSsidLimits(): sane counts only; none → undefined', () => {
    assert.deepEqual(toApGroupSsidLimits({ band2g: 8, band5g: 8, band6g: 8, mlo: 4 }), { band2g: 8, band5g: 8, band6g: 8, mlo: 4 });
    assert.deepEqual(toApGroupSsidLimits({ band2g: -1, band5g: 2.5, mlo: 0 }), { mlo: 0 });
    assert.equal(toApGroupSsidLimits({}), undefined);
    assert.equal(toApGroupSsidLimits(undefined), undefined);
  });

  test('AP_GROUP_ID_REGEX: exactly 24 hex digits', () => {
    for (const id of ['6512a0e1f3b2c41d2e3f4a5b', '6512A0E1F3B2C41D2E3F4A5B']) {
      assert.ok(AP_GROUP_ID_REGEX.test(id), id);
    }
    for (const id of ['', '6512a0e1f3b2c41d2e3f4a5', '6512a0e1f3b2c41d2e3f4a5bc', '6512a0e1f3b2c41d2e3f4a5g', 'bad id!', '../6512a0e1f3b2c41d2e3f']) {
      assert.equal(AP_GROUP_ID_REGEX.test(id), false, id);
    }
  });
}); // End of the describe block for the renderer DTO
