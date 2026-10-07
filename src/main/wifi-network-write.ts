// Wi-Fi network writes (todo.md 4.11, phase 18a; docs/management-design.md
// §3, §4.5, §5): the rules and the request bodies of the Open API SSID
// writes. Pure; its only runtime imports are the name-character and AP-group
// id rules of ap-group-policy.ts (itself pure and import-free at runtime), so
// ControllerSession (controller-session.ts), OpenApiClient
// (openapi-client.ts), the IPC guards (ipc-guards.ts), the unit tests and the
// smoke stub (tests/smoke/stub-main.cjs, which requires the compiled module)
// apply exactly the same rules.
//
// Writes (docs/omada-openapi-ops.md; OpenApiClient names every path version):
// - create:       POST   /openapi/v2/{omadacId}/sites/{siteId}/wireless-network/ssids
//                 → buildCreateSsidBody();
// - basic config: PATCH  /openapi/v1/…/wireless-network/ssids/{ssidId}/basic-config
//                 → mergeBasicConfig(), for an edit AND for "Change password":
//                 the ops doc has no dedicated password operation, so a new
//                 passphrase is a basic-config save carrying it;
// - enable:       PATCH  /openapi/v1/…/wireless-network/ssids/{ssidId}/enable,
//                 exactly {ssidEnable} (buildEnableBody());
// - delete:       DELETE /openapi/v1/…/wireless-network/ssids/{ssidId}, no body.
//
// Rules (main decides; the renderer may pre-check):
// - SSID name: trimmed (String.prototype.trim()); 1 to MAX_SSID_NAME_BYTES
//   BYTES of UTF-8 (the ops doc says "1 to 32 UTF-8 characters", and its
//   errorCode -33240 "The SSID name should be between 1 and 32 bytes": the
//   802.11 SSID limit, so bytes are counted); the character rule of AP-group
//   names (ap-group-policy.ts: no control, unpaired surrogate,
//   line / paragraph separator or bidirectional-control character);
// - passphrase (WPA-Personal `pskSetting.securityKey`): 8 to 63 printable
//   ASCII characters (U+0020–U+007E), taken as typed — never trimmed (the ops
//   doc: "8-63 printable ASCII characters or 8-63 hexadecimal digits"; hex
//   digits are printable ASCII, and a 64-hex-digit raw key is NOT accepted).
//   An empty passphrase counts as "not typed";
// - security: only open (0) and WPA-Personal (3) are written; Enterprise (2),
//   PPSK (4, 5) and any unknown mode are refused ('unsupportedSecurity'),
//   whether the renderer asks for one or the FRESH detail reports one;
// - a passphrase goes into a body only when the user typed one (spec §3):
//   the key the detail reports is never copied into a body, and every save
//   whose result is WPA-Personal needs a typed one ('passphraseRequired') —
//   the detail may return the key masked or not at all (unverified, spec §5),
//   and a masked key echoed back could become the new password. A typed
//   passphrase for an open result is refused ('passphraseNotApplicable').
//
// Read-merge-write (spec §3). The basic-config endpoint covers the BASIC
// settings of a network only: exactly the fields of BASIC_CONFIG_SCHEMA, the
// documented request schema of PATCH …/basic-config, top level AND nested
// (pinned against docs/omada-openapi-ops.md by a unit test). Rate limits,
// schedules, rate control, MAC filtering, multicast, DHCP option 82, band
// steering, Hotspot 2.0, Wi-Fi calling, the AP-group bindings, the device
// selection and the enable state are NOT part of that body: they are separate
// SSID settings with endpoints of their own, which this app never calls.
// mergeBasicConfig() starts from the FRESH detail the controller returned for
// the network and copies exactly the schema's fields the detail reports,
// verbatim (nulls included); nested objects — `vlanSetting` with its
// `customConfig`, `CondBroadcastCtrl`, `pskSetting` — are copied whole with
// exactly their documented fields (`lanNetworkVlanIds` is a data map, copied
// whole). A key the schema does not document, top level or nested, is never
// sent, whatever the detail carries; an optional field the detail does not
// report stays absent (never invented). Then only the edited fields are
// applied on top (name, bands, security, passphrase — plus the dependents of
// a security / band change, below). Refused as 'networkStateUnknown', nothing
// sent: a detail that lacks a field the schema marks required (`name`,
// `band`, `guestNetEnable`, `security`, `broadcast`, `vlanEnable`,
// `mloEnable`, `pmfMode`, `enable11r`; for a WPA-Personal network
// `pskSetting.versionPsk`, `encryptionPsk`, `gikRekeyPskEnable`) and the edit
// does not supply, or that reports any schema field (or a documented nested
// field) with the wrong type — an unedited field is never given a default.
// The Enterprise / PPSK settings (`entSetting`, `ppskSetting`) are never sent
// (those modes are refused), nor `pskSetting` for an open result; a
// WPA-Personal result's `pskSetting` is the detail's, minus its key, plus the
// typed passphrase.
//
// Security and bands are ONE dependent change: deriveSecurityDependents()
// (shared by the create and the edits) decides `versionPsk`, `encryptionPsk`,
// `pmfMode` and `oweEnable` for the resulting security + bands. Rules — the
// ops doc: `versionPsk` 4 is WPA2-PSK/WPA3-SAE (WPA3-SAE on a 6 GHz-only
// network), WPA3-SAE requires AES, Enhanced IoT Connectivity only with 5 GHz
// and 6 GHz off and `versionPsk` ≠ 4; the Wi-Fi standards where the doc is
// silent: 6 GHz requires WPA3-SAE or OWE with PMF mandatory, WPA3-SAE alone
// requires PMF mandatory, WPA2/WPA3 transition mode uses PMF capable (WFA:
// capable, not required), WPA2-only (and WPA / WPA+WPA2) is never PMF
// mandatory, OWE requires PMF, and an open network without OWE has no keys
// to protect management frames. "kept" = the fresh value when it is allowed
// for the result; otherwise (and for a create) the value after "else":
//
//   result                            versionPsk              encryptionPsk          pmfMode                      oweEnable
//   WPA-Personal, 6 GHz only          4 (WPA3-SAE)            3 (AES)                1 (Mandatory)                false if it was on
//   WPA-Personal, 6 GHz + 2.4 / 5     4 (WPA2-PSK/WPA3-SAE)   3 (AES)                2 (Capable)                  false if it was on
//   WPA-Personal, no 6 GHz            kept 1–4, else 2        v4: 3; kept 1/3, else 3  v4: 2; kept 2/3, else 2   false if it was on
//   open, 6 GHz                       —                       —                      1 (Mandatory)                true
//   open, no 6 GHz, OWE on            —                       —                      1 (Mandatory)                kept
//   open, no 6 GHz, OWE off / absent  —                       —                      3 (Disabled)                 kept (absent stays absent)
//
// An edit derives them only when the security or the bands actually change;
// an edit of the name or the passphrase alone sends every dependent exactly
// as the fresh detail reports it. A user setting outside the editable set
// that conflicts with the result is never flipped: Enhanced IoT Connectivity
// on while the result has 5 / 6 GHz or `versionPsk` 4 is refused
// ('securityBandConflict', diagnostic "conflict: enhancedIotConnectivity").
// The create request documents no `oweEnable`, so an open network that
// includes 6 GHz cannot be created consistently: refused
// ('securityBandConflict', diagnostic "conflict: oweEnable") — create it
// without 6 GHz, then add 6 GHz with an edit (basic-config carries
// `oweEnable`). A WPA-Personal create always uses WPA2-PSK / AES without
// 6 GHz. The table's values are app decisions, unverified live (phase 20).

