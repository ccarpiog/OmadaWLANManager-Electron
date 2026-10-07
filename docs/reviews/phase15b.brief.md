# Review brief — phase 15b (todo 4.8, second half)

- **Repo:** /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron (Electron 44, TypeScript, esbuild-bundled renderer, sandboxed preload). Review the **uncommitted** working tree against `HEAD`.
- **Phase goal:** the `ControllerSession` facade (internal client + Open API client on the same pinned `ControllerTlsSessions` session), capability detection with the reason codes of `docs/management-design.md` §2.2, a "Test management access" button in Settings, the site name returned to the renderer, and `readOnlyReason()` fed by the capabilities. No management actions yet (phases 16–19).
- **Spec:** `docs/management-design.md` §2 (2.1–2.3), §3, §5; `todo.md` item 4.8; prior phase narrative `docs/progress-archive/phase-15a.md`.
- **Changed files:** new `src/main/controller-session.ts`, `src/renderer/management.ts`, `tests/unit/controller-session.test.ts`; modified `src/main/{connection-manager,index,preload,omada-api,openapi-client,net-transport}.ts`, `src/shared/types.ts`, `src/renderer/{validation,view-state,state,notices,i18n,connection,management-form,settings-modal,elements,apply-translations,renderer}.ts`, `src/renderer/index.html`, `src/renderer/styles.css`, tests under `tests/unit/`, `tests/smoke/`, `tests/tls-probe/`, `tests/fixtures/smoke/ui-strings.json`, `todo.md`, `README.md`. Ignore `PROGRESS.json` (workflow record).
- **Reason codes (check order):** `legacyController`, `managementNotConfigured`, `invalidCredentials`, `tokenFailed`, `siteNotFound`, `apGroupsMismatch`, `probeFailed`; renderer-only `managementChecking`. New IPC: `MANAGEMENT_CAPABILITIES`, `MANAGEMENT_TEST` (each takes one session nonce).
- **Verification already run (all exit 0):** `npm run build`; `npm test` 572/572; `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` 144/144; same `ELECTRON_PATH` `npm run tls-probe` 24/24. Do not contact any real controller and do not read `~/.omada-wlan-manager/`.

## Risks to probe

1. **Secret / token leakage:** the Client Secret, the Open API token or a raw controller body reaching an IPC reply, renderer state, a log line or an error string (diagnostics must go through `redact.ts`).
2. **Secret before trust:** any path where the Open API token request (carrying the secret) can be sent before the certificate pin check / `/api/info` handshake passes, or over a session other than the pinned controller session.
3. **Invalidation races:** URL change, cert reset/trust, disconnect and superseded connect must close the Open API client and drop its token synchronously; a capability probe or Test result that resolves after an invalidation must be discarded, never applied to a newer session. Check the session-nonce ownership on both new channels.
4. **Capability correctness:** each failing check maps to its own reason; the AP-group check compares **id sets** for equality (missing, extra, same names with different ids), never names; the site check uses the selected internal site id; a management failure never delays or fails the internal connect / AP list.
5. **IPC hardening:** both new handlers start with `assertTrustedIpcSender()` and shape-guard payloads; the preload stays `electron`-only and its channel copy matches the shared one.
6. **Behavior regressions** in the existing connect / site selection / refresh / move flows from routing handlers through the facade; the read-only banner as the single `readOnlyReason()` switch; es/en parity of the 20 new strings; no `innerHTML` / inline styles.
7. Known worker notes to judge, not assume fine: the Test button only tests saved credentials; a Settings save re-runs the checks twice (save + reconnect); the TLS probe's pinned-session proof leans on Electron caching a rejection in the default session.

## Output

Write the full report to `docs/reviews/phase15b.md` with a verdict line (`ship`, `ship-with-fixes` or `do-not-ship`), then `BLOCKERS` and `SHOULD-FIX` lists with file:line references. Time budget: 15 minutes.
