// Adversarial concurrency tests for the main-process connection state machine
// (src/main/connection-manager.ts): fake controllers whose connect() the test
// resolves by hand, a fake config and a fake controller-session switch, so
// every interleaving of connect / site selection / trust with a controller URL
// change or a certificate reset can be driven deterministically. Covers the
// phase-7 serialization baseline and the phase-11 review blockers: a URL
// change and a certificate reset are atomic controller transitions, and no
// stale continuation can install a controller or persist anything afterwards.
// No Electron, no network.

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import type { CertificatePin } from '../../src/main/cert-pinning';
import { ConnectionManager, ManagedController, settleWithin } from '../../src/main/connection-manager';
import type { ConnectOutcome } from '../../src/main/omada-api';
import type { ConnectionResult, SiteInfo } from '../../src/shared/types';

const URL_A = 'https://controller-a.invalid:8043';
const URL_B = 'https://controller-b.invalid:8043';
const HOST_A = 'controller-a.invalid';
const SITES: SiteInfo[] = [
  { id: 'site-a', name: 'Site A' },
  { id: 'site-b', name: 'Site B' },
];
// A well-formed SHA-256 fingerprint (32 colon-separated uppercase hex bytes)
const FINGERPRINT = Array.from({ length: 32 }, (_, index) => index.toString(16).toUpperCase().padStart(2, '0')).join(':');
// Drain limit used by the harness (short, so the bounded-drain test is quick)
const DRAIN_MS = 40;

// The state machine logs expected failures; keep the test output readable
mock.method(console, 'error', () => {});
mock.method(console, 'warn', () => {});

/**
 * A promise with its settle functions exposed.
 */
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
 * Fake controller: connect() waits for the test (connectResult), logout()
 * records the controller session that was current when it STARTED.
 */
class FakeController implements ManagedController {
  readonly url: string;
  readonly connectResult = deferred<ConnectOutcome>();
  readonly preferredSiteIds: Array<string | undefined> = [];
  readonly logoutSessions: number[] = [];
  selectedSite: string | null = null;
  private sites: SiteInfo[] = [];
  private readonly harness: Harness;

  /**
   * Creates a fake controller for one connect attempt.
   * @param {Harness} harness - The owning harness.
   * @param {string} url - The URL it was created for.
   */
  constructor(harness: Harness, url: string) {
    this.harness = harness;
    this.url = url;
  }

  /**
   * Resolves (or rejects) when the test settles connectResult.
   * @param {string} [preferredSiteId] - The stored site id offered.
   * @returns {Promise<ConnectOutcome>} The outcome the test chose.
   */
  async connect(preferredSiteId?: string): Promise<ConnectOutcome> {
    this.preferredSiteIds.push(preferredSiteId);
    const outcome = await this.connectResult.promise;
    this.sites = outcome.sites;
    return outcome;
  }

  /**
   * Accepts only ids of the authorized-site list.
   * @param {string} siteId - The chosen id.
   * @returns {boolean} True when accepted.
   */
  selectSite(siteId: string): boolean {
    if (!this.sites.some((site) => site.id === siteId)) {
      return false;
    }
    this.selectedSite = siteId;
    return true;
  }

  /**
   * Records the current session id, then settles like harness.logoutResult.
   * @returns {Promise<void>} The harness' logout promise.
   */
  logout(): Promise<void> {
    this.logoutSessions.push(this.harness.sessionId);
    return this.harness.logoutResult;
  }
} // End of class FakeController

/**
 * A fake controller with the optional ManagedController hooks: it records
 * close() / activate() / logout() calls in order and reports a site name and
 * a session nonce when activated (like ControllerSession).
 */
class HookedController extends FakeController {
  readonly events: string[] = [];

  /**
   * Records the synchronous close.
   */
  close(): void {
    this.events.push('close');
  }

  /**
   * Records the activation and returns the success details.
   * @returns {{ siteName: string; sessionNonce: string }} The details.
   */
  activate(): { siteName: string; sessionNonce: string } {
    this.events.push('activate');
    return { siteName: this.selectedSite ?? 'Only site', sessionNonce: 'c'.repeat(32) };
  }

  /**
   * Records the logout, then behaves like FakeController.logout().
   * @returns {Promise<void>} The harness' logout promise.
   */
  logout(): Promise<void> {
    this.events.push('logout');
    return super.logout();
  }
} // End of class HookedController

