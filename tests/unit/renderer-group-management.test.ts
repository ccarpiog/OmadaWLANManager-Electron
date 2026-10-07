// Tests for the pure AP group management logic of the renderer
// (src/renderer/group-management.ts, a DOM-free module; phase 16b): the
// mirror of the main-side rules (writable ids, the name check) checked
// against src/main/ap-group-policy.ts itself, Delete hidden for the default
// group and why it is unavailable for the others, the per-band capacity rows
// ("not reported" stays absent) and the Capacity warning badge's bands
// (a reported 0 only, never an absent value), the boundary
// validation of the AP-group replies, the message key of every error code,
// and how a created group is found again after the reload.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AP_GROUP_ID_REGEX,
  checkApGroupDeletion,
  hasApGroupNameConflict,
  MAX_AP_GROUP_NAME_LENGTH,
  validateApGroupName,
  type PolicyApGroup,
} from '../../src/main/ap-group-policy';
import type { ApGroupOperationError, ManagedApGroup } from '../../src/shared/types';
import {
  capacityRows,
  capacityText,
  checkGroupName,
  deleteBlockKey,
  deleteBlocks,
  findCreatedGroupId,
  fullCapacityBands,
  groupErrorKey,
  isApGroupOperationError,
  isStaleDataFailure,
  isWritableGroupId,
  MAX_GROUP_NAME_LENGTH,
  parseGroupActionResult,
  parseManagedGroupsResult,
  WRITABLE_GROUP_ID_REGEX,
  type DeleteBlock,
  type DeleteInput,
  type NamedGroup,
} from '../../src/renderer/group-management';

// Every ApGroupOperationError main can answer with (src/shared/types.ts)
const ERRORS: ApGroupOperationError[] = [
  'notConnected',
  'superseded',
  'managementUnavailable',
  'nameRequired',
  'nameTooLong',
  'nameInvalid',
  'nameTaken',
  'nameUnchanged',
  'groupNotFound',
  'groupIsDefault',
  'groupNotEmpty',
  'groupHasNetworks',
  'groupStateUnknown',
  'groupLimitReached',
  'groupListIncomplete',
  'requestFailed',
];

// The groups on screen in the name tests
const GROUPS: NamedGroup[] = [
  { id: '6512a0e1f3b2c41d2e3f4a5b', name: 'Default' },
  { id: '6512a0e1f3b2c41d2e3f4a5c', name: 'Café' },
  { id: '6512a0e1f3b2c41d2e3f4a5d', name: 'Exterior' },
];

/**
 * Builds a delete input: a non-default group whose fresh view reports no
 * APs and no networks, with the given fields overridden.
 * @param {Partial<DeleteInput>} [overrides] - Fields to set.
 * @returns {DeleteInput} The input.
 */
function deleteInput(overrides: Partial<DeleteInput> = {}): DeleteInput {
  return {
    managed: { id: GROUPS[2].id, name: 'Exterior', isDefault: false, apCount: 0, networkNames: [] },
    managedStatus: 'ready',
    isDefault: false,
    apCount: 0,
    networkCount: 0,
    ...overrides,
  };
}

/**
 * The main-side policy view of a renderer DTO (what main's fresh read would
 * hold for the same group).
 * @param {ManagedApGroup} group - The DTO.
 * @returns {PolicyApGroup} The policy view.
 */
function policyView(group: ManagedApGroup): PolicyApGroup {
  const view: PolicyApGroup = { id: group.id, name: group.name };
  if (group.isDefault) view.isDefault = true;
  if (group.apCount !== undefined) view.apNum = group.apCount;
  if (group.networkNames !== undefined) view.ssidNameList = group.networkNames;
  return view;
}