import type { NetworkBand, NetworkOperationError, NetworkSecurity, WritableNetworkSecurity } from '../shared/types';
import { AP_GROUP_ID_REGEX, FORBIDDEN_NAME_CHARACTERS } from './ap-group-policy';

// SSID names: at most 32 bytes of UTF-8 (see the header)
export const MAX_SSID_NAME_BYTES = 32;

// WPA-Personal passphrases: 8 to 63 printable ASCII characters (see the header)
export const MIN_PASSPHRASE_LENGTH = 8;
export const MAX_PASSPHRASE_LENGTH = 63;
const PASSPHRASE_REGEX = /^[\x20-\x7e]+$/;

// Every NetworkSecurity value (the IPC enum guard accepts exactly these; the
// write rules accept only WRITABLE_SECURITY_CODES)
export const NETWORK_SECURITIES: readonly NetworkSecurity[] = ['open', 'wpaEnterprise', 'wpaPersonal', 'ppskWithoutRadius', 'ppskWithRadius', 'unknown'];

// The Open API `security` codes of the writable modes (ops doc: 0 None,
// 3 WPA-Personal)
export const SECURITY_OPEN = 0;
export const SECURITY_WPA_PERSONAL = 3;
const WRITABLE_SECURITY_CODES: ReadonlyMap<WritableNetworkSecurity, number> = new Map<WritableNetworkSecurity, number>([
  ['open', SECURITY_OPEN],
  ['wpaPersonal', SECURITY_WPA_PERSONAL]
]);

// The bands of the `band` bit mask in canonical order (the same bits as
// wifi-network-model.ts: bit 0 2.4 GHz, bit 1 5 GHz, bit 2 6 GHz)
export const NETWORK_BANDS: readonly NetworkBand[] = ['band2g', 'band5g', 'band6g'];
const BAND_BITS: ReadonlyMap<NetworkBand, number> = new Map<NetworkBand, number>([
  ['band2g', 1],
  ['band5g', 2],
  ['band6g', 4]
]);
const BAND_5G_BIT = 2;
const BAND_6G_BIT = 4;

/** The JSON type of a documented request field ("integer": a safe integer). */
export type SchemaFieldType = 'string' | 'integer' | 'boolean' | 'object';

/**
 * One documented request field: its key, its JSON type, whether the ops doc
 * marks it required (`*`), and — for an object with documented fields —
 * those fields (an object without them is a data map, copied whole).
 */
export interface SchemaField {
  readonly key: string;
  readonly type: SchemaFieldType;
  readonly required: boolean;
  readonly fields?: readonly SchemaField[];
}

/**
 * A required field of a request schema.
 * @param {string} key - The key.
 * @param {SchemaFieldType} type - Its JSON type.
 * @param {readonly SchemaField[]} [fields] - Its documented fields (objects).
 * @returns {SchemaField} The field.
 */
function required(key: string, type: SchemaFieldType, fields?: readonly SchemaField[]): SchemaField {
  return fields === undefined ? { key, type, required: true } : { key, type, required: true, fields };
}

/**
 * An optional field of a request schema.
 * @param {string} key - The key.
 * @param {SchemaFieldType} type - Its JSON type.
 * @param {readonly SchemaField[]} [fields] - Its documented fields (objects).
 * @returns {SchemaField} The field.
 */
function optional(key: string, type: SchemaFieldType, fields?: readonly SchemaField[]): SchemaField {
  return fields === undefined ? { key, type, required: false } : { key, type, required: false, fields };
}

