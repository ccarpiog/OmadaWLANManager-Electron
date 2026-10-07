// ============================================================================
// Wi-Fi network write flows (todo.md 4.11, phase 18b; docs/management-design.md
// §3, §4.5, §5): New network, Edit, Change password, Enable / Disable and
// Delete, each one exclusive operation (state.isManagingNetwork) bound to the
// session it started in, over the guarded IPC of phase 18a with the session
// nonce of the connection on screen. A flow opens the network dialog
// (network-dialog.ts), checks the form client-side first (the mirror of
// main's rules in network-editing.ts: immediate feedback, no IPC for a write
// main would refuse), and only then sends ONE write — main is
// authoritative: it reads fresh controller data and re-applies every rule —
// and shows main's answer as text, with its codes-only diagnostic. Right
// before every write the renderer checks again that Wi-Fi network management
// is on (a capability check that started meanwhile turns it off: fail
// closed, nothing is sent, the dialog says why), that the data on screen is
// fresh (never while the internal data is stale after a failed refresh, nor
// while the managed list is stale or being read: currentNetworkWriteBlock())
// and that the network acted on is still the one the managed list holds
// (unchanged, not gone). A flow does not even start on data known to be
// stale (a toast says why; the actions render disabled with the reason).
//   - New network: created disabled, bound to the chosen AP groups; with
//     "Enable after creating", a second write enables it when main reported
//     the new network's id (never one found by name) — otherwise, or when
//     enabling fails, the toast says the network stays disabled and why;
//   - Edit: a staged form (name, Open ↔ WPA-Personal, bands, the re-typed
//     passphrase for every WPA-Personal result), then a review of the
//     changes; Cancel (or Escape) discards everything and nothing is sent
//     until "Save changes";
//   - Change password: the new passphrase twice, then a review naming the
//     network, its scope and the effect, built from the same fresh read as
//     the confirmations below (refused the same way; nothing is sent until
//     "Change password" there);
//   - Enable / Disable / Delete: a confirmation stating the impact (scope,
//     bound groups), opened only after the internal data and the managed
//     list were read again, built from that fresh read — refused with a
//     toast when the read fails or the network changed or is gone meanwhile.
// After a successful write it reloads the internal data, the management
// capabilities (kept on screen while asked again) and, with them, the
// managed network list; then the dialog closes, a toast says what happened,
// and focus goes to the new network's list item, the network's detail (the
// action used, else its heading), or the list after a delete — the opener
// after a cancel. A refusal keeps the dialog open; one that means the data
// on screen may be stale also re-reads the managed list. A late answer for
// another session is discarded (the dialog just closes). The passphrase is
// read from its field only right before a check or a write, sent once
// renderer → main, and never logged, stored or shown.
// ============================================================================

import type { ManagedNetwork, NetworkCreateRequest, NetworkPasswordRequest, NetworkUpdateRequest } from '../shared/types';
import { loadData } from './connection';
import { networkDetail } from './elements';
import { WRITABLE_GROUP_ID_REGEX } from './group-management';
import { t, tFormat, translate, type Translations } from './i18n';
import { groupMembers } from './inventory-model';
import { apCountOrUnknown, displayName, focusById } from './inventory-ui';
import { loadManagedNetworks } from './managed-networks';
import {
  DELETE_NETWORK_BUTTON_ID,
  EDIT_NETWORK_BUTTON_ID,
  NEW_NETWORK_BUTTON_ID,
  PASSWORD_NETWORK_BUTTON_ID,
  TOGGLE_NETWORK_BUTTON_ID,
} from './managed-networks-view';
import { loadManagementCapabilities } from './management';
import { openNetworkDialog, type GroupOption, type NetworkDialog, type NetworkDialogContent, type NetworkDialogKind, type NetworkField } from './network-dialog';
import {
  checkCreateDraft,
  checkEditDraft,
  checkPassphrase,
  editNoteTexts,
  editReviewRows,
  findCreatedNetworkId,
  impactNote,
  impactRows,
  initialEditDraft,
  isNetworkStaleDataFailure,
  networkActions,
  networkFailureText,
  parseNetworkActionResult,
  passwordReviewSummary,
  sameManagedNetwork,
  type EditPlan,
  type NetworkFailureInfo,
  type NetworkWriteFailure,
  type ParsedNetworkAction,
  type TextContext,
} from './network-editing';
import { managedNetworkScope } from './network-management';
import {
  currentNetworkWriteBlock,
  focusManagedNetworkItem,
  focusNetworkDetailHeading,
  focusNetworkListFallback,
  isNetworkManagementOn,
  renderNetworksView,
  selectManagedNetwork,
} from './networks-view';
import { isOperationInProgress, state } from './state';
import { showToast } from './toast';

