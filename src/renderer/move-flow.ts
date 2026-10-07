// ============================================================================
// Move flow (docs/management-design.md §4.3): moves the selected APs (the
// checkbox selection, APs hidden by filters included) into the destination
// checked in the pane — review dialog, then one OMADA_SET_WLAN call (the
// internal `PATCH eaps/{mac}`, the only move path) per AP, one at a time,
// then the per-AP results with "Retry failed", which reruns only the failed
// APs through the same review. Its contract is the run's failed MACs and
// destination id, re-checked against the lists reloaded after the run
// (checkRetry()): APs or a destination that vanished meanwhile are stated,
// never silently dropped. APs already in the destination are skipped,
// never PATCHed. The run is sequential and NOT atomic: each AP succeeds or
// fails on its own. The whole flow is one exclusive operation
// (state.isApplyingChange) bound to the session it started in: when the
// session generation moves on (disconnect, URL change, reconnect), it stops at
// the next await and nothing it learned reaches the UI.
// ============================================================================

import type { AccessPoint, WlanGroup } from '../shared/types';
import { visibleApMacs } from './ap-filters';
import { renderApList } from './ap-list';
import { selectedAccessPoints } from './ap-selection';
import { loadData } from './connection';
import { currentMovePlan, focusDestinationRadio, hideDestinationPane, renderDestinationPane, renderMovePreview } from './destination-pane';
import { apFilterInput, apList } from './elements';
import { t } from './i18n';
import { loadManagedGroups } from './managed-groups';
import { openMoveDialog, type MoveDialog } from './move-dialog';
import { renderInventoryViews } from './navigation';
import {
  applyMovedGroup,
  checkRetry,
  countHiddenAps,
  describeMoveError,
  planMove,
  summarizeMoveOutcomes,
  type MoveOutcome,
  type MovePlan,
} from './move-plan';
import { isOperationInProgress, state } from './state';
import { showToast } from './toast';
import { isValidMac, isValidWlanId } from './validation';

/**
 * Moves the APs one at a time (in list order) into the destination, showing
 * the progress in the dialog. A move that resolves anything but true, or
 * throws, is a failure with the controller's message (when there is one);
 * failures are expected outcomes, reported in the results (console.warn,
 * not console.error). Stops as soon as the session generation changes.
 * @param {readonly AccessPoint[]} aps - The APs to move.
 * @param {WlanGroup} destination - The destination group.
 * @param {number} generation - The session generation the flow started in.
 * @param {MoveDialog} dialog - The open move dialog.
 * @returns {Promise<MoveOutcome[] | null>} One outcome per AP, or null when
 *   the session changed meanwhile (the outcomes are then discarded).
 */
async function runMoves(aps: readonly AccessPoint[], destination: WlanGroup, generation: number, dialog: MoveDialog): Promise<MoveOutcome[] | null> {
  const outcomes: MoveOutcome[] = [];
  for (const [index, ap] of aps.entries()) {
    dialog.showProgress(index + 1, aps.length);
    let ok = false;
    let error: string | null = null;
    try {
      ok = (await window.omadaAPI.setApWlanGroup(ap.mac, destination.wlanId)) === true;
    } catch (thrown) {
      console.warn(`Moving access point ${ap.mac} failed:`, thrown);
      error = describeMoveError(thrown);
    }
    // Stale (the session changed while awaiting): skip the remaining moves
    // and leave the UI alone
    if (generation !== state.sessionGeneration) return null;
    outcomes.push({ mac: ap.mac, name: ap.name, ok, error: ok ? null : error });
  } // End of the loop that moves the APs one by one
  return outcomes;
} // End of function runMoves()

/**
 * Commits a run's outcomes to the renderer state: the moved APs report the
 * destination locally (right even if the reload below fails), the selection
 * becomes the failed APs (so the move button retries exactly those once the
 * dialog is closed; "Retry failed" follows the checked retry contract), and
 * a fully successful run also clears the destination. Re-renders the AP list,
 * the destination pane and the read-only views (an open AP details pane then
 * shows the moved AP's new group and networks).
 * @param {readonly MoveOutcome[]} outcomes - The run's outcomes.
 * @param {WlanGroup} destination - The destination group.
 */
function commitOutcomes(outcomes: readonly MoveOutcome[], destination: WlanGroup): void {
  const summary = summarizeMoveOutcomes(outcomes);
  if (summary.succeededMacs.length > 0) {
    state.accessPoints = applyMovedGroup(state.accessPoints, summary.succeededMacs, destination.wlanName);
  }
  state.selectedApMacs = new Set(summary.failedMacs);
  state.selectionAnchorMac = null;
  if (summary.failedMacs.length === 0) {
    state.destinationGroup = null;
  }
  renderApList();
  renderDestinationPane();
  renderInventoryViews();
} // End of function commitOutcomes()

/**
 * Reloads the lists after a run that moved at least one AP. A failed reload
 * is a load error, not a failed move: it is reported as such and the locally
 * updated lists stay. A stale failure is ignored. A successful reload also
 * re-reads the fresh Open API view of the AP groups in the background
 * (their AP counts changed; AP-group management on only).
 * @param {number} generation - The session generation the flow started in.
 * @returns {Promise<void>}
 */
async function reloadAfterMove(generation: number): Promise<void> {
  try {
    await loadData();
    void loadManagedGroups(generation);
  } catch (error) {
    if (generation !== state.sessionGeneration) return;
    console.warn('Error reloading data after a move:', error);
    showToast(t('loadError'), 'error');
    renderApList();
    renderDestinationPane();
  }
} // End of function reloadAfterMove()

