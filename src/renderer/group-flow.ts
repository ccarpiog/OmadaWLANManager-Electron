// ============================================================================
// AP group management flows (todo.md 4.9; docs/management-design.md §4.4):
// New group, Rename and Delete, each one exclusive operation
// (state.isManagingApGroup) bound to the session it started in, and "Move
// access points here". A write flow opens the AP group dialog
// (group-dialog.ts), checks a typed name client-side first (the mirror of
// main's rules in group-management.ts: immediate feedback, no IPC for a name
// main would refuse), sends ONE write over the guarded IPC with the session
// nonce of the connection on screen, and shows main's answer — main is
// authoritative: it re-reads the AP groups and re-applies every rule before
// writing. After a successful write it reloads the internal lists (the AP
// groups view, the destination pane and the sidebar counts), the management
// capabilities and the fresh Open API view (capacity, delete reasons), then
// closes the dialog and restores focus: the new group's list item, the
// renamed group's Rename, the list after a delete, the opener after a
// cancel. A refusal keeps the dialog open with the reason. A late answer
// for another session is discarded (the dialog just closes).
// "Move access points here" never uses the Open API: it opens the Access
// points view with the group preselected as the destination of the phase-13
// move flow (internal OMADA_SET_WLAN, review dialog, per-AP results).
// ============================================================================

import type { WlanGroup } from '../shared/types';
import { renderApDetails } from './ap-details';
import { loadData } from './connection';
import { renderControllerSwitcher } from './controller-switcher';
import { renderDestinationPane } from './destination-pane';
import { apFilterInput, apList, destinationSearchInput, groupDetail } from './elements';
import { openGroupDialog, type GroupDialogContent, type GroupDialogKind } from './group-dialog';
import {
  checkGroupName,
  findCreatedGroupId,
  groupErrorKey,
  isStaleDataFailure,
  isWritableGroupId,
  parseGroupActionResult,
  type GroupFailure,
  type NamedGroup,
  type ParsedGroupAction,
} from './group-management';
import {
  focusGroupDetailHeading,
  focusGroupItem,
  focusGroupListFallback,
  isGroupManagementOn,
  NEW_GROUP_BUTTON_ID,
  RENAME_BUTTON_ID,
  renderGroupsView,
  selectGroup,
} from './groups-view';
import { t, tFormat } from './i18n';
import { focusById } from './inventory-ui';
import { loadManagedGroups } from './managed-groups';
import { loadManagementCapabilities } from './management';
import { isAmbiguousGroup, matchesDestinationSearch } from './move-plan';
import { navigateToView } from './navigation';
import { isOperationInProgress, state } from './state';
import { showToast } from './toast';

// The progress text of each write
const PROGRESS_KEYS = {
  create: 'groupCreating',
  rename: 'groupRenaming',
  delete: 'groupDeleting',
} as const satisfies Record<GroupDialogKind, string>;

// The success message of each write (a toast)
const DONE_KEYS = {
  create: 'groupCreated',
  rename: 'groupRenamed',
  delete: 'groupDeleted',
} as const satisfies Record<GroupDialogKind, string>;

/**
 * What a successful write leaves for the focus and the toast.
 */
interface WriteDone {
  kind: GroupDialogKind;
  // The group written (the new group when it can be told; null otherwise)
  groupId: string | null;
  // The group's name after the write (for a delete: the deleted group's)
  name: string;
}

/**
 * The groups on screen as the name rules see them.
 * @returns {NamedGroup[]} Their ids and names.
 */
function namedGroups(): NamedGroup[] {
  return state.wlanGroups.map(group => ({ id: group.wlanId, name: group.wlanName }));
}

/**
 * The text of a refusal: its message plus main's codes-only diagnostic.
 * @param {GroupFailure} error - The refusal.
 * @param {string | null} diagnostic - Main's diagnostic, or null.
 * @returns {string} The localized text.
 */
