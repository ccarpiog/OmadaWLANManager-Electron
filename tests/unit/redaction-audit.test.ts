// Redaction audit (phase 20a; docs/management-design.md §3 "Redaction",
// docs/security-audit.md): drives representative failure paths end to end —
// the real ConnectionManager, ControllerSession, OmadaController and
// OpenApiClient over one fake transport, and the IPC registrar of index.ts
// (ipc-trust.ts) for the channels that answer by throwing — with sentinel
// secrets planted in every form the spec names (password, client_secret /
// clientSecret, securityKey, psk, Authorization, cookies, CSRF token, access
// and refresh tokens, a typed passphrase), keyed and, for the secrets the app
// knows, bare. No sentinel may appear in any IPC reply, any rejection message
// that crosses to the renderer, or any captured console line. Paths:
// - internal API: a login refusal, an HTTP 500 page and a transport failure
//   during connect (the connect result's `detail` is shown to the user);
//   the data and AP-move channels failing through the registrar;
// - Open API: a token refusal and a token HTTP 500 (capabilities), a failed
//   AP-group read, AP-group and Wi-Fi network write refusals echoing the
//   request, a failed network read, and the network read model over a detail
//   carrying the stored passphrase;
// - live session credentials (the 20a review): the CSRF token and the
//   session cookie echoed bare once logged in — connect, an excerpt cut
//   across the cookie, the data and AP-move channels, a failed re-login that
//   cleared them — and the access token echoed bare on the Open API path;
// - the registrar itself: a handler failure quoting the call's own typed
//   passphrase or the stored secrets;
// - a config file that is not JSON (V8's parse error quotes the file);
// - a log lint over src/main: no console call passes an error, a rejection
//   reason or its message without the redactor (or the error's name only).

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, describe, mock, test } from 'node:test';
import { parseStoredConfigText } from '../../src/main/config-model';
import { ConnectionManager } from '../../src/main/connection-manager';
import {
  accessPointsReply,
  apMoveReply,
  changeNetworkPasswordReply,
  ControllerSession,
  createApGroupReply,
  getSessionCapabilities,
  managedApGroupsReply,
  managedNetworksReply,
  updateNetworkReply,
  wlanGroupsReply,
  type ManagementCredentials
} from '../../src/main/controller-session';
import { parseApMoveRequest, parseNetworkPasswordRequest, requireSessionNonce } from '../../src/main/ipc-guards';
import { createTrustedIpcRegistrar, type IpcHandleRegistry } from '../../src/main/ipc-trust';
import { OpenApiClient, TOKEN_PATH } from '../../src/main/openapi-client';
import { IPC_CHANNELS } from '../../src/shared/types';
import responses from '../fixtures/controller/responses.json';
import ssidWriteFixtures from '../fixtures/openapi/ssid-writes.json';
import { FakeTransport, type FakeReply } from './helpers/fake-transport';

const BASE_URL = 'https://controller.invalid:8043';
const OMADAC_ID = responses.apiInfo.result.omadacId;
const SITE_ID = responses.sitesSingle.result.data[0].id;
const LOGIN_PATH = `/${OMADAC_ID}/api/v2/login`;
const LOGOUT_PATH = `/${OMADAC_ID}/api/v2/logout`;
const SITES_PATH = `/${OMADAC_ID}/api/v2/sites?currentPage=1&currentPageSize=100`;
const WLANS_PATH = `/${OMADAC_ID}/api/v2/sites/${SITE_ID}/setting/wlans`;
const SSIDS_SETTING_PATH = `/${OMADAC_ID}/api/v2/sites/${SITE_ID}/setting/ssids`;
const DEVICES_PATH = `/${OMADAC_ID}/api/v2/sites/${SITE_ID}/devices`;
const OPENAPI_SITES = `/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`;
const AP_GROUPS = `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/ap-groups`;
const AP_GROUPS_PAGE = `${AP_GROUPS}?page=1&pageSize=100`;
const SSIDS_PAGE = `/openapi/v2/${OMADAC_ID}/sites/${SITE_ID}/wireless-network/ssids?page=1&pageSize=100`;
const SSID_V1 = `/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/wireless-network/ssids`;
const GROUP_IDS = responses.wlans.result.data.map((group) => group.id);
const CASA_ID = ssidWriteFixtures.ssidId;
const AP_MAC = responses.devices.result.find((device) => device.type === 'ap')?.mac ?? 'AA-BB-CC-DD-EE-01';

