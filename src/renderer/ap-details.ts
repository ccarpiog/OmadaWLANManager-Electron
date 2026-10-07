// ============================================================================
// AP details pane of the Access points view (docs/management-design.md §4.3:
// "clicking a row (not its checkbox) opens AP details — effective networks
// with override badges, link to its group"). Read-only, from the loaded
// internal data: status, MAC, the AP's group (a cross-link when it resolves
// to exactly one listed group), its clients when reported, and the Wi-Fi
// networks its group broadcasts, each a cross-link to the network. Per-AP
// SSID overrides are NOT read (the internal `GET eaps/{mac}` shape of
// `ssidOverrides[]` is undocumented — see todo.md 4.7), so the pane states
// that they cannot be shown instead of inventing badges.
//
// The pane takes the destination pane's place while it is open (the
// destination pane keeps its state and comes back on Close), which keeps the
// 700×500 window usable. Pure logic: inventory-model.ts.
// ============================================================================

import { focusApListAt } from './ap-focus';
import { createStatusElement } from './ap-status';
import { apDetailsContent, apDetailsPanel, apFilterInput, apList, destinationPanel } from './elements';
import { t, tFormat, tGroup } from './i18n';
import { apGroupLink, describeApDetails, networkLink, type ApDetailsModel } from './inventory-model';
import {
  createCrossLink,
  createDetailHeading,
  createDetailSection,
  createLinkList,
  createNote,
  findCrossLink,
  focusById,
  focusedCrossLink,
} from './inventory-ui';
import { state } from './state';

// Id of the pane's heading (the AP's name)
const HEADING_ID = 'apDetailsName';

/**
 * Builds one fact row of the pane (a term and its value).
 * @param {string} kind - Its data-fact value.
 * @param {string} label - The term.
 * @param {HTMLElement | string} value - The value (an element or a text).
 * @returns {HTMLDivElement} The row.
 */
function createFact(kind: string, label: string, value: HTMLElement | string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'detail-fact';
  row.dataset.fact = kind;
  const term = document.createElement('dt');
  term.textContent = label;
  const definition = document.createElement('dd');
  if (typeof value === 'string') {
    definition.textContent = value;
  } else {
    definition.appendChild(value);
  }
  row.appendChild(term);
  row.appendChild(definition);
  return row;
} // End of function createFact()

/**
 * The value of the group fact: a cross-link to the group when it resolves to
 * exactly one listed group; otherwise the reason it cannot (no group, not in
 * the list, a name another group shares).
 * @param {ApDetailsModel} model - The AP's details.
 * @returns {HTMLElement | string} The value.
 */
function groupFactValue(model: ApDetailsModel): HTMLElement | string {
  const link = apGroupLink(model.group);
  if (model.group.kind === 'group' && link !== null) {
    return createCrossLink(link, model.group.group.wlanName);
  }
  if (model.group.kind === 'unlisted') {
    return tFormat('apGroupUnlisted', { group: model.group.name });
  }
  if (model.group.kind === 'ambiguous') {
    return tFormat('apGroupAmbiguous', { group: model.group.name });
  }
  return t('unassigned');
} // End of function groupFactValue()

/**
 * Builds the networks section: the group's networks as cross-links, the
 * strong empty-group label for a group without networks, or a note when the
 * group (hence the networks) cannot be identified.
 * @param {ApDetailsModel} model - The AP's details.
 * @returns {HTMLElement} The section.
 */
function createNetworksSection(model: ApDetailsModel): HTMLElement {
  if (model.networks === null) {
    return createDetailSection('networks', t('wifiNetworks'), [createNote(t('apNetworksUnknown'), 'networksUnknown')]);
  }
  const title = `${t('wifiNetworks')} (${model.networks.length})`;
  if (model.networks.length === 0) {
    return createDetailSection('networks', title, [createNote(t('emptyGroup'), 'emptyGroup', 'is-silence')]);
  }
  const rows = model.networks.map(name => [createCrossLink(networkLink(name), name)]);
  return createDetailSection('networks', title, [createLinkList(rows)]);
} // End of function createNetworksSection()

/**
 * Builds the pane's content for one AP.
 * @param {ApDetailsModel} model - The AP's details.
 * @returns {HTMLElement[]} The content, in order.
 */
