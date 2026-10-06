# Phase 10 review brief — Electron upgrade (todo.md 4.3, absorbs 3.3)

- **Repo:** the current working directory (`omada-electron`), branch `main`. Review the **uncommitted** working tree against `HEAD`.
- **Review file:** `docs/reviews/phase10.md`
- **Time budget:** 15 minutes.

## Goal

Upgrade Electron 28.3.3 → current stable major (44.5.1) and the tooling (electron-builder/dmg-builder 24.13.3 → 26.17.0, TypeScript 5.9.3 → 7.0.2, @types/node 20 → 24) **with no behavior change**. Keep the security posture: a sandboxed preload, the IPC sender checks, the certificate bypass scoped to the configured controller, the CSP, and `net.request` transport hardening. Packaging: `mac.notarize` must stay a plain `true` (the user notarizes through a notarytool keychain profile).

## Changed files

`package.json`, `package-lock.json`, `tsconfig.json`, `tests/tsconfig.json`, `scripts/build-renderer.mjs` (esbuild target chrome120 → chrome152), `scripts/run-unit-tests.mjs`, new `scripts/resolve-tsc.mjs` (TS 7 no longer exports `bin/tsc`), `src/main/index.ts` (`will-navigate` reads `event.url`; new `select-client-certificate` handler that never sends a client certificate), `src/renderer/modal-focus.ts` (comment only), `tests/smoke/run-smoke.mjs` + `tests/smoke/stub-main.cjs` (sandbox check via `getLastWebPreferences()`, asserts the Electron version on every launch), `README.md`, `todo.md`, and the new narrative `docs/progress-archive/phase-10.md` (versions, a per-API breaking-change table, `npm audit` before/after).

## Verification already run (by the orchestrator, all exit 0)

- `npm run build`
- `npm test`: 143/143
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron node tests/smoke/run-smoke.mjs`: 40/40, prints "running Electron 44.5.1 (Chromium 152, Node 24.21.0)"
- `dist/main/preload.js` requires only `electron`.
- The worker reports that an unsigned `electron-builder --mac --dir` to `/private/tmp/omada-p10-build` succeeds only under `node --no-turbo-fast-api-calls`. Plain `npx electron-builder` fails with `Cannot find module 'async-exit-hook'`, because of a Node 22.12–22.17 bug with non-ASCII paths (nodejs/node#58586). Local Node is 22.15.1. The worker therefore set `engines.node` to `^22.18.0 || >=24.2.0`.

## Risks to probe

1. **Breaking changes 29→44**: is the table in `docs/progress-archive/phase-10.md` correct and complete for the APIs `src/main/*.ts` uses? In particular: `setCertificateVerifyProc` (request fields, the `verificationResult` strings that `isSelfSignedVerificationResult()` matches), `certificate-error`, `net.request` (options, redirect and abort semantics in `src/main/net-transport.ts`), `safeStorage`, `contextBridge`/sandboxed preload, `ipcMain.handle` + `event.senderFrame`, `will-navigate`, `setWindowOpenHandler`, and `before-quit`.
2. **The new `select-client-certificate` handler**: is the claim in its comment true for Electron 44? Is `event.preventDefault()` + `callback()` the correct "continue without a certificate" call? Could it break a normal Omada connection?
3. **TypeScript 7 config switch** (`module`/`moduleResolution` → `nodenext`, `types: ["node"]`): is the emitted CommonJS really unchanged? Is the renderer type-check still strict? Is `scripts/resolve-tsc.mjs` robust (it is used by `npm test` and maybe by `build`)? Does `npm run build` still call a working `tsc`?
4. **`engines.node` tightening**: it is justified by the packaging bug, but does it now make `npm install` or `npm test` fail on the user's Node 22.15.1? Is it consistent with README?
5. **Packaging config** under electron-builder 26: do any `build.*` keys in `package.json` need renaming? Is the notarize env-var finding right (keychain profile via `APPLE_KEYCHAIN_PROFILE`)?
6. **Smoke harness**: are the new checks equally strict (sandbox, version)? Can it still fall back to the broken npm Electron binary?
7. **Lockfile**: any unexpected new runtime dependency? Was `npm audit fix` limited to build-time packages?

## Constraints

Do not contact `192.168.1.130` and do not read or write `~/.omada-wlan-manager/`. Never run `npm start`, `npm run dev` or `electron .`; the smoke harness is safe, since it uses a temp HOME and a stubbed main.
