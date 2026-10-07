// Tests for the Wi-Fi network writes through the controller session
// (src/main/controller-session.ts: createNetwork(), updateNetwork(),
// changeNetworkPassword(), setNetworkEnabled(), deleteNetwork() and their
// *Reply() wrappers, the MANAGEMENT_NETWORK_* handlers' bodies), driven end to
// end — the real ConnectionManager, OmadaController and OpenApiClient over one
// fake transport whose Open API SSIDs live in memory (no Electron, no network):
// - the exact requests of every write: the fresh reads first (AP-group list
//   and SSID catalog, or the network's detail), then exactly one write with
//   the exact body (read-merge-write: every unedited setting of the fresh
//   detail kept); a create answer without an id resolved only to an id that
//   is new since the pre-create catalog AND has the name (never a name match
//   alone);
// - a security / band change conflicting with Enhanced IoT Connectivity, and
//   an open create on 6 GHz: securityBandConflict, nothing written;
// - the input rules answered before any request; Enterprise / PPSK / unknown
//   security refused for an edit on the FRESH detail, whatever the renderer
//   asked; enable / delete allowed for any security;
// - the controller errorCodes mapped to stable codes, codes-only diagnostics;
// - session binding: management off, not connected, a stale nonce, and a
//   superseding connect, a disconnect, a re-check or a credentials save while
//   a write is held — superseded, nothing more sent, late answers discarded;
// - one session's writes run one at a time (shared with the AP-group writes),
//   and a queued write is bound to the management state it was invoked
//   under: a credentials save, a re-check, a connect or a disconnect before
//   its turn → superseded, zero requests (network and AP-group writes);
// - a sentinel passphrase never reaches a reply or a log line.

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { ConnectionManager } from '../../src/main/connection-manager';
import {
  applyManagementAccessChange,
  changeNetworkPasswordReply,
  ControllerSession,
  createNetworkReply,
  deleteApGroupReply,
  deleteNetworkReply,
  renameApGroupReply,
  setNetworkEnabledReply,
  testManagementAccess,
  updateNetworkReply,
  type ManagementCredentials
} from '../../src/main/controller-session';
import { OpenApiClient, TOKEN_PATH } from '../../src/main/openapi-client';
import type { NetworkActionResult, NetworkCreateRequest, NetworkUpdateRequest } from '../../src/shared/types';
import responses from '../fixtures/controller/responses.json';
import ssidWriteFixtures from '../fixtures/openapi/ssid-writes.json';
import { FakeTransport, type FakeReply, type RecordedRequest } from './helpers/fake-transport';

const BASE_URL = 'https://controller.invalid:8043';
const OMADAC_ID = responses.apiInfo.result.omadacId;
const SITE_ID = responses.sitesSingle.result.data[0].id;
const LOGIN_PATH = `/${OMADAC_ID}/api/v2/login`;
const LOGOUT_PATH = `/${OMADAC_ID}/api/v2/logout`;
const SITES_PATH = `/${OMADAC_ID}/api/v2/sites?currentPage=1&currentPageSize=100`;
const WLANS_PATH = `/${OMADAC_ID}/api/v2/sites/${SITE_ID}/setting/wlans`;
const OPENAPI_SITES = `/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`;
const AP_GROUPS = `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/ap-groups`;
const AP_GROUPS_PAGE = `${AP_GROUPS}?page=1&pageSize=100`;
const SSIDS = `/openapi/v2/${OMADAC_ID}/sites/${SITE_ID}/wireless-network/ssids`;
const SSIDS_PAGE = `${SSIDS}?page=1&pageSize=100`;
const SSID_V1 = `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/wireless-network/ssids`;
const CLIENT_ID = 'owm-client-1';
const CLIENT_SECRET = 'Cl1ent-S3cret-Value-Never-Shown';
// The internal setting/wlans ids of the fixture (the Open API AP groups must match them)
const [DEFAULT_ID, GROUP_B_ID, EMPTY_ID] = responses.wlans.result.data.map((group) => group.id);
// A well-formed AP-group id the controller does not list
const UNKNOWN_GROUP_ID = '6512a0e1f3b2c41d2e3f4a00';
// The fake controller's networks: WPA-Personal (the fixture detail), open, Enterprise, PPSK
const CASA_ID = ssidWriteFixtures.ssidId;
const [OPEN_ID, ENTERPRISE_ID, PPSK_ID] = ['5f00c0ffee0000000000c002', '5f00c0ffee0000000000c003', '5f00c0ffee0000000000c004'];
// The id the fake controller gives a created network
const NEW_ID = '5f00c0ffee0000000000c0aa';
// A network that already has a create request's name before the create
const EXISTING_NUEVA_ID = '5f00c0ffee0000000000c0a9';
// Sentinel passphrases: none may ever come back in a reply or a log line
const PASS_1 = 'SENTINEL-pass-one-18a';
const PASS_2 = 'SENTINEL-pass-two-18a';
const CURRENT_KEY = 'fixture-current-key-NEVER-SENT';

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

/** One SSID of the fake controller: its catalog entry and its raw v1 detail. */
interface FakeNetwork {
  entry: Record<string, unknown>;
  detail: Record<string, unknown>;
}

/**
 * The default fake networks: "Casa" (WPA-Personal, the fixture's full
 * detail), "Invitados" (open), "Empresa" (WPA-Enterprise), "Clave única"
 * (PPSK without RADIUS).
 * @returns {FakeNetwork[]} Fresh copies.
 */
