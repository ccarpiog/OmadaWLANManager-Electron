# Security, async-race and accessibility audit (phase 20a)

Date: 2026-10-07. Scope: todo.md 4.13 first half — the IPC surface, redaction, async races in the renderer, destructive confirmations, and accessibility / keyboard behaviour at the three window widths. Measured against `docs/management-design.md` §3 and §4.6–§4.7. The line numbers refer to the tree at the end of phase 20a, except the rows marked I-1a (the TP-Link cloud channels and log lines added by inbox phase I-1a, `docs/omada-cloud-openapi.md`), I-1b1 (the cloud controller session), I-1b2b1 (the connection targets) and I-1b2b2 (the session-bound data channels and the controller switch), which refer to the tree at the end of those phases.

Verification: `npm run build`, `npm test` (1033 tests after the review fixes), `npm run smoke` (270 checks, 10 launches, new `[a11y]`) and `npm run tls-probe` (25 checks) all pass. Every fix below was reverted on its own, and a test then failed (see "Fixed in 20a").

## 1. IPC channels

All 26 channels are registered in `src/main/index.ts` through `handleTrusted()`, the registrar of `src/main/ipc-trust.ts` (built at `index.ts:213` with `isTrustedIpcSender`, `index.ts:169`). The two TP-Link cloud channels came with I-1a, the controller switch with I-1b2b2.

- **Sender check:** runs before the handler body. A call from any other frame is rejected with a fixed message.
- **Failures:** a failure crosses back only as `new Error(redacted message)`. The redaction scrubs the stored password, the Client Secret, the cloud Client Secret and the live cloud account tokens by value (`storedSecrets()`, I-1a: `index.ts:238`), as well as the call's own sensitive argument values.
- **Registration:** a channel cannot be registered twice.

`tests/unit/ipc-surface.test.ts` checks the registrar's behaviour. It also reads `index.ts` and checks three things:
- Nothing calls `ipcMain.*` directly.
- Every `IPC_CHANNELS` key is registered exactly once, and nothing else.
- Every handler captures `...extra` and passes it to a guard that refuses extra arguments.

Column key:
- **Shape** is the arity and structure check.
- **Formats / limits** covers ids, enums and lengths.
- **Session** is session ownership.
- **Reply** is what crosses back.
- **Sender** is ✓ for every channel: `handleTrusted()` runs `isTrusted` before the body (`ipc-trust.ts`).

