// Tests for AP-group management through the controller session
// (src/main/controller-session.ts: listManagedApGroups(), createApGroup(),
// renameApGroup(), deleteApGroup() and their *Reply() wrappers), driven end to
// end — the real ConnectionManager, OmadaController and OpenApiClient over one
// fake transport whose Open API AP groups live in memory (no Electron, no
// network):
// - the capacity read path: the minimal DTO, garbage fields absent;
// - create / rename / delete: the exact v1 calls, the name rules, the name
//   conflict and the delete policy decided on FRESH data read right before
//   the write (incl. "fresh data says non-empty although the renderer thought
//   empty"), the controller error codes, the id of a created group;
// - session binding: management off, a stale nonce, a superseding connect, a
//   disconnect, a re-check or a credentials save while an operation runs —
//   nothing more is written and late answers are discarded;
// - writes of one session run one at a time;
// - no reply or log line carries the Client Secret, a token or controller text.

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { ConnectionManager } from '../../src/main/connection-manager';
import {
  applyManagementAccessChange,
  ControllerSession,
  createApGroupReply,
  deleteApGroupReply,
  managedApGroupsReply,
  renameApGroupReply,
  testManagementAccess,
  type ManagementCredentials
} from '../../src/main/controller-session';
import { OpenApiClient, TOKEN_PATH } from '../../src/main/openapi-client';
import type { ApGroupActionResult, ManagedApGroupsResult } from '../../src/shared/types';
import responses from '../fixtures/controller/responses.json';
import { FakeTransport, type FakeReply, type RecordedRequest } from './helpers/fake-transport';

const BASE_URL = 'https://controller.invalid:8043';
const OMADAC_ID = responses.apiInfo.result.omadacId;
const SITE_ID = responses.sitesSingle.result.data[0].id;
const LOGIN_PATH = `/${OMADAC_ID}/api/v2/login`;
const LOGOUT_PATH = `/${OMADAC_ID}/api/v2/logout`;
const SITES_PATH = `/${OMADAC_ID}/api/v2/sites?currentPage=1&currentPageSize=100`;
const OPENAPI_SITES = `/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`;
const AP_GROUPS = `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/ap-groups`;
const AP_GROUPS_PAGE = `${AP_GROUPS}?page=1&pageSize=100`;
const CLIENT_ID = 'owm-client-1';
const CLIENT_SECRET = 'Cl1ent-S3cret-Value-Never-Shown';
// The internal setting/wlans ids of the fixture (the Open API list must match them)
const [DEFAULT_ID, GROUP_B_ID, EMPTY_ID] = responses.wlans.result.data.map((group) => group.id);
// The id the fake controller gives a created group, and a valid id nobody has
const NEW_ID = '6512a0e1f3b2c41d2e3f4aff';
const UNKNOWN_ID = '6512a0e1f3b2c41d2e3f4a00';

/**
 * The internal setting/wlans path of the site.
 * @returns {string} The path.
 */
function wlansPath(): string {
  return `/${OMADAC_ID}/api/v2/sites/${SITE_ID}/setting/wlans`;
}

/**
 * The Open API path of one AP group.
 * @param {string} id - The group id.
 * @returns {string} The path.
 */
function groupPath(id: string): string {
  return `${AP_GROUPS}/${id}`;
}

/**
 * A successful Open API envelope.
 * @param {unknown} [result] - The result (absent for writes).
 * @returns {FakeReply} The reply.
 */
function ok(result?: unknown): FakeReply {
  return { body: result === undefined ? { errorCode: 0, msg: 'Success.' } : { errorCode: 0, msg: 'Success.', result } };
}

/**
 * A failed Open API envelope.
 * @param {number} errorCode - The controller errorCode.
 * @param {string} [msg] - Its message.
 * @returns {FakeReply} The reply.
 */
function apiError(errorCode: number, msg = 'Refused.'): FakeReply {
  return { body: { errorCode, msg } };
}

/** A promise with its resolve function exposed. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

/**
 * Creates a deferred promise.
 * @returns {Deferred<T>} The promise and its resolve function.
 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * Lets pending promise callbacks run until `predicate` holds (bounded).
 * @param {() => boolean} predicate - The condition.
 * @returns {Promise<void>}
 */
