# Phase 17a — Wi-Fi network read model in main (2026-10-07)

- **Plan item:** `todo.md` 4.10, first half. Phase 17 was split before starting: 17a covers the main-process read model, secret stripping and guarded IPC; 17b covers the Wi-Fi networks view on the managed source and the smoke (recorded in `todo.md` 4.10 "Split").
- **Risk:** high (decides which secrets can reach the renderer; new IPC surface). The plan had listed phase 17 as routine; 17b stays routine.
- **Workers:** opus (phase), opus (review fixes). Orchestrator: `/autoclaude-opus`, driven mode.
- **Detailed "how":** `todo.md` 4.10 "Done (17a)".

## What was built

- **`OpenApiClient`** (`src/main/openapi-client.ts`) gained three reads: the v2 SSID catalog (paged through `listAll()`), the v1 SSID detail and the v1 per-SSID AP-group bindings. Path versions are explicit per operation.
- **`src/main/wifi-network-model.ts`** (new, pure) holds the validators and the DTO builder:
  - A malformed payload becomes `malformedResponse`.
  - A field on which the list and the detail disagree becomes unknown.
  - `ManagedNetwork` (in `src/shared/types.ts`) is built field by field. It exposes only `hasPassphrase` and never a key.
  - `chooseDevices` 0 means "All access points". Any value it doesn't recognise gives an unknown scope, never "all". The enable-field fallback follows spec §5.
- **`ControllerSession.listManagedNetworks()`:**
  - Gated on `manageWifiNetworks`, and bound to the session like 16a's `listManagedApGroups()` (`superseded`, late answers discarded).
  - Requests run one at a time: ⌈N/100⌉ list pages, then 2 per network, with a cap of 128 networks.
  - Small refactors: `#managementContext()` takes the capability flag, and the AP-group reply wrapper became a shared `sessionOwnedReply()` with unchanged behaviour.
- **IPC:**
  - New channel `management:networks`: `assertTrustedIpcSender()`, then exactly the 32-hex session nonce, then `notConnected` / `superseded` as in 16a.
  - New preload method `getManagedNetworks()`. The compiled preload still requires only `electron`.
- **Smoke stub:** the channel runs raw payloads through the real validators and DTO builder. New knobs `networks` / `networksResult`, and one new `[caps]`-style check drives the bridge method.

## Review — Codex, `docs/reviews/phase17a.md`, ship-with-fixes

- **Blocker:** `listAll()` stopped at a short page even when `totalRows` said more rows existed, so it could silently return an incomplete list and slip past the network cap.
  - **Fix:** with a sane `totalRows` (a non-negative safe integer on page 1), the walk keeps going past short pages until the raw count reaches it, so a controller-capped page size is read completely.
  - An empty page before the total, a `totalRows` that changes, a non-empty page that adds no new id, or the 50-page cap all set `truncated`. Without `totalRows`, the old short-page rule stays, and the no-progress rule now applies there too.
  - **Callers:** a truncated network catalog, or a complete one over 128 networks, is the explicit error `networkListIncomplete`. AP groups map to `groupListIncomplete` / `apGroupsMismatch`. Sites use the flag only in the `siteNotFound` diagnostic.
- **Should-fix:** bound AP-group ids accepted any 1–128 character string.
  - **Fix:** they now pass `isApGroupId()` (reusing `AP_GROUP_ID_REGEX` from `ap-group-policy.ts`). One bad id, in either the bindings or the detail's `apGroupIds`, drops the whole list, and the scope becomes unknown.
  - SSID ids keep a looser rule (`SSID_ID_REGEX`). The JSDoc gives the reason: the ops doc gives no format, and an SSID id never grants a scope. The smoke stub uses the same rules.
- **Revert checks:** reverting the pagination fix made 9 tests fail; reverting the id rule made 5 fail. Both files were restored byte-identical (`cmp` + shasum). Fixed by an opus worker; the orchestrator re-ran everything.

## Verification (orchestrator, after the review fixes)

- `npm run build`: exit 0.
- `npm test`: 731/731, fail 0 (was 675 before 17a; 719 after the phase worker).
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke`: 167/167. The smoke prints stack traces for its deliberately malformed IPC calls, which is expected.
- `ELECTRON_PATH=… npm run tls-probe`: 25/25.
- The compiled preload requires only `electron`; `fd -H "conflicted copy"` found nothing.

## Decisions and deviations

- **One failure fails the whole read.** If one network's detail or bindings call fails, the read returns `requestFailed` rather than marking just that network unknown. Riskiest live assumption: if the bindings call errors for "All access points" networks on the real controller, the 17b view fails every time. Phase 20 must check this first; 17b must show the error state with Retry, never a partial list.
- **Strictness of the bindings answer:** a structurally broken entry (not an object, or an id that isn't a string) rejects the answer as `malformedResponse`. Only string ids that fail the 24-hex rule give an unknown scope.
- **More rows than `totalRows`** still counts as complete, because the existing 15a/17a tests expect that. If one SSID is added and another deleted during the read, `totalRows` stays the same, so counting rows can't detect it.
- **Not in the DTO:** hidden/broadcast, guest and VLAN, because they weren't in the required list. 18/19 may add them.

## Unverified live — add to the phase 20 checklist

1. Which list field carries the enabled state (`ssidEnable` or `description`), per the §5 fallback.
2. Whether the list's `chooseDevices` means the same as the detail's.
3. Whether the v1 detail returns the passphrase in clear, masked, or not at all (the source of `hasPassphrase`).
4. What the bindings call returns for "All access points" networks: an error, empty, or every group.
5. Whether the detail's `apGroupIds` and the bindings call agree.
6. Whether `band` uses only bits 1/2/4.
7. Whether `id` and `ssidId` are equal.
8. Whether only security codes 0 and 2–5 occur.
9. Whether a 128-network cap is enough, and how long the ⌈N/100⌉ + 2N sequential requests take on a real site.
10. Whether the controller caps the page size below the requested one (now read completely either way).