// The documented fields of `pskSetting` (WPA-Personal)
const PSK_SETTING_FIELDS: readonly SchemaField[] = [
  optional('securityKey', 'string'),
  required('versionPsk', 'integer'),
  required('encryptionPsk', 'integer'),
  required('gikRekeyPskEnable', 'boolean'),
  optional('rekeyPskInterval', 'integer'),
  optional('intervalPskType', 'integer')
];

// The documented request schema of PATCH …/ssids/{ssidId}/basic-config
// (docs/omada-openapi-ops.md), top level and nested, in documented order: the
// merge copies exactly these fields from the fresh detail (see the header).
// `entSetting` / `ppskSetting` are listed because the schema documents them;
// this app never sends them (only open and WPA-Personal are written).
export const BASIC_CONFIG_SCHEMA: readonly SchemaField[] = [
  required('name', 'string'),
  required('band', 'integer'),
  optional('autoWanAccess', 'boolean'),
  required('guestNetEnable', 'boolean'),
  required('security', 'integer'),
  optional('oweEnable', 'boolean'),
  required('broadcast', 'boolean'),
  required('vlanEnable', 'boolean'),
  optional('vlanId', 'integer'),
  optional('pskSetting', 'object', PSK_SETTING_FIELDS),
  optional('entSetting', 'object', [
    required('radiusProfileId', 'string'),
    required('versionEnt', 'integer'),
    required('encryptionEnt', 'integer'),
    required('gikRekeyEntEnable', 'boolean'),
    optional('rekeyEntInterval', 'integer'),
    optional('intervalEntType', 'integer'),
    optional('nasIdMode', 'integer'),
    optional('nasId', 'string')
  ]),
  optional('ppskSetting', 'object', [
    optional('ppskProfileId', 'string'),
    optional('radiusProfileId', 'string'),
    optional('macFormat', 'integer'),
    optional('nasId', 'string'),
    optional('type', 'integer')
  ]),
  required('mloEnable', 'boolean'),
  required('pmfMode', 'integer'),
  required('enable11r', 'boolean'),
  optional('hidePwd', 'boolean'),
  optional('greEnable', 'boolean'),
  optional('vlanSetting', 'object', [
    required('mode', 'integer'),
    optional('customConfig', 'object', [
      required('customMode', 'integer'),
      optional('lanNetworkId', 'string'),
      optional('bridgeVlan', 'integer'),
      optional('vlanId', 'integer'),
      optional('lanNetworkVlanIds', 'object'),
      optional('vlanPoolIds', 'string')
    ])
  ]),
  optional('prohibitWifiShare', 'boolean'),
  optional('enhancedIotConnectivity', 'boolean'),
  optional('CondBroadcastCtrl', 'object', [
    optional('enable', 'boolean'),
    optional('condition', 'integer'),
    optional('upTime', 'integer'),
    optional('downTime', 'integer')
  ])
];

// The top-level keys of the basic-config request, in documented order
export const BASIC_CONFIG_KEYS: readonly string[] = BASIC_CONFIG_SCHEMA.map((field) => field.key);

// Request keys never copied from the detail: the Enterprise / PPSK settings
// (modes this app never writes) and `pskSetting` (rebuilt by the merge)
const NOT_COPIED_KEYS: ReadonlySet<string> = new Set(['entSetting', 'ppskSetting', 'pskSetting']);

// The stored key is never copied out of a detail's `pskSetting`
const KEY_FIELDS: ReadonlySet<string> = new Set(['securityKey']);

// The `pmfMode` values (ops doc: 1 Mandatory, 2 Capable, 3 Disable)
const PMF_MANDATORY = 1;
const PMF_CAPABLE = 2;
const PMF_DISABLED = 3;

// The `pskSetting` values (ops doc): versionPsk 1 WPA-PSK, 2 WPA2-PSK,
// 3 WPA/WPA2-PSK, 4 WPA2-PSK/WPA3-SAE (WPA3-SAE on a 6 GHz-only network);
// encryptionPsk 1 Auto, 3 AES
const PSK_VERSIONS: readonly number[] = [1, 2, 3, 4];
const PSK_ENCRYPTIONS: readonly number[] = [1, 3];
const PSK_WPA2 = 2;
const PSK_WPA2_WPA3 = 4;
const PSK_AES = 3;
// The group-key update of a network that gets WPA-Personal settings first
// (a create, or an open network switching): off (app default)
const DEFAULT_GIK_REKEY = false;

// `deviceType` of a created network: bit 0 = EAPs (access points) only
const DEVICE_TYPE_EAP = 1;
// `chooseDevices` of a created network: 1 = the given AP groups, not "all devices"
const CHOOSE_SELECTED_DEVICES = 1;

/** The Wi-Fi network writes (diagnostics and the controller error-code table). */
export type NetworkWriteOperation = 'create' | 'update' | 'password' | 'enable' | 'delete';

// The documented, operation-specific controller errorCodes of the SSID
// writes (docs/omada-openapi-ops.md) and the stable codes they map to; every
// other failure is 'requestFailed' (its code stays in the diagnostic).
// Unverified live (phase 20). -33217 "Invalid SSID security mode", -33219
// "This SSID already exists", -33231 "The ssid's name should not be the same
// with emergency ssid", -33238 "The number of SSIDs on %band% has reached the
// limit", -33240 "The SSID name should be between 1 and 32 bytes"
const NAME_AND_SECURITY_ERRORS: ReadonlyArray<readonly [number, NetworkOperationError]> = [
  [-33217, 'unsupportedSecurity'],
  [-33219, 'nameTaken'],
  [-33231, 'nameTaken'],
  [-33240, 'nameTooLong']
];
export const NETWORK_CONTROLLER_ERRORS: Record<NetworkWriteOperation, ReadonlyMap<number, NetworkOperationError>> = {
  create: new Map<number, NetworkOperationError>(NAME_AND_SECURITY_ERRORS),
  update: new Map<number, NetworkOperationError>([...NAME_AND_SECURITY_ERRORS, [-33238, 'bandLimitReached']]),
  password: new Map<number, NetworkOperationError>([...NAME_AND_SECURITY_ERRORS, [-33238, 'bandLimitReached']]),
  enable: new Map<number, NetworkOperationError>(),
  delete: new Map<number, NetworkOperationError>()
};

