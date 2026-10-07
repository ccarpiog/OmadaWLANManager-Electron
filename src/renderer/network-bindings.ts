// ============================================================================
// Pure logic of the "Broadcast on" editor (todo.md 4.12, phase 19b;
// docs/management-design.md §4.5, §5): which AP groups broadcast a managed
// Wi-Fi network, DOM-free so the unit tests can run it in plain Node:
//   - whether a network's binding can be edited (bindingAvailability()):
//     never while Wi-Fi network management is off; read-only, with the
//     reason, for an "All access points" network (never converted into a
//     group list) and for an unknown scope; editable for a network bound to
//     known AP groups, whatever its security mode (user decision D3);
//   - whether the data on screen is fresh enough for the binding write
//     (bindingWriteBlock(): the 18b freshness gate networkWriteBlock() of
//     network-editing.ts, plus the managed AP-group list, whose capacity the
//     pre-check reads, being read, failed or not read yet);
//   - the editor's options (the managed AP groups main can bind, by name,
//     with their AP counts from the internal data) and its search;
//   - the diff of a change (added / removed / kept groups, the complete new
//     set — never a delta), the before / after reach in groups and APs
//     (managedNetworkScope() over the selected set, so a lower bound reads
//     "at least M APs" exactly like the list), and the client-side capacity
//     pre-check from the managed AP-group capacity (every added group on
//     every band the network uses: reported 0 = full, not reported =
//     unknown — fail closed, never read as room). The renderer DTO carries
//     no MLO state, so there is no client-side MLO rule: main refuses an MLO
//     network's additions itself and its capacityProblems ('mlo') are shown;
//   - the request check mirroring main's binding plan
//     (src/main/network-binding-plan.ts — keep them in sync) that is the
//     only producer of a write request (checkBindingDraft()): nothing for an
//     "All access points" or unknown-scope network, no group, an unknown or
//     malformed group, nothing changed, unknown bands while adding, or an
//     added group without confirmed room;
//   - the boundary validation of main's reply (parseNetworkBindingsResult():
//     a malformed or contradictory reply or capacity list is refused as
//     'failed'), the text
//     of every NetworkBindingsError (plus the renderer's own freshness
//     refusals and 'failed'; the Record type makes the compiler require
//     each code) with main's codes-only diagnostic, and the capacity
//     problems named per group and band;
//   - the rows and notes of the editor's live preview and of the
//     confirmation step.
// The text builders take a TextContext (a translator and the language), so
// the DOM modules pass translate() of i18n.ts and the unit tests either
// table of i18n-strings.ts.
// ============================================================================

import type {
  AccessPoint,
  ManagedApGroup,
  ManagedNetwork,
  NetworkBand,
  NetworkBindingsError,
  NetworkBindingsRequest,
  NetworkCapacityBand,
  NetworkCapacityProblem,
  WlanGroup,
} from '../shared/types';
import { WRITABLE_GROUP_ID_REGEX, type ManagedGroupsStatus } from './group-management';
import { groupMembers } from './inventory-model';
import { normalizeSearch } from './move-plan';
import {
  canonicalBands,
  networkWriteBlock,
  scopeSummaryText,
  type MessageKey,
  type NetworkFreshness,
  type NetworkWriteBlock,
  type SummaryRow,
  type TextContext,
} from './network-editing';
import { managedNetworkScope, summarizeScope, type ManagedScope } from './network-management';
import { parseDiagnostic } from './validation';

// Most capacity problems one reply may carry: 256 groups (the IPC guard's
// cap on a request's ids) × 3 bands + MLO
export const MAX_CAPACITY_PROBLEMS = 1024;

// The bands a capacity problem can name, in main's order ('mlo' last)
const CAPACITY_BANDS: readonly NetworkCapacityBand[] = ['band2g', 'band5g', 'band6g', 'mlo'];

// ============================================================================
// Availability and freshness
// ============================================================================

/** Why a network's binding is shown read-only: "All access points", or an unknown scope. */
export type BindingReadOnlyReason = 'allAccessPoints' | 'unknown';

/** Whether the "Broadcast on" editor is offered for a network, or why it is read-only. */
export type BindingAvailability = { kind: 'editable' } | { kind: 'readOnly'; reason: BindingReadOnlyReason };

