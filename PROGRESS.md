# PROGRESS — Omada WLAN Manager (Electron)

Authoritative checkpoint for `/goahead-fable` runs. Plan source: `todo.md` (code-review findings, 2026-08-24).

## Phase plan

| Phase | Scope (todo.md items) | Status |
|---|---|---|
| 1 | Renderer/main bug fixes: 1.1, 1.4, 1.5, 1.12, 1.13, 1.14 (minimal renderer-side), 1.15, 3.9 | **done** |
| 2 | API client robustness (`omada-api.ts`): 1.3, 1.6, 1.7, 1.8, 3.13 | **done** |
| 3 | Config & credential security: 2.1, 2.4, 2.5 (+1.14 final flag mechanism), 2.7, 3.6 | **done** |
| 4 | Renderer/IPC/cert hardening: 1.9, 2.2, 2.3a (origin compare), 2.6, 3.14 | **done** |
| 5 | Packaging & platform: 1.2, 3.5, 3.15 | **done** |
| 6 | UX improvements: 3.1, 3.2, 3.7, 3.8 (+OMADA_CONNECT i18n error codes) | **done** |
| 7 | Connection flow & multi-site: 1.11, 3.12 | **done** |

**Deferred (need user input or live controller):**
- ~~1.10 status-category mapping~~ — **done 2026-08-29** (see below).
- 2.3b trust-on-first-use cert pinning — UX decision (first-use confirmation dialog).
- 3.3 Electron 28 → current major upgrade — risky, retest on all platforms; user call.
- 3.4 esbuild bundler for renderer — structural change; user call.
- 3.10 ESLint/tests/CI scaffolding — optional final phase if user wants it.

## Decisions

- **2.1 config compat:** password will be encrypted via `safeStorage` with one-time migration of the plaintext value. This breaks config compatibility with the old Python version (one-way). Chosen because todo.md's own fix instruction recommends it; flagged here for the user.
- **User-facing text:** the app is bilingual (es/en via the i18n table in `renderer.ts`); every new user-facing string must be added to BOTH languages. Code comments/docs in English.
- **todo.md upkeep:** each phase worker marks its completed items in `todo.md` (✅ + one line describing how).

## Environment

- `npm install` re-run 2026-08-24 to restore `node_modules/.bin` (Dropbox strips symlinks — see todo.md 3.11). If `tsc: command not found` reappears, re-run `npm install`.
- Verification command: `npm run build` (tsc + copy-static). No tests/linter exist yet.
- Git remote: `origin` → github.com/ccarpiog/OmadaWLANManager-Electron.git, branch `main`.

## Completed

### Phase 1 — renderer/main bug fixes (2026-08-24)
- Items 1.1, 1.4, 1.5, 1.12, 1.13, 1.14 (minimal), 1.15, 3.9 implemented in `src/renderer/renderer.ts` and `src/main/index.ts`; details marked per-item in `todo.md`.
- Acceptance: `npm run build` exit 0 (verified twice, incl. after review fix). No test suite exists.
- Codex review: `.claude/reviews/phase1-aggregate.md`. One P1 found (the `{success:false}` branch of `connect()` skipped `clearData()` + IPC disconnect) — fixed before commit; verdict otherwise clean.
- New helper `clearData()` in renderer.ts centralizes data/selection/filter reset; new i18n key `passwordRequired` (es+en).

### Phase 2 — API client robustness (2026-08-24)
- Items 1.3, 1.6, 1.7, 1.8, 3.13 implemented in `src/main/omada-api.ts` + `src/main/index.ts`; details per-item in `todo.md`.
- Key mechanics: cookie jar is a `Map` with per-name merge honoring deletions; `rawRequest()` rejects non-2xx with a 200-char excerpt, 15 s abort timer, 5 MB body cap, all settle paths clear the timer; session expiry (`errorCode -1200`) triggers ONE shared re-login (`sharedRelogin()` + `reloginPromise`) with a single retry via `rawRequest()`; `logout()` (best-effort POST + `clearSessionState()`) runs on `OMADA_DISCONNECT` and `before-quit` (3 s bound, guarded re-entry of `app.quit()`); validators throw `Unsupported API response (...)` on missing required ids, normalize only display fields.
- Acceptance: `npm run build` exit 0 (after fixes). Orchestrator spot-read of the relogin path.
- Codex review: `.claude/reviews/phase2-aggregate.md` — 4 findings (1 high: relogin race; 2 medium; 1 low), ALL fixed in a second worker round before commit.

