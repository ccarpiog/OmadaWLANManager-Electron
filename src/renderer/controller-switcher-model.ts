// ============================================================================
// Controller switcher (inbox item I-1c2a; spec
// autoclaude/processed/10-tplink-cloud-controllers.md "UI"): pure model, no
// DOM. The switcher at the top of the sidebar (its DOM, the state reset and
// the cloud error states are phase I-1c2b) builds on these:
// - buildControllerSwitcher(): the ordered entries — the local controller
//   first ("This network", only when one is configured), then the TP-Link
//   cloud account's controllers sorted by name with a "Cloud" tag; the cloud
//   duplicate of the local controller (its omadacId is main's
//   `localOmadacId`) is listed once, as local; a controller that cannot be
//   used is present but disabled with its reason (the I-1c1 reason texts);
//   the active entry is marked; a failed cloud list is a status the UI shows
//   while the local entry stays usable;
// - cloudFallbackTarget(): whether to offer "Connect through TP-Link cloud"
//   after a local connect failed because the controller did not answer;
// - isSwitcherBusy(): the switcher is disabled while an operation that owns
//   the session runs (a move, an AP-group or Wi-Fi network write — the
//   "Broadcast on" binding write included —, a connect, a disconnect, a
//   settings save or a certificate reset);
// - cloudConnectFailureKey(): the text of a refused cloud connect (-7132,
//   offline, an expired or deleted credential pointing at Settings → TP-Link
//   cloud, …), keyed by the code-first `detail` main sends;
// - parseConnectionTarget(): main's current connection target
//   (RendererConfig.connectionTarget), failing closed.
// Unit-tested in tests/unit/renderer-controller-switcher.test.ts.
// ============================================================================

import type { CloudController, CloudControllerReason, ControllerTarget } from '../shared/types';
import {
  CLOUD_REASON_TEXT,
  cloudTestOutcome,
  isCloudControllerId,
  tpLinkErrorCode,
  type CloudTestDisplay,
  type ParsedCloudResult,
} from './cloud-form';
import type { Translations } from './i18n-strings';

// The switcher's fixed texts: its label, the local entry's name, the tag of
// a cloud entry, the hint while it is disabled, and the offer to reach the
// local controller through the cloud
export const SWITCHER_TEXT: Readonly<Record<'label' | 'local' | 'cloudTag' | 'busy' | 'connectThroughCloud', keyof Translations>> = {
  label: 'controllerSwitcherLabel',
  local: 'thisNetwork',
  cloudTag: 'controllerSwitcherCloudTag',
  busy: 'controllerSwitcherBusy',
  connectThroughCloud: 'connectThroughCloud',
};

/**
 * The failures a cloud controller list can end in (cloudTestOutcome()'s
 * displays of a reply: neither a success nor the Settings-only lines).
 */
export type SwitcherCloudFailure = Exclude<CloudTestDisplay, 'ok' | 'testing' | 'unsavedChanges'>;

// The text of each failed cloud list in the switcher: the I-1c1 texts where
// they fit outside Settings (rate limiting, timeout, network), and texts
// pointing at Settings → TP-Link cloud for the credential problems (the
// I-1c1 ones say "save it here")
export const SWITCHER_CLOUD_FAILURE_TEXT: Readonly<Record<SwitcherCloudFailure, keyof Translations>> = {
  notConfigured: 'cloudConnectNotConfigured',
  superseded: 'cloudListSuperseded',
  credentialExpired: 'cloudConnectCredentialExpired',
  credentialDisabled: 'cloudConnectCredentialInvalid',
  credentialWrong: 'cloudConnectCredentialInvalid',
  credentialInvalid: 'cloudConnectCredentialInvalid',
  tokenRejected: 'cloudConnectCredentialInvalid',
  rateLimited: 'cloudTestRateLimited',
  timeout: 'cloudTestTimeout',
  networkError: 'cloudTestNetworkError',
  malformedResponse: 'cloudListFailed',
  httpError: 'cloudListFailed',
  apiError: 'cloudListFailed',
  unknownError: 'cloudListFailed',
  failed: 'cloudListFailed',
};