/**
 * Decides whether the "Broadcast on" editor is offered (spec §4.5): nothing
 * at all unless Wi-Fi network management is on (networkManagementOn(): also
 * off while a capability check runs, on legacy controllers and with any
 * read-only reason); read-only for an "All access points" network (its
 * binding is never converted into a group list — spec §5) and for an
 * unknown scope (never guessed); editable for a network bound to known AP
 * groups, whatever its security mode (D3: Enterprise / PPSK networks may be
 * bound too).
 * @param {ManagedNetwork} network - The network.
 * @param {boolean} managementOn - networkManagementOn() for the state now.
 * @returns {BindingAvailability | null} The availability, or null when nothing is offered.
 */
export function bindingAvailability(network: ManagedNetwork, managementOn: boolean): BindingAvailability | null {
  if (!managementOn) return null;
  if (network.scope === 'allAccessPoints') return { kind: 'readOnly', reason: 'allAccessPoints' };
  if (network.scope !== 'apGroups' || network.apGroupIds === null) return { kind: 'readOnly', reason: 'unknown' };
  return { kind: 'editable' };
}

/**
 * Why the binding write is held back: one of networkWriteBlock()'s reasons
 * (the internal data stale, the managed network list stale or being read),
 * or the managed AP-group list — its options and capacity — failed
 * ('groupsStale') or is being read / not read yet ('groupsReading').
 */
export type BindingWriteBlock = NetworkWriteBlock | 'groupsStale' | 'groupsReading';

/** What bindingWriteBlock() decides from (the renderer state). */
export interface BindingFreshness extends NetworkFreshness {
  // Where the managed AP-group list's read is (state.managedGroupsStatus)
  groupsStatus: ManagedGroupsStatus;
  // A managed AP-group list is held (state.managedApGroups !== null)
  hasGroups: boolean;
}

/**
 * Decides whether the data on screen is fresh enough for the binding write:
 * the 18b gate first (networkWriteBlock()), then the managed AP-group list
 * the editor's options and capacity pre-check come from — never while its
 * latest read failed ('groupsStale') or before it was read ('groupsReading').
 * @param {BindingFreshness} freshness - The relevant renderer state.
 * @returns {BindingWriteBlock | null} Why the write is held back, or null when it may go ahead.
 */
export function bindingWriteBlock(freshness: BindingFreshness): BindingWriteBlock | null {
  const blocked = networkWriteBlock(freshness);
  if (blocked !== null) return blocked;
  if (freshness.groupsStatus === 'failed') return 'groupsStale';
  if (freshness.groupsStatus !== 'ready' || !freshness.hasGroups) return 'groupsReading';
  return null;
}

// ============================================================================
// Options and search
// ============================================================================

/** One AP group the editor offers: its id, its name and its AP count (null: unknown). */
export interface BindingOption {
  id: string;
  name: string;
  apCount: number | null;
}

/**
 * The AP groups the editor offers: the managed AP groups main can bind
 * (24-hex ids), sorted by name, each with its AP count from the internal
 * data (the APs reporting the group's name; unknown when the internal list
 * does not have the group or another group shares its name).
 * @param {readonly ManagedApGroup[]} managed - The managed AP-group list.
 * @param {readonly WlanGroup[]} groups - The internal groups.
 * @param {readonly AccessPoint[]} accessPoints - The internal APs.
 * @returns {BindingOption[]} The options.
 */
