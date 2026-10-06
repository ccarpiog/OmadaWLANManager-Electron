# Phase 10 — Electron upgrade (todo 4.3, absorbs 3.3), 2026-10-06

- **Worker:** opus (one phase worker). No commit by the worker; the orchestrator commits.

## Versions before → after

| Component | Before | After | Note |
|---|---|---|---|
| `electron` | 28.3.3 | **44.5.1** | npm `latest` (current stable major is 44) |
| Chromium (in Electron) | 120.0.6099.291 | **152.0.7977.130** | read from `process.versions` of each binary |
| Node.js (in Electron) | 18.18.2 | **24.21.0** | idem |
| `electron-builder` | 24.13.3 | **26.17.0** | newest stable and GitHub "Latest" release; npm's `latest` dist-tag still points at 26.15.3 (26.15.4–26.17.0 were published under the `v26` tag while `next` carries 27.0.0-alpha) |
| `dmg-builder` | 24.13.3 | **26.17.0** | equal to electron-builder (electron-builder 26.17.0 pins it exactly; deduped) |
| `typescript` | 5.9.3 | **7.0.2** | npm `latest`; the native (Go) compiler |
| `@types/node` | 20.19.25 | **24.19.1** | newest 24.x, matching Electron's Node 24 |
| `playwright-core` | 1.63.0 | 1.63.0 | already the newest stable; drives Electron 44 fine (smoke 40/40) |
| esbuild renderer target | `chrome120` | **`chrome152`** | `scripts/build-renderer.mjs` |
| `@electron/notarize` (transitive) | 2.2.1 | 2.5.0 | |
| `app-builder-bin` (transitive) | 4.0.0 | — (gone) | electron-builder 26 no longer ships the Go helper binary |
| `engines.node` | `>=20` | `^22.18.0 \|\| >=24.2.0` | see "Node.js module-resolution bug" below |

## Acceptance criteria and results

| Criterion | Result |
|---|---|
| electron on the current stable major; electron-builder = dmg-builder on the newest stable; TypeScript and `@types/node` bumped; `mac.notarize` exactly `true` | Met — see the table above; `package.json` `build.mac.notarize` is still `true` |
| `npm run build` exit 0 | Met |
| `npm test` exit 0, ≥ 143 tests | Met — 143/143 (13 suites) |
| `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` exit 0, ≥ 39 checks, zero console errors, new Electron shown | Met — 40/40; output prints `running Electron 44.5.1 (Chromium 152.0.7977.130, Node 24.21.0)` for both launches and the new check "every launch ran the installed Electron 44.5.1" passes |
| `dist/main/preload.js` requires only `electron` | Met — single `require("electron")` |
| Unsigned `electron-builder --mac --dir` to `/private/tmp/omada-p10-build` exits 0 with the new Electron | Met with a workaround — see "Node.js module-resolution bug": with this machine's Node 22.15.1 the plain `npx electron-builder …` fails; `node --no-turbo-fast-api-calls node_modules/electron-builder/cli.js …` exits 0. `Electron Framework.framework/Resources/Info.plist` `CFBundleVersion` = 44.5.1 |
| Breaking-change table and `npm audit` remainder recorded | Met — below |
| todo.md 3.3/4.3 marked; README versions current | Met |
| `fd -H "conflicted copy"` prints nothing | Met |

## Electron breaking changes 29 → 44, per API the app uses

Source: `docs/breaking-changes.md` at tag `v44.5.1` of electron/electron, plus `docs/api/web-contents.md` and `electron.d.ts` 44.5.1 for deprecations that the breaking-changes file does not list.

