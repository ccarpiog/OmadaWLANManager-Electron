// ============================================================================
// TP-Link cloud access (Settings, inbox item I-1c1): pure form and reply
// logic, no DOM. Mirrors the main-process save rules of
// src/main/config-model.ts (applyCloudAccessSave()) so the renderer can
// explain a refusal before sending anything — main enforces the same rules
// on its own. Also decides when "Test cloud access" must not run on unsaved
// changes (hasUnsavedCloudChanges(): main only ever tests the SAVED
// credential), validates main's cloud:test reply (parseCloudAccessResult():
// the controller DTOs or a stable code with a diagnostic) and maps it to
// what the result line shows (cloudTestOutcome(), cloudTestSummaryKey(),
// cloudControllerStatusKey()), and tells whether a reply still belongs to
// the run on screen (isCloudTestCurrent()). Unit-tested in
// tests/unit/renderer-cloud-form.test.ts.
// ============================================================================

import type {
  CloudAccessError,
  CloudAccessStatus,
  CloudController,
  CloudControllerReason,
  CloudRegion,
  ConfigSavePayload,
} from '../shared/types';
import type { Translations } from './i18n-strings';
import { CLIENT_ID_REGEX } from './management-form';

// The cloud account regions, in display order, and the default — keep in
// sync with CLOUD_REGIONS / DEFAULT_CLOUD_REGION in src/main/cloud-hosts.ts
export const CLOUD_REGIONS: readonly CloudRegion[] = ['aps', 'euw', 'use'];
export const DEFAULT_CLOUD_REGION: CloudRegion = 'euw';

// The cloud access as the renderer reads it when main reports nothing usable
// (no cloud flags in the config, or malformed ones): nothing stored, the
// default region, a typed secret could be stored encrypted, local active
export const NO_CLOUD_ACCESS: Readonly<CloudAccessStatus> = Object.freeze({
  region: DEFAULT_CLOUD_REGION,
  clientId: '',
  hasCloudSecret: false,
  cloudSecretSessionOnly: false,
  canPersistCloudSecret: true,
  activeController: 'local',
});

// An omadacId as main sends it (OMADAC_ID_REGEX in src/main/cloud-account-model.ts)
const OMADAC_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
// Main walks at most 10 pages of 100 organizations (cloud-account-client.ts)
const MAX_CLOUD_CONTROLLERS = 1000;
// Display caps: a controller name (MAX_ORG_NAME_LENGTH in
// cloud-account-model.ts), a version (MAX_CONTROLLER_VERSION_LENGTH in
// controller-version.ts) and a diagnostic (MAX_CLOUD_DIAGNOSTIC_CHARS)
const MAX_CLOUD_NAME_LENGTH = 128;
const MAX_CLOUD_VERSION_LENGTH = 64;
const MAX_CLOUD_DIAGNOSTIC_LENGTH = 200;
// C0 / C1 control characters and the bidirectional controls: never displayed
const UNSAFE_TEXT_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
// An error code main may add later (unknown to this renderer): shown as is
const UNKNOWN_ERROR_CODE_REGEX = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// TP-Link's errorCode inside main's codes-only diagnostic ("…, errorCode -52602")
const TPLINK_ERROR_CODE_REGEX = /\berrorCode (-?\d{1,9})\b/;

// Every CloudAccessError (src/shared/types.ts); the Record type makes the
// compiler require each one, so a new code cannot be forgotten here
const CLOUD_ACCESS_ERRORS: Record<CloudAccessError, true> = {
  notConfigured: true,
  superseded: true,
  credentialInvalid: true,
  tokenRejected: true,
  rateLimited: true,
  timeout: true,
  networkError: true,
  malformedResponse: true,
  httpError: true,
  apiError: true,
};

// Every CloudControllerReason with the text of its controller status
export const CLOUD_REASON_TEXT: Readonly<Record<CloudControllerReason, keyof Translations>> = {
  notController: 'cloudReasonNotController',
  incompleteEntry: 'cloudReasonIncompleteEntry',
  unsupportedHost: 'cloudReasonUnsupportedHost',
  versionUnknown: 'cloudReasonVersionUnknown',
  versionTooOld: 'cloudReasonVersionTooOld',
  offline: 'cloudReasonOffline',
};

