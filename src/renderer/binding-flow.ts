// ============================================================================
// "Broadcast on" flow (todo.md 4.12, phase 19b; docs/management-design.md
// §4.5, §5): which AP groups broadcast a managed Wi-Fi network, as one
// exclusive operation (state.isManagingNetwork, like the 18b network writes)
// bound to the session it started in, over the guarded IPC of phase 19a
// (updateNetworkBindings() with the session nonce, the network's id and the
// COMPLETE new set of groups). Steps:
//   1. "Change AP groups" (only for a network bound to known AP groups,
//      while Wi-Fi network management is on and the data on screen is fresh:
//      currentBindingWriteBlock() — the 18b gate plus the managed AP-group
//      list) opens the editor (binding-dialog.ts) on the network's current
//      groups, with the live preview of network-bindings.ts (before / after
//      reach, added / removed / kept groups, the capacity pre-check);
//   2. "Review the change": the request-level rules on the selection
//      (checkBindingSelection(): no group, nothing changed — nothing is
//      read), then the data is READ AGAIN (the internal lists, the managed
//      network list and the managed AP-group list) and the change is judged
//      on that fresh read only: management gone or the network gone / no
//      longer editable ends the flow with a toast; data not fresh keeps the
//      editor with the reason; a network or an AP-group list that changed
//      since the editor showed it rebuilds the editor on the fresh data with
//      the reason (nothing is sent until the user reviews again); then the
//      full client-side check (checkBindingDraft(): every group listed, the
//      bands known while adding, the capacity of every added group on every
//      band — fail closed, every failing group + band named);
//   3. the confirmation of the change (Back keeps the selection; Cancel or
//      Escape sends nothing);
//   4. "Save AP groups": Wi-Fi network management re-checked, the freshness
//      gate and the network unchanged on the managed list (sameManagedNetwork())
//      re-checked right before the ONE write; main's answer is shown as text
//      with its codes-only diagnostic and — for 'capacityInsufficient' — its
//      capacity problems (authoritative; 'mlo' included, with the MLO note),
//      back on the editor; a refusal that means stale data re-reads the
//      managed lists in the background;
//   5. after success: the internal data, the capabilities and with them the
//      managed lists are reloaded; the dialog closes, a toast states the
//      refreshed scope and focus returns to "Change AP groups".
// A late answer for another session is discarded (the dialog just closes).
// ============================================================================

import type { ManagedNetwork, NetworkBindingsRequest } from '../shared/types';
import { openBindingDialog, type BindingDescriber, type BindingDialog } from './binding-dialog';
import { loadData } from './connection';
import { renderControllerSwitcher } from './controller-switcher';
import { networkDetail } from './elements';
import { t, tFormat, translate } from './i18n';
import { displayName, focusById } from './inventory-ui';
import { loadManagedGroups } from './managed-groups';
import { loadManagedNetworks } from './managed-networks';
import { BINDINGS_NETWORK_BUTTON_ID, managedScopeText } from './managed-networks-view';
import {
  bindingAvailability,
  bindingChangeNotes,
  bindingChangeRows,
  bindingFailureText,
  bindingOptions,
  bindingPreview,
  capacityProblemLines,
  checkBindingDraft,
  checkBindingSelection,
  groupNameLookup,
  isBindingStaleDataFailure,
  mloProblemNote,
  parseNetworkBindingsResult,
  planBindingChange,
  sameBindingOptions,
  type BindingFailure,
  type BindingFailureInfo,
  type BindingOption,
  type CheckedBindingWrite,
  type ParsedBindingsResult,
} from './network-bindings';
import { sameManagedNetwork, type TextContext } from './network-editing';
import { heldNetwork, reloadAfterWrite } from './network-flow';
import { managedNetworkScope } from './network-management';
import {
  currentBindingWriteBlock,
  focusNetworkDetailHeading,
  focusNetworkListFallback,
  isNetworkManagementOn,
  renderNetworksView,
} from './networks-view';
import { isOperationInProgress, state } from './state';
import { showToast } from './toast';

