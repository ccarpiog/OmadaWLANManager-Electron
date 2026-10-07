// ============================================================================
// Connection: connect/disconnect (including the multi-site selection step and
// the certificate trust-on-first-use step), data loading, refresh, and the
// Retry of the §4.6 error states. A failed connection or first data load
// leaves its message in state.loadError (the views' persistent inline error);
// a failed reload marks the data on screen as stale (state.refreshError).
// A successful connection keeps the site name and the session nonce main
// reported, and after its first data load fetches the management
// capabilities in the background (management.ts).
// The controller switcher's switch (inbox I-1c2b, switchToController()) runs
// the same attempt as connect() over switchController(), after dropping the
// controller on screen (data, selection, searches, managed caches, details,
// Back history); a refused TP-Link cloud connect gets its own text
// (cloudConnectFailureKey()), and a local controller that did not answer
// may be offered "Connect through TP-Link cloud" (offerCloudFallback()).
// Every async path is serialized through the operation flags and
// generation-checked after each await (see state.ts).
// ============================================================================

import type { AccessPoint, CertificateActionResult, ConnectionResult, ControllerTarget, SiteInfo } from '../shared/types';
import { renderApFilterOptions, renderApList } from './ap-list';
import { GROUP_FILTER_ALL, pruneSelection, sanitizeClientCount, STATUS_FILTER_ALL } from './ap-selection';
import { showCertificateChanged, showCertificateTrust } from './cert-modal';
import { applySwitcherConfig, loadCloudControllers, renderControllerSwitcher, syncSwitcherConfig } from './controller-switcher';
import { cloudConnectFailureKey, cloudFallbackTarget, isLocalUnreachable, isSwitcherBusy, localOmadacIdOf } from './controller-switcher-model';
import { renderDestinationList, renderMovePreview } from './destination-pane';
import { apFilterInput, connectBtn, destinationSearchInput, refreshBtn, settingsBtn } from './elements';
import { t } from './i18n';
import { loadManagedGroups, resetManagedGroups } from './managed-groups';
import { loadManagedNetworks, resetManagedNetworks } from './managed-networks';
import { beginCapabilityCheck, loadManagementCapabilities } from './management';
import { isAmbiguousGroup } from './move-plan';
import { isAnyModalOpen } from './modal-focus';
import { renderInventoryViews, resetInventoryViews } from './navigation';
import { renderNetworksView } from './networks-view';
import { renderNotices } from './notices';
import { applyGroupVocabulary, renderContentViews } from './panels';
import { renderNavCounts } from './shell';
import { showSiteSelection } from './site-modal';
import { captureSessionTicket, fetchControllerData, isTicketCurrent, reloadWithTicket, type SessionTicket } from './session-ticket';
import { invalidateSession, isOperationInProgress, setListsRefreshing, state } from './state';
import { renderHeaderMeta, setStatus } from './status';
import { showToast } from './toast';
import {
  isValidMac,
  isValidSiteId,
  isValidWlanId,
  parseCertificateDetails,
  parseControllerName,
  parseGroupListing,
  parseSessionNonce,
  parseSiteName,
} from './validation';

/**
 * The localized text of a connection error code (stable codes sent by the
 * main process over IPC — see the OMADA_CONNECT handler in
 * src/main/index.ts); an unknown/absent code is the generic connection error.
 * @param {string | undefined} error - The error code.
 * @returns {string} The localized text.
 */
function connectionErrorText(error: string | undefined): string {
  switch (error) {
    case 'configIncomplete':
      return t('configIncomplete');
    case 'connectFailed':
      return t('connectFailed');
    case 'connectionSuperseded':
      return t('connectionSuperseded');
    case 'siteUnavailable':
      return t('siteSelectError');
    case 'certificateUntrusted':
      return t('certUntrustedStatus');
    case 'certificateChanged':
      return t('certChangedStatus');
    default:
      return t('connectionError');
  }
} // End of function connectionErrorText()

/**
 * Maps a failed connection result to a localized message: for a TP-Link
 * cloud target, a refused connect whose code-first `detail` has its own text
 * (cloudConnectFailureKey(): rate limiting -7132, offline, an expired or
 * deleted credential -52602 pointing at Settings → TP-Link cloud, none saved,
 * an unknown controller, the session codes); otherwise the code's text
 * (connectionErrorText()). The optional technical detail is appended when
 * present.
 * @param {{ error?: string; detail?: string }} result - The failed result.
 * @param {boolean} [cloudTarget=false] - The attempt was for a cloud controller.
 * @returns {string} The localized error message to display.
 */
