// ============================================================================
// Controller switcher (inbox item I-1c2b; spec
// autoclaude/processed/10-tplink-cloud-controllers.md "UI"): the DOM of the
// switcher at the top of the sidebar, over the pure model
// (controller-switcher-model.ts). It holds what the switcher shows — the
// config's local URL, cloud credential flag and main's current target
// (applySwitcherConfig() / syncSwitcherConfig()), and the TP-Link cloud
// account's controllers (loadCloudControllers(), late replies discarded) —
// and renders it:
// - the toggle names the controller the app works with ("This network", a
//   cloud controller's name, or none chosen yet) and opens the panel;
// - the panel lists "This network" first, then the cloud controllers by
//   name with a "Cloud" tag (the local duplicate hidden), each one that
//   cannot be used focusable but aria-disabled and described by its reason;
//   a failed, empty or incomplete cloud list says so under the entries;
// - while an operation owns the session (isSwitcherBusy()) the toggle is
//   aria-disabled and described by the reason, and the panel is closed.
// The switch itself — invalidating the session, switchController(), the
// result handled like connect()'s — is switchToController() in
// connection.ts; renderer.ts wires the clicks (takeSwitcherChoice()), so
// this module never imports the connection code. Shown only while a cloud
// credential is stored: without one the app looks as before. Built with DOM
// APIs, never HTML strings.
// ============================================================================

import type { ControllerTarget } from '../shared/types';
import { parseCloudAccessResult, type ParsedCloudResult } from './cloud-form';
import {
  activeSwitcherEntry,
  buildControllerSwitcher,
  canConnect,
  isEntryActivatable,
  isSwitcherBusy,
  localOmadacIdOf,
  readSwitcherConfig,
  SWITCHER_TEXT,
  switcherEntryParts,
  switcherNotice,
  type SwitcherConfig,
  type SwitcherEntry,
  type SwitcherModel,
} from './controller-switcher-model';
import { handleListArrowKeydown } from './dom-helpers';
import {
  controllerSwitcher,
  controllerSwitcherBtn,
  controllerSwitcherBusyText,
  controllerSwitcherCurrent,
  controllerSwitcherLabel,
  controllerSwitcherList,
  controllerSwitcherNotice,
  controllerSwitcherPanel,
} from './elements';
import { t, tFormat } from './i18n';
import { state } from './state';
import { controllerHostLabel } from './validation';

/**
 * The switcher's model from the renderer state: the configured local
 * controller (labelled by its host), the cloud list held, the local
 * omadacId that list carried, main's target and — for an active cloud
 * controller the list does not show — the connected controller's name.
 * @returns {SwitcherModel} The model.
 */
export function currentSwitcherModel(): SwitcherModel {
  return buildControllerSwitcher({
    localConfigured: state.switcherLocalUrl !== '',
    localName: controllerHostLabel(state.switcherLocalUrl, null),
    cloud: state.cloudControllers,
    localOmadacId: localOmadacIdOf(state.cloudControllers),
    active: state.connectionTarget,
    activeName: state.controllerName,
  });
} // End of function currentSwitcherModel()

/**
 * Applies a config read (loadConfig()) to the switcher: the local URL, the
 * cloud credential flag and main's current target, and — from them —
 * whether connect() reaches a controller (state.hasStoredConfig, canConnect()).
 * Without a cloud credential no list is held and a read in flight is
 * discarded. Re-renders the switcher.
 * @param {unknown} config - The RendererConfig received over IPC.
 * @returns {SwitcherConfig} What was read.
 */
export function applySwitcherConfig(config: unknown): SwitcherConfig {
  const view = readSwitcherConfig(config);
  state.switcherLocalUrl = view.localUrl;
  state.switcherCredentialStored = view.credentialStored;
  state.connectionTarget = view.target;
  state.hasStoredConfig = canConnect(view);
  if (!view.credentialStored) {
    state.cloudControllers = null;
    state.cloudListRequest++;
  }
  renderControllerSwitcher();
  return view;
} // End of function applySwitcherConfig()

/**
 * Reads main's config again (after a switch or a settings save) and applies
 * it to the switcher (applySwitcherConfig()). A failed read keeps what is
 * shown.
 * @returns {Promise<SwitcherConfig | null>} What was read, or null on failure.
 */
