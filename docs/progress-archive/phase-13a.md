# Phase 13a — app shell + Access points list (2026-10-06)

- **Scope:** first half of `todo.md` item 4.6 (phase 13). The orchestrator split phase 13 before starting: 13a = shell + sidebar + Access points list with multi-select; 13b = always-visible destination pane, review dialog, sequential bulk move with per-AP results and Retry failed. The split is recorded in `todo.md` 4.6.
- **Risk:** high. **Workers:** opus (phase worker), opus (review-fix worker).

## What was built

- **Header (`shell.ts`):** site name, controller host, connection state as text + colour ("Connected"/"Conectado"), "Updated hh:mm", "Omada <controllerVersion>", Refresh. Refresh keeps the rows on screen with a "Refreshing…" state; a failed refresh keeps the old data and the previous time (the failure now logs `console.warn`, not `console.error`, so the smoke's zero-console-errors check can exercise it).
- **Sidebar:** Access points / AP groups (legacy wording via `tGroup()`) / Wi-Fi networks as native buttons with **total** counts (APs; groups incl. empty ones; distinct SSID names), `aria-current="page"` on the active view, Settings at the bottom. AP groups and Wi-Fi networks show a translated placeholder until phase 14.
- **Access points list (`ap-list.ts`, pure logic in `ap-selection.ts`):** native checkboxes (the AP list's `role="listbox"`/`option` simulation is gone; the group panel keeps it until 13b), status text + colour, AP name, group, network count, optional client count. Row click toggles; Shift-click and Shift+Arrow ranges; "Select all N filtered APs"; "Clear selection"; an `aria-live` "3 selected (1 hidden by filters)" summary. New status and group filters (spec §4.3 shows them; only search existed) plus "Clear filters" when nothing matches.
- **Moves:** the existing confirm → `OMADA_SET_WLAN` flow now moves the whole selection one AP at a time, hidden APs included; APs that fail stay selected so Apply retries them (13b replaces this with a per-AP result list and Retry failed).
- **Main process:** only `validateAccessPoints()` gained an **optional** `clientNum` (absent → no count shown), with fixture cases.
- **Housekeeping:** "Access points"/"Puntos de acceso" wording; the four stale `renderer.ts` comments in `index.html`/`styles.css` fixed; `tFormat()` no longer mangles `$&`-style sequences in substituted names; README updated.

## Review

- Codex, `docs/reviews/phase13a.md`: ship-with-fixes, 1 blocker + 1 should-fix, both fixed by an opus worker before commit:
  - **Blocker:** the move confirmation focused Confirm, so Enter, Enter committed a bulk move. The shared confirm dialog (only caller: `apply-change.ts`) now focuses Cancel, with `aria-describedby` on the message. The smoke asserts Cancel is focused and visible and that Enter right after opening cancels with no `OMADA_SET_WLAN` call; the keyboard-only move Tabs to Confirm.
  - **Should-fix:** a range anchor hidden by a filter broke Shift-click forever. The pure `planRangeSelection()` makes the target the new anchor when the old one is not visible; used by Shift-click and Shift+Arrow; 6 unit tests + a smoke regression.

## Verification (orchestrator, after the fixes)

- `npm run build` exit 0
- `npm test` 357/357 (was 327 before the phase)
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` 83/83 (was 58), zero console errors
- `npm run tls-probe` (same `ELECTRON_PATH`) 21/21 — its e2e waits follow the new header and row markup
- `rg "innerHTML|insertAdjacentHTML|\.style\.|style=" src/renderer` empty; `fd -H "conflicted copy"` empty

## Deviations / open items

- **Site name:** the renderer only learns it from a pick in the site modal; single-site controllers and a remembered site show the host only. Needs main to return the site name (fits the phase 15 `ControllerSession` facade).
- **`clientNum`:** field name from the Open API device docs, unverified against the internal API on a live controller (optional, so harmless if absent) — add to the phase 20 live checklist.
- **AP details pane** (row click → effective networks, link to group) deferred to phase 14 (noted in `todo.md` 4.7); in 13a a row click toggles the checkbox.
- Dropbox produced conflicted copies (and once hid `run-smoke.mjs` under a conflicted name) during both workers' edits; each worker restored the newest complete copy; the final tree has none.