// The progress text of each confirmed write
const CONFIRMED_PROGRESS_KEYS = {
  enable: 'networkEnabling',
  disable: 'networkDisabling',
  delete: 'networkDeleting',
} as const satisfies Record<'enable' | 'disable' | 'delete', keyof Translations>;

// The success message of each write but the create (a toast)
const DONE_KEYS = {
  edit: 'networkSaved',
  password: 'networkPasswordChanged',
  enable: 'networkEnabledDone',
  disable: 'networkDisabledDone',
  delete: 'networkDeleted',
} as const satisfies Record<Exclude<NetworkDialogKind, 'create'>, keyof Translations>;

// The control focus returns to after a write on a network that stays
const ACTION_BUTTON_IDS = {
  edit: EDIT_NETWORK_BUTTON_ID,
  password: PASSWORD_NETWORK_BUTTON_ID,
  enable: TOGGLE_NETWORK_BUTTON_ID,
  disable: TOGGLE_NETWORK_BUTTON_ID,
  delete: DELETE_NETWORK_BUTTON_ID,
} as const satisfies Record<Exclude<NetworkDialogKind, 'create'>, string>;

/** One flow in progress: its write, session, network and dialog. */
interface FlowContext {
  kind: NetworkDialogKind;
  generation: number;
  nonce: string;
  // The network written (null for a create)
  network: ManagedNetwork | null;
  dialog: NetworkDialog;
}

/** What a successful flow leaves for the toast and the focus. */
interface FlowDone {
  kind: NetworkDialogKind;
  // The network written (the new one when it can be told; null otherwise)
  networkId: string | null;
  toast: string;
  toastType: 'success' | 'error' | 'info';
}

/** The outcome of one guarded write. */
type WriteOutcome = { kind: 'ok'; networkId: string | null } | { kind: 'refused'; failure: NetworkFailureInfo } | { kind: 'gone' };

/** The outcome of the fresh read before a confirmation: the network as it is now, or why it is refused. */
type FreshRead = { ok: true; network: ManagedNetwork } | { ok: false; failure: NetworkFailureInfo };

/**
 * The text context of the active language (for network-editing.ts).
 * @returns {TextContext} The translator and the language.
 */
function textContext(): TextContext {
  return { tr: translate, language: state.currentLanguage };
}

/**
 * Tells whether a flow's session is gone (another session generation or
 * nonce on screen): nothing of a late answer reaches the UI then.
 * @param {FlowContext} flow - The flow.
 * @returns {boolean} True when the session changed.
 */
function isGone(flow: FlowContext): boolean {
  return flow.generation !== state.sessionGeneration || state.sessionNonce !== flow.nonce;
}

/**
 * The network with an id on the managed list held now, or null (also used
 * by the "Broadcast on" flow, binding-flow.ts).
 * @param {string} networkId - The network's id.
 * @returns {ManagedNetwork | null} The network, or null.
 */
export function heldNetwork(networkId: string): ManagedNetwork | null {
  return state.managedNetworks?.find(candidate => candidate.id === networkId) ?? null;
}

/**
 * Why a write may not act on the data on screen now: writes are held back
 * (currentNetworkWriteBlock(): the internal data stale after a failed
 * refresh, the managed list stale or being read), or the network a flow
 * captured changed on the managed list since, or is gone
 * ('networkChanged'). Null when the write may go ahead.
 * @param {ManagedNetwork | null} network - The network acted on (null: a create).
 * @returns {NetworkFailureInfo | null} The refusal, or null.
 */
function freshnessRefusal(network: ManagedNetwork | null): NetworkFailureInfo | null {
  const blocked = currentNetworkWriteBlock();
  if (blocked !== null) return { error: blocked, diagnostic: null };
  if (network === null) return null;
  const held = heldNetwork(network.id);
  return held !== null && sameManagedNetwork(network, held) ? null : { error: 'networkChanged', diagnostic: null };
}

/**
 * Shows a refusal that keeps a flow from opening its dialog as a toast (an
 * information while the data is being read again, an error otherwise).
 * @param {NetworkFailureInfo} failure - The refusal.
 */
function showRefusalToast(failure: NetworkFailureInfo): void {
  showToast(networkFailureText(failure, textContext()), failure.error === 'dataReading' ? 'info' : 'error');
}

