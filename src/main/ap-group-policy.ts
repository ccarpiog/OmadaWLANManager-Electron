// AP-group management rules (todo.md 4.9; docs/management-design.md §3, §4.4,
// §5): the id format, the name rules, the app's delete policy and the
// renderer DTO built from validated Open API data. Pure and import-free at
// runtime (type-only imports), so the main process (controller-session.ts,
// ipc-guards.ts), the unit tests and the smoke stub (tests/smoke/stub-main.cjs,
// which requires the compiled module) apply exactly the same rules.
//
// Name rules (main-side; the renderer may pre-check, main decides):
// - the name is trimmed (String.prototype.trim(): Unicode white space);
// - 1 to MAX_AP_GROUP_NAME_LENGTH characters, counted in UTF-16 code units
//   (docs/omada-openapi-ops.md: "1 to 128 characters"; the controller is a
//   Java application, whose String.length() counts UTF-16 code units — and
//   that count is never below the code-point count, so the cap is the
//   conservative reading either way; unverified live, phase 20);
// - the ops doc states no character rules, so a conservative set is refused:
//   control characters (Unicode Cc: C0, DEL, C1 — tabs and line breaks
//   included), unpaired surrogates (Cs), the line / paragraph separators and
//   the bidirectional controls (LRM, RLM, ALM, the embeddings, overrides and
//   isolates), which could make one name display as another;
// - a name equal to another group's name is refused: APs carry only their
//   group's NAME, so two same-named groups cannot be told apart as move
//   targets (phase 13b). Names are compared after trimming, NFC normalization
//   and lower-casing (a conservative superset of exact equality; the
//   controller's own duplicate rule is unverified).
//
// Delete policy (spec §3 "App-policy deletion rules", §5: what the controller
// does with the APs of a deleted group is unknown): a group may be deleted
// only when fresh controller data shows it exists, is not the default group,
// has 0 APs and no Wi-Fi network bound to it. An AP count or network list the
// controller did not report sanely makes the policy unverifiable: refused
// ('groupStateUnknown'). Fail closed: a network list counts as known only as
// an array of strings — one with any other entry (`[null]`, `[42]`) is
// unknown, never read as "no networks"; an AP count only as a non-negative
// integer — a missing or garbage one is unknown, never read as 0.

import type { ApGroupBandValues, ApGroupOperationError, ApGroupSsidLimits, ManagedApGroup } from '../shared/types';

// AP-group ids accepted over IPC: 24 hex digits (spec §3; the controller's
// object ids, e.g. 6512a0e1f3b2c41d2e3f4a5b). A group whose id has another
// format can be listed but not renamed or deleted
export const AP_GROUP_ID_REGEX = /^[0-9A-Fa-f]{24}$/;

// The ops doc: "AP group name should contain 1 to 128 characters"
export const MAX_AP_GROUP_NAME_LENGTH = 128;

// Characters refused in a group name (see the header): control characters,
// unpaired surrogates, U+2028/U+2029, and the bidirectional controls
// (U+061C ALM, U+200E LRM, U+200F RLM, U+202A–U+202E, U+2066–U+2069).
// Wi-Fi network (SSID) names follow the same character rule
// (wifi-network-write.ts)
export const FORBIDDEN_NAME_CHARACTERS = /[\p{Cc}\p{Cs}\u{2028}\u{2029}\u{061c}\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/u;

// The keys of the Open API `remainingBinding` object per band (ops doc:
// "0:2g, 1:5g, 2:6g"); any other key is ignored (unverified, phase 20)
const REMAINING_BINDING_BANDS: ReadonlyArray<readonly [string, keyof ApGroupBandValues]> = [
  ['0', 'band2g'],
  ['1', 'band5g'],
  ['2', 'band6g']
];

/** The outcome of validateApGroupName(): the trimmed name, or a stable error code. */
export type ApGroupNameCheck = { ok: true; name: string } | { ok: false; error: 'nameRequired' | 'nameTooLong' | 'nameInvalid' };

/** Why the delete policy refuses a group (see checkApGroupDeletion()). */
export type ApGroupDeleteRefusal = Extract<
  ApGroupOperationError,
  'groupNotFound' | 'groupIsDefault' | 'groupNotEmpty' | 'groupHasNetworks' | 'groupStateUnknown'
>;

/**
 * The fields of a validated Open API AP group the rules read (OpenApiApGroup
 * in openapi-client.ts matches it structurally).
 */
export interface PolicyApGroup {
  id: string;
  name: string;
  isDefault?: true;
  apNum?: number;
  ssidNameList?: string[];
  remainingBinding?: Record<string, number>;
}

/** Per-group SSID limits as the Open API client reports them (page-level fields). */
export interface PolicyApGroupLimits {
  band2g?: number;
  band5g?: number;
  band6g?: number;
  mlo?: number;
}

/**
 * Tells whether a value is a non-negative safe integer (a count).
 * @param {unknown} value - The value.
 * @returns {value is number} True for a count.
 */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Tells whether a value is a known network-name list: an array whose entries
 * are all strings (any other entry makes the whole list unknown).
 * @param {unknown} value - The value.
 * @returns {value is string[]} True for a known list.
 */
function isNameList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((name) => typeof name === 'string');
}