| Channel | Shape | Formats / limits | Session | Reply |
|---|---|---|---|---|
| `config:load` (`index.ts:414`) | no argument (`requireNoExtraArguments`) | — | n/a | `RendererConfig`: flags only, never the password or Client Secret (`config-model.ts:348`); I-1c2a: plus `connectionTarget`, main's current target (`'local'` or an omadacId) |
| `config:save` (`index.ts:441`; I-1b2b2: `:577`) | one plain object, known keys only (`isValidConfigSavePayload`, `index.ts:228`; I-1a: `:282`, plus the cloud keys; I-1c2a: moved to `ipc-guards.ts`, shared with the unit tests and the smoke stub, and the cloud-only shape — `''` URL and username, no password — accepted whole, a partial local section refused); no extra argument | url ≤ 2048, username ≤ 256, password ≤ 512, clientId ≤ 256, clientSecret ≤ 512, language enum, `removeManagementAccess` literal `true`; I-1a: `cloudRegion` enum, `cloudClientId` ≤ 256, `cloudClientSecret` ≤ 512, `removeCloudAccess` literal `true` and alone; value rules in `saveConfig()` | n/a (a URL change is a controller transition; a cloud-credential change drops the cloud client and its tokens, and on a cloud target runs the same transition) | codes plus management and cloud flags (`cloudAccess`), never a secret; I-1b2b2: `connectionReset` whenever the transition ran — a URL change, or a cloud-credential change that dropped a cloud connection (`finishConfigSave()`, `controller-session.ts:369`) |
| `omada:connect` (`:474`) | no argument | — | starts a generation (`connection-manager.ts`) | codes; `detail` redacted (fixed in 20a) |
| `omada:select-site` (`:488`) | 2 arguments, no extra | site id `[A-Za-z0-9_-]{1,64}`, then exact-matched against the authorized list; nonce 32-hex | selection nonce of the current pending record | `ConnectionResult` |
| `omada:get-aps` (I-1b2b2: `:652`) | `requireSessionNonce` (1 argument) | nonce 32-hex | I-1b2b2: the installed, open session named by the nonce, before any controller call (`sessionDataReply()`, `controller-session.ts:2471`): none or closed → rejection `notConnected (…)`, another session's nonce → `superseded (…)`; a result or failure arriving after a switch, reconnect or transition → `superseded` | allowlisted `AccessPoint` DTO (`omada-validators.ts:86`) |
| `omada:get-wlans` (I-1b2b2: `:659`) | `requireSessionNonce` | nonce 32-hex | as `omada:get-aps` | allowlisted `GroupListing` (`omada-validators.ts:142`, `:200`) |
| `omada:set-wlan` (I-1b2b2: `:664`) | 3 arguments, no extra (`parseApMoveRequest`, `ipc-guards.ts:126`: nonce first) | nonce 32-hex; MAC regex; group id `[A-Za-z0-9_-]{1,64}` (legacy WLAN-group ids are not 24-hex) | as `omada:get-aps` (a stale nonce never reaches the controller) | `true` or a redacted rejection |
| `omada:switch-controller` (I-1b2b2: `:680`) | one plain object, exactly `{kind: 'local'}` or `{kind: 'cloud', omadacId}` (`parseControllerTargetRequest`, `ipc-guards.ts:149`); no extra argument; refused before any state change | `omadacId` by `isOmadacId()` (`[A-Za-z0-9_-]{1,64}`, never `local` or a reserved object key) | `ConnectionManager.switchTarget()`: the URL-change transition in one synchronous step (every connect, site choice, trust decision and session — its reads and writes — superseded), then `activeController` persisted and the new target connected | the new target's `ConnectionResult` (a cloud refusal: `connectError` with a code-first detail; a cloud success adds `controllerName`) |
| `omada:disconnect` (`:548`) | 0–1 argument, no extra | nonce 32-hex when given | a nonce scopes the abort to its pending selection | void |
| `cert:trust` (`:566`) | 1 argument, no extra | nonce 32-hex | trust nonce plus generation; the fingerprint is main's own | codes |
| `cert:reset` (`:586`) | no argument | — | atomic transition | codes |
| `management:capabilities` / `management:test` (`:600`, `:608`) | `requireSessionNonce` (1 argument) | nonce 32-hex | `capabilitiesReply()` (`controller-session.ts:2025`): `notConnected` / `superseded`, re-checked after the await | flags plus a reason code plus a codes-only diagnostic |
| `management:ap-groups` (`:624`) | `requireSessionNonce` | nonce | `sessionOwnedReply()` (`controller-session.ts:2094`) | `ManagedApGroup` DTO, codes |
| `management:ap-group-create` / `-rename` / `-delete` (`:629`, `:634`, `:640`) | exact keys, plain object, 1 argument (`requireExactPayload`, `ipc-guards.ts:103`) | nonce; id 24-hex (`AP_GROUP_ID_REGEX`, `ap-group-policy.ts:41`); raw name ≤ 1024, then 1–128 characters, no control or bidi characters (`validateApGroupName`, `ap-group-policy.ts:116`) | `sessionOwnedReply` plus the write epoch | codes |
| `management:networks` (`:652`) | `requireSessionNonce` | nonce | `sessionOwnedReply` | `ManagedNetwork`: allowlist plus `hasPassphrase` only (`wifi-network-model.ts:544`) |
| `management:network-create` (`:671`) | exact keys plus optional `passphrase` | nonce; name raw ≤ 1024, then SSID 1–32 UTF-8 bytes (`validateSsidName`, `wifi-network-write.ts:516`); security / bands enums; ≤ 256 deduplicated 24-hex group ids; passphrase raw ≤ 256, then 8–63 printable ASCII | `sessionOwnedReply` plus epoch | codes plus the new id; never the passphrase |
| `management:network-update` / `-password` / `-enable` / `-delete` (`:677`–`:692`) | exact keys (optional edited fields) | SSID id (`isSsidId`, `wifi-network-model.ts:172`); same name, enum and passphrase rules; `enabled` boolean | `sessionOwnedReply` plus epoch; read-merge-write on fresh data | codes |
| `management:network-bindings` (`:702`) | exact keys | SSID id; ≤ 256 deduplicated 24-hex ids | `sessionOwnedReply` plus epoch; plan on fresh data | codes plus `capacityProblems` |
| `cloud:test` (I-1a: `:809`) | no argument (`requireNoExtraArguments`): no host, deviceId, serverHost or URL from the renderer | — (saved credentials only; `notConfigured` without them) | no nonce (see §7); a reply whose credentials were saved, removed or replaced meanwhile is `superseded` (credential generation in `CloudAccessService`, `cloud-access.ts`) | `CloudController` DTOs `{omadacId, name, online, version, connectable, reason}` (`toCloudController()`, `cloud-account-model.ts`) — I-1c2a: plus the stored `localOmadacId` on a success (a routing identifier like the DTOs' omadacIds, never in a diagnostic) — or a code with a codes-only diagnostic, scrubbed by value; never a deviceId, serverHost, secret or token |
| `cloud:controllers` (I-1a: `:815`) | no argument | — (saved credentials only) | as `cloud:test` | as `cloud:test` |

**Preload** (`src/main/preload.ts`). Its only runtime import is `electron`. It exposes exactly `platform` plus 26 methods, each invoking its own channel through `ipcRenderer.invoke` (the two cloud methods with no argument; I-1b2b2: the three data methods with the session nonce first, `switchController(target)`). No other `ipcRenderer` API is used, and its local channel table equals the shared one. `ipc-surface.test.ts` (structural) checks all of this, and the smoke checks it at runtime (`EXPECTED_BRIDGE`; I-1a: the `[es]` cloud-channels check; I-1b2b2: the `[es]` controller-switch and session-bound data-channel checks).

## 2. Redaction inventory

Central redactor: `src/main/redact.ts`.

**What can cross to the renderer:**
- **Handler failures:** the rejection messages of every channel, which also appear in Electron's "Error occurred in handler" line. They go through `sanitizeIpcError()` (`ipc-trust.ts`).
- **Internal-client failures:** they leave `ControllerSession` only as a new Error with the redacted message, every credential the internal client holds or held (password, CSRF tokens, session-cookie values: `OmadaController.sessionSecrets()`) scrubbed by value (`#internalCall()`, `controller-session.ts:708`; fixed in the 20a review). This covers the connect detail, the data and AP-move rejections, and their log lines.
- **Connect detail:** the connect result's `detail` is shown to the user. It is `redactErrorMessage(error, [password])` (`connection-manager.ts:499`) over that sanitized failure.
- **Management replies:** they carry codes and codes-only diagnostics (`describeOpenApiFailure()`); Open API diagnostics are scrubbed in `OpenApiClient.#scrub()`. I-1b1: on a cloud controller only, a refusal's diagnostic also carries TP-Link's message (`OpenApiError.controllerMessage`, spec: a view-only credential's refusal shows its code and message). It is redacted and scrubbed by value of the client's tokens and of the account's cloud Client Secret and tokens (`CloudTokenProvider.liveSecrets()`); the local route keeps no controller text.
- **Transport bodies:** the transport's HTTP error excerpt is redacted before it is cut (`omada-transport.ts:115`). The internal client's session credentials are scrubbed before the cut too, so a bare one across the boundary leaves no prefix (fixed in the 20a review).

**Log lines in main.** A lint test fails if any `console.*` call passes an error or rejection reason other than through the redactor or its `.name` (`redaction-audit.test.ts`, "log lint"). The lines:

| Where | Treatment |
|---|---|
| `config.ts:106`, `:136`, `:154`, `:189` | `redactErrorMessage()` (fs / safeStorage errors; the plaintext password is scrubbed by value at `:136`) |
| `config-model.ts:194` | error name only: V8's `JSON.parse` message quotes the file (fixed in 20a) |
| `config-model.ts:257`, `:510` | `redactErrorMessage()` (`:510` also scrubs the typed password) |
| `config-model.ts:291`, `:421` | error name only |
| `index.ts:293`, `:450` | `redactErrorMessage()` (`:450` scrubs the typed and stored secrets) |
| `cert-verify.ts:128`, `:229` | `redactErrorMessage()` |
| `omada-api.ts:158`, `:267`, `:432` | `redactedMessage()`: the redactor plus every session credential by value — password, CSRF tokens, session-cookie values (fixed in 20a; the cookies in the 20a review) |
| `omada-api.ts:337`, `:424` | counts and ids only |
| `connection-manager.ts:251`, `:500` | `redactErrorMessage()` (`:500` fixed in 20a) |
| `controller-session.ts:865` … `:1914` (11 lines) | `redactText()` of codes-only text, with the call's secrets (I-1b1: on a cloud controller, plus a refusal's scrubbed TP-Link message) |
| I-1b1: `cloud-controller-session.ts:400` | counts only |
| I-1b1: `cloud-controller-session.ts:652` | `redactText()` of a failed cloud move's code and diagnostic |
| `openapi-client.ts:849` (I-1a: `:770`, the shared page walker) | counts only |
| I-1a: `cloud-access.ts:218` | `redactErrorMessage()` with the live cloud secret and tokens |
| I-1a: `cloud-access.ts:223` | the reply's codes-only diagnostic (already scrubbed by value) |
| I-1a: `config-model.ts:494`, `:718` | error name only (cloud secret decrypt / encrypt) |
| I-1b2b1: `connection-manager.ts:784` | a refused cloud connect's code-first, codes-only detail (`cloudRefusalDetail()`, redacted) |
| I-1b2b1: `connection-manager.ts:804` | a failed cloud connect's detail (`connectFailureDetail()`: the `CloudSessionError` text, redacted and scrubbed by value of the `deviceId`, the `serverHost` origin and host and the account's live secrets) |
| I-1b2b1: `connection-manager.ts:567`, `:572` | fixed text |
| other `config*.ts` lines | fixed text |