/**
 * The form field a refusal is about (focus goes there).
 * @param {NetworkWriteFailure} error - The failure.
 * @returns {NetworkField} The field, or null.
 */
function fieldOf(error: NetworkWriteFailure): NetworkField {
  switch (error) {
    case 'nameRequired':
    case 'nameTooLong':
    case 'nameInvalid':
    case 'nameTaken':
      return 'name';
    case 'passphraseRequired':
    case 'passphraseInvalid':
    case 'passphraseNotApplicable':
      return 'passphrase';
    case 'passphraseMismatch':
      return 'confirmation';
    case 'bandsRequired':
    case 'bandLimitReached':
    case 'securityBandConflict':
      return 'bands';
    case 'groupsRequired':
    case 'groupNotFound':
      return 'groups';
    default:
      return null;
  }
} // End of function fieldOf()

/**
 * Shows a refusal in the dialog (its text and main's diagnostic) and, when
 * it means the data on screen may be stale, re-reads the managed list in the
 * background so the detail follows.
 * @param {FlowContext} flow - The flow.
 * @param {NetworkFailureInfo} failure - The refusal.
 */
function showRefusal(flow: FlowContext, failure: NetworkFailureInfo): void {
  flow.dialog.showError(networkFailureText(failure, textContext()), fieldOf(failure.error));
  if (isNetworkStaleDataFailure(failure.error)) {
    void loadManagedNetworks(flow.generation);
  }
}

/**
 * Sends one write over IPC and validates the answer; a call that throws
 * (e.g. a request refused by main's guard) is 'failed'. Only a fixed text
 * and the error's name are logged: never a request (a passphrase may be in
 * it).
 * @param {() => Promise<unknown>} call - The bridge call.
 * @param {string} what - The write, for the log.
 * @returns {Promise<ParsedNetworkAction>} The validated answer.
 */
async function callWrite(call: () => Promise<unknown>, what: string): Promise<ParsedNetworkAction> {
  try {
    return parseNetworkActionResult(await call());
  } catch (error) {
    console.warn(`The Wi-Fi network ${what} failed (${error instanceof Error ? error.name : 'unknown error'})`);
    return { ok: false, error: 'failed', diagnostic: null };
  }
}

/**
 * Runs one write of a flow, failing closed: when Wi-Fi network management is
 * no longer on (it went off, or a capability check started) nothing is sent
 * and the refusal is 'managementUnavailable'; when the data on screen is not
 * known to be fresh, or the flow's network changed on the managed list (a
 * re-read while the dialog was open) or is gone, nothing is sent either
 * (freshnessRefusal()). Otherwise the dialog shows the
 * progress, the write is sent, and its answer is 'gone' when the session
 * changed meanwhile. After a success the dialog's password fields are
 * emptied at once (a refusal keeps them for another try).
 * @param {FlowContext} flow - The flow.
 * @param {keyof Translations} progressKey - The progress text.
 * @param {() => Promise<unknown>} call - The bridge call.
 * @param {string} what - The write, for the log.
 * @returns {Promise<WriteOutcome>} The outcome.
 */
async function guardedWrite(flow: FlowContext, progressKey: keyof Translations, call: () => Promise<unknown>, what: string): Promise<WriteOutcome> {
  if (!isNetworkManagementOn()) {
    return { kind: 'refused', failure: { error: 'managementUnavailable', diagnostic: null } };
  }
  const stale = freshnessRefusal(flow.network);
  if (stale !== null) {
    return { kind: 'refused', failure: stale };
  }
  flow.dialog.showBusy(t(progressKey));
  const parsed = await callWrite(call, what);
  if (isGone(flow)) return { kind: 'gone' };
  if (!parsed.ok) return { kind: 'refused', failure: parsed };
  flow.dialog.clearPassphrase();
  return { kind: 'ok', networkId: parsed.networkId };
} // End of function guardedWrite()

/**
 * Reloads after a successful write: the internal lists (a failed reload is
 * reported and the data marked stale, like after a move), then the
 * management capabilities (kept on screen while asked again) and, through
 * them, the fresh AP-group view and the managed network list (awaited).
 * Stops when the session changes. Also the reload after a "Broadcast on"
 * write (binding-flow.ts).
 * @param {number} generation - The session generation of the flow.
 * @returns {Promise<void>}
 */
