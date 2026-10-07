# Phase I-1b2a — the renderer honors `ssidListUnknown` (2026-10-07)

- **Plan:** inbox item I-1 part B, second half, first slice (spec `autoclaude/processed/10-tplink-cloud-controllers.md`; plan record `todo.md` §5, "Done (I-1b2a)" holds the full "how"). I-1b2 was split into I-1b2a / I-1b2b before starting.
- **Risk:** high. **Workers:** opus (phase); the same opus worker, resumed, for the review fix.
- **Run:** `/autoclaude-opus`, driven, one iteration.

## What was built

- **Why:** the I-1b1 cloud mapper emits `ssidList: []` + `ssidListUnknown: true` when the cloud API does not report a group's SSID names, and the renderer read that as "no networks". Fixing the consumers makes the cloud session installable in I-1b2b.
- **One predicate:** `hasUnknownNetworks()` (`move-plan.ts`); `networkNames()` returns `[]` for a flagged group so a stray name in a flagged list is never used.
- **Moves:** `planMove()` puts every AP whose source or destination list is unknown in the optional `unreportedSourceCount` (out of the diff) and flags an unknown destination with `destinationNetworksUnknown`; the preview and review keep the known APs' diff and add "Network change unknown for N APs" (`unreportedSourcesNote()` in `move-text.ts`). An unknown destination reads "Networks unknown", never the empty-group warning, and is never under "Silence".
- **Counts:** a single group reads "Networks unknown" (group row and detail, AP row via `networkCountFor()` → `'unknown'`, AP details, destination option). A count combining known and unknown groups is a **lower bound** ("at least N", unknown when N is 0), following `networkScopeKind()`: sidebar total (`distinctSsidCountKind()`, badge "N+" or hidden), each network's scope ("at least N groups", AP count lower bound, "Not included" notes in the detail).
- **Search:** an unknown group matches destination search by its own name only.
- **Delete rule:** `DeleteInput.networkCount` accepts `null`; it never blocks alone (the fresh controller list decides).
- **Review fix:** the internal Wi-Fi networks list now shows "Wi-Fi networks unknown: …" instead of "No Wi-Fi networks available" when no group's list is known, and "Showing N of at least M" while searching a lower-bound inventory; the choice is the pure `networkListKeys()` in `ap-selection.ts`.
- 18 new es / en keys. Optional fields are absent without the flag, so local results are byte-identical. Main, IPC, the cloud mapper, the managed-network list and "Broadcast on" (bound group ids, not `ssidList`) are untouched.

## Acceptance

| Criterion | Met | Evidence |
|---|---|---|
| `npm run build` exits 0 | yes | after the phase and after the review fix (orchestrator) |
| `npm test` exits 0, above 1156, unknown / mixed / flag-absent cases | yes | 1180/1180 after the phase; 1184/1184 after the fix (`renderer-{move-plan,inventory-model,ap-selection,group-management}.test.ts`) |
| `npm run smoke` 271/271 with no smoke edits | yes | 271/271, both times (orchestrator) |
| No consumer reads a flagged group as "0 networks", an empty reach diff or an exact count | yes | worker survey of `rg ssidList src/renderer`; Codex review found only the networks-view empty / summary states, fixed |
| No conflicted copies | yes | `fd -H "conflicted copy"` empty |
| No controller / `tplinkcloud.com` contact (D4) | yes | renderer-only change, unit tests and stubbed smoke |

## Review

- Codex, `docs/reviews/phaseI-1b2a.md`, **ship-with-fixes** (0 blockers, 1 should-fix).
- **Should-fix** `networks-view.ts` `renderInternalNetworkList()` — an all-unknown inventory rendered "No Wi-Fi networks available" and the search summary presented the known-only total as exact. **Fixed** as above, with 4 unit tests (all-unknown, mixed, flag-absent, es / en placeholder parity).

## Leftovers (none blocking)

- The new DOM text for the unknown states is exercised by unit tests only: local data never sets the flag, so the smoke cannot reach it until the cloud session is wired (I-1b2b) and a `[cloud]` smoke launch exists (I-1c).
- A network that only an unknown group might broadcast is not listed (it is not known to exist).
- An AP in a shared-name group reads "Networks unknown" if either same-named group is unknown.
