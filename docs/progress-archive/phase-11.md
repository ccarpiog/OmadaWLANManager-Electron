# Phase 11 — URL-scoped credentials + certificate TOFU pinning (todo 4.4, completes 2.3b), 2026-10-06

- **Risk:** high. **Worker:** opus. One phase worker, then one opus worker for the review blockers. Neither worker committed; the orchestrator commits.
- Full per-item description: `todo.md` item 4.4, "Done".

## Acceptance criteria and results

| Criterion | Result |
|---|---|
| A changed normalized URL clears the password (blob + legacy plaintext), `encryptedClientSecret`, site id and pin; a blank password is rejected with `passwordRequired`; main enforces it, the renderer mirrors it | Met — `config-model.ts` `applyConfigSave()` + unit tests; the e2e probe checks the IPC path with the file left untouched |
| TOFU pin per normalized origin, SHA-256 leaf fingerprint, first-use dialog, mismatch dialog, "Reset trusted certificate" in Settings | Met — `cert-pinning.ts`, `cert-verify.ts`, `cert-modal.ts`, Settings pin section; smoke `tofu` launch |
| No credential sent before the pin check passes | Met — TLS probe: first use and mismatch are rejected in the handshake with 0 HTTP requests at the server; e2e: no login POST before trust |
| Same decision in `setCertificateVerifyProc` and `certificate-error` | Met — both call `decideCertificate()`; `certificate-error` additionally requires the exact configured origin |
| `https://host/#` no longer kept (main + renderer mirror); README config note fixed | Met — both reject an empty fragment; unit tests added |
| es/en strings for all new text | Met — the `Translations` interface enforces parity; the build type-checks it |
| `npm run build`, `npm test`, `npm run smoke` exit 0 | Met — 246/246 tests, 52/52 smoke checks |

## Decisions

- **TOFU governs only the self-signed bypass.** Certificates Chromium already trusts (`net::OK`) and hosts other than the configured controller keep Chromium's verdict, so CA-issued certificates that renew (for example Let's Encrypt) never trip a mismatch. The existing `isSelfSignedVerificationResult()` class set stays the eligibility gate, and was not widened. An eligible certificate for the configured hostname is accepted only when its fingerprint equals the pin. Because the pin is a fingerprint, the hostname-only verify proc no longer accepts a different certificate on another port of the same host. That closes the residual risk noted in phase 4.
- **Pin storage:** one config record `{origin, sha256, trustedAt}`. The app is single-controller, and a URL change clears the pin.
- **Fingerprint:** `crypto.X509Certificate(pem).fingerprint256`, i.e. colon-separated uppercase hex SHA-256 of the DER.
- **`CERT_TRUST` takes only a generation-bound nonce.** Main pins the fingerprint it recorded itself, never one supplied by the renderer. A mismatch offers no trust action; the user resets the pin in Settings.
- **Verifier cache (empirical).** Electron 44.5.1 caches the verify proc's verdict per (certificate, hostname). Neither `session.closeAllConnections()` nor re-installing the proc clears it; control runs in the probe show both a stale rejection after trust and a stale acceptance after reset. Controller requests therefore go through `ControllerTlsSessions`, a dedicated in-memory session partition that is replaced on trust, on reset, on a URL change, and before a connect that follows a rejection. Old partitions stay alive until quit, a handful per run.
- **Inline reset confirmation** inside the Settings dialog, because the modal code does not stack dialogs.
- **State transitions (after review):** `ConnectionManager` (`src/main/connection-manager.ts`, Electron-free) owns connect, site selection, disconnect, trust and reset. A URL change and a reset both run one synchronous `invalidateControllerState()`. Save and reset replies carry `connectionReset`.

## Review

- Codex, `docs/reviews/phase11.md`, **ship-with-fixes**, two blockers:
  1. `CONFIG_SAVE` with a changed URL did not bump `connectGeneration`, discard the pending site selection or detach the installed controller, so a stale connect or site selection could complete for the old controller under the new config.
  2. `CERT_RESET` likewise left the installed controller, the pending site selection and the generation untouched.
- **Resolution:** an opus worker moved the transition logic into `ConnectionManager`. A URL change and a reset both run `invalidateControllerState()`: bump the generation, drop pending trust and site selection, detach the installed controller, start best-effort logouts on the old TLS session and switch to a fresh one. Connect and trust re-check generation and URL after every await; select-site has no await. 26 new unit tests cover the concurrency cases, plus four new e2e probe checks (reset during an authenticated in-flight connect, reset while connected without a renderer disconnect, URL change during an in-flight connect, URL change with a pending multi-site selection). The orchestrator re-ran everything; see Verification.

## Verification (orchestrator, after the blocker fixes; all exit 0)

- `npm run build`
- `npm test` — 246/246 (31 suites)
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 52/52, zero console errors
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run tls-probe` — 21/21 (local 127.0.0.1 only, temp HOME, openssl self-signed certificates)
- `rg -n "require\(" dist/main/preload.js` — only `electron`; no `innerHTML`/inline styles in `src/renderer`; CSP line unchanged; `fd -H "conflicted copy"` empty (the second worker removed one conflicted copy of `cert-verify.ts` and its compiled outputs); no private keys under `tests/`.

## Open points carried forward

- A stale request created after a session switch can still record a pin rejection that a concurrent connect to the same host picks up. That is not a security hole, but the dialog could show a confusing fingerprint (pre-existing edge, noted by the fix worker).
- Save and reset can take up to 3 s to reply if the old controller hangs, because the old session stays open so its logouts can finish.
- The e2e probe disables `safeStorage`, so it does not cover encryption.
- The new e2e checks were not run against the pre-fix code; their ability to catch the old bug is reasoned, not demonstrated.
