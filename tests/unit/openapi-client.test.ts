// Tests for the Open API client (src/main/openapi-client.ts), driven by the
// fake transport (no Electron, no network) and the fixtures in
// tests/fixtures/openapi/: the client-credentials token request, the
// `AccessToken=` header, proactive renewal, re-acquire-once on a rejected
// token through ONE shared acquisition, no retry loop, pagination with dedupe,
// the page cap and its completeness rules (a sane totalRows is followed past
// short pages; an empty or repeating page before it, or a changed totalRows,
// is an explicit truncation), explicit v1/v2 paths, PUT/DELETE pass-through, the
// validators, the stable error codes, that no secret or token ever shows
// up in an error, a diagnostic or the client object itself, and that close()
// drops every token reference (also the ones only private fields hold) and
// ends an operation in flight as clientClosed without another request.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inspect } from 'node:util';
import {
  MAX_PAGES,
  OpenApiClient,
  OpenApiError,
  openApiPath,
  TOKEN_PATH,
  validateApGroupLimits,
  validateCreatedApGroup,
  validateOpenApiApGroup,
  validateOpenApiPage,
  validateOpenApiSite,
  validateTokenResult,
  type OpenApiErrorCode
} from '../../src/main/openapi-client';
import apGroupWriteFixtures from '../fixtures/openapi/ap-group-writes.json';
import apGroupFixtures from '../fixtures/openapi/ap-groups.json';
import siteFixtures from '../fixtures/openapi/sites.json';
import ssidFixtures from '../fixtures/openapi/ssids.json';
import tokenFixtures from '../fixtures/openapi/token.json';
import { FakeTransport, type FakeReply, type RecordedRequest } from './helpers/fake-transport';
import { reachableStrings } from './helpers/reachable-strings';

const BASE_URL = 'https://controller.invalid:8043';
const OMADAC_ID = 'c0ffee00c0ffee00c0ffee00';
const CLIENT_ID = 'owm-client-0001';
const CLIENT_SECRET = 'S3cr3t-Client-Value-For-Tests';
const SITES = `/openapi/v1/${OMADAC_ID}/sites`;
const SITES_PAGE_1 = `${SITES}?page=1&pageSize=100`;

/**
 * A successful token response carrying the given token.
 * @param {string} token - The access token.
 * @param {number} [expiresIn] - Lifetime in seconds.
 * @returns {FakeReply} The reply.
 */
function tokenReply(token: string, expiresIn = 7200): FakeReply {
  return { body: { errorCode: 0, msg: 'Open API Get Access Token successfully.', result: { accessToken: token, tokenType: 'bearer', expiresIn, refreshToken: `RT-${token}` } } };
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
 * One page of sites.
 * @param {string[]} ids - Site ids on the page.
 * @param {number | undefined} [totalRows] - The reported total.
 * @returns {FakeReply} The reply.
 */
function sitesPage(ids: string[], totalRows?: number): FakeReply {
  return ok({ totalRows, currentPage: 1, currentSize: ids.length, data: ids.map((siteId) => ({ siteId, name: `Site ${siteId}` })) });
}

/**
 * Generated site ids site-<from> … site-<from + count - 1>.
 * @param {number} from - The first number.
 * @param {number} count - How many.
 * @returns {string[]} The ids.
 */
function siteIds(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `site-${from + index}`);
}

/**
 * The path of one page of the site listing.
 * @param {number} page - The page number.
 * @param {number} [pageSize] - The page size asked for.
 * @returns {string} The path with its query.
 */
function sitesPagePath(page: number, pageSize = 100): string {
  return `${SITES}?page=${page}&pageSize=${pageSize}`;
}

// The controller's "access token expired" answer (unverified code, see TOKEN_REJECTED_ERROR_CODES)
const EXPIRED: FakeReply = { body: { errorCode: -44112, msg: 'The access token has expired. Please re-apply for a new access token.' } };

/**
 * Creates a client over a fresh fake transport.
 * @param {{ now?: () => number }} [options] - Clock override.
 * @returns {{ client: OpenApiClient; transport: FakeTransport }} The pair.
 */
function setup(options: { now?: () => number } = {}): { client: OpenApiClient; transport: FakeTransport } {
  const transport = new FakeTransport(BASE_URL);
  const client = new OpenApiClient({
    baseUrl: `${BASE_URL}/`,
    omadacId: OMADAC_ID,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    transport,
    now: options.now
  });
  return { client, transport };
} // End of function setup()

/**
 * Returns the Authorization header values of the recorded requests to a path prefix.
 * @param {FakeTransport} transport - The transport.
 * @param {string} prefix - Path prefix.
 * @returns {(string | undefined)[]} The header values, in order.
 */
function authorizationsTo(transport: FakeTransport, prefix: string): (string | undefined)[] {
  return transport.requests.filter((request) => request.path.startsWith(prefix)).map((request) => request.headers.Authorization);
}

/**
 * Counts the token requests recorded so far.
 * @param {FakeTransport} transport - The transport.
 * @returns {number} The count.
 */
function tokenRequests(transport: FakeTransport): number {
  return transport.requestsTo('POST', TOKEN_PATH).length;
}

