// ============================================================================
// The managed (Open API) list of the site's Wi-Fi networks (todo.md 4.10,
// phase 17b): read with getManagedNetworks() and the session nonce of the
// connection on screen, only while Wi-Fi network management is on
// (isNetworkManagementOn()); the Wi-Fi networks view (networks-view.ts)
// shows it instead of the 14a internal-data view. Read after the management
// capabilities arrive (or change), after a refresh or the reload after a
// move, and on the Retry of the error state or of the refresh-error notice.
// Every reply is checked against the session generation, the nonce it was
// asked with and the read's number (isCurrentNetworkRead()): a late reply
// from an old session, nonce or read changes nothing. The reply is validated
// whole (parseManagedNetworksResult()) and settled against the list held
// (settleNetworkRead()): a new list replaces it whole; a failed or malformed
// FIRST read shows the view's error state with Retry, never a partial list;
// a failed RE-READ keeps the last good list of the same session on screen,
// stale, with the §4.6 refresh-error notice (its time and the reason), until
// a later read succeeds. While the first read runs the view shows its
// loading skeleton; a re-read keeps the list on screen until the new reply
// arrives. Writes are held back while a read runs or after one failed
// (network-editing.ts networkWriteBlock()); since a re-read does not
// re-render the view as it starts, the read's status is mirrored on the
// list as data-managed-read ('idle', 'loading', 'ready', 'failed').
// ============================================================================

import { networkList, networkSearchInput, networksStaleNotice } from './elements';
import { renderNetworksSource } from './navigation';
import {
  isCurrentNetworkRead,
  isHeldForSession,
  parseManagedNetworksResult,
  settleNetworkRead,
  type HeldManagedNetworks,
  type ManagedNetworksStatus,
  type NetworkReadTicket,
  type ParsedManagedNetworks,
} from './network-management';
import { isNetworkManagementOn } from './networks-view';
import { state } from './state';

/**
 * Sets where the managed read is (state.managedNetworksStatus) and mirrors
 * it on the list as data-managed-read: a re-read keeps the view as it is
 * while it runs, so this tells that the list on screen is being read again.
 * @param {ManagedNetworksStatus} status - The read's status.
 */
function setManagedNetworksStatus(status: ManagedNetworksStatus): void {
  state.managedNetworksStatus = status;
  networkList.dataset.managedRead = status;
}

/**
 * Forgets the managed list (disconnect, a new session, management off or a
 * check run starting) and invalidates any read in flight (its reply will be
 * discarded). Does not re-render.
 */
export function resetManagedNetworks(): void {
  state.managedNetworksRequest++;
  state.managedNetworks = null;
  state.managedNetworksStamp = null;
  setManagedNetworksStatus('idle');
  state.managedNetworksFailure = null;
}

/**
 * Forgets the managed list and re-renders the Wi-Fi networks view (back to
 * the 14a view) when one was held, read or failed.
 */
export function forgetManagedNetworks(): void {
  const shown = state.managedNetworksStatus !== 'idle';
  resetManagedNetworks();
  if (shown) {
    renderNetworksSource();
  }
}

/**
 * The managed list held now, with the session it was read for, or null.
 * @returns {HeldManagedNetworks | null} The held list, or null.
 */
function heldNetworks(): HeldManagedNetworks | null {
  if (state.managedNetworks === null || state.managedNetworksStamp === null) return null;
  return { ...state.managedNetworksStamp, networks: state.managedNetworks };
}

/**
 * Reads the managed list of Wi-Fi networks for the session on screen and
 * re-renders the Wi-Fi networks view with it. While management is off (or
 * no session is on screen) the list is forgotten instead (the 14a view).
 * The first read shows the loading skeleton; a re-read keeps the list on
 * screen (a stale one loses its notice while it runs). The reply settles
 * against the held list (settleNetworkRead()): a new list replaces it
 * whole; a failed or malformed re-read keeps the last good list of the same
 * session, stale, with its notice; a failed first read shows the error
 * state with Retry. Discarded when the session generation or nonce changed
 * meanwhile, or when a newer read started.
 * @param {number} generation - The session generation the read belongs to.
 * @returns {Promise<void>}
 */
export async function loadManagedNetworks(generation: number): Promise<void> {
  if (generation !== state.sessionGeneration) return;
  const nonce = state.sessionNonce;
  if (nonce === null || !isNetworkManagementOn()) {
    forgetManagedNetworks();
    return;
  }
  const ticket: NetworkReadTicket = { generation, nonce, request: ++state.managedNetworksRequest };
  // A list read for another session is never kept (a new session resets it
  // anyway)
  if (!isHeldForSession(state.managedNetworksStamp, ticket)) {
    state.managedNetworks = null;
    state.managedNetworksStamp = null;
  }
  const wasStale = state.managedNetworksStatus === 'failed' && state.managedNetworks !== null;
  setManagedNetworksStatus('loading');
  state.managedNetworksFailure = null;
  if (state.managedNetworks === null || wasStale) {
    renderNetworksSource();
  }

  let parsed: ParsedManagedNetworks;
  try {
    parsed = parseManagedNetworksResult(await window.omadaAPI.getManagedNetworks(nonce));
  } catch (error) {
    console.warn('Error reading the managed Wi-Fi networks:', error);
    parsed = { ok: false, error: 'failed', diagnostic: null };
  }
  // A late reply: another session or nonce, or no longer the latest read
  if (!isCurrentNetworkRead(ticket, { generation: state.sessionGeneration, nonce: state.sessionNonce, request: state.managedNetworksRequest })) return;

  const settled = settleNetworkRead(heldNetworks(), ticket, parsed, Date.now());
  state.managedNetworks = settled.held === null ? null : settled.held.networks;
  state.managedNetworksStamp = settled.held === null ? null : { generation: settled.held.generation, nonce: settled.held.nonce, readAt: settled.held.readAt };
  setManagedNetworksStatus(settled.status);
  state.managedNetworksFailure = settled.failure;
  renderNetworksSource();
} // End of function loadManagedNetworks()

/**
 * Retry of the managed read's error state and of the stale list's
 * refresh-error notice: reads the list again for the session on screen (the
 * skeleton replaces the error at once; a stale list stays, without its
 * notice). Focus moves from the Retry button, which is about to disappear,
 * to the view's search.
 */
export function retryManagedNetworks(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && (networkList.contains(active) || networksStaleNotice.contains(active))) {
    networkSearchInput.focus({ preventScroll: true });
  }
  void loadManagedNetworks(state.sessionGeneration);
}
