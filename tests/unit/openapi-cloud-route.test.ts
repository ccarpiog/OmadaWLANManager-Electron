// Tests for the Open API client's cloud route (src/main/openapi-client.ts with
// route 'cloud'; docs/omada-cloud-openapi.md §6), on the fake transport — no
// Electron, no network, never a tplinkcloud.com request: the exact cloudaccess
// URLs and headers of a few existing operations (the same validators as the
// local route), the omadacId taken from the organization, the token from the
// CloudAccountClient, an auth-error retry through a fresh account token, a
// non-allowlisted serverHost refused before any request, the shared throttle
// and the -7132 backoff, cloud token failures mapped to OpenApiError codes, and
// the target's routing identifiers scrubbed from every diagnostic (cloud only).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CLOUD_ORGANIZATIONS_PATH, CLOUD_TOKEN_PATH, CloudAccountClient } from '../../src/main/cloud-account-client';
import { cloudControllerTarget, validateCloudOrganization, type CloudControllerTarget } from '../../src/main/cloud-account-model';
import { CloudRequestThrottle } from '../../src/main/cloud-throttle';
import { describeOpenApiFailure, OpenApiClient, OpenApiError, TOKEN_PATH, type OpenApiErrorCode } from '../../src/main/openapi-client';
import guide from '../fixtures/cloud/account-guide.json';
import { FakeClock } from './helpers/fake-clock';
import { FakeTransport, type FakeReply } from './helpers/fake-transport';

const EUW = 'https://euw1-omada-northbound.tplinkcloud.com';
const APS = 'https://aps1-omada-northbound.tplinkcloud.com';
// The guide's example organization (APS host), made a 6.3 controller
const ORGANIZATION = { ...guide.organizationsPage.result.data[0], orgVersion: '6.3.0.45' };
const DEVICE_ID = ORGANIZATION.deviceId;
const OMADAC_ID = ORGANIZATION.omadacId;
const PREFIX = `/v1/cloudaccess/${DEVICE_ID}`;
const SITE_ID = '64a1b2c3d4e5f60718293a4b';
const AP_GROUP_ID = '64aa00000000000000000001';

/**
 * A successful get_tokens answer carrying the given token.
 * @param {string} token - The access token.
 * @returns {FakeReply} The reply.
 */
function tokenReply(token: string): FakeReply {
  return { body: { errorCode: 0, msg: 'Open API Get Access Token successfully.', result: { accessToken: token, tokenType: 'bearer', expiresIn: 7200, refreshToken: 'RT-neverUsedRefreshTokenValue0000' } } };
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
 * Builds the account client (EUW) and the cloud route client for the guide's
 * organization (APS serverHost) over ONE fake transport: the account calls go
 * to the EUW base, the tunnel calls to the organization's serverHost — the
 * fake records full URLs, so both are visible.
 * @returns {{ account: CloudAccountClient; client: OpenApiClient; transport: FakeTransport; clock: FakeClock; throttle: CloudRequestThrottle }} The parts.
 */
function setup(): { account: CloudAccountClient; client: OpenApiClient; transport: FakeTransport; clock: FakeClock; throttle: CloudRequestThrottle } {
  const clock = new FakeClock();
  const transport = new FakeTransport('');
  const throttle = new CloudRequestThrottle({ now: clock.now, sleep: clock.sleep });
  const account = new CloudAccountClient({ region: 'euw', clientId: 'cloud-client', clientSecret: 'cloud-secret-value', transport, throttle, now: clock.now });
  const target = cloudControllerTarget(validateCloudOrganization(ORGANIZATION));
  assert.ok(target);
  const client = new OpenApiClient({ route: 'cloud', target, tokenProvider: account, throttle, transport });
  return { account, client, transport, clock, throttle };
} // End of function setup()

/**
 * The full URL of a tunnelled Open API path.
 * @param {string} path - The self-hosted path with its query.
 * @returns {string} The URL.
 */
function tunnel(path: string): string {
  return `${APS}${PREFIX}${path}`;
}

/**
 * Awaits a promise expected to reject with an OpenApiError of a code.
 * @param {Promise<unknown>} promise - The promise.
 * @param {OpenApiErrorCode} code - The expected code.
 * @returns {Promise<OpenApiError>} The error.
 */
async function expectOpenApiError(promise: Promise<unknown>, code: OpenApiErrorCode): Promise<OpenApiError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof OpenApiError, String(error));
    assert.equal(error.code, code, error.message);
    return error;
  }
  throw new Error(`expected an OpenApiError ${code}`);
} // End of function expectOpenApiError()

