// Tests for the TP-Link cloud account client (src/main/cloud-account-client.ts),
// driven by the fake transport and a fake clock — no Electron, no network,
// never a tplinkcloud.com request: get_tokens exactly as the guide shows it,
// the `AccessToken=` header, renewal by get_tokens shortly before expiry, one
// re-acquire on an auth error (HTTP 401 / -44116 / -44112) and never a loop,
// the refresh token never sent nor kept, the organization walk to totalRows
// with its page cap, the shared throttle (≤ 5 requests/s across concurrent
// callers) and the -7132 / HTTP 429 backoff, every stable error code, the
// secret and the tokens scrubbed from every diagnostic, and close().

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CloudAccountError, type CloudAccountErrorCode } from '../../src/main/cloud-account-model';
import {
  CLOUD_ORGANIZATIONS_PATH,
  CLOUD_TOKEN_PATH,
  CloudAccountClient,
  MAX_ORGANIZATION_PAGES,
  ORGANIZATION_PAGE_SIZE
} from '../../src/main/cloud-account-client';
import { CloudRequestThrottle } from '../../src/main/cloud-throttle';
import guide from '../fixtures/cloud/account-guide.json';
import fourOrganizations from '../fixtures/cloud/organizations-four.json';
import { FakeClock } from './helpers/fake-clock';
import { FakeTransport, type FakeReply } from './helpers/fake-transport';
import { reachableStrings } from './helpers/reachable-strings';

const EUW = 'https://euw1-omada-northbound.tplinkcloud.com';
const CLIENT_ID = '185586e0df424f5ea938de13cba91e01';
const CLIENT_SECRET = '767372a5258a4fc1a03c57f3d071fc35';
const GUIDE_TOKEN = guide.tokenSuccess.result.accessToken;
const GUIDE_REFRESH = guide.tokenSuccess.result.refreshToken;
const ORGS_PAGE_1 = `${CLOUD_ORGANIZATIONS_PATH}?page=1&pageSize=${ORGANIZATION_PAGE_SIZE}`;

/**
 * A successful get_tokens answer carrying the given token.
 * @param {string} token - The access token.
 * @param {number} [expiresIn] - Lifetime in seconds.
 * @returns {FakeReply} The reply.
 */
function tokenReply(token: string, expiresIn = 7200): FakeReply {
  return { body: { errorCode: 0, msg: 'Open API Get Access Token successfully.', result: { accessToken: token, tokenType: 'bearer', expiresIn, refreshToken: `RT-${token.replace(/\W/g, '')}RefreshValue0000` } } };
}

/**
 * One page of organizations with generated rows.
 * @param {number} from - First row number.
 * @param {number} count - Rows on the page.
 * @param {number} totalRows - The reported total.
 * @returns {FakeReply} The reply.
 */
function organizationsPage(from: number, count: number, totalRows: number): FakeReply {
  const data = Array.from({ length: count }, (_, index) => ({ ...fourOrganizations.page.result.data[3], omadacId: `org${from + index}`, orgName: `Org ${from + index}` }));
  return { body: { errorCode: 0, msg: 'OK', result: { totalRows, currentPage: 1, currentSize: count, data } } };
}

/**
 * The path of one organization page.
 * @param {number} page - Page number.
 * @returns {string} The path with its query.
 */
function orgsPage(page: number): string {
  return `${CLOUD_ORGANIZATIONS_PATH}?page=${page}&pageSize=${ORGANIZATION_PAGE_SIZE}`;
}

/**
 * Creates a client on the EUW region over a fresh fake transport and clock.
 * @returns {{ client: CloudAccountClient; transport: FakeTransport; clock: FakeClock }} The parts.
 */
function setup(): { client: CloudAccountClient; transport: FakeTransport; clock: FakeClock } {
  const clock = new FakeClock();
  const transport = new FakeTransport(EUW);
  const client = new CloudAccountClient({
    region: 'euw',
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    transport,
    throttle: new CloudRequestThrottle({ now: clock.now, sleep: clock.sleep }),
    now: clock.now
  });
  return { client, transport, clock };
} // End of function setup()