describe('writable group ids (mirror of the main-side id rule)', () => {
  test('24 hex digits only, like AP_GROUP_ID_REGEX in ap-group-policy.ts', () => {
    const samples = ['6512a0e1f3b2c41d2e3f4a5b', '6512A0E1F3B2C41D2E3F4A5B', '6512a0e1f3b2c41d2e3f4a5', '6512a0e1f3b2c41d2e3f4a5bc', 'legacy_group_01', 'zzzzzzzzzzzzzzzzzzzzzzzz', '', 'bad id!'];
    for (const sample of samples) {
      assert.equal(isWritableGroupId(sample), AP_GROUP_ID_REGEX.test(sample), sample);
    }
    assert.equal(WRITABLE_GROUP_ID_REGEX.source, AP_GROUP_ID_REGEX.source);
    assert.equal(isWritableGroupId('legacy_group_01'), false);
    assert.equal(isWritableGroupId('6512a0e1f3b2c41d2e3f4a5b'), true);
  });
});

describe('checkGroupName (mirror of the main-side name rules)', () => {
  test('the length cap is main\'s', () => {
    assert.equal(MAX_GROUP_NAME_LENGTH, MAX_AP_GROUP_NAME_LENGTH);
  });

  test('blank, length and character rules agree with validateApGroupName() on every sample', () => {
    const samples = [
      '', '   ', '\t\n', 'a', ' padded ', 'x'.repeat(128), 'x'.repeat(129), ` ${'y'.repeat(128)} `, 'tab\there', 'line\nbreak', 'del\u007f',
      'c1\u0085', '‎LRM', 'RLM‏', 'ALM؜', 'over‮ride', 'iso⁦late', 'sep ', 'para ', 'lone\ud800', 'ok 😀 emoji',
      'Grupo — aulas', 'Café', 'zero​width',
    ];
    for (const sample of samples) {
      const main = validateApGroupName(sample);
      const renderer = checkGroupName(sample, []);
      assert.deepEqual(renderer, main, JSON.stringify(sample));
    }
  });

  test('a name another group has is refused case-insensitively and after NFC, like hasApGroupNameConflict()', () => {
    for (const name of ['DEFAULT', 'default', ' Default ', 'Café', 'CAFÉ', 'exterior']) {
      assert.deepEqual(checkGroupName(name, GROUPS), { ok: false, error: 'nameTaken' }, name);
      assert.equal(hasApGroupNameConflict(name.trim(), GROUPS), true, name);
    }
    assert.deepEqual(checkGroupName('  Grupo nuevo  ', GROUPS), { ok: true, name: 'Grupo nuevo' });
    assert.equal(hasApGroupNameConflict('Grupo nuevo', GROUPS), false);
  });

  test('a rename to the same name (after trimming) is unchanged; a case change of its own name is allowed; another group\'s name is taken', () => {
    const renaming = GROUPS[2];
    assert.deepEqual(checkGroupName('Exterior', GROUPS, renaming), { ok: false, error: 'nameUnchanged' });
    assert.deepEqual(checkGroupName('  Exterior ', GROUPS, renaming), { ok: false, error: 'nameUnchanged' });
    assert.deepEqual(checkGroupName('EXTERIOR', GROUPS, renaming), { ok: true, name: 'EXTERIOR' });
    assert.equal(hasApGroupNameConflict('EXTERIOR', GROUPS, renaming.id), false);
    assert.deepEqual(checkGroupName('default', GROUPS, renaming), { ok: false, error: 'nameTaken' });
    assert.deepEqual(checkGroupName('Jardín', GROUPS, renaming), { ok: true, name: 'Jardín' });
  });

  test('the length and character rules come before the duplicate and unchanged rules', () => {
    assert.deepEqual(checkGroupName('', GROUPS, GROUPS[0]), { ok: false, error: 'nameRequired' });
    assert.deepEqual(checkGroupName('x'.repeat(129), GROUPS), { ok: false, error: 'nameTooLong' });
    assert.deepEqual(checkGroupName('Default‮', GROUPS), { ok: false, error: 'nameInvalid' });
  });
});

