# PROGRESS — Omada WLAN Manager (Electron)

Authoritative checkpoint for autoclaude runs (`/autoclaude-opus`, `/autoclaude-fable`; earlier phases ran under `/goahead-fable`). Plan source: `todo.md` — sections 1–3 (code-review findings, 2026-08-24, phases 1–7) and **section 4 (Omada 6.3 AP groups & Wi-Fi network management, 2026-10-06, phases 8–20)**. Phases 8–20 implement the spec in `docs/management-design.md`; read that spec's relevant section before starting any of them.

## Phase plan

| Phase | Scope (todo.md items) | Status |
|---|---|---|
| 1 | Renderer/main bug fixes: 1.1, 1.4, 1.5, 1.12, 1.13, 1.14 (minimal renderer-side), 1.15, 3.9 | **done** |
| 2 | API client robustness (`omada-api.ts`): 1.3, 1.6, 1.7, 1.8, 3.13 | **done** |
| 3 | Config & credential security: 2.1, 2.4, 2.5 (+1.14 final flag mechanism), 2.7, 3.6 | **done** |
| 4 | Renderer/IPC/cert hardening: 1.9, 2.2, 2.3a (origin compare), 2.6, 3.14 | **done** |
| 5 | Packaging & platform: 1.2, 3.5, 3.15 | **done** |
| 6 | UX improvements: 3.1, 3.2, 3.7, 3.8 (+OMADA_CONNECT i18n error codes) | **done** |
| 7 | Connection flow & multi-site: 1.11, 3.12 | **done** |
| 8 | 4.1 Renderer modularization with esbuild (absorbs 3.4) — risk: high (structural, no behavior change); worker: opus | **done** — `docs/progress-archive/phase-8.md` |
| 9 | 4.2 Test harness: `npm test` (node:test + fixtures) and committed Playwright `_electron` smoke with stubbed main (`npm run smoke`) — risk: routine; worker: opus | **done** — `docs/progress-archive/phase-9.md` |
| 10 | 4.3 Electron 28 → 44 (absorbs 3.3) — risk: high; worker: opus | **done** — `docs/progress-archive/phase-10.md` |
| 11 | 4.4 URL-scoped credentials + certificate TOFU pinning (completes 2.3b) — risk: high; worker: opus | **done** — `docs/progress-archive/phase-11.md` |
| 12 | 4.5 Omada 6.3 correctness: `controllerVer`, `groupModel`, full group list from `setting/wlans` (empty groups), AP/WLAN terminology — risk: routine; worker: opus | **done** — `docs/progress-archive/phase-12.md` |
| 13a | 4.6 (first half) App shell (sidebar, counts, Updated hh:mm) + Access points list with checkbox multi-select surviving filters — risk: high; worker: opus | **done** — `docs/progress-archive/phase-13a.md` |
| 13b | 4.6 (second half) Destination pane, review dialog, sequential bulk move with per-AP results + Retry failed — risk: high; worker: opus | **done** — `docs/progress-archive/phase-13b.md` |
| 14a | 4.7 (first half) Read-only AP groups & Wi-Fi networks views from internal data, cross-navigation with "Back to …", AP details pane — risk: routine; worker: opus | **done** — `docs/progress-archive/phase-14a.md` |
| 14b | 4.7 (second half) §4.6 states, read-only banner with reason, §4.7 responsive breakpoints, Cmd/Ctrl+F and Escape — risk: routine; worker: opus | **done** — `docs/progress-archive/phase-14b.md` |
| 15a | 4.8 (first half) Management-access credentials in config + Settings, Electron-free `OpenApiClient`, central redactor — risk: high; worker: opus | **done** — `docs/progress-archive/phase-15a.md` |
| 15b | 4.8 (second half) `ControllerSession` facade, capability detection + §2.2 reason codes, "Test management access", `readOnlyReason()` inputs — risk: high; worker: opus | **done** — `docs/progress-archive/phase-15b.md` |
| 16a | 4.9 (first half) Open API create/rename/delete of AP groups, main-side policy on fresh data, guarded IPC + `ManagedApGroup` capacity read path, smoke-stub channels — risk: high; worker: opus | **done** — `docs/progress-archive/phase-16a.md` |
| 16b | 4.9 (second half) AP groups view actions (New / Rename / Delete with refusal reasons), per-band capacity, Capacity warning badge, "Move access points here", fail-closed capability re-checks, smoke — risk: high; worker: opus | **done** — `docs/progress-archive/phase-16b.md` |
| 17a | 4.10 (first half) Open API SSID catalog / detail / bindings reads, pure validators, secret-free `ManagedNetwork` DTO, scope + enable fallback, guarded `management:networks` IPC, smoke stub — risk: high; worker: opus | **done** — `docs/progress-archive/phase-17a.md` |
| 17b | 4.10 (second half) Wi-Fi networks view on the managed source when management is on (stale replies discarded), scopes "All access points" / "N groups · M APs", smoke es + en — risk: routine; worker: opus | **done** — `docs/progress-archive/phase-17b.md` |
| 18a | 4.11 (first half) Open API network writes (create, `basic-config`, change password, `enable`, delete), pure builders + validators, read-merge-write on fresh data, security / band dependents, guarded IPC, smoke stub — risk: high; worker: opus | **done** — `docs/progress-archive/phase-18a.md` |
| 18b | 4.11 (second half) Wi-Fi networks view editing UI: create, staged edit, Change password, enable / disable, delete with impact summary, Enterprise / PPSK explained, freshness gate, smoke es + en — risk: high; worker: opus | **done** — `docs/progress-archive/phase-18b.md` |
| 19a | 4.12 (first half) Open API SSID ↔ AP-group binding write (`PATCH …/ssids/{ssidId}/ap-groups`), pure binding plan + per-band capacity validation on fresh data, never for "All access points", guarded IPC, smoke stub — risk: high; worker: opus | **done** — `docs/progress-archive/phase-19a.md` |
| 19b | 4.12 (second half) "Broadcast on" editor UI: searchable group checkboxes, before / after reach diff, capacity problems per group + band, confirmation, smoke es + en — risk: high; worker: opus | **done** — `docs/progress-archive/phase-19b.md` |
| 20 | 4.13 Integration, hardening, docs, `docs/live-test-checklist.md` — split into 20a / 20b before starting (recorded in `todo.md` 4.13) | **done** (20a + 20b) |
| 20a | 4.13 (first half) IPC + redaction audit, async-race review, destructive paths confirmed, accessibility / keyboard smoke `[a11y]` at the three widths, `docs/security-audit.md` — risk: high; worker: opus | **done** — `docs/progress-archive/phase-20a.md` |
| 20b | 4.13 (second half) README + short user guide (es / en UI terms) + `docs/live-test-checklist.md` per spec §6 — risk: routine; worker: opus | **done** — `docs/progress-archive/phase-20b.md` |
| I-1a | Inbox I-1 (spec `autoclaude/processed/10-tplink-cloud-controllers.md`, part A): cloud config fields, `CloudAccountClient`, `OpenApiClient` cloud route, redactor additions, guarded IPC `cloud:test` / `cloud:controllers`, smoke-stub channels, `docs/omada-cloud-openapi.md` — risk: high; worker: opus | **done** — `docs/progress-archive/phase-i-1a.md` |
| I-1b | Inbox I-1 part B: Open-API-only `ControllerSession` + `ConnectionManager` local / cloud targets, Open API moves verified by re-read, race tests — split into I-1b1 / I-1b2 before starting (recorded in `todo.md` §5) | in progress |
| I-1b1 | Inbox I-1 part B (first half): Open-API-only cloud controller session (sites, `ap-groups/aps`, `ap-groups`, networks + writes over the cloud route, `orgVersion`, capabilities, moves verified by re-read), Electron-free, fixtures, not wired yet — risk: high; worker: opus (phase and review fixes) | **done** — `docs/progress-archive/phase-i-1b1.md` |
| I-1b2 | Inbox I-1 part B (second half): `ConnectionManager` local / cloud targets, switch IPC, `localOmadacId`, `activeController` / `cloudSites` persistence with local fallback, session nonces on the `omada:*` data channels, race tests, smoke stub; renderer consumers honor `ssidListUnknown` (I-1b1 review) — split into I-1b2a / I-1b2b (recorded in `todo.md` §5) | in progress |
| I-1b2a | Renderer honors `ssidListUnknown`: move planning, inventory, AP selection, destination pane, move review and networks view never read an unknown group's networks as "0 networks" / a reach diff; es / en unknown text; unit tests; local behavior and smoke unchanged — risk: high; worker: opus (phase and review fix) | **done** — `docs/progress-archive/phase-i-1b2a.md` |
| I-1b2b | `ConnectionManager` local / cloud targets, switch IPC, `localOmadacId`, `activeController` / `cloudSites` persistence with local fallback, session nonces on `omada:get-aps` / `omada:get-wlans` / `omada:set-wlan`, `CloudSessionError` mapping, race tests, smoke stub, tls-probe green — split into I-1b2b1 / I-1b2b2 (recorded in `todo.md` §5) | in progress |
| I-1b2b1 | Connection targets in main: `ConnectionManager` local / cloud targets + `switchTarget()` with the synchronous invalidation, cloud connect from a fresh organization entry, `localOmadacId`, `activeController` / `cloudSites` persistence, pure startup-target resolution with the local fallback, `CloudSessionError` mapping, race tests; Electron-free, no IPC / renderer / startup change — risk: high; worker: opus (phase; review fix by the orchestrator) | **done** — `docs/progress-archive/phase-i-1b2b1.md` |
| I-1b2b2 | Guarded switch IPC, startup honoring the resolved target, session nonces on `omada:get-aps` / `omada:get-wlans` / `omada:set-wlan` (main, preload, renderer move + refresh, 20a `refreshData()` fix), renderer tolerates a cloud `url: ''`, smoke stub, tls-probe green — risk: high; position: after I-1b2b1 | pending |
| I-1c | Inbox I-1 part C: Settings cloud section, controller switcher, state reset, cloud error states, "Connect through TP-Link cloud", smoke `[cloud]` es + en, README + checklist cloud section — risk: high; position: after I-1b | pending |