/**
 * Awaits a promise expected to reject with an OpenApiError and returns it.
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

/**
 * A promise with its resolver exposed (to hold a fake reply).
 * @returns {{ promise: Promise<T>; resolve: (value: T) => void }} The pair.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * Lets every pending promise callback and I/O callback run.
 * @returns {Promise<void>}
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('OpenApiClient: token acquisition and the AccessToken header', () => {
  test('the first call acquires a token (client credentials, JSON body, no Authorization) and sends Authorization: AccessToken=<token>', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, { body: tokenFixtures.success }).on('GET', SITES_PAGE_1, sitesPage(['site-a']));
    const sites = await client.listSites();
    assert.deepEqual(sites, { items: [{ id: 'site-a', name: 'Site site-a' }], truncated: false });
    assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, `GET ${SITES_PAGE_1}`]);
    const [tokenRequest, call] = transport.requests;
    assert.equal(tokenRequest.url, `${BASE_URL}/openapi/authorize/token?grant_type=client_credentials`);
    assert.deepEqual(tokenRequest.body, { omadacId: OMADAC_ID, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    assert.equal(tokenRequest.headers['Content-Type'], 'application/json');
    assert.equal(tokenRequest.headers.Authorization, undefined);
    assert.equal(call.headers.Authorization, 'AccessToken=AT-fixture-0001');
    assert.equal(call.headers['Content-Type'], undefined);
    assert.equal(call.body, undefined);
  }); // End of test "the first call acquires a token (client credentials, JSON..."

  test('a valid token is reused: later calls send no token request', async () => {
    const { client, transport } = setup();
    transport
      .on('POST', TOKEN_PATH, [tokenReply('AT-1')])
      .on('GET', SITES_PAGE_1, sitesPage(['site-a']))
      .on('GET', SITES, ok({ data: [] }));
    await client.listSites();
    await client.listSites();
    await client.request('GET', 'v1', ['sites']);
    assert.equal(tokenRequests(transport), 1);
    assert.deepEqual(authorizationsTo(transport, SITES), ['AccessToken=AT-1', 'AccessToken=AT-1', 'AccessToken=AT-1']);
  }); // End of test "a valid token is reused: later calls send no token request"

  test('proactive renewal: the token is used until its expiry minus the margin, then re-acquired before the call', async () => {
    let now = 0;
    const { client, transport } = setup({ now: () => now });
    transport.on('POST', TOKEN_PATH, [tokenReply('AT-1', 7200), tokenReply('AT-2', 7200)]).on('GET', SITES_PAGE_1, sitesPage(['site-a']));
    await client.listSites();
    now = 7200 * 1000 - 60 * 1000 - 1; // 1 ms before the renewal time
    await client.listSites();
    assert.equal(tokenRequests(transport), 1);
    now += 1; // the renewal time
    await client.listSites();
    assert.equal(tokenRequests(transport), 2);
    assert.deepEqual(authorizationsTo(transport, SITES), ['AccessToken=AT-1', 'AccessToken=AT-1', 'AccessToken=AT-2']);
    assert.deepEqual(transport.log().slice(-2), [`POST ${TOKEN_PATH}`, `GET ${SITES_PAGE_1}`]);
  }); // End of test "proactive renewal: the token is used until its expiry min..."
}); // End of the describe block for token acquisition

describe('OpenApiClient: a rejected token is re-acquired once, shared, never in a loop', () => {
  for (const [name, rejection] of [
    ['errorCode -44112 (expired)', EXPIRED],
    ['errorCode -44113 (invalid)', { body: { errorCode: -44113, msg: 'The access token is invalid.' } }],
    ['HTTP 401', { status: 401, body: 'Unauthorized' }]
  ] as Array<[string, FakeReply]>) {
    test(`${name}: exactly one re-acquire and one retry`, async () => {
      const { client, transport } = setup();
      transport.on('POST', TOKEN_PATH, [tokenReply('AT-1'), tokenReply('AT-2')]).on('GET', SITES_PAGE_1, [rejection, sitesPage(['site-a'])]);
      const sites = await client.listSites();
      assert.equal(sites.items.length, 1);
      assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, `GET ${SITES_PAGE_1}`, `POST ${TOKEN_PATH}`, `GET ${SITES_PAGE_1}`]);
      assert.deepEqual(authorizationsTo(transport, SITES), ['AccessToken=AT-1', 'AccessToken=AT-2']);
    });
  } // End of the loop over the rejection kinds

  test('a second rejection surfaces as tokenRejected after exactly one re-acquire (no loop); the next call starts afresh', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, [tokenReply('AT-1'), tokenReply('AT-2'), tokenReply('AT-3')]).on('GET', SITES_PAGE_1, EXPIRED);
    const error = await expectOpenApiError(client.listSites(), 'tokenRejected');
    assert.equal(error.controllerErrorCode, null);
    assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, `GET ${SITES_PAGE_1}`, `POST ${TOKEN_PATH}`, `GET ${SITES_PAGE_1}`]);
    // A later call gets its own single re-acquire, nothing more
    await expectOpenApiError(client.listSites(), 'tokenRejected');
    assert.equal(transport.requests.length, 7);
    assert.equal(tokenRequests(transport), 3);
  });

  test('a failing re-acquire surfaces its own error (invalidCredentials) and the call is not retried', async () => {
    const { client, transport } = setup();
    transport
      .on('POST', TOKEN_PATH, [tokenReply('AT-1'), { body: { errorCode: -44106, msg: 'The client id or client secret is invalid.' } }])
      .on('GET', SITES_PAGE_1, [EXPIRED]);
    const error = await expectOpenApiError(client.listSites(), 'invalidCredentials');
    assert.equal(error.controllerErrorCode, -44106);
    assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, `GET ${SITES_PAGE_1}`, `POST ${TOKEN_PATH}`]);
  });

  test('concurrent first calls share ONE token acquisition', async () => {
    const { client, transport } = setup();
    const held = deferred<FakeReply>();
    transport.on('POST', TOKEN_PATH, () => held.promise).on('GET', SITES_PAGE_1, sitesPage(['site-a']));
    const calls = [client.listSites(), client.listSites(), client.listSites()];
    await flush();
    assert.equal(tokenRequests(transport), 1);
    held.resolve(tokenReply('AT-1'));
    const results = await Promise.all(calls);
    assert.ok(results.every((result) => result.items.length === 1));
    assert.equal(tokenRequests(transport), 1);
    assert.deepEqual(authorizationsTo(transport, SITES), ['AccessToken=AT-1', 'AccessToken=AT-1', 'AccessToken=AT-1']);
  }); // End of test "concurrent first calls share ONE token acquisition"

  test('concurrent calls whose token expires share ONE re-acquisition, and each retries once', async () => {
    const { client, transport } = setup();
    const heldRenewal = deferred<FakeReply>();
    let tokenCalls = 0;
    transport
      .on('POST', TOKEN_PATH, () => (++tokenCalls === 1 ? tokenReply('AT-1') : heldRenewal.promise))
      .on('GET', SITES_PAGE_1, (request: RecordedRequest) => (request.headers.Authorization === 'AccessToken=AT-1' ? EXPIRED : sitesPage(['site-a'])));
    // Three calls share the first acquisition (AT-1), are all rejected, and
    // all wait on the SAME held renewal
    const calls = [client.listSites(), client.listSites(), client.listSites()];
    await flush();
    assert.equal(tokenCalls, 2);
    heldRenewal.resolve(tokenReply('AT-2'));
    const results = await Promise.all(calls);
    assert.ok(results.every((result) => result.items.length === 1));
    assert.equal(tokenCalls, 2);
    // AT-1 was rejected once per call; every call retried once, with AT-2
    const authorizations = authorizationsTo(transport, SITES);
    assert.deepEqual(authorizations.filter((value) => value === 'AccessToken=AT-1').length, 3);
    assert.deepEqual(authorizations.filter((value) => value === 'AccessToken=AT-2').length, 3);
    assert.equal(authorizations.length, 6);
  }); // End of test "concurrent calls whose token expires share ONE re-acquisition"
}); // End of the describe block for the rejected-token lifecycle

describe('OpenApiClient: pagination', () => {
  test('walks the pages, dedupes by id and stops at totalRows', async () => {
    const { client, transport } = setup();
    const [first, second] = siteFixtures.pages;
    transport
      .on('POST', TOKEN_PATH, tokenReply('AT-1'))
      .on('GET', `${SITES}?page=1&pageSize=2`, ok(first))
      .on('GET', `${SITES}?page=2&pageSize=2`, ok(second));
    const list = await client.listAll('v1', ['sites'], validateOpenApiSite, (site) => site.id, { pageSize: 2 });
    assert.deepEqual(list, {
      items: [
        { id: 'site-a', name: 'Colegio' },
        { id: 'site-b', name: 'Oficina' },
        { id: 'site-c', name: 'site-c' }
      ],
      truncated: false
    });
    assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, `GET ${SITES}?page=1&pageSize=2`, `GET ${SITES}?page=2&pageSize=2`]);
  }); // End of test "walks the pages, dedupes by id and stops at totalRows"

  test('a short page ends the walk without totalRows; extra query parameters follow page and pageSize', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', `${SITES}?page=1&pageSize=3&searchKey=Cole+gio`, sitesPage(['site-a']));
    const list = await client.listAll('v1', ['sites'], validateOpenApiSite, (site) => site.id, {
      pageSize: 3,
      query: { searchKey: 'Cole gio', page: 9 }
    });
    assert.equal(list.items.length, 1);
    assert.equal(transport.requests.length, 2);
  });

  test(`the defensive page cap (${MAX_PAGES} pages by default, or the given one) stops an endless listing and reports truncated`, async () => {
    const { client, transport } = setup();
    let page = 0;
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1'));
    for (let index = 1; index <= MAX_PAGES + 1; index++) {
      transport.on('GET', `${SITES}?page=${index}&pageSize=1`, () => sitesPage([`site-${++page}`]));
    }
    const capped = await client.listAll('v1', ['sites'], validateOpenApiSite, (site) => site.id, { pageSize: 1 });
    assert.equal(capped.truncated, true);
    assert.equal(capped.items.length, MAX_PAGES);
    assert.equal(transport.requests.length, 1 + MAX_PAGES);
    const small = await client.listAll('v1', ['sites'], validateOpenApiSite, (site) => site.id, { pageSize: 1, maxPages: 3 });
    assert.equal(small.truncated, true);
    assert.equal(small.items.length, 3);
  }); // End of test "the defensive page cap (${MAX_PAGES} pages by default, or..."

  test('a sane totalRows wins over a short page: the walk goes on until the raw entries fetched reach it', async () => {
    const { client, transport } = setup();
    transport
      .on('POST', TOKEN_PATH, tokenReply('AT-1'))
      .on('GET', sitesPagePath(1), sitesPage(siteIds(0, 100), 150))
      .on('GET', sitesPagePath(2), sitesPage(siteIds(100, 30), 150))
      .on('GET', sitesPagePath(3), sitesPage(siteIds(130, 20), 150));
    const list = await client.listSites();
    assert.equal(list.truncated, false);
    assert.deepEqual(list.items.map((site) => site.id), siteIds(0, 150), 'the rows after the short page 2 are read too');
    assert.deepEqual(transport.log().slice(1), [1, 2, 3].map((page) => `GET ${sitesPagePath(page)}`));
  }); // End of test "a sane totalRows wins over a short page..."

  test('a controller that caps the page size (asked 100, serves 40) is read completely; the page cap still bounds such a walk', async () => {
    const { client, transport } = setup();
    transport
      .on('POST', TOKEN_PATH, tokenReply('AT-1'))
      .on('GET', sitesPagePath(1), sitesPage(siteIds(0, 40), 100))
      .on('GET', sitesPagePath(2), sitesPage(siteIds(40, 40), 100))
      .on('GET', sitesPagePath(3), sitesPage(siteIds(80, 20), 100));
    const list = await client.listSites();
    assert.deepEqual(list, { items: siteIds(0, 100).map((id) => ({ id, name: `Site ${id}` })), truncated: false });
    assert.equal(transport.requests.length, 1 + 3);

    const capped = setup();
    let next = 0;
    capped.transport.on('POST', TOKEN_PATH, tokenReply('AT-1'));
    for (let page = 1; page <= 4; page++) {
      capped.transport.on('GET', sitesPagePath(page), () => sitesPage(siteIds((next += 10), 10), 999999));
    }
    const short = await capped.client.listAll('v1', ['sites'], validateOpenApiSite, (site) => site.id, { maxPages: 3 });
    assert.equal(short.truncated, true, 'unfinished at the page cap');
    assert.equal(capped.transport.requests.length, 1 + 3, 'never more than the page cap');
  }); // End of test "a controller that caps the page size..."

  test('an empty page before totalRows is reached is explicitly incomplete (truncated), and nothing more is requested; totalRows 0 with an empty page is complete', async () => {
    const cases: Array<[string, FakeReply, FakeReply, number]> = [
      ['full page, then an empty one', sitesPage(siteIds(0, 100), 150), sitesPage([], 150), 100],
      ['short page, then an empty one', sitesPage(siteIds(0, 4), 10), sitesPage([], 10), 4]
    ];
    for (const [label, first, second, kept] of cases) {
      const { client, transport } = setup();
      transport
        .on('POST', TOKEN_PATH, tokenReply('AT-1'))
        .on('GET', sitesPagePath(1), first)
        .on('GET', sitesPagePath(2), second)
        .on('GET', sitesPagePath(3), sitesPage(siteIds(500, 10), 150));
      const list = await client.listSites();
      assert.equal(list.truncated, true, label);
      assert.equal(list.items.length, kept, label);
      assert.equal(transport.requests.length, 1 + 2, `${label}: the walk stopped at the empty page`);
    } // End of the loop over the empty-page cases
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', sitesPagePath(1), sitesPage([], 0));
    assert.deepEqual(await client.listSites(), { items: [], truncated: false });
  }); // End of test "an empty page before totalRows is reached..."

  test('a totalRows that changes between pages (another value, dropped, or appearing on a later page) is explicitly incomplete at once', async () => {
    const cases: Array<[number | undefined, number | undefined]> = [
      [150, 160],
      [150, 149],
      [150, undefined],
      [undefined, 150]
    ];
    for (const [first, second] of cases) {
      const { client, transport } = setup();
      transport
        .on('POST', TOKEN_PATH, tokenReply('AT-1'))
        .on('GET', sitesPagePath(1), sitesPage(siteIds(0, 100), first))
        .on('GET', sitesPagePath(2), sitesPage(siteIds(100, 50), second))
        .on('GET', sitesPagePath(3), sitesPage(siteIds(150, 10), second));
      const list = await client.listSites();
      const label = `totalRows ${first} then ${second}`;
      assert.equal(list.truncated, true, label);
      assert.equal(transport.requests.length, 1 + 2, `${label}: no page after the contradiction`);
    } // End of the loop over the changing totals
  }); // End of test "a totalRows that changes between pages..."

  test('a page that only repeats earlier entries makes no progress: truncated at once, with or without totalRows (a controller ignoring `page`)', async () => {
    const cases: Array<[string, FakeReply]> = [
      ['totalRows 150, the same 50 rows on every page', sitesPage(siteIds(0, 50), 150)],
      ['no totalRows, the same full page on every page', sitesPage(siteIds(0, 100))]
    ];
    for (const [label, reply] of cases) {
      const { client, transport } = setup();
      transport.on('POST', TOKEN_PATH, tokenReply('AT-1'));
      for (let page = 1; page <= MAX_PAGES; page++) {
        transport.on('GET', sitesPagePath(page), reply);
      }
      const list = await client.listSites();
      assert.equal(list.truncated, true, label);
      assert.equal(transport.requests.length, 1 + 2, `${label}: stopped at the first page without a new entry`);
    } // End of the loop over the repeating-page cases
  }); // End of test "a page that only repeats earlier entries..."

  test('the page size is checked (1–1000)', async () => {
    const { client } = setup();
    for (const pageSize of [0, 1001, 2.5]) {
      await assert.rejects(client.listAll('v1', ['sites'], validateOpenApiSite, (site) => site.id, { pageSize }), /page size/);
    }
  });

  test('listApGroups(): v1 path with the site id, normalized groups with apNum, ssidNameList and remainingBinding', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', `${SITES}/site-a/ap-groups?page=1&pageSize=100`, ok(apGroupFixtures.page));
    const groups = await client.listApGroups('site-a');
    assert.deepEqual(groups.items, [
      apGroupFixtures.valid[0].expected,
      apGroupFixtures.valid[1].expected,
      { id: '6501c0ffee0000000000b006', name: 'zGrupo B', apNum: 2, ssidNameList: ['Taller'] }
    ]);
    await assert.rejects(client.listApGroups(''), /Invalid site id/);
  });
}); // End of the describe block for pagination

describe('OpenApiClient: explicit paths and methods', () => {
  test('openApiPath() requires v1 or v2 and encodes every segment', () => {
    assert.equal(openApiPath('v1', OMADAC_ID, ['sites']), `/openapi/v1/${OMADAC_ID}/sites`);
    assert.equal(
      openApiPath('v2', OMADAC_ID, ['sites', 'site a/b?c', 'wireless-network', 'ssids']),
      `/openapi/v2/${OMADAC_ID}/sites/site%20a%2Fb%3Fc/wireless-network/ssids`
    );
    assert.throws(() => openApiPath('v3' as unknown as 'v1', OMADAC_ID, ['sites']), /v1 or v2/);
    for (const segment of ['', '.', '..']) {
      assert.throws(() => openApiPath('v1', OMADAC_ID, ['sites', segment]), /segment/);
    }
  });

  test('request() builds the versioned URL; v1 and v2 calls reach their own paths', async () => {
    const { client, transport } = setup();
    transport
      .on('POST', TOKEN_PATH, tokenReply('AT-1'))
      .on('GET', `/openapi/v2/${OMADAC_ID}/sites/s1/wireless-network/ssids?page=1&pageSize=10`, ok({ data: [] }))
      .on('GET', `/openapi/v1/${OMADAC_ID}/sites/s1/wireless-network/ssids/x1`, ok({ ssidId: 'x1' }));
    assert.deepEqual(await client.request('GET', 'v2', ['sites', 's1', 'wireless-network', 'ssids'], { query: { page: 1, pageSize: 10 } }), { data: [] });
    assert.deepEqual(await client.request('GET', 'v1', ['sites', 's1', 'wireless-network', 'ssids', 'x1']), { ssidId: 'x1' });
  });

  test('PUT, PATCH, POST and DELETE pass through with their JSON body (and none for DELETE); extra headers are sent', async () => {
    const { client, transport } = setup();
    const groupPath = `/openapi/v1/${OMADAC_ID}/sites/s1/ap-groups/g1`;
    transport
      .on('POST', TOKEN_PATH, tokenReply('AT-1'))
      .on('PUT', groupPath, ok(null))
      .on('PATCH', groupPath, ok(null))
      .on('POST', `/openapi/v1/${OMADAC_ID}/sites/s1/ap-groups`, ok({ id: 'g2' }))
      .on('DELETE', groupPath, ok(undefined));
    await client.request('PUT', 'v1', ['sites', 's1', 'ap-groups', 'g1'], { body: { name: 'Aulas' }, headers: { 'X-Trace': 'abc' } });
    await client.request('PATCH', 'v1', ['sites', 's1', 'ap-groups', 'g1'], { body: { name: 'Aulas 2', addApMacs: [] } });
    assert.deepEqual(await client.request('POST', 'v1', ['sites', 's1', 'ap-groups'], { body: { name: 'New', apMacs: [] } }), { id: 'g2' });
    await client.request('DELETE', 'v1', ['sites', 's1', 'ap-groups', 'g1']);
    const [, put, patch, post, del] = transport.requests;
    assert.equal(put.method, 'PUT');
    assert.deepEqual(put.body, { name: 'Aulas' });
    assert.equal(put.headers['Content-Type'], 'application/json');
    assert.equal(put.headers['X-Trace'], 'abc');
    assert.equal(put.headers.Authorization, 'AccessToken=AT-1');
    assert.equal(patch.method, 'PATCH');
    assert.deepEqual(patch.body, { name: 'Aulas 2', addApMacs: [] });
    assert.equal(post.method, 'POST');
    assert.equal(del.method, 'DELETE');
    assert.equal(del.body, undefined);
    assert.equal(del.headers['Content-Type'], undefined);
    assert.equal(del.headers.Authorization, 'AccessToken=AT-1');
  }); // End of test "PUT, PATCH, POST and DELETE pass through..."

  test('reserved or malformed extra headers are refused before anything is sent', async () => {
    const { client, transport } = setup();
    const refused: Array<Record<string, string>> = [{ Authorization: 'AccessToken=forged' }, { cookie: 'a=b' }, { 'Bad Header': 'x' }, { 'X-Ok': 'line\r\nX-Evil: 1' }];
    for (const headers of refused) {
      await assert.rejects(client.request('GET', 'v1', ['sites'], { headers }), /header/i);
    }
    assert.equal(transport.requests.length, 0);
  });
}); // End of the describe block for paths and methods

describe('Open API validators (fixtures)', () => {
  test('validateTokenResult(): valid token results', () => {
    for (const fixture of tokenFixtures.valid) {
      assert.deepEqual(validateTokenResult(fixture.result, fixture.nowMs), fixture.expected, fixture.name);
    }
  });

  test('validateTokenResult(): malformed token results are rejected as malformedResponse', () => {
    for (const fixture of tokenFixtures.invalid) {
      assert.throws(() => validateTokenResult((fixture as { result?: unknown }).result, 0), (error: unknown) =>
        error instanceof OpenApiError && error.code === 'malformedResponse' && error.diagnostic === 'Unsupported Open API response (token)', fixture.name);
    }
  });

  test('validateOpenApiSite(): valid and malformed entries', () => {
    for (const fixture of siteFixtures.valid) {
      assert.deepEqual(validateOpenApiSite(fixture.entry), fixture.expected, fixture.name);
    }
    for (const fixture of siteFixtures.invalid) {
      assert.throws(() => validateOpenApiSite(fixture.entry), (error: unknown) =>
        error instanceof OpenApiError && error.code === 'malformedResponse' && error.diagnostic === 'Unsupported Open API response (sites)', fixture.name);
    }
  });

  test('validateOpenApiApGroup(): valid and malformed entries', () => {
    for (const fixture of apGroupFixtures.valid) {
      assert.deepEqual(validateOpenApiApGroup(fixture.entry), fixture.expected, fixture.name);
    }
    for (const fixture of apGroupFixtures.invalid) {
      assert.throws(() => validateOpenApiApGroup(fixture.entry), (error: unknown) =>
        error instanceof OpenApiError && error.code === 'malformedResponse' && error.diagnostic === 'Unsupported Open API response (ap-groups)', fixture.name);
    }
  });

  test('validateOpenApiPage(): a page needs a data array; totalRows is kept only as a sane count', () => {
    for (const fixture of siteFixtures.invalidPages) {
      assert.throws(() => validateOpenApiPage((fixture as { result?: unknown }).result, 'sites'), OpenApiError, fixture.name);
    }
    assert.deepEqual(validateOpenApiPage({ data: [], totalRows: -1 }, 'sites'), { data: [], totalRows: null });
    for (const insane of [2.5, '5', Number.POSITIVE_INFINITY, Number.NaN, 2 ** 53, null, true]) {
      assert.equal(validateOpenApiPage({ data: [], totalRows: insane }, 'sites').totalRows, null, String(insane));
    }
    assert.equal(validateOpenApiPage({ data: [], totalRows: 0 }, 'sites').totalRows, 0);
  });

  test('malformed payloads reached through the client fail the call with malformedResponse', async () => {
    const malformedToken = setup();
    malformedToken.transport.on('POST', TOKEN_PATH, ok({ tokenType: 'bearer' }));
    await expectOpenApiError(malformedToken.client.listSites(), 'malformedResponse');
    assert.equal(malformedToken.transport.requests.length, 1);

    const malformedSite = setup();
    malformedSite.transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', SITES_PAGE_1, ok({ data: [{ siteId: 'a' }, { name: 'no id' }] }));
    await expectOpenApiError(malformedSite.client.listSites(), 'malformedResponse');

    const malformedGroups = setup();
    malformedGroups.transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', `${SITES}/s1/ap-groups?page=1&pageSize=100`, ok({ data: 'none' }));
    await expectOpenApiError(malformedGroups.client.listApGroups('s1'), 'malformedResponse');
  }); // End of test "malformed payloads reached through the client fail the ca..."
}); // End of the describe block for the validators

describe('OpenApiClient: stable error codes', () => {
  test('token endpoint: HTTP 401/403 and errorCode -44106 are invalidCredentials; other errorCodes apiError; HTTP 500 httpError', async () => {
    const cases: Array<[FakeReply, OpenApiErrorCode, number | null, number | null]> = [
      [{ status: 401, body: '' }, 'invalidCredentials', 401, null],
      [{ status: 403, body: '<html>Forbidden</html>' }, 'invalidCredentials', 403, null],
      [{ body: { errorCode: -44106, msg: 'The client id or client secret is invalid.' } }, 'invalidCredentials', null, -44106],
      [{ body: { errorCode: -1, msg: 'General error.' } }, 'apiError', null, -1],
      [{ status: 500, body: '<html>boom</html>' }, 'httpError', 500, null]
    ];
    for (const [reply, code, httpStatus, controllerErrorCode] of cases) {
      const { client, transport } = setup();
      transport.on('POST', TOKEN_PATH, reply);
      const error = await expectOpenApiError(client.listSites(), code);
      assert.equal(error.httpStatus, httpStatus);
      assert.equal(error.controllerErrorCode, controllerErrorCode);
      assert.equal(transport.requests.length, 1);
    }
  }); // End of test "token endpoint: ..."

  test('calls: apiError with the controller errorCode and message; httpError with the status (never the raw body); malformed bodies', async () => {
    const { client, transport } = setup();
    transport
      .on('POST', TOKEN_PATH, tokenReply('AT-1'))
      .on('GET', SITES_PAGE_1, [
        { body: { errorCode: -33000, msg: 'This site does not exist.' } },
        { status: 500, body: '<html><body>Internal error at /openapi with stack trace</body></html>' },
        { status: 502, body: { errorCode: -1001, msg: 'Upstream failed.' } },
        { body: '<!DOCTYPE html><title>Login</title>' },
        { body: { msg: 'no errorCode' } }
      ]);
    const api = await expectOpenApiError(client.listSites(), 'apiError');
    assert.equal(api.controllerErrorCode, -33000);
    assert.match(api.diagnostic, /errorCode -33000 \(This site does not exist\.\)/);
    const http = await expectOpenApiError(client.listSites(), 'httpError');
    assert.equal(http.httpStatus, 500);
    assert.equal(http.diagnostic, 'HTTP 500');
    const httpJson = await expectOpenApiError(client.listSites(), 'httpError');
    assert.equal(httpJson.controllerErrorCode, -1001);
    assert.match(httpJson.diagnostic, /^HTTP 502: errorCode -1001 \(Upstream failed\.\)$/);
    const html = await expectOpenApiError(client.listSites(), 'malformedResponse');
    assert.ok(!html.message.includes('DOCTYPE'));
    await expectOpenApiError(client.listSites(), 'malformedResponse');
  }); // End of test "calls: apiError ..."

  test('transport failures: timeout and networkError', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1'));
    let call = 0;
    transport.on('GET', SITES_PAGE_1, () => {
      call++;
      throw new Error(call === 1 ? 'Request timeout (15s)' : 'net::ERR_CONNECTION_REFUSED');
    });
    const timeout = await expectOpenApiError(client.listSites(), 'timeout');
    assert.equal(timeout.diagnostic, 'Request timeout (15s)');
    const network = await expectOpenApiError(client.listSites(), 'networkError');
    assert.equal(network.diagnostic, 'net::ERR_CONNECTION_REFUSED');
  }); // End of test "transport failures: timeout and networkError"

  test('close(): later calls fail with clientClosed without sending; a call in flight fails the same way', async () => {
    const { client, transport } = setup();
    const held = deferred<FakeReply>();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', SITES_PAGE_1, () => held.promise);
    const inFlight = client.listSites();
    await flush();
    client.close();
    held.resolve(sitesPage(['site-a']));
    await expectOpenApiError(inFlight, 'clientClosed');
    const sent = transport.requests.length;
    await expectOpenApiError(client.listSites(), 'clientClosed');
    assert.equal(transport.requests.length, sent);
    assert.equal(client.isClosed, true);
  }); // End of test "close(): later calls fail with clientClosed without sendi..."
}); // End of the describe block for the error codes

describe('OpenApiClient: no secret or token in errors, diagnostics or the client object', () => {
  // Tokens the fake controller hands out in this block
  const TOKENS = ['AT-Leaky-Token-1', 'AT-Leaky-Token-2'];

  /**
   * Asserts that nothing derived from an error carries the secret or a token.
   * @param {OpenApiError} error - The error.
   */
  function assertClean(error: OpenApiError): void {
    const views = [error.message, error.diagnostic, String(error), error.stack ?? '', JSON.stringify(error), inspect(error, { showHidden: true, depth: 10 })];
    for (const view of views) {
      for (const secret of [CLIENT_SECRET, ...TOKENS, `RT-${TOKENS[0]}`]) {
        assert.ok(!view.includes(secret), `${error.code} leaks ${secret}: ${view}`);
      }
    }
  } // End of function assertClean()

  test('controller messages, HTTP error bodies and transport errors that echo the secret or the token are scrubbed', async () => {
    const errors: OpenApiError[] = [];

    // Token endpoint errors echoing the secret
    for (const reply of [
      { body: { errorCode: -44106, msg: `client_secret=${CLIENT_SECRET} is invalid` } },
      { body: { errorCode: -1, msg: `Bad request {"client_secret":"${CLIENT_SECRET}"} rejected ${CLIENT_SECRET}` } },
      { status: 500, body: { errorCode: -1, msg: `failed for ${CLIENT_SECRET}` } }
    ] as FakeReply[]) {
      const { client, transport } = setup();
      transport.on('POST', TOKEN_PATH, reply);
      errors.push(await client.listSites().then(() => assert.fail('expected a failure'), (error: OpenApiError) => error));
    }

    // Call errors echoing the token (current and previous ones)
    const { client, transport } = setup();
    let tokenCalls = 0;
    transport.on('POST', TOKEN_PATH, () => tokenReply(TOKENS[tokenCalls++] ?? 'AT-other'));
    let call = 0;
    transport.on('GET', SITES_PAGE_1, () => {
      call++;
      if (call === 1) {
        return { body: { errorCode: -1, msg: `Authorization: AccessToken=${TOKENS[0]} refused` } };
      }
      if (call === 2) {
        return { body: { errorCode: -2, msg: `token ${TOKENS[0]} unknown` } };
      }
      if (call === 3) {
        return EXPIRED;
      }
      if (call === 4) {
        return { status: 503, body: { errorCode: -3, msg: `Bearer ${TOKENS[1]} and ${TOKENS[0]}` } };
      }
      throw new Error(`socket closed while sending AccessToken=${TOKENS[1]} with secret ${CLIENT_SECRET}`);
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      errors.push(await client.listSites().then(() => assert.fail('expected a failure'), (error: OpenApiError) => error));
    }
    assert.equal(errors.length, 7);
    assert.ok(errors.every((error) => error instanceof OpenApiError));
    for (const error of errors) {
      assertClean(error);
    }
  }); // End of test "controller messages ... are scrubbed"

  test('the client object never shows the secret or the token (JSON, inspect, own keys)', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply(TOKENS[0])).on('GET', SITES_PAGE_1, sitesPage(['site-a']));
    await client.listSites();
    const views = [JSON.stringify(client), inspect(client, { showHidden: true, depth: 10 }), Object.keys(client).join(','), Object.getOwnPropertyNames(client).join(',')];
    for (const view of views) {
      assert.ok(!view.includes(CLIENT_SECRET), view);
      assert.ok(!view.includes(TOKENS[0]), view);
    }
  });

  test('constructor errors never include the credentials', () => {
    const transport = new FakeTransport(BASE_URL);
    const base = { baseUrl: BASE_URL, omadacId: OMADAC_ID, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, transport };
    for (const options of [{ ...base, baseUrl: '' }, { ...base, omadacId: '' }, { ...base, clientId: '' }, { ...base, clientSecret: '' }]) {
      assert.throws(() => new OpenApiClient(options), (error: unknown) => error instanceof Error && !error.message.includes(CLIENT_SECRET));
    }
  });
}); // End of the describe block for secrets

