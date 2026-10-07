// ============================================================================
// "Broadcast on" dialog (todo.md 4.12, phase 19b; docs/management-design.md
// §4.5, §4.7): one static modal in index.html (#bindingModal) whose editor
// and summary are built per open with DOM APIs only (group names can never
// be interpreted as markup). Two steps:
//   edit   — a search over the AP groups, one native checkbox per group (its
//            name and AP count; the network's current groups ticked), the
//            selection line ("N groups selected · M hidden by the search",
//            aria-live), and the live preview the caller computes for the
//            selection (network-bindings.ts bindingPreview(): the reach now
//            and after, the added / removed / kept groups, the capacity
//            pre-check's problems named per group and band, notes); "Review
//            the change" is disabled while nothing changed;
//   review — the confirmation of the change (rows and notes), Back to the
//            editor (the selection kept), Cancel, "Save AP groups"; it
//            opens on Cancel (the safe default).
// Like the other modals: role="dialog" + aria-modal, the Tab focus trap and
// the inert background (modal-focus.ts). Escape clears the dialog's search
// first (the top context's search, escapeAction() of view-state.ts), else
// cancels; Enter in the search field does nothing. Every step needs its own
// deliberate interaction (the 18b guard of network-dialog.ts): the
// confirming button ignores the second click of a multi-click and a held
// Enter's repeats are swallowed. While the re-read, the write and the
// reload run, the dialog shows the progress (role="status"), its controls
// are disabled and Escape is ignored; a refusal is shown on the error line
// (role="alert") with the capacity problems as a list, and the dialog stays
// open. The caller (binding-flow.ts) drives the dialog and restores focus
// after close().
// ============================================================================

import {
  backBindingBtn,
  bindingModal,
  bindingModalEditor,
  bindingModalError,
  bindingModalMessage,
  bindingModalStatus,
  bindingModalSummary,
  bindingModalTitle,
  cancelBindingBtn,
  confirmBindingBtn,
} from './elements';
import { handleListArrowKeydown, shownListItems } from './dom-helpers';
import { t, tFormat } from './i18n';
import { apCountOrUnknown, displayName } from './inventory-ui';
import { createFocusTrap, updateBackgroundInert } from './modal-focus';
import { filterBindingOptions, type BindingOption, type BindingPreview } from './network-bindings';
import { buildSummary, isHeldEnterRepeat, isRepeatedClick, type NetworkSummary } from './network-dialog';
import { escapeAction } from './view-state';

/** The live preview of a selection (bindingPreview() over the data on screen). */
export type BindingDescriber = (selected: readonly string[], visible: readonly string[]) => BindingPreview;

/** What one opening of the dialog shows. */
export interface BindingDialogContent {
  title: string;
  message: string;
  // The AP groups offered, in order
  options: readonly BindingOption[];
  // The groups ticked at first (the network's current groups)
  selected: readonly string[];
  describe: BindingDescriber;
}

/** The user's choice: the confirming button, Back (review step), or null for Cancel / Escape / a closed dialog. */
export type BindingDialogChoice = 'confirm' | 'back' | null;

/** The open dialog: one instance per flow (openBindingDialog()). */
export interface BindingDialog {
  // Waits for the user's next choice
  next(): Promise<BindingDialogChoice>;
  // The ticked groups now, in the options' order
  selected(): string[];
  // Replaces the options (fresh data): the ticked groups still offered stay
  // ticked, the search stays; the preview follows the new describer
  setOptions(options: readonly BindingOption[], describe: BindingDescriber): void;
  // Back to the edit step (the selection as it was)
  showEditor(): void;
  // Shows the review step: its title, message, rows and notes, Back
  // visible, focus on Cancel
  showReview(title: string, message: string, summary: NetworkSummary, confirmLabel: string): void;
  // Shows the progress of the re-read, the write or the reload
  showBusy(text: string): void;
  // Shows a refusal (its text, the capacity problems, notes) and gives the
  // dialog back to the user
  showError(text: string, lines: readonly string[], notes: readonly string[]): void;
  // Hides the dialog and removes the editor and summary; idempotent
  close(): void;
}

// Ids of the per-open controls (unique while the dialog is open)
const SEARCH_INPUT_ID = 'bindingSearchInput';
const GROUP_LIST_ID = 'bindingGroupList';
const SELECTION_ID = 'bindingSelection';