/** One binding flow in progress: its session, the network, what the editor shows, and the dialog. */
interface BindingFlowContext {
  generation: number;
  nonce: string;
  networkId: string;
  // The network the change is judged against (replaced by a fresh read
  // whenever the network changed on the controller)
  baseline: ManagedNetwork;
  // The AP groups the editor offers
  options: BindingOption[];
  dialog: BindingDialog;
}

/** How a flow ended: written or not, and the toast to show (none for a plain cancel). */
interface BindingFlowResult {
  written: boolean;
  toast: string;
  toastType: 'success' | 'error' | 'info';
}

/** The fresh read before the confirmation: the network and options as they are now, or why the change cannot go on. */
type FreshBindingData =
  | { ok: true; network: ManagedNetwork; options: BindingOption[] }
  | { ok: false; failure: BindingFailureInfo; end: boolean };

/** The outcome of the guarded write. */
type BindingWriteOutcome = { kind: 'ok' } | { kind: 'refused'; failure: BindingFailureInfo; fromMain: boolean } | { kind: 'gone' };

/**
 * The text context of the active language (for network-bindings.ts).
 * @returns {TextContext} The translator and the language.
 */
function textContext(): TextContext {
  return { tr: translate, language: state.currentLanguage };
}

/**
 * A failure of the renderer's own (no diagnostic, no capacity problem).
 * @param {BindingFailure} error - The failure.
 * @returns {BindingFailureInfo} The failure info.
 */
function ownFailure(error: BindingFailure): BindingFailureInfo {
  return { error, diagnostic: null, capacityProblems: [] };
}

/**
 * Tells whether a flow's session is gone (another session generation or
 * nonce on screen): nothing of a late answer reaches the UI then.
 * @param {BindingFlowContext} flow - The flow.
 * @returns {boolean} True when the session changed.
 */
function isGone(flow: BindingFlowContext): boolean {
  return flow.generation !== state.sessionGeneration || state.sessionNonce !== flow.nonce;
}

/**
 * The AP groups the editor offers from the data on screen (the managed
 * AP-group list main can bind, with the internal AP counts).
 * @returns {BindingOption[]} The options.
 */
function currentOptions(): BindingOption[] {
  return bindingOptions(state.managedApGroups ?? [], state.wlanGroups, state.accessPoints);
}

/**
 * The live preview of the editor for a baseline network, over the data on
 * screen when it is asked.
 * @param {ManagedNetwork} network - The network the change is judged against.
 * @returns {BindingDescriber} The describer.
 */
function describerFor(network: ManagedNetwork): BindingDescriber {
  return (selected, visible) =>
    bindingPreview({ network, selected, visible, managed: state.managedApGroups ?? [], groups: state.wlanGroups, accessPoints: state.accessPoints }, textContext());
}

/**
 * Shows a refusal in the dialog: its text (with main's diagnostic), the
 * capacity problems named per group and band, the MLO note when MLO is
 * named; for main's refusals that mean the data on screen may be stale,
 * the managed lists are read again in the background so the detail follows.
 * @param {BindingFlowContext} flow - The flow.
 * @param {BindingFailureInfo} failure - The refusal.
 * @param {boolean} fromMain - Main refused (not the client-side check).
 */
function showRefusal(flow: BindingFlowContext, failure: BindingFailureInfo, fromMain: boolean): void {
  const ctx = textContext();
  const nameOf = groupNameLookup(state.managedApGroups ?? [], state.wlanGroups);
  const note = mloProblemNote(failure.capacityProblems, ctx);
  flow.dialog.showError(bindingFailureText(failure, ctx), capacityProblemLines(failure.capacityProblems, nameOf, ctx), note === null ? [] : [note]);
  if (fromMain && isBindingStaleDataFailure(failure.error)) {
    void loadManagedNetworks(flow.generation);
    void loadManagedGroups(flow.generation);
  }
} // End of function showRefusal()

/**
 * Reads again, right before the confirmation, everything the change is
 * judged on: the internal lists (the APs and groups the reach is resolved
 * against; a failed reload leaves them stale), then the managed network list
 * and the managed AP-group list. Refused — the flow ends — when management
 * went off, or when the network is gone or no longer offers the editor (e.g.
 * now "All access points"); refused with the editor kept when the data is
 * not fresh after the read.
 * @param {BindingFlowContext} flow - The flow.
 * @returns {Promise<FreshBindingData | null>} The fresh data or the refusal; null when the session changed meanwhile.
 */
