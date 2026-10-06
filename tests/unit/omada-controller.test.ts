// Transport-level tests for OmadaController (src/main/omada-api.ts): the
// client is driven end-to-end through FakeTransport with the canned Omada
// envelopes in tests/fixtures/controller/responses.json — login → sites →
// APs/groups, multi-site selection, site pagination, the -1200 session-expiry
// single shared re-login, cookie/CSRF handling, logout and error paths. No
// Electron, no network.

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { OmadaController } from '../../src/main/omada-api';
import responses from '../fixtures/controller/responses.json';
import { FakeTransport } from './helpers/fake-transport';

const BASE_URL = 'https://controller.invalid:8043';
const OMADAC_ID = responses.apiInfo.result.omadacId;
const SITE_A = responses.sitesMulti.result.data[0].id;
const SITE_B = responses.sitesMulti.result.data[1].id;
const SITES_PATH = `/${OMADAC_ID}/api/v2/sites?currentPage=1&currentPageSize=100`;
const LOGIN_PATH = `/${OMADAC_ID}/api/v2/login`;
const LOGOUT_PATH = `/${OMADAC_ID}/api/v2/logout`;

/**
 * Builds the devices path for a site.
 * @param {string} siteId - Site id.
 * @returns {string} The devices path.
 */
function devicesPath(siteId: string): string {
  return `/${OMADAC_ID}/api/v2/sites/${siteId}/devices`;
}

/**
 * Builds the WLAN-group (setting/ssids) path for a site.
 * @param {string} siteId - Site id.
 * @returns {string} The ssids path.
 */
function ssidsPath(siteId: string): string {
  return `/${OMADAC_ID}/api/v2/sites/${siteId}/setting/ssids`;
}

/**
 * Creates a fake transport preloaded with a successful single-site login:
 * /api/info sets the session cookie, login returns csrf-token-1.
 * @returns {FakeTransport} The transport.
 */
function singleSiteTransport(): FakeTransport {
  return new FakeTransport(BASE_URL)
    .on('GET', '/api/info', { body: responses.apiInfo, setCookie: 'TPOMADA_SESSIONID=session-1; Path=/; HttpOnly' })
    .on('POST', LOGIN_PATH, { body: responses.loginOk })
    .on('GET', SITES_PATH, { body: responses.sitesSingle });
}

/**
 * Creates a controller over a transport (trailing slash on purpose: the
 * constructor must strip it).
 * @param {FakeTransport} transport - The fake transport.
 * @returns {OmadaController} The controller.
 */
function createController(transport: FakeTransport): OmadaController {
  return new OmadaController(`${BASE_URL}/`, 'admin', 's3cret', transport);
}

// The client logs expected failures with console.error/warn; keep the test
// output readable (the assertions check the behavior, not the logs). Each
// test file runs in its own process, so this affects this file only
mock.method(console, 'error', () => {});
mock.method(console, 'warn', () => {});