In the renderer, the console lines log rejection messages that main has already sanitized. The renderer only ever holds a typed passphrase or password, and none of its log lines includes one.

**Sentinel test.** `tests/unit/redaction-audit.test.ts` plants sentinels in every form the spec names: password, `client_secret` / `clientSecret`, `securityKey`, `psk`, `Authorization: Bearer`, cookie, CSRF token, access and refresh tokens, and a typed passphrase. They are planted both keyed and bare where the path sent them. The test drives:
- **Internal API:** a login refusal, an HTTP 500 page and a transport failure during connect, plus the AP list, group list and AP move failing through the registrar.
- **Open API:** a token refusal and a token HTTP 500, a failed AP-group read and a refused create, a refused password change echoing the typed passphrase (through the registrar), a refused basic-settings save and a failed network read.
- **Read model:** the network read model over a detail holding the stored key.
- **Live session credentials (20a review):** once logged in, a refused site list during connect, an HTTP 500 page with the session cookie across the excerpt boundary, the data and AP-move channels, and a failed re-login after a session expiry, all echoing the bare CSRF token and session cookie. On the Open API path, a transport failure and a refusal echoing the bare access token.

No sentinel may appear in any reply, rejection message or captured log line.

**TP-Link cloud (I-1a).** The cloud Client Secret, the account access and refresh tokens and `AK-` API keys are covered by:
- `redact.test.ts`: every key, header, query and bare form;
- `cloud-account-client.test.ts`: TP-Link messages and transport failures echoing them;
- `cloud-access.test.ts`: replies and the trusted registrar's by-value scrub of the live cloud secrets.