function defaultNetworks(): FakeNetwork[] {
  const base = { guestNetEnable: false, broadcast: true, vlanEnable: false, mloEnable: false, pmfMode: 2, enable11r: false, hidePwd: false, ssidEnable: true, chooseDevices: 1 };
  return [
    { entry: { id: CASA_ID, name: 'Casa', security: 3, band: 3, chooseDevices: 1 }, detail: structuredClone(ssidWriteFixtures.basicConfig.detail) },
    { entry: { id: OPEN_ID, name: 'Invitados', security: 0, band: 1, chooseDevices: 1 }, detail: { id: OPEN_ID, name: 'Invitados', band: 1, security: 0, ...base, pmfMode: 3 } },
    {
      entry: { id: ENTERPRISE_ID, name: 'Empresa', security: 2, band: 3, chooseDevices: 1 },
      detail: { id: ENTERPRISE_ID, name: 'Empresa', band: 3, security: 2, ...base, entSetting: { radiusProfileId: 'radius-1', versionEnt: 2, encryptionEnt: 3, gikRekeyEntEnable: false } }
    },
    { entry: { id: PPSK_ID, name: 'Clave única', security: 4, band: 3, chooseDevices: 1 }, detail: { id: PPSK_ID, name: 'Clave única', band: 3, security: 4, ...base, ppskSetting: { ppskProfileId: 'ppsk-1' } } }
  ];
} // End of function defaultNetworks()

/** The kinds of request a test can hold or answer once. */
type RouteKind = 'groups' | 'catalog' | 'detail' | 'create' | 'basic-config' | 'enable' | 'delete';

/**
 * The fake environment: one transport serving the internal API and the Open
 * API (the AP groups match the internal list, so every capability check
 * passes; the SSIDs come from `networks`), the configured URL and management
 * credentials, and the real ConnectionManager over ControllerSessions.
 */
class Harness {
  readonly transport = new FakeTransport(BASE_URL);
  configuredUrl = BASE_URL;
  credentials: ManagementCredentials | null = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
  tokensIssued = 0;
  readonly manager: ConnectionManager<ControllerSession>;
  networks: FakeNetwork[] = defaultNetworks();
  // One-shot answers of the next request of a kind, when set
  readonly overrides = new Map<RouteKind, () => FakeReply | Promise<FakeReply>>();

