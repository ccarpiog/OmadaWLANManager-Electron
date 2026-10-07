// ============================================================================
// Wi-Fi network dialog (todo.md 4.11; docs/management-design.md §3, §4.5,
// §4.7): one static modal in index.html (#networkModal) whose form and
// summary are built per open with DOM APIs only (network and group names can
// never be interpreted as markup), for the five network writes:
//   create   — name, security (Open / WPA-Personal), the passphrase twice
//              (WPA-Personal only), bands, the AP groups to bind, "Enable
//              after creating" (off);
//   edit     — the staged form (name, security, bands, and the re-typed
//              passphrase twice whenever the result is WPA-Personal), then
//              the review of the changes (Back / Cancel / Save);
//   password — the new passphrase twice;
//   enable / disable / delete — the confirmation with its impact summary;
//              it opens on Cancel, never on the confirming button.
// Like the other modals: role="dialog" + aria-modal, the Tab focus trap and
// the inert background (modal-focus.ts), Escape = Cancel (the staged edit is
// discarded). Enter in a text or password field confirms the step. Every
// step needs its own deliberate interaction: the confirming button ignores
// the second (and later) click of a multi-click — a double-click on "Review
// changes" shows the review and never also saves it — and a held Enter's
// repeats are swallowed (they neither confirm nor activate the focused
// button of the next step). While a
// write and the reload after it run, the dialog shows the progress
// (role="status"), its controls are disabled and Escape is ignored; a
// refusal — the client-side check or main's answer — is shown on the error
// line (role="alert") and the dialog stays open for another try.
// Passphrase hygiene: the password fields are type="password" with
// autocomplete="new-password", never prefilled, cleared when they are
// hidden (security switched to Open), as soon as a write carrying them
// succeeded and when the dialog closes, and removed from the DOM with the
// form; their value is only read on demand
// (readPassphrase()) right before a check or a write, never stored. The
// caller (network-flow.ts) drives the dialog and restores focus after
// close().
// ============================================================================

import type { NetworkBand, WritableNetworkSecurity } from '../shared/types';
import {
  backNetworkBtn,
  cancelNetworkBtn,
  confirmNetworkBtn,
  networkModal,
  networkModalError,
  networkModalForm,
  networkModalMessage,
  networkModalStatus,
  networkModalSummary,
  networkModalTitle,
} from './elements';
import { t } from './i18n';
import { createFocusTrap, updateBackgroundInert } from './modal-focus';
import type { SummaryRow } from './network-editing';

/** Which write the dialog is for. */
export type NetworkDialogKind = 'create' | 'edit' | 'password' | 'enable' | 'disable' | 'delete';

/** One AP group the create form offers to bind. */
export interface GroupOption {
  id: string;
  name: string;
  // Secondary text (its AP count)
  meta: string;
}

/**
 * The fields of a form (create, edit, password); an absent field is not
 * shown. `passphrase.whenWpaPersonal`: the passphrase fields follow the
 * security choice (shown for WPA-Personal only) instead of always showing.
 */
export interface NetworkFormSpec {
  name?: { value: string };
  security?: { value: WritableNetworkSecurity };
  passphrase?: { whenWpaPersonal: boolean; note: string | null };
  bands?: { value: readonly NetworkBand[]; note: string | null };
  groups?: { options: readonly GroupOption[] };
  enableAfter?: boolean;
}

/** A summary under the message: rows (label, value) and notes. */
export interface NetworkSummary {
  rows: readonly SummaryRow[];
  notes: readonly string[];
}

/** What one opening of the dialog shows. */
export interface NetworkDialogContent {
  kind: NetworkDialogKind;
  title: string;
  message: string;
  confirmLabel: string;
  // The confirming button in the destructive colour (disable, delete)
  danger: boolean;
  form: NetworkFormSpec | null;
  summary: NetworkSummary | null;
}

/** The user's choice: the confirming button (or Enter), Back (review step), or null for Cancel / Escape / a closed dialog. */
export type NetworkDialogChoice = 'confirm' | 'back' | null;

/** The form's values (never the passphrase: see readPassphrase()). */
export interface NetworkFormValues {
  name: string;
  security: WritableNetworkSecurity;
  bands: NetworkBand[];
  apGroupIds: string[];
  enableAfter: boolean;
}

