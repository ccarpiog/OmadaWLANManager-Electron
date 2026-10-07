// Tests for the pure IPC shape guards (src/main/ipc-guards.ts) of the
// session-owned channels: the session nonce (32 lowercase hex, no extra
// arguments) and the AP-group payloads — exactly the listed keys (none
// missing, no unknown one), plain objects only, the nonce and the 24-hex
// AP-group id formats, a string name within the raw cap — and the Wi-Fi
// network write payloads (phase 18a): the same exact-keys rule with optional
// keys allowed only when present, SSID ids, the security / band enums, the
// AP-group id list (cap, dedupe), a boolean enable state, raw caps on the
// name and the passphrase, and rejection messages that never quote the
// passphrase — and the binding payload (phase 19a): exactly {sessionNonce,
// networkId, apGroupIds}, at most 256 deduplicated 24-hex ids — and that the
// parsed request is a fresh copy carrying nothing else.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MAX_NETWORK_AP_GROUP_IDS,
  MAX_RAW_AP_GROUP_NAME_LENGTH,
  MAX_RAW_NETWORK_NAME_LENGTH,
  MAX_RAW_PASSPHRASE_LENGTH,
  NONCE_REGEX,
  parseApGroupCreateRequest,
  parseApGroupDeleteRequest,
  parseApGroupRenameRequest,
  parseNetworkBindingsRequest,
  parseNetworkCreateRequest,
  parseNetworkDeleteRequest,
  parseNetworkEnableRequest,
  parseNetworkPasswordRequest,
  parseNetworkUpdateRequest,
  requireSessionNonce
} from '../../src/main/ipc-guards';

const NONCE = '0123456789abcdef0123456789abcdef';
const GROUP_ID = '6512a0e1f3b2c41d2e3f4a5b';
const OTHER_GROUP_ID = '6512a0e1f3b2c41d2e3f4a5c';
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

const NETWORK_ID = '5f00c0ffee0000000000c001';
const PASSPHRASE = 'SENTINEL-guard-passphrase';

/**
 * A valid create payload with the given overrides.
 * @param {Record<string, unknown>} [overrides] - Fields to replace (undefined removes nothing).
 * @returns {Record<string, unknown>} The payload.
 */
function createPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { sessionNonce: NONCE, name: ' Casa ', security: 'wpaPersonal', bands: ['band5g', 'band2g'], apGroupIds: [GROUP_ID], passphrase: PASSPHRASE, ...overrides };
}

/**
 * Runs a guard expected to throw and returns the rejection message.
 * @param {() => unknown} run - The guard call.
 * @returns {string} The message.
 */
function rejection(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.match(error.message, /^IPC call rejected: /);
    return error.message;
  }
  throw new Error('expected a rejection');
}

