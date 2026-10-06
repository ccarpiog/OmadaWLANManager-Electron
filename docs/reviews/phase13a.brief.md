# Review brief — phase 13a (app shell + Access points list)

- **Repo:** omada-electron (Electron 44 + TypeScript 7, esbuild-bundled renderer). Review the **uncommitted** working tree against `HEAD`.
- **Phase / goal:** phase 13a, the first half of `todo.md` item 4.6. New global shell (header with site, connection state, "Updated hh:mm", controller version, Refresh; left sidebar with Access points / AP groups / Wi-Fi networks and total counts, placeholders for the last two views) and an Access points list with native checkbox multi-select, Shift-click and Shift+Arrow range selection, "Select all N filtered", and a selection that survives filtering ("N selected (M hidden by filters)"). The existing confirm → `OMADA_SET_WLAN` move flow now applies to the whole selection, including hidden APs, one AP at a time. Phase 13b (destination pane, review dialog, per-AP results + Retry failed) is NOT in scope.
- **Spec:** `docs/management-design.md` §4.1–§4.3, §4.6, §4.7.
- **Changed files:** `src/renderer/{ap-selection.ts (new), shell.ts (new), ap-list.ts, apply-change.ts, apply-translations.ts, connection.ts, dom-helpers.ts, elements.ts, i18n.ts, index.html, panels.ts, renderer.ts, state.ts, status.ts, styles.css}`, `src/shared/types.ts`, `src/main/omada-validators.ts` (optional `clientNum`), `tests/unit/renderer-ap-selection.test.ts (new)`, `tests/smoke/{run-smoke.mjs, stub-main.cjs}`, `tests/tls-probe/run-tls-probe.mjs`, `tests/fixtures/…`, `README.md`, `todo.md`. `PROGRESS.json` is a workflow record — ignore it.
- **Verification run by the orchestrator:** `npm run build` exit 0; `npm test` 351/351 pass; `npm run smoke` (stubbed main, temp HOME) 81/81; `npm run tls-probe` 21/21; `rg "innerHTML|insertAdjacentHTML|\.style\.|style=" src/renderer` empty.
- **Risks to probe:**
  1. Bulk move over the selection: correctness when the selection contains APs hidden by filters, APs already in the destination group, or APs that disappeared after a refresh; partial failure handling (failed APs stay selected); interaction with `sessionGeneration` / `isOperationInProgress()` guards (disconnect, refresh, URL change mid-move).
  2. Selection state across refresh/disconnect/reconnect/site change — stale MACs, selection of APs no longer present, counts wrong.
  3. Range selection and keyboard logic (`ap-selection.ts`): anchor handling across filter changes, Shift+Arrow at list ends, focus management after re-render.
  4. Refresh semantics: stale data kept and "Updated" time preserved on failure; any race between refresh and a move.
  5. `clientNum` validator change must stay optional and must not reject payloads lacking it.
  6. Accessibility: native checkboxes, `aria-live` count, `aria-current` on nav; es/en parity for every new string; CSP-safe DOM building.
  7. `tFormat()` change (`$&` handling) — confirm it is correct and not a regression.
- **Review file:** `docs/reviews/phase13a.md`.
- **Time budget:** 15 minutes.