export async function syncSwitcherConfig(): Promise<SwitcherConfig | null> {
  try {
    return applySwitcherConfig(await window.omadaAPI.loadConfig());
  } catch (error) {
    console.warn('Could not read the configuration for the controller switcher:', error);
    return null;
  }
} // End of function syncSwitcherConfig()

/**
 * Reads the TP-Link cloud account's controllers (cloud:controllers, no
 * argument) for the switcher, while a cloud credential is stored. The reply
 * is validated (parseCloudAccessResult(); an IPC failure counts as a failed
 * list) and kept only when it answers the latest read — a newer read, or a
 * credential change in between, discards it. The list on screen stays until
 * the reply arrives.
 * @returns {Promise<ParsedCloudResult | null>} The kept reply, or null (no
 *   credential, or a late reply).
 */
export async function loadCloudControllers(): Promise<ParsedCloudResult | null> {
  if (!state.switcherCredentialStored) {
    state.cloudControllers = null;
    renderControllerSwitcher();
    return null;
  }
  const request = ++state.cloudListRequest;
  let parsed: ParsedCloudResult;
  try {
    parsed = parseCloudAccessResult(await window.omadaAPI.getCloudControllers());
  } catch (error) {
    console.warn('Error listing the TP-Link cloud controllers:', error);
    parsed = { ok: false, error: 'invalid', code: null, diagnostic: null };
  }
  if (request !== state.cloudListRequest) {
    return null;
  }
  state.cloudControllers = parsed;
  renderControllerSwitcher();
  return parsed;
} // End of function loadCloudControllers()

/**
 * The title an entry (or the toggle, for the active entry) shows: "This
 * network" for the local controller, else the cloud controller's name.
 * @param {SwitcherEntry} entry - The entry.
 * @returns {string} The title.
 */
function entryTitle(entry: SwitcherEntry): string {
  const parts = switcherEntryParts(entry);
  return parts.titleKey !== null ? t(parts.titleKey) : parts.title;
}

/**
 * The entry buttons of the panel, in order.
 * @returns {HTMLButtonElement[]} The buttons.
 */
function entryButtons(): HTMLButtonElement[] {
  return Array.from(controllerSwitcherList.querySelectorAll<HTMLButtonElement>('.controller-entry'));
}

/**
 * Builds one entry of the panel: a native button (its title, the "Cloud"
 * tag, the local host or the cloud version), aria-current on the active
 * entry; an entry that cannot be used stays focusable, aria-disabled and
 * described by its reason (shown under it).
 * @param {SwitcherEntry} entry - The entry.
 * @param {number} index - Its position (for the reason's id).
 * @returns {HTMLLIElement} The list item.
 */
function buildEntryItem(entry: SwitcherEntry, index: number): HTMLLIElement {
  const parts = switcherEntryParts(entry);
  const item = document.createElement('li');
  item.className = 'controller-entry-item';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'controller-entry';
  button.dataset.key = entry.key;
  button.dataset.kind = entry.kind;

  const head = document.createElement('span');
  head.className = 'controller-entry-head';
  const title = document.createElement('span');
  title.className = 'controller-entry-title';
  title.textContent = entryTitle(entry);
  head.appendChild(title);
  if (parts.cloudTag) {
    const tag = document.createElement('span');
    tag.className = 'controller-entry-tag';
    tag.textContent = t(SWITCHER_TEXT.cloudTag);
    head.appendChild(tag);
  }
  button.appendChild(head);

  const detailText = parts.host ?? (parts.version !== null ? tFormat('controllerVersionLabel', { version: parts.version }) : null);
  if (detailText !== null) {
    const detail = document.createElement('span');
    detail.className = 'controller-entry-detail';
    detail.textContent = detailText;
    button.appendChild(detail);
  }
  if (entry.active) {
    button.setAttribute('aria-current', 'true');
  }
  item.appendChild(button);

  if (!entry.usable && entry.reasonKey !== null) {
    const reason = document.createElement('p');
    reason.className = 'controller-entry-reason';
    reason.id = `controllerEntryReason${index}`;
    reason.textContent = t(entry.reasonKey);
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-describedby', reason.id);
    item.appendChild(reason);
  }
  return item;
} // End of function buildEntryItem()

