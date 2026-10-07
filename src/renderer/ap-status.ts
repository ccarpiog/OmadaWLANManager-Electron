// ============================================================================
// AP status presentation, shared by the Access points list (ap-list.ts), the
// AP details pane (ap-details.ts) and the AP rows of the AP groups and Wi-Fi
// networks details: the colour class and the label of each statusCategory,
// and the "● Connected" element (colour + text, never colour alone).
// ============================================================================

import { t, type Translations } from './i18n';

/**
 * Presentation for each Omada AP `statusCategory`, keyed by the numeric value
 * the controller reports:
 *
 *   0 disconnected — the controller has lost the AP entirely
 *   1 connected    — normal working state
 *   2 pending      — being adopted; reachable but not yet managed
 *   3 heartbeat missed — adopted, but the controller stopped hearing from it
 *   4 isolated     — adopted and reachable, but cut off from its uplink
 *
 * Previously categories 1 and 2 were both painted green as "online" and
 * everything else red as "offline", which claimed a pending AP was working and
 * hid the difference between a dead AP and one that had merely gone quiet.
 * Each state now gets its own colour and its own label (see the statusAp*
 * translation keys).
 */
const AP_STATUS: Record<number, { className: string; labelKey: keyof Translations }> = {
  0: { className: 'offline', labelKey: 'statusApDisconnected' },
  1: { className: 'online', labelKey: 'statusApConnected' },
  2: { className: 'pending', labelKey: 'statusApPending' },
  3: { className: 'warning', labelKey: 'statusApHeartbeatMissed' },
  4: { className: 'isolated', labelKey: 'statusApIsolated' },
};

/**
 * Maps an AP's `statusCategory` to its colour class and label key, falling
 * back to a neutral "unknown" state for any value the controller reports that
 * is not in AP_STATUS — a newer firmware adding a category must not make an AP
 * look disconnected.
 * @param {number} statusCategory - The category reported by the controller.
 * @returns {{ className: string; labelKey: keyof Translations }} Presentation
 *   for that state.
 */
export function getApStatus(statusCategory: number): { className: string; labelKey: keyof Translations } {
  return AP_STATUS[statusCategory] ?? { className: 'unknown', labelKey: 'statusApUnknown' };
}

/**
 * Builds an AP's status as a coloured dot (decorative) plus its label text.
 * @param {number} statusCategory - The category reported by the controller.
 * @param {string} [id] - Optional element id (e.g. for aria-describedby).
 * @returns {HTMLSpanElement} The `.item-status` element.
 */
export function createStatusElement(statusCategory: number, id?: string): HTMLSpanElement {
  const apStatus = getApStatus(statusCategory);
  const status = document.createElement('span');
  status.className = `item-status ${apStatus.className}`;
  if (id !== undefined) {
    status.id = id;
  }
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.textContent = '●';
  const label = document.createElement('span');
  label.className = 'status-label';
  label.textContent = t(apStatus.labelKey);
  status.appendChild(dot);
  status.appendChild(label);
  return status;
} // End of function createStatusElement()
