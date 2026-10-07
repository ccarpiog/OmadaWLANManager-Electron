// Tests for ConnectionManager's connection targets (inbox item I-1b2b1;
// src/main/connection-manager.ts, src/main/connection-target.ts,
// src/main/cloud-connect.ts): no Electron, no network, never a tplinkcloud.com
// or controller request.
// - the pure target helpers and the startup resolution with its local
//   fallback (an unusable cloud credential → local);
// - with fake controllers whose connects and lookups the test settles by
//   hand: switchTarget() runs the URL-change invalidation synchronously
//   before any await, persists activeController and connects the new target;
//   a switch during a connect, a cloud lookup, a site choice or a move never
//   lets the old attempt install anything or persist its omadacId or site;
//   local → cloud → local; the cloud refusals; cloudSites persistence; the
//   local omadacId learned once; a cloud credential change on a cloud target;
// - end to end on fixtures (the real ControllerSession, CloudAccessService,
//   CloudAccountClient and OpenApiClient cloud route over fake transports):
//   the cloud session built from a fresh organization entry on the
//   organization's tunnel, each refusal before any session exists, the
//   code-first connect detail and move rejection with no routing identifier,
//   secret or token, and the races of a switch with a cloud move and with a
//   managed read (cloud and local);
// - the wiring of inbox I-1b2b2: the startup target (startOn(),
//   startupTargetOf()), CONFIG_SAVE's connectionReset for a cloud credential
//   change on a cloud target (applyConfigSave() + finishConfigSave()), the
//   session nonce on the controller data channels (accessPointsReply(),
//   wlanGroupsReply(), apMoveReply(): a stale nonce never reaches a
//   controller; a reply that arrives after a switch or a reconnect is
//   superseded) and the cloud connect result's controller name.

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { CLOUD_ORGANIZATIONS_PATH, CLOUD_TOKEN_PATH } from '../../src/main/cloud-account-client';
import { CloudAccessService } from '../../src/main/cloud-access';
import type { CloudCredentials } from '../../src/main/cloud-account-model';
import { createCloudControllerLookup } from '../../src/main/cloud-connect';
import { CloudSessionError, describeCloudSessionError } from '../../src/main/cloud-controller-session';
import { cloudCredentialsOf, type SecretBox, type StoredConfig } from '../../src/main/config-model';
import {
  cloudRefusalDetail,
  connectFailureDetail,
  ConnectionManager,
  type CloudControllerLookup,
  type ManagedController
} from '../../src/main/connection-manager';
import {
  activeControllerValue,
  isSameTarget,
  normalizeConnectionTarget,
  resolveStartupTarget,
  startupTargetOf,
  type ConnectionTarget
} from '../../src/main/connection-target';
import {
  accessPointsReply,
  applyManagementAccessChange,
  apMoveReply,
  ControllerSession,
  finishConfigSave,
  getSessionCapabilities,
  managedApGroupsReply,
  managementOn,
  wlanGroupsReply,
  type ManagementCredentials
} from '../../src/main/controller-session';
import { createTrustedIpcRegistrar } from '../../src/main/ipc-trust';
import type { ConnectOutcome } from '../../src/main/omada-api';
import { OpenApiClient, TOKEN_PATH } from '../../src/main/openapi-client';
import { REDACTED } from '../../src/main/redact';
import type { CloudAccessStatus, ConfigSavePayload, ConnectionResult, ManagementAccessStatus, SiteInfo } from '../../src/shared/types';
import fourOrganizations from '../fixtures/cloud/organizations-four.json';
import tunnel from '../fixtures/cloud/controller-tunnel.json';
import responses from '../fixtures/controller/responses.json';
import { FakeClock } from './helpers/fake-clock';
import { FakeTransport, type FakeReply } from './helpers/fake-transport';

// The code under test logs expected failures; keep the output readable
mock.method(console, 'error', () => {});
mock.method(console, 'warn', () => {});

const URL_A = 'https://controller-a.invalid:8043';
const OMADAC_LOCAL = 'c0ffee00c0ffee00c0ffee00c0ffee00';
const OMADAC_CLOUD = '4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d';
const OMADAC_OTHER = '3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a';
const SITES: SiteInfo[] = [
  { id: 'site-a', name: 'Site A' },
  { id: 'site-b', name: 'Site B' }
];
const NONCE = 'c'.repeat(32);
const SUPERSEDED: ConnectionResult = { success: false, error: 'connectionSuperseded' };

/** A promise with its settle functions exposed. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/**
 * Creates a deferred promise.
 * @returns {Deferred<T>} The promise and its settle functions.
 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Lets every pending microtask and immediate callback run.
 * @returns {Promise<void>}
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Lets pending callbacks run until `predicate` holds (bounded).
 * @param {() => boolean} predicate - The condition.
 * @returns {Promise<void>}
 */
async function until(predicate: () => boolean): Promise<void> {
  for (let round = 0; round < 200 && !predicate(); round++) {
    await flush();
  }
  assert.ok(predicate(), 'condition reached');
}

describe('connection targets: the pure helpers', () => {
  test('normalizeConnectionTarget(): local, or cloud with a usable omadacId; a clean copy; anything else null', () => {
    assert.deepEqual(normalizeConnectionTarget({ kind: 'local', omadacId: OMADAC_CLOUD }), { kind: 'local' });
    assert.deepEqual(normalizeConnectionTarget({ kind: 'cloud', omadacId: OMADAC_CLOUD, extra: 1 }), { kind: 'cloud', omadacId: OMADAC_CLOUD });
    for (const bad of [null, undefined, 'local', [], {}, { kind: 'cloud' }, { kind: 'cloud', omadacId: 'local' }, { kind: 'cloud', omadacId: '__proto__' }, { kind: 'cloud', omadacId: 'a b' }, { kind: 'remote' }]) {
      assert.equal(normalizeConnectionTarget(bad), null, JSON.stringify(bad));
    }
  });

  test('isSameTarget() and activeControllerValue()', () => {
    assert.equal(isSameTarget({ kind: 'local' }, { kind: 'local' }), true);
    assert.equal(isSameTarget({ kind: 'cloud', omadacId: OMADAC_CLOUD }, { kind: 'cloud', omadacId: OMADAC_CLOUD }), true);
    assert.equal(isSameTarget({ kind: 'cloud', omadacId: OMADAC_CLOUD }, { kind: 'cloud', omadacId: OMADAC_OTHER }), false);
    assert.equal(isSameTarget({ kind: 'local' }, { kind: 'cloud', omadacId: OMADAC_CLOUD }), false);
    assert.equal(activeControllerValue({ kind: 'local' }), 'local');
    assert.equal(activeControllerValue({ kind: 'cloud', omadacId: OMADAC_CLOUD }), OMADAC_CLOUD);
  });

  test('resolveStartupTarget(): the stored cloud controller only while the cloud credential is usable (the session-only secret included), else local', () => {
    const base: StoredConfig = { url: URL_A, username: 'admin', language: 'en' };
    assert.deepEqual(resolveStartupTarget(base, true), { kind: 'local' });
    assert.deepEqual(resolveStartupTarget({ ...base, activeController: 'local' }, true), { kind: 'local' });
    assert.deepEqual(resolveStartupTarget({ ...base, activeController: OMADAC_CLOUD }, true), { kind: 'cloud', omadacId: OMADAC_CLOUD });
    assert.deepEqual(resolveStartupTarget({ ...base, activeController: OMADAC_CLOUD }, false), { kind: 'local' }, 'unusable credential → local');
    assert.deepEqual(resolveStartupTarget({ ...base, activeController: 'not an id' }, true), { kind: 'local' });
    // Usability as config-model.ts decides it: a Client ID with no decryptable
    // secret is unusable (the I-1a leftover: activeController survives it);
    // the session-only secret makes it usable
    const box: SecretBox = {
      isEncryptionAvailable: () => true,
      isSecureStorageAvailable: () => false,
      encryptString: (plainText) => plainText,
      decryptString: (blob) => blob
    };
    const stored: StoredConfig = { ...base, activeController: OMADAC_CLOUD, cloudClientId: 'cloud-client-1', encryptedCloudClientSecret: 'blob' };
    assert.deepEqual(resolveStartupTarget(stored, cloudCredentialsOf(stored, box, null) !== null), { kind: 'local' });
    assert.deepEqual(resolveStartupTarget(stored, cloudCredentialsOf(stored, box, 'session-secret') !== null), { kind: 'cloud', omadacId: OMADAC_CLOUD });
  }); // End of test "resolveStartupTarget()..."
}); // End of describe 'connection targets: the pure helpers'

/**
 * A fake controller of either kind: connect() waits for the test
 * (connectResult), setApWlanGroup() for moveResult; close() / activate() /
 * logout() are recorded in order.
 */
