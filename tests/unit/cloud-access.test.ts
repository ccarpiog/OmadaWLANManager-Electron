// Tests for the cloud access behind `cloud:test` and `cloud:controllers`
// (src/main/cloud-access.ts), on the fake transport — no Electron, no
// network: saved credentials only ('notConfigured' without them), a fresh
// token for Test and a reused one for the listing, the controller DTOs (four
// organizations: exactly the renderer keys, never a deviceId, serverHost,
// secret or token), stable failure codes with codes-only diagnostics scrubbed
// by value, 'superseded' when the credentials are saved, removed or replaced
// while a call runs, and the live secrets the IPC registrar scrubs; and the
// fresh organization entry a cloud target's connect reads (findOrganization()).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CLOUD_ORGANIZATIONS_PATH, CLOUD_TOKEN_PATH } from '../../src/main/cloud-account-client';
import { CloudAccessService } from '../../src/main/cloud-access';
import type { CloudCredentials } from '../../src/main/cloud-account-model';
import { createTrustedIpcRegistrar } from '../../src/main/ipc-trust';
import { REDACTED } from '../../src/main/redact';
import type { CloudAccessResult } from '../../src/shared/types';
import guide from '../fixtures/cloud/account-guide.json';
import fourOrganizations from '../fixtures/cloud/organizations-four.json';
import { FakeClock } from './helpers/fake-clock';
import { FakeTransport, type FakeReply } from './helpers/fake-transport';

const EUW = 'https://euw1-omada-northbound.tplinkcloud.com';
const ORGS_PAGE_1 = `${CLOUD_ORGANIZATIONS_PATH}?page=1&pageSize=100`;
const SECRET = 'cloud-secret-value-0001';
const CREDENTIALS: CloudCredentials = { region: 'euw', clientId: 'cloud-client-0001', clientSecret: SECRET };

/**
 * A successful get_tokens answer carrying the given token.
 * @param {string} token - The access token.
 * @returns {FakeReply} The reply.
 */
function tokenReply(token: string): FakeReply {
  return { body: { errorCode: 0, msg: 'Open API Get Access Token successfully.', result: { accessToken: token, tokenType: 'bearer', expiresIn: 7200, refreshToken: 'RT-refreshValueNeverUsed00000000' } } };
}

/**
 * Builds a service whose saved credentials the test controls.
 * @param {CloudCredentials | null} [initial] - The saved credentials.
 * @returns {{ service: CloudAccessService; transport: FakeTransport; saved: { credentials: CloudCredentials | null } }} The parts.
 */
function setup(initial: CloudCredentials | null = CREDENTIALS): {
  service: CloudAccessService;
  transport: FakeTransport;
  saved: { credentials: CloudCredentials | null };
} {
  const clock = new FakeClock();
  const transport = new FakeTransport(EUW);
  const saved = { credentials: initial };
  const service = new CloudAccessService({ getCredentials: () => saved.credentials, transport, now: clock.now, sleep: clock.sleep });
  return { service, transport, saved };
} // End of function setup()

/**
 * Asserts a reply holds no secret, token, deviceId or serverHost.
 * @param {CloudAccessResult} reply - The reply.
 * @param {string[]} secrets - Values that must not appear.
 */
function assertSecretFree(reply: CloudAccessResult, secrets: string[]): void {
  const serialized = JSON.stringify(reply);
  for (const secret of [...secrets, 'tplinkcloud', 'deviceId', 'serverHost', 'refresh', 'RT-']) {
    assert.ok(!serialized.includes(secret), `${secret} in ${serialized}`);
  }
}

