// ============================================================================
// Panel states: the empty/loading blocks shown in both list panels and the
// selection info bar (with the Apply button) in the footer of the Access
// points view.
// ============================================================================

import { selectedAccessPoints } from './ap-selection';
import { apList, applyBtn, selectionInfo, wlanList, wlanPanelTitle } from './elements';
import { createEmptyState, createLoadingState } from './dom-helpers';
import { t, tFormat, tGroup } from './i18n';
import { applyShellVocabulary } from './shell';
import { state } from './state';

/**
 * Rebuilds the selection info bar with DOM APIs (no HTML strings, no inline
 * style attributes — muted parts use the .muted-text CSS class, which keeps
 * the CSP free of style-src 'unsafe-inline') and enables the Apply button
 * only when at least one AP (the checkbox selection, including APs hidden by
 * the filters) and a group are selected, and no move is running. One AP is
 * named; several show their count. The group wording follows the
 * controller's group model (tGroup()).
 */
export function updateSelectionInfo(): void {
  const selectedAps = selectedAccessPoints(state.accessPoints, state.selectedApMacs);
  if (selectedAps.length === 0 && !state.selectedWlan) {
    const placeholder = document.createElement('span');
    placeholder.className = 'selection-placeholder';
    placeholder.textContent = tGroup('selectApAndGroup');
    selectionInfo.replaceChildren(placeholder);
    applyBtn.disabled = true;
    return;
  }

  const detail = document.createElement('div');
  detail.className = 'selection-detail';

  const apPart = document.createElement('span');
  if (selectedAps.length === 1) {
    apPart.className = 'ap-name';
    apPart.textContent = selectedAps[0].name;
  } else if (selectedAps.length > 1) {
    apPart.className = 'ap-name';
    apPart.textContent = tFormat('selectedApsCount', { count: String(selectedAps.length) });
  } else {
    apPart.className = 'muted-text';
    apPart.textContent = t('selectAp');
  }

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '→';

  const wlanPart = document.createElement('span');
  if (state.selectedWlan) {
    wlanPart.className = 'wlan-name';
    wlanPart.textContent = state.selectedWlan.wlanName;
  } else {
    wlanPart.className = 'muted-text';
    wlanPart.textContent = tGroup('selectGroup');
  }

  detail.appendChild(apPart);
  detail.appendChild(arrow);
  detail.appendChild(wlanPart);
  selectionInfo.replaceChildren(detail);

  applyBtn.disabled = !(selectedAps.length > 0 && state.selectedWlan) || state.isApplyingChange;
} // End of function updateSelectionInfo()

/**
 * Shows a loading spinner in both list panels while data is being fetched.
 */
export function showLoadingStates(): void {
  apList.replaceChildren(createLoadingState());
  wlanList.replaceChildren(createLoadingState());
}

/**
 * Shows the initial empty states in both panels: a "configure the connection"
 * hint before any controller URL is stored (so a first-run user who closes
 * the settings modal is not left without guidance), or the usual "connect to
 * see data" messages afterwards.
 */
export function showEmptyStates(): void {
  if (!state.hasStoredConfig) {
    apList.replaceChildren(createEmptyState(t('configureHint')));
    wlanList.replaceChildren(createEmptyState(t('configureHint')));
    return;
  }
  apList.replaceChildren(createEmptyState(t('connectToSeeAPs')));
  wlanList.replaceChildren(createEmptyState(t('connectToSeeGroups')));
} // End of function showEmptyStates()

/**
 * Writes the group panel's title, the group list's accessible name and the
 * shell's group texts (sidebar entry, placeholder view) in the vocabulary of
 * the current group model ("AP groups" on Omada 6.3+, "WLAN groups (legacy)"
 * before — see tGroup()). Called by applyTranslations() and whenever
 * state.groupModel changes (loadData() and clearData() in connection.ts).
 */
export function applyGroupVocabulary(): void {
  const title = tGroup('groupsTitle');
  wlanPanelTitle.textContent = title;
  wlanList.setAttribute('aria-label', title);
  applyShellVocabulary();
}