class TargetController implements ManagedController {
  readonly kind: 'local' | 'cloud';
  readonly omadacId: string | null;
  readonly connectResult = deferred<ConnectOutcome>();
  readonly moveResult = deferred<boolean>();
  readonly preferredSiteIds: string[] = [];
  readonly events: string[] = [];
  readonly moves: string[] = [];
  private sites: SiteInfo[] = [];

  /**
   * Creates the fake.
   * @param {'local' | 'cloud'} kind - The controller kind.
   * @param {string | null} omadacId - What it reports as its omadacId.
   */
  constructor(kind: 'local' | 'cloud', omadacId: string | null) {
    this.kind = kind;
    this.omadacId = omadacId;
  }

  /**
   * Resolves when the test settles connectResult.
   * @param {string} [preferredSiteId] - The remembered site offered.
   * @returns {Promise<ConnectOutcome>} The outcome the test chose.
   */
  async connect(preferredSiteId?: string): Promise<ConnectOutcome> {
    this.preferredSiteIds.push(preferredSiteId ?? '(none)');
    const outcome = await this.connectResult.promise;
    this.sites = outcome.sites;
    return outcome;
  }

  /**
   * Accepts only a listed site id.
   * @param {string} siteId - The chosen id.
   * @returns {boolean} True when listed.
   */
  selectSite(siteId: string): boolean {
    return this.sites.some((site) => site.id === siteId);
  }

  /** Records the close. */
  close(): void {
    this.events.push('close');
  }

  /**
   * Records the activation.
   * @returns {{ sessionNonce: string }} The success details.
   */
  activate(): { sessionNonce: string } {
    this.events.push('activate');
    return { sessionNonce: NONCE };
  }

  /**
   * Records the logout.
   * @returns {Promise<void>} Resolves at once.
   */
  logout(): Promise<void> {
    this.events.push('logout');
    return Promise.resolve();
  }

  /**
   * Records a move and waits for moveResult (as OMADA_SET_WLAN would call it).
   * @param {string} mac - The AP.
   * @param {string} wlanId - The group.
   * @returns {Promise<boolean>} The move result.
   */
  setApWlanGroup(mac: string, wlanId: string): Promise<boolean> {
    this.moves.push(`${mac}>${wlanId}`);
    return this.moveResult.promise;
  }
} // End of class TargetController

/**
 * The fake environment: config values, every persisted write (in order),
 * every controller created, every cloud lookup (settled by the test) and the
 * state machine.
 */
class TargetHarness {
  url = URL_A;
  storedSiteId = '';
  localOmadacId = '';
  cloudSites: Record<string, string> = {};
  sessionId = 1;
  // What the next local controller reports as its omadacId
  learnedId: string | null = OMADAC_LOCAL;
  activeWriteFails = false;
  readonly writes: string[] = [];
  readonly controllers: TargetController[] = [];
  readonly lookups: Array<{ omadacId: string; reply: Deferred<CloudControllerLookup<TargetController>> }> = [];
  readonly manager: ConnectionManager<TargetController>;

  /**
   * Builds the state machine over the fakes.
   * @param {{ cloud?: boolean }} [options] - `cloud: false` leaves the cloud side out.
   */
  constructor(options: { cloud?: boolean } = {}) {
    this.manager = new ConnectionManager<TargetController>({
      getCredentials: () => ({ url: this.url, username: 'admin', password: 's3cret' }),
      createController: () => this.track(new TargetController('local', this.learnedId)),
      getConfiguredUrl: () => this.url,
      getStoredSiteId: () => this.storedSiteId,
      saveStoredSiteId: (siteId) => {
        this.storedSiteId = siteId;
        this.writes.push(`siteId=${siteId}`);
      },
      saveCertificatePin: () => true,
      clearCertificatePin: () => true,
      resetControllerSession: () => {
        this.sessionId++;
        return Promise.resolve();
      },
      logoutDrainMs: 20,
      getLocalOmadacId: () => this.localOmadacId,
      saveLocalOmadacId: (url, omadacId) => {
        this.localOmadacId = omadacId;
        this.writes.push(`localOmadacId=${omadacId}@${url}`);
      },
      saveActiveController: (value) => {
        this.writes.push(`activeController=${value}`);
        return !this.activeWriteFails;
      },
      cloud:
        options.cloud === false
          ? undefined
          : {
              lookupController: (omadacId) => {
                const reply = deferred<CloudControllerLookup<TargetController>>();
                this.lookups.push({ omadacId, reply });
                return reply.promise;
              },
              getCloudSiteId: (omadacId) => this.cloudSites[omadacId] ?? '',
              saveCloudSiteId: (omadacId, siteId) => {
                this.cloudSites[omadacId] = siteId;
                this.writes.push(`cloudSites[${omadacId}]=${siteId}`);
              }
            }
    });
  } // End of constructor()

  /**
   * Records a created controller.
   * @param {TargetController} controller - The controller.
   * @returns {TargetController} The same controller.
   */
  track(controller: TargetController): TargetController {
    this.controllers.push(controller);
    return controller;
  }

  /**
   * A connectable lookup answer whose factory creates a cloud fake.
   * @param {string} omadacId - The organization.
   * @returns {CloudControllerLookup<TargetController>} The answer.
   */
  found(omadacId: string): CloudControllerLookup<TargetController> {
    return { ok: true, create: () => this.track(new TargetController('cloud', omadacId)), secrets: () => ['routing-secret-value'] };
  }

  /**
   * The most recently created controller.
   * @returns {TargetController} It.
   */
  get latest(): TargetController {
    const controller = this.controllers[this.controllers.length - 1];
    assert.ok(controller, 'a controller was created');
    return controller;
  }

  /**
   * Connects the current (local) target fully on a single-site controller.
   * @returns {Promise<TargetController>} The installed controller.
   */
  async connectLocal(): Promise<TargetController> {
    const pending = this.manager.connect();
    await flush();
    const controller = this.latest;
    controller.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await pending, { success: true, sessionNonce: NONCE });
    assert.equal(this.manager.controller, controller);
    return controller;
  }

  /**
   * Switches to a cloud target and completes its lookup and connect.
   * @param {string} omadacId - The cloud controller.
   * @param {ConnectOutcome} [outcome] - Its connect outcome (one site by default).
   * @returns {Promise<{ result: ConnectionResult; controller: TargetController }>} The result and the cloud fake.
   */
  async switchToCloud(omadacId: string, outcome: ConnectOutcome = { siteSelected: true, sites: [SITES[0]] }): Promise<{ result: ConnectionResult; controller: TargetController }> {
    const pending = this.manager.switchTarget({ kind: 'cloud', omadacId });
    await flush();
    this.lookups[this.lookups.length - 1].reply.resolve(this.found(omadacId));
    await flush();
    const controller = this.latest;
    assert.equal(controller.kind, 'cloud');
    controller.connectResult.resolve(outcome);
    return { result: await pending, controller };
  } // End of function switchToCloud()
} // End of class TargetHarness