describe('OpenApiClient cloud route: URLs and headers', () => {
  test('sites: one account token, then GET {serverHost}/v1/cloudaccess/{deviceId}/openapi/v1/{omadacId}/sites with AccessToken=', async () => {
    const { client, transport } = setup();
    transport
      .on('POST', `${EUW}${CLOUD_TOKEN_PATH}`, tokenReply('a1-AT-cloudTokenValue000000000001'))
      .on('GET', tunnel(`/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`), ok({ totalRows: 1, data: [{ siteId: SITE_ID, name: 'Planta 4' }] }));
    const sites = await client.listSites();
    assert.deepEqual(sites, { items: [{ id: SITE_ID, name: 'Planta 4' }], truncated: false });
    assert.deepEqual(transport.log(), [
      `POST ${EUW}/authorize/account/token?type=get_tokens`,
      `GET https://aps1-omada-northbound.tplinkcloud.com/v1/cloudaccess/7B069516D97677D0BCA8E643F334A1A3F182A1/openapi/v1/5ffc0460d2816b0d09b531cd27c106a8/sites?page=1&pageSize=100`
    ]);
    const call = transport.requests[1];
    assert.equal(call.headers.Authorization, 'AccessToken=a1-AT-cloudTokenValue000000000001');
    assert.equal(call.headers.Accept, 'application/json');
    assert.equal(call.body, undefined);
    assert.equal(client.route, 'cloud');
    assert.equal(client.omadacId, OMADAC_ID, 'the organization\'s omadacId, not /api/info\'s');
    assert.equal(client.baseUrl, `${APS}${PREFIX}`);
    assert.equal(transport.requests.some((request) => request.url.includes(TOKEN_PATH) || request.url.includes('/api/info')), false, 'no controller token request, no /api/info');
  }); // End of test "sites: one account token..."

  test('the guide\'s users example path, an AP-group list (v1, paged) and an AP-group create (POST with its body) behind the prefix', async () => {
    const { client, transport } = setup();
    transport
      .on('POST', `${EUW}${CLOUD_TOKEN_PATH}`, tokenReply('a1-AT-cloudTokenValue000000000002'))
      .on('GET', tunnel(`/openapi/v1/${OMADAC_ID}/users?page=1&pageSize=10`), { body: guide.cloudAccessUsersPage })
      .on('GET', tunnel(`/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/ap-groups?page=1&pageSize=100`), ok({ totalRows: 1, maxSsids2G: 8, data: [{ id: AP_GROUP_ID, name: 'Planta 4', primary: true, apNum: 3 }] }))
      .on('POST', tunnel(`/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/ap-groups`), ok({ id: '64aa00000000000000000002' }));
    const users = await client.request('GET', 'v1', ['users'], { query: { page: 1, pageSize: 10 } });
    assert.deepEqual(users, guide.cloudAccessUsersPage.result);
    const groups = await client.listApGroups(SITE_ID);
    assert.deepEqual(groups, { items: [{ id: AP_GROUP_ID, name: 'Planta 4', isDefault: true, apNum: 3 }], truncated: false, limits: { band2g: 8 } });
    assert.equal(await client.createApGroup(SITE_ID, 'Nuevo grupo'), '64aa00000000000000000002');
    const create = transport.requests[transport.requests.length - 1];
    assert.equal(create.url, `${APS}/v1/cloudaccess/${DEVICE_ID}/openapi/v1/${OMADAC_ID}/sites/${SITE_ID}/ap-groups`);
    assert.deepEqual(create.body, { name: 'Nuevo grupo' });
    assert.equal(create.headers['Content-Type'], 'application/json');
    assert.equal(transport.requestsTo('POST', `${EUW}${CLOUD_TOKEN_PATH}`).length, 1, 'the account token is reused');
  }); // End of test "the guide's users example path..."

  test('a v2 path (the SSID catalog) keeps its version behind the prefix', async () => {
    const { client, transport } = setup();
    transport
      .on('POST', `${EUW}${CLOUD_TOKEN_PATH}`, tokenReply('a1-AT-cloudTokenValue000000000003'))
      .on('GET', tunnel(`/openapi/v2/${OMADAC_ID}/sites/${SITE_ID}/wireless-network/ssids?page=1&pageSize=100`), ok({ totalRows: 0, data: [] }));
    assert.deepEqual(await client.listSsids(SITE_ID), { items: [], truncated: false });
  });
});

