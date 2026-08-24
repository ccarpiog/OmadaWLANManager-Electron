# Codex review — Phase 4 aggregate (renderer/IPC/cert hardening)

Date: 2026-08-24. Scope: uncommitted working-tree diff implementing todo.md items 1.9, 2.2, 2.3a, 2.6, 3.14 (src/main/index.ts, src/main/preload.ts, src/renderer/renderer.ts, src/renderer/index.html, src/renderer/styles.css).

## Codex output (verbatim)

### (a) Correctness or security defects

- **P2 — src/main/index.ts:157** — The origin-scoped `certificate-error` check is undermined by `setCertificateVerifyProc` at line 182, which still accepts invalid certificates for every port on the configured hostname; verification should enforce the configured origin consistently.

### (b) Regressions vs previous behavior

- **src/renderer/index.html:6** — The tightened CSP blocks the existing `data:` SVG background at styles.css:505, so the custom language-select arrow disappears. An explicit `img-src 'self' data:` or a file-backed image is needed.

No sandbox-preload breakage was found: the emitted preload requires only Electron, and its shared-type import is erased.

### (c) Readiness verdict

**Not ready** to proceed. The certificate policy remains broader than the newly documented origin boundary. The CSP regression is minor but should also be corrected.

### (d) Missing i18n strings

None. The diff adds no new user-facing renderer string missing from either the Spanish or English translation table.

## Resolution (orchestrator, before commit)

1. **P2 verify-proc scope** — partially fixed, remainder structurally deferred. The API client uses Electron `net.request` on the default session, and the app-level `certificate-error` event does not fire for `net` module requests, so the verify-proc bypass cannot be removed without breaking all API connectivity to self-signed controllers. Electron's verify-proc `request` object exposes only `hostname` — no port — so scoping the bypass to the full configured origin is impossible with this API. Mitigations applied: the bypass now additionally requires `request.verificationResult` to be one of the failure classes a self-signed cert actually produces (`ERR_CERT_AUTHORITY_INVALID`, `ERR_CERT_COMMON_NAME_INVALID`, `ERR_CERT_DATE_INVALID` — helper `isSelfSignedVerificationResult()`); revoked/weak-signature/other failures are never bypassed. The residual same-host-different-port exposure is documented in the code comment and closes fully only with trust-on-first-use pinning (todo.md 2.3b, deferred by user decision). Recorded as an open risk in PROGRESS.md.
2. **CSP `data:` image regression** — fixed: `img-src 'self' data:` added to the CSP meta tag in index.html.

`npm run build` exit 0 after both fixes.