describe('ConnectionManager targets: switchTarget()', () => {
  test('the target starts local and is read as a copy; an invalid target is refused before any state change', async () => {
    const harness = new TargetHarness();
    assert.deepEqual(harness.manager.target, { kind: 'local' });
    const copy = harness.manager.target as { kind: string };
    copy.kind = 'cloud';
    assert.deepEqual(harness.manager.target, { kind: 'local' });
    const installed = await harness.connectLocal();
    const before = harness.sessionId;
    for (const bad of [{ kind: 'cloud', omadacId: 'local' }, { kind: 'cloud', omadacId: 'a b' }, { kind: 'cloud' }, { kind: 'remote' }, null]) {
      await assert.rejects(harness.manager.switchTarget(bad as unknown as ConnectionTarget), /Connection target rejected/);
    }
    assert.equal(harness.manager.controller, installed);
    assert.deepEqual(installed.events, ['activate']);
    assert.equal(harness.sessionId, before);
    assert.equal(harness.writes.some((write) => write.startsWith('activeController')), false);
  }); // End of test "the target starts local..."

  test('the URL-change invalidation runs synchronously before any await; then activeController is persisted and the new target connects', async () => {
    const harness = new TargetHarness();
    const local = await harness.connectLocal();
    const before = harness.sessionId;
    const pending = harness.manager.switchTarget({ kind: 'cloud', omadacId: OMADAC_CLOUD });
    // The synchronous part of the switch
    assert.equal(harness.manager.controller, null, 'detached at once');
    assert.ok(local.events.indexOf('close') > 0 && local.events.indexOf('close') < local.events.indexOf('logout'), local.events.join());
    assert.equal(harness.sessionId, before + 1, 'controller TLS session replaced in the same step');
    assert.deepEqual(harness.manager.target, { kind: 'cloud', omadacId: OMADAC_CLOUD });
    assert.equal(harness.writes[harness.writes.length - 1], `activeController=${OMADAC_CLOUD}`);
    assert.deepEqual(harness.lookups.map((lookup) => lookup.omadacId), [OMADAC_CLOUD], 'the fresh lookup started in the same step');
    // The connect of the new target
    harness.lookups[0].reply.resolve(harness.found(OMADAC_CLOUD));
    await flush();
    const cloud = harness.latest;
    assert.equal(cloud.kind, 'cloud');
    assert.deepEqual(cloud.preferredSiteIds, [''], 'no remembered cloud site');
    cloud.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await pending, { success: true, sessionNonce: NONCE });
    assert.equal(harness.manager.controller, cloud);
    assert.deepEqual(cloud.events, ['activate']);
    assert.ok(!harness.writes.some((write) => write.startsWith('siteId') || write.startsWith('cloudSites')), 'an automatic pick is not persisted');
  }); // End of test "the URL-change invalidation runs synchronously..."

  test('a switch during a local connect: the old attempt is never installed and neither its omadacId nor its site is persisted', async () => {
    const harness = new TargetHarness();
    const single = harness.manager.connect();
    await flush();
    const stale = harness.controllers[0];
    const switching = harness.manager.switchTarget({ kind: 'cloud', omadacId: OMADAC_CLOUD });
    stale.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await single, SUPERSEDED);
    assert.ok(stale.events.includes('logout') && !stale.events.includes('activate'));
    // A multi-site local attempt overtaken the same way parks nothing
    const back = harness.manager.switchTarget({ kind: 'local' });
    await flush();
    const multi = harness.latest;
    // The first switch's lookup answers late: overtaken, it builds nothing
    harness.lookups[0].reply.resolve(harness.found(OMADAC_CLOUD));
    assert.deepEqual(await switching, SUPERSEDED, 'the first switch was overtaken too');
    assert.equal(harness.controllers.filter((controller) => controller.kind === 'cloud').length, 0);
    const overtaking = harness.manager.switchTarget({ kind: 'cloud', omadacId: OMADAC_CLOUD });
    multi.connectResult.resolve({ siteSelected: false, sites: SITES });
    assert.deepEqual(await back, SUPERSEDED);
    harness.lookups[harness.lookups.length - 1].reply.resolve(harness.found(OMADAC_CLOUD));
    await flush();
    harness.latest.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.equal((await overtaking).success, true);
    assert.equal(harness.manager.controller?.kind, 'cloud');
    assert.deepEqual(harness.writes, [`activeController=${OMADAC_CLOUD}`, 'activeController=local', `activeController=${OMADAC_CLOUD}`]);
    assert.equal(harness.localOmadacId, '');
  }); // End of test "a switch during a local connect..."

  test('a switch while a local site choice is pending: the old nonce is refused and no site is persisted', async () => {
    const harness = new TargetHarness();
    const pending = harness.manager.connect();
    await flush();
    const parked = harness.latest;
    parked.connectResult.resolve({ siteSelected: false, sites: SITES });
    const result = await pending;
    assert.equal(result.needsSiteSelection, true);
    const { result: switched } = await harness.switchToCloud(OMADAC_CLOUD);
    assert.equal(switched.success, true);
    assert.ok(parked.events.includes('logout'));
    assert.deepEqual(harness.manager.selectSite('site-b', result.selectionNonce as string), { success: false, error: 'siteUnavailable' });
    assert.deepEqual(harness.writes, [`activeController=${OMADAC_CLOUD}`]);
  }); // End of test "a switch while a local site choice is pending..."

  test('a switch during a cloud lookup: the late organization entry builds no session', async () => {
    const harness = new TargetHarness();
    const first = harness.manager.switchTarget({ kind: 'cloud', omadacId: OMADAC_CLOUD });
    await flush();
    const second = harness.manager.switchTarget({ kind: 'local' });
    await flush();
    harness.lookups[0].reply.resolve(harness.found(OMADAC_CLOUD));
    assert.deepEqual(await first, SUPERSEDED);
    assert.equal(harness.controllers.filter((controller) => controller.kind === 'cloud').length, 0, 'no cloud session was built');
    harness.latest.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.equal((await second).success, true);
    assert.equal(harness.manager.controller?.kind, 'local');
    assert.deepEqual(harness.writes, [`activeController=${OMADAC_CLOUD}`, 'activeController=local', `localOmadacId=${OMADAC_LOCAL}@${URL_A}`]);
  }); // End of test "a switch during a cloud lookup..."

  test('a switch during a cloud connect: the late session is released, never installed, and the next cloud site choice goes to cloudSites only', async () => {
    const harness = new TargetHarness();
    harness.storedSiteId = 'site-local';
    const first = harness.manager.switchTarget({ kind: 'cloud', omadacId: OMADAC_CLOUD });
    await flush();
    harness.lookups[0].reply.resolve(harness.found(OMADAC_CLOUD));
    await flush();
    const stale = harness.latest;
    const second = harness.manager.switchTarget({ kind: 'cloud', omadacId: OMADAC_OTHER });
    await flush();
    stale.connectResult.resolve({ siteSelected: false, sites: SITES });
    assert.deepEqual(await first, SUPERSEDED);
    assert.ok(stale.events.includes('logout') && !stale.events.includes('activate'));
    harness.lookups[1].reply.resolve(harness.found(OMADAC_OTHER));
    await flush();
    const other = harness.latest;
    other.connectResult.resolve({ siteSelected: false, sites: SITES });
    const parked = await second;
    assert.equal(parked.needsSiteSelection, true);
    assert.deepEqual(harness.manager.selectSite('site-b', parked.selectionNonce as string), { success: true, sessionNonce: NONCE });
    assert.equal(harness.manager.controller, other);
    assert.deepEqual(harness.cloudSites, { [OMADAC_OTHER]: 'site-b' });
    assert.equal(harness.storedSiteId, 'site-local', 'the local siteId is never touched by a cloud choice');
    assert.equal(harness.localOmadacId, '', 'a cloud session never sets localOmadacId');
    // The remembered cloud site is offered to the next connect of that controller
    const again = harness.manager.connect();
    await flush();
    harness.lookups[2].reply.resolve(harness.found(OMADAC_OTHER));
    await flush();
    assert.deepEqual(harness.latest.preferredSiteIds, ['site-b']);
    harness.latest.connectResult.resolve({ siteSelected: true, sites: SITES });
    assert.equal((await again).success, true);
  }); // End of test "a switch during a cloud connect..."

  test('a switch during a move: the late result belongs to the detached controller only', async () => {
    const harness = new TargetHarness();
    const local = await harness.connectLocal();
    // A move already running on the installed controller (OMADA_SET_WLAN checked its nonce before it started)
    const move = local.setApWlanGroup('AA-BB-CC-00-00-01', 'group-1');
    const { controller: cloud } = await harness.switchToCloud(OMADAC_CLOUD);
    local.moveResult.resolve(true);
    assert.equal(await move, true);
    assert.equal(harness.manager.controller, cloud);
    assert.deepEqual(cloud.moves, []);
    assert.ok(local.events.includes('logout'));
  }); // End of test "a switch during a move..."

  test('local → cloud → local: each step installs its kind, releases the previous one and persists activeController', async () => {
    const harness = new TargetHarness();
    const local = await harness.connectLocal();
    const { result, controller: cloud } = await harness.switchToCloud(OMADAC_CLOUD);
    assert.deepEqual(result, { success: true, sessionNonce: NONCE });
    assert.ok(local.events.includes('logout'));
    const back = harness.manager.switchTarget({ kind: 'local' });
    assert.equal(harness.manager.controller, null);
    assert.ok(cloud.events.includes('close') && cloud.events.includes('logout'));
    harness.latest.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await back, { success: true, sessionNonce: NONCE });
    assert.equal((harness.manager.controller as TargetController | null)?.kind, 'local');
    assert.deepEqual(harness.manager.target, { kind: 'local' });
    assert.deepEqual(harness.writes, [`localOmadacId=${OMADAC_LOCAL}@${URL_A}`, `activeController=${OMADAC_CLOUD}`, 'activeController=local']);
  }); // End of test "local → cloud → local..."

  test('a switch to the current target is a plain reconnect through the full transition', async () => {
    const harness = new TargetHarness();
    const first = await harness.connectLocal();
    const again = harness.manager.switchTarget({ kind: 'local' });
    assert.equal(harness.manager.controller, null);
    assert.ok(first.events.includes('logout'));
    harness.latest.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.equal((await again).success, true);
    assert.notEqual(harness.manager.controller, first);
  });

  test('a failed activeController write does not stop the switch (this run only)', async () => {
    const harness = new TargetHarness();
    harness.activeWriteFails = true;
    const { result } = await harness.switchToCloud(OMADAC_CLOUD);
    assert.equal(result.success, true);
    assert.deepEqual(harness.manager.target, { kind: 'cloud', omadacId: OMADAC_CLOUD });
  });
}); // End of describe 'ConnectionManager targets: switchTarget()'