function failureText(error: GroupFailure, diagnostic: string | null): string {
  const text = t(groupErrorKey(error));
  return diagnostic === null ? text : `${text} (${diagnostic})`;
}

/**
 * Builds the live name check of the dialog: the message of a refused name,
 * except while the field is blank (only a submit says that).
 * @param {NamedGroup} [renaming] - The group being renamed.
 * @returns {(raw: string) => string | null} The check.
 */
function liveNameCheck(renaming?: NamedGroup): (raw: string) => string | null {
  return (raw: string): string | null => {
    const check = checkGroupName(raw, namedGroups(), renaming);
    return check.ok || check.error === 'nameRequired' ? null : t(groupErrorKey(check.error));
  };
}

/**
 * What the dialog shows for one write.
 * @param {GroupDialogKind} kind - The write.
 * @param {WlanGroup | null} group - The group renamed / deleted (null: create).
 * @returns {GroupDialogContent} The dialog's content.
 */
function dialogContent(kind: GroupDialogKind, group: WlanGroup | null): GroupDialogContent {
  const name = group?.wlanName ?? '';
  if (kind === 'create') {
    return { kind, title: t('createGroupTitle'), message: t('createGroupMessage'), confirmLabel: t('createGroupAction'), initialName: '', validate: liveNameCheck() };
  }
  if (kind === 'rename') {
    return {
      kind,
      title: t('renameGroupTitle'),
      message: tFormat('renameGroupMessage', { name }),
      confirmLabel: t('renameGroupAction'),
      initialName: name,
      validate: liveNameCheck({ id: group?.wlanId ?? '', name }),
    };
  }
  return { kind, title: t('deleteGroupTitle'), message: tFormat('deleteGroupMessage', { name }), confirmLabel: t('deleteGroupAction'), initialName: '', validate: null };
} // End of function dialogContent()

/**
 * Sends one write over IPC and validates the answer; a call that throws
 * (e.g. a malformed request refused by main's guard) is 'failed'.
 * @param {GroupDialogKind} kind - The write.
 * @param {string} sessionNonce - The session nonce of the connection on screen.
 * @param {string} name - The checked name (create / rename).
 * @param {string} apGroupId - The group id (rename / delete).
 * @returns {Promise<ParsedGroupAction>} The validated answer.
 */
async function sendWrite(kind: GroupDialogKind, sessionNonce: string, name: string, apGroupId: string): Promise<ParsedGroupAction> {
  try {
    if (kind === 'create') {
      return parseGroupActionResult(await window.omadaAPI.createApGroup({ sessionNonce, name }));
    }
    if (kind === 'rename') {
      return parseGroupActionResult(await window.omadaAPI.renameApGroup({ sessionNonce, apGroupId, name }));
    }
    return parseGroupActionResult(await window.omadaAPI.deleteApGroup({ sessionNonce, apGroupId }));
  } catch (error) {
    console.warn(`The AP group ${kind} failed:`, error);
    return { ok: false, error: 'failed', diagnostic: null };
  }
} // End of function sendWrite()

/**
 * Reloads after a successful write: the internal lists (AP groups view,
 * destination pane, sidebar counts — a failed reload is reported and the
 * data marked stale, like after a move), then the management capabilities
 * (kept on screen while asked again) and, through them, the fresh Open API
 * view. Stops when the session changes.
 * @param {number} generation - The session generation of the flow.
 * @returns {Promise<void>}
 */
async function reloadAfterWrite(generation: number): Promise<void> {
  try {
    await loadData();
  } catch (error) {
    if (generation !== state.sessionGeneration) return;
    console.warn('Error reloading data after an AP group change:', error);
    showToast(t('loadError'), 'error');
  }
  if (generation !== state.sessionGeneration) return;
  await loadManagementCapabilities(generation, true);
} // End of function reloadAfterWrite()