/** The per-open blocks of the editor. */
interface EditorBlocks {
  root: HTMLElement[];
  search: HTMLInputElement;
  list: HTMLElement;
  empty: HTMLParagraphElement;
  selection: HTMLParagraphElement;
  preview: HTMLDListElement;
  capacity: HTMLElement;
  capacityList: HTMLUListElement;
  notes: HTMLElement;
}

/**
 * Builds the editor's fixed blocks with DOM APIs: the search field, the
 * group list (filled by renderOptions()) with its "no group / no match"
 * line, the selection line, the preview rows, the capacity block and the
 * notes.
 * @returns {EditorBlocks} The blocks.
 */
function buildEditor(): EditorBlocks {
  const search = document.createElement('input');
  search.type = 'text';
  search.id = SEARCH_INPUT_ID;
  search.className = 'filter-input binding-search';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.placeholder = t('bindingSearchPlaceholder');
  search.setAttribute('aria-label', t('bindingSearchLabel'));
  search.setAttribute('aria-controls', GROUP_LIST_ID);

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'network-fieldset binding-groups';
  fieldset.id = 'bindingGroupsField';
  const legend = document.createElement('legend');
  legend.textContent = t('bindingGroupsLegend');
  const list = document.createElement('div');
  list.className = 'network-group-list binding-group-list';
  list.id = GROUP_LIST_ID;
  const empty = document.createElement('p');
  empty.className = 'binding-no-results';
  empty.hidden = true;
  fieldset.append(legend, list, empty);

  const selection = document.createElement('p');
  selection.className = 'form-help binding-selection';
  selection.id = SELECTION_ID;
  selection.setAttribute('aria-live', 'polite');
  const preview = document.createElement('dl');
  preview.className = 'network-summary-rows binding-preview';
  const capacity = document.createElement('div');
  capacity.className = 'binding-capacity';
  capacity.hidden = true;
  const capacityTitle = document.createElement('p');
  capacityTitle.className = 'binding-capacity-title';
  capacityTitle.textContent = t('bindingCapacityTitle');
  const capacityList = document.createElement('ul');
  capacityList.className = 'binding-capacity-list';
  capacity.append(capacityTitle, capacityList);
  const notes = document.createElement('div');
  notes.className = 'binding-notes';

  return { root: [search, fieldset, selection, preview, capacity, notes], search, list, empty, selection, preview, capacity, capacityList, notes };
} // End of function buildEditor()

/**
 * Builds one group's checkbox (its name and AP count inside its label).
 * @param {BindingOption} option - The group.
 * @param {boolean} checked - Initially ticked.
 * @returns {HTMLLabelElement} The choice.
 */
function createGroupChoice(option: BindingOption, checked: boolean): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'network-choice binding-choice';
  label.dataset.groupId = option.id;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = 'bindingGroup';
  input.value = option.id;
  input.checked = checked;
  const name = document.createElement('span');
  name.className = 'network-choice-text';
  name.textContent = displayName(option.name);
  const meta = document.createElement('span');
  meta.className = 'detail-meta';
  meta.textContent = apCountOrUnknown(option.apCount);
  label.append(input, name, meta);
  return label;
} // End of function createGroupChoice()

/**
 * Builds the rows of a preview (a definition list's items).
 * @param {BindingPreview} preview - The preview.
 * @returns {HTMLDivElement[]} The rows.
 */
function createPreviewRows(preview: BindingPreview): HTMLDivElement[] {
  return preview.rows.map(row => {
    const item = document.createElement('div');
    item.className = 'network-summary-row';
    item.dataset.row = row.kind;
    const term = document.createElement('dt');
    term.textContent = row.label;
    const value = document.createElement('dd');
    value.textContent = row.value;
    item.append(term, value);
    return item;
  }); // End of the mapping of the preview rows
} // End of function createPreviewRows()

/**
 * Builds a list of lines (the capacity problems).
 * @param {readonly string[]} lines - The lines.
 * @returns {HTMLLIElement[]} The items.
 */
function createLineItems(lines: readonly string[]): HTMLLIElement[] {
  return lines.map(line => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  });
}

/**
 * Opens the "Broadcast on" dialog on its edit step, focus in the search
 * field.
 * @param {BindingDialogContent} content - What to show.
 * @returns {BindingDialog} The dialog's controller.
 */
