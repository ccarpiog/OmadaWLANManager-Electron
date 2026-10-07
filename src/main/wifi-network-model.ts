// Wi-Fi network read model (todo.md 4.10, phase 17a; docs/management-design.md
// §2.3, §3, §4.5, §5): the validators of the three Open API SSID reads and the
// secret-free renderer DTO built from them. Pure; its only runtime import is
// the AP-group id rule of ap-group-policy.ts (itself pure and import-free at
// runtime), so OpenApiClient (openapi-client.ts), ControllerSession
// (controller-session.ts), the unit tests and the smoke stub
// (tests/smoke/stub-main.cjs, which requires the compiled module) apply exactly
// the same rules.
//
// Sources (docs/omada-openapi-ops.md; the client names every path version):
// - catalog:  GET /openapi/v2/{omadacId}/sites/{siteId}/wireless-network/ssids
//             (paged) → validateOpenApiSsid() per entry;
// - detail:   GET /openapi/v1/…/wireless-network/ssids/{ssidId}
//             → validateOpenApiSsidDetail();
// - bindings: GET /openapi/v1/…/wireless-network/ssids/{ssidId}/ap-groups
//             → validateSsidBindings().
//
// Rejected (the validator returns null; the client turns that into
// 'malformedResponse'): a catalog entry that is not a plain object, has no
// usable SSID id (`id`, or its deprecated equivalent `ssidId`; both present
// and different is rejected too) or no usable name; a detail that is not a
// plain object or does not name the requested SSID; a bindings answer that is
// not a plain object, whose `apGroups` is present but not an array, or holds
// any entry that is not an object carrying a string `id`. A list is kept whole
// or not at all — never filtered into a shorter list.
//
// Two id rules: SSID ids (SSID_ID_REGEX, a path-safe sanity rule) and bound
// AP-group ids (AP_GROUP_ID_REGEX of ap-group-policy.ts: 24 hex digits, the
// same rule the AP-group writes and their IPC guard apply). A bound id list —
// the bindings answer's or the detail's `apGroupIds` — with ANY id that is not
// 24 hex digits is dropped whole (UNRECOGNIZED: the scope becomes unknown),
// never filtered (the 16a fail-closed rule: a shorter list would look like a
// known, smaller scope).
//
// Field values: each source reports a field as "not reported" (absent or
// null), "unrecognized" (present, but not a value the ops doc defines) or a
// recognized value. A field reported by both the catalog and the detail must
// agree: disagreement, or an unrecognized value from either source, makes it
// unknown — never a default (combine()).
// - enabled: catalog per spec §5 (`ssidEnable` if boolean, else `description`
//   if boolean, else not reported); detail `ssidEnable`;
// - security: 0 open, 2 WPA-Enterprise, 3 WPA-Personal, 4 PPSK without
//   RADIUS, 5 PPSK with RADIUS;
// - bands: the `band` bit mask (bit 0 2.4 GHz, bit 1 5 GHz, bit 2 6 GHz),
//   1–7 only;
// - device selection: `chooseDevices` 0 = all devices → scope
//   'allAccessPoints'; 1 = not all devices → scope 'apGroups' with the bound
//   ids (unknown ids make the scope unknown); anything else → 'unknown',
//   never "all";
// - bound AP-group ids: the bindings answer's `apGroups[].id`, cross-checked
//   as a SET with the detail's `apGroupIds` (a non-array list, or one with any
//   entry that is not a 24-hex AP-group id, makes them unknown, and so does
//   disagreement).
//
// Secrets (spec §3): the validators read primitives of allowlisted fields
// only — they never keep an object or array of the payload — and keep of the
// passphrase nothing but a boolean (`hasSecurityKey`: `pskSetting.securityKey`
// is a non-empty string). toManagedNetwork() builds the DTO field by field
// from those values and re-checks their types, so no securityKey, PSK / PPSK
// key, RADIUS secret, description text or unknown key can reach the renderer,
// at any depth. `hasPassphrase`: true for WPA-Personal with a reported key,
// false for an open network reporting none, otherwise null (unknown: the
// detail may withhold the key — spec §5 —, and Enterprise / PPSK networks
// have no single passphrase).

