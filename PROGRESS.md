# PROGRESS — Omada WLAN Manager (Electron)

Authoritative checkpoint for autoclaude runs (`/autoclaude-opus`, `/autoclaude-fable`; earlier phases ran under `/goahead-fable`). Plan source: `todo.md` — sections 1–3 (code-review findings, 2026-08-24, phases 1–7) and **section 4 (Omada 6.3 AP groups & Wi-Fi network management, 2026-10-06, phases 8–20)**. Phases 8–20 implement the spec in `docs/management-design.md`; read that spec's relevant section before starting any of them.

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
| 8 | 4.1 Renderer modularization with esbuild (absorbs 3.4) — risk: high (structural, no behavior change); worker: opus | **done** — `docs/progress-archive/phase-8.md` |
| 9 | 4.2 Test harness: `npm test` (node:test + fixtures) and committed Playwright `_electron` smoke with stubbed main (`npm run smoke`) — risk: routine; worker: opus | **done** — `docs/progress-archive/phase-9.md` |
| 10 | 4.3 Electron 28 → 44 (absorbs 3.3) — risk: high; worker: opus | **done** — `docs/progress-archive/phase-10.md` |
| 11 | 4.4 URL-scoped credentials + certificate TOFU pinning (completes 2.3b) — risk: high; worker: opus | **done** — `docs/progress-archive/phase-11.md` |
| 12 | 4.5 Omada 6.3 correctness: `controllerVer`, `groupModel`, full group list from `setting/wlans` (empty groups), AP/WLAN terminology — risk: routine; worker: opus | **done** — `docs/progress-archive/phase-12.md` |
| 13a | 4.6 (first half) App shell (sidebar, counts, Updated hh:mm) + Access points list with checkbox multi-select surviving filters — risk: high; worker: opus | **done** — `docs/progress-archive/phase-13a.md` |
| 13b | 4.6 (second half) Destination pane, review dialog, sequential bulk move with per-AP results + Retry failed — risk: high; worker: opus | **done** — `docs/progress-archive/phase-13b.md` |
| 14a | 4.7 (first half) Read-only AP groups & Wi-Fi networks views from internal data, cross-navigation with "Back to …", AP details pane — risk: routine; worker: opus | **done** — `docs/progress-archive/phase-14a.md` |
| 14b | 4.7 (second half) §4.6 states, read-only banner with reason, §4.7 responsive breakpoints, Cmd/Ctrl+F and Escape — risk: routine | pending |
| 15 | 4.8 Open API credentials, `OpenApiClient`, `ControllerSession`, capability detection — risk: high | pending |
| 16 | 4.9 AP group management (create/rename/delete-if-empty, move APs here) — risk: high | pending |
| 17 | 4.10 Wi-Fi network read model via Open API (secrets stripped) — risk: routine | pending |
| 18 | 4.11 Wi-Fi network editing, Open + WPA-Personal (read-merge-write, change password) — risk: high | pending |
| 19 | 4.12 "Broadcast on" SSID ↔ AP-group binding editor with capacity checks — risk: high | pending |
| 20 | 4.13 Integration, hardening, docs, `docs/live-test-checklist.md` — risk: routine | pending |

**Phases 8–20 invariants (user decision D4, 2026-10-06):** no phase may contact the real controller (`192.168.1.130`) or read/write the real `~/.omada-wlan-manager/` config. Verification is `npm run build` + (from phase 9) `npm test` + `npm run smoke` against a stubbed main process with `HOME` pointed at a temp dir. Behaviors that need a live controller follow the defensive defaults in `docs/management-design.md` §5; the user runs `docs/live-test-checklist.md` manually after phase 20.

**Deferred (need user input or live controller):**
- ~~1.10 status-category mapping~~ — **done 2026-08-29** (see below).
- ~~2.3b trust-on-first-use cert pinning~~ — done in phase 11 (todo 4.4).
- ~~3.3 Electron 28 → current major upgrade~~ — scheduled as phase 10 (todo 4.3).
- ~~3.4 esbuild bundler for renderer~~ — scheduled as phase 8 (todo 4.1).
- 3.10 ESLint/CI scaffolding — tests scheduled as phase 9 (todo 4.2); ESLint/CI remain optional.

## Decisions

