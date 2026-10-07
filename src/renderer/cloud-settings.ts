// ============================================================================
// TP-Link cloud access in Settings (inbox item I-1c1): the "TP-Link cloud
// (optional)" section — Region, cloud Client ID, cloud Client Secret (never
// shown back: "(unchanged)" while one is stored), the help and the note on
// where the credential is created, the session-only note, "Remove cloud
// access" with an inline confirmation (staged and applied by Save as
// `removeCloudAccess: true`, like "Remove management access"), and "Test
// cloud access" over cloud:test. The rules are pure, in cloud-form.ts;
// settings-modal.ts opens, closes and saves the modal and asks this module
// for the section's part of each step.
//
// "Test cloud access" tests the SAVED credential only (main takes no
// argument): unsaved cloud edits are refused here, without calling main
// ("save first"). A reply is shown only while it belongs to the run on
// screen: every Settings open and close and every staged removal start a new
// run number (resetCloudTest()), so a late reply never paints into a closed
// or reopened Settings (isCloudTestCurrent()). Main itself answers
// 'superseded' when the credential was saved or removed while it ran, which
// is shown as such — never as a current result.
// ============================================================================

import type { CloudController, CloudRegion, RendererConfig } from '../shared/types';
import {
  CLOUD_REGIONS,
  CLOUD_TEST_TEXT,
  DEFAULT_CLOUD_REGION,
  cloudControllerStatusKey,
  cloudSecretAffordance,
  cloudTestOutcome,
  cloudTestSummaryKey,
  cloudTestTone,
  hasUnsavedCloudChanges,
  isCloudTestCurrent,
  parseCloudAccessResult,
  parseCloudAccessStatus,
  planCloudSave,
  type CloudFormPlan,
  type CloudSecretAffordance,
  type CloudTestOutcome,
  type ParsedCloudResult,
} from './cloud-form';
import {
  cancelCloudRemoveBtn,
  cloudClientIdInput,
  cloudClientSecretInput,
  cloudCredentialHelp,
  cloudHeading,
  cloudHelp,
  cloudRegionSelect,
  cloudRemovalNote,
  cloudRemoveConfirm,
  cloudRemoveMessage,
  cloudSessionNote,
  cloudTestResult,
  confirmCloudRemoveBtn,
  labelCloudClientId,
  labelCloudClientSecret,
  labelCloudRegion,
  removeCloudBtn,
  settingsModal,
  testCloudBtn,
  undoCloudRemovalBtn,
} from './elements';
import { t, tFormat, type Translations } from './i18n';
import { state } from './state';

// The name of each region in the select
const REGION_TEXT: Record<CloudRegion, keyof Translations> = {
  aps: 'cloudRegionAps',
  euw: 'cloudRegionEuw',
  use: 'cloudRegionUse',
};

// i18n key of each cloud Client Secret placeholder (see cloudSecretAffordance())
const CLOUD_SECRET_PLACEHOLDERS: Record<Exclude<CloudSecretAffordance, 'none'>, keyof Translations> = {
  unchanged: 'passwordUnchanged',
  requiredNewRegion: 'cloudSecretRequiredNewRegion',
  requiredNewClientId: 'clientSecretRequiredNewClientId',
};

// A reply that could not be read (the call threw): shown as 'failed'
const UNUSABLE_REPLY: ParsedCloudResult = { ok: false, error: 'invalid', code: null, diagnostic: null };

/**
 * Writes the section's static strings in the active language: heading, help
 * and credential note, the labels, the region names, the notes, the removal
 * controls and the test button (apply-translations.ts calls it; the secret
 * placeholder and the result are written per open / per run).
 */
export function applyCloudTranslations(): void {
  cloudHeading.textContent = t('cloudTitle');
  cloudHelp.textContent = t('cloudHelp');
  cloudCredentialHelp.textContent = t('cloudCredentialHelp');
  labelCloudRegion.textContent = t('cloudRegion');
  for (const option of Array.from(cloudRegionSelect.options)) {
    const region = CLOUD_REGIONS.find((candidate) => candidate === option.value);
    if (region !== undefined) {
      option.textContent = t(REGION_TEXT[region]);
    }
  }
  labelCloudClientId.textContent = t('clientId');
  labelCloudClientSecret.textContent = t('clientSecret');
  cloudSessionNote.textContent = t('cloudSessionOnly');
  cloudRemovalNote.textContent = t('cloudRemovalPending');
  cloudRemoveMessage.textContent = t('cloudRemoveConfirm');
  removeCloudBtn.textContent = t('cloudRemove');
  undoCloudRemovalBtn.textContent = t('cloudUndoRemoval');
  cancelCloudRemoveBtn.textContent = t('cancel');
  confirmCloudRemoveBtn.textContent = t('cloudRemoveAction');
  testCloudBtn.textContent = t('cloudTest');
} // End of function applyCloudTranslations()

