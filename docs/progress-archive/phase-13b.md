# Phase 13b — destination pane, review dialog, sequential bulk move (2026-10-07)

- **Plan item:** `todo.md` 4.6, second half (13a was the shell and the Access points list).
- **Risk:** high. **Workers:** opus (phase), opus (review fixes). Run under `/autoclaude-opus`.

## What was built

- Phase 13a's right-hand group panel (`wlan-list.ts`, a `role="listbox"`), its footer "Apply change"
  bar and the confirm modal (`confirm-modal.ts`, `apply-change.ts`) are gone, with their markup and
  i18n keys. Nothing else used the confirm modal.
- **Destination pane** (`destination-pane.ts`): always visible, one native radio per group, search over
  group names and SSID names; empty groups pinned under "Silence" / "Silenciar" with the §4.1 label;
  legacy controllers keep `tGroup()` wording.
- **Pure move logic** (`move-plan.ts`, DOM- and Electron-free, `tests/unit/renderer-move-plan.test.ts`):
  networks gained / lost / unchanged for the checkbox selection (filter-hidden APs included and
  stated), "N already in this group; M will move", no-op detection, the move plan (APs already in
  the destination are never PATCHed), result aggregation, and `checkRetry()`. `move-text.ts` holds the
  text builders; `ap-filters.ts` was split out of the list code.
- Button labels "Move AP" / "Move N APs" (es "Mover AP" / "Mover N AP"); disabled for no selection,
  no destination or a no-op.
- **One dialog** (`move-dialog.ts`): review → progress → per-AP results. The review opens focused on
  Cancel, with `aria-describedby`, the `modal-focus.ts` trap, background `inert`, Escape = Cancel and
  opener-focus restore. It shows source group(s) → destination, networks gained/lost/unchanged, the
  number of APs moving, clients on them (sum of optional `clientNum`, missing values stated), and says
  that per-AP SSID overrides cannot be shown from the internal API.
- **Sequential bulk move** (`move-flow.ts`): one `OMADA_SET_WLAN` (`PATCH eaps/{mac}`) at a time, not
  atomic (stated in the UI); per-AP results with the controller's message; failed APs stay selected;
  "Retry failed" re-runs only them through the same review. The `sessionGeneration` /
  `invalidateSession()` / `isOperationInProgress()` guards are kept. No new IPC channel; the smoke stub
  gained a `setWlanErrors` setting so a chosen AP's move fails with a message.
- Enter on a destination radio makes that radio's group the destination, refreshes the preview and
  opens the review (still focused on Cancel); it does nothing on a disabled radio or a no-op.
- APs with no group, or in a group whose name another group shares, report "current networks unknown".

## Review

- Codex, `docs/reviews/phase13b.md`: **ship-with-fixes**, 1 blocker + 2 should-fix, all fixed by an
  opus worker before the commit:
  - **Blocker — duplicate group names.** AP records carry only the group *name*, so a destination whose
    name another group shares made no-op detection and the preview unverifiable. Such a group is now
    *ambiguous*: its radio is shown disabled with a reason ("rename one in Omada to move APs here",
    es + en), `planMove()` refuses it, and a reload drops it if it was checked. APs in an ambiguous
    group can still move to a unique destination.
  - **Should-fix — Retry failed after reload.** The failed MACs and destination id are kept as the
    retry contract and re-checked after the post-move reload by the pure `checkRetry()`: vanished APs
    (or ones already in the destination) are stated and skipped; a gone or now-ambiguous destination,
    or no AP left, hides Retry with a note saying why.
  - **Should-fix — Enter on a radio** acted on the state's destination instead of the focused radio
    (e.g. when the checked one was hidden by the search). Fixed as described above, with a smoke case.

## Verification (orchestrator, after the review fixes)

- `npm run build` — exit 0
- `npm test` — 398/398, fail 0 (357 before the phase)
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 92/92 (83 before)
- `ELECTRON_PATH=… npm run tls-probe` — 21/21
- `rg -n "innerHTML|insertAdjacentHTML|\.style\." src/renderer` — empty; no references to the deleted
  modules; `dist/main/preload.js` requires only `electron`.
- Smoke covers: single move through the review; bulk all-succeed, partial failure → results → Retry
  failed, and cancel (no PATCH); destination search by SSID name; the Silence section; the no-op and
  mixed-selection cases; a keyboard-only move; Cancel as initial focus; a disabled same-named group;
  Enter on a focused radio while the checked destination is filtered out.

## Notes

- Dropbox produced conflicted copies of several files during both worker runs (and of `README.md`
  after the fix run); each time the newest complete version was kept and the stale copies deleted.
- The results dialog also appears when every AP moved, so a successful single move needs one Close.
- A failed AP that the reload shows already in the destination is counted and not retried.
