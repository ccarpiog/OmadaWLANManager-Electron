// ============================================================================
// Management access in the renderer: the capabilities main reports for the
// session on screen (state.managementCapabilities, which feed the read-only
// banner through readOnlyReason() in view-state.ts, and with it the AP
// groups view's write actions), and "Test management access" in Settings.
// Main runs every check (docs/management-design.md §2.2) with the saved
// credentials; the renderer only sends the session nonce of its connect
// result, validates the reply (parseManagementResult()) and shows the
// outcome. Every check run that may change the verdict (a connection's
// first check, "Test management access") fails closed the moment it starts:
// the capabilities become unknown ('managementChecking' on the banner) and
// the AP groups view loses every write action and the capacity until the
// run's result says management is on (management-form.ts
// startCapabilityCheck() / settleCapabilityCheck()), and the Wi-Fi
// networks view falls back to its 14a internal-data view. Every new answer
// also re-reads (or forgets) the fresh Open API view of the AP groups
// (managed-groups.ts) and the managed list of the Wi-Fi networks
// (managed-networks.ts). Every await is generation-checked
// (state.sessionGeneration) and run-checked (state.managementCheck): a reply
// for an older session or an older check run changes nothing.
// ============================================================================

import type { ManagementCapabilities } from '../shared/types';
import { clientIdInput, clientSecretInput, managementTestResult, testManagementBtn, urlInput } from './elements';
import { renderGroupsView } from './groups-view';
import { t, type Translations } from './i18n';
import { loadManagedGroups, resetManagedGroups } from './managed-groups';
import { forgetManagedNetworks, loadManagedNetworks } from './managed-networks';
import {
  hasUnsavedManagementChanges,
  managementTestOutcome,
  settleCapabilityCheck,
  startCapabilityCheck,
  type CapabilityCheckState,
  type ManagementTestOutcome,
} from './management-form';
import { renderNetworksSource } from './navigation';
import { isNetworkManagementOn } from './networks-view';
import { renderNotices } from './notices';
import { state } from './state';
import { isManagementReason, isSameControllerUrl, parseManagementResult, type ParsedManagementResult } from './validation';

/**
 * What the test's result line can show: an outcome of a finished run, the
 * line while it runs, or the refusal to test unsaved changes.
 */
type ManagementTestDisplay = ManagementTestOutcome | 'testing' | 'unsavedChanges';

// The result text of each display
const TEST_TEXT: Record<ManagementTestDisplay, keyof Translations> = {
  testing: 'managementTestRunning',
  ok: 'managementTestOk',
  legacyController: 'managementTestLegacyController',
  managementNotConfigured: 'managementTestNotConfigured',
  invalidCredentials: 'managementTestInvalidCredentials',
  tokenFailed: 'managementTestTokenFailed',
  siteNotFound: 'managementTestSiteNotFound',
  apGroupsMismatch: 'managementTestApGroupsMismatch',
  probeFailed: 'managementTestProbeFailed',
  notConnected: 'managementTestNotConnected',
  unsavedChanges: 'managementTestUnsaved',
  superseded: 'managementTestSuperseded',
  failed: 'managementTestFailed',
};

// A reply that carries no capabilities (unreadable, or the call threw):
// settleCapabilityCheck() turns it into management off ('probeFailed')
const UNUSABLE_REPLY: ParsedManagementResult = { ok: false, error: 'invalid' };

/**
 * The tone of a result line (its left border, see styles.css): 'ok' when
 * every check passed, 'off' for a failing check, 'busy' while running,
 * 'info' otherwise.
 * @param {ManagementTestDisplay} display - What the line shows.
 * @returns {'ok' | 'off' | 'busy' | 'info'} The tone.
 */
function toneOf(display: ManagementTestDisplay): 'ok' | 'off' | 'busy' | 'info' {
  if (display === 'ok') return 'ok';
  if (display === 'testing') return 'busy';
  return isManagementReason(display) ? 'off' : 'info';
}

