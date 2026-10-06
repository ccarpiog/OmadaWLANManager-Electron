# Review brief — phase 13b (todo 4.6, second half)

- **Repo:** /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron (Electron 44 + TypeScript 7; renderer is an esbuild bundle of `src/renderer/*.ts`).
- **Review the uncommitted working tree** against `HEAD` (`git diff`, plus the untracked files listed below).
- **Review file:** `docs/reviews/phase13b.md`. **Time budget:** 15 minutes.

## Phase goal

Replace phase 13a's old group panel (listbox), footer "Apply change" bar and confirm modal with:
an always-visible destination pane (native radios, search over group AND SSID names, empty groups
pinned in a "Silence" section), a gains/losses preview for the checkbox selection (filter-hidden APs
included), mixed-selection hints ("N already in this group; M will move", no-op disabled), "Move AP" /
"Move N APs" labels, a review dialog (initial focus on Cancel; source groups → destination; networks
gained/lost/unchanged; clients on moving APs; per-AP overrides stated as unavailable, never invented),
and a sequential bulk move (`OMADA_SET_WLAN` → `PATCH eaps/{mac}`, one at a time) with per-AP results
and "Retry failed". Spec: `docs/management-design.md` §4.1, §4.3, §4.7; scope: `todo.md` item 4.6.

## Changed files

- New: `src/renderer/move-plan.ts` (pure plan/preview/result logic), `move-text.ts`, `destination-pane.ts`, `move-dialog.ts`, `move-flow.ts`, `ap-filters.ts`, `tests/unit/renderer-move-plan.test.ts`.
- Deleted: `src/renderer/wlan-list.ts`, `confirm-modal.ts`, `apply-change.ts`.
- Modified: `src/renderer/{ap-list,ap-selection,apply-translations,cert-modal,connection,dom-helpers,elements,i18n,modal-focus,panels,renderer,site-modal,state}.ts`, `index.html`, `styles.css`; `tests/smoke/run-smoke.mjs`, `tests/smoke/stub-main.cjs`, `tests/fixtures/smoke/ui-strings.json`; `README.md`, `todo.md`. (`PROGRESS.json` is a workflow record — ignore.)

## Verification already run (all exit 0)

- `npm run build`
- `npm test` — 385/385 (28 new)
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 87/87, zero console errors
- `ELECTRON_PATH=… npm run tls-probe` — 21/21
- `rg "innerHTML|insertAdjacentHTML|\.style\." src/renderer` — empty; `dist/main/preload.js` requires only `electron`.

## Risks to probe

1. **Async safety of the bulk move** (`move-flow.ts`): disconnect, refresh, URL change / connection reset, or a session switch mid-loop must stop it and never commit stale results; `sessionGeneration` / `invalidateSession()` / `isOperationInProgress()` guards must still make operations mutually exclusive; the dialog must not be left stuck in "progress".
2. **Correctness of the plan**: APs already in the destination are skipped, not PATCHed; filter-hidden selected APs are included; "Retry failed" re-runs exactly the failed APs; failed APs stay selected, succeeded ones update their group. Duplicate group names (the worker chose to move, not skip, an AP whose current group name another group shares — check this is safe and explained).
3. **Honesty of the preview/review**: networks gained/lost/unchanged derived only from loaded group → SSID lists; client count from optional `clientNum` with missing values stated; no fabricated per-AP override claims.
4. **Accessibility/keyboard**: native radio group arrow keys; Enter on a radio opens the review (a worker addition — check it cannot cause an accidental move); dialog focus trap, Escape = Cancel, background `inert`, opener-focus restore after results/close; `aria-live` summaries.
5. **Deleted modules**: nothing still references the removed confirm modal, its markup or its i18n keys; es/en parity holds.
6. **Smoke coverage**: single move, bulk all-succeed / partial failure → Retry failed / cancel (no PATCH), SSID-name search, Silence section, no-op disabled + mixed hint, keyboard-only move, Cancel initial focus — check the assertions actually test these rather than passing vacuously; existing coverage not silently dropped.
7. **Invariants**: no `innerHTML`/inline styles (CSP `style-src 'self'`); no contact with a real controller; JSDoc on every function; closing-brace comments on blocks > 10 lines; 700×500 layout still usable.