// TP-Link's token-request errorCodes that refine a 'credentialInvalid' reply
// (docs/omada-cloud-openapi.md §9): -52602 / -90112 "has expired or does not
// exist", -90113 "has been disabled", -90106 "The Client Id Or Client Secret
// is Invalid"; any other (-44116, HTTP 401 / 403) keeps the generic text
const CREDENTIAL_DISPLAYS: ReadonlyMap<number, CloudTestDisplay> = new Map<number, CloudTestDisplay>([
  [-52602, 'credentialExpired'],
  [-90112, 'credentialExpired'],
  [-90113, 'credentialDisabled'],
  [-90106, 'credentialWrong'],
]);

/**
 * Tells whether a value is one of the cloud account regions.
 * @param {unknown} value - The candidate.
 * @returns {value is CloudRegion} True for 'aps', 'euw' or 'use'.
 */
export function isCloudRegion(value: unknown): value is CloudRegion {
  return typeof value === 'string' && (CLOUD_REGIONS as readonly string[]).includes(value);
}

/**
 * Removes the control and bidirectional characters of a text received over
 * IPC and trims it.
 * @param {string} raw - The text.
 * @returns {string} The cleaned text.
 */
function cleanText(raw: string): string {
  return raw.replace(UNSAFE_TEXT_CHARACTERS, '').trim();
}

/**
 * Validates the cloud-access flags of a config received over IPC
 * (RendererConfig.cloudAccess / ConfigSaveResult.cloudAccess), field by
 * field: a missing or malformed field reads as "nothing stored" (the default
 * region, no Client ID, no secret, local active). Never a secret: main sends
 * flags only.
 * @param {unknown} raw - The `cloudAccess` field received over IPC.
 * @returns {CloudAccessStatus} The validated flags.
 */
export function parseCloudAccessStatus(raw: unknown): CloudAccessStatus {
  if (typeof raw !== 'object' || raw === null) {
    return { ...NO_CLOUD_ACCESS };
  }
  const candidate = raw as Record<string, unknown>;
  const clientId = typeof candidate.clientId === 'string' && CLIENT_ID_REGEX.test(candidate.clientId) ? candidate.clientId : '';
  const active = candidate.activeController;
  return {
    region: isCloudRegion(candidate.region) ? candidate.region : DEFAULT_CLOUD_REGION,
    clientId,
    hasCloudSecret: candidate.hasCloudSecret === true,
    cloudSecretSessionOnly: candidate.cloudSecretSessionOnly === true,
    canPersistCloudSecret: candidate.canPersistCloudSecret !== false,
    activeController: typeof active === 'string' && (active === 'local' || OMADAC_ID_REGEX.test(active)) ? active : 'local',
  };
} // End of function parseCloudAccessStatus()

// ============================================================================
// The form: save plan, secret placeholder, unsaved changes
// ============================================================================

/**
 * What the TP-Link cloud section holds when the user saves.
 */
export interface CloudFormInput {
  // The user confirmed "Remove cloud access" (applied by this save)
  removeStaged: boolean;
  // Raw field values (the region select's value)
  regionField: string;
  clientIdField: string;
  clientSecretField: string;
  // What main reported when the modal opened
  storedRegion: CloudRegion;
  storedClientId: string;
  hasCloudSecret: boolean;
}

/**
 * The cloud-access fields of a ConfigSavePayload.
 */
export type CloudPayloadFields = Pick<ConfigSavePayload, 'cloudRegion' | 'cloudClientId' | 'cloudClientSecret' | 'removeCloudAccess'>;

/**
 * Renderer-side refusals (same codes as main's ConfigSaveError).
 */
export type CloudFormError = 'invalidCloudClientId' | 'cloudClientIdRequired' | 'cloudClientSecretRequired';

/**
 * Result of planCloudSave(): the fields to add to the payload, or why the
 * save is refused.
 */
export type CloudFormPlan = { ok: true; fields: CloudPayloadFields } | { ok: false; error: CloudFormError };

/**
 * What the cloud Client Secret field's placeholder says leaving it blank means.
 */
export type CloudSecretAffordance = 'none' | 'unchanged' | 'requiredNewRegion' | 'requiredNewClientId';