/** A refusal of the write rules (a stable code; a codes-only diagnostic for a conflict). */
export interface WriteRefusal {
  ok: false;
  error: NetworkOperationError;
  diagnostic?: string;
}

/** The outcome of validateSsidName(): the trimmed name, or a stable error code. */
export type SsidNameCheck = { ok: true; name: string } | { ok: false; error: 'nameRequired' | 'nameTooLong' | 'nameInvalid' };

/** The outcome of validatePassphrase(): the passphrase as typed, or 'passphraseInvalid'. */
export type PassphraseCheck = { ok: true; passphrase: string } | { ok: false; error: 'passphraseInvalid' };

/**
 * The settings that depend on the security mode and the bands (see the
 * header's table): `versionPsk` / `encryptionPsk` for a WPA-Personal result
 * only; `oweEnable` only when the result requires a value (absent: unchanged).
 */
export interface SecurityDependents {
  versionPsk?: number;
  encryptionPsk?: number;
  pmfMode: number;
  oweEnable?: boolean;
}

/** The fresh values deriveSecurityDependents() keeps when they stay allowed (an edit). */
export interface CurrentSecuritySettings {
  versionPsk?: unknown;
  encryptionPsk?: unknown;
  pmfMode?: unknown;
  oweEnable?: unknown;
  enhancedIotConnectivity?: unknown;
}

/** The outcome of deriveSecurityDependents(): the dependents, or a 'securityBandConflict'. */
export type SecurityDerivation = { ok: true; dependents: SecurityDependents } | WriteRefusal;

/** A create request as the renderer sent it (shape-checked by the IPC guard). */
export interface NetworkCreateInput {
  name: string;
  security: NetworkSecurity;
  bands: readonly NetworkBand[];
  apGroupIds: readonly string[];
  passphrase?: string;
}

/** A create that passed every rule: the values its body is built from. */
export interface CheckedNetworkCreate {
  name: string;
  security: number;
  bandMask: number;
  apGroupIds: string[];
  dependents: SecurityDependents;
  passphrase?: string;
}

/** The edited fields of a basic-config save as the renderer sent them. */
export interface NetworkEditsInput {
  name?: string;
  security?: NetworkSecurity;
  bands?: readonly NetworkBand[];
  passphrase?: string;
}

/** Edited fields that passed the rules (only the edited ones are present). */
export interface CheckedNetworkEdits {
  name?: string;
  security?: number;
  bandMask?: number;
  passphrase?: string;
}

/** The outcome of mergeBasicConfig(): the full basic-config body, or a refusal. */
export type BasicConfigMerge = { ok: true; body: Record<string, unknown> } | WriteRefusal;

/**
 * Builds a refusal.
 * @param {NetworkOperationError} error - The stable code.
 * @param {string} [diagnostic] - A codes-only diagnostic (a conflict's field).
 * @returns {WriteRefusal} The refusal.
 */
function refuse(error: NetworkOperationError, diagnostic?: string): WriteRefusal {
  return diagnostic === undefined ? { ok: false, error } : { ok: false, error, diagnostic };
}

/**
 * The 'securityBandConflict' refusal naming the conflicting field.
 * @param {string} field - The conflicting field's key.
 * @returns {WriteRefusal} The refusal.
 */
function conflict(field: string): WriteRefusal {
  return refuse('securityBandConflict', `conflict: ${field}`);
}

/**
 * Tells whether a value is a plain object (not null, not an array).
 * @param {unknown} value - The value.
 * @returns {value is Record<string, unknown>} True for a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Tells whether a value is a safe integer within [min, max].
 * @param {unknown} value - The value.
 * @param {number} min - Lowest allowed value.
 * @param {number} max - Highest allowed value.
 * @returns {value is number} True when in range.
 */
function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

/**
 * Tells whether a value has a documented JSON type.
 * @param {unknown} value - The value (not null / undefined).
 * @param {SchemaFieldType} type - The type.
 * @returns {boolean} True when it has it.
 */
function hasFieldType(value: unknown, type: SchemaFieldType): boolean {
  if (type === 'integer') {
    return typeof value === 'number' && Number.isSafeInteger(value);
  }
  if (type === 'object') {
    return isPlainObject(value);
  }
  return typeof value === type;
}

/**
 * Copies exactly the documented fields of a request schema an object
 * reports (own, not undefined), verbatim (nulls included, deep copies):
 * an object field with documented fields is copied with exactly those,
 * recursively; anything else (a data map, a value of the wrong type) whole.
 * @param {Record<string, unknown>} source - The object (a fresh detail or one of its objects).
 * @param {readonly SchemaField[]} fields - The documented fields.
 * @param {ReadonlySet<string>} [skip] - Top-level keys not to copy.
 * @returns {Record<string, unknown>} The copy.
 */