async function until(predicate: () => boolean): Promise<void> {
  for (let round = 0; round < 200 && !predicate(); round++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(predicate(), 'condition reached');
}

// Every console line the code under test writes (checked for secrets)
const logLines: string[] = [];
/**
 * Records one console call as text.
 * @param {...unknown} args - The console arguments.
 */
const recordLog = (...args: unknown[]): void => {
  logLines.push(args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
};
mock.method(console, 'warn', recordLog);
mock.method(console, 'error', recordLog);
mock.method(console, 'log', recordLog);

// Every reply the tests received (checked for secrets at the end)
const replies: unknown[] = [];

/** One AP group of the fake controller (null fields are left out of the answer). */
interface FakeGroup {
  id: string;
  name: string;
  primary?: boolean;
  apNum?: number | null;
  ssidNameList?: unknown[] | null;
  remainingBinding?: Record<string, unknown> | null;
}

/**
 * The fake environment: one transport serving the internal API and the Open
 * API (AP groups in memory, mutated by the writes), the configured URL and
 * management credentials, and the real ConnectionManager over ControllerSessions.
 */
class Harness {
  readonly transport = new FakeTransport(BASE_URL);
  configuredUrl = BASE_URL;
  credentials: ManagementCredentials | null = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
  tokensIssued = 0;
  readonly manager: ConnectionManager<ControllerSession>;
  groups: FakeGroup[] = [
    { id: DEFAULT_ID, name: 'Default', primary: true, apNum: 3, ssidNameList: ['Casa', 'Invitados'], remainingBinding: { '0': 6, '1': 6, '2': 8 } },
    { id: GROUP_B_ID, name: 'zGrupo B', primary: false, apNum: 1, ssidNameList: ['Taller'], remainingBinding: { '0': 7, '1': 7, '2': 8 } },
    { id: EMPTY_ID, name: 'zNinguna', primary: false, apNum: 0, ssidNameList: [], remainingBinding: { '0': 8, '1': 8, '2': 8 } }
  ];
  // The answer of the next AP-group list request(s), when set (else the groups)
  listOverride: (() => FakeReply | Promise<FakeReply>) | null = null;

  /**
   * The answer of a create (default: the group is added, its id returned).
   * @param {string} name - The name the POST carried.
   * @returns {FakeReply | Promise<FakeReply>} The answer.
   */
  createAnswer: (name: string) => FakeReply | Promise<FakeReply> = (name) => {
    this.groups.push({ id: NEW_ID, name, primary: false, apNum: 0, ssidNameList: [], remainingBinding: { '0': 8, '1': 8, '2': 8 } });
    return ok({ id: NEW_ID });
  };

  /**
   * The answer of a rename (default: applied, errorCode 0).
   * @param {string} id - The group id of the path.
   * @param {string} name - The name the PATCH carried.
   * @returns {FakeReply | Promise<FakeReply>} The answer.
   */
  renameAnswer: (id: string, name: string) => FakeReply | Promise<FakeReply> = (id, name) => {
    const group = this.groups.find((candidate) => candidate.id === id);
    if (group) {
      group.name = name;
    }
    return ok();
  };

  /**
   * The answer of a delete (default: applied, errorCode 0).
   * @param {string} id - The group id of the path.
   * @returns {FakeReply | Promise<FakeReply>} The answer.
   */
  deleteAnswer: (id: string) => FakeReply | Promise<FakeReply> = (id) => {
    this.groups = this.groups.filter((group) => group.id !== id);
    return ok();
  };

  /**
   * Builds a harness where every capability check passes.
   */
  constructor() {
    this.transport
      .on('GET', '/api/info', { body: responses.apiInfo, setCookie: 'TPOMADA_SESSIONID=session-1; Path=/; HttpOnly' })
      .on('POST', LOGIN_PATH, { body: responses.loginOk })
      .on('GET', SITES_PATH, { body: responses.sitesSingle })
      .on('GET', wlansPath(), { body: responses.wlans })
      .on('POST', LOGOUT_PATH, { body: responses.ok })
      .on('POST', TOKEN_PATH, () => ok({ accessToken: `AT-session-token-${++this.tokensIssued}`, tokenType: 'bearer', expiresIn: 7200, refreshToken: 'RT-x' }))
      .on('GET', OPENAPI_SITES, ok({ totalRows: 1, currentPage: 1, currentSize: 1, data: [{ siteId: SITE_ID, name: 'Casa' }] }))
      .on('GET', AP_GROUPS_PAGE, () => (this.listOverride ? this.listOverride() : this.listReply()))
      .on('POST', AP_GROUPS, (request) => this.createAnswer((request.body as { name: string }).name));
    for (const id of [DEFAULT_ID, GROUP_B_ID, EMPTY_ID, NEW_ID, UNKNOWN_ID]) {
      this.transport
        .on('PATCH', groupPath(id), (request) => this.renameAnswer(id, (request.body as { name: string }).name))
        .on('DELETE', groupPath(id), () => this.deleteAnswer(id));
    }
    this.manager = new ConnectionManager<ControllerSession>({
      getCredentials: () => ({ url: this.configuredUrl, username: 'admin', password: 'internal-password' }),
      createController: (credentials) =>
        new ControllerSession({
          ...credentials,
          transport: this.transport,
          getManagementCredentials: () => this.credentials,
          getConfiguredUrl: () => this.configuredUrl,
          createOpenApiClient: (options) => new OpenApiClient(options)
        }),
      getConfiguredUrl: () => this.configuredUrl,
      getStoredSiteId: () => '',
      saveStoredSiteId: () => undefined,
      saveCertificatePin: () => true,
      clearCertificatePin: () => true,
      resetControllerSession: () => Promise.resolve(),
      logoutDrainMs: 20
    });
  } // End of constructor()

  /**
   * The current AP-group page as the controller would answer it.
   * @returns {FakeReply} The reply.
   */
  listReply(): FakeReply {
    const data = this.groups.map((group) => {
      const entry: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(group)) {
        if (value !== null && value !== undefined) {
          entry[key] = value;
        }
      }
      return entry;
    });
    return ok({ totalRows: data.length, currentPage: 1, currentSize: 100, data, maxSsids2G: 8, maxSsids5G: 8, maxSsids6G: 8, maxSsidsMlo: 4 });
  } // End of function listReply()

  /**
   * Connects, waits for the capabilities and returns the session nonce.
   * @returns {Promise<string>} The session nonce.
   */
  async connect(): Promise<string> {
    const result = await this.manager.connect();
    assert.equal(result.success, true, JSON.stringify(result));
    const nonce = result.sessionNonce as string;
    await this.manager.controller?.waitForCapabilities();
    return nonce;
  }

  /**
   * The recorded Open API requests (the token included).
   * @returns {RecordedRequest[]} The requests.
   */
  openApiRequests(): RecordedRequest[] {
    return this.transport.requests.filter((request) => request.path.startsWith('/openapi'));
  }

  /**
   * The recorded AP-group writes (POST / PATCH / DELETE under …/ap-groups).
   * @returns {RecordedRequest[]} The writes.
   */
  writes(): RecordedRequest[] {
    return this.transport.requests.filter((request) => request.path.startsWith(AP_GROUPS) && request.method !== 'GET');
  }

  /**
   * How many AP-group list requests were made so far.
   * @returns {number} The count.
   */
  listReads(): number {
    return this.transport.requestsTo('GET', AP_GROUPS_PAGE).length;
  }

  /**
   * Holds the next AP-group list request until the returned deferred is
   * resolved (later requests are answered normally).
   * @returns {Deferred<void>} Resolve it to answer the held request.
   */
  holdNextList(): Deferred<void> {
    const hold = deferred<void>();
    this.listOverride = async () => {
      this.listOverride = null;
      await hold.promise;
      return this.listReply();
    };
    return hold;
  }
} // End of class Harness

/**
 * Records a reply for the final secret check and returns it.
 * @param {Promise<T>} promise - The reply promise.
 * @returns {Promise<T>} The reply.
 */
async function reply<T extends ManagedApGroupsResult | ApGroupActionResult>(promise: Promise<T>): Promise<T> {
  const value = await promise;
  replies.push(value);
  return value;
}

/**
 * Creates through the reply wrapper.
 * @param {Harness} harness - The harness.
 * @param {string} nonce - The session nonce.
 * @param {string} name - The name as typed.
 * @returns {Promise<ApGroupActionResult>} The reply.
 */
function create(harness: Harness, nonce: string, name: string): Promise<ApGroupActionResult> {
  return reply(createApGroupReply(harness.manager, { sessionNonce: nonce, name }));
}

/**
 * Renames through the reply wrapper.
 * @param {Harness} harness - The harness.
 * @param {string} nonce - The session nonce.
 * @param {string} apGroupId - The group id.
 * @param {string} name - The name as typed.
 * @returns {Promise<ApGroupActionResult>} The reply.
 */
function rename(harness: Harness, nonce: string, apGroupId: string, name: string): Promise<ApGroupActionResult> {
  return reply(renameApGroupReply(harness.manager, { sessionNonce: nonce, apGroupId, name }));
}

/**
 * Deletes through the reply wrapper.
 * @param {Harness} harness - The harness.
 * @param {string} nonce - The session nonce.
 * @param {string} apGroupId - The group id.
 * @returns {Promise<ApGroupActionResult>} The reply.
 */
function remove(harness: Harness, nonce: string, apGroupId: string): Promise<ApGroupActionResult> {
  return reply(deleteApGroupReply(harness.manager, { sessionNonce: nonce, apGroupId }));
}

/**
 * Lists through the reply wrapper.
 * @param {Harness} harness - The harness.
 * @param {string} nonce - The session nonce.
 * @returns {Promise<ManagedApGroupsResult>} The reply.
 */
function list(harness: Harness, nonce: string): Promise<ManagedApGroupsResult> {
  return reply(managedApGroupsReply(harness.manager, nonce));
}

describe('AP groups: the capacity read path', () => {
  test('management on: every group as the minimal DTO (id, name, default flag, AP count, networks, per-band remaining) plus the SSID limits', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await list(harness, nonce), {
      success: true,
      groups: [
        { id: DEFAULT_ID, name: 'Default', isDefault: true, apCount: 3, networkNames: ['Casa', 'Invitados'], remainingBinding: { band2g: 6, band5g: 6, band6g: 8 } },
        { id: GROUP_B_ID, name: 'zGrupo B', isDefault: false, apCount: 1, networkNames: ['Taller'], remainingBinding: { band2g: 7, band5g: 7, band6g: 8 } },
        { id: EMPTY_ID, name: 'zNinguna', isDefault: false, apCount: 0, networkNames: [], remainingBinding: { band2g: 8, band5g: 8, band6g: 8 } }
      ],
      ssidLimits: { band2g: 8, band5g: 8, band6g: 8, mlo: 4 }
    });
    const read = harness.openApiRequests().filter((request) => request.path === AP_GROUPS_PAGE).pop();
    assert.equal(read?.headers.Authorization, 'AccessToken=AT-session-token-1');
  }); // End of test "management on: every group as the..."

  test('missing or garbage capacity fields are absent in the DTO, never invented', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.groups[1] = { id: GROUP_B_ID, name: 'zGrupo B', primary: false, apNum: -2, ssidNameList: null, remainingBinding: { '0': -1, '1': 'x', mlo: 3 } };
    harness.groups[2] = { id: EMPTY_ID, name: 'zNinguna', apNum: 1.5, ssidNameList: 'Casa' as unknown as unknown[], remainingBinding: null };
    const result = await list(harness, nonce);
    assert.deepEqual(result.groups?.slice(1), [
      { id: GROUP_B_ID, name: 'zGrupo B', isDefault: false },
      { id: EMPTY_ID, name: 'zNinguna', isDefault: false }
    ]);
  });

  test('a network list with a non-string entry is absent in the DTO, never shortened to its string entries', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.groups[1].ssidNameList = ['Taller', null];
    harness.groups[2].ssidNameList = [42];
    const result = await list(harness, nonce);
    assert.deepEqual(result.groups?.slice(1), [
      { id: GROUP_B_ID, name: 'zGrupo B', isDefault: false, apCount: 1, remainingBinding: { band2g: 7, band5g: 7, band6g: 8 } },
      { id: EMPTY_ID, name: 'zNinguna', isDefault: false, apCount: 0, remainingBinding: { band2g: 8, band5g: 8, band6g: 8 } }
    ]);
  });

  test('management off → managementUnavailable with no AP-group request; not connected → notConnected; another nonce → superseded', async () => {
    const harness = new Harness();
    harness.credentials = null;
    assert.deepEqual(await list(harness, 'a'.repeat(32)), { success: false, error: 'notConnected' });
    const nonce = await harness.connect();
    assert.deepEqual(await list(harness, nonce), { success: false, error: 'managementUnavailable' });
    assert.deepEqual(harness.openApiRequests(), []);
    assert.deepEqual(await list(harness, 'b'.repeat(32)), { success: false, error: 'superseded' });
  });

  test('a list read failure is requestFailed with a codes-only diagnostic', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.listOverride = () => ({ status: 503, body: `<html>busy client_secret=${CLIENT_SECRET}</html>` });
    assert.deepEqual(await list(harness, nonce), { success: false, error: 'requestFailed', diagnostic: 'ap-groups: httpError, HTTP 503' });
  });
}); // End of the describe block for the capacity read path

