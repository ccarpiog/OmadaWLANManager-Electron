// ============================================================================
// Destination pane of the Access points view (docs/management-design.md
// §4.3), always visible next to the AP list: a search over group names AND
// network names, one native radio per group (AP groups on Omada 6.3+, WLAN
// groups before), groups without networks pinned in a "Silence" section with
// the strong empty-group label, and the move preview for the current checkbox
// selection (APs hidden by filters included): networks gained / lost /
// unchanged, mixed selections ("12 already in this group; 4 will move") and
// the "Move AP" / "Move N APs" button that starts the move flow
// (move-flow.ts). The radios form one native radio group: Tab enters it at
// the checked radio, the arrow keys move and check. A group whose name
// another group shares (ambiguous: APs name their group, so its members
// cannot be identified) stays listed with its radio disabled and the reason
// shown. Until data is loaded, the list shows the §4.6 state as text
// (content-state.ts). In the single-pane layout (700–799 px) the pane is a
// drill-in pane: "Choose destination" opens it in the AP list's place, its
// Back returns to the list (layout.ts). Pure logic: move-plan.ts.
// ============================================================================

import type { WlanGroup } from '../shared/types';
import { visibleApMacs } from './ap-filters';
import { selectedAccessPoints } from './ap-selection';
import { createStateBlock, currentContentState } from './content-state';
import { createEmptyState } from './dom-helpers';
import {
  destinationList,
  destinationSearchInput,
  moveBtn,
  movePreview,
  moveStatus,
  openDestinationBtn,
} from './elements';
import { t, tFormat, tGroup } from './i18n';
import {
  countHiddenAps,
  hasUnknownNetworks,
  isAmbiguousGroup,
  networkNames,
  orderNetworksForSearch,
  partitionDestinations,
  planMove,
  type MovePlan,
} from './move-plan';
import {
  destinationDetailText,
  hiddenApsNote,
  moveActionLabel,
  moveStatusText,
  networkDiffRows,
  unknownSourcesNote,
  unreportedSourcesNote,
} from './move-text';
import { applyPaneLayout } from './layout';
import { isOperationInProgress, state } from './state';

// The name every destination radio shares: one native radio group
const RADIO_NAME = 'destinationGroup';

/**
 * Plans the move of the current selection (APs hidden by the filters
 * included) into the destination checked in the pane.
 * @returns {MovePlan | null} The plan, or null without a destination or a
 *   selection.
 */
export function currentMovePlan(): MovePlan | null {
  const destination = state.destinationGroup;
  const selected = selectedAccessPoints(state.accessPoints, state.selectedApMacs);
  if (destination === null || selected.length === 0) {
    return null;
  }
  return planMove(selected, destination, state.wlanGroups);
}

/**
 * Tells whether an event target is one of the pane's destination radios.
 * @param {EventTarget | null} target - The event target.
 * @returns {target is HTMLInputElement} True for a destination radio.
 */
export function isDestinationRadio(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.type === 'radio' && target.name === RADIO_NAME && destinationList.contains(target);
}

/**
 * Moves keyboard focus to the radio of a group, when it is rendered.
 * @param {string} wlanId - The group id.
 * @returns {boolean} True when a radio received focus.
 */
export function focusDestinationRadio(wlanId: string): boolean {
  const radio = Array.from(destinationList.querySelectorAll<HTMLInputElement>('.destination-radio')).find(candidate => candidate.value === wlanId);
  if (!radio) {
    return false;
  }
  radio.focus();
  return document.activeElement === radio;
}

/**
 * Builds one destination option with DOM APIs (no HTML strings): a label
 * wrapping a native radio (named by the group, described by its details)
 * with the group name and its details — the network count and the first
 * network names, the ones matching the search first, or the strong
 * "No Wi-Fi networks — silences these APs" label for an empty group
 * ("Networks unknown" when the controller did not report them). An
 * ambiguous group (another group has its name) gets a disabled, never
 * checked radio and the reason on a line of its own (part of the radio's
 * description).
 * @param {WlanGroup} group - The group.
 * @param {number} index - Option index (for the element ids).
 * @returns {HTMLLabelElement} The option.
 */