/**
 * What the switcher knows when it is built.
 */
export interface SwitcherInput {
  // Whether a local controller is configured (RendererConfig.url not ''),
  // and its display name when known (e.g. the host, controllerHostLabel())
  localConfigured: boolean;
  localName: string | null;
  // The account's controllers (parseCloudAccessResult() of cloud:controllers),
  // or null when no list was asked for (no cloud credential stored, or not
  // read yet)
  cloud: ParsedCloudResult | null;
  // The local controller's omadacId (main's `localOmadacId`, e.g.
  // localOmadacIdOf(cloud)); null when never learned
  localOmadacId: string | null;
  // The active target (parseConnectionTarget() of RendererConfig
  // .connectionTarget), or null when unknown
  active: ControllerTarget | null;
  // The name of the connected cloud controller (its connect result's
  // controllerName), for an active controller the list does not show
  activeName?: string | null;
}

/**
 * One entry of the switcher.
 */
export interface SwitcherEntry {
  // Stable and unique: 'local', or 'cloud:' + the omadacId
  key: string;
  // What switchController() gets for this entry
  target: ControllerTarget;
  kind: 'local' | 'cloud';
  // The local entry: its display name when known (its label is "This
  // network"); a cloud entry: the organization name (null only for an
  // unlisted active controller whose name is unknown)
  name: string | null;
  // A cloud entry's Omada version when reported
  version: string | null;
  // False when the controller cannot be used: the entry is disabled and
  // `reason` / `reasonKey` say why (the I-1c1 reason texts)
  usable: boolean;
  reason: CloudControllerReason | null;
  reasonKey: keyof Translations | null;
  // The entry of the controller the app works with now
  active: boolean;
  // The local entry while the session is its cloud duplicate (reached
  // through "Connect through TP-Link cloud"): choosing it connects directly
  viaCloud: boolean;
  // False for the active cloud controller when the list does not show it (the
  // list failed, or no longer lists it): kept so the active one is never lost
  listed: boolean;
}

/**
 * The state of the cloud part of the switcher: no list asked for, the list
 * (and whether it may be incomplete), or why it could not be read — the
 * display of cloudTestOutcome(), its text in the switcher and main's
 * diagnostic.
 */
export type SwitcherCloudStatus =
  | { kind: 'none' }
  | { kind: 'listed'; truncated: boolean }
  | { kind: 'failed'; display: SwitcherCloudFailure; textKey: keyof Translations; detail: string | null };

/**
 * The switcher's model.
 */
export interface SwitcherModel {
  entries: SwitcherEntry[];
  cloud: SwitcherCloudStatus;
}

/**
 * The local controller's omadacId a successful cloud reply carried.
 * @param {ParsedCloudResult | null} cloud - The parsed reply, or null.
 * @returns {string | null} The omadacId, or null.
 */
export function localOmadacIdOf(cloud: ParsedCloudResult | null): string | null {
  return cloud !== null && cloud.ok && cloud.localOmadacId !== undefined ? cloud.localOmadacId : null;
}

/**
 * Validates main's current connection target (RendererConfig
 * .connectionTarget: 'local' or an omadacId). Fails closed: anything else is
 * null (unknown), never a crash.
 * @param {unknown} raw - The `connectionTarget` field received over IPC.
 * @returns {ControllerTarget | null} The target, or null.
 */
export function parseConnectionTarget(raw: unknown): ControllerTarget | null {
  if (raw === 'local') {
    return { kind: 'local' };
  }
  return isCloudControllerId(raw) ? { kind: 'cloud', omadacId: raw } : null;
}