/**
 * Writes the toggle: the switcher's label, the active controller (or "none
 * chosen"), its tooltip, and — while an operation owns the session — the
 * busy state (aria-disabled, described by the reason, which is also the
 * tooltip then).
 * @param {SwitcherModel} model - The switcher's model.
 * @param {boolean} busy - Whether the switcher is disabled now.
 */
function renderSwitcherToggle(model: SwitcherModel, busy: boolean): void {
  const active = activeSwitcherEntry(model);
  const current = active === null ? t('controllerSwitcherNone') : entryTitle(active);
  controllerSwitcherLabel.textContent = t(SWITCHER_TEXT.label);
  controllerSwitcherCurrent.textContent = current;
  controllerSwitcherBusyText.textContent = t(SWITCHER_TEXT.busy);
  controllerSwitcher.classList.toggle('is-cloud', active !== null && (active.kind === 'cloud' || active.viaCloud));
  controllerSwitcherBtn.classList.toggle('is-busy', busy);
  if (busy) {
    controllerSwitcherBtn.setAttribute('aria-disabled', 'true');
    controllerSwitcherBtn.setAttribute('aria-describedby', controllerSwitcherBusyText.id);
    controllerSwitcherBtn.title = t(SWITCHER_TEXT.busy);
  } else {
    controllerSwitcherBtn.removeAttribute('aria-disabled');
    controllerSwitcherBtn.removeAttribute('aria-describedby');
    controllerSwitcherBtn.title = tFormat('controllerSwitcherToggle', { name: current });
  }
  controllerSwitcherBtn.setAttribute('aria-expanded', String(state.switcherOpen));
} // End of function renderSwitcherToggle()

/**
 * Renders the switcher from the state (see the header): shown exactly while
 * a cloud credential is stored (the list read, being read, failed or empty —
 * a failed or empty list is shown too, so the user learns why nothing can be
 * chosen); without one nothing in the cloud is reachable (main refuses a
 * cloud connect), so there is nothing to switch to and the app looks as
 * before the TP-Link cloud existed. Then the toggle, the entries and the
 * notice (a live region: rewritten only when its text changes). The panel
 * closes when the switcher hides or becomes busy (focus inside it goes back
 * to the toggle); an entry that had focus keeps it across the re-render.
 * Called whenever what it shows may have changed: a config read, a cloud
 * list, the start and end of every operation that disables it, a language
 * change.
 */
export function renderControllerSwitcher(): void {
  const model = currentSwitcherModel();
  const shown = state.switcherCredentialStored;
  const busy = isSwitcherBusy(state);
  const focusInPanel = controllerSwitcherPanel.contains(document.activeElement);
  const focusedKey = focusInPanel && document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key ?? null : null;
  if (state.switcherOpen && (!shown || busy)) {
    state.switcherOpen = false;
  }
  controllerSwitcher.hidden = !shown;
  renderSwitcherToggle(model, busy);

  controllerSwitcherList.replaceChildren(...model.entries.map((entry, index) => buildEntryItem(entry, index)));
  const notice = switcherNotice(model, state.cloudControllers, state.switcherCredentialStored);
  const noticeText = notice === null ? '' : notice.detail ? `${t(notice.key)} (${notice.detail})` : t(notice.key);
  if (controllerSwitcherNotice.textContent !== noticeText) {
    controllerSwitcherNotice.textContent = noticeText;
  }
  controllerSwitcherNotice.hidden = notice === null;
  if (notice === null) {
    delete controllerSwitcherNotice.dataset.tone;
  } else {
    controllerSwitcherNotice.dataset.tone = notice.tone;
  }
  controllerSwitcherPanel.hidden = !state.switcherOpen;

  // Focus never stays on a removed or hidden entry
  if (focusInPanel) {
    const again = state.switcherOpen && focusedKey !== null ? entryButtons().find((button) => button.dataset.key === focusedKey) : undefined;
    if (again !== undefined) {
      again.focus();
    } else if (state.switcherOpen) {
      controllerSwitcherPanel.focus();
    } else if (shown) {
      controllerSwitcherBtn.focus();
    }
  }
} // End of function renderControllerSwitcher()

