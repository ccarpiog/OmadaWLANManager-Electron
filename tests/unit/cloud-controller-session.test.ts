// Tests for the cloud controller session (src/main/cloud-controller-session.ts
// behind ControllerSession `kind: 'cloud'`; inbox item I-1b1,
// docs/omada-cloud-openapi.md §12), driven end to end on fixtures — the real
// CloudAccountClient, the real OpenApiClient cloud route and the real shared
// management code over one fake transport (no Electron, no network, never a
// tplinkcloud.com request; tests/fixtures/cloud/controller-tunnel.json):
// - orgVersion → version / group model, and the fail-closed refusal below 6.3;
// - sites (GET …/sites) and the site pick (never from an incomplete list);
// - the AP mapping from ap-groups/aps (missing fields → unknown, paging, an
//   incomplete listing refused) and the group listing from ap-groups (empty
//   groups, per-band capacity, SSID names, Open API ids);
// - capabilities without §2.2 (4)–(5) and a view-only refusal's code and
//   message;
// - the phase 16–19 management operations going out on the cloud-route URLs
//   through the shared code;
// - AP moves: the exact PATCH, success only on a confirming re-read, the
//   failure codes, the guards before any request;
// - close / supersede, and that nothing ever reaches the internal API.
// The ConnectionManager here only installs a cloud session so the shared
// *Reply wrappers run on it; the real wiring is phase I-1b2.

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { CLOUD_TOKEN_PATH, CloudAccountClient } from '../../src/main/cloud-account-client';
import { cloudControllerTarget, validateCloudOrganization, type CloudControllerTarget } from '../../src/main/cloud-account-model';
import {
  checkMoveRead,
  CLOUD_MOVE_VERIFY_DELAY_MS,
  CLOUD_MOVE_VERIFY_READS,
  CLOUD_SESSION_ERROR_CODES,
  CloudSessionError,
  cloudVersionRefusal,
  isApRow,
  toCloudAccessPoint,
  UNKNOWN_STATUS_CATEGORY,
  type CloudSessionErrorCode
} from '../../src/main/cloud-controller-session';
import { CloudRequestThrottle } from '../../src/main/cloud-throttle';
import { ConnectionManager } from '../../src/main/connection-manager';
import {
  ControllerSession,
  createApGroupReply,
  deleteApGroupReply,
  getSessionCapabilities,
  managedApGroupsReply,
  managedNetworksReply,
  managementOn,
  renameApGroupReply,
  setNetworkEnabledReply,
  testManagementAccess,
  updateNetworkBindingsReply
} from '../../src/main/controller-session';
import { describeController } from '../../src/main/controller-version';
import { describeOpenApiFailure, OpenApiClient, OpenApiError, TOKEN_PATH, validateOpenApiApGroupAp } from '../../src/main/openapi-client';
import { translations, type Translations } from '../../src/renderer/i18n-strings';
import type { AccessPoint } from '../../src/shared/types';
import guide from '../fixtures/cloud/account-guide.json';
import tunnel from '../fixtures/cloud/controller-tunnel.json';
import ssidFixtures from '../fixtures/openapi/ssids.json';
import { FakeClock } from './helpers/fake-clock';
import { FakeTransport, type FakeReply, type RecordedRequest } from './helpers/fake-transport';

const EUW = 'https://euw1-omada-northbound.tplinkcloud.com';
const APS = 'https://aps1-omada-northbound.tplinkcloud.com';
// The guide's example organization (APS host), made a 6.3 OC200
const ORGANIZATION = { ...guide.organizationsPage.result.data[0], orgName: 'OC200 Planta 4', orgVersion: '6.3.0.45' };
const OMADAC_ID = ORGANIZATION.omadacId;
const DEVICE_ID = ORGANIZATION.deviceId;
const TUNNEL = `${APS}/v1/cloudaccess/${DEVICE_ID}/openapi`;
const TOKEN_URL = `${EUW}${CLOUD_TOKEN_PATH}`;
const SITE_ID = tunnel.siteId;
const { default: DEFAULT_ID, grupoB: GRUPO_B_ID, silencio: SILENCIO_ID, desconocido: DESCONOCIDO_ID } = tunnel.groupIds;
const CASA_ID = ssidFixtures.ssidId;
const NEW_GROUP_ID = '6512a0e1f3b2c41d2e3f4aff';
const MAC_1 = 'AA-BB-CC-00-00-01';
// The account's cloud Client Secret: 32 characters no redactor pattern
// knows, so only the by-value scrub can remove it
const CLOUD_SECRET = 'cloudSecretValue0123456789abcdef';

/**
 * The tunnelled URL of a v1 self-hosted path.
 * @param {string} path - The path after the omadacId (with its query).
 * @returns {string} The URL.
 */
function v1(path: string): string {
  return `${TUNNEL}/v1/${OMADAC_ID}${path}`;
}

/**
 * The tunnelled URL of a v2 self-hosted path.
 * @param {string} path - The path after the omadacId (with its query).
 * @returns {string} The URL.
 */
function v2(path: string): string {
  return `${TUNNEL}/v2/${OMADAC_ID}${path}`;
}

const SITES = v1('/sites?page=1&pageSize=100');
const AP_GROUPS = v1(`/sites/${SITE_ID}/ap-groups`);
const AP_GROUPS_PAGE = `${AP_GROUPS}?page=1&pageSize=100`;
const APS_PAGE_1 = v1(`/sites/${SITE_ID}/ap-groups/aps?page=1&pageSize=100`);
const APS_PAGE_2 = v1(`/sites/${SITE_ID}/ap-groups/aps?page=2&pageSize=100`);
const SSIDS_PAGE = v2(`/sites/${SITE_ID}/wireless-network/ssids?page=1&pageSize=100`);
const SSID_CASA = v1(`/sites/${SITE_ID}/wireless-network/ssids/${CASA_ID}`);

/**
 * The tunnelled URL of an AP's wlan-group switch.
 * @param {string} mac - The MAC as sent.
 * @returns {string} The URL.
 */