export function openBindingDialog(content: BindingDialogContent): BindingDialog {
  const focusTrap = createFocusTrap(bindingModal);
  const editor = buildEditor();
  let options: readonly BindingOption[] = content.options;
  let describe: BindingDescriber = content.describe;
  let step: 'edit' | 'review' = 'edit';
  let closed = false;
  let busy = false;
  let changed = false;
  let resolveNext: ((value: BindingDialogChoice) => void) | null = null;

  /**
   * Settles a pending next() exactly once.
   * @param {BindingDialogChoice} value - The user's choice.
   */
  const settle = (value: BindingDialogChoice): void => {
    const resolve = resolveNext;
    resolveNext = null;
    resolve?.(value);
  };

  /**
   * The group checkboxes now.
   * @returns {HTMLInputElement[]} The inputs, in the options' order.
   */
  const groupInputs = (): HTMLInputElement[] => Array.from(editor.list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));

  /**
   * The ticked groups now.
   * @returns {string[]} Their ids, in the options' order.
   */
  const checkedIds = (): string[] => groupInputs().filter(input => input.checked).map(input => input.value);

  /** The confirming button follows the step: disabled on the edit step while nothing changed. */
  const syncConfirm = (): void => {
    confirmBindingBtn.disabled = busy || (step === 'edit' && !changed);
  };

  /**
   * Applies the search: the groups it does not match are hidden (a ticked
   * one stays ticked), and the line under the list says when none is
   * offered or none matches.
   * @returns {string[]} The ids shown.
   */
  const applySearch = (): string[] => {
    const visible = filterBindingOptions(options, editor.search.value);
    const shown = new Set(visible);
    for (const label of editor.list.querySelectorAll<HTMLLabelElement>('label[data-group-id]')) {
      label.hidden = !shown.has(label.dataset.groupId ?? '');
    }
    if (options.length === 0) {
      editor.empty.textContent = t('bindingNoGroups');
    } else if (visible.length === 0) {
      editor.empty.textContent = tFormat('bindingNoResults', { query: editor.search.value.trim() });
    }
    editor.empty.hidden = options.length > 0 && visible.length > 0;
    return visible;
  }; // End of function applySearch()

  /** Recomputes the live preview for the selection and the search now. */
  const refreshPreview = (): void => {
    const preview = describe(checkedIds(), applySearch());
    changed = preview.changed;
    editor.selection.textContent = preview.selection;
    editor.preview.replaceChildren(...createPreviewRows(preview));
    editor.capacityList.replaceChildren(...createLineItems(preview.capacity));
    editor.capacity.hidden = preview.capacity.length === 0;
    editor.notes.replaceChildren(
      ...preview.notes.map(text => {
        const note = document.createElement('p');
        note.className = 'form-help binding-note';
        note.textContent = text;
        return note;
      })
    );
    syncConfirm();
  }; // End of function refreshPreview()

  /**
   * Renders the options, ticking the given groups.
   * @param {ReadonlySet<string>} ticked - The groups to tick.
   */
  const renderOptions = (ticked: ReadonlySet<string>): void => {
    editor.list.replaceChildren(...options.map(option => createGroupChoice(option, ticked.has(option.id))));
    refreshPreview();
  };

  /**
   * Shows or hides the error line: the refusal's text, the capacity
   * problems as a list, and its notes.
   * @param {string | null} text - The refusal, or null to clear it.
   * @param {readonly string[]} lines - The capacity problems.
   * @param {readonly string[]} notes - The notes.
   */
  const setError = (text: string | null, lines: readonly string[], notes: readonly string[]): void => {
    if (text === null) {
      bindingModalError.replaceChildren();
      bindingModalError.hidden = true;
      return;
    }
    const message = document.createElement('p');
    message.className = 'binding-error-text';
    message.textContent = text;
    const blocks: HTMLElement[] = [message];
    if (lines.length > 0) {
      const list = document.createElement('ul');
      list.className = 'binding-error-list';
      list.append(...createLineItems(lines));
      blocks.push(list);
    }
    for (const text of notes) {
      const note = document.createElement('p');
      note.className = 'binding-error-note';
      note.textContent = text;
      blocks.push(note);
    }
    bindingModalError.replaceChildren(...blocks);
    bindingModalError.hidden = false;
  }; // End of function setError()

  /**
   * Enables or disables the controls for the re-read, write or reload in
   * flight.
   * @param {boolean} value - True while it runs.
   */
  const setBusy = (value: boolean): void => {
    busy = value;
    cancelBindingBtn.disabled = value;
    backBindingBtn.disabled = value;
    editor.search.readOnly = value;
    for (const input of groupInputs()) {
      input.disabled = value;
    }
    if (value) {
      bindingModal.setAttribute('aria-busy', 'true');
    } else {
      bindingModal.removeAttribute('aria-busy');
    }
    syncConfirm();
  }; // End of function setBusy()

  /** Focus on the editor: the first ticked group, else the search field. */
  const focusEditor = (): void => {
    const first = groupInputs().find(input => input.checked && input.closest('[hidden]') === null);
    (first ?? editor.search).focus();
  };

  /** Confirming button. */
  const handleConfirm = (): void => {
    if (busy || confirmBindingBtn.disabled) return;
    settle('confirm');
  };

  /**
   * A click on the confirming button: only a single click (or a keyboard
   * activation) counts (isRepeatedClick()).
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

  /** Empties the dialog's search and shows every group again. */
  const clearSearch = (): void => {
    editor.search.value = '';
    refreshPreview();
    editor.search.focus();
  };

  /**
   * Escape clears the dialog's search first (the top context's search),
   * else cancels (ignored while busy); Enter in the search field does
   * nothing; the repeats of a held Enter are swallowed.
   * @param {KeyboardEvent} e - The keydown event.
   */
  const handleKeydown = (e: KeyboardEvent): void => {
    if (e.isComposing) return;
    if (isHeldEnterRepeat(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (busy) return;
      const action = escapeAction({ dialogOpen: true, searchActive: step === 'edit' && editor.search.value !== '', editMode: false });
      if (action === 'clearSearch') {
        e.preventDefault();
        clearSearch();
      } else {
        handleCancel();
      }
    } else if (e.key === 'Enter' && e.target === editor.search) {
      e.preventDefault();
    }
  }; // End of function handleKeydown()

  /** A group was ticked or unticked: the preview follows. */
  const handleListChange = (): void => {
    refreshPreview();
  };

  /**
   * Arrows move through the shown group checkboxes (spec §4.7).
   * @param {KeyboardEvent} e - The keydown event.
   */
  const handleListKeydown = (e: KeyboardEvent): void => {
    handleListArrowKeydown(e, shownListItems(editor.list, 'input[type="checkbox"]'));
  };

  /** The search changed: the list and the preview follow. */
  const handleSearchInput = (): void => {
    refreshPreview();
  };

  // Fill the dialog for this open
  bindingModalTitle.textContent = content.title;
  bindingModalMessage.textContent = content.message;
  bindingModalEditor.replaceChildren(...editor.root);
  bindingModalEditor.hidden = false;
  bindingModalSummary.replaceChildren();
  bindingModalSummary.hidden = true;
  bindingModal.dataset.step = 'edit';
  setError(null, [], []);
  bindingModalStatus.textContent = '';
  cancelBindingBtn.textContent = t('cancel');
  backBindingBtn.textContent = t('networkBackAction');
  backBindingBtn.hidden = true;
  confirmBindingBtn.textContent = t('bindingReviewAction');
  renderOptions(new Set(content.selected));
  setBusy(false);

  confirmBindingBtn.addEventListener('click', handleConfirmClick);
  cancelBindingBtn.addEventListener('click', handleCancel);
  backBindingBtn.addEventListener('click', handleBack);
  editor.list.addEventListener('change', handleListChange);
  editor.list.addEventListener('keydown', handleListKeydown);
  editor.search.addEventListener('input', handleSearchInput);
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('keydown', focusTrap);
  bindingModal.classList.add('visible');
  updateBackgroundInert();
  editor.search.focus();

  return {
    /**
     * Waits for the user's next choice.
     * @returns {Promise<BindingDialogChoice>} 'confirm', 'back', or null for Cancel / Escape / a closed dialog.
     */
    next(): Promise<BindingDialogChoice> {
      if (closed) return Promise.resolve(null);
      settle(null);
      return new Promise<BindingDialogChoice>(resolve => {
        resolveNext = resolve;
      });
    },

    /**
     * The ticked groups now (also the ones the search hides).
     * @returns {string[]} Their ids, in the options' order.
     */
    selected(): string[] {
      return checkedIds();
    },

    /**
     * Replaces the options with fresh ones, keeping the ticked groups that
     * are still offered and the search.
     * @param {readonly BindingOption[]} fresh - The fresh options.
     * @param {BindingDescriber} freshDescribe - The describer over the fresh baseline.
     */
    setOptions(fresh: readonly BindingOption[], freshDescribe: BindingDescriber): void {
      if (closed) return;
      const ticked = new Set(checkedIds());
      options = fresh;
      describe = freshDescribe;
      renderOptions(ticked);
    },

    /**
     * Back to the edit step (the selection and the search as they were);
     * focus on the first ticked group, else the search.
     */
    showEditor(): void {
      if (closed) return;
      step = 'edit';
      bindingModalTitle.textContent = content.title;
      bindingModalMessage.textContent = content.message;
      bindingModalSummary.replaceChildren();
      bindingModalSummary.hidden = true;
      bindingModalEditor.hidden = false;
      bindingModal.dataset.step = 'edit';
      backBindingBtn.hidden = true;
      confirmBindingBtn.textContent = t('bindingReviewAction');
      setError(null, [], []);
      refreshPreview();
      focusEditor();
    }, // End of method showEditor()

    /**
     * Shows the review step: the editor hidden (kept for Back), the
     * change's rows and notes, Back visible, the saving label on the
     * confirming button; focus on Cancel (spec §4.7).
     * @param {string} title - The review's title.
     * @param {string} message - Its message.
     * @param {NetworkSummary} summary - The change's rows and notes.
     * @param {string} confirmLabel - The saving button's label.
     */
    showReview(title: string, message: string, summary: NetworkSummary, confirmLabel: string): void {
      if (closed) return;
      step = 'review';
      setBusy(false);
      bindingModalStatus.textContent = '';
      setError(null, [], []);
      bindingModalTitle.textContent = title;
      bindingModalMessage.textContent = message;
      bindingModalEditor.hidden = true;
      bindingModalSummary.replaceChildren(...buildSummary(summary));
      bindingModalSummary.hidden = false;
      bindingModal.dataset.step = 'review';
      backBindingBtn.hidden = false;
      confirmBindingBtn.textContent = confirmLabel;
      syncConfirm();
      cancelBindingBtn.focus();
    }, // End of method showReview()

    /**
     * Shows the progress of the re-read, the write or the reload.
     * @param {string} text - The progress text.
     */
    showBusy(text: string): void {
      if (closed) return;
      setBusy(true);
      setError(null, [], []);
      bindingModalStatus.textContent = text;
      // Every control is disabled or read-only now: keep focus inside the
      // dialog, on the progress line
      if (document.activeElement !== bindingModalStatus) {
        bindingModalStatus.focus();
      }
    }, // End of method showBusy()

    /**
     * Shows a refusal and gives the dialog back to the user (focus on the
     * editor, or on Cancel in the review step).
     * @param {string} text - The refusal.
     * @param {readonly string[]} lines - The capacity problems, one line per group.
     * @param {readonly string[]} notes - Notes under it.
     */
    showError(text: string, lines: readonly string[], notes: readonly string[]): void {
      if (closed) return;
      setBusy(false);
      bindingModalStatus.textContent = '';
      setError(text, lines, notes);
      if (step === 'review') {
        cancelBindingBtn.focus();
      } else {
        refreshPreview();
        focusEditor();
      }
    }, // End of method showError()

    /**
     * Hides the dialog, removes every listener, the editor and the summary,
     * and lifts the background inertness (the caller then restores focus);
     * settles a pending next() with null. Idempotent.
     */
    close(): void {
      if (closed) return;
      closed = true;
      bindingModal.classList.remove('visible');
      confirmBindingBtn.removeEventListener('click', handleConfirmClick);
      cancelBindingBtn.removeEventListener('click', handleCancel);
      backBindingBtn.removeEventListener('click', handleBack);
      editor.list.removeEventListener('change', handleListChange);
      editor.list.removeEventListener('keydown', handleListKeydown);
      editor.search.removeEventListener('input', handleSearchInput);
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('keydown', focusTrap);
      busy = false;
      cancelBindingBtn.disabled = false;
      backBindingBtn.disabled = false;
      confirmBindingBtn.disabled = false;
      bindingModal.removeAttribute('aria-busy');
      bindingModalEditor.replaceChildren();
      bindingModalSummary.replaceChildren();
      setError(null, [], []);
      bindingModalStatus.textContent = '';
      backBindingBtn.hidden = true;
      delete bindingModal.dataset.step;
      // Lift the background inertness; the caller then moves focus back
      // into the page (focus cannot enter an inert subtree)
      updateBackgroundInert();
      settle(null);
    }, // End of method close()
  }; // End of the dialog controller
} // End of function openBindingDialog()