describe('OpenApiClient cloud route: tokens and errors', () => {
  test('an auth error (HTTP 401 / -44116) through the tunnel: one fresh get_tokens, one retry with the new account token', async () => {
    const { client, transport } = setup();
    const sites = tunnel(`/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`);
    transport
      .on('POST', `${EUW}${CLOUD_TOKEN_PATH}`, [tokenReply('a1-AT-oldCloudTokenValue0000000001'), tokenReply('a1-AT-newCloudTokenValue0000000002')])
      .on('GET', sites, [{ status: 401, body: guide.liveBadBearer.body }, ok({ totalRows: 0, data: [] })]);
    await client.listSites();
    assert.deepEqual(transport.requestsTo('GET', sites).map((request) => request.headers.Authorization), [
      'AccessToken=a1-AT-oldCloudTokenValue0000000001',
      'AccessToken=a1-AT-newCloudTokenValue0000000002'
    ]);
    assert.ok(transport.requests.every((request) => !/refresh/i.test(request.url)));
  });

  test('-44116 in a 2xx envelope counts as a rejection too; a second rejection is tokenRejected (no loop)', async () => {
    const { client, transport } = setup();
    const sites = tunnel(`/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`);
    transport
      .on('POST', `${EUW}${CLOUD_TOKEN_PATH}`, [tokenReply('a1-AT-oldCloudTokenValue0000000001'), tokenReply('a1-AT-newCloudTokenValue0000000002')])
      .on('GET', sites, { body: guide.liveBadBearer.body });
    await expectOpenApiError(client.listSites(), 'tokenRejected');
    assert.equal(transport.requests.length, 4);
  });

  test('a cloud credential failure surfaces as invalidCredentials with TP-Link\'s errorCode; no tunnel call is made', async () => {
    const { client, transport } = setup();
    transport.on('POST', `${EUW}${CLOUD_TOKEN_PATH}`, { body: guide.liveCredentialExpired });
    const error = await expectOpenApiError(client.listSites(), 'invalidCredentials');
    assert.equal(error.controllerErrorCode, -52602);
    assert.equal(transport.requests.length, 1);
  });

  test('-7132 through the tunnel backs the credential off and is retried; persistent → rateLimited after 3 retries', async () => {
    const once = setup();
    const sites = tunnel(`/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`);
    once.transport.on('POST', `${EUW}${CLOUD_TOKEN_PATH}`, tokenReply('a1-AT-cloudTokenValue000000000004')).on('GET', sites, [{ body: guide.rateLimited }, ok({ totalRows: 0, data: [] })]);
    await once.client.listSites();
    assert.ok(once.clock.sleeps.includes(1000));
    const always = setup();
    always.transport.on('POST', `${EUW}${CLOUD_TOKEN_PATH}`, tokenReply('a1-AT-cloudTokenValue000000000005')).on('GET', sites, { status: 429, body: '' });
    const error = await expectOpenApiError(always.client.listSites(), 'rateLimited');
    assert.equal(error.httpStatus, 429);
    assert.equal(always.transport.requestsTo('GET', sites).length, 4);
  });

  test('the tunnel and the account share ONE throttle: concurrent account and tunnel calls never start more than 5 per second', async () => {
    const { account, client, transport, clock } = setup();
    const starts: number[] = [];
    const record = (reply: FakeReply) => () => {
      starts.push(clock.time);
      return reply;
    };
    transport
      .on('POST', `${EUW}${CLOUD_TOKEN_PATH}`, record(tokenReply('a1-AT-cloudTokenValue000000000006')))
      .on('GET', `${EUW}${CLOUD_ORGANIZATIONS_PATH}?page=1&pageSize=100`, record({ body: guide.organizationsPage }))
      .on('GET', tunnel(`/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`), record(ok({ totalRows: 0, data: [] })));
    await Promise.all([...Array.from({ length: 5 }, () => client.listSites()), ...Array.from({ length: 5 }, () => account.listOrganizations())]);
    assert.equal(starts.length, 11);
    for (let index = 5; index < starts.length; index++) {
      assert.ok(starts[index] - starts[index - 5] >= 1000, `start ${index}`);
    }
  }); // End of test "the tunnel and the account share ONE throttle..."

  test('a refusal (2xx and non-2xx) and a transport failure lose the tunnel base URL, the serverHost origin and host and the deviceId by value, the base URL whole', async () => {
    const { client, transport } = setup();
    const sites = tunnel(`/openapi/v1/${OMADAC_ID}/sites?page=1&pageSize=100`);
    const base = `${APS}${PREFIX}`;
    const host = new URL(APS).hostname;
    const msg = `No permission for ${base}/openapi/v1 via ${APS} (host ${host}, device ${DEVICE_ID}).`;
    let call = 0;
    transport.on('POST', `${EUW}${CLOUD_TOKEN_PATH}`, tokenReply('a1-AT-cloudTokenValue000000000007')).on('GET', sites, () => {
      call++;
      if (call === 3) {
        throw new Error(`connect ECONNREFUSED ${base}/openapi/v1 (${host}, ${DEVICE_ID})`);
      }
      return { status: call === 1 ? 200 : 403, body: { errorCode: -1005, msg } };
    });
    const refused = await expectOpenApiError(client.listSites(), 'apiError');
    const forbidden = await expectOpenApiError(client.listSites(), 'httpError');
    const unreachable = await expectOpenApiError(client.listSites(), 'networkError');
    // Longest value first: the base URL goes whole, not as "[REDACTED]/v1/cloudaccess/[REDACTED]"
    const scrubbed = 'No permission for [REDACTED]/openapi/v1 via [REDACTED] (host [REDACTED], device [REDACTED]).';
    assert.equal(refused.controllerMessage, scrubbed);
    assert.equal(forbidden.controllerMessage, scrubbed);
    assert.equal(unreachable.diagnostic, 'connect ECONNREFUSED [REDACTED]/openapi/v1 ([REDACTED], [REDACTED])');
    for (const error of [refused, forbidden, unreachable]) {
      for (const text of [error.message, error.diagnostic, error.controllerMessage ?? '', describeOpenApiFailure(error)]) {
        for (const value of [base, APS, host, DEVICE_ID]) {
          assert.ok(!text.includes(value), `${value} in ${text}`);
        }
      }
    } // End of the loop over the three failures
  }); // End of test "a refusal (2xx and non-2xx) and a transport failure..."

  test('the local route scrubs no routing value: its refusal and transport-failure diagnostics are unchanged', async () => {
    const localBase = 'https://controller.invalid:8043';
    const transport = new FakeTransport(localBase);
    const local = new OpenApiClient({ baseUrl: localBase, omadacId: 'c0ffee00c0ffee00c0ffee00', clientId: 'id', clientSecret: 'secret', transport });
    // Short enough for MAX_DIAGNOSTIC_CHARS with its context
    const msg = `No permission for ${localBase}/openapi/v1 (device ${DEVICE_ID}).`;
    let call = 0;
    transport.on('POST', TOKEN_PATH, tokenReply('AT-local-1')).on('GET', '/openapi/v1/c0ffee00c0ffee00c0ffee00/sites?page=1&pageSize=100', () => {
      call++;
      if (call === 2) {
        throw new Error(`connect ECONNREFUSED ${localBase}/openapi/v1 (${DEVICE_ID})`);
      }
      return { body: { errorCode: -1005, msg } };
    });
    const refused = await expectOpenApiError(local.listSites(), 'apiError');
    assert.equal(refused.diagnostic, `GET request failed: errorCode -1005 (${msg})`);
    assert.equal(refused.controllerMessage, null, 'the local route keeps no controller text');
    const unreachable = await expectOpenApiError(local.listSites(), 'networkError');
    assert.equal(unreachable.diagnostic, `connect ECONNREFUSED ${localBase}/openapi/v1 (${DEVICE_ID})`);
  }); // End of test "the local route scrubs no routing value..."
});