function connectionErrorMessage(result: { error?: string; detail?: string }, cloudTarget = false): string {
  const cloudKey = cloudTarget ? cloudConnectFailureKey(result) : null;
  let message = cloudKey !== null ? t(cloudKey) : connectionErrorText(result.error);
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
 * no stale UI commit (status, button label, data) goes through. The
 * management capabilities on screen are dropped at once (a reconnect, e.g.
 * after a settings save): main closes the installed session's management
 * side as the attempt starts and the new session runs its own checks, so
 * no AP-group write action outlives the old verdict. Started from the
 * Connect button, the attempt gives focus back to it once it is enabled
 * again (restoreConnectFocus()). Main connects its current target: a
 * refused TP-Link cloud connect gets the cloud texts (inbox I-1c2b).
 * @returns {Promise<void>}
 */
export async function connect(): Promise<void> {
  if (isOperationInProgress()) return;
  await runConnectionAttempt(() => window.omadaAPI.connect(), state.connectionTarget?.kind === 'cloud', false);
} // End of function connect()

/**
 * Switches to another controller (the controller switcher and "Connect
 * through TP-Link cloud", inbox I-1c2b): a no-op while the switcher is busy
 * (isSwitcherBusy(): a move, a write, a connect, a disconnect, a save, a
 * certificate reset — a data load or refresh does not block it, it is
 * superseded). The renderer session is invalidated FIRST — the generation
 * bumped and the session nonce dropped, so every reply still in flight for
 * the old controller is discarded —, the controller on screen is dropped
 * (clearData(): data, AP selection, destination, filters and searches,
 * managed caches, the AP details pane and drill-ins, the Back history; the
 * views show the loading skeletons), then main's switchController() runs and
 * its reply (that connect's result) is handled exactly like connect()'s —
 * site selection, certificate trust, the cloud error texts. Main's target
 * is read back afterwards for the switcher (it changes even when the new
 * controller's connect fails).
 * @param {ControllerTarget} target - The controller to switch to.
 * @returns {Promise<void>}
 */
export async function switchToController(target: ControllerTarget): Promise<void> {
  if (isSwitcherBusy(state)) return;
  await runConnectionAttempt(() => window.omadaAPI.switchController(target), target.kind === 'cloud', true);
} // End of function switchToController()

/**
 * The attempt shared by connect() and switchToController() (see them): the
 * session invalidated, the connecting state shown (the switcher disabled),
 * the request awaited and its result handled (handleConnectResult()), the
 * buttons released and the switcher re-rendered at the end. Every post-await
 * commit is generation-checked.
 * @param {() => Promise<ConnectionResult>} request - The IPC call (connect or switch).
 * @param {boolean} cloudTarget - The attempt is for a TP-Link cloud controller.
 * @param {boolean} isSwitch - A controller switch (drops the controller on screen first).
 * @returns {Promise<void>}
 */
async function runConnectionAttempt(request: () => Promise<ConnectionResult>, cloudTarget: boolean, isSwitch: boolean): Promise<void> {
  // Disabling the Connect button below drops its focus; remember that it
  // started the attempt (spec §4.7: focus returns to the opener once the
  // certificate or site dialog it may open has closed)
  const fromConnectButton = document.activeElement === connectBtn;
  invalidateSession();
  beginCapabilityCheck();
  // This connection's session generation: every post-await UI commit below
  // is discarded when it no longer matches (belt-and-braces on top of the
  // in-flight serialization)
  const generation = state.sessionGeneration;
  state.isConnecting = true;
  // A new attempt replaces the previous error (and its "Connect through
  // TP-Link cloud" offer) with the loading skeletons
  state.loadError = null;
  state.refreshError = false;
  state.cloudFallback = null;
  if (isSwitch) {
    // The controller on screen goes at once: its session (the nonce with
    // the old generation, like disconnect()), its site and every piece of
    // view state that belongs to it (clearData(); the views show the
    // skeletons while isConnecting)
    state.sessionNonce = null;
    state.siteName = null;
    state.isConnected = false;
    clearData();
  }
  setStatus('connecting');
  connectBtn.disabled = true;
  // Settings must stay closed while a connection is in flight: a settings
  // save mid-connect could start a competing attempt (see openSettings())
  settingsBtn.disabled = true;
  connectBtn.textContent = t('connecting');
  renderContentViews();
  renderControllerSwitcher();

  try {
    const result = await request();

    // Stale result (session superseded while awaiting): discard it
    if (generation !== state.sessionGeneration) return;

    await handleConnectResult(result, generation, true, cloudTarget);
  } catch (error) {
    console.error(isSwitch ? 'Error switching controllers:' : 'Error connecting:', error);
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
      // Without data the views still show the loading state of the attempt:
      // bring them to its outcome (disconnected or the inline error)
      if (state.lastUpdatedAt === null) {
        renderContentViews();
      }
      restoreConnectFocus(fromConnectButton);
      if (isSwitch) {
        void syncAfterSwitch(generation);
      }
    }
    renderControllerSwitcher();
  }
} // End of function runConnectionAttempt()

