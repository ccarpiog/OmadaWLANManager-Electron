// Tests for the session ownership of the controller data channels
// (sessionDataReply() in src/main/controller-session.ts; inbox I-1b2b2,
// docs/security-audit.md §7): OMADA_GET_APS, OMADA_GET_WLANS and
// OMADA_SET_WLAN act only for the installed, open session the renderer names
// by its nonce. Checked BEFORE the controller call: no installed or a closed
// session is 'notConnected', another session's nonce 'superseded' (the call
// never runs). A result or failure that settles once the session was replaced
// or closed is 'superseded'; the current session's own failure passes
// unchanged. The rejection messages start with the code. Fakes only.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sessionDataRefusal, sessionDataReply, type SessionBound } from '../../src/main/controller-session';

const NONCE = '1'.repeat(32);
const OTHER = '2'.repeat(32);

/** A fake installed session. */
class FakeSession implements SessionBound {
  readonly sessionNonce: string;
  isClosed = false;

  /**
   * Creates the fake.
   * @param {string} nonce - Its session nonce.
   */
  constructor(nonce: string) {
    this.sessionNonce = nonce;
  }
}

/** A fake connection manager: only the installed session. */
interface FakeManager {
  controller: FakeSession | null;
}

/**
 * A data call the test settles by hand, counting its runs.
 * @returns {{ run: (session: FakeSession) => Promise<string>; runs: FakeSession[]; resolve(value: string): void; reject(error: unknown): void }} The call.
 */
function heldCall(): { run: (session: FakeSession) => Promise<string>; runs: FakeSession[]; resolve(value: string): void; reject(error: unknown): void } {
  const runs: FakeSession[] = [];
  let resolve!: (value: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    run: (session) => {
      runs.push(session);
      return promise;
    },
    runs,
    resolve: (value) => resolve(value),
    reject: (error) => reject(error)
  };
} // End of function heldCall()

describe('sessionDataReply(): refused before any controller call', () => {
  test('no installed session, or a closed one (a newer connect, a switch or a transition started): notConnected', async () => {
    const call = heldCall();
    await assert.rejects(sessionDataReply<FakeSession, string>({ controller: null }, NONCE, call.run), { message: /^notConnected \(/ });
    const closed = new FakeSession(NONCE);
    closed.isClosed = true;
    await assert.rejects(sessionDataReply({ controller: closed }, NONCE, call.run), { message: /^notConnected \(/ });
    assert.equal(call.runs.length, 0);
  });

  test('another session\'s nonce (a stale one): superseded', async () => {
    const call = heldCall();
    await assert.rejects(sessionDataReply({ controller: new FakeSession(NONCE) }, OTHER, call.run), { message: /^superseded \(/ });
    assert.equal(call.runs.length, 0);
  });

  test('the refusal messages start with the code and quote no value', () => {
    assert.equal(sessionDataRefusal('notConnected').message, 'notConnected (no open controller session is installed)');
    assert.equal(sessionDataRefusal('superseded').message, 'superseded (the session nonce does not name the installed controller session)');
  });
}); // End of describe 'sessionDataReply(): refused before any controller call'

describe('sessionDataReply(): the current session, and late results', () => {
  test('the installed session\'s nonce: the call runs on it and its result is passed on', async () => {
    const session = new FakeSession(NONCE);
    const call = heldCall();
    const reply = sessionDataReply({ controller: session }, NONCE, call.run);
    call.resolve('aps');
    assert.equal(await reply, 'aps');
    assert.deepEqual(call.runs, [session]);
  });

  test('replaced (a switch, a reconnect) or closed while the call ran: the late result is superseded, never passed on', async () => {
    for (const change of ['replaced', 'closed', 'disconnected'] as const) {
      const session = new FakeSession(NONCE);
      const manager: FakeManager = { controller: session };
      const call = heldCall();
      const reply = sessionDataReply(manager, NONCE, call.run);
      if (change === 'replaced') {
        manager.controller = new FakeSession(OTHER);
      } else if (change === 'closed') {
        session.isClosed = true;
      } else {
        manager.controller = null;
      }
      call.resolve('late result');
      await assert.rejects(reply, { message: /^superseded \(/ }, change);
    } // End of the loop over the session changes
  });

  test('a failure: the current session\'s own error passes unchanged; after a switch it is superseded too', async () => {
    const session = new FakeSession(NONCE);
    const manager: FakeManager = { controller: session };
    const current = heldCall();
    const failing = sessionDataReply(manager, NONCE, current.run);
    current.reject(new Error('moveNotConfirmed (AP listed in another group, 3 reads)'));
    await assert.rejects(failing, { message: 'moveNotConfirmed (AP listed in another group, 3 reads)' });
    const late = heldCall();
    const reply = sessionDataReply(manager, NONCE, late.run);
    manager.controller = new FakeSession(OTHER);
    late.reject(new Error('Not connected to the controller'));
    await assert.rejects(reply, { message: /^superseded \(/ });
  }); // End of test "a failure..."
}); // End of describe 'sessionDataReply(): the current session, and late results'
