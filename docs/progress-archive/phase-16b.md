# Phase 16b — AP group management UI (2026-10-07)

- **Plan item:** `todo.md` 4.9, second half (16a = main-side operations + IPC, 16b = UI + smoke).
- **Risk:** high. **Workers:** opus (phase), opus (review fixes). Orchestrator: `/autoclaude-opus`, driven mode.
- **Detailed "how" paragraph:** `todo.md` 4.9, "Done (16b)".

## Acceptance criteria (all met)

| Criterion | Evidence |
|---|---|
| New group / Rename / Delete only when management is on; banner explains otherwise | smoke `[groups]` launch (management on / check failing / re-check running), `[caps]` banners |
| Delete hidden for the default group, otherwise disabled with the reason (has APs / has networks / state unknown / still checking), confirmation dialog | smoke `[groups]`: no Delete on default, delete blocked when non-empty, fresh-data refusal, delete after confirmation |
| Every 16a code mapped to es + en text | `renderer-group-management.test.ts` (every `ApGroupOperationError` + `failed` has es/en text); smoke refused create shows the text |
| Client-side name rules mirror main | unit tests run `checkGroupName()` against `ap-group-policy.ts` itself |
| Non-24-hex ids get no write actions | smoke "unwritable id" check |
| Per-band capacity with the session nonce, absent = "Not reported", stale replies discarded | smoke absent capacity values, late reply of an old session discarded |
| Capacity warning badge (spec §4.4) | smoke badge in es and en; unit `fullCapacityBands()` incl. absent values |
| Move access points here → phase-13 review dialog over the internal API | smoke Move here → review → move |
| Reload after every write; focus restored | smoke create / rename / delete focus checks |
| < 800 px single pane, no overflow at 700×500 | smoke 700×500 check |
| `npm run build`, `npm test`, smoke, TLS probe exit 0 | see Verification |

## What was built

- **`group-management.ts`** (pure): `isGroupManagementOn()`, `deleteBlocks()` (null = hidden for the default group; otherwise the blocking reasons, failing closed), `checkGroupName()` (trim, 1–128 UTF-16 units, no control / bidi, NFC + case-insensitive duplicates, unchanged rename), `fullCapacityBands()`, reply parsers (`parseManagedGroupsResult()`, `parseGroupActionResult()`), code → i18n key mapping.
- **`managed-groups.ts`**: reads `getManagedApGroups()` with the session nonce after capabilities arrive or change, after refresh / move reload and after each write; a reply for another session, nonce or an older read is discarded.
- **`group-dialog.ts`**: one static modal on the `modal-focus.ts` pattern (trap, inert background, Escape = Cancel, error line `role="alert"`, progress with disabled buttons).
- **`group-flow.ts`**: one exclusive operation (`state.isManagingApGroup`): client check → one guarded write → main's answer as text → after success reload data + capabilities + managed view, toast, focus on the new item / Rename / the list / the opener.
- **`groups-view.ts`**: New group above the list; Rename / Delete / Move access points here / Per-band capacity in the detail; Capacity warning badge in the master list.
- **Fail-closed capability checks** (review fix): `beginCapabilityCheck()` in `management.ts` over the pure `startCapabilityCheck()` / `settleCapabilityCheck()` in `management-form.ts`, run numbering in `state.managementCheck`; triggered by "Test management access" and by connect / reconnect. A reply without capabilities = `probeFailed`. A group dialog submitted while management is off sends nothing.
- 58 i18n keys (es/en). README updated.

## Decisions

- **Move access points here** opens Access points with the group pre-checked as the phase-13 destination (no separate AP picker): reuses the existing review / confirm flow, internal API only, shown even without management.
- **Capacity warning** = at least one band REPORTED at 0 remaining; absent values never count; shown only while management is on and the fresh view was read.
- **Capabilities cleared at connect start** too (fix worker's extension of the review fix): main drops the Open API session there as well.

## Review

- Codex, `docs/reviews/phase16b.md`, **ship-with-fixes**, 0 blockers, 2 should-fixes:
  1. Capability re-checks did not fail closed (`management.ts`): write actions stayed visible during / after an unsuccessful re-check → fixed (see above), smoke checks fail on revert.
  2. Capacity warning badge missing from the master list (`groups-view.ts`) → implemented, unit + smoke checks fail on revert.
- Plus a known spec deviation from the first worker: Delete for the default group was disabled instead of hidden (spec §4.4) → now hidden; three smoke assertions fail on revert.
- All three fixed by one opus worker; the orchestrator re-ran build, tests, smoke and probe.

## Smoke checks adapted (spec changed what they assert)

- 14a "no edit controls" probe now expects exactly the "Mover puntos de acceso aquí" button.
- The `[caps]` bridge check skips the managed-list reads the renderer now makes on its own.
- Three 16b assertions changed from "default Delete disabled" to "no Delete on default" in the fix round.

## Verification (orchestrator, after the fixes)

- `npm run build` — exit 0
- `npm test` — exit 0, 675/675 (16a: 638)
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — exit 0, 166/166 (6th launch `[groups]`; `EXPECTED_LAUNCHES` 5 → 6)
- `ELECTRON_PATH=… npm run tls-probe` — exit 0, 25/25
- `rg -n innerHTML src/renderer` — none; compiled preload requires only `electron`; `fd -H "conflicted copy"` — none.

## Leftovers / for the phase 20 live checklist

- Whether a newly created group appears in the internal `setting/wlans` list right after the reload.
- Whether `remainingBinding` has an MLO key (the MLO row never shows a remaining value; 16a DTO has no MLO field).
- After a write, main does not re-run its AP-group id comparison (`apGroupsMismatch`) check.
- The dialog-guard smoke check opens Settings over the group dialog by script (no normal UI path reaches that state after the fix).
