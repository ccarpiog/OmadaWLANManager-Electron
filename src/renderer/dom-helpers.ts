// ============================================================================
// DOM helper for the list panels: the empty-state block (the loading
// skeleton and the other §4.6 states are built by content-state.ts). The
// lists use native controls (checkboxes for the access points, radios for
// the destination groups), so no listbox keyboard simulation is needed.
// Everything is built with DOM APIs, never HTML strings.
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