/**
 * Fills the section from the loaded config: the stored region and cloud
 * Client ID in their fields, the secret field always empty (the secret never
 * reaches the renderer; only `hasCloudSecret` does), the flags in state, no
 * removal staged, no confirmation open and no old test result. The flags
 * arriving over IPC are validated (parseCloudAccessStatus(): a missing or
 * malformed field reads as "nothing stored").
 * @param {RendererConfig} config - The config from loadConfig().
 */
export function loadCloudSection(config: RendererConfig): void {
  const cloud = parseCloudAccessStatus(config.cloudAccess);
  state.settingsCloudRegion = cloud.region;
  state.settingsCloudClientId = cloud.clientId;
  state.settingsHasCloudSecret = cloud.hasCloudSecret;
  state.settingsCloudSecretSessionOnly = cloud.cloudSecretSessionOnly;
  state.settingsCanPersistCloudSecret = cloud.canPersistCloudSecret;
  state.settingsRemoveCloud = false;
  cloudRegionSelect.value = cloud.region;
  cloudClientIdInput.value = cloud.clientId;
  cloudClientSecretInput.value = '';
  cloudRemoveConfirm.hidden = true;
  resetCloudTest();
  updateCloudAffordance();
} // End of function loadCloudSection()

/**
 * Brings the section up to date with its state: the cloud Client Secret
 * placeholder (what leaving it blank means, cloudSecretAffordance()), the
 * session-only note (shown when a typed secret could not be stored
 * encrypted, or the current one is session-only; it then describes the
 * secret field), and the removal controls — "Remove cloud access" is
 * enabled only when a Client ID or a secret is stored, and once a removal is
 * staged the fields are emptied and disabled, the pending-removal note shows
 * and "Keep cloud access" replaces the Remove button. Called on open and on
 * every region or Client ID edit.
 */
export function updateCloudAffordance(): void {
  const staged = state.settingsRemoveCloud;
  const affordance = staged
    ? 'none'
    : cloudSecretAffordance({
        hasCloudSecret: state.settingsHasCloudSecret,
        regionField: cloudRegionSelect.value,
        clientIdField: cloudClientIdInput.value,
        storedRegion: state.settingsCloudRegion,
        storedClientId: state.settingsCloudClientId,
      });
  cloudClientSecretInput.placeholder = affordance === 'none' ? '' : t(CLOUD_SECRET_PLACEHOLDERS[affordance]);

  const sessionOnly = !staged && (!state.settingsCanPersistCloudSecret || state.settingsCloudSecretSessionOnly);
  cloudSessionNote.hidden = !sessionOnly;
  if (sessionOnly) {
    cloudClientSecretInput.setAttribute('aria-describedby', 'cloudSessionNote');
  } else {
    cloudClientSecretInput.removeAttribute('aria-describedby');
  }

  cloudRegionSelect.disabled = staged;
  cloudClientIdInput.disabled = staged;
  cloudClientSecretInput.disabled = staged;
  cloudRemovalNote.hidden = !staged;
  undoCloudRemovalBtn.hidden = !staged;
  removeCloudBtn.hidden = staged || !cloudRemoveConfirm.hidden;
  removeCloudBtn.disabled = state.settingsCloudClientId === '' && !state.settingsHasCloudSecret;
} // End of function updateCloudAffordance()

/**
 * "Remove cloud access" handler: asks for confirmation inline (no second
 * modal), with focus on its Cancel.
 */
export function requestCloudRemoval(): void {
  if (removeCloudBtn.disabled || state.settingsRemoveCloud) return;
  cloudRemoveConfirm.hidden = false;
  removeCloudBtn.hidden = true;
  cancelCloudRemoveBtn.focus();
}

/**
 * Cancel handler of the inline removal confirmation: back to the Remove button.
 */
