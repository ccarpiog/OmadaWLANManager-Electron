// Tests for the pure view-state logic (src/renderer/view-state.ts, a DOM-free
// module): the §4.6 content state of the views (first run, disconnected,
// loading, initial-load error, ready — data always wins), the read-only
// banner's reason (driven by the group model and the management capabilities
// main reports), the §4.7 Escape priority and the Cmd/Ctrl+F shortcut, and
// the pane the single-pane layout shows.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ManagementCapabilities, ManagementReason } from '../../src/shared/types';
import {
  accessPointsPane,
  contentState,
  escapeAction,
  isFindShortcut,
  masterDetailPane,
  readOnlyReason,
  type ContentStateInput,
  type KeyChord,
} from '../../src/renderer/view-state';

// Every reason main can report (src/shared/types.ts ManagementReason)
const REASONS: ManagementReason[] = [
  'legacyController',
  'managementNotConfigured',
  'invalidCredentials',
  'tokenFailed',
  'siteNotFound',
  'apGroupsMismatch',
  'probeFailed',
];

/**
 * Capabilities with management off for a reason.
 * @param {ManagementReason} reason - The reason.
 * @returns {ManagementCapabilities} The capabilities.
 */
function off(reason: ManagementReason): ManagementCapabilities {
  return { manageApGroups: false, manageWifiNetworks: false, reason };
}

// Capabilities with every check passed
const ON: ManagementCapabilities = { manageApGroups: true, manageWifiNetworks: true, reason: null };

/**
 * Builds a content-state input: a configured, idle, disconnected app with
 * no data and no error, with the given fields overridden.
 * @param {Partial<ContentStateInput>} [overrides] - Fields to set.
 * @returns {ContentStateInput} The input.
 */
function input(overrides: Partial<ContentStateInput> = {}): ContentStateInput {
  return { hasStoredConfig: true, isConnecting: false, isLoadingData: false, hasData: false, loadError: null, ...overrides };
}

/**
 * Builds a key press: the given key without modifiers, with the given
 * modifiers set.
 * @param {string} key - The key.
 * @param {Partial<KeyChord>} [modifiers] - Modifiers to set.
 * @returns {KeyChord} The key press.
 */
function chord(key: string, modifiers: Partial<KeyChord> = {}): KeyChord {
  return { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers };
}

describe('contentState', () => {
  test('first run without a stored controller, disconnected with one', () => {
    assert.equal(contentState(input({ hasStoredConfig: false })), 'firstRun');
    assert.equal(contentState(input()), 'disconnected');
  });

  test('connecting or loading the first data shows the loading state', () => {
    assert.equal(contentState(input({ isConnecting: true })), 'loading');
    assert.equal(contentState(input({ isLoadingData: true })), 'loading');
    assert.equal(contentState(input({ hasStoredConfig: false, isConnecting: true })), 'loading');
  });

  test('a failed attempt shows its error until a new attempt starts', () => {
    assert.equal(contentState(input({ loadError: 'Connection error' })), 'loadError');
    // A Retry in flight replaces the error with the loading state
    assert.equal(contentState(input({ loadError: 'Connection error', isConnecting: true })), 'loading');
    // An empty message is still an error (only null means none)
    assert.equal(contentState(input({ loadError: '' })), 'loadError');
  });

  test('loaded data always wins: refreshing and a failed refresh keep it on screen', () => {
    assert.equal(contentState(input({ hasData: true })), 'ready');
    assert.equal(contentState(input({ hasData: true, isLoadingData: true })), 'ready');
    assert.equal(contentState(input({ hasData: true, isConnecting: true, loadError: 'x', hasStoredConfig: false })), 'ready');
  });
});