function wlanGroupUrl(mac: string): string {
  return v1(`/sites/${SITE_ID}/aps/${mac}/wlan-group`);
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
 * A successful get_tokens answer.
 * @param {string} token - The account access token.
 * @returns {FakeReply} The reply.
 */
function tokenReply(token: string): FakeReply {
  return ok({ accessToken: token, tokenType: 'bearer', expiresIn: 7200, refreshToken: 'RT-neverUsedRefreshTokenValue0000' });
}

/**
 * The two ap-groups/aps pages with one AP's group id changed (removed when
 * undefined), or the AP dropped altogether (`drop`).
 * @param {string} mac - The AP's MAC as listed.
 * @param {string | undefined} apGroupId - Its group id in the copy.
 * @param {boolean} [drop] - Leave the AP out instead.
 * @returns {[FakeReply, FakeReply]} Page 1 and page 2.
 */
function apsPagesWith(mac: string, apGroupId: string | undefined, drop = false): [FakeReply, FakeReply] {
  const pages = [structuredClone(tunnel.apGroupApsPage1), structuredClone(tunnel.apGroupApsPage2)];
  for (const page of pages) {
    const rows = page.result.data as Array<Record<string, unknown>>;
    const index = rows.findIndex((row) => row.mac === mac);
    if (index < 0) {
      continue;
    }
    if (drop) {
      rows.splice(index, 1);
      page.result.totalRows -= 1;
      pages.forEach((other) => (other.result.totalRows = page.result.totalRows));
    } else if (apGroupId === undefined) {
      delete rows[index].apGroupId;
    } else {
      rows[index].apGroupId = apGroupId;
    }
  } // End of the loop over the two pages
  return [{ body: pages[0] }, { body: pages[1] }];
} // End of function apsPagesWith()

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
 * Awaits a promise expected to reject with a CloudSessionError of a code.
 * @param {Promise<unknown>} promise - The promise.
 * @param {CloudSessionErrorCode} code - The expected code.
 * @returns {Promise<CloudSessionError>} The error.
 */
async function expectCloudError(promise: Promise<unknown>, code: CloudSessionErrorCode): Promise<CloudSessionError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof CloudSessionError, String(error));
    assert.equal(error.code, code, error.message);
    assert.ok(error.message.startsWith(code), 'the message starts with the code');
    return error;
  }
  throw new Error(`expected a CloudSessionError ${code}`);
} // End of function expectCloudError()

// Every console line the code under test writes, and every request of every
// harness (checked at the end: no secret, never the internal API)
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
const allTransports: FakeTransport[] = [];
const issuedTokens: string[] = [];
const replies: unknown[] = [];

/**
 * The fake environment: one transport for the account and the tunnel, the
 * account client and its throttle on a fake clock, every cloud-route client
 * the sessions create, and a ConnectionManager that installs cloud sessions.
 */
class CloudHarness {
  readonly clock = new FakeClock();
  readonly transport = new FakeTransport('');
  readonly throttle: CloudRequestThrottle;
  readonly account: CloudAccountClient;
  readonly target: CloudControllerTarget;
  readonly clients: OpenApiClient[] = [];
  readonly sessions: ControllerSession[] = [];
  readonly moveSleeps: number[] = [];
  readonly savedSiteIds: string[] = [];
  readonly manager: ConnectionManager<ControllerSession>;
  orgVersion: string | null = '6.3.0.45';
  storedSiteId = '';

  /**
   * Builds the harness: a 6.3 controller with one site, the fixture AP
   * groups and AP list.
   */
  constructor() {
    allTransports.push(this.transport);
    this.throttle = new CloudRequestThrottle({ now: this.clock.now, sleep: this.clock.sleep });
    this.account = new CloudAccountClient({ region: 'euw', clientId: 'cloud-client-1', clientSecret: CLOUD_SECRET, transport: this.transport, throttle: this.throttle, now: this.clock.now });
    const target = cloudControllerTarget(validateCloudOrganization(ORGANIZATION));
    assert.ok(target);
    this.target = target;
    this.transport
      .on('POST', TOKEN_URL, () => {
        const token = `a1-AT-cloudSessionToken${String(issuedTokens.length + 1).padStart(8, '0')}`;
        issuedTokens.push(token);
        return tokenReply(token);
      })
      .on('GET', SITES, { body: tunnel.sites })
      .on('GET', AP_GROUPS_PAGE, { body: tunnel.apGroups })
      .on('GET', APS_PAGE_1, { body: tunnel.apGroupApsPage1 })
      .on('GET', APS_PAGE_2, { body: tunnel.apGroupApsPage2 });
    // Test-only manager: the cloud session ignores these local credentials
    this.manager = new ConnectionManager<ControllerSession>({
      getCredentials: () => ({ url: 'https://cloud-session.invalid', username: 'unused', password: 'unused' }),
      createController: () => this.newSession(),
      getConfiguredUrl: () => 'https://cloud-session.invalid',
      getStoredSiteId: () => this.storedSiteId,
      saveStoredSiteId: (siteId) => void this.savedSiteIds.push(siteId),
      saveCertificatePin: () => true,
      clearCertificatePin: () => true,
      resetControllerSession: () => Promise.resolve(),
      logoutDrainMs: 10
    });
  } // End of constructor

  /**
   * Creates a cloud session for the organization (recording its clients).
   * @returns {ControllerSession} The session.
   */
  newSession(): ControllerSession {
    const session = new ControllerSession({
      kind: 'cloud',
      omadacId: OMADAC_ID,
      name: ORGANIZATION.orgName,
      orgVersion: this.orgVersion,
      createOpenApiClient: () => {
        const client = new OpenApiClient({ route: 'cloud', target: this.target, tokenProvider: this.account, throttle: this.throttle, transport: this.transport });
        this.clients.push(client);
        return client;
      },
      sleep: async (ms) => {
        this.moveSleeps.push(ms);
      }
    });
    this.sessions.push(session);
    return session;
  } // End of function newSession()

  /**
   * Connects through the manager and waits for management to be on.
   * @returns {Promise<string>} The session nonce.
   */
  async connectManaged(): Promise<string> {
    const result = await this.manager.connect();
    assert.equal(result.success, true, JSON.stringify(result));
    assert.ok(result.sessionNonce);
    const capabilities = await getSessionCapabilities(this.manager, result.sessionNonce);
    assert.deepEqual(capabilities, { success: true, capabilities: managementOn() });
    return result.sessionNonce;
  }

  /**
   * The installed session.
   * @returns {ControllerSession} It.
   */
  get installed(): ControllerSession {
    const session = this.manager.controller;
    assert.ok(session);
    return session;
  }

  /**
   * The requests made after `mark` (an index into the request log).
   * @param {number} mark - The index.
   * @returns {RecordedRequest[]} The requests.
   */
  since(mark: number): RecordedRequest[] {
    return this.transport.requests.slice(mark);
  }
} // End of class CloudHarness

/**
 * Records a reply (checked for secrets at the end) and returns it.
 * @template T The reply type.
 * @param {T} reply - The reply.
 * @returns {T} The same reply.
 */
function seen<T>(reply: T): T {
  replies.push(reply);
  return reply;
}

