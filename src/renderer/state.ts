// Renderer state. Every piece of module-level mutable state lives in the single
// `state` object below: ES module imports are read-only bindings, so other
// modules read and write `state.<field>` instead of reassigning their own
// `let`s. Nothing else in src/renderer declares module-level mutable state.

import type { AccessPoint, Language, WlanGroup } from '../shared/types';
import { refreshBtn } from './elements';

/**
 * Shape of the renderer's mutable state (see the `state` object below).
 */
export interface RendererState {
  // Active UI language (see setLanguage() in i18n.ts)
  currentLanguage: Language;

  // Loaded controller data and the current selection
  accessPoints: AccessPoint[];
  wlanGroups: WlanGroup[];
  selectedAp: AccessPoint | null;
  selectedWlan: WlanGroup | null;
  isConnected: boolean;
  apFilterText: string;
  wlanFilterText: string;
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

  // Per-operation in-flight flags serializing connect/disconnect/save/apply/
  // refresh so they can never overlap (see isOperationInProgress())
  isConnecting: boolean;
  isDisconnecting: boolean;
  isSavingSettings: boolean;
  isApplyingChange: boolean;

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
  selectedAp: null,
  selectedWlan: null,
  isConnected: false,
  apFilterText: '',
  wlanFilterText: '',
  isLoadingData: false,
  hasStoredConfig: false,
  sessionGeneration: 0,
  isConnecting: false,
  isDisconnecting: false,
  isSavingSettings: false,
  isApplyingChange: false,
  settingsOpener: null,
  isSettingsOpening: false,
};

/**
 * Reports whether any exclusive operation (connect, disconnect, settings
 * save, apply, or data load) is currently in flight. Used to serialize the
 * operations: while one is pending, starting another is a no-op.
 * @returns {boolean} True when an operation is in progress.
 */
export function isOperationInProgress(): boolean {
  return state.isConnecting || state.isDisconnecting || state.isSavingSettings || state.isApplyingChange || state.isLoadingData;
}

/**
 * Invalidates the current session: bumps the generation token (so any
 * in-flight load or apply discards its result when it completes) and resets
 * the loading indicators that a discarded operation will no longer clean up.
 * Called at the start of connect() and disconnect().
 */
export function invalidateSession(): void {
  state.sessionGeneration++;
  state.isLoadingData = false;
  refreshBtn.classList.remove('spinning');
}