/**
 * Orders two cloud entries: by name (case- and accent-insensitive, numbers
 * by value), an unknown name last, then by omadacId so the order is stable.
 * @param {SwitcherEntry} a - One entry.
 * @param {SwitcherEntry} b - The other.
 * @returns {number} Negative when `a` comes first.
 */
function compareCloudEntries(a: SwitcherEntry, b: SwitcherEntry): number {
  if (a.name === null || b.name === null) {
    if (a.name !== b.name) {
      return a.name === null ? 1 : -1;
    }
  } else {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    if (byName !== 0) {
      return byName;
    }
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
} // End of function compareCloudEntries()

/**
 * Builds one listed cloud entry.
 * @param {CloudController} controller - The validated controller DTO.
 * @param {ControllerTarget | null} active - The active target.
 * @returns {SwitcherEntry} The entry.
 */
function cloudEntry(controller: CloudController, active: ControllerTarget | null): SwitcherEntry {
  return {
    key: `cloud:${controller.omadacId}`,
    target: { kind: 'cloud', omadacId: controller.omadacId },
    kind: 'cloud',
    name: controller.name,
    version: controller.version,
    usable: controller.connectable && controller.reason === null,
    reason: controller.reason,
    reasonKey: controller.reason === null ? null : CLOUD_REASON_TEXT[controller.reason],
    active: active?.kind === 'cloud' && active.omadacId === controller.omadacId,
    viaCloud: false,
    listed: true,
  };
} // End of function cloudEntry()

/**
 * The cloud part's status from the parsed list.
 * @param {ParsedCloudResult | null} cloud - The parsed reply, or null.
 * @returns {SwitcherCloudStatus} The status.
 */
function cloudStatusOf(cloud: ParsedCloudResult | null): SwitcherCloudStatus {
  if (cloud === null) {
    return { kind: 'none' };
  }
  if (cloud.ok) {
    return { kind: 'listed', truncated: cloud.truncated };
  }
  const outcome = cloudTestOutcome(cloud);
  const display = outcome.display as SwitcherCloudFailure;
  return { kind: 'failed', display, textKey: SWITCHER_CLOUD_FAILURE_TEXT[display] ?? 'cloudListFailed', detail: outcome.detail };
} // End of function cloudStatusOf()

/**
 * Builds the switcher (see the header): the local entry first when a local
 * controller is configured — active when the target is local, or when it is
 * the local controller's cloud duplicate (`viaCloud`) —, then the cloud
 * entries sorted by name: every listed controller but the local duplicate
 * (hidden only while a local controller is configured: without one it is
 * just a cloud controller), disabled with its reason when it cannot be used,
 * plus the active cloud controller when the list does not show it
 * (`listed: false`, so the controller in use is never missing). A failed or
 * absent cloud list leaves the local entry as it is.
 * @param {SwitcherInput} input - What the switcher knows.
 * @returns {SwitcherModel} The entries and the cloud status.
 */
export function buildControllerSwitcher(input: SwitcherInput): SwitcherModel {
  const active = input.active;
  const localId = input.localConfigured && isCloudControllerId(input.localOmadacId) ? input.localOmadacId : null;
  const activeIsLocalDuplicate = active?.kind === 'cloud' && localId !== null && active.omadacId === localId;
  const entries: SwitcherEntry[] = [];
  if (input.localConfigured) {
    entries.push({
      key: 'local',
      target: { kind: 'local' },
      kind: 'local',
      name: input.localName,
      version: null,
      usable: true,
      reason: null,
      reasonKey: null,
      active: active?.kind === 'local' || activeIsLocalDuplicate,
      viaCloud: activeIsLocalDuplicate,
      listed: true,
    });
  }

  const cloudEntries: SwitcherEntry[] = [];
  if (input.cloud !== null && input.cloud.ok) {
    for (const controller of input.cloud.controllers) {
      if (localId !== null && controller.omadacId === localId) {
        continue;
      }
      cloudEntries.push(cloudEntry(controller, active));
    }
  } // End of the loop over the listed cloud controllers

  if (active?.kind === 'cloud' && !activeIsLocalDuplicate && !cloudEntries.some((entry) => entry.active)) {
    const name = typeof input.activeName === 'string' && input.activeName.trim() !== '' ? input.activeName : null;
    cloudEntries.push({
      key: `cloud:${active.omadacId}`,
      target: { kind: 'cloud', omadacId: active.omadacId },
      kind: 'cloud',
      name,
      version: null,
      usable: true,
      reason: null,
      reasonKey: null,
      active: true,
      viaCloud: false,
      listed: false,
    });
  }

  cloudEntries.sort(compareCloudEntries);
  entries.push(...cloudEntries);
  return { entries, cloud: cloudStatusOf(input.cloud) };
} // End of function buildControllerSwitcher()

/**
 * Tells whether a connect result is a LOCAL connect that failed because the
 * controller did not answer at all (main's `unreachable: true` on a
 * connectError; never a certificate result, a login refusal, an HTTP error or
 * a cloud connect).
 * @param {unknown} result - The ConnectionResult received over IPC.
 * @returns {boolean} True for an unreachable local controller.
 */
export function isLocalUnreachable(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) {
    return false;
  }
  const candidate = result as Record<string, unknown>;
  return candidate.success === false && candidate.error === 'connectError' && candidate.unreachable === true;
}