describe('AP groups: create', () => {
  test('the name is trimmed; a fresh list is read, then POST v1 …/ap-groups with exactly {name}; the reply carries the new id', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const readsBefore = harness.listReads();
    assert.deepEqual(await create(harness, nonce, '  Aulas planta 2  '), { success: true, apGroupId: NEW_ID });
    assert.equal(harness.listReads(), readsBefore + 1, 'one fresh read before the write');
    const log = harness.transport.log();
    assert.deepEqual(log.slice(-2), [`GET ${AP_GROUPS_PAGE}`, `POST ${AP_GROUPS}`]);
    const [post] = harness.writes();
    assert.deepEqual(post.body, { name: 'Aulas planta 2' });
    assert.equal(post.headers.Authorization, 'AccessToken=AT-session-token-1');
  }); // End of test "the name is trimmed; a fresh..."

  test('invalid names are refused before any request (nameRequired, nameTooLong, nameInvalid)', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const before = harness.transport.requests.length;
    assert.deepEqual(await create(harness, nonce, '   '), { success: false, error: 'nameRequired' });
    assert.deepEqual(await create(harness, nonce, 'x'.repeat(129)), { success: false, error: 'nameTooLong' });
    assert.deepEqual(await create(harness, nonce, 'Aulas\u{202e}B'), { success: false, error: 'nameInvalid' });
    assert.equal(harness.transport.requests.length, before);
  });

  test('a name another group has on FRESH data (any case) is nameTaken and nothing is written', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await create(harness, nonce, 'ZNINGUNA'), { success: false, error: 'nameTaken' });
    // Created in Omada after the renderer loaded its list
    harness.groups.push({ id: UNKNOWN_ID, name: 'Aulas', apNum: 0, ssidNameList: [] });
    assert.deepEqual(await create(harness, nonce, 'aulas'), { success: false, error: 'nameTaken' });
    assert.deepEqual(harness.writes(), []);
  });

  test('an answer without a usable id: the id comes from a fresh list (exactly one new group with the name), else the reply has none', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.createAnswer = (name) => {
      harness.groups.push({ id: NEW_ID, name, apNum: 0, ssidNameList: [] });
      return ok({});
    };
    assert.deepEqual(await create(harness, nonce, 'Aulas'), { success: true, apGroupId: NEW_ID });
    const second = new Harness();
    const secondNonce = await second.connect();
    second.createAnswer = () => ok({ id: 42 });
    assert.deepEqual(await create(second, secondNonce, 'Aulas'), { success: true });
    // The fallback read fails by itself (no invalidation): created, no id
    const failing = new Harness();
    const failingNonce = await failing.connect();
    failing.createAnswer = (name) => {
      failing.groups.push({ id: NEW_ID, name, apNum: 0, ssidNameList: [] });
      failing.listOverride = () => ({ status: 503, body: 'busy' });
      return ok({});
    };
    assert.deepEqual(await create(failing, failingNonce, 'Aulas'), { success: true });
  }); // End of test "an answer without a usable id:..."

  test('an answer without a usable id and an invalidation during the fallback read (credentials save, re-check): superseded, not success', async () => {
    const invalidations: Array<[string, (harness: Harness, nonce: string) => Promise<unknown>]> = [
      [
        'credentials save',
        async (harness) =>
          applyManagementAccessChange(harness.manager, { url: BASE_URL, username: 'admin', language: 'es', clientId: 'owm-client-2', clientSecret: 'another-secret' })
      ],
      ['"Test management access"', (harness, nonce) => testManagementAccess(harness.manager, nonce)]
    ];
    for (const [label, invalidate] of invalidations) {
      const harness = new Harness();
      const nonce = await harness.connect();
      const held: { hold: Deferred<void> | null } = { hold: null };
      harness.createAnswer = (name) => {
        harness.groups.push({ id: NEW_ID, name, apNum: 0, ssidNameList: [] });
        // Hold the fallback read that follows this answer
        held.hold = harness.holdNextList();
        return ok({});
      };
      const pending = create(harness, nonce, 'Aulas');
      await until(() => held.hold !== null && harness.listOverride === null);
      const invalidated = invalidate(harness, nonce);
      held.hold?.resolve();
      assert.deepEqual(await pending, { success: false, error: 'superseded' }, label);
      await invalidated;
      assert.equal(harness.writes().length, 1, `${label}: the one POST`);
    } // End of the loop over the invalidations
  }); // End of test "an answer without a usable id and an invalidation..."

  test('controller errors: -33200 nameTaken, -33201 groupLimitReached, others requestFailed — codes only, never the controller text', async () => {
    const cases: Array<[FakeReply, ApGroupActionResult]> = [
      [apiError(-33200, 'This WLAN group has been already created.'), { success: false, error: 'nameTaken', diagnostic: 'apiError, errorCode -33200' }],
      [apiError(-33201), { success: false, error: 'groupLimitReached', diagnostic: 'apiError, errorCode -33201' }],
      [apiError(-33000, `site ${CLIENT_SECRET}`), { success: false, error: 'requestFailed', diagnostic: 'apiError, errorCode -33000' }],
      [apiError(-33203), { success: false, error: 'requestFailed', diagnostic: 'apiError, errorCode -33203' }],
      [{ status: 500, body: 'oops' }, { success: false, error: 'requestFailed', diagnostic: 'httpError, HTTP 500' }]
    ];
    for (const [answer, expected] of cases) {
      const harness = new Harness();
      const nonce = await harness.connect();
      harness.createAnswer = () => answer;
      assert.deepEqual(await create(harness, nonce, 'Aulas'), expected);
      assert.equal(harness.writes().length, 1, 'never retried');
    }
  }); // End of test "controller errors: -33200 nameTaken..."

  test('a truncated fresh list is groupListIncomplete and nothing is written', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    for (let page = 1; page <= 50; page++) {
      const data = Array.from({ length: 100 }, (_, index) => ({ id: `${String(page).padStart(4, '0')}${String(index).padStart(20, '0')}`, name: `G${page}-${index}`, apNum: 0, ssidNameList: [] }));
      harness.transport.on('GET', `${AP_GROUPS}?page=${page}&pageSize=100`, ok({ totalRows: 99999, data }));
    }
    assert.deepEqual(await create(harness, nonce, 'Aulas'), { success: false, error: 'groupListIncomplete', diagnostic: 'ap-groups truncated' });
    assert.deepEqual(await remove(harness, nonce, EMPTY_ID), { success: false, error: 'groupListIncomplete', diagnostic: 'ap-groups truncated' });
    assert.deepEqual(harness.writes(), []);
  });

  test('writes of one session run one at a time: two concurrent creates of the same name → one POST, the second is nameTaken', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const [first, second] = await Promise.all([create(harness, nonce, 'Aulas'), create(harness, nonce, 'AULAS')]);
    assert.deepEqual(first, { success: true, apGroupId: NEW_ID });
    assert.deepEqual(second, { success: false, error: 'nameTaken' });
    assert.equal(harness.writes().length, 1);
  });
}); // End of the describe block for create

