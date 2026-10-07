// Tests for the Wi-Fi network binding write through the controller session
// (src/main/controller-session.ts: updateNetworkBindings() and
// updateNetworkBindingsReply(), the MANAGEMENT_NETWORK_BINDINGS handler's body;
// todo.md 4.12, phase 19a), driven end to end — the real ConnectionManager,
// OmadaController and OpenApiClient over one fake transport whose Open API
// SSIDs and AP groups live in memory (no Electron, no network):
// - the exact requests: the fresh SSID catalog, the fresh detail, the fresh
//   bindings, the fresh AP-group list, then exactly one PATCH …/ap-groups
//   with exactly {apGroupIds}; Enterprise / PPSK networks may be bound (D3);
// - the request rules answered before any request;
// - never a binding PATCH for an "All access points" or unknown-scope network
//   (whatever the bindings answer and the request) — the catalog and the
//   detail disagreeing included —, and no AP-group read;
// - the catalog: incomplete or over the cap → networkListIncomplete, the
//   network not listed → networkNotFound, nothing per network; it is re-read
//   inside the serialized operation (a queued write sees the catalog as it
//   is when its turn comes);
// - fresh data contradicting the renderer (bindings, scope, capacity, a
//   deleted group, an incomplete list) decides;
// - the capacity of ADDED groups: every failing group + band named, a missing
//   remainingBinding failing closed, unknown bands only refusing additions;
//   MLO: an unknown MLO state refusing additions, an MLO network's added
//   groups failing on MLO capacity (no documented key: unknown);
// - controller errors mapped to codes with codes-only diagnostics;
// - session binding: management off, not connected, a stale nonce, and a
//   superseding connect, a disconnect, a re-check or a credentials save while
//   a read or the PATCH is held — superseded, nothing more sent; a QUEUED
//   binding write invalidated before its turn sends nothing;
// - no Client Secret, token or controller text in a reply or a log line.

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { ConnectionManager } from '../../src/main/connection-manager';
import {
  applyManagementAccessChange,
  ControllerSession,
  setNetworkEnabledReply,
  testManagementAccess,
  updateNetworkBindingsReply,
  type ManagementCredentials
} from '../../src/main/controller-session';
import { OpenApiClient, TOKEN_PATH } from '../../src/main/openapi-client';
import { MAX_MANAGED_NETWORKS } from '../../src/main/wifi-network-model';
import type { NetworkActionResult, NetworkBindingsResult } from '../../src/shared/types';
import responses from '../fixtures/controller/responses.json';
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
// The fake controller's networks
const [CASA_ID, ALL_ID, ENTERPRISE_ID, PPSK_ID] = ['5f00c0ffee0000000000c001', '5f00c0ffee0000000000c002', '5f00c0ffee0000000000c003', '5f00c0ffee0000000000c004'];

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

/**
 * Lets pending promise and I/O callbacks run for a while.
 * @returns {Promise<void>}
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 20; round++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
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

/** One SSID of the fake controller: its raw v2 catalog entry, v1 detail and v1 bindings `result`s. */
interface FakeNetwork {
  entry: Record<string, unknown>;
  detail: Record<string, unknown>;
  bindings: Record<string, unknown>;
}

/**
 * The raw bindings `result` of a network bound to the given groups.
 * @param {string[]} ids - The bound group ids.
 * @returns {Record<string, unknown>} The result.
 */
function boundResult(ids: string[]): Record<string, unknown> {
  return { apGroups: ids.map((id) => ({ id, name: `Group ${id.slice(-2)}`, apNum: 1, remainingBinding: { 0: 3, 1: 3, 2: 3 } })), maxSsids2G: 8, maxSsids5G: 8, maxSsids6G: 8 };
}

/**
 * The default fake networks: "Casa" (WPA-Personal, 2.4 + 5 GHz, bound to
 * Default), "Todos" ("All access points", every band), "Empresa"
 * (WPA-Enterprise) and "Clave única" (PPSK), both bound to zGrupo B. The
 * catalog entry agrees with the detail; MLO is off.
 * @returns {Map<string, FakeNetwork>} Fresh copies by id.
 */
function defaultNetworks(): Map<string, FakeNetwork> {
  const network = (id: string, name: string, security: number, band: number, chooseDevices: number, ids: string[]): [string, FakeNetwork] => [
    id,
    {
      entry: { id, name, description: true, security, band, chooseDevices },
      detail: { id, name, security, band, chooseDevices, apGroupIds: ids, ssidEnable: true, mloEnable: false, pskSetting: { securityKey: 'fixture-key-never-shown' } },
      bindings: boundResult(ids)
    }
  ];
  return new Map([
    network(CASA_ID, 'Casa', 3, 3, 1, [DEFAULT_ID]),
    network(ALL_ID, 'Todos', 0, 7, 0, []),
    network(ENTERPRISE_ID, 'Empresa', 2, 3, 1, [GROUP_B_ID]),
    network(PPSK_ID, 'Clave única', 4, 1, 1, [GROUP_B_ID])
  ]);
} // End of function defaultNetworks()

