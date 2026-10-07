// ============================================================================
// Pure logic of the Wi-Fi network editing UI (todo.md 4.11, phase 18b;
// docs/management-design.md §3, §4.5, §5), DOM-free so the unit tests can run
// it in plain Node:
//   - which write actions a managed network offers (networkActions()): none
//     unless Wi-Fi network management is on; Edit for Open and WPA-Personal
//     networks, Change password for WPA-Personal ones, Enable or Disable while
//     the enabled state is known (spec §5: hidden otherwise), Delete for every
//     security mode, and why an Enterprise / PPSK / unknown network is not
//     editable;
//   - whether the data on screen is fresh enough for any write
//     (networkWriteBlock(): never while the internal data is stale after a
//     failed refresh, nor while the managed list is stale after a failed
//     read or is being read), and whether the network a flow acts on is
//     still the one the managed list holds (sameManagedNetwork());
//   - the renderer mirror of main's write rules (src/main/wifi-network-write.ts
//     — keep them in sync) for immediate feedback: the SSID name (trimmed, 1
//     to 32 bytes of UTF-8, no control / bidirectional-control characters),
//     the passphrase (8 to 63 printable ASCII characters, never trimmed,
//     typed twice), the create form (bands, AP groups, no open network with
//     6 GHz) and the staged edit (its changes against the network, "nothing
//     to change", the passphrase every save whose result is WPA-Personal
//     needs, the review's rows and notes — the PMF note included); main stays
//     authoritative and its answer is what is shown;
//   - the boundary validation of the write replies, the text of every
//     NetworkOperationError (plus the renderer's own 'passphraseMismatch',
//     freshness refusals and 'failed') with main's codes-only diagnostic as
//     secondary text, and the
//     field a 'securityBandConflict' names ("conflict: <field>");
//   - the impact summary of a confirmation (the scope, the bound AP groups by
//     name) and the scope text both the list and the dialogs show.
// The text builders take a TextContext (a translator and the language), so
// the DOM modules pass translate() of i18n.ts (the active language) and the
// unit tests either table of i18n-strings.ts. A passphrase is never part of
// any value this module returns.
// ============================================================================

import type { Language, ManagedNetwork, NetworkBand, NetworkOperationError, NetworkSecurity, WritableNetworkSecurity } from '../shared/types';
import { FORBIDDEN_NAME_CHARACTERS, WRITABLE_GROUP_ID_REGEX } from './group-management';
import type { Translations } from './i18n-strings';
import { NETWORK_ID_REGEX, securityKey, summarizeScope, type ManagedNetworksStatus, type ManagedScope, type ScopeSummary } from './network-management';
import { parseDiagnostic } from './validation';

// SSID names: at most 32 bytes of UTF-8 (MAX_SSID_NAME_BYTES in
// src/main/wifi-network-write.ts)
export const MAX_SSID_NAME_BYTES = 32;

// WPA-Personal passphrases: 8 to 63 printable ASCII characters
// (MIN_PASSPHRASE_LENGTH / MAX_PASSPHRASE_LENGTH there)
export const MIN_PASSPHRASE_LENGTH = 8;
export const MAX_PASSPHRASE_LENGTH = 63;
const PASSPHRASE_REGEX = /^[\x20-\x7e]+$/;

// The bands in display (and canonical) order
const BANDS: readonly NetworkBand[] = ['band2g', 'band5g', 'band6g'];

/** A key of the i18n table. */
export type MessageKey = keyof Translations;

/** A translator: a message in some language, with its placeholders substituted. */
export type Translate = (key: MessageKey, vars?: Record<string, string>) => string;

/** What the text builders need: the translator and its language (for list formatting). */
export interface TextContext {
  tr: Translate;
  language: Language;
}

// ============================================================================
// Actions
// ============================================================================

/** Why a network offers no Edit / Change password: its security mode. */
export type NotEditableReason = 'enterprise' | 'ppsk' | 'unknown';

/**
 * The write actions of a managed network's detail: Edit, Change password,
 * Enable or Disable ('enable' for a disabled network, 'disable' for an
 * enabled one, null while its state is unknown), Delete, and why it cannot
 * be edited (null when it can).
 */
export interface NetworkActions {
  edit: boolean;
  changePassword: boolean;
  toggle: 'enable' | 'disable' | null;
  delete: boolean;
  notEditable: NotEditableReason | null;
}

/**
 * Tells whether the app can edit a security mode: Open and WPA-Personal only
 * (main refuses every other mode with 'unsupportedSecurity').
 * @param {NetworkSecurity} security - The DTO value.
 * @returns {security is WritableNetworkSecurity} True for 'open' and 'wpaPersonal'.
 */
export function isEditableSecurity(security: NetworkSecurity): security is WritableNetworkSecurity {
  return security === 'open' || security === 'wpaPersonal';
}

