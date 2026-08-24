# PROGRESS — Omada WLAN Manager (Electron)

Authoritative checkpoint for `/goahead` runs. Plan source: `todo.md` (code-review findings, 2026-08-24).

## Phase plan

| Phase | Scope (todo.md items) | Status |
|---|---|---|
| 1 | Renderer/main bug fixes: 1.1, 1.4, 1.5, 1.12, 1.13, 1.14 (minimal renderer-side), 1.15, 3.9 | **done** |
| 2 | API client robustness (`omada-api.ts`): 1.3, 1.6, 1.7, 1.8, 3.13 | **done** |
| 3 | Config & credential security: 2.1, 2.4, 2.5 (+1.14 final flag mechanism), 2.7, 3.6 | **done** |
| 4 | Renderer/IPC/cert hardening: 1.9, 2.2, 2.3a (origin compare), 2.6, 3.14 | **done** |
| 5 | Packaging & platform: 1.2, 3.5, 3.15 | **done** |
| 6 | UX improvements: 3.1, 3.2, 3.7, 3.8 | pending |
| 7 | Connection flow & multi-site: 1.11, 3.12 | pending |

**Deferred (need user input or live controller):**
- 1.10 status-category mapping — needs verification against a live controller.
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

## Open risks

- Verify-proc cert bypass is hostname-scoped, not origin-scoped (Electron API limitation, see phase 4 notes); fully closed only by deferred item 2.3b (TOFU pinning).
- Phase 4's sandbox + IPC hardening has not had a live GUI smoke test (`npm start`).

## Next action

Run Phase 6: spawn one worker for UX improvements — todo.md items 3.1 ("Replace blocking `alert()` calls with in-app toasts"), 3.2 ("Add a Refresh button and loading indicators"), 3.7 ("Keyboard/UX niceties in the settings modal"), 3.8 ("i18n and accessibility polish"). Worker reads those items in `todo.md` for full instructions. All four are renderer-heavy: every new user-facing string must land in BOTH es and en i18n tables; the strict CSP (`style-src 'self'`, no inline styles) and DOM-building conventions from phase 4 (`createElement`/`textContent`, no innerHTML) must be preserved. Also a phase-6 polish candidate flagged in phase 3: `OMADA_CONNECT`'s hardcoded Spanish error strings in `src/main/index.ts` should move to i18n error codes mapped in the renderer. Then verify build, Codex-review aggregate, commit, push.

## Key paths

- `src/renderer/renderer.ts` — UI logic, i18n table, confirm modal, connect/disconnect
- `src/main/index.ts` — window creation, IPC handlers, cert verification
- `src/main/omada-api.ts` — OmadaController HTTP client
- `src/main/config.ts` — config persistence
- `src/main/preload.ts` — contextBridge API

## Git state

- Phase 4 committed as 37450f1, phase 5 committed on top (SHA in `git log`), both pushed to origin/main (2026-08-24).
