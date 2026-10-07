// ============================================================================
// The fresh Open API view of the site's AP groups (todo.md 4.9): read with
// getManagedApGroups() and the session nonce of the connection on screen,
// only while AP-group management is on (isGroupManagementOn()). It feeds the
// AP groups view's per-band capacity and why Delete is unavailable
// (groups-view.ts); main re-checks every rule on its own fresh read before a
// write anyway. Read after the management capabilities arrive (or change),
// after a refresh or the reload after a move, and after every AP-group
// write. Every reply is checked against the session generation, the nonce
// it was asked with and the read's number: a late reply from an old session,
// nonce or read changes nothing. Values main did not report stay absent. It
// also feeds the "Broadcast on" editor's options and capacity pre-check
// (binding-flow.ts), so the Wi-Fi network's detail is re-rendered once a
// read settles (its "Change AP groups" action follows the list's freshness).
// ============================================================================

import { isGroupManagementOn, renderGroupsView } from './groups-view';
import { parseManagedGroupsResult, type ParsedManagedGroups } from './group-management';
import { renderNetworkDetail } from './networks-view';
import { state } from './state';

/**
 * Forgets the fresh view (disconnect, management off) and invalidates any
 * read in flight (its reply will be discarded). Does not re-render.
 */
export function resetManagedGroups(): void {
  state.managedGroupsRequest++;
  state.managedApGroups = null;
  state.managedSsidLimits = null;
  state.managedGroupsStatus = 'idle';
  state.managedGroupsFailure = null;
}

/**
 * Reads the fresh view of the AP groups for the session on screen and
 * re-renders the AP groups view (and the Wi-Fi network detail) with it. While management is off (or no
 * session is on screen) the view is forgotten instead. The previous view
 * stays on screen while a new read runs; a failed read drops it (the delete
 * reasons then fail closed and the capacity section states the failure).
 * Discarded when the session generation or nonce changed meanwhile, or when
 * a newer read started.
 * @param {number} generation - The session generation the read belongs to.
 * @returns {Promise<void>}
 */
export async function loadManagedGroups(generation: number): Promise<void> {
  if (generation !== state.sessionGeneration) return;
  const nonce = state.sessionNonce;
  if (nonce === null || !isGroupManagementOn()) {
    if (state.managedGroupsStatus !== 'idle') {
      resetManagedGroups();
      renderGroupsView();
    }
    return;
  }
  const request = ++state.managedGroupsRequest;
  if (state.managedApGroups === null) {
    state.managedGroupsStatus = 'loading';
    state.managedGroupsFailure = null;
    renderGroupsView();
  }

  let parsed: ParsedManagedGroups;
  try {
    parsed = parseManagedGroupsResult(await window.omadaAPI.getManagedApGroups(nonce));
  } catch (error) {
    console.warn('Error reading the managed AP groups:', error);
    parsed = { ok: false, error: 'failed', diagnostic: null };
  }
  // A late reply: another session or nonce, or no longer the latest read
  if (generation !== state.sessionGeneration || state.sessionNonce !== nonce || request !== state.managedGroupsRequest) return;

  if (parsed.ok) {
    state.managedApGroups = parsed.groups;
    state.managedSsidLimits = parsed.ssidLimits;
    state.managedGroupsStatus = 'ready';
    state.managedGroupsFailure = null;
  } else {
    state.managedApGroups = null;
    state.managedSsidLimits = null;
    state.managedGroupsStatus = 'failed';
    state.managedGroupsFailure = { error: parsed.error, diagnostic: parsed.diagnostic };
  }
  renderGroupsView();
  renderNetworkDetail();
} // End of function loadManagedGroups()