**Phases 8–20 invariants (user decision D4, 2026-10-06):** no phase may contact the real controller (`192.168.1.130`) or read/write the real `~/.omada-wlan-manager/` config. Verification is `npm run build` + (from phase 9) `npm test` + `npm run smoke` against a stubbed main process with `HOME` pointed at a temp dir. Behaviors that need a live controller follow the defensive defaults in `docs/management-design.md` §5; the user runs `docs/live-test-checklist.md` manually after phase 20.

**Deferred (need user input or live controller):**
- ~~1.10 status-category mapping~~ — **done 2026-08-29** (see below).
- ~~2.3b trust-on-first-use cert pinning~~ — done in phase 11 (todo 4.4).
- ~~3.3 Electron 28 → current major upgrade~~ — scheduled as phase 10 (todo 4.3).
- ~~3.4 esbuild bundler for renderer~~ — scheduled as phase 8 (todo 4.1).
- 3.10 ESLint/CI scaffolding — tests scheduled as phase 9 (todo 4.2); ESLint/CI remain optional.

## Decisions

- **2.1 config compat:** password will be encrypted via `safeStorage` with one-time migration of the plaintext value. This breaks config compatibility with the old Python version (one-way). Chosen because todo.md's own fix instruction recommends it; flagged here for the user.
- **User-facing text:** the app is bilingual (es/en via the i18n table in `renderer.ts`); every new user-facing string must be added to BOTH languages. Code comments/docs in English.
- **todo.md upkeep:** each phase worker marks its completed items in `todo.md` (✅ + one line describing how).
- **Management plan (2026-10-06, user decisions D1–D4 — full text in `docs/management-design.md` §1):** D1 hybrid architecture — internal username/password API stays for viewing and **all AP moves**; an optional Open API Client ID/Secret unlocks AP-group and Wi-Fi network management. D2 groundwork first (phases 8–11). D3 Wi-Fi network editing for Open + WPA-Personal only; Enterprise/PPSK view/enable/bind/delete only. D4 no live-controller tests in autoclaude runs. Defaults: controllers < 6.3 are assignment-only; "All devices" SSID bindings read-only; only empty, unbound, non-default AP groups can be deleted; Client Secret never stored in plaintext.
- **Multi-controller dropped (2026-10-06):** the user's two OC200 controllers are not on their network, and TP-Link's cloud Open API does not reach local controllers (probe: "Controller ID not exist."). The app stays single-controller. Details: `docs/management-design.md` §7. **Revised 2026-10-07 by user decisions D5–D7** (inbox item I-1): the Account Level Open API (beta) tunnels to on-prem controllers, so after phase 20 a TP-Link cloud account adds remote controllers beside the direct local one (one switcher); D4 extends to no `tplinkcloud.com` request from tests, smoke or probes. Phases 8–20 stay single-controller.
- **UI direction (2026-10-06):** sidebar with Access points (landing) / AP groups / Wi-Fi networks; the Wi-Fi networks view is the only place to edit SSID ↔ AP-group bindings; no "remove AP from group" (always "move to"). Spec §4 of `docs/management-design.md`.