describe('OmadaController connect (single site)', () => {
  test('runs info → login → sites and auto-selects the only site', async () => {
    const transport = singleSiteTransport();
    const controller = createController(transport);

    const outcome = await controller.connect();

    assert.deepEqual(outcome, { siteSelected: true, sites: [{ id: responses.sitesSingle.result.data[0].id, name: 'Casa' }] });
    assert.deepEqual(transport.log(), ['GET /api/info', `POST ${LOGIN_PATH}`, `GET ${SITES_PATH}`]);
    assert.equal(transport.requests[0].url, `${BASE_URL}/api/info`, 'base URL trailing slash stripped');
  });

  test('sends credentials only in the login body; JSON headers on every request', async () => {
    const transport = singleSiteTransport();
    await createController(transport).connect();

    const [info, login, sites] = transport.requests;
    assert.equal(info.body, undefined);
    assert.deepEqual(login.body, { username: 'admin', password: 's3cret' });
    assert.equal(sites.body, undefined);
    for (const request of transport.requests) {
      assert.equal(request.headers['Content-Type'], 'application/json');
      assert.equal(request.headers.Accept, 'application/json');
    }
  }); // End of test "sends credentials only in the login body; JSON headers on every req..."

  test('attaches the CSRF token only after login and the session cookie from Set-Cookie', async () => {
    const transport = singleSiteTransport();
    await createController(transport).connect();

    const [info, login, sites] = transport.requests;
    assert.equal(info.headers['Csrf-Token'], undefined);
    assert.equal(info.headers.Cookie, undefined, 'empty jar sends no Cookie header');
    assert.equal(login.headers['Csrf-Token'], undefined);
    assert.equal(login.headers.Cookie, 'TPOMADA_SESSIONID=session-1');
    assert.equal(sites.headers['Csrf-Token'], 'csrf-token-1');
    assert.equal(sites.headers.Cookie, 'TPOMADA_SESSIONID=session-1');
  }); // End of test "attaches the CSRF token only after login and the session cookie fro..."

  test('loads APs (sorted, APs only) and WLAN groups (sorted) for the selected site', async () => {
    const siteId = responses.sitesSingle.result.data[0].id;
    const transport = singleSiteTransport()
      .on('GET', devicesPath(siteId), { body: responses.devices })
      .on('GET', ssidsPath(siteId), { body: responses.ssids });
    const controller = createController(transport);
    await controller.connect();

    const aps = await controller.getAccessPoints();
    assert.deepEqual(aps.map((ap) => ap.name), ['Altillo', 'EAP Carpio', 'Salón']);
    assert.deepEqual(aps[1], { mac: 'AA-BB-CC-00-11-33', name: 'EAP Carpio', type: 'ap', wlanGroup: 'zGrupo B', statusCategory: 1 });

    const groups = await controller.getWlanGroups();
    assert.deepEqual(groups.map((group) => group.wlanName), ['Default', 'zGrupo B']);
    assert.deepEqual(groups[0].ssidList, [{ ssidName: 'Casa' }, { ssidName: 'Invitados' }]);
  }); // End of test "loads APs (sorted, APs only) and WLAN groups (sorted) for the selec..."

  test('moves an AP with PATCH eaps/{mac} {wlanId}', async () => {
    const siteId = responses.sitesSingle.result.data[0].id;
    const mac = 'AA-BB-CC-00-11-33';
    const path = `/${OMADAC_ID}/api/v2/sites/${siteId}/eaps/${mac}`;
    const transport = singleSiteTransport().on('PATCH', path, { body: responses.ok });
    const controller = createController(transport);
    await controller.connect();

    assert.equal(await controller.setApWlanGroup(mac, '6512a0e1f3b2c41d2e3f4a5b'), true);
    const [patch] = transport.requestsTo('PATCH', path);
    assert.deepEqual(patch.body, { wlanId: '6512a0e1f3b2c41d2e3f4a5b' });
    assert.equal(patch.headers['Csrf-Token'], 'csrf-token-1');
  }); // End of test "moves an AP with PATCH eaps/{mac} {wlanId}"

  test('a rejected move surfaces the controller message', async () => {
    const siteId = responses.sitesSingle.result.data[0].id;
    const mac = 'AA-BB-CC-00-11-33';
    const transport = singleSiteTransport().on('PATCH', `/${OMADAC_ID}/api/v2/sites/${siteId}/eaps/${mac}`, { body: responses.apiError });
    const controller = createController(transport);
    await controller.connect();
    await assert.rejects(controller.setApWlanGroup(mac, 'abc'), { message: 'Internal controller error.' });
  });

  test('a Set-Cookie deletion on a later response drops the cookie from the jar', async () => {
    const siteId = responses.sitesSingle.result.data[0].id;
    const transport = singleSiteTransport()
      .on('GET', devicesPath(siteId), { body: responses.devices, setCookie: 'TPOMADA_SESSIONID=; Max-Age=0' })
      .on('GET', ssidsPath(siteId), { body: responses.ssids });
    const controller = createController(transport);
    await controller.connect();
    await controller.getAccessPoints();
    await controller.getWlanGroups();
    const [ssidsRequest] = transport.requestsTo('GET', ssidsPath(siteId));
    assert.equal(ssidsRequest.headers.Cookie, undefined);
  }); // End of test "a Set-Cookie deletion on a later response drops the cookie from the..."
}); // End of the describe block for single-site connect

