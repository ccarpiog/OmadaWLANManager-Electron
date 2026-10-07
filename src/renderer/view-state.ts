// ============================================================================
// Pure view-state logic of the app shell (docs/management-design.md §4.6 and
// §4.7), DOM-free so the unit tests can run it in plain Node:
//   - contentState(): which §4.6 state the content of every view shows (first
//     run, disconnected, initial loading, initial-load error, or the data);
//   - readOnlyReason(): why the AP groups and Wi-Fi networks views are
//     read-only — the ONE function the read-only banner is driven from, fed
//     with the group model and the management capabilities main detected;
//   - escapeAction(): the Escape key's priority (clear the search, then exit
//     edit mode, then close the top dialog);
//   - isFindShortcut(): Cmd+F (macOS) / Ctrl+F (elsewhere);
//   - accessPointsPane() / masterDetailPane(): which pane a view shows in
//     the single-pane layout (700–799 px windows).
// ============================================================================

import type { GroupModel, ManagementCapabilities, ManagementReason } from '../shared/types';

// ============================================================================
// Content states (§4.6)
// ============================================================================

/**
 * The state the content of the three views shows:
 * - 'firstRun': no controller configured yet (one "Configure connection" action);
 * - 'disconnected': configured but not connected ("Connect to controller");
 * - 'loading': connecting or loading the first data (skeletons in the layout);
 * - 'loadError': the connection or its first data load failed (a persistent
 *   inline error with Retry and Settings);
 * - 'ready': data is loaded. Refreshing and a failed refresh keep this state
 *   (the data stays on screen, marked as refreshing or as stale).
 */
export type ContentState = 'firstRun' | 'disconnected' | 'loading' | 'loadError' | 'ready';

/**
 * What contentState() derives the state from.
 */
export interface ContentStateInput {
  // A controller URL is stored
  hasStoredConfig: boolean;
  // A connection attempt is in flight (including its certificate and site steps)
  isConnecting: boolean;
  // A data load is in flight
  isLoadingData: boolean;
  // Data from a successful load is on screen
  hasData: boolean;
  // The localized message of a failed connection or first load, or null
  loadError: string | null;
}

/**
 * Derives the content state. Loaded data always wins (a refresh keeps it on
 * screen, also when it fails); then an attempt in flight shows the loading
 * skeletons (a Retry replaces the error with them); then a failed attempt
 * shows its error; otherwise first run or disconnected.
 * @param {ContentStateInput} input - The relevant renderer state.
 * @returns {ContentState} The state to show.
 */
export function contentState(input: ContentStateInput): ContentState {
  if (input.hasData) return 'ready';
  if (input.isConnecting || input.isLoadingData) return 'loading';
  if (input.loadError !== null) return 'loadError';
  return input.hasStoredConfig ? 'disconnected' : 'firstRun';
}

// ============================================================================
// Read-only banner (§4.6)
// ============================================================================

/**
 * Why the AP groups and Wi-Fi networks views are read-only: one of the
 * management reasons main reports (ManagementReason in src/shared/types.ts —
 * 'legacyController': a controller before 6.3 or of unknown version, moving
 * APs works; 'managementNotConfigured': Omada 6.3+ without Open API
 * credentials, the fix is Settings → Management access; and one code per
 * other failing check of spec §2.2), or 'managementChecking' while main is
 * still checking the management access of the session on screen.
 */
export type ReadOnlyReason = ManagementReason | 'managementChecking';

/**
 * What readOnlyReason() decides from.
 */
export interface ReadOnlyInput {
  // Data from a successful load is on screen (no banner without data)
  hasData: boolean;
  // The loaded controller's group model (null while no data is loaded)
  groupModel: GroupModel | null;
  // The management capabilities main reported for the session on screen,
  // or null while they are being checked
  capabilities: ManagementCapabilities | null;
}

/**
 * Decides whether the read-only banner shows, and with which reason. The
 * banner is driven from this function alone: no banner without data; a
 * legacy group model is 'legacyController' at once (also before the
 * capabilities arrive); then 'managementChecking' until main reports the
 * capabilities, the reason of the failing check, and no banner once every
 * check passed (a reason-less report with a capability off fails closed as
 * 'probeFailed').
 * @param {ReadOnlyInput} input - The relevant renderer state.
 * @returns {ReadOnlyReason | null} The reason, or null for no banner.
 */
