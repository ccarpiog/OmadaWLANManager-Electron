// ============================================================================
// Notices above the views (docs/management-design.md §4.6):
//   - the read-only banner of the AP groups and Wi-Fi networks views, which
//     states the precise reason and the fix. It is driven ONLY by
//     readOnlyReason() (view-state.ts), from the group model and the
//     management capabilities main reported (one text per reason code). The
//     Access points view does not show it: moving APs is never read-only;
//   - the refresh-error notice: the data on screen is stale (a refresh or the
//     reload after a move failed); it states the last-updated time and
//     offers Retry (data-state-action="retry", wired in renderer.ts).
// (The Wi-Fi networks view's own refresh-error notice — its managed list
// kept, stale, after a failed re-read — follows the same pattern and is
// rendered by renderNetworksStaleNotice() in networks-view.ts.)
// ============================================================================

import { readOnlyBanner, readOnlyBannerText, refreshNotice, refreshNoticeRetryBtn, refreshNoticeText } from './elements';
import { t, tFormat, type Translations } from './i18n';
import { state } from './state';
import { formatTime } from './status';
import { readOnlyReason, type ReadOnlyReason } from './view-state';

// The banner text of each reason
const READ_ONLY_TEXT: Record<ReadOnlyReason, keyof Translations> = {
  managementNotConfigured: 'readOnlyManagementNotConfigured',
  legacyController: 'readOnlyLegacyController',
  managementChecking: 'readOnlyManagementChecking',
  invalidCredentials: 'readOnlyInvalidCredentials',
  tokenFailed: 'readOnlyTokenFailed',
  siteNotFound: 'readOnlySiteNotFound',
  apGroupsMismatch: 'readOnlyApGroupsMismatch',
  probeFailed: 'readOnlyProbeFailed',
};

/**
 * Renders the read-only banner: shown on the AP groups and Wi-Fi networks
 * views while readOnlyReason() gives a reason (its code is exposed as
 * data-reason), hidden otherwise.
 */
export function renderReadOnlyBanner(): void {
  const reason = readOnlyReason({
    hasData: state.lastUpdatedAt !== null,
    groupModel: state.groupModel,
    capabilities: state.managementCapabilities,
  });
  const shown = reason !== null && state.currentView !== 'accessPoints';
  readOnlyBanner.hidden = !shown;
  readOnlyBannerText.textContent = reason === null ? '' : t(READ_ONLY_TEXT[reason]);
  if (reason === null) {
    delete readOnlyBanner.dataset.reason;
  } else {
    readOnlyBanner.dataset.reason = reason;
  }
} // End of function renderReadOnlyBanner()

/**
 * Renders the refresh-error notice: shown while the data on screen is stale
 * (state.refreshError) and no new load is in flight, with the time of the
 * last successful load and Retry.
 */
export function renderRefreshNotice(): void {
  const stale = state.refreshError && state.lastUpdatedAt !== null && state.isConnected;
  refreshNotice.hidden = !stale || state.isLoadingData;
  refreshNoticeText.textContent = stale && state.lastUpdatedAt !== null ? tFormat('refreshFailedNotice', { time: formatTime(state.lastUpdatedAt) }) : '';
  refreshNoticeRetryBtn.textContent = t('retry');
  refreshNoticeRetryBtn.disabled = state.isLoadingData;
} // End of function renderRefreshNotice()

/**
 * Renders both notices (after a load, a disconnect, a view switch or a
 * language change).
 */
export function renderNotices(): void {
  renderReadOnlyBanner();
  renderRefreshNotice();
}
