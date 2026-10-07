// Renderer state. Every piece of module-level mutable state lives in the single
// `state` object below: ES module imports are read-only bindings, so other
// modules read and write `state.<field>` instead of reassigning their own
// `let`s. Nothing else in src/renderer declares module-level mutable state.

import type { AccessPoint, ApGroupSsidLimits, GroupModel, Language, ManagedApGroup, ManagedNetwork, ManagementCapabilities, WlanGroup } from '../shared/types';
import { GROUP_FILTER_ALL, STATUS_FILTER_ALL } from './ap-selection';
import { apDetailsContent, apList, destinationList, groupDetail, groupList, networkDetail, networkList, refreshBtn } from './elements';
import type { GroupFailure, ManagedGroupsStatus } from './group-management';
import type { AppView, NavLocation } from './nav-history';
import type { ManagedNetworksStatus, NetworkFailureDetail, NetworkReadStamp } from './network-management';

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
  // view's own search text (network and group names). On the managed source
  // (Wi-Fi network management on) networks are told apart by id:
  // `selectedManagedNetworkId` is the selected one (its name is mirrored in
  // `selectedNetworkName`), or an id waiting to be resolved on the managed
  // list (Back); null while a selection by name (a cross-link, the 14a
  // view's selection) waits to be resolved there; always null on the 14a
  // view. Each field holds only its own kind of key (an id is never stored
  // as a name): the managed list resolves them by networkSelectionKey()
  selectedNetworkName: string | null;
  selectedManagedNetworkId: string | null;
  networkSearchText: string;
  // Single-pane layout (700–799 px windows, layout.ts): whether the
  // destination picker of the Access points view, the AP groups view's
  // detail and the Wi-Fi networks view's detail were drilled into (each
  // replaces its list until its "Back" is pressed). Ignored by the wider
  // layouts, which show list and detail side by side
  destinationPaneOpen: boolean;
  groupDetailOpen: boolean;
  networkDetailOpen: boolean;
  // Cross-navigation "Back" history, oldest first (navigation.ts): pushed by
  // following a link to an AP, a group or a network, popped by "Back to …",
  // emptied by the sidebar navigation and by a disconnect
  navHistory: NavLocation[];
  // Time (ms since the epoch) of the last successful data load, shown as
  // "Updated hh:mm"; null while no data is loaded. A failed refresh keeps it
  lastUpdatedAt: number | null;
  // Host (with port) of the connected controller, and the name of the site
  // the connection uses, as main reported it in the connect or site-selection
  // result (null when unknown)
  controllerHost: string | null;
  siteName: string | null;
  // The opaque session nonce of the connect or site-selection result: echoed
  // back verbatim with the management-access calls (management.ts), so they
  // act only on the session on screen; null while not connected
  sessionNonce: string | null;
  // The management capabilities main reported for that session (flags plus
  // a reason code), or null while they are being checked or not connected;
  // they feed readOnlyReason() (view-state.ts). A check run that may change
  // the verdict clears them as it starts (fail closed); `managementCheck`
  // numbers the runs the renderer started or asked about, so a reply about
  // an older run is discarded (management.ts, management-form.ts)
  managementCapabilities: ManagementCapabilities | null;
  managementCheck: number;
  // The fresh Open API view of the site's AP groups (managed-groups.ts),
  // read with the session nonce while AP-group management is on: per group
  // the default flag, AP count, bound networks and per-band remaining
  // capacity as main reported them (absent = not reported), plus the
  // per-group SSID limits. `managedApGroups` is null until read (or after a
  // failed read, whose code is `managedGroupsFailure`); a re-read keeps the
  // previous view on screen until the new one arrives.
  // `managedGroupsRequest` numbers the reads: a reply that is not the latest
  // read's (or arrives for another session or nonce) is discarded
  managedApGroups: ManagedApGroup[] | null;
  managedSsidLimits: ApGroupSsidLimits | null;
  managedGroupsStatus: ManagedGroupsStatus;
  managedGroupsFailure: { error: GroupFailure; diagnostic: string | null } | null;
  managedGroupsRequest: number;
  // The managed (Open API) list of the site's Wi-Fi networks
  // (managed-networks.ts), read with the session nonce while Wi-Fi network
  // management is on: the secret-free DTOs main built (never a passphrase).
  // `managedNetworks` is null until read, and after a failed first read
  // (whose code is `managedNetworksFailure`: the view shows its error state
  // with Retry, never a partial list); a re-read keeps the previous list on
  // screen until the new one arrives, and a failed re-read keeps it, stale
  // (status 'failed' with a list: the view's refresh-error notice states the
  // failure and the list's time). `managedNetworksStamp` is the session the
  // held list was read for and when (null with no list): a list is only
  // ever kept for the same session. `managedNetworksRequest` numbers the
  // reads: a reply that is not the latest read's (or arrives for another
  // session or nonce) is discarded
  managedNetworks: ManagedNetwork[] | null;
  managedNetworksStamp: NetworkReadStamp | null;
  managedNetworksStatus: ManagedNetworksStatus;
  managedNetworksFailure: NetworkFailureDetail | null;
  managedNetworksRequest: number;
  // True while loadData() is fetching (drives the Refresh button/spinners)
  isLoadingData: boolean;
  // True when a controller URL is stored; before first configuration the
  // views show the first-run state ("Configure connection") instead of the
  // disconnected one ("Connect to controller") — see view-state.ts
  hasStoredConfig: boolean;
  // Localized message of the last failed connection or first data load, shown
  // by every view as a persistent inline error with Retry and Settings; null
  // otherwise. Cleared by a new attempt, a successful load or a disconnect
  loadError: string | null;
  // True after a refresh (or the reload after a move) failed: the data on
  // screen is stale, which the refresh notice and the header state with the
  // last-updated time. Cleared by the next successful load or a disconnect
  refreshError: boolean;

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
  // isManagingApGroup covers a whole AP-group create / rename / delete flow
  // (group-flow.ts): from opening its dialog, through the write and the
  // reload after it, until the dialog closes
  isManagingApGroup: boolean;
  // isManagingNetwork covers a whole Wi-Fi network write flow
  // (network-flow.ts: New network, Edit, Change password, Enable / Disable,
  // Delete): from opening its dialog, through the write(s) and the reload
  // after them, until the dialog closes. No passphrase is ever kept in this
  // state: it lives only in the dialog's password fields while it is open
  isManagingNetwork: boolean;
  // True while a trusted-certificate reset (Settings) is in flight
  isResettingCertificate: boolean;
  // True while "Test management access" (Settings) waits for main. Not an
  // exclusive operation: a test only reads, and main answers "superseded"
  // when the session changes meanwhile
  isTestingManagement: boolean;

  // Stored controller URL and password flag captured when the settings modal
  // opened: the "(unchanged)" password affordance applies only while the URL
  // field still designates that stored URL (credentials are URL-scoped)
  settingsStoredUrl: string;
  settingsHasPassword: boolean;

  // Management access as main reported it when the settings modal opened
  // (never the Client Secret itself): the stored Client ID, whether a usable
  // secret exists, whether it is held for this session only, and whether a
  // newly typed one can be stored encrypted. `settingsRemoveManagement` is
  // true once the user confirmed "Remove management access" (applied by Save)
  settingsClientId: string;
  settingsHasClientSecret: boolean;
  settingsClientSecretSessionOnly: boolean;
  settingsCanPersistClientSecret: boolean;
  settingsRemoveManagement: boolean;

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
  selectedManagedNetworkId: null,
  networkSearchText: '',
  destinationPaneOpen: false,
  groupDetailOpen: false,
  networkDetailOpen: false,
  navHistory: [],
  lastUpdatedAt: null,
  controllerHost: null,
  siteName: null,
  sessionNonce: null,
  managementCapabilities: null,
  managementCheck: 0,
  managedApGroups: null,
  managedSsidLimits: null,
  managedGroupsStatus: 'idle',
  managedGroupsFailure: null,
  managedGroupsRequest: 0,
  managedNetworks: null,
  managedNetworksStamp: null,
  managedNetworksStatus: 'idle',
  managedNetworksFailure: null,
  managedNetworksRequest: 0,
  isLoadingData: false,
  hasStoredConfig: false,
  loadError: null,
  refreshError: false,
  sessionGeneration: 0,
  isConnecting: false,
  isDisconnecting: false,
  isSavingSettings: false,
  isApplyingChange: false,
  isManagingApGroup: false,
  isManagingNetwork: false,
  isResettingCertificate: false,
  isTestingManagement: false,
  settingsStoredUrl: '',
  settingsHasPassword: false,
  settingsClientId: '',
  settingsHasClientSecret: false,
  settingsClientSecretSessionOnly: false,
  settingsCanPersistClientSecret: true,
  settingsRemoveManagement: false,
  settingsOpener: null,
  isSettingsOpening: false,
};

/**
 * Reports whether any exclusive operation (connect, disconnect, settings
 * save, AP move, AP-group create / rename / delete, Wi-Fi network write,
 * data load, or certificate reset) is currently in flight. Used to serialize the
 * operations: while one is pending, starting another is a no-op.
 * @returns {boolean} True when an operation is in progress.
 */
export function isOperationInProgress(): boolean {
  return (
    state.isConnecting ||
    state.isDisconnecting ||
    state.isSavingSettings ||
    state.isApplyingChange ||
    state.isManagingApGroup ||
    state.isManagingNetwork ||
    state.isLoadingData ||
    state.isResettingCertificate
  );
}

/**
 * Marks the content of the three views as refreshing (or not): the AP list,
 * the destination list, the AP groups and Wi-Fi networks lists and the
 * detail panes (AP details, group, network). The loaded data stays on
 * screen, dimmed and flagged aria-busy, while a refresh is in flight.
 * @param {boolean} refreshing - True while a refresh is in flight.
 */
export function setListsRefreshing(refreshing: boolean): void {
  for (const list of [apList, destinationList, groupList, networkList, apDetailsContent, groupDetail, networkDetail]) {
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