/**
 * Takes new capabilities for the session on screen: the banner follows, the
 * AP groups view's actions follow (renderGroupsView()), the fresh Open API
 * view of the AP groups is read again (or forgotten when management is off
 * now), and so is the managed list of the Wi-Fi networks (both in parallel;
 * the connection itself never waits for them). With Wi-Fi network
 * management off now, the Wi-Fi networks view's 14a source is settled (no
 * longer a check's fallback): it is re-rendered so its Back history is
 * reconciled with it.
 * @param {ManagementCapabilities} capabilities - The capabilities.
 * @param {number} generation - The session generation they belong to.
 * @returns {Promise<void>} Settles once the fresh view of the AP groups and the managed network list were read (the reload after a write waits for both).
 */
async function applyCapabilities(capabilities: ManagementCapabilities, generation: number): Promise<void> {
  state.managementCapabilities = capabilities;
  renderNotices();
  renderGroupsView();
  if (!isNetworkManagementOn()) {
    renderNetworksSource();
  }
  await Promise.all([loadManagedNetworks(generation), loadManagedGroups(generation)]);
}

/**
 * The renderer's record of the session's capabilities and check runs.
 * @returns {CapabilityCheckState} The record now.
 */
function checkState(): CapabilityCheckState {
  return { capabilities: state.managementCapabilities, check: state.managementCheck };
}

/**
 * Starts a check run for the session on screen (startCapabilityCheck()) and
 * returns its number. When the capabilities on screen are cleared (a run
 * that may change the verdict), the fresh Open API view of the AP groups and
 * the managed list of the Wi-Fi networks go with them (a read in flight is
 * discarded) and the banner ('managementChecking'), the AP groups view and
 * the Wi-Fi networks view (back to its 14a view) follow at once: no write
 * action is shown or enabled until the run's result says management is on. Exported for connect() too, whose
 * new session starts its own checks in main.
 * @param {boolean} [keepCurrent] - True to keep known capabilities while main is asked again.
 * @returns {number} The run's number (state.managementCheck).
 */
export function beginCapabilityCheck(keepCurrent = false): number {
  const started = startCapabilityCheck(checkState(), keepCurrent);
  state.managementCheck = started.check;
  if (started.capabilities === null) {
    state.managementCapabilities = null;
    resetManagedGroups();
    renderNotices();
    renderGroupsView();
    forgetManagedNetworks();
  }
  return started.check;
} // End of function beginCapabilityCheck()

/**
 * Takes main's reply to a check run when it is still about the session on
 * screen and the latest run (settleCapabilityCheck(): an unusable reply
 * fails closed with 'probeFailed'); a late reply changes nothing.
 * @param {ParsedManagementResult} result - The validated reply.
 * @param {number} check - The run it belongs to.
 * @param {number} generation - The session generation it was asked in.
 * @param {string | null} nonce - The session nonce it was asked with.
 * @returns {Promise<void> | null} The read of the fresh view after taking it, or null when discarded.
 */
function settleCheck(result: ParsedManagementResult, check: number, generation: number, nonce: string | null): Promise<void> | null {
  if (generation !== state.sessionGeneration || state.sessionNonce !== nonce) return null;
  const settled = settleCapabilityCheck(checkState(), check, result);
  if (settled === null || settled.capabilities === null) return null;
  return applyCapabilities(settled.capabilities, generation);
}

/**
 * Fetches the management capabilities main computes for the session on
 * screen, in the background after a connection's first data load (they
 * never delay or fail the connection), and after an AP-group or Wi-Fi
 * network write. While main checks, the capabilities are null — the banner
 * says so (managementChecking) and no write action is offered — unless
 * `keepCurrent` keeps the ones on screen until the answer arrives (a
 * re-read: main answers with its latest result, so no flicker of the banner
 * and the actions); an unusable answer fails closed ('probeFailed'). Then
 * the fresh Open API view of the AP groups and the managed list of the Wi-Fi
 * networks are read (awaited). Discarded when
 * the session changed or a newer check run started meanwhile.
 * @param {number} generation - The session generation of the connection.
 * @param {boolean} [keepCurrent] - True to keep the capabilities on screen while asking.
 * @returns {Promise<void>}
 */