import type { ManagedNetwork, NetworkBand, NetworkScope, NetworkSecurity } from '../shared/types';
import { AP_GROUP_ID_REGEX } from './ap-group-policy';

// SSID ids (an SSID's own `id` / `ssidId`). Deliberately looser than the
// AP-group rule: the ops doc types the SSID id as a plain string and states no
// format (the 24-hex rule is spec §3's for AP groups), and an SSID id never
// describes or grants a scope — it only names its own network in its own
// detail / bindings reads (one percent-encoded path segment) and in the DTO,
// and the detail must echo it. Tightening it to 24 hex on an unverified
// assumption could refuse a real controller's whole catalog; this sanity rule
// already keeps path tricks, white space and control characters out of a
// request path. To be confirmed live (phase 20); a write will re-check it
export const SSID_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

// Sanity cap on a network name as reported (the ops doc: 1 to 32 UTF-8
// characters; 128 UTF-16 code units leaves room for any such name)
export const MAX_NETWORK_NAME_LENGTH = 128;

// The most networks one read handles: every network costs two requests
// (detail + bindings), so a catalog with more is refused before any
// per-network request ('networkListIncomplete')
export const MAX_MANAGED_NETWORKS = 128;

// "Present, but not a value the ops doc defines" (see the header)
export const UNRECOGNIZED = 'unrecognized' as const;

/**
 * One source's report of a field: undefined (not reported), UNRECOGNIZED, or
 * the recognized value.
 */
export type ReportedField<T> = T | typeof UNRECOGNIZED | undefined;

/** A recognized security mode (NetworkSecurity without 'unknown'). */
export type KnownNetworkSecurity = Exclude<NetworkSecurity, 'unknown'>;

/** The device selection of an SSID (`chooseDevices`: 0 all devices, 1 not all). */
export type DeviceSelection = 'all' | 'selected';

/** One validated entry of the v2 SSID catalog (allowlisted values only). */
export interface OpenApiSsid {
  id: string;
  name: string;
  enabled: ReportedField<boolean>;
  security: ReportedField<KnownNetworkSecurity>;
  bands: ReportedField<NetworkBand[]>;
  deviceSelection: ReportedField<DeviceSelection>;
}

/**
 * One validated v1 SSID detail (allowlisted values only). Of the passphrase
 * only `hasSecurityKey` is kept: whether `pskSetting.securityKey` is a
 * non-empty string — never the key.
 */
export interface OpenApiSsidDetail {
  id: string;
  enabled: ReportedField<boolean>;
  security: ReportedField<KnownNetworkSecurity>;
  bands: ReportedField<NetworkBand[]>;
  deviceSelection: ReportedField<DeviceSelection>;
  apGroupIds: ReportedField<string[]>;
  hasSecurityKey: boolean;
}

/**
 * The validated AP-group bindings of one SSID: undefined (not reported),
 * UNRECOGNIZED (a list with an id that is not a 24-hex AP-group id: dropped
 * whole) or the bound ids.
 */
export interface OpenApiSsidBindings {
  apGroupIds: ReportedField<string[]>;
}

// The security modes of the ops doc (`security`)
const SECURITY_MODES: ReadonlyMap<number, KnownNetworkSecurity> = new Map<number, KnownNetworkSecurity>([
  [0, 'open'],
  [2, 'wpaEnterprise'],
  [3, 'wpaPersonal'],
  [4, 'ppskWithoutRadius'],
  [5, 'ppskWithRadius']
]);

// The bits of the `band` mask, in the canonical DTO order
const BAND_BITS: ReadonlyArray<readonly [number, NetworkBand]> = [
  [1, 'band2g'],
  [2, 'band5g'],
  [4, 'band6g']
];

