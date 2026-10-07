// ============================================================================
// DOM blocks of the Wi-Fi networks view (docs/management-design.md §4.5,
// §4.6) on its managed (Open API) source (todo.md 4.10, phase 17b): one
// master item per network (name; enabled state, security and bands; scope),
// the detail's content (the scope, the facts, the bound AP groups and the
// APs that broadcast it as cross-links, or the note of an "All access
// points" / unknown scope), the scope text, the error state of a failed
// first managed read with Retry and Settings, and the refresh-error notice
// of a stale list (a failed re-read kept the last good one: its time, the
// reason and Retry). Also the APs section both sources share. Read-only: no edit controls (phases 18–19). A value the controller
// did not report clearly is stated as unknown, never invented; the
// passphrase is only stated as set / none — the DTO carries no key.
// Everything is built with DOM APIs, never HTML strings. Pure logic:
// network-management.ts; the view itself (source, selection, search):
// networks-view.ts.
// ============================================================================

import type { AccessPoint, NetworkBand } from '../shared/types';
import { createStatusElement } from './ap-status';
import { createStateAction } from './content-state';
import { createEmptyState } from './dom-helpers';
import { networksStaleNotice, networksStaleNoticeText, networksStaleRetryBtn } from './elements';
import { t, tFormat, tGroup } from './i18n';
import { apLink, groupLink, groupMembers } from './inventory-model';
import {
  apCountOrUnknown,
  createCrossLink,
  createDetailSection,
  createFact,
  createLinkList,
  createMeta,
  createNote,
  displayName,
  groupCountText,
} from './inventory-ui';
import {
  bandKeys,
  enabledKey,
  networkFailureKey,
  passphraseKey,
  securityKey,
  summarizeScope,
  type ManagedNetworkRow,
  type ManagedScope,
  type NetworkFailureDetail,
} from './network-management';
import { state } from './state';
import { formatTime } from './status';

/**
 * Builds the APs section of a network's detail (both sources): the APs that
 * broadcast it as cross-links with their status, then — when some APs may
 * broadcast it but their group cannot be identified — a note saying how
 * many. While the count is not exact (such APs, or bound groups the list
 * does not have) the title carries no count and "no access points" is never
 * stated; with every AP placed and none broadcasting it, the no-APs note.
 * @param {readonly AccessPoint[]} aps - The APs that broadcast it, in list order.
 * @param {number} unknownApCount - APs that may broadcast it (group unknown).
 * @param {number} [unresolvedGroupCount] - Bound groups the list does not have.
 * @returns {HTMLElement} The section.
 */
export function createBroadcastingApsSection(aps: readonly AccessPoint[], unknownApCount: number, unresolvedGroupCount = 0): HTMLElement {
  const content: HTMLElement[] = [];
  if (aps.length > 0) {
    content.push(createLinkList(aps.map(ap => [createCrossLink(apLink(ap), ap.name), createStatusElement(ap.statusCategory)])));
  }
  if (unknownApCount > 0) {
    const note = unknownApCount === 1 ? t('networkUnknownApsOne') : tFormat('networkUnknownApsMany', { count: String(unknownApCount) });
    content.push(createNote(note, 'unknownAps'));
  }
  if (unknownApCount > 0 || unresolvedGroupCount > 0) {
    return createDetailSection('aps', t('accessPoints'), content);
  }
  if (aps.length === 0) {
    content.push(createNote(t('networkNoAps'), 'noAps'));
  }
  return createDetailSection('aps', `${t('accessPoints')} (${aps.length})`, content);
} // End of function createBroadcastingApsSection()

/**
 * A managed network's scope as text: "All access points", "Unknown scope",
 * or "N groups · M APs" — while M is a lower bound, "at least M APs" (or
 * "AP count unknown" when none is placed) followed by the reasons: how many
 * APs' groups cannot be identified and how many bound groups the list does
 * not have. A lower bound is never presented as exact.
 * @param {ManagedScope} scope - The resolved scope.
 * @returns {string} The localized scope.
 */
export function managedScopeText(scope: ManagedScope): string {
  const summary = summarizeScope(scope);
  if (summary.kind === 'allAccessPoints') return t('scopeAllAccessPoints');
  if (summary.kind === 'unknown') return t('scopeUnknown');

  const groups = groupCountText(summary.groupCount);
  if (summary.countKind === 'exact') {
    return `${groups} · ${apCountOrUnknown(summary.apCount)}`;
  }
  let aps = t('apCountUnknown');
  if (summary.countKind === 'atLeast') {
    aps = summary.apCount === 1 ? t('apCountAtLeastOne') : tFormat('apCountAtLeastMany', { count: String(summary.apCount) });
  }
  const reasons: string[] = [];
  if (summary.unknownApCount > 0) {
    reasons.push(summary.unknownApCount === 1 ? t('scopeUnknownApsOne') : tFormat('scopeUnknownApsMany', { count: String(summary.unknownApCount) }));
  }
  if (summary.unresolvedGroupCount > 0) {
    reasons.push(
      summary.unresolvedGroupCount === 1 ? t('scopeUnresolvedGroupsOne') : tFormat('scopeUnresolvedGroupsMany', { count: String(summary.unresolvedGroupCount) })
    );
  }
  return [`${groups} · ${aps}`, ...reasons].join('; ');
} // End of function managedScopeText()

