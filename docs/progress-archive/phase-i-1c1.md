# Phase I-1c1 — Settings "TP-Link cloud (optional)" section (2026-10-07)

- **Risk:** high. **Worker:** opus (phase); the review fix was made by the orchestrator (under 10 source lines plus one smoke check).
- **Split:** I-1c was split into I-1c1 / I-1c2 / I-1c3 before starting (recorded in `todo.md` §5 "I-1c").
- **How:** `todo.md` §5 "Done (I-1c1)" holds the full description (section layout, pure `src/renderer/cloud-form.ts`, DOM module `src/renderer/cloud-settings.ts`, save path, staged Remove, Test cloud access outcomes, stale-result guard, smoke stub, tests, notes for I-1c2).

## Acceptance

| Criterion | Met | Evidence |
|---|---|---|
| Settings section with Region, Client ID, never-echoed Client Secret, credential note (es / en) | yes | smoke `[cloudset]` es + en "Settings shows the cloud section" |
| Save through `config:save`; the three I-1a save codes have es / en texts | yes | smoke "the cloud save codes have Spanish texts" (renderer- and main-side) + en twin |
| Test cloud access: "save first" for unsaved edits without calling main; controllers with reasons; `-7132`, `-52602`, unknown code, `superseded` | yes | smoke checks "with nothing saved", "a successful test", "errors" (es + en) |
| Late / stale results never painted (close / reopen, staged removal, field edit, newer run) | yes | smoke "a test still running when Settings closes", "a cloud field edit discards the test" (review fix) |
| Remove cloud access: inline confirmation, staged, Save sends `removeCloudAccess: true` alone | yes | smoke "Quitar el acceso a la nube" + en twin |
| Smoke stub config load reports the cloud flags; `config:save` honors cloud fields and removal | yes | `tests/smoke/stub-main.cjs` (`applyCloudSave()`), exercised by every `[cloudset]` check |
| `npm run build` exit 0 | yes | orchestrator, after the review fix |
| `npm test` all pass | yes | 1280/1280 (was 1248; +32 in `tests/unit/renderer-cloud-form.test.ts`) |
| `npm run smoke` all pass | yes | 291/291 (was 273; +18 in the new `[cloudset]` launch) |
| No conflicted copies; user's stub hunks intact; no controller / `tplinkcloud.com` contact | yes | `fd -H "conflicted copy"` empty; worker diffed the user's lines against a backup; stub and fixtures only |

`npm run tls-probe` 29/29 was run by the worker (no main-process change; not re-run by the orchestrator).

## Decisions

- **Remove is staged, applied by Save** (not an immediate save): parity with "Remove management access", and `config:save` needs the form's URL / username / password anyway.
- **Stale-result guard stronger than "Test management access"**: a run number bumped by every run, Settings open / close, staged removal and cloud field edit. The management test's 20a leftover (a late result can show in a reopened Settings) is left as it was.
- **`credentialInvalid` refined by `errorCode`**: `-52602` / `-90112` expired or deleted, `-90113` disabled, `-90106` wrong ID or secret.

## Review

- Codex, `docs/reviews/phaseI-1c1.md`, **ship-with-fixes**, 0 blockers.
- Should-fix (`src/renderer/cloud-settings.ts`: a region / Client ID / Client Secret edit made while a test ran, or after it showed, left a result describing the old credential) → **fixed** by the orchestrator: `handleCloudFieldEdit()` resets the run (`resetCloudTest()`) and refreshes the placeholder on every edit of the three fields (wired in `renderer.ts`); smoke check "a cloud field edit discards the test" added. Build, `npm test` 1280/1280 and smoke 291/291 re-run after the fix.

## Leftovers (for I-1c2, none blocking)

- `config:save` still requires a valid local URL, username and password, so a cloud-only user cannot save the cloud credential: the cloud-only start must relax that path in main and in `saveSettings()`.
- The renderer does not receive `localOmadacId`, so the Test result lists the local duplicate too; the switcher needs main to expose it (or hide the duplicate).
- The stub's cloud channels ignore the `cloudAccess` flags (script `cloudResult` for `notConfigured`); `cloudConnectResult` unchanged.
- The cloud certificate note in Settings is not done (I-1c2).
- The worker ran one read-only `git diff` at the start to locate the user's hunks (against the brief's no-git rule; harmless).
