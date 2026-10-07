// ============================================================================
// Management access in the renderer: the capabilities main reports for the
// session on screen (state.managementCapabilities, which feed the read-only
// banner through readOnlyReason() in view-state.ts), and "Test management
// access" in Settings. Main runs every check (docs/management-design.md
// §2.2) with the saved credentials; the renderer only sends the session nonce
// of its connect result, validates the reply (parseManagementResult()) and
// shows the outcome. Every await is generation-checked
// (state.sessionGeneration): a reply for an older session changes nothing.
// ============================================================================

import type { ManagementCapabilities } from '../shared/types';
import { clientIdInput, clientSecretInput, managementTestResult, testManagementBtn, urlInput } from './elements';
import { t, type Translations } from './i18n';
import { hasUnsavedManagementChanges, managementTestOutcome, type ManagementTestOutcome } from './management-form';
import { renderNotices } from './notices';
import { state } from './state';
import { isManagementReason, isSameControllerUrl, parseManagementResult } from './validation';

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

// What the banner shows when main's answer is unusable (fails closed)
const UNAVAILABLE: ManagementCapabilities = { manageApGroups: false, manageWifiNetworks: false, reason: 'probeFailed' };

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
 * Fetches the management capabilities main computes for the session on
 * screen, in the background after a connection's first data load (they
 * never delay or fail the connection). While main checks, the capabilities
 * are null — the banner says so (managementChecking); an unusable answer
 * fails closed ('probeFailed'). Discarded when the session changed meanwhile.
 * @param {number} generation - The session generation of the connection.
 * @returns {Promise<void>}
 */
export async function loadManagementCapabilities(generation: number): Promise<void> {
  if (generation !== state.sessionGeneration) return;
  const nonce = state.sessionNonce;
  state.managementCapabilities = null;
  renderNotices();
  if (nonce === null) {
    state.managementCapabilities = { ...UNAVAILABLE };
    renderNotices();
    return;
  }
  let capabilities: ManagementCapabilities;
  try {
    const result = parseManagementResult(await window.omadaAPI.getManagementCapabilities(nonce));
    capabilities = result.ok ? result.capabilities : { ...UNAVAILABLE };
  } catch (error) {
    console.warn('Error loading the management capabilities:', error);
    capabilities = { ...UNAVAILABLE };
  }
  if (generation !== state.sessionGeneration || state.sessionNonce !== nonce) return;
  state.managementCapabilities = capabilities;
  renderNotices();
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
 * asks main to run the checks again for the session on screen, shows the
 * precise result and, while the session is still the same, takes it as the
 * session's capabilities (the banner follows). One run at a time: clicks
 * while it runs are ignored (the button stays focusable, aria-disabled).
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
  let outcome: ManagementTestOutcome;
  let capabilities: ManagementCapabilities | null = null;
  try {
    const result = parseManagementResult(await window.omadaAPI.testManagementAccess(nonce));
    outcome = managementTestOutcome(result);
    capabilities = result.ok ? result.capabilities : null;
  } catch (error) {
    console.warn('Error testing management access:', error);
    outcome = 'failed';
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
  if (capabilities !== null) {
    state.managementCapabilities = capabilities;
    renderNotices();
  }
  showTestResult(outcome, capabilities?.diagnostic);
} // End of function runManagementTest()
