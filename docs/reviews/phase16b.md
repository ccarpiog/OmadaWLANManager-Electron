Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 0 blocker(s), 2 should-fix.

Do not ship phase 16b as complete: management controls can remain exposed during or after an unsuccessful capability recheck, and the required master-list capacity warning is absent.

- [SHOULD-FIX] medium · confidence 0.93 — src/renderer/management.ts:175 — Capability rechecks do not fail closed in the renderer
    runManagementTest() marks only the Settings control as busy; it leaves the previous managementCapabilities active while main has already invalidated its Open API client for the new…
    Fix: At test start, clear managementCapabilities and rerender notices/groups, or prevent leaving Settings until the check settles. For every same…
- [SHOULD-FIX] medium · confidence 1 — src/renderer/groups-view.ts:199 — Required capacity-warning badge is missing from the master list
    createGroupItem() renders the name, Default badge, AP count, and network count only. It never consults managedApGroups or remainingBinding, so a group with zero remaining capacity…
    Fix: Define the warning threshold from the reported per-band capacity, render a localized Capacity warning badge without treating absent values a…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: none
SHOULD-FIX: src/renderer/management.ts:175 — Capability rechecks do not fail closed in the renderer — At test start, clear managementCapabilities and rerender notices/groups, or prevent leaving Settings until the check settles. For every same…
SHOULD-FIX: src/renderer/groups-view.ts:199 — Required capacity-warning badge is missing from the master list — Define the warning threshold from the reported per-band capacity, render a localized Capacity warning badge without treating absent values a…
NOT-VERIFIED: Make capability testing fail closed before exposing write actions.
NOT-VERIFIED: Implement and test the master-list capacity-warning badge.
NOT-VERIFIED: Keep the default-group Delete deviation explicitly deferred or change it to the specified hidden behavior before declaring §4.4 complete.
