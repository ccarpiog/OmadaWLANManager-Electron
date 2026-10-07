# Phase I-1c3 — cloud docs: README, live-test checklist Part C, user guide (2026-10-07)

- **Risk:** routine. **Workers:** opus (phase); a fresh opus worker for the two review fixes. Docs only, no `src/` / `tests/` / `scripts/` change.
- **Closes:** I-1c3, I-1c and inbox item I-1 (the last phase of the plan).
- **How:** `todo.md` §5 "Done (I-1c3)" holds the description.

## What was built

- `README.md`: section "TP-Link cloud controllers (optional)" — what the cloud access does, where the Account Level Open API credential is created and that the portal's Open API page may not be enabled yet, the Settings "TP-Link cloud (optional)" section, the sidebar controller switcher, "Connect through TP-Link cloud", the cloud-only setup, the certificate note, limits; short additions to Features, Requirements, Usage, Configuration, Testing, Project structure and Security notes.
- `docs/live-test-checklist.md`: Part C (C.0–C.16 and clean-up C.R) covering every `docs/omada-cloud-openapi.md` §11 live unknown and every "For I-1c3" switcher step (duplicate hidden, offline / below-6.3 reasons, a switch and back, "Connect through TP-Link cloud" with the local controller unplugged, `-7132` by rapid switching, Remove cloud access on a cloud controller with and without a local controller); a cloud kit of shell functions (reads, token requests, one optional no-op move that re-sends an AP's current group), tested offline in zsh and bash against a mock `curl`; 19 cross-reference rows (`C11-1`–`C11-12`, `I-1c2a-1`–`2`, `I-1c2b-1`–`5`).
- `docs/user-guide.md`: new §9 (cloud; old §9–10 renumbered), 8 term-table rows (es / en), a cloud note in the certificate section.
- `docs/omada-cloud-openapi.md`: five sentences that still called the checklist / switcher future work.
- `todo.md` §5: I-1c3, I-1c and I-1 marked ✅.

## Acceptance

| Criterion | Met | Evidence |
|---|---|---|
| README cloud section with every point of the brief | yes | worker report; Codex review found no accuracy gap beyond finding 2 (fixed) |
| Checklist cloud section covering every §11 item and every "For I-1c3" step, cross-reference table updated | yes | Part C C.0–C.16 + C.R, 19 rows; review found no coverage gap |
| User guide consistent, UI terms verbatim es / en | yes | worker checked every bold pair against `i18n-strings.ts` (checklist pairs 247 → 371) |
| `todo.md` §5 marks I-1c3, I-1c, I-1 | yes | `git diff todo.md` |
| `npm run build` exit 0 | yes | orchestrator, before and after the review fixes |
| `npm test` all pass | yes | 1358/1358 (orchestrator, before and after the review fixes) |
| `npm run smoke` all pass | yes | 314/314 (orchestrator, before the review fixes; the fixes are docs only) |
| No conflicted copies; no source change; the user's three uncommitted test files untouched | yes | `fd -H "conflicted copy"` empty; `git status --short` shows only docs + the user's usual 7 / 8-line diffs |
| No controller or `tplinkcloud.com` contact | yes | kit tested only against a mock `curl` and a temp `HOME` |

## Review

Codex, `docs/reviews/phaseI-1c3.md`, ship-with-fixes, 0 blockers, 2 should-fix — both fixed by a fresh opus worker:

1. **C.16 left the real config displaced if interrupted** → the step now runs in its own subshell: refuses to start if `config.json` is missing or an earlier backup is left; unique `mktemp` backup (0600) checked with `cmp` before deletion; EXIT / HUP / INT / TERM trap restores and checks; backup removed and traps cleared only after a checked restore the user triggers by typing `restore` after quitting the app. C.0 item 5 updated; new C.R item 5 recovers a leftover backup (covers a killed terminal). Tested offline in interactive zsh 5.9 and bash 3.2 on a pty: 24/24 scenarios (normal restore, `exit`, Ctrl-C, Ctrl-D, closed terminal, TERM / HUP / INT, both refusals); a control copy without the EXIT trap failed as expected.
2. **The guide promised the cloud Client Secret is always stored encrypted** → README cloud setup line and guide §4, §9, §11 now state the code's rule, the same for the management and cloud Client Secret: encrypted and saved only when `secureSecretStorageAvailable()` is true (safeStorage available, and on Linux a `gnome_libsecret` / `kwallet*` backend); otherwise kept in memory until quit, and an earlier blob is ignored while secure storage is unavailable.

## Leftovers (none blocking)

- C.16's restore asks the user to quit the app first but cannot check it (under `npm start` the process is just "Electron"); the kept backup covers an interrupted run.
- Unverified, outside the phase: the README says the controller password is kept in plain text "e.g. a Linux session without a secret service", but the code falls back to plain text only when no encryption is available at all, which may not hold on Linux with the `basic_text` backend.
- Several Part C checks can only be partly covered (an expired credential; whether token requests count toward the rate limit; the "older than 6.3" and other unusable reasons without such a controller; moves without a silenceable remote AP; a `-7132` the app's own throttle may never let through) — the cross-reference rows say so.
- The worker ran one read-only `git show` against the brief's no-git rule (no staging or commits).