/** The field a refusal is about (focus goes there). */
export type NetworkField = 'name' | 'passphrase' | 'confirmation' | 'bands' | 'groups' | null;

/**
 * The open dialog: one instance per flow (openNetworkDialog()).
 */
export interface NetworkDialog {
  // Waits for the user's next choice
  next(): Promise<NetworkDialogChoice>;
  // The form's values now (an absent field reads as empty)
  readForm(): NetworkFormValues;
  // The two password fields as typed, read on demand (never kept)
  readPassphrase(): { passphrase: string; confirmation: string };
  // Empties the two password fields (a write carrying them succeeded)
  clearPassphrase(): void;
  // Edit: shows the review step (the form hidden, kept): its title,
  // message, rows and notes, Back visible, focus on Cancel
  showReview(title: string, message: string, summary: NetworkSummary, confirmLabel: string): void;
  // Edit: back to the form step
  showForm(): void;
  // Shows the progress of the write (or the reload after it)
  showBusy(text: string): void;
  // Shows a refusal and gives the dialog back to the user (focus on the
  // field it is about, else the first field, else Cancel)
  showError(text: string, field: NetworkField): void;
  // Hides the dialog, clears and removes the form; idempotent
  close(): void;
}

// The bands of the form, in display order
const FORM_BANDS: readonly NetworkBand[] = ['band2g', 'band5g', 'band6g'];

/**
 * The multi-click guard of a dialog's confirming button (shared with the
 * "Broadcast on" dialog, binding-dialog.ts): only a single click (or a
 * keyboard activation, detail 0) counts. The second click of a double-click
 * arrives after the first one moved the dialog to its next step (whose
 * confirming button is the same one): it must never confirm that step too.
 * @param {MouseEvent} e - The click event.
 * @returns {boolean} True for the second (or a later) click of a multi-click.
 */
export function isRepeatedClick(e: MouseEvent): boolean {
  return e.detail > 1;
}

/**
 * The held-Enter guard of a dialog (shared with binding-dialog.ts): the
 * repeats of a held Enter key are swallowed while the dialog is open, so one
 * key press never steps through two steps.
 * @param {KeyboardEvent} e - The keydown event.
 * @returns {boolean} True for a repeat of a held Enter.
 */
export function isHeldEnterRepeat(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && e.repeat;
}

// Ids of the per-open fields (unique while the dialog is open)
const NAME_INPUT_ID = 'networkNameInput';
const NAME_HINT_ID = 'networkNameHint';
const PASSPHRASE_FIELD_ID = 'networkPassphraseField';
const PASSPHRASE_INPUT_ID = 'networkPassphraseInput';
const CONFIRMATION_INPUT_ID = 'networkPassphraseConfirmInput';
const PASSPHRASE_HINT_ID = 'networkPassphraseHint';
const ENABLE_AFTER_INPUT_ID = 'networkEnableAfterInput';

/**
 * Builds a labelled text or password field (a form-group: label, input,
 * optional help line it is described by).
 * @param {string} id - The input id.
 * @param {'text' | 'password'} type - The input type.
 * @param {string} label - The label.
 * @param {string | null} hintId - The id of the help line it is described by, or null.
 * @returns {{ group: HTMLDivElement; input: HTMLInputElement }} The field and its input.
 */
function createInputField(id: string, type: 'text' | 'password', label: string, hintId: string | null): { group: HTMLDivElement; input: HTMLInputElement } {
  const group = document.createElement('div');
  group.className = 'form-group network-field';
  const labelElement = document.createElement('label');
  labelElement.htmlFor = id;
  labelElement.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.id = id;
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  // Password fields: never offered a saved value, never saved (spec §3)
  input.autocomplete = type === 'password' ? 'new-password' : 'off';
  const describedBy = [hintId, 'networkModalError'].filter((value): value is string => value !== null).join(' ');
  input.setAttribute('aria-describedby', describedBy);
  group.append(labelElement, input);
  return { group, input };
} // End of function createInputField()

/**
 * Builds a help line of the form.
 * @param {string} text - The text.
 * @param {string} kind - Its data-note value.
 * @param {string} [id] - Its id (when a field is described by it).
 * @returns {HTMLParagraphElement} The line.
 */
