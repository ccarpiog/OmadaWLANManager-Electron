# Codex review — Phase 6 aggregate (UX improvements)

Date: 2026-08-24. Scope: uncommitted working-tree diff implementing todo.md items 3.1, 3.2, 3.7, 3.8 + OMADA_CONNECT i18n error codes (src/renderer/renderer.ts, index.html, styles.css; src/main/index.ts; src/shared/types.ts).

## Codex output (verbatim)

## 1. Overall verdict

needs fixes first

## 2. Defects and regressions

- **P1 — `src/renderer/renderer.ts:814-824,843-905` — A data load can finish after disconnect and repopulate the disconnected UI.**
  Disconnect does not cancel or invalidate an active refresh, while `loadData()` commits its response unconditionally. A user can start Refresh and then click Disconnect; the pending request may subsequently restore AP/WLAN data and allow selections even though `isConnected` is false. Use a connection/request generation token and discard results belonging to an obsolete session.

- **P1 — `src/renderer/renderer.ts:993-1043,1140-1155` — Settings saves and apply-triggered reloads can start overlapping connection/data operations.**
  `saveSettings()` neither disables submission nor checks whether a connect/load is already active; keyboard repeat can invoke it multiple times. Refresh can also run while `setApWlanGroup()` is pending, after which `applyChange()` starts another `loadData()`; the first completion sets `isLoadingData = false` and re-enables Refresh while another request remains active. Serialize these operations or use request identities/reference counting.

- **P2 — `src/renderer/index.html:18-63`, `src/renderer/renderer.ts:1236-1259`, `src/main/index.ts:135-148` — The empty-HTML strategy can flash a blank shell before translations are applied.**
  `ready-to-show` waits for an initial render, not for the asynchronous `loadConfig()` inside `init()`. The window can therefore be shown while headings, buttons, status and panels are empty; if `loadConfig()` rejects, `init()` has no catch and the UI remains blank. Gate window display on an explicit renderer-ready signal or keep the document hidden with an external CSS class until initialization succeeds.

- **P2 — `src/renderer/index.html:68-121`, `src/renderer/renderer.ts:942-955,1066-1107` — Neither modal implements modal focus containment or restoration.**
  Autofocusing the URL/Confirm button moves focus in, but Tab can leave either modal and interact with background controls. Closing leaves focus on a now-hidden descendant rather than returning it to the opener; the overlays also lack `role="dialog"` and `aria-modal="true"`. Add a focus trap, semantic dialog attributes, background inertness, and opener-focus restoration.

- **P2 — `src/renderer/styles.css:405-437,559-584`, `src/main/index.ts:120-123` — Toasts can cover modal controls at the supported minimum window height.**
  Toasts deliberately use `z-index: 200`, above modal overlays at `100`. Because they are bottom-positioned and individually accept pointer events, settings validation toasts can overlap and intercept the modal footer around the 500px minimum height; stacked toasts expand upward.

- **P2 — `src/renderer/renderer.ts:488-547,559-616` — The keyboard behavior conflicts with `role="radio"` semantics.**
  Enter/Space clears the selection when activating the already-selected item, every radio has `tabIndex = 0` (no roving tabindex), and arrow-key navigation is absent — radios conventionally can't uncheck themselves.

## 3. User-facing strings bypassing the i18n table

- `src/renderer/renderer.ts:739-740` and `src/main/index.ts:314-317` — raw technical `detail` appended to the localized connection error.
- `src/renderer/index.html:7` — `Omada WLAN Manager` document title (arguably a neutral product name).
- `src/renderer/index.html:82,86,90` — literal URL/username/password placeholder examples.
- `src/renderer/index.html:95-96` — `Español`/`English` language autonyms.

## 4. Hard-invariant check results — all PASS

CSP, safe DOM construction, IPC sender/payload guards, sandboxed preload, `platform-<os>` body class, and es/en i18n parity (verified via `tsc --noEmit`) all pass.

## 5. Readiness for phase 7

Not yet — resolve the P1 stale-request races (refresh/connect/save/disconnect) and the ready-to-show/blank-UI gap first; fix modal focus trap/restoration and radio keyboard semantics before treating phase 6 accessibility as complete; verify toast/modal overlap at the 500px minimum window height.

## Resolution (orchestrator)

- Both P1s and all four P2s: sent back to a fix worker before commit (see the fix-verification pass below).
- Section 3 items: the technical `detail` append is intentional (controller/API error text is not translatable and aids debugging); the document title is the product name; placeholder examples and language autonyms are conventionally untranslated. No change.

## Fix-verification pass (Codex, same date)

1. **P1 stale refresh after disconnect — CLOSED** — `src/renderer/renderer.ts:927,961-1015`. Disconnect invalidates the session before awaiting; `loadData()` checks the generation after its fetch, in its error path, and before clearing loading state.

2. **P1 overlapping settings/apply/connection operations — NOT CLOSED** — `src/renderer/renderer.ts:247-249,926-937,1199-1271`. Disconnect has no in-flight flag and bypasses `isOperationInProgress()`. A user can close the settings modal during a save, disconnect, and then have the completed save call `connect()` while disconnect is pending. Neither connect nor disconnect generation-checks its own post-await UI commits.

3. **P2 blank shell during initialization — CLOSED** — `src/renderer/index.html:10`, `src/renderer/styles.css:56-58`, `src/renderer/renderer.ts:1483-1525`. The body remains hidden until translations are applied; both config-load failure and the outer initialization failure remove `pre-init`.

4. **P2 modal semantics, focus containment, and restoration — NOT CLOSED** — `src/renderer/index.html:70,110`, `src/renderer/renderer.ts:1090-1115,1134-1157,1288-1338`. Normal open/close paths trap and restore focus correctly, and confirm listeners are cleaned up. However, the settings "already open" check occurs before `await loadConfig()`: concurrent opens can both pass it, and the later completion overwrites `settingsOpener` with the URL field, causing close to refocus a hidden modal descendant. Background content is also never made inert.

5. **P2 toasts covering/intercepting modal controls — CLOSED** — `src/renderer/renderer.ts:419-442`, `src/renderer/styles.css:573-603`. Toasts are top-right, capped at three, and both the container and individual toasts are click-through.

6. **P2 radio keyboard semantics — CLOSED** — `src/renderer/index.html:49,58`, `src/renderer/renderer.ts:538-570,582-717`. The controls now use listbox/option semantics, maintain one roving tab stop, preserve the intended optional-selection model, restore focus after keyboard-triggered rerenders, and support Arrow Up/Down without corrupting selection.

New defects introduced by the fixes: none distinct from the unresolved race and modal issue above. TypeScript validation passes with `tsc --noEmit`.

VERDICT: not ready to commit — disconnect serialization and the asynchronous settings-modal open race remain unresolved.

## Final resolution (orchestrator, before commit)

A second fix round closed the two remaining findings in `src/renderer/renderer.ts`: `disconnect()` is now the single guarded public entry (no-op while any exclusive operation is in flight, `isDisconnecting` included in `isOperationInProgress()`, internal cleanup paths call the IPC directly), `connect()`/`disconnect()` generation-check every post-await UI commit, and `saveSettings()` re-checks generation + operation guard before its auto-connect; `openSettings()` sets `isSettingsOpening` and captures the opener synchronously before its await (rolled back on failure), and `updateBackgroundInert()` keeps `.app-container` inert while either modal is open. Orchestrator spot-read the disconnect and openSettings paths; `npm run build` exit 0; inline-style greps clean. Committed on that basis.
