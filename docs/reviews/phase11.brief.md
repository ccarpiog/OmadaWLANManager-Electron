# Review brief — phase 11 (todo 4.4): URL-scoped credentials + certificate TOFU pinning

- **Repo:** `/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron` (Electron 44 + TypeScript 7; main / sandboxed preload / esbuild-bundled renderer). Review the **uncommitted** working tree against `HEAD`.
- **Review file:** `docs/reviews/phase11.md`
- **Time budget:** 10 minutes.

## Goal
1. Changing the controller URL (normalized) clears the stored password (blob + legacy plaintext), `encryptedClientSecret` if present, site id and certificate pin; a blank password on a URL change is rejected (`passwordRequired`). Main enforces it, the renderer mirrors it.
2. TOFU pinning per normalized origin: SHA-256 leaf fingerprint; first-use dialog ("Trust and connect"), mismatch ("certificate changed") dialog, "Reset trusted certificate" in Settings. **No credential (login POST) may be sent before the pin check passes.** The same decision applies in `setCertificateVerifyProc` and `certificate-error`. TOFU only governs the existing self-signed bypass class set (`isSelfSignedVerificationResult()`); CA-trusted certs (`net::OK`) and other hosts keep Chromium's verdict.
3. `normalizeControllerUrl()` and its renderer mirror no longer keep an empty `#` fragment. README's stale plaintext/Python config note fixed.

## Changed files
New: `src/main/cert-pinning.ts` (pure decision logic), `src/main/cert-verify.ts` (verify-proc installer + controller session), `src/main/config-model.ts` (pure save rules), `src/renderer/cert-modal.ts`, `tests/unit/{cert-pinning,config-model,renderer-validation}.test.ts`, `tests/fixtures/certs/`, `tests/tls-probe/` (opt-in `npm run tls-probe`: real Electron vs a local 127.0.0.1 HTTPS server with openssl self-signed certs).
Modified: `src/main/{config,index,net-transport,omada-api,preload,url}.ts`, `src/shared/types.ts`, `src/renderer/{apply-translations,connection,elements,i18n,modal-focus,renderer,settings-modal,state,validation}.ts`, `src/renderer/{index.html,styles.css}`, `tests/smoke/{run-smoke.mjs,stub-main.cjs}`, `tests/unit/url.test.ts`, test fixtures, `package.json`, `README.md`, `todo.md`. (`PROGRESS.json` is a workflow record — ignore.)

## Verification already run (all exit 0)
- `npm run build`
- `npm test` — 220/220
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 51/51, zero console errors
- `ELECTRON_PATH=… npm run tls-probe` — 17/17: first use rejected in the handshake with 0 HTTP requests at the server; retry after trust → 200; different cert on same/other port → mismatch, 0 requests; after reset → first use again; e2e against `dist/main/index.js` with a fake controller shows no login POST before trust and a forged `CERT_TRUST` nonce refused.

## Key design facts to check
- The probe showed Electron 44.5.1 caches verify-proc verdicts per (cert, hostname), and neither `closeAllConnections()` nor re-installing the proc clears that. So controller requests go through a **dedicated in-memory session** replaced with a fresh one on trust, reset, URL change and before a connect that follows a rejection. Old sessions stay alive until quit.
- `CERT_TRUST` takes only a generation-bound nonce; main pins the fingerprint it recorded itself. `CERT_RESET` takes no arguments and disconnects first if connected. Mismatch has no trust action (reset in Settings).

## Risks to probe hardest
- Any path where the password or a login POST can go out before the pin check (including re-login after session expiry `-1200`, site selection, the reconnect after trust, the startup auto-connect).
- Races: pending pin event vs connect generation; trust/reset while a connect is in flight; stale nonce reuse; the verify proc's pending event attributed to the wrong attempt.
- Whether the new controller session is used by *every* controller request (login, logout, re-login, AP move) and whether replacing it mid-flight can leave a request on an old, still-trusting session.
- URL-change clearing: any save path that keeps the old password/pin/site for a new origin; normalization equality edge cases.
- IPC guards on the new channels (sender assertion, shape/nonce checks), secrets never returned over IPC, i18n es/en parity, no innerHTML/inline styles, CSP unchanged.
