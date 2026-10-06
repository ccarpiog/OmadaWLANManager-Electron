// Controller version -> group model (docs/management-design.md §2.2). Pure (no
// Electron): unit-tested in tests/unit/controller-version.test.ts and loaded by
// the smoke stub (tests/smoke/stub-main.cjs) so it mirrors the real rule.
//
// Omada 6.3 turned WLAN groups into AP groups (docs/omada-6.3-api-findings.md).
// A controller that reports 6.3 or later in /api/info `controllerVer` uses the
// "AP groups" model ('apGroup'). Anything older uses the legacy "WLAN groups"
// model ('wlanGroup'), and so does a missing or unparseable version: the
// defensive default, because the version alone must never unlock 6.3-only
// behavior. The model selects the UI vocabulary and how strictly the group list
// is loaded (OmadaController.getWlanGroups()).

import type { ControllerInfo, GroupModel } from '../shared/types';

// First controller version with the AP-groups model
const AP_GROUP_MIN_MAJOR = 6;
const AP_GROUP_MIN_MINOR = 3;

// Upper bound for the controllerVer string kept from /api/info (it crosses to
// the renderer); a longer value is treated as absent
export const MAX_CONTROLLER_VERSION_LENGTH = 64;

// Printable ASCII only: a version string never needs anything else
const PRINTABLE_ASCII_REGEX = /^[\x20-\x7E]+$/;

// "major.minor" plus any number of further numeric parts ("6.3.0.45"). Each
// part is capped at 9 digits so Number() stays exact
const VERSION_REGEX = /^(\d{1,9})\.(\d{1,9})(?:\.\d{1,9})*$/;

/**
 * Normalizes the raw `controllerVer` value of /api/info: a non-empty string of
 * printable ASCII within MAX_CONTROLLER_VERSION_LENGTH (after trimming) is
 * kept as is, even when it is not a parseable version; anything else is null.
 * @param {unknown} raw - The raw `controllerVer` field.
 * @returns {string | null} The trimmed version string, or null.
 */
export function normalizeControllerVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > MAX_CONTROLLER_VERSION_LENGTH || !PRINTABLE_ASCII_REGEX.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Parses the major and minor numbers of a controller version string. Only the
 * plain dotted-numeric form is accepted ("6.3", "6.3.0.45"); prefixes,
 * suffixes and single numbers ("v6.3", "6.3-beta", "6") are unparseable.
 * @param {string | null} version - A normalized version string, or null.
 * @returns {{ major: number; minor: number } | null} The parsed numbers, or null.
 */
export function parseControllerVersion(version: string | null): { major: number; minor: number } | null {
  if (version === null) {
    return null;
  }
  const match = VERSION_REGEX.exec(version);
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Derives the group model from a controller version: 'apGroup' for 6.3 and
 * later, 'wlanGroup' for older versions and, defensively, for a missing or
 * unparseable version.
 * @param {string | null} version - A normalized version string, or null.
 * @returns {GroupModel} The group model.
 */
export function groupModelForVersion(version: string | null): GroupModel {
  const parsed = parseControllerVersion(version);
  if (!parsed) {
    return 'wlanGroup';
  }
  const atLeast63 = parsed.major > AP_GROUP_MIN_MAJOR || (parsed.major === AP_GROUP_MIN_MAJOR && parsed.minor >= AP_GROUP_MIN_MINOR);
  return atLeast63 ? 'apGroup' : 'wlanGroup';
}

/**
 * Builds the controller info from the raw `controllerVer` of /api/info.
 * @param {unknown} rawVersion - The raw `controllerVer` field.
 * @returns {ControllerInfo} The normalized version and its group model.
 */
export function describeController(rawVersion: unknown): ControllerInfo {
  const controllerVersion = normalizeControllerVersion(rawVersion);
  return { controllerVersion, groupModel: groupModelForVersion(controllerVersion) };
}
