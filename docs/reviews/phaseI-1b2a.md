Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 1 finding(s): 0 blocker(s), 1 should-fix.

Do not ship yet: the internal Networks view still converts an entirely unknown inventory into a definitive empty state and exposes known-only totals as exact search counts.

- [SHOULD-FIX] medium · confidence 0.99 — src/renderer/networks-view.ts:297 — Networks view still reports an exact zero or total when lists are unknown
    When every group has `ssidListUnknown: true`, `buildNetworkRows()` legitimately returns no rows, but this branch renders “No Wi-Fi networks available,” falsely asserting zero netwo…
    Fix: Branch on `distinctSsidCountKind(state.wlanGroups)`: render an explicit unknown-inventory state instead of `noNetworks` when no names are kn…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: none
SHOULD-FIX: src/renderer/networks-view.ts:297 — Networks view still reports an exact zero or total when lists are unknown — Branch on `distinctSsidCountKind(state.wlanGroups)`: render an explicit unknown-inventory state instead of `noNetworks` when no names are kn…
NOT-VERIFIED: Fix the internal Networks view’s empty and filtered-summary states, then add coverage for both unknown-only and mixed inventories.
