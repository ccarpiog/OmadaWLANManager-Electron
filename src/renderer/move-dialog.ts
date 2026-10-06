// ============================================================================
// Move dialog (docs/management-design.md §4.3, §4.7): one modal per move
// flow, in three phases filled with DOM APIs only (createElement/textContent:
// AP, group and network names can never be interpreted as markup):
//   review   — source group(s) → destination, the APs that move (and the
//              ones skipped because they are there already), the networks
//              gained / lost / unchanged, the clients on the moving APs, and
//              the notes that the move is not atomic and that per-AP network
//              overrides cannot be shown. Opens with focus on Cancel, never
//              on the move button.
//   running  — "Moving 2 of 4…" while the APs are moved one at a time;
//              no buttons, Escape ignored, focus parked on the summary.
//   results  — one row per AP (moved / failed + the controller's message)
//              with "Retry failed" (when something failed and the retry
//              contract still holds after the reload; notes say which
//              failed APs it leaves out, or why it is unavailable) and Close.
// Like the other modals: Tab focus trap, inert background, Escape cancels
// or closes, and close() removes every listener and settles any pending
// promise. The caller (move-flow.ts) restores focus after close().
// ============================================================================

import type { WlanGroup } from '../shared/types';
import {
  cancelMoveBtn,
  closeMoveBtn,
  confirmMoveBtn,
  moveModal,
  moveModalSummary,
  moveModalTitle,
  moveNotes,
  moveResults,
  moveReview,
  retryFailedBtn,
} from './elements';
import { t, tFormat } from './i18n';
import { createFocusTrap, updateBackgroundInert } from './modal-focus';
import { summarizeMoveOutcomes, type MoveOutcome, type MovePlan, type RetryCheck } from './move-plan';
import {
  apCountText,
  clientsText,
  hiddenApsNote,
  moveActionLabel,
  networkCountText,
  networkDiffRows,
  retryNotes,
  sourceGroupsText,
  unknownSourcesNote,
} from './move-text';

// What the user chose in the results phase
export type MoveResultsAction = 'close' | 'retry';

/**
 * The open move dialog: one instance per move flow (openMoveDialog()).
 */
export interface MoveDialog {
  // Shows the review of a plan; resolves true for the move button, false
  // for Cancel/Escape (or when the dialog is closed meanwhile)
  review(plan: MovePlan, hiddenCount: number): Promise<boolean>;
  // Shows "Moving done of total…" (the run phase)
  showProgress(done: number, total: number): void;
  // Shows "Refreshing…" while the lists reload after the run
  showRefreshing(): void;
  // Shows the per-AP results; resolves 'retry' for "Retry failed" (offered
  // only while the checked retry contract is not blocked), 'close' for
  // Close/Escape (or when the dialog is closed meanwhile)
  showResults(outcomes: readonly MoveOutcome[], destination: WlanGroup, retry: RetryCheck): Promise<MoveResultsAction>;
  // Hides the dialog and releases everything; idempotent
  close(): void;
}

// The dialog's phase ('idle' until the first review shows it)
type Phase = 'idle' | 'review' | 'running' | 'results' | 'closed';

/**
 * One row of the review list: a term and its details.
 */
interface ReviewRow {
  // data-row value (from / to / aps / networks / clients)
  key: string;
  label: string;
  // Main value, or null for a row made of detail lines only
  value: string | null;
  // Detail lines below the value; `warning` styles the strong ones
  details: Array<{ text: string; warning?: boolean }>;
}

/**
 * Builds the review list's rows for a plan.
 * @param {MovePlan} plan - The move plan.
 * @param {number} hiddenCount - Moving APs the filters hide.
 * @returns {ReviewRow[]} From, To, Access points, Wi-Fi networks, Clients.
 */