/**
 * Awaits a promise expected to reject with a CloudAccountError of a code.
 * @param {Promise<unknown>} promise - The promise.
 * @param {CloudAccountErrorCode} code - The expected code.
 * @returns {Promise<CloudAccountError>} The error.
 */
async function expectCloudError(promise: Promise<unknown>, code: CloudAccountErrorCode): Promise<CloudAccountError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof CloudAccountError, String(error));
    assert.equal(error.code, code, error.message);
    return error;
  }
  throw new Error(`expected a CloudAccountError ${code}`);
} // End of function expectCloudError()

/**
 * Counts the get_tokens requests so far.
 * @param {FakeTransport} transport - The transport.
 * @returns {number} The count.
 */
function tokenRequests(transport: FakeTransport): number {
  return transport.requestsTo('POST', CLOUD_TOKEN_PATH).length;
}

describe('CloudAccountClient: get_tokens and the AccessToken header (the guide\'s examples)', () => {
  test('the token request and the organization list are exactly the documented calls', async () => {
    const { client, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, { body: guide.tokenSuccess }).on('GET', ORGS_PAGE_1, { body: guide.organizationsPage });
    const list = await client.listOrganizations();
    assert.equal(list.truncated, false);
    assert.deepEqual(list.items.map((organization) => organization.omadacId), ['5ffc0460d2816b0d09b531cd27c106a8']);
    const [token, organizations] = transport.requests;
    assert.equal(token.url, `${EUW}/authorize/account/token?type=get_tokens`);
    assert.equal(token.method, 'POST');
    assert.deepEqual(token.body, { client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    assert.equal(token.headers['Content-Type'], 'application/json');
    assert.equal(token.headers.Authorization, undefined);
    assert.equal(organizations.url, `${EUW}/v1/organizations?page=1&pageSize=100`);
    assert.equal(organizations.headers.Authorization, `AccessToken=${GUIDE_TOKEN}`);
    assert.equal(organizations.body, undefined);
    assert.equal(transport.requests.length, 2);
  }); // End of test "the token request and the organization list..."

  test('each region has its own base URL', async () => {
    for (const [region, host] of [['aps', 'aps1'], ['use', 'use1']] as const) {
      const base = `https://${host}-omada-northbound.tplinkcloud.com`;
      const transport = new FakeTransport(base);
      transport.on('POST', CLOUD_TOKEN_PATH, { body: guide.tokenSuccess });
      const client = new CloudAccountClient({ region, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, transport });
      await client.authorize();
      assert.equal(transport.requests[0].url, `${base}/authorize/account/token?type=get_tokens`);
    }
    assert.throws(() => new CloudAccountClient({ region: 'xx' as unknown as 'euw', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, transport: new FakeTransport(EUW) }), /region/);
    assert.throws(() => new CloudAccountClient({ region: 'euw', clientId: '', clientSecret: CLIENT_SECRET, transport: new FakeTransport(EUW) }), /Client ID/);
    assert.throws(() => new CloudAccountClient({ region: 'euw', clientId: CLIENT_ID, clientSecret: '', transport: new FakeTransport(EUW) }), (error: unknown) => error instanceof Error && !error.message.includes(CLIENT_ID));
  });

  test('a valid token is reused; renewal re-runs get_tokens shortly before expiry (60 s margin), never earlier', async () => {
    const { client, transport, clock } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, [tokenReply('AT-first-token-AAAAAAAAAAAA'), tokenReply('AT-second-token-BBBBBBBBBBB')]).on('GET', ORGS_PAGE_1, organizationsPage(1, 1, 1));
    await client.listOrganizations();
    clock.advance(7200 * 1000 - 60 * 1000 - 1);
    await client.listOrganizations();
    assert.equal(tokenRequests(transport), 1, 'still valid one millisecond before the margin');
    clock.advance(1);
    await client.listOrganizations();
    assert.equal(tokenRequests(transport), 2, 'renewed at the margin');
    const auth = transport.requestsTo('GET', ORGS_PAGE_1).map((request) => request.headers.Authorization);
    assert.deepEqual(auth, ['AccessToken=AT-first-token-AAAAAAAAAAAA', 'AccessToken=AT-first-token-AAAAAAAAAAAA', 'AccessToken=AT-second-token-BBBBBBBBBBB']);
  }); // End of test "a valid token is reused; renewal re-runs get_tokens..."

  test('authorize({ fresh: true }) requires a new get_tokens even with a valid token; concurrent callers share one acquisition', async () => {
    const { client, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, [tokenReply('AT-one-AAAAAAAAAAAAAAAAAAAA'), tokenReply('AT-two-BBBBBBBBBBBBBBBBBBBB')]);
    await Promise.all([client.authorize(), client.authorize(), client.getAccessToken()]);
    assert.equal(tokenRequests(transport), 1, 'one shared acquisition');
    await client.authorize({ fresh: true });
    assert.equal(tokenRequests(transport), 2);
    assert.equal(await client.getAccessToken(), 'AT-two-BBBBBBBBBBBBBBBBBBBB');
  });
});

describe('CloudAccountClient: auth errors re-acquire once, never the refresh token', () => {
  test('HTTP 401 with -44116 (the live bad-bearer answer): one new get_tokens, one retry with the new token', async () => {
    const { client, transport } = setup();
    transport
      .on('POST', CLOUD_TOKEN_PATH, [tokenReply('AT-old-token-AAAAAAAAAAAAAAA'), tokenReply('AT-new-token-BBBBBBBBBBBBBBB')])
      .on('GET', ORGS_PAGE_1, [{ status: 401, body: guide.liveBadBearer.body }, organizationsPage(1, 1, 1)]);
    const list = await client.listOrganizations();
    assert.equal(list.items.length, 1);
    assert.deepEqual(transport.log(), [`POST ${CLOUD_TOKEN_PATH}`, `GET ${ORGS_PAGE_1}`, `POST ${CLOUD_TOKEN_PATH}`, `GET ${ORGS_PAGE_1}`]);
    assert.equal(transport.requests[3].headers.Authorization, 'AccessToken=AT-new-token-BBBBBBBBBBBBBBB');
  });

  test('errorCode -44112 (expired) and -44113 (invalid) in a 2xx answer count as rejections too', async () => {
    for (const rejection of [guide.tokenExpired, { errorCode: -44113, msg: 'The Access Token is Invalid' }]) {
      const { client, transport } = setup();
      transport
        .on('POST', CLOUD_TOKEN_PATH, [tokenReply('AT-old-token-AAAAAAAAAAAAAAA'), tokenReply('AT-new-token-BBBBBBBBBBBBBBB')])
        .on('GET', ORGS_PAGE_1, [{ body: rejection }, organizationsPage(1, 1, 1)]);
      await client.listOrganizations();
      assert.equal(tokenRequests(transport), 2, String(rejection.errorCode));
    }
  });

  test('a second rejection is final: tokenRejected, no loop (2 token requests, 2 calls)', async () => {
    const { client, transport } = setup();
    transport
      .on('POST', CLOUD_TOKEN_PATH, [tokenReply('AT-old-token-AAAAAAAAAAAAAAA'), tokenReply('AT-new-token-BBBBBBBBBBBBBBB')])
      .on('GET', ORGS_PAGE_1, { status: 401, body: guide.liveBadBearer.body });
    const error = await expectCloudError(client.listOrganizations(), 'tokenRejected');
    assert.match(error.diagnostic, /HTTP 401/);
    assert.equal(transport.requests.length, 4);
  });

  test('the refresh token is never sent and never kept: no `type=refresh`, no `refresh_token`, not reachable from the client', async () => {
    const { client, transport, clock } = setup();
    transport
      .on('POST', CLOUD_TOKEN_PATH, [{ body: guide.tokenSuccess }, { body: guide.tokenRefreshExample }, { body: guide.tokenSuccess }])
      .on('GET', ORGS_PAGE_1, [{ status: 401, body: guide.liveBadBearer.body }, organizationsPage(1, 1, 1), organizationsPage(1, 1, 1)]);
    await client.listOrganizations();
    clock.advance(7200 * 1000);
    await client.listOrganizations();
    for (const request of transport.requests) {
      const text = `${request.url} ${JSON.stringify(request.body ?? {})} ${JSON.stringify(request.headers)}`;
      assert.ok(!/refresh/i.test(text), text);
      assert.ok(!text.includes(GUIDE_REFRESH) && !text.includes(guide.tokenRefreshExample.result.refreshToken), text);
    }
    assert.ok(transport.requests.filter((request) => request.method === 'POST').every((request) => request.url === `${EUW}/authorize/account/token?type=get_tokens`));
    const strings = await reachableStrings(client);
    for (const refreshToken of [GUIDE_REFRESH, guide.tokenRefreshExample.result.refreshToken]) {
      assert.ok(!strings.includes(refreshToken), 'no refresh token in the client');
      assert.ok(!client.liveSecrets().includes(refreshToken));
    }
  }); // End of test "the refresh token is never sent and never kept..."
});

describe('CloudAccountClient: the organization walk', () => {
  test('totalRows is followed over several pages (100 + 50), deduplicated by omadacId, complete', async () => {
    const { client, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('AT-token-AAAAAAAAAAAAAAAAAAAA')).on('GET', orgsPage(1), organizationsPage(1, 100, 150)).on('GET', orgsPage(2), organizationsPage(101, 50, 150));
    const list = await client.listOrganizations();
    assert.equal(list.items.length, 150);
    assert.equal(list.truncated, false);
    assert.equal(transport.requestsTo('GET', orgsPage(3)).length, 0);
  });

  test('a huge totalRows stops at the page cap and is flagged truncated (fail-closed), never a loop', async () => {
    const { client, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('AT-token-AAAAAAAAAAAAAAAAAAAA'));
    for (let page = 1; page <= MAX_ORGANIZATION_PAGES + 1; page++) {
      transport.on('GET', orgsPage(page), organizationsPage((page - 1) * 100 + 1, 100, 100000));
    }
    const list = await client.listOrganizations();
    assert.equal(list.truncated, true);
    assert.equal(list.items.length, MAX_ORGANIZATION_PAGES * 100);
    assert.equal(transport.requests.filter((request) => request.method === 'GET').length, MAX_ORGANIZATION_PAGES);
  });

  test('an empty page before totalRows, or a repeating page, is truncated; a page that is not a list or a row without omadacId is malformedResponse', async () => {
    const gap = setup();
    gap.transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('AT-token-AAAAAAAAAAAAAAAAAAAA')).on('GET', orgsPage(1), organizationsPage(1, 100, 150)).on('GET', orgsPage(2), organizationsPage(1, 0, 150));
    assert.equal((await gap.client.listOrganizations()).truncated, true);
    const repeat = setup();
    repeat.transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('AT-token-AAAAAAAAAAAAAAAAAAAA')).on('GET', orgsPage(1), organizationsPage(1, 100, 150)).on('GET', orgsPage(2), organizationsPage(1, 100, 150));
    assert.equal((await repeat.client.listOrganizations()).truncated, true);
    for (const body of [{ errorCode: 0, result: { data: 'x' } }, { errorCode: 0 }, { errorCode: 0, result: { totalRows: 1, data: [{ orgName: 'no id' }] } }]) {
      const { client, transport } = setup();
      transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('AT-token-AAAAAAAAAAAAAAAAAAAA')).on('GET', ORGS_PAGE_1, { body });
      await expectCloudError(client.listOrganizations(), 'malformedResponse');
    }
  }); // End of test "an empty page before totalRows..."
});