describe('OmadaController connect (multi-site)', () => {
  /**
   * Creates a fake transport whose login returns two (deduplicated) sites.
   * @returns {FakeTransport} The transport.
   */
  function multiSiteTransport(): FakeTransport {
    return new FakeTransport(BASE_URL)
      .on('GET', '/api/info', { body: responses.apiInfo })
      .on('POST', LOGIN_PATH, { body: responses.loginOk })
      .on('GET', SITES_PATH, { body: responses.sitesMulti });
  }

  test('without a stored choice it never picks silently; sites are deduplicated', async () => {
    const controller = createController(multiSiteTransport());
    const outcome = await controller.connect();
    assert.deepEqual(outcome, {
      siteSelected: false,
      sites: [{ id: SITE_A, name: 'Casa' }, { id: SITE_B, name: 'Oficina' }],
    });
    await assert.rejects(controller.getAccessPoints(), { message: 'No conectado al controlador' });
  });

  test('a stored site id that is still authorized is reused', async () => {
    const outcome = await createController(multiSiteTransport()).connect(SITE_B);
    assert.equal(outcome.siteSelected, true);
  });

  test('a stored site id that is no longer authorized is ignored', async () => {
    const outcome = await createController(multiSiteTransport()).connect('64f0c0ffee0000000000dead');
    assert.equal(outcome.siteSelected, false);
  });

  test('selectSite() accepts only authorized ids and then addresses that site', async () => {
    const transport = multiSiteTransport().on('GET', devicesPath(SITE_B), { body: responses.devices });
    const controller = createController(transport);
    await controller.connect();

    assert.equal(controller.selectSite('../../etc'), false);
    assert.equal(controller.selectSite('64f0c0ffee0000000000dead'), false);
    assert.equal(controller.selectSite(SITE_B), true);
    const aps = await controller.getAccessPoints();
    assert.equal(aps.length, 3);
    assert.equal(transport.requestsTo('GET', devicesPath(SITE_B)).length, 1);
  }); // End of test "selectSite() accepts only authorized ids and then addresses that site"

  test('walks every site page until a short page (pagination)', async () => {
    const page1 = Array.from({ length: 100 }, (_, index) => ({ id: `site-${index}`, name: `Site ${index}` }));
    const page2 = Array.from({ length: 30 }, (_, index) => ({ id: `site-${100 + index}`, name: `Site ${100 + index}` }));
    const transport = new FakeTransport(BASE_URL)
      .on('GET', '/api/info', { body: responses.apiInfo })
      .on('POST', LOGIN_PATH, { body: responses.loginOk })
      .on('GET', SITES_PATH, { body: { errorCode: 0, msg: '', result: { totalRows: 130, data: page1 } } })
      .on('GET', `/${OMADAC_ID}/api/v2/sites?currentPage=2&currentPageSize=100`, {
        body: { errorCode: 0, msg: '', result: { totalRows: 130, data: page2 } },
      });
    const outcome = await createController(transport).connect();
    assert.equal(outcome.sites.length, 130);
    assert.equal(outcome.siteSelected, false);
    assert.equal(transport.log().filter((entry) => entry.includes('/sites?')).length, 2);
  }); // End of test "walks every site page until a short page (pagination)"

  test('stops at the reported total even when the last page is full', async () => {
    const page1 = Array.from({ length: 100 }, (_, index) => ({ id: `site-${index}`, name: `Site ${index}` }));
    const transport = new FakeTransport(BASE_URL)
      .on('GET', '/api/info', { body: responses.apiInfo })
      .on('POST', LOGIN_PATH, { body: responses.loginOk })
      .on('GET', SITES_PATH, { body: { errorCode: 0, msg: '', result: { totalRows: 100, data: page1 } } });
    const outcome = await createController(transport).connect();
    assert.equal(outcome.sites.length, 100);
  });
}); // End of the describe block for multi-site connect