// The text of each cloud save refusal, renderer- or main-side (the three
// cloud ConfigSaveError codes of phase I-1a)
export const CLOUD_SAVE_ERROR_TEXT: Readonly<Record<CloudFormError, keyof Translations>> = {
  invalidCloudClientId: 'invalidCloudClientId',
  cloudClientIdRequired: 'cloudClientIdRequired',
  cloudClientSecretRequired: 'cloudClientSecretRequired',
};

/**
 * The text of a save error code when it is one of the cloud refusals.
 * @param {unknown} error - The `error` of a ConfigSaveResult (or a plan's refusal).
 * @returns {keyof Translations | null} The text's key, or null for any other code.
 */
export function cloudSaveErrorKey(error: unknown): keyof Translations | null {
  return typeof error === 'string' && Object.prototype.hasOwnProperty.call(CLOUD_SAVE_ERROR_TEXT, error)
    ? CLOUD_SAVE_ERROR_TEXT[error as CloudFormError]
    : null;
}

/**
 * The region a form state designates: the select's value when it is a
 * region, else the stored one.
 * @param {string} regionField - The select's value.
 * @param {CloudRegion} storedRegion - The stored region.
 * @returns {CloudRegion} The region.
 */
function formRegion(regionField: string, storedRegion: CloudRegion): CloudRegion {
  return isCloudRegion(regionField) ? regionField : storedRegion;
}

/**
 * Decides the cloud-access part of a settings save (main's
 * applyCloudAccessSave() rules):
 * - a staged removal sends `removeCloudAccess: true` alone;
 * - a blank Client ID sends nothing (or only a changed region) — unless a
 *   secret was typed, or a Client ID or secret is stored (then the user must
 *   use "Remove cloud access"): 'cloudClientIdRequired';
 * - an invalid Client ID: 'invalidCloudClientId';
 * - a typed secret sends the region, the Client ID and the secret;
 * - a blank secret with the stored region and Client ID sends nothing (main
 *   keeps everything as stored);
 * - a blank secret with a new Client ID or a new region:
 *   'cloudClientSecretRequired' (an old secret never follows another
 *   credential).
 * @param {CloudFormInput} input - The section's state.
 * @returns {CloudFormPlan} The payload fields, or the refusal.
 */
export function planCloudSave(input: CloudFormInput): CloudFormPlan {
  if (input.removeStaged) {
    return { ok: true, fields: { removeCloudAccess: true } };
  }
  const region = formRegion(input.regionField, input.storedRegion);
  const regionChanged = region !== input.storedRegion;
  const clientId = input.clientIdField.trim();
  const secret = input.clientSecretField;
  if (clientId === '') {
    if (secret !== '' || input.storedClientId !== '' || input.hasCloudSecret) {
      return { ok: false, error: 'cloudClientIdRequired' };
    }
    return { ok: true, fields: regionChanged ? { cloudRegion: region } : {} };
  }
  if (!CLIENT_ID_REGEX.test(clientId)) {
    return { ok: false, error: 'invalidCloudClientId' };
  }
  if (secret !== '') {
    return { ok: true, fields: { cloudRegion: region, cloudClientId: clientId, cloudClientSecret: secret } };
  }
  if (!regionChanged && clientId === input.storedClientId) {
    return { ok: true, fields: {} };
  }
  return { ok: false, error: 'cloudClientSecretRequired' };
} // End of function planCloudSave()

/**
 * Decides the cloud Client Secret placeholder: "(unchanged)" only while a
 * secret is stored and the region and Client ID fields still hold the
 * stored ones; "(required for the new region)" or "(required for the new
 * Client ID)" when a secret is stored but would not be kept; nothing
 * otherwise (no secret stored, or the Client ID field blank).
 * @param {{ hasCloudSecret: boolean; regionField: string; clientIdField: string; storedRegion: CloudRegion; storedClientId: string }} input - The section's state.
 * @returns {CloudSecretAffordance} The placeholder to show.
 */
export function cloudSecretAffordance(input: {
  hasCloudSecret: boolean;
  regionField: string;
  clientIdField: string;
  storedRegion: CloudRegion;
  storedClientId: string;
}): CloudSecretAffordance {
  const clientId = input.clientIdField.trim();
  if (!input.hasCloudSecret || clientId === '') {
    return 'none';
  }
  if (formRegion(input.regionField, input.storedRegion) !== input.storedRegion) {
    return 'requiredNewRegion';
  }
  return clientId === input.storedClientId ? 'unchanged' : 'requiredNewClientId';
} // End of function cloudSecretAffordance()

