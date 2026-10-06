// ============================================================================
// Connection: connect/disconnect (including the multi-site selection step),
// data loading, and refresh. Every async path is serialized through the
// operation flags and generation-checked after each await (see state.ts).
// ============================================================================

import type { SiteInfo } from '../shared/types';
import { renderApList } from './ap-list';
import { apFilterInput, connectBtn, refreshBtn, settingsBtn, wlanFilterInput } from './elements';
import { t } from './i18n';
import { showEmptyStates, showLoadingStates, updateSelectionInfo } from './panels';
import { showSiteSelection } from './site-modal';
import { invalidateSession, isOperationInProgress, state } from './state';
import { setStatus } from './status';
import { showToast } from './toast';
import { isValidMac, isValidSiteId, isValidWlanId } from './validation';
import { renderWlanList } from './wlan-list';

/**
 * Maps a failed connection result (stable error codes sent by the main
 * process over IPC — see the OMADA_CONNECT handler in src/main/index.ts) to a
 * localized message. An unknown/absent code falls back to the generic
 * connection error; the optional technical detail is appended when present.
 * @param {{ error?: string; detail?: string }} result - The failed result.
 * @returns {string} The localized error message to display.
 */
function connectionErrorMessage(result: { error?: string; detail?: string }): string {
  let message: string;
  switch (result.error) {
    case 'configIncomplete':
      message = t('configIncomplete');
      break;
    case 'connectFailed':
      message = t('connectFailed');
      break;
    case 'connectionSuperseded':
      message = t('connectionSuperseded');
      break;
    case 'siteUnavailable':
      message = t('siteSelectError');
      break;
    default:
      message = t('connectionError');
      break;
  }
  if (result.detail) {
    message = `${message} (${result.detail})`;
  }
  return message;
} // End of function connectionErrorMessage()

/**
 * Connects to the Omada controller and loads its data. If any step fails
 * (including loadData(), which is allowed to throw), the whole UI state is
 * reset consistently and the main-process controller is released. A no-op
 * while another exclusive operation is in flight; starting a connection
 * begins a new session generation, so any stale in-flight load from a
 * previous session discards its result. Its own generation is re-checked
 * after every await: should this session ever be superseded while awaiting,
 * no stale UI commit (status, button label, data) goes through.
 * @returns {Promise<void>}
 */
export async function connect(): Promise<void> {
  if (isOperationInProgress()) return;
  invalidateSession();
  // This connection's session generation: every post-await UI commit below
  // is discarded when it no longer matches (belt-and-braces on top of the
  // in-flight serialization)
  const generation = state.sessionGeneration;
  state.isConnecting = true;
  setStatus('connecting');
  connectBtn.disabled = true;
  // Settings must stay closed while a connection is in flight: a settings
  // save mid-connect could start a competing attempt (see openSettings())
  settingsBtn.disabled = true;
  connectBtn.textContent = t('connecting');

  try {
    const result = await window.omadaAPI.connect();

    // Stale result (session superseded while awaiting): discard it
    if (generation !== state.sessionGeneration) return;

    if (result.success) {
      await commitConnectedUi(generation);
    } else if (result.error === 'connectionSuperseded') {
      // Stale attempt: a newer main-process flow (connect or disconnect)
      // owns the session now. Reset only the local UI — invoking a
      // disconnect here could log out the controller that newer flow owns
      resetConnectionUi(connectionErrorMessage(result));
    } else if (result.needsSiteSelection) {
      // Multi-site controller with no valid stored choice: let the user pick
      await runSiteSelection(result.sites, result.selectionNonce, generation);
    } else {
      await abortConnection(generation, connectionErrorMessage(result));
    }
  } catch (error) {
    console.error('Error connecting:', error);
    // A stale failure must neither flip the newer session's UI nor release
    // a controller that the newer session may own (abortConnection()
    // re-checks the generation itself, but never reach it when stale)
    if (generation !== state.sessionGeneration) return;
    await abortConnection(generation, t('connectionError'));
  } finally {
    state.isConnecting = false;
    // Only the current session owner may re-enable the buttons; when stale,
    // the superseding operation manages the button lifecycle itself
    if (generation === state.sessionGeneration) {
      connectBtn.disabled = false;
      settingsBtn.disabled = false;
    }
  }
} // End of function connect()

/**
 * Commits the connected UI (status text, button label) and loads the
 * controller data. Part of connect(): errors thrown here — including by
 * loadData() — are handled by connect()'s catch so the whole UI state stays
 * consistent. Every post-await commit is generation-checked.
 * @param {number} generation - The session generation captured by connect().
 * @returns {Promise<void>}
 */
async function commitConnectedUi(generation: number): Promise<void> {
  const config = await window.omadaAPI.loadConfig();
  // Stale result: a newer session owns the UI now
  if (generation !== state.sessionGeneration) return;
  setStatus('connected', config.url);
  connectBtn.textContent = t('disconnect');
  await loadData();
} // End of function commitConnectedUi()

