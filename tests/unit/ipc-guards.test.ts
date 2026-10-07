// Tests for the pure IPC shape guards (src/main/ipc-guards.ts) of the
// session-owned channels: the session nonce (32 lowercase hex, no extra
// arguments) and the AP-group payloads — exactly the listed keys (none
// missing, no unknown one), plain objects only, the nonce and the 24-hex
// AP-group id formats, a string name within the raw cap — and that the
// parsed request is a fresh copy carrying nothing else.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MAX_RAW_AP_GROUP_NAME_LENGTH,
  NONCE_REGEX,
  parseApGroupCreateRequest,
  parseApGroupDeleteRequest,
  parseApGroupRenameRequest,
  requireSessionNonce
} from '../../src/main/ipc-guards';

const NONCE = '0123456789abcdef0123456789abcdef';
const GROUP_ID = '6512a0e1f3b2c41d2e3f4a5b';
const BAD_NONCES: unknown[] = [undefined, null, 42, '', '0123456789ABCDEF0123456789ABCDEF', `${NONCE}0`, NONCE.slice(1), ` ${NONCE.slice(1)}`, [NONCE], { nonce: NONCE }];
const BAD_IDS: unknown[] = [undefined, null, 7, '', 'bad id!', `${GROUP_ID}0`, GROUP_ID.slice(1), '../6512a0e1f3b2c41d2e3f4', [GROUP_ID]];

describe('requireSessionNonce()', () => {
  test('accepts exactly one 32-hex nonce', () => {
    assert.equal(requireSessionNonce(NONCE, []), NONCE);
    assert.ok(NONCE_REGEX.test(NONCE));
  });

  test('rejects malformed nonces and extra arguments', () => {
    for (const nonce of BAD_NONCES) {
      assert.throws(() => requireSessionNonce(nonce, []), /invalid session nonce format/, JSON.stringify(nonce));
    }
    assert.throws(() => requireSessionNonce(NONCE, ['x']), /unexpected arguments/);
  });
}); // End of the describe block for requireSessionNonce()

describe('AP-group payload guards', () => {
  test('valid payloads parse into fresh copies with exactly the listed keys', () => {
    const createPayload = { sessionNonce: NONCE, name: '  Aulas  ' };
    const create = parseApGroupCreateRequest(createPayload, []);
    assert.deepEqual(create, { sessionNonce: NONCE, name: '  Aulas  ' }, 'the name is trimmed later, by the name rules');
    assert.notEqual(create, createPayload);
    assert.deepEqual(parseApGroupRenameRequest({ name: 'B', apGroupId: GROUP_ID, sessionNonce: NONCE }, []), { sessionNonce: NONCE, apGroupId: GROUP_ID, name: 'B' });
    assert.deepEqual(parseApGroupDeleteRequest({ sessionNonce: NONCE, apGroupId: GROUP_ID.toUpperCase() }, []), { sessionNonce: NONCE, apGroupId: GROUP_ID.toUpperCase() });
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, { sessionNonce: NONCE, apGroupId: GROUP_ID });
    assert.deepEqual(parseApGroupDeleteRequest(nullPrototype, []), { sessionNonce: NONCE, apGroupId: GROUP_ID });
    assert.equal(parseApGroupCreateRequest({ sessionNonce: NONCE, name: '' }, []).name, '', 'blank is a name-rule code, not a shape error');
  });

  test('non-objects, arrays, class instances and extra arguments are rejected', () => {
    for (const payload of [undefined, null, 'x', 42, [NONCE, 'x'], new Date(), new Map()]) {
      assert.throws(() => parseApGroupCreateRequest(payload, []), /IPC call rejected/, String(payload));
      assert.throws(() => parseApGroupDeleteRequest(payload, []), /IPC call rejected/, String(payload));
    }
    assert.throws(() => parseApGroupCreateRequest({ sessionNonce: NONCE, name: 'A' }, [1]), /unexpected arguments/);
    assert.throws(() => parseApGroupRenameRequest({ sessionNonce: NONCE, apGroupId: GROUP_ID, name: 'A' }, [undefined]), /unexpected arguments/);
    assert.throws(() => parseApGroupDeleteRequest({ sessionNonce: NONCE, apGroupId: GROUP_ID }, [{}]), /unexpected arguments/);
  });

  test('unknown or missing keys are rejected', () => {
    const cases: Array<[(payload: unknown) => unknown, Record<string, unknown>]> = [
      [(payload) => parseApGroupCreateRequest(payload, []), { sessionNonce: NONCE, name: 'A', apMacs: [] }],
      [(payload) => parseApGroupCreateRequest(payload, []), { sessionNonce: NONCE }],
      [(payload) => parseApGroupCreateRequest(payload, []), { name: 'A' }],
      [(payload) => parseApGroupCreateRequest(payload, []), { sessionNonce: NONCE, name: 'A', apGroupId: GROUP_ID }],
      [(payload) => parseApGroupRenameRequest(payload, []), { sessionNonce: NONCE, apGroupId: GROUP_ID, name: 'A', addApMacs: [] }],
      [(payload) => parseApGroupRenameRequest(payload, []), { sessionNonce: NONCE, name: 'A' }],
      [(payload) => parseApGroupDeleteRequest(payload, []), { sessionNonce: NONCE, apGroupId: GROUP_ID, force: true }],
      [(payload) => parseApGroupDeleteRequest(payload, []), { sessionNonce: NONCE, apGroupId: GROUP_ID, name: 'A' }],
      [(payload) => parseApGroupDeleteRequest(payload, []), { apGroupId: GROUP_ID }],
      [(payload) => parseApGroupDeleteRequest(payload, []), {}]
    ];
    for (const [parse, payload] of cases) {
      assert.throws(() => parse(payload), /invalid AP-group request keys/, JSON.stringify(payload));
    }
  }); // End of test "unknown or missing keys are rejected"

  test('malformed nonces, AP-group ids and names are rejected', () => {
    for (const sessionNonce of BAD_NONCES.filter((value) => value !== undefined)) {
      assert.throws(() => parseApGroupCreateRequest({ sessionNonce, name: 'A' }, []), /invalid session nonce format/, JSON.stringify(sessionNonce));
      assert.throws(() => parseApGroupDeleteRequest({ sessionNonce, apGroupId: GROUP_ID }, []), /invalid session nonce format/);
    }
    for (const apGroupId of BAD_IDS.filter((value) => value !== undefined)) {
      assert.throws(() => parseApGroupRenameRequest({ sessionNonce: NONCE, apGroupId, name: 'A' }, []), /invalid AP group id format/, JSON.stringify(apGroupId));
      assert.throws(() => parseApGroupDeleteRequest({ sessionNonce: NONCE, apGroupId }, []), /invalid AP group id format/);
    }
    for (const name of [null, 5, ['A'], { text: 'A' }, 'x'.repeat(MAX_RAW_AP_GROUP_NAME_LENGTH + 1)]) {
      assert.throws(() => parseApGroupCreateRequest({ sessionNonce: NONCE, name }, []), /invalid AP group name/);
      assert.throws(() => parseApGroupRenameRequest({ sessionNonce: NONCE, apGroupId: GROUP_ID, name }, []), /invalid AP group name/);
    }
    assert.equal(parseApGroupCreateRequest({ sessionNonce: NONCE, name: 'x'.repeat(MAX_RAW_AP_GROUP_NAME_LENGTH) }, []).name.length, MAX_RAW_AP_GROUP_NAME_LENGTH);
  }); // End of test "malformed nonces, AP-group ids and names are rejected"
}); // End of the describe block for the AP-group payload guards
