// Tests for the Wi-Fi network read model through the controller session
// (src/main/controller-session.ts: listManagedNetworks() and
// managedNetworksReply(), the MANAGEMENT_NETWORKS handler's body), driven end
// to end — the real ConnectionManager, OmadaController and OpenApiClient over
// one fake transport whose Open API SSIDs live in memory (no Electron, no
// network):
// - the reply: the allowlisted DTO per network — "All access points" vs
//   "N groups" vs an unknown scope, the enable-field fallback, hasPassphrase;
// - the requests: bounded and deterministic (the catalog pages, then the
//   detail and the bindings of each network, one at a time), explicit v1/v2;
// - malformed payloads (catalog, detail, bindings, garbage pages) and failed
//   calls end the read with a codes-only diagnostic and nothing more is sent;
//   a truncated or oversized catalog is refused before any per-network call —
//   also one the client cannot prove complete (an empty page or a changed
//   totalRows before the total), while a controller-capped page size is read
//   completely and cannot slip past the network cap;
// - bound AP-group ids that are not 24 hex digits make the scope unknown;
// - session binding: management off, not connected, a stale nonce, and a
//   superseding connect, a disconnect, a re-check or a credentials save while
//   the read runs — superseded, late answers discarded, nothing more sent;
// - no reply or log line carries a sentinel secret of the payloads, the
//   Client Secret, a token or controller text.

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { ConnectionManager } from '../../src/main/connection-manager';
import {
  applyManagementAccessChange,
  ControllerSession,
  managedNetworksReply,
  testManagementAccess,
  type ManagementCredentials
} from '../../src/main/controller-session';
import { MAX_PAGES, OpenApiClient, TOKEN_PATH } from '../../src/main/openapi-client';
import { MAX_MANAGED_NETWORKS } from '../../src/main/wifi-network-model';
import type { ManagedNetworksResult } from '../../src/shared/types';
import responses from '../fixtures/controller/responses.json';
import ssidFixtures from '../fixtures/openapi/ssids.json';
import { FakeTransport, type FakeReply, type RecordedRequest } from './helpers/fake-transport';

const BASE_URL = 'https://controller.invalid:8043';
const OMADAC_ID = responses.apiInfo.result.omadacId;
const SITE_ID = responses.sitesSingle.result.data[0].id;
const LOGIN_PATH = `/${OMADAC_ID}/api/v2/login`;
const LOGOUT_PATH = `/${OMADAC_ID}/api/v2/logout`;
const SITES_PATH = `/${OMADAC_ID}/api/v2/sites?currentPage=1&currentPageSize=100`;
const WLANS_PATH = `/${OMADAC_ID}/api/v2/sites/${SITE_ID}/setting/wlans`;
const OPENAPI_SITES = `/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`;
const AP_GROUPS_PAGE = `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/ap-groups?page=1&pageSize=100`;
const SSIDS = `/openapi/v2/${OMADAC_ID}/sites/${SITE_ID}/wireless-network/ssids`;
const SSIDS_PAGE = `${SSIDS}?page=1&pageSize=100`;
const SSID_V1 = `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/wireless-network/ssids`;
const CLIENT_ID = 'owm-client-1';
const CLIENT_SECRET = 'Cl1ent-S3cret-Value-Never-Shown';
// The internal setting/wlans ids of the fixture (the Open API AP groups must match them)
const [DEFAULT_ID, GROUP_B_ID, EMPTY_ID] = responses.wlans.result.data.map((group) => group.id);
const [CASA_ID, TODOS_ID, RARA_ID] = ['5f00c0ffee0000000000c001', '5f00c0ffee0000000000c002', '5f00c0ffee0000000000c003'];

/**
 * A successful Open API envelope.
 * @param {unknown} result - The result.
 * @returns {FakeReply} The reply.
 */