- **2.1 config compat:** password will be encrypted via `safeStorage` with one-time migration of the plaintext value. This breaks config compatibility with the old Python version (one-way). Chosen because todo.md's own fix instruction recommends it; flagged here for the user.
- **User-facing text:** the app is bilingual (es/en via the i18n table in `renderer.ts`); every new user-facing string must be added to BOTH languages. Code comments/docs in English.
- **todo.md upkeep:** each phase worker marks its completed items in `todo.md` (✅ + one line describing how).
- **Management plan (2026-10-06, user decisions D1–D4 — full text in `docs/management-design.md` §1):** D1 hybrid architecture — internal username/password API stays for viewing and **all AP moves**; an optional Open API Client ID/Secret unlocks AP-group and Wi-Fi network management. D2 groundwork first (phases 8–11). D3 Wi-Fi network editing for Open + WPA-Personal only; Enterprise/PPSK view/enable/bind/delete only. D4 no live-controller tests in autoclaude runs. Defaults: controllers < 6.3 are assignment-only; "All devices" SSID bindings read-only; only empty, unbound, non-default AP groups can be deleted; Client Secret never stored in plaintext.
- **Multi-controller dropped (2026-10-06):** the user's two OC200 controllers are not on their network, and TP-Link's cloud Open API does not reach local controllers (probe: "Controller ID not exist."). The app stays single-controller. Details: `docs/management-design.md` §7.
- **UI direction (2026-10-06):** sidebar with Access points (landing) / AP groups / Wi-Fi networks; the Wi-Fi networks view is the only place to edit SSID ↔ AP-group bindings; no "remove AP from group" (always "move to"). Spec §4 of `docs/management-design.md`.

## Environment

