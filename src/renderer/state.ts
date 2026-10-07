// Renderer state. Every piece of module-level mutable state lives in the single
// `state` object below: ES module imports are read-only bindings, so other
// modules read and write `state.<field>` instead of reassigning their own
// `let`s. Nothing else in src/renderer declares module-level mutable state.

import type { AccessPoint, GroupModel, Language, WlanGroup } from '../shared/types';
import { GROUP_FILTER_ALL, STATUS_FILTER_ALL } from './ap-selection';
import { apList, destinationList, groupList, networkList, refreshBtn } from './elements';
import type { AppView, NavLocation } from './nav-history';

// The three views of the app shell (docs/management-design.md §4.2), defined
// with the navigation history (nav-history.ts); the Access points view is the
// landing view
export type { AppView } from './nav-history';

/**
 * Shape of the renderer's mutable state (see the `state` object below).
 */
export interface RendererState {
  // Active UI language (see setLanguage() in i18n.ts)
  currentLanguage: Language;

  // Loaded controller data and the current selection
  accessPoints: AccessPoint[];
  wlanGroups: WlanGroup[];
  // Group model and version of the controller the loaded groups come from
  // (getWlanGroups()); both null while no controller data is loaded. The
  // model picks the group vocabulary (tGroup() in i18n.ts); the version is
  // shown in the header (status.ts)
  groupModel: GroupModel | null;
  controllerVersion: string | null;
  // Access points view selection: the MACs of the checked APs. It survives
  // filtering (hidden APs stay selected) and reloads (pruned to the APs that
  // still exist); a successful move or a disconnect clears it
  selectedApMacs: Set<string>;
  // Range anchor of Shift-click / Shift+Arrow selection: the AP of the last
  // plain toggle (null = no anchor)
  selectionAnchorMac: string | null;
  // The AP row whose checkbox is the list's single Tab stop (roving tabindex)
  apFocusMac: string | null;
  // The group checked in the destination pane (the move target); kept after
  // a reload while its group still exists, cleared by a fully successful
  // move or a disconnect
  destinationGroup: WlanGroup | null;
  isConnected: boolean;
  // Access points list filters: search text, status filter (see
  // STATUS_FILTER_ALL in ap-selection.ts) and group filter (a group id,
  // GROUP_FILTER_ALL or GROUP_FILTER_UNASSIGNED)
  apFilterText: string;
  apStatusFilter: string;
  apGroupFilter: string;
  // Destination pane search (matches group names and network names)
  destinationSearchText: string;
  // The view the shell shows (sidebar navigation, shell.ts)
  currentView: AppView;
  // Access points view: the AP whose details pane is open (ap-details.ts;
  // the pane takes the destination pane's place), or null when it is closed
  apDetailsMac: string | null;
  // AP groups view (groups-view.ts): the selected group's id (null = none)
  // and the view's own search text (group and network names)
  selectedGroupId: string | null;
  groupSearchText: string;
  // Wi-Fi networks view (networks-view.ts): the selected network's name
  // (null = none; the internal API identifies networks by name only) and the
  // view's own search text (network and group names)
  selectedNetworkName: string | null;
  networkSearchText: string;
  // Cross-navigation "Back" history, oldest first (navigation.ts): pushed by
  // following a link to an AP, a group or a network, popped by "Back to …",
  // emptied by the sidebar navigation and by a disconnect
  navHistory: NavLocation[];
  // Time (ms since the epoch) of the last successful data load, shown as
  // "Updated hh:mm"; null while no data is loaded. A failed refresh keeps it
  lastUpdatedAt: number | null;
  // Host (with port) of the connected controller, and the name of the site
  // picked in the site-selection modal (null when the renderer does not know
  // it: single-site controllers and remembered sites report no name)
  controllerHost: string | null;
  siteName: string | null;
  // True while loadData() is fetching (drives the Refresh button/spinners)
  isLoadingData: boolean;
  // True when a controller URL is stored; before first configuration the empty
  // states show a "configure the connection" hint instead of "connect to see"
  hasStoredConfig: boolean;