export function bindingOptions(managed: readonly ManagedApGroup[], groups: readonly WlanGroup[], accessPoints: readonly AccessPoint[]): BindingOption[] {
  return managed
    .filter(group => WRITABLE_GROUP_ID_REGEX.test(group.id))
    .map(group => {
      const internal = groups.find(candidate => candidate.wlanId === group.id);
      const members = internal === undefined ? null : groupMembers(internal, groups, accessPoints);
      return { id: group.id, name: group.name, apCount: members === null ? null : members.length };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
} // End of function bindingOptions()

/**
 * Tells whether two option lists offer the same groups (ids and names, in
 * the same order): when the controller's AP groups changed since the editor
 * showed them, the user checks the updated list first.
 * @param {readonly BindingOption[]} a - One list.
 * @param {readonly BindingOption[]} b - The other.
 * @returns {boolean} True when they offer the same groups.
 */
export function sameBindingOptions(a: readonly BindingOption[], b: readonly BindingOption[]): boolean {
  return a.length === b.length && a.every((option, index) => option.id === b[index].id && option.name === b[index].name);
}

/**
 * The ids of the options matching the editor's search (case-insensitive
 * substring of the group name; every option for an empty search).
 * @param {readonly BindingOption[]} options - The options.
 * @param {string} query - The search text as typed.
 * @returns {string[]} The matching ids, in order.
 */
export function filterBindingOptions(options: readonly BindingOption[], query: string): string[] {
  const needle = normalizeSearch(query);
  return options.filter(option => needle === '' || option.name.toLowerCase().includes(needle)).map(option => option.id);
}

/**
 * A lookup of AP-group names by id: the managed list's name, else the
 * internal list's, else null (a group neither list has).
 * @param {readonly ManagedApGroup[]} managed - The managed AP-group list.
 * @param {readonly WlanGroup[]} groups - The internal groups.
 * @returns {(id: string) => string | null} The lookup.
 */
export function groupNameLookup(managed: readonly ManagedApGroup[], groups: readonly WlanGroup[]): (id: string) => string | null {
  const names = new Map<string, string>();
  for (const group of groups) names.set(group.wlanId, group.wlanName);
  for (const group of managed) names.set(group.id, group.name);
  return (id: string): string | null => names.get(id) ?? null;
}

// ============================================================================
// Diff, reach and capacity
// ============================================================================

/** The added / removed / kept groups of a binding change. */
export interface BindingDiff {
  added: string[];
  removed: string[];
  kept: string[];
}

/**
 * The diff of a change, as main computes it (diffBindings() of
 * network-binding-plan.ts): added (selected, not bound — selection order),
 * removed (bound, not selected — current order) and kept (both — selection
 * order). Ids are compared exactly; duplicates count once.
 * @param {readonly string[]} current - The network's bound groups.
 * @param {readonly string[]} selected - The selected groups (the complete new set).
 * @returns {BindingDiff} The diff.
 */
export function diffBindingSets(current: readonly string[], selected: readonly string[]): BindingDiff {
  const bound = new Set(current);
  const wanted = new Set(selected);
  return {
    added: [...wanted].filter(id => !bound.has(id)),
    removed: [...bound].filter(id => !wanted.has(id)),
    kept: [...wanted].filter(id => bound.has(id)),
  };
}

/**
 * Tells whether a diff changes anything.
 * @param {BindingDiff} diff - The diff.
 * @returns {boolean} True when a group is added or removed.
 */
export function isBindingChange(diff: BindingDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0;
}

/** A planned change: the reach before and after (resolved scopes) and the diff. */
export interface BindingChange {
  before: ManagedScope;
  after: ManagedScope;
  diff: BindingDiff;
}

/**
 * Plans a change for its preview: the network's reach now, its reach on the
 * selected groups (the same resolution as the list: a lower bound while some
 * APs' groups or some groups cannot be resolved), and the diff. A network
 * whose binding is not editable keeps its own scope on both sides.
 * @param {ManagedNetwork} network - The network (bound to AP groups).
 * @param {readonly string[]} selected - The selected groups.
 * @param {readonly WlanGroup[]} groups - The internal groups.
 * @param {readonly AccessPoint[]} accessPoints - The internal APs.
 * @returns {BindingChange} The change.
 */
export function planBindingChange(network: ManagedNetwork, selected: readonly string[], groups: readonly WlanGroup[], accessPoints: readonly AccessPoint[]): BindingChange {
  const before = managedNetworkScope(network, groups, accessPoints);
  if (network.scope !== 'apGroups' || network.apGroupIds === null) {
    return { before, after: before, diff: { added: [], removed: [], kept: [] } };
  }
  const set = [...new Set(selected)];
  const after = managedNetworkScope({ ...network, apGroupIds: set }, groups, accessPoints);
  return { before, after, diff: diffBindingSets(network.apGroupIds, set) };
} // End of function planBindingChange()

/**
 * The client-side capacity pre-check (mirror of main's
 * checkBindingCapacity() for the radio bands): for every ADDED group and
 * every band the network uses, the managed list's remaining binding must be
 * reported and above 0 — reported 0 is 'full', not reported (no value, no
 * record, a group the list does not have) is 'unknown': fail closed, never
 * read as room. EVERY failing group + band is listed, in added-group order
 * then band order. No MLO rule: the DTO carries no MLO state (main checks it).
 * @param {readonly string[]} added - The groups the change adds.
 * @param {readonly NetworkBand[]} bands - The bands the network uses.
 * @param {readonly ManagedApGroup[]} managed - The managed AP-group list.
 * @returns {NetworkCapacityProblem[]} The problems (empty: every added group has room).
 */
export function clientCapacityProblems(added: readonly string[], bands: readonly NetworkBand[], managed: readonly ManagedApGroup[]): NetworkCapacityProblem[] {
  const byId = new Map(managed.map(group => [group.id, group]));
  const used = canonicalBands(bands);
  const problems: NetworkCapacityProblem[] = [];
  for (const apGroupId of added) {
    const remaining = byId.get(apGroupId)?.remainingBinding;
    for (const band of used) {
      const value = remaining?.[band];
      if (value === undefined) {
        problems.push({ apGroupId, band, reason: 'unknown' });
      } else if (value <= 0) {
        problems.push({ apGroupId, band, reason: 'full' });
      }
    } // End of the loop over the network's bands
  } // End of the loop over the added groups
  return problems;
} // End of function clientCapacityProblems()

// ============================================================================
// Failures and the request check
// ============================================================================

/**
 * A binding write failure as the renderer knows it: main's code, or one of
 * the renderer's own — a BindingWriteBlock (the data on screen is not
 * fresh), 'networkChanged' (the network changed on the controller, or is
 * gone, since the editor captured it), 'groupsChanged' (the AP groups the
 * editor offers changed since they were shown) or 'failed' (an unreadable
 * reply, a call that threw). Nothing is sent for any of the renderer's own.
 */
export type BindingFailure = NetworkBindingsError | BindingWriteBlock | 'networkChanged' | 'groupsChanged' | 'failed';

/** A failure with what its text needs: main's codes-only diagnostic (or null) and the capacity problems (main's, or the pre-check's). */
export interface BindingFailureInfo {
  error: BindingFailure;
  diagnostic: string | null;
  capacityProblems: NetworkCapacityProblem[];
}

/** A refusal (client-side or main's): nothing is written. */
export interface BindingRefusal extends BindingFailureInfo {
  ok: false;
}

// Every NetworkBindingsError (src/shared/types.ts) and the renderer's own
// failures with their message key; the Record type makes the compiler
// require each one, so a new code fails the build until it has a text
const BINDING_ERROR_KEYS = {
  notConnected: 'bindingErrorNotConnected',
  superseded: 'bindingErrorSuperseded',
  managementUnavailable: 'bindingErrorManagementUnavailable',
  groupsRequired: 'bindingErrorGroupsRequired',
  nothingToChange: 'bindingErrorNothingToChange',
  networkListIncomplete: 'bindingErrorNetworkListIncomplete',
  networkNotFound: 'bindingErrorNetworkNotFound',
  scopeAllAccessPoints: 'bindingErrorScopeAllAccessPoints',
  scopeUnknown: 'bindingErrorScopeUnknown',
  groupNotFound: 'bindingErrorGroupNotFound',
  groupListIncomplete: 'bindingErrorGroupListIncomplete',
  networkStateUnknown: 'bindingErrorNetworkStateUnknown',
  capacityInsufficient: 'bindingErrorCapacityInsufficient',
  requestFailed: 'bindingErrorRequestFailed',
  dataStale: 'networkErrorDataStale',
  listStale: 'networkErrorListStale',
  dataReading: 'networkErrorDataReading',
  groupsStale: 'bindingErrorGroupsStale',
  groupsReading: 'bindingErrorGroupsReading',
  networkChanged: 'networkErrorNetworkChanged',
  groupsChanged: 'bindingErrorGroupsChanged',
  failed: 'bindingErrorFailed',
} as const satisfies Record<BindingFailure, MessageKey>;

// The renderer's own failures (never accepted from main's replies)
const RENDERER_FAILURES: readonly Exclude<BindingFailure, NetworkBindingsError>[] = [
  'dataStale',
  'listStale',
  'dataReading',
  'groupsStale',
  'groupsReading',
  'networkChanged',
  'groupsChanged',
  'failed',
];

/**
 * Builds a refusal.
 * @param {BindingFailure} error - The failure.
 * @param {NetworkCapacityProblem[]} [capacityProblems] - The capacity problems (none by default).
 * @returns {BindingRefusal} The refusal.
 */
function refuse(error: BindingFailure, capacityProblems: NetworkCapacityProblem[] = []): BindingRefusal {
  return { ok: false, error, diagnostic: null, capacityProblems };
}

/** A selection that passed the request-level rules: the complete new set (deduplicated) and its diff. */
export interface CheckedSelection {
  ok: true;
  apGroupIds: string[];
  diff: BindingDiff;
}

/**
 * The request-level rules of a selection (no AP-group data needed), in
 * main's order where it applies: the network's scope ("All access points" =
 * 'scopeAllAccessPoints', anything but known AP groups = 'scopeUnknown' —
 * never a request for those), at least one group ('groupsRequired'), every
 * id 24 hex digits ('groupNotFound'), and a change ('nothingToChange').
 * @param {ManagedNetwork} network - The network as captured.
 * @param {readonly string[]} selected - The selected groups.
 * @returns {CheckedSelection | BindingRefusal} The checked selection, or the refusal.
 */
export function checkBindingSelection(network: ManagedNetwork, selected: readonly string[]): CheckedSelection | BindingRefusal {
  if (network.scope === 'allAccessPoints') return refuse('scopeAllAccessPoints');
  if (network.scope !== 'apGroups' || network.apGroupIds === null) return refuse('scopeUnknown');
  const apGroupIds = [...new Set(selected)];
  if (apGroupIds.length === 0) return refuse('groupsRequired');
  if (!apGroupIds.every(id => WRITABLE_GROUP_ID_REGEX.test(id))) return refuse('groupNotFound');
  const diff = diffBindingSets(network.apGroupIds, apGroupIds);
  if (!isBindingChange(diff)) return refuse('nothingToChange');
  return { ok: true, apGroupIds, diff };
} // End of function checkBindingSelection()

/** A binding write that passed every client-side rule: the request (the complete new set) and its diff. */
export interface CheckedBindingWrite {
  ok: true;
  request: NetworkBindingsRequest;
  diff: BindingDiff;
}

/**
 * Checks a binding write the way main will (planNetworkBindings() of
 * network-binding-plan.ts), and is the only producer of its request: the
 * request-level rules (checkBindingSelection()), every selected group in the
 * managed AP-group list ('groupNotFound'), then — only when groups are added
 * — the network's bands known ('networkStateUnknown') and the capacity of
 * every added group on every band (clientCapacityProblems():
 * 'capacityInsufficient' with EVERY failing group + band). The request
 * carries the session nonce, the network's id and the complete new set.
 * @param {ManagedNetwork} network - The network as captured.
 * @param {readonly string[]} selected - The selected groups.
 * @param {readonly ManagedApGroup[]} managed - The managed AP-group list.
 * @param {string} sessionNonce - The session nonce of the connection on screen.
 * @returns {CheckedBindingWrite | BindingRefusal} The request, or the refusal (nothing to send).
 */
export function checkBindingDraft(network: ManagedNetwork, selected: readonly string[], managed: readonly ManagedApGroup[], sessionNonce: string): CheckedBindingWrite | BindingRefusal {
  const checked = checkBindingSelection(network, selected);
  if (!checked.ok) return checked;
  const listed = new Set(managed.map(group => group.id));
  if (!checked.apGroupIds.every(id => listed.has(id))) return refuse('groupNotFound');
  if (checked.diff.added.length > 0) {
    if (network.bands === null || network.bands.length === 0) return refuse('networkStateUnknown');
    const problems = clientCapacityProblems(checked.diff.added, network.bands, managed);
    if (problems.length > 0) return refuse('capacityInsufficient', problems);
  }
  return { ok: true, request: { sessionNonce, networkId: network.id, apGroupIds: checked.apGroupIds }, diff: checked.diff };
} // End of function checkBindingDraft()

// ============================================================================
// Reply validation
// ============================================================================

/** A binding reply after validation: success, or main's refusal. */
export type ParsedBindingsResult = { ok: true } | BindingRefusal;

/**
 * Tells whether a value is a plain (non-array) object.
 * @param {unknown} value - The candidate.
 * @returns {value is Record<string, unknown>} True for an object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Tells whether a value is a known NetworkBindingsError (main's codes; not
 * one of the renderer's own failures).
 * @param {unknown} value - The candidate.
 * @returns {value is NetworkBindingsError} True for a known code.
 */
export function isNetworkBindingsError(value: unknown): value is NetworkBindingsError {
  return (
    typeof value === 'string' &&
    !(RENDERER_FAILURES as readonly string[]).includes(value) &&
    Object.prototype.hasOwnProperty.call(BINDING_ERROR_KEYS, value)
  );
}

/**
 * Validates one capacity problem of a reply: exactly the keys `apGroupId`
 * (24 hex digits), `band` (2.4 / 5 / 6 GHz or 'mlo') and `reason` ('full'
 * or 'unknown').
 * @param {unknown} raw - The candidate.
 * @returns {NetworkCapacityProblem | null} The problem, or null when malformed.
 */
function parseCapacityProblem(raw: unknown): NetworkCapacityProblem | null {
  if (!isRecord(raw) || Object.keys(raw).length !== 3) return null;
  const { apGroupId, band, reason } = raw;
  if (typeof apGroupId !== 'string' || !WRITABLE_GROUP_ID_REGEX.test(apGroupId)) return null;
  if (typeof band !== 'string' || !(CAPACITY_BANDS as readonly string[]).includes(band)) return null;
  if (reason !== 'full' && reason !== 'unknown') return null;
  return { apGroupId, band: band as NetworkCapacityBand, reason };
}

/** The only keys a binding reply may carry (main's NetworkBindingsResult). */
const BINDINGS_RESULT_KEYS: readonly string[] = ['success', 'error', 'diagnostic', 'capacityProblems'];

/**
 * Validates an updateNetworkBindings() reply as a discriminated schema, so a
 * contradictory reply is never read as a success or as a partial refusal:
 * - any key outside BINDINGS_RESULT_KEYS refuses the reply;
 * - `success: true` must carry nothing else (no error, diagnostic or
 *   capacity problems) — main's success is exactly `{success: true}`;
 * - `success: false` must name one of main's known codes; it keeps the
 *   codes-only diagnostic when well-formed (a malformed one is dropped);
 * - 'capacityInsufficient' must carry a non-empty array of at most
 *   MAX_CAPACITY_PROBLEMS well-formed problems, and every other code none.
 * Anything else is refused as 'failed' (an unreadable reply).
 * @param {unknown} raw - The reply received over IPC.
 * @returns {ParsedBindingsResult} The validated reply.
 */
export function parseNetworkBindingsResult(raw: unknown): ParsedBindingsResult {
  const unreadable = refuse('failed');
  if (!isRecord(raw)) return unreadable;
  if (Object.keys(raw).some(key => !BINDINGS_RESULT_KEYS.includes(key))) return unreadable;
  if (raw.success === true) {
    const contradictory = raw.error !== undefined || raw.diagnostic !== undefined || raw.capacityProblems !== undefined;
    return contradictory ? unreadable : { ok: true };
  }
  if (raw.success !== false || !isNetworkBindingsError(raw.error)) return unreadable;
  const error: NetworkBindingsError = raw.error;
  if (error !== 'capacityInsufficient') {
    if (raw.capacityProblems !== undefined) return unreadable;
    return { ok: false, error, diagnostic: parseDiagnostic(raw.diagnostic), capacityProblems: [] };
  }
  const list = raw.capacityProblems;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CAPACITY_PROBLEMS) return unreadable;
  const parsed = list.map(parseCapacityProblem);
  if (parsed.some(problem => problem === null)) return unreadable;
  return { ok: false, error, diagnostic: parseDiagnostic(raw.diagnostic), capacityProblems: parsed as NetworkCapacityProblem[] };
} // End of function parseNetworkBindingsResult()

/**
 * Tells whether a refusal means the data on screen may be stale (fresh
 * controller data contradicted it): the managed network list and the
 * managed AP-group list are then read again, so the detail follows.
 * @param {BindingFailure} error - The failure.
 * @returns {boolean} True when the managed lists should be read again.
 */
export function isBindingStaleDataFailure(error: BindingFailure): boolean {
  return (
    error === 'nothingToChange' ||
    error === 'networkNotFound' ||
    error === 'scopeAllAccessPoints' ||
    error === 'scopeUnknown' ||
    error === 'groupNotFound' ||
    error === 'networkStateUnknown' ||
    error === 'capacityInsufficient' ||
    error === 'requestFailed'
  );
} // End of function isBindingStaleDataFailure()

// ============================================================================
// Texts
// ============================================================================

/**
 * The message key of a binding write failure.
 * @param {BindingFailure} error - The failure.
 * @returns {MessageKey} Its key.
 */
export function bindingErrorKey(error: BindingFailure): MessageKey {
  return BINDING_ERROR_KEYS[error];
}

/**
 * The text of a binding write failure: its message, followed by main's
 * codes-only diagnostic in parentheses when there is one (the capacity
 * problems are listed apart: capacityProblemLines()).
 * @param {BindingFailureInfo} failure - The failure.
 * @param {TextContext} ctx - The translator.
 * @returns {string} The localized text.
 */
export function bindingFailureText(failure: BindingFailureInfo, ctx: TextContext): string {
  const text = ctx.tr(bindingErrorKey(failure.error));
  return failure.diagnostic === null ? text : `${text} (${failure.diagnostic})`;
}

/**
 * A capacity band as text ("2.4 GHz", …, "MLO").
 * @param {NetworkCapacityBand} band - The band.
 * @param {TextContext} ctx - The translator.
 * @returns {string} The localized band.
 */
function capacityBandText(band: NetworkCapacityBand, ctx: TextContext): string {
  return band === 'mlo' ? ctx.tr('bindingBandMlo') : ctx.tr(band);
}

/**
 * A group's name for display: its name ("(no name)" for an empty one), or
 * — for a group no list has — its id.
 * @param {string} id - The group's id.
 * @param {(id: string) => string | null} nameOf - The name lookup.
 * @param {TextContext} ctx - The translator.
 * @returns {string} The display name.
 */
function groupDisplayName(id: string, nameOf: (id: string) => string | null, ctx: TextContext): string {
  const name = nameOf(id);
  if (name === null) return id;
  return name === '' ? ctx.tr('unnamed') : name;
}

/**
 * The capacity problems named per group and band, one line per group in
 * the problems' order: "zNinguna — 5 GHz: full, 6 GHz: not reported".
 * @param {readonly NetworkCapacityProblem[]} problems - The problems (main's or the pre-check's).
 * @param {(id: string) => string | null} nameOf - The group name lookup.
 * @param {TextContext} ctx - The translator.
 * @returns {string[]} The lines (empty when there is no problem).
 */
export function capacityProblemLines(problems: readonly NetworkCapacityProblem[], nameOf: (id: string) => string | null, ctx: TextContext): string[] {
  const byGroup = new Map<string, string[]>();
  for (const problem of problems) {
    const key = problem.reason === 'full' ? 'bindingCapacityFull' : 'bindingCapacityUnknown';
    const entries = byGroup.get(problem.apGroupId) ?? [];
    entries.push(ctx.tr(key, { band: capacityBandText(problem.band, ctx) }));
    byGroup.set(problem.apGroupId, entries);
  } // End of the loop that groups the problems per AP group
  return [...byGroup].map(([id, bands]) => ctx.tr('bindingCapacityGroup', { group: groupDisplayName(id, nameOf, ctx), bands: bands.join(', ') }));
} // End of function capacityProblemLines()

/**
 * The note under capacity problems that name MLO: the network uses MLO and
 * the controller reports no MLO room, so no group can be added to it yet
 * (removing still works); null when no problem is about MLO.
 * @param {readonly NetworkCapacityProblem[]} problems - The problems.
 * @param {TextContext} ctx - The translator.
 * @returns {string | null} The note, or null.
 */
export function mloProblemNote(problems: readonly NetworkCapacityProblem[], ctx: TextContext): string | null {
  return problems.some(problem => problem.band === 'mlo') ? ctx.tr('bindingMloNote') : null;
}

/**
 * Groups as text: their names (in the given order) and how many no list
 * has, or "None" for no group.
 * @param {readonly string[]} ids - The groups.
 * @param {(id: string) => string | null} nameOf - The group name lookup.
 * @param {TextContext} ctx - The translator.
 * @returns {string} The localized list.
 */
export function groupListText(ids: readonly string[], nameOf: (id: string) => string | null, ctx: TextContext): string {
  if (ids.length === 0) return ctx.tr('bindingRowNone');
  const names: string[] = [];
  let unresolved = 0;
  for (const id of ids) {
    const name = nameOf(id);
    if (name === null) {
      unresolved++;
    } else {
      names.push(name === '' ? ctx.tr('unnamed') : name);
    }
  } // End of the loop over the groups
  if (unresolved > 0) {
    names.push(unresolved === 1 ? ctx.tr('networkImpactUnresolvedOne') : ctx.tr('networkImpactUnresolvedMany', { count: String(unresolved) }));
  }
  return names.join(', ');
} // End of function groupListText()

/**
 * The rows of a change (the editor's live preview and the confirmation):
 * the reach now and after ("N groups · M APs" — "at least M APs" while a
 * lower bound), then the added, removed and kept groups by name.
 * @param {BindingChange} change - The planned change.
 * @param {(id: string) => string | null} nameOf - The group name lookup.
 * @param {TextContext} ctx - The translator.
 * @returns {SummaryRow[]} The rows, in order.
 */
export function bindingChangeRows(change: BindingChange, nameOf: (id: string) => string | null, ctx: TextContext): SummaryRow[] {
  return [
    { kind: 'before', label: ctx.tr('bindingRowBefore'), value: scopeSummaryText(summarizeScope(change.before), ctx.tr) },
    { kind: 'after', label: ctx.tr('bindingRowAfter'), value: scopeSummaryText(summarizeScope(change.after), ctx.tr) },
    { kind: 'added', label: ctx.tr('bindingRowAdded'), value: groupListText(change.diff.added, nameOf, ctx) },
    { kind: 'removed', label: ctx.tr('bindingRowRemoved'), value: groupListText(change.diff.removed, nameOf, ctx) },
    { kind: 'kept', label: ctx.tr('bindingRowKept'), value: groupListText(change.diff.kept, nameOf, ctx) },
  ];
} // End of function bindingChangeRows()

/**
 * The notes of the confirmation: removed groups stop broadcasting the
 * network (their clients are disconnected), and per-AP overrides cannot be
 * shown (the internal API does not report them).
 * @param {BindingChange} change - The planned change.
 * @param {TextContext} ctx - The translator.
 * @returns {string[]} The notes.
 */
export function bindingChangeNotes(change: BindingChange, ctx: TextContext): string[] {
  const notes: string[] = [];
  if (change.diff.removed.length > 0) notes.push(ctx.tr('bindingNoteRemoved'));
  notes.push(ctx.tr('overridesUnavailable'));
  return notes;
}

/**
 * The selection line of the editor: how many groups are selected and, while
 * a search hides some of them, how many are hidden.
 * @param {number} selectedCount - Selected groups.
 * @param {number} hiddenCount - Selected groups the search hides.
 * @param {TextContext} ctx - The translator.
 * @returns {string} The localized line.
 */
export function bindingSelectionText(selectedCount: number, hiddenCount: number, ctx: TextContext): string {
  let text = ctx.tr('bindingSelectionNone');
  if (selectedCount === 1) {
    text = ctx.tr('bindingSelectionOne');
  } else if (selectedCount > 1) {
    text = ctx.tr('bindingSelectionMany', { count: String(selectedCount) });
  }
  if (hiddenCount === 0) return text;
  const hidden = hiddenCount === 1 ? ctx.tr('bindingHiddenOne') : ctx.tr('bindingHiddenMany', { count: String(hiddenCount) });
  return `${text} · ${hidden}`;
} // End of function bindingSelectionText()

/** What the editor shows below its list for the selection now. */
export interface BindingPreview {
  // The selection line ("2 groups selected · 1 hidden by the search")
  selection: string;
  // A group is added or removed (the review button is disabled otherwise)
  changed: boolean;
  // The reach now / after and the added / removed / kept groups
  rows: SummaryRow[];
  // The pre-check's capacity problems, one line per group (empty: none)
  capacity: string[];
  // Notes: nothing changed yet; the bands unknown while adding
  notes: string[];
}

/** What bindingPreview() is built from. */
export interface BindingPreviewInput {
  network: ManagedNetwork;
  selected: readonly string[];
  // The ids the search shows now
  visible: readonly string[];
  managed: readonly ManagedApGroup[];
  groups: readonly WlanGroup[];
  accessPoints: readonly AccessPoint[];
}

/**
 * The editor's live preview for the selection now: the selection line, the
 * change's rows (planBindingChange()), the capacity pre-check's problems
 * named per group and band, and a note when nothing changed yet or when the
 * network's bands are unknown while groups would be added.
 * @param {BindingPreviewInput} input - The network, the selection and the data on screen.
 * @param {TextContext} ctx - The translator.
 * @returns {BindingPreview} The preview.
 */
export function bindingPreview(input: BindingPreviewInput, ctx: TextContext): BindingPreview {
  const { network, managed, groups, accessPoints } = input;
  const selected = [...new Set(input.selected)];
  const visible = new Set(input.visible);
  const change = planBindingChange(network, selected, groups, accessPoints);
  const nameOf = groupNameLookup(managed, groups);
  const changed = isBindingChange(change.diff);
  const notes: string[] = [];
  let capacity: string[] = [];
  if (!changed) {
    notes.push(ctx.tr('bindingUnchanged'));
  } else if (change.diff.added.length > 0) {
    if (network.bands === null || network.bands.length === 0) {
      notes.push(ctx.tr('bindingBandsUnknownNote'));
    } else {
      capacity = capacityProblemLines(clientCapacityProblems(change.diff.added, network.bands, managed), nameOf, ctx);
    }
  }
  return {
    selection: bindingSelectionText(selected.length, selected.filter(id => !visible.has(id)).length, ctx),
    changed,
    rows: bindingChangeRows(change, nameOf, ctx),
    capacity,
    notes,
  };
} // End of function bindingPreview()