function copyDocumentedFields(source: Record<string, unknown>, fields: readonly SchemaField[], skip?: ReadonlySet<string>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const field of fields) {
    if (skip?.has(field.key) || !Object.prototype.hasOwnProperty.call(source, field.key) || source[field.key] === undefined) {
      continue;
    }
    const value = source[field.key];
    copy[field.key] = field.fields !== undefined && isPlainObject(value) ? copyDocumentedFields(value, field.fields) : structuredClone(value);
  }
  return copy;
} // End of function copyDocumentedFields()

/**
 * Tells whether an object matches a request schema: every field it carries
 * (not null / undefined) has its documented type and — for an object with
 * documented fields — matches them, required ones included; with
 * `enforceRequired`, every required field of this level is present and not
 * null.
 * @param {Record<string, unknown>} value - The object.
 * @param {readonly SchemaField[]} fields - The documented fields.
 * @param {boolean} enforceRequired - Whether this level's required fields must be present.
 * @returns {boolean} True when it matches.
 */
function matchesSchema(value: Record<string, unknown>, fields: readonly SchemaField[], enforceRequired: boolean): boolean {
  for (const field of fields) {
    const entry = value[field.key];
    if (entry === undefined || entry === null) {
      if (enforceRequired && field.required) {
        return false;
      }
      continue;
    }
    if (!hasFieldType(entry, field.type)) {
      return false;
    }
    if (field.fields !== undefined && !matchesSchema(entry as Record<string, unknown>, field.fields, true)) {
      return false;
    }
  } // End of the loop over the documented fields
  return true;
} // End of function matchesSchema()

/**
 * Counts the bytes of a text encoded as UTF-8, code point by code point (an
 * unpaired surrogate counts as the 3 bytes of its U+FFFD replacement; the
 * name rule refuses those anyway).
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
 * Validates an SSID name typed by the user (see the header): trims it, then
 * checks it is not blank, at most MAX_SSID_NAME_BYTES bytes of UTF-8 and free
 * of the refused characters.
 * @param {unknown} raw - The name as received (a string, shape-checked by the IPC guard).
 * @returns {SsidNameCheck} The trimmed name, or 'nameRequired' / 'nameTooLong' / 'nameInvalid'.
 */
export function validateSsidName(raw: unknown): SsidNameCheck {
  const name = typeof raw === 'string' ? raw.trim() : '';
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
} // End of function validateSsidName()

/**
 * Validates a typed WPA-Personal passphrase (see the header): 8 to 63
 * printable ASCII characters, as typed (never trimmed).
 * @param {unknown} raw - The passphrase as received.
 * @returns {PassphraseCheck} The passphrase, or 'passphraseInvalid'.
 */
export function validatePassphrase(raw: unknown): PassphraseCheck {
  if (
    typeof raw !== 'string' ||
    raw.length < MIN_PASSPHRASE_LENGTH ||
    raw.length > MAX_PASSPHRASE_LENGTH ||
    !PASSPHRASE_REGEX.test(raw)
  ) {
    return { ok: false, error: 'passphraseInvalid' };
  }
  return { ok: true, passphrase: raw };
} // End of function validatePassphrase()

/**
 * Tells whether a passphrase was typed: a non-empty string (an empty one, or
 * none, means "not typed").
 * @param {unknown} raw - The passphrase field.
 * @returns {raw is string} True when typed.
 */
export function isTypedPassphrase(raw: unknown): raw is string {
  return typeof raw === 'string' && raw !== '';
}

/**
 * The Open API `security` code of a writable mode.
 * @param {unknown} security - The requested mode.
 * @returns {number | null} 0 (open) or 3 (WPA-Personal); null for any other
 *   mode (Enterprise, PPSK, unknown, garbage).
 */
export function writableSecurityCode(security: unknown): number | null {
  return WRITABLE_SECURITY_CODES.get(security as WritableNetworkSecurity) ?? null;
}

/**
 * The `band` bit mask of a band list (duplicates ignored).
 * @param {readonly NetworkBand[]} bands - The bands.
 * @returns {number | null} The mask (1–7), or null when no known band is listed.
 */
export function toBandMask(bands: readonly NetworkBand[]): number | null {
  let mask = 0;
  for (const band of Array.isArray(bands) ? bands : []) {
    mask |= BAND_BITS.get(band) ?? 0;
  }
  return mask === 0 ? null : mask;
}

/**
 * A fresh value when it is one of the allowed ones, else the fallback.
 * @param {unknown} value - The fresh value (absent for a create).
 * @param {readonly number[]} allowed - The values allowed for the result.
 * @param {number} fallback - The table's value.
 * @returns {number} The value to send.
 */
function keptIfAllowed(value: unknown, allowed: readonly number[], fallback: number): number {
  return typeof value === 'number' && allowed.includes(value) ? value : fallback;
}

/**
 * Decides the settings that depend on the security mode and the bands, for
 * a create (no `current`) and for an edit that changes the security or the
 * bands (`current`: the fresh values) — the derivation table of the header:
 * a fresh value is kept while it stays allowed for the result, otherwise the
 * table's value is used. Refused ('securityBandConflict', the diagnostic
 * names the field) when Enhanced IoT Connectivity is on while the result has
 * 5 / 6 GHz or `versionPsk` 4, and for a create of an open network that
 * includes 6 GHz (it needs OWE, which the create request cannot carry).
 * @param {number} security - The resulting `security` (0 or 3).
 * @param {number} bandMask - The resulting `band` mask (1–7).
 * @param {CurrentSecuritySettings} [current] - The fresh values (an edit); absent for a create.
 * @returns {SecurityDerivation} The dependents, or the conflict.
 */