describe('CloudAccessService: saved credentials only', () => {
  test('nothing saved → notConfigured, and nothing is sent', async () => {
    const { service, transport } = setup(null);
    assert.deepEqual(await service.test(), { success: false, error: 'notConfigured' });
    assert.deepEqual(await service.controllers(), { success: false, error: 'notConfigured' });
    assert.equal(transport.requests.length, 0);
    assert.deepEqual(service.liveSecrets(), []);
  });

  test('cloud:test with the four-organization account: a fresh token, the DTOs only, secret-free', async () => {
    const { service, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, [tokenReply('a1-AT-tokenOneValue00000000000001'), tokenReply('a1-AT-tokenTwoValue00000000000002')]).on('GET', ORGS_PAGE_1, { body: fourOrganizations.page });
    const reply = await service.test();
    assert.deepEqual(reply, { success: true, controllers: fourOrganizations.expected, truncated: false });
    for (const controller of reply.controllers ?? []) {
      assert.deepEqual(Object.keys(controller).sort(), ['connectable', 'name', 'omadacId', 'online', 'reason', 'version']);
    }
    assertSecretFree(reply, [SECRET, 'a1-AT-tokenOneValue00000000000001', CREDENTIALS.clientId]);
    // A second Test proves the credential again with a new token
    await service.test();
    assert.equal(transport.requestsTo('POST', CLOUD_TOKEN_PATH).length, 2);
  }); // End of test "cloud:test with the four-organization account..."

  test('cloud:controllers reuses a valid token', async () => {
    const { service, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('a1-AT-tokenOneValue00000000000001')).on('GET', ORGS_PAGE_1, { body: guide.organizationsPage });
    await service.controllers();
    const reply = await service.controllers();
    assert.equal(reply.success, true);
    assert.deepEqual(reply.controllers?.map((controller) => [controller.omadacId, controller.reason]), [['5ffc0460d2816b0d09b531cd27c106a8', 'versionTooOld']]);
    assert.equal(transport.requestsTo('POST', CLOUD_TOKEN_PATH).length, 1);
    assert.equal(transport.requestsTo('GET', ORGS_PAGE_1).length, 2);
  });
});

describe('CloudAccessService: failures', () => {
  test('stable codes with codes-only diagnostics (TP-Link\'s redacted message only for an unknown errorCode)', async () => {
    const cases: Array<[FakeReply, string, string]> = [
      [{ body: guide.liveCredentialExpired }, 'credentialInvalid', 'credentialInvalid, errorCode -52602'],
      [{ status: 401, body: guide.liveBadBearer.body }, 'credentialInvalid', 'credentialInvalid, HTTP 401, errorCode -44116'],
      [{ status: 503, body: '<html>maintenance</html>' }, 'httpError', 'httpError, HTTP 503'],
      [{ body: 'garbage' }, 'malformedResponse', 'malformedResponse'],
      [{ status: 429, body: '' }, 'rateLimited', 'rateLimited, HTTP 429'],
      [{ body: guide.tooManyAuthentications }, 'apiError', 'apiError, token request failed: errorCode -90114 (This Open API Application has exceeded the maximum allowed authentications)']
    ];
    for (const [reply, code, diagnostic] of cases) {
      const { service, transport } = setup();
      transport.on('POST', CLOUD_TOKEN_PATH, reply);
      assert.deepEqual(await service.test(), { success: false, error: code, diagnostic }, JSON.stringify(reply));
    }
  }); // End of test "stable codes with codes-only diagnostics..."

  test('timeout / networkError; a failure echoing the secret or the token is scrubbed by value', async () => {
    const { service, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('a1-AT-tokenOneValue00000000000001')).on('GET', ORGS_PAGE_1, { body: { errorCode: -90199, msg: `refused ${SECRET} a1-AT-tokenOneValue00000000000001 tokenOne` } });
    const reply = await service.test();
    assert.equal(reply.error, 'apiError');
    assertSecretFree(reply, [SECRET, 'a1-AT-tokenOneValue00000000000001']);
    assert.ok(reply.diagnostic?.includes(REDACTED));
    const timeout = setup();
    timeout.transport.on('POST', CLOUD_TOKEN_PATH, () => {
      throw new Error('Request timeout (15s)');
    });
    assert.deepEqual(await timeout.service.test(), { success: false, error: 'timeout', diagnostic: 'timeout' });
  });

  test('a credential saved or removed while the call runs → superseded (a late reply is never shown as current)', async () => {
    for (const change of ['invalidate', 'remove', 'replace'] as const) {
      const { service, transport, saved } = setup();
      let release!: (reply: FakeReply) => void;
      transport
        .on('POST', CLOUD_TOKEN_PATH, tokenReply('a1-AT-tokenOneValue00000000000001'))
        .on('GET', ORGS_PAGE_1, () => new Promise<FakeReply>((resolve) => {
          release = resolve;
        }));
      const pending = service.test();
      await new Promise((resolve) => setImmediate(resolve));
      if (change === 'invalidate') {
        service.invalidate();
      } else if (change === 'remove') {
        saved.credentials = null;
        assert.deepEqual(await service.controllers(), { success: false, error: 'notConfigured' });
      } else {
        saved.credentials = { ...CREDENTIALS, clientSecret: 'another-secret' };
        transport.on('GET', ORGS_PAGE_1, { body: fourOrganizations.page });
        assert.equal((await service.controllers()).success, true, 'the new credential works at once');
      }
      release({ body: fourOrganizations.page });
      assert.deepEqual(await pending, { success: false, error: 'superseded' }, change);
    } // End of the loop over the credential changes
  }); // End of test "a credential saved or removed while the call runs..."
});

