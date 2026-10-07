# Phase I-1b2b2 — switch IPC and nonce-bound data channels (2026-10-07)

- **Risk:** high. **Worker:** opus (phase). No review fix (the one should-fix was declined, see Review).
- **Plan record:** `todo.md` §5, "I-1b2b" → "Split" → "I-1b2b2" and its "Done (I-1b2b2)" sub-list (the "how").
  Closing this phase closes I-1b2b, I-1b2 and I-1b; only I-1c remains of inbox item I-1.

## What was built

- **Switch IPC:** `omada:switch-controller` (preload `switchController(target)`, shared `ControllerTarget`) through
  `handleTrusted()` and the pure `parseControllerTargetRequest()` (`ipc-guards.ts`): exactly `{kind: 'local'}` or
  `{kind: 'cloud', omadacId}`, a plain object with no other key, refused before any state change; then
  `ConnectionManager.switchTarget()`, the reply being the new target's `ConnectionResult`. No switcher UI (I-1c).
- **Startup:** `connectionManager.startOn(getStartupTarget())` before `createWindow()`. `getStartupTarget()`
  (`config.ts`) wraps `resolveStartupTarget(config, getCloudCredentials() !== null)` through the pure
  `startupTargetOf()`, reading the credential only when `activeController` names a cloud controller. `startOn()` sets
  the target without a transition, write or connect, and only while nothing ran. Local default start unchanged.
- **Data-channel nonces:** `omada:get-aps`, `omada:get-wlans` and `omada:set-wlan` take the session nonce first
  (`requireSessionNonce()`; `parseApMoveRequest()` for set-wlan). `sessionDataReply()` (`controller-session.ts`)
  applies the management channels' ownership rules before any controller call: no installed open session →
  `notConnected`, another session's nonce → `superseded`, and a result settling after the session was replaced or
  closed → `superseded`. Refusals are rejections whose message starts with the code (reply shapes unchanged).
- **Renderer:** pure `src/renderer/session-ticket.ts` (`captureSessionTicket()`, `isTicketCurrent()`,
  `fetchControllerData()`, `reloadWithTicket()`). Load, refresh and the move flow (every move and its reload) capture
  the nonce and generation at their start and discard stale replies. The 20a leftover is fixed: `refreshData()` starts
  its managed re-reads only for the generation captured at its start.
- **`connectionReset`:** `applyConfigSave()` returns whether the transition ran; the new `finishConfigSave()` builds
  the CONFIG_SAVE reply, now `connectionReset: true` for a cloud-credential change on a cloud target as well as for a
  URL change (the I-1b2b1 leftover).
- **Cloud `url: ''`:** a cloud connect result carries `controllerName`; the renderer stores it
  (`parseControllerName()`) and labels the header through the pure `controllerHostLabel()` (`validation.ts`). No new
  strings.
- **Smoke stub / probe:** the stub runs the real guards for the switch and the three data channels;
  `run-smoke.mjs` has two new `[es]` checks and skips the nonce in the set-wlan argument comparisons. The TLS probe
  sends a nonce in `installedState()` and checks that another nonce answers `superseded`. The user's own lines in
  `tests/smoke/stub-main.cjs` and all of `tests/tls-probe/app-main.cjs` were untouched; the commit stages the stub
  from a temp copy with the user's hunks reversed, as in phase I-1a.

## Decisions

- Refusals are code-first rejections, not new reply objects, so the three channels keep their reply shapes.
- **Behavior change:** while a newer connect attempt is in flight, the data channels refuse the old session
  (`notConnected`); phase 7 used to keep serving it. No current renderer flow calls them in that window. All checks
  stayed green.
- `requireController()` in `index.ts` is gone; every data handler goes through `sessionDataReply()`.

## Acceptance (all met)

| Criterion | Evidence |
|---|---|
| Guarded switch channel, malformed target refused before any change | `ipc-guards.test.ts` (+3), `ipc-surface.test.ts` (+2), smoke `[es]` switch check |
| Startup honors `resolveStartupTarget()` with the local fallback | `connection-targets.test.ts` startup cases; smoke and probe start local as before |
| Nonces on the three data channels, stale refused before any controller call, late replies `superseded` | `session-data-reply.test.ts` (6), `connection-targets.test.ts` (real local and cloud sessions), smoke data-channel check, TLS probe CERT_RESET check |
| Renderer captures the session at flow start (20a `refreshData()` fix) | `renderer-session-ticket.test.ts` (8) |
| `config:save` reports `connectionReset` for the cloud-credential drop | `connection-targets.test.ts`, `connection-manager.test.ts` |
| Renderer survives `url: ''` | `renderer-validation.test.ts` (+2) |
| Build, unit, smoke, probe green | orchestrator re-runs below |

## Verification (orchestrator, 2026-10-07)

- `npm run build` → exit 0.
- `npm test` → exit 0, 1248/1248 (was 1218).
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` → exit 0,
  273/273 (was 271).
- `ELECTRON_PATH=<same> npm run tls-probe` → exit 0, 29/29.
- `fd -H "conflicted copy"` → empty. No controller or `tplinkcloud.com` contact.

## Review

- Codex, `docs/reviews/phaseI-1b2b2.md`, **ship-with-fixes**, 0 blockers, 1 should-fix.
- Should-fix (`connectionReset` reported for a cloud-credential save while the cloud target had nothing connected):
  **declined, no change.** The flag means "the transition ran", exactly as for a URL change since phase 11. The
  transition must still run, because it cancels an in-flight cloud connect that the manager does not track
  separately. While disconnected, `handleConnectionReset()` in `src/renderer/connection.ts` only clears the remembered
  site name, which is correct after an account change. Narrowing the flag would need in-flight tracking and could
  under-report a cancelled connect.

## Leftovers (none blocking, for I-1c)

- The switcher must invalidate the renderer session (generation and nonce) before `switchController()`, then handle
  its result like `connect()`.
- `init()` auto-connects only when a local URL is configured, so a cloud-only setup needs I-1c's entry point.
- The smoke stub's config load still reports no cloud flags; a stub cloud target is refused `notConfigured` unless
  `cloudConnectResult` is scripted.
