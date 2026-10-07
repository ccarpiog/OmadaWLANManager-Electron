# Phase 14b — view states, read-only banner, responsive layout, keys (2026-10-07)

- **Plan item:** `todo.md` 4.7, second half (split recorded there on 2026-10-07). Spec: `docs/management-design.md` §4.6 and §4.7.
- **Risk:** routine. **Workers:** opus (phase), opus (review fixes). Run under `/autoclaude-opus`.

## Acceptance criteria and evidence

| Criterion | Met | Evidence |
|---|---|---|
| Every §4.6 state across Access points, AP groups and Wi-Fi networks (first run, disconnected, initial loading, refreshing, no data vs no results, initial-load error with Retry + Settings, refresh error with stale data + time) | yes | `view-state.ts` / `content-state.ts` / `notices.ts`; smoke checks for first run, disconnected, connect failure inline, initial-load error + Retry recovering, refresh notice + Retry |
| Read-only banner with reason, driven from one function | yes | `readOnlyReason()` in `view-state.ts` (`managementNotConfigured` on 6.3+, `legacyController` below); smoke: 6.3, legacy (es), legacy (en) |
| §4.7 breakpoints (≥1000 full sidebar + split; 800–999 icon sidebar + split; 700–799 top switcher + single-pane drill-in with Back); min window 700×500 | yes | `styles.css` + `layout.ts`; smoke at 1200, 900, 720 px and 700×500, no horizontal overflow |
| Cmd/Ctrl+F focuses the current view's search; Escape: clear search → exit edit mode (stub) → close top dialog | yes | `keyboard.ts` + pure `escapeAction()`; smoke incl. a dialog on top |
| All existing checks keep passing | yes | 8 existing smoke checks adapted where the spec changed what they assert (see Deviations) |
| `npm run build`, `npm test`, smoke, tls-probe exit 0 | yes | see Verification |

## What was built

- `view-state.ts` (pure): `contentState()` — first run / disconnected / loading / initial-load error / ready, data always winning; `readOnlyReason()`; `escapeAction()`. Unit tests in `tests/unit/renderer-view-state.test.ts`.
- `content-state.ts`: draws the state in each view's main list with exactly one action (Configure connection, Connect to controller, or Retry + Settings on a persistent `role="alert"` error kept in `state.loadError`); skeleton rows (`role="status"`) on first load and every connect.
- `notices.ts`: the refresh-error notice ("Couldn't refresh the data. Showing the data from hh:mm." + Retry, from `state.refreshError`) with an amber stale dot on "Updated hh:mm"; the read-only banner on the AP groups and Wi-Fi networks views only (moves are never read-only).
- `layout.ts`: breakpoint handling; below 800 px panes not shown are `is-offstage` (hidden with `visibility` in one grid cell so scroll offsets and Back history survive); drill-in Back buttons on the destination picker, AP details, and group / network details; focus moved into the shown pane on drill-in, Back and breakpoint crossings.
- `keyboard.ts`: one document key handler replacing the settings-only Escape listener; the move, site and certificate dialogs keep their own listeners; Cmd/Ctrl+F ignored while a dialog is open.
- Sidebar: icons added, full width 188 → 212 px; compact icon + count sidebar (labels visually hidden, tooltips) at 800–999 px. Header Connect disabled until a controller is configured. 7 new i18n keys (es/en).

## Decisions

- Read-only banner shown only on the AP groups and Wi-Fi networks views: AP moves use the internal API and are never read-only (spec D1).
- Escape's "exit edit mode" step is a stub (`isEditModeActive()` / `exitEditMode()`) for phases 16–19.
- Single-text-field searches (groups, networks, destination) keep "Clear search"; only the AP list (several filters) says "Clear filters".
- Default window stays 900×650 (the window-size smoke pins it), so a new window lands on the icon sidebar. Open question for the user: raise the default width to ~1100 px to show the full sidebar.

## Deviations

- 8 existing smoke checks adapted: 700×500 opens the destination picker before checking it; a connect failure shows the inline error instead of "connect to see…"; the English URL-change check expects skeletons instead of the hint; the 14a "no edit controls" probe ignores the new Back buttons.
- A connect / first-load failure now reads "Error loading data from the controller" instead of "Connection error".
- At narrow widths, a group or network selected at a wider width opens straight into its detail.

## Review

- Codex, `docs/reviews/phase14b.md`, ship-with-fixes, 0 blockers, 2 should-fixes, both fixed by an opus worker:
  1. Below 800 px a fully successful move left focus in the hidden AP list → the destination picker now closes (as its Back does) before focus falls back to the list's Tab stop; partial failure and Enter-on-radio paths unchanged.
  2. Leaving single-pane mode could hide a focused drill-in Back button → `layout.ts` relocates hidden focus in both directions (picker Back → its search; "Choose destination" → AP list; AP details Back → "Close details" and the reverse; group / network Back → the selected list item). Chromium can blur the hidden element before the media-query event, so `layout.ts` remembers an element that just lost focus by being hidden.
- Two new smoke checks cover both paths (the move check was confirmed to fail with the fix disabled).

## Verification (orchestrator, after the review fixes)

- `npm run build` — exit 0
- `npm test` — exit 0, 452/452
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — exit 0, 122/122 (was 109 before the phase)
- `ELECTRON_PATH=… npm run tls-probe` — exit 0, 21/21
- `rg -n "innerHTML|insertAdjacentHTML|\.style\." src/renderer` — no matches; `fd -H "conflicted copy"` — no matches (the worker removed one stale `connection.ts` conflicted copy)

## Leftovers (none blocking)

- Default window 900×650 lands on the icon sidebar (see Decisions).
- The read-only banner's "Settings → Management access" section does not exist until phase 15.