// The highest `band` value made of the three documented bits
const MAX_BAND_MASK = 7;

/**
 * Tells whether a value is a plain object (not null, not an array).
 * @param {unknown} value - The value.
 * @returns {value is Record<string, unknown>} True for a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Tells whether a value is a usable SSID id (see SSID_ID_REGEX for why this
 * rule is looser than the AP-group one).
 * @param {unknown} value - The value.
 * @returns {value is string} True for a usable SSID id.
 */
export function isSsidId(value: unknown): value is string {
  return typeof value === 'string' && SSID_ID_REGEX.test(value);
}

/**
 * Tells whether a value is a usable bound AP-group id: 24 hex digits
 * (AP_GROUP_ID_REGEX of ap-group-policy.ts, the rule of the AP-group writes).
 * @param {unknown} value - The value.
 * @returns {value is string} True for a usable AP-group id.
 */
export function isApGroupId(value: unknown): value is string {
  return typeof value === 'string' && AP_GROUP_ID_REGEX.test(value);
}

/**
 * Tells whether a value is "not reported" (absent or null).
 * @param {unknown} value - The value.
 * @returns {boolean} True when absent or null.
 */
function isNotReported(value: unknown): value is undefined | null {
  return value === undefined || value === null;
}

/**
 * Resolves the id of an SSID answer: `id`, or its deprecated equivalent
 * `ssidId` (ops doc). When both are present they must be the same usable id.
 * @param {Record<string, unknown>} raw - The answer object.
 * @returns {string | null} The id, or null when missing, unusable or contradictory.
 */
function resolveSsidId(raw: Record<string, unknown>): string | null {
  const id = raw.id;
  const legacy = raw.ssidId;
  if (isNotReported(id)) {
    return isSsidId(legacy) ? legacy : null;
  }
  if (!isSsidId(id)) {
    return null;
  }
  return isNotReported(legacy) || legacy === id ? id : null;
} // End of function resolveSsidId()

/**
 * Reads a boolean field: not reported, the boolean, or UNRECOGNIZED.
 * @param {unknown} value - The raw value.
 * @returns {ReportedField<boolean>} The report.
 */
function readBoolean(value: unknown): ReportedField<boolean> {
  if (isNotReported(value)) {
    return undefined;
  }
  return typeof value === 'boolean' ? value : UNRECOGNIZED;
}

/**
 * Reads the catalog's enable state per spec §5: `ssidEnable` if boolean,
 * else `description` if boolean, else not reported (the detail may still
 * report it).
 * @param {Record<string, unknown>} raw - The catalog entry.
 * @returns {ReportedField<boolean>} The report (never UNRECOGNIZED).
 */
function readCatalogEnabled(raw: Record<string, unknown>): ReportedField<boolean> {
  if (typeof raw.ssidEnable === 'boolean') {
    return raw.ssidEnable;
  }
  if (typeof raw.description === 'boolean') {
    return raw.description;
  }
  return undefined;
}

/**
 * Reads `security`: one of the documented modes, else UNRECOGNIZED.
 * @param {unknown} value - The raw value.
 * @returns {ReportedField<KnownNetworkSecurity>} The report.
 */
function readSecurity(value: unknown): ReportedField<KnownNetworkSecurity> {
  if (isNotReported(value)) {
    return undefined;
  }
  return (typeof value === 'number' && SECURITY_MODES.get(value)) || UNRECOGNIZED;
}

/**
 * Reads the `band` bit mask: an integer from 1 to 7 becomes the bands in
 * canonical order; 0, a higher value or any other type is UNRECOGNIZED.
 * @param {unknown} value - The raw value.
 * @returns {ReportedField<NetworkBand[]>} The report.
 */