  /**
   * Builds a harness where every capability check passes.
   */
  constructor() {
    this.transport
      .on('GET', '/api/info', { body: responses.apiInfo, setCookie: 'TPOMADA_SESSIONID=session-1; Path=/; HttpOnly' })
      .on('POST', LOGIN_PATH, { body: responses.loginOk })
      .on('GET', SITES_PATH, { body: responses.sitesSingle })
      .on('GET', WLANS_PATH, { body: responses.wlans })
      .on('POST', LOGOUT_PATH, { body: responses.ok })
      .on('POST', TOKEN_PATH, () => ok({ accessToken: `AT-session-token-${++this.tokensIssued}`, tokenType: 'bearer', expiresIn: 7200, refreshToken: 'RT-x' }))
      .on('GET', OPENAPI_SITES, ok({ totalRows: 1, currentPage: 1, currentSize: 1, data: [{ siteId: SITE_ID, name: 'Casa' }] }))
      .on('GET', AP_GROUPS_PAGE, () => this.#take('groups') ?? ok({ totalRows: 3, data: [DEFAULT_ID, GROUP_B_ID, EMPTY_ID].map((id) => ({ id, name: id, apNum: 0, ssidNameList: [] })) }))
      .on('GET', SSIDS_PAGE, () => this.#take('catalog') ?? ok({ totalRows: this.networks.length, data: this.networks.map((network) => network.entry) }))
      .on('POST', SSIDS, () => this.#take('create') ?? ok({ id: NEW_ID }));
    this.routeNetworks([CASA_ID, OPEN_ID, ENTERPRISE_ID, PPSK_ID, NEW_ID]);
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
   * Registers the detail and write routes of the given SSID ids (the detail
   * served from `networks`, the writes answered with success, or by the
   * one-shot overrides).
   * @param {string[]} ids - The SSID ids.
   */
  routeNetworks(ids: string[]): void {
    for (const id of ids) {
      this.transport
        .on('GET', `${SSID_V1}/${id}`, () => this.#take('detail') ?? ok(this.#network(id).detail))
        .on('PATCH', `${SSID_V1}/${id}/basic-config`, () => this.#take('basic-config') ?? ok())
        .on('PATCH', `${SSID_V1}/${id}/enable`, () => this.#take('enable') ?? ok())
        .on('DELETE', `${SSID_V1}/${id}`, () => this.#take('delete') ?? ok({}));
    }
  }

  /**
   * Consumes the one-shot override of a route kind, if any.
   * @param {RouteKind} kind - The route kind.
   * @returns {FakeReply | Promise<FakeReply> | null} The override's answer, or null.
   */
  #take(kind: RouteKind): FakeReply | Promise<FakeReply> | null {
    const answer = this.overrides.get(kind);
    if (answer === undefined) {
      return null;
    }
    this.overrides.delete(kind);
    return answer();
  }

  /**
   * The fake network with this id.
   * @param {string} id - The SSID id.
   * @returns {FakeNetwork} The network.
   */
  #network(id: string): FakeNetwork {
    const found = this.networks.find((network) => network.entry.id === id);
    assert.ok(found, `fake network ${id}`);
    return found;
  }

  /**
   * Connects, waits for the capabilities and returns the session nonce.
   * @returns {Promise<string>} The session nonce.
   */
  async connect(): Promise<string> {
    const result = await this.manager.connect();
    assert.equal(result.success, true, JSON.stringify(result));
    await this.manager.controller?.waitForCapabilities();
    return result.sessionNonce as string;
  }

  /**
   * The recorded SSID requests (catalog, details, writes) as "METHOD path".
   * @returns {string[]} The requests.
   */
  ssidLog(): string[] {
    return this.transport.requests.filter((request) => request.path.includes('/wireless-network/ssids')).map((request) => `${request.method} ${request.path}`);
  }

  /**
   * The recorded write requests (POST / PATCH / DELETE of the Open API; the
   * token requests are not writes).
   * @returns {RecordedRequest[]} The requests.
   */
  writes(): RecordedRequest[] {
    return this.transport.requests.filter((request) => request.path.startsWith('/openapi/') && request.path !== TOKEN_PATH && request.method !== 'GET');
  }

  /**
   * Holds the next request of a kind until the returned deferred is resolved,
   * then answers it normally (or with `answer`).
   * @param {RouteKind} kind - The route kind.
   * @param {() => FakeReply} [answer] - The answer once released.
   * @returns {Deferred<void>} Resolve it to answer the held request.
   */
  hold(kind: RouteKind, answer?: () => FakeReply): Deferred<void> {
    const gate = deferred<void>();
    this.overrides.set(kind, async () => {
      await gate.promise;
      return answer ? answer() : this.#take(kind) ?? this.#defaultAnswer(kind);
    });
    return gate;
  }

  /**
   * The normal answer of a route kind (for a released hold).
   * @param {RouteKind} kind - The route kind.
   * @returns {FakeReply} The answer.
   */
  #defaultAnswer(kind: RouteKind): FakeReply {
    if (kind === 'groups') {
      return ok({ totalRows: 3, data: [DEFAULT_ID, GROUP_B_ID, EMPTY_ID].map((id) => ({ id, name: id })) });
    }
    if (kind === 'catalog') {
      return ok({ totalRows: this.networks.length, data: this.networks.map((network) => network.entry) });
    }
    if (kind === 'detail') {
      return ok(this.#network(CASA_ID).detail);
    }
    return kind === 'create' ? ok({ id: NEW_ID }) : ok();
  } // End of function #defaultAnswer()
} // End of class Harness

/**
 * Records a reply (for the secret check) and returns it.
 * @param {Promise<NetworkActionResult>} pending - The reply.
 * @returns {Promise<NetworkActionResult>} The same reply.
 */
async function recorded(pending: Promise<NetworkActionResult>): Promise<NetworkActionResult> {
  const value = await pending;
  replies.push(value);
  return value;
}

/**
 * A create request with the given overrides.
 * @param {string} nonce - The session nonce.
 * @param {Partial<NetworkCreateRequest>} [overrides] - Fields to replace.
 * @returns {NetworkCreateRequest} The request.
 */
function createRequest(nonce: string, overrides: Partial<NetworkCreateRequest> = {}): NetworkCreateRequest {
  return { sessionNonce: nonce, name: 'Nueva', security: 'wpaPersonal', bands: ['band2g', 'band5g'], apGroupIds: [DEFAULT_ID, GROUP_B_ID], passphrase: PASS_1, ...overrides };
}

/**
 * An update request with the given edits.
 * @param {string} nonce - The session nonce.
 * @param {string} networkId - The network.
 * @param {Partial<NetworkUpdateRequest>} edits - The edited fields.
 * @returns {NetworkUpdateRequest} The request.
 */
function updateRequest(nonce: string, networkId: string, edits: Partial<NetworkUpdateRequest>): NetworkUpdateRequest {
  return { sessionNonce: nonce, networkId, ...edits };
}

describe('Wi-Fi network writes: the requests (fresh read first, then exactly one write)', () => {
  test('update: GET the v1 detail, then PATCH …/basic-config with the merged body — every unedited setting kept, the typed passphrase only', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const edits = ssidWriteFixtures.basicConfig.edit.edits as Partial<NetworkUpdateRequest>;
    assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, edits))), { success: true });
    assert.deepEqual(harness.ssidLog(), [`GET ${SSID_V1}/${CASA_ID}`, `PATCH ${SSID_V1}/${CASA_ID}/basic-config`]);
    const [patch] = harness.writes();
    assert.deepEqual(patch.body, ssidWriteFixtures.basicConfig.edit.body);
    assert.ok(!JSON.stringify(patch.body).includes(CURRENT_KEY), 'the current key is never sent back');
  });

  test('change password: GET the detail, then PATCH …/basic-config — the detail\'s settings unchanged, only the passphrase new', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await recorded(changeNetworkPasswordReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, passphrase: PASS_2 })), { success: true });
    assert.deepEqual(harness.ssidLog(), [`GET ${SSID_V1}/${CASA_ID}`, `PATCH ${SSID_V1}/${CASA_ID}/basic-config`]);
    const body = harness.writes()[0].body as Record<string, unknown>;
    // No security / band change: every dependent exactly as the detail reports it (PMF mandatory)
    const expected = { ...ssidWriteFixtures.basicConfig.edit.body, name: 'Casa', band: 3, pmfMode: 1, pskSetting: { ...ssidWriteFixtures.basicConfig.edit.body.pskSetting, securityKey: PASS_2 } };
    assert.deepEqual(body, expected);
  });

  test('create: GET the AP-group list and the SSID catalog, then POST the v2 catalog with the exact body (disabled, bound, passphrase as typed); the reply names the new id', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce, { name: ' Nueva ' }))), { success: true, networkId: NEW_ID });
    const requests = harness.transport.requests.filter((request) => request.path.startsWith(`/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}`) || request.path.startsWith(SSIDS));
    assert.deepEqual(requests.map((request) => `${request.method} ${request.path}`).slice(-3), [`GET ${AP_GROUPS_PAGE}`, `GET ${SSIDS_PAGE}`, `POST ${SSIDS}`]);
    assert.deepEqual(harness.writes()[0].body, {
      name: 'Nueva',
      deviceType: 1,
      ssidEnable: false,
      chooseDevices: 1,
      apGroupIds: [DEFAULT_ID, GROUP_B_ID],
      band: 3,
      guestNetEnable: false,
      security: 3,
      broadcast: true,
      vlanEnable: false,
      mloEnable: false,
      pmfMode: 2,
      enable11r: false,
      hidePwd: false,
      pskSetting: { securityKey: PASS_1, versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: false }
    });
  }); // End of test "create: GET the AP-group list, then POST..."

  test('create without a usable id in the answer: never a pre-existing network with the same name; exactly one NEW id with the requested name → that id; zero, two or a differently named new id → no id', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    /**
     * Makes the next POST add networks to the fake catalog and answer without a usable id.
     * @param {Array<[string, string]>} added - The [id, name] of each network the create adds.
     * @param {unknown} result - The answer's `result`.
     */
    const createAdding = (added: Array<[string, string]>, result: unknown): void => {
      harness.overrides.set('create', () => {
        for (const [id, name] of added) {
          harness.networks.push({ entry: { id, name, security: 3, band: 3 }, detail: { id } });
        }
        return ok(result);
      });
    };
    // A network named "Nueva" exists BEFORE the create, and the create adds none to the catalog
    harness.networks.push({ entry: { id: EXISTING_NUEVA_ID, name: 'Nueva', security: 3, band: 3 }, detail: { id: EXISTING_NUEVA_ID } });
    createAdding([], {});
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: true }, 'the existing same-named network is never returned');
    assert.deepEqual(harness.ssidLog().slice(-3), [`GET ${SSIDS_PAGE}`, `POST ${SSIDS}`, `GET ${SSIDS_PAGE}`]);
    // Exactly one new id, with the requested name (a same-named one already exists)
    createAdding([[NEW_ID, 'Nueva']], null);
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: true, networkId: NEW_ID });
    // One new id with another name (someone else's create meanwhile)
    createAdding([['5f00c0ffee0000000000c0b1', 'Otra']], { id: 7 });
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: true }, 'a new id with another name');
    // Two new ids, both with the requested name
    createAdding([['5f00c0ffee0000000000c0b2', 'Nueva'], ['5f00c0ffee0000000000c0b3', 'Nueva']], {});
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: true }, 'two new ids');
    // The read after the create fails by itself: the create is still reported, without an id
    harness.overrides.set('create', () => {
      harness.overrides.set('catalog', () => ({ status: 503, body: 'busy' }));
      return ok({});
    });
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: true });
    // A truncated catalog before the create: no id is ever inferred
    harness.transport.on('GET', `${SSIDS}?page=2&pageSize=100`, ok({ totalRows: 999, data: [] }));
    harness.overrides.set('catalog', () => ok({ totalRows: 999, data: harness.networks.map((network) => network.entry) }));
    createAdding([['5f00c0ffee0000000000c0b4', 'Nueva']], {});
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: true }, 'truncated baseline');
  }); // End of test "create without a usable id in the answer..."

  test('create: a failed catalog read before the POST refuses the create (requestFailed, "ssids: …"), nothing is written', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.overrides.set('catalog', () => ({ status: 503, body: 'busy' }));
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: false, error: 'requestFailed', diagnostic: 'ssids: httpError, HTTP 503' });
    assert.deepEqual(harness.writes(), []);
  });

  test('enable / disable and delete: GET the detail, then exactly PATCH …/enable {ssidEnable} or DELETE — allowed for Enterprise and PPSK networks too', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    for (const networkId of [CASA_ID, ENTERPRISE_ID, PPSK_ID]) {
      assert.deepEqual(await recorded(setNetworkEnabledReply(harness.manager, { sessionNonce: nonce, networkId, enabled: false })), { success: true });
      assert.deepEqual(await recorded(deleteNetworkReply(harness.manager, { sessionNonce: nonce, networkId })), { success: true });
      assert.deepEqual(harness.ssidLog().slice(-4), [
        `GET ${SSID_V1}/${networkId}`,
        `PATCH ${SSID_V1}/${networkId}/enable`,
        `GET ${SSID_V1}/${networkId}`,
        `DELETE ${SSID_V1}/${networkId}`
      ]);
    } // End of the loop over the security modes
    const writes = harness.writes();
    assert.deepEqual(writes.filter((request) => request.method === 'PATCH').map((request) => request.body), [{ ssidEnable: false }, { ssidEnable: false }, { ssidEnable: false }]);
    assert.ok(writes.filter((request) => request.method === 'DELETE').every((request) => request.body === undefined));
    assert.deepEqual(await recorded(setNetworkEnabledReply(harness.manager, { sessionNonce: nonce, networkId: OPEN_ID, enabled: true })), { success: true });
    assert.deepEqual(harness.writes().at(-1)?.body, { ssidEnable: true });
  }); // End of test "enable / disable and delete..."
}); // End of the describe block for the requests