describe('CloudAccountClient: the shared throttle and the rate limit', () => {
  test('concurrent listings on one credential start at most 5 requests in any 1 s window (token request included)', async () => {
    const { client, transport, clock } = setup();
    const starts: number[] = [];
    transport
      .on('POST', CLOUD_TOKEN_PATH, () => {
        starts.push(clock.time);
        return tokenReply('AT-token-AAAAAAAAAAAAAAAAAAAA');
      })
      .on('GET', ORGS_PAGE_1, () => {
        starts.push(clock.time);
        return organizationsPage(1, 1, 1);
      });
    await Promise.all(Array.from({ length: 11 }, () => client.listOrganizations()));
    assert.equal(starts.length, 12, 'one token request and 11 listings');
    for (let index = 5; index < starts.length; index++) {
      assert.ok(starts[index] - starts[index - 5] >= 1000, `start ${index}`);
    }
  }); // End of test "concurrent listings on one credential..."

  test('-7132 backs the credential off (1 s) and the call is retried; HTTP 429 the same', async () => {
    for (const limited of [{ body: guide.rateLimited }, { status: 429, body: guide.rateLimited }, { status: 429, body: '<html>Too Many Requests</html>' }]) {
      const { client, transport, clock } = setup();
      transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('AT-token-AAAAAAAAAAAAAAAAAAAA')).on('GET', ORGS_PAGE_1, [limited, organizationsPage(1, 1, 1)]);
      const list = await client.listOrganizations();
      assert.equal(list.items.length, 1);
      assert.equal(transport.requestsTo('GET', ORGS_PAGE_1).length, 2);
      assert.ok(clock.sleeps.includes(1000), JSON.stringify(clock.sleeps));
    }
  });

  test('a persistent rate limit ends as rateLimited after 3 retries with a growing backoff; a rate-limited token request too', async () => {
    const { client, transport, clock } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('AT-token-AAAAAAAAAAAAAAAAAAAA')).on('GET', ORGS_PAGE_1, { body: guide.rateLimited });
    const error = await expectCloudError(client.listOrganizations(), 'rateLimited');
    assert.equal(error.apiErrorCode, -7132);
    assert.equal(transport.requestsTo('GET', ORGS_PAGE_1).length, 4);
    assert.deepEqual(clock.sleeps, [1000, 2000, 4000]);
    const token = setup();
    token.transport.on('POST', CLOUD_TOKEN_PATH, { status: 429, body: '' });
    const tokenError = await expectCloudError(token.client.authorize(), 'rateLimited');
    assert.equal(tokenError.httpStatus, 429);
  });
});

