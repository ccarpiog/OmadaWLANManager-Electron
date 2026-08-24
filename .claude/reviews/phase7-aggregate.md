# Codex review — Phase 7 aggregate (connection flow & multi-site)

Date: 2026-08-24. Scope: uncommitted working-tree diff implementing todo.md items 1.11 and 3.12. Verbatim Codex output follows.

## Overall verdict

The phase is close, but the plan should **not yet be declared complete**. I found two P2 race/order defects in the new connection flow and one P2 multi-site completeness issue. No P1 findings.

TypeScript passes with `tsc --noEmit`, and `git diff --check` reports no whitespace errors.

## Findings

1. **P2 — [renderer.ts:938](/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron/src/renderer/renderer.ts:938), [renderer.ts:985](/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron/src/renderer/renderer.ts:985), [index.ts:343](/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron/src/main/index.ts:343) — A superseded attempt can disconnect the newer controller.**

   The main process correctly returns `connectionSuperseded` for stale attempt A. However, the renderer handles every unsuccessful result through `abortConnection()`, which unconditionally invokes `OMADA_DISCONNECT`.

   Sequence:

   1. Attempt A starts.
   2. Attempt B starts directly through IPC and eventually installs controller B.
   3. A finishes and receives `connectionSuperseded`.
   4. A’s renderer path calls `abortConnection()`.
   5. `OMADA_DISCONNECT` logs out controller B and increments the main generation again.

   The renderer’s `sessionGeneration` cannot protect this case because it only knows about operations started through its own guarded `connect()` function; it does not know that another main-process attempt superseded A. This undermines the purpose of main-process serialization.

   **Recommended fix:** Treat `connectionSuperseded` as a stale result and reset only the local UI—do not invoke `disconnect()`. More robustly, give each connection a main-process lease/attempt token and make disconnect conditional on ownership of that token.

2. **P2 — [index.ts:351](/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron/src/main/index.ts:351), [index.ts:378](/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron/src/main/index.ts:378), [omada-api.ts:121](/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron/src/main/omada-api.ts:121) — `OMADA_SELECT_SITE` is not restricted to a pending selection and can mutate the wrong session.**

   Once authentication completes, the controller is installed globally even when it still needs site selection. The selection handler checks only that a controller exists and that the ID appears in its authorized list.

   Consequently:

   - A delayed selection from an older modal can target a newer controller.
   - The handler can switch an already-connected multi-site controller to another authorized site without a pending connect.
   - An out-of-order call can persist that unexpected site.
   - There is no connection generation or pending-selection token tying the selection to the `OMADA_CONNECT` result that supplied the list.

   Normal renderer serialization makes this unlikely through ordinary UI interaction, but the main-process serialization and IPC boundary should remain correct independently of renderer behavior.

   **Recommended fix:** Keep a separate pending controller record such as `{controller, generation, nonce}`. Return the opaque nonce with `needsSiteSelection`, require it in `OMADA_SELECT_SITE`, and accept the call only while that exact generation remains pending. Install the controller globally only after selection succeeds. Clear and release the pending controller on disconnect, supersession, cancellation, and quit.

3. **P2 — [omada-api.ts:167](/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron/src/main/omada-api.ts:167) — Only the first 100 authorized sites are loaded.**

   `loadSites()` requests `currentPage=1&currentPageSize=100` and does not inspect pagination metadata or fetch subsequent pages. On a controller with more than 100 authorized sites:

   - The modal omits later sites.
   - A stored site beyond the first page is incorrectly treated as unauthorized.
   - The user cannot select an omitted site.

   This contradicts the stated requirement to load the authorized sites.

   **Recommended fix:** Consume the response’s total/page metadata and fetch every page, with a defensive maximum site/page count. Validate and deduplicate the combined list before exposing it.

## Hard invariants

- **Strict CSP / no inline styles: confirmed.**  
  [index.html:6](/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron/src/renderer/index.html:6) retains `style-src 'self'`; searches found no inline `style` attributes or renderer `.style` mutations.