/**
 * One switch of the controller session, as recorded by the harness.
 */
interface SessionSwitch {
  from: number;
  to: number;
  // True once the outgoing session was retired (after the drain)
  retired: boolean;
}

/**
 * The fake environment: config, controller sessions and the state machine.
 */
class Harness {
  config = { url: URL_A, username: 'admin', password: 's3cret', siteId: '', pin: null as CertificatePin | null };
  sessionId = 1;
  readonly switches: SessionSwitch[] = [];
  readonly controllers: FakeController[] = [];
  readonly savedSiteIds: string[] = [];
  pinWriteFails = false;
  logoutResult: Promise<void> = Promise.resolve();
  readonly manager: ConnectionManager<FakeController>;

  /**
   * Builds the state machine over the fakes.
   * @param {boolean} [hooked] - Create HookedControllers (with close() / activate()).
   */
  constructor(hooked = false) {
    this.manager = new ConnectionManager<FakeController>({
      getCredentials: () => ({ url: this.config.url, username: this.config.username, password: this.config.password }),
      createController: (credentials) => {
        const controller = hooked ? new HookedController(this, credentials.url) : new FakeController(this, credentials.url);
        this.controllers.push(controller);
        return controller;
      },
      getConfiguredUrl: () => this.config.url,
      getStoredSiteId: () => this.config.siteId,
      saveStoredSiteId: (siteId) => {
        this.config.siteId = siteId;
        this.savedSiteIds.push(siteId);
      },
      saveCertificatePin: (pin) => {
        if (this.pinWriteFails) {
          return false;
        }
        this.config.pin = pin;
        return true;
      },
      clearCertificatePin: () => {
        if (this.pinWriteFails) {
          return false;
        }
        this.config.pin = null;
        return true;
      },
      resetControllerSession: (drain) => this.resetSession(drain),
      logoutDrainMs: DRAIN_MS,
    });
  } // End of constructor()

  /**
   * Fake ControllerTlsSessions.reset(): switches synchronously (the contract)
   * and retires the outgoing session after the drain, asynchronously.
   * @param {Promise<void>} [drain] - Settles when the outgoing session may close.
   * @returns {Promise<void>} Settles once the outgoing session is retired.
   */
  resetSession(drain?: Promise<void>): Promise<void> {
    const record: SessionSwitch = { from: this.sessionId, to: this.sessionId + 1, retired: false };
    this.sessionId = record.to;
    this.switches.push(record);
    return (async () => {
      if (drain) {
        await drain;
      }
      await flush();
      record.retired = true;
    })();
  } // End of function resetSession()

  /**
   * Simulates the CONFIG_SAVE handler for a controller URL change: config.ts
   * saveConfig() drops the password, site id and pin and reports urlChanged.
   * @param {string} url - The new controller URL.
   * @returns {Promise<{ success: boolean; urlChanged?: boolean; connectionReset: boolean }>} The save result.
   */
  changeUrl(url: string): Promise<{ success: boolean; urlChanged?: boolean; connectionReset: boolean }> {
    return this.manager.applyConfigSave(() => {
      this.config = { ...this.config, url, password: 'new-password', siteId: '', pin: null };
      return { success: true, urlChanged: true };
    });
  }

  /**
   * The most recently created controller.
   * @returns {FakeController} The controller.
   */
  get latest(): FakeController {
    const controller = this.controllers[this.controllers.length - 1];
    assert.ok(controller, 'a controller was created');
    return controller;
  }

  /**
   * Starts a connect and lets it reach controller.connect(). The pending
   * result is wrapped: an async function returning a bare promise would
   * adopt it, i.e. wait for the very connect the test has yet to settle.
   * @returns {Promise<{ result: Promise<ConnectionResult> }>} The pending connect result.
   */
  async startConnect(): Promise<{ result: Promise<ConnectionResult> }> {
    const result = this.manager.connect();
    await flush();
    return { result };
  }

  /**
   * Connects fully on a single-site controller (installed afterwards).
   * @returns {Promise<FakeController>} The installed controller.
   */
  async connectInstalled(): Promise<FakeController> {
    const pending = (await this.startConnect()).result;
    const controller = this.latest;
    controller.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    // A HookedController's activate() details join the success result
    const expected = controller instanceof HookedController ? { success: true, siteName: 'Only site', sessionNonce: 'c'.repeat(32) } : { success: true };
    assert.deepEqual(await pending, expected);
    assert.equal(this.manager.controller, controller);
    return controller;
  }

