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
| 18 | 4.11 Wi-Fi network editing, Open + WPA-Personal (read-merge-write, change password) — risk: high | pending |
| 19 | 4.12 "Broadcast on" SSID ↔ AP-group binding editor with capacity checks — risk: high | pending |
| 20 | 4.13 Integration, hardening, docs, `docs/live-test-checklist.md` — risk: routine | pending |

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
- **Multi-controller dropped (2026-10-06):** the user's two OC200 controllers are not on their network, and TP-Link's cloud Open API does not reach local controllers (probe: "Controller ID not exist."). The app stays single-controller. Details: `docs/management-design.md` §7.
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

### Phase 8 — renderer modularization with esbuild (2026-10-06)

- Risk: high. Worker: opus. Full narrative: `docs/progress-archive/phase-8.md`.
- The renderer is now one esbuild IIFE bundle (`dist/renderer/renderer.js`), built from 17 modules plus the `renderer.ts` entry. Shared types come from `src/shared/types.ts`, which now also holds the `OmadaAPI` bridge interface. `index.html`/`styles.css` are unchanged.
- Acceptance met: clean build exit 0; bundle free of `require`/`exports`/`import`/`eval`; no duplicated renderer types; the markup diff is empty; isolated launch smoke 21/21 (`HOME` = temp dir).
- Review: Codex, `docs/reviews/phase8.md`, ship-with-fixes. The 1 should-fix (watch mode skipped the renderer type-check) was fixed by the orchestrator.

### Phase 9 — test harness (2026-10-06)

- Risk: routine. Worker: opus. Full narrative: `docs/progress-archive/phase-9.md`.
- `npm test` (143 tests, `node:test`, JSON fixtures, no Electron) and `npm run smoke` (39 checks, playwright-core `_electron` against a stubbed main in `tests/smoke/`). The validators, cookie jar, URL normalization and HTTP transport now live in Electron-free modules; `net-transport.ts` is injected by `index.ts`.
- Acceptance met: build exit 0; `npm test` 143/143; smoke 39/39 with zero console errors, no network and a temp HOME; it covers the connected paths phase 8 left unverified, which all pass.
- The smoke found a pre-existing focus bug (`.btn { transition: all }` hid Confirm when it was focused), fixed in `styles.css`.
- Review: Codex, `docs/reviews/phase9.md`, ship-with-fixes. The 1 should-fix (playwright-core needs Node ≥ 20; README said 18+) was fixed by the orchestrator: README and `engines` now say Node ≥ 20.

### Phase 10 — Electron upgrade (2026-10-06)

- Risk: high. Worker: opus. Full narrative, including the breaking-change table for Electron 29 → 44: `docs/progress-archive/phase-10.md`.
- Electron 28.3.3 → **44.5.1** (Chromium 152, Node 24.21). electron-builder/dmg-builder 24.13.3 → 26.17.0, TypeScript 5.9.3 → 7.0.2, @types/node → 24. The esbuild target is now `chrome152`.
- Code: `will-navigate` reads `event.url`. A new `select-client-certificate` handler never sends a client certificate: in Electron 44 it also fires for `net.request`. Both tsconfigs moved to `nodenext` with `types: ["node"]`, because TypeScript 7 dropped `moduleResolution: node`. `scripts/resolve-tsc.mjs` and `scripts/tsc.mjs` run the compiler without `.bin`. The smoke checks the sandbox through `getLastWebPreferences()` and asserts the Electron version on every launch.
- Acceptance met: `npm run build` exit 0; `npm test` 143/143; smoke 40/40 on Electron 44.5.1, with zero console errors. The compiled preload still requires only `electron`. The unsigned `electron-builder --mac --dir` to `/private/tmp/omada-p10-build` exits 0 and bundles Electron Framework 44.5.1, but only through the Node workaround in *Environment*. `mac.notarize` is still `true`. `npm audit`: 24 → 8 moderate.
- Review: Codex, `docs/reviews/phase10.md`, ship-with-fixes. The blocker was that build, build:renderer and watch still ran `tsc` through the Dropbox-breakable `.bin` shim. The orchestrator fixed it with `scripts/tsc.mjs`, then re-ran the build, the tests (143/143) and the smoke (40/40), all exit 0.