function buildContent(model: ApDetailsModel): HTMLElement[] {
  const { ap } = model;
  const facts = document.createElement('dl');
  facts.className = 'detail-facts';
  const mac = document.createElement('span');
  mac.className = 'detail-mono';
  mac.textContent = ap.mac;
  let clients: string;
  if (ap.clientNum === undefined) {
    clients = t('clientsNotReported');
  } else {
    clients = ap.clientNum === 1 ? t('clientCountOne') : tFormat('clientCountMany', { count: String(ap.clientNum) });
  }
  facts.append(
    createFact('status', t('apStatusLabel'), createStatusElement(ap.statusCategory)),
    createFact('mac', t('apMacLabel'), mac),
    createFact('group', tGroup('groupLabel'), groupFactValue(model)),
    createFact('clients', t('apClientsLabel'), clients),
  );
  return [
    createDetailHeading(HEADING_ID, ap.name),
    facts,
    createNetworksSection(model),
    createNote(t('apOverridesUnavailable'), 'overrides'),
  ];
} // End of function buildContent()

/**
 * Renders the pane for state.apDetailsMac: shown (in the destination pane's
 * place) with the AP's details, or hidden with the destination pane back
 * when no AP is open — also when the open AP is no longer loaded (the state
 * is cleared then). The rows of the Access points list mark the AP whose
 * details are open. Keyboard focus inside the pane survives the re-render
 * (same cross-link, else the heading); when the pane closes with focus
 * inside, focus returns to the AP list.
 */
export function renderApDetails(): void {
  const ap = state.apDetailsMac === null ? undefined : state.accessPoints.find(candidate => candidate.mac === state.apDetailsMac);
  const previousMac = state.apDetailsMac;
  if (ap === undefined) {
    state.apDetailsMac = null;
  }
  const focusInside = apDetailsPanel.contains(document.activeElement);
  const focusLink = focusedCrossLink(apDetailsContent);
  const headingFocused = document.activeElement?.id === HEADING_ID;

  for (const row of apList.querySelectorAll<HTMLElement>('.ap-row')) {
    row.classList.toggle('is-viewing', row.dataset.mac === state.apDetailsMac);
  }
  apDetailsPanel.hidden = ap === undefined;
  destinationPanel.hidden = ap !== undefined;

  if (ap === undefined) {
    apDetailsContent.replaceChildren();
    if (focusInside && !focusApListAt(previousMac)) {
      apFilterInput.focus();
    }
    return;
  }

  apDetailsContent.replaceChildren(...buildContent(describeApDetails(ap, state.wlanGroups)));
  if (focusLink !== null) {
    const link = findCrossLink(apDetailsContent, focusLink);
    if (link) {
      link.focus({ preventScroll: true });
      return;
    }
  }
  if (focusInside || headingFocused) {
    focusById(HEADING_ID);
  }
} // End of function renderApDetails()

/**
 * Opens the details pane for one AP (a click on its row, Enter on its
 * checkbox, or a cross-link). The pane replaces the destination pane until
 * it is closed.
 * @param {string} mac - The AP's MAC.
 * @param {boolean} focusHeading - True to move keyboard focus to the pane's
 *   heading (the AP's name).
 * @returns {boolean} True when the AP is loaded and its details are shown.
 */
export function openApDetails(mac: string, focusHeading: boolean): boolean {
  if (!state.accessPoints.some(ap => ap.mac === mac)) {
    return false;
  }
  state.apDetailsMac = mac;
  renderApDetails();
  if (focusHeading) {
    focusApDetailsHeading();
  }
  return true;
} // End of function openApDetails()

/**
 * Closes the details pane (the destination pane comes back).
 * @param {boolean} restoreFocus - True to return keyboard focus to the AP's
 *   checkbox (or the list's Tab stop, or the search field).
 */
export function closeApDetails(restoreFocus: boolean): void {
  const mac = state.apDetailsMac;
  state.apDetailsMac = null;
  renderApDetails();
  if (restoreFocus && !focusApListAt(mac)) {
    apFilterInput.focus();
  }
}

/**
 * Moves keyboard focus to the pane's heading (the AP's name).
 * @returns {boolean} True when the heading received focus.
 */
export function focusApDetailsHeading(): boolean {
  return focusById(HEADING_ID);
}