- Dropbox strips symlinks and exec bits inside `node_modules` (todo.md 3.11). Every `tsc` run goes through `scripts/tsc.mjs` (Node + `resolveTscPath()`), so a broken `node_modules/.bin` no longer matters. Re-run `npm install` if a package itself goes missing.
- Verification commands: `npm run build` (`tsc` for main/preload/shared → `tsc -p src/renderer` type-check → esbuild bundle via `scripts/build-renderer.mjs` → copy-static); `npm test` (unit tests, no Electron, temp HOME); `ELECTRON_PATH=<electron binary> npm run smoke` (GUI smoke, stubbed main, temp HOME); `ELECTRON_PATH=<electron binary> npm run tls-probe` (opt-in, phase 11: real Electron `net.request` and the real `dist/main/index.js` against local 127.0.0.1 HTTPS servers with openssl self-signed certificates, temp HOME; run it whenever certificate, session or connection-state code changes). No linter. `engines.node` is `^22.18.0 || >=24.2.0` since phase 10. The local Node is 22.15.1, so `npm install` warns; only electron-builder actually breaks on it (next bullet).
- **Packaging on Node 22.12–22.17 / 24.0–24.1** (nodejs/node#58586, non-ASCII repo path): `npx electron-builder` fails with `Cannot find module 'async-exit-hook'`. Until the user upgrades Node, run `node --no-turbo-fast-api-calls node_modules/electron-builder/cli.js …` instead, building to `/private/tmp` and never `./release`. With `mac.notarize: true`, electron-builder 26 reads `APPLE_KEYCHAIN_PROFILE` (plus the optional `APPLE_KEYCHAIN`) only when neither the `APPLE_ID…` set nor the `APPLE_API_KEY…` set is in the environment.
- Dropbox gotcha: several quick back-to-back edits to one file can leave "<name> (… conflicted copy).md" files, and once even removed `PROGRESS.md` itself (phase 8). Batch the edits to a file, then run `fd -H "conflicted copy"` before committing. Keep the newest complete copy.
- Smoke Electron binary: `node_modules/electron/dist` is broken by Dropbox, so `npm run smoke` needs `ELECTRON_PATH`. An extracted Electron 44.5.1 lives at `/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron`. It may vanish on reboot; if so, re-extract `electron-v44.5.1-darwin-arm64.zip` (GitHub release, or `~/Library/Caches/electron/` after a packaging run) with `ditto -x -k`. The smoke fails unless every launch runs the installed Electron version, so the old 28.3.3 copy in `/private/tmp/omada-p8-smoke/` is rejected.
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

### Release v1.1.0 (2026-08-29)

- Ships item 1.10 (AP status categories) plus the modal focus fix that v1.0.0
  already contained. Minor, not patch: the status states are user-visible new
  behaviour, not a silent correction.
- `Omada WLAN Manager-1.1.0-arm64.dmg`, arm64 only. App and disk image both
  signed, notarized and stapled; both report
  `accepted / source=Notarized Developer ID`.
- Verified before publishing: source-tree smoke 26/26, packaged-app smoke
  10/10, status-category rendering 23/23 **against the packaged app**
  (`PACKAGED=1 node smoke-status.mjs`).
- `notarize-dmg.sh` now globs the `.dmg` instead of hard-coding a version, so
  it survives future releases.

### Phase 8 — renderer modularization with esbuild (2026-10-06)

- Risk: high. Worker: opus. Full narrative: `docs/progress-archive/phase-8.md`.
- The renderer is now one esbuild IIFE bundle (`dist/renderer/renderer.js`), built from 17 modules plus the `renderer.ts` entry. Shared types come from `src/shared/types.ts`, which now also holds the `OmadaAPI` bridge interface. `index.html`/`styles.css` are unchanged.
- Acceptance met: clean build exit 0; bundle free of `require`/`exports`/`import`/`eval`; no duplicated renderer types; the markup diff is empty; isolated launch smoke 21/21 (`HOME` = temp dir).
- Review: Codex, `docs/reviews/phase8.md`, ship-with-fixes. The 1 should-fix (watch mode skipped the renderer type-check) was fixed by the orchestrator.

### Phase 9 — test harness (2026-10-06)

- Risk: routine. Worker: opus. Full narrative: `docs/progress-archive/phase-9.md`.
- `npm test` (143 tests, `node:test`, JSON fixtures, no Electron) and `npm run smoke` (39 checks, playwright-core `_electron` against a stubbed main in `tests/smoke/`). The validators, cookie jar, URL normalization and HTTP transport now live in Electron-free modules; `net-transport.ts` is injected by `index.ts`.
- Acceptance met: build exit 0; `npm test` 143/143; smoke 39/39 with zero console errors, no network and a temp HOME; it covers the connected paths phase 8 left unverified, which all pass.
- The smoke found a pre-existing focus bug (`.btn { transition: all }` hid Confirm when it was focused), fixed in `styles.css`.
- Review: Codex, `docs/reviews/phase9.md`, ship-with-fixes. The 1 should-fix (playwright-core needs Node ≥ 20; README said 18+) was fixed by the orchestrator: README and `engines` now say Node ≥ 20.

### Phase 10 — Electron upgrade (2026-10-06)

- Risk: high. Worker: opus. Full narrative, including the breaking-change table for Electron 29 → 44: `docs/progress-archive/phase-10.md`.
- Electron 28.3.3 → **44.5.1** (Chromium 152, Node 24.21). electron-builder/dmg-builder 24.13.3 → 26.17.0, TypeScript 5.9.3 → 7.0.2, @types/node → 24. The esbuild target is now `chrome152`.
- Code: `will-navigate` reads `event.url`. A new `select-client-certificate` handler never sends a client certificate: in Electron 44 it also fires for `net.request`. Both tsconfigs moved to `nodenext` with `types: ["node"]`, because TypeScript 7 dropped `moduleResolution: node`. `scripts/resolve-tsc.mjs` and `scripts/tsc.mjs` run the compiler without `.bin`. The smoke checks the sandbox through `getLastWebPreferences()` and asserts the Electron version on every launch.
- Acceptance met: `npm run build` exit 0; `npm test` 143/143; smoke 40/40 on Electron 44.5.1, with zero console errors. The compiled preload still requires only `electron`. The unsigned `electron-builder --mac --dir` to `/private/tmp/omada-p10-build` exits 0 and bundles Electron Framework 44.5.1, but only through the Node workaround in *Environment*. `mac.notarize` is still `true`. `npm audit`: 24 → 8 moderate.
- Review: Codex, `docs/reviews/phase10.md`, ship-with-fixes. The blocker was that build, build:renderer and watch still ran `tsc` through the Dropbox-breakable `.bin` shim. The orchestrator fixed it with `scripts/tsc.mjs`, then re-ran the build, the tests (143/143) and the smoke (40/40), all exit 0.

### Phase 11 — URL-scoped credentials + certificate TOFU pinning (2026-10-06)

- Risk: high. Worker: opus (phase worker, plus an opus worker for the review blockers). Full narrative: `docs/progress-archive/phase-11.md`.
- Changing the normalized controller URL drops the password, `encryptedClientSecret`, site id and pin, and a blank password is then refused (`config-model.ts`). The certificate pin is one config record `{origin, sha256, trustedAt}`. `cert-pinning.ts` decides and `cert-verify.ts` applies the decision in both the verify proc and `certificate-error`. A first use or a mismatch fails the `/api/info` handshake, so no login POST is ever sent. New IPC: `CERT_TRUST` (nonce only) and `CERT_RESET`. Renderer: `cert-modal.ts` plus a pin section in Settings. An empty URL fragment is rejected, and the README config note was rewritten.
- Electron 44 caches verify-proc verdicts per (certificate, hostname), so controller requests use a dedicated in-memory session that is replaced on trust, reset, URL change and after a rejection.
- Acceptance met: build exit 0; `npm test` 246/246; smoke 52/52; `npm run tls-probe` 21/21. The probe shows 0 HTTP requests reach the server before trust and covers the stale cache and the race cases.
- Review: Codex, `docs/reviews/phase11.md`, ship-with-fixes with 2 blockers: a URL change and `CERT_RESET` did not invalidate in-flight connects, pending site selections or the installed controller. Both were fixed by moving the state logic into the Electron-free `connection-manager.ts` with one synchronous `invalidateControllerState()`, backed by 26 new unit tests and 4 new e2e probe checks. The orchestrator then re-ran build, tests, smoke and probe, all exit 0.

### Phase 12 — Omada 6.3 correctness & terminology (2026-10-06)

- Risk: routine. Worker: opus. Full narrative: `docs/progress-archive/phase-12.md`.
- `controllerVer` is kept, and `controller-version.ts` derives `groupModel`: `apGroup` on 6.3+, otherwise `wlanGroup` (also for a missing or garbage version). `getWlanGroups()` returns `{controllerVersion, groupModel, groups}`. The list comes from `setting/wlans` (empty groups included), with SSID names outer-joined from `setting/ssids`, and non-AP `deviceType` entries are dropped. On 6.3+ a failing `setting/wlans` fails the load; on legacy or unknown versions it falls back to the old `setting/ssids` list. Moves are unchanged and empty groups are move targets. Wording is "AP groups" vs "WLAN groups (legacy)" in es and en; README and package description are updated.
- Acceptance met: build exit 0; `npm test` 327/327; smoke 58/58 (an empty group renders and opens the move confirm; legacy wording checked); `npm run tls-probe` 21/21; the preload still requires only `electron`; no `innerHTML`.
- Review: Codex, `docs/reviews/phase12.md`, ship, with 0 findings.

### Phase 13a — app shell + Access points list (2026-10-06)

- Risk: high. Workers: opus (phase), opus (review fixes). Full narrative: `docs/progress-archive/phase-13a.md`.
- Phase 13 (todo 4.6) was split before starting: 13a = shell + list, 13b = destination pane + review dialog + bulk move results (recorded in `todo.md` 4.6).
- New `shell.ts` (header: site, connection state, "Updated hh:mm", controller version, Refresh that keeps data on screen; sidebar with total counts and view placeholders) and `ap-selection.ts` (pure selection logic). The AP list uses native checkboxes with Shift-click/Shift+Arrow ranges, "Select all N filtered", and an `aria-live` "N selected (M hidden by filters)". New status/group filters. The old confirm → `OMADA_SET_WLAN` flow moves the whole selection one AP at a time; failed APs stay selected. Optional `clientNum` in `validateAccessPoints()`.
- Acceptance met: build exit 0; `npm test` 357/357; smoke 83/83 (single, multi and hidden-by-filter moves, keyboard-only move, selection survives filtering, empty group selectable and labelled, nav items + counts, placeholders, Updated time); `npm run tls-probe` 21/21; no `innerHTML`/inline styles.
- Review: Codex, `docs/reviews/phase13a.md`, ship-with-fixes. Blocker (confirm focused the Confirm button) → the confirm dialog now focuses Cancel, with `aria-describedby`; should-fix (filter-hidden range anchor) → `planRangeSelection()` re-anchors. Both fixed by an opus worker; orchestrator re-ran build, tests, smoke and probe, all green.

### Phase 13b — destination pane, review dialog, bulk move (2026-10-07)

- Risk: high. Workers: opus (phase), opus (review fixes). Full narrative: `docs/progress-archive/phase-13b.md`.
- The old group panel, "Apply change" bar and confirm modal are gone. New: an always-visible destination pane (`destination-pane.ts`, native radios, search over group and SSID names, empty groups under "Silence"), pure move logic (`move-plan.ts`: gains/losses/unchanged, "N already in this group; M will move", no-op, move plan, results, `checkRetry()`), one review → progress → results dialog (`move-dialog.ts`, focus on Cancel, clients from `clientNum`, overrides stated as unavailable) and the sequential bulk move (`move-flow.ts`, one `OMADA_SET_WLAN` at a time, per-AP results, Retry failed). "Move AP" / "Move N APs". No new IPC channel.
- Acceptance met: build exit 0; `npm test` 398/398; smoke 92/92 (single, bulk all-succeed / partial → Retry failed / cancel, SSID search, Silence, no-op + mixed, keyboard-only, Cancel focus, same-named group, Enter on a focused radio); `npm run tls-probe` 21/21; no `innerHTML`/inline styles.
- Review: Codex, `docs/reviews/phase13b.md`, ship-with-fixes. Blocker (duplicate group names made no-op detection unverifiable, since AP records carry only the group name) → same-named groups are shown disabled with a reason and `planMove()` refuses them; should-fixes (Retry failed drifting after the post-move reload; Enter acting on the checked rather than the focused radio) → retry contract re-checked by `checkRetry()`, Enter selects the focused radio first. All fixed by an opus worker; orchestrator re-ran build, tests, smoke and probe, all green.

### Phase 14a — read-only AP groups & Wi-Fi networks views, cross-navigation, AP details (2026-10-07)

- Risk: routine. Workers: opus (phase), opus (review fixes). Full narrative: `docs/progress-archive/phase-14a.md`.
- Phase 14 (todo 4.7) was split before starting: 14a = read-only views + cross-navigation + AP details, 14b = §4.6 states, read-only banner, §4.7 breakpoints, Cmd/Ctrl+F, Escape (recorded in `todo.md` 4.7).
- New: `groups-view.ts` (counts, Empty badge, Default only from `primary: true` → `WlanGroup.isDefault`), `networks-view.ts` (one entry per network name, scope "N groups · M APs", "at least M APs" when some APs' groups cannot be identified), `ap-details.ts` (row click opens it in the destination pane's place; the checkbox alone toggles), `nav-history.ts` + `navigation.ts` ("Back to …" restores view, selection, search, scroll, focus; history reconciled after every load), pure `inventory-model.ts`. Override badges stated as unavailable (no new IPC: the `ssidOverrides[]` element shape is undocumented).
- Acceptance met: build exit 0; `npm test` 438/438; smoke 109/109 (groups and networks list + detail, cross-navigation round trip with Back, AP details by row click with checkbox-only toggling, the overrides statement, all 13a/13b checks); `npm run tls-probe` 21/21; no `innerHTML`/inline styles; preload requires only `electron`.
- Review: Codex, `docs/reviews/phase14a.md`, ship-with-fixes, 0 blockers. Should-fixes (network scope showed a lower bound as exact; Back kept targets a refresh removed) fixed by an opus worker; orchestrator re-ran build, tests, smoke and probe, all green.

## Plan status: ACTIVE — phases 8–14a done, phases 14b–20 pending

Phases 1–7 are done, committed, and pushed (plus releases v1.0.0/v1.1.0). On 2026-10-06 the user approved a new plan — todo.md section 4, phases 8–20 — after a live check of Omada Controller 6.3.0.45 showed that WLAN Groups became AP Groups (findings: `docs/omada-6.3-api-findings.md`). The app still works on 6.3, but it hides empty AP groups (todo 4.5). The plan adds AP-group and Wi-Fi network management.

## Open risks

- ~~Verify-proc cert bypass is hostname-scoped~~ — closed by phase 11: the bypass now requires the pinned fingerprint, so another certificate on another port of the same host is rejected.
- ~~No live GUI smoke test~~ — done 2026-08-29, see above.
- ~~Never tested against a live controller~~ — the user tested the packaged
  v1.0.0 app against a real controller on 2026-08-29 and reported it working.
  This was the last blocker on the release. Deferred item 1.10 (status-category
  mapping) is now actionable: it only needed live status values to verify.
- ~~Packaging never run end-to-end~~ — `electron-builder --mac` run 2026-08-29
  (signed + notarized, see the release section). Windows and Linux targets are
  still untested.
- ~~Phase 8 connected paths not GUI-tested~~ — covered by phase 9's smoke
  (connect → lists, site selection, AP move, refresh, disconnect); all pass.
- `npm audit`: 8 moderate remain after phase 10 (down from 24: 1 critical and 17 high). All 8 are in
  electron-builder's `@electron/get@3` → `global-agent` → `roarr` → `sprintf-js` chain, which is
  build-time only and has no upstream fix yet.
- Local Node 22.15.1 is below the new `engines` range. electron-builder needs the
  `--no-turbo-fast-api-calls` workaround until the user upgrades to Node 22.18+ or 24.2+.
- electron-builder 26 is untested for Windows/Linux, and a full signed + notarized DMG
  has not been built on it yet. Check `APPLE_KEYCHAIN_PROFILE=AC_NOTARY_PROFILE` on the next release.
- ~~`normalizeControllerUrl()` keeps an empty `#`~~ — fixed in phase 11 (main and renderer reject it).
- Phase 11 leftovers (none blocking): a stale request made after a TLS-session switch can still record a pin rejection that a concurrent connect to the same host picks up, so the dialog could show a confusing fingerprint; save/reset may take up to 3 s to reply when the old controller hangs (old-session logouts get that long); each session reset keeps an in-memory partition alive until quit; the e2e probe runs with `safeStorage` disabled. Phase 15 must route the Open API client through the same `ControllerTlsSessions` session and `ConnectionManager` invalidation, and clear `encryptedClientSecret` through the existing URL-change path in `config-model.ts`.
- ~~Four stale `renderer.ts` comments; "Access Points" title; `controllerVersion` not shown~~ — fixed in phase 13a.
- Phase 12 leftovers (none blocking): before connecting, the UI shows the 6.3 "AP groups"
  wording. `setting/wlans` on pre-6.3 controllers has never been tested live; the
  fallback to `setting/ssids` covers that case.
- Phase 13a leftovers (none blocking): the header shows the site name only after a pick in the
  site modal (single-site controllers and a remembered site show the host) — main should return
  the site name, best in phase 15's `ControllerSession`; `clientNum` is unverified live (add it to
  the phase 20 checklist); the AP details pane (row click) is deferred to phase 14 (`todo.md` 4.7);
  a failed refresh now logs `console.warn` instead of `console.error`.
