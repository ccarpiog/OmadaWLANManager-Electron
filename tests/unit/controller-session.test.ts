// Tests for the controller session facade (src/main/controller-session.ts)
// driven end to end — the real ConnectionManager, the real OmadaController and
// the real OpenApiClient over one fake transport (no Electron, no network),
// with the internal fixtures of tests/fixtures/controller/responses.json:
// - the capability matrix of docs/management-design.md §2.2 (each failing
//   check turns management off with its own reason code, in check order),
//   incl. the site-id mismatch and the AP-group id-set mismatches (missing,
//   extra, same names with different ids — never matched by name);
// - the checks never delay or fail the connect or the AP list, and the
//   Client Secret goes out only in the token request, after the internal
//   /api/info handshake and login;
// - every invalidation (certificate reset, URL change, disconnect, a
//   superseding connect) closes the Open API client and drops its token at
//   once, and late check results are discarded (nothing more is sent) — a
//   new connect does so before its first await, so the old session nonce
//   answers notConnected while the new internal login is still pending;
// - a management-credentials save starts no check run of its own: the
//   reconnect the Settings flow performs runs the checks once (one token);
// - the site name and the session nonce reach the renderer, the
//   session-nonce ownership of the management-access replies, "Test
//   management access", and that no reply, log line or error string ever
//   carries the Client Secret or a token.

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { ConnectionManager } from '../../src/main/connection-manager';
import {
  applyManagementAccessChange,
  compareIdSets,
  ControllerSession,
  describeOpenApiFailure,
  getSessionCapabilities,
  managementOff,
  managementOn,
  testManagementAccess,
  touchesManagementAccess,
  type ManagementCredentials
} from '../../src/main/controller-session';
import { OpenApiClient, OpenApiError, TOKEN_PATH } from '../../src/main/openapi-client';
import type { ConfigSavePayload, ConnectionResult, ManagementCapabilitiesResult, ManagementReason } from '../../src/shared/types';
import responses from '../fixtures/controller/responses.json';
import { FakeTransport, type FakeReply, type RecordedRequest } from './helpers/fake-transport';
import { reachableStrings } from './helpers/reachable-strings';

const BASE_URL = 'https://controller.invalid:8043';
const OTHER_URL = 'https://other-controller.invalid:8043';
const OMADAC_ID = responses.apiInfo.result.omadacId;
const SITE_ID = responses.sitesSingle.result.data[0].id;
const SITE_B = responses.sitesMulti.result.data[1].id;
const LOGIN_PATH = `/${OMADAC_ID}/api/v2/login`;
const LOGOUT_PATH = `/${OMADAC_ID}/api/v2/logout`;
const SITES_PATH = `/${OMADAC_ID}/api/v2/sites?currentPage=1&currentPageSize=100`;
const OPENAPI_SITES = `/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`;
// The internal group list (setting/wlans) of the fixture: 3 groups
const GROUPS = responses.wlans.result.data.map((group) => ({ id: group.id, name: group.name }));
const CLIENT_ID = 'owm-client-1';
const CLIENT_SECRET = 'Cl1ent-S3cret-Value-Never-Shown';
const NONCE_REGEX = /^[0-9a-f]{32}$/;

/**
 * The internal setting/wlans path of a site.
 * @param {string} siteId - Site id.
 * @returns {string} The path.
 */
function wlansPath(siteId: string): string {
  return `/${OMADAC_ID}/api/v2/sites/${siteId}/setting/wlans`;
}

/**
 * The internal devices path of a site.
 * @param {string} siteId - Site id.
 * @returns {string} The path.
 */
function devicesPath(siteId: string): string {
  return `/${OMADAC_ID}/api/v2/sites/${siteId}/devices`;
}

/**
 * The Open API ap-groups path (first page) of a site.
 * @param {string} siteId - Site id.
 * @returns {string} The path.
 */
function apGroupsPath(siteId: string): string {
  return `/openapi/v1/${OMADAC_ID}/sites/${siteId}/ap-groups?page=1&pageSize=100`;
}

/**
 * A successful Open API envelope.
 * @param {unknown} result - The result.
 * @returns {FakeReply} The reply.
 */
function ok(result: unknown): FakeReply {
  return { body: { errorCode: 0, msg: 'Success.', result } };
}

/**
 * A successful token reply.
 * @param {string} token - The access token.
 * @returns {FakeReply} The reply.
 */
function tokenReply(token: string): FakeReply {
  return ok({ accessToken: token, tokenType: 'bearer', expiresIn: 7200, refreshToken: `RT-${token}` });
}

/**
 * One Open API page of sites.
 * @param {Array<{ siteId: string; name: string }>} sites - The entries.
 * @returns {FakeReply} The reply.
 */
function sitesPage(sites: Array<{ siteId: string; name: string }>): FakeReply {
  return ok({ totalRows: sites.length, currentPage: 1, currentSize: sites.length, data: sites });
}

/**
 * One Open API page of AP groups.
 * @param {Array<{ id: string; name: string }>} groups - The entries.
 * @returns {FakeReply} The reply.
 */
