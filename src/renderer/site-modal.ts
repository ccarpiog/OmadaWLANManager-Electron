// ============================================================================
// Site Selection Modal (multi-site controllers)
// ============================================================================

import type { SiteInfo } from '../shared/types';
import { cancelSiteBtn, siteListContainer, siteModal } from './elements';
import { createFocusTrap, updateBackgroundInert } from './modal-focus';

/**
 * Shows the site-selection modal for a multi-site controller and resolves
 * with the id of the site the user chose, or null on cancel/Escape. One
 * button per site is built with DOM APIs (createElement/textContent/dataset —
 * site names from the controller can never be interpreted as markup). Every
 * close path routes through a single finish() that hides the modal, removes
 * all listeners, lifts the background inertness, restores focus to the
 * opener, and resolves exactly once — same structure as showConfirm().
 * @param {SiteInfo[]} sites - The (validated) authorized sites to offer.
 * @returns {Promise<string | null>} The chosen site id, or null on cancel.
 */
export function showSiteSelection(sites: SiteInfo[]): Promise<string | null> {
  return new Promise(resolve => {
    // Build one option button per site
    const siteButtons = sites.map(site => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn site-option';
      button.dataset.siteId = site.id;
      button.textContent = site.name;
      return button;
    });
    siteListContainer.replaceChildren(...siteButtons);

    // Remember the opener to restore focus later, and build the Tab focus
    // trap that keeps focus inside the modal
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTrap = createFocusTrap(siteModal);
    siteModal.classList.add('visible');
    updateBackgroundInert();

    let finished = false;

    /**
     * Hides the modal, removes all listeners, clears the option buttons,
     * lifts the background inertness, restores focus to the opener, and
     * resolves exactly once.
     * @param {string | null} result - The chosen site id, or null on cancel.
     */
    const finish = (result: string | null): void => {
      if (finished) return;
      finished = true;
      siteModal.classList.remove('visible');
      siteListContainer.removeEventListener('click', handleSiteClick);
      cancelSiteBtn.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', focusTrap);
      // Drop the transient option buttons (and their listeners with them)
      siteListContainer.replaceChildren();
      // Lift the background inertness BEFORE refocusing the opener (focus
      // cannot enter an inert subtree)
      updateBackgroundInert();
      opener?.focus();
      resolve(result);
    }; // End of function finish()

    /**
     * Delegated click handler for the site option buttons: finishes with the
     * clicked site's id.
     * @param {MouseEvent} e - The click event.
     */
    const handleSiteClick = (e: MouseEvent): void => {
      const target = e.target instanceof Element ? e.target.closest('.site-option') : null;
      if (target instanceof HTMLElement && target.dataset.siteId) {
        finish(target.dataset.siteId);
      }
    };

    /** Cancel button handler: finishes with null. */
    const handleCancel = (): void => finish(null);

    /**
     * Escape key handler: routes through the cancel path.
     * @param {KeyboardEvent} e - The keydown event.
     */
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') handleCancel();
    };

    siteListContainer.addEventListener('click', handleSiteClick);
    cancelSiteBtn.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', focusTrap);

    // Move keyboard focus onto the first site option (Escape cancels)
    if (siteButtons.length > 0) {
      siteButtons[0].focus();
    } else {
      cancelSiteBtn.focus();
    }
  });
} // End of function showSiteSelection()