export function deriveSecurityDependents(security: number, bandMask: number, current?: CurrentSecuritySettings): SecurityDerivation {
  const fresh: CurrentSecuritySettings = current ?? {};
  const has6g = (bandMask & BAND_6G_BIT) !== 0;
  const only6g = bandMask === BAND_6G_BIT;
  const iotOn = fresh.enhancedIotConnectivity === true;
  if (iotOn && (bandMask & (BAND_5G_BIT | BAND_6G_BIT)) !== 0) {
    return conflict('enhancedIotConnectivity');
  }
  if (security === SECURITY_OPEN) {
    if (has6g && current === undefined) {
      return conflict('oweEnable');
    }
    // OWE (forced on 6 GHz) requires PMF; without it there is nothing to protect
    const pmfMode = has6g || fresh.oweEnable === true ? PMF_MANDATORY : PMF_DISABLED;
    return { ok: true, dependents: has6g ? { pmfMode, oweEnable: true } : { pmfMode } };
  }
  const versionPsk = has6g ? PSK_WPA2_WPA3 : keptIfAllowed(fresh.versionPsk, PSK_VERSIONS, PSK_WPA2);
  if (iotOn && versionPsk === PSK_WPA2_WPA3) {
    return conflict('enhancedIotConnectivity');
  }
  const encryptionPsk = versionPsk === PSK_WPA2_WPA3 ? PSK_AES : keptIfAllowed(fresh.encryptionPsk, PSK_ENCRYPTIONS, PSK_AES);
  let pmfMode: number;
  if (versionPsk === PSK_WPA2_WPA3) {
    // WPA3-SAE alone (6 GHz only): mandatory; WPA2/WPA3 transition: capable
    pmfMode = only6g ? PMF_MANDATORY : PMF_CAPABLE;
  } else {
    pmfMode = keptIfAllowed(fresh.pmfMode, [PMF_CAPABLE, PMF_DISABLED], PMF_CAPABLE);
  }
  const dependents: SecurityDependents = { versionPsk, encryptionPsk, pmfMode };
  if (fresh.oweEnable === true) {
    // OWE belongs to open networks only
    dependents.oweEnable = false;
  }
  return { ok: true, dependents };
} // End of function deriveSecurityDependents()

/**
 * Checks a create request against every rule that needs no controller data
 * (see the header), in this order: the name, the security mode, the bands,
 * the security + band combination (deriveSecurityDependents()), the AP
 * groups (at least one, every id 24 hex digits; duplicates dropped), then the
 * passphrase (required and valid for WPA-Personal, refused for open). Nothing
 * is sent for a refused create.
 * @param {NetworkCreateInput} input - The request's fields.
 * @returns {{ ok: true; create: CheckedNetworkCreate } | WriteRefusal} The checked create, or a refusal.
 */
export function checkNetworkCreate(input: NetworkCreateInput): { ok: true; create: CheckedNetworkCreate } | WriteRefusal {
  const name = validateSsidName(input.name);
  if (!name.ok) {
    return refuse(name.error);
  }
  const security = writableSecurityCode(input.security);
  if (security === null) {
    return refuse('unsupportedSecurity');
  }
  const bandMask = toBandMask(input.bands);
  if (bandMask === null) {
    return refuse('bandsRequired');
  }
  const derived = deriveSecurityDependents(security, bandMask);
  if (!derived.ok) {
    return derived;
  }
  const groupIds = Array.isArray(input.apGroupIds) ? [...new Set(input.apGroupIds)] : [];
  if (groupIds.length === 0) {
    return refuse('groupsRequired');
  }
  if (!groupIds.every((id) => typeof id === 'string' && AP_GROUP_ID_REGEX.test(id))) {
    return refuse('groupNotFound');
  }
  const create: CheckedNetworkCreate = { name: name.name, security, bandMask, apGroupIds: groupIds, dependents: derived.dependents };
  const typed = isTypedPassphrase(input.passphrase);
  if (security === SECURITY_OPEN) {
    return typed ? refuse('passphraseNotApplicable') : { ok: true, create };
  }
  if (!typed) {
    return refuse('passphraseRequired');
  }
  const passphrase = validatePassphrase(input.passphrase);
  if (!passphrase.ok) {
    return refuse(passphrase.error);
  }
  create.passphrase = passphrase.passphrase;
  return { ok: true, create };
} // End of function checkNetworkCreate()

/**
 * Builds the body of `POST /openapi/v2/…/wireless-network/ssids` for a checked
 * create: every field the ops doc marks required (`name`, `deviceType`,
 * `band`, `guestNetEnable`, `security`, `broadcast`, `vlanEnable`,
 * `mloEnable`, `pmfMode`, `enable11r`, `hidePwd`; for WPA-Personal
 * `pskSetting` with `securityKey`, `versionPsk`, `encryptionPsk`,
 * `gikRekeyPskEnable`), plus `ssidEnable: false` (created DISABLED, spec
 * §4.5), `chooseDevices: 1` and `apGroupIds` (bound to the given AP groups).
 * The other settings are app defaults: access points only (`deviceType` 1),
 * broadcast (not hidden), no guest network, no VLAN, no MLO, no 802.11r, the
 * password not hidden, no group-key update, and the PMF / WPA settings of
 * the derivation table (checkNetworkCreate() → deriveSecurityDependents()).
 * An open network carries no `pskSetting`.
 * @param {CheckedNetworkCreate} create - The checked create (checkNetworkCreate()).
 * @returns {Record<string, unknown>} The body.
 */
