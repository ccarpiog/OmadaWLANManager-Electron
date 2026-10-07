# Phase 20a — IPC, redaction, async-race and accessibility audit (2026-10-07)

- **Plan item:** `todo.md` 4.13, first half. Phase 20 was split before starting: 20a = IPC + redaction audit, async-race review across views, destructive paths confirmed, accessibility / keyboard smoke at the three widths; 20b = README + short user guide (es / en UI terms) + `docs/live-test-checklist.md` per spec §6 (recorded in `todo.md` 4.13).
- **Risk:** high (the plan said routine for phase 20 as a whole; this half decides whether secrets or stale writes slip through). Workers: opus (phase), opus (review fixes). Run under `/autoclaude-opus`.
- **Audit report:** `docs/security-audit.md` — §1 IPC channel table with `file:line` evidence, §2 redaction inventory, §3 async-flow table (flow → stale-reply guard), §4 destructive-action table, §5 accessibility results, §6 "Fixed in 20a", §7 remaining risks.

## What changed

- **Main.** New `src/main/ipc-trust.ts`: a single registrar `handleTrusted()` runs `assertTrustedIpcSender()` before any handler and sends failures back redacted; every channel in `index.ts` goes through it. The 8 older channels refuse extra arguments. The connect error detail shown in the UI and 13 log lines that logged raw errors are now redacted; a corrupt config file logs only the error name (V8's JSON parse message can quote the file, i.e. a plaintext password).
- **Review fix (blocker).** The internal client keeps every CSRF token and session-cookie value it has held (including those cleared by logout or a failed re-login); every failure leaving `ControllerSession` is scrubbed of them plus the password (connect detail, data / AP-move errors, logs), and the transport scrubs an error-page excerpt before its 200-character cut. Cookie values are scrubbed when the name looks sensitive or the value has ≥ 8 characters, so short values like `en` do not mangle messages. The Open API path had no gap (codes only; the client already scrubs its own tokens).
- **Renderer.** Change password gained a confirmation that focuses Cancel; review fix (should-fix): it re-reads the managed network right before the confirmation, like Enable / Disable / Delete, and ends with the "network changed" toast when the network changed, is gone or is no longer WPA-Personal. Settings cannot open over or under another dialog; Escape in Settings cancels an inline confirmation first; disconnect drops the old session nonce, so a stale "Test management access" reply is refused; focus returns to Connect after the certificate / site dialogs; closed dialogs are `inert` during their fade-out; arrow keys work in dialog lists; the site and Settings dialogs have descriptions; the status text is a live region. 3 new strings (es + en).
- **Tests.** `tests/unit/ipc-surface.test.ts` (every registered channel behind the sender guard; preload exposes exactly the expected methods); `tests/unit/redaction-audit.test.ts` (sentinel secrets through replies, rejections and logs, a lint that fails on any unredacted error in a main log line, live CSRF / cookie / token echo tests); new smoke launch `[a11y]` (es + en: layout per width, 700×500 action bars and modal buttons in view, Cmd/Ctrl+F per view, Escape order, focus trap + restore per modal kind, destructive confirmations focus Cancel, live regions, arrow keys, nothing focusable behind a modal); 2 smoke checks for the Change password re-read. `OMADA_SMOKE_ONLY` in `tests/smoke/run-smoke.mjs` runs a single launch. The `[groups]` check that opened Settings over an open dialog by script now asserts the refusal and that main rejects the write.
- **Docs.** `README.md`: only sentences these changes made inaccurate. `todo.md` 4.13 "Done (20a)".

## Acceptance

| Criterion | Result |
|---|---|
| `npm run build` exits 0 | met |
| `npm test` exits 0 | met — 1033/1033 (was 1001) |
| `npm run smoke` exits 0 | met — 270/270, 10 launches (was 250, 9) |
| `npm run tls-probe` exits 0 | met — 25/25 |
| Every channel behind the sender guard, structurally tested | met — `ipc-surface.test.ts` |
| No secret strings in replies / logs | met — `redaction-audit.test.ts`, incl. live CSRF / cookie values after the review fix |
| Every destructive path confirmed, focusing Cancel | met — `docs/security-audit.md` §4; Change password added |
| Accessibility / keyboard smoke at the three widths | met — `[a11y]` |
| Each fix's test fails on revert | met — verified by both workers, revert by revert |
| No `innerHTML`; preload `electron`-only; no conflicted copies | met |

## Review

- Codex, `docs/reviews/phase20a.md` (brief `docs/reviews/phase20a.brief.md`), ship-with-fixes.
- Blocker: transient CSRF and session-cookie values could reach the renderer unredacted (`connection-manager.ts:493`) → fixed as above, 5 new unit tests failing on revert.
- Should-fix: Change password confirmation built from a stale scope (`network-flow.ts:594`) → fresh re-read, 2 new smoke checks failing on revert.
- Orchestrator re-ran build, tests, smoke and probe after the fixes: all exit 0.

## Remaining risks (from `docs/security-audit.md` §7, none blocking)

- `omada:set-wlan`, `omada:get-aps`, `omada:get-wlans` carry no session nonce (the renderer's exclusive, generation-checked move flow and phase 7's install-on-success keep them safe today); I-1b (Open API moves) is the natural place to bind them.
- `refreshData()` starts managed reads with the current generation rather than a captured one (latent).
- A late "Test management access" result can show in a reopened Settings (cosmetic, same session).
- A Settings URL change has no confirmation step (not a spec-listed destructive action; the placeholders state the consequence).
- Error toasts use the polite live region, not `role=alert`.
- `.detail-actions` scroll with the detail at short heights (in view when a detail opens at 700×500, not pinned).
- Settings inline confirmations stay clickable while a certificate reset's disconnect is awaited (guarded by the exclusive flags).

## Phase 20b inputs

- The live-test checklist must cover spec §5, the "Unverified live" lists in `todo.md` 4.8–4.12 and `docs/progress-archive/phase-15a.md` … `phase-19b.md`, and the phase 12–19b leftovers in `PROGRESS.md` Open risks.
