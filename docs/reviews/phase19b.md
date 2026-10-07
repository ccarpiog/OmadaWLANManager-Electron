Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 1 finding(s): 0 blocker(s), 1 should-fix.

Do not ship yet: the new IPC reply validator accepts semantically malformed binding replies instead of failing closed.

- [SHOULD-FIX] medium · confidence 0.93 — src/renderer/network-bindings.ts:503 — Malformed binding replies can be accepted as success or incomplete capacity refusals
    The parser returns success immediately whenever `success === true`, without validating contradictory or malformed `error`/`capacityProblems` fields. It also accepts `{success:false…
    Fix: Validate the reply as a discriminated schema: reject contradictory failure fields on success, require a known error on failure, and require…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: none
SHOULD-FIX: src/renderer/network-bindings.ts:503 — Malformed binding replies can be accepted as success or incomplete capacity refusals — Validate the reply as a discriminated schema: reject contradictory failure fields on success, require a known error on failure, and require…
NOT-VERIFIED: Tighten `parseNetworkBindingsResult()` and update its boundary tests before shipping.