describe('Wi-Fi network write payload guards', () => {
  test('valid payloads parse into fresh copies: bands deduplicated in canonical order, group ids deduplicated, the passphrase only when present, as typed', () => {
    const payload = createPayload({ bands: ['band6g', 'band2g', 'band6g'], apGroupIds: [GROUP_ID, GROUP_ID.toUpperCase(), GROUP_ID] });
    const create = parseNetworkCreateRequest(payload, []);
    assert.deepEqual(create, {
      sessionNonce: NONCE,
      name: ' Casa ',
      security: 'wpaPersonal',
      bands: ['band2g', 'band6g'],
      apGroupIds: [GROUP_ID, GROUP_ID.toUpperCase()],
      passphrase: PASSPHRASE
    });
    assert.notEqual(create.bands, payload.bands);
    const { passphrase: _omitted, ...open } = createPayload({ security: 'open' });
    assert.equal('passphrase' in parseNetworkCreateRequest(open, []), false);
    assert.deepEqual(parseNetworkCreateRequest(createPayload({ security: 'wpaEnterprise', bands: [], apGroupIds: [], passphrase: '' }), []).security, 'wpaEnterprise', 'enum values main refuses later with a code');
    assert.deepEqual(parseNetworkUpdateRequest({ sessionNonce: NONCE, networkId: NETWORK_ID }, []), { sessionNonce: NONCE, networkId: NETWORK_ID }, 'nothing edited is a rule code');
    assert.deepEqual(parseNetworkUpdateRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, name: 'B', security: 'open', bands: ['band5g'], passphrase: ' x ' }, []), {
      sessionNonce: NONCE,
      networkId: NETWORK_ID,
      name: 'B',
      security: 'open',
      bands: ['band5g'],
      passphrase: ' x '
    });
    assert.deepEqual(parseNetworkPasswordRequest({ networkId: NETWORK_ID, passphrase: PASSPHRASE, sessionNonce: NONCE }, []), { sessionNonce: NONCE, networkId: NETWORK_ID, passphrase: PASSPHRASE });
    assert.deepEqual(parseNetworkEnableRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, enabled: false }, []), { sessionNonce: NONCE, networkId: NETWORK_ID, enabled: false });
    assert.deepEqual(parseNetworkDeleteRequest({ sessionNonce: NONCE, networkId: 'legacy_ssid-1' }, []), { sessionNonce: NONCE, networkId: 'legacy_ssid-1' });
  }); // End of test "valid payloads parse into fresh copies..."

  test('unknown or missing keys, and optional keys present but undefined, are rejected', () => {
    const cases: Array<[(payload: unknown) => unknown, Record<string, unknown>]> = [
      [(payload) => parseNetworkCreateRequest(payload, []), createPayload({ vlanId: 20 })],
      [(payload) => parseNetworkCreateRequest(payload, []), createPayload({ passphrase: undefined })],
      [(payload) => parseNetworkCreateRequest(payload, []), { sessionNonce: NONCE, name: 'A', security: 'open', bands: ['band2g'] }],
      [(payload) => parseNetworkUpdateRequest(payload, []), { sessionNonce: NONCE, networkId: NETWORK_ID, hidden: true }],
      [(payload) => parseNetworkUpdateRequest(payload, []), { sessionNonce: NONCE, networkId: NETWORK_ID, name: undefined }],
      [(payload) => parseNetworkUpdateRequest(payload, []), { sessionNonce: NONCE, name: 'A' }],
      [(payload) => parseNetworkPasswordRequest(payload, []), { sessionNonce: NONCE, networkId: NETWORK_ID }],
      [(payload) => parseNetworkPasswordRequest(payload, []), { sessionNonce: NONCE, networkId: NETWORK_ID, passphrase: PASSPHRASE, name: 'A' }],
      [(payload) => parseNetworkEnableRequest(payload, []), { sessionNonce: NONCE, networkId: NETWORK_ID }],
      [(payload) => parseNetworkDeleteRequest(payload, []), { sessionNonce: NONCE, networkId: NETWORK_ID, force: true }],
      [(payload) => parseNetworkDeleteRequest(payload, []), {}]
    ];
    for (const [parse, payload] of cases) {
      assert.throws(() => parse(payload), /invalid Wi-Fi network request keys/, JSON.stringify(payload));
    }
    for (const payload of [undefined, null, 'x', [NONCE], new Date()]) {
      assert.throws(() => parseNetworkDeleteRequest(payload, []), /invalid Wi-Fi network request/, String(payload));
    }
    assert.throws(() => parseNetworkDeleteRequest({ sessionNonce: NONCE, networkId: NETWORK_ID }, [1]), /unexpected arguments/);
  }); // End of test "unknown or missing keys..."

  test('malformed values are rejected: nonce, SSID id, security, bands, group ids (format, cap), name and passphrase caps, a non-boolean enable state', () => {
    for (const sessionNonce of BAD_NONCES.filter((value) => value !== undefined)) {
      assert.throws(() => parseNetworkDeleteRequest({ sessionNonce, networkId: NETWORK_ID }, []), /invalid session nonce format/);
    }
    for (const networkId of [null, 7, '', '..', '../x', 'a b', 'x'.repeat(129), [NETWORK_ID]]) {
      assert.throws(() => parseNetworkDeleteRequest({ sessionNonce: NONCE, networkId }, []), /invalid Wi-Fi network id format/, JSON.stringify(networkId));
      assert.throws(() => parseNetworkEnableRequest({ sessionNonce: NONCE, networkId, enabled: true }, []), /invalid Wi-Fi network id format/);
    }
    for (const security of [null, 3, 'wep', 'WPAPERSONAL', ['open']]) {
      assert.throws(() => parseNetworkCreateRequest(createPayload({ security }), []), /invalid Wi-Fi network security/, JSON.stringify(security));
      assert.throws(() => parseNetworkUpdateRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, security }, []), /invalid Wi-Fi network security/);
    }
    for (const bands of [null, 'band2g', ['band24g'], ['band2g', 'band5g', 'band6g', 'band2g'], [1]]) {
      assert.throws(() => parseNetworkCreateRequest(createPayload({ bands }), []), /invalid Wi-Fi network bands/, JSON.stringify(bands));
    }
    for (const apGroupIds of [null, GROUP_ID, ['Corrupto'], [GROUP_ID, 7], Array.from({ length: MAX_NETWORK_AP_GROUP_IDS + 1 }, () => GROUP_ID)]) {
      assert.throws(() => parseNetworkCreateRequest(createPayload({ apGroupIds }), []), /invalid AP group id format/);
    }
    assert.equal(parseNetworkCreateRequest(createPayload({ apGroupIds: Array.from({ length: MAX_NETWORK_AP_GROUP_IDS }, () => GROUP_ID) }), []).apGroupIds.length, 1);
    for (const name of [null, 5, ['A'], 'x'.repeat(MAX_RAW_NETWORK_NAME_LENGTH + 1)]) {
      assert.throws(() => parseNetworkCreateRequest(createPayload({ name }), []), /invalid Wi-Fi network name/);
      assert.throws(() => parseNetworkUpdateRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, name }, []), /invalid Wi-Fi network name/);
    }
    for (const enabled of ['true', 1, null]) {
      assert.throws(() => parseNetworkEnableRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, enabled }, []), /invalid Wi-Fi network enable state/);
    }
    assert.equal(parseNetworkPasswordRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, passphrase: 'x'.repeat(MAX_RAW_PASSPHRASE_LENGTH) }, []).passphrase.length, MAX_RAW_PASSPHRASE_LENGTH);
  }); // End of test "malformed values are rejected..."

  test('a rejected passphrase (not a string, over the raw cap) or any other rejection of a payload carrying one never quotes it', () => {
    const long = `${PASSPHRASE}${'x'.repeat(MAX_RAW_PASSPHRASE_LENGTH)}`;
    const messages = [
      rejection(() => parseNetworkPasswordRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, passphrase: long }, [])),
      rejection(() => parseNetworkPasswordRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, passphrase: [PASSPHRASE] }, [])),
      rejection(() => parseNetworkCreateRequest(createPayload({ passphrase: long }), [])),
      rejection(() => parseNetworkUpdateRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, passphrase: { value: PASSPHRASE } }, [])),
      rejection(() => parseNetworkCreateRequest(createPayload({ extra: PASSPHRASE }), [])),
      rejection(() => parseNetworkCreateRequest(createPayload({ security: PASSPHRASE }), [])),
      rejection(() => parseNetworkPasswordRequest({ sessionNonce: PASSPHRASE, networkId: NETWORK_ID, passphrase: PASSPHRASE }, []))
    ];
    assert.equal(messages.filter((message) => /invalid Wi-Fi network passphrase/.test(message)).length, 4);
    assert.ok(messages.every((message) => !message.includes('SENTINEL')), messages.join(' | '));
  }); // End of test "a rejected passphrase (not a string..."
}); // End of the describe block for the Wi-Fi network payload guards