### Phase 11 — URL-scoped credentials + certificate TOFU pinning (2026-10-06)

- Risk: high. Worker: opus (phase worker, plus an opus worker for the review blockers). Full narrative: `docs/progress-archive/phase-11.md`.
- Changing the normalized controller URL drops the password, `encryptedClientSecret`, site id and pin, and a blank password is then refused (`config-model.ts`). The certificate pin is one config record `{origin, sha256, trustedAt}`. `cert-pinning.ts` decides and `cert-verify.ts` applies the decision in both the verify proc and `certificate-error`. A first use or a mismatch fails the `/api/info` handshake, so no login POST is ever sent. New IPC: `CERT_TRUST` (nonce only) and `CERT_RESET`. Renderer: `cert-modal.ts` plus a pin section in Settings. An empty URL fragment is rejected, and the README config note was rewritten.
- Electron 44 caches verify-proc verdicts per (certificate, hostname), so controller requests use a dedicated in-memory session that is replaced on trust, reset, URL change and after a rejection.
- Acceptance met: build exit 0; `npm test` 246/246; smoke 52/52; `npm run tls-probe` 21/21. The probe shows 0 HTTP requests reach the server before trust and covers the stale cache and the race cases.
- Review: Codex, `docs/reviews/phase11.md`, ship-with-fixes with 2 blockers: a URL change and `CERT_RESET` did not invalidate in-flight connects, pending site selections or the installed controller. Both were fixed by moving the state logic into the Electron-free `connection-manager.ts` with one synchronous `invalidateControllerState()`, backed by 26 new unit tests and 4 new e2e probe checks. The orchestrator then re-ran build, tests, smoke and probe, all exit 0.

### Phase 12 — Omada 6.3 correctness & terminology (2026-10-06)

- Risk: routine. Worker: opus. Full narrative: `docs/progress-archive/phase-12.md`.
- `controllerVer` is kept, and `controller-version.ts` derives `groupModel`: `apGroup` on 6.3+, otherwise `wlanGroup` (also for a missing or garbage version). `getWlanGroups()` returns `{controllerVersion, groupModel, groups}`. The list comes from `setting/wlans` (empty groups included), with SSID names outer-joined from `setting/ssids`, and non-AP `deviceType` entries are dropped. On 6.3+ a failing `setting/wlans` fails the load; on legacy or unknown versions it falls back to the old `setting/ssids` list. Moves are unchanged and empty groups are move targets. Wording is "AP groups" vs "WLAN groups (legacy)" in es and en; README and package description are updated.
- Acceptance met: build exit 0; `npm test` 327/327; smoke 58/58 (an empty group renders and opens the move confirm; legacy wording checked); `npm run tls-probe` 21/21; the preload still requires only `electron`; no `innerHTML`.
- Review: Codex, `docs/reviews/phase12.md`, ship, with 0 findings.

### Phase 13a — app shell + Access points list (2026-10-06)

- Risk: high. Workers: opus (phase), opus (review fixes). Full narrative: `docs/progress-archive/phase-13a.md`.
- Phase 13 (todo 4.6) was split before starting: 13a = shell + list, 13b = destination pane + review dialog + bulk move results (recorded in `todo.md` 4.6).
- New `shell.ts` (header: site, connection state, "Updated hh:mm", controller version, Refresh that keeps data on screen; sidebar with total counts and view placeholders) and `ap-selection.ts` (pure selection logic). The AP list uses native checkboxes with Shift-click/Shift+Arrow ranges, "Select all N filtered", and an `aria-live` "N selected (M hidden by filters)". New status/group filters. The old confirm → `OMADA_SET_WLAN` flow moves the whole selection one AP at a time; failed APs stay selected. Optional `clientNum` in `validateAccessPoints()`.
- Acceptance met: build exit 0; `npm test` 357/357; smoke 83/83 (single, multi and hidden-by-filter moves, keyboard-only move, selection survives filtering, empty group selectable and labelled, nav items + counts, placeholders, Updated time); `npm run tls-probe` 21/21; no `innerHTML`/inline styles.
- Review: Codex, `docs/reviews/phase13a.md`, ship-with-fixes. Blocker (confirm focused the Confirm button) → the confirm dialog now focuses Cancel, with `aria-describedby`; should-fix (filter-hidden range anchor) → `planRangeSelection()` re-anchors. Both fixed by an opus worker; orchestrator re-ran build, tests, smoke and probe, all green.