/**
 * The default fresh AP-group list entries (the internal list's ids, so every
 * capability check passes), each with room on every band.
 * @returns {Array<Record<string, unknown>>} Fresh copies.
 */
function defaultGroups(): Array<Record<string, unknown>> {
  return [DEFAULT_ID, GROUP_B_ID, EMPTY_ID].map((id) => ({ id, name: `Group ${id.slice(-2)}`, apNum: 0, ssidNameList: [], remainingBinding: { 0: 5, 1: 5, 2: 5 } }));
}

/** The kinds of request a test can hold or answer once. */
type RouteKind = 'groups' | 'catalog' | 'detail' | 'bindings' | 'patch' | 'enable';

/**
 * The fake environment: one transport serving the internal API and the Open
 * API (the AP groups match the internal list, so every capability check
 * passes; the SSIDs — catalog entries in insertion order, details, bindings —
 * come from `networks`, the AP-group list from `groups`),
 * the configured URL and management credentials, and the real
 * ConnectionManager over ControllerSessions.
 */
class Harness {
  readonly transport = new FakeTransport(BASE_URL);
  configuredUrl = BASE_URL;
  credentials: ManagementCredentials | null = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
  tokensIssued = 0;
  readonly manager: ConnectionManager<ControllerSession>;
  readonly networks = defaultNetworks();
  groups = defaultGroups();
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
      .on('GET', AP_GROUPS_PAGE, () => this.#take('groups') ?? ok({ totalRows: this.groups.length, data: this.groups }))
      .on('GET', SSIDS_PAGE, () => this.#take('catalog') ?? ok({ totalRows: this.networks.size, data: [...this.networks.values()].map((network) => network.entry) }));
    for (const id of this.networks.keys()) {
      this.transport
        .on('GET', `${SSID_V1}/${id}`, () => this.#take('detail') ?? ok(this.#network(id).detail))
        .on('GET', `${SSID_V1}/${id}/ap-groups`, () => this.#take('bindings') ?? ok(this.#network(id).bindings))
        .on('PATCH', `${SSID_V1}/${id}/ap-groups`, () => this.#take('patch') ?? ok())
        .on('PATCH', `${SSID_V1}/${id}/enable`, () => this.#take('enable') ?? ok());
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
    const found = this.networks.get(id);
    assert.ok(found, `fake network ${id}`);
    return found;
  }

  /**
   * Re-binds a fake network (detail apGroupIds and bindings) behind the
   * renderer's back.
   * @param {string} id - The SSID id.
   * @param {string[]} ids - The bound group ids.
   */
  rebind(id: string, ids: string[]): void {
    const network = this.#network(id);
    network.detail.apGroupIds = [...ids];
    network.bindings = boundResult(ids);
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
   * The recorded Open API requests of the site's SSIDs (catalog included)
   * and AP groups (not the token, not the site list) from index `from` on, as
   * "METHOD path".
   * @param {number} [from] - The first request index.
   * @returns {string[]} The requests.
   */
  siteLog(from = 0): string[] {
    return this.transport.requests
      .slice(from)
      .filter((request) => request.path.startsWith(SSID_V1) || request.path.startsWith(SSIDS) || request.path.startsWith(AP_GROUPS))
      .map((request) => `${request.method} ${request.path}`);
  }

  /**
   * The recorded SSID reads (catalog, details, bindings) from index `from` on,
   * as "METHOD path" (the capability checks never read SSIDs).
   * @param {number} [from] - The first request index.
   * @returns {string[]} The requests.
   */
  ssidReads(from = 0): string[] {
    return this.siteLog(from).filter((line) => line.startsWith(`GET ${SSID_V1}`) || line.startsWith(`GET ${SSIDS}`));
  }

  /**
   * The recorded binding PATCH requests.
   * @returns {RecordedRequest[]} The requests.
   */
  bindingPatches(): RecordedRequest[] {
    return this.transport.requests.filter((request) => request.method === 'PATCH' && request.path.endsWith('/ap-groups'));
  }

  /**
   * Holds the next request of a kind until the returned deferred is resolved,
   * then answers it with `answer`.
   * @param {RouteKind} kind - The route kind.
   * @param {() => FakeReply} answer - The answer once released.
   * @returns {Deferred<void>} Resolve it to answer the held request.
   */
  hold(kind: RouteKind, answer: () => FakeReply): Deferred<void> {
    const gate = deferred<void>();
    this.overrides.set(kind, async () => {
      await gate.promise;
      return answer();
    });
    return gate;
  }
} // End of class Harness

/**
 * Sends one binding write and records its reply (for the secret check).
 * @param {Harness} harness - The harness.
 * @param {string} nonce - The session nonce.
 * @param {string} networkId - The network.
 * @param {string[]} apGroupIds - The requested set.
 * @returns {Promise<NetworkBindingsResult>} The reply.
 */
async function bind(harness: Harness, nonce: string, networkId: string, apGroupIds: string[]): Promise<NetworkBindingsResult> {
  const reply = await updateNetworkBindingsReply(harness.manager, { sessionNonce: nonce, networkId, apGroupIds });
  replies.push(reply);
  return reply;
}

/**
 * The paths of the four fresh reads of a binding write, in order.
 * @param {string} networkId - The network.
 * @returns {string[]} "METHOD path" of the catalog, detail, bindings and AP-group reads.
 */
function freshReads(networkId: string): string[] {
  return [`GET ${SSIDS_PAGE}`, `GET ${SSID_V1}/${networkId}`, `GET ${SSID_V1}/${networkId}/ap-groups`, `GET ${AP_GROUPS_PAGE}`];
}

/**
 * Sets a raw field of a fake network's catalog entry AND detail (the
 * controller changed the network: both sources agree).
 * @param {Harness} harness - The harness.
 * @param {string} id - The SSID id.
 * @param {string} field - The raw field.
 * @param {unknown} value - Its value (undefined: removed from both).
 */
function setBoth(harness: Harness, id: string, field: string, value: unknown): void {
  const network = harness.networks.get(id)!;
  for (const raw of [network.entry, network.detail]) {
    if (value === undefined) {
      delete raw[field];
    } else {
      raw[field] = value;
    }
  }
}

describe('Binding write: the requests (fresh reads first, then exactly one PATCH)', () => {
  test('Casa gains a group: GET the catalog, GET the detail, GET the bindings, GET the AP-group list, then PATCH …/ap-groups with exactly {apGroupIds} — the complete new set', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const from = harness.transport.requests.length;
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: true });
    assert.deepEqual(harness.siteLog(from), [...freshReads(CASA_ID), `PATCH ${SSID_V1}/${CASA_ID}/ap-groups`]);
    const [patch] = harness.bindingPatches();
    assert.deepEqual(patch.body, { apGroupIds: [DEFAULT_ID, EMPTY_ID] });
    assert.equal(patch.headers.Authorization, 'AccessToken=AT-session-token-1');
  });

  test('a removal and a swap: the body is the requested set in request order (never a delta); removals need no capacity data', async () => {
    const harness = new Harness();
    harness.rebind(CASA_ID, [DEFAULT_ID, GROUP_B_ID]);
    const nonce = await harness.connect();
    harness.groups = defaultGroups().map((group) => ({ ...group, remainingBinding: undefined }));
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [GROUP_B_ID]), { success: true });
    harness.groups = defaultGroups();
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [EMPTY_ID, DEFAULT_ID, EMPTY_ID]), { success: true });
    assert.deepEqual(harness.bindingPatches().map((request) => request.body), [{ apGroupIds: [GROUP_B_ID] }, { apGroupIds: [EMPTY_ID, DEFAULT_ID] }]);
  });

  test('Enterprise and PPSK networks may be bound (user decision D3)', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    assert.deepEqual(await bind(harness, nonce, ENTERPRISE_ID, [GROUP_B_ID, DEFAULT_ID]), { success: true });
    assert.deepEqual(await bind(harness, nonce, PPSK_ID, [EMPTY_ID]), { success: true });
    assert.deepEqual(
      harness.bindingPatches().map((request) => `${request.path} ${JSON.stringify(request.body)}`),
      [`${SSID_V1}/${ENTERPRISE_ID}/ap-groups ${JSON.stringify({ apGroupIds: [GROUP_B_ID, DEFAULT_ID] })}`, `${SSID_V1}/${PPSK_ID}/ap-groups ${JSON.stringify({ apGroupIds: [EMPTY_ID] })}`]
    );
  });
}); // End of the describe block for the requests