  /**
   * Connects on a multi-site controller up to the parked site selection.
   * @returns {Promise<{ controller: FakeController; nonce: string }>} The
   *   parked controller and the selection nonce.
   */
  async connectPendingSelection(): Promise<{ controller: FakeController; nonce: string }> {
    const pending = (await this.startConnect()).result;
    const controller = this.latest;
    controller.connectResult.resolve({ siteSelected: false, sites: SITES });
    const result = await pending;
    assert.equal(result.needsSiteSelection, true);
    assert.equal(typeof result.selectionNonce, 'string');
    assert.equal(this.manager.controller, null, 'a pending selection is not installed');
    return { controller, nonce: result.selectionNonce as string };
  }

  /**
   * Runs a connect that fails on a first-use pin rejection.
   * @returns {Promise<string>} The trust nonce of the certificateUntrusted result.
   */
  async connectFirstUse(): Promise<string> {
    const pending = (await this.startConnect()).result;
    this.manager.recordPinRejection({ kind: 'first-use', hostname: HOST_A, fingerprint: FINGERPRINT });
    this.latest.connectResult.reject(new Error('net::ERR_FAILED'));
    const result = await pending;
    assert.equal(result.error, 'certificateUntrusted');
    assert.equal(typeof result.trustNonce, 'string');
    return result.trustNonce as string;
  }
} // End of class Harness

describe('ConnectionManager baseline (phase-7 serialization)', () => {
  test('connect installs only after authentication; disconnect detaches and logs out', async () => {
    const harness = new Harness();
    const pending = (await harness.startConnect()).result;
    assert.equal(harness.manager.controller, null, 'nothing installed while authenticating');
    harness.latest.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await pending, { success: true });
    const controller = harness.latest;
    assert.equal(harness.manager.controller, controller);
    await harness.manager.disconnect();
    assert.equal(harness.manager.controller, null);
    assert.equal(controller.logoutSessions.length, 1);
  });

  test('configIncomplete without a password; no controller is created', async () => {
    const harness = new Harness();
    harness.config.password = '';
    assert.deepEqual(await harness.manager.connect(), { success: false, error: 'configIncomplete' });
    assert.equal(harness.controllers.length, 0);
  });

  test('a newer connect supersedes an in-flight one: the stale attempt is logged out, the newer one installed', async () => {
    const harness = new Harness();
    const first = (await harness.startConnect()).result;
    const stale = harness.latest;
    const second = (await harness.startConnect()).result;
    const fresh = harness.latest;
    fresh.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await second, { success: true });
    stale.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await first, { success: false, error: 'connectionSuperseded' });
    await flush();
    assert.equal(harness.manager.controller, fresh);
    assert.equal(stale.logoutSessions.length, 1);
    assert.equal(fresh.logoutSessions.length, 0);
  }); // End of test "a newer connect supersedes an in-flight one: the stale attempt is lo..."

  test('a disconnect while a connect is in flight makes it stale (nothing installed)', async () => {
    const harness = new Harness();
    const pending = (await harness.startConnect()).result;
    await harness.manager.disconnect();
    harness.latest.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await pending, { success: false, error: 'connectionSuperseded' });
    assert.equal(harness.manager.controller, null);
  });

  test('multi-site: selectSite needs the current nonce and an authorized id, then installs and persists', async () => {
    const harness = new Harness();
    const { controller, nonce } = await harness.connectPendingSelection();
    assert.deepEqual(harness.manager.selectSite('site-a', 'f'.repeat(32)), { success: false, error: 'siteUnavailable' });
    assert.deepEqual(harness.manager.selectSite('site-zzz', nonce), { success: false, error: 'siteUnavailable' });
    assert.deepEqual(harness.manager.selectSite('site-b', nonce), { success: true });
    assert.equal(harness.manager.controller, controller);
    assert.deepEqual(harness.savedSiteIds, ['site-b']);
    assert.deepEqual(harness.manager.selectSite('site-b', nonce), { success: false, error: 'siteUnavailable' }, 'one-time nonce');
  });

  test('a nonce-scoped disconnect aborts only the current pending selection', async () => {
    const harness = new Harness();
    const { controller, nonce } = await harness.connectPendingSelection();
    await harness.manager.disconnect('0'.repeat(32));
    assert.equal(controller.logoutSessions.length, 0, 'a stale nonce is a no-op');
    await harness.manager.disconnect(nonce);
    assert.equal(controller.logoutSessions.length, 1);
    assert.deepEqual(harness.manager.selectSite('site-a', nonce), { success: false, error: 'siteUnavailable' });
  });
}); // End of describe 'ConnectionManager baseline'

