// ============================================================================
// Apply Change (move the selected APs into the selected group)
// ============================================================================
//
// Phase 13a keeps the existing flow (Apply → confirm modal → OMADA_SET_WLAN,
// the internal `PATCH eaps/{mac}` move) and runs it over the checkbox
// selection of the Access points list, including selected APs the filters
// hide. Several APs are moved one after the other (the controller has no
// atomic bulk move). Phase 13b replaces this with the destination pane, the
// review dialog and the per-AP result list (todo.md 4.6).

import { renderApList, syncApSelection } from './ap-list';
import { selectedAccessPoints } from './ap-selection';
import { showConfirm } from './confirm-modal';
import { loadData } from './connection';
import { applyBtn } from './elements';
import { t, tFormat } from './i18n';
import { updateSelectionInfo } from './panels';
import { isOperationInProgress, state } from './state';
import { showToast } from './toast';
import { isValidMac, isValidWlanId } from './validation';
import { renderWlanList } from './wlan-list';

// How many AP names the confirmation lists before "+N more"
const MAX_NAMED_APS = 3;

/**
 * Builds the confirmation question for a move: the classic one-AP question,
 * or the count and the first few names for several APs.
 * @param {string[]} apNames - Names of the APs to move, in list order.
 * @param {string} groupName - Name of the destination group.
 * @returns {string} The localized question.
 */
function confirmationMessage(apNames: string[], groupName: string): string {
  if (apNames.length === 1) {
    return tFormat('confirmAssign', { wlan: groupName, ap: apNames[0] });
  }
  const named = apNames.slice(0, MAX_NAMED_APS).join(', ');
  const rest = apNames.length - MAX_NAMED_APS;
  const list = rest > 0 ? `${named} +${rest} ${t('more')}` : named;
  return tFormat('confirmAssignMany', { wlan: groupName, count: String(apNames.length), aps: list });
}

/**
 * Moves the selected APs (checkbox selection, including APs hidden by the
 * filters) into the selected group after user confirmation, one
 * OMADA_SET_WLAN call per AP, in list order. The identifiers are
 * format-checked before crossing the IPC boundary (the main process
 * re-validates them too). A no-op while any exclusive operation is pending;
 * if the session changes while the move is in flight (e.g. the user
 * disconnects), the remaining moves are skipped and the result is discarded
 * without touching the UI.
 * Outcome: all moved → success toast, selection cleared; none moved → error
 * toast, selection kept; some failed → error toast naming the count and only
 * the failed APs stay selected (Apply retries them). The lists reload after
 * any successful move.
 * @returns {Promise<void>}
 */
export async function applyChange(): Promise<void> {
  const group = state.selectedWlan;
  const aps = selectedAccessPoints(state.accessPoints, state.selectedApMacs);
  if (aps.length === 0 || !group) return;
  if (isOperationInProgress()) return;

  // Belt-and-braces: loadData() already filtered malformed ids, but never
  // send an invalid MAC or WLAN id over IPC
  if (!aps.every(ap => isValidMac(ap.mac)) || !isValidWlanId(group.wlanId)) {
    console.error('Refusing to apply change: invalid MAC or WLAN id format');
    showToast(t('changeError'), 'error');
    return;
  }

  state.isApplyingChange = true;
  const generation = state.sessionGeneration;

  try {
    const confirmed = await showConfirm(confirmationMessage(aps.map(ap => ap.name), group.wlanName));

    if (!confirmed) return;

    applyBtn.disabled = true;
    applyBtn.textContent = t('applying');

    const failedMacs: string[] = [];
    let thrownError: unknown = null;
    for (const [index, ap] of aps.entries()) {
      if (aps.length > 1) {
        applyBtn.textContent = tFormat('applyingProgress', { done: String(index + 1), total: String(aps.length) });
      }
      let moved = false;
      try {
        moved = await window.omadaAPI.setApWlanGroup(ap.mac, group.wlanId);
      } catch (error) {
        thrownError = error;
      }
      // Stale result (disconnected while awaiting): leave the UI alone and
      // skip the remaining moves
      if (generation !== state.sessionGeneration) return;
      if (!moved) {
        failedMacs.push(ap.mac);
      }
    } // End of the loop that moves the selected APs one by one
    if (thrownError !== null) {
      console.error('Error applying change:', thrownError);
    }

    const movedCount = aps.length - failedMacs.length;
    if (failedMacs.length === 0) {
      showToast(aps.length === 1 ? t('changeApplied') : tFormat('changeAppliedMany', { count: String(aps.length), wlan: group.wlanName }), 'success');
      state.selectedApMacs = new Set<string>();
      state.selectionAnchorMac = null;
      state.selectedWlan = null;
    } else if (movedCount === 0) {
      showToast(t('changeError'), 'error');
    } else {
      showToast(tFormat('changePartial', { failed: String(failedMacs.length), total: String(aps.length) }), 'error');
      state.selectedApMacs = new Set(failedMacs);
      state.selectionAnchorMac = null;
    }
    syncApSelection();

    if (movedCount > 0) {
      // Reload data to reflect changes. A failed reload is a load error,
      // not a failed change — report it as such and keep the old lists
      try {
        await loadData();
      } catch (loadError) {
        console.error('Error reloading data after applying change:', loadError);
        showToast(t('loadError'), 'error');
        renderApList();
        renderWlanList();
        updateSelectionInfo();
      }
    }
  } catch (error) {
    console.error('Error applying change:', error);
    // A stale failure must not surface in the disconnected/new UI
    if (generation === state.sessionGeneration) {
      showToast(t('changeError'), 'error');
    }
  } finally {
    state.isApplyingChange = false;
    applyBtn.textContent = t('apply');
    // Recomputes applyBtn.disabled from the current selection
    updateSelectionInfo();
  }
} // End of function applyChange()