function ok(result: unknown): FakeReply {
  return { body: { errorCode: 0, msg: 'Success.', result } };
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

/** One SSID of the fake controller: the raw Open API payloads it answers with. */
interface FakeNetwork {
  entry: Record<string, unknown>;
  detail: unknown;
  bindings: unknown;
}

/**
 * The default fake networks: "Casa" bound to three AP groups (WPA-Personal,
 * enable state from the catalog's `description`), "Todos" on all access
 * points (open, the detail's ssidEnable), "Rara" with values the ops doc does
 * not define (unknown scope, security, bands and enable state).
 * @returns {FakeNetwork[]} Fresh copies.
 */
function defaultNetworks(): FakeNetwork[] {
  return [
    {
      entry: { id: CASA_ID, ssidId: CASA_ID, name: 'Casa', description: true, chooseDevices: 1, band: 3, security: 3, broadcast: true },
      detail: { id: CASA_ID, name: 'Casa', band: 3, security: 3, chooseDevices: 1, pskSetting: { securityKey: 'casa-passphrase-SENTINEL', versionPsk: 2 }, apGroupIds: [EMPTY_ID, GROUP_B_ID, DEFAULT_ID] },
      bindings: { apGroups: [{ id: DEFAULT_ID, name: 'Default', apNum: 3 }, { id: GROUP_B_ID, name: 'zGrupo B', apNum: 1 }, { id: EMPTY_ID, name: 'zNinguna', apNum: 0 }] }
    },
    {
      entry: { id: TODOS_ID, name: 'Todos', chooseDevices: 0, band: 7, security: 0 },
      detail: { id: TODOS_ID, name: 'Todos', ssidEnable: false, chooseDevices: 0, band: 7, security: 0 },
      bindings: { apGroups: [] }
    },
    {
      entry: { id: RARA_ID, name: 'Rara', description: 'Una red rara', chooseDevices: 7, band: 0, security: 9 },
      detail: { id: RARA_ID, chooseDevices: 7 },
      bindings: { apGroups: [{ id: DEFAULT_ID }] }
    }
  ];
} // End of function defaultNetworks()

// The DTOs of defaultNetworks()
const EXPECTED_NETWORKS = [
  { id: CASA_ID, name: 'Casa', security: 'wpaPersonal', bands: ['band2g', 'band5g'], enabled: true, hasPassphrase: true, scope: 'apGroups', apGroupIds: [DEFAULT_ID, GROUP_B_ID, EMPTY_ID] },
  { id: TODOS_ID, name: 'Todos', security: 'open', bands: ['band2g', 'band5g', 'band6g'], enabled: false, hasPassphrase: false, scope: 'allAccessPoints', apGroupIds: [] },
  { id: RARA_ID, name: 'Rara', security: 'unknown', bands: null, enabled: null, hasPassphrase: null, scope: 'unknown', apGroupIds: [DEFAULT_ID] }
];

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
  // One-shot answers of the next catalog / detail / bindings request, when set
  catalogOverride: (() => FakeReply | Promise<FakeReply>) | null = null;
  detailOverride: ((id: string) => FakeReply | Promise<FakeReply>) | null = null;
  bindingsOverride: ((id: string) => FakeReply | Promise<FakeReply>) | null = null;

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
      .on('GET', AP_GROUPS_PAGE, ok({ totalRows: 3, data: [DEFAULT_ID, GROUP_B_ID, EMPTY_ID].map((id) => ({ id, name: id, apNum: 0, ssidNameList: [] })) }))
      .on('GET', SSIDS_PAGE, () => this.#take('catalog') ?? ok({ totalRows: this.networks.length, currentPage: 1, currentSize: 100, data: this.networks.map((network) => network.entry) }));
    this.routeNetworks([CASA_ID, TODOS_ID, RARA_ID]);
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
   * Registers the detail and bindings routes of the given SSID ids (served
   * from `networks`, or by the one-shot overrides).
   * @param {string[]} ids - The SSID ids.
   */
  routeNetworks(ids: string[]): void {
    for (const id of ids) {
      this.transport
        .on('GET', `${SSID_V1}/${id}`, () => this.#take('detail', id) ?? ok(this.#network(id).detail))
        .on('GET', `${SSID_V1}/${id}/ap-groups`, () => this.#take('bindings', id) ?? ok(this.#network(id).bindings));
    }
  }

  /**
   * Consumes the one-shot override of a route kind, if any.
   * @param {'catalog' | 'detail' | 'bindings'} kind - The route kind.
   * @param {string} [id] - The SSID id.
   * @returns {FakeReply | Promise<FakeReply> | null} The override's answer, or null.
   */
  #take(kind: 'catalog' | 'detail' | 'bindings', id = ''): FakeReply | Promise<FakeReply> | null {
    if (kind === 'catalog' && this.catalogOverride) {
      const answer = this.catalogOverride;
      this.catalogOverride = null;
      return answer();
    }
    if (kind === 'detail' && this.detailOverride) {
      const answer = this.detailOverride;
      this.detailOverride = null;
      return answer(id);
    }
    if (kind === 'bindings' && this.bindingsOverride) {
      const answer = this.bindingsOverride;
      this.bindingsOverride = null;
      return answer(id);
    }
    return null;
  } // End of function #take()

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
   * The recorded SSID requests (catalog, details, bindings).
   * @returns {RecordedRequest[]} The requests.
   */
  ssidRequests(): RecordedRequest[] {
    return this.transport.requests.filter((request) => request.path.includes('/wireless-network/ssids'));
  }

  /**
   * Holds the next request of a kind until the returned deferred is resolved.
   * @param {'catalog' | 'detail' | 'bindings'} kind - The route kind.
   * @returns {Deferred<void>} Resolve it to answer the held request.
   */
  hold(kind: 'catalog' | 'detail' | 'bindings'): Deferred<void> {
    const gate = deferred<void>();
    if (kind === 'catalog') {
      this.catalogOverride = async () => {
        await gate.promise;
        return ok({ totalRows: this.networks.length, data: this.networks.map((network) => network.entry) });
      };
    } else if (kind === 'detail') {
      this.detailOverride = async (id) => {
        await gate.promise;
        return ok(this.#network(id).detail);
      };
    } else {
      this.bindingsOverride = async (id) => {
        await gate.promise;
        return ok(this.#network(id).bindings);
      };
    }
    return gate;
  } // End of function hold()
} // End of class Harness

/**
 * Reads the networks through the reply wrapper (recorded for the secret check).
 * @param {Harness} harness - The harness.
 * @param {string} nonce - The session nonce.
 * @returns {Promise<ManagedNetworksResult>} The reply.
 */
async function read(harness: Harness, nonce: string): Promise<ManagedNetworksResult> {
  const value = await managedNetworksReply(harness.manager, nonce);
  replies.push(value);
  return value;
}

describe('Wi-Fi networks: the read model', () => {
  test('management on: one DTO per network — "All access points", "N groups", an explicit unknown scope; the §5 enable fallback; hasPassphrase', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await read(harness, nonce), { success: true, networks: EXPECTED_NETWORKS });
  });

  test('requests: GET only, one at a time — the v2 catalog page, then per network its v1 detail and v1 bindings: 1 + 2N, in catalog order', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    await read(harness, nonce);
    const requests = harness.ssidRequests();
    assert.deepEqual(
      requests.map((request) => `${request.method} ${request.path}`),
      [
        `GET ${SSIDS_PAGE}`,
        `GET ${SSID_V1}/${CASA_ID}`,
        `GET ${SSID_V1}/${CASA_ID}/ap-groups`,
        `GET ${SSID_V1}/${TODOS_ID}`,
        `GET ${SSID_V1}/${TODOS_ID}/ap-groups`,
        `GET ${SSID_V1}/${RARA_ID}`,
        `GET ${SSID_V1}/${RARA_ID}/ap-groups`
      ]
    );
    assert.equal(requests.length, 1 + 2 * harness.networks.length);
    assert.ok(requests.every((request) => request.headers.Authorization === 'AccessToken=AT-session-token-1' && request.body === undefined));
  }); // End of test "requests: GET only, one at a time..."

  test('requests: two catalog pages for 101 networks → 2 + 2 × 101 requests', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.networks = Array.from({ length: 101 }, (_, index) => {
      const id = `5f00c0ffee${String(index).padStart(14, '0')}`;
      return { entry: { id, name: `Red ${index}`, chooseDevices: 1 }, detail: { id }, bindings: { apGroups: [] } };
    });
    harness.routeNetworks(harness.networks.map((network) => network.entry.id as string));
    harness.transport
      .on('GET', SSIDS_PAGE, ok({ totalRows: 101, data: harness.networks.slice(0, 100).map((network) => network.entry) }))
      .on('GET', `${SSIDS}?page=2&pageSize=100`, ok({ totalRows: 101, data: harness.networks.slice(100).map((network) => network.entry) }));
    const result = await read(harness, nonce);
    assert.equal(result.networks?.length, 101);
    assert.equal(harness.ssidRequests().length, 2 + 2 * 101);
  }); // End of test "requests: two catalog pages for 101 networks..."

  test('an empty catalog: success with no networks, one request', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.networks = [];
    assert.deepEqual(await read(harness, nonce), { success: true, networks: [] });
    assert.equal(harness.ssidRequests().length, 1);
  });

  test('a truncated catalog or one over MAX_MANAGED_NETWORKS: networkListIncomplete before any per-network request', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = Array.from({ length: 100 }, (_, index) => ({ id: `5f00c0ffee${String(page * 1000 + index).padStart(14, '0')}`, name: `Red ${page}-${index}` }));
      harness.transport.on('GET', `${SSIDS}?page=${page}&pageSize=100`, ok({ totalRows: 999999, data }));
    }
    assert.deepEqual(await read(harness, nonce), { success: false, error: 'networkListIncomplete', diagnostic: 'ssids truncated' });
    assert.ok(harness.ssidRequests().every((request) => request.path.startsWith(SSIDS)), 'catalog pages only');

    const big = new Harness();
    const bigNonce = await big.connect();
    const count = MAX_MANAGED_NETWORKS + 1;
    const entries = Array.from({ length: count }, (_, index) => ({ id: `5f00c0ffee${String(index).padStart(14, '0')}`, name: `Red ${index}` }));
    big.transport
      .on('GET', SSIDS_PAGE, ok({ totalRows: count, data: entries.slice(0, 100) }))
      .on('GET', `${SSIDS}?page=2&pageSize=100`, ok({ totalRows: count, data: entries.slice(100) }));
    assert.deepEqual(await read(big, bigNonce), { success: false, error: 'networkListIncomplete', diagnostic: `ssids ${count}, over ${MAX_MANAGED_NETWORKS}` });
    assert.equal(big.ssidRequests().length, 2, 'the two catalog pages, nothing per network');
  }); // End of test "a truncated catalog or one over..."

  test('a controller capping the catalog page size (asked 100, serves 2): the walk follows totalRows and every network is read', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const entries = harness.networks.map((network) => network.entry);
    harness.transport
      .on('GET', SSIDS_PAGE, ok({ totalRows: 3, data: entries.slice(0, 2) }))
      .on('GET', `${SSIDS}?page=2&pageSize=100`, ok({ totalRows: 3, data: entries.slice(2) }));
    assert.deepEqual(await read(harness, nonce), { success: true, networks: EXPECTED_NETWORKS });
    assert.equal(harness.ssidRequests().length, 2 + 2 * 3);
  });

  test('the network cap cannot be bypassed by short pages: 150 networks served 50 per page → networkListIncomplete over the cap, nothing per network', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const count = 150;
    const entries = Array.from({ length: count }, (_, index) => ({ id: `5f00c0ffee${String(index).padStart(14, '0')}`, name: `Red ${index}` }));
    for (let page = 1; page <= 3; page++) {
      harness.transport.on('GET', `${SSIDS}?page=${page}&pageSize=100`, ok({ totalRows: count, data: entries.slice((page - 1) * 50, page * 50) }));
    }
    assert.deepEqual(await read(harness, nonce), { success: false, error: 'networkListIncomplete', diagnostic: `ssids ${count}, over ${MAX_MANAGED_NETWORKS}` });
    assert.equal(harness.ssidRequests().length, 3, 'the three catalog pages, nothing per network');
  }); // End of test "the network cap cannot be bypassed by short pages..."

  test('a catalog that cannot be proven complete (an empty page, a changed totalRows) → networkListIncomplete, never a shorter list; nothing per network', async () => {
    const cases: Array<[string, (entries: unknown[]) => [FakeReply, FakeReply]]> = [
      ['an empty page before totalRows', (entries) => [ok({ totalRows: 5, data: entries }), ok({ totalRows: 5, data: [] })]],
      ['totalRows changes on page 2', (entries) => [ok({ totalRows: 3, data: entries.slice(0, 2) }), ok({ totalRows: 4, data: entries.slice(2) })]],
      ['totalRows dropped on page 2', (entries) => [ok({ totalRows: 3, data: entries.slice(0, 2) }), ok({ data: entries.slice(2) })]]
    ];
    for (const [label, pages] of cases) {
      const harness = new Harness();
      const nonce = await harness.connect();
      const [first, second] = pages(harness.networks.map((network) => network.entry));
      harness.transport.on('GET', SSIDS_PAGE, first).on('GET', `${SSIDS}?page=2&pageSize=100`, second);
      assert.deepEqual(await read(harness, nonce), { success: false, error: 'networkListIncomplete', diagnostic: 'ssids truncated' }, label);
      assert.equal(harness.ssidRequests().length, 2, `${label}: the two catalog pages only`);
    } // End of the loop over the unprovable catalogs
  }); // End of test "a catalog that cannot be proven complete..."

  test('bound AP-group ids that are not 24 hex digits (non-hex, wrong length, a name — each in a mixed list): an unknown scope, never a filtered one; the read succeeds', async () => {
    for (const bad of ['zz'.repeat(12), DEFAULT_ID.slice(1), `${DEFAULT_ID}0`, 'Corrupto']) {
      const harness = new Harness();
      const nonce = await harness.connect();
      const ids = [DEFAULT_ID, GROUP_B_ID, bad];
      const [casa] = harness.networks;
      casa.detail = { ...(casa.detail as Record<string, unknown>), apGroupIds: ids };
      casa.bindings = { apGroups: ids.map((id) => ({ id })) };
      assert.deepEqual(
        await read(harness, nonce),
        { success: true, networks: [{ ...EXPECTED_NETWORKS[0], scope: 'unknown', apGroupIds: null }, ...EXPECTED_NETWORKS.slice(1)] },
        bad
      );
    } // End of the loop over the malformed ids
  }); // End of test "bound AP-group ids that are not 24 hex digits..."
}); // End of the describe block for the read model

