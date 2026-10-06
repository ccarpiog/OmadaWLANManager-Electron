// ============================================================================
// Certificate Modal (trust on first use): the first-use confirmation ("Trust
// and connect" / "Cancel") and the "certificate changed" notice (old and new
// fingerprints, connection refused, pointer to Settings). One static modal in
// index.html, filled per open with DOM APIs only (createElement/textContent:
// host names and fingerprints can never be interpreted as markup).
// ============================================================================

import type { CertificateDetails } from '../shared/types';
import {
  cancelCertBtn,
  certDetails,
  certModal,
  certModalHint,
  certModalMessage,
  certModalTitle,
  confirmCertBtn,
} from './elements';
import { t } from './i18n';
import { createFocusTrap, updateBackgroundInert } from './modal-focus';

/**
 * One label/value row of the certificate details list.
 */
interface CertificateRow {
  label: string;
  value: string;
  // True for fingerprints (monospace, selectable, wraps anywhere)
  fingerprint: boolean;
}

/**
 * What one opening of the certificate modal shows.
 */
interface CertificateModalContent {
  title: string;
  message: string;
  // Extra guidance below the details, or null for none
  hint: string | null;
  rows: CertificateRow[];
  // Label of the confirming button, or null for the single-button variant
  confirmLabel: string | null;
  cancelLabel: string;
}

/**
 * Builds the <dt>/<dd> pairs of the details list.
 * @param {CertificateRow[]} rows - The rows to show.
 * @returns {HTMLElement[]} The elements, in order.
 */
function buildDetailRows(rows: CertificateRow[]): HTMLElement[] {
  return rows.flatMap(row => {
    const term = document.createElement('dt');
    term.textContent = row.label;
    const value = document.createElement('dd');
    value.textContent = row.value;
    if (row.fingerprint) {
      value.className = 'cert-fingerprint';
    }
    return [term, value];
  });
} // End of function buildDetailRows()

/**
 * Opens the certificate modal and resolves with the user's choice: true for
 * the confirming button, false for Cancel/Close or Escape. Same structure as
 * showSiteSelection(): every close path routes through a single finish() that hides
 * the modal, removes all listeners (including the Escape and focus-trap ones),
 * lifts the background inertness, restores focus to the opener, and resolves
 * exactly once. Keyboard focus starts on the cancelling button, so Enter can
 * never trust a certificate by accident.
 * @param {CertificateModalContent} content - What to show.
 * @returns {Promise<boolean>} True when the user confirmed.
 */
function openCertificateModal(content: CertificateModalContent): Promise<boolean> {
  return new Promise(resolve => {
    certModalTitle.textContent = content.title;
    certModalMessage.textContent = content.message;
    certDetails.replaceChildren(...buildDetailRows(content.rows));
    certModalHint.textContent = content.hint ?? '';
    certModalHint.hidden = content.hint === null;
    cancelCertBtn.textContent = content.cancelLabel;
    // The single-button variant only hides the confirm button (its label is
    // kept, so the static UI never holds a blank button)
    if (content.confirmLabel !== null) {
      confirmCertBtn.textContent = content.confirmLabel;
    }
    confirmCertBtn.hidden = content.confirmLabel === null;

    // Remember the opener to restore focus later, and build the Tab focus
    // trap that keeps focus inside the modal (hidden buttons are skipped)
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTrap = createFocusTrap(certModal);
    certModal.classList.add('visible');
    updateBackgroundInert();

    let finished = false;

    /**
     * Hides the modal, removes all listeners, clears the per-open content,
     * lifts the background inertness, restores focus to the opener, and
     * resolves exactly once.
     * @param {boolean} result - The value to resolve the promise with.
     */
    const finish = (result: boolean): void => {
      if (finished) return;
      finished = true;
      certModal.classList.remove('visible');
      confirmCertBtn.removeEventListener('click', handleConfirm);
      cancelCertBtn.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', focusTrap);
      certDetails.replaceChildren();
      // Restore the static defaults (both buttons visible) for the next open
      confirmCertBtn.hidden = false;
      certModalHint.hidden = true;
      // Lift the background inertness BEFORE refocusing the opener (focus
      // cannot enter an inert subtree)
      updateBackgroundInert();
      opener?.focus();
      resolve(result);
    }; // End of function finish()

    /** Confirm button handler: finishes with true. */
    const handleConfirm = (): void => finish(true);

    /** Cancel/Close button handler: finishes with false. */
    const handleCancel = (): void => finish(false);

    /**
     * Escape key handler: routes through the cancel path.
     * @param {KeyboardEvent} e - The keydown event.
     */
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') handleCancel();
    };

    confirmCertBtn.addEventListener('click', handleConfirm);
    cancelCertBtn.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', focusTrap);

    cancelCertBtn.focus();
  }); // End of the modal promise executor
} // End of function openCertificateModal()

/**
 * Shows the first-use confirmation for a self-signed controller certificate:
 * the controller host and the certificate's SHA-256 fingerprint, with
 * "Trust and connect" and "Cancel".
 * @param {CertificateDetails} details - Validated host and fingerprint.
 * @returns {Promise<boolean>} True when the user chose "Trust and connect".
 */
export function showCertificateTrust(details: CertificateDetails): Promise<boolean> {
  return openCertificateModal({
    title: t('certUntrustedTitle'),
    message: t('certUntrustedMessage'),
    hint: null,
    rows: [
      { label: t('certHost'), value: details.host, fingerprint: false },
      { label: t('certFingerprint'), value: details.fingerprint, fingerprint: true },
    ],
    confirmLabel: t('certTrustAndConnect'),
    cancelLabel: t('cancel'),
  });
} // End of function showCertificateTrust()

/**
 * Shows the "certificate changed" notice: the controller host, the trusted
 * fingerprint and the presented one, the refusal to connect, and the pointer
 * to Settings ("Reset trusted certificate"). Single "Close" button.
 * @param {CertificateDetails} details - Validated host and both fingerprints.
 * @returns {Promise<void>} Resolves when the notice is closed.
 */
export async function showCertificateChanged(details: CertificateDetails): Promise<void> {
  await openCertificateModal({
    title: t('certChangedTitle'),
    message: t('certChangedMessage'),
    hint: t('certChangedHint'),
    rows: [
      { label: t('certHost'), value: details.host, fingerprint: false },
      { label: t('certPinnedFingerprint'), value: details.pinnedFingerprint ?? '', fingerprint: true },
      { label: t('certPresentedFingerprint'), value: details.fingerprint, fingerprint: true },
    ],
    confirmLabel: null,
    cancelLabel: t('close'),
  });
} // End of function showCertificateChanged()