## 3. Async flows (renderer)

Generations, nonces and exclusive flags are in `state.ts`. The session generation changes only in `connect()`, `disconnect()` and `handleConnectionReset()`. All of their callers first check `isOperationInProgress()`. Main never pushes events (the preload is invoke-only).

| Flow | Stale-reply guard | Verdict |
|---|---|---|
| connect, certificate trust, site selection | `connection.ts` re-checks the generation after every await (trust and site after their dialog); nonces come from the result | OK |
| disconnect | the exclusive flag; generation bumped first; the commit is generation-gated | **fixed:** the session nonce now goes with the old generation at once (`connection.ts:507`) |
| refresh / `loadData()` | generation checked after the awaits; a stale error is swallowed. I-1b2b2: the session (generation and nonce) is captured at the start (`session-ticket.ts`); both data calls carry that nonce; the managed re-reads after a refresh start for the captured generation only while it is current (`reloadWithTicket()`) | OK (the 20a latent note in §7 is closed) |
| AP bulk move | exclusive flag; generation after the review, after each AP and after the results (`move-flow.ts`); I-1b2b2: every move and the reload after the run carry the nonce captured at the flow's start | OK |
| capability checks / "Test management access" | `settleCheck()`: generation plus nonce plus run number; Test re-checks both | OK |
| "Test cloud access" (I-1c1) | no session (works while disconnected): unsaved cloud edits are refused before any call ("save first"); a run number bumped by every run, every Settings open and close and every staged removal (`isCloudTestCurrent()`, `cloud-settings.ts`), so a late reply never paints into a closed or reopened Settings; main's `superseded` (credential saved or removed meanwhile) is shown as such, with no controller list | OK |
| managed AP-group reads / writes | request sequence plus nonce (`managed-groups.ts`); `group-flow.ts`: exclusive flag, generation after the dialog, management re-checked, nonce captured at start | OK |
| managed network reads / writes | ticket plus `isCurrentNetworkRead()` / `settleNetworkRead()`; `network-flow.ts`: `isGone()` after every dialog step, `guardedWrite()` (management, freshness, `sameManagedNetwork`), fresh re-read before Enable / Disable / Delete | OK; **fixed (20a review):** the Change password review was built from the snapshot taken when the flow opened, and now uses the same fresh re-read |
| "Broadcast on" | `isGone()`, re-read before confirming, `guardedBindingWrite()` (baseline and options unchanged) | OK |
| settings save / certificate reset | exclusive flags; the reconnect only for the same generation | OK |
| Settings opening | — | **fixed:** Settings could open during a write flow's re-read and stack under or over its dialog (`settingsBlocked()`, `settings-modal.ts:55`) |

