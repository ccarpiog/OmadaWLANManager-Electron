# Phase 14a — read-only AP groups & Wi-Fi networks views, cross-navigation, AP details (2026-10-07)

- **Scope:** todo.md item 4.7, first half (the item's **Split** bullet). Phase 14 was split before starting: 14a = the read-only views, cross-navigation and the AP details pane; 14b = the §4.6 states, the read-only banner, the §4.7 responsive breakpoints, Cmd/Ctrl+F and the Escape order.
- **Risk:** routine. **Workers:** opus (phase), opus (review fixes). Run under `/autoclaude-opus`.

## What was built

- **AP groups view** (`groups-view.ts`): list with AP and network counts, its own search, and a detail with linked APs and networks. Groups without networks carry the §4.1 "No Wi-Fi networks — silences these APs" label as the Empty badge. A **Default** badge appears only when `setting/wlans` reports `primary: true` (`validateGroupList()` keeps it as the optional `WlanGroup.isDefault`; same response, no new request). Per-band capacity is left out: `setting/wlans` has `remainingBinding`, but the app does not keep it yet (phase 16).
- **Wi-Fi networks view** (`networks-view.ts`): one entry per distinct network name, scope "N groups · M APs", its own search, a detail with linked groups and APs. Security, bands and enabled state are stated as needing management access.
- **AP details** (`ap-details.ts`): a row click (or Enter on the checkbox) opens the pane in the destination pane's place; "Close details" brings the destination pane back. Only the native checkbox toggles selection now; ranges, Space and select-all unchanged.
- **Override badges:** stated as unavailable, no new IPC. The findings doc names `ssidOverrides[]` on `GET eaps/{mac}` but not its element fields, so a validator would have to guess the shape (recorded in `todo.md`).
- **Back** (`nav-history.ts`, `navigation.ts`): "Back to …" restores the previous view, selection, search, scroll and focus; sidebar navigation clears the history.
- Pure view models in `inventory-model.ts`; DOM helpers in `inventory-ui.ts`; `ap-status.ts` and `ap-focus.ts` split out of the list code.

## Review

- Codex, `docs/reviews/phase14a.md`: **ship-with-fixes**, 0 blockers, 2 should-fixes, both fixed by an opus worker:
  1. Network scope presented a lower bound as an exact AP count (APs whose group is missing, unlisted or shares its name were dropped). Now each network also counts the APs that *may* broadcast it and shows "at least M APs" / "AP count unknown" plus how many APs' groups cannot be identified; "No APs" never appears while such APs exist. A shared-name group's APs are never listed as definite broadcasters.
  2. Back history kept targets a refresh removed. A pure reconciliation in `nav-history.ts` runs after every successful load: drops entries whose AP/group/network is gone, updates renamed labels, merges neighbouring duplicates and drops top entries pointing where the user already is.
- Side effect: the standard smoke fixtures include an AP with no group (Bodega), so "Casa" reads "at least 4 APs". The "single move → Close" smoke check now counts loads relative to the move instead of an absolute 2.

## Verification (orchestrator, after the fixes; all exit 0)

- `npm run build`
- `npm test` — 438/438 (398 before the phase)
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 109/109 (92 before)
- `ELECTRON_PATH=… npm run tls-probe` — 21/21
- `rg "innerHTML|insertAdjacentHTML|\.style\." src/renderer` — no hits; `dist/main/preload.js` requires only `electron`; `fd -H "conflicted copy"` — none

## Leftovers (none blocking)

- In the Access points list, an AP whose group name is shared still shows the network count of the first group with that name (pre-existing since 13a).
- The 13b review dialog says the internal API "does not report" overrides, but `eaps/{mac}` does return `ssidOverrides[]`; the smoke asserts that exact text. Reword when overrides get a validated shape.
- Dropbox renamed or removed files mid-run twice (`inventory-model.ts`, `renderer-nav-history.test.ts`); both restored, no conflicted copies remain.