describe('deleteBlocks (Delete hidden for the default group; why it is unavailable for the others)', () => {
  test('a group the fresh view and the internal data both report empty, unbound and not default may be deleted', () => {
    assert.deepEqual(deleteBlocks(deleteInput()), []);
  });

  test('the default group, flagged by either source: Delete is hidden (null), not disabled with a reason (spec §4.4)', () => {
    assert.equal(deleteBlocks(deleteInput({ isDefault: true, apCount: 4, networkCount: 2 })), null);
    assert.equal(deleteBlocks(deleteInput({ isDefault: true })), null);
    const managed: ManagedApGroup = { id: GROUPS[0].id, name: 'Default', isDefault: true, apCount: 0, networkNames: [] };
    assert.equal(deleteBlocks(deleteInput({ managed })), null);
    assert.equal(deleteBlocks(deleteInput({ managed, managedStatus: 'loading' })), null);
    // Every other group gets a list (possibly empty: Delete enabled)
    assert.deepEqual(deleteBlocks(deleteInput({ isDefault: false })), []);
  });

  test('APs and networks, from the fresh view or the internal data, each named', () => {
    assert.deepEqual(deleteBlocks(deleteInput({ apCount: 1 })), ['groupNotEmpty']);
    assert.deepEqual(deleteBlocks(deleteInput({ managed: { id: 'x', name: 'x', isDefault: false, apCount: 2, networkNames: [] } })), ['groupNotEmpty']);
    assert.deepEqual(deleteBlocks(deleteInput({ networkCount: 3 })), ['groupHasNetworks']);
    assert.deepEqual(deleteBlocks(deleteInput({ managed: { id: 'x', name: 'x', isDefault: false, apCount: 0, networkNames: ['Casa'] } })), ['groupHasNetworks']);
    assert.deepEqual(deleteBlocks(deleteInput({ apCount: 1, networkCount: 5 })), ['groupNotEmpty', 'groupHasNetworks']);
  });

  test('fails closed: still reading, not read, read but not listed, or an AP count / network list not reported', () => {
    assert.deepEqual(deleteBlocks(deleteInput({ managed: undefined, managedStatus: 'loading' })), ['deleteChecking']);
    assert.deepEqual(deleteBlocks(deleteInput({ managed: undefined, managedStatus: 'idle' })), ['deleteChecking']);
    assert.deepEqual(deleteBlocks(deleteInput({ managed: undefined, managedStatus: 'failed' })), ['groupStateUnknown']);
    assert.deepEqual(deleteBlocks(deleteInput({ managed: undefined, managedStatus: 'ready' })), ['groupStateUnknown']);
    assert.deepEqual(deleteBlocks(deleteInput({ managed: { id: 'x', name: 'x', isDefault: false, networkNames: [] } })), ['groupStateUnknown']);
    assert.deepEqual(deleteBlocks(deleteInput({ managed: { id: 'x', name: 'x', isDefault: false, apCount: 0 } })), ['groupStateUnknown']);
  });

  test('a name another group shares (internal AP count unknown) does not block when the fresh view counts the group empty by id', () => {
    assert.deepEqual(deleteBlocks(deleteInput({ apCount: null })), []);
  });

  test('never offers a delete main\'s policy would refuse on the same fresh data', () => {
    const cases: ManagedApGroup[] = [
      { id: 'a', name: 'a', isDefault: true, apCount: 0, networkNames: [] },
      { id: 'b', name: 'b', isDefault: false, apCount: 3, networkNames: [] },
      { id: 'c', name: 'c', isDefault: false, apCount: 0, networkNames: ['Casa'] },
      { id: 'd', name: 'd', isDefault: false, networkNames: [] },
      { id: 'e', name: 'e', isDefault: false, apCount: 0 },
      { id: 'f', name: 'f', isDefault: false, apCount: 0, networkNames: [] },
    ];
    for (const managed of cases) {
      const blocks = deleteBlocks(deleteInput({ managed }));
      const offered = blocks !== null && blocks.length === 0;
      assert.equal(offered, checkApGroupDeletion(policyView(managed)) === null, managed.id);
    }
  });

  test('every block has its own message key (none for the default group: its Delete is hidden)', () => {
    const blocks: DeleteBlock[] = ['groupNotEmpty', 'groupHasNetworks', 'groupStateUnknown', 'deleteChecking'];
    const keys = blocks.map(deleteBlockKey);
    assert.equal(new Set(keys).size, blocks.length);
    assert.deepEqual(keys, ['deleteBlockedNotEmpty', 'deleteBlockedHasNetworks', 'deleteBlockedUnknown', 'deleteBlockedChecking']);
  });
});

