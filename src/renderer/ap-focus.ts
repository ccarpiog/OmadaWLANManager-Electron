// ============================================================================
// Keyboard focus inside the Access points list: its checkboxes form one Tab
// stop (roving tabindex). Shared by the list (ap-list.ts) and the AP details
// pane (ap-details.ts), whose Close returns focus to the AP's checkbox.
// ============================================================================

import { apList } from './elements';
import { state } from './state';

/**
 * Moves keyboard focus to a row's checkbox and makes it the list's Tab stop.
 * @param {HTMLInputElement} checkbox - The checkbox to focus.
 */
export function focusApCheckbox(checkbox: HTMLInputElement): void {
  for (const other of apList.querySelectorAll<HTMLInputElement>('.ap-checkbox')) {
    other.tabIndex = other === checkbox ? 0 : -1;
  }
  state.apFocusMac = checkbox.dataset.mac ?? null;
  checkbox.focus();
}

/**
 * Finds the rendered checkbox of an AP.
 * @param {string} mac - The AP's MAC.
 * @returns {HTMLInputElement | null} The checkbox, or null when the AP's row
 *   is not rendered (e.g. hidden by the filters).
 */
export function findApCheckbox(mac: string): HTMLInputElement | null {
  return Array.from(apList.querySelectorAll<HTMLInputElement>('.ap-checkbox')).find(checkbox => checkbox.dataset.mac === mac) ?? null;
}

/**
 * Returns keyboard focus to the Access points list: to the AP's checkbox
 * when its row is rendered, else to the list's Tab stop.
 * @param {string | null} mac - The AP to focus, or null for the Tab stop.
 * @returns {boolean} True when a checkbox received focus.
 */
export function focusApListAt(mac: string | null): boolean {
  const checkbox = (mac !== null ? findApCheckbox(mac) : null) ?? apList.querySelector<HTMLInputElement>('.ap-checkbox[tabindex="0"]');
  if (!checkbox) {
    return false;
  }
  focusApCheckbox(checkbox);
  return document.activeElement === checkbox;
} // End of function focusApListAt()