function reviewRows(plan: MovePlan, hiddenCount: number): ReviewRow[] {
  const destination = plan.destination;
  const empty = destination.ssidList.length === 0;

  const apDetails: ReviewRow['details'] = [];
  const already = plan.alreadyThere.length;
  if (already > 0) {
    apDetails.push({ text: already === 1 ? t('alreadySkippedOne') : tFormat('alreadySkippedMany', { count: String(already) }) });
  }
  const hidden = hiddenApsNote(hiddenCount);
  if (hidden !== null) {
    apDetails.push({ text: hidden });
  }

  // Networks gained / lost / unchanged, only from the moving APs whose
  // current group is known; the others are stated as unknown
  const networkDetails: ReviewRow['details'] = plan.knownSourceCount > 0
    ? networkDiffRows(plan).map(row => ({ text: `${row.label}: ${row.value}` }))
    : [];
  const unknown = unknownSourcesNote(plan.unknownSourceCount);
  if (unknown !== null) {
    networkDetails.push({ text: unknown });
  }

  return [
    { key: 'from', label: t('moveFrom'), value: sourceGroupsText(plan), details: [] },
    {
      key: 'to',
      label: t('moveTo'),
      value: destination.wlanName,
      details: [empty ? { text: t('emptyGroup'), warning: true } : { text: networkCountText(destination.ssidList.length) }],
    },
    { key: 'aps', label: `${t('accessPoints')} (${apCountText(plan.moving.length)})`, value: plan.moving.map(ap => ap.name).join(', '), details: apDetails },
    { key: 'networks', label: t('wifiNetworks'), value: null, details: networkDetails },
    { key: 'clients', label: t('clientsOnMovingAps'), value: clientsText(plan), details: [] },
  ];
} // End of function reviewRows()

/**
 * Renders review rows as <div><dt/><dd/></div> groups of the <dl>.
 * @param {ReviewRow[]} rows - The rows.
 * @returns {HTMLElement[]} The row elements.
 */
function buildReviewElements(rows: ReviewRow[]): HTMLElement[] {
  return rows.map(row => {
    const wrapper = document.createElement('div');
    wrapper.className = 'move-review-row';
    wrapper.dataset.row = row.key;
    const term = document.createElement('dt');
    term.textContent = row.label;
    const value = document.createElement('dd');
    if (row.value !== null) {
      const main = document.createElement('span');
      main.className = 'move-review-value';
      main.textContent = row.value;
      value.appendChild(main);
    }
    for (const detail of row.details) {
      const line = document.createElement('span');
      line.className = detail.warning ? 'move-review-detail is-warning' : 'move-review-detail';
      line.textContent = detail.text;
      value.appendChild(line);
    }
    wrapper.appendChild(term);
    wrapper.appendChild(value);
    return wrapper;
  }); // End of the row mapping
} // End of function buildReviewElements()

/**
 * Builds one per-AP result row: the outcome as text (+ colour), the AP name,
 * its MAC and, for a failure, the controller's message (or "The controller
 * did not accept the change" when there is none).
 * @param {MoveOutcome} outcome - The AP's outcome.
 * @returns {HTMLLIElement} The row.
 */
function createResultRow(outcome: MoveOutcome): HTMLLIElement {
  const item = document.createElement('li');
  item.className = outcome.ok ? 'move-result is-ok' : 'move-result is-failed';
  item.dataset.mac = outcome.mac;

  const status = document.createElement('span');
  status.className = 'move-result-status';
  status.textContent = outcome.ok ? t('moveResultOk') : t('moveResultFailed');

  const name = document.createElement('span');
  name.className = 'move-result-name';
  name.textContent = outcome.name;

  const mac = document.createElement('span');
  mac.className = 'move-result-mac';
  mac.textContent = outcome.mac;

  item.appendChild(status);
  item.appendChild(name);
  item.appendChild(mac);
  if (!outcome.ok) {
    const error = document.createElement('span');
    error.className = 'move-result-error';
    error.textContent = outcome.error ?? t('moveRejected');
    item.appendChild(error);
  }
  return item;
} // End of function createResultRow()

/**
 * The results summary: all moved, none moved, or "Moved n of N…".
 * @param {readonly MoveOutcome[]} outcomes - The outcomes.
 * @param {WlanGroup} destination - The destination group.
 * @returns {string} The localized summary.
 */
function resultsSummaryText(outcomes: readonly MoveOutcome[], destination: WlanGroup): string {
  const { total, succeededMacs, failedMacs } = summarizeMoveOutcomes(outcomes);
  const group = destination.wlanName;
  if (failedMacs.length === 0) {
    return total === 1 ? tFormat('moveResultsAllOne', { group }) : tFormat('moveResultsAllMany', { count: String(total), group });
  }
  if (succeededMacs.length === 0) {
    return total === 1 ? t('moveResultsNoneOne') : tFormat('moveResultsNoneMany', { count: String(total) });
  }
  return tFormat('moveResultsPartial', { moved: String(succeededMacs.length), total: String(total), group });
} // End of function resultsSummaryText()

/**
 * Replaces the dialog's notes with the given texts (one paragraph each).
 * @param {string[]} texts - The notes.
 */
function setNotes(texts: string[]): void {
  moveNotes.replaceChildren(...texts.map(text => {
    const note = document.createElement('p');
    note.className = 'move-note';
    note.textContent = text;
    return note;
  }));
}