describe('ConnectionManager targets: cloud refusals, localOmadacId, config saves', () => {
  test('a refused lookup is connectError with a code-first detail; no session is built', async () => {
    const cases: Array<[string, string | undefined, string]> = [
      ['notConfigured', undefined, 'notConfigured'],
      ['credentialInvalid', 'credentialInvalid, errorCode -52602', 'credentialInvalid (errorCode -52602)'],
      ['superseded', undefined, 'superseded'],
      ['unknownController', undefined, 'unknownController'],
      ['listIncomplete', 'organization list incomplete', 'listIncomplete (organization list incomplete)'],
      ['notController', undefined, 'notController'],
      ['incompleteEntry', undefined, 'incompleteEntry'],
      ['unsupportedHost', undefined, 'unsupportedHost'],
      ['versionUnknown', undefined, 'versionUnknown'],
      ['versionTooOld', undefined, 'versionTooOld'],
      ['offline', undefined, 'offline']
    ];
    for (const [code, diagnostic, detail] of cases) {
      const harness = new TargetHarness();
      const pending = harness.manager.switchTarget({ kind: 'cloud', omadacId: OMADAC_CLOUD });
      await flush();
      harness.lookups[0].reply.resolve(diagnostic === undefined ? { ok: false, code } : { ok: false, code, diagnostic });
      assert.deepEqual(await pending, { success: false, error: 'connectError', detail }, code);
      assert.equal(harness.controllers.length, 0, `${code}: no session`);
      assert.equal(harness.manager.controller, null);
    } // End of the loop over the refusal codes
    const bare = new TargetHarness({ cloud: false });
    assert.deepEqual(await bare.manager.switchTarget({ kind: 'cloud', omadacId: OMADAC_CLOUD }), { success: false, error: 'connectError', detail: 'cloudUnavailable' });
  }); // End of test "a refused lookup is connectError..."

  test('a failing cloud session connect: the detail starts with the CloudSessionError code and is scrubbed of the lookup\'s values', async () => {
    const harness = new TargetHarness();
    const pending = harness.manager.switchTarget({ kind: 'cloud', omadacId: OMADAC_CLOUD });
    await flush();
    harness.lookups[0].reply.resolve(harness.found(OMADAC_CLOUD));
    await flush();
    harness.latest.connectResult.reject(new CloudSessionError('requestFailed', 'sites: apiError, errorCode -1 (no routing-secret-value)', 'apiError'));
    assert.deepEqual(await pending, { success: false, error: 'connectError', detail: `requestFailed (sites: apiError, errorCode -1 (no ${REDACTED}))` });
    assert.ok(harness.latest.events.includes('logout'), 'the failed session is released');
    assert.equal(harness.manager.controller, null);
  });

  test('localOmadacId: learned on a successful local connect or site choice, persisted only when it changed; never from a failed connect or an unusable id', async () => {
    const harness = new TargetHarness();
    await harness.connectLocal();
    await harness.connectLocal();
    assert.deepEqual(harness.writes, [`localOmadacId=${OMADAC_LOCAL}@${URL_A}`], 'one write for an unchanged id');
    // Another controller behind the same URL, completed through a site choice
    harness.learnedId = OMADAC_OTHER;
    const pending = harness.manager.connect();
    await flush();
    harness.latest.connectResult.resolve({ siteSelected: false, sites: SITES });
    const parked = await pending;
    assert.equal(harness.writes.length, 1, 'nothing persisted while the site choice is pending');
    assert.equal(harness.manager.selectSite('site-a', parked.selectionNonce as string).success, true);
    assert.deepEqual(harness.writes.slice(1), [`localOmadacId=${OMADAC_OTHER}@${URL_A}`, 'siteId=site-a']);
    // Unusable ids and failures persist nothing
    for (const id of ['local', null, 'a b']) {
      harness.learnedId = id;
      await harness.connectLocal();
    }
    harness.learnedId = OMADAC_CLOUD;
    const failing = harness.manager.connect();
    await flush();
    harness.latest.connectResult.reject(new Error('net::ERR_CONNECTION_REFUSED'));
    assert.equal((await failing).error, 'connectError');
    assert.equal(harness.writes.length, 3);
    assert.equal(harness.localOmadacId, OMADAC_OTHER);
  }); // End of test "localOmadacId..."

  test('applyConfigSave(): a cloud credential change detaches a cloud target\'s session and supersedes its connect; on the local target it changes nothing', async () => {
    const harness = new TargetHarness();
    const local = await harness.connectLocal();
    await harness.manager.applyConfigSave(() => ({ success: true, urlChanged: false, cloudCredentialsChanged: true }));
    assert.equal(harness.manager.controller, local, 'the local session does not use the cloud account');
    const { controller: cloud } = await harness.switchToCloud(OMADAC_CLOUD);
    const before = harness.sessionId;
    const saving = harness.manager.applyConfigSave(() => ({ success: true, urlChanged: false, cloudCredentialsChanged: true }));
    assert.equal(harness.manager.controller, null);
    assert.ok(cloud.events.includes('logout'));
    assert.equal(harness.sessionId, before + 1);
    await saving;
    assert.deepEqual(harness.manager.target, { kind: 'cloud', omadacId: OMADAC_CLOUD }, 'the target stays');
    // A cloud connect in flight is superseded the same way
    const pending = harness.manager.connect();
    await flush();
    await harness.manager.applyConfigSave(() => ({ success: true, cloudCredentialsChanged: true }));
    harness.lookups[harness.lookups.length - 1].reply.resolve(harness.found(OMADAC_CLOUD));
    assert.deepEqual(await pending, SUPERSEDED);
    assert.equal(harness.controllers.filter((controller) => controller.kind === 'cloud').length, 1, 'no session built for the stale lookup');
    // A failed save changes nothing
    const { controller: again } = await harness.switchToCloud(OMADAC_CLOUD);
    await harness.manager.applyConfigSave(() => ({ success: false, cloudCredentialsChanged: true }));
    assert.equal(harness.manager.controller, again);
  }); // End of test "applyConfigSave(): a cloud credential change..."
}); // End of describe 'cloud refusals, localOmadacId, config saves'

describe('the cloud error mapping (code first)', () => {
  test('describeCloudSessionError(): the code, then the Open API code unless the diagnostic names it, then the diagnostic', () => {
    assert.equal(describeCloudSessionError('notConnected', '', null), 'notConnected');
    assert.equal(describeCloudSessionError('requestFailed', 'sites: rateLimited, HTTP 429', 'rateLimited'), 'requestFailed (sites: rateLimited, HTTP 429)');
    assert.equal(describeCloudSessionError('requestFailed', 'sites read failed', 'invalidCredentials'), 'requestFailed (invalidCredentials; sites read failed)');
    assert.equal(describeCloudSessionError('moveRequestFailed', '', 'timeout'), 'moveRequestFailed (timeout)');
    assert.equal(new CloudSessionError('requestFailed', 'x', 'timeout').message, 'requestFailed (timeout; x)');
    assert.equal(new CloudSessionError('moveNotConfirmed', 'AP listed in another group, 3 reads').message, 'moveNotConfirmed (AP listed in another group, 3 reads)');
  });

  test('connectFailureDetail(): a cloud failure code first, a local failure unchanged; both scrubbed by value', () => {
    assert.equal(connectFailureDetail(new CloudSessionError('noSites', 'sites 0'), []), 'noSites (sites 0)');
    assert.equal(connectFailureDetail(new CloudSessionError('requestFailed', 'echo deviceValue1', 'apiError'), ['deviceValue1']), `requestFailed (apiError; echo ${REDACTED})`);
    assert.equal(connectFailureDetail(new Error('Login failed: s3cret'), ['s3cret']), `Login failed: ${REDACTED}`);
    assert.equal(cloudRefusalDetail('offline'), 'offline');
    assert.equal(cloudRefusalDetail('apiError', 'apiError, token request failed: errorCode -90114'), 'apiError (token request failed: errorCode -90114)');
    assert.equal(cloudRefusalDetail('notConfigured', 'notConfigured'), 'notConfigured');
  });
}); // End of describe 'the cloud error mapping (code first)'

// ---------------------------------------------------------------------------
// End to end on fixtures: the real sessions, cloud access and cloud route
// ---------------------------------------------------------------------------