function createHelp(text: string, kind: string, id?: string): HTMLParagraphElement {
  const help = document.createElement('p');
  help.className = 'form-help network-help';
  help.dataset.note = kind;
  if (id !== undefined) help.id = id;
  help.textContent = text;
  return help;
}

/**
 * Builds a native checkbox or radio with its label text (and an optional
 * secondary text) inside its label.
 * @param {'checkbox' | 'radio'} type - The input type.
 * @param {string} name - The input's name.
 * @param {string} value - Its value.
 * @param {string} text - The label text.
 * @param {boolean} checked - Initially checked.
 * @param {string} [meta] - Secondary text.
 * @returns {{ label: HTMLLabelElement; input: HTMLInputElement }} The choice and its input.
 */
function createChoice(type: 'checkbox' | 'radio', name: string, value: string, text: string, checked: boolean, meta?: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement('label');
  label.className = 'network-choice';
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.value = value;
  input.checked = checked;
  const span = document.createElement('span');
  span.className = 'network-choice-text';
  span.textContent = text;
  label.append(input, span);
  if (meta !== undefined) {
    const extra = document.createElement('span');
    extra.className = 'detail-meta';
    extra.textContent = meta;
    label.appendChild(extra);
  }
  return { label, input };
} // End of function createChoice()

/**
 * Builds a fieldset with its legend.
 * @param {string} id - The fieldset id.
 * @param {string} legend - The legend.
 * @returns {HTMLFieldSetElement} The fieldset.
 */
function createFieldset(id: string, legend: string): HTMLFieldSetElement {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'network-fieldset';
  fieldset.id = id;
  const legendElement = document.createElement('legend');
  legendElement.textContent = legend;
  fieldset.appendChild(legendElement);
  return fieldset;
}

/** The per-open controls of the form (null / empty when the form has no such field). */
interface FormControls {
  nameInput: HTMLInputElement | null;
  securityInputs: HTMLInputElement[];
  passphraseField: HTMLElement | null;
  passphraseInput: HTMLInputElement | null;
  confirmationInput: HTMLInputElement | null;
  bandInputs: HTMLInputElement[];
  groupInputs: HTMLInputElement[];
  enableAfterInput: HTMLInputElement | null;
}

/**
 * Builds the form of one open (create, edit, password) with DOM APIs: the
 * name field, the security choice, the passphrase fields (with their hint
 * and note), the bands, the AP groups and "Enable after creating", each
 * only when the spec has it. The passphrase fields start empty.
 * @param {NetworkFormSpec} form - The fields.
 * @returns {{ blocks: HTMLElement[]; controls: FormControls }} The form's blocks and its controls.
 */