The write flows send the nonce they captured at the start. Main's `sessionOwnedReply()` plus the write epoch refuse a superseded session; since I-1b2b2 the data loads and the AP moves do too (`sessionDataReply()`).

## 4. Destructive and broad actions

| Action | Confirmation (objects + effect) | Initial focus | Verdict |
|---|---|---|---|
| AP move (single / bulk / retry) | review: APs, from → to, networks gained / lost, clients, not atomic | Cancel | OK |
| AP-group delete | names the group; "no APs, no networks; cannot be undone"; danger button | Cancel | OK |
| Network disable / delete | names the network plus impact rows (scope, groups); danger button; fresh re-read first | Cancel | OK |
| Network enable | names the network plus impact | Cancel | OK |
| Edit (security / bands / name / passphrase) | review: from → to rows, the passphrase row, notes | Cancel | OK |
| Change password | **was: none** — Enter in the field sent the write. Now: a review naming the network, its scope, its groups and the passphrase row, with Back, built from a fresh re-read (refused with a toast when the network changed, is gone or is no longer WPA-Personal) (`network-flow.ts:587`, `passwordReviewSummary()`) | Cancel | **fixed** |
| "Broadcast on" | review: now / after / added / removed, reach | Cancel | OK |
| Settings: remove management access, reset trusted certificate | inline confirmation naming the effect | Cancel | OK |
| Settings: URL change | no confirmation (the password and Client Secret fields say "required for the new URL") | — | not in the spec's list; kept (§7) |
| Certificate first use | host plus SHA-256 fingerprint | Cancel | OK |

## 5. Accessibility and keyboard

New smoke launch `[a11y]` (`tests/smoke/run-smoke.mjs`, `runAccessibility()`); the checks run in es, and the text-asserting check also in en.

- **Layout per width:** at 1200, 900, 750 and 700×500, each of the three views shows the expected mode:
  - 1200: full sidebar plus split panes.
  - 900: icon sidebar plus split panes.
  - 750 and 700×500: top view switcher plus one pane at a time, with "Choose destination".
  - Cmd/Ctrl+F focuses that view's search (visible), with no horizontal overflow.
- **700×500:**
  - The AP list action bar and the move button are inside the window.
  - Each dialog kind is a labelled, described `role=dialog`, `aria-modal`, with every footer button inside the window and the background inert. The kinds: Settings, move review, New group, group Delete, network Edit / Disable / Delete, Change password review, "Broadcast on", New network, site list, and the certificate notice.
  - Nothing outside the dialog is focusable, Tab and Shift+Tab wrap inside it, and Escape returns focus to the opener.
