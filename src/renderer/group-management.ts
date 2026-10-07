// ============================================================================
// Pure logic of the AP group management UI (todo.md 4.9, phase 16b;
// docs/management-design.md §4.4), DOM-free so the unit tests can run it in
// plain Node:
//   - the renderer mirror of the main-side rules (src/main/ap-group-policy.ts
//     and ipc-guards.ts — keep them in sync): which group ids can be written
//     (24 hex digits), the name check (trimmed, 1–128 UTF-16 code units, no
//     control / bidirectional-control characters, no case-insensitive
//     duplicate, a rename to the same name is "unchanged") for immediate
//     feedback; main stays authoritative and its reply is what is shown;
//   - whether Delete is shown for a group (hidden for the default group, spec
//     §4.4) and why it is unavailable (has APs, has networks, state unknown,
//     still checking), from the fresh Open API view main reported
//     (ManagedApGroup) and the internal data on screen, failing closed;
//   - the per-band capacity rows (2.4 / 5 / 6 GHz, MLO): a value the
//     controller did not report stays absent ("not reported"), never invented;
//     and the bands behind the master list's Capacity warning badge (a
//     REPORTED remaining capacity of 0);
//   - the boundary validation of the AP-group replies (list and writes) and
//     the mapping of every ApGroupOperationError to its message key.
// The message keys below are keys of the i18n table (Translations in
// i18n.ts); the DOM modules look them up with t()/tFormat(), which checks
// them against the table at compile time.
// ============================================================================

import type { ApGroupBandValues, ApGroupOperationError, ApGroupSsidLimits, ManagedApGroup } from '../shared/types';
import { parseDiagnostic } from './validation';

// AP-group ids main accepts for a write: 24 hex digits (AP_GROUP_ID_REGEX in
// src/main/ap-group-policy.ts). Other groups are listed but get no write action
export const WRITABLE_GROUP_ID_REGEX = /^[0-9A-Fa-f]{24}$/;

// Longest group name after trimming, in UTF-16 code units
// (MAX_AP_GROUP_NAME_LENGTH in src/main/ap-group-policy.ts)
export const MAX_GROUP_NAME_LENGTH = 128;