/**
 * Decides whether to offer "Connect through TP-Link cloud": the local connect
 * failed because the controller did not answer (isLocalUnreachable()), the
 * local controller's omadacId is known, and a complete cloud list shows that
 * same omadacId online and usable. Returns that controller's target, or null
 * otherwise — an unknown omadacId, a certificate or credential failure, an
 * offline or unusable duplicate, no duplicate, or a failed or possibly
 * incomplete list (main refuses a cloud connect from an incomplete list).
 * @param {{ localResult: unknown; cloud: ParsedCloudResult | null; localOmadacId: string | null }} input - The failed local connect, the cloud list and the local omadacId.
 * @returns {ControllerTarget | null} The cloud target to offer, or null.
 */
export function cloudFallbackTarget(input: { localResult: unknown; cloud: ParsedCloudResult | null; localOmadacId: string | null }): ControllerTarget | null {
  if (!isLocalUnreachable(input.localResult) || !isCloudControllerId(input.localOmadacId)) {
    return null;
  }
  const cloud = input.cloud;
  if (cloud === null || !cloud.ok || cloud.truncated) {
    return null;
  }
  const duplicate = cloud.controllers.find((controller) => controller.omadacId === input.localOmadacId);
  if (duplicate === undefined || !duplicate.online || !duplicate.connectable || duplicate.reason !== null) {
    return null;
  }
  return { kind: 'cloud', omadacId: duplicate.omadacId };
} // End of function cloudFallbackTarget()

/**
 * The renderer's operation flags the switcher depends on (the fields of the
 * renderer state, src/renderer/state.ts, by the same names).
 */
export interface SwitcherActivity {
  // A move flow (review, run, results)
  isApplyingChange: boolean;
  // An AP-group create / rename / delete flow
  isManagingApGroup: boolean;
  // A Wi-Fi network write flow, the "Broadcast on" binding write included
  isManagingNetwork: boolean;
  // A connect (a switch runs as one), a disconnect, a settings save, a
  // certificate reset
  isConnecting: boolean;
  isDisconnecting: boolean;
  isSavingSettings: boolean;
  isResettingCertificate: boolean;
}

/**
 * Tells whether the switcher must be disabled (it then shows SWITCHER_TEXT
 * .busy): a move or an AP-group, Wi-Fi network or binding write is running —
 * a switch would supersede it mid-way —, or an operation that owns the
 * session is (a connect or switch, a disconnect, a settings save, a
 * certificate reset). A data load or refresh does not disable it: a switch
 * supersedes the load (its reply is discarded by the session ticket).
 * @param {SwitcherActivity} activity - The operation flags (e.g. the renderer state).
 * @returns {boolean} True while the switcher must be disabled.
 */
