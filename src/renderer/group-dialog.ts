// ============================================================================
// AP group dialog (todo.md 4.9; docs/management-design.md §4.4, §4.7): one
// static modal in index.html, filled per open with DOM APIs only (group
// names can never be interpreted as markup), for the three AP-group writes:
//   create — the name field, "Create group";
//   rename — the name field prefilled with the current name (selected);
//   delete — the confirmation naming the group; opens on Cancel, never on
//            the destructive button.
// Like the other modals: role="dialog" + aria-modal, the Tab focus trap and
// the inert background (modal-focus.ts), Escape = Cancel. Enter in the name
// field confirms. While the write and the reload after it run, the dialog
// shows the progress (role="status"), its buttons are disabled and Escape is
// ignored (no double submit); a refusal — the client-side name check or
// main's answer — is shown on the error line (role="alert") and the dialog
// stays open for another try. The caller (group-flow.ts) drives it and
// restores focus after close().
// ============================================================================

import {
  cancelGroupBtn,
  confirmGroupBtn,
  groupModal,
  groupModalError,
  groupModalMessage,
  groupModalStatus,
  groupModalTitle,
  groupNameField,
  groupNameHint,
  groupNameInput,
  groupNameLabel,
} from './elements';
import { t } from './i18n';
import { createFocusTrap, updateBackgroundInert } from './modal-focus';

/** Which write the dialog is for. */
export type GroupDialogKind = 'create' | 'rename' | 'delete';

/**
 * What one opening of the dialog shows.
 */
export interface GroupDialogContent {
  kind: GroupDialogKind;
  title: string;
  message: string;
  confirmLabel: string;
  // The name field's initial value (rename: the current name; else '')
  initialName: string;
  // Live check of the typed name, run on every edit: the message to show,
  // or null for none (create / rename; null for delete)
  validate: ((raw: string) => string | null) | null;
}

/**
 * The open dialog: one instance per flow (openGroupDialog()).
 */
export interface GroupDialog {
  // Waits for the user's next choice: the typed name (create / rename) or ''
  // (delete) for the confirming button or Enter; null for Cancel, Escape, or
  // when the dialog is closed meanwhile
  next(): Promise<string | null>;
  // Shows the progress of the write (or the reload after it): buttons
  // disabled, Escape ignored, focus parked on the status line
  showBusy(text: string): void;
  // Shows a refusal and gives the dialog back to the user (focus on the name
  // field, or on Cancel for a delete)
  showError(text: string): void;
  // Hides the dialog and releases everything; idempotent
  close(): void;
}

/**
 * Shows or hides the error line (and marks the name field invalid).
 * @param {string | null} text - The error, or null to clear it.
 */
function setError(text: string | null): void {
  groupModalError.textContent = text ?? '';
  groupModalError.hidden = text === null;
  if (text === null) {
    groupNameInput.removeAttribute('aria-invalid');
  } else {
    groupNameInput.setAttribute('aria-invalid', 'true');
  }
} // End of function setError()

/**
 * Opens the AP group dialog. Focus starts on the name field (create,
 * rename — with the current name selected) or on Cancel (delete).
 * @param {GroupDialogContent} content - What to show.
 * @returns {GroupDialog} The dialog's controller.
 */