- **Dynamic DOM uses safe DOM APIs: confirmed.**  
  Site buttons are created with `document.createElement()`, `textContent`, and `dataset` at [renderer.ts:1587](/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron/src/renderer/renderer.ts:1587). No `innerHTML`, `outerHTML`, or `insertAdjacentHTML` use was found.

- **All `ipcMain.handle` callbacks assert the sender first and guard payloads: confirmed.**  
  Every handler begins with `assertTrustedIpcSender(event)`. The new site handler validates type and `SITE_ID_REGEX`, followed by exact authorized-list membership. Payload-free handlers require no additional argument guard. The ordering problem above is a state/authorization defect, not a missing shape guard.

- **Sandbox-compatible preload: confirmed.**  
  [preload.ts:1](/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron/src/main/preload.ts:1) has only the Electron runtime import; project imports are type-only. `sandbox: true` remains set.

- **Spanish/English i18n parity: confirmed.**  
  Both languages implement the typed `Translations` interface, including `siteSelectionTitle`, `siteSelectionMessage`, `siteSelectError`, and `connectionSuperseded`.

- **Renderer generation/operation model: confirmed for normal UI flow.**  
  Site selection remains awaited inside `connect()`, so `isConnecting` stays true. Settings and other operations are disabled or rejected while the modal is open. Post-await UI commits are generation-checked. The first finding concerns main-process supersession that the renderer generation cannot observe.

- **Stored-site persistence convention: confirmed.**  
  `saveStoredSiteId()` delegates to the existing `writeConfigFile()`, which writes a same-directory temporary file with mode `0o600` and atomically renames it. The in-memory cache changes only after a successful write. Changing the normalized controller URL drops `siteId`.

- **Superseded-session cleanup: confirmed, with best-effort semantics.**  
  Stale and failed local controllers pass through `releaseController()`. `logout()` attempts server-side logout and clears cookies, CSRF state, site selection, and authorized sites. A network failure can leave the server session alive until server expiry, but the local state is eventually cleared and the controller reference discarded; that matches the existing best-effort logout design.

- **Site modal cancellation/quit behavior: mostly confirmed.**  
  Escape and Cancel resolve the modal and call disconnect. Background controls are inert and `isConnecting` blocks normal disconnect while selection is open. Quitting bumps the main generation and performs bounded logout of the installed controller. The missing pending-selection ownership identified above remains the weakness for externally ordered IPC calls.

## Single-site regression risk

The ordinary single-site path appears sound:

- Exactly one returned site is selected automatically.
- No modal is shown.
- Stored-site validity does not interfere with the sole-site choice.
- Data loading occurs through the same connected UI path as before.
- Connection and load errors still release the controller and reset the UI.

The primary residual risk is the untested API assumption around the sites response shape and pagination. For controllers returning the expected first-page array with one site, I found no direct single-site regression.

**Final readiness:** phase 7 should remain open until the superseded-result cleanup and pending-site-selection ownership defects are fixed. Pagination should also be resolved before declaring multi-site support complete.

Codex session ID: 01a03553-1d4c-7611-99f7-bac7a9a52482
Resume in Codex: codex resume 01a03553-1d4c-7611-99f7-bac7a9a52482

## Final resolution (orchestrator, before commit)

All three P2s closed by a fix worker following the review's recommended designs: (1) `connectionSuperseded` resets local UI only via `resetConnectionUi()` (no IPC), and `OMADA_DISCONNECT` accepts an optional nonce that no-ops unless the caller owns the pending selection; (2) `needsSiteSelection` parks the controller in a main-process `{controller, generation, nonce}` record (16-byte hex nonce) — installed globally only after `OMADA_SELECT_SITE` succeeds with the exact current nonce; record cleared+released on newer connect, disconnect, and quit; (3) `loadSites()` paginates (100/page, 50-page defensive cap with console.warn) and dedupes by id. Orchestrator spot-read the OMADA_CONNECT handler and pending-record mechanics; `npm run build` exit 0; invariant greps clean. Committed on that basis.