/**
 * Decides the write actions of a managed network (spec §4.5): none at all
 * unless Wi-Fi network management is on (networkManagementOn(): also off
 * while a capability check runs, on legacy controllers and with any
 * read-only reason); otherwise Edit for an Open or WPA-Personal network,
 * Change password for a WPA-Personal one, Enable / Disable while the enabled
 * state is known (spec §5: the toggle is hidden for an unknown state), and
 * Delete for every security mode. An Enterprise, PPSK or unknown network has
 * no Edit / Change password, and the reason is stated.
 * @param {ManagedNetwork} network - The network.
 * @param {boolean} managementOn - networkManagementOn() for the state now.
 * @returns {NetworkActions | null} The actions, or null when none is offered.
 */
export function networkActions(network: ManagedNetwork, managementOn: boolean): NetworkActions | null {
  if (!managementOn) return null;
  const editable = isEditableSecurity(network.security);
  let notEditable: NotEditableReason | null = null;
  if (!editable) {
    if (network.security === 'wpaEnterprise') {
      notEditable = 'enterprise';
    } else if (network.security === 'unknown') {
      notEditable = 'unknown';
    } else {
      notEditable = 'ppsk';
    }
  }
  let toggle: NetworkActions['toggle'] = null;
  if (network.enabled !== null) {
    toggle = network.enabled ? 'disable' : 'enable';
  }
  return { edit: editable, changePassword: network.security === 'wpaPersonal', toggle, delete: true, notEditable };
} // End of function networkActions()

/**
 * The explanation of a network the app does not edit: its security mode
 * named (Enterprise, PPSK) or stated as unclear (unknown).
 * @param {ManagedNetwork} network - The network (not editable).
 * @param {TextContext} ctx - The translator.
 * @returns {string} The explanation.
 */
export function notEditableText(network: ManagedNetwork, ctx: TextContext): string {
  const security = securityKey(network.security);
  return security === null ? ctx.tr('networkNotEditableUnknown') : ctx.tr('networkNotEditable', { security: ctx.tr(security) });
}

// ============================================================================
// Freshness of the data a write acts on
// ============================================================================

/**
 * Why every network write is held back now (the actions render disabled
 * with this reason, and a flow refuses with it): 'dataStale' — the internal
 * data on screen (the AP groups and APs an impact summary is resolved
 * against) is stale after a failed refresh; 'listStale' — the managed list's
 * latest read failed (a stale list kept on screen, or none at all);
 * 'dataReading' — the managed list is being read (again).
 */
export type NetworkWriteBlock = 'dataStale' | 'listStale' | 'dataReading';

/** What networkWriteBlock() decides from (the renderer state). */
export interface NetworkFreshness {
  // A refresh, or the reload after a write or a move, failed (state.refreshError)
  refreshError: boolean;
  // Where the managed list's latest read is (state.managedNetworksStatus)
  listStatus: ManagedNetworksStatus;
  // A managed list is held (state.managedNetworks !== null)
  hasList: boolean;
}

/**
 * Decides whether the data on screen is fresh enough for a network write:
 * never while the internal data is stale ('dataStale'), while the managed
 * list's latest read failed ('listStale': a stale list, or the error state
 * of a failed first read) or while it is being read or not read yet
 * ('dataReading'). A write must never act on — nor a confirmation state the
 * impact of — a snapshot known to be stale.
 * @param {NetworkFreshness} freshness - The relevant renderer state.
 * @returns {NetworkWriteBlock | null} Why writes are held back, or null when they may go ahead.
 */
export function networkWriteBlock(freshness: NetworkFreshness): NetworkWriteBlock | null {
  if (freshness.refreshError) return 'dataStale';
  if (freshness.listStatus === 'failed') return 'listStale';
  if (freshness.listStatus !== 'ready' || !freshness.hasList) return 'dataReading';
  return null;
}

/**
 * Tells whether two optional value lists hold the same values (both
 * unknown, or the same set whatever the order).
 * @param {readonly string[] | null} a - One list, or null for unknown.
 * @param {readonly string[] | null} b - The other.
 * @returns {boolean} True when they are the same.
 */
function sameValueSet(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  const left = new Set(a);
  return left.size === new Set(b).size && b.every(value => left.has(value));
}

/**
 * Tells whether a network on the managed list is still the one a flow
 * captured: every field of the DTO the same (the bands and the bound groups
 * as sets). A network that changed on the controller since it was shown is
 * never written from the old snapshot, and a confirmation never states its
 * old impact: the user checks it again first.
 * @param {ManagedNetwork} a - The network as captured.
 * @param {ManagedNetwork} b - The network on the managed list now.
 * @returns {boolean} True when nothing changed.
 */
export function sameManagedNetwork(a: ManagedNetwork, b: ManagedNetwork): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.security === b.security &&
    a.enabled === b.enabled &&
    a.hasPassphrase === b.hasPassphrase &&
    a.scope === b.scope &&
    sameValueSet(a.bands, b.bands) &&
    sameValueSet(a.apGroupIds, b.apGroupIds)
  );
} // End of function sameManagedNetwork()