const BASE_URL = 'https://controller.invalid:8043';
const LOCAL_ID = responses.apiInfo.result.omadacId;
const LOCAL_SITE = responses.sitesSingle.result.data[0].id;
const LOCAL_GROUPS = responses.wlans.result.data.map((group) => ({ id: group.id, name: group.name }));
const LOCAL_AP_GROUPS = `/openapi/v1/${LOCAL_ID}/sites/${LOCAL_SITE}/ap-groups?page=1&pageSize=100`;
const EUW = 'https://euw1-omada-northbound.tplinkcloud.com';
const PLANTA_4 = fourOrganizations.page.result.data[3];
const CLOUD_ID = PLANTA_4.omadacId;
const DEVICE_ID = PLANTA_4.deviceId;
const TUNNEL = `${EUW}/v1/cloudaccess/${DEVICE_ID}/openapi/v1/${CLOUD_ID}`;
const TOKEN_URL = `${EUW}${CLOUD_TOKEN_PATH}`;
const ORGS_URL = `${EUW}${CLOUD_ORGANIZATIONS_PATH}?page=1&pageSize=100`;
const CLOUD_SITES = `${TUNNEL}/sites?page=1&pageSize=100`;
const CLOUD_SITE = tunnel.siteId;
const CLOUD_SITE_2 = tunnel.sitesTwo.result.data[1].siteId;
const CLOUD_AP_GROUPS = `${TUNNEL}/sites/${CLOUD_SITE}/ap-groups?page=1&pageSize=100`;
const MAC_1 = 'AA-BB-CC-00-00-01';
const SILENCIO_ID = tunnel.groupIds.silencio;
const MOVE_URL = `${TUNNEL}/sites/${CLOUD_SITE}/aps/${MAC_1}/wlan-group`;
const CLOUD_SECRET = 'cloudTargetSecret0123456789abcdef';
const CREDENTIALS: CloudCredentials = { region: 'euw', clientId: 'cloud-client-1', clientSecret: CLOUD_SECRET };

/**
 * A successful Open API envelope.
 * @param {unknown} [result] - The result (absent for writes).
 * @returns {FakeReply} The reply.
 */
function ok(result?: unknown): FakeReply {
  return { body: result === undefined ? { errorCode: 0, msg: 'Success.' } : { errorCode: 0, msg: 'Success.', result } };
}

/**
 * A reply held until the test releases it.
 * @returns {{ route: () => Promise<FakeReply>; release(reply: FakeReply): void; readonly held: boolean }} The route and its release.
 */
function heldReply(): { route: () => Promise<FakeReply>; release(reply: FakeReply): void; readonly held: boolean } {
  let release: ((reply: FakeReply) => void) | null = null;
  return {
    route: () =>
      new Promise<FakeReply>((resolve) => {
        release = resolve;
      }),
    release: (reply: FakeReply) => {
      assert.ok(release, 'the request was made');
      release(reply);
    },
    get held(): boolean {
      return release !== null;
    }
  };
} // End of function heldReply()

/**
 * The real stack over two fake transports: the local controller (internal
 * API + Open API fixtures) and the TP-Link cloud (the account and the
 * organization's tunnel), CloudAccessService with the saved credential, the
 * production lookup (createCloudControllerLookup()) and a ConnectionManager
 * recording every persisted value.
 */
class LiveHarness {
  readonly clock = new FakeClock();
  readonly localTransport = new FakeTransport(BASE_URL);
  readonly cloudTransport = new FakeTransport('');
  readonly tokens: string[] = [];
  readonly cloudClients: OpenApiClient[] = [];
  readonly cloudSessions: ControllerSession[] = [];
  readonly config = { siteId: '', localOmadacId: '', cloudSites: {} as Record<string, string> };
  readonly saved = { localOmadacId: [] as string[], activeController: [] as string[], siteId: [] as string[], cloudSites: [] as string[] };
  cloudCredentials: CloudCredentials | null = CREDENTIALS;
  managementCredentials: ManagementCredentials | null = null;
  readonly access: CloudAccessService;
  readonly manager: ConnectionManager<ControllerSession>;

  /**
   * Builds the stack; the organization list is the four-organization account.
   */
  constructor() {
    this.localTransport
      .on('GET', '/api/info', { body: responses.apiInfo, setCookie: 'TPOMADA_SESSIONID=session-1; Path=/; HttpOnly' })
      .on('POST', `/${LOCAL_ID}/api/v2/login`, { body: responses.loginOk })
      .on('GET', `/${LOCAL_ID}/api/v2/sites?currentPage=1&currentPageSize=100`, { body: responses.sitesSingle })
      .on('GET', `/${LOCAL_ID}/api/v2/sites/${LOCAL_SITE}/setting/wlans`, { body: responses.wlans })
      .on('GET', `/${LOCAL_ID}/api/v2/sites/${LOCAL_SITE}/setting/ssids`, { body: responses.ssids })
      .on('GET', `/${LOCAL_ID}/api/v2/sites/${LOCAL_SITE}/devices`, { body: responses.devices })
      .on('POST', `/${LOCAL_ID}/api/v2/logout`, { body: responses.ok })
      .on('POST', TOKEN_PATH, ok({ accessToken: 'AT-local-session-token-1', tokenType: 'bearer', expiresIn: 7200, refreshToken: 'RT-local' }))
      .on('GET', `/openapi/v1/${LOCAL_ID}/sites?page=1&pageSize=100`, ok({ totalRows: 1, currentPage: 1, currentSize: 1, data: [{ siteId: LOCAL_SITE, name: 'Casa' }] }))
      .on('GET', LOCAL_AP_GROUPS, ok({ totalRows: LOCAL_GROUPS.length, currentPage: 1, currentSize: LOCAL_GROUPS.length, data: LOCAL_GROUPS.map((group) => ({ ...group, apNum: 1 })) }));
    this.cloudTransport
      .on('POST', TOKEN_URL, () => {
        const token = `a1-AT-targetToken${String(this.tokens.length + 1).padStart(8, '0')}`;
        this.tokens.push(token);
        return ok({ accessToken: token, tokenType: 'bearer', expiresIn: 7200, refreshToken: 'RT-neverUsedRefreshTokenValue0000' });
      })
      .on('GET', ORGS_URL, { body: fourOrganizations.page })
      .on('GET', CLOUD_SITES, { body: tunnel.sites })
      .on('GET', CLOUD_AP_GROUPS, { body: tunnel.apGroups })
      .on('GET', `${TUNNEL}/sites/${CLOUD_SITE}/ap-groups/aps?page=1&pageSize=100`, { body: tunnel.apGroupApsPage1 })
      .on('GET', `${TUNNEL}/sites/${CLOUD_SITE}/ap-groups/aps?page=2&pageSize=100`, { body: tunnel.apGroupApsPage2 });
    this.access = new CloudAccessService({ getCredentials: () => this.cloudCredentials, transport: this.cloudTransport, now: this.clock.now, sleep: this.clock.sleep });
    const lookup = createCloudControllerLookup({
      access: this.access,
      transport: this.cloudTransport,
      sleep: async () => undefined,
      createOpenApiClient: (options) => {
        const client = new OpenApiClient(options);
        this.cloudClients.push(client);
        return client;
      }
    });
    this.manager = new ConnectionManager<ControllerSession>({
      getCredentials: () => ({ url: BASE_URL, username: 'admin', password: 'internal-password' }),
      createController: (credentials) =>
        new ControllerSession({
          ...credentials,
          transport: this.localTransport,
          getManagementCredentials: () => this.managementCredentials,
          getConfiguredUrl: () => BASE_URL
        }),
      getConfiguredUrl: () => BASE_URL,
      getStoredSiteId: () => this.config.siteId,
      saveStoredSiteId: (siteId) => void this.saved.siteId.push(siteId),
      saveCertificatePin: () => true,
      clearCertificatePin: () => true,
      resetControllerSession: () => Promise.resolve(),
      logoutDrainMs: 20,
      getLocalOmadacId: () => this.config.localOmadacId,
      saveLocalOmadacId: (url, omadacId) => {
        assert.equal(url, BASE_URL);
        this.config.localOmadacId = omadacId;
        this.saved.localOmadacId.push(omadacId);
      },
      saveActiveController: (value) => {
        this.saved.activeController.push(value);
        return true;
      },
      cloud: {
        lookupController: async (omadacId) => {
          const found = await lookup(omadacId);
          if (!found.ok) {
            return found;
          }
          return {
            ok: true,
            secrets: found.secrets,
            create: () => {
              const session = found.create();
              this.cloudSessions.push(session);
              return session;
            }
          };
        }, // End of the recording lookup
        getCloudSiteId: (omadacId) => this.config.cloudSites[omadacId] ?? '',
        saveCloudSiteId: (omadacId, siteId) => {
          this.config.cloudSites[omadacId] = siteId;
          this.saved.cloudSites.push(`${omadacId}=${siteId}`);
        }
      }
    });
  } // End of constructor()

  /**
   * Switches to the Planta 4 cloud controller and waits for management on.
   * @returns {Promise<string>} The session nonce.
   */
  async switchCloudManaged(): Promise<string> {
    const result = await this.manager.switchTarget({ kind: 'cloud', omadacId: CLOUD_ID });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.ok(result.sessionNonce);
    assert.deepEqual(await getSessionCapabilities(this.manager, result.sessionNonce), { success: true, capabilities: managementOn() });
    return result.sessionNonce;
  }