### Phase 13b — destination pane, review dialog, bulk move (2026-10-07)

- Risk: high. Workers: opus (phase), opus (review fixes). Full narrative: `docs/progress-archive/phase-13b.md`.
- The old group panel, "Apply change" bar and confirm modal are gone. New: an always-visible destination pane (`destination-pane.ts`, native radios, search over group and SSID names, empty groups under "Silence"), pure move logic (`move-plan.ts`: gains/losses/unchanged, "N already in this group; M will move", no-op, move plan, results, `checkRetry()`), one review → progress → results dialog (`move-dialog.ts`, focus on Cancel, clients from `clientNum`, overrides stated as unavailable) and the sequential bulk move (`move-flow.ts`, one `OMADA_SET_WLAN` at a time, per-AP results, Retry failed). "Move AP" / "Move N APs". No new IPC channel.
- Acceptance met: build exit 0; `npm test` 398/398; smoke 92/92 (single, bulk all-succeed / partial → Retry failed / cancel, SSID search, Silence, no-op + mixed, keyboard-only, Cancel focus, same-named group, Enter on a focused radio); `npm run tls-probe` 21/21; no `innerHTML`/inline styles.
- Review: Codex, `docs/reviews/phase13b.md`, ship-with-fixes. Blocker (duplicate group names made no-op detection unverifiable, since AP records carry only the group name) → same-named groups are shown disabled with a reason and `planMove()` refuses them; should-fixes (Retry failed drifting after the post-move reload; Enter acting on the checked rather than the focused radio) → retry contract re-checked by `checkRetry()`, Enter selects the focused radio first. All fixed by an opus worker; orchestrator re-ran build, tests, smoke and probe, all green.

### Phase 14a — read-only AP groups & Wi-Fi networks views, cross-navigation, AP details (2026-10-07)

- Risk: routine. Workers: opus (phase), opus (review fixes). Full narrative: `docs/progress-archive/phase-14a.md`.
- Phase 14 (todo 4.7) was split before starting: 14a = read-only views + cross-navigation + AP details, 14b = §4.6 states, read-only banner, §4.7 breakpoints, Cmd/Ctrl+F, Escape (recorded in `todo.md` 4.7).
- New: `groups-view.ts` (counts, Empty badge, Default only from `primary: true` → `WlanGroup.isDefault`), `networks-view.ts` (one entry per network name, scope "N groups · M APs", "at least M APs" when some APs' groups cannot be identified), `ap-details.ts` (row click opens it in the destination pane's place; the checkbox alone toggles), `nav-history.ts` + `navigation.ts` ("Back to …" restores view, selection, search, scroll, focus; history reconciled after every load), pure `inventory-model.ts`. Override badges stated as unavailable (no new IPC: the `ssidOverrides[]` element shape is undocumented).
- Acceptance met: build exit 0; `npm test` 438/438; smoke 109/109 (groups and networks list + detail, cross-navigation round trip with Back, AP details by row click with checkbox-only toggling, the overrides statement, all 13a/13b checks); `npm run tls-probe` 21/21; no `innerHTML`/inline styles; preload requires only `electron`.
- Review: Codex, `docs/reviews/phase14a.md`, ship-with-fixes, 0 blockers. Should-fixes (network scope showed a lower bound as exact; Back kept targets a refresh removed) fixed by an opus worker; orchestrator re-ran build, tests, smoke and probe, all green.