/**
 * Validates a group name typed by the user (see the header): trims it and
 * checks the length and the characters.
 * @param {string} raw - The name as received (a string, shape-checked by the IPC guard).
 * @returns {ApGroupNameCheck} The trimmed name, or 'nameRequired' / 'nameTooLong' / 'nameInvalid'.
 */
export function validateApGroupName(raw: string): ApGroupNameCheck {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name === '') {
    return { ok: false, error: 'nameRequired' };
  }
  if (name.length > MAX_AP_GROUP_NAME_LENGTH) {
    return { ok: false, error: 'nameTooLong' };
  }
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) {
    return { ok: false, error: 'nameInvalid' };
  }
  return { ok: true, name };
} // End of function validateApGroupName()

/**
 * The key two group names are compared by: trimmed, NFC-normalized and
 * lower-cased (locale-independent).
 * @param {string} name - A group name.
 * @returns {string} The comparison key.
 */
export function apGroupNameKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

/**
 * Tells whether another group already has (a name equal to) `name`.
 * @param {string} name - The validated new name.
 * @param {ReadonlyArray<{ id: string; name: string }>} groups - The site's groups (fresh data).
 * @param {string} [exceptId] - The group being renamed (its own name never conflicts).
 * @returns {boolean} True when the name is taken.
 */
export function hasApGroupNameConflict(name: string, groups: ReadonlyArray<{ id: string; name: string }>, exceptId?: string): boolean {
  const key = apGroupNameKey(name);
  return groups.some((group) => group.id !== exceptId && apGroupNameKey(group.name) === key);
}

/**
 * The app's delete policy over fresh controller data (see the header). The
 * most specific reason wins: not found, default, has APs, has networks, then
 * "cannot be verified" when the AP count or the network list is missing or
 * insane (see the header: an insane list is unknown, not empty).
 * @param {PolicyApGroup | undefined} group - The group from a fresh list (undefined: not listed).
 * @returns {ApGroupDeleteRefusal | null} The refusal, or null when deleting is allowed.
 */
export function checkApGroupDeletion(group: PolicyApGroup | undefined): ApGroupDeleteRefusal | null {
  if (group === undefined) {
    return 'groupNotFound';
  }
  if (group.isDefault === true) {
    return 'groupIsDefault';
  }
  if (isCount(group.apNum) && group.apNum > 0) {
    return 'groupNotEmpty';
  }
  if (isNameList(group.ssidNameList) && group.ssidNameList.length > 0) {
    return 'groupHasNetworks';
  }
  if (!isCount(group.apNum) || !isNameList(group.ssidNameList)) {
    return 'groupStateUnknown';
  }
  return null;
} // End of function checkApGroupDeletion()

/**
 * Maps the Open API `remainingBinding` record to the per-band DTO; unknown
 * keys and insane values are left out.
 * @param {Record<string, number> | undefined} remaining - The validated record.
 * @returns {ApGroupBandValues | undefined} The bands, or undefined when none is known.
 */
export function toBandValues(remaining: Record<string, number> | undefined): ApGroupBandValues | undefined {
  if (remaining === undefined || remaining === null || typeof remaining !== 'object') {
    return undefined;
  }
  const bands: ApGroupBandValues = {};
  for (const [key, band] of REMAINING_BINDING_BANDS) {
    const value = Object.prototype.hasOwnProperty.call(remaining, key) ? remaining[key] : undefined;
    if (isCount(value)) {
      bands[band] = value;
    }
  }
  return Object.keys(bands).length > 0 ? bands : undefined;
} // End of function toBandValues()

/**
 * Builds the renderer DTO of one validated Open API AP group: only the listed
 * fields, the optional ones only when known (never invented — an insane
 * network list is left out, not shortened).
 * @param {PolicyApGroup} group - The validated group.
 * @returns {ManagedApGroup} The DTO.
 */
export function toManagedApGroup(group: PolicyApGroup): ManagedApGroup {
  const dto: ManagedApGroup = { id: group.id, name: group.name, isDefault: group.isDefault === true };
  if (isCount(group.apNum)) {
    dto.apCount = group.apNum;
  }
  if (isNameList(group.ssidNameList)) {
    dto.networkNames = [...group.ssidNameList];
  }
  const remaining = toBandValues(group.remainingBinding);
  if (remaining !== undefined) {
    dto.remainingBinding = remaining;
  }
  return dto;
} // End of function toManagedApGroup()

/**
 * Builds the SSID-limits DTO from the client's page-level limits; only sane
 * counts are kept.
 * @param {PolicyApGroupLimits | undefined} limits - The limits.
 * @returns {ApGroupSsidLimits | undefined} The DTO, or undefined when none is known.
 */
export function toApGroupSsidLimits(limits: PolicyApGroupLimits | undefined): ApGroupSsidLimits | undefined {
  if (limits === undefined || limits === null || typeof limits !== 'object') {
    return undefined;
  }
  const dto: ApGroupSsidLimits = {};
  for (const key of ['band2g', 'band5g', 'band6g', 'mlo'] as const) {
    if (isCount(limits[key])) {
      dto[key] = limits[key];
    }
  }
  return Object.keys(dto).length > 0 ? dto : undefined;
} // End of function toApGroupSsidLimits()