describe('ConnectionManager: a certificate reset is an atomic controller transition', () => {
  test('reset while a connect is in flight (authenticated, not yet installed): the stale completion is refused and nothing is persisted', async () => {
    const harness = new Harness();
    const pending = (await harness.startConnect()).result;
    const stale = harness.latest;
    const reset = harness.manager.resetCertificate();
    // The controller authenticates right after the reset started
    stale.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await pending, { success: false, error: 'connectionSuperseded' });
    assert.deepEqual(await reset, { success: true, connectionReset: true });
    await flush();
    assert.equal(harness.manager.controller, null, 'nothing installed');
    assert.deepEqual(harness.savedSiteIds, [], 'no site id persisted');
    assert.equal(harness.config.pin, null);
    assert.equal(stale.logoutSessions.length, 1, 'the stale controller is logged out');
  }); // End of test "reset while a connect is in flight (authenticated, not yet installed..."

  test('reset while a multi-site connect is in flight: no site selection is parked for the stale attempt', async () => {
    const harness = new Harness();
    const pending = (await harness.startConnect()).result;
    const reset = harness.manager.resetCertificate();
    harness.latest.connectResult.resolve({ siteSelected: false, sites: SITES });
    const result = await pending;
    await reset;
    assert.deepEqual(result, { success: false, error: 'connectionSuperseded' });
    assert.equal(harness.manager.controller, null);
  });

  test('reset while connected (no renderer disconnect first): the controller is detached synchronously and its logout starts on the outgoing session before the switch', async () => {
    const harness = new Harness();
    const controller = await harness.connectInstalled();
    const before = harness.sessionId;
    const reset = harness.manager.resetCertificate();
    // Synchronous part of the transition, before any await
    assert.equal(harness.manager.controller, null, 'detached at once');
    assert.deepEqual(controller.logoutSessions, [before], 'logout started on the outgoing session');
    assert.equal(harness.sessionId, before + 1, 'session switched in the same step');
    assert.equal(harness.config.pin, null);
    assert.deepEqual(await reset, { success: true, connectionReset: true });
    assert.equal(harness.switches[harness.switches.length - 1].retired, true);
  }); // End of test "reset while connected (no renderer disconnect first): the controller..."

  test('reset while a site selection is pending: the parked controller is logged out and the selection is refused (no site persisted)', async () => {
    const harness = new Harness();
    const { controller, nonce } = await harness.connectPendingSelection();
    await harness.manager.resetCertificate();
    assert.equal(controller.logoutSessions.length, 1);
    assert.deepEqual(harness.manager.selectSite('site-a', nonce), { success: false, error: 'siteUnavailable' });
    assert.equal(harness.manager.controller, null);
    assert.deepEqual(harness.savedSiteIds, []);
  });

  test('a connect that fails after a reset is not offered for trust (superseded, no trust nonce)', async () => {
    const harness = new Harness();
    const pending = (await harness.startConnect()).result;
    const reset = harness.manager.resetCertificate();
    harness.manager.recordPinRejection({ kind: 'first-use', hostname: HOST_A, fingerprint: FINGERPRINT });
    harness.latest.connectResult.reject(new Error('net::ERR_FAILED'));
    assert.deepEqual(await pending, { success: false, error: 'connectionSuperseded' });
    await reset;
  });

  test('reset during the pre-connect session reset (after a pin rejection): superseded before any controller is created', async () => {
    const harness = new Harness();
    harness.manager.recordPinRejection({ kind: 'first-use', hostname: HOST_A, fingerprint: FINGERPRINT });
    const pending = harness.manager.connect();
    // connect() is now awaiting its own session reset
    const reset = harness.manager.resetCertificate();
    assert.deepEqual(await pending, { success: false, error: 'connectionSuperseded' });
    await reset;
    assert.equal(harness.controllers.length, 0, 'no controller, so no login, was started');
  });

  test('a pending first-use trust decision dies with the reset', async () => {
    const harness = new Harness();
    const nonce = await harness.connectFirstUse();
    await harness.manager.resetCertificate();
    assert.deepEqual(await harness.manager.trustCertificate(nonce), { success: false, error: 'trustUnavailable' });
    assert.equal(harness.config.pin, null);
  });

  test('a failed pin write still runs the transition (fail-safe) and reports saveFailed with connectionReset', async () => {
    const harness = new Harness();
    const controller = await harness.connectInstalled();
    harness.pinWriteFails = true;
    assert.deepEqual(await harness.manager.resetCertificate(), { success: false, error: 'saveFailed', connectionReset: true });
    assert.equal(harness.manager.controller, null);
    assert.equal(controller.logoutSessions.length, 1);
  });

  test('the outgoing session is retired only after the detached logouts settle', async () => {
    const harness = new Harness();
    await harness.connectInstalled();
    const logout = deferred<void>();
    harness.logoutResult = logout.promise;
    const reset = harness.manager.resetCertificate();
    await flush();
    assert.equal(harness.switches[harness.switches.length - 1].retired, false, 'kept open while the logout runs');
    logout.resolve();
    await reset;
    assert.equal(harness.switches[harness.switches.length - 1].retired, true);
  });

  test('a hung logout does not hold the transition past the drain limit', async () => {
    const harness = new Harness();
    await harness.connectInstalled();
    harness.logoutResult = new Promise<void>(() => {});
    const started = Date.now();
    assert.deepEqual(await harness.manager.resetCertificate(), { success: true, connectionReset: true });
    assert.ok(Date.now() - started < DRAIN_MS + 1000, 'bounded by the drain limit');
    assert.equal(harness.switches[harness.switches.length - 1].retired, true);
  });

  test('a connect started after the reset proceeds normally', async () => {
    const harness = new Harness();
    await harness.connectInstalled();
    await harness.manager.resetCertificate();
    const controller = await harness.connectInstalled();
    assert.equal(harness.manager.controller, controller);
  });
}); // End of describe 'a certificate reset is an atomic controller transition'