export async function reloadAfterWrite(generation: number): Promise<void> {
  try {
    await loadData();
  } catch (error) {
    if (generation !== state.sessionGeneration) return;
    console.warn('Error reloading data after a Wi-Fi network change:', error);
    showToast(t('loadError'), 'error');
  }
  if (generation !== state.sessionGeneration) return;
  await loadManagementCapabilities(generation, true);
} // End of function reloadAfterWrite()

/**
 * Reads again, right before an Enable / Disable / Delete confirmation opens
 * (or the Change password review is shown), everything its impact summary is
 * built from: the internal lists (the AP groups and APs the scope is
 * resolved against; a failed reload leaves them stale), then the managed
 * list (the network's scope and bound groups). The confirmation opens only
 * on that fresh read, with the network as it is now: refused when the
 * reload or the managed read failed (or a newer read is still running), when
 * management went off, or when the network changed on the controller, is
 * gone or no longer offers the write (e.g. no longer WPA-Personal) since it
 * was shown — the re-rendered view then shows it as it is, to be checked
 * before trying again.
 * @param {'password' | 'enable' | 'disable' | 'delete'} kind - The write.
 * @param {ManagedNetwork} shown - The network as the view (or the flow's latest read) showed it.
 * @param {number} generation - The session generation of the flow.
 * @param {string} nonce - The session nonce of the flow.
 * @returns {Promise<FreshRead | null>} The fresh network or the refusal; null when the session changed meanwhile.
 */
async function rereadForConfirmation(kind: 'password' | 'enable' | 'disable' | 'delete', shown: ManagedNetwork, generation: number, nonce: string): Promise<FreshRead | null> {
  /**
   * Tells whether the flow's session is gone (another generation or nonce).
   * @returns {boolean} True when it changed.
   */
  const sessionGone = (): boolean => generation !== state.sessionGeneration || state.sessionNonce !== nonce;
  try {
    await loadData();
  } catch (error) {
    if (sessionGone()) return null;
    console.warn('Error reloading data before a Wi-Fi network confirmation:', error);
  }
  if (sessionGone()) return null;
  // A failed reload is refused below (the data is stale): no managed read then
  if (!state.refreshError) {
    await loadManagedNetworks(generation);
    if (sessionGone()) return null;
  }
  if (!isNetworkManagementOn()) {
    return { ok: false, failure: { error: 'managementUnavailable', diagnostic: null } };
  }
  const refused = freshnessRefusal(shown);
  if (refused !== null) {
    return { ok: false, failure: refused };
  }
  const network = heldNetwork(shown.id);
  if (network === null || !isOffered(kind, network)) {
    return { ok: false, failure: { error: 'networkChanged', diagnostic: null } };
  }
  return { ok: true, network };
} // End of function rereadForConfirmation()

/**
 * The AP groups the create form offers: the loaded groups main can bind
 * (24-hex ids), in list order, each with its AP count.
 * @returns {GroupOption[]} The options.
 */
function groupOptions(): GroupOption[] {
  return state.wlanGroups
    .filter(group => WRITABLE_GROUP_ID_REGEX.test(group.wlanId))
    .map(group => {
      const members = groupMembers(group, state.wlanGroups, state.accessPoints);
      return { id: group.wlanId, name: displayName(group.wlanName), meta: apCountOrUnknown(members === null ? null : members.length) };
    });
}

/**
 * What the dialog shows for one flow.
 * @param {NetworkDialogKind} kind - The write.
 * @param {ManagedNetwork | null} network - The network written (null: create).
 * @returns {NetworkDialogContent} The dialog's content.
 */