/**
 * After a switch: reads main's target back for the switcher (the switch
 * persisted it even when the new controller's connect failed), and —
 * still disconnected and idle — lets the Connect button and the views follow
 * whether connect() now reaches a controller (a cloud-only configuration).
 * @param {number} generation - The switch's session generation.
 * @returns {Promise<void>}
 */
async function syncAfterSwitch(generation: number): Promise<void> {
  await syncSwitcherConfig();
  if (generation !== state.sessionGeneration || state.isConnected || isOperationInProgress()) return;
  connectBtn.disabled = !state.hasStoredConfig;
  if (state.lastUpdatedAt === null) {
    renderContentViews();
  }
} // End of function syncAfterSwitch()

/**
 * Gives focus back to the Connect button after an attempt it started, once
 * the button is enabled again: disabling it dropped its focus to the page,
 * and the certificate and site dialogs restore focus to their opener — that
 * disabled button — when they close, which cannot take it. Focus counts as
 * lost on the page itself, or still inside a dialog that just closed (an
 * inert subtree: the browser only moves it out at its next update). Focus
 * that went somewhere else meanwhile (a dialog still open, a control the
 * user picked) is left alone.
 * @param {boolean} fromConnectButton - The Connect button started the attempt.
 */
function restoreConnectFocus(fromConnectButton: boolean): void {
  if (!fromConnectButton || isAnyModalOpen()) return;
  const active = document.activeElement;
  if (active === null || active === document.body || active.closest('[inert]') !== null) {
    connectBtn.focus();
  }
} // End of function restoreConnectFocus()

/**
 * Handles one OMADA_CONNECT (or switch) result inside connect(): success
 * commits the connected UI; a superseded result resets only the local UI; a
 * multi-site result runs the site selection; a certificate result runs the
 * first-use confirmation (only when `allowTrust` — the retry after trusting
 * never asks twice) or the "certificate changed" notice; anything else
 * aborts with the mapped error message (a cloud target's own texts,
 * connectionErrorMessage()) — and a LOCAL controller that did not answer may
 * then be offered "Connect through TP-Link cloud" (offerCloudFallback()).
 * Errors propagate to connect()'s catch.
 * @param {ConnectionResult} result - The connect result.
 * @param {number} generation - The session generation captured by connect().
 * @param {boolean} allowTrust - Whether a first-use result may be offered for trust.
 * @param {boolean} [cloudTarget=false] - The attempt was for a TP-Link cloud controller.
 * @returns {Promise<void>}
 */
async function handleConnectResult(result: ConnectionResult, generation: number, allowTrust: boolean, cloudTarget = false): Promise<void> {
  if (result.success) {
    applySessionDetails(result, null);
    await commitConnectedUi(generation);
  } else if (result.error === 'connectionSuperseded') {
    // Stale attempt: a newer main-process flow (connect or disconnect)
    // owns the session now. Reset only the local UI — invoking a
    // disconnect here could log out the controller that newer flow owns
    resetConnectionUi(connectionErrorMessage(result));
  } else if (result.needsSiteSelection) {
    // Multi-site controller with no valid stored choice: let the user pick
    await runSiteSelection(result.sites, result.selectionNonce, generation);
  } else if (result.error === 'certificateUntrusted' && allowTrust) {
    // Self-signed certificate seen for the first time: let the user verify it
    await runCertificateTrust(result.certificate, result.trustNonce, generation);
  } else if (result.error === 'certificateChanged') {
    await runCertificateChanged(result.certificate, generation);
  } else {
    await abortConnection(generation, connectionErrorMessage(result, cloudTarget));
    if (!cloudTarget) {
      void offerCloudFallback(result, generation);
    }
  }
} // End of function handleConnectResult()