describe('ConnectionManager: a controller URL change is an atomic controller transition', () => {
  test('URL change while a connect is in flight: the stale completion is refused, nothing installed or persisted for the old controller', async () => {
    const harness = new Harness();
    const pending = (await harness.startConnect()).result;
    const stale = harness.latest;
    const before = harness.sessionId;
    const save = harness.changeUrl(URL_B);
    assert.equal(harness.sessionId, before + 1, 'session switched in the same step as the save');
    stale.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await pending, { success: false, error: 'connectionSuperseded' });
    assert.deepEqual(await save, { success: true, urlChanged: true, connectionReset: true }, 'the transition ran (inbox I-1b2b2: reported for CONFIG_SAVE)');
    await flush();
    assert.equal(harness.manager.controller, null);
    assert.deepEqual(harness.savedSiteIds, []);
    assert.equal(stale.logoutSessions.length, 1);
  }); // End of test "URL change while a connect is in flight: the stale completion is ref..."

  test('URL change while a site selection is pending: selectSite is refused, no site id persisted, the parked controller is logged out on the outgoing session', async () => {
    const harness = new Harness();
    const { controller, nonce } = await harness.connectPendingSelection();
    const before = harness.sessionId;
    const save = harness.changeUrl(URL_B);
    assert.deepEqual(controller.logoutSessions, [before]);
    assert.deepEqual(harness.manager.selectSite('site-a', nonce), { success: false, error: 'siteUnavailable' });
    await save;
    assert.equal(harness.manager.controller, null);
    assert.deepEqual(harness.savedSiteIds, []);
    assert.equal(harness.config.siteId, '');
  });

  test('URL change while connected: the controller is detached and logged out; the nonce-scoped disconnect of a stale flow stays a no-op', async () => {
    const harness = new Harness();
    const controller = await harness.connectInstalled();
    await harness.changeUrl(URL_B);
    assert.equal(harness.manager.controller, null);
    assert.equal(controller.logoutSessions.length, 1);
    await harness.manager.disconnect('a'.repeat(32));
    assert.equal(controller.logoutSessions.length, 1);
  });

  test('a save that keeps the URL, or fails, leaves the connection alone', async () => {
    const harness = new Harness();
    const controller = await harness.connectInstalled();
    const before = harness.sessionId;
    await harness.manager.applyConfigSave(() => ({ success: true, urlChanged: false }));
    await harness.manager.applyConfigSave(() => ({ success: false, urlChanged: true }));
    assert.equal(harness.manager.controller, controller);
    assert.equal(harness.sessionId, before, 'no session switch');
    assert.equal(controller.logoutSessions.length, 0);
  });

  test('URL change while a first-use trust decision is pending: CERT_TRUST is refused and nothing is pinned', async () => {
    const harness = new Harness();
    const nonce = await harness.connectFirstUse();
    await harness.changeUrl(URL_B);
    assert.deepEqual(await harness.manager.trustCertificate(nonce), { success: false, error: 'trustUnavailable' });
    assert.equal(harness.config.pin, null);
  });

  test('URL change during CERT_TRUST\'s session reset: the stale trust flow is told trustUnavailable (and the pin is gone with the old URL)', async () => {
    const harness = new Harness();
    const nonce = await harness.connectFirstUse();
    const trust = harness.manager.trustCertificate(nonce);
    assert.equal(harness.config.pin?.sha256, FINGERPRINT, 'pinned before the await');
    await harness.changeUrl(URL_B);
    assert.deepEqual(await trust, { success: false, error: 'trustUnavailable' });
    assert.equal(harness.config.pin, null);
  });

  test('without interference, CERT_TRUST pins the recorded fingerprint for the origin and succeeds', async () => {
    const harness = new Harness();
    const nonce = await harness.connectFirstUse();
    assert.deepEqual(await harness.manager.trustCertificate(nonce), { success: true });
    assert.equal(harness.config.pin?.origin, URL_A);
    assert.equal(harness.config.pin?.sha256, FINGERPRINT);
    assert.deepEqual(await harness.manager.trustCertificate(nonce), { success: false, error: 'trustUnavailable' }, 'one-time nonce');
  });

  test('defense in depth: a configured-URL change that bypassed the transition still makes connect and selectSite refuse stale completions', async () => {
    const harness = new Harness();
    const { nonce } = await harness.connectPendingSelection();
    harness.config.url = URL_B;
    assert.deepEqual(harness.manager.selectSite('site-a', nonce), { success: false, error: 'siteUnavailable' });
    harness.config.url = URL_A;
    const pending = (await harness.startConnect()).result;
    harness.config.url = URL_B;
    harness.latest.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await pending, { success: false, error: 'connectionSuperseded' });
    assert.equal(harness.manager.controller, null);
    assert.deepEqual(harness.savedSiteIds, []);
  }); // End of test "defense in depth: a configured-URL change that bypassed the transiti..."
}); // End of describe 'a controller URL change is an atomic controller transition'

