Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 1 blocker(s), 1 should-fix.

Do not ship yet: the main-side guard can write a network whose canonical read model says has unknown scope, and MLO capacity is knowingly allowed to bypass fail-closed validation.

- [BLOCKER] high · confidence 0.99 — src/main/controller-session.ts:1889 — Catalog/detail disagreement bypasses the unknown-scope write guard
    The write rereads only v1 detail and bindings. `networkBindingFacts()` therefore treats `detail.chooseDevices = 1` plus known bindings as `apGroups`, even if the v2 catalog reports…
    Fix: Reread the SSID catalog inside the serialized operation, require a complete catalog containing the target, and derive scope by combining its…
- [SHOULD-FIX] medium · confidence 0.91 — src/main/network-binding-plan.ts:188 — MLO networks bypass capacity validation
    Binding facts retain only the three radio-band bits; the documented `mloEnable` state is not represented. Consequently an MLO-enabled network can add a group whenever its 2.4/5/6 G…
    Fix: Preserve and validate `mloEnable` from the fresh detail and incorporate a defensible per-group MLO-capacity check. Until the controller expo…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: src/main/controller-session.ts:1889 — Catalog/detail disagreement bypasses the unknown-scope write guard — Reread the SSID catalog inside the serialized operation, require a complete catalog containing the target, and derive scope by combining its…
SHOULD-FIX: src/main/network-binding-plan.ts:188 — MLO networks bypass capacity validation — Preserve and validate `mloEnable` from the fresh detail and incorporate a defensible per-group MLO-capacity check. Until the controller expo…
NOT-VERIFIED: Fix both fail-open paths and add regression tests covering catalog/detail scope disagreement and MLO enabled/unknown state.
