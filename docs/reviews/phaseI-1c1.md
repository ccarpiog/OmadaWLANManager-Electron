Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 1 finding(s): 0 blocker(s), 1 should-fix.

Do not ship yet: cloud-test results can be presented for a credential different from the one currently shown in Settings.

- [SHOULD-FIX] medium · confidence 0.99 — src/renderer/cloud-settings.ts:365 — Cloud edits do not invalidate an in-flight or completed test result
    The unsaved-change check runs only before `cloud:test` starts. While it awaits main, the region, Client ID, and Client Secret remain editable, but the completion guard checks only…
    Fix: Invalidate and clear the cloud-test run on every region, Client ID, and Client Secret edit, and re-check `hasUnsavedCloudChanges()` immediat…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: none
SHOULD-FIX: src/renderer/cloud-settings.ts:365 — Cloud edits do not invalidate an in-flight or completed test result — Invalidate and clear the cloud-test run on every region, Client ID, and Client Secret edit, and re-check `hasUnsavedCloudChanges()` immediat…
NOT-VERIFIED: Wire all three cloud fields to invalidate existing test state on edits.
NOT-VERIFIED: Add coverage for edits during an in-flight test and edits after a displayed success.