function dialogContent(kind: NetworkDialogKind, network: ManagedNetwork | null): NetworkDialogContent {
  const name = displayName(network?.name ?? '');
  if (kind === 'create' || network === null) {
    return {
      kind: 'create',
      title: t('networkCreateTitle'),
      message: t('networkCreateMessage'),
      confirmLabel: t('networkCreateAction'),
      danger: false,
      form: {
        name: { value: '' },
        security: { value: 'wpaPersonal' },
        passphrase: { whenWpaPersonal: true, note: null },
        bands: { value: ['band2g', 'band5g'], note: t('networkCreate6GhzNote') },
        groups: { options: groupOptions() },
        enableAfter: false,
      },
      summary: null,
    };
  }
  if (kind === 'edit') {
    const draft = initialEditDraft(network);
    return {
      kind,
      title: t('networkEditTitle'),
      message: tFormat('networkEditMessage', { name }),
      confirmLabel: t('networkReviewAction'),
      danger: false,
      form: {
        name: { value: draft.name },
        security: { value: draft.security },
        passphrase: { whenWpaPersonal: true, note: t('networkEditPassphraseNote') },
        bands: { value: draft.bands, note: network.bands === null ? t('networkEditBandsUnknown') : null },
      },
      summary: null,
    };
  }
  if (kind === 'password') {
    return {
      kind,
      title: t('networkPasswordTitle'),
      message: tFormat('networkPasswordMessage', { name }),
      confirmLabel: t('networkPasswordAction'),
      danger: false,
      form: { passphrase: { whenWpaPersonal: false, note: null } },
      summary: null,
    };
  }
  const scope = managedNetworkScope(network, state.wlanGroups, state.accessPoints);
  const note = impactNote(scope, textContext());
  const summary = { rows: impactRows(scope, textContext()), notes: note === null ? [] : [note] };
  if (kind === 'enable') {
    return { kind, title: t('networkEnableTitle'), message: tFormat('networkEnableMessage', { name }), confirmLabel: t('networkEnableAction'), danger: false, form: null, summary };
  }
  if (kind === 'disable') {
    return { kind, title: t('networkDisableTitle'), message: tFormat('networkDisableMessage', { name }), confirmLabel: t('networkDisableAction'), danger: true, form: null, summary };
  }
  return { kind, title: t('networkDeleteTitle'), message: tFormat('networkDeleteMessage', { name }), confirmLabel: t('networkDeleteAction'), danger: true, form: null, summary };
} // End of function dialogContent()

/**
 * New network: form → client-side check → create (disabled, bound to the
 * chosen groups) → with "Enable after creating", enable it when main
 * reported its id → reload. A refusal keeps the form for another try.
 * @param {FlowContext} flow - The flow.
 * @returns {Promise<FlowDone | null>} The outcome, or null for a cancel / a session change.
 */
async function runCreate(flow: FlowContext): Promise<FlowDone | null> {
  const ctx = textContext();
  for (;;) {
    const choice = await flow.dialog.next();
    if (choice !== 'confirm' || isGone(flow)) return null;
    const values = flow.dialog.readForm();
    let request: NetworkCreateRequest;
    {
      // The passphrase is read here and only lives in this block and the request
      const typed = flow.dialog.readPassphrase();
      const check = checkCreateDraft(values, typed.passphrase, typed.confirmation);
      if (!check.ok) {
        showRefusal(flow, check);
        continue;
      }
      const { create } = check;
      request = { sessionNonce: flow.nonce, name: create.name, security: create.security, bands: create.bands, apGroupIds: create.apGroupIds };
      if (create.security === 'wpaPersonal') {
        request.passphrase = typed.passphrase;
      }
    }
    const sent = request;
    const outcome = await guardedWrite(flow, 'networkCreating', () => window.omadaAPI.createNetwork(sent), 'create');
    delete request.passphrase;
    if (outcome.kind === 'gone') return null;
    if (outcome.kind === 'refused') {
      showRefusal(flow, outcome.failure);
      continue;
    }

    const name = request.name;
    const createdId = outcome.networkId;
    let toast = tFormat('networkCreated', { name });
    let toastType: FlowDone['toastType'] = 'success';
    if (values.enableAfter && createdId === null) {
      // Never enabled by a name match: the controller did not say which one is new
      toast = tFormat('networkCreatedNoId', { name });
      toastType = 'info';
    } else if (values.enableAfter && createdId !== null) {
      const enabled = await guardedWrite(
        flow,
        'networkEnablingCreated',
        () => window.omadaAPI.setNetworkEnabled({ sessionNonce: flow.nonce, networkId: createdId, enabled: true }),
        'enable'
      );
      if (enabled.kind === 'gone') return null;
      if (enabled.kind === 'ok') {
        toast = tFormat('networkCreatedEnabled', { name });
      } else {
        toast = tFormat('networkCreatedEnableFailed', { name, reason: networkFailureText(enabled.failure, ctx) });
        toastType = 'error';
      }
    }
    flow.dialog.showBusy(t('refreshing'));
    await reloadAfterWrite(flow.generation);
    if (flow.generation !== state.sessionGeneration) return null;
    return { kind: 'create', networkId: findCreatedNetworkId(createdId, name, state.managedNetworks ?? []), toast, toastType };
  } // End of the dialog -> create -> reload loop
} // End of function runCreate()