describe('AP groups: rename', () => {
  test('PATCH v1 …/ap-groups/{id} with exactly {name} after a fresh read; the default group can be renamed; a case-only change is allowed', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await rename(harness, nonce, GROUP_B_ID, ' Aulas B '), { success: true });
    assert.deepEqual(await rename(harness, nonce, DEFAULT_ID, 'Principal'), { success: true });
    assert.deepEqual(await rename(harness, nonce, EMPTY_ID, 'ZNINGUNA'), { success: true });
    const writes = harness.writes();
    assert.deepEqual(writes.map((request) => [request.method, request.path, request.body]), [
      ['PATCH', groupPath(GROUP_B_ID), { name: 'Aulas B' }],
      ['PATCH', groupPath(DEFAULT_ID), { name: 'Principal' }],
      ['PATCH', groupPath(EMPTY_ID), { name: 'ZNINGUNA' }]
    ]);
    assert.ok(writes.every((request) => request.headers.Authorization === 'AccessToken=AT-session-token-1'));
  }); // End of test "PATCH v1 …/ap-groups/{id} with exactly {name}..."

  test('groupNotFound, nameUnchanged and nameTaken are decided on fresh data, with nothing written', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await rename(harness, nonce, UNKNOWN_ID, 'Aulas'), { success: false, error: 'groupNotFound' });
    assert.deepEqual(await rename(harness, nonce, GROUP_B_ID, '  zGrupo B '), { success: false, error: 'nameUnchanged' });
    assert.deepEqual(await rename(harness, nonce, GROUP_B_ID, 'default'), { success: false, error: 'nameTaken' });
    assert.deepEqual(await rename(harness, nonce, GROUP_B_ID, ''), { success: false, error: 'nameRequired' });
    // Renamed in Omada meanwhile: the fresh name is what counts
    harness.groups[1].name = 'Taller';
    assert.deepEqual(await rename(harness, nonce, GROUP_B_ID, 'Taller'), { success: false, error: 'nameUnchanged' });
    assert.deepEqual(harness.writes(), []);
  }); // End of test "groupNotFound, nameUnchanged and nameTaken are decided..."

  test('controller -33200 is nameTaken', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.renameAnswer = () => apiError(-33200);
    assert.deepEqual(await rename(harness, nonce, GROUP_B_ID, 'Aulas'), { success: false, error: 'nameTaken', diagnostic: 'apiError, errorCode -33200' });
  });
}); // End of the describe block for rename

