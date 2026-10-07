Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 0 blocker(s), 2 should-fix.

Do not ship yet: network scopes can assert false AP counts, and refreshes leave Back entries that promise deleted targets.

- [SHOULD-FIX] medium · confidence 0.98 — src/renderer/inventory-model.ts:224 — Unresolved AP membership is presented as an exact network scope
    APs whose group name is ambiguous or unlisted are omitted from `apCount`, but the resulting lower bound is rendered as an exact count. The included twin-group fixture demonstrates…
    Fix: Carry an uncertainty flag/count into `NetworkRow` and `NetworkBroadcasters`; render an unknown or lower-bound scope, and never show the no-A…
- [SHOULD-FIX] medium · confidence 0.97 — src/renderer/navigation.ts:303 — Successful refreshes retain stale Back-history targets
    `renderInventoryViews()` drops current selections that disappeared but leaves `state.navHistory` untouched. If a refresh removes an AP, group, or network stored in history, the Bac…
    Fix: Reconcile history against the newly loaded inventory before rendering the Back bar: skip invalid locations or downgrade them to an itemless…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: none
SHOULD-FIX: src/renderer/inventory-model.ts:224 — Unresolved AP membership is presented as an exact network scope — Carry an uncertainty flag/count into `NetworkRow` and `NetworkBroadcasters`; render an unknown or lower-bound scope, and never show the no-A…
SHOULD-FIX: src/renderer/navigation.ts:303 — Successful refreshes retain stale Back-history targets — Reconcile history against the newly loaded inventory before rendering the Back bar: skip invalid locations or downgrade them to an itemless…
NOT-VERIFIED: Fix uncertain network-scope presentation.
NOT-VERIFIED: Sanitize navigation history after every successful data reload.
NOT-VERIFIED: Add regression coverage for both failure scenarios.