- **Destructive confirmations** focus Cancel: move review, group Delete, network Disable / Delete, Change password review, both Settings inline confirmations.
- **Escape order:** Escape clears the view's search first, and focus stays there. With a dialog open, Escape closes the dialog and the search is kept. In Settings, Escape first cancels an open inline confirmation (fixed), and the next Escape closes Settings. The "exit edit mode" step has no user: every edit happens in a dialog.
- **Live regions:**
  - The selection count, the move preview, the list counts, toasts, the dialog status lines and the Settings test result are polite.
  - The dialog errors are `role=alert`.
  - The connection status is `role=status` (fixed).
- **Arrow keys:**
  - The AP checkboxes, the group and network lists, and the destination radios already supported them.
  - The site list, the "Broadcast on" group checkboxes and the New network group checkboxes now do too (fixed, `handleListArrowKeydown()` in `dom-helpers.ts`).
- **Hidden-behind-modal:** a closed dialog stayed focusable while it faded out (`visibility` is transitioned on close). Closed overlays are now `inert` (`updateBackgroundInert()`, `modal-focus.ts:86`).

## 6. Fixed in 20a

Each fix is listed with the check that fails when the fix alone is reverted. Every revert was run, and the check failed.

1. **IPC registrar.** Every channel goes through `handleTrusted()` (sender check, redacted rethrow, no double registration).
   - Fails on revert: `ipc-surface.test.ts`, the redaction tests of the data channels and the passphrase echo.
2. **No extra arguments.** The 8 older channels now refuse extra arguments (`requireNoExtraArguments`).
   - Fails on revert: `ipc-surface.test.ts`, "every handler captures its extra arguments".
3. **Connect detail and log.** The connect result's `detail` (shown in the UI) and its log line are redacted, with the password scrubbed by value.
   - Fails on revert: `redaction-audit.test.ts`, the three connect tests.
4. **Raw errors in main logs.** These are now redacted: `omada-api.ts` (3 lines), `config.ts` (4), `config-model.ts` (2), `cert-verify.ts` (2), `index.ts` (2).
   - Fails on revert: the log lint.
5. **Corrupt config file.** A config file that is not JSON was logged with V8's message, which quotes the file (plaintext legacy password). It is now logged by error name only (`parseStoredConfigText()`).
   - Fails on revert: the config test and the log lint.
6. **Change password confirmation.** Change password now has the destructive confirmation of spec §3 (es/en strings `networkPasswordReviewTitle`, `networkPasswordReviewMessage`).
   - Fails on revert: `[netedit]` es/en Change password, `[a11y]` network dialogs.
7. **Settings stacking.** Settings no longer opens over a dialog, or during a flow that is about to open one.
   - Fails on revert: `[a11y]` "Settings never stacks", `[groups]` "management access cannot change under an open write dialog".
8. **Settings inline confirmations.** Escape inside Settings cancels an open inline confirmation first.
   - Fails on revert: `[a11y]` Escape order.
9. **Disconnect nonce.** `disconnect()` drops the session nonce together with the generation, so a "Test management access" reply for the session being torn down is no longer accepted.
   - Fails on revert: `[a11y]` es/en teardown checks.
10. **Focus after Connect.** Focus returns to Connect after the certificate or site dialog that a Connect opened.
    - Fails on revert: `[a11y]` site and certificate checks.
11. **Closed dialogs inert.** Closed dialogs are `inert`, so nothing is focusable during the fade-out.
    - Fails on revert: `[a11y]` "Broadcast on".
12. **Arrow keys in dialog lists.**
    - Fails on revert: `[a11y]` site, "Broadcast on", New network.
13. **Dialog descriptions.** The site dialog and Settings now have a description (`aria-describedby`; Settings got a new es/en description string).
    - Fails on revert: `[a11y]` site and Settings.
14. **Connection status live region.** `#statusText` is now a live region.
    - Fails on revert: `[a11y]` aria-live.
15. **Live session credentials (review blocker).** A controller message could echo the CSRF token or the session cookie bare after login. The connect detail, the data and AP-move rejections and the log lines scrubbed only the static secrets. Now `ControllerSession.#internalCall()` sanitizes every internal-client failure with `OmadaController.sessionSecrets()`: the password, the Cookie header, and every CSRF token and cookie value held, also after a logout or a failed re-login. The error excerpt is scrubbed of them before its cut. The Open API path had no gap: its replies and logs carry codes only, and `OpenApiClient.#scrub()` already removes the remembered tokens.
    - Fails on revert: `redaction-audit.test.ts` "live session credentials". The sanitizer revert fails 3 tests, the pre-cut scrub revert fails the boundary test, and keeping only the current credentials fails the re-login test. The access-token test guards the existing `#knownTokens` scrub and fails when that is removed.
