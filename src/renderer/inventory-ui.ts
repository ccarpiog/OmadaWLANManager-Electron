// ============================================================================
// Shared building blocks of the read-only AP groups and Wi-Fi networks views
// and of the AP details pane: localized count texts, cross-links (native
// buttons carrying data-link-kind / data-link-target, followed by the
// delegated handler in navigation.ts), badges, notes, detail headings,
// fact rows and sections, and the master lists' keyboard model (one Tab
// stop; ArrowUp / ArrowDown / Home / End move between the items).
// Everything is built with DOM APIs (createElement / textContent), never
// HTML strings.
// ============================================================================

import { createEmptyState } from './dom-helpers';
import { t, tFormat } from './i18n';
import { networkScopeKind } from './inventory-model';
import { apCountText } from './move-text';
import type { LinkTarget } from './nav-history';

/**
 * A controller-supplied name for display: an empty one reads "(no name)".
 * @param {string} name - The group, network or AP name.
 * @returns {string} The display text.
 */
export function displayName(name: string): string {
  return name === '' ? t('unnamed') : name;
}

/**
 * An AP count: "No APs", "1 AP", "N APs", or "AP count unknown" (null).
 * @param {number | null} count - The count, or null when unknown.
 * @returns {string} The localized count.
 */
export function apCountOrUnknown(count: number | null): string {
  if (count === null) return t('apCountUnknown');
  if (count === 0) return t('apCountNone');
  return apCountText(count);
}

/**
 * A group count: "1 group" / "N groups".
 * @param {number} count - The number of groups.
 * @returns {string} The localized count.
 */
export function groupCountText(count: number): string {
  return count === 1 ? t('groupCountOne') : tFormat('groupCountMany', { count: String(count) });
}

/**
 * A network's scope from the internal data (§4.5): "N groups · M APs" when
 * every AP is placed; otherwise a lower bound ("at least M APs") or "AP
 * count unknown" followed by the reason (how many APs' groups cannot be
 * identified) — never "No APs" while some AP may broadcast the network.
 * @param {number} groupCount - Groups broadcasting the network.
 * @param {number} apCount - APs known to broadcast it (in those groups).
 * @param {number} unknownApCount - APs that may broadcast it (their group
 *   cannot be identified).
 * @returns {string} The localized scope.
 */
export function scopeText(groupCount: number, apCount: number, unknownApCount: number): string {
  const groups = groupCountText(groupCount);
  const kind = networkScopeKind(apCount, unknownApCount);
  if (kind === 'exact') {
    return `${groups} · ${apCountOrUnknown(apCount)}`;
  }
  let aps = t('apCountUnknown');
  if (kind === 'atLeast') {
    aps = apCount === 1 ? t('apCountAtLeastOne') : tFormat('apCountAtLeastMany', { count: String(apCount) });
  }
  const reason = unknownApCount === 1 ? t('scopeUnknownApsOne') : tFormat('scopeUnknownApsMany', { count: String(unknownApCount) });
  return `${groups} · ${aps}; ${reason}`;
} // End of function scopeText()

/**
 * Builds a cross-link: a native button that opens an AP's details, a group
 * or a network in its view (navigation.ts follows it, pushing a "Back to …"
 * entry). Its text is the target's display name.
 * @param {LinkTarget} link - What the link opens.
 * @param {string} text - The visible text (the target's name).
 * @returns {HTMLButtonElement} The link button.
 */
export function createCrossLink(link: LinkTarget, text: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cross-link';
  button.dataset.linkKind = link.kind;
  button.dataset.linkTarget = link.target;
  button.textContent = displayName(text);
  return button;
} // End of function createCrossLink()

/**
 * Finds the cross-link to a target inside a container.
 * @param {HTMLElement} container - Where to look.
 * @param {LinkTarget} link - The target.
 * @returns {HTMLButtonElement | null} The first matching link, or null.
 */
export function findCrossLink(container: HTMLElement, link: LinkTarget): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.cross-link'))
    .find(button => button.dataset.linkKind === link.kind && button.dataset.linkTarget === link.target) ?? null;
}

/**
 * Returns the cross-link that has keyboard focus inside a container (to give
 * focus back to the same link after a re-render).
 * @param {HTMLElement} container - The container.
 * @returns {LinkTarget | null} The focused link's target, or null.
 */
export function focusedCrossLink(container: HTMLElement): LinkTarget | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLButtonElement) || !active.classList.contains('cross-link') || !container.contains(active)) {
    return null;
  }
  const kind = active.dataset.linkKind;
  const target = active.dataset.linkTarget;
  if ((kind !== 'ap' && kind !== 'group' && kind !== 'network') || target === undefined) {
    return null;
  }
  return { kind, target };
} // End of function focusedCrossLink()

/**
 * Builds a badge (e.g. "Default").
 * @param {string} text - The badge text.
 * @param {string} variant - Its modifier class (e.g. 'badge-default').
 * @returns {HTMLSpanElement} The badge.
 */
export function createBadge(text: string, variant: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = `badge ${variant}`;
  badge.textContent = text;
  return badge;
}

/**
 * Builds a note paragraph of a detail pane.
 * @param {string} text - The note.
 * @param {string} kind - Its data-note value (what it is about).
 * @param {string} [extraClass] - An extra class (e.g. 'is-silence').
 * @returns {HTMLParagraphElement} The note.
 */
export function createNote(text: string, kind: string, extraClass?: string): HTMLParagraphElement {
  const note = document.createElement('p');
  note.className = extraClass === undefined ? 'detail-note' : `detail-note ${extraClass}`;
  note.dataset.note = kind;
  note.textContent = text;
  return note;
}