describe('Wi-Fi network writes: the rules (refused with codes, nothing written)', () => {
  test('input rules are answered before any Open API request of the write (name, passphrase, security, bands, groups, nothing to change)', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const before = harness.transport.requests.length;
    const cases: Array<[Promise<NetworkActionResult>, string]> = [
      [createNetworkReply(harness.manager, createRequest(nonce, { name: 'é'.repeat(17) })), 'nameTooLong'],
      [createNetworkReply(harness.manager, createRequest(nonce, { name: '  ' })), 'nameRequired'],
      [createNetworkReply(harness.manager, createRequest(nonce, { security: 'wpaEnterprise' })), 'unsupportedSecurity'],
      [createNetworkReply(harness.manager, createRequest(nonce, { security: 'ppskWithRadius' })), 'unsupportedSecurity'],
      [createNetworkReply(harness.manager, createRequest(nonce, { passphrase: undefined })), 'passphraseRequired'],
      [createNetworkReply(harness.manager, createRequest(nonce, { passphrase: 'x'.repeat(64) })), 'passphraseInvalid'],
      [createNetworkReply(harness.manager, createRequest(nonce, { security: 'open' })), 'passphraseNotApplicable'],
      [createNetworkReply(harness.manager, createRequest(nonce, { bands: [] })), 'bandsRequired'],
      [createNetworkReply(harness.manager, createRequest(nonce, { apGroupIds: [] })), 'groupsRequired'],
      [updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, {})), 'nothingToChange'],
      [updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { security: 'unknown' })), 'unsupportedSecurity'],
      [updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { passphrase: 'corta' })), 'passphraseInvalid'],
      [changeNetworkPasswordReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, passphrase: '' }), 'passphraseRequired'],
      [changeNetworkPasswordReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, passphrase: 'contraseña-1' }), 'passphraseInvalid']
    ];
    for (const [pending, error] of cases) {
      assert.deepEqual(await recorded(pending), { success: false, error });
    }
    // An open network on 6 GHz needs OWE, which the create request cannot carry
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce, { security: 'open', bands: ['band2g', 'band6g'], passphrase: undefined }))), {
      success: false,
      error: 'securityBandConflict',
      diagnostic: 'conflict: oweEnable'
    });
    assert.equal(harness.transport.requests.length, before, 'nothing was sent');
  }); // End of test "input rules are answered before any...""

  test('a create bound to a group the fresh AP-group list does not have: groupNotFound, no POST; a truncated list: groupListIncomplete', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce, { apGroupIds: [DEFAULT_ID, UNKNOWN_GROUP_ID] }))), { success: false, error: 'groupNotFound' });
    harness.overrides.set('groups', () => ok({ totalRows: 5, data: [DEFAULT_ID, GROUP_B_ID, EMPTY_ID].map((id) => ({ id, name: id })) }));
    harness.transport.on('GET', `${AP_GROUPS}?page=2&pageSize=100`, ok({ totalRows: 5, data: [] }));
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: false, error: 'groupListIncomplete', diagnostic: 'ap-groups truncated' });
    assert.deepEqual(harness.writes(), []);
  });

  test('fresh data contradicting the renderer: an edit or a password change of a network the detail reports as Enterprise / PPSK / unknown → unsupportedSecurity, no PATCH', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const casa = harness.networks[0];
    for (const security of [2, 4, 5, 9, undefined]) {
      casa.detail = { ...structuredClone(ssidWriteFixtures.basicConfig.detail), security };
      assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { name: 'Casa 2', passphrase: PASS_1 }))), { success: false, error: 'unsupportedSecurity' });
      assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { security: 'open' }))), { success: false, error: 'unsupportedSecurity' });
      assert.deepEqual(await recorded(changeNetworkPasswordReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, passphrase: PASS_2 })), { success: false, error: 'unsupportedSecurity' });
    }
    for (const networkId of [ENTERPRISE_ID, PPSK_ID]) {
      assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, networkId, { name: 'X', security: 'wpaPersonal', passphrase: PASS_1 }))), { success: false, error: 'unsupportedSecurity' });
    }
    assert.deepEqual(harness.writes(), []);
  }); // End of test "fresh data contradicting the renderer..."

  test('WPA-Personal saves need the re-typed passphrase (spec §3): passphraseRequired after the fresh read, no PATCH; an open network refuses one (passphraseNotApplicable); an open network\'s edit needs none', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { name: 'Casa 2' }))), { success: false, error: 'passphraseRequired' });
    assert.deepEqual(await recorded(changeNetworkPasswordReply(harness.manager, { sessionNonce: nonce, networkId: OPEN_ID, passphrase: PASS_2 })), { success: false, error: 'passphraseNotApplicable' });
    assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, OPEN_ID, { security: 'wpaPersonal' }))), { success: false, error: 'passphraseRequired' });
    assert.deepEqual(harness.writes(), []);
    assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, OPEN_ID, { name: 'Invitados 2', bands: ['band2g', 'band5g'] }))), { success: true });
    assert.deepEqual(harness.writes()[0].body, { name: 'Invitados 2', band: 3, security: 0, guestNetEnable: false, broadcast: true, vlanEnable: false, mloEnable: false, pmfMode: 3, enable11r: false, hidePwd: false });
    assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, OPEN_ID, { security: 'wpaPersonal', passphrase: PASS_1 }))), { success: true });
    assert.deepEqual((harness.writes()[1].body as Record<string, unknown>).pskSetting, { versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: false, securityKey: PASS_1 });
  }); // End of test "WPA-Personal saves need the re-typed passphrase..."

  test('a security / band change conflicting with Enhanced IoT Connectivity on the FRESH detail: securityBandConflict naming the field, no PATCH; the feature is never flipped', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.networks[0].detail = { ...structuredClone(ssidWriteFixtures.basicConfig.detail), band: 1, enhancedIotConnectivity: true };
    const refusal = { success: false, error: 'securityBandConflict', diagnostic: 'conflict: enhancedIotConnectivity' };
    assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { bands: ['band2g', 'band5g'], passphrase: PASS_1 }))), refusal);
    assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { security: 'open', bands: ['band6g'] }))), refusal);
    assert.deepEqual(harness.ssidLog(), [`GET ${SSID_V1}/${CASA_ID}`, `GET ${SSID_V1}/${CASA_ID}`], 'the fresh detail only');
    assert.deepEqual(harness.writes(), []);
  });

  test('a detail missing a setting the save must carry: networkStateUnknown, no PATCH', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const detail = structuredClone(ssidWriteFixtures.basicConfig.detail) as Record<string, unknown>;
    delete detail.pmfMode;
    harness.networks[0].detail = detail;
    assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { name: 'Casa 2', passphrase: PASS_1 }))), { success: false, error: 'networkStateUnknown' });
    assert.deepEqual(harness.writes(), []);
  });
}); // End of the describe block for the rules

