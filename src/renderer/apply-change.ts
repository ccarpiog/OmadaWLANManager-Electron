// ============================================================================
// Apply Change (assign the selected WLAN group to the selected AP)
// ============================================================================

import { renderApList } from './ap-list';
import { showConfirm } from './confirm-modal';
import { loadData } from './connection';
import { applyBtn } from './elements';
import { t, tFormat } from './i18n';
import { updateSelectionInfo } from './panels';
import { isOperationInProgress, state } from './state';
import { showToast } from './toast';
import { isValidMac, isValidWlanId } from './validation';
import { renderWlanList } from './wlan-list';

/**
 * Applies the selected WLAN group to the selected AP after user confirmation.
 * The identifiers are format-checked before crossing the IPC boundary (the
 * main process re-validates them too). A no-op while any exclusive operation
 * is pending; if the session changes while the change is in flight (e.g. the
 * user disconnects), the result is discarded without touching the UI.
 * @returns {Promise<void>}
 */
export async function applyChange(): Promise<void> {
  if (!state.selectedAp || !state.selectedWlan) return;
  if (isOperationInProgress()) return;

  // Belt-and-braces: loadData() already filtered malformed ids, but never
  // send an invalid MAC or WLAN id over IPC
  if (!isValidMac(state.selectedAp.mac) || !isValidWlanId(state.selectedWlan.wlanId)) {
    console.error('Refusing to apply change: invalid MAC or WLAN id format');
    showToast(t('changeError'), 'error');
    return;
  }

  state.isApplyingChange = true;
  const generation = state.sessionGeneration;

  try {
    const confirmed = await showConfirm(
      tFormat('confirmAssign', { wlan: state.selectedWlan.wlanName, ap: state.selectedAp.name })
    );

    if (!confirmed) return;

    applyBtn.disabled = true;
    applyBtn.textContent = t('applying');

    const success = await window.omadaAPI.setApWlanGroup(state.selectedAp.mac, state.selectedWlan.wlanId);

    // Stale result (disconnected while awaiting): leave the UI alone
    if (generation !== state.sessionGeneration) return;

    if (success) {
      showToast(t('changeApplied'), 'success');
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
    } else {
      showToast(t('changeError'), 'error');
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