export function buildCreateSsidBody(create: CheckedNetworkCreate): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: create.name,
    deviceType: DEVICE_TYPE_EAP,
    ssidEnable: false,
    chooseDevices: CHOOSE_SELECTED_DEVICES,
    apGroupIds: [...create.apGroupIds],
    band: create.bandMask,
    guestNetEnable: false,
    security: create.security,
    broadcast: true,
    vlanEnable: false,
    mloEnable: false,
    pmfMode: create.dependents.pmfMode,
    enable11r: false,
    hidePwd: false
  };
  if (create.security === SECURITY_WPA_PERSONAL && create.passphrase !== undefined) {
    body.pskSetting = {
      securityKey: create.passphrase,
      versionPsk: create.dependents.versionPsk,
      encryptionPsk: create.dependents.encryptionPsk,
      gikRekeyPskEnable: DEFAULT_GIK_REKEY
    };
  }
  return body;
} // End of function buildCreateSsidBody()

/**
 * Checks the edited fields of a basic-config save against every rule that
 * needs no controller data, in this order: at least one edited field
 * ('nothingToChange'), the name, the security mode (open / WPA-Personal only),
 * the bands, then the passphrase's format when one was typed. Whether the
 * passphrase is required or not applicable depends on the fresh detail
 * (mergeBasicConfig()).
 * @param {NetworkEditsInput} edits - The edited fields as sent.
 * @returns {{ ok: true; edits: CheckedNetworkEdits } | WriteRefusal} The checked edits, or a refusal.
 */
export function checkNetworkEdits(edits: NetworkEditsInput): { ok: true; edits: CheckedNetworkEdits } | WriteRefusal {
  const typed = isTypedPassphrase(edits.passphrase);
  if (edits.name === undefined && edits.security === undefined && edits.bands === undefined && !typed) {
    return refuse('nothingToChange');
  }
  const checked: CheckedNetworkEdits = {};
  if (edits.name !== undefined) {
    const name = validateSsidName(edits.name);
    if (!name.ok) {
      return refuse(name.error);
    }
    checked.name = name.name;
  }
  if (edits.security !== undefined) {
    const security = writableSecurityCode(edits.security);
    if (security === null) {
      return refuse('unsupportedSecurity');
    }
    checked.security = security;
  }
  if (edits.bands !== undefined) {
    const bandMask = toBandMask(edits.bands);
    if (bandMask === null) {
      return refuse('bandsRequired');
    }
    checked.bandMask = bandMask;
  }
  if (typed) {
    const passphrase = validatePassphrase(edits.passphrase);
    if (!passphrase.ok) {
      return refuse(passphrase.error);
    }
    checked.passphrase = passphrase.passphrase;
  }
  return { ok: true, edits: checked };
} // End of function checkNetworkEdits()

/**
 * The detail's WPA-Personal settings for a WPA-Personal result, minus its
 * key (the typed passphrase is added by the caller): exactly the documented
 * `pskSetting` fields. For a network that already is WPA-Personal they must
 * be complete and sane — `versionPsk` 1–4, `encryptionPsk` 1 / 3,
 * `gikRekeyPskEnable` a boolean, the optional ones well typed — never
 * invented (null). For an open network switching, its stale settings (or
 * none) are reused only when well typed; the derivation fills the version
 * and encryption, the merge an absent group-key flag.
 * @param {unknown} reported - The detail's `pskSetting`.
 * @param {boolean} wasWpaPersonal - Whether the fresh detail is WPA-Personal.
 * @returns {Record<string, unknown> | null} The settings, or null when they cannot be used safely.
 */
function freshPskSetting(reported: unknown, wasWpaPersonal: boolean): Record<string, unknown> | null {
  if (!wasWpaPersonal && (reported === undefined || reported === null)) {
    return {};
  }
  if (!isPlainObject(reported)) {
    return null;
  }
  const setting = copyDocumentedFields(reported, PSK_SETTING_FIELDS, KEY_FIELDS);
  if (!matchesSchema(setting, PSK_SETTING_FIELDS, wasWpaPersonal)) {
    return null;
  }
  if (wasWpaPersonal && (!PSK_VERSIONS.includes(setting.versionPsk as number) || !PSK_ENCRYPTIONS.includes(setting.encryptionPsk as number))) {
    return null;
  }
  return setting;
} // End of function freshPskSetting()

/**
 * Tells whether a merged basic-config body (without its `pskSetting`) is
 * complete and sane (see the header): it matches the documented schema —
 * every required field present and not null, every field it carries (nested
 * ones included) of its documented type — with a non-empty name, a `band` of
 * 1–7, a `security` of 0 or 3, a `pmfMode` of 1–3, and — when the VLAN is
 * enabled — a `vlanId` (1–4094) or a `vlanSetting` object.
 * @param {Record<string, unknown>} body - The merged body.
 * @returns {boolean} True when complete.
 */
function hasRequiredBasicConfig(body: Record<string, unknown>): boolean {
  if (!matchesSchema(body, BASIC_CONFIG_SCHEMA, true)) {
    return false;
  }
  if (body.name === '' || !isIntegerIn(body.band, 1, 7) || !isIntegerIn(body.pmfMode, 1, 3)) {
    return false;
  }
  if (body.security !== SECURITY_OPEN && body.security !== SECURITY_WPA_PERSONAL) {
    return false;
  }
  return body.vlanEnable !== true || isIntegerIn(body.vlanId, 1, 4094) || isPlainObject(body.vlanSetting);
} // End of function hasRequiredBasicConfig()