describe('CloudAccountClient: stable error codes, nothing secret in a diagnostic', () => {
  test('token refusals: -52602 (live), -90106, -90112, -90113 and HTTP 401 / 403 are credentialInvalid; -90114 an apiError with its message', async () => {
    const cases: Array<[FakeReply, CloudAccountErrorCode, number | null, number | null]> = [
      [{ body: guide.liveCredentialExpired }, 'credentialInvalid', null, -52602],
      [{ body: guide.clientInvalid }, 'credentialInvalid', null, -90106],
      [{ body: { errorCode: -90112, msg: 'This Open API Application has expired or does not exist' } }, 'credentialInvalid', null, -90112],
      [{ body: guide.applicationDisabled }, 'credentialInvalid', null, -90113],
      [{ status: 401, body: guide.liveBadBearer.body }, 'credentialInvalid', 401, -44116],
      [{ status: 403, body: '<html>Forbidden</html>' }, 'credentialInvalid', 403, null],
      [{ body: guide.tooManyAuthentications }, 'apiError', null, -90114],
      [{ status: 500, body: '<html>oops</html>' }, 'httpError', 500, null],
      [{ status: 502, body: { errorCode: -1, msg: 'Bad gateway' } }, 'httpError', 502, -1],
      [{ body: 'not json' }, 'malformedResponse', null, null],
      [{ body: { msg: 'no code' } }, 'malformedResponse', null, null],
      [{ body: { errorCode: 0, result: { tokenType: 'bearer' } } }, 'malformedResponse', null, null],
      [{ body: { errorCode: 0, result: { accessToken: 'has space', expiresIn: 7200 } } }, 'malformedResponse', null, null]
    ];
    for (const [reply, code, httpStatus, apiErrorCode] of cases) {
      const { client, transport } = setup();
      transport.on('POST', CLOUD_TOKEN_PATH, reply);
      const error = await expectCloudError(client.authorize(), code);
      assert.equal(error.httpStatus, httpStatus, JSON.stringify(reply));
      assert.equal(error.apiErrorCode, apiErrorCode, JSON.stringify(reply));
    }
    const { client, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, { body: guide.tooManyAuthentications });
    const error = await expectCloudError(client.authorize(), 'apiError');
    assert.match(error.diagnostic, /errorCode -90114 \(This Open API Application has exceeded the maximum allowed authentications\)/);
  }); // End of test "token refusals..."

  test('an unknown errorCode on the organization list is apiError with its code; -44121 (no organization permission) too', async () => {
    const { client, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('AT-token-AAAAAAAAAAAAAAAAAAAA')).on('GET', ORGS_PAGE_1, { body: guide.noOrganizationPermission });
    const error = await expectCloudError(client.listOrganizations(), 'apiError');
    assert.equal(error.apiErrorCode, -44121);
  });

  test('transport failures: timeout and networkError, scrubbed of the secret and the token by value', async () => {
    const timeout = setup();
    timeout.transport.on('POST', CLOUD_TOKEN_PATH, () => {
      throw new Error('Request timeout (15s)');
    });
    await expectCloudError(timeout.client.authorize(), 'timeout');
    const network = setup();
    network.transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('AT-plain-token-value-XYZXYZXYZ')).on('GET', ORGS_PAGE_1, () => {
      throw new Error(`socket hang up near AT-plain-token-value-XYZXYZXYZ and ${CLIENT_SECRET}`);
    });
    const error = await expectCloudError(network.client.listOrganizations(), 'networkError');
    assert.ok(!error.message.includes('AT-plain-token-value-XYZXYZXYZ') && !error.message.includes(CLIENT_SECRET), error.message);
  });

  test('TP-Link\'s message echoing the secret, the token or a client_secret pair never reaches the diagnostic', async () => {
    const { client, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, { body: { errorCode: -90199, msg: `bad ${CLIENT_SECRET} client_secret=${CLIENT_SECRET} refresh_token=RT-gvPUG4oKc5SB6aDcsDfpE1KrohhjVZbY` } });
    const error = await expectCloudError(client.authorize(), 'apiError');
    for (const secret of [CLIENT_SECRET, 'RT-gvPUG4oKc5SB6aDcsDfpE1KrohhjVZbY']) {
      assert.ok(!error.message.includes(secret) && !error.diagnostic.includes(secret), error.message);
    }
    assert.match(error.diagnostic, /errorCode -90199/);
  });
});

