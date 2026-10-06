// ============================================================================
// DOM helpers for the list panels: empty/loading blocks. The lists use native
// controls (checkboxes for the access points, radios for the destination
// groups), so no listbox keyboard simulation is needed. Everything is built
// with DOM APIs, never HTML strings.
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