/**
 * The read-merge-write of a basic-config save (see the header): the FRESH
 * detail's documented basic-config fields, verbatim, with only the checked
 * edits applied — and, when the edit changes the security or the bands, the
 * dependents of deriveSecurityDependents(). Refused when the fresh detail is
 * not a plain object, lacks a required field or reports one of the wrong type
 * ('networkStateUnknown'), when it reports a mode other than open /
 * WPA-Personal ('unsupportedSecurity' — whatever the renderer believed), when
 * the result is WPA-Personal without a typed passphrase
 * ('passphraseRequired') or open with one ('passphraseNotApplicable'), and
 * when the change conflicts with a setting the app does not change
 * ('securityBandConflict'). The detail's own key is never copied: a
 * WPA-Personal body carries the typed passphrase only.
 * @param {unknown} detail - The raw `result` of the fresh detail read.
 * @param {CheckedNetworkEdits} edits - The checked edits (checkNetworkEdits()).
 * @returns {BasicConfigMerge} The body, or a refusal.
 */
export function mergeBasicConfig(detail: unknown, edits: CheckedNetworkEdits): BasicConfigMerge {
  if (!isPlainObject(detail)) {
    return refuse('networkStateUnknown');
  }
  const freshSecurity = detail.security;
  if (freshSecurity !== SECURITY_OPEN && freshSecurity !== SECURITY_WPA_PERSONAL) {
    return refuse('unsupportedSecurity');
  }
  const resultSecurity = edits.security ?? freshSecurity;
  if (resultSecurity === SECURITY_OPEN && edits.passphrase !== undefined) {
    return refuse('passphraseNotApplicable');
  }
  if (resultSecurity === SECURITY_WPA_PERSONAL && edits.passphrase === undefined) {
    return refuse('passphraseRequired');
  }

  // The documented fields the fresh detail reports, then the edits on top
  const body = copyDocumentedFields(detail, BASIC_CONFIG_SCHEMA, NOT_COPIED_KEYS);
  if (edits.name !== undefined) {
    body.name = edits.name;
  }
  if (edits.bandMask !== undefined) {
    body.band = edits.bandMask;
  }
  body.security = resultSecurity;
  if (!hasRequiredBasicConfig(body)) {
    return refuse('networkStateUnknown');
  }
  const psk = resultSecurity === SECURITY_WPA_PERSONAL ? freshPskSetting(detail.pskSetting, freshSecurity === SECURITY_WPA_PERSONAL) : undefined;
  if (psk === null) {
    return refuse('networkStateUnknown');
  }

  // Security and bands are one dependent change: derived only when they change
  if (resultSecurity !== freshSecurity || body.band !== detail.band) {
    const derived = deriveSecurityDependents(resultSecurity, body.band as number, {
      versionPsk: psk?.versionPsk,
      encryptionPsk: psk?.encryptionPsk,
      pmfMode: body.pmfMode,
      oweEnable: body.oweEnable,
      enhancedIotConnectivity: body.enhancedIotConnectivity
    });
    if (!derived.ok) {
      return derived;
    }
    body.pmfMode = derived.dependents.pmfMode;
    if (derived.dependents.oweEnable !== undefined) {
      body.oweEnable = derived.dependents.oweEnable;
    }
    if (psk !== undefined) {
      psk.versionPsk = derived.dependents.versionPsk;
      psk.encryptionPsk = derived.dependents.encryptionPsk;
    }
  } // End of the security / band change
  if (psk !== undefined) {
    if (typeof psk.gikRekeyPskEnable !== 'boolean') {
      // Only an open network switching gets here (a WPA-Personal one must report it)
      psk.gikRekeyPskEnable = DEFAULT_GIK_REKEY;
    }
    psk.securityKey = edits.passphrase;
    body.pskSetting = psk;
  }
  return { ok: true, body };
} // End of function mergeBasicConfig()

/**
 * The body of `PATCH …/ssids/{ssidId}/enable`: exactly `{ssidEnable}`.
 * @param {boolean} enabled - The new enable state.
 * @returns {{ ssidEnable: boolean }} The body.
 */
export function buildEnableBody(enabled: boolean): { ssidEnable: boolean } {
  return { ssidEnable: enabled === true };
}

/**
 * Sanity check of a create / basic-config body handed to the Open API client
 * (defense in depth; the rules proper are applied above): a plain object with
 * a non-empty string `name`, a `band` of 1–7 and a writable `security` (0 or
 * 3: the client never sends an Enterprise or PPSK body), whose `pskSetting`,
 * when present, is an object carrying a valid passphrase — and which carries
 * a `pskSetting` exactly when it is WPA-Personal.
 * @param {unknown} body - The body.
 * @returns {boolean} True when sane.
 */
export function isSaneSsidWriteBody(body: unknown): body is Record<string, unknown> {
  if (!isPlainObject(body) || typeof body.name !== 'string' || body.name === '' || !isIntegerIn(body.band, 1, 7)) {
    return false;
  }
  if (body.security === SECURITY_OPEN) {
    return body.pskSetting === undefined;
  }
  return body.security === SECURITY_WPA_PERSONAL && isPlainObject(body.pskSetting) && validatePassphrase(body.pskSetting.securityKey).ok;
} // End of function isSaneSsidWriteBody()

/**
 * The secrets a write body carries (the passphrase), so the client can scrub
 * them by value from any diagnostic of that call.
 * @param {unknown} body - The body.
 * @returns {string[]} The secret values (none for an open network).
 */
export function ssidBodySecrets(body: unknown): string[] {
  const setting = isPlainObject(body) ? body.pskSetting : undefined;
  const key = isPlainObject(setting) ? setting.securityKey : undefined;
  return typeof key === 'string' && key !== '' ? [key] : [];
}