function apGroupsPage(groups: Array<{ id: string; name: string }>): FakeReply {
  return ok({ totalRows: groups.length, currentPage: 1, currentSize: groups.length, data: groups.map((group) => ({ ...group, apNum: 1 })) });
}

/** A promise with its settle function exposed. */
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

/**
 * The fake environment: one transport serving the internal API and the Open
 * API, the configured URL and management credentials, the real
 * ConnectionManager over ControllerSessions, and every Open API client the
 * sessions create.
 */
class Harness {
  readonly transport = new FakeTransport(BASE_URL);
  configuredUrl = BASE_URL;
  storedSiteId = '';
  credentials: ManagementCredentials | null = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
  tokensIssued = 0;
  readonly clients: OpenApiClient[] = [];
  readonly sessions: ControllerSession[] = [];
  readonly manager: ConnectionManager<ControllerSession>;

  /**
   * Builds a harness where every check passes (Omada 6.3, single site,
   * matching AP groups, credentials configured).
   */
  constructor() {
    this.transport
      .on('GET', '/api/info', { body: responses.apiInfo, setCookie: 'TPOMADA_SESSIONID=session-1; Path=/; HttpOnly' })
      .on('POST', LOGIN_PATH, { body: responses.loginOk })
      .on('GET', SITES_PATH, { body: responses.sitesSingle })
      .on('GET', wlansPath(SITE_ID), { body: responses.wlans })
      .on('GET', `/${OMADAC_ID}/api/v2/sites/${SITE_ID}/setting/ssids`, { body: responses.ssids })
      .on('GET', devicesPath(SITE_ID), { body: responses.devices })
      .on('POST', LOGOUT_PATH, { body: responses.ok })
      .on('POST', TOKEN_PATH, () => tokenReply(`AT-session-token-${++this.tokensIssued}`))
      .on('GET', OPENAPI_SITES, sitesPage([{ siteId: SITE_ID, name: 'Casa' }]))
      .on('GET', apGroupsPath(SITE_ID), apGroupsPage(GROUPS));
    this.manager = new ConnectionManager<ControllerSession>({
      getCredentials: () => ({ url: this.configuredUrl, username: 'admin', password: 'internal-password' }),
      createController: (credentials) => {
        const session = new ControllerSession({
          ...credentials,
          transport: this.transport,
          getManagementCredentials: () => this.credentials,
          getConfiguredUrl: () => this.configuredUrl,
          createOpenApiClient: (options) => {
            const client = new OpenApiClient(options);
            this.clients.push(client);
            return client;
          }
        });
        this.sessions.push(session);
        return session;
      }, // End of the createController dependency
      getConfiguredUrl: () => this.configuredUrl,
      getStoredSiteId: () => this.storedSiteId,
      saveStoredSiteId: (siteId) => {
        this.storedSiteId = siteId;
      },
      saveCertificatePin: () => true,
      clearCertificatePin: () => true,
      resetControllerSession: () => Promise.resolve(),
      logoutDrainMs: 20
    });
  } // End of constructor()

  /**
   * The most recently created session.
   * @returns {ControllerSession} The session.
   */
  get session(): ControllerSession {
    const session = this.sessions[this.sessions.length - 1];
    assert.ok(session, 'a session was created');
    return session;
  }

  /**
   * Connects and returns the successful result (asserted).
   * @returns {Promise<ConnectionResult>} The connect result.
   */
  async connect(): Promise<ConnectionResult> {
    const result = await this.manager.connect();
    assert.equal(result.success, true, JSON.stringify(result));
    return result;
  }

  /**
   * Connects and waits for the capabilities of the installed session.
   * @returns {Promise<{ result: ConnectionResult; reply: ManagementCapabilitiesResult }>} Both replies.
   */
  async connectAndCheck(): Promise<{ result: ConnectionResult; reply: ManagementCapabilitiesResult }> {
    const result = await this.connect();
    const reply = await getSessionCapabilities(this.manager, result.sessionNonce as string);
    return { result, reply };
  }

  /**
   * The recorded requests whose path starts with /openapi (the token included).
   * @returns {RecordedRequest[]} The Open API requests.
   */
  openApiRequests(): RecordedRequest[] {
    return this.transport.requests.filter((request) => request.path.startsWith('/openapi'));
  }
} // End of class Harness

/**
 * Runs the full connect + checks with one route replaced, and returns the
 * capabilities reply.
 * @param {(harness: Harness) => void} arrange - Changes the harness before connecting.
 * @returns {Promise<{ harness: Harness; reply: ManagementCapabilitiesResult }>} The harness and the reply.
 */
async function checkWith(arrange: (harness: Harness) => void): Promise<{ harness: Harness; reply: ManagementCapabilitiesResult }> {
  const harness = new Harness();
  arrange(harness);
  const { reply } = await harness.connectAndCheck();
  return { harness, reply };
}

/**
 * Asserts that a reply turned management off with the given reason (and,
 * when given, diagnostic).
 * @param {ManagementCapabilitiesResult} reply - The reply.
 * @param {ManagementReason} reason - Expected reason.
 * @param {string} [diagnostic] - Expected diagnostic.
 */