/**
 * Edit: the staged form → client-side check → the review of the changes
 * (Back returns to the form, Cancel discards) → one basic-config save of
 * the edited fields only (with the re-typed passphrase for a WPA-Personal
 * result) → reload. A refusal at the save brings the form back with the
 * reason.
 * @param {FlowContext} flow - The flow.
 * @param {ManagedNetwork} network - The network edited.
 * @returns {Promise<FlowDone | null>} The outcome, or null for a cancel / a session change.
 */
async function runEdit(flow: FlowContext, network: ManagedNetwork): Promise<FlowDone | null> {
  const ctx = textContext();
  // The checked plan while the review step is shown; null on the form step
  let plan: EditPlan | null = null;
  for (;;) {
    const choice = await flow.dialog.next();
    if (choice === null || isGone(flow)) return null;
    if (plan === null) {
      const typed = flow.dialog.readPassphrase();
      const check = checkEditDraft(network, flow.dialog.readForm(), typed.passphrase, typed.confirmation);
      if (!check.ok) {
        showRefusal(flow, check);
        continue;
      }
      plan = check.plan;
      const summary = { rows: editReviewRows(plan, ctx), notes: editNoteTexts(plan, ctx) };
      flow.dialog.showReview(t('networkReviewTitle'), tFormat('networkReviewMessage', { name: displayName(network.name) }), summary, t('networkSaveAction'));
      continue;
    }
    if (choice === 'back') {
      plan = null;
      flow.dialog.showForm();
      continue;
    }

    const request: NetworkUpdateRequest = { sessionNonce: flow.nonce, networkId: network.id, ...plan.edits };
    if (plan.needsPassphrase) {
      request.passphrase = flow.dialog.readPassphrase().passphrase;
    }
    const outcome = await guardedWrite(flow, 'networkSaving', () => window.omadaAPI.updateNetwork(request), 'save');
    delete request.passphrase;
    if (outcome.kind === 'gone') return null;
    if (outcome.kind === 'refused') {
      plan = null;
      flow.dialog.showForm();
      showRefusal(flow, outcome.failure);
      continue;
    }
    const name = displayName(request.name ?? network.name);
    flow.dialog.showBusy(t('refreshing'));
    await reloadAfterWrite(flow.generation);
    if (flow.generation !== state.sessionGeneration) return null;
    return { kind: 'edit', networkId: network.id, toast: tFormat(DONE_KEYS.edit, { name }), toastType: 'success' };
  } // End of the form -> review -> save loop
} // End of function runEdit()

/**
 * Change password: the new passphrase twice → client-side check → a fresh
 * read (rereadForConfirmation(), like Enable / Disable / Delete) → the
 * review naming the network, its scope and the effect, built from that read
 * (spec §3: a passphrase change is confirmed; Back returns to the fields as
 * typed, Cancel discards; focus on Cancel) → one save of the passphrase →
 * reload. A refused read ends the flow with a toast (the read failed, or the
 * network changed, is gone or is no longer WPA-Personal: the re-rendered
 * view shows it as it is now); a refusal at the save brings the fields back
 * with the reason.
 * @param {FlowContext} flow - The flow.
 * @param {ManagedNetwork} network - The network (WPA-Personal).
 * @returns {Promise<FlowDone | null>} The outcome, or null for a cancel / a refused read / a session change.
 */
async function runPassword(flow: FlowContext, network: ManagedNetwork): Promise<FlowDone | null> {
  const ctx = textContext();
  // The network as the latest fresh read returned it: the review and the
  // write act on it
  let current = network;
  // True while the review step is shown (the checked fields kept behind it)
  let reviewing = false;
  for (;;) {
    const choice = await flow.dialog.next();
    if (choice === null || isGone(flow)) return null;
    if (!reviewing) {
      const typed = flow.dialog.readPassphrase();
      const refused = checkPassphrase(typed.passphrase, typed.confirmation);
      if (refused !== null) {
        showRefusal(flow, { error: refused, diagnostic: null });
        continue;
      }
      // The review states the scope of a fresh read only
      flow.dialog.showBusy(t('bindingReading'));
      const fresh = await rereadForConfirmation('password', current, flow.generation, flow.nonce);
      if (fresh === null) return null;
      if (!fresh.ok) {
        showRefusalToast(fresh.failure);
        return null;
      }
      current = fresh.network;
      flow.network = current;
      reviewing = true;
      const scope = managedNetworkScope(current, state.wlanGroups, state.accessPoints);
      flow.dialog.showReview(
        t('networkPasswordReviewTitle'),
        tFormat('networkPasswordReviewMessage', { name: displayName(current.name) }),
        passwordReviewSummary(scope, ctx),
        t('networkPasswordAction')
      );
      continue;
    }
    if (choice === 'back') {
      reviewing = false;
      flow.dialog.showForm();
      continue;
    }
    const request: NetworkPasswordRequest = { sessionNonce: flow.nonce, networkId: current.id, passphrase: flow.dialog.readPassphrase().passphrase };
    const outcome = await guardedWrite(flow, 'networkChangingPassword', () => window.omadaAPI.changeNetworkPassword(request), 'password change');
    request.passphrase = '';
    if (outcome.kind === 'gone') return null;
    if (outcome.kind === 'refused') {
      reviewing = false;
      flow.dialog.showForm();
      showRefusal(flow, outcome.failure);
      continue;
    }
    flow.dialog.showBusy(t('refreshing'));
    await reloadAfterWrite(flow.generation);
    if (flow.generation !== state.sessionGeneration) return null;
    return { kind: 'password', networkId: current.id, toast: tFormat(DONE_KEYS.password, { name: displayName(current.name) }), toastType: 'success' };
  } // End of the fields -> review -> save -> reload loop
} // End of function runPassword()