/**
 * A band list as text ("2.4 GHz and 5 GHz"), or null when unknown.
 * @param {NetworkBand[] | null} bands - The DTO value.
 * @returns {string | null} The localized list, or null.
 */
function bandsText(bands: NetworkBand[] | null): string | null {
  const keys = bandKeys(bands);
  if (keys === null) return null;
  return new Intl.ListFormat(state.currentLanguage, { type: 'conjunction' }).format(keys.map(key => t(key)));
}

/**
 * Builds one master item of the managed list: a native button (the selected
 * one carries aria-current="true") with the network's name, a line with its
 * enabled state, security and bands ("State unknown", "Security unknown",
 * "Bands unknown" when not reported clearly) and its scope.
 * @param {ManagedNetworkRow} row - The network's row.
 * @param {string | null} selectedId - The selected network's id, or null.
 * @returns {HTMLLIElement} The list item.
 */
export function createManagedNetworkItem(row: ManagedNetworkRow, selectedId: string | null): HTMLLIElement {
  const { network } = row;
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'master-item';
  button.dataset.networkId = network.id;
  button.dataset.networkName = network.name;
  button.tabIndex = -1;
  if (network.id === selectedId) {
    button.setAttribute('aria-current', 'true');
  }
  const header = document.createElement('span');
  header.className = 'master-item-header';
  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = displayName(network.name);
  header.appendChild(name);

  const enabled = enabledKey(network.enabled);
  const security = securityKey(network.security);
  const properties = document.createElement('span');
  properties.className = 'item-subtitle master-item-meta network-properties';
  properties.dataset.enabled = network.enabled === null ? 'unknown' : String(network.enabled);
  properties.textContent = [
    enabled === null ? t('networkEnabledUnknown') : t(enabled),
    security === null ? t('securityUnknown') : t(security),
    bandsText(network.bands) ?? t('bandsUnknown'),
  ].join(' · ');

  const scope = document.createElement('span');
  scope.className = 'item-subtitle master-item-meta network-scope';
  scope.dataset.scope = network.scope;
  scope.textContent = managedScopeText(row.scope);
  button.append(header, properties, scope);
  item.appendChild(button);
  return item;
} // End of function createManagedNetworkItem()

/**
 * Builds the facts of a managed network's detail: its enabled state,
 * security, bands and whether a password is set — each "Unknown" when the
 * controller did not report it clearly.
 * @param {ManagedNetworkRow} row - The network's row.
 * @returns {HTMLDListElement} The fact list.
 */
function createManagedFacts(row: ManagedNetworkRow): HTMLDListElement {
  const { network } = row;
  const unknown = t('networkValueUnknown');
  const enabled = enabledKey(network.enabled);
  const security = securityKey(network.security);
  const passphrase = passphraseKey(network.hasPassphrase);
  const facts = document.createElement('dl');
  facts.className = 'detail-facts';
  facts.append(
    createFact('enabled', t('networkStateLabel'), enabled === null ? unknown : t(enabled)),
    createFact('security', t('networkSecurityLabel'), security === null ? unknown : t(security)),
    createFact('bands', t('networkBandsLabel'), bandsText(network.bands) ?? unknown),
    createFact('passphrase', t('networkPassphraseLabel'), passphrase === null ? unknown : t(passphrase)),
  );
  return facts;
} // End of function createManagedFacts()

/**
 * Builds the bound-groups section of a network bound to AP groups: the
 * bound groups the list has as cross-links with their AP counts, a note for
 * the bound groups it does not have, or the note that it is bound to none.
 * @param {Extract<ManagedScope, { kind: 'apGroups' }>} scope - The resolved scope.
 * @returns {HTMLElement} The section.
 */
function createBoundGroupsSection(scope: Extract<ManagedScope, { kind: 'apGroups' }>): HTMLElement {
  const content: HTMLElement[] = [];
  if (scope.groups.length > 0) {
    const rows = scope.groups.map(group => {
      const members = groupMembers(group, state.wlanGroups, state.accessPoints);
      return [createCrossLink(groupLink(group), group.wlanName), createMeta(apCountOrUnknown(members === null ? null : members.length))];
    });
    content.push(createLinkList(rows));
  }
  if (scope.unresolvedGroupCount > 0) {
    const count = scope.unresolvedGroupCount;
    content.push(createNote(count === 1 ? t('networkUnresolvedGroupsOne') : tFormat('networkUnresolvedGroupsMany', { count: String(count) }), 'unresolvedGroups'));
  }
  if (scope.groupCount === 0) {
    content.push(createNote(t('networkNoGroups'), 'noGroups'));
  }
  return createDetailSection('groups', `${tGroup('groupsTitle')} (${scope.groupCount})`, content);
} // End of function createBoundGroupsSection()