/**
 * Shows exactly the given footer buttons.
 * @param {{ cancel: boolean; confirm: boolean; retry: boolean; close: boolean }} visible - Which to show.
 */
function setButtons(visible: { cancel: boolean; confirm: boolean; retry: boolean; close: boolean }): void {
  cancelMoveBtn.hidden = !visible.cancel;
  confirmMoveBtn.hidden = !visible.confirm;
  retryFailedBtn.hidden = !visible.retry;
  closeMoveBtn.hidden = !visible.close;
}

/**
 * Creates the move dialog for one move flow. Nothing is shown until the
 * first review(); the listeners (buttons, Escape, Tab focus trap) live from
 * then until close().
 * @returns {MoveDialog} The dialog's controller.
 */
export function openMoveDialog(): MoveDialog {
  const focusTrap = createFocusTrap(moveModal);
  let phase: Phase = 'idle';
  let resolveReview: ((confirmed: boolean) => void) | null = null;
  let resolveResults: ((action: MoveResultsAction) => void) | null = null;

  /**
   * Settles a pending review exactly once.
   * @param {boolean} confirmed - The user's choice.
   */
  const settleReview = (confirmed: boolean): void => {
    const resolve = resolveReview;
    resolveReview = null;
    resolve?.(confirmed);
  };

  /**
   * Settles a pending results choice exactly once.
   * @param {MoveResultsAction} action - The user's choice.
   */
  const settleResults = (action: MoveResultsAction): void => {
    const resolve = resolveResults;
    resolveResults = null;
    resolve?.(action);
  };

  /** Move button handler (review): confirms. */
  const handleConfirm = (): void => settleReview(true);
  /** Cancel button handler (review): cancels. */
  const handleCancel = (): void => settleReview(false);
  /** "Retry failed" handler (results). */
  const handleRetry = (): void => settleResults('retry');
  /** Close handler (results). */
  const handleClose = (): void => settleResults('close');

  /**
   * Escape: cancels the review, closes the results, and is ignored while
   * the APs are being moved.
   * @param {KeyboardEvent} e - The keydown event.
   */
  const handleEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (phase === 'review') {
      settleReview(false);
    } else if (phase === 'results') {
      settleResults('close');
    }
  };

  /**
   * Shows the overlay and installs the listeners on first use.
   */
  const show = (): void => {
    if (phase !== 'idle') return;
    confirmMoveBtn.addEventListener('click', handleConfirm);
    cancelMoveBtn.addEventListener('click', handleCancel);
    retryFailedBtn.addEventListener('click', handleRetry);
    closeMoveBtn.addEventListener('click', handleClose);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', focusTrap);
    moveModal.classList.add('visible');
    updateBackgroundInert();
  }; // End of function show()

  return {
    /**
     * Shows the review of a plan (showing the dialog on first use): summary,
     * review rows, notes, Cancel and the move button; focus on Cancel.
     * @param {MovePlan} plan - The move plan (at least one AP moving).
     * @param {number} hiddenCount - Moving APs the filters hide.
     * @returns {Promise<boolean>} True for the move button, false for
     *   Cancel/Escape or when the dialog is closed meanwhile.
     */
    review(plan: MovePlan, hiddenCount: number): Promise<boolean> {
      if (phase === 'closed') return Promise.resolve(false);
      show();
      phase = 'review';
      moveModal.classList.remove('is-running');
      moveModalTitle.textContent = t('moveReviewTitle');
      moveModalSummary.textContent = plan.moving.length === 1
        ? tFormat('moveReviewSummaryOne', { ap: plan.moving[0].name, group: plan.destination.wlanName })
        : tFormat('moveReviewSummaryMany', { count: String(plan.moving.length), group: plan.destination.wlanName });
      moveReview.replaceChildren(...buildReviewElements(reviewRows(plan, hiddenCount)));
      moveReview.hidden = false;
      moveResults.replaceChildren();
      moveResults.hidden = true;
      setNotes([t('moveNotAtomic'), t('overridesUnavailable')]);
      cancelMoveBtn.textContent = t('cancel');
      confirmMoveBtn.textContent = moveActionLabel(plan.moving.length);
      setButtons({ cancel: true, confirm: true, retry: false, close: false });
      // The safe default (spec §4.7): Enter or Escape cancels; the move
      // button takes a deliberate Tab
      cancelMoveBtn.focus();
      return new Promise<boolean>(resolve => {
        resolveReview = resolve;
      });
    }, // End of method review()

    /**
     * Shows the run's progress ("Moving done of total…"): no buttons, Escape
     * ignored, focus parked on the summary.
     * @param {number} done - The AP being moved (1-based).
     * @param {number} total - How many APs the run moves.
     */
    showProgress(done: number, total: number): void {
      if (phase === 'closed' || phase === 'idle') return;
      phase = 'running';
      moveModal.classList.add('is-running');
      moveModalSummary.textContent = tFormat('moveProgress', { done: String(done), total: String(total) });
      setNotes([t('moveNotAtomic')]);
      setButtons({ cancel: false, confirm: false, retry: false, close: false });
      // No button is left: keep focus inside the dialog, on the summary
      if (document.activeElement !== moveModalSummary) {
        moveModalSummary.focus();
      }
    }, // End of method showProgress()

    /**
     * Shows "Refreshing…" while the lists reload after the run.
     */
    showRefreshing(): void {
      if (phase !== 'running') return;
      moveModalSummary.textContent = t('refreshing');
    },

    /**
     * Shows the per-AP results with Close (focused) and, when an AP failed,
     * "Retry failed" — unless the retry contract checked after the reload is
     * blocked (destination gone or ambiguous, no failed AP left), in which
     * case the button stays hidden and a note says why. Failed APs the retry
     * leaves out (no longer listed, already in the destination) are stated
     * in the notes, with what the retry still covers.
     * @param {readonly MoveOutcome[]} outcomes - One outcome per moved AP.
     * @param {WlanGroup} destination - The destination group.
     * @param {RetryCheck} retry - The run's retry contract, checked against
     *   the lists loaded after it (checkRetry()).
     * @returns {Promise<MoveResultsAction>} 'retry' or 'close' (also when the
     *   dialog is closed meanwhile).
     */
    showResults(outcomes: readonly MoveOutcome[], destination: WlanGroup, retry: RetryCheck): Promise<MoveResultsAction> {
      if (phase === 'closed' || phase === 'idle') return Promise.resolve('close');
      phase = 'results';
      moveModal.classList.remove('is-running');
      moveModalTitle.textContent = t('moveResultsTitle');
      moveModalSummary.textContent = resultsSummaryText(outcomes, destination);
      moveReview.replaceChildren();
      moveReview.hidden = true;
      moveResults.replaceChildren(...outcomes.map(createResultRow));
      moveResults.hidden = false;
      const anyFailed = outcomes.some(outcome => !outcome.ok);
      setNotes([...(anyFailed ? retryNotes(retry, destination.wlanName) : []), t('moveNotAtomic')]);
      retryFailedBtn.textContent = t('retryFailed');
      closeMoveBtn.textContent = t('close');
      setButtons({ cancel: false, confirm: false, retry: anyFailed && retry.blocked === null, close: true });
      closeMoveBtn.focus();
      return new Promise<MoveResultsAction>(resolve => {
        resolveResults = resolve;
      });
    }, // End of method showResults()

    /**
     * Hides the dialog, removes every listener, restores the static defaults
     * and lifts the background inertness (the caller then restores focus);
     * settles any pending promise. Idempotent; a dialog never shown only
     * settles.
     */
    close(): void {
      if (phase === 'closed') return;
      const wasShown = phase !== 'idle';
      phase = 'closed';
      if (wasShown) {
        moveModal.classList.remove('visible', 'is-running');
        confirmMoveBtn.removeEventListener('click', handleConfirm);
        cancelMoveBtn.removeEventListener('click', handleCancel);
        retryFailedBtn.removeEventListener('click', handleRetry);
        closeMoveBtn.removeEventListener('click', handleClose);
        document.removeEventListener('keydown', handleEscape);
        document.removeEventListener('keydown', focusTrap);
        // Drop the per-open content and restore the static defaults (the
        // review buttons shown) for the next open
        moveReview.replaceChildren();
        moveReview.hidden = false;
        moveResults.replaceChildren();
        moveResults.hidden = true;
        moveNotes.replaceChildren();
        moveModalSummary.textContent = '';
        moveModalTitle.textContent = t('moveReviewTitle');
        setButtons({ cancel: true, confirm: true, retry: false, close: false });
        // Lift the background inertness; the caller then moves focus back
        // into the page (focus cannot enter an inert subtree)
        updateBackgroundInert();
      }
      // No pending promise may leak
      settleReview(false);
      settleResults('close');
    }, // End of method close()
  }; // End of the dialog controller
} // End of function openMoveDialog()