/**
 * Builds the heading of a detail pane: the item's name, focusable by script
 * only (tabindex -1), so a cross-link can move focus to the new content.
 * @param {string} id - The heading id.
 * @param {string} text - The item's name.
 * @returns {HTMLHeadingElement} The heading.
 */
export function createDetailHeading(id: string, text: string): HTMLHeadingElement {
  const heading = document.createElement('h3');
  heading.className = 'detail-name';
  heading.id = id;
  heading.tabIndex = -1;
  heading.textContent = displayName(text);
  return heading;
}

/**
 * Builds one section of a detail pane: an h4 title and its content.
 * @param {string} kind - Its data-section value ('aps', 'networks', 'groups').
 * @param {string} title - The section title (e.g. "Access points (3)").
 * @param {HTMLElement[]} content - The section's content.
 * @returns {HTMLElement} The section.
 */
export function createDetailSection(kind: string, title: string, content: HTMLElement[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'detail-section';
  section.dataset.section = kind;
  const heading = document.createElement('h4');
  heading.className = 'detail-section-title';
  heading.textContent = title;
  section.appendChild(heading);
  section.append(...content);
  return section;
} // End of function createDetailSection()

/**
 * Builds one fact row of a detail pane's fact list (a term and its value).
 * @param {string} kind - Its data-fact value.
 * @param {string} label - The term.
 * @param {HTMLElement | string} value - The value (an element or a text).
 * @returns {HTMLDivElement} The row.
 */
export function createFact(kind: string, label: string, value: HTMLElement | string): HTMLDivElement {
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
 * Builds the list of a detail section: one row per linked item.
 * @param {HTMLElement[][]} rows - Each row's parts (the cross-link first).
 * @returns {HTMLUListElement} The list.
 */
export function createLinkList(rows: HTMLElement[][]): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'detail-links';
  for (const parts of rows) {
    const item = document.createElement('li');
    item.className = 'detail-link-row';
    item.append(...parts);
    list.appendChild(item);
  }
  return list;
} // End of function createLinkList()

/**
 * Builds a muted secondary text (e.g. a linked group's AP count).
 * @param {string} text - The text.
 * @returns {HTMLSpanElement} The element.
 */
export function createMeta(text: string): HTMLSpanElement {
  const meta = document.createElement('span');
  meta.className = 'detail-meta';
  meta.textContent = text;
  return meta;
}

/**
 * Moves keyboard focus to an element by id, when it exists.
 * @param {string} id - The element id.
 * @returns {boolean} True when the element received focus.
 */
export function focusById(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) {
    return false;
  }
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

/**
 * Writes an aria-live summary only when its text changes (so screen readers
 * announce changes, not every re-render).
 * @param {HTMLElement} element - The live region.
 * @param {string} text - The new text.
 */
export function setLiveText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

// ============================================================================
// Master lists (AP groups, Wi-Fi networks): one Tab stop, arrow keys
// ============================================================================

/**
 * Makes one master item the list's single Tab stop: the current (selected)
 * one when rendered, else the first. Every other item gets tabindex -1.
 * @param {HTMLElement} list - The master list container.
 */
export function applyMasterRovingTabindex(list: HTMLElement): void {
  const items = Array.from(list.querySelectorAll<HTMLButtonElement>('.master-item'));
  if (items.length === 0) return;
  const tabStop = items.find(item => item.getAttribute('aria-current') === 'true') ?? items[0];
  for (const item of items) {
    item.tabIndex = item === tabStop ? 0 : -1;
  }
}

/**
 * Moves keyboard focus to one master item and makes it the Tab stop.
 * @param {HTMLElement} list - The master list container.
 * @param {HTMLButtonElement} item - The item to focus.
 */
export function focusMasterItem(list: HTMLElement, item: HTMLButtonElement): void {
  for (const other of list.querySelectorAll<HTMLButtonElement>('.master-item')) {
    other.tabIndex = other === item ? 0 : -1;
  }
  item.focus();
}

/**
 * Keydown handler of a master list: ArrowUp / ArrowDown / Home / End move
 * focus between the items (Enter and Space select natively: they are
 * buttons).
 * @param {KeyboardEvent} e - The keydown event.
 * @param {HTMLElement} list - The master list container.
 */
export function handleMasterListKeydown(e: KeyboardEvent, list: HTMLElement): void {
  const current = e.target;
  if (!(current instanceof HTMLButtonElement) || !current.classList.contains('master-item')) return;
  const items = Array.from(list.querySelectorAll<HTMLButtonElement>('.master-item'));
  const index = items.indexOf(current);
  let next: number;
  switch (e.key) {
    case 'ArrowDown':
      next = index + 1;
      break;
    case 'ArrowUp':
      next = index - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = items.length - 1;
      break;
    default:
      return;
  }
  // Arrows move focus, not the panel's scroll position
  e.preventDefault();
  if (index === -1 || next < 0 || next >= items.length || next === index) return;
  focusMasterItem(list, items[next]);
} // End of function handleMasterListKeydown()

/**
 * Builds the "no results" state of a view search: the message and a "Clear
 * search" button.
 * @param {string} message - The localized message.
 * @param {string} buttonId - The button's id.
 * @param {() => void} onClear - What the button does.
 * @returns {HTMLElement} The no-results element.
 */
export function createSearchNoResults(message: string, buttonId: string, onClear: () => void): HTMLElement {
  const container = createEmptyState(message);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary btn-compact';
  button.id = buttonId;
  button.textContent = t('clearSearch');
  button.addEventListener('click', onClear);
  container.appendChild(button);
  return container;
} // End of function createSearchNoResults()