/**
 * Tells whether the TP-Link cloud section holds changes that are not saved
 * yet: a staged removal, a typed secret, a Client ID that differs from the
 * stored one, or another region. "Test cloud access" checks the SAVED
 * credential (main takes no argument), so it asks the user to save first
 * instead of testing something else than what is shown.
 * @param {{ removeStaged: boolean; regionField: string; clientIdField: string; clientSecretField: string; storedRegion: CloudRegion; storedClientId: string }} input - The section's state.
 * @returns {boolean} True when something is unsaved.
 */
export function hasUnsavedCloudChanges(input: {
  removeStaged: boolean;
  regionField: string;
  clientIdField: string;
  clientSecretField: string;
  storedRegion: CloudRegion;
  storedClientId: string;
}): boolean {
  return (
    input.removeStaged ||
    input.clientSecretField !== '' ||
    input.clientIdField.trim() !== input.storedClientId ||
    formRegion(input.regionField, input.storedRegion) !== input.storedRegion
  );
} // End of function hasUnsavedCloudChanges()

// ============================================================================
// The cloud:test reply
// ============================================================================

/**
 * A cloud:test reply after validation: the controllers (and whether the list
 * may be incomplete), or a failure — a known CloudAccessError, a code this
 * renderer does not know ('unknown', with the code), or 'invalid' for a
 * malformed reply — with main's diagnostic when it sent a usable one.
 */
export type ParsedCloudResult =
  | { ok: true; controllers: CloudController[]; truncated: boolean }
  | { ok: false; error: CloudAccessError | 'unknown' | 'invalid'; code: string | null; diagnostic: string | null };

/**
 * Validates a diagnostic main attached to a cloud reply: codes, HTTP status
 * and TP-Link's errorCode — plus TP-Link's redacted message for an
 * 'apiError' — so any printable text up to main's cap is kept (it is shown
 * as text only), with control and bidirectional characters removed.
 * @param {unknown} raw - The `diagnostic` field received over IPC.
 * @returns {string | null} The diagnostic, or null.
 */
export function parseCloudDiagnostic(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const cleaned = cleanText(raw);
  return cleaned.length > 0 && cleaned.length <= MAX_CLOUD_DIAGNOSTIC_LENGTH ? cleaned : null;
}

/**
 * Validates one controller DTO, failing closed: exactly the shape
 * toCloudController() builds (src/main/cloud-account-model.ts) — a usable
 * omadacId, a displayable name, booleans, a version or null, a known reason
 * or null, and `connectable` exactly when there is no reason. Only the six
 * DTO fields are copied.
 * @param {unknown} raw - One entry of `controllers`.
 * @returns {CloudController | null} The controller, or null when malformed.
 */
export function parseCloudController(raw: unknown): CloudController | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.omadacId !== 'string' || !OMADAC_ID_REGEX.test(candidate.omadacId) || candidate.omadacId === 'local') {
    return null;
  }
  const name = typeof candidate.name === 'string' ? cleanText(candidate.name) : '';
  if (name === '' || name.length > MAX_CLOUD_NAME_LENGTH) {
    return null;
  }
  const version = candidate.version;
  if (version !== null && (typeof version !== 'string' || cleanText(version) === '' || version.length > MAX_CLOUD_VERSION_LENGTH)) {
    return null;
  }
  const reason = candidate.reason;
  if (reason !== null && (typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(CLOUD_REASON_TEXT, reason))) {
    return null;
  }
  if (typeof candidate.online !== 'boolean' || typeof candidate.connectable !== 'boolean' || candidate.connectable !== (reason === null)) {
    return null;
  }
  return {
    omadacId: candidate.omadacId,
    name,
    online: candidate.online,
    version: version === null ? null : cleanText(version),
    connectable: candidate.connectable,
    reason: reason as CloudControllerReason | null,
  };
} // End of function parseCloudController()

/**
 * Validates a cloud:test reply. A success needs a controller list of valid
 * DTOs (one malformed entry rejects the reply: the list would not be what
 * main sent) and a boolean or absent `truncated`. A failure needs an error
 * code: a known one, or one shaped like a code ('unknown': a code main may
 * add later, shown with its diagnostic); anything else is 'invalid'.
 * @param {unknown} raw - The reply received over IPC.
 * @returns {ParsedCloudResult} The validated reply.
 */