// Characters main refuses in a group name (FORBIDDEN_NAME_CHARACTERS in
// src/main/ap-group-policy.ts): control characters, unpaired surrogates,
// U+2028/U+2029 and the bidirectional controls
const FORBIDDEN_NAME_CHARACTERS = /[\p{Cc}\p{Cs}\u{2028}\u{2029}\u{061c}\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/u;

// Every ApGroupOperationError (src/shared/types.ts) with its message key; the
// Record type makes the compiler require each one. 'failed' is the
// renderer's own outcome for a reply it cannot read or a call that threw
const ERROR_KEYS = {
  notConnected: 'apGroupErrorNotConnected',
  superseded: 'apGroupErrorSuperseded',
  managementUnavailable: 'apGroupErrorManagementUnavailable',
  nameRequired: 'apGroupErrorNameRequired',
  nameTooLong: 'apGroupErrorNameTooLong',
  nameInvalid: 'apGroupErrorNameInvalid',
  nameTaken: 'apGroupErrorNameTaken',
  nameUnchanged: 'apGroupErrorNameUnchanged',
  groupNotFound: 'apGroupErrorGroupNotFound',
  groupIsDefault: 'apGroupErrorGroupIsDefault',
  groupNotEmpty: 'apGroupErrorGroupNotEmpty',
  groupHasNetworks: 'apGroupErrorGroupHasNetworks',
  groupStateUnknown: 'apGroupErrorGroupStateUnknown',
  groupLimitReached: 'apGroupErrorGroupLimitReached',
  groupListIncomplete: 'apGroupErrorGroupListIncomplete',
  requestFailed: 'apGroupErrorRequestFailed',
  failed: 'apGroupErrorFailed',
} as const satisfies Record<ApGroupOperationError | 'failed', string>;

/** The message key of an AP-group error (a key of the i18n table). */
export type GroupErrorKey = (typeof ERROR_KEYS)[keyof typeof ERROR_KEYS];

/** An AP-group failure as the renderer knows it: main's code, or 'failed'. */
export type GroupFailure = ApGroupOperationError | 'failed';

/**
 * Why Delete is unavailable for a (non-default) group — the default group
 * gets no Delete at all (deleteBlocks() answers null):
 * - 'groupNotEmpty': access points are in it;
 * - 'groupHasNetworks': Wi-Fi networks are bound to it;
 * - 'groupStateUnknown': the controller did not report its AP count or its
 *   networks (sanely), or the fresh data could not be read — fail closed;
 * - 'deleteChecking': the fresh data is still being read.
 */
export type DeleteBlock = 'groupNotEmpty' | 'groupHasNetworks' | 'groupStateUnknown' | 'deleteChecking';

// The message key of each delete block
const DELETE_BLOCK_KEYS = {
  groupNotEmpty: 'deleteBlockedNotEmpty',
  groupHasNetworks: 'deleteBlockedHasNetworks',
  groupStateUnknown: 'deleteBlockedUnknown',
  deleteChecking: 'deleteBlockedChecking',
} as const satisfies Record<DeleteBlock, string>;

/** The message key of a delete block (a key of the i18n table). */
export type DeleteBlockKey = (typeof DELETE_BLOCK_KEYS)[keyof typeof DELETE_BLOCK_KEYS];

/**
 * Where the fresh Open API view of the AP groups (getManagedApGroups()) is:
 * not asked for (management off, or not connected), being read, read, or
 * not readable.
 */
export type ManagedGroupsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** A group as the name rules see it: its id and its name. */
export interface NamedGroup {
  id: string;
  name: string;
}

/** Why a name is refused (the codes main answers with for the same cases). */
export type GroupNameError = Extract<ApGroupOperationError, 'nameRequired' | 'nameTooLong' | 'nameInvalid' | 'nameTaken' | 'nameUnchanged'>;

/** The outcome of checkGroupName(): the trimmed name, or why it is refused. */
export type GroupNameCheck = { ok: true; name: string } | { ok: false; error: GroupNameError };

/**
 * Tells whether a group can be renamed or deleted from the app: main accepts
 * only 24-hex-digit AP-group ids over IPC.
 * @param {string} id - The group id.
 * @returns {boolean} True for a writable id.
 */
export function isWritableGroupId(id: string): boolean {
  return WRITABLE_GROUP_ID_REGEX.test(id);
}

/**
 * The key two group names are compared by (apGroupNameKey() in
 * src/main/ap-group-policy.ts): trimmed, NFC-normalized and lower-cased.
 * @param {string} name - A group name.
 * @returns {string} The comparison key.
 */
export function groupNameKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

/**
 * Checks a typed group name the way main will (see the header): blank,
 * too long or with refused characters; for a rename, the group's own name
 * ("unchanged", nothing is sent); then a name another group already has
 * (compared case-insensitively — same-named groups cannot be move targets).
 * @param {string} raw - The name as typed.
 * @param {readonly NamedGroup[]} groups - The groups on screen.
 * @param {NamedGroup} [renaming] - The group being renamed (absent for a create).
 * @returns {GroupNameCheck} The trimmed name, or the refusal.
 */
export function checkGroupName(raw: string, groups: readonly NamedGroup[], renaming?: NamedGroup): GroupNameCheck {
  const name = raw.trim();
  if (name === '') {
    return { ok: false, error: 'nameRequired' };
  }
  if (name.length > MAX_GROUP_NAME_LENGTH) {
    return { ok: false, error: 'nameTooLong' };
  }
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) {
    return { ok: false, error: 'nameInvalid' };
  }
  if (renaming !== undefined && renaming.name === name) {
    return { ok: false, error: 'nameUnchanged' };
  }
  const key = groupNameKey(name);
  if (groups.some(group => group.id !== renaming?.id && groupNameKey(group.name) === key)) {
    return { ok: false, error: 'nameTaken' };
  }
  return { ok: true, name };
} // End of function checkGroupName()

