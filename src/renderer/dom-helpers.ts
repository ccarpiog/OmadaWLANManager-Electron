// ============================================================================
// DOM helpers for the list panels: empty/loading blocks and the group
// listbox's keyboard navigation (roving tabindex; the Access points list uses
// native checkboxes, see ap-list.ts). Everything is built with DOM APIs, never
// HTML strings.
// ============================================================================

import { t } from './i18n';

/**
 * Creates an empty-state block (a muted message) for a list panel. Built with
 * DOM APIs, never HTML strings.
 * @param {string} message - The message to display.
 * @returns {HTMLElement} The empty-state element.
 */
export function createEmptyState(message: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'empty-state';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  container.appendChild(paragraph);
  return container;
}

/**
 * Creates a loading block (spinner) for a list panel while data is fetched.
 * @returns {HTMLElement} The loading element.
 */
export function createLoadingState(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'loading';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-label', t('loading'));
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  container.appendChild(spinner);
  return container;
}

/**
 * Restores keyboard focus to a just-re-rendered list item identified by a
 * dataset key/value pair. Re-rendering a list replaces every node, so the
 * previously focused element is gone; without this, a keyboard selection
 * would throw focus back to <body>. The refocused item also becomes the
 * single roving tab stop of its listbox.
 * @param {HTMLElement} listElement - The listbox container (wlanList).
 * @param {'mac' | 'wlanId'} dataKey - The dataset key identifying the item.
 * @param {string} value - The identifier value to look for.
 */
export function focusListItemByData(listElement: HTMLElement, dataKey: 'mac' | 'wlanId', value: string): void {
  for (const child of Array.from(listElement.children)) {
    if (child instanceof HTMLElement && child.dataset[dataKey] === value) {
      // Move the roving tab stop onto the item that receives focus
      for (const sibling of Array.from(listElement.children)) {
        if (sibling instanceof HTMLElement && sibling.getAttribute('role') === 'option') {
          sibling.tabIndex = sibling === child ? 0 : -1;
        }
      }
      child.focus();
      return;
    }
  }
} // End of function focusListItemByData()

/**
 * Applies roving tabindex to a listbox's options: the selected option (or the
 * first one when nothing is selected) is the single Tab stop (tabindex 0),
 * every other option gets tabindex -1. Called after each list render.
 * @param {HTMLElement} listElement - The listbox container (wlanList).
 */
export function applyRovingTabindex(listElement: HTMLElement): void {
  const options = Array.from(listElement.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute('role') === 'option'
  );
  if (options.length === 0) return;
  const selected = options.find(option => option.getAttribute('aria-selected') === 'true');
  const tabStop = selected || options[0];
  for (const option of options) {
    option.tabIndex = option === tabStop ? 0 : -1;
  }
} // End of function applyRovingTabindex()

/**
 * Moves keyboard focus from one listbox option to its neighbor (ArrowUp/
 * ArrowDown navigation, no wrap-around). The newly focused option becomes
 * the single roving Tab stop of the listbox.
 * @param {HTMLElement} listElement - The listbox container (wlanList).
 * @param {HTMLElement} current - The option that currently has focus.
 * @param {1 | -1} direction - +1 for the next option, -1 for the previous.
 */
export function moveOptionFocus(listElement: HTMLElement, current: HTMLElement, direction: 1 | -1): void {
  const options = Array.from(listElement.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute('role') === 'option'
  );
  const index = options.indexOf(current);
  if (index === -1) return;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= options.length) return;
  const next = options[nextIndex];
  current.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
} // End of function moveOptionFocus()
