# Phase 8 — renderer modularization with esbuild (todo 4.1, absorbs 3.4)

Closed 2026-10-06 under `/autoclaude-opus`. Risk class: high. Worker model: opus.

## What changed

- `esbuild` (^0.28.2) devDependency. `npm run build` is now
  `tsc && npm run build:renderer && npm run copy-static`, where
  `build:renderer` = `tsc -p src/renderer && node scripts/build-renderer.mjs`.
- The root `tsconfig.json` excludes `src/renderer`; `src/renderer/tsconfig.json`
  type-checks the renderer only (`noEmit`, no Node types).
- `scripts/build-renderer.mjs` deletes `dist/renderer` and then writes one
  strict-mode IIFE `dist/renderer/renderer.js` (target `chrome120`, linked
  source map that `build.files` already excludes). `--watch`
  (`npm run watch:renderer`) runs esbuild's watch mode with
  `tsc -p src/renderer --watch` as a child process. It stops on
  SIGINT/SIGTERM/SIGHUP.
- `src/renderer/renderer.ts` is now the entry: event wiring + init sequence
  only. There are 17 modules: `state` (every former module-level `let`, in one
  `state` object), `elements`, `i18n`, `apply-translations`, `status`,
  `toast`, `validation`, `dom-helpers`, `panels`, `ap-list`, `wlan-list`,
  `modal-focus`, `settings-modal`, `confirm-modal`, `site-modal`,
  `connection`, `apply-change`. There are no import cycles.
- Shared types come from `src/shared/types.ts` via `import type` only, and the
  renderer duplicates are gone. The `OmadaAPI` bridge interface moved from the
  preload into `src/shared/types.ts`, with `platform: string`. The preload
  checks its bridge object with `satisfies OmadaAPI`, which only affects type
  checking. The compiled preload still requires only `electron`.
- `index.html` and `styles.css` are byte-identical to before.

## Acceptance (all met)

| Criterion | Evidence |
|---|---|
| Build exit 0 from a clean `dist/` | `rm -rf dist && npm run build` → exit 0 (orchestrator, twice incl. after review fix) |
| One bundled renderer script loaded by `index.html` | `dist/renderer/` = `index.html`, `renderer.js`, `renderer.js.map`, `styles.css`; script tag unchanged |
| Bundle has no module/eval leftovers | `rg -n "require\(\|exports\.\|^\s*import \|\bimport\(\|eval\(\|new Function" dist/renderer/renderer.js` → no matches |
| No duplicated renderer types | `rg -n "interface AccessPoint\|interface WlanGroup\|type Language" src/renderer` → no matches |
| Markup unchanged | `git diff --quiet -- src/renderer/index.html src/renderer/styles.css` → exit 0 |
| Behavior unchanged | The worker compared old and new code with a script: all 47 functions and the init block match line for line apart from the `state.` prefixes. Isolated launch smoke 21/21 (see below) |

## Launch smoke (throwaway, outside the repo)

`node /private/tmp/omada-p8-tools/smoke.mjs <pw-dir> <Electron binary> <project root>`
with Playwright-core in `/private/tmp/omada-p8-smoke/pw`, Electron 28.3.3
extracted to `/private/tmp/omada-p8-smoke/electron/Electron.app`, and `HOME`
pointed at a fresh temp dir. Result: 21/21. Checked: one window and one
script, translations applied, `pre-init` removed, the first-run settings modal
opens with focus in the URL field, focus trap in both directions, background
inert, Escape, invalid-URL toast, bridge present, no leaked globals, zero
console/page errors, no config written. **Not covered:** the connected paths
(connect → lists, site selection, AP move, refresh, disconnect), which need
the stubbed main that phase 9 adds. `/private/tmp` does not survive a reboot.

## Review

Codex adversarial review, `docs/reviews/phase8.md`: **ship-with-fixes**, 0
blockers, 1 should-fix. The finding was that `watch:renderer` ran esbuild
without type-checking. It was fixed by the orchestrator in
`scripts/build-renderer.mjs` with `startTypeCheckWatcher()`. Verified:
watch mode prints "Found 0 errors", and SIGTERM leaves no orphan tsc process.

## Known leftovers

- Four comments in `index.html`/`styles.css` still say `renderer.ts` for code
  that moved to `apply-translations`, `site-modal`, `ap-list` and `toast`.
  The files were kept byte-identical on purpose; fix them when phase 13
  changes the markup.
- Renderer functions are no longer globals on `window`. Nothing in the app
  used them that way.