function readBands(value: unknown): ReportedField<NetworkBand[]> {
  if (isNotReported(value)) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_BAND_MASK) {
    return UNRECOGNIZED;
  }
  return BAND_BITS.filter(([bit]) => (value & bit) !== 0).map(([, band]) => band);
}

/**
 * Reads `chooseDevices`: 0 = all devices, 1 = not all devices, else UNRECOGNIZED.
 * @param {unknown} value - The raw value.
 * @returns {ReportedField<DeviceSelection>} The report.
 */
function readDeviceSelection(value: unknown): ReportedField<DeviceSelection> {
  if (isNotReported(value)) {
    return undefined;
  }
  if (value === 0) {
    return 'all';
  }
  return value === 1 ? 'selected' : UNRECOGNIZED;
}

/**
 * Reads a bound AP-group id list kept whole or not at all: an array whose
 * entries are all 24-hex AP-group ids (isApGroupId()) becomes a deduplicated
 * copy; a non-array or an array with any other entry is UNRECOGNIZED (never
 * filtered: the scope becomes unknown).
 * @param {unknown} value - The raw value.
 * @returns {ReportedField<string[]>} The report.
 */
function readApGroupIdList(value: unknown): ReportedField<string[]> {
  if (isNotReported(value)) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every(isApGroupId)) {
    return UNRECOGNIZED;
  }
  return [...new Set(value as string[])];
}

/**
 * Validates one entry of the v2 SSID catalog (see the header): a plain object
 * with a usable id and a non-empty name of sane length; every other field is
 * read as a report, never copied.
 * @param {unknown} entry - One raw entry of `result.data`.
 * @returns {OpenApiSsid | null} The entry, or null when it is malformed.
 */
export function validateOpenApiSsid(entry: unknown): OpenApiSsid | null {
  if (!isPlainObject(entry)) {
    return null;
  }
  const id = resolveSsidId(entry);
  const name = entry.name;
  if (id === null || typeof name !== 'string' || name === '' || name.length > MAX_NETWORK_NAME_LENGTH) {
    return null;
  }
  return {
    id,
    name,
    enabled: readCatalogEnabled(entry),
    security: readSecurity(entry.security),
    bands: readBands(entry.band),
    deviceSelection: readDeviceSelection(entry.chooseDevices)
  };
} // End of function validateOpenApiSsid()

/**
 * Validates the v1 detail `result` of one SSID (see the header): a plain
 * object naming exactly the requested SSID. Keeps the reports of the enable
 * state, security, bands, device selection and `apGroupIds`, and whether a
 * WPA-Personal key is reported — never the key or any other setting.
 * @param {unknown} result - The raw `result`.
 * @param {string} expectedId - The SSID id that was requested.
 * @returns {OpenApiSsidDetail | null} The detail, or null when it is malformed.
 */
export function validateOpenApiSsidDetail(result: unknown, expectedId: string): OpenApiSsidDetail | null {
  if (!isPlainObject(result) || resolveSsidId(result) !== expectedId) {
    return null;
  }
  const psk = result.pskSetting;
  const securityKey = isPlainObject(psk) ? psk.securityKey : undefined;
  return {
    id: expectedId,
    enabled: readBoolean(result.ssidEnable),
    security: readSecurity(result.security),
    bands: readBands(result.band),
    deviceSelection: readDeviceSelection(result.chooseDevices),
    apGroupIds: readApGroupIdList(result.apGroupIds),
    hasSecurityKey: typeof securityKey === 'string' && securityKey !== ''
  };
} // End of function validateOpenApiSsidDetail()

/**
 * Validates the v1 AP-group bindings `result` of one SSID (see the header):
 * `apGroups` absent or null is "not reported"; otherwise it must be an array
 * of objects that all carry a string `id` (else the answer is malformed).
 * Those ids are kept — deduplicated, in answer order — only when every one is
 * a 24-hex AP-group id; one that is not makes the whole list UNRECOGNIZED
 * (dropped whole, never filtered: the network's scope becomes unknown).
 * @param {unknown} result - The raw `result`.
 * @returns {OpenApiSsidBindings | null} The bindings, or null when malformed.
 */
