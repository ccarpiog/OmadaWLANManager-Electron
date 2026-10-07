// ============================================================================
// DOM helpers for the lists: the empty-state block of a list panel (the
// loading skeleton and the other §4.6 states are built by content-state.ts)
// and the arrow-key navigation of the lists inside dialogs (the site list,
// the AP-group checkboxes of the Wi-Fi network and "Broadcast on" dialogs).
// The lists use native controls (checkboxes, radios, buttons), so no listbox
// simulation is needed. Everything is built with DOM APIs, never HTML strings.
// ============================================================================

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
 * Arrow-key navigation of a list of native controls (docs/management-design.md
 * §4.7: arrows navigate lists): ArrowDown / ArrowUp move focus to the next /
 * previous item, Home / End to the first / last; Space and Enter keep their
 * native meaning (tick a checkbox, press a button) and Tab still visits every
 * item. Acts only on a key pressed on one of the items, without modifiers.
 * @param {KeyboardEvent} e - The keydown event.
 * @param {readonly HTMLElement[]} items - The list's shown items, in order.
 * @returns {boolean} True when the key was a list move (handled).
 */
export function handleListArrowKeydown(e: KeyboardEvent, items: readonly HTMLElement[]): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  const index = items.findIndex(item => item === e.target);
  if (index === -1) return false;
  let next: number;
  switch (e.key) {
    case 'ArrowDown':
      next = Math.min(index + 1, items.length - 1);
      break;
    case 'ArrowUp':
      next = Math.max(index - 1, 0);
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = items.length - 1;
      break;
    default:
      return false;
  }
  // Arrows move focus, never the scroll position of the list
  e.preventDefault();
  items[next].focus();
  return true;
} // End of function handleListArrowKeydown()

/**
 * The shown items of a list container matching a selector (an item inside a
 * `hidden` subtree — e.g. filtered out by a search — is skipped).
 * @param {HTMLElement} container - The list container.
 * @param {string} selector - The items' selector.
 * @returns {HTMLElement[]} The shown items, in DOM order.
 */
export function shownListItems(container: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(item => item.closest('[hidden]') === null);
}
