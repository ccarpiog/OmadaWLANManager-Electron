# Phase 17b — Wi-Fi networks view on the managed source (2026-10-07)

- **Plan item:** `todo.md` 4.10, second half (phase 17 was split before 17a started; 17a = main-side read model + IPC, done in `619d18f`).
- **Risk:** routine (renderer only; the secret boundary was decided in 17a). **Workers:** opus (phase), opus (review fixes). Run under `/autoclaude-opus`.
- **Detailed "how":** `todo.md` 4.10 "Done (17b)".

## What was built

- The Wi-Fi networks view (`src/renderer/networks-view.ts`) has two sources. While management is off, or its capabilities are unknown or still being checked, it shows the 14a internal-data view, unchanged. While `networkManagementOn()` holds (pure `network-management.ts`: connected, session nonce, 6.3 group model, no read-only reason, `manageWifiNetworks`), it shows the managed list.
- `src/renderer/managed-networks.ts` reads `getManagedNetworks()` with the session nonce after the capabilities arrive or change, after a refresh, after the post-move reload and on Retry. A reply is taken only for the same session generation, nonce and latest read number (`isCurrentNetworkRead()`). `parseManagedNetworksResult()` copies each DTO by allowlist and refuses the whole reply when one network breaks the contract (`invalidReply`).
- `src/renderer/managed-networks-view.ts` renders rows (enabled state · security · bands, "unknown" stated for null) and the detail (password Set / None / Unknown, never a key; bound groups and their APs as cross-links; the all-APs or unknown-scope note). Scope is "All access points", "N groups · M APs" (with a lower bound and its reasons when an AP's group or a bound id cannot be resolved) or "Unknown scope", never guessed.
- Networks are identified by id; cross-links and Back carry typed keys (`NetworkKey`, `{kind: 'id' | 'name', value}`), each resolved only in its own namespace. A name shared by several networks selects none (the view opens searched for that name). The sidebar count is the managed total while the managed list is shown.
- 33 i18n keys (es/en). `createFact()` moved to `inventory-ui.ts`; the APs section is shared by both sources. No main-side change and no new IPC channel.

## Decisions

- **Error state:** a failed, incomplete or malformed **first** read shows the §4.6 persistent error (`role="alert"`, the code's text + main's codes-only diagnostic) with Retry and Settings — never a partial list and no fallback to the internal view (it lacks the managed fields).
- **Failed re-read (review fix 1):** keeps the last good list of the same session on screen, whole, marked stale with a networks-view refresh-error notice (`#networksStaleNotice`: time of the list, amber dot, reason, Retry) until a later read succeeds (pure `settleNetworkRead()`). A list of another session/nonce is never kept; disconnect, management off and a check run still forget it. This is what §4.6 asks for refresh errors; the worker first chose to fail closed and the review overruled it.
- **Back history across a capability re-check (review fix 3):** the temporary 14a fallback during a re-check is not a settled source (`networksSourceSettled()`), so managed Back entries survive a re-check that passes. Once management is definitively off, managed id entries are dropped (the 14a view cannot show a network by id).
- `readOnlyReason()` returns no reason for a null group model, so the management check requires the 6.3 group model explicitly (found by the new unit tests).
- The invalid-reply message now reads "…not valid: none of it is shown." / "…no se muestra nada de ella." (the old "nothing is shown" contradicted the stale notice).

## Verification

- Phase worker: `npm run build` 0; `npm test` 759/759; smoke 180/180 (7th launch `[nets]`, 13 checks, `EXPECTED_LAUNCHES` 6 → 7); `npm run tls-probe` 25/25. Stale-reply revert check: the two `[nets]` stale-reply checks fail when the check is disabled.
- Review-fix worker: `npm test` 774/774; smoke 182/182; tls-probe 25/25. Each fix has unit tests that fail on revert (1 / 4 / 1); a smoke run with fixes 1 and 3 reverted failed exactly the 3 new checks.
- Orchestrator re-run after the fixes: `npm run build` exit 0; `npm test` exit 0, 774/774; `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` exit 0, 182/182; `npm run tls-probe` (same `ELECTRON_PATH`) exit 0, 25/25; no `innerHTML` in `src/renderer`; compiled preload requires only `electron`; no conflicted copies.
- Adapted smoke checks: three existing `[nets]` error-state checks (es error state, "never a partial list", the en check) reach the error through "Test management access" (a fresh first read), since a refresh after a good read now shows the stale notice.

## Review

- Codex, `docs/reviews/phase17b.md`, ship-with-fixes, 0 blockers, 3 should-fixes: (1) a failed refresh discarded the last good managed list → kept and marked stale; (2) an untyped pending key could resolve a name as another network's id → typed `NetworkKey`; (3) a capability re-check permanently deleted managed Back history → the re-check fallback is unsettled. All fixed by an opus worker with tests that fail on revert.

## Leftovers (none blocking)

- The stale notice sits above the views beside the existing refresh notice (inside the networks view it broke two control-counting smoke checks).
- A cross-link from a group to a network carries a name; when two managed networks share it, the view opens searched for the name instead of a detail.
- Phase 17a's leftovers still apply, notably: if the real controller errors on the bindings call for "All access points" networks, the whole managed read fails and the view shows the error state — phase 20 checks that first (`docs/progress-archive/phase-17a.md`).
