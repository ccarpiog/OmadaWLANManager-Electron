# Review brief — phase 16a (AP group operations and IPC)

- **Repo:** the current working directory (Omada WLAN Manager, TypeScript Electron app). Review the **uncommitted** working tree against `HEAD`.
- **Phase:** 16a, the main-process half of `todo.md` item 4.9 (AP group management). Risk: high. Phase 16b (the UI) is not part of this change.
- **Goal:** Open API create / rename / delete of AP groups through `ControllerSession` only, with the app policy re-checked in main from fresh Open API data before every write (delete only non-default, 0 APs, no SSID bindings; names trimmed, 1–128, no control/bidi characters, no case-insensitive duplicate), gated on the management capability and bound to the current session (15b invalidation, late results discarded); new IPC channels `management:ap-groups`, `management:ap-group-create|rename|delete` with trusted-sender assert, pure shape guards (exact keys, 32-hex session nonce, 24-hex group id) and stable error codes; a validated `ManagedApGroup` DTO with per-band `remainingBinding` for phase 16b; smoke-stub coverage of the new channels.
- **Spec:** `docs/management-design.md` §2.2, §3 (security/IPC rules), §4.4, §5 (defensive defaults); API facts `docs/omada-openapi-ops.md` (`/ap-groups` sections).
- **Changed files:** `src/main/ap-group-policy.ts` (new), `src/main/ipc-guards.ts` (new), `src/main/openapi-client.ts`, `src/main/controller-session.ts`, `src/main/index.ts`, `src/main/preload.ts`, `src/shared/types.ts`, `tests/unit/ap-group-policy.test.ts` (new), `tests/unit/ipc-guards.test.ts` (new), `tests/unit/ap-group-management.test.ts` (new), `tests/unit/openapi-client.test.ts`, `tests/fixtures/openapi/ap-group-writes.json` (new), `tests/smoke/stub-main.cjs`, `tests/smoke/run-smoke.mjs`, `todo.md`, `README.md`. (`PROGRESS.json` is a workflow record — ignore it.)
- **Verification already run (all exit 0):** `npm run build`; `npm test` 633/633 (was 580); `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` 145/145 (the stack traces it prints are the new check's deliberately malformed IPC calls being rejected by the guards); `npm run tls-probe` (same `ELECTRON_PATH`) 25/25; compiled `dist/main/preload.js` requires only `electron`.
- **Risks to probe:**
  1. Any Open API write reachable from IPC without trusted sender + valid shape + matching session nonce + management on + (delete) the fresh-data policy check.
  2. Race / invalidation: a write in flight across a disconnect, URL change, certificate reset, superseded connect or credentials save — can it still send, or report success for the wrong session? Are a session's writes serialized?
  3. Request contracts: method, path version (v1), exact body (POST `{name}`, PATCH `{name}`, DELETE no body); handling when POST's `result.id` is missing; error mapping.
  4. Leaks: raw controller responses, secrets, tokens in replies, logs or error messages (`redact.ts`).
  5. The DTO: garbage capacity fields must be absent, never invented; groups with a non-24-hex id are listed but not writable.
  6. Name rules: trimming, duplicate detection (case-insensitive), length counting, control/bidi rejection — consistent between guard, policy and stub.
  7. The smoke stub must mirror the real guards and policy codes, not a looser copy.
  8. Project rules: JSDoc on every function; closing-brace comments on blocks > 10 lines; no user-facing strings added; comments in English.
- **Constraint:** never contact the real controller (192.168.1.130) or read/write the real `~/.omada-wlan-manager/`.
- **Review file:** `docs/reviews/phase16a.md`
- **Time budget:** 15 minutes.
