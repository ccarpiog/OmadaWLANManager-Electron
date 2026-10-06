Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 1 blocker(s), 1 should-fix.

Do not ship yet: bulk moves have an unsafe keyboard confirmation path, and Shift-click range selection breaks after filtering hides its anchor.

- [BLOCKER] high · confidence 0.99 — src/renderer/apply-change.ts:77 — Bulk move confirmation defaults focus to the destructive action
    The new multi-AP path opens the shared confirmation at this line, whose implementation immediately focuses Confirm. Consequently, a keyboard user can press Enter on Apply and then…
    Fix: Change the confirmation dialog to initially focus Cancel or a focusable heading, associate the message via aria-describedby, and update the…
- [SHOULD-FIX] medium · confidence 0.98 — src/renderer/ap-list.ts:444 — A hidden range anchor permanently disables Shift-click ranges
    When Shift-click is used with a non-null anchor, this branch never updates the anchor. If filtering has hidden the old anchor, rangeBetween() returns only the clicked target, but t…
    Fix: Before applying a Shift-click range, verify that the anchor is in visibleApMacs(); when it is absent, treat the target as the new anchor. Ad…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: src/renderer/apply-change.ts:77 — Bulk move confirmation defaults focus to the destructive action — Change the confirmation dialog to initially focus Cancel or a focusable heading, associate the message via aria-describedby, and update the…
SHOULD-FIX: src/renderer/ap-list.ts:444 — A hidden range anchor permanently disables Shift-click ranges — Before applying a Shift-click range, verify that the anchor is in visibleApMacs(); when it is absent, treat the target as the new anchor. Ad…
NOT-VERIFIED: Fix the confirmation’s initial focus and adjust the keyboard smoke assertion.
NOT-VERIFIED: Re-anchor Shift-click after filter changes and add regression coverage.