export function openGroupDialog(content: GroupDialogContent): GroupDialog {
  const withName = content.kind !== 'delete';
  const focusTrap = createFocusTrap(groupModal);
  let closed = false;
  let busy = false;
  let resolveNext: ((value: string | null) => void) | null = null;

  /**
   * Settles a pending next() exactly once.
   * @param {string | null} value - The user's choice.
   */
  const settle = (value: string | null): void => {
    const resolve = resolveNext;
    resolveNext = null;
    resolve?.(value);
  };

  /** Confirming button (and Enter in the name field). */
  const handleConfirm = (): void => {
    if (busy) return;
    settle(withName ? groupNameInput.value : '');
  };

  /** Cancel button. */
  const handleCancel = (): void => {
    if (busy) return;
    settle(null);
  };

  /**
   * Escape cancels (ignored while the write runs); Enter in the name field
   * confirms.
   * @param {KeyboardEvent} e - The keydown event.
   */
  const handleKeydown = (e: KeyboardEvent): void => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && e.target === groupNameInput) {
      e.preventDefault();
      handleConfirm();
    }
  };

  /** Live check of the name on every edit. */
  const handleInput = (): void => {
    if (busy || content.validate === null) return;
    setError(content.validate(groupNameInput.value));
  };

  /**
   * Enables or disables the controls for the write in flight.
   * @param {boolean} value - True while the write (or its reload) runs.
   */
  const setBusy = (value: boolean): void => {
    busy = value;
    confirmGroupBtn.disabled = value;
    cancelGroupBtn.disabled = value;
    groupNameInput.readOnly = value;
    if (value) {
      groupModal.setAttribute('aria-busy', 'true');
    } else {
      groupModal.removeAttribute('aria-busy');
    }
  }; // End of function setBusy()

  // Fill the dialog for this open
  groupModalTitle.textContent = content.title;
  groupModalMessage.textContent = content.message;
  groupNameField.hidden = !withName;
  groupNameLabel.textContent = t('groupNameLabel');
  groupNameHint.textContent = t('groupNameHint');
  groupNameInput.value = content.initialName;
  setError(null);
  groupModalStatus.textContent = '';
  cancelGroupBtn.textContent = t('cancel');
  confirmGroupBtn.textContent = content.confirmLabel;
  confirmGroupBtn.classList.toggle('btn-danger', !withName);
  confirmGroupBtn.classList.toggle('btn-primary', withName);
  setBusy(false);

  confirmGroupBtn.addEventListener('click', handleConfirm);
  cancelGroupBtn.addEventListener('click', handleCancel);
  groupNameInput.addEventListener('input', handleInput);
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('keydown', focusTrap);
  groupModal.classList.add('visible');
  updateBackgroundInert();
  if (withName) {
    groupNameInput.focus();
    groupNameInput.select();
  } else {
    // The safe default (spec §4.7): Enter or Escape cancels the delete
    cancelGroupBtn.focus();
  }

  return {
    /**
     * Waits for the user's next choice.
     * @returns {Promise<string | null>} The typed name ('' for a delete), or
     *   null for Cancel / Escape / a closed dialog.
     */
    next(): Promise<string | null> {
      if (closed) return Promise.resolve(null);
      settle(null);
      return new Promise<string | null>(resolve => {
        resolveNext = resolve;
      });
    },

    /**
     * Shows the progress of the write or its reload.
     * @param {string} text - The progress text.
     */
    showBusy(text: string): void {
      if (closed) return;
      setBusy(true);
      setError(null);
      groupModalStatus.textContent = text;
      // Both buttons are disabled and the field is read-only now: keep focus
      // inside the dialog, on the progress line
      if (document.activeElement !== groupModalStatus) {
        groupModalStatus.focus();
      }
    }, // End of method showBusy()

    /**
     * Shows a refusal and gives the dialog back to the user.
     * @param {string} text - The refusal (client-side check or main's answer).
     */
    showError(text: string): void {
      if (closed) return;
      setBusy(false);
      groupModalStatus.textContent = '';
      setError(text);
      if (withName) {
        groupNameInput.focus();
      } else {
        cancelGroupBtn.focus();
      }
    }, // End of method showError()

    /**
     * Hides the dialog, removes every listener, clears the per-open
     * content and lifts the background inertness (the caller then restores
     * focus); settles a pending next() with null. Idempotent.
     */
    close(): void {
      if (closed) return;
      closed = true;
      groupModal.classList.remove('visible');
      confirmGroupBtn.removeEventListener('click', handleConfirm);
      cancelGroupBtn.removeEventListener('click', handleCancel);
      groupNameInput.removeEventListener('input', handleInput);
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('keydown', focusTrap);
      setBusy(false);
      groupNameInput.value = '';
      setError(null);
      groupModalStatus.textContent = '';
      // Lift the background inertness; the caller then moves focus back
      // into the page (focus cannot enter an inert subtree)
      updateBackgroundInert();
      settle(null);
    }, // End of method close()
  }; // End of the dialog controller
} // End of function openGroupDialog()