describe('Wi-Fi network writes: controller errors (stable codes, codes-only diagnostics)', () => {
  test('the documented errorCodes of the write map per operation; others are requestFailed; a failed fresh read names its call', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    /**
     * Saves an edit of "Casa" (with the re-typed passphrase).
     * @returns {Promise<NetworkActionResult>} The reply.
     */
    const save = (): Promise<NetworkActionResult> => recorded(updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { name: 'Casa 2', passphrase: PASS_1 })));
    const cases: Array<[RouteKind, FakeReply, () => Promise<NetworkActionResult>, NetworkActionResult]> = [
      ['basic-config', apiError(-33219), save, { success: false, error: 'nameTaken', diagnostic: 'ssid basic-config: apiError, errorCode -33219' }],
      ['basic-config', apiError(-33238), save, { success: false, error: 'bandLimitReached', diagnostic: 'ssid basic-config: apiError, errorCode -33238' }],
      ['basic-config', apiError(-33240), save, { success: false, error: 'nameTooLong', diagnostic: 'ssid basic-config: apiError, errorCode -33240' }],
      ['basic-config', apiError(-33807), save, { success: false, error: 'requestFailed', diagnostic: 'ssid basic-config: apiError, errorCode -33807' }],
      ['basic-config', { status: 500, body: '<html>oops</html>' }, save, { success: false, error: 'requestFailed', diagnostic: 'ssid basic-config: httpError, HTTP 500' }],
      ['detail', { status: 503, body: 'busy' }, save, { success: false, error: 'requestFailed', diagnostic: 'ssid detail: httpError, HTTP 503' }],
      ['detail', apiError(-33219), save, { success: false, error: 'requestFailed', diagnostic: 'ssid detail: apiError, errorCode -33219' }],
      ['detail', ok({ id: OPEN_ID }), save, { success: false, error: 'requestFailed', diagnostic: 'ssid detail: malformedResponse' }],
      ['create', apiError(-33219), () => recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: false, error: 'nameTaken', diagnostic: 'ssid create: apiError, errorCode -33219' }],
      ['create', apiError(-33231), () => recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: false, error: 'nameTaken', diagnostic: 'ssid create: apiError, errorCode -33231' }],
      ['create', apiError(-33238), () => recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: false, error: 'requestFailed', diagnostic: 'ssid create: apiError, errorCode -33238' }],
      ['groups', { status: 503, body: 'busy' }, () => recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: false, error: 'requestFailed', diagnostic: 'ap-groups: httpError, HTTP 503' }],
      ['enable', apiError(-33000), () => recorded(setNetworkEnabledReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, enabled: true })), { success: false, error: 'requestFailed', diagnostic: 'ssid enable: apiError, errorCode -33000' }],
      ['delete', apiError(-33000), () => recorded(deleteNetworkReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID })), { success: false, error: 'requestFailed', diagnostic: 'ssid delete: apiError, errorCode -33000' }]
    ];
    for (const [kind, answer, run, expected] of cases) {
      harness.overrides.set(kind, () => answer);
      assert.deepEqual(await run(), expected, `${kind} ${JSON.stringify(answer.body)}`);
    }
  }); // End of test "the documented errorCodes of the write map per operation..."
}); // End of the describe block for controller errors