/**
 * What deleteBlocks() decides from: the fresh Open API view of the group
 * (undefined when not read, or not listed) and where that read is, plus the
 * internal data on screen.
 */
export interface DeleteInput {
  managed: ManagedApGroup | undefined;
  managedStatus: ManagedGroupsStatus;
  // The internal list flags the group as the default one
  isDefault: boolean;
  // APs the internal data places in the group (null: unknown, a shared name)
  apCount: number | null;
  // Wi-Fi networks the internal data binds to it
  networkCount: number;
}

/**
 * Decides how Delete is offered for a group (main re-checks on fresh data
 * anyway). The default group — flagged by either source — is never
 * deletable, so Delete is hidden for it (spec §4.4): null. Otherwise the
 * reasons it is unavailable (empty: it may be offered), every applicable
 * one from the fresh view or the internal data (whichever reports APs or
 * networks): has APs, has networks; when neither applies, the delete is
 * still refused while the fresh view is being read ('deleteChecking'), or
 * when it is missing or lacks the AP count or the network list
 * ('groupStateUnknown'). The fresh view counts APs by group id, so a name
 * another group shares (internal AP count unknown) does not block on its own.
 * @param {DeleteInput} input - The group's data.
 * @returns {DeleteBlock[] | null} The reasons, most specific first, or null
 *   when Delete is hidden (the default group).
 */
export function deleteBlocks(input: DeleteInput): DeleteBlock[] | null {
  const { managed } = input;
  if (input.isDefault || managed?.isDefault === true) {
    return null;
  }
  const blocks: DeleteBlock[] = [];
  if ((managed?.apCount ?? 0) > 0 || (input.apCount ?? 0) > 0) {
    blocks.push('groupNotEmpty');
  }
  if ((managed?.networkNames?.length ?? 0) > 0 || input.networkCount > 0) {
    blocks.push('groupHasNetworks');
  }
  if (blocks.length > 0) {
    return blocks;
  }
  if (managed === undefined && (input.managedStatus === 'loading' || input.managedStatus === 'idle')) {
    return ['deleteChecking'];
  }
  if (managed === undefined || managed.apCount === undefined || managed.networkNames === undefined) {
    return ['groupStateUnknown'];
  }
  return [];
} // End of function deleteBlocks()

/**
 * The message key of a delete block.
 * @param {DeleteBlock} block - The block.
 * @returns {DeleteBlockKey} Its key.
 */
export function deleteBlockKey(block: DeleteBlock): DeleteBlockKey {
  return DELETE_BLOCK_KEYS[block];
}

/** A band of the capacity section: 2.4, 5 and 6 GHz, and MLO. */
export type CapacityBand = keyof ApGroupBandValues | 'mlo';

/**
 * One row of the capacity section: how many more Wi-Fi networks the band
 * can take (null: not reported) and the per-group limit (null: not reported).
 */
export interface CapacityRow {
  band: CapacityBand;
  remaining: number | null;
  limit: number | null;
}

/** The message of a capacity row: its key and placeholder values. */
export interface CapacityText {
  key: 'capacityFreeOf' | 'capacityFree' | 'capacityNotReportedLimit' | 'capacityNotReported';
  vars: Record<string, string>;
}

// The bands, in display order
const CAPACITY_BANDS: readonly CapacityBand[] = ['band2g', 'band5g', 'band6g', 'mlo'];

/**
 * Builds the capacity rows of a group: one per band (2.4 / 5 / 6 GHz, MLO)
 * with the remaining capacity main reported for the group (the DTO carries
 * none for MLO) and the site's per-group limit; a value not reported stays
 * null (never invented).
 * @param {ManagedApGroup | undefined} managed - The group's fresh view.
 * @param {ApGroupSsidLimits | null} limits - The per-group SSID limits.
 * @returns {CapacityRow[]} The four rows.
 */
export function capacityRows(managed: ManagedApGroup | undefined, limits: ApGroupSsidLimits | null): CapacityRow[] {
  return CAPACITY_BANDS.map(band => {
    const remaining = band === 'mlo' ? undefined : managed?.remainingBinding?.[band];
    const limit = limits?.[band];
    return { band, remaining: remaining ?? null, limit: limit ?? null };
  });
}

