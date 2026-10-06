// ============================================================================
// Modal Focus Containment (Tab focus trap + inert background), shared by the
// settings, confirm, and site-selection modals
// ============================================================================

import { appContainer, confirmModal, settingsModal, siteModal } from './elements';

/**
 * Collects the keyboard-focusable elements currently inside a modal, in DOM
 * order. Recomputed on every Tab press so disabled/enabled changes (e.g. the
 * Save button while saving) are respected.
 * @param {HTMLElement} modal - The modal overlay element to search.
 * @returns {HTMLElement[]} The focusable elements inside the modal.
 */
function getFocusableElements(modal: HTMLElement): HTMLElement[] {
  const selector = 'button, input, select, textarea, [tabindex]';
  return Array.from(modal.querySelectorAll<HTMLElement>(selector)).filter(
    el => !el.hasAttribute('disabled') && el.tabIndex >= 0
  );
}

/**
 * Creates a keydown handler implementing a Tab focus trap for a modal: Tab on
 * the last focusable element wraps to the first, Shift+Tab on the first wraps
 * to the last, and focus found outside the modal is pulled back in. Install
 * it on document while the modal is open; remove it on close.
 * @param {HTMLElement} modal - The modal overlay element to contain focus in.
 * @returns {(e: KeyboardEvent) => void} The keydown handler to (un)install.
 */
export function createFocusTrap(modal: HTMLElement): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const focusable = getFocusableElements(modal);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !modal.contains(active)) {
      // Focus escaped (or never entered): pull it back into the modal
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }; // End of the returned keydown handler
} // End of function createFocusTrap()

/**
 * Syncs the inert state of the background app container with modal
 * visibility: while either modal is open, the background is inert — its
 * controls can be neither Tab-focused nor clicked (Chromium has supported
 * the inert attribute natively since version 102). This complements the Tab
 * focus trap and the opener-focus restoration. Call after every modal open/close
 * transition; on close, call it BEFORE refocusing the opener (focus cannot
 * enter an inert subtree).
 */
export function updateBackgroundInert(): void {
  const anyModalOpen =
    settingsModal.classList.contains('visible') ||
    confirmModal.classList.contains('visible') ||
    siteModal.classList.contains('visible');
  if (anyModalOpen) {
    appContainer.setAttribute('inert', '');
  } else {
    appContainer.removeAttribute('inert');
  }
} // End of function updateBackgroundInert()
