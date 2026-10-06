Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 1 finding(s): 1 blocker(s), 0 should-fix.

Do not ship yet: the release build bypasses the new TypeScript resolver and remains vulnerable to the exact Dropbox symlink failure it was meant to solve.

- [BLOCKER] high · confidence 0.98 — package.json:8 — Release builds still depend on the breakable `.bin/tsc` symlink
    `npm run build` and `build:renderer` still invoke `tsc` through npm's `node_modules/.bin` shim. The new `resolveTscPath()` is used only by unit tests and renderer watch mode. In th…
    Fix: Route all compiler entry points—including `build`, `build:renderer`, and `watch`—through a Node script using `resolveTscPath()`. Then verify…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: package.json:8 — Release builds still depend on the breakable `.bin/tsc` symlink — Route all compiler entry points—including `build`, `build:renderer`, and `watch`—through a Node script using `resolveTscPath()`. Then verify…
SHOULD-FIX: none
NOT-VERIFIED: Wire `resolve-tsc.mjs` into every TypeScript build/watch command.
NOT-VERIFIED: Re-run build, tests, smoke, and packaging without relying on the `.bin/tsc` symlink.
