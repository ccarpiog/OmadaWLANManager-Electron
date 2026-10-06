// ============================================================================
// App shell: the sidebar navigation (Access points / AP groups / Wi-Fi
// networks with their total counts, Settings at the bottom) and the switch
// between the three views (docs/management-design.md §4.2). The AP groups and
// Wi-Fi networks views are placeholders until phase 14 (todo.md 4.7).
// ============================================================================

import { countDistinctSsids } from './ap-selection';
import {
  navAccessPointsBtn,
  navGroupsBtn,
  navNetworksBtn,
  settingsBtnLabel,
  viewAccessPoints,
  viewGroups,
  viewGroupsText,
  viewGroupsTitle,
  viewNav,
  viewNetworks,
  viewNetworksText,
  viewNetworksTitle,
} from './elements';
import { t, tGroup } from './i18n';
import { state, type AppView } from './state';

// Each view with its sidebar button and its container
const VIEWS: Record<AppView, { nav: HTMLButtonElement; view: HTMLElement }> = {
  accessPoints: { nav: navAccessPointsBtn, view: viewAccessPoints },
  groups: { nav: navGroupsBtn, view: viewGroups },
  networks: { nav: navNetworksBtn, view: viewNetworks },
};

/**
 * Tells whether a string names one of the views.
 * @param {string | undefined} value - Candidate view name (a data-view value).
 * @returns {value is AppView} True for a known view.
 */
export function isAppView(value: string | undefined): value is AppView {
  return value === 'accessPoints' || value === 'groups' || value === 'networks';
}

/**
 * Shows one view and hides the others; the sidebar button of the shown view
 * carries aria-current="page". Navigation works connected or not (spec §4.6:
 * "Disconnected: navigation stays").
 * @param {AppView} view - The view to show.
 */
export function showView(view: AppView): void {
  state.currentView = view;
  for (const [name, entry] of Object.entries(VIEWS)) {
    const active = name === view;
    entry.view.hidden = !active;
    if (active) {
      entry.nav.setAttribute('aria-current', 'page');
    } else {
      entry.nav.removeAttribute('aria-current');
    }
  }
} // End of function showView()

/**
 * Writes one sidebar count, or hides it when the total is unknown.
 * @param {HTMLButtonElement} button - The sidebar button.
 * @param {number | null} count - The total, or null while no data is loaded.
 */
function setNavCount(button: HTMLButtonElement, count: number | null): void {
  const badge = button.querySelector('.nav-count');
  if (!(badge instanceof HTMLElement)) return;
  badge.textContent = count === null ? '' : String(count);
  badge.hidden = count === null;
}

/**
 * Renders the sidebar's TOTAL counts (never the filtered ones): access
 * points, groups (empty groups included) and distinct Wi-Fi network names
 * across the group listing. Hidden until data has loaded; a failed refresh
 * keeps the previous totals, like the data on screen.
 */
export function renderNavCounts(): void {
  const loaded = state.lastUpdatedAt !== null;
  setNavCount(navAccessPointsBtn, loaded ? state.accessPoints.length : null);
  setNavCount(navGroupsBtn, loaded ? state.wlanGroups.length : null);
  setNavCount(navNetworksBtn, loaded ? countDistinctSsids(state.wlanGroups) : null);
}

/**
 * Writes the shell's group-vocabulary texts ("AP groups" on Omada 6.3+,
 * "WLAN groups (legacy)" before — see tGroup()): the sidebar entry and the
 * placeholder view title. Called by applyGroupVocabulary() (panels.ts).
 */
export function applyShellVocabulary(): void {
  const title = tGroup('groupsTitle');
  const label = navGroupsBtn.querySelector('.nav-label');
  if (label) label.textContent = title;
  viewGroupsTitle.textContent = title;
}

/**
 * Writes every shell text in the active language: the navigation's
 * accessible name, the sidebar entries, the Settings entry and the
 * placeholder views; then the counts. Called by applyTranslations().
 */
export function applyShellTranslations(): void {
  viewNav.setAttribute('aria-label', t('viewNavLabel'));
  const apLabel = navAccessPointsBtn.querySelector('.nav-label');
  if (apLabel) apLabel.textContent = t('accessPoints');
  const networksLabel = navNetworksBtn.querySelector('.nav-label');
  if (networksLabel) networksLabel.textContent = t('wifiNetworks');
  settingsBtnLabel.textContent = t('settings');
  applyShellVocabulary();
  viewGroupsText.textContent = t('viewComingSoon');
  viewNetworksTitle.textContent = t('wifiNetworks');
  viewNetworksText.textContent = t('viewComingSoon');
  renderNavCounts();
} // End of function applyShellTranslations()
