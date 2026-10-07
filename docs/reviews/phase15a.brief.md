# Review brief — phase 15a (todo.md 4.8, first half)

- **Repo:** this directory (Omada WLAN Manager, Electron 44 + TypeScript 7). Review the **uncommitted** working tree against `HEAD`.
- **Phase goal:** optional Open API ("management access") credentials in config + Settings, an Electron-free `OpenApiClient`, and one central redactor. The client is deliberately NOT wired into the connect flow yet (phase 15b adds `ControllerSession`, capability detection, "Test management access").
- **Spec:** `docs/management-design.md` §2.1–2.3, §3 (security requirements), §5 (unverified API behaviors); `todo.md` item 4.8 (incl. its Split line and the new "Done (15a)" line).
- **Risk class:** high.

## Changed files
- New: `src/main/redact.ts`, `src/main/openapi-client.ts`, `src/renderer/management-form.ts`, `tests/unit/redact.test.ts`, `tests/unit/openapi-client.test.ts`, `tests/unit/renderer-management-form.test.ts`, `tests/fixtures/openapi/{token,sites,ap-groups}.json`.
- Modified: `src/shared/types.ts`, `src/main/{config-model,config,index,omada-transport,preload}.ts`, `src/renderer/{index.html,styles.css,elements,state,i18n,apply-translations,settings-modal,renderer}.ts`, `tests/unit/{config-model,omada-transport}.test.ts`, `tests/unit/helpers/fake-transport.ts`, `tests/smoke/{stub-main.cjs,run-smoke.mjs}`, `tests/fixtures/smoke/ui-strings.json`, `tests/tls-probe/run-tls-probe.mjs`, `README.md`, `todo.md`.

## Verification already run (all exit 0)
- `npm run build`
- `npm test` — 516/516
- `ELECTRON_PATH=… npm run smoke` — 133/133
- `ELECTRON_PATH=… npm run tls-probe` — 22/22 (new e2e check: real main without `safeStorage` writes only the Client ID, secret is session-only, never in a reply or on disk)
- Compiled preload requires only `electron`; no `innerHTML`/inline styles.

## Focus — where it is most likely wrong
1. **Secret leakage:** can the Client Secret or an access/refresh token reach disk (plaintext fallback, temp file, migration path), any IPC reply, renderer state, a log line, an error message/`detail`, or a serialized `OpenApiClient` instance? Check every `CONFIG_LOAD`/`CONFIG_SAVE` path, the session-only memory store, and error construction in the client and transport.
2. **URL-scoped credentials:** a controller URL change and "Remove management access" must clear the Client ID, `encryptedClientSecret` and the session-only secret. The blank-secret "keep" rule is said to apply only for the same URL and Client ID — check it cannot reuse controller A's secret for controller B, or the old secret for a new Client ID.
3. **Token lifecycle:** proactive expiry, exactly one shared re-acquire per request on an expired/invalid-token response, one retry, no loop, concurrent requests share one acquisition, a failed acquisition does not poison later calls forever, token not reused after credentials change.
4. **Redactor completeness:** keys case-insensitive and deep; free-text patterns (`AccessToken=`, `Bearer`, query params, JSON-ish pairs, `TPOMADA_SESSIONID`); the transport's error excerpt now passes through it — check for regressions in existing error messages and truncation interacting with redaction (e.g. a secret cut in half by the 200-char excerpt escaping the pattern).
5. **IPC payload guard:** `CONFIG_SAVE` now rejects unknown keys — check the renderer never sends one in any flow (first-run, URL change, language-only save) and that length/charset caps are enforced main-side.
6. **Pagination/validators:** page cap, dedupe, malformed `result` shapes, explicit v1/v2 with no default.
7. **Unverified constants** (spec §5): token error codes -44112/-44113 (+ HTTP 401) as token-rejected, -44106 as bad credentials, `expiresIn` default 300 s, Client ID charset 1–128 `[A-Za-z0-9._-]` — are any of these choices likely to lock out a real controller (e.g. a Client ID format the charset rejects)?
8. Project conventions: es/en i18n parity, JSDoc on every function, closing-brace comments on blocks > 10 lines, D4 (no real controller, no real `~/.omada-wlan-manager/`).

## Out of scope
`ControllerSession`, capability detection, the "Test management access" button and the read-only banner inputs — phase 15b.

## Review file
`docs/reviews/phase15a.md`

## Time budget
15 minutes.
