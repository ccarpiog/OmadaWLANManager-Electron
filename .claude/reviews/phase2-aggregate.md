# Codex review — Phase 2 aggregate (2026-08-24)

Scope: working-tree diff for todo.md items 1.3, 1.6, 1.7, 1.8, 3.13 (`src/main/omada-api.ts`, `src/main/index.ts`).

Verdict: **not safe to commit yet** — re-login concurrency is a release blocker.

## Findings

1. **High — concurrent `-1200` responses cause multiple competing logins.**
   `omada-api.ts:361`, `renderer.ts:578`
   APs and WLANs are fetched with `Promise.all`. If both return `-1200`, both call `relogin()` independently. The two login responses can overwrite the shared cookie and CSRF token, or the later login can invalidate the session used by the earlier retry. One retry may consequently return `-1200` despite a successful re-login.
   Fix: a shared in-flight `reloginPromise` so every expired request awaits the same login operation, then retries once.

2. **Medium — failed re-login leaves stale or partially mutated authentication state.**
   `omada-api.ts:381`, `omada-api.ts:391`
   `rawRequest()` merges login response cookies before `relogin()` checks whether login succeeded. A failed login may delete or replace the session cookie while the old `csrfToken` and `siteId` remain set; subsequent calls pass the "connected" guards and repeatedly attempt re-login from inconsistent state.
   Fix: clear cookies, CSRF token, and site id when the shared re-login attempt fails; coordinate with finding 1 so one failing attempt cannot clear another successful attempt's state.

3. **Medium — entry validation can silently convert unsupported API shapes into empty/partial results.**
   `omada-api.ts:119`, `omada-api.ts:224`, `omada-api.ts:264`
   Malformed entries / missing required fields are skipped, so a controller that renames `mac`, `wlanId`, or site `id` yields an empty list (or "no site access") instead of the explicit unsupported-response error.
   Fix: normalize only genuinely optional display fields; throw `Unsupported API response (...)` when an entry lacks its required identifier or element types are invalid.

4. **Low — a late response can mutate cookies after the request has settled.**
   `omada-api.ts:478`
   The response callback merges `Set-Cookie` before checking `settled`; a queued response arriving after timeout/abort mutates the jar after rejection.
   Fix: check `settled` before merging/processing a late response; discard or abort that response.

## Checks that passed

- Per-name cookie merging preserves `TPOMADA_SESSIONID`; attribute parsing handles `Expires`, `Max-Age <= 0`, empty-value deletion, values containing `=`.
- All settle paths (resolve, reject, timeout, overflow, request-error, response-error, abort) clear the timer; no double settlement.
- before-quit re-entry quits correctly, bounded at 3 s, no double-fire.
- Retry-loop prevention correct (retry uses `rawRequest()` directly).
- TypeScript compilation and `git diff --check` passed.

## Resolution

All four findings fixed by the phase worker before commit:

1. Shared in-flight `reloginPromise` + `sharedRelogin()`; concurrent -1200 responses join one login and each retries once via `rawRequest()`.
2. `clearSessionState()` (cookies, CSRF, site id) runs on every `relogin()` failure path, inside `relogin()` and therefore before the shared promise resets — a failing attempt cannot clear a later successful attempt's state.
3. Validators now throw `Unsupported API response (...)` on missing required identifiers (AP `mac`, WLAN `wlanId`, site `id`) or invalid element types; only display fields are normalized.
4. `rawRequest()`'s response callback checks `settled` first and discards late responses before any cookie merge.

Re-verified: `npm run build` exit 0; orchestrator spot-read of the relogin path confirmed the fix.