export function parseCloudAccessResult(raw: unknown): ParsedCloudResult {
  const invalid: ParsedCloudResult = { ok: false, error: 'invalid', code: null, diagnostic: null };
  if (typeof raw !== 'object' || raw === null) {
    return invalid;
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.success === true) {
    if (!Array.isArray(candidate.controllers) || candidate.controllers.length > MAX_CLOUD_CONTROLLERS) {
      return invalid;
    }
    if (candidate.truncated !== undefined && typeof candidate.truncated !== 'boolean') {
      return invalid;
    }
    const controllers: CloudController[] = [];
    for (const entry of candidate.controllers) {
      const controller = parseCloudController(entry);
      if (controller === null) {
        return invalid;
      }
      controllers.push(controller);
    }
    return { ok: true, controllers, truncated: candidate.truncated === true };
  } // End of the success branch
  if (candidate.success !== false || typeof candidate.error !== 'string') {
    return invalid;
  }
  const diagnostic = parseCloudDiagnostic(candidate.diagnostic);
  if (Object.prototype.hasOwnProperty.call(CLOUD_ACCESS_ERRORS, candidate.error)) {
    return { ok: false, error: candidate.error as CloudAccessError, code: candidate.error, diagnostic };
  }
  if (UNKNOWN_ERROR_CODE_REGEX.test(candidate.error)) {
    return { ok: false, error: 'unknown', code: candidate.error, diagnostic };
  }
  return invalid;
} // End of function parseCloudAccessResult()

// ============================================================================
// What the result line shows
// ============================================================================

/**
 * What the test's result line can show: the line while it runs, the refusal
 * to test unsaved changes, a success ('ok'), one display per failure (a
 * refused credential refined by TP-Link's errorCode), a code this renderer
 * does not know, or 'failed' for a malformed reply or an IPC error.
 */
export type CloudTestDisplay =
  | 'testing'
  | 'unsavedChanges'
  | 'ok'
  | 'notConfigured'
  | 'superseded'
  | 'credentialExpired'
  | 'credentialDisabled'
  | 'credentialWrong'
  | 'credentialInvalid'
  | 'tokenRejected'
  | 'rateLimited'
  | 'timeout'
  | 'networkError'
  | 'malformedResponse'
  | 'httpError'
  | 'apiError'
  | 'unknownError'
  | 'failed';

// The text of each display but 'ok' (whose summary depends on the count,
// cloudTestSummaryKey())
export const CLOUD_TEST_TEXT: Readonly<Record<Exclude<CloudTestDisplay, 'ok'>, keyof Translations>> = {
  testing: 'cloudTestRunning',
  unsavedChanges: 'cloudTestUnsaved',
  notConfigured: 'cloudTestNotConfigured',
  superseded: 'cloudTestSuperseded',
  credentialExpired: 'cloudTestCredentialExpired',
  credentialDisabled: 'cloudTestCredentialDisabled',
  credentialWrong: 'cloudTestCredentialWrong',
  credentialInvalid: 'cloudTestCredentialInvalid',
  tokenRejected: 'cloudTestTokenRejected',
  rateLimited: 'cloudTestRateLimited',
  timeout: 'cloudTestTimeout',
  networkError: 'cloudTestNetworkError',
  malformedResponse: 'cloudTestMalformedResponse',
  httpError: 'cloudTestHttpError',
  apiError: 'cloudTestApiError',
  unknownError: 'cloudTestUnknownError',
  failed: 'cloudTestFailed',
};

/**
 * What one finished "Test cloud access" run shows: the display, the detail
 * in parentheses after its text (main's diagnostic; for an unknown code, the
 * code and the diagnostic), and for a success the controllers and whether
 * the list may be incomplete.
 */
export interface CloudTestOutcome {
  display: CloudTestDisplay;
  detail: string | null;
  controllers: CloudController[];
  truncated: boolean;
}

/**
 * Reads TP-Link's errorCode out of main's codes-only diagnostic.
 * @param {string | null} diagnostic - The diagnostic (e.g. "credentialInvalid, errorCode -52602").
 * @returns {number | null} The errorCode, or null when there is none.
 */