/**
 * The bands behind the master list's Capacity warning badge (spec §4.4): the
 * bands whose remaining capacity the controller REPORTED as 0 for the group
 * (no room for another Wi-Fi network), from the same rows as the detail's
 * capacity section (capacityRows(): MLO never carries a remaining value). A
 * band the controller did not report never counts (never invented), and
 * without the group's fresh view there is no warning.
 * @param {ManagedApGroup | undefined} managed - The group's fresh view.
 * @returns {CapacityBand[]} The full bands in display order (empty: no warning).
 */
export function fullCapacityBands(managed: ManagedApGroup | undefined): CapacityBand[] {
  return capacityRows(managed, null)
    .filter(row => row.remaining === 0)
    .map(row => row.band);
}

/**
 * The text of a capacity row: "R of L free", "R free" (limit not
 * reported), "Not reported (limit L)" or "Not reported".
 * @param {CapacityRow} row - The row.
 * @returns {CapacityText} Its message key and values.
 */
export function capacityText(row: CapacityRow): CapacityText {
  if (row.remaining !== null) {
    return row.limit !== null
      ? { key: 'capacityFreeOf', vars: { remaining: String(row.remaining), limit: String(row.limit) } }
      : { key: 'capacityFree', vars: { remaining: String(row.remaining) } };
  }
  return row.limit !== null ? { key: 'capacityNotReportedLimit', vars: { limit: String(row.limit) } } : { key: 'capacityNotReported', vars: {} };
}

/**
 * The message key of an AP-group failure.
 * @param {GroupFailure} error - Main's code, or 'failed'.
 * @returns {GroupErrorKey} Its key.
 */
export function groupErrorKey(error: GroupFailure): GroupErrorKey {
  return ERROR_KEYS[error];
}

/**
 * Tells whether a value is a known ApGroupOperationError.
 * @param {unknown} value - The candidate.
 * @returns {value is ApGroupOperationError} True for a known code.
 */
export function isApGroupOperationError(value: unknown): value is ApGroupOperationError {
  return typeof value === 'string' && value !== 'failed' && Object.prototype.hasOwnProperty.call(ERROR_KEYS, value);
}

/** A failed AP-group reply after validation. */
export interface GroupFailureReply {
  ok: false;
  error: GroupFailure;
  // Main's codes-only diagnostic, or null
  diagnostic: string | null;
}

/** A getManagedApGroups() reply after validation. */
export type ParsedManagedGroups = { ok: true; groups: ManagedApGroup[]; ssidLimits: ApGroupSsidLimits | null } | GroupFailureReply;

/** A create / rename / delete reply after validation. */
export type ParsedGroupAction = { ok: true; apGroupId: string | null } | GroupFailureReply;

/**
 * Tells whether a value is a count (a non-negative safe integer).
 * @param {unknown} value - The candidate.
 * @returns {value is number} True for a count.
 */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Keeps the sane per-band counts of an object (unknown keys and insane
 * values are left out).
 * @param {unknown} raw - The candidate object.
 * @param {readonly CapacityBand[]} bands - The keys to keep.
 * @returns {Partial<Record<CapacityBand, number>> | undefined} The counts, or undefined when none.
 */
function parseBandCounts(raw: unknown, bands: readonly CapacityBand[]): Partial<Record<CapacityBand, number>> | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const counts: Partial<Record<CapacityBand, number>> = {};
  for (const band of bands) {
    const value = (raw as Record<string, unknown>)[band];
    if (Object.prototype.hasOwnProperty.call(raw, band) && isCount(value)) {
      counts[band] = value;
    }
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
} // End of function parseBandCounts()

/**
 * Validates one ManagedApGroup of a reply: a string id and name are
 * required; the optional fields are kept only when sane (a network list only
 * as an array of strings — anything else is unknown, never "no networks").
 * @param {unknown} raw - The candidate.
 * @returns {ManagedApGroup | null} The group, or null when unusable.
 */