// ============================================================================
// Name and passphrase rules (mirror of src/main/wifi-network-write.ts)
// ============================================================================

/** Why a typed network name is refused (main's codes for the same cases). */
export type NetworkNameError = Extract<NetworkOperationError, 'nameRequired' | 'nameTooLong' | 'nameInvalid'>;

/** The outcome of checkNetworkName(): the trimmed name, or why it is refused. */
export type NetworkNameCheck = { ok: true; name: string } | { ok: false; error: NetworkNameError };

/** Why a typed passphrase is refused: main's codes, plus a confirmation that differs. */
export type PassphraseError = 'passphraseRequired' | 'passphraseInvalid' | 'passphraseMismatch';

/**
 * Counts the bytes of a text encoded as UTF-8, code point by code point
 * (utf8ByteLength() in src/main/wifi-network-write.ts: an unpaired surrogate
 * counts as the 3 bytes of its replacement; the name rule refuses those
 * anyway).
 * @param {string} text - The text.
 * @returns {number} Its UTF-8 length in bytes.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x80) {
      bytes += 1;
    } else if (codePoint < 0x800) {
      bytes += 2;
    } else if (codePoint < 0x10000) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  } // End of the loop over the text's code points
  return bytes;
} // End of function utf8ByteLength()

/**
 * Checks a typed network name the way main will (validateSsidName()): trims
 * it, then refuses a blank name, more than 32 bytes of UTF-8, or a control /
 * bidirectional-control character.
 * @param {string} raw - The name as typed.
 * @returns {NetworkNameCheck} The trimmed name, or the refusal.
 */
export function checkNetworkName(raw: string): NetworkNameCheck {
  const name = raw.trim();
  if (name === '') {
    return { ok: false, error: 'nameRequired' };
  }
  if (utf8ByteLength(name) > MAX_SSID_NAME_BYTES) {
    return { ok: false, error: 'nameTooLong' };
  }
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) {
    return { ok: false, error: 'nameInvalid' };
  }
  return { ok: true, name };
} // End of function checkNetworkName()

/**
 * Checks a typed passphrase and its confirmation: not typed (empty) is
 * 'passphraseRequired'; 8 to 63 printable ASCII characters (U+0020–U+007E),
 * taken as typed — never trimmed — else 'passphraseInvalid' (main's
 * validatePassphrase()); then the confirmation must be identical
 * ('passphraseMismatch', the renderer's own check).
 * @param {string} passphrase - The passphrase field.
 * @param {string} confirmation - The confirmation field.
 * @returns {PassphraseError | null} The refusal, or null when accepted.
 */
export function checkPassphrase(passphrase: string, confirmation: string): PassphraseError | null {
  if (passphrase === '') {
    return 'passphraseRequired';
  }
  if (passphrase.length < MIN_PASSPHRASE_LENGTH || passphrase.length > MAX_PASSPHRASE_LENGTH || !PASSPHRASE_REGEX.test(passphrase)) {
    return 'passphraseInvalid';
  }
  return confirmation === passphrase ? null : 'passphraseMismatch';
} // End of function checkPassphrase()

/**
 * A band list in canonical order (2.4 / 5 / 6 GHz), duplicates and unknown
 * values dropped.
 * @param {readonly NetworkBand[]} bands - The bands.
 * @returns {NetworkBand[]} The canonical list.
 */
export function canonicalBands(bands: readonly NetworkBand[]): NetworkBand[] {
  return BANDS.filter(band => bands.includes(band));
}

/**
 * Tells whether two band lists hold the same bands.
 * @param {readonly NetworkBand[]} a - One list.
 * @param {readonly NetworkBand[]} b - The other.
 * @returns {boolean} True for the same set.
 */
function sameBands(a: readonly NetworkBand[], b: readonly NetworkBand[]): boolean {
  const left = canonicalBands(a);
  const right = canonicalBands(b);
  return left.length === right.length && left.every((band, index) => band === right[index]);
}

// ============================================================================
// Failures
// ============================================================================

/**
 * A network write failure as the renderer knows it: main's code, or one of
 * the renderer's own — 'passphraseMismatch' (the confirmation differs), a
 * NetworkWriteBlock (the data on screen is not fresh: nothing is sent),
 * 'networkChanged' (the network changed on the controller, or is gone,
 * since the flow captured it: nothing is sent) or 'failed' (an unreadable
 * reply, a call that threw).
 */
export type NetworkWriteFailure = NetworkOperationError | 'passphraseMismatch' | NetworkWriteBlock | 'networkChanged' | 'failed';

// The renderer's own failures (never accepted from main's replies)
const RENDERER_FAILURES: readonly Exclude<NetworkWriteFailure, NetworkOperationError>[] = [
  'passphraseMismatch',
  'dataStale',
  'listStale',
  'dataReading',
  'networkChanged',
  'failed',
];

/**
 * A failure with what its text needs: main's codes-only diagnostic (null for
 * none, and for a client-side refusal) and — for a 'securityBandConflict'
 * found client-side — the conflicting field (main names it in its diagnostic
 * "conflict: <field>").
 */