export function readOnlyReason(input: ReadOnlyInput): ReadOnlyReason | null {
  if (!input.hasData || input.groupModel === null) return null;
  if (input.groupModel !== 'apGroup') return 'legacyController';
  if (input.capabilities === null) return 'managementChecking';
  if (input.capabilities.reason !== null) return input.capabilities.reason;
  return input.capabilities.manageApGroups && input.capabilities.manageWifiNetworks ? null : 'probeFailed';
} // End of function readOnlyReason()

// ============================================================================
// Keys (§4.7)
// ============================================================================

/**
 * What one Escape press does, in priority order.
 */
export type EscapeAction = 'clearSearch' | 'exitEditMode' | 'closeDialog' | 'none';

/**
 * The context of an Escape press. `searchActive` and `editMode` describe the
 * TOP context: the open dialog's own search and edit mode when a dialog is
 * open (the "Broadcast on" dialog has a search; no dialog has an edit
 * mode), else the current view's.
 */
export interface EscapeContext {
  // A dialog is open
  dialogOpen: boolean;
  // The top context's search has text
  searchActive: boolean;
  // The top context is in edit mode (no view has one: the AP-group writes,
  // the Wi-Fi network edit and the "Broadcast on" editor use dialogs)
  editMode: boolean;
}

/**
 * Picks what Escape does (spec §4.7): clear the search first, then exit edit
 * mode, then close the top dialog.
 * @param {EscapeContext} context - The context of the key press.
 * @returns {EscapeAction} The action.
 */
export function escapeAction(context: EscapeContext): EscapeAction {
  if (context.searchActive) return 'clearSearch';
  if (context.editMode) return 'exitEditMode';
  if (context.dialogOpen) return 'closeDialog';
  return 'none';
}

/**
 * The modifier and key state of a key press (a KeyboardEvent subset).
 */
export interface KeyChord {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Tells whether a key press is "focus the search": Cmd+F on macOS, Ctrl+F
 * elsewhere (Ctrl+F on macOS stays the text fields' "forward one character").
 * @param {KeyChord} chord - The key press.
 * @param {string} platform - The Node platform name (e.g. 'darwin').
 * @returns {boolean} True for the find shortcut.
 */
export function isFindShortcut(chord: KeyChord, platform: string): boolean {
  if (chord.altKey || chord.shiftKey || chord.key.toLowerCase() !== 'f') return false;
  return platform === 'darwin' ? chord.metaKey && !chord.ctrlKey : chord.ctrlKey && !chord.metaKey;
}

// ============================================================================
// Single-pane layout (§4.7, 700–799 px)
// ============================================================================

/**
 * The pane the Access points view shows in the single-pane layout.
 */
export type AccessPointsPane = 'list' | 'destination' | 'details';

/**
 * Picks the Access points view's pane: the AP details while open, else the
 * destination picker when the user opened it, else the AP list.
 * @param {boolean} detailsOpen - An AP's details pane is open.
 * @param {boolean} destinationOpen - The destination picker was opened.
 * @returns {AccessPointsPane} The pane to show.
 */
export function accessPointsPane(detailsOpen: boolean, destinationOpen: boolean): AccessPointsPane {
  if (detailsOpen) return 'details';
  return destinationOpen ? 'destination' : 'list';
}

/**
 * Picks the pane of a master/detail view (AP groups, Wi-Fi networks) in the
 * single-pane layout: the detail only while it was opened AND an item is
 * selected (a selection a reload dropped brings the list back).
 * @param {boolean} detailOpen - The detail was opened (an item was picked).
 * @param {boolean} hasSelection - An item is selected.
 * @returns {'list' | 'detail'} The pane to show.
 */
export function masterDetailPane(detailOpen: boolean, hasSelection: boolean): 'list' | 'detail' {
  return detailOpen && hasSelection ? 'detail' : 'list';
}
