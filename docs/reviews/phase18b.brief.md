# Review brief — phase 18b (todo 4.11, second half): Wi-Fi network editing UI

- **Repo:** /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron (Electron 44, TypeScript 7, renderer bundled by esbuild). Review the **uncommitted** working tree against `HEAD` (`a5c3e02`).
- **Review file:** `docs/reviews/phase18b.md`
- **Time budget:** 20 minutes.

## Goal

Renderer UI on top of the phase-18a main-side Wi-Fi network writes (bridge `createNetwork`, `updateNetwork`, `changeNetworkPassword`, `setNetworkEnabled`, `deleteNetwork`; reply `NetworkActionResult`; codes `NetworkOperationError`). Spec: `docs/management-design.md` §3, §4.5, §5 (user decision D3: edit only Open + WPA-Personal; Enterprise / PPSK view / enable / bind / delete only). Plan: `todo.md` item 4.11 (incl. "Done (18a)" and the new "Done (18b)"). 18a codes and derivation table: `docs/progress-archive/phase-18a.md`. The UI write pattern it follows: phase 16b (`group-management.ts`, `group-dialog.ts`, `group-flow.ts`).

- Actions only while `networkManagementOn()` holds — hidden while management is off, a capability re-check runs, on legacy controllers or with a read-only reason; capability re-checked right before each write, failing closed.
- **New network**: name, Open / WPA-Personal, passphrase, bands, AP groups (≥ 1); created disabled; optional "Enable after creating" (create, then `setNetworkEnabled` only with the id main returned). Client pre-checks mirror `src/main/wifi-network-write.ts` (SSID 1–32 UTF-8 bytes, forbidden characters, passphrase 8–63 printable ASCII, never trimmed); an open 6 GHz create is explained up front (main refuses it as `securityBandConflict`).
- **Edit** (Open / WPA-Personal only): staged name / security / bands, review step, Cancel discards, nothing sent before confirm, `nothingToChange` handled, every save whose result is WPA-Personal needs the re-typed passphrase; the PMF-mandatory → capable note when bands change.
- **Change password** (WPA-Personal only), **Enable / Disable** (all modes, with impact), **Delete** (all modes, impact summary: scope, bound groups, APs; focus on Cancel).
- Enterprise / PPSK / unknown security: no Edit / Change password, a visible explanation.
- Every 18a code mapped to es + en text; main's codes-only diagnostic as secondary text; `securityBandConflict` names its field from `conflict: <field>`.
- After a write: one exclusive write at a time, reload data + capabilities + the managed list, toast, focus restored.
- **Passphrase hygiene**: password inputs only, never prefilled or echoed, cleared on every close path; never in toasts, logs, DOM text, long-lived state or `console.*`.

## Changed files

New: `src/renderer/network-editing.ts` (pure rules), `network-dialog.ts`, `network-flow.ts`, `i18n-strings.ts` (the es/en tables moved out of `i18n.ts` so unit tests can read them), `tests/unit/renderer-network-editing.test.ts`.
Modified: `src/renderer/{i18n,managed-networks-view,networks-view,management,state,elements,modal-focus,apply-translations,renderer,keyboard,view-state,group-management}.ts`, `index.html`, `styles.css`, `tests/smoke/run-smoke.mjs` (new 8th launch `[netedit]`, es then en), `tests/fixtures/smoke/ui-strings.json`, `README.md`, `todo.md`. No main-process change.

## Verification already run (orchestrator, all exit 0)

- `npm run build` — exit 0
- `npm test` — 897/897 (was 858)
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 213/213 (was 183). Stack traces from 16a/18a's deliberately malformed IPC calls are expected.
- `npm run tls-probe` (same `ELECTRON_PATH`) — 25/25
- Compiled preload requires only `electron`; no `innerHTML` in `src/renderer`; no Dropbox conflicted copies.
- **Do not contact any real controller or touch `~/.omada-wlan-manager/`** (user decision D4). The smoke already uses a temp HOME.

## Known deviations (the worker's own report — judge whether they matter)

1. The es/en string tables moved from `i18n.ts` to a new DOM-free `i18n-strings.ts`; `i18n.ts` keeps the helpers plus a new `translate()`.
2. `applyCapabilities()` in `management.ts` now also awaits the managed network list, so the 16b AP-group post-write reload waits for it too.
3. Edit is a two-step dialog, not an in-view edit mode; the 14b Escape edit-mode stub stays unused.
4. The managed scope text is now one pure function shared by the list and the impact summaries.
5. In `[nets]`, the "no edit control" check now expects exactly New network plus Delete and two notes on an Enterprise / PPSK network.
6. When the enabled state is unknown, Enable / Disable is hidden with a note.

## Risks to probe

- A passphrase surviving a dialog close on any path (Escape, Cancel, Back from review, failure, success, a capability re-check or disconnect while open, re-opening the dialog), or reaching a toast, log, `console.*`, state or DOM text.
- Write actions reachable while management is off / re-checking / superseded (stale buttons left in the DOM, a dialog left open across a session change, a write sent with an old session nonce).
- The staged edit sending something other than what the review showed; a WPA-Personal save without a typed passphrase; Cancel or Back still sending; "Enable after creating" enabling a network other than the created one, or acting when no id came back.
- Two writes overlapping (double-click, Enter + click), and the post-write reload racing a stale managed-list reply.
- Regressions in the 16b AP-group flow from deviation 2, and in the 17b managed view (stale-list rules, Back history, typed keys).
- Wrong or missing es / en text for any `NetworkOperationError` code; impact summaries stating a lower bound or an unknown scope as exact.
- Client pre-checks disagreeing with `src/main/wifi-network-write.ts` at the boundaries (32 bytes, 4-byte characters, 8 / 63 characters, spaces).