## Environment

- Dropbox strips symlinks and exec bits inside `node_modules` (todo.md 3.11). Every `tsc` run goes through `scripts/tsc.mjs` (Node + `resolveTscPath()`), so a broken `node_modules/.bin` no longer matters. Re-run `npm install` if a package itself goes missing.
- Verification commands: `npm run build` (`tsc` for main/preload/shared → `tsc -p src/renderer` type-check → esbuild bundle via `scripts/build-renderer.mjs` → copy-static); `npm test` (unit tests, no Electron, temp HOME); `ELECTRON_PATH=<electron binary> npm run smoke` (GUI smoke, stubbed main, temp HOME); `ELECTRON_PATH=<electron binary> npm run tls-probe` (opt-in, phase 11: real Electron `net.request` and the real `dist/main/index.js` against local 127.0.0.1 HTTPS servers with openssl self-signed certificates, temp HOME; run it whenever certificate, session or connection-state code changes). No linter. `engines.node` is `^22.18.0 || >=24.2.0` since phase 10. The local Node is 22.15.1, so `npm install` warns; only electron-builder actually breaks on it (next bullet).
- **Packaging on Node 22.12–22.17 / 24.0–24.1** (nodejs/node#58586, non-ASCII repo path): `npx electron-builder` fails with `Cannot find module 'async-exit-hook'`. Until the user upgrades Node, run `node --no-turbo-fast-api-calls node_modules/electron-builder/cli.js …` instead, building to `/private/tmp` and never `./release`. With `mac.notarize: true`, electron-builder 26 reads `APPLE_KEYCHAIN_PROFILE` (plus the optional `APPLE_KEYCHAIN`) only when neither the `APPLE_ID…` set nor the `APPLE_API_KEY…` set is in the environment.
- Dropbox gotcha: several quick back-to-back edits to one file can leave "<name> (… conflicted copy).md" files, and once even removed `PROGRESS.md` itself (phase 8). Batch the edits to a file, then run `fd -H "conflicted copy"` before committing. Keep the newest complete copy.
- Smoke Electron binary: `node_modules/electron/dist` is broken by Dropbox, so `npm run smoke` needs `ELECTRON_PATH`. An extracted Electron 44.5.1 lives at `/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron`. It may vanish on reboot; if so, re-extract `electron-v44.5.1-darwin-arm64.zip` (GitHub release, or `~/Library/Caches/electron/` after a packaging run) with `ditto -x -k`. The smoke fails unless every launch runs the installed Electron version, so the old 28.3.3 copy in `/private/tmp/omada-p8-smoke/` is rejected.
- Git remote: `origin` → github.com/ccarpiog/OmadaWLANManager-Electron.git, branch `main`.

## Completed

### Phases 1–7, GUI smoke, item 1.10, releases v1.0.0 / v1.1.0 (2026-08-24 → 2026-08-29)

- Full narratives moved to `docs/progress-archive/phases-1-7-and-releases.md` (reviews in `.claude/reviews/`).
- Release gotchas still in force: build to `/private/tmp`, never `./release` (Dropbox strips the symlinks in `Electron.app`); `codesign` selects the identity by SHA-1 hash (the "í" in the name breaks under a non-UTF-8 locale); `mac.notarize` stays a plain `true` (notarytool keychain profile `AC_NOTARY_PROFILE`, see `SIGN_AND_NOTARIZE.md` in the user's OneDrive); `notarize-dmg.sh` globs the `.dmg`. Releases are arm64 only. Smoke scripts must keep `HOME` on a temp dir: the user's real config auto-connects to the live controller.
- v1.0.0 (tag at `a209965`) and v1.1.0 are published on GitHub; the user confirmed v1.0.0 against a live controller on 2026-08-29.

### Phases 8–20b (2026-10-06 → 2026-10-07)

- Summaries are in the phase plan table above; full narratives, acceptance evidence and review resolutions are in `docs/progress-archive/phase-8.md` … `phase-20b.md` (reviews in `docs/reviews/phase8.md` … `phase20b.md`, all Codex, all ship or ship-with-fixes with every blocker fixed).

### Phase I-1a — TP-Link cloud account groundwork in main (2026-10-07)

- Risk: high. Workers: opus (phase); the two review fixes were made by the orchestrator (each under 10 lines). Full narrative: `docs/progress-archive/phase-i-1a.md`; the "how" is `todo.md` §5 "Done (I-1a)" (§5 is new: the I-1 plan record).
- New: `src/main/cloud-{hosts,throttle,account-model,account-client,access,transport}.ts` (allowlist, per-credential throttle, DTO + reasons, `get_tokens`-only account client, `CloudAccessService`, origin-locked transport in its own session), the `OpenApiClient` `cloud` route, cloud config fields with Remove as `removeCloudAccess: true` on `config:save`, guarded nonce-free `cloud:test` / `cloud:controllers` (credential generation → `superseded`), redactor additions, four-organization smoke-stub fixtures, TLS-probe step (e), `docs/omada-cloud-openapi.md`. No UI, no `ControllerSession` / `ConnectionManager` change.
- Acceptance met: build exit 0; `npm test` 1122/1122; smoke 271/271; `npm run tls-probe` 29/29 (all re-run by the orchestrator after the review fixes); no conflicted copies; no controller or `tplinkcloud.com` API contact (the worker fetched only the public documentation guide).
- Review: Codex, `docs/reviews/phaseI-1a.md`, ship-with-fixes. Blocker: an invalid persisted region was dropped alone, rebinding the secret to EUW (→ a present-but-invalid region or Client ID drops the whole credential, regression test). Should-fix: cloud invalidation ran after an await (→ inside the save callback). Both fixed and verified.

### Phase I-1b1 — Open-API-only cloud controller session (2026-10-07)

- Risk: high. Workers: opus (phase, `5aba471`); opus (the two review fixes, next iteration). Full narrative: `docs/progress-archive/phase-i-1b1.md`; the "how" is `todo.md` §5 "Done (I-1b1)".
- `ControllerSession` delegates to `LocalControllerBackend` (moved code) or `CloudControllerBackend` (`src/main/cloud-controller-session.ts`, cloud-route client factory, moves verified by re-read, `CloudSessionError`); not wired into `ConnectionManager` / IPC yet.
- Acceptance met: build exit 0; `npm test` 1156/1156; smoke 271/271; `npm run tls-probe` 29/29 (all re-run by the orchestrator after the fixes); no conflicted copies; no controller or `tplinkcloud.com` contact.
- Review: Codex, `docs/reviews/phaseI-1b1.md`, ship-with-fixes. Blocker (truncated site list could auto-select a site → `listIncomplete` first, test) and should-fix (cloud routing identifiers in diagnostics → scrubbed by value on the cloud route, tests) fixed; should-fix `ssidListUnknown` read as "no networks" → carried into I-1b2's acceptance (consumer list in the archive).

### Phase I-1b2a — the renderer honors `ssidListUnknown` (2026-10-07)

- Risk: high. Workers: opus (phase; the same worker, resumed, for the review fix). Full narrative: `docs/progress-archive/phase-i-1b2a.md`; the "how" is `todo.md` §5 "Done (I-1b2a)".
- A group whose network list is unknown never reads as "0 networks": the move preview / review keep the known APs' diff and say "Network change unknown for N APs"; single-group counts read "Networks unknown"; combined counts are a lower bound ("at least N", badge "N+"); an unknown group matches destination search by its own name only. Local results byte-identical (optional fields absent without the flag).
- Acceptance met: build exit 0; `npm test` 1184/1184 (was 1156); smoke 271/271 with no smoke edits (all re-run by the orchestrator after the fix); no conflicted copies; renderer-only, no controller or `tplinkcloud.com` contact.
- Review: Codex, `docs/reviews/phaseI-1b2a.md`, ship-with-fixes. Should-fix (the internal networks list said "No Wi-Fi networks available" for an all-unknown inventory and gave an exact search total) fixed with the pure `networkListKeys()` and 4 tests.

### Phase I-1b2b1 — connection targets in main (2026-10-07)

- Risk: high. Workers: opus (phase); the review fix was made by the orchestrator (under 10 source lines). Full narrative: `docs/progress-archive/phase-i-1b2b1.md`; the "how" is `todo.md` §5 "Done (I-1b2b1)". Split from I-1b2b before starting (I-1b2b2 = the IPC side).
- `ConnectionManager.switchTarget()` (synchronous invalidation first, `activeController` persisted, full reconnect even to the same target), cloud connect from a fresh organization entry (`CloudAccessService.findOrganization()`, `src/main/cloud-connect.ts`), `cloudSites[omadacId]` read and written, `localOmadacId` learned on a local install, pure `resolveStartupTarget()` (`src/main/connection-target.ts`, not wired yet), code-first `CloudSessionError` connect `detail` / move rejection. No IPC, preload, renderer or startup change: the running app stays local.
- Acceptance met: build exit 0; `npm test` 1218/1218 (was 1184); smoke 271/271; `npm run tls-probe` 29/29 (all re-run by the orchestrator after the review fix); no conflicted copies; no controller or `tplinkcloud.com` contact.
- Review: Codex, `docs/reviews/phaseI-1b2b1.md`, ship-with-fixes, 0 blockers. Should-fix (a truncated organization list still connected when the omadacId was on a read page) fixed: `listIncomplete` refusal first, fail-closed; assertions and contract §13 updated.

## Inbox

- 2026-10-07 10:09: triaged `10-tplink-cloud-controllers.md` → **queued** as I-1 (split I-1a / I-1b / I-1c per the item's own suggestion), after phase 20; I-1a done 2026-10-07. The user's decisions D5–D7 in it match the session memory of 2026-10-07; the TP-Link portal's Open API page is not yet enabled for the account, so I-1 builds against the documented contract and fixtures only.

## Plan status: ACTIVE — phases 8–20, I-1a, I-1b1, I-1b2a and I-1b2b1 done; next I-1b2b2, then I-1c

Phases 1–7 are done, committed, and pushed (plus releases v1.0.0/v1.1.0). On 2026-10-06 the user approved a new plan — todo.md section 4, phases 8–20 — after a live check of Omada Controller 6.3.0.45 showed that WLAN Groups became AP Groups (findings: `docs/omada-6.3-api-findings.md`). The app still works on 6.3, but it hides empty AP groups (todo 4.5). The plan adds AP-group and Wi-Fi network management.

## Open risks

- ~~Verify-proc cert bypass is hostname-scoped~~ — closed by phase 11: the bypass now requires the pinned fingerprint, so another certificate on another port of the same host is rejected.
- ~~No live GUI smoke test~~ — done 2026-08-29, see above.
- ~~Never tested against a live controller~~ — the user tested the packaged
  v1.0.0 app against a real controller on 2026-08-29 and reported it working.
  This was the last blocker on the release. Deferred item 1.10 (status-category
  mapping) is now actionable: it only needed live status values to verify.
- ~~Packaging never run end-to-end~~ — `electron-builder --mac` run 2026-08-29
  (signed + notarized, see the release section). Windows and Linux targets are
  still untested.
- ~~Phase 8 connected paths not GUI-tested~~ — covered by phase 9's smoke
  (connect → lists, site selection, AP move, refresh, disconnect); all pass.
- `npm audit`: 8 moderate remain after phase 10 (down from 24: 1 critical and 17 high). All 8 are in
  electron-builder's `@electron/get@3` → `global-agent` → `roarr` → `sprintf-js` chain, which is
  build-time only and has no upstream fix yet.
- Local Node 22.15.1 is below the new `engines` range. electron-builder needs the
  `--no-turbo-fast-api-calls` workaround until the user upgrades to Node 22.18+ or 24.2+.
- electron-builder 26 is untested for Windows/Linux, and a full signed + notarized DMG
  has not been built on it yet. Check `APPLE_KEYCHAIN_PROFILE=AC_NOTARY_PROFILE` on the next release.
- ~~`normalizeControllerUrl()` keeps an empty `#`~~ — fixed in phase 11 (main and renderer reject it).
- Phase 11 leftovers (none blocking): a stale request made after a TLS-session switch can still record a pin rejection that a concurrent connect to the same host picks up, so the dialog could show a confusing fingerprint; save/reset may take up to 3 s to reply when the old controller hangs (old-session logouts get that long); each session reset keeps an in-memory partition alive until quit; the e2e probe runs with `safeStorage` disabled. Phase 15 must route the Open API client through the same `ControllerTlsSessions` session and `ConnectionManager` invalidation, and clear `encryptedClientSecret` through the existing URL-change path in `config-model.ts`.
- ~~Four stale `renderer.ts` comments; "Access Points" title; `controllerVersion` not shown~~ — fixed in phase 13a.
- Phase 12 leftovers (none blocking): before connecting, the UI shows the 6.3 "AP groups"
  wording. `setting/wlans` on pre-6.3 controllers has never been tested live; the
  fallback to `setting/ssids` covers that case.
- Phase 13a leftovers (none blocking): ~~the header shows the site name only after a pick in the
  site modal~~ — fixed in phase 15b (main returns `siteName`); `clientNum` is unverified live (add it to
  the phase 20 checklist); the AP details pane (row click) is deferred to phase 14 (`todo.md` 4.7);
  a failed refresh now logs `console.warn` instead of `console.error`.
- Phase 13b leftovers (none blocking): same-named groups cannot be move targets until renamed (the
  internal AP list has only group names; per-AP ids need `GET eaps/{mac}`); the review states that
  per-AP SSID overrides cannot be shown; a successful move still ends on a results dialog that needs
  one Close.
- Phase 14a leftovers (none blocking): in the Access points list an AP in a shared-name group shows the
  network count of the first group with that name (since 13a); the 13b review dialog says the internal API
  "does not report" overrides although `eaps/{mac}` returns `ssidOverrides[]` (element shape undocumented;
  smoke asserts the text); per-band capacity (`remainingBinding` in `setting/wlans`) is not kept yet —
  phase 16; an AP with no group makes every network's count "at least M APs".
- Phase 14b leftovers (none blocking): the default window (900×650) lands on the icon sidebar — ask the
  user whether to raise the default width to ~1100 px (the window-size smoke pins 900×650); the read-only
  banner points at "Settings → Management access", which phase 15 creates; a connect / first-load failure
  now reads "Error loading data from the controller" rather than "Connection error".
- Phase 15a leftovers (none blocking): the Open API token endpoint, reply shape, `expiresIn` (300 s default)
  and error codes (-44112/-44113 + HTTP 401 = token rejected, -44106 = bad credentials) and the Client ID
  format (1–128 `[A-Za-z0-9._-]`) are unverified — add them to the phase 20 checklist; the Linux
  secure-backend check is unit-tested only; a secret blob written under an insecure Linux backend by an
  earlier build could not be told apart later (no released build stored one); two documented free-text
  redactor gaps in `redact.ts` (`redactValue()` covers them for structured data).
- Phase 15b leftovers (none blocking): "Test management access" tests saved credentials only (unsaved
  edits → "save first", disconnected → "connect first"); during a reconnect the old **internal** controller
  stays installed until the new attempt succeeds (phase-7 behavior; its Open API client is closed at once);
  the probe's proof that Open API calls use the controller session leans on Electron caching a first-use
  rejection in the default session; that internal and Open API site / AP-group ids are the same values is
  unverified live — add it to the phase 20 checklist.
- Phase 16a leftovers (none blocking): six unverified AP-group API behaviors (POST without `apMacs` and its
  `result.id`, PATCH name-only, error codes -33200/-33201/-33203, duplicate-name handling, what `apNum` /
  `ssidNameList` count, `remainingBinding` keys and `maxSsids*`, the 128-character rule) — listed in
  `docs/progress-archive/phase-16a.md`, add them to the phase 20 checklist; groups with a non-24-hex id are
  listed but not writable (16b must mirror the rule); the new smoke check prints stack traces for its
  deliberately malformed IPC calls (expected, the run still passes).
- Phase 16b leftovers (none blocking): add to the phase 20 checklist whether a newly created group appears in
  the internal `setting/wlans` list right after the reload, and whether `remainingBinding` has an MLO key (the
  MLO capacity row never shows a remaining value); after a write, main does not re-run its `apGroupsMismatch`
  id comparison; "Move access points here" pre-checks the group as the destination instead of opening a
  separate AP picker (spec §4.4 wording); the dialog-guard smoke check reaches its state by script.

- Phase 17a leftovers (none blocking): one failing per-network detail or bindings call fails the whole network
  read (`requestFailed`) — if the real controller errors on bindings for "All access points" networks, the 17b view
  always fails, so phase 20 checks that first; `listAll()`'s new no-progress rule also marks a trailing
  duplicates-only page as `truncated` for AP groups (fail-closed); more rows than `totalRows` still counts as complete;
  hidden / guest / VLAN are not in the DTO yet; 10 unverified API behaviors listed in `docs/progress-archive/phase-17a.md`.
- Phase 17b leftovers (none blocking): a group → network cross-link carries a name, so when two managed networks share it the
  view opens searched for the name instead of a detail; the networks stale notice sits above the views beside the general
  refresh notice; managed Back entries are dropped once management is definitively off (the 14a view has no ids).
- Phase 18a leftovers (none blocking): a WPA2/WPA3 network with PMF mandatory is lowered to PMF capable when its bands change (18b
  must state it; phase 20 checks what the controller allows); MLO compatibility is not checked; only name, Open ↔ WPA-Personal, bands and
  passphrase are editable — hidden / guest / VLAN / PMF / 802.11r / MLO are preserved but absent from the renderer DTO; creating an Open
  6 GHz network is refused (no `oweEnable` in the create schema); the unverified write behaviors are listed in `todo.md` 4.11 "Done (18a)".
- Phase 18b leftovers (none blocking): the PMF note is a possibility only (the DTO has no PMF); a click made while a background managed re-read runs is
  refused with a toast instead of disabling the buttons (no flicker); the 14b Escape edit-mode stub is still unused (19b may use it); the live
  checks (PMF lowering, create disabled + enable by id, duplicate-name rule, disable / delete scope, Enterprise / PPSK toggles) are listed in
  `docs/progress-archive/phase-18b.md`.
- Phase 19a leftovers (none blocking): no MLO `remainingBinding` key is documented (`MLO_REMAINING_BINDING_KEY = null`), so an MLO-enabled network
  can gain no AP group until phase 20 verifies a key (removals still work); an absent / malformed `mloEnable` refuses additions; whether the PATCH
  replaces or merges, the full-group error code and catalog / detail scope agreement are live checks listed in `todo.md` 4.12 "Done (19a)".
- Phase 19b leftovers (none blocking): the editor is a dialog, so the 14b edit-mode stub stays unused; for an MLO network adding groups is
  refused only at Save, by main (the renderer DTO has no MLO state); a bound group missing from the AP-group list can only be removed; the
  editor's AP counts come from internal data, not the controller's `apNum`; the live checks are at the end of `todo.md` 4.12 "Done (19b)".
- Phase 20a leftovers (none blocking, `docs/security-audit.md` §7): `omada:set-wlan` / `omada:get-aps` / `omada:get-wlans` carry no session nonce (safe today
  through the renderer's exclusive, generation-checked move flow; bind them in I-1b); `refreshData()` uses the current generation, not a captured one
  (latent); a late "Test management access" result can show in a reopened Settings; a URL change has no confirmation; error toasts use the polite
  live region; `.detail-actions` are not pinned at short heights; Settings inline confirmations stay clickable during a certificate reset (guarded).
- Phase 20b leftovers (none blocking): `docs/live-test-checklist.md` is unrun, so every live unknown of phases 12–20a stays unverified until the user runs it;
  deferred on production on purpose: entering / leaving "All access points" scope, the full-group error code, the group limit, deleting the default group or a
  group with APs, pre-6.3 controllers; the probe kit needs `jq` + `openssl`, and zsh needs `setopt interactivecomments` before pasting (stated in the checklist).
- Phase I-1a leftovers (none blocking): the save codes `invalidCloudClientId` / `cloudClientIdRequired` / `cloudClientSecretRequired` have no es/en strings
  yet (I-1c); the smoke stub's config load returns no cloud flags yet (I-1c); `activeController` / `cloudSites` survive a dropped credential, so I-1b must
  fall back to local when the active cloud controller has no usable credential; the `config:save` invalidation ordering has no automated test; the live
  unknowns are `docs/omada-cloud-openapi.md` §11.
- Phase I-1b1 leftovers (none blocking): a cloud session's `url` is `''` (use `kind` / `controllerName`); `close()` drops the management clients only, the
  data client serves until `logout()`; the cloud mapper emits `ssidList: []` + `ssidListUnknown: true` when the group's SSID names are unreported, which
  today's renderer reads as "no networks" — **I-1b2 must fix the consumers (listed in `docs/progress-archive/phase-i-1b1.md`) before the cloud session is
  installable**; the renderer shows an AP with no reported group name as "Unassigned" (should be unknown — I-1c); live unknowns in
  `docs/omada-cloud-openapi.md` §11 items 8–12.
- Phase I-1b2a leftovers (none blocking): the unknown-state DOM text is unit-tested only — local data never sets the flag, so the smoke reaches it only
  once the cloud session is wired (I-1b2b) and a `[cloud]` smoke launch exists (I-1c); a network only an unknown group might broadcast is not listed.
- Phase I-1b2b1 leftovers (none blocking, all for I-1b2b2): the `config:save` reply must report `connectionReset` when a cloud-credential change dropped a
  cloud connection (`applyConfigSave()` already runs the transition; today only a URL change reports it); startup must call
  `resolveStartupTarget(config, getCloudCredentials() !== null)`; a failed `activeController` write is only logged (the switch still applies to the run).
- **User's uncommitted files (never commit, revert or reconcile them):** `tests/smoke/window-placement.cjs` (untracked) and the edits to
  `tests/smoke/stub-main.cjs` and `tests/tls-probe/app-main.cjs` that load it appeared at 11:01 on 2026-10-07, during the 19b iteration, made
  by neither the worker nor the orchestrator — the user's concurrent change (smoke / probe windows on a secondary display, shown without focus).
  Commit phase work by explicit path so they stay out; verification runs fine with them in the tree.

## Next action

**Start phase I-1b2b2** (risk: high; plan: `todo.md` §5 "I-1b2b" → "Split" → "I-1b2b2", plus the "For I-1b2b2" bullet under "Done (I-1b2b1)"; contract `docs/omada-cloud-openapi.md` §13; nonce background `docs/security-audit.md` §7): a guarded controller-switch IPC channel over `ConnectionManager.switchTarget()` (through `handleTrusted()` + `ipc-guards.ts`, target shape validated, preload method); startup honoring `resolveStartupTarget(config, getCloudCredentials() !== null)` (`src/main/connection-target.ts`); session nonces on `omada:get-aps` / `omada:get-wlans` / `omada:set-wlan` in main, preload and the renderer's move and refresh flows (20a leftover), with the 20a `refreshData()` captured-generation fix; the `config:save` reply reporting `connectionReset` when a cloud-credential change dropped a cloud connection (I-1b2b1 leftover); the renderer tolerating a connected cloud session's `url: ''` (minimal, no switcher UI — that is I-1c); smoke-stub channels for the switch (the stub file `tests/smoke/stub-main.cjs` carries the user's uncommitted hunks: stage only the phase's hunks, as phase I-1a did from a temp copy with the user's hunks reversed); race tests; `npm run tls-probe` green.

Verify: `npm run build`, `npm test` (now 1218), `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` (271) and `npm run tls-probe` (29, same `ELECTRON_PATH`), all exit 0; `fd -H "conflicted copy"` empty. The user's own uncommitted test files stay out of every commit (commit by explicit path).

## Key paths

- `src/renderer/renderer.ts` — renderer entry (event wiring + init); logic lives in sibling modules (`state`, `i18n`, `shell` (header + sidebar), `connection`, `ap-list` + `ap-filters` + pure `ap-selection`, `destination-pane`, pure `move-plan` + `move-text`, `move-dialog`, `move-flow` (bulk move), `groups-view` + `networks-view` + `ap-details` over pure `inventory-model`, `navigation` + pure `nav-history` (Back), pure `view-state` (§4.6 states, `readOnlyReason()`, `escapeAction()`) + `content-state` + `notices`, `layout` (breakpoints, single-pane drill-in), `keyboard` (Cmd/Ctrl+F, Escape), `*-modal`, `toast`, …), bundled by `scripts/build-renderer.mjs`
- `scripts/tsc.mjs` + `scripts/resolve-tsc.mjs` — run TypeScript 7 through Node (no `.bin` shim)
- `tests/unit/` + `tests/fixtures/` — `npm test` (runner `scripts/run-unit-tests.mjs`); `tests/smoke/` — `npm run smoke` (`stub-main.cjs`, `run-smoke.mjs`)
- `src/main/omada-transport.ts` (transport interface + hardened request logic), `net-transport.ts` (Electron `net`), `omada-validators.ts`, `cookie-jar.ts`, `url.ts`
- `docs/reviews/` — phase review briefs and reports from phase 8 on (earlier ones in `.claude/reviews/`); `docs/progress-archive/` — closed-phase narratives
- `src/main/index.ts` — window creation, IPC handlers, cert verification
- `src/main/omada-api.ts` — OmadaController HTTP client (`getWlanGroups()` → `GroupListing`: `setting/wlans` outer-joined with `setting/ssids`, legacy fallback); `src/main/controller-version.ts` — `controllerVer` → `groupModel`
- `src/main/config.ts` — config persistence (save rules in the pure `config-model.ts`, incl. the Client ID / Client Secret rules and `secureSecretStorageAvailable()`)
- `src/main/controller-session.ts` — `ControllerSession` facade (internal client + Open API client, capability checks and reason codes, AP-group writes); `src/main/ap-group-policy.ts` (pure name + delete policy), `src/main/ipc-guards.ts` (pure IPC shape / nonce / id guards); `src/renderer/management.ts` — capabilities state (fail-closed `beginCapabilityCheck()`) + "Test management access"; `src/renderer/group-management.ts` (pure AP-group action rules, name check, capacity warning, code → text), `managed-groups.ts` (nonce-bound managed list), `group-dialog.ts` + `group-flow.ts` (New / Rename / Delete); `src/renderer/network-management.ts` (pure managed-network rules: source, stale-reply decision, reply parsing, scope text, typed keys), `managed-networks.ts` (nonce-bound managed network reads, stale list on a failed re-read), `managed-networks-view.ts` (managed list + detail); `src/renderer/network-editing.ts` (pure network write rules: actions per security mode, client checks, staged-edit diff, impact rows, `networkWriteBlock()` freshness gate), `network-dialog.ts` + `network-flow.ts` (New / Edit / Change password / Enable / Disable / Delete); `src/renderer/i18n-strings.ts` (DOM-free es/en tables; `i18n.ts` keeps the helpers)
- `src/main/openapi-client.ts` — Electron-free Open API client (token lifecycle, v1/v2 paths, pagination walking to `totalRows`, `listSites()` / `listApGroups()` / SSID catalog, detail and bindings, SSID create / `basic-config` / `enable` / delete); `src/main/wifi-network-model.ts` — pure SSID validators + secret-free `ManagedNetwork` DTO builder; `src/main/wifi-network-write.ts` — pure SSID write rules (name / passphrase checks, `basic-config` schema merge, `deriveSecurityDependents()`); `src/main/network-binding-plan.ts` — pure SSID ↔ AP-group binding plan (scope, diff, per-band + MLO capacity); `src/main/redact.ts` — central redactor; `src/renderer/management-form.ts` — Settings "Management access (optional)"
- `src/main/cert-pinning.ts` (pure pin decision + fingerprint), `cert-verify.ts` (verify proc, `certificate-error`, `ControllerTlsSessions`), `connection-manager.ts` (connect / site selection / trust / reset / `invalidateControllerState()`, Electron-free); `src/renderer/cert-modal.ts`
- `tests/tls-probe/` — opt-in `npm run tls-probe` (local HTTPS servers, real Electron)
- `src/main/preload.ts` — contextBridge API; `src/main/ipc-trust.ts` — `handleTrusted()`, the one IPC registrar (sender check first, redacted failures)
- `docs/user-guide.md` — short user guide (es / en UI terms); `docs/live-test-checklist.md` — the user's manual live run (spec §6), with the pinned-TLS probe kit and the cross-reference table
- `docs/security-audit.md` — phase 20a audit: IPC channel table, redaction inventory, async-flow guards, destructive actions, accessibility, remaining risks
- `docs/management-design.md` — approved spec for phases 8–20 (decisions, architecture, security, UI)
- `docs/omada-6.3-api-findings.md` — live API findings on controller 6.3.0.45 (internal API + Open API summary)
- `docs/omada-openapi-ops.md` — Open API operations (params, bodies, responses) extracted from the controller's own spec
- `src/main/connection-target.ts` (target type, pure `resolveStartupTarget()`), `src/main/cloud-connect.ts` (`createCloudControllerLookup()`: fresh organization entry → refusal code or cloud session factory), `tests/unit/connection-targets.test.ts` (targets, persistence, races)
- `src/main/cloud-hosts.ts` (`serverHost` allowlist), `cloud-throttle.ts` (per-credential throttle), `cloud-account-model.ts` (organization validators, DTO + reasons, error codes), `cloud-account-client.ts` (`CloudAccountClient`), `cloud-access.ts` (`CloudAccessService`: credential generation, the two IPC replies), `cloud-transport.ts` (origin-locked Electron `net` in its own session); `docs/omada-cloud-openapi.md` — the Account Level Open API contract (§11 = live unknowns)

## Git state

- Phases 4 (37450f1), 5 (a7f2e30), 6 (9b685b2), and 7 (final commit on main, SHA in `git log`) all pushed to origin/main (2026-08-24). Tree clean after the phase-7 commit.
- Phase 8: `9f147ad`, pushed.
- Phase 9: `65dcf1a` ("Add unit tests and a GUI smoke harness"), pushed to origin/main (`f0a891e..65dcf1a`). A follow-up commit records this SHA. Tree clean after it.
- Phase 10: `388791f` ("Upgrade Electron to 44 and the build toolchain"), pushed to origin/main (`73ae8ed..388791f`). A follow-up commit records this SHA. Tree clean after it.
- Phase 11: `29be7d9` ("Scope credentials to the controller URL and pin its certificate"), pushed to origin/main (`4b82bd9..29be7d9`). A follow-up commit records this SHA. Tree clean after it.
- Phase 12: `c7b251f` ("List empty AP groups and detect the controller's group model"), pushed to origin/main (`7a848ab..c7b251f`). A follow-up commit records this SHA. Tree clean after it.
- Phase 13a: `0a7f7d1` ("Add the sidebar shell and checkbox multi-select for access points"), pushed to origin/main (`7bf0e6b..0a7f7d1`). A follow-up commit records this SHA. Tree clean after it.
- Phase 13b: `b3ecb65` ("Add the destination pane, move review and sequential bulk moves"), pushed to origin/main (`17dcba5..b3ecb65`). A follow-up commit records this SHA. Tree clean after it.
- Phase 14a: `33bcb34` ("Add read-only AP group and Wi-Fi network views with cross-navigation"), pushed to origin/main (`cf2db68..33bcb34`). A follow-up commit records this SHA. Tree clean after it.
- Phase 14b: `b68ea14` ("Add view states, the read-only banner and the responsive layout"), pushed to origin/main (`9567098..b68ea14`). A follow-up commit records this SHA. Tree clean after it.
- Phase 15a: `a14415d` ("Add optional Open API credentials, an Open API client and a central redactor"), pushed to origin/main (`72faed9..a14415d`). A follow-up commit records this SHA. Tree clean after it.
- Phase 15b: `1bcc5ea` ("Add the controller session, management capability checks and a test button"), pushed to origin/main (`4a259f6..1bcc5ea`). A follow-up commit records this SHA. Tree clean after it.
- Phase 16a: `a8a6612` ("Add AP group create, rename and delete operations behind guarded IPC"), pushed to origin/main (`df49bed..a8a6612`). A follow-up commit records this SHA. Tree clean after it. Deviation: that commit message wrongly carries a `Co-Authored-By: Claude` trailer, against the user's global rule (no AI references in commits); left as is because history is never rewritten on pushed `main` — never add such a trailer again.
- Phase 16b: `b98365f` ("Add AP group management actions and per-band capacity to the AP groups view"), pushed to origin/main (`ea83c4f..b98365f`). A follow-up commit records this SHA. Tree clean after it.
- Phase 17a: `619d18f` ("Read Wi-Fi networks through the Open API with secrets stripped behind guarded IPC"), pushed to origin/main (`dbf07af..619d18f`). A follow-up commit records this SHA. Tree clean after it.
- Phase 17b: `9f52776` ("Show the managed Wi-Fi network list when management is on"), pushed to origin/main (`7b1e177..9f52776`). A follow-up commit records this SHA. Tree clean after it.
- Phase 18a: `985f6e2` ("Add Wi-Fi network create, edit, enable and delete behind guarded IPC"), pushed to origin/main (`fec4a4f..985f6e2`). A follow-up commit records this SHA. Tree clean after it.
- Phase 18b: `ecd9d3d` ("Add Wi-Fi network create, edit, password, enable and delete to the networks view"), pushed to origin/main (`a5c3e02..ecd9d3d`). A follow-up commit records this SHA. Tree clean after it.
- Inbox triage (I-1 queued): `71826e3` (script commit), pushed with phase 19a.
- Phase 19a: `afa7182` ("Add the Wi-Fi network AP-group binding write with capacity checks behind guarded IPC"), pushed to origin/main (`eb581f4..afa7182`). A follow-up commit records this SHA. Tree clean after it.
- Phase 19b: `f91eae6` ("Add the Broadcast on editor that picks which AP groups carry a Wi-Fi network"), pushed to origin/main (`3d505e8..f91eae6`). A follow-up commit records this SHA. Tree clean after it except the user's own uncommitted files (`tests/smoke/window-placement.cjs`, `tests/smoke/stub-main.cjs`, `tests/tls-probe/app-main.cjs`; see Open risks), deliberately left out.
- Phase 20a: `d92ed36` ("Route every IPC channel through one sender-checked registrar and harden redaction, focus and stale-data guards"), pushed to origin/main (`54739aa..d92ed36`). A follow-up commit records this SHA. Tree clean after it except the user's own uncommitted files (`tests/smoke/window-placement.cjs`, `tests/smoke/stub-main.cjs`, `tests/tls-probe/app-main.cjs`) deliberately left out.
- Phase 20b: `ee32098` ("Add the user guide, the live-test checklist and README coverage of AP-group and Wi-Fi network management"), pushed to origin/main (`df69b86..ee32098`). A follow-up commit records this SHA. Tree clean after it except the user's own uncommitted files (`tests/smoke/window-placement.cjs`, `tests/smoke/stub-main.cjs`, `tests/tls-probe/app-main.cjs`) deliberately left out.
- Phase I-1a: `ea2596c` ("Add a TP-Link cloud account client, the Open API cloud route and guarded cloud IPC on fixtures"), pushed to origin/main (`9086eac..ea2596c`). A follow-up commit records this SHA. Its `tests/smoke/stub-main.cjs` holds only the phase block (staged from a temp copy with the user's hunks reversed). Tree clean after it except the user's own uncommitted files (`tests/smoke/window-placement.cjs`, `tests/smoke/stub-main.cjs`, `tests/tls-probe/app-main.cjs`) deliberately left out.
- Phase I-1b1: `5aba471` ("Add an Open-API-only controller session for cloud controllers with moves verified by a re-read"), pushed to origin/main (`0478796..5aba471`); its two review fixes and the close are `cdec083` ("Refuse a truncated cloud site list and scrub cloud routing identifiers from diagnostics"); its push failed three times (GitHub `remote rejected … Internal Server Error`, 2026-10-07 15:12–15:13 UTC) and went through with phase I-1b2a's push (`5aba471..25c167e`). A follow-up commit records this SHA. Tree clean after it except the user's own uncommitted files (`tests/smoke/window-placement.cjs`, `tests/smoke/stub-main.cjs`, `tests/tls-probe/app-main.cjs`) deliberately left out.
- Phase I-1b2a: `25c167e` ("Show unreported AP-group network lists as unknown instead of empty in moves, counts and the networks list"), pushed to origin/main (`5aba471..25c167e`, carrying the I-1b1 close commits too). A follow-up commit records this SHA. Tree clean after it except the user's own uncommitted files (`tests/smoke/window-placement.cjs`, `tests/smoke/stub-main.cjs`, `tests/tls-probe/app-main.cjs`) deliberately left out.
- Phase I-1b2b1: `e24eb47` ("Let the connection manager target the local or a cloud controller with fail-closed cloud lookups and race-safe switching"; phase code, review fix and close in one commit), pushed to origin/main (`a75043c..e24eb47`). A follow-up commit records this SHA. Tree clean after it except the user's own uncommitted files (`tests/smoke/window-placement.cjs`, `tests/smoke/stub-main.cjs`, `tests/tls-probe/app-main.cjs`) deliberately left out.