describe('cloud controller session: version and group model from orgVersion', () => {
  test('a 6.3 organization: the cloud kind, its omadacId and name, version and group model before any request', () => {
    const harness = new CloudHarness();
    const session = harness.newSession();
    assert.equal(session.kind, 'cloud');
    assert.equal(session.url, '');
    assert.equal(session.omadacId, OMADAC_ID, 'from the organization list, never /api/info');
    assert.equal(session.controllerName, 'OC200 Planta 4');
    assert.equal(session.controllerVersion, '6.3.0.45');
    assert.equal(session.groupModel, 'apGroup');
    assert.equal(session.site, null);
    assert.equal(harness.transport.requests.length, 0);
    assert.deepEqual(describeController(' 7.0.1 '), { controllerVersion: '7.0.1', groupModel: 'apGroup' }, 'the controller-version.ts rule');
  }); // End of test "a 6.3 organization: the cloud..."

  test('below 6.3: connect refused with versionTooOld before any request; the checks answer legacyController without one; nothing else is served', async () => {
    const harness = new CloudHarness();
    harness.orgVersion = '6.2.0.9';
    const session = harness.newSession();
    assert.equal(session.groupModel, 'wlanGroup');
    const refused = await expectCloudError(session.connect(), 'versionTooOld');
    assert.equal(refused.message, 'versionTooOld (orgVersion 6.2.0.9)');
    assert.deepEqual(await session.waitForCapabilities(), { manageApGroups: false, manageWifiNetworks: false, reason: 'legacyController' });
    await expectCloudError(session.getAccessPoints(), 'notConnected');
    await expectCloudError(session.getWlanGroups(), 'notConnected');
    await expectCloudError(session.setApWlanGroup(MAC_1, SILENCIO_ID), 'notConnected');
    assert.equal(harness.transport.requests.length, 0, 'nothing was sent');
    assert.equal(harness.clients.length, 0, 'no client was even created');
    // Through the manager: a connect error whose detail starts with the code
    const result = seen(await harness.manager.connect());
    assert.equal(result.success, false);
    assert.equal(result.error, 'connectError');
    assert.match(result.detail ?? '', /^versionTooOld/);
    assert.equal(harness.transport.requests.length, 0);
  }); // End of test "below 6.3..."

  test('no dotted orgVersion (absent, "v6.3", "6"): versionUnknown, fail-closed', async () => {
    for (const orgVersion of [null, 'v6.3', '6', '6.3-beta']) {
      const harness = new CloudHarness();
      harness.orgVersion = orgVersion;
      const session = harness.newSession();
      await expectCloudError(session.connect(), 'versionUnknown');
      assert.equal(harness.transport.requests.length, 0, String(orgVersion));
    }
    assert.equal(cloudVersionRefusal(describeController('6.3')), null);
    assert.equal(cloudVersionRefusal(describeController('10.0.0')), null);
    assert.equal(cloudVersionRefusal(describeController('6.2.9.9')), 'versionTooOld');
    assert.equal(cloudVersionRefusal(describeController(undefined)), 'versionUnknown');
  }); // End of test "no dotted orgVersion (absent, "v6.3",..."

  test('unusable options are refused in the constructor (fixed text): a reserved omadacId, no client factory', () => {
    const base = { kind: 'cloud' as const, omadacId: OMADAC_ID, name: 'x', orgVersion: '6.3.0.45', createOpenApiClient: () => new OpenApiClient({ route: 'cloud', target: new CloudHarness().target, tokenProvider: { getAccessToken: async () => 'AT-x', renewAccessToken: async () => 'AT-y' }, throttle: new CloudRequestThrottle(), transport: new FakeTransport('') }) };
    assert.throws(() => new ControllerSession({ ...base, omadacId: 'local' }), /omadacId/);
    assert.throws(() => new ControllerSession({ ...base, createOpenApiClient: undefined as unknown as () => OpenApiClient }), /factory/);
  });
});

describe('cloud controller session: sites', () => {
  test('one site: GET {serverHost}/v1/cloudaccess/{deviceId}/openapi/v1/{omadacId}/sites, auto-selected; one account token', async () => {
    const harness = new CloudHarness();
    const session = harness.newSession();
    assert.deepEqual(await session.connect(), { siteSelected: true, sites: [{ id: SITE_ID, name: 'Planta 4' }] });
    assert.deepEqual(session.site, { id: SITE_ID, name: 'Planta 4' });
    assert.deepEqual(harness.transport.log(), [`POST ${TOKEN_URL}`, `GET https://aps1-omada-northbound.tplinkcloud.com/v1/cloudaccess/${DEVICE_ID}/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`]);
    assert.match(harness.transport.requests[1].headers.Authorization, /^AccessToken=a1-AT-/);
    assert.equal(harness.clients[0].route, 'cloud');
  });

  test('two sites: the remembered one while listed, else the user picks one (only a listed id); through the manager the pick is persisted', async () => {
    const harness = new CloudHarness();
    harness.transport.on('GET', SITES, { body: tunnel.sitesTwo });
    const remembered = harness.newSession();
    assert.equal((await remembered.connect('64f0c0ffee0000000000a002')).siteSelected, true);
    assert.equal(remembered.site?.name, 'Almacén');
    const choosing = harness.newSession();
    const outcome = await choosing.connect('64f0c0ffee0000000000a0ff');
    assert.equal(outcome.siteSelected, false);
    assert.equal(outcome.sites.length, 2);
    assert.equal(choosing.selectSite('64f0c0ffee0000000000a0ff'), false);
    assert.equal(choosing.site, null);
    assert.equal(choosing.selectSite(SITE_ID), true);
    assert.deepEqual(choosing.site, { id: SITE_ID, name: 'Planta 4' });
    const parked = seen(await harness.manager.connect());
    assert.equal(parked.needsSiteSelection, true);
    assert.ok(parked.selectionNonce);
    const installed = seen(harness.manager.selectSite('64f0c0ffee0000000000a002', parked.selectionNonce));
    assert.equal(installed.success, true);
    assert.equal(installed.siteName, 'Almacén');
    assert.deepEqual(harness.savedSiteIds, ['64f0c0ffee0000000000a002']);
  }); // End of test "two sites..."

  test('no site is noSites; a failed site list is requestFailed with its codes and the OpenApiError code', async () => {
    const harness = new CloudHarness();
    harness.transport.on('GET', SITES, ok({ totalRows: 0, data: [] }));
    await expectCloudError(harness.newSession().connect(), 'noSites');
    harness.transport.on('GET', SITES, { status: 503, body: '<html>busy</html>' });
    const failed = await expectCloudError(harness.newSession().connect(), 'requestFailed');
    assert.equal(failed.message, 'requestFailed (sites: httpError, HTTP 503)');
    assert.equal(failed.openApiCode, 'httpError');
    const expired = new CloudHarness();
    expired.transport.on('POST', TOKEN_URL, { body: guide.liveCredentialExpired });
    const refused = await expectCloudError(expired.newSession().connect(), 'requestFailed');
    assert.equal(refused.openApiCode, 'invalidCredentials', 'I-1b2 can point at Settings');
    assert.match(refused.diagnostic, /errorCode -52602/);
  }); // End of test "no site is noSites; a..."

  test('a site list not proven complete is listIncomplete before the empty check and the pick: the one site seen is not selected, nothing site-scoped is sent', async () => {
    const harness = new CloudHarness();
    const sitesPage2 = v1('/sites?page=2&pageSize=100');
    // One site on page 1 of a reported 2, then an empty page 2: the walk
    // cannot prove the list complete, and pickSite() would take the one site
    harness.transport.on('GET', SITES, ok({ totalRows: 2, data: [{ siteId: SITE_ID, name: 'Planta 4' }] })).on('GET', sitesPage2, ok({ totalRows: 2, data: [] }));
    const session = harness.newSession();
    const incomplete = await expectCloudError(session.connect(), 'listIncomplete');
    assert.equal(incomplete.diagnostic, 'sites truncated, 1 listed');
    assert.equal(session.site, null, 'not auto-selected');
    assert.equal(session.selectSite(SITE_ID), false, 'nor selectable afterwards');
    await expectCloudError(session.getAccessPoints(), 'notConnected');
    await expectCloudError(session.getWlanGroups(), 'notConnected');
    assert.deepEqual(harness.transport.log(), [`POST ${TOKEN_URL}`, `GET ${SITES}`, `GET ${sitesPage2}`], 'no site-scoped request');
    // The remembered site does not slip through a partial list either
    const remembered = harness.newSession();
    await expectCloudError(remembered.connect(SITE_ID), 'listIncomplete');
    assert.equal(remembered.site, null);
    // An empty first page of a reported non-empty list: listIncomplete, not noSites
    harness.transport.on('GET', SITES, ok({ totalRows: 3, data: [] }));
    const empty = await expectCloudError(harness.newSession().connect(), 'listIncomplete');
    assert.equal(empty.diagnostic, 'sites truncated, 0 listed');
  }); // End of test "a site list not proven complete..."
});

