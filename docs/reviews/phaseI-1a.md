Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 1 blocker(s), 1 should-fix.

Do not ship: malformed persisted regions can redirect a stored Client Secret to the wrong regional endpoint, and config saves do not invalidate old cloud operations atomically.

- [BLOCKER] high · confidence 0.98 — src/main/config-model.ts:313 — An invalid persisted region silently rebinds credentials to EUW
    Validation drops an invalid `cloudRegion` independently while retaining `cloudClientId` and `encryptedCloudClientSecret`. Downstream, absence means the default EUW region, so a cor…
    Fix: Distinguish an absent region from an explicitly invalid one. If `cloudRegion` is present but invalid, discard or disable the complete cloud…
- [SHOULD-FIX] medium · confidence 0.97 — src/main/index.ts:532 — Cloud credential invalidation occurs after an asynchronous controller transition
    `saveConfig()` persists the new or removed cloud credential synchronously, but `cloudAccess.invalidate()` runs only after awaiting `connectionManager.applyConfigSave()`. When the s…
    Fix: Invalidate cloud access synchronously inside the save callback immediately after a successful credential-changing save, before any promise c…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: src/main/config-model.ts:313 — An invalid persisted region silently rebinds credentials to EUW — Distinguish an absent region from an explicitly invalid one. If `cloudRegion` is present but invalid, discard or disable the complete cloud…
SHOULD-FIX: src/main/index.ts:532 — Cloud credential invalidation occurs after an asynchronous controller transition — Invalidate cloud access synchronously inside the save callback immediately after a successful credential-changing save, before any promise c…
NOT-VERIFIED: Fix both credential-boundary failures and add regression tests before shipping.