describe('Wi-Fi network binding payload guard (phase 19a)', () => {
  test('a valid payload parses into a fresh copy with exactly {sessionNonce, networkId, apGroupIds}, the ids deduplicated in their order', () => {
    const payload = { apGroupIds: [OTHER_GROUP_ID, GROUP_ID, OTHER_GROUP_ID], networkId: NETWORK_ID, sessionNonce: NONCE };
    const request = parseNetworkBindingsRequest(payload, []);
    assert.deepEqual(request, { sessionNonce: NONCE, networkId: NETWORK_ID, apGroupIds: [OTHER_GROUP_ID, GROUP_ID] });
    assert.notEqual(request.apGroupIds, payload.apGroupIds);
    assert.deepEqual(Object.keys(request).sort(), ['apGroupIds', 'networkId', 'sessionNonce']);
    assert.deepEqual(parseNetworkBindingsRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, apGroupIds: [] }, []).apGroupIds, [], 'no group is a rule code (groupsRequired), not a shape error');
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, { sessionNonce: NONCE, networkId: NETWORK_ID, apGroupIds: [GROUP_ID] });
    assert.deepEqual(parseNetworkBindingsRequest(nullPrototype, []), { sessionNonce: NONCE, networkId: NETWORK_ID, apGroupIds: [GROUP_ID] });
  });

  test('unknown or missing keys, a non-object payload and extra arguments are rejected', () => {
    const cases: Record<string, unknown>[] = [
      { sessionNonce: NONCE, networkId: NETWORK_ID, apGroupIds: [GROUP_ID], chooseDevices: 0 },
      { sessionNonce: NONCE, networkId: NETWORK_ID, apGroupIds: [GROUP_ID], allAccessPoints: true },
      { sessionNonce: NONCE, networkId: NETWORK_ID },
      { sessionNonce: NONCE, apGroupIds: [GROUP_ID] },
      { networkId: NETWORK_ID, apGroupIds: [GROUP_ID] },
      {}
    ];
    for (const payload of cases) {
      assert.throws(() => parseNetworkBindingsRequest(payload, []), /invalid Wi-Fi network bindings request keys/, JSON.stringify(payload));
    }
    for (const payload of [undefined, null, 'x', [NONCE], new Date()]) {
      assert.throws(() => parseNetworkBindingsRequest(payload, []), /invalid Wi-Fi network bindings request/, String(payload));
    }
    assert.throws(() => parseNetworkBindingsRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, apGroupIds: [GROUP_ID] }, [1]), /unexpected arguments/);
  }); // End of test "unknown or missing keys…"

  test('malformed values are rejected: the nonce, the SSID id, the group ids (format, type, more than 256)', () => {
    for (const sessionNonce of BAD_NONCES.filter((value) => value !== undefined)) {
      assert.throws(() => parseNetworkBindingsRequest({ sessionNonce, networkId: NETWORK_ID, apGroupIds: [GROUP_ID] }, []), /invalid session nonce format/);
    }
    for (const networkId of [null, 7, '', '..', '../x', 'a b', 'x'.repeat(129), [NETWORK_ID]]) {
      assert.throws(() => parseNetworkBindingsRequest({ sessionNonce: NONCE, networkId, apGroupIds: [GROUP_ID] }, []), /invalid Wi-Fi network id format/, JSON.stringify(networkId));
    }
    const tooMany = Array.from({ length: MAX_NETWORK_AP_GROUP_IDS + 1 }, () => GROUP_ID);
    for (const apGroupIds of [null, GROUP_ID, { 0: GROUP_ID }, ['Corrupto'], [GROUP_ID, 7], [GROUP_ID, null], [`${GROUP_ID} `], tooMany]) {
      assert.throws(() => parseNetworkBindingsRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, apGroupIds }, []), /invalid AP group id format/, JSON.stringify(apGroupIds).slice(0, 60));
    }
    const atCap = Array.from({ length: MAX_NETWORK_AP_GROUP_IDS }, () => GROUP_ID);
    assert.deepEqual(parseNetworkBindingsRequest({ sessionNonce: NONCE, networkId: NETWORK_ID, apGroupIds: atCap }, []).apGroupIds, [GROUP_ID]);
  }); // End of test "malformed values are rejected…"
}); // End of the describe block for the binding payload guard
