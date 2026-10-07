# Phase I-1a — TP-Link cloud account groundwork in main (2026-10-07)

- **Plan:** inbox item I-1 part A (spec `autoclaude/processed/10-tplink-cloud-controllers.md`; plan record `todo.md` §5, "Done (I-1a)" holds the full "how").
- **Risk:** high. **Workers:** opus (phase); the two review fixes were made by the orchestrator (under 10 lines each).
- **Run:** `/autoclaude-opus`, driven.

## What was built

- **Config** (`config-model.ts`, `config.ts`): optional fields `cloudRegion` (`aps|euw|use`, default `euw`), `cloudClientId`, `encryptedCloudClientSecret` (safeStorage blob only, session-only fallback), `localOmadacId` (dropped on a URL change; I-1b populates it), `activeController` (`'local'` or an omadacId), `cloudSites`. A region or cloud Client ID change drops the stored secret. Remove cloud access is `removeCloudAccess: true` on `config:save`, sent alone. The renderer sees `cloudAccess` flags only.
- **`CloudAccountClient`** (`cloud-account-client.ts`): `get_tokens` only, renewed 60 s before expiry and once on HTTP 401 / `-44112` / `-44113` / `-44116`; the refresh token is never sent or kept. Organizations walked to `totalRows`, capped at 10 pages of 100 (fail-closed `truncated`); the page walker `walkPagedListing()` is shared with `OpenApiClient.listAll()`.
- **Throttle** (`cloud-throttle.ts`): one per credential, ≤ 5 requests/s FIFO, 1 / 2 / 4 / 8 s backoff on `-7132` / 429, 3 retries.
- **Allowlist** (`cloud-hosts.ts`) and **transport** (`cloud-transport.ts`): https, default port, no userinfo / path / query / fragment, hostname exactly `aps1|euw1|use1-omada-northbound.tplinkcloud.com`; the transport refuses every other origin before sending and refuses redirects. The cloud has its own in-memory session partition with `setCertificateVerifyProc(null)`; `decideCertificate()` never accepts a certificate for a cloud host.
- **Route:** `OpenApiClient({route: 'cloud', target, tokenProvider, throttle, transport})` prefixes `{serverHost}/v1/cloudaccess/{deviceId}`, reuses every operation and validator, refuses a non-allowlisted target in the constructor. The local route is unchanged.
- **DTO** (`cloud-account-model.ts`): `{omadacId, name, online, version, connectable, reason}`, reasons `notController`, `incompleteEntry`, `unsupportedHost`, `versionUnknown`, `versionTooOld`, `offline` (permanent before transient).
- **IPC:** `cloud:test` (fresh token) and `cloud:controllers` (reuses it) through `handleTrusted()`, no argument, saved credentials only (`notConfigured` otherwise). No session nonce (no local session; must work disconnected); stale replies refused by a credential generation in `CloudAccessService` (`cloud-access.ts`) → `superseded`. Reasoning in `docs/security-audit.md` §7.
- **Redactor:** bare `AT-` / `a1-AT-` / `RT-` / `AK-` token shapes, `client_secret` / `AccessToken=` / `Bearer AK-` forms; live cloud secret and tokens join `storedSecrets()`.
- **Docs:** `docs/omada-cloud-openapi.md` (contract, from the public guide, every unverified detail flagged in §11); `docs/security-audit.md` channel table + §7; a pointer note in `docs/management-design.md` §7.
- **Smoke stub:** `cloud:test` / `cloud:controllers` answer four fixture organizations (local duplicate, offline, below 6.3, connectable) for I-1c; knobs `cloudResult`, `cloudControllers`.
- **TLS probe:** step (e) — the cloud session rejects a self-signed certificate that the pin accepts on a controller session, and the cloud transport refuses 127.0.0.1; plus an e2e `notConfigured` check.

## Acceptance

| Criterion | Met | Evidence |
|---|---|---|
| `npm run build` exits 0 | yes | orchestrator run, after the worker and after the review fixes |
| `npm test` exits 0 with the new fixture tests | yes | 1121/1121 after the worker; 1122/1122 after the review fixes |
| `npm run smoke` exits 0 | yes | 271/271, both times |
| `npm run tls-probe` exits 0 | yes | 29/29, both times |
| New channels in `ipc-surface.test.ts` and `docs/security-audit.md`; `docs/omada-cloud-openapi.md`; `todo.md` §5 | yes | files present, test green |
| No `tplinkcloud.com` API / controller request in tests, smoke or probes; no `ControllerSession` / `ConnectionManager` behavior change; no UI | yes | worker report; the stub and transport refuse all network; only the public documentation guide was fetched by the worker |
| No conflicted copies | yes | `fd -H "conflicted copy"` empty |

## Review

- Codex, `docs/reviews/phaseI-1a.md`, **ship-with-fixes** (1 blocker, 1 should-fix).
- **Blocker** `config-model.ts` — an invalid persisted `cloudRegion` was dropped on its own while the Client ID and blob were kept, so the secret would be sent to the default EUW endpoint. **Fixed:** a region or cloud Client ID that is present but invalid drops the whole credential (region, Client ID, blob); an absent region stays the default. Regression test in `tests/unit/config-cloud.test.ts`.
- **Should-fix** `index.ts` — `cloudAccess.invalidate()` ran only after `connectionManager.applyConfigSave()` awaited a controller transition. **Fixed:** it runs inside the save callback, in the same synchronous step as the write. Not unit-testable without extracting the handler (index.ts is covered only by the probe); comment + doc updated.

## Decisions

- No session nonce on the cloud channels (credential generation instead) — they must work while disconnected from the local controller.
- Remove cloud access as a `config:save` flag rather than a new channel (mirrors `removeManagementAccess`).
- `activeController` and `cloudSites` survive a dropped or changed credential (keyed by omadacIds); I-1b must fall back to local when the active cloud controller has no usable credential.

## Leftovers (none blocking)

- New save error codes `invalidCloudClientId`, `cloudClientIdRequired`, `cloudClientSecretRequired` have no es/en strings yet (generic save error until I-1c; nothing sends cloud fields today).
- The smoke stub's config load does not return the cloud flags yet (I-1c).
- The `config:save` invalidation ordering has no automated regression test.
- Unverified live behaviors: `docs/omada-cloud-openapi.md` §11 (portal page, token error codes beyond `-52602`, OC200 `deviceType`, `orgVersion` format, reported `serverHost`, rate-limit accounting, tunnel v1 / v2 paths and writes, view-only codes).