describe('settleWithin()', () => {
  test('settles with the work, or at the bound, and never rejects', async () => {
    let settled = false;
    const work = deferred<void>();
    const bounded = settleWithin(work.promise, 1000).then(() => {
      settled = true;
    });
    await flush();
    assert.equal(settled, false);
    work.reject(new Error('ignored'));
    await bounded;
    assert.equal(settled, true);
    await settleWithin(new Promise(() => {}), 5);
  }); // End of test "settles with the work, or at the bound, and never rejects"
});

describe('ConnectionManager: the optional close() / activate() hooks (ControllerSession)', () => {
  test('only the installed controller is activated, and its details join the success result (connect, and selectSite)', async () => {
    const single = new Harness(true);
    const pending = (await single.startConnect()).result;
    single.latest.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await pending, { success: true, siteName: 'Only site', sessionNonce: 'c'.repeat(32) });
    assert.deepEqual((single.latest as HookedController).events, ['activate']);

    const multi = new Harness(true);
    const { controller, nonce } = await multi.connectPendingSelection();
    assert.deepEqual((controller as HookedController).events, [], 'a parked controller is not activated');
    assert.deepEqual(multi.manager.selectSite('site-b', nonce), { success: true, siteName: 'site-b', sessionNonce: 'c'.repeat(32) });
    assert.deepEqual((controller as HookedController).events, ['activate']);
  }); // End of test "only the installed controller is activated..."

  test('a transition closes the installed controller synchronously, before its logout starts', async () => {
    const harness = new Harness(true);
    await harness.connectInstalled();
    const controller = harness.latest as HookedController;
    const reset = harness.manager.resetCertificate();
    assert.equal(controller.events[1], 'close', 'closed in the synchronous part of the transition');
    assert.ok(controller.events.indexOf('close') < controller.events.indexOf('logout'));
    await reset;

    await harness.connectInstalled();
    const second = harness.latest as HookedController;
    await harness.changeUrl(URL_B);
    assert.deepEqual(second.events.slice(0, 2), ['activate', 'close']);
    assert.ok(second.events.includes('logout'));
  }); // End of test "a transition closes the installed controller synchronously..."

  test('a superseded attempt and a discarded parked controller are closed, never activated', async () => {
    const harness = new Harness(true);
    const first = (await harness.startConnect()).result;
    const stale = harness.latest as HookedController;
    const second = (await harness.startConnect()).result;
    harness.latest.connectResult.resolve({ siteSelected: false, sites: SITES });
    const parked = harness.latest as HookedController;
    assert.equal((await second).needsSiteSelection, true);
    stale.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await first, { success: false, error: 'connectionSuperseded' });
    assert.deepEqual(stale.events, ['close', 'logout']);
    // A newer connect discards the parked selection
    const third = (await harness.startConnect()).result;
    harness.latest.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.equal((await third).success, true);
    assert.deepEqual(parked.events, ['close', 'logout']);
    await harness.manager.disconnect();
    assert.deepEqual((harness.latest as HookedController).events.slice(0, 2), ['activate', 'close']);
  }); // End of test "a superseded attempt and a discarded parked controller are closed..."
}); // End of describe 'the optional close() / activate() hooks'