describe('Wi-Fi networks: malformed payloads and failed calls end the read (codes only, nothing more sent)', () => {
  test('a malformed catalog (missing id, mixed with a valid entry, garbage page): requestFailed "ssids: malformedResponse", no per-network request', async () => {
    const answers: FakeReply[] = [
      ok({ totalRows: 2, data: [{ id: CASA_ID, name: 'Casa' }, { name: 'Sin id' }] }),
      ok({ totalRows: 2, data: [{ id: CASA_ID, name: 'Casa' }, null] }),
      ok({ data: 'Casa' }),
      ok(null),
      { body: '<html>not json</html>' }
    ];
    for (const answer of answers) {
      const harness = new Harness();
      const nonce = await harness.connect();
      harness.catalogOverride = () => answer;
      assert.deepEqual(await read(harness, nonce), { success: false, error: 'requestFailed', diagnostic: 'ssids: malformedResponse' }, JSON.stringify(answer));
      assert.equal(harness.ssidRequests().length, 1);
    }
  }); // End of test "a malformed catalog..."

  test('a malformed detail (another SSID, no id) or bindings (non-array, mixed list): requestFailed naming the call; nothing after it is sent', async () => {
    const cases: Array<[string, (harness: Harness) => void, string, number]> = [
      ['detail of another SSID', (harness) => (harness.detailOverride = () => ok({ id: TODOS_ID })), 'ssid detail: malformedResponse', 2],
      ['detail without id', (harness) => (harness.detailOverride = () => ok({ name: 'Casa', ssidEnable: true })), 'ssid detail: malformedResponse', 2],
      ['bindings not an array', (harness) => (harness.bindingsOverride = () => ok({ apGroups: 'all' })), 'ssid ap-groups: malformedResponse', 3],
      ['bindings mixed list', (harness) => (harness.bindingsOverride = () => ok({ apGroups: [{ id: DEFAULT_ID }, null] })), 'ssid ap-groups: malformedResponse', 3],
      ['bindings entry without id', (harness) => (harness.bindingsOverride = () => ok({ apGroups: [{ name: 'Default' }] })), 'ssid ap-groups: malformedResponse', 3]
    ];
    for (const [label, arrange, diagnostic, requests] of cases) {
      const harness = new Harness();
      const nonce = await harness.connect();
      arrange(harness);
      assert.deepEqual(await read(harness, nonce), { success: false, error: 'requestFailed', diagnostic }, label);
      assert.equal(harness.ssidRequests().length, requests, `${label}: the read stopped at the failed call`);
    }
  }); // End of test "a malformed detail..."

  test('failed calls: HTTP 503 on a detail, a controller errorCode on the bindings — codes only, never controller text', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.detailOverride = () => ({ status: 503, body: `<html>busy client_secret=${CLIENT_SECRET}</html>` });
    assert.deepEqual(await read(harness, nonce), { success: false, error: 'requestFailed', diagnostic: 'ssid detail: httpError, HTTP 503' });
    harness.bindingsOverride = () => ({ body: { errorCode: -1300, msg: 'Failed to get site information: securityKey=casa-passphrase-SENTINEL' } });
    assert.deepEqual(await read(harness, nonce), { success: false, error: 'requestFailed', diagnostic: 'ssid ap-groups: apiError, errorCode -1300' });
  });
}); // End of the describe block for malformed payloads