function buildForm(form: NetworkFormSpec): { blocks: HTMLElement[]; controls: FormControls } {
  const controls: FormControls = {
    nameInput: null,
    securityInputs: [],
    passphraseField: null,
    passphraseInput: null,
    confirmationInput: null,
    bandInputs: [],
    groupInputs: [],
    enableAfterInput: null,
  };
  const blocks: HTMLElement[] = [];
  if (form.name !== undefined) {
    const field = createInputField(NAME_INPUT_ID, 'text', t('networkNameLabel'), NAME_HINT_ID);
    field.input.value = form.name.value;
    field.group.appendChild(createHelp(t('networkNameHint'), 'nameHint', NAME_HINT_ID));
    controls.nameInput = field.input;
    blocks.push(field.group);
  }
  if (form.security !== undefined) {
    const fieldset = createFieldset('networkSecurityField', t('networkSecurityLabel'));
    for (const security of ['open', 'wpaPersonal'] as const) {
      const choice = createChoice('radio', 'networkSecurity', security, t(security === 'open' ? 'securityOpen' : 'securityWpaPersonal'), form.security.value === security);
      controls.securityInputs.push(choice.input);
      fieldset.appendChild(choice.label);
    }
    blocks.push(fieldset);
  }
  if (form.passphrase !== undefined) {
    const wrapper = document.createElement('div');
    wrapper.className = 'network-passphrase';
    wrapper.id = PASSPHRASE_FIELD_ID;
    const first = createInputField(PASSPHRASE_INPUT_ID, 'password', t('networkPassphraseFieldLabel'), PASSPHRASE_HINT_ID);
    const second = createInputField(CONFIRMATION_INPUT_ID, 'password', t('networkPassphraseConfirmLabel'), PASSPHRASE_HINT_ID);
    controls.passphraseInput = first.input;
    controls.confirmationInput = second.input;
    wrapper.append(first.group, second.group, createHelp(t('networkPassphraseHint'), 'passphraseHint', PASSPHRASE_HINT_ID));
    if (form.passphrase.note !== null) {
      wrapper.appendChild(createHelp(form.passphrase.note, 'passphraseNote'));
    }
    controls.passphraseField = wrapper;
    blocks.push(wrapper);
  }
  if (form.bands !== undefined) {
    const fieldset = createFieldset('networkBandsField', t('networkBandsLabel'));
    const row = document.createElement('div');
    row.className = 'network-choice-row';
    for (const band of FORM_BANDS) {
      const choice = createChoice('checkbox', 'networkBand', band, t(band), form.bands.value.includes(band));
      controls.bandInputs.push(choice.input);
      row.appendChild(choice.label);
    }
    fieldset.appendChild(row);
    if (form.bands.note !== null) {
      fieldset.appendChild(createHelp(form.bands.note, 'bandsNote'));
    }
    blocks.push(fieldset);
  }
  if (form.groups !== undefined) {
    const fieldset = createFieldset('networkGroupsField', t('networkGroupsLegend'));
    const list = document.createElement('div');
    list.className = 'network-group-list';
    for (const option of form.groups.options) {
      const choice = createChoice('checkbox', 'networkGroup', option.id, option.name, false, option.meta);
      controls.groupInputs.push(choice.input);
      list.appendChild(choice.label);
    }
    fieldset.appendChild(list);
    fieldset.appendChild(createHelp(t(form.groups.options.length === 0 ? 'networkGroupsNone' : 'networkGroupsHint'), 'groupsHint'));
    blocks.push(fieldset);
  }
  if (form.enableAfter !== undefined) {
    const choice = createChoice('checkbox', 'networkEnableAfter', 'enable', t('networkEnableAfterLabel'), form.enableAfter);
    choice.input.id = ENABLE_AFTER_INPUT_ID;
    choice.label.classList.add('network-enable-after');
    controls.enableAfterInput = choice.input;
    blocks.push(choice.label);
  }
  return { blocks, controls };
} // End of function buildForm()

/**
 * Builds the summary block (review rows and notes, or a confirmation's
 * impact summary): a definition list and the notes. Shared with the
 * "Broadcast on" dialog (binding-dialog.ts).
 * @param {NetworkSummary} summary - The rows and notes.
 * @returns {HTMLElement[]} The list and the notes.
 */
export function buildSummary(summary: NetworkSummary): HTMLElement[] {
  const list = document.createElement('dl');
  list.className = 'network-summary-rows';
  for (const row of summary.rows) {
    const item = document.createElement('div');
    item.className = 'network-summary-row';
    item.dataset.row = row.kind;
    const term = document.createElement('dt');
    term.textContent = row.label;
    const value = document.createElement('dd');
    value.textContent = row.value;
    item.append(term, value);
    list.appendChild(item);
  } // End of the loop over the summary rows
  const notes = summary.notes.map(text => {
    const note = document.createElement('p');
    note.className = 'network-summary-note';
    note.textContent = text;
    return note;
  });
  return summary.rows.length > 0 ? [list, ...notes] : notes;
} // End of function buildSummary()

/**
 * Opens the Wi-Fi network dialog. Focus starts on the name field (create,
 * edit — its text selected), on the passphrase field (Change password) or
 * on Cancel (the confirmations).
 * @param {NetworkDialogContent} content - What to show.
 * @returns {NetworkDialog} The dialog's controller.
 */