export interface NetworkFailureInfo {
  error: NetworkWriteFailure;
  diagnostic: string | null;
  conflictField?: string;
}

/** A refusal of a form check (create, edit, Change password): nothing is sent. */
export interface FormRefusal extends NetworkFailureInfo {
  ok: false;
}

/** A write reply after validation: success (with a created network's id, when usable) or a failure. */
export type ParsedNetworkAction = { ok: true; networkId: string | null } | FormRefusal;

// Every NetworkOperationError (src/shared/types.ts) and the renderer's own
// failures with their message key; the Record type makes the compiler
// require each one
const ERROR_KEYS = {
  notConnected: 'networkErrorNotConnected',
  superseded: 'networkErrorSuperseded',
  managementUnavailable: 'networkErrorManagementUnavailable',
  nameRequired: 'networkErrorNameRequired',
  nameTooLong: 'networkErrorNameTooLong',
  nameInvalid: 'networkErrorNameInvalid',
  nameTaken: 'networkErrorNameTaken',
  passphraseRequired: 'networkErrorPassphraseRequired',
  passphraseInvalid: 'networkErrorPassphraseInvalid',
  passphraseNotApplicable: 'networkErrorPassphraseNotApplicable',
  bandsRequired: 'networkErrorBandsRequired',
  groupsRequired: 'networkErrorGroupsRequired',
  unsupportedSecurity: 'networkErrorUnsupportedSecurity',
  nothingToChange: 'networkErrorNothingToChange',
  bandLimitReached: 'networkErrorBandLimitReached',
  securityBandConflict: 'networkErrorSecurityBandConflict',
  groupNotFound: 'networkErrorGroupNotFound',
  groupListIncomplete: 'networkErrorGroupListIncomplete',
  networkStateUnknown: 'networkErrorNetworkStateUnknown',
  requestFailed: 'networkErrorRequestFailed',
  passphraseMismatch: 'networkErrorPassphraseMismatch',
  dataStale: 'networkErrorDataStale',
  listStale: 'networkErrorListStale',
  dataReading: 'networkErrorDataReading',
  networkChanged: 'networkErrorNetworkChanged',
  failed: 'networkErrorFailed',
} as const satisfies Record<NetworkWriteFailure, MessageKey>;

// The settings a 'securityBandConflict' can name (main's diagnostic
// "conflict: <field>") with the message naming each; another field gets the
// generic message (the diagnostic still names it)
const CONFLICT_KEYS: Readonly<Record<string, MessageKey>> = {
  enhancedIotConnectivity: 'networkConflictIot',
  oweEnable: 'networkConflictOwe',
};

// main's diagnostic of a 'securityBandConflict' refusal
const CONFLICT_DIAGNOSTIC_REGEX = /^conflict: ([A-Za-z0-9_]+)$/;

/**
 * The message key of a network write failure.
 * @param {NetworkWriteFailure} error - The failure.
 * @returns {MessageKey} Its key.
 */
export function networkErrorKey(error: NetworkWriteFailure): MessageKey {
  return ERROR_KEYS[error];
}

/**
 * Tells whether a value is a known NetworkOperationError (main's codes; not
 * one of the renderer's own failures).
 * @param {unknown} value - The candidate.
 * @returns {value is NetworkOperationError} True for a known code.
 */
export function isNetworkOperationError(value: unknown): value is NetworkOperationError {
  return (
    typeof value === 'string' &&
    !(RENDERER_FAILURES as readonly string[]).includes(value) &&
    Object.prototype.hasOwnProperty.call(ERROR_KEYS, value)
  );
}

/**
 * The setting a 'securityBandConflict' names: the field given client-side,
 * else the one of main's diagnostic "conflict: <field>", else null.
 * @param {NetworkFailureInfo} failure - The failure.
 * @returns {string | null} The field's key, or null.
 */
export function conflictFieldOf(failure: NetworkFailureInfo): string | null {
  if (failure.conflictField !== undefined) return failure.conflictField;
  const match = failure.diagnostic === null ? null : CONFLICT_DIAGNOSTIC_REGEX.exec(failure.diagnostic);
  return match === null ? null : match[1];
}

/**
 * The text of a network write failure: its message — for a
 * 'securityBandConflict' the one naming its setting (Enhanced IoT
 * Connectivity, OWE), the generic one for another — followed by main's
 * codes-only diagnostic in parentheses when there is one.
 * @param {NetworkFailureInfo} failure - The failure.
 * @param {TextContext} ctx - The translator.
 * @returns {string} The localized text.
 */
export function networkFailureText(failure: NetworkFailureInfo, ctx: TextContext): string {
  let key = networkErrorKey(failure.error);
  if (failure.error === 'securityBandConflict') {
    const field = conflictFieldOf(failure);
    if (field !== null && Object.prototype.hasOwnProperty.call(CONFLICT_KEYS, field)) {
      key = CONFLICT_KEYS[field];
    }
  }
  const text = ctx.tr(key);
  return failure.diagnostic === null ? text : `${text} (${failure.diagnostic})`;
} // End of function networkFailureText()