// The sentinels: none may ever reach a reply, a rejection or a log line
const SENTINELS = {
  password: 'SNTL-password-a1x',
  clientSecret: 'SNTL-client-secret-b2x',
  securityKey: 'SNTL-security-key-c3x',
  psk: 'SNTL-psk-d4x',
  authorization: 'SNTL-authorization-e5x',
  cookie: 'SNTL-cookie-f6x',
  csrf: 'SNTL-csrf-g7x',
  accessToken: 'SNTL-access-token-h8x',
  refreshToken: 'SNTL-refresh-token-i9x',
  passphrase: 'SNTL-typed-passphrase-j10x'
} as const;
const SENTINEL_VALUES: readonly string[] = Object.values(SENTINELS);

/**
 * A controller text quoting every sentinel under its key, in the forms a
 * response or an error echo takes: a query/form string, a JSON object,
 * header lines with Bearer, a cookie and a CSRF header.
 * @returns {string} The text.
 */
function keyedSecrets(): string {
  const json = JSON.stringify({
    password: SENTINELS.password,
    clientSecret: SENTINELS.clientSecret,
    securityKey: SENTINELS.securityKey,
    psk: SENTINELS.psk,
    csrfToken: SENTINELS.csrf,
    accessToken: SENTINELS.accessToken,
    refreshToken: SENTINELS.refreshToken,
    passphrase: SENTINELS.passphrase
  });
  return [
    `password=${SENTINELS.password}&client_secret=${SENTINELS.clientSecret}&access_token=${SENTINELS.accessToken}&refresh_token=${SENTINELS.refreshToken}`,
    json,
    `Authorization: Bearer ${SENTINELS.authorization}`,
    `Cookie: TPOMADA_SESSIONID=${SENTINELS.cookie}`,
    `Csrf-Token: ${SENTINELS.csrf}`,
    `pskSetting securityKey=${SENTINELS.securityKey} psk=${SENTINELS.psk}`
  ].join('\n');
} // End of function keyedSecrets()

/**
 * A controller message that also echoes, bare (no key names them), the
 * secrets the request on that path carried — a server can only echo what it
 * was sent: the login password on the internal API, the Client Secret and the
 * bearer token on the Open API, a typed passphrase on a network write. They
 * come first, so even a 200-character excerpt keeps them.
 * @param {readonly string[]} bare - The secrets echoed bare.
 * @returns {string} The text.
 */
function echoedSecrets(bare: readonly string[]): string {
  return `${bare.join(' ')} ${keyedSecrets()}`;
}

// What each path's requests carry (and a reply can therefore echo bare)
const INTERNAL_ECHO = [SENTINELS.password];
// ... and an internal request once logged in: the CSRF token header and the
// session cookie as well
const SESSION_ECHO = [SENTINELS.password, SENTINELS.csrf, SENTINELS.cookie];
const OPENAPI_ECHO = [SENTINELS.clientSecret, SENTINELS.accessToken];
const WRITE_ECHO = [SENTINELS.passphrase, SENTINELS.clientSecret, SENTINELS.accessToken];

/**
 * A successful Open API / internal envelope.
 * @param {unknown} [result] - The result.
 * @returns {FakeReply} The reply.
 */
function ok(result?: unknown): FakeReply {
  return { body: result === undefined ? { errorCode: 0, msg: 'Success.' } : { errorCode: 0, msg: 'Success.', result } };
}

/**
 * A refused envelope whose message echoes every secret.
 * @param {number} errorCode - The errorCode.
 * @param {readonly string[]} bare - The secrets echoed bare (echoedSecrets()).
 * @returns {FakeReply} The reply.
 */
function refusedWithSecrets(errorCode: number, bare: readonly string[]): FakeReply {
  return { body: { errorCode, msg: echoedSecrets(bare), result: { echo: keyedSecrets() } } };
}

/**
 * An HTTP 500 page that starts with the bare secrets and then quotes them keyed.
 * @param {readonly string[]} bare - The secrets echoed bare (echoedSecrets()).
 * @returns {FakeReply} The reply.
 */
function http500WithSecrets(bare: readonly string[]): FakeReply {
  return { status: 500, body: `<html>${echoedSecrets(bare)}</html>` };
}

// Every console line the code under test writes
const logLines: string[] = [];
/**
 * Records one console call as text (Errors with their message and stack).
 * @param {...unknown} args - The console arguments.
 */