/**
 * Enable / Disable / Delete: the confirmation with its impact summary →
 * one write → reload.
 * @param {FlowContext} flow - The flow.
 * @param {ManagedNetwork} network - The network.
 * @param {'enable' | 'disable' | 'delete'} kind - The write.
 * @returns {Promise<FlowDone | null>} The outcome, or null for a cancel / a session change.
 */
async function runConfirmed(flow: FlowContext, network: ManagedNetwork, kind: 'enable' | 'disable' | 'delete'): Promise<FlowDone | null> {
  for (;;) {
    const choice = await flow.dialog.next();
    if (choice !== 'confirm' || isGone(flow)) return null;
    const call =
      kind === 'delete'
        ? () => window.omadaAPI.deleteNetwork({ sessionNonce: flow.nonce, networkId: network.id })
        : () => window.omadaAPI.setNetworkEnabled({ sessionNonce: flow.nonce, networkId: network.id, enabled: kind === 'enable' });
    const outcome = await guardedWrite(flow, CONFIRMED_PROGRESS_KEYS[kind], call, kind);
    if (outcome.kind === 'gone') return null;
    if (outcome.kind === 'refused') {
      showRefusal(flow, outcome.failure);
      continue;
    }
    flow.dialog.showBusy(t('refreshing'));
    await reloadAfterWrite(flow.generation);
    if (flow.generation !== state.sessionGeneration) return null;
    return { kind, networkId: kind === 'delete' ? null : network.id, toast: tFormat(DONE_KEYS[kind], { name: displayName(network.name) }), toastType: 'success' };
  } // End of the confirmation -> write -> reload loop
} // End of function runConfirmed()

/**
 * Tells whether a network offers a write now (networkActions(): e.g. no
 * Edit for an Enterprise network, no Disable for a disabled one).
 * @param {Exclude<NetworkDialogKind, 'create'>} kind - The write.
 * @param {ManagedNetwork} network - The network.
 * @returns {boolean} True when offered.
 */
function isOffered(kind: Exclude<NetworkDialogKind, 'create'>, network: ManagedNetwork): boolean {
  const actions = networkActions(network, isNetworkManagementOn());
  if (actions === null) return false;
  switch (kind) {
    case 'edit':
      return actions.edit;
    case 'password':
      return actions.changePassword;
    case 'enable':
    case 'disable':
      return actions.toggle === kind;
    case 'delete':
      return actions.delete;
    default:
      return false;
  }
} // End of function isOffered()

/**
 * Restores keyboard focus once the dialog closed: after a create, the new
 * network's list item (selected), else "New network"; after a write on a
 * network that stays, the action used in its detail (e.g. the toggle, now
 * the opposite one), else its heading; after a delete, the list (its Tab
 * stop, "New network" or the search). Without a write (Cancel, Escape, a
 * refusal then Cancel): the control that opened the dialog, also when the
 * view was re-rendered meanwhile (found again by its id) — else the
 * network's heading if it was in the detail — else the list.
 * @param {FlowDone | null} done - The successful flow, or null.
 * @param {HTMLElement | null} opener - The element focused when the flow started.
 * @param {boolean} openerInDetail - The opener was in the network's detail.
 */