  /**
   * The installed session (asserted).
   * @returns {ControllerSession} It.
   */
  get installed(): ControllerSession {
    const session = this.manager.controller;
    assert.ok(session, 'a session is installed');
    return session;
  }

  /**
   * Asserts a text carries no routing identifier, secret or token.
   * @param {string} text - The text (a detail, a message).
   */
  assertClean(text: string): void {
    for (const value of [DEVICE_ID, 'tplinkcloud', 'serverHost', CLOUD_SECRET, ...this.tokens]) {
      assert.ok(!text.includes(value), `${value} in ${text}`);
    }
  }
} // End of class LiveHarness

describe('cloud targets end to end (fixtures)', () => {
  test('the session is built from a fresh organization entry: Open API only, on the organization\'s tunnel, with the account token', async () => {
    const harness = new LiveHarness();
    const nonce = await harness.switchCloudManaged();
    assert.match(nonce, /^[0-9a-f]{32}$/);
    const session = harness.installed;
    assert.equal(session.kind, 'cloud');
    assert.equal(session.url, '');
    assert.equal(session.omadacId, CLOUD_ID);
    assert.equal(session.controllerName, 'OC200 Planta 4');
    assert.equal(session.controllerVersion, '6.3.0.45');
    assert.deepEqual(session.site, { id: CLOUD_SITE, name: 'Planta 4' });
    assert.deepEqual(harness.cloudTransport.log().slice(0, 3), [`POST ${TOKEN_URL}`, `GET ${ORGS_URL}`, `GET ${CLOUD_SITES}`]);
    const tunnelled = harness.cloudTransport.requests.filter((request) => request.url.startsWith(TUNNEL));
    assert.ok(tunnelled.length >= 2);
    assert.ok(tunnelled.every((request) => request.headers.Authorization === `AccessToken=${harness.tokens[0]}`), 'the account token on every tunnelled call');
    assert.ok(harness.cloudClients.length >= 2 && harness.cloudClients.every((client) => client.route === 'cloud' && client.omadacId === CLOUD_ID));
    assert.equal(harness.localTransport.requests.length, 0, 'nothing went to the local controller');
    assert.deepEqual(harness.saved.activeController, [CLOUD_ID]);
    assert.deepEqual(harness.saved.localOmadacId, [], 'a cloud session never sets localOmadacId');
    // Every connect reads the organization list again
    assert.equal((await harness.manager.connect()).success, true);
    assert.equal(harness.cloudTransport.requestsTo('GET', ORGS_URL).length, 2);
    assert.equal(harness.cloudTransport.requestsTo('POST', TOKEN_URL).length, 1, 'the account token is reused');
    assert.equal((await harness.installed.getAccessPoints()).length, 4);
  }); // End of test "the session is built from a fresh organization entry..."

  test('refusals before any session: no credential, an account failure, an unknown omadacId, each non-connectable organization', async () => {
    const unsupported = structuredClone(fourOrganizations.page);
    unsupported.result.data[3].serverHost = 'https://euw1-omada-northbound.example.com';
    const cases: Array<[string, (harness: LiveHarness) => void, string, string]> = [
      ['no credential', (harness) => void (harness.cloudCredentials = null), CLOUD_ID, 'notConfigured'],
      ['credential refused', (harness) => void harness.cloudTransport.on('POST', TOKEN_URL, { body: { errorCode: -52602, msg: 'This Open API Application has expired or does not exist.' } }), CLOUD_ID, 'credentialInvalid (errorCode -52602)'],
      ['unknown omadacId', () => undefined, '5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e', 'unknownController'],
      ['offline', () => undefined, fourOrganizations.page.result.data[1].omadacId, 'offline'],
      ['below 6.3', () => undefined, fourOrganizations.page.result.data[2].omadacId, 'versionTooOld'],
      ['unsupported host', (harness) => void harness.cloudTransport.on('GET', ORGS_URL, { body: unsupported }), CLOUD_ID, 'unsupportedHost']
    ];
    for (const [name, arrange, omadacId, detail] of cases) {
      const harness = new LiveHarness();
      arrange(harness);
      const result = await harness.manager.switchTarget({ kind: 'cloud', omadacId });
      assert.deepEqual(result, { success: false, error: 'connectError', detail }, name);
      harness.assertClean(JSON.stringify(result));
      assert.equal(harness.cloudSessions.length, 0, `${name}: no session built`);
      assert.equal(harness.cloudClients.length, 0, `${name}: no cloud-route client`);
      assert.ok(harness.cloudTransport.requests.every((request) => request.url === TOKEN_URL || request.url === ORGS_URL), `${name}: no tunnel request`);
      assert.equal(harness.manager.controller, null);
    } // End of the loop over the refusals
  }); // End of test "refusals before any session..."

  test('a failing cloud session: the connect detail starts with its code and carries no routing identifier, secret or token', async () => {
    const harness = new LiveHarness();
    harness.cloudTransport.on('GET', CLOUD_SITES, { status: 503, body: '<html>maintenance</html>' });
    const failed = await harness.manager.switchTarget({ kind: 'cloud', omadacId: CLOUD_ID });
    assert.deepEqual(failed, { success: false, error: 'connectError', detail: 'requestFailed (sites: httpError, HTTP 503)' });
    harness.cloudTransport.on('GET', CLOUD_SITES, () => ({ body: { errorCode: -1005, msg: `denied ${DEVICE_ID} ${EUW} ${harness.tokens[0]} ${CLOUD_SECRET}` } }));
    const refused = await harness.manager.connect();
    assert.equal(refused.error, 'connectError');
    assert.match(refused.detail ?? '', /^requestFailed \(sites: /);
    harness.assertClean(refused.detail ?? '');
    assert.equal(harness.manager.controller, null);
    assert.ok(harness.cloudSessions.every((session) => session.isClosed), 'the failed sessions are released');
  }); // End of test "a failing cloud session..."

  test('the move rejection crosses the IPC registrar with the code first and nothing secret', async () => {
    const harness = new LiveHarness();
    await harness.switchCloudManaged();
    harness.cloudTransport.on('PATCH', MOVE_URL, { body: { errorCode: -1005, msg: `view only ${DEVICE_ID} ${harness.tokens[0]}` } });
    const listeners = new Map<string, (event: object, ...args: unknown[]) => unknown>();
    const registrar = createTrustedIpcRegistrar<object>({ handle: (channel, listener) => void listeners.set(channel, listener) }, () => true, () => [CLOUD_SECRET, ...harness.access.liveSecrets()]);
    registrar.handle('omada:set-wlan', (_event, mac, wlanId) => harness.installed.setApWlanGroup(mac as string, wlanId as string));
    const listener = listeners.get('omada:set-wlan');
    assert.ok(listener);
    await assert.rejects(
      async () => listener({}, MAC_1, SILENCIO_ID),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^moveRequestFailed \(aps wlan-group: .*errorCode -1005/);
        harness.assertClean(error.message);
        return true;
      }
    );
  }); // End of test "the move rejection crosses the IPC registrar..."

  test('a multi-site cloud controller: the picked site goes to cloudSites[omadacId] and is offered to the next connect', async () => {
    const harness = new LiveHarness();
    harness.cloudTransport.on('GET', CLOUD_SITES, { body: tunnel.sitesTwo });
    const parked = await harness.manager.switchTarget({ kind: 'cloud', omadacId: CLOUD_ID });
    assert.equal(parked.needsSiteSelection, true);
    assert.deepEqual(harness.manager.selectSite(CLOUD_SITE_2, parked.selectionNonce as string).siteName, 'Almacén');
    assert.deepEqual(harness.saved.cloudSites, [`${CLOUD_ID}=${CLOUD_SITE_2}`]);
    assert.deepEqual(harness.saved.siteId, [], 'never the local siteId');
    const again = await harness.manager.connect();
    assert.equal(again.success, true, 'the remembered site is picked without asking');
    assert.equal(again.siteName, 'Almacén');
  }); // End of test "a multi-site cloud controller..."

  test('local → cloud → local with real sessions: localOmadacId learned from /api/info once; each switch releases the previous session', async () => {
    const harness = new LiveHarness();
    const local = await harness.manager.connect();
    assert.equal(local.success, true, JSON.stringify(local));
    const localSession = harness.installed;
    assert.equal(localSession.kind, 'local');
    assert.deepEqual(harness.saved.localOmadacId, [LOCAL_ID]);
    await harness.switchCloudManaged();
    assert.ok(localSession.isClosed);
    assert.equal(harness.localTransport.requestsTo('POST', `/${LOCAL_ID}/api/v2/logout`).length, 1, 'the local session was logged out');
    const cloudSession = harness.installed;
    const back = await harness.manager.switchTarget({ kind: 'local' });
    assert.equal(back.success, true);
    assert.equal(harness.installed.kind, 'local');
    assert.ok(cloudSession.isClosed);
    assert.ok(harness.cloudClients.every((client) => client.isClosed), 'every cloud-route client of the old session is closed');
    assert.deepEqual(harness.saved.localOmadacId, [LOCAL_ID], 'unchanged: persisted once');
    assert.deepEqual(harness.saved.activeController, [CLOUD_ID, 'local']);
  }); // End of test "local → cloud → local with real sessions..."

  test('a switch during a cloud move: the late PATCH answer is superseded, no re-read is sent, the new session is untouched', async () => {
    const harness = new LiveHarness();
    await harness.switchCloudManaged();
    const cloudSession = harness.installed;
    const patch = heldReply();
    harness.cloudTransport.on('PATCH', MOVE_URL, patch.route);
    const move = cloudSession.setApWlanGroup(MAC_1, SILENCIO_ID);
    await until(() => patch.held);
    const switched = await harness.manager.switchTarget({ kind: 'local' });
    assert.equal(switched.success, true);
    const localSession = harness.installed;
    const mark = harness.cloudTransport.requests.length;
    patch.release(ok());
    await assert.rejects(move, (error: unknown) => error instanceof CloudSessionError && error.code === 'superseded');
    assert.equal(harness.cloudTransport.requests.length, mark, 'no re-read after the switch');
    assert.equal(harness.installed, localSession);
    assert.ok(!harness.localTransport.requests.some((request) => request.url.includes(MAC_1) || request.method === 'PATCH'), 'nothing reached the new session');
  }); // End of test "a switch during a cloud move..."

  test('a switch during a managed read: a cloud session\'s reply is superseded', async () => {
    const harness = new LiveHarness();
    const nonce = await harness.switchCloudManaged();
    const read = heldReply();
    harness.cloudTransport.on('GET', CLOUD_AP_GROUPS, read.route);
    const reply = managedApGroupsReply(harness.manager, nonce);
    await until(() => read.held);
    assert.equal((await harness.manager.switchTarget({ kind: 'local' })).success, true);
    read.release({ body: tunnel.apGroups });
    assert.deepEqual(await reply, { success: false, error: 'superseded' });
  }); // End of test "a switch during a managed read: a cloud session's reply..."

  test('a switch during a managed read: a local session\'s reply is superseded', async () => {
    const harness = new LiveHarness();
    harness.managementCredentials = { clientId: 'owm-client-1', clientSecret: 'Cl1ent-S3cret-Value-Never-Shown' };
    const connected = await harness.manager.connect();
    assert.equal(connected.success, true);
    const nonce = connected.sessionNonce as string;
    assert.deepEqual(await getSessionCapabilities(harness.manager, nonce), { success: true, capabilities: managementOn() });
    const read = heldReply();
    harness.localTransport.on('GET', LOCAL_AP_GROUPS, read.route);
    const reply = managedApGroupsReply(harness.manager, nonce);
    await until(() => read.held);
    assert.equal((await harness.manager.switchTarget({ kind: 'cloud', omadacId: CLOUD_ID })).success, true);
    read.release(ok({ totalRows: LOCAL_GROUPS.length, currentPage: 1, currentSize: LOCAL_GROUPS.length, data: LOCAL_GROUPS }));
    assert.deepEqual(await reply, { success: false, error: 'superseded' });
    assert.equal(harness.installed.kind, 'cloud');
  }); // End of test "a switch during a managed read: a local session's reply..."

  test('a local management-credentials save leaves an installed cloud session\'s management alone', async () => {
    const harness = new LiveHarness();
    await harness.switchCloudManaged();
    const session = harness.installed;
    const client = session.openApiClient;
    assert.ok(client);
    applyManagementAccessChange(harness.manager, { url: BASE_URL, username: 'admin', language: 'en', clientId: 'new-local-client' });
    assert.equal(session.openApiClient, client);
    assert.deepEqual(session.capabilities, managementOn());
    assert.equal(client.isClosed, false);
  }); // End of test "a local management-credentials save leaves..."
}); // End of describe 'cloud targets end to end (fixtures)'