describe('Wi-Fi network writes: bound to the current session (the 15b invalidation)', () => {
  test('management off → managementUnavailable with no SSID request; not connected → notConnected; another nonce → superseded', async () => {
    const harness = new Harness();
    harness.credentials = null;
    assert.deepEqual(await recorded(deleteNetworkReply(harness.manager, { sessionNonce: 'a'.repeat(32), networkId: CASA_ID })), { success: false, error: 'notConnected' });
    const nonce = await harness.connect();
    assert.deepEqual(await recorded(updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { name: 'X', passphrase: PASS_1 }))), { success: false, error: 'managementUnavailable' });
    assert.deepEqual(await recorded(createNetworkReply(harness.manager, createRequest(nonce))), { success: false, error: 'managementUnavailable' });
    assert.deepEqual(await recorded(setNetworkEnabledReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, enabled: true })), { success: false, error: 'managementUnavailable' });
    assert.deepEqual(harness.transport.requests.filter((request) => request.path.startsWith('/openapi')), []);
    assert.deepEqual(await recorded(deleteNetworkReply(harness.manager, { sessionNonce: 'b'.repeat(32), networkId: CASA_ID })), { success: false, error: 'superseded' });
  }); // End of test "management off → managementUnavailable with..."

  test('a superseding connect while the fresh detail is held: superseded, no PATCH is ever sent', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const gate = harness.hold('detail');
    const pending = recorded(updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { name: 'Casa 2', passphrase: PASS_1 })));
    await until(() => harness.ssidLog().length === 1);
    const reconnect = harness.manager.connect();
    gate.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.equal((await reconnect).success, true);
    assert.deepEqual(harness.writes(), []);
  }); // End of test "a superseding connect while the..."

  test('a disconnect while the PATCH is held: its late answer is discarded (superseded)', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const gate = harness.hold('basic-config');
    const pending = recorded(changeNetworkPasswordReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, passphrase: PASS_2 }));
    await until(() => harness.writes().length === 1);
    await harness.manager.disconnect();
    gate.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.deepEqual(await recorded(deleteNetworkReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID })), { success: false, error: 'notConnected' });
  }); // End of test "a disconnect while the PATCH..."

  test('"Test management access" while a delete\'s detail is held: superseded, no DELETE; the new run\'s client serves the next write', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const gate = harness.hold('detail');
    const pending = recorded(deleteNetworkReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID }));
    await until(() => harness.ssidLog().length === 1);
    const retest = testManagementAccess(harness.manager, nonce);
    gate.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.equal((await retest).capabilities?.manageWifiNetworks, true);
    assert.deepEqual(harness.writes(), []);
    assert.deepEqual(await recorded(deleteNetworkReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID })), { success: true });
  }); // End of test ""Test management access" while a..."

  test('a management-credentials save while a create\'s AP-group read is held: superseded, no POST; the next write re-checks first', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const gate = harness.hold('groups');
    const pending = recorded(createNetworkReply(harness.manager, createRequest(nonce)));
    await until(() => harness.transport.requests.filter((request) => request.path === AP_GROUPS_PAGE).length === 2);
    applyManagementAccessChange(harness.manager, { url: BASE_URL, username: 'admin', language: 'es', clientId: 'owm-client-2', clientSecret: 'another-secret' });
    gate.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.deepEqual(harness.writes(), []);
    const tokensBefore = harness.tokensIssued;
    assert.deepEqual(await recorded(setNetworkEnabledReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, enabled: true })), { success: true });
    assert.equal(harness.tokensIssued, tokensBefore + 1, 'the checks ran again (a new token) before the write');
  }); // End of test "a management-credentials save while a create's AP-group read is held..."

  test('a superseding connect while the POST is held: the created network\'s late answer is discarded (superseded), no catalog read follows', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const gate = harness.hold('create', () => ok({}));
    const pending = recorded(createNetworkReply(harness.manager, createRequest(nonce)));
    await until(() => harness.writes().length === 1);
    const reconnect = harness.manager.connect();
    gate.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    await reconnect;
    assert.equal(harness.ssidLog().filter((line) => line === `GET ${SSIDS_PAGE}`).length, 1, 'only the catalog read before the create');
  }); // End of test "a superseding connect while the...""
}); // End of the describe block for session binding