describe('Binding write: refusals', () => {
  test('the request rules are answered before any request (no group, a non-24-hex id) — even before the capabilities are consulted', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const before = harness.transport.requests.length;
    assert.deepEqual(await bind(harness, nonce, CASA_ID, []), { success: false, error: 'groupsRequired' });
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, 'not-an-ap-group-id']), { success: false, error: 'groupNotFound' });
    harness.credentials = null;
    applyManagementAccessChange(harness.manager, { url: BASE_URL, username: 'admin', language: 'es', removeManagementAccess: true });
    assert.deepEqual(await bind(harness, nonce, CASA_ID, []), { success: false, error: 'groupsRequired' });
    assert.equal(harness.transport.requests.length, before, 'nothing was sent');
  }); // End of test "the request rules are answered before any request…"

  test('"All access points": NO binding PATCH is ever sent — whatever the bindings answer (none, every group, not reported) and whatever is asked — and the AP-group list is not even read', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const answers: Array<Record<string, unknown>> = [boundResult([]), boundResult([DEFAULT_ID, GROUP_B_ID, EMPTY_ID]), { apGroups: null }, {}];
    const requests = [[DEFAULT_ID], [DEFAULT_ID, GROUP_B_ID, EMPTY_ID], [EMPTY_ID], [UNKNOWN_GROUP_ID]];
    for (const answer of answers) {
      harness.networks.get(ALL_ID)!.bindings = answer;
      harness.networks.get(ALL_ID)!.detail.apGroupIds = ((answer.apGroups as Array<{ id: string }> | null | undefined) ?? []).map((entry) => entry.id);
      for (const requested of requests) {
        const from = harness.transport.requests.length;
        assert.deepEqual(await bind(harness, nonce, ALL_ID, requested), { success: false, error: 'scopeAllAccessPoints' }, JSON.stringify([answer, requested]));
        assert.deepEqual(harness.siteLog(from), freshReads(ALL_ID).slice(0, 3), 'the catalog, the detail and the bindings only');
      }
    } // End of the loop over the bindings answers
    // A network the renderer still believed bound to groups, turned "all" on the controller
    setBoth(harness, CASA_ID, 'chooseDevices', 0);
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'scopeAllAccessPoints' });
    assert.deepEqual(harness.bindingPatches(), [], 'no binding PATCH, ever');
  }); // End of test ""All access points": NO binding PATCH…"

  test('an unknown scope: NO binding PATCH (no or an unrecognized device selection, bindings contradicting the detail, a bound id that is not 24 hex digits)', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const casa = harness.networks.get(CASA_ID)!;
    const variants: Array<[string, () => void]> = [
      ['no chooseDevices (catalog and detail)', () => setBoth(harness, CASA_ID, 'chooseDevices', undefined)],
      ['chooseDevices 5', () => (casa.detail.chooseDevices = 5)],
      ['chooseDevices "1"', () => (casa.detail.chooseDevices = '1')],
      ['bindings contradicting the detail', () => (casa.bindings = boundResult([DEFAULT_ID, GROUP_B_ID]))],
      ['a bound id that is not 24 hex digits', () => (casa.bindings = { apGroups: [{ id: DEFAULT_ID }, { id: 'legacy_group_01' }] })],
      ['nothing reported about the bindings', () => ((casa.bindings = {}), delete casa.detail.apGroupIds)]
    ];
    for (const [label, apply] of variants) {
      // Back to the default Casa (fresh entry, detail and bindings objects), then the variant
      Object.assign(casa, defaultNetworks().get(CASA_ID)!);
      apply();
      const from = harness.transport.requests.length;
      assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'scopeUnknown' }, label);
      assert.deepEqual(harness.siteLog(from), freshReads(CASA_ID).slice(0, 3), label);
    } // End of the loop over the unknown-scope variants
    assert.deepEqual(harness.bindingPatches(), []);
  }); // End of test "an unknown scope: NO binding PATCH…"

  test('the catalog and the detail disagreeing is an unknown scope, as in the network list: NO binding PATCH, no AP-group read — never judged from the detail alone', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const casa = harness.networks.get(CASA_ID)!;
    const variants: Array<[string, () => void]> = [
      ['catalog "All access points", detail "AP groups"', () => (casa.entry.chooseDevices = 0)],
      ['catalog "AP groups", detail "All access points"', () => (casa.detail.chooseDevices = 0)],
      ['catalog chooseDevices unrecognized', () => (casa.entry.chooseDevices = 5)],
      ['catalog chooseDevices a string', () => (casa.entry.chooseDevices = '1')]
    ];
    for (const [label, apply] of variants) {
      Object.assign(casa, defaultNetworks().get(CASA_ID)!);
      apply();
      const from = harness.transport.requests.length;
      // Adding and removing alike: the scope rule comes first
      assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'scopeUnknown' }, label);
      assert.deepEqual(await bind(harness, nonce, CASA_ID, [EMPTY_ID]), { success: false, error: 'scopeUnknown' }, label);
      assert.deepEqual(harness.siteLog(from), [...freshReads(CASA_ID).slice(0, 3), ...freshReads(CASA_ID).slice(0, 3)], `${label}: no AP-group read`);
    } // End of the loop over the disagreements
    assert.deepEqual(harness.bindingPatches(), [], 'no binding PATCH');
    // The bands disagreeing: unknown bands — an addition is refused, a removal is not
    Object.assign(casa, defaultNetworks().get(CASA_ID)!);
    harness.rebind(CASA_ID, [DEFAULT_ID, GROUP_B_ID]);
    casa.entry.band = 7;
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, GROUP_B_ID, EMPTY_ID]), { success: false, error: 'networkStateUnknown', diagnostic: 'bands unknown' });
    assert.deepEqual(harness.bindingPatches(), []);
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID]), { success: true });
  }); // End of test "the catalog and the detail disagreeing…"

  test('the catalog must be complete and list the network: not listed → networkNotFound, truncated or over the cap → networkListIncomplete; nothing per network, no PATCH', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    // Deleted on the controller (the renderer still lists it): the detail would still answer
    const from = harness.transport.requests.length;
    harness.overrides.set('catalog', () => ok({ totalRows: 2, data: [harness.networks.get(ALL_ID)!.entry, harness.networks.get(PPSK_ID)!.entry] }));
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'networkNotFound' });
    assert.deepEqual(harness.siteLog(from), [`GET ${SSIDS_PAGE}`], 'the catalog only');
    // A catalog that cannot be proven complete (an empty page 2 before totalRows)
    const entries = [...harness.networks.values()].map((network) => network.entry);
    harness.overrides.set('catalog', () => ok({ totalRows: entries.length + 1, data: entries }));
    harness.transport.on('GET', `${SSIDS}?page=2&pageSize=100`, ok({ totalRows: entries.length + 1, data: [] }));
    const truncatedFrom = harness.transport.requests.length;
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'networkListIncomplete', diagnostic: 'ssids truncated' });
    assert.deepEqual(harness.siteLog(truncatedFrom), [`GET ${SSIDS_PAGE}`, `GET ${SSIDS}?page=2&pageSize=100`], 'the catalog pages only');
    // Over the cap, Casa included (on page 2)
    const count = MAX_MANAGED_NETWORKS + 1;
    const many = [
      ...Array.from({ length: count - 1 }, (_, index) => ({ id: `5f00c0ffee${String(index).padStart(14, '0')}`, name: `Red ${index}` })),
      harness.networks.get(CASA_ID)!.entry
    ];
    harness.overrides.set('catalog', () => ok({ totalRows: count, data: many.slice(0, 100) }));
    harness.transport.on('GET', `${SSIDS}?page=2&pageSize=100`, ok({ totalRows: count, data: many.slice(100) }));
    const bigFrom = harness.transport.requests.length;
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'networkListIncomplete', diagnostic: `ssids ${count}, over ${MAX_MANAGED_NETWORKS}` });
    assert.deepEqual(harness.siteLog(bigFrom), [`GET ${SSIDS_PAGE}`, `GET ${SSIDS}?page=2&pageSize=100`], 'the catalog pages only');
    assert.deepEqual(harness.bindingPatches(), []);
  }); // End of test "the catalog must be complete and list the network…"

  test('fresh data contradicting the renderer decides: bindings already as asked → nothingToChange; a group deleted meanwhile → groupNotFound; an incomplete list → groupListIncomplete; no PATCH', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    // The renderer believed Casa bound to Default only; it is bound to both already
    harness.rebind(CASA_ID, [DEFAULT_ID, GROUP_B_ID]);
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [GROUP_B_ID, DEFAULT_ID]), { success: false, error: 'nothingToChange' });
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [UNKNOWN_GROUP_ID, DEFAULT_ID]), { success: false, error: 'groupNotFound' });
    // zNinguna was deleted on the controller (the renderer still lists it)
    harness.overrides.set('groups', () => ok({ totalRows: 2, data: defaultGroups().slice(0, 2) }));
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'groupNotFound' });
    harness.overrides.set('groups', () => ok({ totalRows: 5, data: defaultGroups() }));
    harness.transport.on('GET', `${AP_GROUPS}?page=2&pageSize=100`, ok({ totalRows: 5, data: [] }));
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'groupListIncomplete', diagnostic: 'ap-groups truncated' });
    assert.deepEqual(harness.bindingPatches(), []);
  }); // End of test "fresh data contradicting the renderer decides…"

  test('the diff is computed against the FRESH bindings: a group the renderer thought bound but is not counts as added (and its capacity is checked); one bound meanwhile and kept is not', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.groups = defaultGroups().map((group) => (group.id === EMPTY_ID ? { ...group, remainingBinding: { 0: 0, 1: 0, 2: 0 } } : group));
    // zNinguna is full and not bound on the controller: adding it is refused
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), {
      success: false,
      error: 'capacityInsufficient',
      diagnostic: 'capacity: 2 full, 0 unknown',
      capacityProblems: [
        { apGroupId: EMPTY_ID, band: 'band2g', reason: 'full' },
        { apGroupId: EMPTY_ID, band: 'band5g', reason: 'full' }
      ]
    });
    // Bound on the controller meanwhile: zNinguna is KEPT, so its full capacity does not matter
    harness.rebind(CASA_ID, [DEFAULT_ID, EMPTY_ID]);
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID, GROUP_B_ID]), { success: true });
    assert.deepEqual(harness.bindingPatches().map((request) => request.body), [{ apGroupIds: [DEFAULT_ID, EMPTY_ID, GROUP_B_ID] }]);
  }); // End of test "the diff is computed against the FRESH bindings…"

  test('capacity: every failing group + band is named (full and not reported), a missing remainingBinding fails closed, the 6 GHz key counts; unknown bands refuse only additions', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.groups = [
      { id: DEFAULT_ID, name: 'Default', remainingBinding: { 0: 5, 1: 5 } },
      { id: GROUP_B_ID, name: 'B', remainingBinding: { 0: 0, 1: 'x', 2: 4 } },
      { id: EMPTY_ID, name: 'Empty' }
    ];
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, GROUP_B_ID, EMPTY_ID]), {
      success: false,
      error: 'capacityInsufficient',
      diagnostic: 'capacity: 1 full, 3 unknown',
      capacityProblems: [
        { apGroupId: GROUP_B_ID, band: 'band2g', reason: 'full' },
        { apGroupId: GROUP_B_ID, band: 'band5g', reason: 'unknown' },
        { apGroupId: EMPTY_ID, band: 'band2g', reason: 'unknown' },
        { apGroupId: EMPTY_ID, band: 'band5g', reason: 'unknown' }
      ]
    });
    // A 6 GHz network: Default reports no 6 GHz value
    setBoth(harness, PPSK_ID, 'band', 4);
    assert.deepEqual(await bind(harness, nonce, PPSK_ID, [GROUP_B_ID, DEFAULT_ID]), {
      success: false,
      error: 'capacityInsufficient',
      diagnostic: 'capacity: 0 full, 1 unknown',
      capacityProblems: [{ apGroupId: DEFAULT_ID, band: 'band6g', reason: 'unknown' }]
    });
    // Bands unknown: adding is refused, removing is not
    harness.groups = defaultGroups();
    harness.rebind(CASA_ID, [DEFAULT_ID, GROUP_B_ID]);
    setBoth(harness, CASA_ID, 'band', undefined);
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, GROUP_B_ID, EMPTY_ID]), { success: false, error: 'networkStateUnknown', diagnostic: 'bands unknown' });
    assert.deepEqual(harness.bindingPatches(), []);
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID]), { success: true });
  }); // End of test "capacity: every failing group + band is named…"

  test('MLO: an unknown MLO state (absent, null, malformed) refuses additions (networkStateUnknown "mlo unknown") but not removals; an MLO network can gain no group while no MLO capacity key is documented', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const casa = harness.networks.get(CASA_ID)!;
    for (const value of [undefined, null, 'false', 0]) {
      Object.assign(casa, defaultNetworks().get(CASA_ID)!);
      harness.rebind(CASA_ID, [DEFAULT_ID, GROUP_B_ID]);
      if (value === undefined) {
        delete casa.detail.mloEnable;
      } else {
        casa.detail.mloEnable = value;
      }
      assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, GROUP_B_ID, EMPTY_ID]), { success: false, error: 'networkStateUnknown', diagnostic: 'mlo unknown' }, String(value));
      assert.deepEqual(harness.bindingPatches(), [], String(value));
    } // End of the loop over the unknown MLO states
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [GROUP_B_ID]), { success: true }, 'a removal needs no MLO state');
    // MLO on: room on every band (and an MLO-looking extra key) is not MLO room
    Object.assign(casa, defaultNetworks().get(CASA_ID)!);
    casa.detail.mloEnable = true;
    harness.groups = defaultGroups().map((group) => ({ ...group, remainingBinding: { 0: 5, 1: 5, 2: 5, 3: 5 } }));
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, GROUP_B_ID, EMPTY_ID]), {
      success: false,
      error: 'capacityInsufficient',
      diagnostic: 'capacity: 0 full, 2 unknown',
      capacityProblems: [
        { apGroupId: GROUP_B_ID, band: 'mlo', reason: 'unknown' },
        { apGroupId: EMPTY_ID, band: 'mlo', reason: 'unknown' }
      ]
    });
    assert.equal(harness.bindingPatches().length, 1, 'only the removal was sent');
    // A removal from an MLO network is sent; MLO off, the same addition is sent too
    harness.rebind(CASA_ID, [DEFAULT_ID, GROUP_B_ID]);
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [GROUP_B_ID]), { success: true });
    casa.detail.mloEnable = false;
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [GROUP_B_ID, DEFAULT_ID, EMPTY_ID]), { success: true });
    assert.deepEqual(harness.bindingPatches().map((request) => request.body), [{ apGroupIds: [GROUP_B_ID] }, { apGroupIds: [GROUP_B_ID] }, { apGroupIds: [GROUP_B_ID, DEFAULT_ID, EMPTY_ID] }]);
  }); // End of test "MLO: an unknown MLO state…"
}); // End of the describe block for the refusals