describe('OpenApiClient.authorize() (spec §2.2 check 3)', () => {
  test('acquires a token once and sends nothing more while it is valid; a closed client refuses without sending', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, [tokenReply('AT-authorize-1')]);
    await client.authorize();
    await client.authorize();
    assert.equal(tokenRequests(transport), 1);
    client.close();
    await expectOpenApiError(client.authorize(), 'clientClosed');
    assert.equal(transport.requests.length, 1);
  });

  test('a refused token request surfaces invalidCredentials, without the secret in the error', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, { body: { errorCode: -44106, msg: `bad secret ${CLIENT_SECRET}` } });
    const error = await expectOpenApiError(client.authorize(), 'invalidCredentials');
    assert.equal(error.controllerErrorCode, -44106);
    assert.equal(`${error.message} ${error.diagnostic}`.includes(CLIENT_SECRET), false);
  });
}); // End of describe 'OpenApiClient.authorize()'

describe('OpenApiClient.close() drops every token reference and ends operations in flight as clientClosed', () => {
  test('after close() no token is reachable from the client — not through its private fields (current token, remembered tokens), a public view, or a later error', async () => {
    const { client, transport } = setup();
    let issued = 0;
    transport.on('POST', TOKEN_PATH, () => tokenReply(`AT-Close-Token-${++issued}`));
    // The first token is rejected once, so the client remembers two tokens
    transport.on('GET', SITES_PAGE_1, [EXPIRED, sitesPage(['site-a'])]);
    await client.listSites();
    assert.equal(issued, 2);
    const before = await reachableStrings(client);
    assert.ok(before.includes('AT-Close-Token-1') && before.includes('AT-Close-Token-2'), 'the walk sees the private token fields');
    client.close();
    const after = await reachableStrings(client);
    assert.deepEqual(after.filter((text) => text.includes('AT-Close-Token-')), [], 'no token reachable once closed');
    const error = await expectOpenApiError(client.listSites(), 'clientClosed');
    const views = [
      JSON.stringify(client),
      inspect(client, { showHidden: true, depth: 10 }),
      Object.getOwnPropertyNames(client).join(','),
      error.message,
      error.diagnostic,
      inspect(error, { showHidden: true, depth: 10 })
    ];
    for (const view of views) {
      assert.ok(!view.includes('AT-Close-Token-'), view);
    }
    // token 1, the rejected call, token 2, the retried call — nothing after close
    assert.equal(transport.requests.length, 4, 'nothing sent after close');
  }); // End of test "after close() no token is reachable from the client..."

  test('a request racing with close() ends as clientClosed whatever its transport call returns — no retry, no re-acquire, no further transport call, no token kept', async () => {
    /**
     * A transport failure whose text quotes a token and the secret.
     * @returns {never} Always throws.
     */
    const leakyFailure = (): never => {
      throw new Error(`socket closed while sending AccessToken=AT-Race-Token-1 with secret ${CLIENT_SECRET}`);
    };
    // [case, which request is in flight when close() runs, its late answer, requests sent in all]
    const cases: Array<[string, 'token' | 'call', () => FakeReply, number]> = [
      ['token reply after close', 'token', () => tokenReply('AT-Race-Token-1'), 1],
      ['token transport failure after close', 'token', leakyFailure, 1],
      ['HTTP 401 after close (no re-acquire)', 'call', () => ({ status: 401, body: '' }), 2],
      ['token-expired errorCode after close (no re-acquire)', 'call', () => EXPIRED, 2],
      ['call transport failure after close', 'call', leakyFailure, 2],
      ['call success after close (result not used)', 'call', () => sitesPage(['site-a']), 2]
    ];
    for (const [name, held, answer, sent] of cases) {
      const { client, transport } = setup();
      const release = deferred<void>();
      transport.on('POST', TOKEN_PATH, async () => {
        if (held === 'token') {
          await release.promise;
          return answer();
        }
        return tokenReply('AT-Race-Token-1');
      });
      transport.on('GET', SITES_PAGE_1, async () => {
        if (held === 'call') {
          await release.promise;
          return answer();
        }
        return sitesPage(['site-a']);
      });
      const inFlight = client.listSites();
      await flush();
      assert.equal(transport.requests.length, sent, `${name}: the held request was sent`);
      client.close();
      release.resolve();
      const error = await expectOpenApiError(inFlight, 'clientClosed');
      await flush();
      assert.equal(transport.requests.length, sent, `${name}: no further transport call`);
      assert.ok(!`${error.message} ${error.diagnostic}`.includes('AT-Race-Token-1') && !error.message.includes(CLIENT_SECRET), name);
      assert.deepEqual((await reachableStrings(client)).filter((text) => text.includes('AT-Race-Token-')), [], `${name}: no token kept`);
    } // End of the loop over the race cases
  }); // End of test "a request racing with close() ends as clientClosed..."
}); // End of describe 'OpenApiClient.close() drops every token reference...'