export function cancelCloudRemoval(): void {
  cloudRemoveConfirm.hidden = true;
  updateCloudAffordance();
  removeCloudBtn.focus();
}

/**
 * Escape inside Settings (settings-modal.ts cancelSettingsInlineConfirm()):
 * cancels the removal confirmation when it is open.
 * @returns {boolean} True when the confirmation was open (and is now cancelled).
 */
export function cancelCloudRemovalIfOpen(): boolean {
  if (cloudRemoveConfirm.hidden) return false;
  cancelCloudRemoval();
  return true;
}

/**
 * Confirm handler of the inline removal confirmation: stages the removal
 * (applied by Save as `removeCloudAccess: true`; Cancel, closing the modal or
 * "Keep cloud access" drop it), returns the section to empty (the default
 * region, no Client ID, no secret), clears any shown test result (it
 * described the credential being removed; a run in flight is discarded) and
 * moves focus to "Keep cloud access".
 */
export function confirmCloudRemoval(): void {
  state.settingsRemoveCloud = true;
  cloudRemoveConfirm.hidden = true;
  cloudRegionSelect.value = DEFAULT_CLOUD_REGION;
  cloudClientIdInput.value = '';
  cloudClientSecretInput.value = '';
  resetCloudTest();
  updateCloudAffordance();
  undoCloudRemovalBtn.focus();
}

/**
 * "Keep cloud access" handler: drops the staged removal and restores the
 * stored region and cloud Client ID in their fields.
 */
export function undoCloudRemoval(): void {
  state.settingsRemoveCloud = false;
  cloudRegionSelect.value = state.settingsCloudRegion;
  cloudClientIdInput.value = state.settingsCloudClientId;
  updateCloudAffordance();
  removeCloudBtn.focus();
}

/**
 * The cloud-access part of a settings save, from the section's state
 * (planCloudSave(): the fields to send, or the refusal to show).
 * @returns {CloudFormPlan} The plan.
 */
export function planCloudSettingsSave(): CloudFormPlan {
  return planCloudSave({
    removeStaged: state.settingsRemoveCloud,
    regionField: cloudRegionSelect.value,
    clientIdField: cloudClientIdInput.value,
    clientSecretField: cloudClientSecretInput.value,
    storedRegion: state.settingsCloudRegion,
    storedClientId: state.settingsCloudClientId,
    hasCloudSecret: state.settingsHasCloudSecret,
  });
} // End of function planCloudSettingsSave()

/**
 * Empties the typed cloud Client Secret (Settings closed: a typed secret
 * never lingers in the DOM).
 */
export function clearCloudSecret(): void {
  cloudClientSecretInput.value = '';
}

/**
 * Hides the test's result and starts a new run number, so a reply still in
 * flight is discarded when it arrives (Settings opened or closed, a removal
 * staged, a cloud field edited: an old result would describe settings that
 * may have changed). The button is usable again at once.
 */
export function resetCloudTest(): void {
  state.cloudTestRun++;
  state.isTestingCloud = false;
  cloudTestResult.hidden = true;
  cloudTestResult.replaceChildren();
  delete cloudTestResult.dataset.result;
  delete cloudTestResult.dataset.tone;
  testCloudBtn.setAttribute('aria-disabled', 'false');
}

/**
 * Region, Client ID or Client Secret edit handler: a test in flight or on
 * screen describes the credential before the edit, so it is discarded
 * (resetCloudTest()), then the secret placeholder is refreshed.
 */
export function handleCloudFieldEdit(): void {
  resetCloudTest();
  updateCloudAffordance();
}

/**
 * Builds one controller of a successful test: its name, its version when
 * reported, and its status — available, or why it cannot be used. Every
 * value is set as text (names come from TP-Link). `data-reason` carries the
 * reason code ('none' when connectable).
 * @param {CloudController} controller - The validated controller.
 * @returns {HTMLLIElement} The list item.
 */
function controllerItem(controller: CloudController): HTMLLIElement {
  const item = document.createElement('li');
  item.dataset.reason = controller.reason ?? 'none';
  const name = document.createElement('span');
  name.className = 'cloud-controller-name';
  name.textContent = controller.name;
  item.append(name);
  if (controller.version !== null) {
    const version = document.createElement('span');
    version.className = 'cloud-controller-version';
    version.textContent = tFormat('controllerVersionLabel', { version: controller.version });
    item.append(version);
  }
  const status = document.createElement('span');
  status.className = 'cloud-controller-status';
  status.textContent = t(cloudControllerStatusKey(controller));
  item.append(status);
  return item;
} // End of function controllerItem()