export function openNetworkDialog(content: NetworkDialogContent): NetworkDialog {
  const focusTrap = createFocusTrap(networkModal);
  const spec = content.form;
  let closed = false;
  let busy = false;
  let resolveNext: ((value: NetworkDialogChoice) => void) | null = null;

  // The form of this open and its controls
  const built = spec === null ? null : buildForm(spec);
  const controls: FormControls = built?.controls ?? {
    nameInput: null,
    securityInputs: [],
    passphraseField: null,
    passphraseInput: null,
    confirmationInput: null,
    bandInputs: [],
    groupInputs: [],
    enableAfterInput: null,
  };

  /**
   * Settles a pending next() exactly once.
   * @param {NetworkDialogChoice} value - The user's choice.
   */
  const settle = (value: NetworkDialogChoice): void => {
    const resolve = resolveNext;
    resolveNext = null;
    resolve?.(value);
  };

  /**
   * The security chosen in the form (WPA-Personal when the form has no
   * security choice: Change password).
   * @returns {WritableNetworkSecurity} The choice.
   */
  const chosenSecurity = (): WritableNetworkSecurity => {
    const checked = controls.securityInputs.find(input => input.checked);
    if (checked === undefined) return spec?.security?.value ?? 'wpaPersonal';
    return checked.value === 'open' ? 'open' : 'wpaPersonal';
  };

  /**
   * Shows the passphrase fields when they apply (always, or only for a
   * WPA-Personal choice); hidden ones are emptied at once.
   */
  const syncPassphraseField = (): void => {
    const { passphraseField, passphraseInput, confirmationInput } = controls;
    if (passphraseField === null || spec?.passphrase === undefined) return;
    const shown = !spec.passphrase.whenWpaPersonal || chosenSecurity() === 'wpaPersonal';
    passphraseField.hidden = !shown;
    if (!shown) {
      if (passphraseInput !== null) passphraseInput.value = '';
      if (confirmationInput !== null) confirmationInput.value = '';
    }
  }; // End of function syncPassphraseField()

  /**
   * Shows or hides the error line (and marks the field it is about invalid).
   * @param {string | null} text - The error, or null to clear it.
   * @param {NetworkField} field - The field it is about.
   */
  const setError = (text: string | null, field: NetworkField): void => {
    networkModalError.textContent = text ?? '';
    networkModalError.hidden = text === null;
    const { nameInput, passphraseInput, confirmationInput } = controls;
    for (const input of [nameInput, passphraseInput, confirmationInput]) {
      input?.removeAttribute('aria-invalid');
    }
    if (text === null) return;
    const target = field === 'name' ? nameInput : field === 'passphrase' ? passphraseInput : field === 'confirmation' ? confirmationInput : null;
    target?.setAttribute('aria-invalid', 'true');
  }; // End of function setError()

  /** Confirming button (and Enter in a text or password field). */
  const handleConfirm = (): void => {
    if (busy) return;
    settle('confirm');
  };

  /**
   * A click on the confirming button: only a single click (or a keyboard
   * activation, detail 0) counts. The second click of a double-click
   * arrives after the first one moved the dialog to its next step (the
   * edit's review, whose confirming button is the same one): it must never
   * confirm that step too.
   * @param {MouseEvent} e - The click event.
   */
  const handleConfirmClick = (e: MouseEvent): void => {
    if (isRepeatedClick(e)) return;
    handleConfirm();
  };

  /** Back button (review step). */
  const handleBack = (): void => {
    if (busy) return;
    settle('back');
  };

  /** Cancel button. */
  const handleCancel = (): void => {
    if (busy) return;
    settle(null);
  };

  /**
   * Escape cancels (ignored while the write runs); Enter in a text or
   * password field confirms the step. The repeats of a held Enter are
   * swallowed (default prevented: no button activation either), so one
   * key press never steps through two steps.
   * @param {KeyboardEvent} e - The keydown event.
   */
  const handleKeydown = (e: KeyboardEvent): void => {
    if (e.isComposing) return;
    if (isHeldEnterRepeat(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && (e.target.type === 'text' || e.target.type === 'password') && networkModal.contains(e.target)) {
      e.preventDefault();
      handleConfirm();
    }
  }; // End of function handleKeydown()

  /** A security choice changed: the passphrase fields follow. */
  const handleSecurityChange = (): void => {
    syncPassphraseField();
  };

  /**
   * Enables or disables the controls for the write in flight.
   * @param {boolean} value - True while the write (or its reload) runs.
   */
  const setBusy = (value: boolean): void => {
    busy = value;
    confirmNetworkBtn.disabled = value;
    cancelNetworkBtn.disabled = value;
    backNetworkBtn.disabled = value;
    for (const input of networkModalForm.querySelectorAll<HTMLInputElement>('input')) {
      if (input.type === 'text' || input.type === 'password') {
        input.readOnly = value;
      } else {
        input.disabled = value;
      }
    }
    if (value) {
      networkModal.setAttribute('aria-busy', 'true');
    } else {
      networkModal.removeAttribute('aria-busy');
    }
  }; // End of function setBusy()

  /** Focus on the first field of the form, else Cancel. */
  const focusFirstField = (): void => {
    const { nameInput, passphraseField, passphraseInput, bandInputs } = controls;
    const first = nameInput ?? (passphraseField !== null && !passphraseField.hidden ? passphraseInput : null) ?? bandInputs[0] ?? null;
    if (first !== null) {
      first.focus();
    } else {
      cancelNetworkBtn.focus();
    }
  }; // End of function focusFirstField()

  // Fill the dialog for this open
  networkModalTitle.textContent = content.title;
  networkModalMessage.textContent = content.message;
  networkModalForm.replaceChildren(...(built?.blocks ?? []));
  for (const input of controls.securityInputs) {
    input.addEventListener('change', handleSecurityChange);
  }
  networkModalForm.hidden = spec === null;
  networkModalSummary.replaceChildren(...(content.summary === null ? [] : buildSummary(content.summary)));
  networkModalSummary.hidden = content.summary === null;
  networkModal.dataset.kind = content.kind;
  networkModal.dataset.step = spec === null ? 'confirm' : 'form';
  syncPassphraseField();
  setError(null, null);
  networkModalStatus.textContent = '';
  cancelNetworkBtn.textContent = t('cancel');
  backNetworkBtn.textContent = t('networkBackAction');
  backNetworkBtn.hidden = true;
  confirmNetworkBtn.textContent = content.confirmLabel;
  confirmNetworkBtn.classList.toggle('btn-danger', content.danger);
  confirmNetworkBtn.classList.toggle('btn-primary', !content.danger);
  setBusy(false);

  confirmNetworkBtn.addEventListener('click', handleConfirmClick);
  cancelNetworkBtn.addEventListener('click', handleCancel);
  backNetworkBtn.addEventListener('click', handleBack);
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('keydown', focusTrap);
  networkModal.classList.add('visible');
  updateBackgroundInert();
  if (spec === null) {
    // The safe default (spec §4.7): Enter or Escape cancels the confirmation
    cancelNetworkBtn.focus();
  } else if (controls.nameInput !== null) {
    controls.nameInput.focus();
    controls.nameInput.select();
  } else {
    focusFirstField();
  }

  return {
    /**
     * Waits for the user's next choice.
     * @returns {Promise<NetworkDialogChoice>} 'confirm', 'back', or null for Cancel / Escape / a closed dialog.
     */
    next(): Promise<NetworkDialogChoice> {
      if (closed) return Promise.resolve(null);
      settle(null);
      return new Promise<NetworkDialogChoice>(resolve => {
        resolveNext = resolve;
      });
    },

    /**
     * Reads the form's values (never the passphrase).
     * @returns {NetworkFormValues} The values.
     */
    readForm(): NetworkFormValues {
      return {
        name: controls.nameInput?.value ?? '',
        security: chosenSecurity(),
        bands: controls.bandInputs.filter(input => input.checked).map(input => input.value as NetworkBand),
        apGroupIds: controls.groupInputs.filter(input => input.checked).map(input => input.value),
        enableAfter: controls.enableAfterInput?.checked ?? false,
      };
    },

    /**
     * Reads the two password fields as typed (empty when hidden or absent);
     * the caller uses the values at once and keeps none.
     * @returns {{ passphrase: string; confirmation: string }} The fields.
     */
    readPassphrase(): { passphrase: string; confirmation: string } {
      const { passphraseField, passphraseInput, confirmationInput } = controls;
      if (passphraseField === null || passphraseField.hidden) return { passphrase: '', confirmation: '' };
      return { passphrase: passphraseInput?.value ?? '', confirmation: confirmationInput?.value ?? '' };
    },

    /**
     * Empties the two password fields at once (the write that carried the
     * passphrase succeeded: it is not kept while the reload runs).
     */
    clearPassphrase(): void {
      if (controls.passphraseInput !== null) controls.passphraseInput.value = '';
      if (controls.confirmationInput !== null) controls.confirmationInput.value = '';
    },

    /**
     * Shows the review step of an edit: the form hidden (kept for Back), the
     * review's title, message, rows and notes, Back visible and the saving
     * label on the confirming button; focus on Cancel (spec §4.7).
     * @param {string} title - The review's title.
     * @param {string} message - Its message.
     * @param {NetworkSummary} summary - The changes and notes.
     * @param {string} confirmLabel - The saving button's label.
     */
    showReview(title: string, message: string, summary: NetworkSummary, confirmLabel: string): void {
      if (closed) return;
      setError(null, null);
      networkModalTitle.textContent = title;
      networkModalMessage.textContent = message;
      networkModalForm.hidden = true;
      networkModalSummary.replaceChildren(...buildSummary(summary));
      networkModalSummary.hidden = false;
      networkModal.dataset.step = 'review';
      backNetworkBtn.hidden = false;
      confirmNetworkBtn.textContent = confirmLabel;
      cancelNetworkBtn.focus();
    }, // End of method showReview()

    /**
     * Back to the form step of an edit (its values as they were).
     */
    showForm(): void {
      if (closed) return;
      networkModalTitle.textContent = content.title;
      networkModalMessage.textContent = content.message;
      networkModalSummary.replaceChildren();
      networkModalSummary.hidden = true;
      networkModalForm.hidden = false;
      networkModal.dataset.step = 'form';
      backNetworkBtn.hidden = true;
      confirmNetworkBtn.textContent = content.confirmLabel;
      focusFirstField();
    }, // End of method showForm()

    /**
     * Shows the progress of the write or its reload.
     * @param {string} text - The progress text.
     */
    showBusy(text: string): void {
      if (closed) return;
      setBusy(true);
      setError(null, null);
      networkModalStatus.textContent = text;
      // Every control is disabled or read-only now: keep focus inside the
      // dialog, on the progress line
      if (document.activeElement !== networkModalStatus) {
        networkModalStatus.focus();
      }
    }, // End of method showBusy()

    /**
     * Shows a refusal and gives the dialog back to the user.
     * @param {string} text - The refusal (client-side check or main's answer).
     * @param {NetworkField} field - The field it is about (focus goes there).
     */
    showError(text: string, field: NetworkField): void {
      if (closed) return;
      setBusy(false);
      networkModalStatus.textContent = '';
      setError(text, field);
      if (networkModalForm.hidden) {
        cancelNetworkBtn.focus();
        return;
      }
      const target =
        field === 'name' ? controls.nameInput
        : field === 'passphrase' ? controls.passphraseInput
        : field === 'confirmation' ? controls.confirmationInput
        : field === 'bands' ? controls.bandInputs[0] ?? null
        : field === 'groups' ? controls.groupInputs[0] ?? null
        : null;
      if (target !== null && !target.closest('[hidden]')) {
        target.focus();
      } else {
        focusFirstField();
      }
    }, // End of method showError()

    /**
     * Hides the dialog, removes every listener, empties the password fields
     * and removes the per-open form and summary, and lifts the background
     * inertness (the caller then restores focus); settles a pending next()
     * with null. Idempotent.
     */
    close(): void {
      if (closed) return;
      closed = true;
      networkModal.classList.remove('visible');
      confirmNetworkBtn.removeEventListener('click', handleConfirmClick);
      cancelNetworkBtn.removeEventListener('click', handleCancel);
      backNetworkBtn.removeEventListener('click', handleBack);
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('keydown', focusTrap);
      setBusy(false);
      for (const input of networkModalForm.querySelectorAll<HTMLInputElement>('input')) {
        if (input.type === 'password' || input.type === 'text') input.value = '';
      }
      networkModalForm.replaceChildren();
      networkModalSummary.replaceChildren();
      for (const input of controls.securityInputs) {
        input.removeEventListener('change', handleSecurityChange);
      }
      controls.nameInput = null;
      controls.passphraseField = null;
      controls.passphraseInput = null;
      controls.confirmationInput = null;
      controls.enableAfterInput = null;
      controls.securityInputs = [];
      controls.bandInputs = [];
      controls.groupInputs = [];
      setError(null, null);
      networkModalStatus.textContent = '';
      backNetworkBtn.hidden = true;
      delete networkModal.dataset.kind;
      delete networkModal.dataset.step;
      // Lift the background inertness; the caller then moves focus back
      // into the page (focus cannot enter an inert subtree)
      updateBackgroundInert();
      settle(null);
    }, // End of method close()
  }; // End of the dialog controller
} // End of function openNetworkDialog()