/**
 * "Connect through TP-Link cloud" (inbox I-1c2b): after a local connect that
 * failed because the controller did not answer at all (main's
 * `unreachable`), and while a cloud credential is stored, reads the
 * account's controllers again (fresh: the duplicate must be online now) and,
 * when cloudFallbackTarget() finds the local controller's cloud duplicate
 * online and usable in a complete list, offers it in the views' error state
 * (state.cloudFallback, an action next to Retry). Discarded when the
 * attempt's session moved on meanwhile (a Retry, a switch, a disconnect),
 * its error is no longer shown or a newer list read superseded this one.
 * @param {ConnectionResult} result - The failed local connect.
 * @param {number} generation - The attempt's session generation.
 * @returns {Promise<void>}
 */
async function offerCloudFallback(result: ConnectionResult, generation: number): Promise<void> {
  if (!isLocalUnreachable(result) || !state.switcherCredentialStored) return;
  const cloud = await loadCloudControllers();
  if (cloud === null || generation !== state.sessionGeneration || state.loadError === null || state.isConnecting) return;
  const target = cloudFallbackTarget({ localResult: result, cloud, localOmadacId: localOmadacIdOf(cloud) });
  if (target === null) return;
  state.cloudFallback = target;
  renderContentViews();
} // End of function offerCloudFallback()

/**
 * Runs the certificate first-use step of connect(): validates the details and
 * the opaque trust nonce received over IPC, shows the fingerprint for the
 * user to verify, and — on "Trust and connect" — sends ONLY the nonce back
 * (the main process pins the fingerprint it recorded itself), then reconnects
 * once within the same session. Cancel returns to the disconnected state (the
 * unconditional disconnect also discards the pending trust record in main).
 * Part of connect(), so isConnecting stays true throughout and every
 * post-await commit is generation-checked.
 * @param {unknown} rawCertificate - The `certificate` field of the result.
 * @param {unknown} rawNonce - The `trustNonce` field of the result (opaque).
 * @param {number} generation - The session generation captured by connect().
 * @returns {Promise<void>}
 */
async function runCertificateTrust(rawCertificate: unknown, rawNonce: unknown, generation: number): Promise<void> {
  const details = parseCertificateDetails(rawCertificate, false);
  // The nonce is opaque: only its presence and type are checked here
  const trustNonce = typeof rawNonce === 'string' && rawNonce.length > 0 ? rawNonce : null;
  if (details === null || trustNonce === null) {
    await abortConnection(generation, t('certUntrustedStatus'));
    return;
  }

  const trusted = await showCertificateTrust(details);
  if (generation !== state.sessionGeneration) return;
  if (!trusted) {
    // User cancelled: not an error — back to the disconnected state
    await abortConnection(generation, null);
    return;
  }

  let trustResult: CertificateActionResult;
  try {
    trustResult = await window.omadaAPI.trustCertificate(trustNonce);
  } catch (error) {
    console.error('Error trusting the controller certificate:', error);
    trustResult = { success: false };
  }
  if (generation !== state.sessionGeneration) return;
  if (!trustResult.success) {
    await abortConnection(generation, t('certTrustError'));
    return;
  }

  // The certificate is pinned now: reconnect within this same session. A
  // second first-use result is not offered again (allowTrust = false)
  const retry = await window.omadaAPI.connect();
  if (generation !== state.sessionGeneration) return;
  await handleConnectResult(retry, generation, false);
} // End of function runCertificateTrust()

/**
 * Runs the "certificate changed" step of connect(): the connection is
 * refused (error status, controller released), then the notice shows the
 * trusted and the presented fingerprints and points to Settings. Part of
 * connect(), so the buttons stay disabled until the notice is closed.
 * @param {unknown} rawCertificate - The `certificate` field of the result.
 * @param {number} generation - The session generation captured by connect().
 * @returns {Promise<void>}
 */