export function validateSsidBindings(result: unknown): OpenApiSsidBindings | null {
  if (!isPlainObject(result)) {
    return null;
  }
  const groups = result.apGroups;
  if (isNotReported(groups)) {
    return { apGroupIds: undefined };
  }
  if (!Array.isArray(groups) || !groups.every((group) => isPlainObject(group) && typeof group.id === 'string')) {
    return null;
  }
  return { apGroupIds: readApGroupIdList(groups.map((group) => (group as Record<string, unknown>).id)) };
} // End of function validateSsidBindings()

/**
 * Combines the two sources' reports of one field (see the header): unknown
 * (null) when either is UNRECOGNIZED, when neither reports it, or when both
 * report different values; otherwise the reported value.
 * @param {ReportedField<T>} first - One report.
 * @param {ReportedField<T>} second - The other report.
 * @param {(a: T, b: T) => boolean} same - Equality of two recognized values.
 * @returns {T | null} The value, or null when unknown.
 */
export function combine<T>(first: ReportedField<T>, second: ReportedField<T>, same: (a: T, b: T) => boolean): T | null {
  if (first === UNRECOGNIZED || second === UNRECOGNIZED) {
    return null;
  }
  if (first === undefined) {
    return second === undefined ? null : second;
  }
  if (second === undefined) {
    return first;
  }
  return same(first, second) ? first : null;
} // End of function combine()

/**
 * Equality of two primitive values.
 * @param {T} a - One value.
 * @param {T} b - The other.
 * @returns {boolean} True when strictly equal.
 */
function samePrimitive<T>(a: T, b: T): boolean {
  return a === b;
}

/**
 * Equality of two band lists (both in canonical order).
 * @param {NetworkBand[]} a - One list.
 * @param {NetworkBand[]} b - The other.
 * @returns {boolean} True when they hold the same bands.
 */
function sameBands(a: NetworkBand[], b: NetworkBand[]): boolean {
  return a.length === b.length && a.every((band, index) => band === b[index]);
}

/**
 * Equality of two id lists as SETS (order and duplicates do not matter).
 * @param {string[]} a - One list.
 * @param {string[]} b - The other.
 * @returns {boolean} True when they hold the same ids.
 */
function sameIdSet(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * Re-checks one report handed to the DTO builder (defense in depth: the smoke
 * stub and tests may pass objects that did not come from the validators): a
 * value the guard rejects becomes UNRECOGNIZED.
 * @param {unknown} value - The report.
 * @param {(value: unknown) => value is T} guard - Recognizes a valid value.
 * @returns {ReportedField<T>} The checked report.
 */
function checked<T>(value: unknown, guard: (value: unknown) => value is T): ReportedField<T> {
  if (value === undefined || value === UNRECOGNIZED) {
    return value;
  }
  return guard(value) ? value : UNRECOGNIZED;
}

/**
 * Recognizes a boolean.
 * @param {unknown} value - The value.
 * @returns {value is boolean} True for a boolean.
 */
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Recognizes a known security mode.
 * @param {unknown} value - The value.
 * @returns {value is KnownNetworkSecurity} True for one of the documented modes.
 */
function isKnownSecurity(value: unknown): value is KnownNetworkSecurity {
  return typeof value === 'string' && [...SECURITY_MODES.values()].includes(value as KnownNetworkSecurity);
}

/**
 * Recognizes a band list: a non-empty array of distinct bands in canonical order.
 * @param {unknown} value - The value.
 * @returns {value is NetworkBand[]} True for a band list.
 */
function isBandList(value: unknown): value is NetworkBand[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  const order = BAND_BITS.map(([, band]) => band);
  const positions = value.map((band) => order.indexOf(band as NetworkBand));
  return positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]));
}

