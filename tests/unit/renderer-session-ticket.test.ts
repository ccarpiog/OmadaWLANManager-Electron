// Tests for the renderer's session tickets (src/renderer/session-ticket.ts;
// inbox I-1b2b2, docs/security-audit.md §7): a session-bound flow captures
// the session generation and nonce at its START; its controller data calls
// carry that nonce, its replies are checked against that session (a reply
// that arrives after a disconnect, a reconnect or a switch is discarded, a
// failure of the current session is rethrown), and the refresh's follow-up
// runs for the captured generation only while it is still current — the
// phase 20a fix: never for a session that replaced it during the load.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  captureSessionTicket,
  fetchControllerData,
  isTicketCurrent,
  reloadWithTicket,
  type ControllerDataApi,
  type SessionTicket
} from '../../src/renderer/session-ticket';
import type { AccessPoint, GroupListing } from '../../src/shared/types';

const NONCE_A = 'a'.repeat(32);
const NONCE_B = 'b'.repeat(32);
const APS: AccessPoint[] = [{ mac: 'AA-BB-CC-00-00-01', name: 'Salón', type: 'eap', wlanGroup: 'Default', statusCategory: 1 }];
const LISTING: GroupListing = { controllerVersion: '6.3.0.45', groupModel: 'apGroup', groups: [{ wlanId: 'g1', wlanName: 'Default', ssidList: [] }] };

/** A mutable stand-in for the renderer state. */
interface FakeState {
  sessionGeneration: number;
  sessionNonce: string | null;
}

/** A promise with its settle functions exposed. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/**
 * Creates a deferred promise.
 * @template T The value type.
 * @returns {Deferred<T>} The deferred.
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
 * A fake data API whose replies the test settles by hand; it records the
 * nonce each call carried.
 * @returns {{ api: ControllerDataApi; nonces: string[]; aps: Deferred<AccessPoint[]>; listing: Deferred<GroupListing> }} The fake.
 */
function fakeApi(): {
  api: ControllerDataApi;
  nonces: string[];
  aps: Deferred<AccessPoint[]>;
  listing: Deferred<GroupListing>;
} {
  const nonces: string[] = [];
  const aps = deferred<AccessPoint[]>();
  const listing = deferred<GroupListing>();
  const api: ControllerDataApi = {
    getAccessPoints: (nonce) => {
      nonces.push(`aps:${nonce}`);
      return aps.promise;
    },
    getWlanGroups: (nonce) => {
      nonces.push(`wlans:${nonce}`);
      return listing.promise;
    }
  };
  return { api, nonces, aps, listing };
} // End of function fakeApi()

/**
 * The renderer's disconnect / reconnect: a new generation and another nonce.
 * @param {FakeState} state - The fake state.
 * @param {string | null} nonce - The new session's nonce (null: disconnected).
 */
function newSession(state: FakeState, nonce: string | null): void {
  state.sessionGeneration++;
  state.sessionNonce = nonce;
}

describe('captureSessionTicket() / isTicketCurrent()', () => {
  test('a ticket captures generation and nonce; none without a nonce', () => {
    assert.deepEqual(captureSessionTicket({ sessionGeneration: 3, sessionNonce: NONCE_A }), { generation: 3, nonce: NONCE_A });
    assert.equal(captureSessionTicket({ sessionGeneration: 3, sessionNonce: null }), null);
  });

  test('current only while both the generation and the nonce are unchanged', () => {
    const ticket: SessionTicket = { generation: 3, nonce: NONCE_A };
    assert.equal(isTicketCurrent(ticket, { sessionGeneration: 3, sessionNonce: NONCE_A }), true);
    assert.equal(isTicketCurrent(ticket, { sessionGeneration: 4, sessionNonce: NONCE_A }), false);
    assert.equal(isTicketCurrent(ticket, { sessionGeneration: 3, sessionNonce: NONCE_B }), false);
    assert.equal(isTicketCurrent(ticket, { sessionGeneration: 3, sessionNonce: null }), false);
  });
}); // End of describe 'captureSessionTicket() / isTicketCurrent()'