/**
 * Validates a write reply (createNetwork(), updateNetwork(),
 * changeNetworkPassword(), setNetworkEnabled(), deleteNetwork()): success,
 * with the created network's id when it is a usable one (NETWORK_ID_REGEX),
 * or a failure with main's known code (anything else is 'failed') and its
 * codes-only diagnostic when well-formed. Nothing else of the reply is kept.
 * @param {unknown} raw - The reply received over IPC.
 * @returns {ParsedNetworkAction} The validated reply.
 */
export function parseNetworkActionResult(raw: unknown): ParsedNetworkAction {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'failed', diagnostic: null };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.success === true) {
    const id = candidate.networkId;
    return { ok: true, networkId: typeof id === 'string' && NETWORK_ID_REGEX.test(id) ? id : null };
  }
  return {
    ok: false,
    error: isNetworkOperationError(candidate.error) ? candidate.error : 'failed',
    diagnostic: parseDiagnostic(candidate.diagnostic),
  };
} // End of function parseNetworkActionResult()

/**
 * Tells whether a refusal means the managed list on screen may be stale
 * (fresh controller data contradicted it): the list is then read again, so
 * the detail follows (e.g. a network turned Enterprise, a group or a network
 * that is gone, a name another network now has).
 * @param {NetworkWriteFailure} error - The failure.
 * @returns {boolean} True when the managed list should be read again.
 */
export function isNetworkStaleDataFailure(error: NetworkWriteFailure): boolean {
  return error === 'unsupportedSecurity' || error === 'groupNotFound' || error === 'nameTaken' || error === 'requestFailed';
}

// ============================================================================
// Create
// ============================================================================

/** What the create form holds (the passphrase fields are read separately). */
export interface CreateDraft {
  name: string;
  security: WritableNetworkSecurity;
  bands: readonly NetworkBand[];
  apGroupIds: readonly string[];
}

/** A create that passed the client-side checks: what is sent (plus the passphrase for WPA-Personal). */
export interface CheckedCreate {
  name: string;
  security: WritableNetworkSecurity;
  bands: NetworkBand[];
  apGroupIds: string[];
}

/**
 * Checks the create form the way main will (checkNetworkCreate()), in its
 * order: the name, the bands (at least one), the security + band
 * combination (an open network cannot be created with 6 GHz: it needs OWE,
 * which the create request cannot carry — 'securityBandConflict' naming
 * 'oweEnable'), the AP groups (at least one, each a 24-hex id; duplicates
 * dropped), then for WPA-Personal the passphrase and its confirmation. An
 * open network carries no passphrase (its fields are not shown).
 * @param {CreateDraft} draft - The form's values.
 * @param {string} passphrase - The passphrase field (WPA-Personal).
 * @param {string} confirmation - Its confirmation field.
 * @returns {{ ok: true; create: CheckedCreate } | FormRefusal} The checked create, or the refusal.
 */
export function checkCreateDraft(draft: CreateDraft, passphrase: string, confirmation: string): { ok: true; create: CheckedCreate } | FormRefusal {
  const name = checkNetworkName(draft.name);
  if (!name.ok) {
    return { ok: false, error: name.error, diagnostic: null };
  }
  const bands = canonicalBands(draft.bands);
  if (bands.length === 0) {
    return { ok: false, error: 'bandsRequired', diagnostic: null };
  }
  if (draft.security === 'open' && bands.includes('band6g')) {
    return { ok: false, error: 'securityBandConflict', diagnostic: null, conflictField: 'oweEnable' };
  }
  const apGroupIds = [...new Set(draft.apGroupIds)];
  if (apGroupIds.length === 0) {
    return { ok: false, error: 'groupsRequired', diagnostic: null };
  }
  if (!apGroupIds.every(id => WRITABLE_GROUP_ID_REGEX.test(id))) {
    return { ok: false, error: 'groupNotFound', diagnostic: null };
  }
  if (draft.security === 'wpaPersonal') {
    const refused = checkPassphrase(passphrase, confirmation);
    if (refused !== null) {
      return { ok: false, error: refused, diagnostic: null };
    }
  }
  return { ok: true, create: { name: name.name, security: draft.security, bands, apGroupIds } };
} // End of function checkCreateDraft()

/**
 * Finds the network a create made in the re-read managed list, to select it:
 * by the id main reported when it is listed, else the ONE network with that
 * name (for the selection only — "Enable after creating" never acts on a
 * network found by name); null when it cannot be told.
 * @param {string | null} networkId - The id main reported, or null.
 * @param {string} name - The (trimmed) name sent.
 * @param {readonly ManagedNetwork[]} networks - The re-read networks.
 * @returns {string | null} The network's id, or null.
 */
