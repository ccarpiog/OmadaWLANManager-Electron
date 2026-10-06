// ============================================================================
// Moving access points: the localized texts of a move plan, shared by the
// destination pane's preview (destination-pane.ts) and the review dialog
// (move-dialog.ts), so both always word the same facts the same way.
// ============================================================================

import { t, tFormat } from './i18n';
import type { MovePlan, NetworkChange, RetryCheck } from './move-plan';

// How many network names a group's preview lists before "+N more"
const MAX_PREVIEW_NETWORKS = 3;

/**
 * The move button's label: "Move AP" / "Move N APs" (§4.1), or the neutral
 * "Move APs" while nothing would move.
 * @param {number} count - How many APs the move would PATCH.
 * @returns {string} The localized label.
 */
export function moveActionLabel(count: number): string {
  if (count === 0) return t('moveNone');
  if (count === 1) return t('moveOne');
  return tFormat('moveMany', { count: String(count) });
}

/**
 * "1 AP" / "N APs".
 * @param {number} count - The number of APs.
 * @returns {string} The localized count.
 */
export function apCountText(count: number): string {
  return count === 1 ? t('apCountOne') : tFormat('apCountMany', { count: String(count) });
}

/**
 * A group's network count: "No networks", "1 network", "N networks".
 * @param {number} count - The number of networks.
 * @returns {string} The localized count.
 */
export function networkCountText(count: number): string {
  if (count === 0) return t('networkCountNone');
  return count === 1 ? t('networkCountOne') : tFormat('networkCountMany', { count: String(count) });
}

/**
 * A destination option's details: the network count and the first network
 * names ("5 networks · Oficina, Taller, Almacén +2 more"), or the strong
 * empty-group label for a group without networks.
 * @param {readonly string[]} names - The group's network names, already in
 *   preview order (search matches first).
 * @returns {string} The localized details.
 */
export function destinationDetailText(names: readonly string[]): string {
  if (names.length === 0) {
    return t('emptyGroup');
  }
  const shown = names.slice(0, MAX_PREVIEW_NETWORKS).join(', ');
  const rest = names.length - MAX_PREVIEW_NETWORKS;
  return `${networkCountText(names.length)} · ${rest > 0 ? `${shown} +${rest} ${t('more')}` : shown}`;
} // End of function destinationDetailText()

/**
 * The names of gained or lost networks, each annotated "(n of N)" when it
 * applies to only some of the moving APs with a known group; "None" when
 * the list is empty.
 * @param {readonly NetworkChange[]} changes - The gained or lost networks.
 * @param {number} knownCount - Moving APs whose current group is known.
 * @returns {string} The localized list.
 */
export function networkChangeList(changes: readonly NetworkChange[], knownCount: number): string {
  if (changes.length === 0) {
    return t('noneValue');
  }
  return changes
    .map(change => (change.apCount < knownCount
      ? tFormat('networkPartial', { name: change.name, count: String(change.apCount), total: String(knownCount) })
      : change.name))
    .join(', ');
} // End of function networkChangeList()

/**
 * One row of the networks diff: its label and value, e.g. "Gains" and
 * "+2 · Casa, Invitados" (gained "+N", lost "−N", unchanged "N"; "None"
 * when empty).
 */
export interface NetworkDiffRow {
  kind: 'gained' | 'lost' | 'unchanged';
  label: string;
  value: string;
}

/**
 * The three networks-diff rows of a plan. Only meaningful when at least one
 * moving AP has a known current group (otherwise nothing can be compared and
 * the caller shows the unknown-networks note instead).
 * @param {MovePlan} plan - The move plan.
 * @returns {NetworkDiffRow[]} Gains, loses, unchanged.
 */
export function networkDiffRows(plan: MovePlan): NetworkDiffRow[] {
  const { gained, lost, unchanged } = plan.networks;
  const known = plan.knownSourceCount;
  return [
    { kind: 'gained', label: t('networksGained'), value: gained.length === 0 ? t('noneValue') : `+${gained.length} · ${networkChangeList(gained, known)}` },
    { kind: 'lost', label: t('networksLost'), value: lost.length === 0 ? t('noneValue') : `−${lost.length} · ${networkChangeList(lost, known)}` },
    { kind: 'unchanged', label: t('networksUnchanged'), value: unchanged.length === 0 ? t('noneValue') : `${unchanged.length} · ${unchanged.join(', ')}` },
  ];
} // End of function networkDiffRows()

/**
 * The status line for a selection and a destination: "N will move", or for
 * a mixed selection "12 already in this group; 4 will move", or when every
 * selected AP is in the destination already, that no AP will move; for an
 * ambiguous destination (refused by the plan), why it cannot be used.
 * @param {MovePlan} plan - The move plan.
 * @returns {string} The localized status.
 */