describe('Wi-Fi network writes: one at a time per session', () => {
  test('two saves and an AP-group delete started together run in order: each fresh read starts only after the previous write settled', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.transport.on('DELETE', `${AP_GROUPS}/${EMPTY_ID}`, ok());
    const gate = harness.hold('basic-config');
    const first = recorded(updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { name: 'Casa 2', passphrase: PASS_1 })));
    const second = recorded(updateNetworkReply(harness.manager, updateRequest(nonce, OPEN_ID, { name: 'Invitados 2' })));
    const third = deleteApGroupReply(harness.manager, { sessionNonce: nonce, apGroupId: EMPTY_ID });
    await until(() => harness.writes().length === 1);
    for (let round = 0; round < 20; round++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.deepEqual(harness.ssidLog(), [`GET ${SSID_V1}/${CASA_ID}`, `PATCH ${SSID_V1}/${CASA_ID}/basic-config`], 'the second save waits');
    gate.resolve();
    assert.deepEqual(await first, { success: true });
    assert.deepEqual(await second, { success: true });
    assert.deepEqual((await third).success, true);
    assert.deepEqual(
      harness.transport.requests
        .filter((request) => request.path.includes('/wireless-network/ssids/') || request.path.startsWith(AP_GROUPS))
        .map((request) => `${request.method} ${request.path}`)
        .slice(-6),
      [
        `GET ${SSID_V1}/${CASA_ID}`,
        `PATCH ${SSID_V1}/${CASA_ID}/basic-config`,
        `GET ${SSID_V1}/${OPEN_ID}`,
        `PATCH ${SSID_V1}/${OPEN_ID}/basic-config`,
        `GET ${AP_GROUPS_PAGE}`,
        `DELETE ${AP_GROUPS}/${EMPTY_ID}`
      ]
    );
  }); // End of test "two saves and an AP-group delete started together..."
}); // End of the describe block for serialized writes

