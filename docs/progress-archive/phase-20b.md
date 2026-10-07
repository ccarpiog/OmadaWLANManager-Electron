# Phase 20b — README, user guide and live-test checklist (2026-10-07)

- **Plan item:** `todo.md` 4.13, second half — the last phase of section 4 (phases 8–20). Documentation only, no product code change.
- **Risk:** routine. Workers: opus (phase), opus (review fixes). Run under `/autoclaude-opus`.

## What changed

- **`docs/live-test-checklist.md`** (new). The manual checklist the user runs on the production controller ("EAP Carpio", Omada 6.3), in spec §6 order: snapshot EAP Carpio's group id → create the empty group `__OWM_TEST_<TS>` (plus a helper group `${T}_B`, so the checklist can show whether the binding PATCH replaces or merges and what deleting a still-bound network does) → create a **disabled** WPA-Personal network bound only to it → edit / change password / toggle enable → each §5 unknown → move EAP Carpio in and back (restored on every path; an emergency-restore section) → unbind + delete the network → delete the groups → confirm no `__OWM_TEST_` left. Each step has Do / Observe / Record / pass-fail. A `curl` + `jq` probe kit covers raw API answers the app never shows. A 78-row cross-reference table maps every spec §5 row and every "unverified live" item from phases 12–20a to a step, with a Coverage column (Covered / Partly covered / Deferred + reason) and a "Not verified by this checklist" list after it.
- **Probe-kit safety (review fixes).** The controller certificate is fetched once with `openssl`, its SHA-256 compared with Settings → **Trusted certificate (SHA-256)** / **Certificado de confianza (SHA-256)** (same colon-separated upper-case hex the app stores); only on a match is the `sha256//` SPKI pin derived. Every request goes through one helper `ocurl` (`--pinnedpubkey "$PIN" --proto '=https'`, `-k` only because the certificate is self-signed; refuses to run without a pin). No secret is exported or on a command line: one-command prefix assignments to `jq`, bodies on stdin, token / CSRF headers via `-H @<(printf …)`, cookie jar in a private `mktemp -d` dir. `kitclose` (Step 9 and emergency restore) logs out, removes the dir, unsets every secret and the helpers. Every write goes through a guarded helper (`gcreate`, `ndisable`, `gdelete`, `eaprestore`); `gdelete` / `ndisable` refuse unless both baselines parse, report success and are complete, the id was captured in this run with its type, the id is absent from the baseline, and a fresh read shows it named `__OWM_TEST_…` — any `jq` / `curl` failure refuses. The optional "All access points" probe (it bound a test network to every production group) is removed; that scope change is deferred to an isolated test site.
- **`docs/user-guide.md`** (new). English text with a 38-row "English UI | Spanish UI" table and bold en / es pairs: connecting and certificate trust, the sidebar views, selecting and moving APs, management access and the read-only banner, AP group and Wi-Fi network actions with their refusal reasons and limits (Enterprise / PPSK), "Broadcast on", keyboard shortcuts.
- **`README.md`.** Describes management access, AP groups, Wi-Fi networks and "Broadcast on", links the guide and the checklist, lists the new modules; states that the management features are tested on fixtures and the live checklist has not been run yet (review fix).
- **`tests/unit/docs-ui-terms.test.ts`** (new, 6 tests). Every bold en / es pair in both docs and every term-table row must match one key's en and es text in `src/renderer/i18n-strings.ts` exactly; fails on a deliberately broken pair and on an empty match set.
- **`todo.md`** 4.13 ✅ with "Done (20b)".

## Acceptance

| Criterion | Result |
|---|---|
| `npm run build` exits 0 | met (after the review fixes too) |
| `npm test` exits 0 | met — 1039/1039 (was 1033; 6 new), after the review fixes too |
| `npm run smoke` exits 0 | met — 270/270 (run after the phase worker; the review fixes changed Markdown only) |
| `npm run tls-probe` exits 0 | met — 25/25 (same) |
| Checklist covers every spec §5 row and every unverified-live item of phases 12–20a | met — 78-row cross-reference table; rows not observable on production are marked Deferred / Partly covered with the reason (review fix) |
| UI terms match `i18n-strings.ts` exactly in both languages | met — `docs-ui-terms.test.ts` (130 pairs in the guide, 247 in the checklist) |
| No live controller, no `tplinkcloud.com` request (D4) | met — the probe kit was tested offline against a mock HTTPS server on 127.0.0.1 (60/60 checks in `zsh -f` and `bash --norc`) |
| No conflicted copies | met |

## Review

Codex, `docs/reviews/phase20b.md`, ship-with-fixes (3 blockers, 2 should-fix), all fixed by an opus worker; the orchestrator re-ran build and tests (green) and checked that every `curl` in the checklist goes through `ocurl`.

- Blocker: `curl -k` sent the secret and password to an unauthenticated controller, secrets exported → SPKI pin checked against the app's pinned fingerprint, secrets kept off argv and the environment.
- Blocker: the delete guard failed open on a `jq` error → fail-closed four-condition guard.
- Blocker: the optional all-access-points probe wrote to every production group → removed, deferred to an isolated test site.
- Should-fix: the cross-reference table overclaimed coverage → Coverage column with honest classes and a "Not verified" list.
- Should-fix: the README claimed live verification → reworded (fixtures only; checklist not yet run).

## Leftovers (none blocking)

- The checklist itself is unrun: every live unknown of phases 12–20a is still unverified until the user runs it.
- Deferred on production (not provoked on purpose): entering / leaving "All access points" scope, the full-group error code, the controller's group limit, deleting the default group, deleting a group that still has APs, pre-6.3 controllers.
- The probe kit needs `jq` and `openssl`; in zsh, `setopt interactivecomments` before pasting (stated in the checklist).