describe('OmadaController session expiry (-1200)', () => {
  const siteId = responses.sitesSingle.result.data[0].id;

  test('re-logs in once and retries the request with the fresh token and cookie', async () => {
    const transport = singleSiteTransport()
      .on('POST', LOGIN_PATH, [
        { body: responses.loginOk },
        { body: responses.loginOkRefreshed, setCookie: 'TPOMADA_SESSIONID=session-2; Path=/' },
      ])
      .on('GET', devicesPath(siteId), [{ body: responses.sessionExpired }, { body: responses.devices }]);
    const controller = createController(transport);
    await controller.connect();

    const aps = await controller.getAccessPoints();

    assert.equal(aps.length, 3);
    assert.deepEqual(transport.log().slice(3), [`GET ${devicesPath(siteId)}`, `POST ${LOGIN_PATH}`, `GET ${devicesPath(siteId)}`]);
    const retry = transport.requestsTo('GET', devicesPath(siteId))[1];
    assert.equal(retry.headers['Csrf-Token'], 'csrf-token-2');
    assert.equal(retry.headers.Cookie, 'TPOMADA_SESSIONID=session-2');
  }); // End of test "re-logs in once and retries the request with the fresh token and co..."

  test('concurrent expirations share ONE re-login', async () => {
    const transport = singleSiteTransport()
      // A third login reply does not exist: a second (competing) re-login
      // would fail the test with "no more replies"
      .on('POST', LOGIN_PATH, [{ body: responses.loginOk }, { body: responses.loginOkRefreshed }])
      .on('GET', devicesPath(siteId), [{ body: responses.sessionExpired }, { body: responses.devices }])
      .on('GET', ssidsPath(siteId), [{ body: responses.sessionExpired }, { body: responses.ssids }]);
    const controller = createController(transport);
    await controller.connect();

    const [aps, groups] = await Promise.all([controller.getAccessPoints(), controller.getWlanGroups()]);

    assert.equal(aps.length, 3);
    assert.equal(groups.length, 2);
    assert.equal(transport.requestsTo('POST', LOGIN_PATH).length, 2, 'connect login + one shared re-login');
  }); // End of test "concurrent expirations share ONE re-login"

  test('a retry that expires again is not retried a second time', async () => {
    const transport = singleSiteTransport()
      .on('POST', LOGIN_PATH, [{ body: responses.loginOk }, { body: responses.loginOkRefreshed }])
      .on('GET', devicesPath(siteId), [{ body: responses.sessionExpired }, { body: responses.sessionExpired }]);
    const controller = createController(transport);
    await controller.connect();

    await assert.rejects(controller.getAccessPoints(), { message: 'Login required.' });
    assert.equal(transport.requestsTo('POST', LOGIN_PATH).length, 2);
    assert.equal(transport.requestsTo('GET', devicesPath(siteId)).length, 2);
  });

  test('a failed re-login clears the session (no half-valid state survives)', async () => {
    const transport = singleSiteTransport()
      .on('POST', LOGIN_PATH, [{ body: responses.loginOk }, { body: responses.loginFailed }])
      .on('GET', devicesPath(siteId), [{ body: responses.sessionExpired }]);
    const controller = createController(transport);
    await controller.connect();

    await assert.rejects(controller.getAccessPoints(), { message: 'Session expired; re-login failed' });
    await assert.rejects(controller.getWlanGroups(), { message: 'No conectado al controlador' });
  });

  test('a re-login network failure clears the session and reports the cause', async () => {
    const transport = singleSiteTransport()
      .on('POST', LOGIN_PATH, [{ body: responses.loginOk }, { status: 502, body: 'Bad Gateway' }])
      .on('GET', devicesPath(siteId), [{ body: responses.sessionExpired }]);
    const controller = createController(transport);
    await controller.connect();

    await assert.rejects(controller.getAccessPoints(), { message: 'Session expired; re-login failed: HTTP 502: Bad Gateway' });
    await assert.rejects(controller.getAccessPoints(), { message: 'No conectado al controlador' });
  });

  test('the connect flow itself never triggers a re-login', async () => {
    const transport = new FakeTransport(BASE_URL)
      .on('GET', '/api/info', { body: responses.apiInfo })
      .on('POST', LOGIN_PATH, [{ body: responses.sessionExpired }]);
    await assert.rejects(createController(transport).connect(), { message: 'Login required.' });
    assert.equal(transport.requestsTo('POST', LOGIN_PATH).length, 1);
  });
}); // End of the describe block for session expiry