describe('cloud controller session: access points from ap-groups/aps', () => {
  test('paged to totalRows; status, clients, group id and name; a missing or insane field is unknown; a gateway row is left out; sorted by name', async () => {
    const harness = new CloudHarness();
    const session = harness.newSession();
    await session.connect();
    const aps = seen(await session.getAccessPoints());
    assert.deepEqual(harness.since(2).map((request) => request.url), [APS_PAGE_1, APS_PAGE_2]);
    const byMac = new Map(aps.map((ap) => [ap.mac, ap]));
    assert.deepEqual(byMac.get('AA-BB-CC-00-00-01'), {
      mac: 'AA-BB-CC-00-00-01',
      name: 'EAP Planta 4 Norte',
      type: 'ap',
      wlanGroup: 'Default',
      statusCategory: 1,
      clientNum: 7,
      wlanId: DEFAULT_ID
    });
    assert.deepEqual(byMac.get('AA-BB-CC-00-00-02'), { mac: 'AA-BB-CC-00-00-02', name: 'EAP Planta 4 Sur', type: 'ap', wlanGroup: 'zGrupo B', statusCategory: 3, clientNum: 0, wlanId: GRUPO_B_ID });
    // Every optional field missing or insane: unknown, never a real-looking default
    assert.deepEqual(byMac.get('aa:bb:cc:00:00:03'), { mac: 'aa:bb:cc:00:00:03', name: 'aa:bb:cc:00:00:03', type: 'ap', wlanGroup: '', statusCategory: UNKNOWN_STATUS_CATEGORY });
    assert.deepEqual(byMac.get('AA-BB-CC-00-00-04'), { mac: 'AA-BB-CC-00-00-04', name: 'EAP Almacén', type: 'ap', wlanGroup: 'zGrupo B', statusCategory: 0, clientNum: 2, wlanId: GRUPO_B_ID });
    assert.equal(byMac.has('AA-BB-CC-00-00-09'), false, 'the gateway row');
    assert.equal(aps.length, 4);
    const names = aps.map((ap) => ap.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  }); // End of test "paged to totalRows..."

  test('a listing not proven complete is refused (listIncomplete), never shorter; a row without a MAC refuses the listing', async () => {
    const harness = new CloudHarness();
    const session = harness.newSession();
    await session.connect();
    harness.transport.on('GET', APS_PAGE_2, ok({ totalRows: 5, data: [] }));
    const incomplete = await expectCloudError(session.getAccessPoints(), 'listIncomplete');
    assert.equal(incomplete.diagnostic, 'ap-groups/aps truncated');
    harness.transport.on('GET', APS_PAGE_1, ok({ totalRows: 1, data: [{ name: 'no mac', apGroupId: DEFAULT_ID }] }));
    const malformed = await expectCloudError(session.getAccessPoints(), 'requestFailed');
    assert.equal(malformed.diagnostic, 'ap-groups/aps: malformedResponse');
  }); // End of test "a listing not proven complete..."

  test('validateOpenApiApGroupAp() / toCloudAccessPoint() / isApRow(): sane fields kept, the rest unknown', () => {
    assert.deepEqual(validateOpenApiApGroupAp({ mac: 'AA-BB-CC-00-00-07', name: 'x', apGroupId: DEFAULT_ID, apGroupName: 'Default', clientNum: 3, statusCategory: 4, deviceType: 'EAP', traffic: 9 }), {
      mac: 'AA-BB-CC-00-00-07',
      name: 'x',
      apGroupId: DEFAULT_ID,
      apGroupName: 'Default',
      clientNum: 3,
      statusCategory: 4,
      deviceType: 'EAP'
    });
    assert.deepEqual(validateOpenApiApGroupAp({ mac: 'm', clientNum: 1.5, statusCategory: 2.5, apGroupId: '', deviceType: '' }), { mac: 'm' });
    for (const entry of [null, [], 'x', {}, { mac: '' }, { mac: 7 }]) {
      assert.throws(() => validateOpenApiApGroupAp(entry), (error: unknown) => error instanceof OpenApiError && error.code === 'malformedResponse');
    }
    const unknown: AccessPoint = toCloudAccessPoint({ mac: 'AA-BB-CC-00-00-07' });
    assert.deepEqual(unknown, { mac: 'AA-BB-CC-00-00-07', name: 'AA-BB-CC-00-00-07', type: 'ap', wlanGroup: '', statusCategory: -1 });
    assert.equal(isApRow({ mac: 'm' }), true);
    assert.equal(isApRow({ mac: 'm', deviceType: 'EAP' }), true);
    assert.equal(isApRow({ mac: 'm', deviceType: 'gateway' }), false);
    assert.equal(isApRow({ mac: 'm', deviceType: 'Switch' }), false);
  }); // End of test "validateOpenApiApGroupAp() / toCloudAccessPoint() / isApRow():..."
});

describe('cloud controller session: the group listing from ap-groups', () => {
  test('every group (empty ones too) with its Open API id, SSID names, default flag and per-band capacity; version and group model from orgVersion', async () => {
    const harness = new CloudHarness();
    const session = harness.newSession();
    await session.connect();
    const listing = seen(await session.getWlanGroups());
    assert.deepEqual(harness.since(2).map((request) => request.url), [AP_GROUPS_PAGE]);
    assert.deepEqual(listing, {
      controllerVersion: '6.3.0.45',
      groupModel: 'apGroup',
      groups: [
        { wlanId: DEFAULT_ID, wlanName: 'Default', ssidList: [{ ssidName: 'Casa' }, { ssidName: 'Invitados' }], isDefault: true, remainingBinding: { band2g: 6, band5g: 6, band6g: 8 } },
        // Its network list is not sane: unknown, never "no networks"; no sane capacity
        { wlanId: DESCONOCIDO_ID, wlanName: 'Desconocido', ssidList: [], ssidListUnknown: true },
        { wlanId: SILENCIO_ID, wlanName: 'Silencio', ssidList: [], remainingBinding: { band2g: 8, band5g: 8, band6g: 8 } },
        { wlanId: GRUPO_B_ID, wlanName: 'zGrupo B', ssidList: [{ ssidName: 'Casa' }], remainingBinding: { band2g: 7, band5g: 7, band6g: 8 } }
      ]
    });
  }); // End of test "every group..."

  test('an AP-group listing not proven complete is refused (listIncomplete)', async () => {
    const harness = new CloudHarness();
    const session = harness.newSession();
    await session.connect();
    harness.transport.on('GET', AP_GROUPS_PAGE, ok({ totalRows: 9, data: tunnel.apGroups.result.data }));
    harness.transport.on('GET', `${AP_GROUPS}?page=2&pageSize=100`, ok({ totalRows: 9, data: [] }));
    await expectCloudError(session.getWlanGroups(), 'listIncomplete');
  });
});

describe('cloud controller session: capabilities without §2.2 (4)–(5)', () => {
  test('management is on once the token works and the site is listed: the check reads only the sites (no ap-groups, nothing internal), on its own cloud client', async () => {
    const harness = new CloudHarness();
    await harness.connectManaged();
    assert.deepEqual(harness.transport.log(), [`POST ${TOKEN_URL}`, `GET ${SITES}`, `GET ${SITES}`], 'connect, then the check: no ap-groups comparison');
    assert.equal(harness.clients.length, 2);
    const [data, check] = harness.clients;
    assert.equal(harness.installed.openApiClient, check);
    assert.notEqual(data, check);
    assert.equal(check.route, 'cloud');
    assert.equal(check.omadacId, OMADAC_ID);
  }); // End of test "management is on once the..."

  test('the site no longer listed is siteNotFound; an unreadable site list (-44121, with its message) is probeFailed', async () => {
    const vanished = new CloudHarness();
    let sitesCalls = 0;
    vanished.transport.on('GET', SITES, () => (++sitesCalls === 1 ? { body: tunnel.sites } : ok({ totalRows: 1, data: [{ siteId: '64f0c0ffee0000000000a0ff', name: 'Otro' }] })));
    const first = seen(await vanished.manager.connect());
    assert.ok(first.sessionNonce);
    assert.deepEqual(seen(await getSessionCapabilities(vanished.manager, first.sessionNonce)), {
      success: true,
      capabilities: { manageApGroups: false, manageWifiNetworks: false, reason: 'siteNotFound', diagnostic: 'sites 1' }
    });
    const refused = new CloudHarness();
    let calls = 0;
    refused.transport.on('GET', SITES, () => (++calls === 1 ? { body: tunnel.sites } : { body: guide.noOrganizationPermission }));
    const second = seen(await refused.manager.connect());
    assert.ok(second.sessionNonce);
    assert.deepEqual(seen(await getSessionCapabilities(refused.manager, second.sessionNonce)), {
      success: true,
      capabilities: {
        manageApGroups: false,
        manageWifiNetworks: false,
        reason: 'probeFailed',
        diagnostic: 'sites: apiError, errorCode -44121 (This OpenAPI AccessToken has no permission to access this organization)'
      }
    });
  }); // End of test "the site no longer listed..."

  test('an expired or deleted credential at check time is invalidCredentials ("Test management access" re-runs the check)', async () => {
    const harness = new CloudHarness();
    const nonce = await harness.connectManaged();
    harness.clock.advance(7200 * 1000);
    harness.transport.on('POST', TOKEN_URL, { body: guide.liveCredentialExpired });
    assert.deepEqual(seen(await testManagementAccess(harness.manager, nonce)), {
      success: true,
      capabilities: { manageApGroups: false, manageWifiNetworks: false, reason: 'invalidCredentials', diagnostic: 'invalidCredentials, errorCode -52602' }
    });
  });

  test('a view-only credential\'s refusal of a write shows the controller\'s code and message, redacted and scrubbed of the account\'s secret and token', async () => {
    const harness = new CloudHarness();
    const nonce = await harness.connectManaged();
    const token = issuedTokens[issuedTokens.length - 1];
    harness.transport.on('POST', AP_GROUPS, {
      body: { errorCode: tunnel.viewOnlyRefusal.errorCode, msg: `${tunnel.viewOnlyRefusal.msg} [${CLOUD_SECRET}] AccessToken=${token} ${token}` }
    });
    const reply = seen(await createApGroupReply(harness.manager, { sessionNonce: nonce, name: 'Planta 4 Este' }));
    assert.equal(reply.success, false);
    assert.equal(reply.error, 'requestFailed');
    assert.match(reply.diagnostic ?? '', /^apiError, errorCode -1005 \(Operation not allowed: this Open API credential has view-only access\. /);
    assert.ok(!(reply.diagnostic ?? '').includes(CLOUD_SECRET), reply.diagnostic);
    assert.ok(!(reply.diagnostic ?? '').includes(token), reply.diagnostic);
    // The local route keeps no controller text: its diagnostics stay codes only
    const localTransport = new FakeTransport('https://controller.invalid:8043');
    const local = new OpenApiClient({ baseUrl: 'https://controller.invalid:8043', omadacId: 'c0ffee00c0ffee00c0ffee00', clientId: 'id', clientSecret: 'secret', transport: localTransport });
    localTransport.on('POST', TOKEN_PATH, tokenReply('AT-local-token-1')).on('GET', '/openapi/v1/c0ffee00c0ffee00c0ffee00/sites?page=1&pageSize=100', { body: tunnel.viewOnlyRefusal });
    const localError = await local.listSites().then(
      () => null,
      (error: unknown) => error
    );
    assert.ok(localError instanceof OpenApiError);
    assert.equal(localError.controllerMessage, null);
    assert.equal(describeOpenApiFailure(localError), 'apiError, errorCode -1005');
  }); // End of test "a view-only credential's refusal..."
});

describe('cloud controller session: the phase 16–19 management code on the cloud route', () => {
  test('AP-group list / create / rename / delete, the network read, enable and a binding write: the shared code, every request on the tunnel', async () => {
    const harness = new CloudHarness();
    const nonce = await harness.connectManaged();
    const mark = harness.transport.requests.length;
    const listed = seen(await managedApGroupsReply(harness.manager, nonce));
    assert.equal(listed.success, true);
    assert.deepEqual(listed.groups?.map((group) => group.id), [DEFAULT_ID, GRUPO_B_ID, SILENCIO_ID, DESCONOCIDO_ID]);
    assert.deepEqual(listed.groups?.[2], { id: SILENCIO_ID, name: 'Silencio', isDefault: false, apCount: 0, networkNames: [], remainingBinding: { band2g: 8, band5g: 8, band6g: 8 } });
    assert.deepEqual(listed.ssidLimits, { band2g: 8, band5g: 8, band6g: 8, mlo: 4 });

    harness.transport.on('POST', AP_GROUPS, ok({ id: NEW_GROUP_ID }));
    assert.deepEqual(seen(await createApGroupReply(harness.manager, { sessionNonce: nonce, name: '  Planta 4 Este ' })), { success: true, apGroupId: NEW_GROUP_ID });
    assert.deepEqual(harness.transport.requestsTo('POST', AP_GROUPS)[0].body, { name: 'Planta 4 Este' });
    // The name rule on FRESH data: another group's name is refused, nothing sent
    assert.deepEqual(seen(await createApGroupReply(harness.manager, { sessionNonce: nonce, name: 'silencio' })), { success: false, error: 'nameTaken' });
    assert.equal(harness.transport.requestsTo('POST', AP_GROUPS).length, 1);

    harness.transport.on('PATCH', `${AP_GROUPS}/${GRUPO_B_ID}`, ok());
    assert.deepEqual(seen(await renameApGroupReply(harness.manager, { sessionNonce: nonce, apGroupId: GRUPO_B_ID, name: 'Grupo B' })), { success: true });
    assert.deepEqual(harness.transport.requestsTo('PATCH', `${AP_GROUPS}/${GRUPO_B_ID}`)[0].body, { name: 'Grupo B' });

    harness.transport
      .on('GET', SSIDS_PAGE, ok({ totalRows: 1, currentPage: 1, currentSize: 100, data: [ssidFixtures.catalog.page.data[0]] }))
      .on('GET', SSID_CASA, ok(ssidFixtures.detail.result))
      .on('GET', `${SSID_CASA}/ap-groups`, ok(ssidFixtures.bindings.result));
    const networks = seen(await managedNetworksReply(harness.manager, nonce));
    assert.equal(networks.success, true);
    assert.equal(networks.networks?.[0].id, CASA_ID);
    assert.equal(networks.networks?.[0].scope, 'apGroups');
    assert.ok(!JSON.stringify(networks).includes('fixture-passphrase-1'), 'never a passphrase');

    harness.transport.on('PATCH', `${SSID_CASA}/enable`, ok());
    assert.deepEqual(seen(await setNetworkEnabledReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, enabled: false })), { success: true });
    assert.deepEqual(harness.transport.requestsTo('PATCH', `${SSID_CASA}/enable`)[0].body, { ssidEnable: false });

    harness.transport.on('PATCH', `${SSID_CASA}/ap-groups`, ok());
    assert.deepEqual(seen(await updateNetworkBindingsReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, apGroupIds: [DEFAULT_ID, GRUPO_B_ID, SILENCIO_ID] })), { success: true });
    const bound = harness.transport.requestsTo('PATCH', `${SSID_CASA}/ap-groups`)[0].body as { apGroupIds: string[] };
    assert.deepEqual([...bound.apGroupIds].sort(), [DEFAULT_ID, GRUPO_B_ID, SILENCIO_ID].sort());

    // The delete policy on FRESH data: the default group is refused, the empty one deleted
    assert.deepEqual(seen(await deleteApGroupReply(harness.manager, { sessionNonce: nonce, apGroupId: DEFAULT_ID })), { success: false, error: 'groupIsDefault' });
    assert.deepEqual(seen(await deleteApGroupReply(harness.manager, { sessionNonce: nonce, apGroupId: DESCONOCIDO_ID })), { success: false, error: 'groupStateUnknown' });
    harness.transport.on('DELETE', `${AP_GROUPS}/${SILENCIO_ID}`, ok());
    assert.deepEqual(seen(await deleteApGroupReply(harness.manager, { sessionNonce: nonce, apGroupId: SILENCIO_ID })), { success: true });
    assert.equal(harness.transport.requests.filter((request) => request.method === 'DELETE').length, 1);

    const sent = harness.since(mark);
    assert.ok(sent.length > 10);
    for (const request of sent) {
      assert.ok(request.url.startsWith(`${TUNNEL}/v1/${OMADAC_ID}/sites/${SITE_ID}/`) || request.url.startsWith(`${TUNNEL}/v2/${OMADAC_ID}/sites/${SITE_ID}/`), request.url);
      assert.match(request.headers.Authorization, /^AccessToken=a1-AT-/);
    }
    assert.equal(harness.transport.requestsTo('POST', TOKEN_URL).length, 1, 'every client shares the one account token');
  }); // End of test "AP-group list / create / rename / delete..."
});