/**
 * Restores keyboard focus once the dialog closed: after a create, the new
 * group's list item (selected), else "New group"; after a rename, the
 * group's Rename, else its heading; after a delete, the list (its Tab stop,
 * "New group" or the search). Without a write (Cancel, Escape, a refusal
 * then Cancel): the control that opened the dialog, also when the views
 * were re-rendered meanwhile (found again by its id) — when it is disabled
 * now (e.g. Delete after fresh data showed APs), the group's heading if it
 * was in the detail — else the list.
 * @param {WriteDone | null} done - The successful write, or null.
 * @param {HTMLElement | null} opener - The element focused when the flow started.
 * @param {boolean} openerInDetail - The opener was in the group's detail.
 */
function restoreFocus(done: WriteDone | null, opener: HTMLElement | null, openerInDetail: boolean): void {
  if (done !== null && done.kind === 'create') {
    if (done.groupId !== null) {
      selectGroup(done.groupId);
      if (focusGroupItem(done.groupId)) return;
    }
    if (focusById(NEW_GROUP_BUTTON_ID)) return;
  } else if (done !== null && done.kind === 'rename') {
    if (focusById(RENAME_BUTTON_ID) || focusGroupDetailHeading()) return;
  } else if (done === null) {
    if (opener !== null && opener.isConnected && !(opener instanceof HTMLButtonElement && opener.disabled)) {
      opener.focus();
      if (document.activeElement === opener) return;
    }
    if (opener !== null && opener.id !== '' && focusById(opener.id)) return;
    if (openerInDetail && focusGroupDetailHeading()) return;
  }
  focusGroupListFallback();
} // End of function restoreFocus()

/**
 * Runs one AP group write flow (New group, Rename, Delete). A no-op while
 * any exclusive operation runs, while AP-group management is off, or for a
 * group that is gone or whose id main would refuse. Dialog → (client-side
 * name check) → write → reload → close; a refusal keeps the dialog open for
 * another try or Cancel. A submit while AP-group management is no longer on
 * (it went off, or a capability check started, after the dialog opened)
 * sends nothing: the dialog shows the managementUnavailable message. Refusals that mean the data on screen is stale
 * (fresh data says otherwise) also read the fresh Open API view again, so
 * the detail follows. The dialog always closes, the operation flag is
 * released, the actions re-render and focus returns to the page.
 * @param {GroupDialogKind} kind - The write.
 * @param {string | null} groupId - The group renamed / deleted (null: create).
 * @returns {Promise<void>}
 */
