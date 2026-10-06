// ============================================================================
// Confirm Modal
// ============================================================================

import { cancelConfirmBtn, confirmConfirmBtn, confirmMessage, confirmModal } from './elements';
import { createFocusTrap, updateBackgroundInert } from './modal-focus';

/**
 * Shows the confirm modal with the given message and resolves with the user's
 * choice. Confirm, Cancel, and Escape all route through a single finish()
 * function that hides the modal, removes every listener (including the Escape
 * and focus-trap ones), restores focus to the opener, and resolves exactly
 * once — so no stale listeners or pending promises can leak.
 * @param {string} message - The question to display in the modal.
 * @returns {Promise<boolean>} True if the user confirmed, false otherwise.
 */
export function showConfirm(message: string): Promise<boolean> {
  return new Promise(resolve => {
    confirmMessage.textContent = message;
    // Remember the opener (usually the Apply button) to restore focus later,
    // and build the Tab focus trap that keeps focus inside the modal
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTrap = createFocusTrap(confirmModal);
    confirmModal.classList.add('visible');
    updateBackgroundInert();

    let finished = false;

    /**
     * Hides the modal, removes all listeners, lifts the background
     * inertness, restores focus to the opener, and resolves exactly once.
     * @param {boolean} result - The value to resolve the promise with.
     */
    const finish = (result: boolean): void => {
      if (finished) return;
      finished = true;
      confirmModal.classList.remove('visible');
      confirmConfirmBtn.removeEventListener('click', handleConfirm);
      cancelConfirmBtn.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', focusTrap);
      // Lift the background inertness BEFORE refocusing the opener (focus
      // cannot enter an inert subtree), then return keyboard focus to the
      // control that opened the modal
      updateBackgroundInert();
      opener?.focus();
      resolve(result);
    }; // End of function finish()

    /** Confirm button handler: finishes with true. */
    const handleConfirm = (): void => finish(true);

    /** Cancel button handler: finishes with false. */
    const handleCancel = (): void => finish(false);

    /**
     * Escape key handler: routes through the cancel path.
     * @param {KeyboardEvent} e - The keydown event.
     */
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') handleCancel();
    };

    confirmConfirmBtn.addEventListener('click', handleConfirm);
    cancelConfirmBtn.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', focusTrap);

    // Move keyboard focus into the modal (Enter confirms, Escape cancels)
    confirmConfirmBtn.focus();
  });
} // End of function showConfirm()