/**
 * Fills the placeholders of a fixture path with this file's ids.
 * @param {string} template - e.g. '/openapi/v1/{omadacId}/sites/{siteId}/ap-groups'.
 * @returns {string} The concrete path.
 */
function fixturePath(template: string): string {
  return template
    .replace('{omadacId}', OMADAC_ID)
    .replace('{siteId}', apGroupWriteFixtures.siteId)
    .replace('{apGroupId}', apGroupWriteFixtures.apGroupId);
}

/**
 * Asserts the contract of one recorded AP-group write: method, versioned
 * path (no query), the access-token header, and the exact JSON body (none
 * for DELETE, with no Content-Type then).
 * @param {RecordedRequest} request - The recorded request.
 * @param {{ method: string; path: string; body?: unknown }} expected - The fixture contract.
 */
function assertWriteContract(request: RecordedRequest, expected: { method: string; path: string; body?: unknown }): void {
  assert.equal(request.method, expected.method);
  assert.equal(request.path, fixturePath(expected.path));
  assert.ok(request.path.startsWith(`/openapi/v1/${OMADAC_ID}/`), 'explicit v1 path');
  assert.equal(request.headers.Authorization, 'AccessToken=AT-1');
  assert.equal(request.headers.Accept, 'application/json');
  if (expected.body === undefined) {
    assert.equal(request.body, undefined, 'no body');
    assert.equal(request.headers['Content-Type'], undefined);
  } else {
    assert.deepEqual(request.body, expected.body, 'exactly the documented body');
    assert.deepEqual(Object.keys(request.body as object), Object.keys(expected.body as object), 'no extra keys');
    assert.equal(request.headers['Content-Type'], 'application/json');
  }
} // End of function assertWriteContract()