function restoreFocus(done: FlowDone | null, opener: HTMLElement | null, openerInDetail: boolean): void {
  const kind = done?.kind ?? null;
  const networkId = done?.networkId ?? null;
  if (kind === 'create') {
    if (networkId !== null) {
      selectManagedNetwork(networkId);
      if (focusManagedNetworkItem(networkId)) return;
    }
    if (focusById(NEW_NETWORK_BUTTON_ID)) return;
  } else if (kind !== null && kind !== 'delete') {
    if (focusById(ACTION_BUTTON_IDS[kind]) || focusNetworkDetailHeading()) return;
  } else if (kind === null) {
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
 * Runs one Wi-Fi network write flow (see the header). A no-op while any
 * exclusive operation runs, while Wi-Fi network management is off (also
 * while a capability check runs), and for a network that is gone or does not
 * offer the write. While the data on screen is not known to be fresh (an
 * action rendered before it went stale, or while a re-read runs) nothing
 * opens: a toast says why and the view re-renders with the actions held
 * back. Enable / Disable / Delete first read the data again
 * (rereadForConfirmation()) and open their confirmation with the fresh
 * network and impact only — a refused read ends the flow with a toast
 * (Change password reads again the same way before its review). The
 * dialog (when it opened) always closes, the operation flag is released,
 * the view re-renders and focus returns to the page.
 * @param {NetworkDialogKind} kind - The write.
 * @param {string | null} networkId - The network written (null: create).
 * @returns {Promise<void>}
 */
export async function runNetworkFlow(kind: NetworkDialogKind, networkId: string | null): Promise<void> {
  if (isOperationInProgress() || !isNetworkManagementOn()) return;
  const nonce = state.sessionNonce;
  const shown = networkId === null ? null : heldNetwork(networkId);
  if (nonce === null || (kind !== 'create' && (shown === null || !isOffered(kind, shown)))) return;
  // Fail closed on data known to be stale (or being read again)
  const held = freshnessRefusal(null);
  if (held !== null) {
    showRefusalToast(held);
    renderNetworksView();
    return;
  }

  state.isManagingNetwork = true;
  const generation = state.sessionGeneration;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const openerInDetail = opener !== null && networkDetail.contains(opener);
  let dialog: NetworkDialog | null = null;
  let done: FlowDone | null = null;

  try {
    let network = shown;
    if (shown !== null && (kind === 'enable' || kind === 'disable' || kind === 'delete')) {
      // The confirmation states the impact of a fresh read only
      const fresh = await rereadForConfirmation(kind, shown, generation, nonce);
      if (fresh === null) return;
      if (!fresh.ok) {
        showRefusalToast(fresh.failure);
        return;
      }
      network = fresh.network;
    }
    dialog = openNetworkDialog(dialogContent(kind, network));
    const flow: FlowContext = { kind, generation, nonce, network, dialog };
    if (kind === 'create' || network === null) {
      done = await runCreate(flow);
    } else if (kind === 'edit') {
      done = await runEdit(flow, network);
    } else if (kind === 'password') {
      done = await runPassword(flow, network);
    } else {
      done = await runConfirmed(flow, network, kind);
    }
  } catch (error) {
    console.error('Error managing a Wi-Fi network:', error instanceof Error ? error.message : 'unknown error');
    if (generation === state.sessionGeneration) {
      showToast(t('networkErrorFailed'), 'error');
    }
  } finally {
    dialog?.close();
    state.isManagingNetwork = false;
    if (generation === state.sessionGeneration) {
      // Re-enables the actions for whatever the state is now
      renderNetworksView();
      if (done !== null) {
        showToast(done.toast, done.toastType);
      }
      restoreFocus(done, opener, openerInDetail);
    }
  }
} // End of function runNetworkFlow()

/**
 * Tells whether a data-network-action value names a write.
 * @param {string | undefined} value - The value.
 * @returns {value is NetworkDialogKind} True for a write.
 */
function isNetworkAction(value: string | undefined): value is NetworkDialogKind {
  return value === 'create' || value === 'edit' || value === 'password' || value === 'enable' || value === 'disable' || value === 'delete';
}

/**
 * Delegated click handler of the Wi-Fi networks view's write actions
 * (data-network-action: create, edit, password, enable, disable, delete);
 * all but create act on the selected network. Disabled actions do nothing.
 * @param {MouseEvent} e - The click event.
 */
export function handleNetworkActionClick(e: MouseEvent): void {
  const button = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('[data-network-action]') : null;
  if (button === null || button.disabled) return;
  const action = button.dataset.networkAction;
  if (!isNetworkAction(action)) return;
  void runNetworkFlow(action, action === 'create' ? null : state.selectedManagedNetworkId);
}