describe('capacity rows', () => {
  test('one row per band (2.4 / 5 / 6 GHz, MLO) with the remaining capacity and the limit; MLO never reports a remaining value', () => {
    const managed: ManagedApGroup = { id: 'a', name: 'a', isDefault: false, remainingBinding: { band2g: 3, band5g: 0, band6g: 8 } };
    assert.deepEqual(capacityRows(managed, { band2g: 8, band5g: 8, band6g: 8, mlo: 4 }), [
      { band: 'band2g', remaining: 3, limit: 8 },
      { band: 'band5g', remaining: 0, limit: 8 },
      { band: 'band6g', remaining: 8, limit: 8 },
      { band: 'mlo', remaining: null, limit: 4 },
    ]);
  });

  test('absent values stay absent (null), never invented', () => {
    const managed: ManagedApGroup = { id: 'a', name: 'a', isDefault: false, remainingBinding: { band2g: 7 } };
    assert.deepEqual(capacityRows(managed, { band2g: 8, band5g: 8 }), [
      { band: 'band2g', remaining: 7, limit: 8 },
      { band: 'band5g', remaining: null, limit: 8 },
      { band: 'band6g', remaining: null, limit: null },
      { band: 'mlo', remaining: null, limit: null },
    ]);
    assert.ok(capacityRows(undefined, null).every(row => row.remaining === null && row.limit === null));
  });

  test('the text of each case: "R of L free", "R free", "Not reported (limit L)", "Not reported"', () => {
    assert.deepEqual(capacityText({ band: 'band2g', remaining: 3, limit: 8 }), { key: 'capacityFreeOf', vars: { remaining: '3', limit: '8' } });
    assert.deepEqual(capacityText({ band: 'band2g', remaining: 0, limit: null }), { key: 'capacityFree', vars: { remaining: '0' } });
    assert.deepEqual(capacityText({ band: 'mlo', remaining: null, limit: 4 }), { key: 'capacityNotReportedLimit', vars: { limit: '4' } });
    assert.deepEqual(capacityText({ band: 'band6g', remaining: null, limit: null }), { key: 'capacityNotReported', vars: {} });
  });
});

describe('fullCapacityBands (the master list\'s Capacity warning badge)', () => {
  test('a band whose reported remaining capacity is 0 triggers it; the bands are named in display order', () => {
    assert.deepEqual(fullCapacityBands({ id: 'a', name: 'a', isDefault: false, remainingBinding: { band2g: 3, band5g: 0, band6g: 8 } }), ['band5g']);
    assert.deepEqual(fullCapacityBands({ id: 'a', name: 'a', isDefault: false, remainingBinding: { band6g: 0, band2g: 0, band5g: 1 } }), ['band2g', 'band6g']);
    assert.deepEqual(fullCapacityBands({ id: 'a', name: 'a', isDefault: false, remainingBinding: { band2g: 0, band5g: 0, band6g: 0 } }), ['band2g', 'band5g', 'band6g']);
  });

  test('room left on every reported band (1 is enough): no warning', () => {
    assert.deepEqual(fullCapacityBands({ id: 'a', name: 'a', isDefault: false, remainingBinding: { band2g: 1, band5g: 1, band6g: 1 } }), []);
    assert.deepEqual(fullCapacityBands({ id: 'a', name: 'a', isDefault: true, apCount: 9, networkNames: ['Casa'], remainingBinding: { band2g: 6 } }), []);
  });

  test('absent values never trigger it (never invented): no remainingBinding, a partial one, or no fresh view at all', () => {
    assert.deepEqual(fullCapacityBands({ id: 'a', name: 'a', isDefault: false }), []);
    assert.deepEqual(fullCapacityBands({ id: 'a', name: 'a', isDefault: false, remainingBinding: {} }), []);
    assert.deepEqual(fullCapacityBands({ id: 'a', name: 'a', isDefault: false, remainingBinding: { band2g: 7 } }), []);
    assert.deepEqual(fullCapacityBands({ id: 'a', name: 'a', isDefault: false, remainingBinding: { band5g: 0 } }), ['band5g']);
    assert.deepEqual(fullCapacityBands(undefined), []);
  });

  test('values the boundary validation drops (negative, fractional, not a number) never reach it: such a group gets no warning', () => {
    const parsed = parseManagedGroupsResult({
      success: true,
      groups: [
        { id: 'a1', name: 'Raro', isDefault: false, remainingBinding: { band2g: -1, band5g: 0.5, band6g: '0', mlo: 0 } },
        { id: 'b2', name: 'Lleno', isDefault: false, remainingBinding: { band2g: 0, band5g: 4 } },
      ],
    });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.groups.map(fullCapacityBands), [[], ['band2g']]);
  });

  test('consistent with the detail\'s capacity section: exactly the rows reporting 0 remaining, whatever the limits', () => {
    const managed: ManagedApGroup = { id: 'a', name: 'a', isDefault: false, remainingBinding: { band2g: 0, band6g: 2 } };
    for (const limits of [null, { band2g: 8, band5g: 8, band6g: 8, mlo: 4 }, { band5g: 0 }]) {
      const fromRows = capacityRows(managed, limits).filter(row => row.remaining === 0).map(row => row.band);
      assert.deepEqual(fullCapacityBands(managed), fromRows);
    }
  });
});