describe('ConnectionManager: a new connect closes the installed controller before its first await', () => {
  test('the installed controller is closed synchronously when the attempt claims the generation; its internal side stays installed while the new login is pending and is logged out once the attempt succeeds', async () => {
    const harness = new Harness(true);
    const old = (await harness.connectInstalled()) as HookedController;
    const pending = harness.manager.connect();
    // Synchronous part of connect(), before its first await
    assert.deepEqual(old.events, ['activate', 'close'], 'closed before connect() awaited anything');
    assert.equal(harness.manager.controller, old, 'the internal controller stays installed during the window (phase 7)');
    await flush();
    const fresh = harness.latest;
    assert.notEqual(fresh, old, 'the new login is pending');
    assert.equal(old.events.includes('logout'), false, 'not logged out while the new login is pending');
    fresh.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.equal((await pending).success, true);
    await flush();
    assert.equal(harness.manager.controller, fresh);
    assert.equal(old.events.filter((event) => event === 'logout').length, 1, 'released once the attempt succeeded');
    assert.deepEqual((fresh as HookedController).events, ['activate']);
  }); // End of test "the installed controller is closed synchronously when the attempt claims..."

  test('a failed, incomplete or superseded attempt still closed the installed controller; its internal side stays installed until a disconnect logs it out', async () => {
    const harness = new Harness(true);
    const old = (await harness.connectInstalled()) as HookedController;
    const failing = (await harness.startConnect()).result;
    harness.latest.connectResult.reject(new Error('net::ERR_CONNECTION_REFUSED'));
    assert.equal((await failing).error, 'connectError');
    assert.equal(old.events[1], 'close');
    assert.equal(harness.manager.controller, old, 'a failed attempt leaves the internal controller installed');
    assert.equal(old.events.includes('logout'), false);

    harness.config.password = '';
    assert.deepEqual(await harness.manager.connect(), { success: false, error: 'configIncomplete' });
    harness.config.password = 's3cret';

    const stale = (await harness.startConnect()).result;
    const staleController = harness.latest;
    await harness.manager.disconnect();
    staleController.connectResult.resolve({ siteSelected: true, sites: [SITES[0]] });
    assert.deepEqual(await stale, { success: false, error: 'connectionSuperseded' });
    assert.equal(harness.manager.controller, null);
    assert.equal(old.events.filter((event) => event === 'logout').length, 1, 'the disconnect logged it out');
  }); // End of test "a failed, incomplete or superseded attempt still closed the installed controller..."
}); // End of describe 'a new connect closes the installed controller before its first await'