describe('cloud controller session: AP moves verified by re-read', () => {
  /**
   * A harness with an installed, managed cloud session.
   * @returns {Promise<{ harness: CloudHarness; session: ControllerSession; mark: number }>} The parts and the request mark.
   */
  async function moving(): Promise<{ harness: CloudHarness; session: ControllerSession; mark: number }> {
    const harness = new CloudHarness();
    await harness.connectManaged();
    return { harness, session: harness.installed, mark: harness.transport.requests.length };
  }

  test('the exact PATCH (URL and {wlanGroupId} body) and true only once the first re-read lists the AP in the destination', async () => {
    const { harness, session, mark } = await moving();
    harness.transport.on('PATCH', wlanGroupUrl(MAC_1), ok());
    const [page1, page2] = apsPagesWith(MAC_1, SILENCIO_ID);
    harness.transport.on('GET', APS_PAGE_1, [page1]).on('GET', APS_PAGE_2, [page2]);
    assert.equal(await session.setApWlanGroup(MAC_1, SILENCIO_ID), true);
    const sent = harness.since(mark);
    assert.deepEqual(sent.map((request) => `${request.method} ${request.url}`), [
      `PATCH https://aps1-omada-northbound.tplinkcloud.com/v1/cloudaccess/${DEVICE_ID}/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/aps/AA-BB-CC-00-00-01/wlan-group`,
      `GET ${APS_PAGE_1}`,
      `GET ${APS_PAGE_2}`
    ]);
    assert.deepEqual(sent[0].body, { wlanGroupId: SILENCIO_ID });
    assert.equal(sent[0].headers['Content-Type'], 'application/json');
    assert.deepEqual(harness.moveSleeps, []);
  }); // End of test "the exact PATCH..."

  test('a re-read that still shows the old group is retried after the pause: true on the second read', async () => {
    const { harness, session } = await moving();
    harness.transport.on('PATCH', wlanGroupUrl(MAC_1), ok());
    const [old1, old2] = apsPagesWith(MAC_1, DEFAULT_ID);
    const [new1, new2] = apsPagesWith(MAC_1, SILENCIO_ID);
    harness.transport.on('GET', APS_PAGE_1, [old1, new1]).on('GET', APS_PAGE_2, [old2, new2]);
    assert.equal(await session.setApWlanGroup(MAC_1, SILENCIO_ID), true);
    assert.deepEqual(harness.moveSleeps, [CLOUD_MOVE_VERIFY_DELAY_MS]);
    assert.equal(CLOUD_MOVE_VERIFY_DELAY_MS, 1000);
  });

  test('every re-read disagrees: moveNotConfirmed after CLOUD_MOVE_VERIFY_READS reads (bounded), never true', async () => {
    const { harness, session, mark } = await moving();
    harness.transport.on('PATCH', wlanGroupUrl(MAC_1), ok());
    const error = await expectCloudError(session.setApWlanGroup(MAC_1, SILENCIO_ID), 'moveNotConfirmed');
    assert.equal(error.message, 'moveNotConfirmed (AP listed in another group, 3 reads)');
    assert.equal(CLOUD_MOVE_VERIFY_READS, 3);
    assert.equal(harness.since(mark).filter((request) => request.url === APS_PAGE_1).length, 3);
    assert.deepEqual(harness.moveSleeps, [1000, 1000]);
    // The AP gone from a complete list disagrees too
    const [gone1, gone2] = apsPagesWith(MAC_1, undefined, true);
    harness.transport.on('GET', APS_PAGE_1, gone1).on('GET', APS_PAGE_2, gone2);
    assert.equal((await expectCloudError(session.setApWlanGroup(MAC_1, SILENCIO_ID), 'moveNotConfirmed')).diagnostic, 'AP not listed, 3 reads');
  }); // End of test "every re-read disagrees: moveNotConfirmed after..."

  test('the re-read fails, is incomplete or reports no group: moveUnverified (the last read decides)', async () => {
    const { harness, session } = await moving();
    harness.transport.on('PATCH', wlanGroupUrl(MAC_1), ok());
    harness.transport.on('GET', APS_PAGE_1, { status: 500, body: '' });
    assert.equal((await expectCloudError(session.setApWlanGroup(MAC_1, SILENCIO_ID), 'moveUnverified')).diagnostic, 'ap-groups/aps: httpError, HTTP 500, 3 reads');
    const [old1, old2] = apsPagesWith(MAC_1, DEFAULT_ID);
    harness.transport.on('GET', APS_PAGE_1, [old1, old1, { status: 502, body: '' }]).on('GET', APS_PAGE_2, [old2, old2]);
    await expectCloudError(session.setApWlanGroup(MAC_1, SILENCIO_ID), 'moveUnverified');
    const [none1, none2] = apsPagesWith(MAC_1, undefined);
    harness.transport.on('GET', APS_PAGE_1, none1).on('GET', APS_PAGE_2, none2);
    assert.equal((await expectCloudError(session.setApWlanGroup(MAC_1, SILENCIO_ID), 'moveUnverified')).diagnostic, 'AP listed without a group id, 3 reads');
    assert.deepEqual(
      checkMoveRead({ items: [{ mac: 'AA-BB-CC-00-00-05', apGroupId: SILENCIO_ID }], truncated: true }, MAC_1, SILENCIO_ID),
      { confirmed: false, code: 'moveUnverified', diagnostic: 'AP missing from an incomplete list' }
    );
    assert.deepEqual(checkMoveRead({ items: [{ mac: 'aa:bb:cc:00:00:01', apGroupId: SILENCIO_ID }], truncated: true }, MAC_1, SILENCIO_ID), { confirmed: true });
  }); // End of test "the re-read fails..."

  test('the PATCH fails: moveRequestFailed with the controller\'s code and message, nothing re-read', async () => {
    const { harness, session, mark } = await moving();
    harness.transport.on('PATCH', wlanGroupUrl(MAC_1), { body: tunnel.apNotFound });
    const error = await expectCloudError(session.setApWlanGroup(MAC_1, SILENCIO_ID), 'moveRequestFailed');
    assert.equal(error.message, 'moveRequestFailed (aps wlan-group: apiError, errorCode -39303 (AP does not exist.))');
    assert.equal(error.openApiCode, 'apiError');
    assert.deepEqual(harness.since(mark).map((request) => request.method), ['PATCH']);
  });

  test('the guards run before any request: a malformed MAC or group id is refused with fixed text, connected or not', async () => {
    const { harness, session } = await moving();
    const before = harness.transport.requests.length;
    for (const mac of ['AA-BB-CC-00-00', 'AA-BB-CC-00-00-0G', 'AA-BB-CC-00-00-01/x', '']) {
      await assert.rejects(session.setApWlanGroup(mac, SILENCIO_ID), { message: 'Cloud move rejected: invalid MAC address format' });
    }
    for (const id of ['../x', '', 'a'.repeat(65), 'id with space']) {
      await assert.rejects(session.setApWlanGroup(MAC_1, id), { message: 'Cloud move rejected: invalid group id format' });
    }
    await assert.rejects(harness.newSession().setApWlanGroup('bad', SILENCIO_ID), { message: 'Cloud move rejected: invalid MAC address format' });
    assert.equal(harness.transport.requests.length, before, 'nothing was sent');
  }); // End of test "the guards run before any..."

  test('a lower-case colon MAC is sent in the ops doc\'s form and matched by MAC on the re-read', async () => {
    const { harness, session } = await moving();
    harness.transport.on('PATCH', wlanGroupUrl('AA-BB-CC-00-00-03'), ok());
    const [page1, page2] = apsPagesWith('aa:bb:cc:00:00:03', SILENCIO_ID);
    harness.transport.on('GET', APS_PAGE_1, page1).on('GET', APS_PAGE_2, page2);
    assert.equal(await session.setApWlanGroup('aa:bb:cc:00:00:03', SILENCIO_ID), true);
  });
});

