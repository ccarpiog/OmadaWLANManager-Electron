# Phase 16a — AP group operations and IPC (2026-10-07)

- **Plan item:** `todo.md` 4.9, first half. Phase 16 was split before starting: 16a = main-process operations, IPC, contract tests; 16b = the AP groups view actions, dialogs, capacity display, "Move access points here" and their smoke (recorded in `todo.md` 4.9).
- **Risk:** high. **Workers:** opus (phase), opus (review fixes).

## What was built

- **`OpenApiClient`** (`src/main/openapi-client.ts`): `createApGroup(siteId, name)` (POST v1 `…/ap-groups`, body `{name}`), `renameApGroup(siteId, apGroupId, name)` (PATCH v1 `…/ap-groups/{id}`, body `{name}`, no read-merge-write needed per the ops doc) and `deleteApGroup(siteId, apGroupId)` (DELETE v1, no body), with the existing `OpenApiError` mapping. POST's `result.id` is used when present; when missing, a fresh list is read and the new group matched, else the reply carries no id. No `getApGroupInfo` (the fresh list covers `groupNotFound` and the name check).
- **Policy** (`src/main/ap-group-policy.ts`, pure): names trimmed, 1–128 characters, no control or bidi characters, no case-insensitive duplicate of another group. Delete refused for the default group (`groupIsDefault`), a group with APs (`groupNotEmpty`), a group with SSID bindings (`groupHasNetworks`), an unknown id (`groupNotFound`), and a group whose AP count or network list the controller did not report sanely (`groupStateUnknown` — fail closed).
- **`ControllerSession`** (`src/main/controller-session.ts`) is the only caller of the write methods: `managementUnavailable` unless the capabilities say management is on; the AP-group list is re-read right before every write and the policy applied to that fresh data; the 15b invalidation is reused (a closed or replaced session or a dropped client sends nothing more; late answers come back `superseded`); a session's writes run one at a time.
- **Capacity read path:** a new read channel rather than extending `OMADA_GET_WLANS` (that reply has no session nonce, serves legacy controllers and sessions without management, and must never wait on an Open API call). DTO `ManagedApGroup` (id, name, isDefault; `apCount`, `networkNames` and per-band `remainingBinding` only when reported sanely) plus `ssidLimits`, in `src/shared/types.ts`.
- **IPC** (`src/main/index.ts`, `src/main/ipc-guards.ts`, `src/main/preload.ts`): channels `management:ap-groups` (nonce only) and `management:ap-group-create|rename|delete` (one object with exactly the listed keys). Each handler: `assertTrustedIpcSender()`, then the pure guards (32-hex session nonce, 24-hex group id; `requireSessionNonce` and `NONCE_REGEX` moved here from `index.ts` so the stub and tests share them), then the session nonce match. Preload: `getManagedApGroups`, `createApGroup`, `renameApGroup`, `deleteApGroup`; the compiled preload still requires only `electron`. Groups whose id is not 24 hex digits are listed but not writable (16b must mirror that). No user-facing strings were added.
- **Smoke stub** (`tests/smoke/stub-main.cjs`): the four channels over the in-memory `wlanGroups`, using the real compiled guards and policy; reconfigurable with `apGroupOverrides`, `apGroupSsidLimits`, `apGroupResults`; applied writes listed in `apGroupWrites`. `EXPECTED_BRIDGE` in `run-smoke.mjs` gained the four methods; one new `[caps]` check exercises the channels (its deliberately malformed calls print handler stack traces — expected).

## Verification

| Command | Exit | Result |
|---|---|---|
| `npm run build` | 0 | |
| `npm test` | 0 | 638/638 (was 580) |
| `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` | 0 | 145/145 (was 144) |
| `npm run tls-probe` (same `ELECTRON_PATH`) | 0 | 25/25 |

Plus: `dist/main/preload.js` requires only `electron`; `fd -H "conflicted copy"` empty. Disabling the delete-policy check makes unit tests fail.

## Review

Codex, `docs/reviews/phase16a.md`, **ship-with-fixes**, 1 blocker + 1 should-fix, both fixed by an opus worker before the commit:

- **Blocker:** `validateOpenApiApGroup()` filtered non-string `ssidNameList` entries, so `[null]` became `[]` = "no bindings" and allowed a delete. Now the list is kept only when it is an array of strings, otherwise omitted; `checkApGroupDeletion()` applies the same rule itself (the stub passes unvalidated data) and refuses with `groupStateUnknown`; the DTO omits `networkNames` in that case. `apNum` already failed closed; tests added for it.
- **Should-fix:** create's missing-id fallback read turned a `superseded` failure into success. It now returns `superseded`; only an independent read failure (e.g. HTTP 503) still reports success without an id.
- New tests fail when each fix is reverted (validator 3, policy 2, create 1). After the fixes the orchestrator re-ran build (0), `npm test` 638/638, smoke 145/145, TLS probe 25/25.

## Unverified API behaviors (add to the phase 20 live checklist)

- POST without `apMacs` is accepted, and its `result.id` equals the internal `setting/wlans` id.
- PATCH with only `name` leaves the group's APs untouched.
- Error codes -33200, -33201, -33203; whether the controller itself rejects duplicate names (and case-sensitively).
- `apNum` counts every AP and `ssidNameList` lists every bound network, including disabled and "All access points" ones.
- `remainingBinding` keys 0/1/2 (is there an MLO key?) and the `maxSsids*` fields.
- How the 128-character limit is counted and which characters the controller accepts.