describe('error codes', () => {
  test('every ApGroupOperationError and the renderer\'s own "failed" has its own message key', () => {
    const keys = [...ERRORS, 'failed' as const].map(groupErrorKey);
    assert.equal(new Set(keys).size, ERRORS.length + 1);
    assert.ok(keys.every(key => key.startsWith('apGroupError')));
  });

  test('isApGroupOperationError() knows main\'s codes only', () => {
    for (const code of ERRORS) {
      assert.equal(isApGroupOperationError(code), true, code);
    }
    for (const other of ['failed', 'toString', '__proto__', 'NameTaken', '', 42, null, undefined]) {
      assert.equal(isApGroupOperationError(other), false, String(other));
    }
  });

  test('the refusals that mean the data on screen is stale', () => {
    const stale = ERRORS.filter(isStaleDataFailure);
    assert.deepEqual(stale, ['nameTaken', 'groupNotFound', 'groupIsDefault', 'groupNotEmpty', 'groupHasNetworks', 'groupStateUnknown']);
    assert.equal(isStaleDataFailure('failed'), false);
  });
});

describe('parseManagedGroupsResult (getManagedApGroups() reply)', () => {
  test('keeps the sane fields of each group and the limits; drops what is insane (never read as "none")', () => {
    const parsed = parseManagedGroupsResult({
      success: true,
      groups: [
        { id: 'a1', name: 'Default', isDefault: true, apCount: 4, networkNames: ['Casa'], remainingBinding: { band2g: 6, band5g: 6, band6g: 6 } },
        { id: 'b2', name: 'Vacío', isDefault: false, apCount: 0, networkNames: [] },
        { id: 'c3', name: 'Raro', isDefault: 'yes', apCount: -1, networkNames: [null], remainingBinding: { band2g: 1.5, band5g: -2, band6g: 3, mlo: 1, extra: 4 } },
        { id: 'd4', name: 'Sin datos', apCount: '2', networkNames: 'Casa', remainingBinding: 'full' },
        { name: 'no id' },
        { id: '', name: 'empty id' },
        { id: 'e5' },
        null,
        'x',
      ],
      ssidLimits: { band2g: 8, band5g: -1, mlo: 4, other: 9 },
    });
    assert.deepEqual(parsed, {
      ok: true,
      groups: [
        { id: 'a1', name: 'Default', isDefault: true, apCount: 4, networkNames: ['Casa'], remainingBinding: { band2g: 6, band5g: 6, band6g: 6 } },
        { id: 'b2', name: 'Vacío', isDefault: false, apCount: 0, networkNames: [] },
        { id: 'c3', name: 'Raro', isDefault: false, remainingBinding: { band6g: 3 } },
        { id: 'd4', name: 'Sin datos', isDefault: false },
      ],
      ssidLimits: { band2g: 8, mlo: 4 },
    });
  });

  test('no limits reported: null', () => {
    assert.deepEqual(parseManagedGroupsResult({ success: true, groups: [] }), { ok: true, groups: [], ssidLimits: null });
    assert.deepEqual(parseManagedGroupsResult({ success: true, groups: [], ssidLimits: { band2g: 'x' } }), { ok: true, groups: [], ssidLimits: null });
  });

  test('failures: main\'s code with a codes-only diagnostic; anything unreadable is "failed"', () => {
    assert.deepEqual(parseManagedGroupsResult({ success: false, error: 'managementUnavailable' }), { ok: false, error: 'managementUnavailable', diagnostic: null });
    assert.deepEqual(parseManagedGroupsResult({ success: false, error: 'requestFailed', diagnostic: 'httpError, HTTP 503' }), {
      ok: false,
      error: 'requestFailed',
      diagnostic: 'httpError, HTTP 503',
    });
    assert.deepEqual(parseManagedGroupsResult({ success: false, error: 'requestFailed', diagnostic: '<b>bad</b>' }), { ok: false, error: 'requestFailed', diagnostic: null });
    assert.deepEqual(parseManagedGroupsResult({ success: false, error: 'somethingElse' }), { ok: false, error: 'failed', diagnostic: null });
    assert.deepEqual(parseManagedGroupsResult({ success: true }), { ok: false, error: 'failed', diagnostic: null });
    assert.deepEqual(parseManagedGroupsResult(null), { ok: false, error: 'failed', diagnostic: null });
    assert.deepEqual(parseManagedGroupsResult('ok'), { ok: false, error: 'failed', diagnostic: null });
  });
});