- Phase 13b leftovers (none blocking): same-named groups cannot be move targets until renamed (the
  internal AP list has only group names; per-AP ids need `GET eaps/{mac}`); the review states that
  per-AP SSID overrides cannot be shown; a successful move still ends on a results dialog that needs
  one Close.
- Phase 14a leftovers (none blocking): in the Access points list an AP in a shared-name group shows the
  network count of the first group with that name (since 13a); the 13b review dialog says the internal API
  "does not report" overrides although `eaps/{mac}` returns `ssidOverrides[]` (element shape undocumented;
  smoke asserts the text); per-band capacity (`remainingBinding` in `setting/wlans`) is not kept yet —
  phase 16; an AP with no group makes every network's count "at least M APs".

## Next action

**Phase 14b — todo 4.7, second half: §4.6 states, read-only banner, §4.7 responsive layout and keys (risk: routine).** First read `todo.md` item 4.7 (its **Split** and **Done (14a)** bullets), then `docs/management-design.md` §4.6 and §4.7 only, and `docs/progress-archive/phase-14a.md` for the three views as they stand.

- Every §4.6 state across Access points, AP groups and Wi-Fi networks: first run (one **Configure connection** action), disconnected (navigation stays; content shows **Connect to controller**), initial loading (progress/skeletons in the layout), refreshing (keep data, mark refreshing — 13a already does this for the AP list), "no data" vs "no search results" with **Clear filters**, initial-load error (inline, persistent, Retry + Settings), refresh error (stale data + last-updated time).
- Read-only banner with the precise reason and fix: on 6.3+ "Open API credentials are not configured — viewing is available. Add them in Settings → Management access.", below 6.3 the legacy-controller reason (spec §4.6 wording; es + en). Phase 15 will switch it on capabilities, so drive it from one function.
- §4.7 breakpoints: ≥1000 px full sidebar + list/detail split; 800–999 px compact (icon) sidebar + split; 700–799 px top view switcher + single-pane drill-in (destination picker and AP details as full panes with Back). Content panes scroll independently; action bars and modal buttons stay visible at short heights; minimum window 700×500.
- Keys: Cmd/Ctrl+F focuses the current view's search; Escape clears search → exits edit mode → closes the top dialog.
- Acceptance: smoke at 1200, 900 and 720 px widths (each view usable, no horizontal overflow); Cmd/Ctrl+F and Escape order; the read-only banner with its reason (6.3 and legacy); first-run / disconnected / initial-load-error states; all existing checks keep passing. `npm run build`, `npm test`, `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` and `npm run tls-probe` (same `ELECTRON_PATH`) must all exit 0.