describe('readOnlyReason', () => {
  test('no banner without data', () => {
    assert.equal(readOnlyReason({ hasData: false, groupModel: null, capabilities: null }), null);
    assert.equal(readOnlyReason({ hasData: false, groupModel: 'apGroup', capabilities: off('managementNotConfigured') }), null);
    assert.equal(readOnlyReason({ hasData: true, groupModel: null, capabilities: off('invalidCredentials') }), null);
  });

  test('Omada 6.3+ without management credentials: viewing only, fix in Settings', () => {
    assert.equal(readOnlyReason({ hasData: true, groupModel: 'apGroup', capabilities: off('managementNotConfigured') }), 'managementNotConfigured');
  });

  test('a legacy (or unknown-version) controller: moving APs only, whatever the capabilities say (also before they arrive)', () => {
    assert.equal(readOnlyReason({ hasData: true, groupModel: 'wlanGroup', capabilities: null }), 'legacyController');
    assert.equal(readOnlyReason({ hasData: true, groupModel: 'wlanGroup', capabilities: ON }), 'legacyController');
  });

  test('Omada 6.3+ while main checks the management access: "checking"', () => {
    assert.equal(readOnlyReason({ hasData: true, groupModel: 'apGroup', capabilities: null }), 'managementChecking');
  });

  test('each failing check is its own reason', () => {
    for (const reason of REASONS) {
      assert.equal(readOnlyReason({ hasData: true, groupModel: 'apGroup', capabilities: off(reason) }), reason, reason);
    }
  });

  test('every check passed: no banner; a reason-less report with a capability off fails closed', () => {
    assert.equal(readOnlyReason({ hasData: true, groupModel: 'apGroup', capabilities: ON }), null);
    assert.equal(readOnlyReason({ hasData: true, groupModel: 'apGroup', capabilities: { ...ON, manageWifiNetworks: false } }), 'probeFailed');
  });
}); // End of describe 'readOnlyReason'

describe('escapeAction', () => {
  test('the search is cleared first, then edit mode, then the dialog', () => {
    assert.equal(escapeAction({ dialogOpen: true, searchActive: true, editMode: true }), 'clearSearch');
    assert.equal(escapeAction({ dialogOpen: true, searchActive: false, editMode: true }), 'exitEditMode');
    assert.equal(escapeAction({ dialogOpen: true, searchActive: false, editMode: false }), 'closeDialog');
  });

  test('without a dialog: clear the search, exit edit mode, or nothing', () => {
    assert.equal(escapeAction({ dialogOpen: false, searchActive: true, editMode: false }), 'clearSearch');
    assert.equal(escapeAction({ dialogOpen: false, searchActive: false, editMode: true }), 'exitEditMode');
    assert.equal(escapeAction({ dialogOpen: false, searchActive: false, editMode: false }), 'none');
  });
});

describe('isFindShortcut', () => {
  test('Cmd+F on macOS, Ctrl+F elsewhere (either case of the key)', () => {
    assert.equal(isFindShortcut(chord('f', { metaKey: true }), 'darwin'), true);
    assert.equal(isFindShortcut(chord('F', { metaKey: true }), 'darwin'), true);
    assert.equal(isFindShortcut(chord('f', { ctrlKey: true }), 'win32'), true);
    assert.equal(isFindShortcut(chord('f', { ctrlKey: true }), 'linux'), true);
  });

  test('the other platform\'s modifier is not the shortcut (Ctrl+F stays "forward" in macOS fields)', () => {
    assert.equal(isFindShortcut(chord('f', { ctrlKey: true }), 'darwin'), false);
    assert.equal(isFindShortcut(chord('f', { metaKey: true }), 'win32'), false);
  });

  test('extra modifiers, both modifiers, no modifier or another key are not the shortcut', () => {
    assert.equal(isFindShortcut(chord('f', { metaKey: true, shiftKey: true }), 'darwin'), false);
    assert.equal(isFindShortcut(chord('f', { metaKey: true, altKey: true }), 'darwin'), false);
    assert.equal(isFindShortcut(chord('f', { metaKey: true, ctrlKey: true }), 'darwin'), false);
    assert.equal(isFindShortcut(chord('f', { ctrlKey: true, metaKey: true }), 'linux'), false);
    assert.equal(isFindShortcut(chord('f'), 'darwin'), false);
    assert.equal(isFindShortcut(chord('g', { metaKey: true }), 'darwin'), false);
  });
});

describe('single-pane panes', () => {
  test('Access points: the AP details win, then the destination picker, else the list', () => {
    assert.equal(accessPointsPane(true, true), 'details');
    assert.equal(accessPointsPane(true, false), 'details');
    assert.equal(accessPointsPane(false, true), 'destination');
    assert.equal(accessPointsPane(false, false), 'list');
  });

  test('master/detail views: the detail only while opened and an item is selected', () => {
    assert.equal(masterDetailPane(true, true), 'detail');
    assert.equal(masterDetailPane(true, false), 'list');
    assert.equal(masterDetailPane(false, true), 'list');
    assert.equal(masterDetailPane(false, false), 'list');
  });
});