describe('Binding write: controller errors (stable codes, codes-only diagnostics)', () => {
  test('a refused PATCH, a failed or malformed fresh read: requestFailed naming the call; nothing after a failed read', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const cases: Array<[RouteKind, FakeReply, NetworkBindingsResult]> = [
      ['patch', apiError(-33000, 'This site does not exist.'), { success: false, error: 'requestFailed', diagnostic: 'ssid bindings: apiError, errorCode -33000' }],
      ['patch', { status: 500, body: '<html>oops</html>' }, { success: false, error: 'requestFailed', diagnostic: 'ssid bindings: httpError, HTTP 500' }],
      ['catalog', { status: 502, body: 'gateway' }, { success: false, error: 'requestFailed', diagnostic: 'ssids: httpError, HTTP 502' }],
      ['catalog', ok({ totalRows: 1, data: [{ id: CASA_ID }] }), { success: false, error: 'requestFailed', diagnostic: 'ssids: malformedResponse' }],
      ['detail', { status: 503, body: 'busy' }, { success: false, error: 'requestFailed', diagnostic: 'ssid detail: httpError, HTTP 503' }],
      ['detail', ok({ id: ALL_ID, chooseDevices: 1 }), { success: false, error: 'requestFailed', diagnostic: 'ssid detail: malformedResponse' }],
      ['bindings', ok({ apGroups: 'all' }), { success: false, error: 'requestFailed', diagnostic: 'ssid ap-groups: malformedResponse' }],
      ['bindings', apiError(-1300), { success: false, error: 'requestFailed', diagnostic: 'ssid ap-groups: apiError, errorCode -1300' }],
      ['groups', { status: 503, body: 'busy' }, { success: false, error: 'requestFailed', diagnostic: 'ap-groups: httpError, HTTP 503' }]
    ];
    for (const [kind, answer, expected] of cases) {
      harness.overrides.set(kind, () => answer);
      assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), expected, `${kind} ${JSON.stringify(answer.body)}`);
    }
    assert.equal(harness.bindingPatches().length, 2, 'only the two refused PATCHes were sent');
  }); // End of test "a refused PATCH, a failed or malformed fresh read…"
}); // End of the describe block for controller errors