describe('CloudAccessService: live secrets and the IPC registrar', () => {
  test('liveSecrets() lists the secret and the tokens while a client is live, none after invalidate()', async () => {
    const { service, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('a1-AT-tokenOneValue00000000000001')).on('GET', ORGS_PAGE_1, { body: fourOrganizations.page });
    await service.controllers();
    assert.deepEqual(service.liveSecrets(), [SECRET, 'a1-AT-tokenOneValue00000000000001']);
    service.invalidate();
    assert.deepEqual(service.liveSecrets(), []);
  });

  test('a handler failure echoing the bare cloud secret or token crosses the registrar scrubbed (stored-secrets mechanism)', async () => {
    const { service, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('tokenWithoutKnownShape0001')).on('GET', ORGS_PAGE_1, { body: fourOrganizations.page });
    await service.controllers();
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const registrar = createTrustedIpcRegistrar<unknown>({ handle: (channel, listener) => void listeners.set(channel, listener) }, () => true, () => [SECRET, ...service.liveSecrets()]);
    registrar.handle('cloud:test', () => {
      throw new Error(`boom ${SECRET} tokenWithoutKnownShape0001`);
    });
    await assert.rejects(async () => listeners.get('cloud:test')?.({}), { message: `boom ${REDACTED} ${REDACTED}` });
  });
});

describe('CloudAccessService.findOrganization(): a cloud target\'s fresh organization entry (inbox I-1b2b1)', () => {
  const PLANTA_4 = fourOrganizations.page.result.data[3];

  test('the organization with its main-only fields and the account client; the list is read on every call, the token reused', async () => {
    const { service, transport } = setup();
    transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('a1-AT-tokenOneValue00000000000001')).on('GET', ORGS_PAGE_1, { body: fourOrganizations.page });
    const found = await service.findOrganization(PLANTA_4.omadacId);
    assert.equal(found.success, true, JSON.stringify(found));
    assert.ok(found.success);
    assert.equal(found.organization.omadacId, PLANTA_4.omadacId);
    assert.equal(found.organization.deviceId, PLANTA_4.deviceId);
    assert.equal(found.organization.serverOrigin, EUW);
    assert.equal(found.organization.version, '6.3.0.45');
    assert.equal(found.account.isClosed, false);
    assert.equal(found.account.region, 'euw');
    assert.equal((await service.findOrganization(PLANTA_4.omadacId)).success, true);
    assert.equal(transport.requestsTo('GET', ORGS_PAGE_1).length, 2, 'fresh: read again');
    assert.equal(transport.requestsTo('POST', CLOUD_TOKEN_PATH).length, 1, 'the token is reused');
    // A non-connectable organization is still found: the connect decides on its reason
    const offline = await service.findOrganization(fourOrganizations.page.result.data[1].omadacId);
    assert.ok(offline.success && offline.organization.online === false);
  }); // End of test "the organization with its main-only fields..."

  test('failures: notConfigured, unknownController, listIncomplete (fail-closed), the account codes, superseded', async () => {
    const none = setup(null);
    assert.deepEqual(await none.service.findOrganization(PLANTA_4.omadacId), { success: false, error: 'notConfigured' });
    assert.equal(none.transport.requests.length, 0);

    const unknown = setup();
    unknown.transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('a1-AT-tokenOneValue00000000000001')).on('GET', ORGS_PAGE_1, { body: fourOrganizations.page });
    assert.deepEqual(await unknown.service.findOrganization('5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e'), { success: false, error: 'unknownController' });

    const partial = setup();
    const page = structuredClone(fourOrganizations.page);
    page.result.totalRows = 500;
    partial.transport
      .on('POST', CLOUD_TOKEN_PATH, tokenReply('a1-AT-tokenOneValue00000000000001'))
      .on('GET', ORGS_PAGE_1, { body: page })
      .on('GET', `${CLOUD_ORGANIZATIONS_PATH}?page=2&pageSize=100`, { body: { errorCode: 0, msg: 'OK', result: { totalRows: 500, currentPage: 2, currentSize: 100, data: [] } } });
    assert.deepEqual(await partial.service.findOrganization('5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e'), { success: false, error: 'listIncomplete', diagnostic: 'organization list incomplete' });
    assert.deepEqual(await partial.service.findOrganization(PLANTA_4.omadacId), { success: false, error: 'listIncomplete', diagnostic: 'organization list incomplete' }, 'an entry on a page that was read is refused too: the list is not proven complete');

    const refused = setup();
    refused.transport.on('POST', CLOUD_TOKEN_PATH, { body: guide.liveCredentialExpired });
    assert.deepEqual(await refused.service.findOrganization(PLANTA_4.omadacId), { success: false, error: 'credentialInvalid', diagnostic: 'credentialInvalid, errorCode -52602' });

    const raced = setup();
    let release!: (reply: FakeReply) => void;
    raced.transport
      .on('POST', CLOUD_TOKEN_PATH, tokenReply('a1-AT-tokenOneValue00000000000001'))
      .on('GET', ORGS_PAGE_1, () => new Promise<FakeReply>((resolve) => {
        release = resolve;
      }));
    const pending = raced.service.findOrganization(PLANTA_4.omadacId);
    await new Promise((resolve) => setImmediate(resolve));
    raced.service.invalidate();
    release({ body: fourOrganizations.page });
    assert.deepEqual(await pending, { success: false, error: 'superseded' });
  }); // End of test "failures: notConfigured, unknownController..."
}); // End of describe 'CloudAccessService.findOrganization()'