function parseManagedGroup(raw: unknown): ManagedApGroup | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || candidate.id === '' || typeof candidate.name !== 'string') {
    return null;
  }
  const group: ManagedApGroup = { id: candidate.id, name: candidate.name, isDefault: candidate.isDefault === true };
  if (isCount(candidate.apCount)) {
    group.apCount = candidate.apCount;
  }
  const names = candidate.networkNames;
  if (Array.isArray(names) && names.every(name => typeof name === 'string')) {
    group.networkNames = [...names];
  }
  const remaining = parseBandCounts(candidate.remainingBinding, ['band2g', 'band5g', 'band6g']);
  if (remaining !== undefined) {
    group.remainingBinding = remaining;
  }
  return group;
} // End of function parseManagedGroup()

/**
 * Validates a failed AP-group reply: a known code (anything else is
 * 'failed') with main's codes-only diagnostic when well-formed.
 * @param {Record<string, unknown>} candidate - The reply.
 * @returns {GroupFailureReply} The failure.
 */
function parseFailure(candidate: Record<string, unknown>): GroupFailureReply {
  return {
    ok: false,
    error: isApGroupOperationError(candidate.error) ? candidate.error : 'failed',
    diagnostic: parseDiagnostic(candidate.diagnostic),
  };
}

/**
 * Validates a getManagedApGroups() reply: a success needs a group array
 * (unusable entries are dropped); the SSID limits are kept when sane.
 * Anything else is a failure ('failed' when unreadable).
 * @param {unknown} raw - The reply received over IPC.
 * @returns {ParsedManagedGroups} The validated reply.
 */
export function parseManagedGroupsResult(raw: unknown): ParsedManagedGroups {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'failed', diagnostic: null };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.success === true && Array.isArray(candidate.groups)) {
    const groups = candidate.groups.map(parseManagedGroup).filter((group): group is ManagedApGroup => group !== null);
    const limits = parseBandCounts(candidate.ssidLimits, ['band2g', 'band5g', 'band6g', 'mlo']);
    return { ok: true, groups, ssidLimits: limits ?? null };
  }
  return parseFailure(candidate);
} // End of function parseManagedGroupsResult()

/**
 * Validates a create / rename / delete reply: success (with the new group's
 * id when it is a string) or a failure.
 * @param {unknown} raw - The reply received over IPC.
 * @returns {ParsedGroupAction} The validated reply.
 */
export function parseGroupActionResult(raw: unknown): ParsedGroupAction {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'failed', diagnostic: null };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.success === true) {
    const id = candidate.apGroupId;
    return { ok: true, apGroupId: typeof id === 'string' && id !== '' ? id : null };
  }
  return parseFailure(candidate);
} // End of function parseGroupActionResult()

/**
 * Finds the group a create made in the reloaded list: by the id main
 * reported when it is listed, else the one group with that name (compared
 * like the name rule); null when it cannot be told.
 * @param {string | null} apGroupId - The id main reported, or null.
 * @param {string} name - The (trimmed) name sent.
 * @param {readonly NamedGroup[]} groups - The reloaded groups.
 * @returns {string | null} The group's id, or null.
 */
export function findCreatedGroupId(apGroupId: string | null, name: string, groups: readonly NamedGroup[]): string | null {
  if (apGroupId !== null && groups.some(group => group.id === apGroupId)) {
    return apGroupId;
  }
  const key = groupNameKey(name);
  const matches = groups.filter(group => groupNameKey(group.name) === key);
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * Tells whether a failure means the data on screen may be stale (fresh
 * controller data contradicted it): the fresh Open API view is then read
 * again, so the delete reasons and the capacity follow.
 * @param {GroupFailure} error - The failure.
 * @returns {boolean} True when the fresh view should be read again.
 */
export function isStaleDataFailure(error: GroupFailure): boolean {
  return (
    error === 'nameTaken' ||
    error === 'groupNotFound' ||
    error === 'groupIsDefault' ||
    error === 'groupNotEmpty' ||
    error === 'groupHasNetworks' ||
    error === 'groupStateUnknown'
  );
} // End of function isStaleDataFailure()