describe('AP groups: delete under the app policy (fresh data right before the DELETE)', () => {
  test('a non-default group with 0 APs and no networks: the fresh read directly precedes DELETE v1 …/ap-groups/{id} (no body)', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await remove(harness, nonce, EMPTY_ID), { success: true });
    assert.deepEqual(harness.transport.log().slice(-2), [`GET ${AP_GROUPS_PAGE}`, `DELETE ${groupPath(EMPTY_ID)}`]);
    const [request] = harness.writes();
    assert.equal(request.body, undefined);
    assert.equal(request.headers.Authorization, 'AccessToken=AT-session-token-1');
    assert.equal(request.headers['Content-Type'], undefined);
  });

  test('every refusal: default, APs, networks, unknown state, unknown id — nothing is written', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await remove(harness, nonce, DEFAULT_ID), { success: false, error: 'groupIsDefault' });
    assert.deepEqual(await remove(harness, nonce, GROUP_B_ID), { success: false, error: 'groupNotEmpty' });
    harness.groups[1].apNum = 0;
    assert.deepEqual(await remove(harness, nonce, GROUP_B_ID), { success: false, error: 'groupHasNetworks' });
    harness.groups[1].ssidNameList = [];
    harness.groups[1].apNum = null;
    assert.deepEqual(await remove(harness, nonce, GROUP_B_ID), { success: false, error: 'groupStateUnknown' });
    harness.groups[1].apNum = 0;
    harness.groups[1].ssidNameList = null;
    assert.deepEqual(await remove(harness, nonce, GROUP_B_ID), { success: false, error: 'groupStateUnknown' });
    assert.deepEqual(await remove(harness, nonce, UNKNOWN_ID), { success: false, error: 'groupNotFound' });
    assert.deepEqual(harness.writes(), []);
  }); // End of test "every refusal..."

  test('fail closed: an insane network list or AP count on fresh data is groupStateUnknown, never "empty" — nothing is written', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    for (const ssidNameList of [[null], [42], 'x', ['Casa', null]]) {
      harness.groups[2] = { id: EMPTY_ID, name: 'zNinguna', apNum: 0, ssidNameList: ssidNameList as unknown[] };
      assert.deepEqual(await remove(harness, nonce, EMPTY_ID), { success: false, error: 'groupStateUnknown' }, JSON.stringify(ssidNameList));
    }
    for (const apNum of [null, '0', -1, 1.5, false]) {
      harness.groups[2] = { id: EMPTY_ID, name: 'zNinguna', apNum: apNum as number | null, ssidNameList: [] };
      assert.deepEqual(await remove(harness, nonce, EMPTY_ID), { success: false, error: 'groupStateUnknown' }, String(apNum));
    }
    assert.deepEqual(harness.writes(), []);
  }); // End of test "fail closed: an insane network list or AP count..."

  test('fresh data says non-empty although the renderer thought it empty: groupNotEmpty, no DELETE', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const shown = await list(harness, nonce);
    assert.equal(shown.groups?.find((group) => group.id === EMPTY_ID)?.apCount, 0, 'the renderer saw it empty');
    // An AP moved in after the renderer's list
    harness.groups[2].apNum = 2;
    assert.deepEqual(await remove(harness, nonce, EMPTY_ID), { success: false, error: 'groupNotEmpty' });
    // A network was bound to it meanwhile
    harness.groups[2].apNum = 0;
    harness.groups[2].ssidNameList = ['Casa'];
    assert.deepEqual(await remove(harness, nonce, EMPTY_ID), { success: false, error: 'groupHasNetworks' });
    assert.deepEqual(harness.writes(), []);
  }); // End of test "fresh data says non-empty although the..."

  test('controller -33203 is groupIsDefault (a default group the list did not flag)', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.deleteAnswer = () => apiError(-33203, 'The default WLAN group cannot be deleted.');
    assert.deepEqual(await remove(harness, nonce, EMPTY_ID), { success: false, error: 'groupIsDefault', diagnostic: 'apiError, errorCode -33203' });
  });
}); // End of the describe block for delete