async function rereadForReview(flow: BindingFlowContext): Promise<FreshBindingData | null> {
  try {
    await loadData();
  } catch (error) {
    if (isGone(flow)) return null;
    console.warn('Error reloading data before a Broadcast on change:', error);
  }
  if (isGone(flow)) return null;
  // A failed reload is refused below (the data is stale): no managed read then
  if (!state.refreshError) {
    await Promise.all([loadManagedNetworks(flow.generation), loadManagedGroups(flow.generation)]);
    if (isGone(flow)) return null;
  }
  if (!isNetworkManagementOn()) {
    return { ok: false, failure: ownFailure('managementUnavailable'), end: true };
  }
  const blocked = currentBindingWriteBlock();
  if (blocked !== null) {
    return { ok: false, failure: ownFailure(blocked), end: false };
  }
  const network = heldNetwork(flow.networkId);
  if (network === null || bindingAvailability(network, true)?.kind !== 'editable') {
    return { ok: false, failure: ownFailure('networkChanged'), end: true };
  }
  return { ok: true, network, options: currentOptions() };
} // End of function rereadForReview()

/**
 * Sends the binding write over IPC and validates the answer; a call that
 * throws (e.g. a request refused by main's guard) is 'failed'. Only a fixed
 * text and the error's name are logged.
 * @param {NetworkBindingsRequest} request - The request (the complete new set).
 * @returns {Promise<ParsedBindingsResult>} The validated answer.
 */
async function callBindings(request: NetworkBindingsRequest): Promise<ParsedBindingsResult> {
  try {
    return parseNetworkBindingsResult(await window.omadaAPI.updateNetworkBindings(request));
  } catch (error) {
    console.warn(`The Broadcast on change failed (${error instanceof Error ? error.name : 'unknown error'})`);
    return { ok: false, error: 'failed', diagnostic: null, capacityProblems: [] };
  }
}

/**
 * Runs the write of a confirmed change, failing closed: when Wi-Fi network
 * management is no longer on, when the data on screen is not known to be
 * fresh (currentBindingWriteBlock()), when the network changed on the
 * managed list since the confirmation was built (or is gone), or when the
 * offered AP groups changed, nothing is sent. Otherwise the dialog shows the
 * progress, the ONE write is sent, and its answer is 'gone' when the session
 * changed meanwhile.
 * @param {BindingFlowContext} flow - The flow.
 * @param {CheckedBindingWrite} write - The checked write (its request).
 * @returns {Promise<BindingWriteOutcome>} The outcome.
 */
async function guardedBindingWrite(flow: BindingFlowContext, write: CheckedBindingWrite): Promise<BindingWriteOutcome> {
  if (!isNetworkManagementOn()) {
    return { kind: 'refused', failure: ownFailure('managementUnavailable'), fromMain: false };
  }
  const blocked = currentBindingWriteBlock();
  if (blocked !== null) {
    return { kind: 'refused', failure: ownFailure(blocked), fromMain: false };
  }
  const held = heldNetwork(flow.networkId);
  if (held === null || !sameManagedNetwork(flow.baseline, held)) {
    return { kind: 'refused', failure: ownFailure('networkChanged'), fromMain: false };
  }
  if (!sameBindingOptions(flow.options, currentOptions())) {
    return { kind: 'refused', failure: ownFailure('groupsChanged'), fromMain: false };
  }
  flow.dialog.showBusy(t('bindingSaving'));
  const parsed = await callBindings(write.request);
  if (isGone(flow)) return { kind: 'gone' };
  return parsed.ok ? { kind: 'ok' } : { kind: 'refused', failure: parsed, fromMain: true };
} // End of function guardedBindingWrite()

/**
 * The toast after a successful write: the network's refreshed scope ("N
 * groups · M APs", from the reloaded data), or a plain confirmation when
 * the reloaded list does not show it bound to AP groups.
 * @param {string} networkId - The network's id.
 * @param {string} shownName - Its name as the flow showed it.
 * @returns {string} The toast's text.
 */