16. **Change password scope (review should-fix).** The review was built from the snapshot taken when the flow opened. It now re-reads with `rereadForConfirmation('password', …)` before the review, and builds the scope from that read. It refuses with the `networkChanged` toast (or the stale-data one) and ends the flow when the network changed, is gone or is no longer WPA-Personal. No new strings: the progress line reuses `bindingReading`.
    - Fails on revert: `[netedit]` es/en "states the scope of a fresh read only".

## 7. Remaining risks (accepted, with the reason)

- ~~**AP move not session-bound in main.**~~ **Closed by inbox phase I-1b2b2.** `omada:get-aps`, `omada:get-wlans` and `omada:set-wlan` now carry the session nonce of the connect result first (preload: `getAccessPoints(sessionNonce)`, `getWlanGroups(sessionNonce)`, `setApWlanGroup(sessionNonce, mac, wlanId)`):
  - main's guard rejects a missing or malformed nonce (`requireSessionNonce()`, `parseApMoveRequest()`), then `sessionDataReply()` refuses, before any controller call, a call without an installed open session (`notConnected (…)`) or with another session's nonce (`superseded (…)`), the management channels' ownership rules; the replies keep their shapes, so a refusal is a rejection whose message starts with the code;
  - a result or failure that arrives once a switch, a reconnect or a transition replaced or closed the session is refused as `superseded`, never passed on;
  - the renderer's load, refresh and move flows capture the nonce (with the generation) at their start and send it (`session-ticket.ts`).

  Unit tests: `session-data-reply.test.ts`, `connection-targets.test.ts` (real sessions: a stale nonce sends nothing to the controller; a switch during a read; a reconnect), `ipc-guards.test.ts`, `ipc-surface.test.ts`; smoke `[es]` session-bound data channels; TLS probe (another nonce is `superseded` on the real main).
- **Cloud channels without a session nonce (I-1a, a decision).** The spec binds new channels to the session nonce, but `cloud:test` and `cloud:controllers` carry none:
  - The only nonce main issues identifies a local controller session (a successful local connect). "Test cloud access" must work while disconnected from, or unable to reach, the local controller, so no nonce exists then.
  - The calls read the TP-Link account only, target no controller, take no argument, and their replies are secret-free DTOs.
  - Stale replies are refused in main instead: `CloudAccessService` keeps a credential generation, and a reply for credentials saved, removed or replaced while it ran answers `superseded`.
  - The renderer (I-1c1, Settings → "TP-Link cloud (optional)") tests the saved credential only: unsaved cloud edits are refused without a call, and a reply that no longer belongs to the run on screen is discarded (§3).
  - Done (I-1b1, I-1b2b2): a cloud controller session gets a session nonce like a local one, so every session-owned read or write on a cloud controller — the management channels and, since I-1b2b2, the data channels — is nonce-bound.
- ~~**`refreshData()` generation.**~~ **Closed by inbox phase I-1b2b2.** The refresh captures the session (generation and nonce) at its start and starts the managed re-reads for that generation only while it is still the session on screen (`reloadWithTicket()`, `session-ticket.ts`; the reload after a move too); a reload whose session changed starts no follow-up for the new one. Unit test: `renderer-session-ticket.test.ts`.
- **Late Test result.** A "Test management access" result can appear in a reopened Settings (cosmetic: it still describes the same session).
- **URL change without confirmation.** A Settings URL change has no confirmation step. It is not in the spec's list of destructive or broad actions, and the required-password placeholders already state the consequence.
- **Error toasts.** They use the polite live region, not `role=alert`.
- **Detail actions at short heights.** `.detail-actions` scroll with the detail content at short heights. They are in view when a detail opens at 700×500 but are not pinned like `.move-actions`.
- **Inline confirmations during a reset.** The Settings inline confirmations stay clickable while a certificate reset's disconnect is awaited. They are guarded by the exclusive flags, so nothing is sent twice.
