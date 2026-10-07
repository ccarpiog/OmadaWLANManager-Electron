// ============================================================================
// Responsive layout (docs/management-design.md §4.7). The window width picks
// the form, in styles.css: from 1000 px the full sidebar with the list and
// its detail side by side; from 800 px the compact (icon) sidebar, still
// side by side; from 700 px (the minimum window) a top view switcher and ONE
// pane at a time. This module keeps the single-pane form in step with the
// state: it marks the panes that are not shown "off stage" (styles.css hides
// them only in the single-pane form, with visibility, so their scroll
// offsets survive), and when a window resize hides the focused element it
// moves keyboard focus to a visible control, in both directions: into the
// shown pane when the window enters the single-pane form, onto the control
// that takes a hidden single-pane control's place when it leaves it. The
// panes that drill in (the destination picker, the AP details, a group's or
// a network's detail) each have a Back button shown only in that form;
// their open/close logic lives with each pane (destination-pane.ts,
// ap-details.ts, groups-view.ts, networks-view.ts). Pure pane choice:
// view-state.ts.
// ============================================================================

import {
  apDetailsPanel,
  apDetailsBackBtn,
  apFilterInput,
  apList,
  apPanel,
  closeApDetailsBtn,
  destinationBackBtn,
  destinationPanel,
  destinationSearchInput,
  groupDetailBackBtn,
  groupDetailPanel,
  groupList,
  groupMasterPanel,
  groupSearchInput,
  networkDetailBackBtn,
  networkDetailPanel,
  networkList,
  networkMasterPanel,
  networkSearchInput,
} from './elements';
import { tFormat } from './i18n';
import { focusMasterItem } from './inventory-ui';
import { state } from './state';
import { accessPointsPane, masterDetailPane } from './view-state';

// The single-pane form's media query; keep in sync with the
// "(max-width: 799px)" blocks of styles.css
const SINGLE_PANE_QUERY = '(max-width: 799px)';

// Class of a pane the single-pane form does not show (styles.css)
const OFFSTAGE_CLASS = 'is-offstage';

const singlePaneMedia = window.matchMedia(SINGLE_PANE_QUERY);

// The element that last lost keyboard focus to nothing because the style
// hid it, until something else gets focus. A resize that hides the focused
// element can make Chromium blur it BEFORE the media-query change event of
// that same resize is dispatched; the change handler then finds focus on
// <body> and relocates it from this element instead.
let hiddenFocusLoss: HTMLElement | null = null;

/**
 * Tells whether the window is in the single-pane form (700–799 px).
 * @returns {boolean} True below 800 px.
 */
export function isSinglePane(): boolean {
  return singlePaneMedia.matches;
}

/**
 * Marks which panes of the three views are off stage in the single-pane
 * form, from the state: the Access points view shows the AP details while
 * open, else the destination picker when it was opened, else the list; the
 * AP groups and Wi-Fi networks views show the detail once an item was
 * picked (and is still selected), else the list. The wider forms ignore the
 * marks. Called after every change of those states.
 */
export function applyPaneLayout(): void {
  const apPane = accessPointsPane(state.apDetailsMac !== null, state.destinationPaneOpen);
  apPanel.classList.toggle(OFFSTAGE_CLASS, apPane !== 'list');
  destinationPanel.classList.toggle(OFFSTAGE_CLASS, apPane !== 'destination');
  apDetailsPanel.classList.toggle(OFFSTAGE_CLASS, apPane !== 'details');

  const groupPane = masterDetailPane(state.groupDetailOpen, state.selectedGroupId !== null);
  groupMasterPanel.classList.toggle(OFFSTAGE_CLASS, groupPane !== 'list');
  groupDetailPanel.classList.toggle(OFFSTAGE_CLASS, groupPane !== 'detail');

  const networkPane = masterDetailPane(state.networkDetailOpen, state.selectedNetworkName !== null);
  networkMasterPanel.classList.toggle(OFFSTAGE_CLASS, networkPane !== 'list');
  networkDetailPanel.classList.toggle(OFFSTAGE_CLASS, networkPane !== 'detail');
} // End of function applyPaneLayout()

/**
 * Moves keyboard focus into the pane the current view shows: a drill-in
 * pane's Back button, else the list's search field.
 */
function focusShownPane(): void {
  let target: HTMLElement;
  if (state.currentView === 'groups') {
    target = groupMasterPanel.classList.contains(OFFSTAGE_CLASS) ? groupDetailBackBtn : groupSearchInput;
  } else if (state.currentView === 'networks') {
    target = networkMasterPanel.classList.contains(OFFSTAGE_CLASS) ? networkDetailBackBtn : networkSearchInput;
  } else if (!apDetailsPanel.classList.contains(OFFSTAGE_CLASS)) {
    target = apDetailsBackBtn;
  } else if (!destinationPanel.classList.contains(OFFSTAGE_CLASS)) {
    target = destinationBackBtn;
  } else {
    target = apFilterInput;
  }
  target.focus({ preventScroll: true });
} // End of function focusShownPane()