export async function loadManagementCapabilities(generation: number, keepCurrent = false): Promise<void> {
  if (generation !== state.sessionGeneration) return;
  const nonce = state.sessionNonce;
  const check = beginCapabilityCheck(keepCurrent);
  let result = UNUSABLE_REPLY;
  if (nonce !== null) {
    try {
      result = parseManagementResult(await window.omadaAPI.getManagementCapabilities(nonce));
    } catch (error) {
      console.warn('Error loading the management capabilities:', error);
    }
  }
  await settleCheck(result, check, generation, nonce);
} // End of function loadManagementCapabilities()

/**
 * Shows one result on the test's result line (role="status"), with main's
 * codes-only diagnostic in parentheses when there is one; the outcome is
 * exposed as data-result and the tone as data-tone.
 * @param {ManagementTestDisplay} display - What to show.
 * @param {string} [diagnostic] - Main's diagnostic (already validated).
 */
function showTestResult(display: ManagementTestDisplay, diagnostic?: string): void {
  const text = t(TEST_TEXT[display]);
  managementTestResult.textContent = diagnostic ? `${text} (${diagnostic})` : text;
  managementTestResult.dataset.result = display;
  managementTestResult.dataset.tone = toneOf(display);
  managementTestResult.hidden = false;
}

/**
 * Hides the test's result line (Settings opened again: an old result would
 * describe settings that may have changed since).
 */
export function resetManagementTest(): void {
  managementTestResult.hidden = true;
  managementTestResult.textContent = '';
  delete managementTestResult.dataset.result;
  delete managementTestResult.dataset.tone;
  testManagementBtn.setAttribute('aria-disabled', String(state.isTestingManagement));
}

/**
 * "Test management access" handler. Refuses (without asking main) while the
 * form holds unsaved management changes ("save first": main tests the saved
 * settings) or while not connected ("connect first": the checks need the
 * controller id, the site and the group list of a connection). Otherwise it
 * asks main to run the checks again for the session on screen — main drops
 * the session's Open API client at once, so the renderer fails closed at
 * once too (beginCapabilityCheck(): banner 'managementChecking', no write
 * action until the result says management is on) — shows the precise result
 * and, while the session and the run are still the latest, takes it as the
 * session's capabilities (the banner follows; a reply without capabilities
 * keeps management off with 'probeFailed'). One run at a time: clicks while
 * it runs are ignored (the button stays focusable, aria-disabled).
 * @returns {Promise<void>}
 */
export async function runManagementTest(): Promise<void> {
  if (state.isTestingManagement) return;
  const unsaved = hasUnsavedManagementChanges({
    removeStaged: state.settingsRemoveManagement,
    clientIdField: clientIdInput.value,
    clientSecretField: clientSecretInput.value,
    storedClientId: state.settingsClientId,
    sameUrl: isSameControllerUrl(state.settingsStoredUrl, urlInput.value),
  });
  if (unsaved) {
    showTestResult('unsavedChanges');
    return;
  }
  const nonce = state.sessionNonce;
  if (!state.isConnected || nonce === null) {
    showTestResult('notConnected');
    return;
  }

  const generation = state.sessionGeneration;
  state.isTestingManagement = true;
  testManagementBtn.setAttribute('aria-disabled', 'true');
  showTestResult('testing');
  const check = beginCapabilityCheck();
  let result = UNUSABLE_REPLY;
  try {
    result = parseManagementResult(await window.omadaAPI.testManagementAccess(nonce));
  } catch (error) {
    console.warn('Error testing management access:', error);
  } finally {
    state.isTestingManagement = false;
    testManagementBtn.setAttribute('aria-disabled', 'false');
  }

  if (generation !== state.sessionGeneration || state.sessionNonce !== nonce) {
    // The connection changed while main was checking: the result is not
    // about the session on screen any more
    showTestResult('superseded');
    return;
  }
  void settleCheck(result, check, generation, nonce);
  showTestResult(managementTestOutcome(result), result.ok ? result.capabilities.diagnostic : undefined);
} // End of function runManagementTest()