describe('OpenApiClient: AP-group write contract (fixtures: tests/fixtures/openapi/ap-group-writes.json)', () => {
  const { siteId, apGroupId } = apGroupWriteFixtures;
  const create = apGroupWriteFixtures.create;
  const rename = apGroupWriteFixtures.rename;
  const remove = apGroupWriteFixtures.delete;

  test('createApGroup(): POST /openapi/v1/{omadacId}/sites/{siteId}/ap-groups with exactly {name} and the AccessToken header; returns result.id', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('POST', fixturePath(create.path), { body: create.success });
    assert.equal(await client.createApGroup(siteId, create.name), create.expectedId);
    assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, `POST ${fixturePath(create.path)}`]);
    assertWriteContract(transport.requests[1], create);
  });

  test('createApGroup(): an answer without a usable id resolves null (never a guessed id)', async () => {
    for (const answer of create.successWithoutUsableId) {
      const { client, transport } = setup();
      transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('POST', fixturePath(create.path), { body: answer });
      assert.equal(await client.createApGroup(siteId, create.name), null, JSON.stringify(answer));
    }
  });

  test('renameApGroup(): PATCH …/ap-groups/{apGroupId} with exactly {name} (no AP lists); errorCode 0 is the confirmation', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('PATCH', fixturePath(rename.path), { body: rename.success });
    assert.equal(await client.renameApGroup(siteId, apGroupId, rename.name), undefined);
    assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, `PATCH ${fixturePath(rename.path)}`]);
    assertWriteContract(transport.requests[1], rename);
  });

  test('deleteApGroup(): DELETE …/ap-groups/{apGroupId} with no body and no Content-Type', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('DELETE', fixturePath(remove.path), { body: remove.success });
    assert.equal(await client.deleteApGroup(siteId, apGroupId), undefined);
    assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, `DELETE ${fixturePath(remove.path)}`]);
    assertWriteContract(transport.requests[1], { method: remove.method, path: remove.path });
  });

  test('the documented errorCodes of each write surface as apiError carrying the code (message scrubbed, never the body); HTTP 500 is httpError', async () => {
    const calls: Array<[string, string, (client: OpenApiClient) => Promise<unknown>, Array<{ errorCode: number; msg: string }>]> = [
      ['POST', create.path, (client) => client.createApGroup(siteId, create.name), create.errors],
      ['PATCH', rename.path, (client) => client.renameApGroup(siteId, apGroupId, rename.name), rename.errors],
      ['DELETE', remove.path, (client) => client.deleteApGroup(siteId, apGroupId), remove.errors]
    ];
    for (const [method, path, call, errors] of calls) {
      for (const answer of errors) {
        const { client, transport } = setup();
        transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on(method, fixturePath(path), { body: answer });
        const error = await expectOpenApiError(call(client), 'apiError');
        assert.equal(error.controllerErrorCode, answer.errorCode);
        assert.equal(transport.requestsTo(method, fixturePath(path)).length, 1, 'no retry of a refused write');
      }
      const { client, transport } = setup();
      transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on(method, fixturePath(path), { status: 500, body: '<html>oops</html>' });
      const error = await expectOpenApiError(call(client), 'httpError');
      assert.equal(error.httpStatus, 500);
      assert.ok(!error.message.includes('oops'));
    } // End of the loop over the three writes
  }); // End of test "the documented errorCodes of each write..."

  test('a rejected token on a write re-acquires once and resends the write once; a second rejection is tokenRejected (no loop)', async () => {
    const { client, transport } = setup();
    let token = 0;
    transport
      .on('POST', TOKEN_PATH, () => tokenReply(`AT-${++token}`))
      .on('DELETE', fixturePath(remove.path), [EXPIRED, { body: remove.success }]);
    await client.deleteApGroup(siteId, apGroupId);
    assert.deepEqual(authorizationsTo(transport, `/openapi/v1/${OMADAC_ID}/sites`), ['AccessToken=AT-1', 'AccessToken=AT-2']);
    const again = setup();
    again.transport.on('POST', TOKEN_PATH, () => tokenReply(`AT-${++token}`)).on('POST', fixturePath(create.path), [EXPIRED, EXPIRED]);
    await expectOpenApiError(again.client.createApGroup(siteId, create.name), 'tokenRejected');
    assert.equal(again.transport.requestsTo('POST', fixturePath(create.path)).length, 2);
  }); // End of test "a rejected token on a write re-acquires once..."

  test('unusable arguments are refused before anything is sent (site / group ids, blank, untrimmed or over-long names)', async () => {
    const { client, transport } = setup();
    await assert.rejects(client.createApGroup('', create.name), /Invalid AP group create arguments/);
    for (const name of ['', '  ', ' padded', 'x'.repeat(129)]) {
      await assert.rejects(client.createApGroup(siteId, name), /Invalid AP group create arguments/);
      await assert.rejects(client.renameApGroup(siteId, apGroupId, name), /Invalid AP group rename arguments/);
    }
    await assert.rejects(client.renameApGroup(siteId, '', rename.name), /Invalid AP group rename arguments/);
    await assert.rejects(client.deleteApGroup(siteId, '..'.repeat(100)), /Invalid AP group delete arguments/);
    await assert.rejects(client.deleteApGroup('', apGroupId), /Invalid AP group delete arguments/);
    assert.deepEqual(transport.requests, []);
  }); // End of test "unusable arguments are refused before anything..."

  test('a write on a closed client fails as clientClosed without sending', async () => {
    const { client, transport } = setup();
    client.close();
    await expectOpenApiError(client.deleteApGroup(siteId, apGroupId), 'clientClosed');
    await expectOpenApiError(client.createApGroup(siteId, create.name), 'clientClosed');
    assert.deepEqual(transport.requests, []);
  });

  test('listApGroups() also reports the first page\'s SSID limits (maxSsids2G/5G/6G/Mlo), insane or absent ones left out', async () => {
    for (const fixture of [apGroupWriteFixtures.limits.valid, apGroupWriteFixtures.limits.insane, apGroupWriteFixtures.limits.absent]) {
      assert.deepEqual(validateApGroupLimits(fixture.result), fixture.expected);
    }
    assert.deepEqual(validateApGroupLimits(null), {});
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', `${SITES}/site-a/ap-groups?page=1&pageSize=100`, ok(apGroupFixtures.page));
    const list = await client.listApGroups('site-a');
    assert.deepEqual(list.limits, { band2g: 8, band5g: 8, band6g: 8, mlo: 4 });
    assert.equal(list.truncated, false);
  });

  test('validateCreatedApGroup(): result.id when usable, else null', () => {
    assert.equal(validateCreatedApGroup(create.success.result), create.expectedId);
    for (const answer of create.successWithoutUsableId) {
      assert.equal(validateCreatedApGroup((answer as { result?: unknown }).result), null);
    }
  });
}); // End of the describe block for the AP-group write contract

