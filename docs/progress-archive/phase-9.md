# Phase 9 — test harness (todo 4.2), 2026-10-06

- **Risk:** routine. **Worker:** opus (one worker, plus one orchestrator fix after review). Run under `/autoclaude-opus`, driven mode.

## Acceptance criteria and results

| Criterion | Result |
|---|---|
| `npm run build` exits 0 | Met — exit 0 (worker, and twice by the orchestrator, incl. after the review fix) |
| `npm test` exits 0, ≥ 1 fixture test per validator, plus cookie-merge and URL-normalization tests, no Electron | Met — 143/143 tests in 13 suites, valid + invalid fixtures for all 3 validators (`validateAccessPoints`, `validateWlanGroups`, `validateSitePage`) |
| `npm run smoke` covers es/en startup, first run, connect → lists, single AP move confirm/cancel, zero console errors, plus the phase-8 unverified paths (site selection, refresh, disconnect) | Met — `ELECTRON_PATH=… npm run smoke` exit 0, 39/39 checks, zero console/page errors, no network requests |
| `HOME` is a fresh temp dir on every launch; no test path references the real config | Met — checked by the smoke itself ("HOME and Electron userData were fresh temp dirs") and by an rg audit of `tests/` |
| Production behaviour unchanged; `dist/` has no test code | Met — `index.ts` passes `netTransport`; `dist/` holds only `main/`, `shared/`, `renderer/` |
| No conflicted copies | Met — `fd -H "conflicted copy"` empty |

## What was built

- **Electron-free main modules:** `src/main/url.ts` (`normalizeControllerUrl()`, moved from `config.ts`), `src/main/cookie-jar.ts`, `src/main/omada-validators.ts`, `src/main/omada-transport.ts` (transport interface, `createHardenedTransport()` — the 15 s timeout covering the whole exchange, the 5 MB cap and settle-once logic, moved verbatim — and `parseOmadaResponse()`). `src/main/net-transport.ts` is the only Electron-dependent piece; `index.ts` injects it into `OmadaController`.
- **`npm test`** = `scripts/run-unit-tests.mjs`: type-checks `tests/` (`tests/tsconfig.json`), bundles each test with esbuild into an OS temp dir (failing if anything imports `electron`) and runs `node:test` with `HOME` set to a temp dir. Tests in `tests/unit/*.test.ts`, a fake transport in `tests/unit/helpers/fake-transport.ts`, JSON fixtures in `tests/fixtures/{validators,cookies,config,controller,smoke}/`.
- **`npm run smoke`** = build + `tests/smoke/run-smoke.mjs` (playwright-core `_electron`). `tests/smoke/stub-main.cjs` builds the window like the real app (real `dist/main/preload.js`, `sandbox: true`, real `dist/renderer/index.html`) and answers every `IPC_CHANNELS` channel from fixtures the runner reconfigures at runtime. It refuses to start with the real HOME and blocks all network requests. Electron comes from `ELECTRON_PATH`, else the npm binary if it runs, else a clear error mentioning Dropbox.
- `README.md` has a Testing section. `todo.md` item 4.2 is marked done.

## Bug found by the smoke

- The confirm modal opened by clicking Apply left keyboard focus on `<body>`. `.btn { transition: all }` also animated the inherited `visibility`, so Confirm was still hidden when `focus()` ran. Same trap as the 2026-08-29 `.modal-overlay` fix. Fixed in `src/renderer/styles.css` (`transition: all var(--transition), visibility 0s`). The check failed before the fix and passes after. This bug was there before phase 8; it is not a phase-8 regression.

## Review

- Codex, `docs/reviews/phase9.md`, **ship-with-fixes**, 0 blockers. One should-fix: `playwright-core` 1.63 needs Node ≥ 20 but the README said Node 18+. **Resolved by the orchestrator:** README now says Node.js 20+, and `package.json` declares `"engines": {"node": ">=20"}` (lockfile synced with `npm install --package-lock-only`). Node 18 has been EOL since April 2025. Codex found no production HTTP regression.

## Deviations and notes

- Electron 28 has no `webContents.getLastWebPreferences()`, so the "window built like the real app" check reads the options the stub recorded and confirms OS-level sandboxing via `app.getAppMetrics()`.
- `.gitignore` was not changed: all test output goes to the OS temp dir.
- Not fixed (it would change behaviour): `normalizeControllerUrl()` accepts `https://host/#` (an empty fragment) and keeps the trailing `#`.
- `npm install` reports 24 audit vulnerabilities (1 critical, 17 high). They come from the existing Electron 28 / electron-builder 24 toolchain, which phase 10 upgrades.

## Verification commands

- `npm run build` → exit 0
- `npm test` → exit 0, 143/143
- `ELECTRON_PATH=/private/tmp/omada-p8-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` → exit 0, 39/39
- `fd -H "conflicted copy"` → empty