describe('AP groups: bound to the current session (the 15b invalidation)', () => {
  test('capability off (credentials missing, or a mismatch) refuses every write with managementUnavailable; nothing is written', async () => {
    const harness = new Harness();
    harness.credentials = null;
    const nonce = await harness.connect();
    assert.deepEqual(await create(harness, nonce, 'Aulas'), { success: false, error: 'managementUnavailable' });
    assert.deepEqual(await rename(harness, nonce, GROUP_B_ID, 'Aulas'), { success: false, error: 'managementUnavailable' });
    assert.deepEqual(await remove(harness, nonce, EMPTY_ID), { success: false, error: 'managementUnavailable' });
    assert.deepEqual(harness.openApiRequests(), []);

    const mismatch = new Harness();
    mismatch.groups.push({ id: UNKNOWN_ID, name: 'Extra', apNum: 0, ssidNameList: [] });
    const mismatchNonce = await mismatch.connect();
    assert.equal(mismatch.manager.controller?.capabilities?.reason, 'apGroupsMismatch');
    const reads = mismatch.listReads();
    assert.deepEqual(await remove(mismatch, mismatchNonce, UNKNOWN_ID), { success: false, error: 'managementUnavailable' });
    assert.equal(mismatch.listReads(), reads);
    assert.deepEqual(mismatch.writes(), []);
  }); // End of test "capability off..."

  test('a superseding connect while the fresh read is held: superseded, and the DELETE is never sent', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const hold = harness.holdNextList();
    const pending = remove(harness, nonce, EMPTY_ID);
    await until(() => harness.listOverride === null);
    const reconnect = harness.manager.connect();
    hold.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    const result = await reconnect;
    assert.equal(result.success, true);
    assert.deepEqual(harness.writes(), []);
    // The old nonce now names no session of this connect
    assert.deepEqual(await remove(harness, nonce, EMPTY_ID), { success: false, error: 'superseded' });
    assert.deepEqual(await list(harness, nonce), { success: false, error: 'superseded' });
    assert.deepEqual(harness.writes(), []);
  }); // End of test "a superseding connect..."

  test('a disconnect while the DELETE answer is held: the late answer is discarded (superseded)', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const answer = deferred<FakeReply>();
    harness.deleteAnswer = () => answer.promise;
    const pending = remove(harness, nonce, EMPTY_ID);
    await until(() => harness.writes().length === 1);
    await harness.manager.disconnect();
    answer.resolve(ok());
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.deepEqual(await create(harness, nonce, 'Aulas'), { success: false, error: 'notConnected' });
  }); // End of test "a disconnect while the DELETE answer..."

  test('"Test management access" (a new check run) while a rename reads: the old client is dropped, superseded, no PATCH', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const hold = harness.holdNextList();
    const pending = rename(harness, nonce, GROUP_B_ID, 'Aulas');
    await until(() => harness.listOverride === null);
    const retest = testManagementAccess(harness.manager, nonce);
    hold.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.equal((await retest).capabilities?.manageApGroups, true);
    assert.deepEqual(harness.writes(), []);
    // The new run's client serves the next call
    assert.deepEqual(await rename(harness, nonce, GROUP_B_ID, 'Aulas'), { success: true });
  }); // End of test ""Test management access" (a new check..."

  test('a management-credentials save while a create reads: superseded, no POST; the next call re-checks with the new credentials', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const hold = harness.holdNextList();
    const pending = create(harness, nonce, 'Aulas');
    await until(() => harness.listOverride === null);
    applyManagementAccessChange(harness.manager, { url: BASE_URL, username: 'admin', language: 'es', clientId: 'owm-client-2', clientSecret: 'another-secret' });
    hold.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.deepEqual(harness.writes(), []);
    const tokensBefore = harness.tokensIssued;
    assert.deepEqual(await create(harness, nonce, 'Aulas'), { success: true, apGroupId: NEW_ID });
    assert.equal(harness.tokensIssued, tokensBefore + 1, 'the checks ran again (a new token) before the write');
  }); // End of test "a management-credentials save while a create..."
}); // End of the describe block for session binding

describe('AP groups: redaction', () => {
  test('no reply and no log line carries the Client Secret, a token or controller text', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.createAnswer = () => apiError(-1, `failed client_secret=${CLIENT_SECRET} Authorization: AccessToken=AT-session-token-1`);
    harness.deleteAnswer = () => ({ status: 502, body: { errorCode: -1, msg: `token AT-session-token-1 ${CLIENT_SECRET}` } });
    replies.push(await create(harness, nonce, 'Aulas'));
    replies.push(await remove(harness, nonce, EMPTY_ID));
    const text = JSON.stringify(replies) + logLines.join('\n');
    assert.ok(replies.length > 30, 'every reply of this file is checked');
    assert.ok(!text.includes(CLIENT_SECRET), 'no Client Secret');
    assert.ok(!/AT-session-token-\d/.test(text), 'no access token');
    assert.ok(!text.includes('client_secret'), 'no controller text');
    assert.ok(!text.includes('already created'), 'no controller message');
  }); // End of test "no reply and no log line..."
}); // End of the describe block for redaction