const recordLog = (...args: unknown[]): void => {
  logLines.push(
    args
      .map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message} ${arg.stack ?? ''}` : typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ')
  );
};
mock.method(console, 'warn', recordLog);
mock.method(console, 'error', recordLog);
mock.method(console, 'log', recordLog);

// Everything that crossed (or would cross) to the renderer
const crossed: unknown[] = [];

/**
 * Lists the sentinels a value contains.
 * @param {unknown} value - The value (stringified).
 * @returns {string[]} The sentinels found.
 */
function leakedSentinels(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return SENTINEL_VALUES.filter((sentinel) => text.includes(sentinel));
}

/**
 * Records a reply and asserts it carries no sentinel.
 * @param {T} reply - The reply.
 * @param {string} label - What it is.
 * @returns {T} The reply.
 */
function checked<T>(reply: T, label: string): T {
  crossed.push(reply);
  assert.deepEqual(leakedSentinels(reply), [], `${label}: ${JSON.stringify(reply)}`);
  return reply;
}

/**
 * The fake environment: the configured password and Client Secret are the
 * sentinels; every route answers normally until a test replaces it.
 */
class Harness {
  readonly transport = new FakeTransport(BASE_URL);
  credentials: ManagementCredentials | null = { clientId: 'owm-client-1', clientSecret: SENTINELS.clientSecret };
  readonly manager: ConnectionManager<ControllerSession>;

  /**
   * Builds a harness where the connect and every capability check pass.
   */
  constructor() {
    const casaDetail = structuredClone(ssidWriteFixtures.basicConfig.detail) as Record<string, unknown>;
    // The stored passphrase of the network: it must never reach the renderer
    casaDetail.pskSetting = { ...(casaDetail.pskSetting as Record<string, unknown>), securityKey: SENTINELS.psk };
    this.transport
      .on('GET', '/api/info', { body: responses.apiInfo, setCookie: `TPOMADA_SESSIONID=${SENTINELS.cookie}; Path=/; HttpOnly` })
      .on('POST', LOGIN_PATH, ok({ token: SENTINELS.csrf }))
      .on('GET', SITES_PATH, { body: responses.sitesSingle })
      .on('GET', WLANS_PATH, { body: responses.wlans })
      .on('GET', SSIDS_SETTING_PATH, { body: responses.ssids })
      .on('GET', DEVICES_PATH, { body: responses.devices })
      .on('POST', LOGOUT_PATH, { body: responses.ok })
      .on('POST', TOKEN_PATH, ok({ accessToken: SENTINELS.accessToken, tokenType: 'bearer', expiresIn: 7200, refreshToken: SENTINELS.refreshToken }))
      .on('GET', OPENAPI_SITES, ok({ totalRows: 1, currentPage: 1, currentSize: 1, data: [{ siteId: SITE_ID, name: 'Casa' }] }))
      .on('GET', AP_GROUPS_PAGE, ok({ totalRows: GROUP_IDS.length, data: GROUP_IDS.map((id) => ({ id, name: `g-${id.slice(-4)}`, apNum: 0, ssidNameList: [] })) }))
      .on('GET', SSIDS_PAGE, ok({ totalRows: 1, data: [{ id: CASA_ID, name: 'Casa', security: 3, band: 3, chooseDevices: 1 }] }))
      .on('GET', `${SSID_V1}/${CASA_ID}`, ok(casaDetail))
      .on('GET', `${SSID_V1}/${CASA_ID}/ap-groups`, ok({ apGroups: [{ id: GROUP_IDS[0], name: 'Default', apNum: 1 }] }));
    this.manager = new ConnectionManager<ControllerSession>({
      getCredentials: () => ({ url: BASE_URL, username: 'admin', password: SENTINELS.password }),
      createController: (credentials) =>
        new ControllerSession({
          ...credentials,
          transport: this.transport,
          getManagementCredentials: () => this.credentials,
          getConfiguredUrl: () => BASE_URL,
          createOpenApiClient: (options) => new OpenApiClient(options)
        }),
      getConfiguredUrl: () => BASE_URL,
      getStoredSiteId: () => '',
      saveStoredSiteId: () => undefined,
      saveCertificatePin: () => true,
      clearCertificatePin: () => true,
      resetControllerSession: () => Promise.resolve(),
      logoutDrainMs: 20
    });
  } // End of constructor()

  /**
   * Connects (asserting success) and waits for the capabilities.
   * @returns {Promise<string>} The session nonce.
   */
  async connect(): Promise<string> {
    const result = checked(await this.manager.connect(), 'connect result');
    assert.equal(result.success, true, JSON.stringify(result));
    await this.manager.controller?.waitForCapabilities();
    return result.sessionNonce as string;
  }

  /**
   * Connects with management on (asserted).
   * @returns {Promise<string>} The session nonce.
   */
  async connectManaged(): Promise<string> {
    const nonce = await this.connect();
    const capabilities = checked(await getSessionCapabilities(this.manager, nonce), 'capabilities');
    assert.equal(capabilities.success && capabilities.capabilities?.manageWifiNetworks, true, JSON.stringify(capabilities));
    return nonce;
  }
} // End of class Harness

/**
 * Registers the internal data / AP-move channels the way index.ts does (the
 * same handler bodies, through the same registrar with the stored secrets)
 * on a fake ipcMain, and returns an invoker that captures the rejection
 * message the renderer would receive.
 * @param {Harness} harness - The harness.
 * @returns {(channel: string, ...args: unknown[]) => Promise<string | null>} Resolves
 *   with the rejection message, or null when the call succeeded.
 */
function registerDataChannels(harness: Harness): (channel: string, ...args: unknown[]) => Promise<string | null> {
  const listeners = new Map<string, (event: { trusted: boolean }, ...args: unknown[]) => unknown>();
  const ipc: IpcHandleRegistry<{ trusted: boolean }> = { handle: (channel, listener) => void listeners.set(channel, listener) };
  const registrar = createTrustedIpcRegistrar(ipc, (event) => event.trusted, () => [SENTINELS.password, SENTINELS.clientSecret]);
  // The session-bound data channels (inbox I-1b2b2), with index.ts's handler bodies
  registrar.handle(IPC_CHANNELS.OMADA_GET_APS, async (_event, sessionNonce, ...extra) => accessPointsReply(harness.manager, requireSessionNonce(sessionNonce, extra)));
  registrar.handle(IPC_CHANNELS.OMADA_GET_WLANS, async (_event, sessionNonce, ...extra) => wlanGroupsReply(harness.manager, requireSessionNonce(sessionNonce, extra)));
  registrar.handle(IPC_CHANNELS.OMADA_SET_WLAN, async (_event, sessionNonce, mac, wlanId, ...extra) =>
    apMoveReply(harness.manager, parseApMoveRequest(sessionNonce, mac, wlanId, extra))
  );
  registrar.handle(IPC_CHANNELS.MANAGEMENT_NETWORK_PASSWORD, async (_event, payload, ...extra) =>
    changeNetworkPasswordReply(harness.manager, parseNetworkPasswordRequest(payload, extra))
  );
  return async (channel, ...args) => {
    const listener = listeners.get(channel);
    assert.ok(listener, channel);
    try {
      crossed.push(await listener({ trusted: true }, ...args));
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      crossed.push(message);
      return message;
    }
  };
} // End of function registerDataChannels()

describe('redaction audit: internal API failures (connect detail, data and AP-move channels)', () => {
  test('a login refusal quoting every secret: the connect detail and the log lines are redacted', async () => {
    const harness = new Harness();
    harness.transport.on('POST', LOGIN_PATH, refusedWithSecrets(-30109, INTERNAL_ECHO));
    const result = checked(await harness.manager.connect(), 'connect result');
    assert.equal(result.success, false);
    assert.equal(result.error, 'connectError');
    assert.ok(result.detail && result.detail.includes('[REDACTED]'), `the detail is kept, redacted: ${result.detail}`);
  });

  test('an HTTP 500 page quoting every secret during connect: redacted detail', async () => {
    const harness = new Harness();
    harness.transport.on('POST', LOGIN_PATH, http500WithSecrets(INTERNAL_ECHO));
    const result = checked(await harness.manager.connect(), 'connect result');
    assert.equal(result.error, 'connectError');
    assert.match(result.detail ?? '', /^HTTP 500: /);
  });

  test('a transport failure quoting every secret during connect: redacted detail', async () => {
    const harness = new Harness();
    harness.transport.on('POST', LOGIN_PATH, () => {
      throw new Error(`socket hang up: ${echoedSecrets(INTERNAL_ECHO)}`);
    });
    const result = checked(await harness.manager.connect(), 'connect result');
    assert.equal(result.error, 'connectError');
    assert.match(result.detail ?? '', /^socket hang up/);
  });

  test('the AP list, group list and AP move failing with every secret: the rejection the renderer gets is redacted', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const invoke = registerDataChannels(harness);
    harness.transport.on('GET', DEVICES_PATH, refusedWithSecrets(-1, INTERNAL_ECHO));
    harness.transport.on('GET', WLANS_PATH, http500WithSecrets(INTERNAL_ECHO));
    harness.transport.on('PATCH', `/${OMADAC_ID}/api/v2/sites/${SITE_ID}/eaps/${AP_MAC}`, () => {
      throw new Error(`write failed: ${echoedSecrets(INTERNAL_ECHO)}`);
    });
    const messages = [
      await invoke(IPC_CHANNELS.OMADA_GET_APS, nonce),
      await invoke(IPC_CHANNELS.OMADA_GET_WLANS, nonce),
      await invoke(IPC_CHANNELS.OMADA_SET_WLAN, nonce, AP_MAC, GROUP_IDS[1])
    ];
    for (const message of messages) {
      assert.ok(message !== null, 'each call failed');
      assert.deepEqual(leakedSentinels(message), [], message ?? '');
    }
    assert.ok(messages.every((message) => message?.includes('[REDACTED]')), 'the messages are kept, redacted');
  }); // End of test "the AP list, group list and AP move failing..."
});

/**
 * Asserts that no console line captured since a mark carries a sentinel.
 * @param {number} mark - logLines.length before the path ran.
 * @param {string} label - What ran.
 * @returns {string[]} The lines captured since the mark.
 */
function assertCleanLogsSince(mark: number, label: string): string[] {
  const lines = logLines.slice(mark);
  assert.deepEqual(lines.filter((line) => leakedSentinels(line).length > 0), [], `${label}: no log line carries a sentinel`);
  return lines;
}

describe('redaction audit: live session credentials echoed bare (CSRF token, session cookie, access token)', () => {
  test('connect: the site list refused after the login, echoing the bare CSRF token and session cookie — the detail and the log lines are redacted', async () => {
    const harness = new Harness();
    harness.transport.on('GET', SITES_PATH, refusedWithSecrets(-1, SESSION_ECHO));
    const mark = logLines.length;
    const result = checked(await harness.manager.connect(), 'connect result');
    assert.equal(result.error, 'connectError');
    assert.ok(result.detail?.startsWith('[REDACTED] [REDACTED] [REDACTED] '), `the detail is kept, redacted: ${result.detail}`);
    // Logged twice: by the internal client and by the connection manager
    assert.ok(assertCleanLogsSince(mark, 'connect').length >= 2, 'the failure was logged');
    // The login succeeded: the failing request carried both credentials
    const [sites] = harness.transport.requestsTo('GET', SITES_PATH);
    assert.equal(sites.headers['Csrf-Token'], SENTINELS.csrf);
    assert.ok(sites.headers.Cookie.includes(SENTINELS.cookie));
  }); // End of test "connect: the site list refused after the login..."

  test('connect: an HTTP 500 site-list page with the bare session cookie across the excerpt boundary — no prefix of it survives the cut', async () => {
    const harness = new Harness();
    // The 200-character excerpt ends 5 characters into the cookie value
    harness.transport.on('GET', SITES_PATH, { status: 500, body: `<html>${'x'.repeat(188)} ${SENTINELS.cookie} ${SENTINELS.csrf}</html>` });
    const result = checked(await harness.manager.connect(), 'connect result');
    assert.equal(result.error, 'connectError');
    const detail = result.detail ?? '';
    assert.ok(detail.startsWith('HTTP 500: <html>xxx') && detail.endsWith(' [REDA'), detail);
    assert.ok(!detail.includes(SENTINELS.cookie.slice(0, 5)), detail);
  });

  test('the AP list, group list and AP move failing with the bare CSRF token and session cookie: the rejections and the log lines are redacted', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const invoke = registerDataChannels(harness);
    harness.transport.on('GET', DEVICES_PATH, refusedWithSecrets(-1, SESSION_ECHO));
    harness.transport.on('GET', WLANS_PATH, http500WithSecrets(SESSION_ECHO));
    harness.transport.on('PATCH', `/${OMADAC_ID}/api/v2/sites/${SITE_ID}/eaps/${AP_MAC}`, () => {
      throw new Error(`write failed: ${echoedSecrets(SESSION_ECHO)}`);
    });
    const mark = logLines.length;
    const messages = [
      await invoke(IPC_CHANNELS.OMADA_GET_APS, nonce),
      await invoke(IPC_CHANNELS.OMADA_GET_WLANS, nonce),
      await invoke(IPC_CHANNELS.OMADA_SET_WLAN, nonce, AP_MAC, GROUP_IDS[1])
    ];
    for (const message of messages) {
      assert.ok(message !== null, 'each call failed');
      assert.deepEqual(leakedSentinels(message), [], message ?? '');
    }
    assert.match(messages[0] ?? '', /^\[REDACTED\] \[REDACTED\] \[REDACTED\] /);
    assertCleanLogsSince(mark, 'data channels');
  }); // End of test "the AP list, group list and AP move failing with the bare CSRF token..."

  test('a re-login failing after the session expired, echoing the CSRF token and cookie it has just cleared: the rejection is still redacted', async () => {
    const harness = new Harness();
    const nonce = await harness.connect();
    const invoke = registerDataChannels(harness);
    harness.transport.on('GET', DEVICES_PATH, { body: { errorCode: -1200, msg: 'Login required.' } });
    harness.transport.on('POST', LOGIN_PATH, () => {
      throw new Error(`socket hang up: ${echoedSecrets(SESSION_ECHO)}`);
    });
    const message = await invoke(IPC_CHANNELS.OMADA_GET_APS, nonce);
    assert.ok(message !== null, 'the call failed');
    assert.deepEqual(leakedSentinels(message), [], message);
    assert.match(message, /^Session expired; re-login failed: socket hang up: \[REDACTED\] \[REDACTED\] \[REDACTED\] /);
    // The re-login went out with the old cookie (so the echo was possible)
    const relogin = harness.transport.requestsTo('POST', LOGIN_PATH).at(-1);
    assert.ok(relogin?.headers.Cookie.includes(SENTINELS.cookie));
  }); // End of test "a re-login failing after the session expired..."

  test('an Open API read failing with the bare access token after it was acquired: the client error, the reply and the log lines are redacted', async () => {
    const harness = new Harness();
    const nonce = await harness.connectManaged();
    const client = harness.manager.controller?.openApiClient;
    assert.ok(client, 'management is on');
    const mark = logLines.length;
    // The client's own errors (what would cross if one escaped a reply):
    // a transport failure and a refusal, each echoing the token bare
    harness.transport.on('GET', AP_GROUPS_PAGE, () => {
      throw new Error(`socket hang up: ${SENTINELS.accessToken}`);
    });
    await assert.rejects(client.listApGroups(SITE_ID), (error: unknown) => {
      assert.ok(error instanceof Error);
      crossed.push(error.message);
      assert.deepEqual(leakedSentinels(error.message), [], error.message);
      return true;
    });
    harness.transport.on('GET', AP_GROUPS_PAGE, refusedWithSecrets(-1, [SENTINELS.accessToken]));
    await assert.rejects(client.listApGroups(SITE_ID), (error: unknown) => {
      assert.ok(error instanceof Error);
      crossed.push(error.message);
      assert.deepEqual(leakedSentinels(error.message), [], error.message);
      return true;
    });
    // End to end: the network read failing the same way
    harness.transport.on('GET', SSIDS_PAGE, () => {
      throw new Error(`socket hang up: ${SENTINELS.accessToken}`);
    });
    const listed = checked(await managedNetworksReply(harness.manager, nonce), 'network list');
    assert.equal(listed.success, false);
    assert.ok(assertCleanLogsSince(mark, 'Open API read').length > 0, 'the failure was logged');
  }); // End of test "an Open API read failing with the bare access token..."
}); // End of describe "redaction audit: live session credentials echoed bare"

describe('redaction audit: Open API failures (token, reads, write refusals)', () => {
  test('a token refusal echoing the Client Secret and every keyed secret: capabilities reply and logs redacted', async () => {
    const harness = new Harness();
    harness.transport.on('POST', TOKEN_PATH, refusedWithSecrets(-44106, [SENTINELS.clientSecret]));
    const nonce = await harness.connect();
    const reply = checked(await getSessionCapabilities(harness.manager, nonce), 'capabilities');
    assert.equal(reply.success && reply.capabilities?.manageApGroups, false);
  });

  test('a token HTTP 500 page with every secret: capabilities reply and logs redacted', async () => {
    const harness = new Harness();
    harness.transport.on('POST', TOKEN_PATH, http500WithSecrets([SENTINELS.clientSecret]));
    const nonce = await harness.connect();
    const reply = checked(await getSessionCapabilities(harness.manager, nonce), 'capabilities');
    assert.equal(reply.success && reply.capabilities?.reason, 'tokenFailed');
  });

  test('a failed AP-group read and a refused AP-group create echoing every secret: replies and logs redacted', async () => {
    const harness = new Harness();
    const nonce = await harness.connectManaged();
    harness.transport.on('POST', AP_GROUPS, refusedWithSecrets(-33201, OPENAPI_ECHO));
    const created = checked(await createApGroupReply(harness.manager, { sessionNonce: nonce, name: 'Nuevo' }), 'create');
    assert.equal(created.success, false);
    harness.transport.on('GET', AP_GROUPS_PAGE, http500WithSecrets(OPENAPI_ECHO));
    const listed = checked(await managedApGroupsReply(harness.manager, nonce), 'ap-group list');
    assert.equal(listed.success, false);
  });

  test('the network read model over a detail holding the stored passphrase: only hasPassphrase crosses', async () => {
    const harness = new Harness();
    const nonce = await harness.connectManaged();
    const reply = checked(await managedNetworksReply(harness.manager, nonce), 'network list');
    assert.equal(reply.success, true, JSON.stringify(reply));
  });

  test('a password change refused with an echo of the typed passphrase and every secret, through the registrar: reply and logs redacted', async () => {
    const harness = new Harness();
    const nonce = await harness.connectManaged();
    harness.transport.on('PATCH', `${SSID_V1}/${CASA_ID}/basic-config`, refusedWithSecrets(-33500, WRITE_ECHO));
    const invoke = registerDataChannels(harness);
    const rejection = await invoke(IPC_CHANNELS.MANAGEMENT_NETWORK_PASSWORD, { sessionNonce: nonce, networkId: CASA_ID, passphrase: SENTINELS.passphrase });
    assert.equal(rejection, null, 'refusals are replies, not rejections');
    const reply = crossed[crossed.length - 1] as { success: boolean };
    assert.equal(reply.success, false);
    assert.deepEqual(leakedSentinels(reply), []);
    // The write went out with the typed passphrase (so the echo was possible)
    const patch = harness.transport.requestsTo('PATCH', `${SSID_V1}/${CASA_ID}/basic-config`);
    assert.equal(patch.length, 1);
    assert.ok(JSON.stringify(patch[0].body).includes(SENTINELS.passphrase));
  }); // End of test "a password change refused..."

  test('a basic-settings save and a network read failing with every secret: replies and logs redacted', async () => {
    const harness = new Harness();
    const nonce = await harness.connectManaged();
    harness.transport.on('PATCH', `${SSID_V1}/${CASA_ID}/basic-config`, http500WithSecrets(WRITE_ECHO));
    const saved = checked(
      await updateNetworkReply(harness.manager, { sessionNonce: nonce, networkId: CASA_ID, name: 'Casa 2', passphrase: SENTINELS.passphrase }),
      'update'
    );
    assert.equal(saved.success, false);
    harness.transport.on('GET', `${SSID_V1}/${CASA_ID}`, refusedWithSecrets(-1, OPENAPI_ECHO));
    const listed = checked(await managedNetworksReply(harness.manager, nonce), 'network list');
    assert.equal(listed.success, false);
  });
});

describe('redaction audit: the IPC registrar scrubs secrets a handler failure quotes', () => {
  test('a handler failure quoting the typed passphrase (bare) and the stored secrets: the rejection is redacted', async () => {
    const listeners = new Map<string, (event: object, ...args: unknown[]) => unknown>();
    const registrar = createTrustedIpcRegistrar<object>(
      { handle: (channel, listener) => void listeners.set(channel, listener) },
      () => true,
      () => [SENTINELS.password, SENTINELS.clientSecret]
    );
    registrar.handle('test:echo', () => {
      throw new Error(`refused ${SENTINELS.passphrase} ${SENTINELS.password} ${SENTINELS.clientSecret} ${keyedSecrets()}`);
    });
    const listener = listeners.get('test:echo');
    assert.ok(listener);
    await assert.rejects(
      async () => listener({}, { sessionNonce: '0'.repeat(32), passphrase: SENTINELS.passphrase }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        crossed.push(error.message);
        assert.deepEqual(leakedSentinels(error.message), [], error.message);
        assert.match(error.message, /^refused \[REDACTED\]/);
        assert.ok(!('stack' in error) || !leakedSentinels(String(error.stack)).length, 'nor in the stack');
        return true;
      }
    );
  }); // End of test "a handler failure quoting the typed passphrase..."
});

describe('redaction audit: config file and main-process log lines', () => {
  test('a config file that is not JSON is logged by its error name only (V8 quotes the file in its message)', () => {
    const before = logLines.length;
    const short = 'pw9SNTL';
    assert.equal(parseStoredConfigText(`{"password": ${short}}`), null);
    assert.equal(parseStoredConfigText(`${short}{"url":"x"}`), null);
    const lines = logLines.slice(before);
    assert.equal(lines.length, 2);
    assert.ok(lines.every((line) => line.includes('SyntaxError') && !line.includes(short)), lines.join('\n'));
    assert.deepEqual(parseStoredConfigText('{"url":"x"}'), { url: 'x' });
  });

  test('log lint: every console call in src/main passes errors and rejection reasons only through the redactor', () => {
    const mainDir = path.join(process.cwd(), 'src', 'main');
    const offenders: string[] = [];
    for (const file of readdirSync(mainDir).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(path.join(mainDir, file), 'utf8');
      for (const call of consoleCalls(source)) {
        const code = withoutRedactedParts(codeOnly(call.args));
        if (/\b(error|err|reason|thrown|cause|exception)\b/.test(code)) {
          offenders.push(`${file}:${call.line}: console.${call.method}(${call.args.replace(/\s+/g, ' ')})`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });
});

/**
 * Finds the console calls of a source text with their argument text.
 * @param {string} source - TypeScript source.
 * @returns {Array<{ method: string; line: number; args: string }>} The calls.
 */
function consoleCalls(source: string): Array<{ method: string; line: number; args: string }> {
  const calls: Array<{ method: string; line: number; args: string }> = [];
  const pattern = /\bconsole\.(log|warn|error|info|debug)\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const start = match.index + match[0].length;
    const end = matchingParen(source, start);
    calls.push({ method: match[1], line: source.slice(0, match.index).split('\n').length, args: source.slice(start, end) });
  } // End of the loop over the console calls of the source
  return calls;
} // End of function consoleCalls()

/**
 * Returns the index of the parenthesis closing the call whose arguments start
 * at `start`, skipping string, template and comment contents.
 * @param {string} source - The source.
 * @param {number} start - Index right after the opening parenthesis.
 * @returns {number} The index of the closing parenthesis.
 */
function matchingParen(source: string, start: number): number {
  let depth = 1;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === "'" || char === '"' || char === '`') {
      index = skipLiteral(source, index);
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  } // End of the loop over the argument characters
  throw new Error('unbalanced console call');
} // End of function matchingParen()