describe('cloud controller session: close and supersede', () => {
  test('a newer connect closes the management side at once (notConnected); the data side serves until the release, then nothing', async () => {
    const harness = new CloudHarness();
    const nonce = await harness.connectManaged();
    const first = harness.installed;
    const gate = deferred<FakeReply>();
    harness.transport.on('GET', SITES, () => gate.promise);
    const second = harness.manager.connect();
    await until(() => harness.transport.requestsTo('GET', SITES).length === 3);
    assert.equal(first.isClosed, true);
    assert.equal(harness.clients[1].isClosed, true, 'the first session\'s management client and its token use are dropped');
    assert.equal(first.openApiClient, null);
    assert.deepEqual(seen(await getSessionCapabilities(harness.manager, nonce)), { success: false, error: 'notConnected' });
    assert.deepEqual(seen(await managedApGroupsReply(harness.manager, nonce)), { success: false, error: 'notConnected' });
    // ManagedController.close(): the data side keeps serving until released
    assert.equal(harness.clients[0].isClosed, false);
    assert.equal((await first.getAccessPoints()).length, 4);
    gate.resolve({ body: tunnel.sites });
    const secondResult = seen(await second);
    assert.equal(secondResult.success, true);
    assert.equal(harness.clients[0].isClosed, true, 'released: the data client is closed');
    // Let the new session's own check run settle before counting requests
    assert.ok(secondResult.sessionNonce);
    assert.equal(seen(await getSessionCapabilities(harness.manager, secondResult.sessionNonce)).success, true);
    const mark = harness.transport.requests.length;
    await expectCloudError(first.getAccessPoints(), 'notConnected');
    await expectCloudError(first.setApWlanGroup(MAC_1, SILENCIO_ID), 'notConnected');
    assert.equal(harness.transport.requests.length, mark, 'nothing more for the released session');
  }); // End of test "a newer connect closes..."

  test('a managed read in flight when the session is disconnected answers superseded and sends nothing more', async () => {
    const harness = new CloudHarness();
    const nonce = await harness.connectManaged();
    const gate = deferred<FakeReply>();
    harness.transport.on('GET', AP_GROUPS_PAGE, () => gate.promise);
    const pending = managedApGroupsReply(harness.manager, nonce);
    await until(() => harness.transport.requestsTo('GET', AP_GROUPS_PAGE).length === 1);
    await harness.manager.disconnect();
    const mark = harness.transport.requests.length;
    gate.resolve({ body: tunnel.apGroups });
    assert.deepEqual(seen(await pending), { success: false, error: 'superseded' });
    assert.equal(harness.transport.requests.length, mark);
    assert.ok(harness.clients.every((client) => client.isClosed), 'every client of the session is closed');
  }); // End of test "a managed read in flight..."

  test('a check run in flight when the session is closed is discarded: superseded, its client closed', async () => {
    const harness = new CloudHarness();
    const gate = deferred<FakeReply>();
    let calls = 0;
    harness.transport.on('GET', SITES, () => (++calls === 1 ? { body: tunnel.sites } : gate.promise));
    const result = seen(await harness.manager.connect());
    assert.ok(result.sessionNonce);
    await until(() => calls === 2);
    const pending = getSessionCapabilities(harness.manager, result.sessionNonce);
    harness.installed.close();
    gate.resolve({ body: tunnel.sites });
    assert.deepEqual(seen(await pending), { success: false, error: 'superseded' });
    assert.equal(harness.clients[1].isClosed, true);
  }); // End of test "a check run in flight..."

  test('a move in flight when the session is disconnected: superseded, its re-read never sent', async () => {
    const harness = new CloudHarness();
    await harness.connectManaged();
    const session = harness.installed;
    const gate = deferred<FakeReply>();
    harness.transport.on('PATCH', wlanGroupUrl(MAC_1), () => gate.promise);
    const move = session.setApWlanGroup(MAC_1, SILENCIO_ID);
    await until(() => harness.transport.requestsTo('PATCH', wlanGroupUrl(MAC_1)).length === 1);
    await harness.manager.disconnect();
    const mark = harness.transport.requests.length;
    gate.resolve(ok());
    await expectCloudError(move, 'superseded');
    assert.equal(harness.transport.requests.length, mark);
  }); // End of test "a move in flight when..."

  test('a data read in flight at logout is superseded; logout sends nothing (no server-side session) and keeps the account token', async () => {
    const harness = new CloudHarness();
    const session = harness.newSession();
    await session.connect();
    const gate = deferred<FakeReply>();
    harness.transport.on('GET', APS_PAGE_1, () => gate.promise);
    const read = session.getAccessPoints();
    await until(() => harness.transport.requestsTo('GET', APS_PAGE_1).length === 1);
    const mark = harness.transport.requests.length;
    await session.logout();
    gate.resolve({ body: tunnel.apGroupApsPage1 });
    await expectCloudError(read, 'superseded');
    assert.equal(harness.transport.requests.length, mark);
    assert.equal(harness.account.isClosed, false, 'the account client belongs to the cloud access, not the session');
    assert.equal(session.site, null);
  }); // End of test "a data read in flight..."
});