async function runCertificateChanged(rawCertificate: unknown, generation: number): Promise<void> {
  const details = parseCertificateDetails(rawCertificate, true);
  await abortConnection(generation, t('certChangedStatus'));
  if (generation !== state.sessionGeneration || details === null) return;
  await showCertificateChanged(details);
} // End of function runCertificateChanged()

/**
 * Keeps what a successful connect or site-selection result reports about the
 * installed session (validated at the boundary): the site name for the
 * header — main reports it for single-site controllers and remembered sites
 * too; `fallbackSiteName` (the name picked in the site modal) covers a result
 * without one —, the opaque session nonce of the session-bound calls (the
 * controller data and the management access) and, for a TP-Link cloud
 * controller only, its name (the header's label in place of a host).
 * The management capabilities of the new session, the fresh Open API view
 * of its AP groups and the managed list of its Wi-Fi networks are unknown
 * until fetched.
 * @param {ConnectionResult} result - The successful result.
 * @param {string | null} fallbackSiteName - Site name to use when the result has none.
 */
function applySessionDetails(result: ConnectionResult, fallbackSiteName: string | null): void {
  state.siteName = parseSiteName(result.siteName) ?? fallbackSiteName;
  state.sessionNonce = parseSessionNonce(result.sessionNonce);
  state.controllerName = parseControllerName(result.controllerName);
  state.managementCapabilities = null;
  resetManagedGroups();
  resetManagedNetworks();
}

/**
 * Commits the connected UI (status text, button label) and loads the
 * controller data. Part of connect(): a failed first load aborts the
 * connection with the load-error message (the views show it inline with
 * Retry and Settings); other errors thrown here are handled by connect()'s
 * catch so the whole UI state stays consistent. Every post-await commit is
 * generation-checked. After the first load the management capabilities are
 * fetched in the background (loadManagementCapabilities(), not awaited): a
 * management failure is never a connection failure.
 * @param {number} generation - The session generation captured by connect().
 * @returns {Promise<void>}
 */
async function commitConnectedUi(generation: number): Promise<void> {
  const config = await window.omadaAPI.loadConfig();
  // Stale result: a newer session owns the UI now
  if (generation !== state.sessionGeneration) return;
  // The switcher marks the controller now connected (main's target)
  applySwitcherConfig(config);
  // The header labels the connection with the configured controller's host,
  // or — for a TP-Link cloud controller, which has no URL — with the
  // controller name its connect result carried (state.controllerName;
  // status.ts never shows the local URL for a cloud session)
  setStatus('connected', config.url);
  connectBtn.textContent = t('disconnect');
  try {
    await loadData();
  } catch (error) {
    if (generation !== state.sessionGeneration) return;
    // An unreachable or failing controller is an expected outcome, shown
    // inline (console.warn, not console.error)
    console.warn('Error loading the controller data after connecting:', error);
    await abortConnection(generation, t('loadError'));
    return;
  }
  if (generation !== state.sessionGeneration) return;
  void loadManagementCapabilities(generation);
} // End of function commitConnectedUi()

/**
 * Resets the local connection UI to a non-connected state: error status (or
 * plain disconnected when no message is given), Connect button label, and
 * cleared data; the views show the error inline (state.loadError) or the
 * disconnected state. Purely local — it performs no IPC, so it is the right
 * cleanup for results the main process reported as superseded, where
 * releasing anything could hit a controller a newer flow owns.
 * @param {string | null} errorMessage - Localized error to show in the status
 *   bar and the views, or null for a plain return to the disconnected state.
 */
function resetConnectionUi(errorMessage: string | null): void {
  state.loadError = errorMessage;
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
    // The header shows the chosen site's name from now on (main reports it,
    // and reuses this site on later connects to the same controller URL)
    applySessionDetails(result, sites.find(site => site.id === chosenSiteId)?.name ?? null);
    await commitConnectedUi(generation);
  } else {
    await abortConnection(generation, connectionErrorMessage(result), selectionNonce);
  }
} // End of function runSiteSelection()