/**
 * Returns the index of the closing quote of the literal opened at `index`
 * (template expressions are skipped as code, with nested literals).
 * @param {string} source - The source.
 * @param {number} index - Index of the opening quote.
 * @returns {number} Index of the closing quote.
 */
function skipLiteral(source: string, index: number): number {
  const quote = source[index];
  for (let cursor = index + 1; cursor < source.length; cursor++) {
    const char = source[cursor];
    if (char === '\\') {
      cursor++;
    } else if (char === quote) {
      return cursor;
    } else if (quote === '`' && char === '$' && source[cursor + 1] === '{') {
      let depth = 1;
      cursor += 2;
      for (; cursor < source.length && depth > 0; cursor++) {
        if (source[cursor] === "'" || source[cursor] === '"' || source[cursor] === '`') {
          cursor = skipLiteral(source, cursor);
        } else if (source[cursor] === '{') {
          depth++;
        } else if (source[cursor] === '}') {
          depth--;
        }
      }
      cursor--;
    }
  } // End of the loop over the literal's characters
  return source.length;
} // End of function skipLiteral()

/**
 * Returns the index of the brace closing a template expression whose code
 * starts at `start`, skipping nested literals.
 * @param {string} text - The text.
 * @param {number} start - Index right after `${`.
 * @returns {number} Index of the closing brace.
 */