function assertOff(reply: ManagementCapabilitiesResult, reason: ManagementReason, diagnostic?: string): void {
  assert.equal(reply.success, true, JSON.stringify(reply));
  assert.equal(reply.capabilities?.manageApGroups, false);
  assert.equal(reply.capabilities?.manageWifiNetworks, false);
  assert.equal(reply.capabilities?.reason, reason, JSON.stringify(reply));
  if (diagnostic !== undefined) {
    assert.equal(reply.capabilities?.diagnostic, diagnostic);
  }
}

describe('ControllerSession: the capability matrix (spec §2.2)', () => {
  test('every check passes: management on; the secret goes out only in the token request, after /api/info and the login, over the session transport', async () => {
    const { harness, reply } = await checkWith(() => {});
    assert.deepEqual(reply, { success: true, capabilities: { manageApGroups: true, manageWifiNetworks: true, reason: null } });
    const log = harness.transport.log();
    assert.deepEqual(log.slice(0, 3), ['GET /api/info', `POST ${LOGIN_PATH}`, `GET ${SITES_PATH}`]);
    assert.equal(log[3], `POST ${TOKEN_PATH}`, 'the token request follows the internal connect');
    const withSecret = harness.transport.requests.filter((request) => JSON.stringify(request).includes(CLIENT_SECRET));
    assert.deepEqual(withSecret.map((request) => request.path), [TOKEN_PATH]);
    assert.deepEqual(withSecret[0].body, { omadacId: OMADAC_ID, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    const reads = harness.openApiRequests().filter((request) => request.method === 'GET');
    assert.deepEqual(reads.map((request) => request.path).sort(), [OPENAPI_SITES, apGroupsPath(SITE_ID)].sort());
    assert.ok(reads.every((request) => request.headers.Authorization === 'AccessToken=AT-session-token-1'));
    assert.ok(harness.transport.requestsTo('GET', wlansPath(SITE_ID)).length >= 1, 'the internal group list was compared');
    const session = harness.session;
    assert.equal(session.openApiClient?.isClosed, false, 'the verified client is kept for management calls');
    assert.equal(session.omadacId, OMADAC_ID);
    assert.deepEqual(session.site, { id: SITE_ID, name: 'Casa' });
    assert.equal(session.controllerVersion, '6.3.0.45');
    assert.equal(session.groupModel, 'apGroup');
    assert.equal(session.url, BASE_URL);
  }); // End of test "every check passes..."

  test('the checks never delay or fail the connect or the AP list (a management failure is not a connection failure)', async () => {
    const harness = new Harness();
    const hold = deferred<FakeReply>();
    harness.transport.on('POST', TOKEN_PATH, () => hold.promise);
    const result = await harness.connect();
    await until(() => harness.transport.requestsTo('POST', TOKEN_PATH).length === 1);
    assert.equal(harness.session.capabilities, null, 'still checking');
    const aps = await harness.session.getAccessPoints();
    assert.ok(aps.length > 0, 'the AP list loads while the token request hangs');
    const waiting = getSessionCapabilities(harness.manager, result.sessionNonce as string);
    hold.resolve({ status: 500, body: '<html>Internal Server Error</html>' });
    assertOff(await waiting, 'tokenFailed', 'httpError, HTTP 500');
    assert.equal(harness.manager.controller, harness.session, 'the session stays installed');
    assert.ok((await harness.session.getWlanGroups()).groups.length === GROUPS.length);
  }); // End of test "the checks never delay or fail the connect or the AP list..."

  test('check 1: a controller before 6.3 is legacyController, checked before the credentials; no Open API request at all', async () => {
    for (const credentials of [{ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, null]) {
      const { harness, reply } = await checkWith((target) => {
        target.credentials = credentials;
        target.transport.on('GET', '/api/info', { body: { ...responses.apiInfo, result: { ...responses.apiInfo.result, controllerVer: '5.15.24.18' } } });
      });
      assertOff(reply, 'legacyController');
      assert.equal(reply.capabilities?.diagnostic, undefined);
      assert.deepEqual(harness.openApiRequests(), []);
      assert.equal(harness.clients.length, 0);
    }
  }); // End of test "check 1: a controller before 6.3 is legacyController..."

  test('check 2: no Client ID + Client Secret configured is managementNotConfigured; no Open API request', async () => {
    const { harness, reply } = await checkWith((target) => {
      target.credentials = null;
    });
    assertOff(reply, 'managementNotConfigured');
    assert.deepEqual(harness.openApiRequests(), []);
  });

  test('check 3: the token endpoint refusing the Client ID / Secret is invalidCredentials (HTTP 401, HTTP 403, errorCode -44106)', async () => {
    const cases: Array<[FakeReply, string]> = [
      [{ status: 401, body: '' }, 'invalidCredentials, HTTP 401'],
      [{ status: 403, body: { errorCode: -1, msg: 'Forbidden' } }, 'invalidCredentials, HTTP 403'],
      [{ body: { errorCode: -44106, msg: 'The client id or client secret is invalid.' } }, 'invalidCredentials, errorCode -44106']
    ];
    for (const [tokenAnswer, diagnostic] of cases) {
      const { harness, reply } = await checkWith((target) => {
        target.transport.on('POST', TOKEN_PATH, tokenAnswer);
      });
      assertOff(reply, 'invalidCredentials', diagnostic);
      assert.deepEqual(harness.openApiRequests().map((request) => request.path), [TOKEN_PATH], 'nothing after the refused token');
      assert.equal(harness.clients[0].isClosed, true, 'the failed run closes its client');
      assert.equal(harness.session.openApiClient, null);
    }
  }); // End of test "check 3: the token endpoint refusing..."

  test('check 3: any other token failure is tokenFailed (HTTP 500, an unknown errorCode, a malformed token, a network error, a timeout)', async () => {
    const cases: Array<[FakeReply | (() => never), string]> = [
      [{ status: 500, body: 'oops' }, 'httpError, HTTP 500'],
      [{ body: { errorCode: -1, msg: 'General error.' } }, 'apiError, errorCode -1'],
      [ok({ accessToken: 'has a space' }), 'malformedResponse'],
      [() => { throw new Error('net::ERR_CONNECTION_RESET'); }, 'networkError'],
      [() => { throw new Error('Request timeout after 15000 ms'); }, 'timeout']
    ];
    for (const [tokenAnswer, diagnostic] of cases) {
      const { reply } = await checkWith((target) => {
        target.transport.on('POST', TOKEN_PATH, tokenAnswer);
      });
      assertOff(reply, 'tokenFailed', diagnostic);
    }
  }); // End of test "check 3: any other token failure..."

  test('check 4: an Open API site list without the selected internal site id is siteNotFound — also when a site has the same name; no AP-group request follows', async () => {
    for (const sites of [[{ siteId: '64f0c0ffee0000000000ffff', name: 'Casa' }], []]) {
      const { harness, reply } = await checkWith((target) => {
        target.transport.on('GET', OPENAPI_SITES, sitesPage(sites));
      });
      assertOff(reply, 'siteNotFound', `sites ${sites.length}`);
      assert.equal(harness.transport.requestsTo('GET', apGroupsPath(SITE_ID)).length, 0);
    }
  });

  test('check 4: a site probe that cannot be read is probeFailed', async () => {
    const { reply } = await checkWith((target) => {
      target.transport.on('GET', OPENAPI_SITES, { body: { errorCode: -1005, msg: 'Permission denied.' } });
    });
    assertOff(reply, 'probeFailed', 'sites: apiError, errorCode -1005');
  });

  test('check 5: the AP-group id set must EQUAL the internal setting/wlans id set — a missing id, an extra id, or the same names with other ids turn management off', async () => {
    const cases: Array<[string, Array<{ id: string; name: string }>, string]> = [
      ['missing', GROUPS.slice(1), 'Open API only 0, controller only 1, shared 2'],
      ['extra', [...GROUPS, { id: '6512a0e1f3b2c41d2e3f4aff', name: 'Nuevo' }], 'Open API only 1, controller only 0, shared 3'],
      ['same names, other ids', GROUPS.map((group, index) => ({ id: `7000c0ffee000000000000a${index}`, name: group.name })), 'Open API only 3, controller only 3, shared 0']
    ];
    for (const [name, groups, diagnostic] of cases) {
      const { harness, reply } = await checkWith((target) => {
        target.transport.on('GET', apGroupsPath(SITE_ID), apGroupsPage(groups));
      });
      assertOff(reply, 'apGroupsMismatch', diagnostic);
      assert.equal(harness.session.openApiClient, null, name);
      assert.ok(harness.clients.every((client) => client.isClosed), name);
    }
  }); // End of test "check 5: the AP-group id set must EQUAL..."

  test('check 5: ids are compared as a set — another order and other names (never matched by name) keep management on', async () => {
    const { reply } = await checkWith((target) => {
      target.transport.on('GET', apGroupsPath(SITE_ID), apGroupsPage([...GROUPS].reverse().map((group) => ({ id: group.id, name: `${group.name} (renamed)` }))));
    });
    assert.deepEqual(reply.capabilities, managementOn());
  });

  test('check 5: an AP-group probe or an internal group list that cannot be read is probeFailed', async () => {
    const groupsFailing = await checkWith((target) => {
      target.transport.on('GET', apGroupsPath(SITE_ID), { status: 502, body: 'Bad gateway' });
    });
    assertOff(groupsFailing.reply, 'probeFailed', 'ap-groups: httpError, HTTP 502');
    const internalFailing = await checkWith((target) => {
      target.transport.on('GET', wlansPath(SITE_ID), { body: { errorCode: -1600, msg: 'Unsupported request path.' } });
    });
    assertOff(internalFailing.reply, 'probeFailed', 'internal group list');
  });
}); // End of describe 'the capability matrix'

describe('ControllerSession: invalidation drops the Open API client and its token', () => {
  const transitions: Array<[string, (harness: Harness) => Promise<unknown>]> = [
    ['certificate reset', (harness) => harness.manager.resetCertificate()],
    [
      'controller URL change',
      (harness) =>
        harness.manager.applyConfigSave(() => {
          harness.configuredUrl = OTHER_URL;
          return { success: true, urlChanged: true };
        })
    ],
    ['disconnect', (harness) => harness.manager.disconnect()]
  ];

  for (const [name, transition] of transitions) {
    test(`${name}: the client is closed in the same synchronous step, the token is gone and the old nonce answers notConnected`, async () => {
      const harness = new Harness();
      const { result, reply } = await harness.connectAndCheck();
      assert.equal(reply.capabilities?.reason, null);
      const session = harness.session;
      const client = session.openApiClient;
      assert.ok(client && !client.isClosed);
      const done = transition(harness);
      assert.equal(client.isClosed, true, 'closed before the transition awaited anything');
      assert.equal(session.isClosed, true);
      assert.equal(session.openApiClient, null);
      assert.equal(session.capabilities, null);
      await done;
      const before = harness.transport.requests.length;
      await assert.rejects(client.request('GET', 'v1', ['sites']), (error: unknown) => error instanceof OpenApiError && error.code === 'clientClosed');
      assert.equal(harness.transport.requests.length, before, 'a closed client sends nothing (no token survives)');
      assert.deepEqual(await getSessionCapabilities(harness.manager, result.sessionNonce as string), { success: false, error: 'notConnected' });
    }); // End of test "<transition>: the client is closed..."
  } // End of the loop over the transitions

  test('a superseding connect closes the previous session\'s client; the new session acquires a NEW token and the old one is never sent again', async () => {
    const harness = new Harness();
    const first = await harness.connectAndCheck();
    const oldClient = harness.session.openApiClient;
    const second = await harness.connectAndCheck();
    assert.equal(oldClient?.isClosed, true);
    assert.equal(second.reply.capabilities?.reason, null);
    assert.equal(harness.tokensIssued, 2);
    assert.deepEqual(await getSessionCapabilities(harness.manager, first.result.sessionNonce as string), { success: false, error: 'superseded' });
    const tokenIndexes = harness.transport.requests.flatMap((request, index) => (request.path === TOKEN_PATH ? [index] : []));
    const afterSecondToken = harness.transport.requests.slice(tokenIndexes[1] + 1).filter((request) => request.path.startsWith('/openapi/v1'));
    assert.ok(afterSecondToken.length > 0);
    assert.ok(afterSecondToken.every((request) => request.headers.Authorization === 'AccessToken=AT-session-token-2'));
  }); // End of test "a superseding connect closes the previous session's client..."

  test('late results are discarded: a probe reply arriving after a disconnect installs nothing, the waiter hears "superseded", and nothing more is sent', async () => {
    const harness = new Harness();
    const hold = deferred<FakeReply>();
    harness.transport.on('GET', OPENAPI_SITES, () => hold.promise);
    const result = await harness.connect();
    await until(() => harness.transport.requestsTo('GET', OPENAPI_SITES).length === 1);
    const session = harness.session;
    const waiting = getSessionCapabilities(harness.manager, result.sessionNonce as string);
    await harness.manager.disconnect();
    assert.deepEqual(await waiting, { success: false, error: 'superseded' });
    const sentBefore = harness.transport.log();
    hold.resolve(sitesPage([{ siteId: SITE_ID, name: 'Casa' }]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(harness.transport.log(), sentBefore, 'no AP-group, group-list or token request after the late reply');
    assert.equal(session.capabilities, null);
    assert.equal(session.openApiClient, null);
    assert.ok(harness.clients.every((client) => client.isClosed));
  }); // End of test "late results are discarded..."

  test('a check run superseded by a newer one (Test management access) never reports; every waiter gets the newest result', async () => {
    const harness = new Harness();
    const hold = deferred<FakeReply>();
    harness.transport.on('POST', TOKEN_PATH, () => hold.promise);
    const result = await harness.connect();
    await until(() => harness.transport.requestsTo('POST', TOKEN_PATH).length === 1);
    const waiting = getSessionCapabilities(harness.manager, result.sessionNonce as string);
    // The credentials were removed meanwhile: the newer run decides at once
    harness.credentials = null;
    const tested = await testManagementAccess(harness.manager, result.sessionNonce as string);
    assertOff(tested, 'managementNotConfigured');
    assertOff(await waiting, 'managementNotConfigured');
    assert.equal(harness.clients[0].isClosed, true, 'the superseded run\'s client was closed');
    hold.resolve(tokenReply('AT-late-token'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(harness.session.capabilities?.reason, 'managementNotConfigured', 'the late run changed nothing');
    assert.equal(harness.transport.requestsTo('GET', OPENAPI_SITES).length, 0);
  }); // End of test "a check run superseded by a newer one..."
}); // End of describe 'invalidation drops the Open API client and its token'

describe('ControllerSession: what reaches the renderer', () => {
  test('the site name and the session nonce: a single-site controller, a multi-site selection and a remembered site', async () => {
    const single = new Harness();
    single.credentials = null;
    const singleResult = await single.connect();
    assert.equal(singleResult.siteName, 'Casa');
    assert.match(singleResult.sessionNonce as string, NONCE_REGEX);

    const multi = new Harness();
    multi.credentials = null;
    multi.transport.on('GET', SITES_PATH, { body: responses.sitesMulti });
    const pending = await multi.manager.connect();
    assert.equal(pending.needsSiteSelection, true);
    assert.equal(pending.siteName, undefined, 'nothing before a site is chosen');
    const selected = multi.manager.selectSite(SITE_B, pending.selectionNonce as string);
    assert.equal(selected.success, true);
    assert.equal(selected.siteName, 'Oficina');
    assert.equal(selected.sessionNonce, multi.session.sessionNonce);

    const remembered = await multi.connect();
    assert.equal(remembered.siteName, 'Oficina', 'the remembered site is named too');
    assert.notEqual(remembered.sessionNonce, selected.sessionNonce, 'every session has its own nonce');
  }); // End of test "the site name and the session nonce..."

  test('session ownership: notConnected without an installed session (or with a site still to pick), superseded for another session\'s nonce', async () => {
    const harness = new Harness();
    harness.credentials = null;
    const nonce = 'a'.repeat(32);
    assert.deepEqual(await getSessionCapabilities(harness.manager, nonce), { success: false, error: 'notConnected' });
    assert.deepEqual(await testManagementAccess(harness.manager, nonce), { success: false, error: 'notConnected' });
    harness.transport.on('GET', SITES_PATH, { body: responses.sitesMulti });
    const pending = await harness.manager.connect();
    assert.equal(pending.needsSiteSelection, true);
    assert.deepEqual(await getSessionCapabilities(harness.manager, nonce), { success: false, error: 'notConnected' });
    harness.transport.on('GET', SITES_PATH, { body: responses.sitesSingle });
    const result = await harness.connect();
    assert.notEqual(result.sessionNonce, nonce);
    assert.deepEqual(await getSessionCapabilities(harness.manager, nonce), { success: false, error: 'superseded' });
    assert.deepEqual(await testManagementAccess(harness.manager, nonce), { success: false, error: 'superseded' });
  }); // End of test "session ownership..."

  test('Test management access runs the checks again with the credentials configured now (a fresh token, the session-only secret when that is all there is) and becomes the session\'s capabilities', async () => {
    const harness = new Harness();
    const { result, reply } = await harness.connectAndCheck();
    assert.equal(reply.capabilities?.reason, null);
    const nonce = result.sessionNonce as string;
    harness.transport.on('POST', TOKEN_PATH, { status: 401, body: '' });
    assertOff(await testManagementAccess(harness.manager, nonce), 'invalidCredentials', 'invalidCredentials, HTTP 401');
    assert.equal(harness.session.capabilities?.reason, 'invalidCredentials');
    assertOff(await getSessionCapabilities(harness.manager, nonce), 'invalidCredentials');
    harness.credentials = { clientId: CLIENT_ID, clientSecret: 'session-only-secret' };
    harness.transport.on('POST', TOKEN_PATH, () => tokenReply(`AT-session-token-${++harness.tokensIssued}`));
    assert.deepEqual(await testManagementAccess(harness.manager, nonce), { success: true, capabilities: managementOn() });
    const tokenRequests = harness.transport.requestsTo('POST', TOKEN_PATH);
    assert.deepEqual(tokenRequests[tokenRequests.length - 1].body, { omadacId: OMADAC_ID, client_id: CLIENT_ID, client_secret: 'session-only-secret' });
    assert.equal(tokenRequests.length, 3, 'every test acquires a fresh token');
  }); // End of test "Test management access runs the checks again..."

  test('no IPC reply, log line or error string carries the Client Secret or a token — also when the controller echoes them back', async () => {
    const echoed = `invalid client_secret ${CLIENT_SECRET} for token AT-session-token-1`;
    const replies: unknown[] = [];
    const harness = new Harness();
    const { result, reply } = await harness.connectAndCheck();
    replies.push(result, reply);
    const nonce = result.sessionNonce as string;
    harness.transport.on('GET', apGroupsPath(SITE_ID), { status: 500, body: { errorCode: -1, msg: echoed } });
    replies.push(await testManagementAccess(harness.manager, nonce));
    harness.transport.on('POST', TOKEN_PATH, { body: { errorCode: -44106, msg: echoed } });
    replies.push(await testManagementAccess(harness.manager, nonce));
    harness.transport.on('POST', TOKEN_PATH, { body: { errorCode: -7, msg: echoed } });
    replies.push(await testManagementAccess(harness.manager, nonce));
    replies.push(await getSessionCapabilities(harness.manager, nonce));
    replies.push(await harness.manager.resetCertificate());
    replies.push(await getSessionCapabilities(harness.manager, nonce));
    const serialized = [JSON.stringify(replies), JSON.stringify(harness.session), ...logLines].join('\n');
    for (const secret of [CLIENT_SECRET, 'AT-session-token-1', 'AT-session-token-2', 'RT-AT-session-token-1', 'internal-password']) {
      assert.equal(serialized.includes(secret), false, `${secret} leaked`);
    }
    assert.ok(logLines.some((line) => line.includes('Management access check: probeFailed')), 'the failure was logged (redacted)');
  }); // End of test "no IPC reply, log line or error string carries..."
}); // End of describe 'what reaches the renderer'

describe('controller-session helpers', () => {
  test('managementOn / managementOff', () => {
    assert.deepEqual(managementOn(), { manageApGroups: true, manageWifiNetworks: true, reason: null });
    assert.deepEqual(managementOff('siteNotFound'), { manageApGroups: false, manageWifiNetworks: false, reason: 'siteNotFound' });
    assert.deepEqual(managementOff('tokenFailed', 'timeout'), { manageApGroups: false, manageWifiNetworks: false, reason: 'tokenFailed', diagnostic: 'timeout' });
  });

  test('describeOpenApiFailure uses codes and numbers only, never the message', () => {
    const error = new OpenApiError('httpError', `HTTP 404 ${CLIENT_SECRET}`, { httpStatus: 404, controllerErrorCode: -1 });
    assert.equal(describeOpenApiFailure(error), 'httpError, HTTP 404, errorCode -1');
    assert.equal(describeOpenApiFailure(new OpenApiError('timeout', 'x')), 'timeout');
    assert.equal(describeOpenApiFailure(new Error(CLIENT_SECRET)), 'unexpected');
  });

  test('compareIdSets compares sets (order and duplicates ignored)', () => {
    assert.deepEqual(compareIdSets(['a', 'b', 'b'], ['b', 'a']), { equal: true, openApiOnly: 0, internalOnly: 0, shared: 2 });
    assert.deepEqual(compareIdSets(['a', 'c'], ['a', 'b']), { equal: false, openApiOnly: 1, internalOnly: 1, shared: 1 });
    assert.deepEqual(compareIdSets([], []), { equal: true, openApiOnly: 0, internalOnly: 0, shared: 0 });
  });

  test('touchesManagementAccess: only a Client ID, a Client Secret or a removal invalidates the checks after a save', () => {
    const base = { url: BASE_URL, username: 'admin', language: 'es' as const };
    assert.equal(touchesManagementAccess(base), false);
    assert.equal(touchesManagementAccess({ ...base, password: 'x' }), false);
    assert.equal(touchesManagementAccess({ ...base, clientId: 'c' }), true);
    assert.equal(touchesManagementAccess({ ...base, clientId: 'c', clientSecret: 's' }), true);
    assert.equal(touchesManagementAccess({ ...base, removeManagementAccess: true }), true);
  });
}); // End of describe 'controller-session helpers'

describe('ControllerSession: a new connect closes the installed session before its first await (held-connect window)', () => {
  test('while the new internal login is pending, the old Open API client is closed with no token left, the old nonce answers notConnected on both channels, nothing is sent for it, and its internal client still serves the data', async () => {
    const harness = new Harness();
    const { result, reply } = await harness.connectAndCheck();
    assert.equal(reply.capabilities?.reason, null);
    const nonce = result.sessionNonce as string;
    const old = harness.session;
    const oldClient = old.openApiClient;
    assert.ok(oldClient && !oldClient.isClosed);
    assert.ok((await reachableStrings(oldClient)).includes('AT-session-token-1'), 'the open client holds its token');
    const login = deferred<FakeReply>();
    harness.transport.on('POST', LOGIN_PATH, () => login.promise);
    const connecting = harness.manager.connect();
    // Synchronous part of connect(), before its first await
    assert.equal(oldClient.isClosed, true, 'closed in the same step as the generation claim');
    assert.equal(old.isClosed, true);
    assert.equal(old.openApiClient, null);
    assert.equal(old.capabilities, null);
    await until(() => harness.transport.requestsTo('POST', LOGIN_PATH).length === 2);
    const openApiBefore = harness.openApiRequests().length;
    assert.deepEqual(await getSessionCapabilities(harness.manager, nonce), { success: false, error: 'notConnected' });
    assert.deepEqual(await testManagementAccess(harness.manager, nonce), { success: false, error: 'notConnected' });
    assert.equal(harness.openApiRequests().length, openApiBefore, 'no token request or probe for the old session');
    assert.deepEqual((await reachableStrings(oldClient)).filter((text) => text.startsWith('AT-')), [], 'no token left in the old client');
    assert.equal(harness.manager.controller, old, 'the internal client stays installed during the window (phase 7)');
    assert.ok((await old.getAccessPoints()).length > 0, 'and still serves the data');
    login.resolve({ body: responses.loginOk });
    const second = await connecting;
    assert.equal(second.success, true, JSON.stringify(second));
    const fresh = await getSessionCapabilities(harness.manager, second.sessionNonce as string);
    assert.deepEqual(fresh, { success: true, capabilities: managementOn() });
    assert.deepEqual(await getSessionCapabilities(harness.manager, nonce), { success: false, error: 'superseded' });
    assert.equal(harness.tokensIssued, 2, 'only the new session acquired a token');
  }); // End of test "while the new internal login is pending, the old Open API client is closed..."

  test('a late probe result of the old session (arriving while the new login is pending) is discarded: its waiter hears superseded, nothing more is sent for it, and the new session checks normally', async () => {
    const harness = new Harness();
    const probe = deferred<FakeReply>();
    harness.transport.on('GET', OPENAPI_SITES, () => probe.promise);
    const first = await harness.connect();
    await until(() => harness.transport.requestsTo('GET', OPENAPI_SITES).length === 1);
    const old = harness.session;
    const waiting = getSessionCapabilities(harness.manager, first.sessionNonce as string);
    const login = deferred<FakeReply>();
    harness.transport.on('POST', LOGIN_PATH, () => login.promise);
    const connecting = harness.manager.connect();
    assert.equal(old.isClosed, true, 'closed before connect() awaited anything');
    assert.deepEqual(await waiting, { success: false, error: 'superseded' });
    await until(() => harness.transport.requestsTo('POST', LOGIN_PATH).length === 2);
    const sentBefore = harness.transport.log();
    probe.resolve(sitesPage([{ siteId: SITE_ID, name: 'Casa' }]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(harness.transport.log(), sentBefore, 'no AP-group, group-list or token request after the late reply');
    assert.equal(old.capabilities, null);
    assert.equal(old.openApiClient, null);
    assert.equal(harness.clients[0].isClosed, true);
    assert.deepEqual(await getSessionCapabilities(harness.manager, first.sessionNonce as string), { success: false, error: 'notConnected' });
    login.resolve({ body: responses.loginOk });
    const second = await connecting;
    assert.equal(second.success, true, JSON.stringify(second));
    assert.deepEqual(await getSessionCapabilities(harness.manager, second.sessionNonce as string), { success: true, capabilities: managementOn() });
    assert.equal(old.capabilities, null, 'the late result never reached the old session');
  }); // End of test "a late probe result of the old session ... is discarded"
}); // End of describe 'a new connect closes the installed session before its first await'

describe('ControllerSession: a management-credentials save owns exactly one capability run', () => {
  /**
   * The payload of a Settings save that rotates the Client Secret (URL kept).
   * @param {string} clientSecret - The new secret.
   * @returns {ConfigSavePayload} The payload.
   */
  const rotation = (clientSecret: string): ConfigSavePayload => ({ url: BASE_URL, username: 'admin', language: 'en', clientId: CLIENT_ID, clientSecret });

  test('the save drops the old client (old credentials) at once and sends nothing; the reconnect the Settings flow performs then runs the checks once — one token request in all, with the new secret', async () => {
    const harness = new Harness();
    await harness.connectAndCheck();
    const old = harness.session;
    const oldClient = old.openApiClient;
    assert.ok(oldClient && !oldClient.isClosed);
    harness.credentials = { clientId: CLIENT_ID, clientSecret: 'rotated-secret' };
    applyManagementAccessChange(harness.manager, rotation('rotated-secret'));
    assert.equal(oldClient.isClosed, true, 'the client of the old credentials is closed at once');
    assert.equal(old.openApiClient, null);
    assert.equal(old.capabilities, null);
    assert.equal(old.isClosed, false, 'the session itself stays usable');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(harness.transport.requestsTo('POST', TOKEN_PATH).length, 1, 'the save itself starts no check run');
    const reconnected = await harness.connectAndCheck();
    assert.deepEqual(reconnected.reply, { success: true, capabilities: managementOn() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const tokenRequests = harness.transport.requestsTo('POST', TOKEN_PATH);
    assert.equal(tokenRequests.length, 2, 'exactly one capability run after the save');
    assert.deepEqual(tokenRequests[1].body, { omadacId: OMADAC_ID, client_id: CLIENT_ID, client_secret: 'rotated-secret' });
  }); // End of test "the save drops the old client (old credentials) at once and sends nothing..."

  test('without a reconnect, the next capabilities request runs the checks once with the new credentials; a save that does not touch the management access changes nothing', async () => {
    const harness = new Harness();
    const { result } = await harness.connectAndCheck();
    const nonce = result.sessionNonce as string;
    const client = harness.session.openApiClient;
    applyManagementAccessChange(harness.manager, { url: BASE_URL, username: 'admin', language: 'en', password: 'x' });
    assert.equal(client?.isClosed, false, 'a password-only save keeps the verified client');
    harness.credentials = null;
    applyManagementAccessChange(harness.manager, { url: BASE_URL, username: 'admin', language: 'en', removeManagementAccess: true });
    assert.equal(client?.isClosed, true);
    assertOff(await getSessionCapabilities(harness.manager, nonce), 'managementNotConfigured');
    harness.credentials = { clientId: CLIENT_ID, clientSecret: 'new-secret' };
    applyManagementAccessChange(harness.manager, rotation('new-secret'));
    const [first, second] = await Promise.all([getSessionCapabilities(harness.manager, nonce), getSessionCapabilities(harness.manager, nonce)]);
    assert.deepEqual(first, { success: true, capabilities: managementOn() });
    assert.deepEqual(second, first, 'concurrent requests share the run');
    assert.equal(harness.transport.requestsTo('POST', TOKEN_PATH).length, 2, 'one run for the new credentials');
  }); // End of test "without a reconnect, the next capabilities request runs the checks once..."
}); // End of describe 'a management-credentials save owns exactly one capability run'
