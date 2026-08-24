# PROGRESS — Omada WLAN Manager (Electron)

Authoritative checkpoint for `/goahead` runs. Plan source: `todo.md` (code-review findings, 2026-08-24).

## Phase plan

| Phase | Scope (todo.md items) | Status |
|---|---|---|
| 1 | Renderer/main bug fixes: 1.1, 1.4, 1.5, 1.12, 1.13, 1.14 (minimal renderer-side), 1.15, 3.9 | **done** |
| 2 | API client robustness (`omada-api.ts`): 1.3, 1.6, 1.7, 1.8, 3.13 | pending |
| 3 | Config & credential security: 2.1, 2.4, 2.5 (+1.14 final flag mechanism), 2.7, 3.6 | pending |
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

## Next action

Run Phase 2: spawn one worker for API-client robustness in `src/main/omada-api.ts` — todo.md items 1.3 (merge cookies by name instead of replacing the jar), 1.6 (reject non-2xx with bounded excerpt, 15 s abort timeout, response size cap), 1.7 (detect "login required" error codes, transparent one-shot re-login + retry), 1.8 (add `logout()` calling `POST /{omadacId}/api/v2/logout`, invoke from the disconnect IPC handler and on app quit, clear cookies/token/siteId), 3.13 (runtime validation of API list responses). Then verify build, Codex-review aggregate, commit, push.

## Key paths

- `src/renderer/renderer.ts` — UI logic, i18n table, confirm modal, connect/disconnect
- `src/main/index.ts` — window creation, IPC handlers, cert verification
- `src/main/omada-api.ts` — OmadaController HTTP client
- `src/main/config.ts` — config persistence
- `src/main/preload.ts` — contextBridge API

## Git state

- Start of run: clean tree at b8c182f except untracked `todo.md`.
