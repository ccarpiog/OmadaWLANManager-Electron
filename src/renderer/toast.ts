// Toast notifications (non-blocking, auto-dismissing status messages)

import { toastContainer } from './elements';

/**
 * Shows a non-blocking toast notification that auto-dismisses. Replaces the
 * former alert() calls (which block the renderer and, on macOS, leave the
 * window without keyboard focus after closing). Built with DOM APIs only.
 * @param {string} message - The localized message to display.
 * @param {'success' | 'error' | 'info'} type - Visual style of the toast.
 */
export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const TOAST_DURATION_MS = 4000;
  const TOAST_FADE_MS = 300;
  const MAX_TOASTS = 3;

  // Cap the stack: drop the oldest toast(s) so the pile can never grow over
  // other UI (the container is also fully click-through, see styles.css)
  while (toastContainer.children.length >= MAX_TOASTS) {
    toastContainer.firstElementChild?.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  // Enter transition on the next frame (so the initial state is painted)
  requestAnimationFrame(() => toast.classList.add('visible'));

  // Auto-dismiss: fade out, then remove the node once the transition ends
  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), TOAST_FADE_MS);
  }, TOAST_DURATION_MS);
} // End of function showToast()
