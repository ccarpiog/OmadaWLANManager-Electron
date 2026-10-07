# Review brief — phase 16b (todo 4.9, second half): AP group management UI

- **Repo:** /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron (Electron 44, TypeScript 7, renderer bundled by esbuild). Review the **uncommitted** working tree against `HEAD` (`ea83c4f`).
- **Review file:** `docs/reviews/phase16b.md`
- **Time budget:** 15 minutes.

## Goal

Renderer UI on top of the phase-16a main-side AP-group operations (Open API create / rename / delete behind guarded IPC). Spec: `docs/management-design.md` §4.1, §4.4, §4.6–§4.7; plan: `todo.md` item 4.9; 16a channels, DTO, policy codes and stub knobs: `docs/progress-archive/phase-16a.md`.

- New group / Rename / Delete in the AP groups view **only** when management capabilities are on; otherwise the existing `readOnlyReason()` banner explains it and no write action shows.
- Delete disabled with a visible reason mapped from the 16a policy codes, behind a confirmation dialog. Every 16a error code mapped to es + en text. Client-side name check mirrors `src/main/ap-group-policy.ts`; main stays authoritative.
- Groups whose id is not 24 hex digits get no write actions (mirrors `src/main/ipc-guards.ts`).
- Per-band capacity from `getManagedApGroups()` (session nonce), absent fields shown as "not reported"; late replies from an old session / nonce / read discarded.
- "Move access points here" reuses the phase-13 internal-API move flow (`OMADA_SET_WLAN`), never the Open API.
- After each successful write: reload data, capabilities and the managed list; focus restored sensibly.

## Changed files

New: `src/renderer/group-management.ts` (pure: availability, name check, reply validation, code → message key), `managed-groups.ts` (managed-list fetch + stale-reply discard), `group-dialog.ts`, `group-flow.ts`, `tests/unit/renderer-group-management.test.ts`.
Modified: `src/renderer/{groups-view,management,connection,move-flow,state,elements,i18n,apply-translations,modal-focus,renderer,keyboard,view-state,validation}.ts`, `index.html`, `styles.css`, `tests/smoke/run-smoke.mjs`, `tests/fixtures/smoke/ui-strings.json`, `README.md`, `todo.md`.

## Verification already run (orchestrator, all exit 0)

- `npm run build` — exit 0
- `npm test` — 664/664 (was 638)
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 162/162 (new 6th `[groups]` launch). Stack traces printed by 16a's deliberately malformed IPC calls are expected.
- `npm run tls-probe` (same `ELECTRON_PATH`) — 25/25
- Compiled preload requires only `electron`; no `innerHTML` in `src/renderer`; no Dropbox conflicted copies.
- **Do not contact any real controller or touch `~/.omada-wlan-manager/`** (user decision D4). If you run the smoke, it uses a temp HOME already.

## Known deviations (the worker's own report — judge whether they matter)

1. Delete for the **default** group is shown disabled with a reason; spec §4.4 says *hidden*.
2. The master-list **Capacity warning** badge (spec §4.4) is not implemented.
3. No MLO "remaining" value is ever shown: the 16a DTO has no MLO field for it.
4. Two existing smoke checks adapted: the 14a "no edit controls" check now expects exactly the Move-here button (shown even without management, since moves use the internal API); the `[caps]` bridge check skips the managed-list reads the renderer makes on its own.

## Risks to probe

- Write actions leaking when management is off, checking, or the capability flips mid-dialog / mid-write; stale capability or managed-list replies after reconnect, site change, URL change or cert reset applied to the new session.
- Double submit; buttons not re-enabled after an error; dialog state surviving a disconnect.
- Code → text mapping gaps (any 16a code that falls through to a generic or raw message; es/en asymmetry).
- Name check drift from `ap-group-policy.ts` (length counted in code units vs code points, bidi/control ranges, case-insensitive duplicate rule).
- Focus and `inert` handling (modal-focus pattern), Escape order, < 800 px single-pane drill-in, no horizontal overflow at 700×500.
- "Move access points here": wrong destination when group names are duplicated; ever touching the Open API.
- No `innerHTML`, no inline styles; JSDoc on every function; closing-bracket comments on >10-line functions/loops (project convention).
