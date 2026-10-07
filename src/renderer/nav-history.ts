// ============================================================================
// Cross-navigation history: pure helpers (docs/management-design.md §4.2,
// "clicking a group or network name anywhere switches view, selects it, and
// offers ← Back to <previous item>")
// ============================================================================
//
// Pure (no DOM, no renderer state, no i18n): navigation.ts applies these
// locations to the views, and the unit tests import this module directly
// (tests/unit/renderer-nav-history.test.ts). A location is everything needed
// to bring a view back the way it was left: the view, the item it showed
// (the AP whose details were open, the selected group, the selected network),
// the view's own search, the scroll offsets of its list and detail panes, and
// the cross-link that was followed from it (focus returns there on Back).
// After every data load the history is reconciled with the loaded items
// (reconcileHistory()), so Back never offers an item a refresh removed.

// The three views of the app shell; the Access points view is the landing view
export type AppView = 'accessPoints' | 'groups' | 'networks';

// What a cross-link points at: an access point (by MAC), a group (by id) or a
// Wi-Fi network (by name: the internal API identifies networks only by name)
export type LinkKind = 'ap' | 'group' | 'network';

/**
 * The target of one cross-link.
 */
export interface LinkTarget {
  kind: LinkKind;
  target: string;
}

/**
 * One place the user can go back to.
 */
export interface NavLocation {
  view: AppView;
  // The item the view showed: the MAC of the AP whose details pane was open
  // (accessPoints), the selected group id (groups) or the selected network
  // name (networks); null when none was
  item: string | null;
  // The item's display name when the location was left (shown as "Back to
  // <name>"); null when no item was shown (the view's name is used instead)
  itemLabel: string | null;
  // The view's own search text ('' for the Access points view, whose filters
  // a cross-link never changes)
  search: string;
  // Scroll offsets of the view's list and detail panes
  listScroll: number;
  detailScroll: number;
  // The cross-link followed from this location, or null
  focusLink: LinkTarget | null;
}

// Most locations the Back history keeps (the oldest are dropped first)
export const MAX_HISTORY = 50;

/**
 * Tells whether a value names a link kind.
 * @param {unknown} value - Candidate kind (e.g. a data-link-kind value).
 * @returns {value is LinkKind} True for 'ap', 'group' or 'network'.
 */
export function isLinkKind(value: unknown): value is LinkKind {
  return value === 'ap' || value === 'group' || value === 'network';
}

/**
 * Returns the view a cross-link opens: an AP opens the Access points view
 * (with its details pane), a group the AP groups view, a network the Wi-Fi
 * networks view.
 * @param {LinkKind} kind - The link kind.
 * @returns {AppView} The view.
 */
export function viewForLink(kind: LinkKind): AppView {
  if (kind === 'ap') return 'accessPoints';
  if (kind === 'group') return 'groups';
  return 'networks';
}

/**
 * Tells whether following a link would land where the user already is (the
 * same view showing the same item): such a link does not add a history entry.
 * @param {NavLocation} current - The current location.
 * @param {LinkTarget} link - The link.
 * @returns {boolean} True when the link points at the current location.
 */
export function isCurrentLocation(current: NavLocation, link: LinkTarget): boolean {
  return current.view === viewForLink(link.kind) && current.item === link.target;
}

/**
 * Returns the history with one more location on top, keeping at most `max`
 * entries (the oldest are dropped).
 * @param {readonly NavLocation[]} history - The history, oldest first.
 * @param {NavLocation} location - The location to push.
 * @param {number} [max] - The cap (MAX_HISTORY by default; at least 1).
 * @returns {NavLocation[]} The new history.
 */
export function pushLocation(history: readonly NavLocation[], location: NavLocation, max: number = MAX_HISTORY): NavLocation[] {
  const next = [...history, location];
  const cap = Math.max(1, Math.floor(max));
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Takes the most recent location off the history.
 * @param {readonly NavLocation[]} history - The history, oldest first.
 * @returns {{ location: NavLocation | null; history: NavLocation[] }} The
 *   location to go back to (null when the history is empty) and the rest.
 */
export function popLocation(history: readonly NavLocation[]): { location: NavLocation | null; history: NavLocation[] } {
  if (history.length === 0) {
    return { location: null, history: [] };
  }
  return { location: history[history.length - 1], history: history.slice(0, -1) };
}

/**
 * A place in the app: a view and the item it shows (null for none).
 */
export type NavPlace = Pick<NavLocation, 'view' | 'item'>;

/**
 * Tells whether two places are the same view showing the same item.
 * @param {NavPlace} a - One place.
 * @param {NavPlace} b - The other place.
 * @returns {boolean} True when they are the same.
 */
function samePlace(a: NavPlace, b: NavPlace): boolean {
  return a.view === b.view && a.item === b.item;
}

/**
 * Reconciles the Back history with newly loaded data, so that "Back to
 * <name>" never promises an item the data no longer has and never leads
 * nowhere:
 * 1. a location whose item is gone is dropped (Back skips it); the label of
 *    an item still loaded is refreshed (it may have been renamed); a
 *    location without an item is kept as it is;
 * 2. consecutive locations at the same place (left next to each other once
 *    a location between them was dropped) collapse into the most recent;
 * 3. locations on top that are the current place are dropped.
 * @param {readonly NavLocation[]} history - The history, oldest first.
 * @param {(view: AppView, item: string) => string | null} labelFor - The
 *   item's current display name, or null when it is no longer loaded.
 * @param {NavPlace | null} current - Where the user is now (after the views
 *   dropped their own gone selections), or null to skip step 3.
 * @returns {NavLocation[]} The new history (the input is never mutated).
 */
export function reconcileHistory(
  history: readonly NavLocation[],
  labelFor: (view: AppView, item: string) => string | null,
  current: NavPlace | null,
): NavLocation[] {
  const next: NavLocation[] = [];
  for (const location of history) {
    let kept = location;
    if (location.item !== null) {
      const label = labelFor(location.view, location.item);
      if (label === null) continue;
      kept = label === location.itemLabel ? location : { ...location, itemLabel: label };
    }
    const previous = next[next.length - 1];
    if (previous !== undefined && samePlace(previous, kept)) {
      next[next.length - 1] = kept;
    } else {
      next.push(kept);
    }
  } // End of the loop that keeps the locations still loaded
  while (current !== null && next.length > 0 && samePlace(next[next.length - 1], current)) {
    next.pop();
  }
  return next;
} // End of function reconcileHistory()

/**
 * Sanitizes a scroll offset read from the DOM (a negative or non-finite
 * value becomes 0).
 * @param {number} value - The offset.
 * @returns {number} A finite, non-negative offset.
 */
export function sanitizeScroll(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