export function findCreatedNetworkId(networkId: string | null, name: string, networks: readonly ManagedNetwork[]): string | null {
  if (networkId !== null && networks.some(network => network.id === networkId)) {
    return networkId;
  }
  const named = networks.filter(network => network.name === name);
  return named.length === 1 ? named[0].id : null;
}

// ============================================================================
// Staged edit
// ============================================================================

/** What the edit form holds (the passphrase fields are read separately). */
export interface EditDraft {
  name: string;
  security: WritableNetworkSecurity;
  bands: readonly NetworkBand[];
}

/** One staged change of an edit, with its value before and after. */
export type EditChange =
  | { field: 'name'; from: string; to: string }
  | { field: 'security'; from: NetworkSecurity; to: WritableNetworkSecurity }
  | { field: 'bands'; from: NetworkBand[] | null; to: NetworkBand[] };

/**
 * A note of the review step: a renamed network (devices must join the new
 * name), a switch to Open (anyone can join) or to WPA-Personal (devices need
 * the typed password), bands removed (their clients are disconnected), and
 * the PMF note (main's derivation may lower PMF "Mandatory" to "Capable"
 * when the security or the bands of a WPA-Personal result change — the DTO
 * carries no PMF, so it is stated as a possibility).
 */
export type EditNote = 'rename' | 'toOpen' | 'toWpaPersonal' | 'bandsRemoved' | 'pmf';

/**
 * The plan of a staged edit: its changes, the edited fields sent to main
 * (only those), the resulting security mode, whether the save needs the
 * re-typed passphrase (every save whose result is WPA-Personal, spec §3 /
 * §5), and the review's notes.
 */
export interface EditPlan {
  changes: EditChange[];
  edits: { name?: string; security?: WritableNetworkSecurity; bands?: NetworkBand[] };
  resultSecurity: WritableNetworkSecurity;
  needsPassphrase: boolean;
  notes: EditNote[];
}

/**
 * The edit form's initial values: the network's name, security and bands
 * (none ticked when the controller did not report them: leaving them all
 * unticked keeps them as they are).
 * @param {ManagedNetwork} network - The network (Open or WPA-Personal).
 * @returns {EditDraft} The initial values.
 */
export function initialEditDraft(network: ManagedNetwork): EditDraft {
  return {
    name: network.name,
    security: network.security === 'open' ? 'open' : 'wpaPersonal',
    bands: network.bands === null ? [] : canonicalBands(network.bands),
  };
}

/**
 * Tells whether a save with this resulting security needs the re-typed
 * passphrase: every WPA-Personal result does (spec §3 / §5 — the current
 * key is never read back, so every save sends the typed one).
 * @param {WritableNetworkSecurity} security - The resulting security.
 * @returns {boolean} True for WPA-Personal.
 */
export function needsPassphrase(security: WritableNetworkSecurity): boolean {
  return security === 'wpaPersonal';
}

/**
 * Plans a staged edit against the network on screen. The name changed when
 * the typed one is neither the network's name nor that name with spaces
 * around it (main trims, so the trimmed name is sent); the security when it
 * differs; the bands when they differ from the reported ones — or, when the
 * controller did not report them, when any is ticked (none ticked keeps
 * them). The notes follow the changes (see EditNote); the PMF note whenever
 * the security or the bands change and the result is WPA-Personal on
 * anything but 6 GHz alone (WPA3-SAE there keeps PMF mandatory).
 * @param {ManagedNetwork} network - The network on screen.
 * @param {EditDraft} draft - The form's values.
 * @returns {EditPlan} The plan.
 */
export function planNetworkEdit(network: ManagedNetwork, draft: EditDraft): EditPlan {
  const changes: EditChange[] = [];
  const edits: EditPlan['edits'] = {};
  const notes: EditNote[] = [];

  const trimmed = draft.name.trim();
  if (draft.name !== network.name && trimmed !== network.name) {
    changes.push({ field: 'name', from: network.name, to: trimmed });
    edits.name = trimmed;
    notes.push('rename');
  }
  const securityChanged = draft.security !== network.security;
  if (securityChanged) {
    changes.push({ field: 'security', from: network.security, to: draft.security });
    edits.security = draft.security;
    notes.push(draft.security === 'open' ? 'toOpen' : 'toWpaPersonal');
  }
  const bands = canonicalBands(draft.bands);
  const bandsChanged = network.bands === null ? bands.length > 0 : !sameBands(network.bands, bands);
  if (bandsChanged) {
    changes.push({ field: 'bands', from: network.bands === null ? null : canonicalBands(network.bands), to: bands });
    edits.bands = bands;
    if (network.bands !== null && network.bands.some(band => !bands.includes(band))) {
      notes.push('bandsRemoved');
    }
  }
  const resultBands = bandsChanged ? bands : network.bands;
  const sixGhzOnly = resultBands !== null && resultBands.length === 1 && resultBands[0] === 'band6g';
  if ((securityChanged || bandsChanged) && draft.security === 'wpaPersonal' && !sixGhzOnly) {
    notes.push('pmf');
  }
  return { changes, edits, resultSecurity: draft.security, needsPassphrase: needsPassphrase(draft.security), notes };
} // End of function planNetworkEdit()

