// ============================================================================
// Access-point list panel: status presentation, list items, and rendering
// ============================================================================

import type { AccessPoint } from '../shared/types';
import { apList } from './elements';
import { applyRovingTabindex, createEmptyState, focusListItemByData, moveOptionFocus } from './dom-helpers';
import { t, tGroup, type Translations } from './i18n';
import { updateSelectionInfo } from './panels';
import { state } from './state';

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
function getApStatus(statusCategory: number): { className: string; labelKey: keyof Translations } {
  return AP_STATUS[statusCategory] ?? { className: 'unknown', labelKey: 'statusApUnknown' };
} // End of function getApStatus()

/**
 * Builds one AP list item entirely with DOM APIs (createElement/textContent/
 * dataset — no HTML strings), so values coming from the controller can never
 * be interpreted as markup. The item acts as a listbox option (which, unlike
 * a radio, legitimately supports an empty selection and toggling): clickable,
 * keyboard focusable via roving tabindex (see applyRovingTabindex()), toggled
 * with Enter/Space, with ArrowUp/ArrowDown moving focus between options.
 * @param {AccessPoint} ap - The access point to render.
 * @returns {HTMLElement} The list-item element with its handlers attached.
 */
function createApListItem(ap: AccessPoint): HTMLElement {
  const apStatus = getApStatus(ap.statusCategory);
  const isSelected = state.selectedAp?.mac === ap.mac;

  const item = document.createElement('div');
  item.className = isSelected ? 'list-item selected' : 'list-item';
  item.dataset.mac = ap.mac;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(isSelected));

  const radio = document.createElement('div');
  radio.className = 'item-radio';

  const content = document.createElement('div');
  content.className = 'item-content';

  const header = document.createElement('div');
  header.className = 'item-header';

  const status = document.createElement('span');
  status.className = `item-status ${apStatus.className}`;
  status.textContent = '●';
  // The dot is the only indicator of the AP's state, so it must carry the
  // state as text too: colour alone is not an accessible distinction, and
  // several categories share a colour.
  status.title = t(apStatus.labelKey);
  status.setAttribute('role', 'img');
  status.setAttribute('aria-label', t(apStatus.labelKey));

  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = ap.name;

  const subtitle = document.createElement('div');
  subtitle.className = 'item-subtitle';
  // "AP group: <name>" on Omada 6.3+, "WLAN: <name>" before (tGroup())
  subtitle.textContent = `${tGroup('groupLabel')}: ${ap.wlanGroup || t('unassigned')}`;

  header.appendChild(status);
  header.appendChild(name);
  content.appendChild(header);
  content.appendChild(subtitle);
  item.appendChild(radio);
  item.appendChild(content);

  /**
   * Toggles this AP's selection and re-renders. When triggered from the
   * keyboard, focus is restored to the re-rendered item.
   * @param {boolean} refocus - True to restore focus after the re-render.
   */
  const toggleSelection = (refocus: boolean): void => {
    state.selectedAp = state.selectedAp?.mac === ap.mac ? null : ap;
    renderApList();
    updateSelectionInfo();
    if (refocus) {
      focusListItemByData(apList, 'mac', ap.mac);
    }
  };

  item.addEventListener('click', () => toggleSelection(false));
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Space must not scroll the panel
      toggleSelection(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); // Arrows must move focus, not scroll the panel
      moveOptionFocus(apList, item, e.key === 'ArrowDown' ? 1 : -1);
    }
  });

  return item;
} // End of function createApListItem()

/**
 * Renders the access-point list (applying the current filter) using DOM APIs.
 */
export function renderApList(): void {
  const filteredAps = state.accessPoints.filter(ap =>
    ap.name.toLowerCase().includes(state.apFilterText.toLowerCase()) ||
    (ap.wlanGroup && ap.wlanGroup.toLowerCase().includes(state.apFilterText.toLowerCase()))
  );

  if (state.accessPoints.length === 0) {
    apList.replaceChildren(createEmptyState(t('noAccessPoints')));
    return;
  }

  if (filteredAps.length === 0) {
    apList.replaceChildren(createEmptyState(`${t('noResultsFor')} "${state.apFilterText}"`));
    return;
  }

  apList.replaceChildren(...filteredAps.map(createApListItem));
  applyRovingTabindex(apList);
} // End of function renderApList()