export function moveStatusText(plan: MovePlan): string {
  if (plan.ambiguousDestination) {
    return t('destinationAmbiguous');
  }
  const already = plan.alreadyThere.length;
  const moving = plan.moving.length;
  if (moving === 0) {
    return already === 1 ? t('allAlreadyInGroupOne') : tFormat('allAlreadyInGroupMany', { count: String(already) });
  }
  const willMove = moving === 1 ? t('willMoveOne') : tFormat('willMoveMany', { count: String(moving) });
  if (already === 0) {
    return willMove;
  }
  const alreadyText = already === 1 ? t('alreadyInGroupOne') : tFormat('alreadyInGroupMany', { count: String(already) });
  return `${alreadyText}; ${willMove}`;
} // End of function moveStatusText()

/**
 * "Includes N APs hidden by filters", or null when none is hidden.
 * @param {number} hidden - Moving APs the filters hide.
 * @returns {string | null} The localized note.
 */
export function hiddenApsNote(hidden: number): string | null {
  if (hidden === 0) return null;
  return hidden === 1 ? t('includesHiddenOne') : tFormat('includesHiddenMany', { count: String(hidden) });
}

/**
 * The note for moving APs whose current networks are unknown, or null.
 * @param {number} count - Moving APs with an unknown current group.
 * @returns {string | null} The localized note.
 */
export function unknownSourcesNote(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? t('unknownSourcesOne') : tFormat('unknownSourcesMany', { count: String(count) });
}

/**
 * The current groups of the moving APs with their counts, e.g.
 * "zGrupo B (1 AP) · Default (2 APs)" ("Unassigned" for APs without one).
 * @param {MovePlan} plan - The move plan.
 * @returns {string} The localized list.
 */
export function sourceGroupsText(plan: MovePlan): string {
  return plan.sources
    .map(source => `${source.name === '' ? t('unassigned') : source.name} (${apCountText(source.count)})`)
    .join(' · ');
}

/**
 * The clients connected to the moving APs: the sum of the counts the APs
 * report, plus how many APs report none; "Unknown" when none reports one
 * (never an invented number, and never a per-network claim).
 * @param {MovePlan} plan - The move plan.
 * @returns {string} The localized text.
 */
export function clientsText(plan: MovePlan): string {
  const { total, reporting, missing } = plan.clients;
  if (reporting === 0) {
    return t('clientsUnknown');
  }
  const base = total === 1 ? t('clientCountOne') : tFormat('clientCountMany', { count: String(total) });
  if (missing === 0) {
    return base;
  }
  return `${base} ${missing === 1 ? t('clientsMissingOne') : tFormat('clientsMissingMany', { count: String(missing) })}`;
} // End of function clientsText()

/**
 * The results' notes on "Retry failed" for a run with failed APs, from its
 * retry contract checked after the reload (checkRetry()): how many failed
 * APs the controller no longer lists, how many already report the
 * destination, then why the retry is unavailable or — when it covers fewer
 * APs than failed — how many it retries. Empty when every failed AP is
 * retried as is.
 * @param {RetryCheck} retry - The checked retry contract.
 * @param {string} groupName - The run's destination name (as it was when
 *   the run started).
 * @returns {string[]} The localized notes, in reading order.
 */
export function retryNotes(retry: RetryCheck, groupName: string): string[] {
  const notes: string[] = [];
  const missing = retry.missingCount;
  if (missing > 0) {
    notes.push(missing === 1 ? t('retryMissingOne') : tFormat('retryMissingMany', { count: String(missing) }));
  }
  const inDestination = retry.inDestinationCount;
  if (inDestination > 0) {
    notes.push(inDestination === 1
      ? tFormat('retryInDestinationOne', { group: groupName })
      : tFormat('retryInDestinationMany', { count: String(inDestination), group: groupName }));
  }

  if (retry.blocked === 'destinationGone') {
    notes.push(tFormat('retryDestinationGone', { group: groupName }));
  } else if (retry.blocked === 'destinationAmbiguous') {
    notes.push(tFormat('retryDestinationAmbiguous', { group: groupName }));
  } else if (retry.blocked === 'nothingLeft') {
    notes.push(t('retryNothingLeft'));
  } else if (notes.length > 0) {
    // Some failed APs are left out: say what the retry still covers
    const count = retry.retryMacs.length;
    notes.push(count === 1
      ? tFormat('retryRemainingOne', { action: t('retryFailed') })
      : tFormat('retryRemainingMany', { action: t('retryFailed'), count: String(count) }));
  }
  return notes;
} // End of function retryNotes()