/**
 * Checks a staged edit before its review, the way main will
 * (checkNetworkEdits() and the merge), in this order: a network the app
 * does not edit ('unsupportedSecurity'), no change at all
 * ('nothingToChange' — a re-typed passphrase alone is not an edit: that is
 * Change password), the new name, the bands (at least one), then — for a
 * WPA-Personal result — the re-typed passphrase and its confirmation.
 * @param {ManagedNetwork} network - The network on screen.
 * @param {EditDraft} draft - The form's values.
 * @param {string} passphrase - The passphrase field.
 * @param {string} confirmation - Its confirmation field.
 * @returns {{ ok: true; plan: EditPlan } | FormRefusal} The plan, or the refusal.
 */
export function checkEditDraft(network: ManagedNetwork, draft: EditDraft, passphrase: string, confirmation: string): { ok: true; plan: EditPlan } | FormRefusal {
  if (!isEditableSecurity(network.security)) {
    return { ok: false, error: 'unsupportedSecurity', diagnostic: null };
  }
  const plan = planNetworkEdit(network, draft);
  if (plan.changes.length === 0) {
    return { ok: false, error: 'nothingToChange', diagnostic: null };
  }
  if (plan.edits.name !== undefined) {
    const name = checkNetworkName(plan.edits.name);
    if (!name.ok) {
      return { ok: false, error: name.error, diagnostic: null };
    }
  }
  if (plan.edits.bands !== undefined && plan.edits.bands.length === 0) {
    return { ok: false, error: 'bandsRequired', diagnostic: null };
  }
  if (plan.needsPassphrase) {
    const refused = checkPassphrase(passphrase, confirmation);
    if (refused !== null) {
      return { ok: false, error: refused, diagnostic: null };
    }
  }
  return { ok: true, plan };
} // End of function checkEditDraft()

// The message key of each review note
const NOTE_KEYS = {
  rename: 'networkNoteRename',
  toOpen: 'networkNoteToOpen',
  toWpaPersonal: 'networkNoteToWpaPersonal',
  bandsRemoved: 'networkNoteBandsRemoved',
  pmf: 'networkNotePmf',
} as const satisfies Record<EditNote, MessageKey>;

/** One row of a review or an impact summary: what it is about, its label and its value. */
export interface SummaryRow {
  kind: string;
  label: string;
  value: string;
}

/**
 * A band list as text ("2.4 GHz and 5 GHz"), or "Unknown" when the bands
 * are unknown (or none).
 * @param {readonly NetworkBand[] | null} bands - The bands.
 * @param {TextContext} ctx - The translator and its language.
 * @returns {string} The localized list.
 */
export function bandListText(bands: readonly NetworkBand[] | null, ctx: TextContext): string {
  if (bands === null || bands.length === 0) return ctx.tr('networkValueUnknown');
  return new Intl.ListFormat(ctx.language, { type: 'conjunction' }).format(canonicalBands(bands).map(band => ctx.tr(band)));
}

/**
 * A security mode as text ("Open", "WPA-Personal", …; "Unknown" when unknown).
 * @param {NetworkSecurity} security - The mode.
 * @param {TextContext} ctx - The translator.
 * @returns {string} The localized mode.
 */
function securityText(security: NetworkSecurity, ctx: TextContext): string {
  const key = securityKey(security);
  return key === null ? ctx.tr('networkValueUnknown') : ctx.tr(key);
}

/**
 * The rows of the review step: each change "before → after" (the name, the
 * security, the bands), then — when the save carries the re-typed
 * passphrase — a password row that never shows it.
 * @param {EditPlan} plan - The checked plan.
 * @param {TextContext} ctx - The translator and its language.
 * @returns {SummaryRow[]} The rows, in order.
 */
export function editReviewRows(plan: EditPlan, ctx: TextContext): SummaryRow[] {
  const rows: SummaryRow[] = plan.changes.map(change => {
    if (change.field === 'name') {
      const from = change.from === '' ? ctx.tr('unnamed') : change.from;
      return { kind: 'name', label: ctx.tr('networkReviewName'), value: ctx.tr('networkReviewChange', { from, to: change.to }) };
    }
    if (change.field === 'security') {
      return { kind: 'security', label: ctx.tr('networkSecurityLabel'), value: ctx.tr('networkReviewChange', { from: securityText(change.from, ctx), to: securityText(change.to, ctx) }) };
    }
    return { kind: 'bands', label: ctx.tr('networkBandsLabel'), value: ctx.tr('networkReviewChange', { from: bandListText(change.from, ctx), to: bandListText(change.to, ctx) }) };
  }); // End of the mapping of the changes to rows
  if (plan.needsPassphrase) {
    rows.push({ kind: 'passphrase', label: ctx.tr('networkPassphraseLabel'), value: ctx.tr('networkReviewPassphraseValue') });
  }
  return rows;
} // End of function editReviewRows()