/**
 * Resets the local connection UI to a non-connected state: error status (or
 * plain disconnected when no message is given), Connect button label, and
 * cleared data. Purely local — it performs no IPC, so it is the right
 * cleanup for results the main process reported as superseded, where
 * releasing anything could hit a controller a newer flow owns.
 * @param {string | null} errorMessage - Localized error to show in the status
 *   bar, or null for a plain return to the disconnected state.
 */
function resetConnectionUi(errorMessage: string | null): void {
  if (errorMessage !== null) {
    setStatus('error', errorMessage);
  } else {
    setStatus('disconnected');
  }
  connectBtn.textContent = t('connect');
  clearData();
} // End of function resetConnectionUi()

/**
 * Resets the UI after a failed or user-aborted connection attempt and
 * releases the main-process controller so stale sessions cannot linger.
 * Generation-checked as a whole: a stale call must neither flip the newer
 * session's UI nor release a controller the newer session may own. When a
 * selection nonce is given, the release is ownership-scoped: the main
 * process only aborts the pending site selection owning that exact nonce
 * (a superseded nonce makes the call a harmless no-op there). Superseded
 * connect results never reach this function at all — they reset the UI via
 * resetConnectionUi() without any IPC.
 * @param {number} generation - The session generation captured by connect().
 * @param {string | null} errorMessage - Localized error to show in the status
 *   bar, or null for a plain return to the disconnected state (user cancel).
 * @param {string} [selectionNonce] - Opaque nonce of the pending site
 *   selection to abort; omitted for an unconditional disconnect.
 * @returns {Promise<void>}
 */
async function abortConnection(generation: number, errorMessage: string | null, selectionNonce?: string): Promise<void> {
  if (generation !== state.sessionGeneration) return;
  resetConnectionUi(errorMessage);
  try {
    await window.omadaAPI.disconnect(selectionNonce);
  } catch (disconnectError) {
    console.error('Error disconnecting after connection failure:', disconnectError);
  }
} // End of function abortConnection()

/**
 * Runs the multi-site selection step of connect(): validates the site list
 * and the opaque selection nonce received over IPC (ids must be well-formed —
 * they cross the boundary again as the selection; the nonce is echoed back
 * verbatim and never interpreted beyond being a non-empty string), shows the
 * site modal, and completes the connection with the chosen site (or aborts it
 * on cancel/failure — an abort scoped to this pending selection via the
 * nonce, so it can never log out a session a newer flow owns). Part of
 * connect(), so isConnecting stays true throughout and every post-await
 * commit is generation-checked.
 * @param {unknown} rawSites - The `sites` field of the connect result.
 * @param {unknown} rawNonce - The `selectionNonce` field of the connect
 *   result (opaque; passed back to the main process, never interpreted).
 * @param {number} generation - The session generation captured by connect().
 * @returns {Promise<void>}
 */
async function runSiteSelection(rawSites: unknown, rawNonce: unknown, generation: number): Promise<void> {
  // Boundary validation: keep only entries with a well-formed id and a
  // string name (the id goes back over IPC as the user's selection)
  const sites: SiteInfo[] = Array.isArray(rawSites)
    ? rawSites.filter((site): site is SiteInfo =>
        site !== null &&
        typeof site === 'object' &&
        isValidSiteId((site as { id?: unknown }).id) &&
        typeof (site as { name?: unknown }).name === 'string'
      )
    : [];

  // The nonce is opaque: only its presence and type are checked, never its
  // content — the main process is the sole interpreter
  const selectionNonce = typeof rawNonce === 'string' && rawNonce.length > 0 ? rawNonce : null;

  if (sites.length === 0 || selectionNonce === null) {
    // Nothing valid to offer (or no nonce to answer with): treat it as a
    // failed connection. Without a nonce the abort falls back to the
    // unconditional disconnect, which also clears any pending selection
    await abortConnection(generation, t('siteSelectError'), selectionNonce ?? undefined);
    return;
  }

  const chosenSiteId = await showSiteSelection(sites);
  if (generation !== state.sessionGeneration) return;

  if (chosenSiteId === null) {
    // User cancelled: not an error — back to the disconnected state (the
    // nonce-scoped abort releases only this pending selection)
    await abortConnection(generation, null, selectionNonce);
    return;
  }

  const result = await window.omadaAPI.selectSite(chosenSiteId, selectionNonce);
  if (generation !== state.sessionGeneration) return;

  if (result.success) {
    await commitConnectedUi(generation);
  } else {
    await abortConnection(generation, connectionErrorMessage(result), selectionNonce);
  }
} // End of function runSiteSelection()

/**
 * Clears all loaded AP/WLAN data, selections, and filters, then re-renders
 * the empty states and the selection info (which disables the Apply button).
 */