  // Monotonic token identifying the current connection session. It is bumped by
  // invalidateSession() on every connect and disconnect; async operations
  // capture it before awaiting and discard their results (no UI commit, no
  // state flips) when it has moved on — e.g. a refresh that finishes after a
  // disconnect must not repopulate the disconnected UI.
  sessionGeneration: number;

  // Per-operation in-flight flags serializing connect/disconnect/save/move/
  // refresh so they can never overlap (see isOperationInProgress()).
  // isApplyingChange covers a whole move flow (move-flow.ts): from opening
  // the review dialog, through the one-AP-at-a-time run and the results
  // (and any "Retry failed"), until the dialog closes
  isConnecting: boolean;
  isDisconnecting: boolean;
  isSavingSettings: boolean;
  isApplyingChange: boolean;
  // True while a trusted-certificate reset (Settings) is in flight
  isResettingCertificate: boolean;

  // Stored controller URL and password flag captured when the settings modal
  // opened: the "(unchanged)" password affordance applies only while the URL
  // field still designates that stored URL (credentials are URL-scoped)
  settingsStoredUrl: string;
  settingsHasPassword: boolean;

  // The element that opened the settings modal (focus returns there on close)
  settingsOpener: HTMLElement | null;
  // True from the moment openSettings() starts until the modal is visible (or
  // the open fails). Set SYNCHRONOUSLY before the config load await, so a
  // concurrent second invocation is a no-op and cannot overwrite the opener
  isSettingsOpening: boolean;
}

// The renderer's single mutable state object (initial values = app start)
export const state: RendererState = {
  currentLanguage: 'es',
  accessPoints: [],
  wlanGroups: [],
  groupModel: null,
  controllerVersion: null,
  selectedApMacs: new Set<string>(),
  selectionAnchorMac: null,
  apFocusMac: null,
  destinationGroup: null,
  isConnected: false,
  apFilterText: '',
  apStatusFilter: STATUS_FILTER_ALL,
  apGroupFilter: GROUP_FILTER_ALL,
  destinationSearchText: '',
  currentView: 'accessPoints',
  apDetailsMac: null,
  selectedGroupId: null,
  groupSearchText: '',
  selectedNetworkName: null,
  networkSearchText: '',
  navHistory: [],
  lastUpdatedAt: null,
  controllerHost: null,
  siteName: null,
  isLoadingData: false,
  hasStoredConfig: false,
  sessionGeneration: 0,
  isConnecting: false,
  isDisconnecting: false,
  isSavingSettings: false,
  isApplyingChange: false,
  isResettingCertificate: false,
  settingsStoredUrl: '',
  settingsHasPassword: false,
  settingsOpener: null,
  isSettingsOpening: false,
};

/**
 * Reports whether any exclusive operation (connect, disconnect, settings
 * save, AP move, data load, or certificate reset) is currently in flight. Used
 * to serialize the operations: while one is pending, starting another is a
 * no-op.
 * @returns {boolean} True when an operation is in progress.
 */
export function isOperationInProgress(): boolean {
  return (
    state.isConnecting ||
    state.isDisconnecting ||
    state.isSavingSettings ||
    state.isApplyingChange ||
    state.isLoadingData ||
    state.isResettingCertificate
  );
}

/**
 * Marks the AP list, the destination list and the AP groups and Wi-Fi
 * networks lists as refreshing (or not): the loaded rows stay on screen,
 * dimmed and flagged aria-busy, while a refresh is in flight.
 * @param {boolean} refreshing - True while a refresh is in flight.
 */
export function setListsRefreshing(refreshing: boolean): void {
  for (const list of [apList, destinationList, groupList, networkList]) {
    list.classList.toggle('is-refreshing', refreshing);
    if (refreshing) {
      list.setAttribute('aria-busy', 'true');
    } else {
      list.removeAttribute('aria-busy');
    }
  }
} // End of function setListsRefreshing()

/**
 * Invalidates the current session: bumps the generation token (so any
 * in-flight load or move discards its result when it completes) and resets
 * the loading indicators that a discarded operation will no longer clean up.
 * Called at the start of connect() and disconnect().
 */
export function invalidateSession(): void {
  state.sessionGeneration++;
  state.isLoadingData = false;
  refreshBtn.classList.remove('spinning');
  setListsRefreshing(false);
}