/**
 * The texts of the review step's notes, in the plan's order.
 * @param {EditPlan} plan - The checked plan.
 * @param {TextContext} ctx - The translator.
 * @returns {string[]} The notes.
 */
export function editNoteTexts(plan: EditPlan, ctx: TextContext): string[] {
  return plan.notes.map(note => ctx.tr(NOTE_KEYS[note]));
}

// ============================================================================
// Scope text and impact summary
// ============================================================================

/**
 * An AP count: "No APs", "1 AP" or "N APs" (apCountOrUnknown() in
 * inventory-ui.ts, for a known count).
 * @param {number} count - The count.
 * @param {Translate} tr - The translator.
 * @returns {string} The localized count.
 */
function apCountText(count: number, tr: Translate): string {
  if (count === 0) return tr('apCountNone');
  return count === 1 ? tr('apCountOne') : tr('apCountMany', { count: String(count) });
}

/**
 * A managed network's scope as text: "All access points", "Unknown scope",
 * or "N groups · M APs" — while M is a lower bound, "at least M APs" (or "AP
 * count unknown" when none is placed) followed by the reasons: how many APs'
 * groups cannot be identified and how many bound groups the list does not
 * have. A lower bound is never presented as exact. Shared by the managed
 * list (managedScopeText() in managed-networks-view.ts) and the impact
 * summaries.
 * @param {ScopeSummary} summary - The scope's summary (summarizeScope()).
 * @param {Translate} tr - The translator.
 * @returns {string} The localized scope.
 */
export function scopeSummaryText(summary: ScopeSummary, tr: Translate): string {
  if (summary.kind === 'allAccessPoints') return tr('scopeAllAccessPoints');
  if (summary.kind === 'unknown') return tr('scopeUnknown');

  const groups = summary.groupCount === 1 ? tr('groupCountOne') : tr('groupCountMany', { count: String(summary.groupCount) });
  if (summary.countKind === 'exact') {
    return `${groups} · ${apCountText(summary.apCount, tr)}`;
  }
  let aps = tr('apCountUnknown');
  if (summary.countKind === 'atLeast') {
    aps = summary.apCount === 1 ? tr('apCountAtLeastOne') : tr('apCountAtLeastMany', { count: String(summary.apCount) });
  }
  const reasons: string[] = [];
  if (summary.unknownApCount > 0) {
    reasons.push(summary.unknownApCount === 1 ? tr('scopeUnknownApsOne') : tr('scopeUnknownApsMany', { count: String(summary.unknownApCount) }));
  }
  if (summary.unresolvedGroupCount > 0) {
    reasons.push(summary.unresolvedGroupCount === 1 ? tr('scopeUnresolvedGroupsOne') : tr('scopeUnresolvedGroupsMany', { count: String(summary.unresolvedGroupCount) }));
  }
  return [`${groups} · ${aps}`, ...reasons].join('; ');
} // End of function scopeSummaryText()

/**
 * The impact summary of an enable / disable / delete confirmation (spec §3:
 * a confirmation names the objects and the effect): the scope ("All access
 * points", "N groups · M APs" or "Unknown scope"); for a network bound to AP
 * groups, the bound groups by name (in the group list's order; the bound
 * groups the list does not have counted; "None" when bound to none).
 * @param {ManagedScope} scope - The network's resolved scope.
 * @param {TextContext} ctx - The translator.
 * @returns {SummaryRow[]} The rows.
 */
export function impactRows(scope: ManagedScope, ctx: TextContext): SummaryRow[] {
  const rows: SummaryRow[] = [{ kind: 'scope', label: ctx.tr('networkImpactScope'), value: scopeSummaryText(summarizeScope(scope), ctx.tr) }];
  if (scope.kind === 'apGroups') {
    const names = scope.groups.map(group => (group.wlanName === '' ? ctx.tr('unnamed') : group.wlanName));
    if (scope.unresolvedGroupCount > 0) {
      const count = scope.unresolvedGroupCount;
      names.push(count === 1 ? ctx.tr('networkImpactUnresolvedOne') : ctx.tr('networkImpactUnresolvedMany', { count: String(count) }));
    }
    rows.push({ kind: 'groups', label: ctx.tr('networkImpactGroups'), value: names.length === 0 ? ctx.tr('networkImpactNoGroups') : names.join(', ') });
  }
  return rows;
} // End of function impactRows()

/**
 * The note under an impact summary: "All access points" includes the ones
 * added later; an unknown scope may affect any access point (never
 * guessed); none for a scope bound to AP groups.
 * @param {ManagedScope} scope - The network's resolved scope.
 * @param {TextContext} ctx - The translator.
 * @returns {string | null} The note, or null.
 */
export function impactNote(scope: ManagedScope, ctx: TextContext): string | null {
  if (scope.kind === 'allAccessPoints') return ctx.tr('networkImpactAllNote');
  if (scope.kind === 'unknown') return ctx.tr('networkImpactUnknownNote');
  return null;
}
