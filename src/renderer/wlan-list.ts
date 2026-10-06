// ============================================================================
// WLAN group list panel: list items and rendering
// ============================================================================

import type { WlanGroup } from '../shared/types';
import { wlanList } from './elements';
import { applyRovingTabindex, createEmptyState, focusListItemByData, moveOptionFocus } from './dom-helpers';
import { t } from './i18n';
import { updateSelectionInfo } from './panels';
import { state } from './state';

/**
 * Builds one WLAN group list item entirely with DOM APIs (createElement/
 * textContent/dataset — no HTML strings). The item acts as a listbox option
 * (which, unlike a radio, legitimately supports an empty selection and
 * toggling): clickable, keyboard focusable via roving tabindex (see
 * applyRovingTabindex()), toggled with Enter/Space, with ArrowUp/ArrowDown
 * moving focus between options.
 * @param {WlanGroup} wlan - The WLAN group to render.
 * @returns {HTMLElement} The list-item element with its handlers attached.
 */
function createWlanListItem(wlan: WlanGroup): HTMLElement {
  const isSelected = state.selectedWlan?.wlanId === wlan.wlanId;
  const ssids = wlan.ssidList.map(s => s.ssidName);
  const ssidPreview = ssids.length > 3
    ? `${ssids.slice(0, 3).join(', ')} +${ssids.length - 3} ${t('more')}`
    : ssids.join(', ');

  const item = document.createElement('div');
  item.className = isSelected ? 'list-item selected' : 'list-item';
  item.dataset.wlanId = wlan.wlanId;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(isSelected));

  const radio = document.createElement('div');
  radio.className = 'item-radio';

  const content = document.createElement('div');
  content.className = 'item-content';

  const header = document.createElement('div');
  header.className = 'item-header';

  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = wlan.wlanName;

  const subtitle = document.createElement('div');
  subtitle.className = 'item-subtitle';
  subtitle.textContent = ssidPreview || t('noSsids');

  header.appendChild(name);
  content.appendChild(header);
  content.appendChild(subtitle);
  item.appendChild(radio);
  item.appendChild(content);

  /**
   * Toggles this WLAN group's selection and re-renders. When triggered from
   * the keyboard, focus is restored to the re-rendered item.
   * @param {boolean} refocus - True to restore focus after the re-render.
   */
  const toggleSelection = (refocus: boolean): void => {
    state.selectedWlan = state.selectedWlan?.wlanId === wlan.wlanId ? null : wlan;
    renderWlanList();
    updateSelectionInfo();
    if (refocus) {
      focusListItemByData(wlanList, 'wlanId', wlan.wlanId);
    }
  };

  item.addEventListener('click', () => toggleSelection(false));
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Space must not scroll the panel
      toggleSelection(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); // Arrows must move focus, not scroll the panel
      moveOptionFocus(wlanList, item, e.key === 'ArrowDown' ? 1 : -1);
    }
  });

  return item;
} // End of function createWlanListItem()

/**
 * Renders the WLAN group list (applying the current filter) using DOM APIs.
 */
export function renderWlanList(): void {
  const filteredWlans = state.wlanGroups.filter(wlan =>
    wlan.wlanName.toLowerCase().includes(state.wlanFilterText.toLowerCase()) ||
    wlan.ssidList.some(s => s.ssidName.toLowerCase().includes(state.wlanFilterText.toLowerCase()))
  );

  if (state.wlanGroups.length === 0) {
    wlanList.replaceChildren(createEmptyState(t('noWlanGroups')));
    return;
  }

  if (filteredWlans.length === 0) {
    wlanList.replaceChildren(createEmptyState(`${t('noResultsFor')} "${state.wlanFilterText}"`));
    return;
  }

  wlanList.replaceChildren(...filteredWlans.map(createWlanListItem));
  applyRovingTabindex(wlanList);
} // End of function renderWlanList()