function savedToast(networkId: string, shownName: string): string {
  const fresh = heldNetwork(networkId);
  const name = displayName(fresh?.name ?? shownName);
  if (fresh === null || fresh.scope !== 'apGroups') {
    return tFormat('bindingSavedPlain', { name });
  }
  return tFormat('bindingSaved', { name, scope: managedScopeText(managedNetworkScope(fresh, state.wlanGroups, state.accessPoints)) });
}

/**
 * The editor → fresh read → confirmation → write → reload loop (see the
 * header). Back returns to the editor with the selection kept; Cancel or
 * Escape at any step ends it with nothing sent; a refusal keeps the dialog.
 * @param {BindingFlowContext} flow - The flow.
 * @returns {Promise<BindingFlowResult | null>} How it ended, or null for a cancel / a session change.
 */
async function runBindingEditor(flow: BindingFlowContext): Promise<BindingFlowResult | null> {
  const ctx = textContext();
  const shownName = flow.baseline.name;
  // The checked write while the confirmation is shown; null on the editor
  let review: CheckedBindingWrite | null = null;
  for (;;) {
    const choice = await flow.dialog.next();
    if (choice === null || isGone(flow)) return null;
    if (review === null) {
      // The request-level rules on the selection as shown (nothing is read)
      const shown = checkBindingSelection(flow.baseline, flow.dialog.selected());
      if (!shown.ok) {
        showRefusal(flow, shown, false);
        continue;
      }
      flow.dialog.showBusy(t('bindingReading'));
      const fresh = await rereadForReview(flow);
      if (fresh === null) return null;
      if (!fresh.ok) {
        if (fresh.end) {
          return { written: false, toast: bindingFailureText(fresh.failure, ctx), toastType: 'error' };
        }
        showRefusal(flow, fresh.failure, false);
        continue;
      }
      const networkSame = sameManagedNetwork(flow.baseline, fresh.network);
      if (!networkSame || !sameBindingOptions(flow.options, fresh.options)) {
        // Judged on fresh data only: the editor is rebuilt on it, to be reviewed again
        flow.baseline = fresh.network;
        flow.options = fresh.options;
        flow.dialog.setOptions(fresh.options, describerFor(fresh.network));
        showRefusal(flow, ownFailure(networkSame ? 'groupsChanged' : 'networkChanged'), false);
        continue;
      }
      flow.baseline = fresh.network;
      const checked = checkBindingDraft(flow.baseline, flow.dialog.selected(), state.managedApGroups ?? [], flow.nonce);
      if (!checked.ok) {
        showRefusal(flow, checked, false);
        continue;
      }
      review = checked;
      const change = planBindingChange(flow.baseline, checked.request.apGroupIds, state.wlanGroups, state.accessPoints);
      const nameOf = groupNameLookup(state.managedApGroups ?? [], state.wlanGroups);
      const summary = { rows: bindingChangeRows(change, nameOf, ctx), notes: bindingChangeNotes(change, ctx) };
      flow.dialog.showReview(t('bindingReviewTitle'), tFormat('bindingReviewMessage', { name: displayName(flow.baseline.name) }), summary, t('bindingSaveAction'));
      continue;
    }
    if (choice === 'back') {
      review = null;
      flow.dialog.showEditor();
      continue;
    }

    const outcome = await guardedBindingWrite(flow, review);
    if (outcome.kind === 'gone') return null;
    if (outcome.kind === 'refused') {
      review = null;
      flow.dialog.showEditor();
      showRefusal(flow, outcome.failure, outcome.fromMain);
      continue;
    }
    flow.dialog.showBusy(t('refreshing'));
    await reloadAfterWrite(flow.generation);
    if (flow.generation !== state.sessionGeneration) return null;
    return { written: true, toast: savedToast(flow.networkId, shownName), toastType: 'success' };
  } // End of the editor -> review -> write -> reload loop
} // End of function runBindingEditor()

