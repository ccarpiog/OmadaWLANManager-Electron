# Phase 12 review brief — Omada 6.3 correctness & terminology (todo.md 4.5)

- **Repo:** /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron (branch `main`, change is UNCOMMITTED in the working tree; review `git diff` + untracked files)
- **Review file:** `docs/reviews/phase12.md`
- **Time budget:** 15 minutes

## Goal
Implement todo.md item 4.5: keep `controllerVer` from `/api/info` and derive `groupModel` (6.3+ "AP groups" vs legacy "WLAN groups"); load the authoritative group list from internal `GET setting/wlans` (includes EMPTY groups, e.g. `zNinguna`, used to silence APs) and outer-join SSID names from `GET setting/ssids`; ignore entries whose `deviceType` is not an AP type; switch vocabulary (es + en) "AP groups" vs "WLAN groups (legacy)"; update README and package.json description. AP moves keep the existing internal `PATCH eaps/{mac} {wlanId}` path. Spec: `docs/management-design.md` §2.2, §2.3, §4.1; API facts: `docs/omada-6.3-api-findings.md`.

## Changed files
- New: `src/main/controller-version.ts`, `tests/unit/controller-version.test.ts`, `tests/fixtures/controller/groups-6.3.json`, `tests/fixtures/controller/groups-legacy.json`, `tests/fixtures/validators/group-list.json`
- Modified: `src/main/{omada-api,omada-validators,index,preload}.ts`, `src/shared/types.ts`, `src/renderer/{i18n,state,panels,apply-translations,ap-list,wlan-list,connection,validation}.ts`, tests (`tests/unit/*`, `tests/fixtures/*`, `tests/smoke/{stub-main.cjs,run-smoke.mjs}`, `tests/tls-probe/fake-controller.mjs`), `README.md`, `package.json`, `todo.md`
- Ignore `PROGRESS.json` (workflow record).

## Design choices the worker made (scrutinize)
- `getWlanGroups()` now returns `{controllerVersion, groupModel, groups}` over the existing IPC channel (not via the connect result).
- Unknown/missing/unparseable `controllerVer` → legacy `wlanGroup` model.
- On 6.3+ a failing `setting/wlans` fails the whole load; on legacy/unknown it falls back to the old `setting/ssids`-derived list.
- `deviceType` present and not `ap` → dropped; entries without `deviceType` count as APs.
- Before connect / after disconnect the UI shows 6.3 "AP groups" wording.

## Verification already run (orchestrator, all exit 0)
- `npm run build`
- `npm test` — 327/327
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 58/58
- `ELECTRON_PATH=… npm run tls-probe` — 21/21
- compiled `dist/main/preload.js` requires only `electron`; no `innerHTML` in `src/renderer`; no Dropbox conflicted copies

## Risks to focus on
1. Correctness of the outer join and validators against the real 6.3 payload shapes documented in `docs/omada-6.3-api-findings.md` (field names, `deviceType` values, ids), incl. SSIDs whose group is missing from `setting/wlans`.
2. Version parsing / `groupModel` derivation edge cases (e.g. "6.3.0.45", "6.10", "5.15.24.17", non-string, garbage).
3. Legacy fallback: does a legacy controller still work exactly as before? Can the 6.3 path silently hide empty groups?
4. Renderer: stale-session generation checks still guard the new payload; wording switches correctly on connect/disconnect/refresh; es/en parity; no unsafe DOM.
5. Smoke stub / tls-probe fake fidelity vs. real shapes (do tests prove what they claim?).
6. No contact with real controller / real `~/.omada-wlan-manager/` in any test.

Do not suggest work belonging to later phases (sidebar shell = phase 13, Open API = phase 15, group management = phase 16).
