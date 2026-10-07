Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 1 finding(s): 0 blocker(s), 1 should-fix.

Do not ship: the new `unreachable` contract is violated for failures occurring after the controller has already responded.

- [SHOULD-FIX] medium · confidence 0.99 — src/main/connection-manager.ts:834 — Later request timeouts are falsely classified as “controller never answered”
    `connectLocal()` applies `isUnreachableFailure(detail)` to any exception from the complete local connection sequence. That sequence first receives `/api/info`, then logs in, then l…
    Fix: Carry structured failure-stage/reachability information through the connection flow and set `unreachable` only when the initial `/api/info`…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: none
SHOULD-FIX: src/main/connection-manager.ts:834 — Later request timeouts are falsely classified as “controller never answered” — Carry structured failure-stage/reachability information through the connection flow and set `unreachable` only when the initial `/api/info`…
NOT-VERIFIED: Correct the failure classification and add stage-specific regression tests before shipping.
