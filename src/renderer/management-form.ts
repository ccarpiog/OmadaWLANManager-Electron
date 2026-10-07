// ============================================================================
// Management access (Settings): pure form logic, no DOM. Mirrors the
// main-process save rules of src/main/config-model.ts
// (applyManagementAccessSave()) so the renderer can explain a refusal before
// sending anything; main enforces the same rules on its own. Also decides
// what "Test management access" reports (managementTestOutcome()) and when
// it must not run on unsaved changes (hasUnsavedManagementChanges()).
// Unit-tested in tests/unit/renderer-management-form.test.ts.
// ============================================================================

import type { ConfigSavePayload, ManagementReason } from '../shared/types';
import type { ParsedManagementResult } from './validation';

// Format of a trimmed Client ID — keep in sync with CLIENT_ID_REGEX in
// src/main/config-model.ts
export const CLIENT_ID_REGEX = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * What the management-access section holds when the user saves.
 */
export interface ManagementFormInput {
  // The user confirmed "Remove management access" (applied by this save)
  removeStaged: boolean;
  // Raw field values
  clientIdField: string;
  clientSecretField: string;
  // What main reported when the modal opened
  storedClientId: string;
  hasClientSecret: boolean;
  // Whether the URL being saved designates the stored controller
  sameUrl: boolean;
}

/**
 * The management-access fields of a ConfigSavePayload.
 */
export type ManagementPayloadFields = Pick<ConfigSavePayload, 'clientId' | 'clientSecret' | 'removeManagementAccess'>;

/**
 * Renderer-side refusals (same codes as main's ConfigSaveError).
 */
export type ManagementFormError = 'invalidClientId' | 'clientIdRequired' | 'clientSecretRequired';

/**
 * Result of planManagementSave(): the fields to add to the payload, or why
 * the save is refused.
 */
export type ManagementFormPlan = { ok: true; fields: ManagementPayloadFields } | { ok: false; error: ManagementFormError };

/**
 * What the Client Secret field's placeholder says leaving it blank means.
 */
export type ClientSecretAffordance = 'none' | 'unchanged' | 'requiredNewUrl' | 'requiredNewClientId';

/**
 * Tells whether a Client ID field value is a plausible Client ID once trimmed.
 * @param {string} value - The raw field value.
 * @returns {boolean} True when valid.
 */
export function isValidClientId(value: string): boolean {
  return CLIENT_ID_REGEX.test(value.trim());
}

/**
 * Decides the management-access part of a settings save:
 * - a staged removal sends `removeManagementAccess: true` alone;
 * - a blank Client ID sends nothing — unless a secret was typed, or
 *   management access is stored for this same controller (then the user must
 *   use "Remove management access"): 'clientIdRequired';
 * - an invalid Client ID: 'invalidClientId';
 * - a typed secret sends the Client ID and the secret;
 * - a blank secret with the stored Client ID on the same controller sends
 *   nothing (main keeps both as stored);
 * - a blank secret with a new Client ID or a new controller URL:
 *   'clientSecretRequired' (an old secret is never reused).
 * @param {ManagementFormInput} input - The section's state.
 * @returns {ManagementFormPlan} The payload fields, or the refusal.
 */
export function planManagementSave(input: ManagementFormInput): ManagementFormPlan {
  if (input.removeStaged) {
    return { ok: true, fields: { removeManagementAccess: true } };
  }
  const clientId = input.clientIdField.trim();
  const secret = input.clientSecretField;
  if (clientId === '') {
    if (secret !== '') {
      return { ok: false, error: 'clientIdRequired' };
    }
    if (input.sameUrl && (input.storedClientId !== '' || input.hasClientSecret)) {
      return { ok: false, error: 'clientIdRequired' };
    }
    return { ok: true, fields: {} };
  }
  if (!isValidClientId(clientId)) {
    return { ok: false, error: 'invalidClientId' };
  }
  if (secret !== '') {
    return { ok: true, fields: { clientId, clientSecret: secret } };
  }
  if (input.sameUrl && clientId === input.storedClientId) {
    return { ok: true, fields: {} };
  }
  return { ok: false, error: 'clientSecretRequired' };
} // End of function planManagementSave()

/**
 * Decides the Client Secret placeholder: "(unchanged)" only while a secret is
 * stored, the URL field designates the stored controller and the Client ID
 * field still holds the stored Client ID; "(required for the new URL)" or
 * "(required for the new Client ID)" when a secret is stored but would not be
 * reused; nothing otherwise (no secret stored, or the Client ID field blank).
 * @param {{ hasClientSecret: boolean; sameUrl: boolean; clientIdField: string; storedClientId: string }} input - The section's state.
 * @returns {ClientSecretAffordance} The placeholder to show.
 */
export function clientSecretAffordance(input: {
  hasClientSecret: boolean;
  sameUrl: boolean;
  clientIdField: string;
  storedClientId: string;
}): ClientSecretAffordance {
  const clientId = input.clientIdField.trim();
  if (!input.hasClientSecret || clientId === '') {
    return 'none';
  }
  if (!input.sameUrl) {
    return 'requiredNewUrl';
  }
  return clientId === input.storedClientId ? 'unchanged' : 'requiredNewClientId';
} // End of function clientSecretAffordance()

/**
 * Tells whether the settings form holds management-access changes that are
 * not saved yet: a staged removal, a typed Client Secret, a Client ID that
 * differs from the stored one, or a URL that designates another controller.
 * "Test management access" checks the SAVED settings, so it asks the user to
 * save first instead of testing something else than what is shown.
 * @param {{ removeStaged: boolean; clientIdField: string; clientSecretField: string; storedClientId: string; sameUrl: boolean }} input - The form's state.
 * @returns {boolean} True when something is unsaved.
 */
export function hasUnsavedManagementChanges(input: {
  removeStaged: boolean;
  clientIdField: string;
  clientSecretField: string;
  storedClientId: string;
  sameUrl: boolean;
}): boolean {
  return input.removeStaged || input.clientSecretField !== '' || input.clientIdField.trim() !== input.storedClientId || !input.sameUrl;
}

/**
 * What one "Test management access" run reports: 'ok' when every check
 * passed, the ManagementReason of the failing check, 'notConnected' /
 * 'superseded' as main answered, or 'failed' for a malformed reply or an IPC
 * error.
 */
export type ManagementTestOutcome = 'ok' | ManagementReason | 'notConnected' | 'superseded' | 'failed';

/**
 * Maps a validated management-access reply to the outcome the test reports.
 * @param {ParsedManagementResult} result - The reply after parseManagementResult().
 * @returns {ManagementTestOutcome} The outcome.
 */
export function managementTestOutcome(result: ParsedManagementResult): ManagementTestOutcome {
  if (!result.ok) {
    return result.error === 'invalid' ? 'failed' : result.error;
  }
  return result.capabilities.reason ?? 'ok';
}