export function isSwitcherBusy(activity: SwitcherActivity): boolean {
  return (
    activity.isApplyingChange === true ||
    activity.isManagingApGroup === true ||
    activity.isManagingNetwork === true ||
    activity.isConnecting === true ||
    activity.isDisconnecting === true ||
    activity.isSavingSettings === true ||
    activity.isResettingCertificate === true
  );
} // End of function isSwitcherBusy()

// The text of a refused cloud connect by the stable code its `detail` starts
// with (main's cloudRefusalDetail() / describeCloudSessionError()); rate
// limiting and the credential codes are checked first (cloudConnectFailureKey())
const CLOUD_CONNECT_CODE_TEXT: ReadonlyMap<string, keyof Translations> = new Map<string, keyof Translations>([
  ['offline', 'cloudConnectOffline'],
  ['notConfigured', 'cloudConnectNotConfigured'],
  ['unknownController', 'cloudConnectUnknownController'],
  ['versionTooOld', 'cloudSessionErrorVersionTooOld'],
  ['versionUnknown', 'cloudSessionErrorVersionUnknown'],
  ['noSites', 'cloudSessionErrorNoSites'],
  ['listIncomplete', 'cloudSessionErrorListIncomplete'],
]);

// The leading stable code of a cloud connect `detail` ("offline",
// "rateLimited (errorCode -7132)", "requestFailed (rateLimited; sites: …)")
const DETAIL_CODE_REGEX = /^([A-Za-z][A-Za-z0-9_]{0,63})(?: \(|$)/;

/**
 * The text of a refused cloud connect (a switchController() or connect()
 * result for a cloud target: connectError with a code-first `detail`):
 * - rate limiting — the code 'rateLimited', TP-Link's -7132, or a session
 *   failure caused by it — reuses the Settings text ("too many requests …
 *   wait a moment");
 * - an expired or deleted credential (-52602 / -90112) points at Settings →
 *   TP-Link cloud; any other refused credential ('credentialInvalid',
 *   'tokenRejected', the Open API 'invalidCredentials') too;
 * - 'offline', 'notConfigured', 'unknownController' and the session codes
 *   'versionTooOld', 'versionUnknown', 'noSites', 'listIncomplete' have their
 *   own texts;
 * - anything else (or a result that is not such a failure) is null: the UI
 *   shows the generic connection error with the detail, as for a local one.
 * @param {unknown} result - The ConnectionResult received over IPC.
 * @returns {keyof Translations | null} The text's key, or null.
 */
export function cloudConnectFailureKey(result: unknown): keyof Translations | null {
  if (typeof result !== 'object' || result === null) {
    return null;
  }
  const candidate = result as Record<string, unknown>;
  if (candidate.success !== false || candidate.error !== 'connectError' || typeof candidate.detail !== 'string') {
    return null;
  }
  const detail = candidate.detail;
  const match = DETAIL_CODE_REGEX.exec(detail);
  if (match === null) {
    return null;
  }
  const code = match[1];
  const tpLinkCode = tpLinkErrorCode(detail);
  if (code === 'rateLimited' || tpLinkCode === -7132 || /\brateLimited\b/.test(detail)) {
    return 'cloudTestRateLimited';
  }
  if (tpLinkCode === -52602 || tpLinkCode === -90112) {
    return 'cloudConnectCredentialExpired';
  }
  if (code === 'credentialInvalid' || code === 'tokenRejected' || /\binvalidCredentials\b/.test(detail)) {
    return 'cloudConnectCredentialInvalid';
  }
  return CLOUD_CONNECT_CODE_TEXT.get(code) ?? null;
} // End of function cloudConnectFailureKey()