/**
 * Shows one outcome in the result box (role="status"): the summary line —
 * the outcome's text with its detail (main's diagnostic) in parentheses, or
 * for a success how many controllers were found — then, for a success, the
 * list of controllers and the incomplete-list note when main flagged it.
 * The display is exposed as data-result and the tone as data-tone.
 * @param {CloudTestOutcome} outcome - What to show.
 */
function showCloudTest(outcome: CloudTestOutcome): void {
  const summary = document.createElement('p');
  summary.className = 'cloud-test-summary';
  const count = outcome.controllers.length;
  const text = outcome.display === 'ok' ? tFormat(cloudTestSummaryKey(count), { count: String(count) }) : t(CLOUD_TEST_TEXT[outcome.display]);
  summary.textContent = outcome.detail ? `${text} (${outcome.detail})` : text;
  const children: HTMLElement[] = [summary];
  if (outcome.display === 'ok' && count > 0) {
    const list = document.createElement('ul');
    list.className = 'cloud-test-list';
    list.setAttribute('aria-label', t('cloudControllersLabel'));
    list.append(...outcome.controllers.map(controllerItem));
    children.push(list);
  }
  if (outcome.display === 'ok' && outcome.truncated) {
    const note = document.createElement('p');
    note.className = 'cloud-test-note';
    note.textContent = t('cloudTestTruncated');
    children.push(note);
  }
  cloudTestResult.replaceChildren(...children);
  cloudTestResult.dataset.result = outcome.display;
  cloudTestResult.dataset.tone = cloudTestTone(outcome.display);
  cloudTestResult.hidden = false;
} // End of function showCloudTest()

/**
 * Shows a line that is not a finished run's result (the line while it runs,
 * the "save first" refusal).
 * @param {'testing' | 'unsavedChanges'} display - What to show.
 */
function showCloudTestLine(display: 'testing' | 'unsavedChanges'): void {
  showCloudTest({ display, detail: null, controllers: [], truncated: false });
}

/**
 * "Test cloud access" handler. Refuses, without asking main, while the
 * section holds unsaved cloud changes ("save first": main tests the saved
 * credential only). Otherwise asks main (cloud:test: a fresh token and the
 * organization list; no connection to a controller is needed), validates the
 * reply and shows the controllers found — each with why it cannot be used —
 * or the precise failure. The reply is discarded unless it still belongs to
 * the run on screen (isCloudTestCurrent(): no Settings close / reopen, no
 * staged removal, no cloud field edit, no newer run meanwhile). One run at a
 * time: clicks while it runs are ignored (the button stays focusable, aria-disabled).
 * @returns {Promise<void>}
 */
export async function runCloudTest(): Promise<void> {
  if (state.isTestingCloud) return;
  const unsaved = hasUnsavedCloudChanges({
    removeStaged: state.settingsRemoveCloud,
    regionField: cloudRegionSelect.value,
    clientIdField: cloudClientIdInput.value,
    clientSecretField: cloudClientSecretInput.value,
    storedRegion: state.settingsCloudRegion,
    storedClientId: state.settingsCloudClientId,
  });
  if (unsaved) {
    showCloudTestLine('unsavedChanges');
    return;
  }

  state.cloudTestRun++;
  const run = state.cloudTestRun;
  state.isTestingCloud = true;
  testCloudBtn.setAttribute('aria-disabled', 'true');
  showCloudTestLine('testing');
  let result = UNUSABLE_REPLY;
  try {
    result = parseCloudAccessResult(await window.omadaAPI.testCloudAccess());
  } catch (error) {
    console.warn('Error testing cloud access:', error);
  }

  if (!isCloudTestCurrent(run, state.cloudTestRun, settingsModal.classList.contains('visible'))) {
    // Settings closed or reopened, a removal was staged, a cloud field was
    // edited or a newer run started meanwhile: resetCloudTest() already freed the button
    return;
  }
  state.isTestingCloud = false;
  testCloudBtn.setAttribute('aria-disabled', 'false');
  showCloudTest(cloudTestOutcome(result));
} // End of function runCloudTest()
