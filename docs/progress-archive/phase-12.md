# Phase 12 — Omada 6.3 correctness & terminology (todo 4.5) — 2026-10-06

- **Risk:** routine. **Worker:** opus (one phase worker, no corrective round).
- **Run:** `/autoclaude-opus`, driven mode.

## What was built

- **Controller version.** `connect()` keeps `controllerVer` from `/api/info`. The new pure module `src/main/controller-version.ts` (`describeController()`) maps it to a `ControllerInfo` of `{controllerVersion, groupModel}`. Version 6.3 or later gives `groupModel: 'apGroup'`. Older, missing, non-string or unparseable versions give the defensive legacy `'wlanGroup'` (spec §2.2).
- **Group list.** `OmadaController.getWlanGroups()` now returns a `GroupListing` of `{controllerVersion, groupModel, groups}` on the existing IPC channel, so the list and its wording always arrive together. It requests `GET setting/wlans` (the authoritative list, empty groups included) and `GET setting/ssids` in parallel. `validateGroupList()` and `joinGroupsWithSsids()` in `omada-validators.ts` then outer-join the SSID names onto the list. Entries whose `deviceType` is present and not `ap` are dropped; untagged entries count as APs. SSID entries whose group id is missing from `setting/wlans` are ignored, with a `console.warn`.
- **Legacy fallback (documented on `getWlanGroups()`).** On 6.3+, `setting/wlans` is required, and a failure fails the load rather than silently hiding the empty groups. On a legacy or unknown version it is tried, and on any failure (request error, errorCode such as -1600, or a rejected shape) the list falls back to the pre-6.3 source, the groups `setting/ssids` reports. `setting/ssids` is required in both models.
- **AP moves** are unchanged (internal `PATCH eaps/{mac} {wlanId}`). Empty groups are now valid move targets.
- **Wording** (spec §4.1), es + en: "Grupos de AP"/"AP groups" on 6.3+, "Grupos WLAN (heredado)"/"WLAN groups (legacy)" below. Empty groups read "Sin redes Wi-Fi — silencia estos AP"/"No Wi-Fi networks — silences these APs". Before connecting and after a disconnect, the UI shows the 6.3 wording. The renderer stores `controllerVersion` but does not display it yet.
- README and the `package.json` description are updated. The spec's §2.2 sentence "today it is discarded" was corrected by the orchestrator.

## Tests

- New fixtures: `tests/fixtures/controller/groups-6.3.json` (6.3 payload with an empty group), `groups-legacy.json`, `tests/fixtures/validators/group-list.json`.
- New `tests/unit/controller-version.test.ts`. The validator and controller tests cover the join (empty group, groups with SSIDs, an SSID for an unknown group, a non-AP entry dropped, malformed payloads rejected) and the legacy fallback.
- Smoke: the stub serves the new `GroupListing` shape. The new checks show an empty group rendered, selectable and usable as a move target (the confirm modal opens), plus legacy wording on a legacy fixture. The TLS-probe fake controller answers `setting/wlans`.

## Verification (orchestrator re-run, all exit 0)

- `npm run build`
- `npm test`: 327/327 (was 246)
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke`: 58/58 (was 52)
- `ELECTRON_PATH=… npm run tls-probe`: 21/21
- Compiled `dist/main/preload.js` requires only `electron`. `rg innerHTML|insertAdjacentHTML src/renderer` finds nothing. `fd -H "conflicted copy"` finds nothing. A Dropbox conflicted copy of `omada-api.ts` appeared mid-edit; the worker kept the newest copy.

## Review

- Codex, `docs/reviews/phase12.md` (brief: `docs/reviews/phase12.brief.md`): **ship**, with 0 findings, 0 blockers and 0 should-fix.

## Deferred to later phases

- The "Access Points" panel title is unchanged. The spec's "Access points"/"Puntos de acceso" wording belongs to the phase 13 shell.
- `controllerVersion` is not shown in the UI yet. Phases 13 and 14 can surface it (site and connection state).