/**
 * Opens the panel and moves focus into it: onto the active entry, else the
 * first entry that can be chosen, else the first entry, else the panel
 * itself (its notice says why nothing is listed). A no-op while the
 * switcher is hidden; while it is busy it only refreshes the busy state.
 */
export function openControllerSwitcher(): void {
  if (controllerSwitcher.hidden) return;
  if (isSwitcherBusy(state)) {
    renderControllerSwitcher();
    return;
  }
  state.switcherOpen = true;
  renderControllerSwitcher();
  const model = currentSwitcherModel();
  const preferred =
    model.entries.find((entry) => entry.active) ??
    model.entries.find((entry) => isEntryActivatable(entry, state.isConnected)) ??
    model.entries[0];
  const button = preferred === undefined ? undefined : entryButtons().find((candidate) => candidate.dataset.key === preferred.key);
  (button ?? controllerSwitcherPanel).focus();
} // End of function openControllerSwitcher()

/**
 * Closes the panel (a no-op when it is closed).
 * @param {boolean} restoreFocus - Move focus back to the toggle (Escape, a choice).
 */
export function closeControllerSwitcher(restoreFocus: boolean): void {
  if (!state.switcherOpen) return;
  state.switcherOpen = false;
  controllerSwitcherPanel.hidden = true;
  controllerSwitcherBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus) {
    controllerSwitcherBtn.focus();
  }
}

/**
 * The toggle's click handler: closes an open panel, opens a closed one
 * (openControllerSwitcher()); while busy nothing opens.
 */
export function toggleControllerSwitcher(): void {
  if (state.switcherOpen) {
    closeControllerSwitcher(true);
  } else {
    openControllerSwitcher();
  }
}

/**
 * Reads a click inside the panel as a choice: an entry that can be chosen
 * (isEntryActivatable(): usable, and not the controller already on screen)
 * closes the panel, focus back on the toggle, and its target is returned
 * for the switch; the active entry closes the panel too and returns null; an
 * entry that cannot be used (aria-disabled) does nothing; while busy only
 * the busy state is refreshed.
 * @param {Event} e - The click event.
 * @returns {ControllerTarget | null} The target to switch to, or null.
 */
export function takeSwitcherChoice(e: Event): ControllerTarget | null {
  const button = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.controller-entry') : null;
  if (button === null) return null;
  const entry = currentSwitcherModel().entries.find((candidate) => candidate.key === button.dataset.key);
  if (entry === undefined || !entry.usable) return null;
  if (isSwitcherBusy(state)) {
    renderControllerSwitcher();
    return null;
  }
  closeControllerSwitcher(true);
  return isEntryActivatable(entry, state.isConnected) ? entry.target : null;
} // End of function takeSwitcherChoice()

/**
 * Keydown handler of the switcher: Escape closes an open panel with focus
 * back on the toggle (marked handled, so the app-wide Escape does not also
 * clear a search); ArrowDown / ArrowUp / Home / End move between the entries
 * (the disabled ones included, so their reasons can be read).
 * @param {KeyboardEvent} e - The keydown event.
 */
export function handleControllerSwitcherKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (state.switcherOpen && !e.isComposing) {
      e.preventDefault();
      closeControllerSwitcher(true);
    }
    return;
  }
  handleListArrowKeydown(e, entryButtons());
} // End of function handleControllerSwitcherKeydown()

/**
 * Focus leaving the switcher for another control closes the panel (focus
 * stays where it went).
 * @param {FocusEvent} e - The focusout event.
 */
export function handleControllerSwitcherFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget;
  if (state.switcherOpen && next instanceof Node && !controllerSwitcher.contains(next)) {
    closeControllerSwitcher(false);
  }
}

/**
 * A pointer press outside the switcher closes the panel.
 * @param {Event} e - The pointerdown event (document-level).
 */
export function handleOutsidePointerDown(e: Event): void {
  if (state.switcherOpen && e.target instanceof Node && !controllerSwitcher.contains(e.target)) {
    closeControllerSwitcher(false);
  }
}