describe('Binding write: bound to the current session (the 15b invalidation)', () => {
  test('management off → managementUnavailable with no Open API request; not connected → notConnected; another nonce → superseded', async () => {
    const harness = new Harness();
    harness.credentials = null;
    assert.deepEqual(await bind(harness, 'a'.repeat(32), CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'notConnected' });
    const nonce = await harness.connect();
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'managementUnavailable' });
    assert.deepEqual(harness.transport.requests.filter((request) => request.path.startsWith('/openapi')), []);
    assert.deepEqual(await bind(harness, 'b'.repeat(32), CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'superseded' });
  });

  // Each in-flight case: the request held, the invalidation, the release —
  // superseded, and nothing sent after the held request
  const inFlight: Array<[string, RouteKind, (harness: Harness, nonce: string) => Promise<unknown>]> = [
    ['a superseding connect while the fresh catalog is held', 'catalog', (harness) => harness.manager.connect()],
    ['a superseding connect while the fresh detail is held', 'detail', (harness) => harness.manager.connect()],
    ['"Test management access" while the fresh bindings are held', 'bindings', (harness, nonce) => testManagementAccess(harness.manager, nonce)],
    [
      'a management-credentials save while the AP-group read is held',
      'groups',
      async (harness) => applyManagementAccessChange(harness.manager, { url: BASE_URL, username: 'admin', language: 'es', clientId: 'owm-client-2', clientSecret: 'another-secret' })
    ],
    ['a disconnect while the fresh detail is held', 'detail', (harness) => harness.manager.disconnect()]
  ];
  for (const [label, kind, invalidate] of inFlight) {
    test(`${label}: superseded, no binding PATCH is ever sent`, async () => {
      const harness = new Harness();
      const nonce = await harness.connect();
      const reads = { catalog: 1, detail: 2, bindings: 3, groups: 4 } as Record<string, number>;
      const from = harness.transport.requests.length;
      const casa = harness.networks.get(CASA_ID)!;
      const answers: Record<string, () => FakeReply> = {
        catalog: () => ok({ totalRows: harness.networks.size, data: [...harness.networks.values()].map((network) => network.entry) }),
        detail: () => ok(casa.detail),
        bindings: () => ok(casa.bindings),
        groups: () => ok({ totalRows: 3, data: defaultGroups() })
      };
      const gate = harness.hold(kind, answers[kind]);
      const pending = bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]);
      await until(() => harness.siteLog(from).length === reads[kind]);
      const invalidation = invalidate(harness, nonce);
      gate.resolve();
      assert.deepEqual(await pending, { success: false, error: 'superseded' });
      await invalidation;
      await settle();
      assert.deepEqual(harness.ssidReads(from), freshReads(CASA_ID).slice(0, Math.min(reads[kind], 3)), 'no read after the held one');
      assert.deepEqual(harness.bindingPatches(), []);
    }); // End of the per-invalidation in-flight test
  } // End of the loop over the in-flight invalidations

  test('a disconnect while the PATCH is held: its late answer is discarded (superseded); the old nonce then answers notConnected', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const gate = harness.hold('patch', () => ok());
    const pending = bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]);
    await until(() => harness.bindingPatches().length === 1);
    await harness.manager.disconnect();
    gate.resolve();
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
    assert.deepEqual(await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]), { success: false, error: 'notConnected' });
  }); // End of test "a disconnect while the PATCH is held…"
}); // End of the describe block for session binding

