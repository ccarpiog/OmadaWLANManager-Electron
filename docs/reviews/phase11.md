Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 2 blocker(s), 0 should-fix.

Do not ship: main-process trust transitions leave stale controller state valid, allowing URL changes or certificate resets to be overtaken by in-flight connects and site selections.

- [BLOCKER] high · confidence 0.98 — src/main/index.ts:410 — URL changes do not invalidate controller state
    After persisting a changed URL, the handler only clears pending certificate trust and replaces the TLS session. It does not increment `connectGeneration`, discard `pendingSiteSelec…
    Fix: Make a URL change an atomic controller transition: invalidate the connect generation, consume certificate trust, discard pending site select…
- [BLOCKER] high · confidence 0.99 — src/main/index.ts:747 — CERT_RESET does not disconnect or invalidate in-flight connections
    The reset handler removes the pin and swaps network contexts but leaves the installed controller, pending site selection, and `connectGeneration` untouched. A connect that authenti…
    Fix: Implement reset atomically in main: invalidate the generation immediately, clear pending trust and site selection, detach the installed cont…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: src/main/index.ts:410 — URL changes do not invalidate controller state — Make a URL change an atomic controller transition: invalidate the connect generation, consume certificate trust, discard pending site select…
BLOCKERS: src/main/index.ts:747 — CERT_RESET does not disconnect or invalidate in-flight connections — Implement reset atomically in main: invalidate the generation immediately, clear pending trust and site selection, detach the installed cont…
SHOULD-FIX: none
NOT-VERIFIED: Fix both main-process state-transition gaps and add adversarial concurrency coverage before release.