function matchingBrace(text: string, start: number): number {
  let depth = 1;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (char === "'" || char === '"' || char === '`') {
      index = skipLiteral(text, index);
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  } // End of the loop over the expression characters
  return text.length;
} // End of function matchingBrace()

/**
 * Blanks the text of string and template literals, keeping template
 * expressions (code, recursively) — so words inside messages never count as
 * identifiers.
 * @param {string} text - Argument source text.
 * @returns {string} Code only.
 */
function codeOnly(text: string): string {
  let output = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "'" || char === '"') {
      index = skipLiteral(text, index);
      output += '""';
    } else if (char === '`') {
      let cursor = index + 1;
      output += ' ';
      while (cursor < text.length && text[cursor] !== '`') {
        if (text[cursor] === '\\') {
          cursor += 2;
        } else if (text[cursor] === '$' && text[cursor + 1] === '{') {
          const end = matchingBrace(text, cursor + 2);
          output += `${codeOnly(text.slice(cursor + 2, end))} `;
          cursor = end + 1;
        } else {
          cursor++;
        }
      } // End of the loop over the template's characters
      index = cursor;
    } else {
      output += char;
    }
  } // End of the loop over the argument characters
  return output;
} // End of function codeOnly()

/**
 * Removes the parts of argument code that are safe by construction: calls of
 * the redactor (redactText / redactErrorMessage / redactValue /
 * redactedMessage, with their arguments) and `x instanceof Error ? x.name :
 * "…"` (the error's class name only).
 * @param {string} code - Code only (codeOnly()).
 * @returns {string} The remaining code.
 */
function withoutRedactedParts(code: string): string {
  let remaining = code.replace(/\b\w+ instanceof Error \? \w+\.name : ""/g, '');
  const redactor = /\b(?:this\.)?(?:redactText|redactErrorMessage|redactValue|redactedMessage)\(/g;
  let match: RegExpExecArray | null;
  while ((match = redactor.exec(remaining)) !== null) {
    const end = matchingParen(remaining, match.index + match[0].length);
    remaining = remaining.slice(0, match.index) + remaining.slice(end + 1);
    redactor.lastIndex = match.index;
  }
  return remaining;
} // End of function withoutRedactedParts()

after(() => {
  // Over the whole file: something crossed, something was logged, and no
  // sentinel reached either
  assert.ok(crossed.length >= 15, `replies checked: ${crossed.length}`);
  assert.ok(logLines.length > 0, 'the failure paths logged');
  const leaking = logLines.filter((line) => leakedSentinels(line).length > 0);
  assert.deepEqual(leaking, [], 'no captured log line carries a sentinel');
});