describe('A QUEUED binding write is bound to the management state it was invoked under (the shared write queue and epoch)', () => {
  /**
   * Holds write A (an enable PATCH), then queues the binding write B behind it.
   * @param {Harness} harness - The connected harness.
   * @param {string} nonce - The session nonce.
   * @returns {Promise<{ gate: Deferred<void>; a: Promise<NetworkActionResult>; b: Promise<NetworkBindingsResult> }>} The gate and both pending replies, once A's PATCH is held.
   */
  const queueBehindHeldWrite = async (harness: Harness, nonce: string): Promise<{ gate: Deferred<void>; a: Promise<NetworkActionResult>; b: Promise<NetworkBindingsResult> }> => {
    const gate = harness.hold('enable', () => ok());
    const a = setNetworkEnabledReply(harness.manager, { sessionNonce: nonce, networkId: ENTERPRISE_ID, enabled: false });
    await until(() => harness.transport.requests.some((request) => request.method === 'PATCH' && request.path.endsWith('/enable')));
    const b = bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]);
    return { gate, a, b };
  };

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
    test(`${label} while write A is held: the queued binding write answers superseded and sends zero requests`, async () => {
      const harness = new Harness();
      const nonce = await harness.connect();
      const { gate, a, b } = await queueBehindHeldWrite(harness, nonce);
      await invalidate(harness, nonce);
      const sent = harness.transport.requests.length;
      gate.resolve();
      assert.deepEqual(await a, { success: false, error: 'superseded' });
      assert.deepEqual(await b, { success: false, error: 'superseded' });
      await settle();
      assert.deepEqual(harness.transport.log().slice(sent), [], 'nothing was sent once A was released');
      assert.deepEqual(harness.bindingPatches(), []);
    }); // End of the per-invalidation queued test
  } // End of the loop over the invalidations

  test('without an invalidation the queued binding write waits for A, then runs its fresh reads and its PATCH', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const from = harness.transport.requests.length;
    const { gate, a, b } = await queueBehindHeldWrite(harness, nonce);
    await settle();
    assert.deepEqual(harness.siteLog(from), [`GET ${SSID_V1}/${ENTERPRISE_ID}`, `PATCH ${SSID_V1}/${ENTERPRISE_ID}/enable`], 'B waits');
    gate.resolve();
    assert.deepEqual(await a, { success: true });
    assert.deepEqual(await b, { success: true });
    assert.deepEqual(harness.siteLog(from).slice(2), [...freshReads(CASA_ID), `PATCH ${SSID_V1}/${CASA_ID}/ap-groups`]);
  }); // End of test "without an invalidation the queued binding write waits…"

  test('the catalog is re-read INSIDE the serialized operation: a catalog changed while the binding write waited for its turn decides (disagreeing with the detail → scopeUnknown; the network gone → networkNotFound); no PATCH', async () => {
    const changes: Array<[string, (harness: Harness) => void, NetworkBindingsResult, number]> = [
      ['the catalog now says "All access points" (the detail does not)', (harness) => (harness.networks.get(CASA_ID)!.entry.chooseDevices = 0), { success: false, error: 'scopeUnknown' }, 3],
      [
        'the catalog no longer lists the network',
        (harness) => harness.overrides.set('catalog', () => ok({ totalRows: 1, data: [harness.networks.get(ALL_ID)!.entry] })),
        { success: false, error: 'networkNotFound' },
        1
      ]
    ];
    for (const [label, change, expected, readCount] of changes) {
      const harness = new Harness();
      const nonce = await harness.connect();
      const from = harness.transport.requests.length;
      const { gate, a, b } = await queueBehindHeldWrite(harness, nonce);
      await settle();
      assert.deepEqual(harness.siteLog(from), [`GET ${SSID_V1}/${ENTERPRISE_ID}`, `PATCH ${SSID_V1}/${ENTERPRISE_ID}/enable`], `${label}: B has read nothing yet`);
      change(harness);
      gate.resolve();
      assert.deepEqual(await a, { success: true }, label);
      assert.deepEqual(await b, expected, label);
      assert.deepEqual(harness.siteLog(from).slice(2), freshReads(CASA_ID).slice(0, readCount), `${label}: B's reads came after A`);
      assert.deepEqual(harness.bindingPatches(), [], label);
    } // End of the loop over the catalog changes
  }); // End of test "the catalog is re-read INSIDE the serialized operation…"
}); // End of the describe block for the queued binding write