/**
 * Recognizes a device selection.
 * @param {unknown} value - The value.
 * @returns {value is DeviceSelection} True for 'all' or 'selected'.
 */
function isDeviceSelection(value: unknown): value is DeviceSelection {
  return value === 'all' || value === 'selected';
}

/**
 * Recognizes a bound AP-group id list (every entry a 24-hex AP-group id).
 * @param {unknown} value - The value.
 * @returns {value is string[]} True for an AP-group id list.
 */
function isApGroupIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isApGroupId);
}

/**
 * Decides `hasPassphrase` (see the header): true for WPA-Personal with a
 * reported key, false for an open network reporting none, null otherwise.
 * @param {NetworkSecurity} security - The resolved security mode.
 * @param {boolean} hasSecurityKey - Whether the detail reported a non-empty key.
 * @returns {boolean | null} The flag, or null when unknown.
 */
export function decideHasPassphrase(security: NetworkSecurity, hasSecurityKey: boolean): boolean | null {
  if (security === 'wpaPersonal') {
    return hasSecurityKey ? true : null;
  }
  if (security === 'open') {
    return hasSecurityKey ? null : false;
  }
  return null;
}

/**
 * Decides the scope (see the header): 'allAccessPoints' only for a device
 * selection reported as "all devices"; 'apGroups' for "not all devices" with
 * known bound ids; 'unknown' for everything else — never "all".
 * @param {DeviceSelection | null} selection - The resolved device selection.
 * @param {string[] | null} apGroupIds - The resolved bound ids.
 * @returns {NetworkScope} The scope.
 */
export function decideScope(selection: DeviceSelection | null, apGroupIds: string[] | null): NetworkScope {
  if (selection === 'all') {
    return 'allAccessPoints';
  }
  if (selection === 'selected' && apGroupIds !== null) {
    return 'apGroups';
  }
  return 'unknown';
}

/**
 * Builds the renderer DTO of one network by ALLOWLIST: every DTO field is
 * computed from the validated reports (re-checked here), nothing of the
 * payload is spread or copied — see the header.
 * @param {OpenApiSsid} entry - The validated catalog entry.
 * @param {OpenApiSsidDetail} detail - Its validated detail.
 * @param {OpenApiSsidBindings} bindings - Its validated AP-group bindings.
 * @returns {ManagedNetwork} The DTO.
 * @throws {TypeError} When the entry's id or name is not usable, or the
 *   detail names another network (a programming error).
 */
export function toManagedNetwork(entry: OpenApiSsid, detail: OpenApiSsidDetail, bindings: OpenApiSsidBindings): ManagedNetwork {
  if (!isSsidId(entry.id) || detail.id !== entry.id || typeof entry.name !== 'string' || entry.name === '' || entry.name.length > MAX_NETWORK_NAME_LENGTH) {
    throw new TypeError('Invalid network entry');
  }
  const security = combine(checked(entry.security, isKnownSecurity), checked(detail.security, isKnownSecurity), samePrimitive) ?? 'unknown';
  const bands = combine(checked(entry.bands, isBandList), checked(detail.bands, isBandList), sameBands);
  const enabled = combine(checked(entry.enabled, isBoolean), checked(detail.enabled, isBoolean), samePrimitive);
  const selection = combine(checked(entry.deviceSelection, isDeviceSelection), checked(detail.deviceSelection, isDeviceSelection), samePrimitive);
  const apGroupIds = combine(checked(bindings.apGroupIds, isApGroupIdList), checked(detail.apGroupIds, isApGroupIdList), sameIdSet);
  const scope = decideScope(selection, apGroupIds);
  return {
    id: entry.id,
    name: entry.name,
    security,
    bands: bands === null ? null : [...bands],
    enabled,
    hasPassphrase: decideHasPassphrase(security, detail.hasSecurityKey === true),
    scope,
    apGroupIds: apGroupIds === null ? null : [...new Set(apGroupIds)]
  };
} // End of function toManagedNetwork()
