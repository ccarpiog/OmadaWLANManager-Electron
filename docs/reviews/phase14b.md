Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 0 blocker(s), 2 should-fix.

Do not ship yet: the single-pane layout introduces two reproducible paths that strand keyboard focus in hidden UI.

- [SHOULD-FIX] medium · confidence 0.97 — src/renderer/layout.ts:62 — Successful moves can leave focus inside hidden UI at narrow widths
    At 700–799 px, `destinationPaneOpen` makes the AP list offstage. After a fully successful move started with the Move button, the destination pane remains open and the button become…
    Fix: Make post-move focus restoration layout-aware: while the destination pane remains active, focus its Back button/search/radio, or close it vi…
- [SHOULD-FIX] medium · confidence 0.94 — src/renderer/layout.ts:103 — Leaving single-pane mode can hide the currently focused Back button
    The media-query handler relocates focus only when entering single-pane mode. When resizing from below 800 px to 800 px or wider while a drill-in Back button is focused, that button…
    Fix: Handle both breakpoint directions. When leaving single-pane mode and focus is on a `.drill-only` control, move it to a visible control in th…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: none
SHOULD-FIX: src/renderer/layout.ts:62 — Successful moves can leave focus inside hidden UI at narrow widths — Make post-move focus restoration layout-aware: while the destination pane remains active, focus its Back button/search/radio, or close it vi…
SHOULD-FIX: src/renderer/layout.ts:103 — Leaving single-pane mode can hide the currently focused Back button — Handle both breakpoint directions. When leaving single-pane mode and focus is on a `.drill-only` control, move it to a visible control in th…
NOT-VERIFIED: Fix both focus-restoration paths and add targeted responsive keyboard tests before shipping.