/**
 * Resolves an SSID contract path of tests/fixtures/openapi/ssids.json.
 * @param {string} template - The path with {omadacId} / {siteId} / {ssidId}.
 * @param {string} [ssidId] - The SSID id (default: the fixture's).
 * @returns {string} The path.
 */
function ssidPath(template: string, ssidId: string = ssidFixtures.ssidId): string {
  return template.replace('{omadacId}', OMADAC_ID).replace('{siteId}', ssidFixtures.siteId).replace('{ssidId}', ssidId);
}

/**
 * Asserts the contract of one recorded SSID read: GET, the exact versioned
 * path (+ query), the access-token header, JSON accepted, no body.
 * @param {RecordedRequest} request - The recorded request.
 * @param {string} path - The expected path including the query string.
 * @param {'v1' | 'v2'} version - The expected API version.
 */
function assertReadContract(request: RecordedRequest, path: string, version: 'v1' | 'v2'): void {
  assert.equal(request.method, 'GET');
  assert.equal(request.path, path);
  assert.ok(request.path.startsWith(`/openapi/${version}/${OMADAC_ID}/sites/${ssidFixtures.siteId}/wireless-network/ssids`), `explicit ${version} path`);
  assert.equal(request.headers.Authorization, 'AccessToken=AT-1');
  assert.equal(request.headers.Accept, 'application/json');
  assert.equal(request.body, undefined, 'no body');
  assert.equal(request.headers['Content-Type'], undefined);
}