describe('Wi-Fi networks: bound to the current session (the 15b invalidation)', () => {
  test('management off (no credentials, an AP-group mismatch) → managementUnavailable with no SSID request; not connected → notConnected; another nonce → superseded', async () => {
    const harness = new Harness();
    harness.credentials = null;
    assert.deepEqual(await read(harness, 'a'.repeat(32)), { success: false, error: 'notConnected' });
    const nonce = await harness.connect();
    assert.deepEqual(await read(harness, nonce), { success: false, error: 'managementUnavailable' });
    assert.deepEqual(harness.transport.requests.filter((request) => request.path.startsWith('/openapi')), []);
    assert.deepEqual(await read(harness, 'b'.repeat(32)), { success: false, error: 'superseded' });

    const mismatch = new Harness();
    mismatch.transport.on('GET', AP_GROUPS_PAGE, ok({ totalRows: 1, data: [{ id: DEFAULT_ID, name: 'Default' }] }));
    const mismatchNonce = await mismatch.connect();
    assert.equal(mismatch.manager.controller?.capabilities?.reason, 'apGroupsMismatch');
    assert.deepEqual(await read(mismatch, mismatchNonce), { success: false, error: 'managementUnavailable' });
    assert.deepEqual(mismatch.ssidRequests(), []);
  }); // End of test "management off..."

  test('a superseding connect while the catalog is held: superseded, no detail is ever requested; the old nonce stays superseded', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const gate = harness.hold('catalog');
    const pending = read(harness, nonce);
    await until(() => harness.ssidRequests().length === 1);
    const reconnect = harness.manager.connect();
    gate.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.equal((await reconnect).success, true);
    assert.equal(harness.ssidRequests().length, 1, 'no per-network request after the supersession');
    assert.deepEqual(await read(harness, nonce), { success: false, error: 'superseded' });
  }); // End of test "a superseding connect while the catalog is held..."

  test('a disconnect while a detail is held: the late answer is discarded (superseded), no bindings request follows', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const gate = harness.hold('detail');
    const pending = read(harness, nonce);
    await until(() => harness.ssidRequests().length === 2);
    await harness.manager.disconnect();
    gate.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.equal(harness.ssidRequests().length, 2);
    assert.deepEqual(await read(harness, nonce), { success: false, error: 'notConnected' });
  }); // End of test "a disconnect while a detail is held..."

  test('"Test management access" (a new check run) while bindings are held: superseded, nothing more sent; the new run\'s client serves the next read', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const gate = harness.hold('bindings');
    const pending = read(harness, nonce);
    await until(() => harness.ssidRequests().length === 3);
    const retest = testManagementAccess(harness.manager, nonce);
    gate.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.equal(harness.ssidRequests().length, 3);
    assert.equal((await retest).capabilities?.manageWifiNetworks, true);
    assert.deepEqual(await read(harness, nonce), { success: true, networks: EXPECTED_NETWORKS });
  }); // End of test ""Test management access" while bindings are held..."

  test('a management-credentials save while the catalog is held: superseded; the next read re-checks with the new credentials first', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const gate = harness.hold('catalog');
    const pending = read(harness, nonce);
    await until(() => harness.ssidRequests().length === 1);
    applyManagementAccessChange(harness.manager, { url: BASE_URL, username: 'admin', language: 'es', clientId: 'owm-client-2', clientSecret: 'another-secret' });
    gate.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.equal(harness.ssidRequests().length, 1);
    const tokensBefore = harness.tokensIssued;
    assert.deepEqual(await read(harness, nonce), { success: true, networks: EXPECTED_NETWORKS });
    assert.equal(harness.tokensIssued, tokensBefore + 1, 'the checks ran again (a new token) before the read');
  }); // End of test "a management-credentials save while the catalog is held..."
}); // End of the describe block for session binding

describe('Wi-Fi networks: no secret in any reply or log line', () => {
  test('sentinel secrets at any depth of the payloads, the Client Secret, tokens and controller text never reach a reply or a log line', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const { entry, detail, bindings, expected } = ssidFixtures.secrets;
    harness.networks = [{ entry, detail, bindings }];
    harness.routeNetworks([entry.id]);
    assert.deepEqual(await read(harness, nonce), { success: true, networks: [expected] });
    // A failing read whose controller text carries a secret
    harness.detailOverride = () => ({ body: { errorCode: -1, msg: `securityKey=${detail.pskSetting.securityKey} AccessToken=AT-session-token-1 ${CLIENT_SECRET}` } });
    replies.push(await read(harness, nonce));
    const text = JSON.stringify(replies) + logLines.join('\n');
    assert.ok(replies.length >= 20, 'every reply of this file is checked');
    assert.ok(!text.includes('SENTINEL'), 'no sentinel secret');
    assert.ok(!text.includes(CLIENT_SECRET), 'no Client Secret');
    assert.ok(!/AT-session-token-\d/.test(text), 'no access token');
    assert.ok(!text.includes('Failed to get site information'), 'no controller text');
  }); // End of test "sentinel secrets at any depth..."
}); // End of the describe block for redaction