describe('OpenApiClient cloud route: the serverHost allowlist', () => {
  test('a target whose serverHost is not allowlisted is refused in the constructor, before any request', () => {
    const transport = new FakeTransport('');
    const throttle = new CloudRequestThrottle();
    const account = new CloudAccountClient({ region: 'euw', clientId: 'cloud-client', clientSecret: 'cloud-secret-value', transport, throttle });
    const base: CloudControllerTarget = { omadacId: OMADAC_ID, deviceId: DEVICE_ID, serverOrigin: APS };
    for (const serverOrigin of [
      'https://evil.example',
      'https://192.168.1.130:8043',
      `${APS}/`,
      `${APS}:8443`,
      'http://aps1-omada-northbound.tplinkcloud.com',
      'https://aps1-omada-northbound.tplinkcloud.com.evil.example',
      'https://user@aps1-omada-northbound.tplinkcloud.com',
      ''
    ]) {
      assert.throws(() => new OpenApiClient({ route: 'cloud', target: { ...base, serverOrigin }, tokenProvider: account, throttle, transport }), /allowlisted/, serverOrigin);
    }
    for (const target of [{ ...base, deviceId: '../x' }, { ...base, deviceId: '' }, { ...base, omadacId: 'local' }]) {
      assert.throws(() => new OpenApiClient({ route: 'cloud', target, tokenProvider: account, throttle, transport }), /omadacId and deviceId/);
    }
    assert.equal(transport.requests.length, 0, 'nothing was sent');
    // An organization whose serverHost is not allowlisted has no target at all
    assert.equal(cloudControllerTarget(validateCloudOrganization({ ...ORGANIZATION, serverHost: 'https://evil.example' })), null);
  }); // End of test "a target whose serverHost is not allowlisted..."

  test('the local route is unchanged: no throttle, its own client-credentials token path, -7132 stays an apiError', async () => {
    const transport = new FakeTransport('https://controller.invalid:8043');
    const local = new OpenApiClient({ baseUrl: 'https://controller.invalid:8043', omadacId: 'c0ffee00c0ffee00c0ffee00', clientId: 'id', clientSecret: 'secret', transport });
    transport
      .on('POST', TOKEN_PATH, tokenReply('AT-local-1'))
      .on('GET', '/openapi/v1/c0ffee00c0ffee00c0ffee00/sites?page=1&pageSize=100', { body: guide.rateLimited });
    const error = await expectOpenApiError(local.listSites(), 'apiError');
    assert.equal(error.controllerErrorCode, -7132);
    assert.equal(local.route, 'local');
    assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, 'GET /openapi/v1/c0ffee00c0ffee00c0ffee00/sites?page=1&pageSize=100']);
  });
});