describe('CloudAccountClient: identity, live secrets and close()', () => {
  test('usesCredentials() compares region, Client ID and secret; liveSecrets() holds the secret and the tokens until close()', async () => {
    const { client, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, { body: guide.tokenSuccess });
    assert.equal(client.usesCredentials({ region: 'euw', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }), true);
    assert.equal(client.usesCredentials({ region: 'aps', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }), false);
    assert.equal(client.usesCredentials({ region: 'euw', clientId: 'other', clientSecret: CLIENT_SECRET }), false);
    assert.equal(client.usesCredentials({ region: 'euw', clientId: CLIENT_ID, clientSecret: 'other' }), false);
    await client.authorize();
    assert.deepEqual(client.liveSecrets(), [CLIENT_SECRET, GUIDE_TOKEN]);
    assert.ok(!JSON.stringify(client).includes(CLIENT_SECRET) && !JSON.stringify(client).includes(GUIDE_TOKEN), 'private fields');
    client.close();
    assert.deepEqual(client.liveSecrets(), []);
    const strings = await reachableStrings(client);
    assert.ok(!strings.includes(GUIDE_TOKEN), 'no token reference left');
    await expectCloudError(client.listOrganizations(), 'clientClosed');
  }); // End of test "usesCredentials() compares region..."

  test('close() during a request in flight: clientClosed, nothing more is sent', async () => {
    const { client, transport } = setup();
    let release!: (reply: FakeReply) => void;
    transport
      .on('POST', CLOUD_TOKEN_PATH, tokenReply('AT-token-AAAAAAAAAAAAAAAAAAAA'))
      .on('GET', ORGS_PAGE_1, () => new Promise<FakeReply>((resolve) => {
        release = resolve;
      }));
    const pending = client.listOrganizations();
    await new Promise((resolve) => setImmediate(resolve));
    client.close();
    release({ status: 401, body: guide.liveBadBearer.body });
    await expectCloudError(pending, 'clientClosed');
    assert.equal(transport.requests.length, 2, 'no re-acquire, no retry after close');
  });
});