### Phase 3 — config & credential security (2026-08-24)
- Items 2.1, 2.4, 2.5, 1.14-final, 2.7, 3.6 implemented; `src/main/config.ts` rewritten around an in-memory cache. Details per-item in `todo.md`.
- Key mechanics: password stored as base64 `safeStorage` blob (`encryptedPassword`), decrypted only in main via `getConnectionCredentials()`; one-time plaintext migration with documented plaintext fallback (+ permission tightening) when encryption is unavailable; TLS callbacks read `getConfiguredUrl()` from cache; `CONFIG_LOAD` returns `{url, username, language, hasPassword}` (hasPassword = blob actually decryptable); renderer omits the password field when blank & stored, main keeps the stored blob and rejects blank-new with `passwordRequired`; atomic writes (temp+rename, dir 0o700 / file 0o600); URL normalized/validated https-only in both renderer (`validateControllerUrl()`) and main (`normalizeControllerUrl()`); new i18n keys `passwordUnchanged`, `invalidUrl`, `saveError` (es+en); `AppConfig` replaced by `RendererConfig`/`ConfigSavePayload`/`ConfigSaveResult` in `src/shared/types.ts`.
- Acceptance: `npm run build` exit 0; no `readFileSync` in `index.ts`; password never received by renderer (rg-verified).
- Codex review: `.claude/reviews/phase3-aggregate.md` — 1 high (legacy plaintext file perms when safeStorage unavailable), 1 low (corrupt blob reported as usable). Both fixed by orchestrator before commit (`tightenPermissions()` helper; decryptability-based `hasPassword` + save check).
- Note: `OMADA_CONNECT`'s hardcoded Spanish error strings predate this work and were left as-is (out of scope; candidate for phase 6 polish).