| API (where) | Changed in 29–44? | Action |
|---|---|---|
| `BrowserWindow` options: `webPreferences.{preload, contextIsolation, nodeIntegration, sandbox}`, size limits, `titleBarStyle: 'hiddenInset'`, `show: false` (`index.ts`, stub) | No API change. 43 rounded corners / WCO layout are Linux frameless-only (the app keeps the native frame there) | None |
| `loadFile`, `ready-to-show`, `closed`, `BrowserWindow.getAllWindows`, `app.whenReady`, `activate`, `window-all-closed`, `before-quit`, `app.quit` (`index.ts`) | No | None |
| Sandboxed preload: `contextBridge.exposeInMainWorld` + `ipcRenderer.invoke`, polyfilled `process.platform` (`preload.ts`) | 29: the `ipcRenderer` module itself can no longer cross the bridge (arrives empty). 44: preloads in DevTools-extension frames only (n/a) | None: the preload exposes only wrapper functions. Compiled preload unchanged and still requires only `electron`; the smoke confirms the full bridge |
| `ipcMain.handle` + `event.senderFrame` URL check (`assertTrustedIpcSender`, stub) | 33: `senderFrame` may be `null` or detached when read late (after a cross-origin navigation) | None: every handler reads it synchronously as its first statement and treats `null` as untrusted (already the case) |
| `webContents` `will-navigate` (`index.ts`, stub) | Positional `url`/`isInPlace`/`isMainFrame`/`frameProcessId`/`frameRoutingId` arguments are deprecated in favour of the details event (`@deprecated` in `electron.d.ts`; not in the breaking-changes file) | Switched to `event.url` in both; same check (`protocol !== 'file:'` → `preventDefault()`) |
| `webContents.setWindowOpenHandler` → `deny` | 39: popups are always resizable (only matters for allowed popups) | None |
| `app` `certificate-error` (`index.ts`) | No | None |
| `session.setCertificateVerifyProc` (`request.hostname`, `request.verificationResult`, `callback(0 \| -3)`) (`index.ts`) | No | None |
| `app` `select-client-certificate` (not handled before) | 44: now also emitted for `net.request()` (with `webContents === null`); when unhandled Electron answers with the first matching certificate from the system store, where before such a `net` request failed with `ERR_SSL_CLIENT_AUTH_CERT_NEEDED` | Added a handler in `index.ts`: `event.preventDefault(); callback()` — continue without a certificate, so the controller can never receive the user's certificate identity (the renderer only loads `file:` URLs, so only controller requests can hit it) |
| `net.request()` (`net-transport.ts`) | 44: rejects `Sec-Fetch-Dest: document/frame/iframe/fencedframe` without `Sec-Fetch-Mode: navigate` | None: the client sets only `Content-Type`, `Accept`, `Csrf-Token` and `Cookie` |
| `safeStorage.isEncryptionAvailable/encryptString/decryptString` (`config.ts`) | No | None |
| CSP in `src/renderer/index.html` (`script-src 'self'`) | No Electron change | None: the smoke reports zero console errors (no CSP violations) on Chromium 152 |
| Smoke only — `webContents` `console-message` (`stub-main.cjs`) | 35: positional `level, message, line, sourceId` deprecated; `level` is now a string (`info`/`warning`/`error`/`debug`) | Switched to the event-object form (`details.level === 'error'`, `details.message`, `details.lineNumber`, `details.sourceId`). A probe on 44.5.1 confirmed `console.error` arrives as `level: 'error'` |
| Smoke only — `preload-error`, `render-process-gone`, `did-fail-load`, `session.webRequest.onBeforeRequest(listener)` without a filter, `app.setPath('userData')`, `app.getAppMetrics().sandboxed`, `getOSProcessId()` | 29 removed `crashed` (not used); 35 changed only explicit `urls: []` filters (none used) | None |
| Smoke only — `webContents.getLastWebPreferences()` | Not public in 28 or 44 (absent from `electron.d.ts` and the docs), but a probe shows it exists at runtime in both and returns the effective `sandbox`/`contextIsolation`/`nodeIntegration` (not `preload`) | Now used by the "window built like the real app" check; the recorded-options checks stay, so the check is stricter, and a missing method fails it |
| `electron` npm package | 42: no `postinstall` download; the binary is fetched on first use (`require('electron')`, `npx electron`, `npx install-electron --no`) | The smoke's fallback no longer `require`s the package (that would start a ~100 MB download into Dropbox); it reads `path.txt` and only uses an already-downloaded binary |
| Supported OS | 33/38/44 dropped macOS 10.15/11/12; 44 dropped win32-ia32 and linux-armv7l | The macOS app now needs macOS 13+ (packaged `LSMinimumSystemVersion` = 13.0); README updated. Build targets use default 64-bit arches |
| Reviewed, not used by the app | 30 `BrowserView`, `context-menu` `inputFormType`, `process.getIOCounters`; 31 WebSQL, `nativeImage.toDataURL`, `flashFrame`; 32 `File.path`, navigation-history methods; 33 `execCommand('paste')`, Windows custom protocols, `login` webContents; 34 Windows fullscreen menu bar; 35 dialog `defaultPath` on Linux, `setPreloads`, service workers; 36 `app.commandLine` lower-casing, session extension methods, `getBitmap`, GTK 4; 37 utility process, `ProtocolResponse.session`; 38 `plugin-crashed`, `webFrame.routingId`, Ozone env vars; 39 `--host-rules`, audio capture plist key, OSR paint; 40/44 renderer `clipboard`; 41 PDF WebContents, cookie change cause; 42 `UNNotification`, OSR scale factor, `clearStorageData` quotas, `createFromNamedImage`; 43 `toBitmap` colour space, `chrome.scripting`, dialogs default to Downloads; 44 subframe worker Node integration, static ANGLE, Unity, login-item attributes | None |

