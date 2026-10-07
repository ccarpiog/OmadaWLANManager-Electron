# Review brief — phase I-1b2b1 (connection targets in main)

- **Repo:** `/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron` (Electron 44 + TypeScript, Omada WLAN Manager). Review the **uncommitted** working tree against `HEAD`.
- **Review file:** `docs/reviews/phaseI-1b2b1.md` (write the full report there).
- **Time budget:** 15 minutes.

## Phase and goal

`ConnectionManager` gains targets `{kind: 'local'} | {kind: 'cloud', omadacId}` so it can install the Open-API-only cloud `ControllerSession` (phase I-1b1, `src/main/cloud-controller-session.ts`). Plan: `todo.md` §5, the "I-1b2b" → "Split" bullet and the new "Done (I-1b2b1)" sub-list; spec `autoclaude/processed/10-tplink-cloud-controllers.md` "Architecture (main process)"; contract `docs/omada-cloud-openapi.md` §12–§13.

Required behavior:
- `switchTarget(target)` runs the same **synchronous** invalidation as a URL change **before any await** (in-flight connects, site choices, tokens and managed reads superseded; late results never installed or persisted), persists `activeController`, then connects.
- A cloud connect reads a **fresh** organization entry; an unknown omadacId, a non-connectable entry or an unusable credential is refused with a code-first `detail` before any session is built; the session is built per `todo.md` §5 "For I-1b2"; `cloudSites[omadacId]` is passed to `connect()` and a cloud site pick is persisted there, never in the local `site`.
- `localOmadacId` learned on a successful local connect, persisted only when changed; still dropped on a URL change.
- Pure `resolveStartupTarget()` (cloud only when `activeController` is an omadacId **and** the credential is usable, else local) — written and tested, **not wired** into startup this phase.
- `CloudSessionError` → connect `detail` / move rejection message, code first, scrubbed of token, secret, deviceId and serverHost.
- No new IPC channel, no preload / renderer change, no startup change: the running app stays local.

## Changed files

New: `src/main/connection-target.ts`, `src/main/cloud-connect.ts`, `tests/unit/connection-targets.test.ts`. Modified: `src/main/connection-manager.ts` (bulk of the change), `cloud-access.ts`, `cloud-controller-session.ts`, `controller-session.ts`, `config-model.ts`, `config.ts`, `index.ts`, `tests/unit/config-cloud.test.ts`, `tests/unit/cloud-access.test.ts`, `docs/omada-cloud-openapi.md`, `docs/security-audit.md`, `todo.md`. Workflow records (ignore): `PROGRESS.md`, `PROGRESS.json`.

**Not part of this phase (the user's own uncommitted work — do not review):** `tests/smoke/stub-main.cjs`, `tests/tls-probe/app-main.cjs`, `tests/smoke/window-placement.cjs`.

## Verification already run (orchestrator, after the worker)

- `npm run build` → exit 0
- `npm test` → exit 0, 1218/1218 (was 1184)
- `ELECTRON_PATH=… npm run smoke` → 271/271
- `ELECTRON_PATH=… npm run tls-probe` → 29/29
- `fd -H "conflicted copy"` → empty

## Risks to probe

1. **Races:** is every await in the switch / cloud-connect path followed by a generation check before installing a session, persisting `activeController` / `cloudSites` / `localOmadacId`, or applying a move result? Can a superseded cloud connect leave a data client or token alive (leak) or close the *new* session's clients?
2. **Invalidation ordering:** does `switchTarget()` invalidate synchronously before its first await, exactly like the URL-change path? Is `activeController` persisted before or after the connect, and what happens when the connect fails (is the app left targeting an unreachable cloud controller with no local fallback)?
3. **Persistence correctness:** `cloudSites` writes never touch the local `site`; `localOmadacId` written only after a successful local connect of the *current* generation; config writes do not race the `config:save` path (the worker also made `applyConfigSave()` drop the connection when the cloud credential changes while the target is cloud — check that is safe and does not change local behavior).
4. **Redaction:** no token, secret, deviceId, serverHost or tunnel URL can reach a connect `detail`, a move rejection or a log line.
5. **Local behavior unchanged:** the local connect / site selection / trust / reset / management paths behave byte-for-byte as before for a local target (the smoke and probe pass, but look for subtle ordering changes in `connection-manager.ts`).
6. **Fail-closed:** an unusable credential, a missing organization entry, a truncated organization list or an account error never builds a session or falls back to a guessed target.

Out of scope here (next phase I-1b2b2): the switch IPC, startup honoring the target, session nonces on `omada:get-aps` / `omada:get-wlans` / `omada:set-wlan`, renderer handling of a cloud `url: ''`, the smoke stub, the settings-save reply's `connectionReset` for a cloud-credential change.