export async function runGroupFlow(kind: GroupDialogKind, groupId: string | null): Promise<void> {
  if (isOperationInProgress() || !isGroupManagementOn()) return;
  const nonce = state.sessionNonce;
  const group = groupId === null ? null : state.wlanGroups.find(candidate => candidate.wlanId === groupId) ?? null;
  if (nonce === null || (kind !== 'create' && (group === null || !isWritableGroupId(group.wlanId)))) return;

  state.isManagingApGroup = true;
  // The controller switcher is disabled while this flow runs (inbox I-1c2b)
  renderControllerSwitcher();
  const generation = state.sessionGeneration;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const openerInDetail = opener !== null && groupDetail.contains(opener);
  const renaming = kind === 'rename' && group !== null ? { id: group.wlanId, name: group.wlanName } : undefined;
  const dialog = openGroupDialog(dialogContent(kind, group));
  let done: WriteDone | null = null;

  try {
    for (;;) {
      const raw = await dialog.next();
      if (raw === null || generation !== state.sessionGeneration) break;
      // Management went off (or became unknown: a capability check started)
      // while the dialog was open: nothing is sent, the dialog says why and
      // stays open for Cancel
      if (!isGroupManagementOn()) {
        dialog.showError(failureText('managementUnavailable', null));
        continue;
      }
      let name = '';
      if (kind !== 'delete') {
        const check = checkGroupName(raw, namedGroups(), renaming);
        if (!check.ok) {
          dialog.showError(failureText(check.error, null));
          continue;
        }
        name = check.name;
      }

      dialog.showBusy(t(PROGRESS_KEYS[kind]));
      const result = await sendWrite(kind, nonce, name, group?.wlanId ?? '');
      // A late answer for another session: nothing of it reaches the UI
      if (generation !== state.sessionGeneration || state.sessionNonce !== nonce) break;
      if (!result.ok) {
        dialog.showError(failureText(result.error, result.diagnostic));
        if (isStaleDataFailure(result.error)) {
          void loadManagedGroups(generation);
        }
        continue;
      }

      dialog.showBusy(t('refreshing'));
      await reloadAfterWrite(generation);
      if (generation !== state.sessionGeneration) break;
      done = {
        kind,
        groupId: kind === 'create' ? findCreatedGroupId(result.apGroupId, name, namedGroups()) : group?.wlanId ?? null,
        name: kind === 'delete' ? group?.wlanName ?? '' : name,
      };
      break;
    } // End of the dialog -> write -> reload loop
  } catch (error) {
    console.error('Error managing an AP group:', error);
    if (generation === state.sessionGeneration) {
      showToast(t('apGroupErrorFailed'), 'error');
    }
  } finally {
    dialog.close();
    state.isManagingApGroup = false;
    renderControllerSwitcher();
    if (generation === state.sessionGeneration) {
      // Re-enables the actions for whatever the state is now
      renderGroupsView();
      if (done !== null) {
        showToast(tFormat(DONE_KEYS[done.kind], { name: done.name }), 'success');
      }
      restoreFocus(done, opener, openerInDetail);
    }
  }
} // End of function runGroupFlow()

/**
 * "Move access points here" (spec §4.4): opens the Access points view with
 * the group checked as the destination of the phase-13 move flow (the
 * internal OMADA_SET_WLAN path; the move button opens the same review
 * dialog), the AP details pane closed and, in the single-pane layout, the AP
 * list shown — focus goes to the list so the APs to move can be ticked (a
 * selection already made is kept). The destination search is cleared when
 * it would hide the group. A no-op while disconnected, during an exclusive
 * operation, or for a group that is gone or whose name another group shares
 * (not a valid destination).
 * @param {string} groupId - The group id.
 */
export function moveApsHere(groupId: string): void {
  if (!state.isConnected || isOperationInProgress()) return;
  const group = state.wlanGroups.find(candidate => candidate.wlanId === groupId);
  if (group === undefined || isAmbiguousGroup(group, state.wlanGroups)) return;
  state.destinationGroup = group;
  if (!matchesDestinationSearch(group, state.destinationSearchText)) {
    state.destinationSearchText = '';
    destinationSearchInput.value = '';
  }
  state.apDetailsMac = null;
  state.destinationPaneOpen = false;
  navigateToView('accessPoints');
  renderApDetails();
  renderDestinationPane();
  const tabStop = apList.querySelector<HTMLInputElement>('.ap-checkbox[tabindex="0"]');
  (tabStop ?? apFilterInput).focus();
} // End of function moveApsHere()

/**
 * Delegated click handler of the AP groups view's actions (data-group-action:
 * create, rename, delete, moveHere); rename, delete and moveHere act on the
 * selected group. Disabled actions do nothing.
 * @param {MouseEvent} e - The click event.
 */
export function handleGroupActionClick(e: MouseEvent): void {
  const button = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('[data-group-action]') : null;
  if (button === null || button.disabled) return;
  const groupId = state.selectedGroupId;
  switch (button.dataset.groupAction) {
    case 'create':
      void runGroupFlow('create', null);
      break;
    case 'rename':
      void runGroupFlow('rename', groupId);
      break;
    case 'delete':
      void runGroupFlow('delete', groupId);
      break;
    case 'moveHere':
      if (groupId !== null) moveApsHere(groupId);
      break;
    default:
      break;
  }
} // End of function handleGroupActionClick()