describe('OmadaController errors and logout', () => {
  test('connect fails clearly when /api/info has no omadacId', async () => {
    const transport = new FakeTransport(BASE_URL).on('GET', '/api/info', { body: responses.apiInfoNoId });
    await assert.rejects(createController(transport).connect(), { message: 'No se pudo obtener el ID del controlador' });
  });

  test('connect surfaces the controller message on bad credentials', async () => {
    const transport = new FakeTransport(BASE_URL)
      .on('GET', '/api/info', { body: responses.apiInfo })
      .on('POST', LOGIN_PATH, { body: responses.loginFailed });
    await assert.rejects(createController(transport).connect(), { message: 'Invalid username or password.' });
  });

  test('connect fails when the account sees no site', async () => {
    const transport = new FakeTransport(BASE_URL)
      .on('GET', '/api/info', { body: responses.apiInfo })
      .on('POST', LOGIN_PATH, { body: responses.loginOk })
      .on('GET', SITES_PATH, { body: responses.sitesEmpty });
    await assert.rejects(createController(transport).connect(), { message: 'El usuario no tiene acceso a ningún sitio' });
  });

  test('non-2xx and non-JSON responses are rejected with bounded excerpts', async () => {
    const http = new FakeTransport(BASE_URL).on('GET', '/api/info', { status: 502, body: '<html>Bad Gateway</html>' });
    await assert.rejects(createController(http).connect(), { message: 'HTTP 502: <html>Bad Gateway</html>' });

    const html = new FakeTransport(BASE_URL).on('GET', '/api/info', { body: '<!DOCTYPE html>' });
    await assert.rejects(createController(html).connect(), { message: 'Invalid JSON response: <!DOCTYPE html>' });
  });

  test('an unsupported devices payload is rejected by the validator', async () => {
    const siteId = responses.sitesSingle.result.data[0].id;
    const transport = singleSiteTransport().on('GET', devicesPath(siteId), { body: responses.devicesUnsupported });
    const controller = createController(transport);
    await controller.connect();
    await assert.rejects(controller.getAccessPoints(), { message: 'Unsupported API response (devices)' });
  });

  test('data calls before connect report "not connected" and send nothing', async () => {
    const transport = new FakeTransport(BASE_URL);
    const controller = createController(transport);
    await assert.rejects(controller.getAccessPoints(), { message: 'No conectado al controlador' });
    await assert.rejects(controller.getWlanGroups(), { message: 'No conectado al controlador' });
    await assert.rejects(controller.setApWlanGroup('AA-BB-CC-00-11-22', 'abc'), { message: 'No conectado al controlador' });
    assert.deepEqual(transport.requests, []);
  });

  test('logout posts to the controller with the CSRF token, then clears the session', async () => {
    const transport = singleSiteTransport().on('POST', LOGOUT_PATH, { body: responses.ok });
    const controller = createController(transport);
    await controller.connect();

    await controller.logout();

    const [logout] = transport.requestsTo('POST', LOGOUT_PATH);
    assert.equal(logout.headers['Csrf-Token'], 'csrf-token-1');
    assert.equal(logout.headers.Cookie, 'TPOMADA_SESSIONID=session-1');
    await assert.rejects(controller.getAccessPoints(), { message: 'No conectado al controlador' });
  }); // End of test "logout posts to the controller with the CSRF token, then clears the..."

  test('logout swallows a failing logout request and still clears the session', async () => {
    const transport = singleSiteTransport().on('POST', LOGOUT_PATH, { status: 500, body: 'oops' });
    const controller = createController(transport);
    await controller.connect();
    await controller.logout();
    await assert.rejects(controller.getAccessPoints(), { message: 'No conectado al controlador' });
  });

  test('logout without a session sends nothing', async () => {
    const transport = new FakeTransport(BASE_URL);
    await createController(transport).logout();
    assert.deepEqual(transport.requests, []);
  });
}); // End of the describe block for errors and logout