### Phase 14b — view states, read-only banner, responsive layout, keys (2026-10-07)

- Risk: routine. Workers: opus (phase), opus (review fixes). Full narrative: `docs/progress-archive/phase-14b.md`.
- New: pure `view-state.ts` (`contentState()` first run / disconnected / loading / initial-load error / ready; `readOnlyReason()`; `escapeAction()`), `content-state.ts` (one action per state; skeletons; persistent Retry + Settings error), `notices.ts` (refresh-error notice with the data's time + amber stale dot; read-only banner on the AP groups and Wi-Fi networks views only), `layout.ts` (≥1000 full sidebar with icons, 800–999 icon sidebar, <800 top view switcher + single-pane drill-in with Back; focus relocated on drill-in, Back and breakpoint crossings), `keyboard.ts` (Cmd/Ctrl+F; Escape: clear search → edit-mode stub → close top dialog). Header Connect disabled until configured. 7 i18n keys (es/en).
- Acceptance met: build exit 0; `npm test` 452/452; smoke 122/122 (states, banners 6.3/legacy es/en, keys, 1200/900/720 px and 700×500 with no horizontal overflow); `npm run tls-probe` 21/21; no `innerHTML`/inline styles. 8 existing smoke checks adapted where the spec changed what they assert (narrative lists them).
- Review: Codex, `docs/reviews/phase14b.md`, ship-with-fixes, 0 blockers. Two should-fixes (focus stranded in hidden UI after a successful move below 800 px; leaving single-pane mode hid a focused Back button) fixed by an opus worker with two new smoke checks; orchestrator re-ran build, tests, smoke and probe, all green.

### Phase 15a — Open API credentials, `OpenApiClient`, central redactor (2026-10-07)

- Risk: high. Workers: opus (phase), opus (review fixes). Full narrative: `docs/progress-archive/phase-15a.md`.
- Phase 15 (todo 4.8) was split before starting: 15a = credentials + client + redactor, 15b = `ControllerSession` + capabilities + "Test management access" + banner inputs (recorded in `todo.md` 4.8).
- New: Settings "Management access (optional)" (`management-form.ts`; Client ID in plain config, Client Secret only as `encryptedClientSecret` when `secureSecretStorageAvailable()` — on Linux only `gnome_libsecret`/`kwallet*` — else session-only with a note; blank keeps it only for the same URL + Client ID; Remove and a URL change clear all three; IPC carries `hasClientSecret` / `clientSecretSessionOnly` / `canPersistClientSecret` only; `CONFIG_SAVE` guard refuses unknown keys). `redact.ts` (structured + free-text; the transport redacts before its 200-char excerpt). Electron-free `openapi-client.ts` (client-credentials token, `AccessToken=`, proactive renewal, one shared re-acquire + one retry, explicit v1/v2, pagination cap 50, `listSites()` / `listApGroups()`, stable error codes) — not yet used by the connect flow.
- Acceptance met: build exit 0; `npm test` 530/530; smoke 133/133 (new `[mgmt]` launch, es + en); `npm run tls-probe` 22/22 (real main without `safeStorage`: only the Client ID on disk, secret never in a reply, file or log); preload `electron`-only; no `innerHTML`/inline styles.
- Review: Codex, `docs/reviews/phase15a.md`, ship-with-fixes, 2 blockers (Linux `basic_text` counted as secure storage; quoted `key="value"` secrets passed the redactor), both fixed by an opus worker with 14 new tests; orchestrator re-ran build, tests, smoke and probe, all green.

### Phase 15b — `ControllerSession`, capability detection, "Test management access" (2026-10-07)

- Risk: high. Workers: opus (phase), opus (review fixes). Full narrative: `docs/progress-archive/phase-15b.md`.
- New `controller-session.ts`: `ConnectionManager` installs a `ControllerSession` (internal client + `OpenApiClient` on the same pinned-session transport); the connect result carries `siteName` + `sessionNonce` (header shows the site name). Background capability checks, reason codes in order: `legacyController`, `managementNotConfigured`, `invalidCredentials`, `tokenFailed`, `siteNotFound`, `apGroupsMismatch` (id sets, never names), `probeFailed`; renderer-only `managementChecking`. Every invalidation closes the Open API client and token synchronously; late results discarded. New IPC `MANAGEMENT_CAPABILITIES` / `MANAGEMENT_TEST` (one session nonce each). `readOnlyReason()` takes the capabilities; "Test management access" in Settings; 20 strings es/en.
- Acceptance met: build exit 0; `npm test` 580/580; smoke 144/144 (new `[caps]` launch: banner per reason, Test results, es + en); `npm run tls-probe` 25/25 (nothing reaches the server before trust; the token request follows `/api/info` + login on the controller session; reset drops the token; a credentials save + reconnect makes exactly one token request); no `innerHTML`; preload `electron`-only.
- Review: Codex, `docs/reviews/phase15b.md`, ship-with-fixes, 2 blockers (a new connect left the old Open API session usable until the new login; `close()` kept tokens in `#knownTokens`) + 1 should-fix (a credentials save started a probe overlapping the reconnect's), all fixed by an opus worker, each with a test that fails when reverted; orchestrator re-ran build, tests, smoke and probe, all green.

### Phase 16a — AP group operations and IPC (2026-10-07)

- Risk: high. Workers: opus (phase), opus (review fixes). Full narrative, incl. the unverified API behaviors for the phase 20 checklist: `docs/progress-archive/phase-16a.md`.
- Phase 16 (todo 4.9) was split before starting: 16a = main-side operations + IPC + contract tests, 16b = UI + smoke (recorded in `todo.md` 4.9).
- New: `OpenApiClient.createApGroup/renameApGroup/deleteApGroup` (v1; POST/PATCH body `{name}`, DELETE no body); pure `ap-group-policy.ts` (names 1–128, no control/bidi, no case-insensitive duplicate; delete codes `groupIsDefault`, `groupNotEmpty`, `groupHasNetworks`, `groupNotFound`, `groupStateUnknown`); `ControllerSession` re-reads the list before every write, `managementUnavailable` when off, writes serialized, `superseded` on invalidation; pure `ipc-guards.ts`; channels `management:ap-groups` (read: `ManagedApGroup` + `ssidLimits`) and `management:ap-group-create|rename|delete`; preload `getManagedApGroups`/`createApGroup`/`renameApGroup`/`deleteApGroup`; stub channels with `apGroupOverrides`/`apGroupSsidLimits`/`apGroupResults`/`apGroupWrites`. No user-facing strings.
- Acceptance met: build exit 0; `npm test` 638/638; smoke 145/145; `npm run tls-probe` 25/25; preload `electron`-only; no conflicted copies.
- Review: Codex, `docs/reviews/phase16a.md`, ship-with-fixes. Blocker (`ssidNameList: [null]` filtered to "no bindings" allowed a delete) → lists kept only when all strings, else unknown → `groupStateUnknown`; should-fix (create's missing-id fallback turned `superseded` into success) → propagated. Fixed by an opus worker with tests that fail on revert; orchestrator re-ran build, tests, smoke and probe, all green.

### Phase 16b — AP group management UI (2026-10-07)

- Risk: high. Workers: opus (phase), opus (review fixes). Full narrative, incl. the leftovers for the phase 20 checklist: `docs/progress-archive/phase-16b.md`; the detailed "how" is `todo.md` 4.9 "Done (16b)".
- New: pure `group-management.ts` (`isGroupManagementOn()`, `deleteBlocks()` — null = hidden for the default group, else reasons failing closed; `checkGroupName()` mirroring `ap-group-policy.ts`; `fullCapacityBands()`; reply parsers; code → es/en text), `managed-groups.ts` (nonce-bound `getManagedApGroups()` reads, stale replies discarded), `group-dialog.ts` (`modal-focus.ts` pattern), `group-flow.ts` (one exclusive write → main's answer as text → reload data + capabilities + managed view → toast + focus). AP groups view: New group / Rename / Delete only while management is on; per-band capacity ("Not reported" when absent); Capacity warning badge (a band reported at 0); "Move access points here" pre-checks the group as the phase-13 destination (internal API, always shown). Capability re-checks ("Test management access", connect / reconnect) clear the renderer's capabilities at once (`beginCapabilityCheck()`), so write actions hide until a passing result. 58 i18n keys (es/en).
- Acceptance met: build exit 0; `npm test` 675/675; smoke 166/166 (6th launch `[groups]`: create / refused create / rename / Move here → review → move / delete blocked / fresh-data refusal / delete after confirm, capability off and re-check running, badge es + en, 700×500, stale reply discarded); `npm run tls-probe` 25/25; no `innerHTML`; preload `electron`-only. Two existing smoke checks adapted (14a "no edit controls" now expects the Move-here button; `[caps]` bridge check skips the renderer's own managed-list reads).
- Review: Codex, `docs/reviews/phase16b.md`, ship-with-fixes, 0 blockers. Should-fixes (re-checks did not fail closed; Capacity warning badge missing) plus the worker's own spec deviation (default-group Delete disabled instead of hidden, §4.4) fixed by an opus worker, each with checks that fail on revert; orchestrator re-ran build, tests, smoke and probe, all green.

### Phase 17a — Wi-Fi network read model in main (2026-10-07)

- Risk: high (the plan said routine; this half decides which secrets reach the renderer). Workers: opus (phase), opus (review fixes). Full narrative, incl. 10 unverified API behaviors for the phase 20 checklist: `docs/progress-archive/phase-17a.md`; the detailed "how" is `todo.md` 4.10 "Done (17a)".
- Phase 17 (todo 4.10) was split before starting: 17a = main-side read model + IPC, 17b = networks view + smoke (recorded in `todo.md` 4.10).
- New: `OpenApiClient` v2 SSID catalog / v1 detail / v1 bindings; pure `wifi-network-model.ts` (validators, list-vs-detail disagreement → unknown, allowlist-only `ManagedNetwork` with `hasPassphrase` only, `chooseDevices` 0 = "All access points", unrecognised → unknown scope, §5 enable fallback); `ControllerSession.listManagedNetworks()` (gated on `manageWifiNetworks`, 16a session binding, sequential ⌈N/100⌉ + 2N requests, cap 128 networks); IPC `management:networks` + preload `getManagedNetworks()`; stub knobs `networks` / `networksResult`. Refactor: shared `sessionOwnedReply()` (16a behavior unchanged).
- Acceptance met: build exit 0; `npm test` 731/731 (nested sentinel secrets at any depth never reach a reply or log; malformed payloads rejected; unknown never becomes "all" or "enabled"; contract tests per call; superseding connect / disconnect / re-check / credentials save); smoke 167/167; `npm run tls-probe` 25/25; preload `electron`-only; no conflicted copies.
- Review: Codex, `docs/reviews/phase17a.md`, ship-with-fixes. Blocker (`listAll()` stopped at a short page despite `totalRows`, so a list could be silently incomplete) → walks to `totalRows`, anything unprovable is `truncated`, an incomplete or over-cap catalog is `networkListIncomplete`; should-fix (bound AP-group ids accepted any string) → 24-hex `isApGroupId()`, one bad id drops the list (unknown scope). Fixed by an opus worker (9 + 5 tests fail on revert); orchestrator re-ran build, tests, smoke and probe, all green.

### Phase 17b — Wi-Fi networks view on the managed source (2026-10-07)

- Risk: routine. Workers: opus (phase), opus (review fixes). Full narrative: `docs/progress-archive/phase-17b.md`; the detailed "how" is `todo.md` 4.10 "Done (17b)" (4.10 now ✅).
- New: pure `network-management.ts` (`networkManagementOn()` — connected, nonce, 6.3 group model, no read-only reason, `manageWifiNetworks`; `isCurrentNetworkRead()`; `parseManagedNetworksResult()` refusing the whole reply on one bad DTO; scope / value text; typed `NetworkKey`; `settleNetworkRead()`), `managed-networks.ts` (nonce-bound `getManagedNetworks()` reads after capabilities change, refresh, post-move reload, Retry; stale replies discarded), `managed-networks-view.ts` (rows: enabled · security · bands; scope "All access points" / "N groups · M APs" with stated lower bounds / "Unknown scope"; detail with password Set / None / Unknown only). Management off or checking → the 14a view unchanged. A failed first read → §4.6 error with Retry + Settings (never a partial list); a failed re-read keeps the same session's last good list, marked stale (`#networksStaleNotice`). 33 i18n keys (es/en). No main-side change.
- Acceptance met: build exit 0; `npm test` 774/774; smoke 182/182 (7th launch `[nets]`: scopes es + en, error + Retry, unknown scope, stale replies of an older read and an old session discarded, management off → 14a, no sentinel secret in the DOM, stale list kept on a failed re-read, Back surviving a re-check); `npm run tls-probe` 25/25; no `innerHTML`; preload `electron`-only.
- Review: Codex, `docs/reviews/phase17b.md`, ship-with-fixes, 0 blockers. Should-fixes (a failed refresh discarded the good list; an untyped key could resolve a name as another network's id; a capability re-check erased managed Back history) fixed by an opus worker, each with tests that fail on revert; orchestrator re-ran build, tests, smoke and probe, all green.

## Plan status: ACTIVE — phases 8–17 done, phases 18–20 pending

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

## Next action

**Phase 18 — todo 4.11: Wi-Fi network editing, Open + WPA-Personal (risk: high).** Split it before starting, as phases 15–17 were, and record the split in `todo.md` 4.11: **18a** = main side — `OpenApiClient` writes (create, `basic-config` PATCH, change password, `enable`, delete; exact paths and bodies from `docs/omada-openapi-ops.md`), pure body builders + validators (UTF-8 SSID ≤ 32 bytes, passphrase 8–63 chars, passphrase only when typed, required fields present, Enterprise / PPSK refused), `ControllerSession` read-merge-write on fresh data (serialized writes, `superseded` on invalidation, the 16a pattern), guarded IPC channels + preload methods (the passphrase crosses IPC only renderer → main, never back; never logged — central redactor), smoke-stub channels and knobs, fixture tests; no UI. **18b** = renderer — create (disabled by default, bound to selected groups), staged edit of basic settings, Change password (re-typed passphrase for WPA-Personal `basic-config` saves, spec §3/§5), enable/disable, delete with impact summary, Enterprise/PPSK explained as not editable; smoke for create / edit / cancel / delete confirmations in es + en. Start with 18a.

- Read first: `todo.md` 4.11 and 4.10 "Done (17a)" + "Done (17b)"; `docs/management-design.md` §3 (security), §4.5 (Wi-Fi networks view) and §5 (defensive defaults) only; `docs/omada-openapi-ops.md` (SSID create / update / enable / delete operations); `docs/progress-archive/phase-16a.md` (the write pattern: fresh-data policy, serialized writes, guards, stub knobs) and `phase-17a.md` (the read model the writes merge onto).
- Acceptance (18a): unit / fixture tests for the Open and WPA-Personal bodies (required fields, passphrase only when typed, the length rules), read-merge-write keeps every unedited field the detail returned, Enterprise / PPSK writes refused, passphrase in no reply, log or error text; `npm run build`, `npm test`, `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` and `npm run tls-probe` (same `ELECTRON_PATH`) all exit 0. No live controller (D4); unverified write behaviors go to the phase 20 checklist list in the narrative.

## Key paths

- `src/renderer/renderer.ts` — renderer entry (event wiring + init); logic lives in sibling modules (`state`, `i18n`, `shell` (header + sidebar), `connection`, `ap-list` + `ap-filters` + pure `ap-selection`, `destination-pane`, pure `move-plan` + `move-text`, `move-dialog`, `move-flow` (bulk move), `groups-view` + `networks-view` + `ap-details` over pure `inventory-model`, `navigation` + pure `nav-history` (Back), pure `view-state` (§4.6 states, `readOnlyReason()`, `escapeAction()`) + `content-state` + `notices`, `layout` (breakpoints, single-pane drill-in), `keyboard` (Cmd/Ctrl+F, Escape), `*-modal`, `toast`, …), bundled by `scripts/build-renderer.mjs`
- `scripts/tsc.mjs` + `scripts/resolve-tsc.mjs` — run TypeScript 7 through Node (no `.bin` shim)
- `tests/unit/` + `tests/fixtures/` — `npm test` (runner `scripts/run-unit-tests.mjs`); `tests/smoke/` — `npm run smoke` (`stub-main.cjs`, `run-smoke.mjs`)
- `src/main/omada-transport.ts` (transport interface + hardened request logic), `net-transport.ts` (Electron `net`), `omada-validators.ts`, `cookie-jar.ts`, `url.ts`
- `docs/reviews/` — phase review briefs and reports from phase 8 on (earlier ones in `.claude/reviews/`); `docs/progress-archive/` — closed-phase narratives
- `src/main/index.ts` — window creation, IPC handlers, cert verification
- `src/main/omada-api.ts` — OmadaController HTTP client (`getWlanGroups()` → `GroupListing`: `setting/wlans` outer-joined with `setting/ssids`, legacy fallback); `src/main/controller-version.ts` — `controllerVer` → `groupModel`
- `src/main/config.ts` — config persistence (save rules in the pure `config-model.ts`, incl. the Client ID / Client Secret rules and `secureSecretStorageAvailable()`)
- `src/main/controller-session.ts` — `ControllerSession` facade (internal client + Open API client, capability checks and reason codes, AP-group writes); `src/main/ap-group-policy.ts` (pure name + delete policy), `src/main/ipc-guards.ts` (pure IPC shape / nonce / id guards); `src/renderer/management.ts` — capabilities state (fail-closed `beginCapabilityCheck()`) + "Test management access"; `src/renderer/group-management.ts` (pure AP-group action rules, name check, capacity warning, code → text), `managed-groups.ts` (nonce-bound managed list), `group-dialog.ts` + `group-flow.ts` (New / Rename / Delete); `src/renderer/network-management.ts` (pure managed-network rules: source, stale-reply decision, reply parsing, scope text, typed keys), `managed-networks.ts` (nonce-bound managed network reads, stale list on a failed re-read), `managed-networks-view.ts` (managed list + detail)
- `src/main/openapi-client.ts` — Electron-free Open API client (token lifecycle, v1/v2 paths, pagination walking to `totalRows`, `listSites()` / `listApGroups()` / SSID catalog, detail and bindings); `src/main/wifi-network-model.ts` — pure SSID validators + secret-free `ManagedNetwork` DTO builder; `src/main/redact.ts` — central redactor; `src/renderer/management-form.ts` — Settings "Management access (optional)"
- `src/main/cert-pinning.ts` (pure pin decision + fingerprint), `cert-verify.ts` (verify proc, `certificate-error`, `ControllerTlsSessions`), `connection-manager.ts` (connect / site selection / trust / reset / `invalidateControllerState()`, Electron-free); `src/renderer/cert-modal.ts`
- `tests/tls-probe/` — opt-in `npm run tls-probe` (local HTTPS servers, real Electron)
- `src/main/preload.ts` — contextBridge API
- `docs/management-design.md` — approved spec for phases 8–20 (decisions, architecture, security, UI)
- `docs/omada-6.3-api-findings.md` — live API findings on controller 6.3.0.45 (internal API + Open API summary)
- `docs/omada-openapi-ops.md` — Open API operations (params, bodies, responses) extracted from the controller's own spec

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
- Phase 17b: committed as "Show the managed Wi-Fi network list when management is on"; a follow-up commit records its SHA and push result.