/**
 * Moves keyboard focus, once the window has left the single-pane form, from
 * a control only that form shows to the visible control that takes its
 * place in the same pane: a group's or a network's detail Back → the
 * selected item of its list (where that Back leads), else the list's
 * search; the AP details' Back → "Close details" (the wider forms' way out
 * of that pane); the destination picker's Back → its search field; "Choose
 * destination" → the AP list's Tab stop, else the AP search field.
 * @param {HTMLElement} active - The focused element the wider form hides.
 */
function focusWidePaneControl(active: HTMLElement): void {
  if (groupDetailPanel.contains(active) || networkDetailPanel.contains(active)) {
    const inGroups = groupDetailPanel.contains(active);
    const list = inGroups ? groupList : networkList;
    const item = list.querySelector<HTMLButtonElement>('.master-item[aria-current="true"]');
    if (item) {
      focusMasterItem(list, item);
    } else {
      (inGroups ? groupSearchInput : networkSearchInput).focus({ preventScroll: true });
    }
    return;
  }
  let target: HTMLElement;
  if (apDetailsPanel.contains(active)) {
    target = closeApDetailsBtn;
  } else if (destinationPanel.contains(active)) {
    target = destinationSearchInput;
  } else {
    target = apList.querySelector<HTMLElement>('.ap-checkbox[tabindex="0"]') ?? apFilterInput;
  }
  target.focus({ preventScroll: true });
} // End of function focusWidePaneControl()

/**
 * Tells whether the current form hides an element from the user: it has no
 * boxes (display:none — the single-pane controls from 800 px on, "Close
 * details" below 800 px), or it sits in a pane the single-pane form puts
 * off stage (hidden with visibility, so it keeps its boxes).
 * @param {HTMLElement} element - The element.
 * @returns {boolean} True when the element is not shown.
 */
function isHiddenByLayout(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) return true;
  return isSinglePane() && element.closest(`.${OFFSTAGE_CLASS}`) !== null;
}

/**
 * Focusout listener (capture, on the document): remembers an element that
 * lost focus to nothing because it is hidden now (see hiddenFocusLoss); any
 * other focus loss forgets it.
 * @param {FocusEvent} e - The focusout event.
 */
function trackHiddenFocusLoss(e: FocusEvent): void {
  const target = e.target;
  hiddenFocusLoss = e.relatedTarget === null && target instanceof HTMLElement && target.isConnected && isHiddenByLayout(target) ? target : null;
}

/**
 * Focusin listener (capture, on the document): focus is somewhere again,
 * so no earlier loss is pending.
 */
function forgetHiddenFocusLoss(): void {
  hiddenFocusLoss = null;
}

/**
 * Reacts to the window crossing into or out of the single-pane form: when
 * the focused element ends up hidden, or focus already fell to <body>
 * because the resize hid it (Chromium may blur it before this event),
 * focus moves to a visible control — into the shown pane when entering the
 * single-pane form (from a pane no longer shown, or from "Close details",
 * which that form replaces with the Back), onto the control that takes a
 * single-pane control's place when leaving it (from a drill-in Back or
 * "Choose destination").
 */
function handleLayoutChange(): void {
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && active !== document.body ? active : null;
  const lost = focused === null ? hiddenFocusLoss : null;
  hiddenFocusLoss = null;
  const hidden = focused ?? lost;
  if (hidden === null || !hidden.isConnected || !isHiddenByLayout(hidden)) return;
  if (isSinglePane()) {
    focusShownPane();
  } else {
    focusWidePaneControl(hidden);
  }
} // End of function handleLayoutChange()

/**
 * Writes the text of a drill-in pane's Back button: the list it returns to,
 * visibly ("← AP groups") and as its accessible name ("Back to AP groups").
 * @param {HTMLButtonElement} button - The Back button.
 * @param {string} listName - The name of the list it returns to.
 */
export function setDrillBackLabel(button: HTMLButtonElement, listName: string): void {
  const label = button.querySelector('.drill-back-label');
  if (label) label.textContent = listName;
  button.setAttribute('aria-label', tFormat('backTo', { target: listName }));
}

/**
 * Applies the pane marks once and starts following the window width.
 * Called once at startup (renderer.ts).
 */
export function installResponsiveLayout(): void {
  applyPaneLayout();
  singlePaneMedia.addEventListener('change', handleLayoutChange);
  document.addEventListener('focusout', trackHiddenFocusLoss, true);
  document.addEventListener('focusin', forgetHiddenFocusLoss, true);
}