describe('Queued writes are bound to the management state they were invoked under (the write epoch)', () => {
  /**
   * Holds write A (a password change's PATCH), then queues write B (a Wi-Fi
   * network save) and write C (an AP-group rename) behind it.
   * @param {Harness} harness - The connected harness.
   * @param {string} nonce - The session nonce.
   * @returns {Promise<{ gate: Deferred<void>; a: Promise<NetworkActionResult>; b: Promise<NetworkActionResult>; c: Promise<unknown> }>} The gate and the three pending replies, once A's PATCH is held.
   */
  const queueBehindHeldWrite = async (
    harness: Harness,
    nonce: string
  ): Promise<{ gate: Deferred<void>; a: Promise<NetworkActionResult>; b: Promise<NetworkActionResult>; c: Promise<unknown> }> => {
    harness.transport.on('PATCH', `${AP_GROUPS}/${EMPTY_ID}`, ok());
    const gate = harness.hold('basic-config');
    const a = recorded(changeNetworkPasswordReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, passphrase: PASS_1 }));
    await until(() => harness.writes().length === 1);
    const b = recorded(updateNetworkReply(harness.manager, updateRequest(nonce, OPEN_ID, { name: 'Invitados 2' })));
    const c = renameApGroupReply(harness.manager, { sessionNonce: nonce, apGroupId: EMPTY_ID, name: 'Renombrado' });
    return { gate, a, b, c };
  }; // End of function queueBehindHeldWrite()

  // Each invalidation settles completely before A is released (a re-check's
  // or a reconnect's own check run included), so any request after that
  // point could only come from the queued writes
  const invalidations: Array<[string, (harness: Harness, nonce: string) => Promise<void>]> = [
    [
      'a management-credentials save',
      async (harness) => {
        applyManagementAccessChange(harness.manager, { url: BASE_URL, username: 'admin', language: 'es', clientId: 'owm-client-2', clientSecret: 'another-secret' });
      }
    ],
    [
      '"Test management access" (a re-check)',
      async (harness, nonce) => {
        assert.equal((await testManagementAccess(harness.manager, nonce)).capabilities?.manageWifiNetworks, true);
      }
    ],
    [
      'a superseding connect',
      async (harness) => {
        assert.equal((await harness.manager.connect()).success, true);
        await harness.manager.controller?.waitForCapabilities();
      }
    ],
    ['a disconnect', (harness) => harness.manager.disconnect()]
  ];
  for (const [label, invalidate] of invalidations) {
    test(`${label} while write A is held: the queued network write B and AP-group write C answer superseded and send zero requests`, async () => {
      const harness = new Harness();
      const nonce = await harness.connect();
      const { gate, a, b, c } = await queueBehindHeldWrite(harness, nonce);
      await invalidate(harness, nonce);
      const sent = harness.transport.requests.length;
      gate.resolve();
      assert.deepEqual(await a, { success: false, error: 'superseded' });
      assert.deepEqual(await b, { success: false, error: 'superseded' });
      assert.deepEqual(await c, { success: false, error: 'superseded' });
      for (let round = 0; round < 20; round++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.deepEqual(harness.transport.log().slice(sent), [], 'nothing was sent once A was released');
      assert.deepEqual(harness.writes().map((request) => `${request.method} ${request.path}`), [`PATCH ${SSID_V1}/${CASA_ID}/basic-config`], 'only A was ever written');
    }); // End of the per-invalidation test
  } // End of the loop over the invalidations

  test('without an invalidation the queued writes still run, in order, once A settles', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const { gate, a, b, c } = await queueBehindHeldWrite(harness, nonce);
    gate.resolve();
    assert.deepEqual(await a, { success: true });
    assert.deepEqual(await b, { success: true });
    assert.deepEqual(await c, { success: true });
    assert.deepEqual(
      harness.writes().map((request) => `${request.method} ${request.path}`),
      [`PATCH ${SSID_V1}/${CASA_ID}/basic-config`, `PATCH ${SSID_V1}/${OPEN_ID}/basic-config`, `PATCH ${AP_GROUPS}/${EMPTY_ID}`]
    );
  });

  test('a write invoked AFTER the invalidation is not superseded by it: it waits for (or starts) the new check run and is sent', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const { gate, a, b } = await queueBehindHeldWrite(harness, nonce);
    const retest = testManagementAccess(harness.manager, nonce);
    const later = recorded(updateNetworkReply(harness.manager, updateRequest(nonce, OPEN_ID, { name: 'Invitados 3' })));
    gate.resolve();
    assert.deepEqual(await a, { success: false, error: 'superseded' });
    assert.deepEqual(await b, { success: false, error: 'superseded' });
    assert.equal((await retest).success, true);
    assert.deepEqual(await later, { success: true });
    assert.deepEqual((harness.writes().at(-1)?.body as Record<string, unknown>).name, 'Invitados 3');
  });
}); // End of the describe block for the write epoch

describe('Wi-Fi network writes: no passphrase in any reply or log line', () => {
  test('controller text echoing the passphrase, the Client Secret or a token never reaches a reply or a log line; no reply carries more than success / error / diagnostic / networkId', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.overrides.set('basic-config', () => apiError(-1, `Invalid key ${PASS_1} securityKey=${PASS_1} AccessToken=AT-session-token-1 ${CLIENT_SECRET}`));
    replies.push(await updateNetworkReply(harness.manager, updateRequest(nonce, CASA_ID, { name: 'Casa 2', passphrase: PASS_1 })));
    harness.overrides.set('create', () => ({ status: 400, body: { errorCode: -2, msg: `passphrase ${PASS_2} refused` } }));
    replies.push(await createNetworkReply(harness.manager, createRequest(nonce, { passphrase: PASS_2 })));
    harness.overrides.set('basic-config', () => {
      throw new Error(`socket closed while sending ${PASS_2}`);
    });
    replies.push(await changeNetworkPasswordReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, passphrase: PASS_2 }));
    const text = JSON.stringify(replies) + logLines.join('\n');
    assert.ok(replies.length >= 40, `every reply of this file is checked (${replies.length})`);
    assert.ok(!text.includes('SENTINEL'), 'no typed passphrase');
    assert.ok(!text.includes(CURRENT_KEY), 'no current key');
    assert.ok(!text.includes(CLIENT_SECRET), 'no Client Secret');
    assert.ok(!/AT-session-token-\d/.test(text), 'no access token');
    assert.ok(!text.includes('Invalid key') && !text.includes('socket closed'), 'no controller or transport text');
    for (const reply of replies) {
      assert.ok(Object.keys(reply as object).every((key) => ['success', 'error', 'diagnostic', 'networkId'].includes(key)), JSON.stringify(reply));
    }
  }); // End of test "controller text echoing the passphrase..."
}); // End of the describe block for redaction
