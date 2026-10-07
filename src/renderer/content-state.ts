// ============================================================================
// The §4.6 states of the views' content (docs/management-design.md) as DOM
// blocks: first run (one "Configure connection" action), disconnected
// ("Connect to controller"), initial loading (skeleton rows in the layout)
// and the initial-load error (a persistent inline error with Retry and
// Settings). The state itself is derived by contentState() in the pure
// view-state.ts. Each view's main list shows the block with its action
// (exactly one per view); the destination list next to the AP list shows
// the same state as text only, so the Access points view never offers two
// identical actions. The action buttons carry data-state-action
// ("configure", "connect", "retry", "settings"), followed by one delegated
// handler in renderer.ts, so this module needs no import of the connection
// or settings code. Everything is built with DOM APIs, never HTML strings.
// ============================================================================

import { createEmptyState } from './dom-helpers';
import { t, type Translations } from './i18n';
import { state } from './state';
import { contentState, type ContentState } from './view-state';

/**
 * Where a state block goes: a view's main list (with the action) or the
 * Access points view's destination list (text only).
 */
export type StateTarget = 'accessPoints' | 'groups' | 'networks' | 'destination';

// The "connect to see …" text of each target (disconnected state)
const DISCONNECTED_TEXT: Record<StateTarget, keyof Translations> = {
  accessPoints: 'connectToSeeAPs',
  groups: 'connectToSeeGroups',
  networks: 'connectToSeeNetworks',
  destination: 'connectToSeeGroups',
};

// Skeleton rows per target while the first data loads
const SKELETON_ROWS = 5;

/**
 * Derives the content state of the views from the renderer state.
 * @returns {ContentState} The state every view shows.
 */
export function currentContentState(): ContentState {
  return contentState({
    hasStoredConfig: state.hasStoredConfig,
    isConnecting: state.isConnecting,
    isLoadingData: state.isLoadingData,
    hasData: state.lastUpdatedAt !== null,
    loadError: state.loadError,
  });
}

/**
 * Builds one action button of a state block (also used by the Wi-Fi
 * networks view's managed-read error, managed-networks-view.ts).
 * @param {string} action - Its data-state-action value.
 * @param {string} label - Its text.
 * @param {string} variant - Its button class (e.g. 'btn-primary').
 * @returns {HTMLButtonElement} The button.
 */
export function createStateAction(action: string, label: string, variant: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn ${variant} btn-compact state-action`;
  button.dataset.stateAction = action;
  button.textContent = label;
  return button;
}

/**
 * Builds the loading skeleton: a few grey placeholder rows in the list's
 * place, announced as "Loading…" (role="status").
 * @returns {HTMLElement} The skeleton.
 */
export function createSkeletonState(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'loading skeleton-list';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-label', t('loading'));
  for (let index = 0; index < SKELETON_ROWS; index++) {
    const row = document.createElement('div');
    row.className = 'skeleton-row';
    row.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = 'skeleton-bar is-title';
    const detail = document.createElement('span');
    detail.className = 'skeleton-bar is-detail';
    row.append(title, detail);
    container.appendChild(row);
  } // End of the loop that builds the skeleton rows
  return container;
} // End of function createSkeletonState()

/**
 * Builds the block of a non-ready content state for one target: the
 * message (its first paragraph) and, in a view's main list, the state's
 * action(s): "Configure connection" (first run), "Connect to controller"
 * (disconnected), or Retry + Settings (initial-load error, which is a
 * persistent alert). The destination list gets the text only.
 * @param {StateTarget} target - Where the block goes.
 * @param {Exclude<ContentState, 'ready'>} kind - The state.
 * @returns {HTMLElement} The block.
 */
export function createStateBlock(target: StateTarget, kind: Exclude<ContentState, 'ready'>): HTMLElement {
  if (kind === 'loading') {
    return createSkeletonState();
  }
  const withActions = target !== 'destination';
  let block: HTMLElement;
  const actions: HTMLButtonElement[] = [];
  if (kind === 'firstRun') {
    block = createEmptyState(t('configureHint'));
    actions.push(createStateAction('configure', t('configureConnection'), 'btn-primary'));
  } else if (kind === 'disconnected') {
    block = createEmptyState(t(DISCONNECTED_TEXT[target]));
    actions.push(createStateAction('connect', t('connectToController'), 'btn-primary'));
  } else {
    block = createEmptyState(state.loadError ?? t('loadError'));
    actions.push(createStateAction('retry', t('retry'), 'btn-primary'), createStateAction('settings', t('settings'), 'btn-secondary'));
    // The view's main list carries the alert; the destination list next to
    // it repeats the message, muted
    if (withActions) {
      block.classList.add('is-error');
      block.setAttribute('role', 'alert');
    }
  }
  block.classList.add('state-block');
  block.dataset.state = kind;
  if (withActions) {
    const bar = document.createElement('div');
    bar.className = 'state-actions';
    bar.append(...actions);
    block.appendChild(bar);
  }
  return block;
} // End of function createStateBlock()