## Code and config changes

- `package.json`: devDependencies bumped as above; `engines.node` → `^22.18.0 || >=24.2.0`. `build` config unchanged (`mac.notarize` still `true`; no key was rejected by electron-builder 26's schema). `package-lock.json` regenerated by `npm install` + `npm audit fix` (non-forced) + `npm install --package-lock-only`.
- `tsconfig.json`, `tests/tsconfig.json`: TypeScript 7 removed `moduleResolution: node` (node10) — `tsc` fails with TS5108. Both now use `module`/`moduleResolution: nodenext` (Node's own resolution; `package.json` has no `"type"`, so every file is CommonJS). The root config also sets `types: ["node"]` because TypeScript 6+ no longer loads every `@types` package by default. `src/renderer/tsconfig.json` is unchanged (ESNext + bundler, `types: []`). No `ignoreDeprecations`; strictness unchanged. The compiled `dist/` is byte-identical to the pre-upgrade build apart from the two intended `index.ts` changes; the renderer bundle is identical (40.9 kB).
- `scripts/resolve-tsc.mjs` (new): TypeScript 7's `package.json` `exports` map no longer exports `./bin/tsc`, so `require.resolve('typescript/bin/tsc')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. `resolveTscPath()` reads the launcher from the exported `package.json` `bin` field; `scripts/run-unit-tests.mjs` (type-check step) and `scripts/build-renderer.mjs` (watch mode) use it. `build-renderer.mjs` target → `chrome152`.
- `src/main/index.ts`: `will-navigate` reads `event.url`; new `select-client-certificate` handler; JSDoc + closing-brace comment on `createWindow()`.
- `tests/smoke/stub-main.cjs`: event-object `console-message`; `will-navigate` mirrors `index.ts`.
- `src/renderer/modal-focus.ts`: a JSDoc comment no longer names Electron 28 (comment only).
- `tests/smoke/run-smoke.mjs`: `findDownloadedPackageBinary()` replaces `require('electron')` in the fallback; `launch()` prints and records the running `process.versions` (electron/chrome/node); new global check "every launch ran the installed Electron <version>" (compares with `node_modules/electron/package.json`, so a stale `ELECTRON_PATH` fails); the window check adds `getLastWebPreferences()`. 39 → 40 checks.
- `README.md`: Requirements (Node 22.18+/24.2+ and why, macOS 13+, toolchain versions) and the smoke "Electron binary" note (Electron 42+ download-on-first-use, version check).
- `todo.md`: 3.3 and 4.3 marked done.

## electron-builder 26 notarization (`mac.notarize: true`)

From `node_modules/app-builder-lib/out/mac/MacTargetHelper.js` (`getNotarizeOptions()` / `notarizeIfProvided()`), 26.17.0:

- The schema now types `notarize` as **boolean only** (the 24.x object form with `teamId` is gone), so `true` is the only enabling value.
- `notarize: false` → skipped. Otherwise the tool is `notarytool` (via `@electron/notarize` 2.5.0) and the credentials come from the environment, first match wins:
  1. `APPLE_ID` or `APPLE_APP_SPECIFIC_PASSWORD` set → requires all of `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (missing one throws `InvalidConfigurationError`).
  2. Any of `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` set → requires all three.
  3. `APPLE_KEYCHAIN_PROFILE` set → notarytool keychain profile, plus `APPLE_KEYCHAIN` when set (`APPLE_KEYCHAIN` alone does nothing).
  4. Nothing set → warning "skipped macOS notarization" (the build does not fail).
- `APPLE_TEAM_ID` is read only in branch 1.
- So the `AC_NOTARY_PROFILE` keychain profile is still honoured: run the signed build with `APPLE_KEYCHAIN_PROFILE=AC_NOTARY_PROFILE` and with none of the branch-1/branch-2 variables set (they take precedence).
- A full `--mac` DMG build now downloads a checksummed `dmgbuild-bundle-arm64-75c8a6c.tar.gz` from electron-builder-binaries into electron-builder's cache (not exercised here; `--dir` only).

## Node.js module-resolution bug (new environment gotcha)

- Symptom: `npx electron-builder --mac --dir …` fails at "searching for node modules" with `Cannot find module 'async-exit-hook'` (and an earlier `cannot check updates … Cannot find module 'simple-update-notifier'`). The modules are installed; `node -e "require.resolve(...)"` finds them.
- Cause: Node 22.15.1 (this machine) has the V8 fast-API `FastInternalModuleStat`, which builds the path from a one-byte (Latin-1) V8 string. Once the CJS loader's `stat()` is optimized, every lookup under a path with Latin-1 non-ASCII characters (`InformáticaHispanoInglés`) fails (nodejs/node#58586, fixed by #58489). Diagnosed in-process: the loader's `stat()` returned -1/-2 for `node_modules` while the plain binding call and `fs.statSync` returned "directory". electron-builder 26 loads enough modules to trigger it; build/test/smoke do not.
- Affected: Node 22.9–22.17 and 24.0–24.1 (checked in `src/node_file.cc` per tag). Fixed: 22.18.0+, 24.2.0+.
- Workaround on an affected Node: `node --no-turbo-fast-api-calls node_modules/electron-builder/cli.js …` (the V8 flag is not accepted in `NODE_OPTIONS`). Fix: upgrade Node. `engines.node` now says `^22.18.0 || >=24.2.0`, so `npm install` prints an `EBADENGINE` warning on Node 22.15.1.

## Other environment notes

- New smoke Electron: `/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron`, extracted with `ditto -x -k` from `electron-v44.5.1-darwin-arm64.zip` (downloaded from the GitHub release into `/private/tmp/omada-p10-download/`; SHA-256 `1d75703019bb16461ae65f3081d7e6f5c0b11e901d0ccb5c343bcf7bcdd6435c` matches the release's `SHASUMS256.txt`). Electron 42+ no longer downloads during `npm install`, so `~/Library/Caches/electron/` only gets a 44.5.1 zip when electron-builder packages. Re-extract if `/private/tmp` is cleared. The 28.3.3 copy in `/private/tmp/omada-p8-smoke/` is obsolete (the smoke now fails on a version mismatch).
- Dropbox: electron-builder 26 has no `app-builder-bin`, so the old `app-builder_arm64` exec-bit fix is no longer needed. TypeScript 7 ships a native binary at `node_modules/@typescript/typescript-darwin-arm64/lib/tsc`; if Dropbox ever strips its exec bit, `tsc` fails with `EACCES` — `chmod +x` it.
- The first smoke runs printed a benign macOS line in the main-process output (`sandbox_extension_issue_file failed … Operation not permitted`); it did not affect any check and was absent from the final run.

## npm audit

- **Before** (Electron 28 / electron-builder 24): 24 — 1 critical (`tar`), 17 high (`@xmldom/xmldom`, `app-builder-lib`, `brace-expansion`, `builder-util`, `builder-util-runtime`, `dmg-builder`, `electron`, `electron-builder`, `electron-builder-squirrel-windows`, `electron-publish`, `extract-zip`, `form-data`, `http-cache-semantics`, `js-yaml`, `lodash`, `minimatch`, `tmp`), 5 moderate (`@electron/get`, `ajv`, `global-agent`, `roarr`, `sprintf-js`), 1 low (`@tootallnate/once`).
- **After `npm install`:** 10 — 2 high (`@xmldom/xmldom` ≤ 0.8.14, `js-yaml` 4.0.0–4.3.1), 8 moderate.
- `npm audit fix` (non-forced, in-range): `js-yaml` 4.1.1 → 4.3.2, `@xmldom/xmldom` 0.8.11 → 0.8.15 (both transitive, build-time only).
- **Remaining: 8 moderate, 0 high, 0 critical** — one chain: `sprintf-js` (all versions, GHSA-hp3w-g68c-fv3c, DoS via unbounded precision) → `roarr` ≤ 2.15.4 → `global-agent` ≤ 3.0.0 → `@electron/get` 3.1.0 (dependency of `app-builder-lib` 26.17.0) → flagged as a consequence: `app-builder-lib`, `dmg-builder`, `electron-builder`, `electron-builder-squirrel-windows`. npm's only "fix" is a downgrade to electron-builder/dmg-builder 26.5.0 (marked breaking) — not applied. Build-time only: the packaged app ships no `node_modules` (`app.asar` holds `dist/**` and `package.json`). Electron's own `@electron/get` 5.1.0 is not affected.

## Verification commands

- `npm audit` (before) → exit 1, 24 vulnerabilities
- `npm install` → exit 0
- `npx tsc --noEmit -p .` (before the tsconfig fix) → exit 1, TS5108 `moduleResolution=node10` removed
- `npm run build` → exit 0 (run several times, last after the audit fix)
- `npm test` → exit 0, 143/143
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` → exit 0, 40/40
- `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir -c.directories.output=/private/tmp/omada-p10-build -c.mac.notarize=false` → exit 1 on Node 22.15.1 (`Cannot find module 'async-exit-hook'`, see above)
- `CSC_IDENTITY_AUTO_DISCOVERY=false node --no-turbo-fast-api-calls node_modules/electron-builder/cli.js --mac --dir -c.directories.output=/private/tmp/omada-p10-build -c.mac.notarize=false` → exit 0; `plutil -extract CFBundleVersion raw ".../Electron Framework.framework/Resources/Info.plist"` → `44.5.1`; app `LSMinimumSystemVersion` 13.0; `app.asar` = `dist/**` (no maps, no `.d.ts`) + `package.json`
- `rg -n "require\(" dist/main/preload.js` → only `require("electron")`
- `node scripts/build-renderer.mjs --watch` → esbuild watch + `tsc -p src/renderer --watch` start ("Found 0 errors")
- `npm audit fix` → exit 1 (8 moderate remain); `npm audit` (after) → exit 1, 8 moderate
- `fd -H "conflicted copy"` → empty

## Deviations and open items

- The exact acceptance command (`npx electron-builder …`) does not pass on this machine's Node 22.15.1 because of the Node bug above; the same build passes with the V8 flag. Upgrading the local Node (22.18+ or 24.2+) removes the need for the flag.
- Windows and Linux packaging were not exercised (macOS-only environment).
- `PROGRESS.md` "Environment" still says Node.js ≥ 20 and points the smoke at the 28.3.3 copy; it needs the new path and Node requirement.

## Review and closure

- Reviewer: Codex (`autoclaude-review.sh`), report `docs/reviews/phase10.md`, verdict **ship-with-fixes**, 1 blocker, 0 should-fix.
- Blocker: `npm run build`, `build:renderer` and `watch` still started `tsc` through the `node_modules/.bin` shim, which Dropbox breaks. `resolveTscPath()` was only used by the unit tests and the renderer watch. **Fixed by the orchestrator:** a new `scripts/tsc.mjs` launcher runs the resolved compiler with Node and forwards the arguments and the exit status. All three npm scripts now call `node scripts/tsc.mjs …`, and the README explains why.
- Re-verified after the fix: `node scripts/tsc.mjs --version` → 7.0.2; `node scripts/tsc.mjs -p does-not-exist` → exit 1, so failures propagate; and these exit 0: `npm run build`; `npm test` 143/143; `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron node tests/smoke/run-smoke.mjs` 40/40 on Electron 44.5.1. The packaging build was not re-run, since the fix only touches the `tsc` entry points ahead of it.
