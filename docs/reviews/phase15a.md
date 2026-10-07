Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 2 blocker(s), 0 should-fix.

Do not ship: the secure-storage fallback can persist an unprotected Client Secret on Linux, and the central redactor demonstrably misses common quoted secret formats.

- [BLOCKER] high · confidence 0.99 — src/main/config.ts:42 — Linux `basic_text` backend is incorrectly treated as secure persistence
    `encryptionAvailable()` checks only `safeStorage.isEncryptionAvailable()`. On Linux, Electron can select `basic_text`; Electron documents that this stores data using a hardcoded pl…
    Fix: On Linux, treat `basic_text` and `unknown` backends as unavailable and keep the Client Secret session-only. Add config-model and real-main p…
- [BLOCKER] high · confidence 1 — src/main/redact.ts:72 — Quoted `key=value` secrets pass through the redactor unchanged
    `ASSIGNMENT_VALUE` explicitly excludes both quote characters at the first value position, so inputs such as `password="hunter 2"`, `client_secret="CS-quoted"`, and `AccessToken='AT…
    Fix: Add dedicated single- and double-quoted assignment-value rules with escape and truncation handling, and make unquoted redaction consume thro…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: src/main/config.ts:42 — Linux `basic_text` backend is incorrectly treated as secure persistence — On Linux, treat `basic_text` and `unknown` backends as unavailable and keep the Client Secret session-only. Add config-model and real-main p…
BLOCKERS: src/main/redact.ts:72 — Quoted `key=value` secrets pass through the redactor unchanged — Add dedicated single- and double-quoted assignment-value rules with escape and truncation handling, and make unquoted redaction consume thro…
SHOULD-FIX: none
NOT-VERIFIED: Block release until Linux `basic_text` uses the session-only path.
NOT-VERIFIED: Expand redaction tests with quoted and whitespace-containing assignment values, including transport error excerpts.