export function tpLinkErrorCode(diagnostic: string | null): number | null {
  const match = diagnostic === null ? null : TPLINK_ERROR_CODE_REGEX.exec(diagnostic);
  return match === null ? null : Number(match[1]);
}

/**
 * The detail of a code this renderer does not know: the code and main's
 * diagnostic — the diagnostic alone when it already starts with the code
 * (main's form: "<code>, …"), the code alone without a diagnostic.
 * @param {string} code - The unknown error code.
 * @param {string | null} diagnostic - Main's diagnostic, if any.
 * @returns {string} The detail.
 */
function unknownErrorDetail(code: string, diagnostic: string | null): string {
  if (diagnostic === null) return code;
  return diagnostic.startsWith(code) ? diagnostic : `${code}: ${diagnostic}`;
}

/**
 * Maps a validated cloud:test reply to what the result line shows: a
 * success lists the controllers; 'credentialInvalid' becomes the expired /
 * disabled / wrong-credential text when TP-Link's errorCode says which
 * (CREDENTIAL_DISPLAYS), else the generic one; every other known code has its
 * own text with main's diagnostic; an unknown code is shown as the code plus
 * its diagnostic; a malformed reply is 'failed'.
 * @param {ParsedCloudResult} result - The reply after parseCloudAccessResult().
 * @returns {CloudTestOutcome} What to show.
 */
export function cloudTestOutcome(result: ParsedCloudResult): CloudTestOutcome {
  if (result.ok) {
    return { display: 'ok', detail: null, controllers: result.controllers, truncated: result.truncated };
  }
  const none = { controllers: [], truncated: false };
  switch (result.error) {
    case 'invalid':
      return { display: 'failed', detail: null, ...none };
    case 'unknown':
      return { display: 'unknownError', detail: unknownErrorDetail(result.code ?? '', result.diagnostic), ...none };
    case 'credentialInvalid': {
      const code = tpLinkErrorCode(result.diagnostic);
      const display = (code === null ? undefined : CREDENTIAL_DISPLAYS.get(code)) ?? 'credentialInvalid';
      return { display, detail: result.diagnostic, ...none };
    }
    default:
      return { display: result.error, detail: result.diagnostic, ...none };
  } // End of the switch over the failure codes
} // End of function cloudTestOutcome()

/**
 * The summary text of a success: no controllers, one, or several (with a
 * `{count}` placeholder).
 * @param {number} count - How many controllers were found.
 * @returns {keyof Translations} The text's key.
 */
export function cloudTestSummaryKey(count: number): keyof Translations {
  if (count === 0) return 'cloudTestOkNone';
  return count === 1 ? 'cloudTestOkOne' : 'cloudTestOkMany';
}

/**
 * The tone of the result line (its left border, styles.css): 'ok' for a
 * success, 'busy' while running, 'info' for the outcomes that ask the user
 * to do something first (save, enter a credential, test again), 'off' for
 * every failure.
 * @param {CloudTestDisplay} display - What the line shows.
 * @returns {'ok' | 'off' | 'busy' | 'info'} The tone.
 */
export function cloudTestTone(display: CloudTestDisplay): 'ok' | 'off' | 'busy' | 'info' {
  if (display === 'ok') return 'ok';
  if (display === 'testing') return 'busy';
  return display === 'unsavedChanges' || display === 'notConfigured' || display === 'superseded' ? 'info' : 'off';
}

/**
 * The status text of one listed controller: available, or why it cannot be
 * used (its reason).
 * @param {CloudController} controller - The controller.
 * @returns {keyof Translations} The text's key.
 */
export function cloudControllerStatusKey(controller: CloudController): keyof Translations {
  return controller.reason === null ? 'cloudControllerAvailable' : CLOUD_REASON_TEXT[controller.reason];
}

/**
 * Tells whether a "Test cloud access" reply still belongs to the run on
 * screen: Settings is open and no newer run started — and none of the
 * events that bump the run number happened meanwhile (Settings opened or
 * closed, a removal staged). A late reply is discarded whatever it says.
 * @param {number} run - The run the reply belongs to.
 * @param {number} currentRun - The run number now.
 * @param {boolean} settingsOpen - Whether Settings is open now.
 * @returns {boolean} True when the reply may be shown.
 */
export function isCloudTestCurrent(run: number, currentRun: number, settingsOpen: boolean): boolean {
  return settingsOpen && run === currentRun;
}