function createDestinationOption(group: WlanGroup, index: number): HTMLLabelElement {
  const nameId = `destination-${index}-name`;
  const detailId = `destination-${index}-detail`;
  const reasonId = `destination-${index}-reason`;
  const ambiguous = isAmbiguousGroup(group, state.wlanGroups);

  const option = document.createElement('label');
  option.className = ambiguous ? 'destination-option is-disabled' : 'destination-option';
  option.dataset.wlanId = group.wlanId;

  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = RADIO_NAME;
  radio.className = 'destination-radio';
  radio.value = group.wlanId;
  radio.disabled = ambiguous;
  radio.checked = !ambiguous && state.destinationGroup?.wlanId === group.wlanId;
  radio.setAttribute('aria-labelledby', nameId);
  radio.setAttribute('aria-describedby', ambiguous ? `${detailId} ${reasonId}` : detailId);

  const text = document.createElement('span');
  text.className = 'destination-text';

  const name = document.createElement('span');
  name.className = 'destination-name';
  name.id = nameId;
  name.textContent = group.wlanName;

  const networksUnknown = hasUnknownNetworks(group);
  const detail = document.createElement('span');
  detail.className = group.ssidList.length === 0 && !networksUnknown ? 'destination-detail is-silence' : 'destination-detail';
  detail.id = detailId;
  detail.textContent = destinationDetailText(orderNetworksForSearch(networkNames(group), state.destinationSearchText), networksUnknown);
  // A narrow pane ellipsizes the details: the tooltip keeps them whole
  detail.title = detail.textContent;

  text.appendChild(name);
  text.appendChild(detail);
  if (ambiguous) {
    const reason = document.createElement('span');
    reason.className = 'destination-reason';
    reason.id = reasonId;
    reason.textContent = t('destinationAmbiguous');
    text.appendChild(reason);
  }
  option.appendChild(radio);
  option.appendChild(text);
  return option;
} // End of function createDestinationOption()

/**
 * Builds the "no results" state of the destination search: the message and
 * a "Clear search" button.
 * @returns {HTMLElement} The empty-state element.
 */
function createNoResultsState(): HTMLElement {
  const container = createEmptyState(tFormat('noDestinationResults', { query: state.destinationSearchText.trim() }));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary btn-compact';
  button.id = 'clearDestinationSearchBtn';
  button.textContent = t('clearSearch');
  button.addEventListener('click', clearDestinationSearch);
  container.appendChild(button);
  return container;
} // End of function createNoResultsState()

/**
 * Renders the destination radios for the current search: the groups with
 * networks first, then the empty ones under the "Silence" heading (a
 * labelled group of its own; every radio still belongs to the one native
 * radio group). A destination the search hides stays checked in the state
 * (the preview keeps naming it). Until data is loaded, the §4.6 state as
 * text (the AP list next to it carries the action). When a radio had focus,
 * focus returns to the same group's radio if it is still rendered.
 */
export function renderDestinationList(): void {
  const active = document.activeElement;
  const focusedWlanId = isDestinationRadio(active) ? active.value : null;

  const contentState = currentContentState();
  if (contentState !== 'ready') {
    destinationList.replaceChildren(createStateBlock('destination', contentState));
    return;
  }
  if (state.wlanGroups.length === 0) {
    destinationList.replaceChildren(createEmptyState(tGroup('noGroups')));
    return;
  }

  const { networks, silence } = partitionDestinations(state.wlanGroups, state.destinationSearchText);
  if (networks.length === 0 && silence.length === 0) {
    destinationList.replaceChildren(createNoResultsState());
    return;
  }

  let index = 0;
  const sections: HTMLElement[] = [];
  if (networks.length > 0) {
    const section = document.createElement('div');
    section.className = 'destination-section';
    section.replaceChildren(...networks.map(group => createDestinationOption(group, index++)));
    sections.push(section);
  }
  if (silence.length > 0) {
    const section = document.createElement('div');
    section.className = 'destination-section destination-silence';
    section.setAttribute('role', 'group');
    const heading = document.createElement('h3');
    heading.className = 'destination-section-title';
    heading.id = 'destinationSilenceTitle';
    heading.textContent = t('silenceSection');
    section.setAttribute('aria-labelledby', heading.id);
    section.replaceChildren(heading, ...silence.map(group => createDestinationOption(group, index++)));
    sections.push(section);
  }
  destinationList.replaceChildren(...sections);

  if (focusedWlanId !== null) {
    focusDestinationRadio(focusedWlanId);
  }
} // End of function renderDestinationList()