/**
 * Prepares "Retry failed" from the checked retry contract: the selection
 * becomes exactly the failed APs still to retry and the destination the
 * group as listed now (same id), both re-rendered, and their plan is
 * returned (every AP in it moves: none reports the destination).
 * @param {readonly string[]} retryMacs - The failed MACs to retry
 *   (RetryCheck.retryMacs).
 * @param {WlanGroup} destination - The destination as listed now
 *   (RetryCheck.destination).
 * @returns {MovePlan} The plan of the retry.
 */
function prepareRetry(retryMacs: readonly string[], destination: WlanGroup): MovePlan {
  state.selectedApMacs = new Set(retryMacs);
  state.selectionAnchorMac = null;
  state.destinationGroup = destination;
  renderApList();
  renderDestinationPane();
  return planMove(selectedAccessPoints(state.accessPoints, state.selectedApMacs), destination, state.wlanGroups);
} // End of function prepareRetry()

/**
 * Returns keyboard focus to the page after the dialog closed: to the element
 * that started the flow when it is still usable and shown (the move button
 * stays enabled after a partial failure), else to the same group's radio
 * when a radio started it (the reload re-rendered it), else to the AP list's
 * Tab stop (after a full success the move button is disabled), else to the
 * AP search field. In the single-pane layout the destination picker hides
 * the AP list, so before focus goes to the list the picker is closed the
 * way its Back closes it: the list comes back (showing the moved APs in
 * their new group) and focus never lands in a hidden pane.
 * @param {HTMLElement | null} opener - The element focused when the flow started.
 */
function restoreFocus(opener: HTMLElement | null): void {
  if (opener !== null && opener.isConnected && !(opener instanceof HTMLButtonElement && opener.disabled)) {
    opener.focus();
    if (document.activeElement === opener) return;
  }
  if (opener instanceof HTMLInputElement && opener.classList.contains('destination-radio') && focusDestinationRadio(opener.value)) {
    return;
  }
  if (state.destinationPaneOpen) {
    hideDestinationPane();
  }
  const tabStop = apList.querySelector<HTMLInputElement>('.ap-checkbox[tabindex="0"]');
  (tabStop ?? apFilterInput).focus();
} // End of function restoreFocus()

/**
 * Runs the move flow for the current selection and destination (the move
 * button, or Enter on a destination radio). A no-op while any exclusive
 * operation is in flight, while disconnected, or when no selected AP would
 * move. The identifiers are format-checked before crossing the IPC boundary
 * (the main process re-validates them). Review → (move button) run → reload
 * when something moved → results. The run's failed MACs and destination id
 * are kept as the retry contract and checked against the lists as they are
 * after the reload (checkRetry()): the results state any failed AP that is
 * gone, and offer "Retry failed" only while the destination still resolves
 * and some failed AP is left; it then plans exactly those APs into that
 * group and loops back to the review. Cancel, Escape or Close end the flow;
 * the dialog always closes, the operation flag is released and focus
 * returns to the page.
 * @returns {Promise<void>}
 */
export async function startMove(): Promise<void> {
  if (isOperationInProgress() || !state.isConnected) return;
  let plan: MovePlan | null = currentMovePlan();
  if (plan === null || plan.moving.length === 0) return;

  state.isApplyingChange = true;
  const generation = state.sessionGeneration;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // Disables the move button while the flow runs
  renderMovePreview();
  const dialog = openMoveDialog();

  try {
    while (plan !== null && plan.moving.length > 0) {
      const destination = plan.destination;
      // Belt-and-braces: loadData() already dropped malformed ids, but never
      // send an invalid MAC or group id over IPC
      if (!plan.moving.every(ap => isValidMac(ap.mac)) || !isValidWlanId(destination.wlanId)) {
        console.error('Refusing to move: invalid MAC or group id format');
        showToast(t('moveError'), 'error');
        return;
      }

      const confirmed = await dialog.review(plan, countHiddenAps(plan.moving, visibleApMacs()));
      if (generation !== state.sessionGeneration || !confirmed) return;

      const outcomes = await runMoves(plan.moving, destination, generation, dialog);
      if (outcomes === null) return;
      // The retry contract, fixed before the reload can change the lists
      const { failedMacs } = summarizeMoveOutcomes(outcomes);
      commitOutcomes(outcomes, destination);
      if (outcomes.some(outcome => outcome.ok)) {
        dialog.showRefreshing();
        await reloadAfterMove(generation);
        if (generation !== state.sessionGeneration) return;
      }

      // The reload may have dropped failed APs or the destination, or made
      // its name ambiguous: check the contract against the lists as they are
      const retry = checkRetry(failedMacs, destination.wlanId, state.accessPoints, state.wlanGroups);
      const action = await dialog.showResults(outcomes, destination, retry);
      if (generation !== state.sessionGeneration || action !== 'retry') return;
      // "Retry failed" is only offered while the contract holds
      if (retry.blocked !== null || retry.destination === null) return;
      plan = prepareRetry(retry.retryMacs, retry.destination);
    } // End of the review -> run -> results loop
  } catch (error) {
    console.error('Error moving access points:', error);
    // A stale failure must not surface in the disconnected/new UI
    if (generation === state.sessionGeneration) {
      showToast(t('moveError'), 'error');
    }
  } finally {
    dialog.close();
    state.isApplyingChange = false;
    // Re-enables the move button for whatever the state is now
    renderMovePreview();
    restoreFocus(opener);
  }
} // End of function startMove()