describe('fetchControllerData(): the captured nonce, and stale replies discarded', () => {
  test('both calls carry the captured nonce; the current session\'s replies are passed on', async () => {
    const state: FakeState = { sessionGeneration: 1, sessionNonce: NONCE_A };
    const fake = fakeApi();
    const ticket = captureSessionTicket(state) as SessionTicket;
    const pending = fetchControllerData(fake.api, ticket, state);
    fake.aps.resolve(APS);
    fake.listing.resolve(LISTING);
    assert.deepEqual(await pending, { stale: false, accessPoints: APS, listing: LISTING });
    assert.deepEqual(fake.nonces, [`aps:${NONCE_A}`, `wlans:${NONCE_A}`]);
  });

  test('a reply that arrives after a reconnect or a switch is stale: discarded, never applied to the new session', async () => {
    const state: FakeState = { sessionGeneration: 1, sessionNonce: NONCE_A };
    const fake = fakeApi();
    const pending = fetchControllerData(fake.api, captureSessionTicket(state) as SessionTicket, state);
    newSession(state, NONCE_B);
    fake.aps.resolve(APS);
    fake.listing.resolve(LISTING);
    assert.deepEqual(await pending, { stale: true });
    assert.deepEqual(fake.nonces, [`aps:${NONCE_A}`, `wlans:${NONCE_A}`], 'the calls went out with the old session\'s nonce, never the new one');
  });

  test('a failure: rethrown for the current session, reported as stale (with the error, to log) after a disconnect', async () => {
    const state: FakeState = { sessionGeneration: 1, sessionNonce: NONCE_A };
    const current = fakeApi();
    const failing = fetchControllerData(current.api, captureSessionTicket(state) as SessionTicket, state);
    current.aps.reject(new Error('controller down'));
    current.listing.resolve(LISTING);
    await assert.rejects(failing, /controller down/);
    const late = fakeApi();
    const pending = fetchControllerData(late.api, captureSessionTicket(state) as SessionTicket, state);
    newSession(state, null);
    const refusal = new Error('superseded (the session nonce does not name the installed controller session)');
    late.aps.reject(refusal);
    late.listing.resolve(LISTING);
    assert.deepEqual(await pending, { stale: true, error: refusal });
  }); // End of test "a failure..."
}); // End of describe 'fetchControllerData()'

describe('reloadWithTicket(): the refresh follow-up uses the generation captured at the start (phase 20a fix)', () => {
  test('a load of the current session: the follow-up runs once, for the captured generation', async () => {
    const state: FakeState = { sessionGeneration: 5, sessionNonce: NONCE_A };
    const ticket = captureSessionTicket(state) as SessionTicket;
    const loads: SessionTicket[] = [];
    const followUps: number[] = [];
    const ran = await reloadWithTicket(ticket, state, async (given) => void loads.push(given), (generation) => void followUps.push(generation));
    assert.equal(ran, true);
    assert.deepEqual(loads, [ticket], 'the load gets the captured ticket');
    assert.deepEqual(followUps, [5]);
  });

  test('the session changes while the load is awaited: no follow-up at all — never one for the new session\'s generation', async () => {
    const state: FakeState = { sessionGeneration: 5, sessionNonce: NONCE_A };
    const ticket = captureSessionTicket(state) as SessionTicket;
    const load = deferred<void>();
    const followUps: number[] = [];
    const pending = reloadWithTicket(ticket, state, () => load.promise, (generation) => void followUps.push(generation));
    // A disconnect and a new connect while the reply is on its way (the
    // pre-20a refresh read the generation here and started the managed
    // reads for the NEW session)
    newSession(state, null);
    newSession(state, NONCE_B);
    load.resolve();
    assert.equal(await pending, false);
    assert.deepEqual(followUps, []);
  });

  test('a failing load is passed on and starts no follow-up', async () => {
    const state: FakeState = { sessionGeneration: 5, sessionNonce: NONCE_A };
    const followUps: number[] = [];
    await assert.rejects(
      reloadWithTicket(captureSessionTicket(state) as SessionTicket, state, async () => {
        throw new Error('load failed');
      }, (generation) => void followUps.push(generation)),
      /load failed/
    );
    assert.deepEqual(followUps, []);
  });
}); // End of describe 'reloadWithTicket()'
