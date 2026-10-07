Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 1 blocker(s), 1 should-fix.

Do not ship: malformed controller data can bypass the destructive delete policy, and one create path violates management-generation invalidation.

- [BLOCKER] high · confidence 0.98 — src/main/controller-session.ts:1026 — Malformed SSID bindings are normalized to “no bindings,” allowing deletion
    The fresh delete check trusts `ssidNameList` after `validateOpenApiApGroup()` filters out every non-string entry. Thus a degraded response such as `ssidNameList: [null]` becomes `[…
    Fix: Treat an SSID list as known only when it is an array containing exclusively strings. Otherwise omit `ssidNameList` or reject the list respon…
- [SHOULD-FIX] medium · confidence 0.97 — src/main/controller-session.ts:962 — Create fallback converts a superseded operation into success
    When POST succeeds without a usable ID, create performs a follow-up list. Any failure from that read—including `superseded` after a same-session management-credential save or `test…
    Fix: Propagate `superseded` from the fallback read; only downgrade non-invalidation read failures to successful creation without an ID if that be…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: src/main/controller-session.ts:1026 — Malformed SSID bindings are normalized to “no bindings,” allowing deletion — Treat an SSID list as known only when it is an array containing exclusively strings. Otherwise omit `ssidNameList` or reject the list respon…
SHOULD-FIX: src/main/controller-session.ts:962 — Create fallback converts a superseded operation into success — Propagate `superseded` from the fallback read; only downgrade non-invalidation read failures to successful creation without an ID if that be…
NOT-VERIFIED: Make SSID-list validation fail closed for delete policy decisions.
NOT-VERIFIED: Preserve `superseded` through the missing-create-ID fallback and add race coverage.
