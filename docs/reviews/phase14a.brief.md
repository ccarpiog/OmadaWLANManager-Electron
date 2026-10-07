# Review brief — phase 14a

- **Repo:** /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron (Electron 44 + TypeScript 7; renderer bundled by esbuild)
- **Phase:** 14a — todo.md item 4.7, first half (see its **Split** bullet). Spec: `docs/management-design.md` §4.1, §4.3 (row click opens AP details), §4.4/§4.5 read-only parts, §4.7.
- **Goal:** replace the phase-13a placeholder "AP groups" and "Wi-Fi networks" views with real read-only views built from already-loaded internal data (group → SSID names; network → groups/APs), cross-navigation with "Back to …" restoring view/selection/search/scroll/focus, and an AP details pane opened by row click (the checkbox alone now toggles selection). Override badges were deliberately NOT implemented (stated as unavailable; the `ssidOverrides[]` element shape is undocumented). Out of scope (phase 14b): §4.6 states, read-only banner, responsive breakpoints, Cmd/Ctrl+F, global Escape order.
- **Review the uncommitted working tree** (`git diff` + untracked files).

## Changed files
- New renderer modules: `src/renderer/nav-history.ts`, `inventory-model.ts` (pure view models), `inventory-ui.ts`, `ap-details.ts`, `groups-view.ts`, `networks-view.ts`, `navigation.ts`, `ap-status.ts`, `ap-focus.ts`
- Modified renderer: `ap-list.ts`, `apply-translations.ts`, `connection.ts`, `elements.ts`, `i18n.ts`, `index.html`, `move-flow.ts`, `panels.ts`, `renderer.ts`, `shell.ts`, `state.ts`, `styles.css`
- Main/shared: `src/main/omada-validators.ts` (`validateGroupList()` keeps `primary: true` as optional `WlanGroup.isDefault`), `src/shared/types.ts`
- Tests: `tests/unit/renderer-inventory-model.test.ts`, `tests/unit/renderer-nav-history.test.ts`, `tests/unit/omada-validators.test.ts`, fixtures under `tests/fixtures/`, `tests/smoke/run-smoke.mjs`
- Docs: `README.md`, `todo.md`

## Verification already run (orchestrator, all exit 0)
- `npm run build`
- `npm test` — 428/428
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 107/107
- `ELECTRON_PATH=… npm run tls-probe` — 21/21
- `rg "innerHTML|insertAdjacentHTML|\.style\." src/renderer` — no hits; `dist/main/preload.js` requires only `electron`

## Risks to focus on
1. Selection/move regressions: the row click no longer toggles the checkbox — check Shift-click / Shift+Arrow ranges, Space, "Select all", and that the destination pane + move flow (13b) still work when the details pane replaces the destination pane, and that closing details restores it.
2. Navigation history correctness: Back restores the right view and selection; stale entries after a refresh/reload or disconnect (APs/groups/networks gone, session change via `sessionGeneration`); sidebar navigation clearing history; focus restoration targets that no longer exist.
3. View-model correctness in `inventory-model.ts`: network identity by SSID name across groups, scope counts "N groups · M APs", empty groups, same-named groups (13b disables them as move targets), legacy (`wlanGroup`) wording, `isDefault` only from `primary: true`.
4. Security invariants: DOM built with `createElement`/`textContent` only (CSP: no inline styles), no new IPC, nothing invented that the data does not support.
5. i18n: es/en parity for every new string; no hard-coded user-facing text.
6. Accessibility per §4.7: native elements, visible focus, `aria-live` where results change, linked rows reachable by keyboard.

## Review file
Write the full report to `docs/reviews/phase14a.md`.

## Time budget
10 minutes.