/**
 * Clears all loaded AP/WLAN data (including the controller's group model and
 * version, so the group vocabulary returns to its default, the time of the
 * last load and the stale-data mark), the AP selection, the destination, the
 * filters and the destination search, then re-renders the views' §4.6 state
 * (disconnected, or the inline error of state.loadError), the filter
 * options, the sidebar counts, the header details, the notices and the move
 * preview (which disables the move button). The AP groups and Wi-Fi
 * networks views lose their selections and searches, the AP details pane
 * and the single-pane drill-ins close and the Back history is emptied (the
 * current view stays: navigation works disconnected). The session nonce and
 * the management capabilities go with the session.
 */
function clearData(): void {
  state.accessPoints = [];
  state.wlanGroups = [];
  state.groupModel = null;
  state.controllerVersion = null;
  state.sessionNonce = null;
  state.controllerName = null;
  state.managementCapabilities = null;
  // The fresh Open API view of the AP groups and the managed list of the
  // Wi-Fi networks go with the session too (a read in flight is discarded)
  resetManagedGroups();
  resetManagedNetworks();
  state.lastUpdatedAt = null;
  state.refreshError = false;
  // The "Connect through TP-Link cloud" offer belongs to the error it came with
  state.cloudFallback = null;
  state.selectedApMacs = new Set<string>();
  state.selectionAnchorMac = null;
  state.apFocusMac = null;
  state.destinationGroup = null;
  state.apFilterText = '';
  state.apStatusFilter = STATUS_FILTER_ALL;
  state.apGroupFilter = GROUP_FILTER_ALL;
  state.destinationSearchText = '';
  apFilterInput.value = '';
  destinationSearchInput.value = '';

  applyGroupVocabulary();
  resetInventoryViews();
  renderApFilterOptions();
  renderContentViews();
  renderNavCounts();
  renderHeaderMeta();
} // End of function clearData()

/**
 * Disconnects from the controller: releases the main-process controller via
 * IPC and clears the UI state, even if the IPC call fails. The guarded entry
 * point for user-initiated disconnects (the Disconnect button, and the
 * certificate reset in Settings, which closes a live session first): a no-op
 * while any exclusive operation is in flight, so a disconnect can never
 * overlap a pending connect/save/move/refresh. Internal cleanup paths that must always run
 * (e.g. the failure paths inside connect()) call window.omadaAPI.disconnect()
 * directly instead. The session generation is bumped FIRST, so a data load
 * still in flight discards its result instead of repopulating the
 * disconnected UI; the disconnected-UI commit itself is generation-checked
 * too, so it can never clobber a session that superseded this one.
 * @returns {Promise<void>}
 */
export async function disconnect(): Promise<void> {
  if (isOperationInProgress()) return;
  state.isDisconnecting = true;
  renderControllerSwitcher();
  invalidateSession();
  // The session nonce goes with the old generation at once (phase 20a): a
  // nonce-bound call started while the disconnect is awaited (e.g. "Test
  // management access" in Settings while a certificate reset closes the
  // session) must not pair the new generation with the old session and have
  // its reply accepted; clearData() drops the rest below
  state.sessionNonce = null;
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
      // A disconnect by the user is not an error
      state.loadError = null;
      setStatus('disconnected');
      connectBtn.textContent = t('connect');
      connectBtn.disabled = false;
      clearData();
    }
    renderControllerSwitcher();
  }
} // End of function disconnect()

/**
 * Mirrors a connection reset the main process performed on its own — a
 * settings save that changed the controller URL or the cloud credential of
 * a cloud connection, or a certificate reset (results carrying
 * `connectionReset`): main already invalidated every in-flight attempt and
 * detached and logged out the controller, so the renderer only drops its
 * session (bumping the session generation discards any in-flight load
 * result) and shows the disconnected state with cleared data. The Connect
 * button follows whether connect() still reaches a controller
 * (state.hasStoredConfig, already read back by the caller): removing the only
 * cloud configuration leaves the first-run state with Connect disabled.
 * Purely local — no IPC. A no-op while not connected: there is no connected
 * UI to drop, and a status message already shown stays.
 */