/**
 * Creates one paragraph of the move preview.
 * @param {string} className - Its CSS class.
 * @param {string} text - Its text.
 * @returns {HTMLParagraphElement} The paragraph.
 */
function createPreviewLine(className: string, text: string): HTMLParagraphElement {
  const line = document.createElement('p');
  line.className = className;
  line.textContent = text;
  return line;
}

/**
 * Builds the networks-diff list of the preview: "Gains", "Loses" and
 * "Unchanged", each on one (ellipsized) line with the whole text as tooltip.
 * @param {MovePlan} plan - The move plan.
 * @returns {HTMLElement} The <dl> element.
 */
function createNetworkDiff(plan: MovePlan): HTMLElement {
  const list = document.createElement('dl');
  list.className = 'move-diff';
  for (const row of networkDiffRows(plan)) {
    const wrapper = document.createElement('div');
    wrapper.className = `move-diff-row is-${row.kind}`;
    const term = document.createElement('dt');
    term.textContent = row.label;
    const value = document.createElement('dd');
    value.textContent = row.value;
    value.title = row.value;
    wrapper.appendChild(term);
    wrapper.appendChild(value);
    list.appendChild(wrapper);
  } // End of the loop over the gains / loses / unchanged rows
  return list;
} // End of function createNetworkDiff()

/**
 * Builds the preview lines for a destination: the destination's name and,
 * when some selected APs would move, how many of them the filters hide, the
 * networks they gain / lose / keep (only from APs whose network change is
 * known — the others are stated as unknown, also when the controller did
 * not report a network list), and the strong empty-group label when the
 * destination silences them (never for a destination whose networks are
 * unknown).
 * @param {WlanGroup} destination - The checked destination.
 * @param {MovePlan | null} plan - The plan for the selection, or null.
 * @returns {HTMLElement[]} The preview elements, in order.
 */
function buildPreview(destination: WlanGroup, plan: MovePlan | null): HTMLElement[] {
  const nodes: HTMLElement[] = [createPreviewLine('move-destination', tFormat('moveDestination', { group: destination.wlanName }))];
  if (plan === null || plan.moving.length === 0) {
    return nodes;
  }
  const hidden = hiddenApsNote(countHiddenAps(plan.moving, visibleApMacs()));
  if (hidden !== null) {
    nodes.push(createPreviewLine('move-note move-hidden-note', hidden));
  }
  if (plan.knownSourceCount > 0) {
    nodes.push(createNetworkDiff(plan));
  }
  const unknown = unknownSourcesNote(plan.unknownSourceCount);
  if (unknown !== null) {
    nodes.push(createPreviewLine('move-note move-unknown-note', unknown));
  }
  const unreported = unreportedSourcesNote(plan);
  if (unreported !== null) {
    nodes.push(createPreviewLine('move-note move-unreported-note', unreported));
  }
  if (destination.ssidList.length === 0 && !hasUnknownNetworks(destination)) {
    nodes.push(createPreviewLine('move-warning', t('emptyGroup')));
  }
  return nodes;
} // End of function buildPreview()

/**
 * Renders the move preview and the move button for the current selection
 * and destination. The status line (an aria-live region, written only when
 * its text changes) asks for APs, then for a destination, then says how many
 * APs will move ("12 already in this group; 4 will move", or that all are
 * there already). The button reads "Move AP" / "Move N APs" (the APs that
 * would move, or the selection while no destination is checked) and is
 * enabled only while connected, with no move running, and with at least one
 * AP to move: a move where every selected AP is already in the destination
 * is a no-op and stays disabled, and so does one into an ambiguous group
 * (the plan refuses it; the status line says why).
 */
export function renderMovePreview(): void {
  const hasData = state.accessPoints.length > 0 || state.wlanGroups.length > 0;
  const selected = selectedAccessPoints(state.accessPoints, state.selectedApMacs);
  const destination = state.destinationGroup;
  const plan = currentMovePlan();

  let status = '';
  if (hasData) {
    if (selected.length === 0) {
      status = t('moveNoSelection');
    } else if (destination === null) {
      status = tGroup('selectGroup');
    } else if (plan !== null) {
      status = moveStatusText(plan);
    }
  }
  if (moveStatus.textContent !== status) {
    moveStatus.textContent = status;
  }
  movePreview.replaceChildren(...(hasData && destination !== null ? buildPreview(destination, plan) : []));

  moveBtn.textContent = moveActionLabel(plan !== null ? plan.moving.length : selected.length);
  moveBtn.disabled = !state.isConnected || state.isApplyingChange || plan === null || plan.moving.length === 0;
} // End of function renderMovePreview()