describe('cloud controller session: stable codes and their texts', () => {
  test('every CloudSessionErrorCode has a non-empty es and en text (cloudSessionError + the code)', () => {
    for (const code of CLOUD_SESSION_ERROR_CODES) {
      const key = `cloudSessionError${code[0].toUpperCase()}${code.slice(1)}` as keyof Translations;
      assert.ok(typeof translations.es[key] === 'string' && translations.es[key].trim() !== '', `es ${key}`);
      assert.ok(typeof translations.en[key] === 'string' && translations.en[key].trim() !== '', `en ${key}`);
      assert.notEqual(translations.es[key], translations.en[key], key);
    }
    assert.equal(new CloudSessionError('notConnected').message, 'notConnected');
    assert.equal(new CloudSessionError('requestFailed', 'sites: x Authorization: AccessToken=abc').message, 'requestFailed (sites: x Authorization: [REDACTED])');
  });
});

describe('cloud controller session: never the internal API, never a secret', () => {
  test('every request of every test went to the account token endpoint or the tunnel; no reply or log line carries the cloud secret or a token', () => {
    const requests = allTransports.flatMap((transport) => transport.requests);
    assert.ok(requests.length > 50);
    for (const request of requests) {
      assert.ok(request.url === TOKEN_URL || request.url.startsWith(`${TUNNEL}/v1/${OMADAC_ID}/`) || request.url.startsWith(`${TUNNEL}/v2/${OMADAC_ID}/`), request.url);
      assert.ok(!request.url.includes('/api/v2/') && !request.url.includes('/api/info') && !request.url.includes(TOKEN_PATH), request.url);
    }
    const texts = [...logLines, ...replies.map((reply) => JSON.stringify(reply))];
    for (const text of texts) {
      assert.ok(!text.includes(CLOUD_SECRET), text);
      for (const token of issuedTokens) {
        assert.ok(!text.includes(token), text);
      }
    }
  }); // End of test "every request of every test..."
});
