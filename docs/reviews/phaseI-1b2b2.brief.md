# Review brief — phase I-1b2b2 (switch IPC and nonce-bound data channels)

- **Repo:** `/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron` (Electron 44 + TypeScript; main `src/main/`, renderer `src/renderer/`, shared types `src/shared/`).
- **Review the uncommitted working tree** against `HEAD` (`33a38fd`). Ignore `PROGRESS.json` and these three files, which carry the user's own unrelated edits: `tests/smoke/window-placement.cjs` (untracked), the top-of-file header comment + `keepTestWindowsOutOfTheWay` require/call in `tests/smoke/stub-main.cjs`, and all of `tests/tls-probe/app-main.cjs`. Every other hunk in `tests/smoke/stub-main.cjs` is this phase's.
- **Review file to write:** `docs/reviews/phaseI-1b2b2.md` (overwrite). Verdict line: `ship`, `ship-with-fixes` or `do-not-ship`, then BLOCKERS / SHOULD-FIX / NITS.
- **Time budget:** 15 minutes.

## Phase goal (plan: `todo.md` §5 "I-1b2b2", contract `docs/omada-cloud-openapi.md` §13, background `docs/security-audit.md` §7)

1. A guarded controller-switch channel `omada:switch-controller` over `ConnectionManager.switchTarget()` (registered via `handleTrusted()`, pure shape guard in `ipc-guards.ts`: exactly `{kind:'local'}` or `{kind:'cloud', omadacId}`, refused before any state change), preload `switchController(target)`.
2. Startup honoring `resolveStartupTarget(config, getCloudCredentials() !== null)` (`src/main/connection-target.ts`) with the local fallback; the local default start unchanged.
3. Session nonces on `omada:get-aps`, `omada:get-wlans`, `omada:set-wlan` in main, preload and the renderer's load / refresh / move flows (new `src/renderer/session-ticket.ts`): missing / malformed nonce refused by the guard; stale → `superseded`, no / closed session → `notConnected`, both before any controller call; a reply landing after a switch / reconnect is `superseded`. The 20a `refreshData()` fix: it uses the generation / nonce captured at its start.
4. `config:save` replies `connectionReset` when a cloud-credential change dropped a cloud connection.
5. The renderer tolerates a connected cloud session's `url: ''` (connect result carries `controllerName`; header shows it).
6. Smoke stub channels for the switch and the nonces.

## Changed files

Main: `src/shared/types.ts`, `src/main/{index,preload,ipc-guards,controller-session,connection-manager,connection-target,config}.ts`. Renderer: `src/renderer/{connection,move-flow,state,status,validation}.ts`, new `src/renderer/session-ticket.ts`. Tests: `tests/smoke/{stub-main.cjs,run-smoke.mjs}`, `tests/tls-probe/run-tls-probe.mjs`, `tests/unit/{connection-targets,connection-manager,ipc-guards,ipc-surface,redaction-audit,renderer-validation}.test.ts`, new `tests/unit/{session-data-reply,renderer-session-ticket}.test.ts`. Docs: `docs/security-audit.md`, `docs/omada-cloud-openapi.md`, `docs/live-test-checklist.md`, `todo.md`.

## Verification already run (orchestrator, all exit 0)

`npm run build`; `npm test` 1248/1248 (was 1218); `ELECTRON_PATH=… npm run smoke` 273/273 (was 271); `ELECTRON_PATH=… npm run tls-probe` 29/29; `fd -H "conflicted copy"` empty.

## Risks to probe

- **Stale-reply races:** can any `omada:get-aps` / `get-wlans` / `set-wlan` reply, or a refresh started before a switch / reconnect / disconnect / certificate reset / config save, still be applied to the new session's renderer state? Is the nonce checked both before the controller call and on the reply path in main? Is the renderer's ticket captured at flow start (not read at reply time) in load, refresh, and every step of a bulk move including Retry failed?
- **Behavior change the worker flagged:** while a newer connect is in flight, the data channels now refuse the old session with `notConnected` (phase 7 used to keep serving it). Check no current renderer flow (refresh during reconnect, move results, Settings save → reconnect) now breaks or shows a wrong error.
- **Refusal shape:** refusals are rejections whose message starts with the code (reply shapes unchanged). Check the renderer maps `superseded` silently (discard) and `notConnected` sensibly, and that no raw controller text / secret leaks through the rejection path (redactor).
- **Switch guard:** any input that reaches `switchTarget()` without validation (extra keys, prototype tricks, non-string omadacId, cloud omadacId format), and the order — guard before any invalidation.
- **Startup:** the cloud credential is read only when a cloud controller is the stored choice; local-only start byte-for-byte unchanged; a corrupt `activeController` falls back to local.
- **`connectionReset`:** reported exactly when a cloud connection was dropped by a cloud-credential change, and still for a URL change; not reported spuriously.
- **`url: ''`:** any remaining renderer path (cert modal, origin checks, `new URL(url)`, header, status) that would throw or show garbage.
- **Smoke stub fidelity:** does the stub enforce the nonce the same way main does, so the smoke would catch a renderer that forgot to send it?
- Invariant D4: no request to the real controller or any `tplinkcloud.com` host from tests, smoke or probe.