export function handleConnectionReset(): void {
  // The controller (URL) or its trust changed: the remembered site name may
  // no longer describe the site the next connection uses
  state.siteName = null;
  if (!state.isConnected) return;
  invalidateSession();
  resetConnectionUi(null);
  connectBtn.disabled = !state.hasStoredConfig;
} // End of function handleConnectionReset()

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
 * Retry of the §4.6 error states (the initial-load error's Retry and the
 * refresh notice's): reloads the data while connected, otherwise runs the
 * whole connection again. Both are no-ops while another exclusive operation
 * is in flight.
 */
export function retryLoad(): void {
  if (state.isConnected) {
    refreshData();
  } else {
    connect();
  }
}

/**
 * Loads access points and the group listing (groups plus the controller's
 * group model and version, validated by parseGroupListing()) from the
 * controller, applies the group vocabulary and renders the AP list, the
 * destination pane, the sidebar counts and the header ("Updated hh:mm" with
 * the new load time). The first load shows loading skeletons in the lists; a reload
 * (refresh, or after a move) keeps the loaded rows on screen, marked as
 * refreshing, with "Refreshing…" in the header. The Refresh button spins
 * either way. A successful load clears the error states (state.loadError,
 * state.refreshError); a failed reload marks the data on screen as stale
 * (the refresh notice and the header state the last-updated time, and the
 * Wi-Fi networks view is re-rendered: its write actions are held back while
 * the data is stale). The AP groups and Wi-Fi networks views and the AP details pane
 * are re-rendered from the new data too (selections whose item is gone are
 * dropped). The AP selection survives a reload, pruned to the APs that
 * still exist; the destination is kept when its group still exists under a
 * name no other group shares (move-plan.ts isAmbiguousGroup()). The
 * session — generation and session nonce — is captured before awaiting
 * (session-ticket.ts; or given by the flow that captured it at its own
 * start): both calls carry that nonce, so main serves exactly that session,
 * and if the session moves on meanwhile (disconnect, reconnect, a controller
 * switch), the result — success or error — is discarded without committing
 * anything to the UI, and the loading state is left alone
 * (invalidateSession() already reset it for the new session). Without a
 * session nonce nothing is asked (a load error).
 * Current-session errors are intentionally not
 * caught here: the caller handles them so the whole UI state stays consistent
 * (see connect(), refreshData(), and the move flow in move-flow.ts); the data
 * on screen and the previous load time stay.
 * @param {SessionTicket} [ticket] - The session the load belongs to (default:
 *   the session on screen now).
 * @returns {Promise<void>}
 */
export async function loadData(ticket: SessionTicket | null = captureSessionTicket(state)): Promise<void> {
  if (ticket === null) {
    throw new Error('No session nonce for the controller data');
  }
  const generation = ticket.generation;
  const isReload = state.lastUpdatedAt !== null;
  state.isLoadingData = true;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');
  if (isReload) {
    setListsRefreshing(true);
    renderNotices();
  } else {
    renderContentViews();
  }
  renderHeaderMeta();
  // Set when this reload fails for the session on screen (the data is stale now)
  let failedReload = false;

  try {
    const fetched = await fetchControllerData(window.omadaAPI, ticket, state);

    // Stale result (the session changed while awaiting): discard it
    if (fetched.stale) {
      if (fetched.error !== undefined) {
        console.warn('Discarding data-load error from a stale session:', fetched.error);
      }
      return;
    }
    const aps = fetched.accessPoints as AccessPoint[];

    // Boundary validation: a listing without a group array throws (a load
    // error, never a silently empty list); an unknown group model becomes
    // the legacy one (the defensive default)
    const listing = parseGroupListing(fetched.listing);

    // Keep only entries whose identifiers have a valid format: they cross the
    // IPC boundary again when APs are moved, and a malformed id coming
    // from a compromised controller must never reach the UI or the main
    // process. The optional client count is kept only as a non-negative
    // integer, and the unreported-group flag (cloud only, inbox I-1c2a) only
    // as exactly `true` on an AP without a group name
    state.accessPoints = aps
      .filter(ap => {
        if (!isValidMac(ap.mac)) {
          console.warn('Ignoring access point with invalid MAC format:', ap.mac);
          return false;
        }
        return true;
      })
      .map(({ clientNum, wlanGroupUnknown, ...ap }) => {
        const clients = sanitizeClientCount(clientNum);
        const kept: AccessPoint = clients === undefined ? ap : { ...ap, clientNum: clients };
        return wlanGroupUnknown === true && kept.wlanGroup === '' ? { ...kept, wlanGroupUnknown: true } : kept;
      });
    state.groupModel = listing.groupModel;
    state.controllerVersion = listing.controllerVersion;
    // The default flag is kept only as exactly `true` (the Default badge
    // must never come from anything else)
    state.wlanGroups = listing.groups
      .filter(wlan => {
        if (!isValidWlanId(wlan.wlanId)) {
          console.warn('Ignoring WLAN group with invalid id format:', wlan.wlanId);
          return false;
        }
        return true;
      })
      .map(({ isDefault, ...wlan }) => (isDefault === true ? { ...wlan, isDefault: true } : wlan));

    // Keep the selection and the destination that still point at loaded data
    const macs = state.accessPoints.map(ap => ap.mac);
    state.selectedApMacs = pruneSelection(state.selectedApMacs, macs);
    if (state.selectionAnchorMac !== null && !macs.includes(state.selectionAnchorMac)) {
      state.selectionAnchorMac = null;
    }
    if (state.apFocusMac !== null && !macs.includes(state.apFocusMac)) {
      state.apFocusMac = null;
    }
    // A destination whose name another group now shares can no longer be
    // used (its radio renders disabled with the reason)
    const destinationId = state.destinationGroup?.wlanId;
    const destination = state.wlanGroups.find(wlan => wlan.wlanId === destinationId);
    state.destinationGroup = destination !== undefined && !isAmbiguousGroup(destination, state.wlanGroups) ? destination : null;
    state.lastUpdatedAt = Date.now();
    state.loadError = null;
    state.refreshError = false;

    applyGroupVocabulary();
    renderApFilterOptions();
    renderApList();
    renderDestinationList();
    renderNavCounts();
    renderMovePreview();
    renderInventoryViews();
  } catch (error) {
    // Stale failure: swallow it (the disconnected/new UI must not react)
    if (!isTicketCurrent(ticket, state)) {
      console.warn('Discarding data-load error from a stale session:', error);
      return;
    }
    // A failed reload keeps the data on screen, now stale
    if (isReload) {
      state.refreshError = true;
      failedReload = true;
    }
    throw error;
  } finally {
    // Only the operation that owns the current session may clear the loading
    // state; a stale load must not re-enable Refresh for a newer session
    if (generation === state.sessionGeneration) {
      state.isLoadingData = false;
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = !state.isConnected;
      setListsRefreshing(false);
      renderHeaderMeta();
      renderNotices();
      if (failedReload) {
        // The Wi-Fi network write actions follow the stale data at once
        renderNetworksView();
      }
    }
  }
} // End of function loadData()

/**
 * Reloads APs and WLAN groups on demand (Refresh button, the refresh
 * notice's Retry). A no-op while any exclusive operation
 * (connect/save/move/load) is pending. The loaded data stays on screen while
 * refreshing; on failure it stays (re-rendered), the header keeps the
 * previous "Updated hh:mm" time marked as stale, the refresh notice states
 * it (loadData()), and an error toast is shown. A successful refresh also
 * re-reads the fresh Open API view of the AP groups and the managed list of
 * the Wi-Fi networks in the background (while management is on). The
 * session (generation and nonce) is captured at the refresh's START
 * (reloadWithTicket(), the phase 20a fix): the load sends that nonce, and
 * the managed re-reads are started for that generation only while it is
 * still the session on screen — never for a session that replaced it while
 * the load was awaited.
 * @returns {Promise<void>}
 */
export async function refreshData(): Promise<void> {
  if (!state.isConnected || isOperationInProgress()) return;
  const ticket = captureSessionTicket(state);
  if (ticket === null) return;

  try {
    await reloadWithTicket(ticket, state, loadData, (generation) => {
      void loadManagedGroups(generation);
      void loadManagedNetworks(generation);
    });
  } catch (error) {
    // A stale failure (already discarded by loadData()) must not reach the UI
    if (!isTicketCurrent(ticket, state)) return;
    // An unreachable controller is an expected outcome, reported by the toast
    console.warn('Error refreshing data:', error);
    showToast(t('loadError'), 'error');
    renderApList();
    renderDestinationList();
    renderMovePreview();
  }
} // End of function refreshData()