describe('Binding write: no secret in any reply or log line', () => {
  test('controller text echoing the Client Secret or a token never reaches a reply or a log line; no reply carries more than success / error / diagnostic / capacityProblems', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    harness.overrides.set('patch', () => apiError(-1, `Refused AccessToken=AT-session-token-1 ${CLIENT_SECRET} fixture-key-never-shown`));
    await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]);
    harness.overrides.set('detail', () => {
      throw new Error(`socket closed ${CLIENT_SECRET}`);
    });
    await bind(harness, nonce, CASA_ID, [DEFAULT_ID, EMPTY_ID]);
    const text = JSON.stringify(replies) + logLines.join('\n');
    assert.ok(replies.length >= 40, `every reply of this file is checked (${replies.length})`);
    assert.ok(!text.includes(CLIENT_SECRET), 'no Client Secret');
    assert.ok(!/AT-session-token-\d/.test(text), 'no access token');
    assert.ok(!text.includes('fixture-key-never-shown'), 'no passphrase of a detail');
    assert.ok(!text.includes('Refused') && !text.includes('socket closed'), 'no controller or transport text');
    for (const reply of replies) {
      assert.ok(Object.keys(reply as object).every((key) => ['success', 'error', 'diagnostic', 'capacityProblems'].includes(key)), JSON.stringify(reply));
    }
  }); // End of test "controller text echoing the Client Secret…"
}); // End of the describe block for redaction
