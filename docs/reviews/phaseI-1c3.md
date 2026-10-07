Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 0 blocker(s), 2 should-fix.

Do not ship yet: the cloud-only procedure does not guarantee restoration after interruption, and the guide misstates cloud-secret persistence.

- [SHOULD-FIX] medium · confidence 0.99 — docs/live-test-checklist.md:1816 — Interrupted cloud-only test leaves the production configuration displaced
    C.16 removes the real `config.json`, but restoration occurs only in a later manual step. There is no shell trap and C.R contains no configuration-recovery step. If the operator abo…
    Fix: Use a unique backup plus an EXIT/HUP/INT/TERM restoration trap, clear the trap only after verified restoration, and add an explicit recovery…
- [SHOULD-FIX] medium · confidence 0.98 — docs/user-guide.md:333 — User guide falsely promises encrypted persistence of the cloud secret
    The guide says the cloud Client Secret is stored encrypted and later says both Client Secrets are stored encrypted. In `applyConfigSave`, however, the cloud secret is session-only…
    Fix: Qualify both guide statements and the README setup statement: encrypt and persist only when a real secure-storage backend is available; othe…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: none
SHOULD-FIX: docs/live-test-checklist.md:1816 — Interrupted cloud-only test leaves the production configuration displaced — Use a unique backup plus an EXIT/HUP/INT/TERM restoration trap, clear the trap only after verified restoration, and add an explicit recovery…
SHOULD-FIX: docs/user-guide.md:333 — User guide falsely promises encrypted persistence of the cloud secret — Qualify both guide statements and the README setup statement: encrypt and persist only when a real secure-storage backend is available; othe…
NOT-VERIFIED: Harden C.16 restoration for every exit path and document recovery in C.R.
NOT-VERIFIED: Make cloud-secret persistence wording consistent with `safeStorage` fallback behavior throughout README and the user guide.
