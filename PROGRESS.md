# PROGRESS — Omada WLAN Manager (Electron)

Authoritative checkpoint for `/goahead` runs. Plan source: `todo.md` (code-review findings, 2026-08-24).

## Phase plan

| Phase | Scope (todo.md items) | Status |
|---|---|---|
| 1 | Renderer/main bug fixes: 1.1, 1.4, 1.5, 1.12, 1.13, 1.14 (minimal renderer-side), 1.15, 3.9 | **done** |
| 2 | API client robustness (`omada-api.ts`): 1.3, 1.6, 1.7, 1.8, 3.13 | **done** |
| 3 | Config & credential security: 2.1, 2.4, 2.5 (+1.14 final flag mechanism), 2.7, 3.6 | **done** |
| 4 | Renderer/IPC/cert hardening: 1.9, 2.2, 2.3a (origin compare), 2.6, 3.14 | pending |
| 5 | Packaging & platform: 1.2, 3.5, 3.15 | pending |
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

## Next action

Run Phase 4: spawn one worker for renderer/IPC/cert hardening — todo.md items 1.9 (build list items with `document.createElement`/`textContent`/`dataset` instead of HTML strings; validate MAC/WLAN-id formats in renderer and main), 2.2 (`sandbox: true`, verify preload still works via contextBridge + ipcRenderer.invoke), 2.3a (in `certificate-error` compare parsed origins instead of `startsWith`; keep `setCertificateVerifyProc` hostname check but note 2.3b TOFU pinning stays deferred), 2.6 (validate `event.senderFrame.url` is the packaged file: URL in every `ipcMain.handle`; runtime-guard payload shapes — types, lengths, MAC/id formats), 3.14 (tighten CSP: replace inline styles from `updateSelectionInfo()` with a CSS class, then `style-src 'self'`, add object-src/base-uri/frame-src/form-action 'none'). Then verify build, Codex-review aggregate, commit, push.

## Key paths

- `src/renderer/renderer.ts` — UI logic, i18n table, confirm modal, connect/disconnect
- `src/main/index.ts` — window creation, IPC handlers, cert verification
- `src/main/omada-api.ts` — OmadaController HTTP client
- `src/main/config.ts` — config persistence
- `src/main/preload.ts` — contextBridge API

## Git state

- Start of run: clean tree at b8c182f except untracked `todo.md`.
