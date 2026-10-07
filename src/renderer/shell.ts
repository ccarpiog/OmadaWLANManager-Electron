// ============================================================================
// App shell: the sidebar navigation (Access points / AP groups / Wi-Fi
// networks with their total counts, Settings at the bottom) and the switch
// between the three views (docs/management-design.md §4.2). The sidebar and
// the cross-links both switch views through showView(); the Back history of
// the cross-links lives in navigation.ts. The window width restyles the
// sidebar (styles.css, §4.7): full, compact (icons, the labels as tooltips)
// or a top view switcher. Also writes the single-pane layout's Back labels
// (layout.ts), which name the views' lists.
// ============================================================================

import {
  apDetailsBackBtn,
  destinationBackBtn,
  groupDetailBackBtn,
  groupsPanelTitle,
  navAccessPointsBtn,
  navGroupsBtn,
  navNetworksBtn,
  networkDetailBackBtn,
  networksPanelTitle,
  settingsBtnLabel,
  viewAccessPoints,
  viewGroups,
  viewNav,
  viewNetworks,
} from './elements';
import { t, tFormat, tGroup } from './i18n';
import { setDrillBackLabel } from './layout';
import { networksNavCount, renderNetworksStaleNotice } from './networks-view';
import { renderReadOnlyBanner } from './notices';
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
 * "Disconnected: navigation stays"). The read-only banner follows the view
 * (it belongs to the AP groups and Wi-Fi networks views), and so does the
 * managed Wi-Fi networks list's refresh-error notice (that view's alone).
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
  renderReadOnlyBanner();
  renderNetworksStaleNotice();
} // End of function showView()

/**
 * Writes one sidebar count, or hides it when the total is unknown.
 * @param {HTMLButtonElement} button - The sidebar button.
 * @param {number | null} count - The total, or null while no data is
 *   loaded (or while it is unknown).
 * @param {boolean} [atLeast=false] - The total is a lower bound ("N+").
 */
function setNavCount(button: HTMLButtonElement, count: number | null, atLeast = false): void {
  const badge = button.querySelector('.nav-count');
  if (!(badge instanceof HTMLElement)) return;
  let text = count === null ? '' : String(count);
  if (count !== null && atLeast) {
    text = tFormat('navCountAtLeast', { count: String(count) });
  }
  badge.textContent = text;
  badge.hidden = count === null;
}

/**
 * Renders the sidebar's TOTAL counts (never the filtered ones): access
 * points, groups (empty groups included) and the Wi-Fi networks — the
 * managed list's networks while the Wi-Fi networks view shows it, else the
 * distinct network names across the group listing (networksNavCount(): a
 * lower bound "N+" while some group's network list is unknown, hidden when
 * no network is known then). Hidden until data has loaded; a failed refresh
 * keeps the previous totals, like the data on screen.
 */
export function renderNavCounts(): void {
  const loaded = state.lastUpdatedAt !== null;
  setNavCount(navAccessPointsBtn, loaded ? state.accessPoints.length : null);
  setNavCount(navGroupsBtn, loaded ? state.wlanGroups.length : null);
  const networks = loaded ? networksNavCount() : null;
  setNavCount(navNetworksBtn, networks === null ? null : networks.count, networks?.atLeast ?? false);
}

/**
 * Writes the shell's group-vocabulary texts ("AP groups" on Omada 6.3+,
 * "WLAN groups (legacy)" before — see tGroup()): the sidebar entry (its
 * label and tooltip), the AP groups view's list title and its detail's
 * single-pane Back. Called by applyGroupVocabulary() (panels.ts).
 */
export function applyShellVocabulary(): void {
  const title = tGroup('groupsTitle');
  const label = navGroupsBtn.querySelector('.nav-label');
  if (label) label.textContent = title;
  navGroupsBtn.title = title;
  groupsPanelTitle.textContent = title;
  setDrillBackLabel(groupDetailBackBtn, title);
}

/**
 * Writes every shell text in the active language: the navigation's
 * accessible name, the sidebar entries (labels and tooltips: the compact
 * sidebar shows icons only), the Settings entry, the view titles and the
 * single-pane layout's Back labels; then the counts. Called by
 * applyTranslations().
 */
export function applyShellTranslations(): void {
  viewNav.setAttribute('aria-label', t('viewNavLabel'));
  const apLabel = navAccessPointsBtn.querySelector('.nav-label');
  if (apLabel) apLabel.textContent = t('accessPoints');
  navAccessPointsBtn.title = t('accessPoints');
  const networksLabel = navNetworksBtn.querySelector('.nav-label');
  if (networksLabel) networksLabel.textContent = t('wifiNetworks');
  navNetworksBtn.title = t('wifiNetworks');
  settingsBtnLabel.textContent = t('settings');
  applyShellVocabulary();
  networksPanelTitle.textContent = t('wifiNetworks');
  setDrillBackLabel(networkDetailBackBtn, t('wifiNetworks'));
  setDrillBackLabel(apDetailsBackBtn, t('accessPoints'));
  setDrillBackLabel(destinationBackBtn, t('accessPoints'));
  renderNavCounts();
} // End of function applyShellTranslations()