describe('parseGroupActionResult (create / rename / delete reply)', () => {
  test('success, with the new group\'s id when reported', () => {
    assert.deepEqual(parseGroupActionResult({ success: true, apGroupId: '6512a0e1f3b2c41d2e3f4a60' }), { ok: true, apGroupId: '6512a0e1f3b2c41d2e3f4a60' });
    assert.deepEqual(parseGroupActionResult({ success: true }), { ok: true, apGroupId: null });
    assert.deepEqual(parseGroupActionResult({ success: true, apGroupId: 42 }), { ok: true, apGroupId: null });
    assert.deepEqual(parseGroupActionResult({ success: true, apGroupId: '' }), { ok: true, apGroupId: null });
  });

  test('failures keep main\'s code and its diagnostic', () => {
    for (const code of ERRORS) {
      assert.deepEqual(parseGroupActionResult({ success: false, error: code }), { ok: false, error: code, diagnostic: null }, code);
    }
    assert.deepEqual(parseGroupActionResult({ success: false, error: 'groupLimitReached', diagnostic: 'apiError, errorCode -33201' }), {
      ok: false,
      error: 'groupLimitReached',
      diagnostic: 'apiError, errorCode -33201',
    });
    assert.deepEqual(parseGroupActionResult({ success: 'true' }), { ok: false, error: 'failed', diagnostic: null });
    assert.deepEqual(parseGroupActionResult(undefined), { ok: false, error: 'failed', diagnostic: null });
  });
});

describe('findCreatedGroupId (the new group after the reload)', () => {
  const reloaded: NamedGroup[] = [...GROUPS, { id: '6512a0e1f3b2c41d2e3f4a60', name: 'Grupo nuevo' }];

  test('by the id main reported when it is listed', () => {
    assert.equal(findCreatedGroupId('6512a0e1f3b2c41d2e3f4a60', 'Grupo nuevo', reloaded), '6512a0e1f3b2c41d2e3f4a60');
  });

  test('else by its name (compared like the name rule), only when exactly one group has it', () => {
    assert.equal(findCreatedGroupId(null, 'grupo NUEVO', reloaded), '6512a0e1f3b2c41d2e3f4a60');
    assert.equal(findCreatedGroupId('ffffffffffffffffffffffff', 'Grupo nuevo', reloaded), '6512a0e1f3b2c41d2e3f4a60');
    assert.equal(findCreatedGroupId(null, 'Grupo nuevo', [...reloaded, { id: 'z', name: 'GRUPO NUEVO' }]), null);
    assert.equal(findCreatedGroupId(null, 'Nada', reloaded), null);
  });
});