/**
 * Renders the whole pane: the destination radios and the move preview.
 */
export function renderDestinationPane(): void {
  renderDestinationList();
  renderMovePreview();
}

/**
 * Delegated change handler of the destination list: a checked radio (by
 * click, Space or the arrow keys) becomes the destination; only the preview
 * re-renders, so keyboard focus stays on the radio. An ambiguous group (its
 * radio is disabled anyway) never becomes the destination.
 * @param {Event} e - The change event.
 */
export function handleDestinationChange(e: Event): void {
  const radio = e.target;
  if (!isDestinationRadio(radio) || !radio.checked) return;
  const group = state.wlanGroups.find(candidate => candidate.wlanId === radio.value);
  if (!group || isAmbiguousGroup(group, state.wlanGroups)) return;
  state.destinationGroup = group;
  renderMovePreview();
} // End of function handleDestinationChange()

/**
 * Enter on a destination radio: makes the FOCUSED radio's group the
 * destination — checked, in the state, preview refreshed — so the review the
 * caller then opens names that group, never another one (e.g. a checked
 * destination the search hides). Nothing changes, and false is returned,
 * while disconnected or during an exclusive operation, for a disabled radio
 * or an unknown group, and when the move would be a no-op (no selection,
 * every selected AP already there, or an ambiguous group the plan refuses).
 * @param {HTMLInputElement} radio - The focused destination radio.
 * @returns {boolean} True when the caller should open the review (startMove()).
 */
export function selectDestinationForMove(radio: HTMLInputElement): boolean {
  if (radio.disabled || !state.isConnected || isOperationInProgress()) return false;
  const group = state.wlanGroups.find(candidate => candidate.wlanId === radio.value);
  if (!group) return false;
  const selected = selectedAccessPoints(state.accessPoints, state.selectedApMacs);
  if (selected.length === 0 || planMove(selected, group, state.wlanGroups).moving.length === 0) return false;
  radio.checked = true;
  state.destinationGroup = group;
  renderMovePreview();
  return true;
} // End of function selectDestinationForMove()

/**
 * Input handler of the destination search: filters the radios by group and
 * network name.
 */
export function handleDestinationSearchInput(): void {
  state.destinationSearchText = destinationSearchInput.value;
  renderDestinationList();
}

/**
 * Empties the destination search, re-renders the radios and returns focus
 * to the search field (Escape in the field, "Clear search").
 */
export function clearDestinationSearch(): void {
  destinationSearchInput.value = '';
  state.destinationSearchText = '';
  renderDestinationList();
  destinationSearchInput.focus();
}

/**
 * Keydown handler of the destination search: Escape clears a non-empty
 * search (spec §4.7: Escape clears the search first).
 * @param {KeyboardEvent} e - The keydown event.
 */
export function handleDestinationSearchKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && destinationSearchInput.value !== '') {
    e.preventDefault();
    clearDestinationSearch();
  }
}

/**
 * Single-pane layout: opens the destination picker in the AP list's place
 * ("Choose destination") and moves focus into it — onto the checked radio,
 * else the first enabled one, else the search field.
 */
export function openDestinationPane(): void {
  state.destinationPaneOpen = true;
  applyPaneLayout();
  const radios = Array.from(destinationList.querySelectorAll<HTMLInputElement>('.destination-radio'));
  const target = radios.find(radio => radio.checked) ?? radios.find(radio => !radio.disabled);
  if (target) {
    target.focus();
  } else {
    destinationSearchInput.focus();
  }
} // End of function openDestinationPane()

/**
 * Single-pane layout: takes the destination picker off stage and brings the
 * AP list back, leaving keyboard focus to the caller (which must move it
 * into the list: the picker is hidden now).
 */
export function hideDestinationPane(): void {
  state.destinationPaneOpen = false;
  applyPaneLayout();
}

/**
 * Single-pane layout: closes the destination picker (its Back) — the AP
 * list comes back with focus on "Choose destination".
 */
export function closeDestinationPane(): void {
  hideDestinationPane();
  openDestinationBtn.focus();
}