/**
 * One catalog entry with a generated id (for multi-page listings).
 * @param {number} index - The entry's number.
 * @returns {Record<string, unknown>} The raw entry.
 */
function generatedSsid(index: number): Record<string, unknown> {
  return { id: `5f00c0ffee${String(index).padStart(14, '0')}`, name: `Red ${index}`, description: true, chooseDevices: 1, band: 3, security: 3 };
}

describe('OpenApiClient: Wi-Fi network read contract (fixtures: tests/fixtures/openapi/ssids.json)', () => {
  const { siteId, ssidId } = ssidFixtures;
  const catalogPath = ssidPath(ssidFixtures.catalog.path);
  const detailPath = ssidPath(ssidFixtures.detail.path);
  const bindingsPath = ssidPath(ssidFixtures.bindings.path);

  test('listSsids(): GET /openapi/v2/{omadacId}/sites/{siteId}/wireless-network/ssids?page=1&pageSize=100, entries validated by allowlist', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', `${catalogPath}?page=1&pageSize=100`, ok(ssidFixtures.catalog.page));
    const list = await client.listSsids(siteId);
    assert.equal(list.truncated, false);
    assert.deepEqual(JSON.parse(JSON.stringify(list.items)), ssidFixtures.catalog.expected);
    assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, `GET ${catalogPath}?page=1&pageSize=100`]);
    assertReadContract(transport.requests[1], `${catalogPath}?page=1&pageSize=100`, 'v2');
  });

  test('listSsids(): pagination walks page=1, page=2 … until a short page or totalRows, deduplicating by id; the page cap marks it truncated', async () => {
    const { client, transport } = setup();
    const first = Array.from({ length: 100 }, (_, index) => generatedSsid(index));
    const second = [...Array.from({ length: 30 }, (_, index) => generatedSsid(100 + index)), generatedSsid(0)];
    transport
      .on('POST', TOKEN_PATH, tokenReply('AT-1'))
      .on('GET', `${catalogPath}?page=1&pageSize=100`, ok({ totalRows: 131, data: first }))
      .on('GET', `${catalogPath}?page=2&pageSize=100`, ok({ totalRows: 131, data: second }));
    const list = await client.listSsids(siteId);
    assert.equal(list.items.length, 130, 'the repeated id is kept once');
    assert.equal(list.truncated, false);
    assert.deepEqual(transport.log().slice(1), [`GET ${catalogPath}?page=1&pageSize=100`, `GET ${catalogPath}?page=2&pageSize=100`]);

    const capped = setup();
    capped.transport.on('POST', TOKEN_PATH, tokenReply('AT-1'));
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = Array.from({ length: 100 }, (_, index) => generatedSsid(page * 1000 + index));
      capped.transport.on('GET', `${catalogPath}?page=${page}&pageSize=100`, ok({ totalRows: 999999, data }));
    }
    const truncated = await capped.client.listSsids(siteId);
    assert.equal(truncated.truncated, true);
    assert.equal(capped.transport.requests.length, 1 + MAX_PAGES, 'never more than the page cap');
  }); // End of test "listSsids(): pagination walks..."

  test('listSsids(): a garbage page, or ONE malformed entry among valid ones, rejects the whole listing as malformedResponse', async () => {
    for (const page of ssidFixtures.validators.garbagePages) {
      const { client, transport } = setup();
      transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', `${catalogPath}?page=1&pageSize=100`, ok(page));
      await expectOpenApiError(client.listSsids(siteId), 'malformedResponse');
    }
    for (const { name, entry } of ssidFixtures.validators.catalogInvalid) {
      const { client, transport } = setup();
      const data = [...ssidFixtures.catalog.page.data, entry];
      transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', `${catalogPath}?page=1&pageSize=100`, ok({ totalRows: data.length, data }));
      const error = await expectOpenApiError(client.listSsids(siteId), 'malformedResponse');
      assert.match(error.diagnostic, /\(ssids\)/, name);
    }
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', `${catalogPath}?page=1&pageSize=100`, { body: { msg: 'no errorCode' } });
    await expectOpenApiError(client.listSsids(siteId), 'malformedResponse');
  }); // End of test "listSsids(): a garbage page..."

  test('getSsidDetail(): GET /openapi/v1/…/wireless-network/ssids/{ssidId} (no query); only allowlisted values, never the key', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', detailPath, ok(ssidFixtures.detail.result));
    const detail = await client.getSsidDetail(siteId, ssidId);
    assert.deepEqual(JSON.parse(JSON.stringify(detail)), ssidFixtures.detail.expected);
    assert.ok(!JSON.stringify(detail).includes(ssidFixtures.detail.result.pskSetting.securityKey));
    assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, `GET ${detailPath}`]);
    assertReadContract(transport.requests[1], detailPath, 'v1');
  });

  test('getSsidApGroups(): GET /openapi/v1/…/wireless-network/ssids/{ssidId}/ap-groups (no query); only the group ids', async () => {
    const { client, transport } = setup();
    transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', bindingsPath, ok(ssidFixtures.bindings.result));
    assert.deepEqual(await client.getSsidApGroups(siteId, ssidId), ssidFixtures.bindings.expected);
    assert.deepEqual(transport.log(), [`POST ${TOKEN_PATH}`, `GET ${bindingsPath}`]);
    assertReadContract(transport.requests[1], bindingsPath, 'v1');
  });

  test('malformed details and bindings are malformedResponse, and the error never quotes the payload (no passphrase)', async () => {
    const secret = ssidFixtures.secrets.detail.pskSetting.securityKey;
    const details = [...ssidFixtures.validators.detailInvalid.map(({ result }) => result), { ...ssidFixtures.secrets.detail, id: '5f00c0ffee0000000000c002' }];
    for (const result of details) {
      const { client, transport } = setup();
      transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', detailPath, ok(result));
      const error = await expectOpenApiError(client.getSsidDetail(siteId, ssidId), 'malformedResponse');
      assert.ok(!error.message.includes(secret) && !inspect(error).includes(secret));
    }
    for (const { name, result } of ssidFixtures.validators.bindingsInvalid) {
      const { client, transport } = setup();
      transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', bindingsPath, ok(result));
      await expectOpenApiError(client.getSsidApGroups(siteId, ssidId), 'malformedResponse').then((error) => assert.match(error.diagnostic, /ssid ap-groups/, name));
    }
  }); // End of test "malformed details and bindings are malformedResponse..."

  test('controller errors: an errorCode is apiError carrying it, HTTP 500 is httpError; nothing is retried', async () => {
    const reads: Array<[string, (client: OpenApiClient) => Promise<unknown>]> = [
      [detailPath, (client) => client.getSsidDetail(siteId, ssidId)],
      [bindingsPath, (client) => client.getSsidApGroups(siteId, ssidId)],
      [`${catalogPath}?page=1&pageSize=100`, (client) => client.listSsids(siteId)]
    ];
    for (const [path, read] of reads) {
      const { client, transport } = setup();
      transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', path, { body: { errorCode: -1300, msg: 'Failed to get site information.' } });
      const error = await expectOpenApiError(read(client), 'apiError');
      assert.equal(error.controllerErrorCode, -1300);
      assert.equal(transport.requestsTo('GET', path).length, 1);
      const failing = setup();
      failing.transport.on('POST', TOKEN_PATH, tokenReply('AT-1')).on('GET', path, { status: 500, body: '<html>oops</html>' });
      assert.equal((await expectOpenApiError(read(failing.client), 'httpError')).httpStatus, 500);
    } // End of the loop over the three reads
  }); // End of test "controller errors: an errorCode is apiError..."

  test('unusable arguments are refused before anything is sent; a closed client sends nothing', async () => {
    const { client, transport } = setup();
    await assert.rejects(client.listSsids(''), /Invalid site id/);
    for (const badId of ['', '..', '../sites', 'a b', 'x'.repeat(129)]) {
      await assert.rejects(client.getSsidDetail(siteId, badId), /Invalid SSID detail arguments/, badId);
      await assert.rejects(client.getSsidApGroups(siteId, badId), /Invalid SSID bindings arguments/, badId);
    }
    await assert.rejects(client.getSsidDetail('', ssidId), /Invalid SSID detail arguments/);
    assert.deepEqual(transport.requests, []);
    client.close();
    await expectOpenApiError(client.listSsids(siteId), 'clientClosed');
    await expectOpenApiError(client.getSsidDetail(siteId, ssidId), 'clientClosed');
    await expectOpenApiError(client.getSsidApGroups(siteId, ssidId), 'clientClosed');
    assert.deepEqual(transport.requests, []);
  }); // End of test "unusable arguments are refused..."
}); // End of the describe block for the Wi-Fi network read contract
