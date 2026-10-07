# Phase I-1b2b1 — connection targets in main (2026-10-07)

- **Risk:** high. **Worker:** opus (phase); the review fix was made by the orchestrator (under 10 source lines).
- **Plan record:** `todo.md` §5, "I-1b2b" → "Split" → "I-1b2b1" and its "Done (I-1b2b1)" sub-list (the "how").
- **Split decision (2026-10-07, before starting):** I-1b2b was too big for one worker, so it was cut into I-1b2b1
  (main-side `ConnectionManager` targets, Electron-free, no IPC / renderer / startup change) and I-1b2b2 (the switch
  IPC, startup honoring the target, session nonces on the `omada:*` data channels, renderer tolerance of a cloud
  `url: ''`, smoke stub).

## What was built

- `src/main/connection-target.ts` (new): the `{kind: 'local'} | {kind: 'cloud', omadacId}` target type and the pure
  `resolveStartupTarget()` (cloud only when `activeController` is an omadacId and the cloud credential is usable,
  else local). Written and tested, not called from startup yet (I-1b2b2).
- `src/main/cloud-connect.ts` (new): `createCloudControllerLookup()` — a fresh organization entry through the new
  `CloudAccessService.findOrganization()`, refusals by code (account code, `listIncomplete`, `unknownController`, the
  DTO reason), otherwise the session factory built as `todo.md` §5 "For I-1b2" says.
- `src/main/connection-manager.ts`: `switchTarget()` runs the URL-change invalidation synchronously before any await,
  persists `activeController`, then connects; switching to the current target is a full reconnect, never a no-op.
  Cloud connects pass `cloudSites[omadacId]`; a cloud site pick is persisted there, never in the local site field.
  `localOmadacId` is learned on install of a local connect, persisted only when usable and changed, for the URL used.
  `applyManagementAccessChange()` skips an installed cloud session. `applyConfigSave()` also runs the transition when
  the cloud credential changes while the target is cloud (added by the worker beyond the brief; unreachable while the
  app stays local).
- Error mapping: `describeCloudSessionError()` (code first, `openApiCode` added when missing) is now the
  `CloudSessionError` message, so the move rejection carries it; the connect `detail` uses it through
  `connectFailureDetail()`, scrubbed again of the routing values and live secrets. Local details unchanged.
- Persistence: pure `withLocalOmadacId()` / `withActiveController()` / `withCloudSite()` / `cloudSiteOf()` in
  `config-model.ts`; `config.ts` accessors write only on a change. `index.ts` only constructs `ConnectionManager` with
  them and the cloud lookup (the cloud transport is hoisted and shared).
- Docs: `docs/omada-cloud-openapi.md` new §13 (connection targets) and fixed §6 / §10 / §12 sentences;
  `docs/security-audit.md` log-line rows.

## Acceptance (all met)

| Criterion | Evidence |
|---|---|
| `npm run build` exit 0 | orchestrator re-run after the review fix |
| `npm test` all pass, above 1184 | 1218/1218 (29 new in `tests/unit/connection-targets.test.ts`, +3 `config-cloud`, +2 `cloud-access`) |
| Smoke unchanged, 271/271 | orchestrator re-run after the fix, no smoke edits |
| TLS probe 29/29 | orchestrator re-run after the fix |
| No conflicted copies | `fd -H "conflicted copy"` empty |
| No IPC / preload / renderer / startup change | `git diff --stat` (main + tests + docs only) |
| Race tests | switch during a connect, a move and a managed read; local → cloud → local; the worker broke three race guards on purpose and the tests failed each time |
| No controller or `tplinkcloud.com` contact | fakes and fixtures only |

## Review

- Codex, `docs/reviews/phaseI-1b2b1.md`, **ship-with-fixes**, 0 blockers.
- Should-fix (`src/main/cloud-access.ts`): a truncated organization list still built a session when the omadacId was
  on a page that was read. **Fixed by the orchestrator:** `findOrganization()` now checks `truncated` first and refuses
  with `listIncomplete (organization list incomplete)`, fail-closed like the I-1b1 truncated site list; the two
  affected assertions (`cloud-access.test.ts`, `connection-targets.test.ts`) and §13 of the contract updated. Build,
  unit 1218/1218, smoke 271/271 and probe 29/29 re-run green.

## Leftovers (none blocking)

- I-1b2b2 must make the `config:save` reply report `connectionReset` when a cloud-credential change dropped a cloud
  connection (today only a URL change does; unreachable while the app stays local).
- I-1b2b2 wires startup as `resolveStartupTarget(config, getCloudCredentials() !== null)`.
- A failed `activeController` write is logged and the switch still applies to this run.
