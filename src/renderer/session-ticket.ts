// ============================================================================
// Session tickets (inbox I-1b2b2; docs/security-audit.md §7): what a
// session-bound flow — the data load, the refresh, the AP move — captures at
// its START: the session generation and the session nonce of the connection
// on screen. Every controller data call the flow makes carries THAT nonce
// (main refuses any other session's: 'notConnected' / 'superseded'), and
// every reply is checked against THAT session, never against whichever
// session is current when the reply arrives: a reply that comes back after
// a disconnect, a reconnect or a controller switch is discarded, never
// applied to the new session's state. Pure (no DOM, no window.omadaAPI: the
// API is passed in), unit-tested in tests/unit/renderer-session-ticket.test.ts.
// ============================================================================

import type { AccessPoint, GroupListing } from '../shared/types';

/** Where the current session is read from (the renderer state). */
export interface SessionSource {
  readonly sessionGeneration: number;
  readonly sessionNonce: string | null;
}

/** The session a flow belongs to, captured at its start. */
export interface SessionTicket {
  readonly generation: number;
  readonly nonce: string;
}

/**
 * Captures the session on screen.
 * @param {SessionSource} source - The renderer state.
 * @returns {SessionTicket | null} The ticket, or null when no session nonce is
 *   held (not connected): a session-bound call cannot be made then.
 */
export function captureSessionTicket(source: SessionSource): SessionTicket | null {
  return source.sessionNonce === null ? null : { generation: source.sessionGeneration, nonce: source.sessionNonce };
}

/**
 * Tells whether the session a ticket was captured for is still the one on
 * screen: the same generation (no connect, disconnect or reset since) and
 * the same nonce.
 * @param {SessionTicket} ticket - The captured ticket.
 * @param {SessionSource} source - The renderer state now.
 * @returns {boolean} True while it is.
 */
export function isTicketCurrent(ticket: SessionTicket, source: SessionSource): boolean {
  return ticket.generation === source.sessionGeneration && ticket.nonce === source.sessionNonce;
}

/** The part of window.omadaAPI the data load uses. */
export interface ControllerDataApi {
  getAccessPoints(sessionNonce: string): Promise<AccessPoint[]>;
  getWlanGroups(sessionNonce: string): Promise<GroupListing>;
}

/**
 * The outcome of fetchControllerData(): the raw replies of the ticket's
 * session (validated by the caller), or `stale` when the session changed
 * while they were awaited — with the failure, if the fetch failed, so the
 * caller can log it without reacting to it.
 */
export type ControllerDataFetch =
  | { stale: false; accessPoints: unknown; listing: unknown }
  | { stale: true; error?: unknown };

/**
 * Fetches the access points and the group listing for the ticket's session:
 * both calls carry the ticket's nonce (captured at the flow's start, never
 * read again), and once both settle the ticket is checked again. A stale
 * result — success or failure — is reported as `stale` and must be
 * discarded; a failure of the current session is rethrown.
 * @param {ControllerDataApi} api - window.omadaAPI (a fake in the tests).
 * @param {SessionTicket} ticket - The session the load belongs to.
 * @param {SessionSource} source - The renderer state (read after the awaits).
 * @returns {Promise<ControllerDataFetch>} The replies, or stale.
 * @throws {unknown} The current session's failure.
 */
export async function fetchControllerData(api: ControllerDataApi, ticket: SessionTicket, source: SessionSource): Promise<ControllerDataFetch> {
  let replies: [unknown, unknown];
  try {
    replies = await Promise.all([api.getAccessPoints(ticket.nonce), api.getWlanGroups(ticket.nonce)]);
  } catch (error) {
    if (!isTicketCurrent(ticket, source)) {
      return { stale: true, error };
    }
    throw error;
  }
  if (!isTicketCurrent(ticket, source)) {
    return { stale: true };
  }
  return { stale: false, accessPoints: replies[0], listing: replies[1] };
} // End of function fetchControllerData()

/**
 * A reload with its follow-up (the refresh flow, and the reload after a
 * move): runs `load` for the ticket's session and then `followUp` with the
 * ticket's generation — the phase 20a fix: the generation captured at the
 * flow's START, never the one current when the load settles — and only while
 * the ticket is still current. A load whose session changed meanwhile (its
 * reply was discarded) starts no follow-up for the new session.
 * @param {SessionTicket} ticket - The session the flow belongs to.
 * @param {SessionSource} source - The renderer state (read after the await).
 * @param {(ticket: SessionTicket) => Promise<void>} load - The data load.
 * @param {(generation: number) => void} followUp - What follows a load of
 *   this session (the managed reads).
 * @returns {Promise<boolean>} True when the follow-up ran.
 * @throws {unknown} What `load` throws.
 */
export async function reloadWithTicket(
  ticket: SessionTicket,
  source: SessionSource,
  load: (ticket: SessionTicket) => Promise<void>,
  followUp: (generation: number) => void
): Promise<boolean> {
  await load(ticket);
  if (!isTicketCurrent(ticket, source)) {
    return false;
  }
  followUp(ticket.generation);
  return true;
} // End of function reloadWithTicket()
