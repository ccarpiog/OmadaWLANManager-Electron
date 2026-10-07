Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 1 blocker(s), 1 should-fix.

Do not ship: transient controller credentials can still cross IPC unredacted, and the new password confirmation can describe stale impact.

- [BLOCKER] high · confidence 0.98 — src/main/connection-manager.ts:493 — Transient CSRF and session-cookie values can reach the renderer unredacted
    After login, internal API requests carry the CSRF token and session cookie. A controller error can echo either value bare in `msg`; `OmadaController.connect()` logs a sanitized cop…
    Fix: Sanitize internal-client failures before rethrowing them using every live credential, including the cookie header and CSRF token, and throw…
- [SHOULD-FIX] medium · confidence 0.94 — src/renderer/network-flow.ts:594 — Password confirmation is built from a stale network scope
    The new review derives its scope and affected groups from the network snapshot captured when the flow opened. Unlike Enable, Disable, and Delete, it performs no fresh managed-netwo…
    Fix: Re-read the managed network immediately before displaying the password review, rebuild the scope from that result, and refuse/restart review…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: src/main/connection-manager.ts:493 — Transient CSRF and session-cookie values can reach the renderer unredacted — Sanitize internal-client failures before rethrowing them using every live credential, including the cookie header and CSRF token, and throw…
SHOULD-FIX: src/renderer/network-flow.ts:594 — Password confirmation is built from a stale network scope — Re-read the managed network immediately before displaying the password review, rebuild the scope from that result, and refuse/restart review…
NOT-VERIFIED: Add the missing transient-secret redaction regression tests.
NOT-VERIFIED: Add a stale-scope password-confirmation test covering an external binding change.