/**
 * Restores keyboard focus once the dialog closed: after a write, "Change AP
 * groups" in the network's detail, else its heading, else the list; without
 * a write, the control that opened the dialog (found again by its id when
 * the view was re-rendered), else the network's heading, else the list.
 * @param {boolean} written - The binding was written.
 * @param {HTMLElement | null} opener - The element focused when the flow started.
 * @param {boolean} openerInDetail - The opener was in the network's detail.
 */
function restoreFocus(written: boolean, opener: HTMLElement | null, openerInDetail: boolean): void {
  if (written) {
    if (focusById(BINDINGS_NETWORK_BUTTON_ID) || focusNetworkDetailHeading()) return;
  } else {
    if (opener !== null && opener.isConnected && !(opener instanceof HTMLButtonElement && opener.disabled)) {
      opener.focus();
      if (document.activeElement === opener) return;
    }
    if (opener !== null && opener.id !== '' && focusById(opener.id)) return;
    if (openerInDetail && focusNetworkDetailHeading()) return;
  }
  focusNetworkListFallback();
} // End of function restoreFocus()

/**
 * Runs the "Broadcast on" flow for a network (see the header). A no-op
 * while any exclusive operation runs, while Wi-Fi network management is off
 * (also while a capability check runs), and for a network that is gone or
 * whose binding is read-only ("All access points", unknown scope). While the
 * data on screen is not known to be fresh nothing opens: a toast says why
 * and the view re-renders with the action held back. The dialog (when it
 * opened) always closes, the operation flag is released, the view
 * re-renders and focus returns to the page.
 * @param {string | null} networkId - The network (the selected one).
 * @returns {Promise<void>}
 */
export async function runBindingFlow(networkId: string | null): Promise<void> {
  if (isOperationInProgress() || !isNetworkManagementOn() || networkId === null) return;
  const nonce = state.sessionNonce;
  const shown = heldNetwork(networkId);
  if (nonce === null || shown === null || bindingAvailability(shown, true)?.kind !== 'editable') return;
  // Fail closed on data known to be stale (or being read again)
  const held = currentBindingWriteBlock();
  if (held !== null) {
    const reading = held === 'dataReading' || held === 'groupsReading';
    showToast(bindingFailureText(ownFailure(held), textContext()), reading ? 'info' : 'error');
    renderNetworksView();
    return;
  }

  state.isManagingNetwork = true;
  // The controller switcher is disabled while this flow runs (inbox I-1c2b)
  renderControllerSwitcher();
  const generation = state.sessionGeneration;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const openerInDetail = opener !== null && networkDetail.contains(opener);
  let dialog: BindingDialog | null = null;
  let result: BindingFlowResult | null = null;

  try {
    const options = currentOptions();
    dialog = openBindingDialog({
      title: t('bindingTitle'),
      message: tFormat('bindingMessage', { name: displayName(shown.name) }),
      options,
      selected: shown.apGroupIds ?? [],
      describe: describerFor(shown),
    });
    result = await runBindingEditor({ generation, nonce, networkId, baseline: shown, options, dialog });
  } catch (error) {
    console.error('Error changing where a Wi-Fi network is broadcast:', error instanceof Error ? error.message : 'unknown error');
    if (generation === state.sessionGeneration) {
      showToast(t('bindingErrorFailed'), 'error');
    }
  } finally {
    dialog?.close();
    state.isManagingNetwork = false;
    renderControllerSwitcher();
    if (generation === state.sessionGeneration) {
      // Re-enables the actions for whatever the state is now
      renderNetworksView();
      if (result !== null) {
        showToast(result.toast, result.toastType);
      }
      restoreFocus(result?.written ?? false, opener, openerInDetail);
    }
  }
} // End of function runBindingFlow()

/**
 * Delegated click handler of the Wi-Fi networks view's "Change AP groups"
 * (data-binding-action "edit"), for the selected network. A disabled action
 * does nothing.
 * @param {MouseEvent} e - The click event.
 */
export function handleBindingActionClick(e: MouseEvent): void {
  const button = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('[data-binding-action]') : null;
  if (button === null || button.disabled || button.dataset.bindingAction !== 'edit') return;
  void runBindingFlow(state.selectedManagedNetworkId);
}