/**
 * Builds a managed network's detail below its heading: the scope line, the
 * facts, then by scope — bound AP groups: the groups and the APs that
 * broadcast it (cross-links); "All access points": a note saying so; an
 * unknown scope: a note that its groups and APs are not shown.
 * @param {ManagedNetworkRow} row - The network's row.
 * @returns {HTMLElement[]} The content, in order.
 */
export function buildManagedNetworkDetail(row: ManagedNetworkRow): HTMLElement[] {
  const scopeLine = document.createElement('p');
  scopeLine.className = 'detail-summary detail-scope';
  scopeLine.dataset.scope = row.network.scope;
  scopeLine.textContent = managedScopeText(row.scope);
  const content: HTMLElement[] = [scopeLine, createManagedFacts(row)];

  const { scope } = row;
  if (scope.kind === 'allAccessPoints') {
    content.push(createNote(t('networkAllAccessPointsNote'), 'allAccessPoints'));
  } else if (scope.kind === 'unknown') {
    content.push(createNote(t('networkUnknownScopeNote'), 'unknownScope'));
  } else {
    content.push(createBoundGroupsSection(scope));
    // With no AP placed, none unknown and some bound groups not listed there
    // is nothing to list (the groups section's note explains why)
    if (scope.groupCount > 0 && (scope.aps.length > 0 || scope.unknownApCount > 0 || scope.unresolvedGroupCount === 0)) {
      content.push(createBroadcastingApsSection(scope.aps, scope.unknownApCount, scope.unresolvedGroupCount));
    }
  }
  return content;
} // End of function buildManagedNetworkDetail()

/**
 * The text of a managed read's failure: its message, with main's codes-only
 * diagnostic in parentheses when there is one.
 * @param {NetworkFailureDetail | null} failure - The failure (null reads as 'failed').
 * @returns {string} The localized text.
 */
function managedNetworksFailureText(failure: NetworkFailureDetail | null): string {
  const text = t(networkFailureKey(failure?.error ?? 'failed'));
  const diagnostic = failure?.diagnostic ?? null;
  return diagnostic === null ? text : `${text} (${diagnostic})`;
}

/**
 * Builds the §4.6 error state of a failed first managed read in the master
 * list's place: a persistent alert with the failure's message (and main's
 * codes-only diagnostic), "Retry" (data-state-action "retryNetworks": the
 * managed read again) and "Settings". No list is shown with it.
 * @param {NetworkFailureDetail | null} failure - The failure (null reads as 'failed').
 * @returns {HTMLElement} The block.
 */
export function createManagedNetworksFailure(failure: NetworkFailureDetail | null): HTMLElement {
  const error = failure?.error ?? 'failed';
  const block = createEmptyState(managedNetworksFailureText(failure));
  block.classList.add('state-block', 'is-error');
  block.setAttribute('role', 'alert');
  block.dataset.state = 'networksError';
  block.dataset.error = error;
  const bar = document.createElement('div');
  bar.className = 'state-actions';
  bar.append(createStateAction('retryNetworks', t('retry'), 'btn-primary'), createStateAction('settings', t('settings'), 'btn-secondary'));
  block.appendChild(bar);
  return block;
} // End of function createManagedNetworksFailure()

/**
 * Renders the §4.6 refresh-error notice of the managed list: shown while the
 * list on screen is stale (a re-read failed, so the last good list stayed),
 * with the time of that list, the failure's text (and main's codes-only
 * diagnostic) and Retry (data-state-action "retryNetworks"); the amber dot
 * marks the list as stale. The failure's code is exposed as data-error and
 * the list's time (ms since the epoch) as data-read-at. Hidden otherwise.
 * @param {NetworkFailureDetail | null} failure - The failure of the stale list's re-read, or null when the list is not stale.
 * @param {number | null} readAt - When the list on screen was read, or null.
 */
export function renderManagedNetworksStaleNotice(failure: NetworkFailureDetail | null, readAt: number | null): void {
  const shown = failure !== null && readAt !== null;
  networksStaleNotice.hidden = !shown;
  networksStaleNoticeText.textContent = shown ? tFormat('networksStaleNotice', { time: formatTime(readAt), reason: managedNetworksFailureText(failure) }) : '';
  networksStaleRetryBtn.textContent = t('retry');
  if (shown) {
    networksStaleNotice.dataset.error = failure.error;
    networksStaleNotice.dataset.readAt = String(readAt);
  } else {
    delete networksStaleNotice.dataset.error;
    delete networksStaleNotice.dataset.readAt;
  }
} // End of function renderManagedNetworksStaleNotice()
