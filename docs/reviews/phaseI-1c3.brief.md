# Review brief — phase I-1c3 (cloud docs)

- **Repo:** `/Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron` (Electron + TypeScript app managing TP-Link Omada controllers), branch `main`, change **uncommitted** in the working tree.
- **Phase and goal:** I-1c3, the last phase of inbox item I-1 (optional TP-Link cloud access: remote controllers through the Account Level Open API (beta) beside the direct local one). Docs only: a cloud section in `README.md`, a cloud part ("Part C") in `docs/live-test-checklist.md` built from `docs/omada-cloud-openapi.md` §11 (live unknowns) and the switcher steps listed in `todo.md` §5 "For I-1c3", `docs/user-guide.md` kept consistent, `todo.md` §5 marks I-1c3 / I-1c / I-1 done. Risk: routine.
- **Changed files (review these):** `README.md`, `docs/live-test-checklist.md` (+~740 lines), `docs/user-guide.md`, `docs/omada-cloud-openapi.md` (five sentences that called the checklist / switcher future work), `todo.md`.
- **Not part of the phase — ignore:** `PROGRESS.json` (orchestrator), and the user's own uncommitted edits in `tests/smoke/stub-main.cjs`, `tests/tls-probe/app-main.cjs`, `tests/smoke/window-placement.cjs`.
- **Verification run:** `npm run build` exit 0; `npm test` 1358/1358; `ELECTRON_PATH=… npm run smoke` 314/314; `fd -H "conflicted copy"` empty. No `src/`, `tests/` or `scripts/` change.
- **Sources of truth:** `src/renderer/i18n-strings.ts` (es / en UI strings), `src/renderer/controller-switcher-model.ts` (`SWITCHER_TEXT`), `src/renderer/cloud-form.ts`, `src/main/cloud-*.ts`, `src/main/connection-target.ts`, `src/main/config-model.ts`; `docs/omada-cloud-openapi.md` (contract, §11); `autoclaude/processed/10-tplink-cloud-controllers.md` (spec, user decisions D5–D7); `docs/progress-archive/phase-i-1*.md` (what was built).

## Risks to check

1. **Accuracy against the code:** every described behavior (switcher visibility, hidden local duplicate, disabled-entry reasons, "Connect through TP-Link cloud" trigger, cloud-only start, Remove cloud access returning to local, certificate note, unknown AP group / network lists, moves verified by re-read, throttle / `-7132`) must match what the code does — no invented features, no missing limits.
2. **UI terms:** every quoted es / en term must match the string tables exactly.
3. **Checklist safety:** Part C is for the user's manual run against a real TP-Link account and production controllers. It adds terminal commands (token requests, reads, and one optional move that re-sends an AP's current group) and a step (C.16) that temporarily moves `~/.omada-wlan-manager/config.json` aside for the cloud-only check. Check that every write is clearly optional and idempotent, that the config file is always restored (including on an aborted step), that no secret is echoed into shell history or logs beyond what the existing Part A/B probe kit already accepts, and that the commands are correct for zsh and bash.
4. **Coverage:** every §11 item and every "For I-1c3" step (duplicate hidden, offline / below-6.3 reasons, a switch and back, "Connect through TP-Link cloud" with the local controller unplugged, `-7132` by rapid switching, Remove cloud access while on a cloud controller — with and without a local controller) has a concrete check; the cross-reference table is consistent.
5. **Consistency:** the README, user guide, contract and checklist do not contradict each other or the earlier (Part A / B) sections; section renumbering in the user guide left no dangling references.

- **Review file:** `docs/reviews/phaseI-1c3.md`
- **Time budget:** 10 minutes.
