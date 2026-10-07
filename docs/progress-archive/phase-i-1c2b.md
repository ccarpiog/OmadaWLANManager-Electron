# Phase I-1c2b — controller switcher UI and cloud error states (2026-10-07)

- **Risk:** high. **Workers:** opus (phase); opus (a fresh worker for the two review fixes).
- **Split:** second half of I-1c2 (split into I-1c2a / I-1c2b before I-1c2a started). Closes I-1c2. Next and last: I-1c3 (docs, routine).
- **How:** `todo.md` §5 "Done (I-1c2b)" holds the full description (where the switcher sits, its DOM and keyboard model, the busy gating, the visibility and layout choices, the switch flow and state reset, the cloud error texts, "Connect through TP-Link cloud", the startup and save follow-ups, strings, the stub knobs, tests, the review fix) and the live steps I-1c3 must add ("For I-1c3").

## Acceptance

| Criterion | Met | Evidence |
|---|---|---|
| Switcher at the top of the sidebar from `buildControllerSwitcher()`: local first as "This network", cloud entries with the "Cloud" tag, the duplicate hidden, disabled entries with their reason, a failed list shown with the local entry usable | yes | smoke `[cloud]` es + en (startup with the duplicate hidden, offline / below-6.3 entries disabled with reasons); `renderer-controller-switcher.test.ts` |
| Switcher disabled while `isSwitcherBusy(state)`, re-rendered at the start and end of every flow that sets a busy flag | yes | smoke `[cloud]` busy check during a switch; the move / group / network / binding flows re-render it |
| A choice invalidates the renderer session (generation + nonce) before `switchController()`, handles the result like `connect()`, re-reads `connectionTarget` | yes | `switchToController()` shares `runConnectionAttempt()` with `connect()`; smoke switch to "OC200 Planta 4" checks main's target |
| State reset on a switch (selection, destination, filters, searches, managed caches, details, Back history, site / controller name; skeletons) | yes | smoke `[cloud]` reset checks |
| Header shows the cloud controller's name | yes | smoke `[cloud]` header name and site |
| Cloud error states (`-7132`, offline, `-52602` → Settings → TP-Link cloud) | yes | smoke `[cloud]` three texts |
| "Connect through TP-Link cloud" only after an unreachable local connect with a fresh connectable duplicate; not after a refused login | yes | smoke `[cloud]` both cases |
| `init()` cloud-only start and the cloud-only save follow-up | yes | smoke `[cloud]` cloud-only start ("Elegir controlador", a choice, a restart on the cloud target), cloud-only save |
| Removing the cloud credential while on a cloud controller returns main's target to local atomically; a cloud-only removal lands in the first-run state with Connect disabled (review fixes) | yes | `connection-targets.test.ts` new describe; smoke `[cloud]` es + en removal checks (es plays a refused save first) |
| With no cloud credential the app behaves as before | yes | every earlier smoke launch green without edits (one en removal check updated by the review fix) |
| es / en strings for every new text | yes | four new keys, parity tests |
| `npm run build` exit 0 | yes | orchestrator, after the review fixes |
| `npm test` all pass | yes | 1358/1358 (was 1344) |
| `npm run smoke` all pass | yes | 314/314 (was 295) |
| `npm run tls-probe` all pass | yes | 29/29 |
| No conflicted copies; user's three files unchanged; no controller / `tplinkcloud.com` contact | yes | `fd -H "conflicted copy"` empty; `git diff` of the user's hunks unchanged; stub and fixtures only |

## Decisions

- **Placement:** the app has no site switcher in the sidebar (a site is picked in the site dialog on connect), so the switcher is the first child of `#viewNav`, above the views' navigation.
- **Visibility:** shown exactly while a cloud credential (Client ID + usable secret) is stored, a failed or empty list included, so the user learns why nothing can be chosen; without one the app looks as before.
- **Layout:** the panel is never in the layout flow (a dropdown over the full sidebar, a fixed popover beside the compact sidebar and below the top view switcher): an in-flow panel moved the entry being pressed when an outside press closed it (found by the smoke).
- **Cloud offer in the error state**, not a toast, so the offer stays with the error it answers; it re-reads the cloud list (fresh) before offering.
- **Startup:** new content state `chooseController` for a cloud-only configuration with no cloud target ("Elegir controlador" opens the panel).
- **Removal is main's job (review fix):** `ConnectionManager.applyConfigSave()` returns a cloud target to local in the save's own synchronous step when the save leaves no usable cloud credential (`CloudConnectionDeps.hasUsableCredential()`, fail-closed); the renderer only follows main's read-back target (`saveFollowUp()`: `'connect' | 'none'`).

## Review

- Codex, `docs/reviews/phaseI-1c2b.md`, **ship-with-fixes**, 0 blockers, 2 should-fix.
- Should-fix 1 (`src/renderer/settings-modal.ts`: cloud credential removal and the target reset were not atomic — main kept the cloud target until the renderer's later `switchController({kind: 'local'})`) → **fixed** in main as above, with unit tests (synchronous reset, in-flight lookup / site choice / connect superseded, failed save, throwing check, no cloud side, real save rules, real sessions: the old nonce refused with nothing sent).
- Should-fix 2 (`src/renderer/connection.ts`: removing the only, cloud-only, configuration re-enabled Connect) → **fixed**: `handleConnectionReset()` sets `connectBtn.disabled = !state.hasStoredConfig`; smoke es + en (the worker confirmed both checks fail with the old line).
- Build, `npm test` 1358/1358, smoke 314/314 and tls-probe 29/29 re-run by the orchestrator after the fixes.

## Leftovers (none blocking)

- I-1c3: the live checklist's switcher steps with a real account (`todo.md` §5 "For I-1c3").
- The `[cloud]` smoke plays restarts with window reloads, not process restarts (main's startup target is unit-tested in `connection-targets.test.ts`).
- Every unreachable local connect with a stored credential reads the cloud list once before offering the fallback; repeated Retry clicks could reach the `-7132` rate limit (the list's own error text shows then).