## Key paths

- `src/renderer/renderer.ts` — renderer entry (event wiring + init); logic lives in sibling modules (`state`, `i18n`, `shell` (header + sidebar), `connection`, `ap-list` + `ap-filters` + pure `ap-selection`, `destination-pane`, pure `move-plan` + `move-text`, `move-dialog`, `move-flow` (bulk move), `groups-view` + `networks-view` + `ap-details` over pure `inventory-model`, `navigation` + pure `nav-history` (Back), `*-modal`, `toast`, …), bundled by `scripts/build-renderer.mjs`
- `scripts/tsc.mjs` + `scripts/resolve-tsc.mjs` — run TypeScript 7 through Node (no `.bin` shim)
- `tests/unit/` + `tests/fixtures/` — `npm test` (runner `scripts/run-unit-tests.mjs`); `tests/smoke/` — `npm run smoke` (`stub-main.cjs`, `run-smoke.mjs`)
- `src/main/omada-transport.ts` (transport interface + hardened request logic), `net-transport.ts` (Electron `net`), `omada-validators.ts`, `cookie-jar.ts`, `url.ts`
- `docs/reviews/` — phase review briefs and reports from phase 8 on (earlier ones in `.claude/reviews/`); `docs/progress-archive/` — closed-phase narratives
- `src/main/index.ts` — window creation, IPC handlers, cert verification
- `src/main/omada-api.ts` — OmadaController HTTP client (`getWlanGroups()` → `GroupListing`: `setting/wlans` outer-joined with `setting/ssids`, legacy fallback); `src/main/controller-version.ts` — `controllerVer` → `groupModel`
- `src/main/config.ts` — config persistence (save rules in the pure `config-model.ts`)
- `src/main/cert-pinning.ts` (pure pin decision + fingerprint), `cert-verify.ts` (verify proc, `certificate-error`, `ControllerTlsSessions`), `connection-manager.ts` (connect / site selection / trust / reset / `invalidateControllerState()`, Electron-free); `src/renderer/cert-modal.ts`
- `tests/tls-probe/` — opt-in `npm run tls-probe` (local HTTPS servers, real Electron)
- `src/main/preload.ts` — contextBridge API
- `docs/management-design.md` — approved spec for phases 8–20 (decisions, architecture, security, UI)
- `docs/omada-6.3-api-findings.md` — live API findings on controller 6.3.0.45 (internal API + Open API summary)
- `docs/omada-openapi-ops.md` — Open API operations (params, bodies, responses) extracted from the controller's own spec