// ---------------------------------------------------------------------------
// Inbox I-1b2b2: startup target, CONFIG_SAVE connectionReset, session-bound
// controller data channels
// ---------------------------------------------------------------------------

const OTHER_NONCE = '0'.repeat(32);
const MANAGEMENT_FLAGS: ManagementAccessStatus = { clientId: '', hasClientSecret: false, clientSecretSessionOnly: false, canPersistClientSecret: true };
const CLOUD_FLAGS: CloudAccessStatus = {
  region: 'euw',
  clientId: 'cloud-client-2',
  hasCloudSecret: true,
  cloudSecretSessionOnly: false,
  canPersistCloudSecret: true,
  activeController: 'local'
};
const CLOUD_SAVE_PAYLOAD: ConfigSavePayload = { url: BASE_URL, username: 'admin', language: 'en', cloudRegion: 'euw', cloudClientId: 'cloud-client-2', cloudClientSecret: 'new-cloud-secret' };

describe('the startup target (inbox I-1b2b2)', () => {
  test('startupTargetOf(): local unless activeController names a cloud controller; the credential is asked only then, and an unusable one falls back to local', () => {
    const base: StoredConfig = { url: URL_A, username: 'admin', language: 'en' };
    let asked = 0;
    /**
     * A usability probe that counts its calls.
     * @param {boolean} usable - What it answers.
     * @returns {() => boolean} The probe.
     */
    const probe = (usable: boolean) => (): boolean => {
      asked++;
      return usable;
    };
    assert.deepEqual(startupTargetOf(base, probe(true)), { kind: 'local' });
    assert.deepEqual(startupTargetOf({ ...base, activeController: 'local' }, probe(true)), { kind: 'local' });
    assert.deepEqual(startupTargetOf({ ...base, activeController: 'not an id' }, probe(true)), { kind: 'local' });
    assert.equal(asked, 0, 'with the local controller active the credential is never read (the default start is unchanged)');
    assert.deepEqual(startupTargetOf({ ...base, activeController: OMADAC_CLOUD }, probe(true)), { kind: 'cloud', omadacId: OMADAC_CLOUD });
    assert.deepEqual(startupTargetOf({ ...base, activeController: OMADAC_CLOUD }, probe(false)), { kind: 'local' }, 'unusable credential → local');
    assert.equal(asked, 2);
  }); // End of test "startupTargetOf()..."

  test('startOn(): the first connect goes to the startup target; no transition, activeController write or connect of its own; refused once anything ran; an invalid target throws', async () => {
    const harness = new TargetHarness();
    const before = harness.sessionId;
    assert.equal(harness.manager.startOn({ kind: 'cloud', omadacId: OMADAC_CLOUD }), true);
    assert.deepEqual(harness.manager.target, { kind: 'cloud', omadacId: OMADAC_CLOUD });
    assert.deepEqual(harness.writes, [], 'the stored choice is not rewritten');
    assert.equal(harness.sessionId, before, 'no transition');
    assert.equal(harness.lookups.length, 0, 'no connect of its own');
    const pending = harness.manager.connect();
    await flush();
    assert.deepEqual(harness.lookups.map((lookup) => lookup.omadacId), [OMADAC_CLOUD], 'the renderer\'s first connect reaches the startup target');
    harness.lookups[0].reply.resolve(harness.found(OMADAC_CLOUD));
    await flush();
    harness.latest.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.equal((await pending).success, true);
    assert.equal(harness.manager.startOn({ kind: 'local' }), false, 'too late: a connect ran');
    assert.deepEqual(harness.manager.target, { kind: 'cloud', omadacId: OMADAC_CLOUD });
    const fresh = new TargetHarness();
    assert.throws(() => fresh.manager.startOn({ kind: 'cloud', omadacId: 'local' }), /Connection target rejected/);
    assert.deepEqual(fresh.manager.target, { kind: 'local' });
    assert.equal(fresh.manager.startOn({ kind: 'local' }), true, 'the local default stays a valid start');
  }); // End of test "startOn()..."
}); // End of describe 'the startup target (inbox I-1b2b2)'

