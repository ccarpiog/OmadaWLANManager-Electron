# Phase 18a — Wi-Fi network writes in main (2026-10-07)

- **Plan item:** `todo.md` 4.11, first half. Phase 18 was split before starting (recorded in `todo.md` 4.11 "Split"): 18a = main-side writes + IPC + tests, no UI; 18b = the editing UI + smoke.
- **Risk:** high. **Workers:** opus (phase), opus (review fixes). Run under `/autoclaude-opus` (driven).
- **Detailed "how":** `todo.md` 4.11 "Done (18a)", including the full **Unverified live (phase 20)** list.

## What was built

- **`OpenApiClient`** (`src/main/openapi-client.ts`): SSID create (`POST`, v2), a detail read for writes, `basic-config` (`PATCH`, v1), `enable` (`PATCH`, v1) and delete (`DELETE`, v1). The ops doc has no password endpoint, so "Change password" is a `basic-config` save that changes only the passphrase.
- **Pure rules** (`src/main/wifi-network-write.ts`, import-free at runtime, also required by the smoke stub): SSID name trimmed, 1–32 UTF-8 bytes, no control / bidi characters; passphrase 8–63 printable ASCII, never trimmed, sent only when typed; only Open (0) and WPA-Personal (3) are writable — Enterprise (2), PPSK (4, 5) and unknown security are refused on renderer input and on fresh data. Security codes follow the ops doc (2 = Enterprise, 3 = WPA-Personal); the worker brief's "Enterprise (security 3)" was wrong.
- **Read-merge-write** (`ControllerSession`): every write waits for the capabilities, answers `managementUnavailable` unless `manageWifiNetworks`, re-reads fresh data, shares the AP-group write queue, and answers `superseded` with nothing sent once the session or client changes. The merge copies exactly the documented `basic-config` request schema (top level and nested), pinned by a unit test that parses the schema from `docs/omada-openapi-ops.md`; unknown keys are never sent, absent optional fields stay absent, and a missing required field or a wrong type is `networkStateUnknown`. The controller's stored key is never reused, so every WPA-Personal `basic-config` save carries a re-typed passphrase (`passphraseRequired` otherwise).
- **Security / band dependents:** one shared `deriveSecurityDependents()` (create and edits) decides WPA version, encryption, PMF and OWE, and runs only when security or bands change, so a name or passphrase edit sends every other field byte-identical. Table: WPA-Personal 6 GHz-only → WPA3-SAE, AES, PMF mandatory; WPA-Personal 6 GHz + other bands → WPA2/WPA3, AES, PMF capable; WPA-Personal without 6 GHz → current values while valid, else WPA2-PSK, AES, PMF capable, OWE off; Open with 6 GHz → OWE on, PMF mandatory; Open without 6 GHz → OWE kept, PMF mandatory with OWE else disabled. `securityBandConflict` (diagnostic `conflict: <field>`) when Enhanced IoT Connectivity is on and the change adds 5 / 6 GHz or needs WPA3; creating an Open 6 GHz network is refused (the create schema has no `oweEnable`).
- **IPC:** `management:network-create|update|password|enable|delete`, each `assertTrustedIpcSender()` → exact-key guards in `ipc-guards.ts` → `sessionOwnedReply()`. Preload `createNetwork`, `updateNetwork`, `changeNetworkPassword`, `setNetworkEnabled`, `deleteNetwork`. The passphrase crosses IPC only renderer → main; it is scrubbed by value from client diagnostics and session logs, and the redactor also catches `preSharedKey` / `wpaKey`.
- **Error codes:** `nameTaken`, `nameTooLong`, `nameRequired`, `nameInvalid`, `passphraseRequired`, `passphraseInvalid`, `passphraseNotApplicable`, `bandsRequired`, `groupsRequired`, `unsupportedSecurity`, `nothingToChange`, `bandLimitReached`, `groupNotFound`, `groupListIncomplete`, `networkStateUnknown`, `securityBandConflict`, `requestFailed`. No user-facing strings (18b maps them).
- **Smoke stub:** the five channels with the real guards, builders and session checks, applied to the stub's network state; one new `[caps]` check drives the bridge methods.

## Acceptance

| Criterion | Result |
|---|---|
| Fixture tests for Open / WPA-Personal bodies (required fields, passphrase only when typed, 32-byte SSID incl. multi-byte boundaries, 8–63 passphrase) | met — `wifi-network-write.test.ts`, `openapi-client.test.ts` over `tests/fixtures/openapi/ssid-writes.json` |
| Read-merge-write keeps every unedited field the detail returned | met — schema round-trip tests incl. nested `vlanSetting.customConfig`, `CondBroadcastCtrl` |
| Enterprise / PPSK writes refused | met — renderer input and fresh-data contradiction tests |
| Passphrase in no reply, log or error text | met — sentinel tests across every path |
| `npm run build`, `npm test`, smoke, TLS probe exit 0 | met — 858/858, 183/183, 25/25 |
| Preload requires only `electron`; no conflicted copies | met |

## Review

Codex, `docs/reviews/phase18a.md`, ship-with-fixes (Codex itself said needs-attention): 3 blockers + 1 should-fix, all fixed by an opus worker, each with tests that failed on revert (seven revert variants checked):

1. **Queued writes survived invalidation** (`#serializeWrite()` delayed the closure without capturing the management state) → each public write captures a management epoch when called; a credentials save, re-check, connect or disconnect makes a queued write `superseded` with zero requests. The phase-16a AP-group writes got the same fix. A check run a write starts itself does not count.
2. **The `basic-config` merge dropped fresh settings** → orchestrator decision: keep `basic-config` writes (the endpoint covers only basic config; rate limits, schedules, MAC filtering live in other endpoints this app never calls), but copy exactly the documented schema, pin it with a drift test, and refuse a missing required field.
3. **Security / band transitions kept incompatible PMF / WPA settings** → `deriveSecurityDependents()` and `securityBandConflict` (above).
4. **Create fallback could return an existing network's id** (should-fix) → the create reads the catalog before the POST; without an id in the reply it returns only the one id that is new and carries the requested name, else no id.

## Leftovers (none blocking)

- A WPA2/WPA3 network with PMF mandatory is lowered to PMF capable when its bands change (the transition rule is applied strictly) — a security downgrade the 18b UI should state, and a phase-20 check of what the controller allows.
- MLO compatibility is not checked.
- 18a can edit only name, Open ↔ WPA-Personal, bands and passphrase; hidden SSID, guest, VLAN, PMF, 802.11r and MLO are preserved but not in the renderer DTO, so 18b cannot edit them without extending the DTO.
- The app does not check duplicate names itself; the controller's -33219 becomes `nameTaken`. A create needs at least one AP group. Enable / disable and delete are allowed for every security mode (spec).
- Unverified live (phase 20), in full in `todo.md` 4.11: the create / `basic-config` / `enable` / delete body and reply shapes and error codes; whether an absent optional `basic-config` field means "unchanged" or "reset"; whether the v1 detail returns every `basic-config` field and the key in clear; the derived WPA / PMF / OWE defaults; delete of a bound network.

## Verification (orchestrator, after the review fixes)

- `npm run build` — exit 0
- `npm test` — 858/858, fail 0
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 183/183
- `ELECTRON_PATH=… npm run tls-probe` — 25/25
- `rg -o 'require\("[^"]*"\)' dist/main/preload.js` — `require("electron")` only
- `fd -H "conflicted copy"` — none