function clearData(): void {
  state.accessPoints = [];
  state.wlanGroups = [];
  state.selectedAp = null;
  state.selectedWlan = null;
  state.apFilterText = '';
  state.wlanFilterText = '';
  apFilterInput.value = '';
  wlanFilterInput.value = '';

  showEmptyStates();
  updateSelectionInfo();
} // End of function clearData()

/**
 * Disconnects from the controller: releases the main-process controller via
 * IPC and clears the UI state, even if the IPC call fails. The single public
 * guarded entry point (Disconnect button): a no-op while any exclusive
 * operation is in flight, so a disconnect can never overlap a pending
 * connect/save/apply/refresh. Internal cleanup paths that must always run
 * (e.g. the failure paths inside connect()) call window.omadaAPI.disconnect()
 * directly instead. The session generation is bumped FIRST, so a data load
 * still in flight discards its result instead of repopulating the
 * disconnected UI; the disconnected-UI commit itself is generation-checked
 * too, so it can never clobber a session that superseded this one.
 * @returns {Promise<void>}
 */
async function disconnect(): Promise<void> {
  if (isOperationInProgress()) return;
  state.isDisconnecting = true;
  invalidateSession();
  // This disconnect's session generation (see the finally block below)
  const generation = state.sessionGeneration;
  try {
    await window.omadaAPI.disconnect();
  } catch (error) {
    console.error('Error disconnecting:', error);
  } finally {
    state.isDisconnecting = false;
    // Only commit the disconnected UI while this is still the current
    // session; when superseded, the newer operation owns the UI
    if (generation === state.sessionGeneration) {
      state.isConnected = false;
      setStatus('disconnected');
      connectBtn.textContent = t('connect');
      connectBtn.disabled = false;
      clearData();
    }
  }
} // End of function disconnect()

/**
 * Connect button handler: disconnects when connected, connects otherwise.
 */
export function toggleConnection() {
  if (state.isConnected) {
    disconnect();
  } else {
    connect();
  }
}

/**
 * Loads access points and WLAN groups from the controller and renders them.
 * Shows a spinner in both panels while fetching (and spins the Refresh
 * button). The session generation is captured before awaiting: if it moves on
 * meanwhile (disconnect/reconnect), the result — success or error — is
 * discarded without committing anything to the UI, and the loading state is
 * left alone (invalidateSession() already reset it for the new session).
 * Current-session errors are intentionally not caught here: the caller
 * handles them so the whole UI state stays consistent (see connect(),
 * refreshData(), and applyChange()).
 * @returns {Promise<void>}
 */
export async function loadData(): Promise<void> {
  const generation = state.sessionGeneration;
  state.isLoadingData = true;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');
  showLoadingStates();

  try {
    const [aps, wlans] = await Promise.all([
      window.omadaAPI.getAccessPoints(),
      window.omadaAPI.getWlanGroups()
    ]);

    // Stale result (the session changed while awaiting): discard it
    if (generation !== state.sessionGeneration) return;

    // Keep only entries whose identifiers have a valid format: they cross the
    // IPC boundary again when a change is applied, and a malformed id coming
    // from a compromised controller must never reach the UI or the main process
    state.accessPoints = aps.filter(ap => {
      if (!isValidMac(ap.mac)) {
        console.warn('Ignoring access point with invalid MAC format:', ap.mac);
        return false;
      }
      return true;
    });
    state.wlanGroups = wlans.filter(wlan => {
      if (!isValidWlanId(wlan.wlanId)) {
        console.warn('Ignoring WLAN group with invalid id format:', wlan.wlanId);
        return false;
      }
      return true;
    });

    // Reset selection
    state.selectedAp = null;
    state.selectedWlan = null;

    renderApList();
    renderWlanList();
    updateSelectionInfo();
  } catch (error) {
    // Stale failure: swallow it (the disconnected/new UI must not react)
    if (generation !== state.sessionGeneration) {
      console.warn('Discarding data-load error from a stale session:', error);
      return;
    }
    throw error;
  } finally {
    // Only the operation that owns the current session may clear the loading
    // state; a stale load must not re-enable Refresh for a newer session
    if (generation === state.sessionGeneration) {
      state.isLoadingData = false;
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = !state.isConnected;
    }
  }
} // End of function loadData()

/**
 * Reloads APs and WLAN groups on demand (Refresh button). A no-op while any
 * exclusive operation (connect/save/apply/load) is pending. On failure the
 * previously loaded data is re-rendered (loadData() leaves the spinners in
 * place when it throws) and an error toast is shown.
 * @returns {Promise<void>}
 */
export async function refreshData(): Promise<void> {
  if (!state.isConnected || isOperationInProgress()) return;

  try {
    await loadData();
  } catch (error) {
    console.error('Error refreshing data:', error);
    showToast(t('loadError'), 'error');
    renderApList();
    renderWlanList();
    updateSelectionInfo();
  }
} // End of function refreshData()
