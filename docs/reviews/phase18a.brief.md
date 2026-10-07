# Review brief — phase 18a (Wi-Fi network writes in main)

- **Repo:** the current working directory (Electron 44 + TypeScript 7, Omada WLAN Manager). The change is the UNCOMMITTED working tree on `main` (`git diff` + the untracked files below).
- **Phase goal:** the main-process half of `todo.md` 4.11 — Open API create / `basic-config` edit / change password / enable-disable / delete of Wi-Fi networks (Open + WPA-Personal only), pure body builders + validators, `ControllerSession` read-merge-write on fresh data (serialized writes, `superseded` on invalidation — the phase-16a pattern), guarded IPC + preload methods, smoke-stub channels, fixture tests. No UI (that is 18b).
- **Spec:** `docs/management-design.md` §3 (security), §4.5, §5 (defensive defaults); `docs/omada-openapi-ops.md` (SSID write operations); `todo.md` 4.11 "Done (18a)" describes what was built and the decisions taken.

## Changed files

New: `src/main/wifi-network-write.ts`, `tests/unit/wifi-network-write.test.ts`, `tests/unit/wifi-network-write-session.test.ts`, `tests/fixtures/openapi/ssid-writes.json`.
Modified: `src/shared/types.ts`, `src/main/openapi-client.ts`, `src/main/controller-session.ts`, `src/main/ipc-guards.ts`, `src/main/index.ts`, `src/main/preload.ts`, `src/main/redact.ts`, `src/main/ap-group-policy.ts`, `tests/smoke/stub-main.cjs`, `tests/smoke/run-smoke.mjs`, `tests/unit/openapi-client.test.ts`, `tests/unit/ipc-guards.test.ts`, `tests/unit/redact.test.ts`, `todo.md`. (`PROGRESS.json` is a workflow record — ignore it.)

## Verification already run (all exit 0)

- `npm run build`
- `npm test` — 834/834 (was 774)
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 183/183
- `ELECTRON_PATH=… npm run tls-probe` — 25/25
- compiled `dist/main/preload.js` requires only `electron`

Do NOT contact any real controller and do NOT read/write `~/.omada-wlan-manager/` (user decision D4). If you run tests, keep `HOME` on a temp dir (the npm scripts already do).

## Risks to focus on

1. **Secret leakage:** the WPA passphrase must cross IPC only renderer → main and never appear in any IPC reply, error, diagnostic, log line or thrown error text; the controller's stored `securityKey` from the fresh detail must never reach the renderer. Check the redactor additions and the by-value scrubbing.
2. **Read-merge-write correctness:** every unedited field of the fresh detail (including fields outside the `ManagedNetwork` DTO — hidden, guest, VLAN, PMF, 802.11r, MLO, rate limits…) is preserved in the PATCH body; the merge never sends a stale or renderer-supplied value for an unedited field; Enterprise / PPSK / unknown security refused on the FRESH data as well as on renderer input (security codes: 0 open, 2 Enterprise, 3 WPA-Personal, 4/5 PPSK).
3. **Validation rules:** SSID 1–32 UTF-8 bytes after trim (multi-byte boundaries), passphrase 8–63 printable ASCII and never trimmed, passphrase included only when typed, required fields present per the ops doc; create disabled by default and bound to valid 24-hex AP-group ids.
4. **Session binding / races:** writes wait for capabilities, `managementUnavailable` unless `manageWifiNetworks`, shared serialized write queue with AP-group writes, `superseded` with nothing more sent after any await once the session is closed/replaced or the client dropped (connect, disconnect, "Test management access", credentials save).
5. **IPC guards:** exact key sets, plain objects, nonce/id formats, bounded strings, booleans; every handler runs `assertTrustedIpcSender()` first.
6. **Smoke stub fidelity:** the stub uses the real guards / builders so it cannot drift from main.

## Output

- Review file: `docs/reviews/phase18a.md` (overwrite).
- Verdict line format as usual (`ship` / `ship-with-fixes` / `do-not-ship`), with BLOCKERS and SHOULD-FIX lists, each with file:line.
- Time budget: 15 minutes.
