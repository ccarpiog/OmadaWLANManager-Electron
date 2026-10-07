Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 1 finding(s): 0 blocker(s), 1 should-fix.

Ship-with-fixes: nonce ownership and stale-reply defenses look sound, but `connectionReset` is still reported spuriously for disconnected cloud targets.

- [SHOULD-FIX] medium · confidence 0.96 — src/main/connection-manager.ts:563 — Cloud credential saves claim a connection reset when no connection existed
    `connectionReset` is derived solely from a successful credential change plus `activeTarget.kind === 'cloud'`. After a failed cloud connection or an explicit disconnect, the target…
    Fix: Track whether a cloud controller session, pending site selection, or cloud connect attempt was actually invalidated. Continue invalidating c…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: none
SHOULD-FIX: src/main/connection-manager.ts:563 — Cloud credential saves claim a connection reset when no connection existed — Track whether a cloud controller session, pending site selection, or cloud connect attempt was actually invalidated. Continue invalidating c…
NOT-VERIFIED: Correct the `connectionReset` predicate and add the disconnected-cloud regression test.