## Git state

- Phases 4 (37450f1), 5 (a7f2e30), 6 (9b685b2), and 7 (final commit on main, SHA in `git log`) all pushed to origin/main (2026-08-24). Tree clean after the phase-7 commit.
- Phase 8: `9f147ad`, pushed.
- Phase 9: `65dcf1a` ("Add unit tests and a GUI smoke harness"), pushed to origin/main (`f0a891e..65dcf1a`). A follow-up commit records this SHA. Tree clean after it.
- Phase 10: `388791f` ("Upgrade Electron to 44 and the build toolchain"), pushed to origin/main (`73ae8ed..388791f`). A follow-up commit records this SHA. Tree clean after it.
- Phase 11: `29be7d9` ("Scope credentials to the controller URL and pin its certificate"), pushed to origin/main (`4b82bd9..29be7d9`). A follow-up commit records this SHA. Tree clean after it.
- Phase 12: `c7b251f` ("List empty AP groups and detect the controller's group model"), pushed to origin/main (`7a848ab..c7b251f`). A follow-up commit records this SHA. Tree clean after it.
- Phase 13a: `0a7f7d1` ("Add the sidebar shell and checkbox multi-select for access points"), pushed to origin/main (`7bf0e6b..0a7f7d1`). A follow-up commit records this SHA. Tree clean after it.
- Phase 13b: `b3ecb65` ("Add the destination pane, move review and sequential bulk moves"), pushed to origin/main (`17dcba5..b3ecb65`). A follow-up commit records this SHA. Tree clean after it.