describe('CloudAccessService: the local controller\'s omadacId on a success (inbox I-1c2a)', () => {
  const LOCAL_ID = 'c0ffee00c0ffee00c0ffee00c0ffee00';

  /**
   * Builds a service whose stored local omadacId the test controls.
   * @param {() => string} getLocalOmadacId - The stored value (or a throwing getter).
   * @returns {{ service: CloudAccessService; transport: FakeTransport }} The parts.
   */
  function setupWithLocal(getLocalOmadacId: () => string): { service: CloudAccessService; transport: FakeTransport } {
    const clock = new FakeClock();
    const transport = new FakeTransport(EUW);
    const service = new CloudAccessService({ getCredentials: () => CREDENTIALS, transport, now: clock.now, sleep: clock.sleep, getLocalOmadacId });
    transport.on('POST', CLOUD_TOKEN_PATH, tokenReply('a1-AT-tokenOneValue00000000000001')).on('GET', ORGS_PAGE_1, { body: fourOrganizations.page });
    return { service, transport };
  } // End of function setupWithLocal()

  test('cloud:test and cloud:controllers carry the stored localOmadacId beside the DTOs, read when the reply is built', async () => {
    let stored = LOCAL_ID;
    const { service } = setupWithLocal(() => stored);
    assert.deepEqual(await service.test(), { success: true, controllers: fourOrganizations.expected, truncated: false, localOmadacId: LOCAL_ID });
    stored = '4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d';
    assert.equal((await service.controllers()).localOmadacId, stored, 'the current value, not one cached from an earlier call');
  });

  test('none stored, an unusable value or a failing getter: no localOmadacId (the reply is otherwise unchanged)', async () => {
    for (const getter of [() => '', () => 'local', () => 'not an id', () => { throw new Error(`boom ${SECRET}`); }]) {
      const { service } = setupWithLocal(getter);
      const reply = await service.controllers();
      assert.deepEqual(reply, { success: true, controllers: fourOrganizations.expected, truncated: false });
    }
  });

  test('a failure never carries it, and it never enters a diagnostic', async () => {
    const clock = new FakeClock();
    const transport = new FakeTransport(EUW);
    const service = new CloudAccessService({ getCredentials: () => CREDENTIALS, transport, now: clock.now, sleep: clock.sleep, getLocalOmadacId: () => LOCAL_ID });
    transport.on('POST', CLOUD_TOKEN_PATH, { body: guide.liveCredentialExpired });
    const reply = await service.test();
    assert.deepEqual(reply, { success: false, error: 'credentialInvalid', diagnostic: 'credentialInvalid, errorCode -52602' });
    assert.ok(!JSON.stringify(reply).includes(LOCAL_ID));
    const none = new CloudAccessService({ getCredentials: () => null, transport, getLocalOmadacId: () => LOCAL_ID });
    assert.deepEqual(await none.controllers(), { success: false, error: 'notConfigured' });
  });
}); // End of describe 'CloudAccessService: the local controller\'s omadacId on a success'
