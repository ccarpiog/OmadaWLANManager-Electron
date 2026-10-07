Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 0 blocker(s), 2 should-fix.

Do not ship yet: removing cloud access can leave main targeting an unusable cloud controller, and the cloud-only removal path exposes an enabled Connect action despite having no connectable configuration.

- [SHOULD-FIX] medium · confidence 0.96 — src/renderer/settings-modal.ts:576 — Cloud credential removal and target reset are not atomic
    After a successful removal, main invalidates the cloud session but retains its in-memory cloud target. The renderer repairs this only after another config read and a separate `swit…
    Fix: In `ConnectionManager.applyConfigSave()`, synchronously reset `activeTarget` to local whenever a successful save removes the credential for…
- [SHOULD-FIX] medium · confidence 0.98 — src/renderer/connection.ts:676 — Removing the only cloud configuration incorrectly enables Connect
    For a connected cloud-only configuration, removal produces `hasStoredConfig === false` and `saveFollowUp()` returns `none`. However, `connectionReset` calls `handleConnectionReset(…
    Fix: Set `connectBtn.disabled = !state.hasStoredConfig` after a reset, and add a cloud-only removal test asserting first-run state, disabled Conn…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: none
SHOULD-FIX: src/renderer/settings-modal.ts:576 — Cloud credential removal and target reset are not atomic — In `ConnectionManager.applyConfigSave()`, synchronously reset `activeTarget` to local whenever a successful save removes the credential for…
SHOULD-FIX: src/renderer/connection.ts:676 — Removing the only cloud configuration incorrectly enables Connect — Set `connectBtn.disabled = !state.hasStoredConfig` after a reset, and add a cloud-only removal test asserting first-run state, disabled Conn…
NOT-VERIFIED: Reset main's active target atomically during cloud-credential removal.
NOT-VERIFIED: Fix reset-time Connect enablement and add cloud-only removal plus failure-path coverage.