describe('CONFIG_SAVE connectionReset (inbox I-1b2b2)', () => {
  test('applyConfigSave() tells whether the transition ran: a URL change, or a cloud credential change on a cloud target only', async () => {
    const harness = new TargetHarness();
    await harness.connectLocal();
    assert.equal((await harness.manager.applyConfigSave(() => ({ success: true, urlChanged: false, cloudCredentialsChanged: true }))).connectionReset, false);
    assert.equal((await harness.manager.applyConfigSave(() => ({ success: true, urlChanged: false }))).connectionReset, false);
    await harness.switchToCloud(OMADAC_CLOUD);
    assert.equal((await harness.manager.applyConfigSave(() => ({ success: false, cloudCredentialsChanged: true }))).connectionReset, false);
    const saved = await harness.manager.applyConfigSave(() => ({ success: true, urlChanged: false, cloudCredentialsChanged: true, extra: 'kept' }));
    assert.deepEqual(saved, { success: true, urlChanged: false, cloudCredentialsChanged: true, extra: 'kept', connectionReset: true }, 'the save result is passed on');
    assert.equal((await harness.manager.applyConfigSave(() => ({ success: true, urlChanged: true }))).connectionReset, true);
  }); // End of test "applyConfigSave() tells whether the transition ran..."

  test('finishConfigSave(): a cloud credential change that dropped a cloud connection replies connectionReset; on the local target it does not; a URL change still does; a failure is its code only', async () => {
    const harness = new LiveHarness();
    const local = await harness.manager.connect();
    assert.equal(local.success, true);
    const localSession = harness.installed;
    const keptLocal = await harness.manager.applyConfigSave(() => ({ success: true, urlChanged: false, cloudCredentialsChanged: true, managementAccess: MANAGEMENT_FLAGS, cloudAccess: CLOUD_FLAGS }));
    assert.deepEqual(finishConfigSave(harness.manager, CLOUD_SAVE_PAYLOAD, keptLocal), { success: true, managementAccess: MANAGEMENT_FLAGS, cloudAccess: CLOUD_FLAGS });
    assert.equal(harness.manager.controller, localSession, 'the local session does not use the cloud account');
    const nonce = await harness.switchCloudManaged();
    const cloudSession = harness.installed;
    const dropped = await harness.manager.applyConfigSave(() => ({ success: true, urlChanged: false, cloudCredentialsChanged: true, managementAccess: MANAGEMENT_FLAGS, cloudAccess: CLOUD_FLAGS }));
    assert.deepEqual(finishConfigSave(harness.manager, CLOUD_SAVE_PAYLOAD, dropped), {
      success: true,
      managementAccess: MANAGEMENT_FLAGS,
      cloudAccess: CLOUD_FLAGS,
      connectionReset: true
    });
    assert.equal(harness.manager.controller, null);
    assert.ok(cloudSession.isClosed);
    await assert.rejects(accessPointsReply(harness.manager, nonce), { message: /^notConnected \(/ });
    const urlChange = await harness.manager.applyConfigSave(() => ({ success: true, urlChanged: true, managementAccess: MANAGEMENT_FLAGS, cloudAccess: CLOUD_FLAGS }));
    assert.equal(finishConfigSave(harness.manager, { url: 'https://other.invalid', username: 'admin', language: 'en', password: 'p' }, urlChange).connectionReset, true);
    const failed = await harness.manager.applyConfigSave(() => ({ success: false, error: 'cloudClientSecretRequired' as const, cloudCredentialsChanged: true }));
    assert.deepEqual(finishConfigSave(harness.manager, CLOUD_SAVE_PAYLOAD, failed), { success: false, error: 'cloudClientSecretRequired' });
  }); // End of test "finishConfigSave(): a cloud credential change..."

  test('finishConfigSave(): a save that kept the URL still applies a management-access change to the installed local session', async () => {
    const harness = new LiveHarness();
    harness.managementCredentials = { clientId: 'owm-client-1', clientSecret: 'Cl1ent-S3cret-Value-Never-Shown' };
    const connected = await harness.manager.connect();
    assert.deepEqual(await getSessionCapabilities(harness.manager, connected.sessionNonce as string), { success: true, capabilities: managementOn() });
    const session = harness.installed;
    assert.ok(session.openApiClient);
    const saved = await harness.manager.applyConfigSave(() => ({ success: true, urlChanged: false, managementAccess: MANAGEMENT_FLAGS, cloudAccess: CLOUD_FLAGS }));
    const reply = finishConfigSave(harness.manager, { url: BASE_URL, username: 'admin', language: 'en', clientId: 'owm-client-2', clientSecret: 'other' }, saved);
    assert.equal(reply.connectionReset, undefined);
    assert.equal(harness.manager.controller, session);
    assert.equal(session.openApiClient, null, 'the old Open API client and capabilities are dropped');
  }); // End of test "finishConfigSave(): a save that kept the URL..."
}); // End of describe 'CONFIG_SAVE connectionReset (inbox I-1b2b2)'

describe('session-bound controller data channels (inbox I-1b2b2)', () => {
  test('local: the connect result\'s nonce is served (and carries no controller name); a stale or foreign nonce is refused before any controller request; a disconnect leaves notConnected', async () => {
    const harness = new LiveHarness();
    const connected = await harness.manager.connect();
    assert.equal(connected.success, true);
    assert.equal('controllerName' in connected, false, 'a local result is unchanged');
    const nonce = connected.sessionNonce as string;
    assert.ok((await accessPointsReply(harness.manager, nonce)).length > 0);
    assert.ok((await wlanGroupsReply(harness.manager, nonce)).groups.length > 0);
    const mark = harness.localTransport.requests.length;
    await assert.rejects(accessPointsReply(harness.manager, OTHER_NONCE), { message: /^superseded \(/ });
    await assert.rejects(wlanGroupsReply(harness.manager, OTHER_NONCE), { message: /^superseded \(/ });
    await assert.rejects(apMoveReply(harness.manager, { sessionNonce: OTHER_NONCE, mac: MAC_1, wlanId: LOCAL_GROUPS[0].id }), { message: /^superseded \(/ });
    assert.equal(harness.localTransport.requests.length, mark, 'nothing reached the controller for a stale nonce');
    await harness.manager.disconnect();
    for (const reply of [accessPointsReply(harness.manager, nonce), wlanGroupsReply(harness.manager, nonce), apMoveReply(harness.manager, { sessionNonce: nonce, mac: MAC_1, wlanId: LOCAL_GROUPS[0].id })]) {
      await assert.rejects(reply, { message: /^notConnected \(/ });
    }
  }); // End of test "local: the connect result's nonce is served..."

  test('a reconnect: while its login is held the old nonce is notConnected (nothing sent); once it succeeds the old nonce is superseded and only the new one is served', async () => {
    const harness = new LiveHarness();
    const first = await harness.manager.connect();
    const oldNonce = first.sessionNonce as string;
    const login = heldReply();
    harness.localTransport.on('POST', `/${LOCAL_ID}/api/v2/login`, login.route);
    const reconnect = harness.manager.connect();
    await until(() => login.held);
    const mark = harness.localTransport.requests.length;
    await assert.rejects(accessPointsReply(harness.manager, oldNonce), { message: /^notConnected \(/ });
    assert.equal(harness.localTransport.requests.length, mark, 'the closed session is not asked');
    login.release({ body: responses.loginOk });
    const second = await reconnect;
    assert.equal(second.success, true);
    assert.notEqual(second.sessionNonce, oldNonce);
    await assert.rejects(accessPointsReply(harness.manager, oldNonce), { message: /^superseded \(/ });
    assert.ok((await accessPointsReply(harness.manager, second.sessionNonce as string)).length > 0);
  }); // End of test "a reconnect..."

  test('a switch during a data read: the late reply of the old session is superseded, never passed on (local read, cloud switch)', async () => {
    const harness = new LiveHarness();
    const connected = await harness.manager.connect();
    const devices = heldReply();
    harness.localTransport.on('GET', `/${LOCAL_ID}/api/v2/sites/${LOCAL_SITE}/devices`, devices.route);
    const read = accessPointsReply(harness.manager, connected.sessionNonce as string);
    await until(() => devices.held);
    const switched = await harness.manager.switchTarget({ kind: 'cloud', omadacId: CLOUD_ID });
    assert.equal(switched.success, true);
    devices.release({ body: responses.devices });
    await assert.rejects(read, { message: /^superseded \(/ });
    assert.equal(harness.installed.kind, 'cloud');
  }); // End of test "a switch during a data read..."

  test('cloud: the connect result names the controller (it has no URL); its nonce is served for the AP list, a move with another nonce never reaches the tunnel', async () => {
    const harness = new LiveHarness();
    const result = await harness.manager.switchTarget({ kind: 'cloud', omadacId: CLOUD_ID });
    assert.equal(result.success, true);
    assert.equal(result.controllerName, 'OC200 Planta 4');
    assert.equal(harness.installed.url, '');
    const nonce = result.sessionNonce as string;
    assert.equal((await accessPointsReply(harness.manager, nonce)).length, 4);
    assert.ok((await wlanGroupsReply(harness.manager, nonce)).groups.length > 0);
    const mark = harness.cloudTransport.requests.length;
    await assert.rejects(apMoveReply(harness.manager, { sessionNonce: OTHER_NONCE, mac: MAC_1, wlanId: SILENCIO_ID }), { message: /^superseded \(/ });
    assert.equal(harness.cloudTransport.requests.length, mark, 'no PATCH and no read for a stale nonce');
    assert.equal(harness.cloudTransport.requestsTo('PATCH', MOVE_URL).length, 0);
  }); // End of test "cloud: the connect result names the controller..."
}); // End of describe 'session-bound controller data channels (inbox I-1b2b2)'