### Phase 4 — renderer/IPC/cert hardening (2026-08-24)
- Items 1.9, 2.2, 2.3a, 2.6, 3.14 implemented in `src/renderer/renderer.ts`, `src/renderer/index.html`, `src/renderer/styles.css`, `src/main/index.ts`, `src/main/preload.ts`; details per-item in `todo.md`.
- Key mechanics: list/selection/empty-state DOM built via `createElement`/`textContent`/`dataset` + `replaceChildren` (helpers `createApListItem`/`createWlanListItem`/`createEmptyState`; `escapeHtml` deleted); MAC/WLAN-id regexes enforced renderer- and main-side (kept in sync — see comments); `sandbox: true` with a sandbox-safe preload (no runtime require of project files; `IPC_CHANNELS` local copy typed `typeof SHARED_IPC_CHANNELS` for drift detection); `certificate-error` compares parsed origins in try/catch; every `ipcMain.handle` starts with `assertTrustedIpcSender()` (sender frame must resolve to the packaged index.html) and `CONFIG_SAVE`/`OMADA_SET_WLAN` payloads are shape-guarded; CSP: `default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`.
- Acceptance: `npm run build` exit 0 (verified twice, incl. after review fixes); no `innerHTML`/`insertAdjacentHTML`/inline styles in renderer (rg-verified); compiled preload requires only `electron`.
- Codex review: `.claude/reviews/phase4-aggregate.md` — 1 P2 (verify-proc accepts any port on the configured hostname) + 1 CSP regression (`data:` SVG select arrow blocked). Both addressed by orchestrator before commit: CSP got `img-src 'self' data:`; the verify-proc bypass was narrowed to self-signed failure classes (`isSelfSignedVerificationResult()`). Full origin scoping in the verify proc is IMPOSSIBLE (Electron's request has no port) and the bypass cannot be removed (the API client uses `net.request`, which `certificate-error` does not cover) — residual same-host-other-port risk documented, closes only with deferred 2.3b TOFU pinning.
- Not GUI-tested: the sandboxed preload was verified statically (compiled output requires only `electron`); a quick `npm start` smoke test is recommended when a display is available.

### Phase 5 — packaging & platform (2026-08-24)
- Items 1.2, 3.5, 3.15 implemented in `package.json`, `assets/icon.ico` (new), `src/main/index.ts`, `src/main/preload.ts`, `src/renderer/renderer.ts`, `src/renderer/styles.css`; details per-item in `todo.md`.
- Key mechanics: `assets/icon.ico` generated from `icon.png` (7 PNG-compressed frames 16–256 px; `file` confirms a valid MS Windows icon resource) so `build.win.icon` resolves; `build.files` excludes `dist/**/*.map` and `dist/**/*.d.ts`; `titleBarStyle` is `'hiddenInset'` on darwin only (`'default'` elsewhere); sandbox-safe preload exposes `platform: process.platform` on the contextBridge; renderer `applyPlatformClass()` tags `<body>` with `platform-<os>` before first paint and the 80 px traffic-light padding lives under `body.platform-darwin .title-bar`. Drag-region CSS intentionally left unscoped (benign on framed windows).
- Acceptance: `npm run build` exit 0 (worker + orchestrator re-run); no packaging run performed (per phase constraints — `npm run package:win` etc. still untested end-to-end).
- Codex review: `.claude/reviews/phase5-aggregate.md` — clean, "ready to proceed", no findings.

### Phase 6 — UX improvements (2026-08-24)
- Items 3.1, 3.2, 3.7, 3.8 + OMADA_CONNECT i18n error codes implemented in `src/renderer/renderer.ts`, `index.html`, `styles.css`, `src/main/index.ts`, `src/shared/types.ts`; details per-item in `todo.md`.
- Key mechanics: `showToast()` toasts (top-right below header, click-through, aria-live, stack capped at 3, 4 s auto-dismiss) replace all `alert()` calls; header Refresh button + panel spinners (`refreshData()` restores old lists on failure); Enter submits settings (per-field handlers — CSP `form-action 'none'` forbids forms); index.html ships textless and `<body class="pre-init">` hides the UI until `applyTranslations()` (no Spanish/blank flash; init failure paths still reveal the UI); AP/WLAN lists are `role="listbox"`/`role="option"` with roving tabindex, ArrowUp/Down, Enter/Space toggle; modals have `role="dialog"`/`aria-modal`, a Tab focus trap, opener-focus restore, and background `inert` (`updateBackgroundInert()`); async safety via `sessionGeneration` + `invalidateSession()` (every post-await UI commit generation-checked) and per-operation flags behind `isOperationInProgress()` (connect/disconnect/save/apply/refresh mutually exclusive); `OMADA_CONNECT` returns `ConnectionErrorCode` codes mapped in the renderer. New i18n keys (es+en, parity enforced by the `Translations` interface): `refresh`, `loading`, `loadError`, `close`, `configIncomplete`, `connectFailed`, `configureHint`, `configLoadError`.
- Acceptance: `npm run build` exit 0 (after each round); greps clean (no `alert(`, no inline styles, no `.style.` writes, no Spanish in `src/main/index.ts`).
- Codex review: `.claude/reviews/phase6-aggregate.md` — first pass found 2 P1 races + 4 P2s (fixed in a worker round); a focused Codex verification pass then confirmed 4/6 closed and re-flagged disconnect serialization + a settings-open race, closed in a second worker round (orchestrator spot-verified). Intentionally untranslated: technical error `detail`, product name, input placeholders, language autonyms.

### Phase 7 — connection flow & multi-site (2026-08-24) — FINAL PHASE
- Items 1.11, 3.12 implemented in `src/main/omada-api.ts`, `src/main/index.ts`, `src/main/config.ts`, `src/main/preload.ts`, `src/shared/types.ts`, `src/renderer/renderer.ts`, `index.html`, `styles.css`; details per-item in `todo.md`.
- Key mechanics: `OmadaController.connect(preferredSiteId?)` loads ALL authorized sites (paginated, 100/page, 50-page defensive cap, deduped by id) and never picks silently — auto-select only with exactly one site or a still-authorized stored `config.siteId` (dropped when the URL changes); otherwise `OMADA_CONNECT` parks the controller in a pending `{controller, generation, nonce}` record (NOT installed) and returns `needsSiteSelection` + sites + a 16-byte hex nonce; the renderer's site-selection modal (DOM-built, focus trap, inert background, Escape/Cancel → disconnected) completes via `OMADA_SELECT_SITE` (sender assert, id + nonce format guards, exact pending-record match) which installs the controller and persists the site. Main-process serialization via `connectGeneration`: stale attempts are logged out and reported `connectionSuperseded` (renderer resets local UI only — no IPC); `OMADA_DISCONNECT` takes an optional ownership nonce; pending record cleared+released on newer connect, disconnect, and quit. New i18n keys: `siteSelectionTitle`, `siteSelectionMessage`, `siteSelectError`, `connectionSuperseded` (es+en).
- Acceptance: `npm run build` exit 0 (after each round); invariant greps clean (no inline styles/innerHTML, 8/8 handlers assert sender, preload sandbox-safe, no Spanish in main).
- Codex review: `.claude/reviews/phase7-aggregate.md` — 3 P2s (superseded-attempt cleanup disconnecting the newer controller; OMADA_SELECT_SITE not bound to a pending selection; site pagination), all fixed in a worker round per the review's own recommended designs; orchestrator spot-verified the pending-record mechanics.
- Not tested against a live controller (single- or multi-site) — see Open risks.

### GUI smoke test (2026-08-29)

First real launch of the app since phase 4. Driven with Playwright's
`_electron` API; script kept at `scratchpad/smoke.mjs` (26 assertions:
window/preload/sandbox, translations, modal focus + trap + inert, URL
validation, connect-without-config, console/main-process errors).

- **Verified working:** single window loads the packaged renderer; the
  sandboxed preload exposes all 9 `omadaAPI` members with no `require`/
  `process` leaking into the renderer; `platform-darwin` body class; every
  string translated with no blank/Spanish flash; the `data:` select-arrow
  renders (phase-4 CSP fix holds); non-https URL rejected renderer-side with
  no config file written; Tab/Shift+Tab focus trap holds in both directions;
  zero console errors, zero page errors, zero main-process output.
- **Bug found and fixed:** opening any modal left keyboard focus on `<body>`.
  `.modal-overlay` used `transition: all`, so `visibility` was still computed
  as `hidden` at the instant `openSettings()` called `urlInput.focus()`, and a
  `visibility: hidden` subtree is not focusable — the call was a silent no-op
  on every open path, including the first-run auto-open. Confirmed by probe
  (identical `focus()` call succeeds once the transition finishes). Fixed in
  `styles.css` by transitioning `opacity`/`visibility` explicitly and
  overriding `visibility 0s` in `.modal-overlay.visible`. One fix covers all
  three modals (settings, confirm, site selection). 26/26 checks pass after.
- Environment gotchas (both caused by the repo living in Dropbox, which
  strips symlinks and exec bits): `node_modules/electron/dist` unpacks
  broken — Electron must be extracted to `/private/tmp` and launched from
  there; and `node_modules/app-builder-bin/mac/app-builder_arm64` loses its
  executable bit, which fails electron-builder with `EACCES` until re-chmodded.

### Release v1.0.0 (2026-08-29)

- Artifacts: `Omada WLAN Manager-1.0.0-arm64.dmg` (93 MB) and a matching
  `-mac.zip`, built by `electron-builder --mac` from commit `3918c8d`.
  **arm64 only** — no Intel or universal build.
- Signed with `Developer ID Application: Carlos Carpio García (CXVKS8ZNCD)`,
  hardened runtime on. The `.app` and the `.dmg` are each notarized and
  stapled; both report `accepted / source=Notarized Developer ID`, and the app
  still does so when checked from inside the mounted image.
- Notarization runs through the `AC_NOTARY_PROFILE` notarytool keychain
  profile (see `SIGN_AND_NOTARIZE.md` in the user's OneDrive). In
  `package.json`, `mac.notarize` MUST stay a plain `true`: adding a `teamId`
  makes @electron/notarize read it as password credentials, which collides
  with the keychain profile and aborts the build.
- Packaged-app smoke test: 10/10 (runs from inside `app.asar`, preload bridge
  intact, focus fix present in the shipped build).
- **Published** on GitHub 2026-08-29:
  https://github.com/ccarpiog/OmadaWLANManager-Electron/releases/tag/v1.0.0 —
  tag `v1.0.0` points at commit `a209965`. Published after the user confirmed
  the app works against a live controller.
- Build must NOT use the default `./release` output dir: it lives in Dropbox,
  which strips the symlinks inside `Electron.app` and produces a broken
  bundle. Build to `/private/tmp` and copy the finished `.dmg` back if needed.
  For the same reason `codesign` must select the identity by SHA-1 hash, not
  by name — the "í" in the name is mangled under a non-UTF-8 locale.

### Item 1.10 — AP status-category mapping (2026-08-29, post-v1.0.0)

- `isOnline` (categories 1 and 2 green, everything else red) replaced by an
  `AP_STATUS` table + `getApStatus()` in `renderer.ts`: 0 disconnected (red),
  1 connected (green), 2 pending/adopting (blue), 3 heartbeat missed and
  4 isolated (orange, distinguished by label), unknown → grey fallback so a
  category added by future firmware cannot look like a dead AP. The status dot
  gained `title` + `role="img"`/`aria-label`, so state is no longer
  colour-only. Six new `statusAp*` i18n keys (es+en).
- Verified with `scratchpad/smoke-status.mjs` (23/23): the main-process IPC
  handlers are stubbed so the renderer walks its real connect → loadData →
  renderApList path over one AP per category. **Not** verified against live
  hardware — the numeric → meaning mapping remains the documented Omada one.
- **Test isolation matters now:** the user has a real config in
  `~/.omada-wlan-manager/`, so the app auto-connects to their live controller
  on startup. Every smoke script launches Electron with `HOME` pointed at
  `scratchpad/fakehome` to keep tests off that controller and off the real
  config. Do not drop that override.

## Plan status: COMPLETE

All 7 phases are done, committed, and pushed. Remaining todo.md items are ALL in the Deferred list below — each needs user input or a live controller before work can start. There is no next phase to run; a future `/goahead-fable` should tell the user the plan is complete and ask which deferred item (if any) to tackle.

## Open risks

- Verify-proc cert bypass is hostname-scoped, not origin-scoped (Electron API limitation, see phase 4 notes); fully closed only by deferred item 2.3b (TOFU pinning).
- ~~No live GUI smoke test~~ — done 2026-08-29, see above.
- ~~Never tested against a live controller~~ — the user tested the packaged
  v1.0.0 app against a real controller on 2026-08-29 and reported it working.
  This was the last blocker on the release. Deferred item 1.10 (status-category
  mapping) is now actionable: it only needed live status values to verify.
- ~~Packaging never run end-to-end~~ — `electron-builder --mac` run 2026-08-29
  (signed + notarized, see the release section). Windows and Linux targets are
  still untested.

## Next action

None — the plan is complete (see "Plan status" above). If the user wants more: (1) run the live smoke tests listed under Open risks; (2) pick from the Deferred list (1.10 status mapping — needs live controller; 2.3b TOFU cert pinning — needs a UX decision; 3.3 Electron upgrade; 3.4 esbuild bundling; 3.10 ESLint/tests/CI). Ask, don't assume.

## Key paths

- `src/renderer/renderer.ts` — UI logic, i18n table, confirm modal, connect/disconnect
- `src/main/index.ts` — window creation, IPC handlers, cert verification
- `src/main/omada-api.ts` — OmadaController HTTP client
- `src/main/config.ts` — config persistence
- `src/main/preload.ts` — contextBridge API

## Git state

- Phases 4 (37450f1), 5 (a7f2e30), 6 (9b685b2), and 7 (final commit on main, SHA in `git log`) all pushed to origin/main (2026-08-24). Tree clean after the phase-7 commit.
