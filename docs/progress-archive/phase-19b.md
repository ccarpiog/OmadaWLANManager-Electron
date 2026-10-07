# Phase 19b — "Broadcast on" editor UI (2026-10-07)

- Risk: high. Worker: opus (phase); review fix by the orchestrator (no worker). Run: `/autoclaude-opus`, driven.
- Plan item: `todo.md` 4.12, second half (now ✅). The detailed "how" and the phase 20 live checks are `todo.md` 4.12 "Done (19b)".

## What was built

- New pure, DOM-free `src/renderer/network-bindings.ts`: availability per network (`bindingAvailability()`: nothing while management is off or re-checking; "All access points" and unknown scope read-only with the reason, never converted), the freshness gate `bindingWriteBlock()` (built on the 18b gate, plus a failed AP-group list read), editor options from the managed AP-group list, search filter, `diffBindingSets()` (added / removed / kept), `planBindingChange()` (before / after reach in groups and APs, "at least" lower bounds), `clientCapacityProblems()` (ADDED groups only, every band, unreported = unknown, fail closed, every failing group + band), `checkBindingDraft()` (the only builder of a write request: the complete new set), `parseNetworkBindingsResult()` (reply at the boundary), the typed exhaustive `NetworkBindingsError` → es / en text table, capacity problem lines, the MLO note.
- New `binding-dialog.ts` (`#bindingModal`: searchable checkboxes, live preview, review step, the 18b multi-click / held-Enter guard, Escape = Cancel) and `binding-flow.ts` (one exclusive operation; data re-read before the confirmation; management re-checked before the write; main's refusal and `capacityProblems` shown back in the editor; after success, reload data + capabilities + managed list, toast with the new scope, focus back on the button).
- `managed-networks-view.ts`: a "Broadcast on" section in the network detail with "Change AP groups"; hidden while management is off or re-checking, disabled on stale data.
- Refactor: `network-dialog.ts` exports its dialog guard and summary builder; `network-flow.ts` exports `heldNetwork()` and `reloadAfterWrite()` (18b behavior unchanged, its smoke still green).
- 56 new i18n keys (es + en). No main-side change.

## Acceptance (all met)

- `npm run build` exit 0; `npm test` 1001/1001 (was 956); `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` 250/250 (was 220; new 9th launch `[bind]`, 30 checks, es + en: edit + confirm → exactly one `{op: 'bindings'}` with the complete set and the refreshed scope; cancel at every step with nothing written; main's refusal text; client and main capacity problems; All access points / unknown scope read-only; no write on stale data; hidden while management is off); `npm run tls-probe` (same `ELECTRON_PATH`) 25/25.
- `rg innerHTML src/renderer` empty; compiled preload requires only `electron`; no conflicted copies.
- The worker reverted three guards (scope rule, an unreported band read as room, accepting malformed capacity lists): each failed unit tests.

## Review

- Codex, `docs/reviews/phase19b.md`, ship-with-fixes, 0 blockers.
- Should-fix: `parseNetworkBindingsResult()` returned success for any `success: true` reply and accepted contradictory failure fields. Fixed by the orchestrator: a discriminated schema (success exactly `{success: true}`; unknown keys refused; a refusal needs a known code; `capacityInsufficient` needs a non-empty, well-formed list of at most `MAX_CAPACITY_PROBLEMS`; any other code no capacity list; anything else `failed`). New boundary tests; build, tests, smoke and probe re-run green.

## Deviations and leftovers (none blocking)

- The editor is a dialog, not an in-view edit mode, so the 14b edit-mode stub stays unused.
- For an MLO network, adding groups is refused only at Save (after the confirmation step) by main, because the renderer DTO has no MLO state; the editor shows main's reason.
- A bound group missing from the AP-group list can only be removed; the editor lists it as removed from the moment it opens.
- The editor's AP counts and reach come from internal data (APs by group name), not from the controller's `apNum`.
- The `[nets]` smoke now expects the new section on its "All access points" and unknown-scope details.
- Live checks for phase 20: listed at the end of `todo.md` 4.12 "Done (19b)".

## Not part of this phase

- `tests/smoke/window-placement.cjs` (untracked) and the edits to `tests/smoke/stub-main.cjs` and `tests/tls-probe/app-main.cjs` that load it appeared at 11:01, two minutes after the iteration started, and were not made by the worker or the orchestrator. They look like the user's own concurrent test-harness change: smoke and probe windows open on a secondary display without taking focus. They were left uncommitted and untouched. Verification ran with them in the tree; they only change window placement and focus, not what the checks test.
