# Phase I-1b1 — Open-API-only cloud controller session (2026-10-07)

- **Plan:** inbox item I-1 part B, first half (spec `autoclaude/processed/10-tplink-cloud-controllers.md`; plan record `todo.md` §5, "Done (I-1b1)" holds the full "how").
- **Risk:** high. **Workers:** opus (phase, one iteration); opus (the two review fixes, the next iteration).
- **Run:** `/autoclaude-opus`, driven. The phase code committed as `5aba471` with its review fixes owed (the iteration hit the context hard mark); the fixes committed in the follow-up phase-close commit.

## What was built

- **Backend split:** `ControllerSession` (`controller-session.ts`) runs on a data-side `ControllerBackend`. `LocalControllerBackend` is the former internal-client code, moved as is; `CloudControllerBackend` (`src/main/cloud-controller-session.ts`) is new. The capability checks and every AP-group, network and binding read / write, with their policy on fresh data, stay one code path; the backend supplies only check 2 (the access) and check 5 (the internal ids: none for a cloud controller).
- **Construction:** `new ControllerSession({kind: 'cloud', omadacId, name, orgVersion, createOpenApiClient, sleep?})`. A factory of cloud-route clients is injected: one data client per connect, one management client per check run, sharing the account token. `close()` drops the management clients only; the data client serves until `logout()` (the `ManagedController` contract). A cloud session's `url` is `''` — tell kinds apart with `kind` / `controllerName`.
- **Cloud data side:** sites from `GET …/sites` through the shared `pickSite()`; APs from `ap-groups/aps` (`OpenApiClient.listApGroupAps()`, paged; an unreported field stays unknown: status -1, no client count, no `wlanId`, `''` group name; `Gateway` / `Switch` rows dropped); groups from `ap-groups` with Open API ids, SSID names, default flag and per-band capacity; version / group model from `orgVersion` (below 6.3 or not dotted → `versionTooOld` / `versionUnknown` before any request).
- **Moves:** `OpenApiClient.setApWlanGroup()` → `PATCH …/aps/{apMac}/wlan-group` `{wlanGroupId}` after `MAC_REGEX` / `WLAN_ID_REGEX` (moved to `ipc-guards.ts`); then up to 3 re-reads 1 s apart, `true` only when a re-read lists the AP in the destination, otherwise `moveRequestFailed` / `moveNotConfirmed` / `moveUnverified`.
- **Errors:** `CloudSessionError` {`code`, `diagnostic`, `openApiCode`}, 10 codes with es / en `cloudSessionError…` strings (not shown by any renderer code yet). On the cloud route a refusal keeps TP-Link's message (`controllerMessage`), redacted and scrubbed.
- **Shared types (optional, renderer unchanged):** `AccessPoint.wlanId`, `WlanGroup.remainingBinding`, `WlanGroup.ssidListUnknown`.
- Not wired into `ConnectionManager` or IPC (I-1b2).

## Acceptance

| Criterion | Met | Evidence |
|---|---|---|
| `npm run build` exits 0 | yes | after the phase; again after the review fixes (orchestrator) |
| `npm test` exits 0 with the cloud-session fixture tests | yes | 1153/1153 after the phase (31 new tests in `tests/unit/cloud-controller-session.test.ts` on `tests/fixtures/cloud/controller-tunnel.json`); 1156/1156 after the fixes |
| `npm run smoke` exits 0 | yes | 271/271, both times |
| `npm run tls-probe` exits 0 | yes | 29/29, both times |
| Local session behavior unchanged | yes | every pre-existing local test green |
| No controller / `tplinkcloud.com` request (D4) | yes | fixtures and injected transports only |
| No conflicted copies | yes | `fd -H "conflicted copy"` empty |

## Review

- Codex, `docs/reviews/phaseI-1b1.md`, **ship-with-fixes** (1 blocker, 2 should-fix).
- **Blocker** `cloud-controller-session.ts` `connect()` — a truncated `listSites()` only warned, so `pickSite()` could auto-select the one site of a partial list. **Fixed:** `listIncomplete` is thrown before the empty check and the pick (a truncated empty list is now `listIncomplete`, not `noSites`); test covers one site with page 2 missing, the remembered-site case and the empty case, and asserts no site-scoped request.
- **Should-fix** `openapi-client.ts` `#scrub()` — cloud diagnostics could carry the routing identifiers. **Fixed:** on the cloud route the tunnel base URL, serverHost origin, bare host and deviceId are by-value scrub values (longest first); the local route scrubs none. Tests in `tests/unit/openapi-cloud-route.test.ts` (refusal 200 / 403, network failure, local unchanged).
- **Should-fix** `cloud-controller-session.ts` mapper — `ssidList: []` + `ssidListUnknown: true` is read as "no networks" by today's consumers. **Carried into I-1b2's acceptance** (`todo.md` §5): before the cloud session is installable, those consumers must honor `ssidListUnknown` or the mapper fails closed. Consumers (worker survey): `move-plan.ts` `networkNames()` / `planMove()` / `matchesDestinationSearch()` / `partitionDestinations()`; `inventory-model.ts` `broadcasts()` (→ `apBroadcasts()`, `networkBroadcasters()`) and `networkNames()` (→ `buildGroupRows()`, `buildNetworkRows()`, `describeApDetails()`); `ap-selection.ts` `countDistinctSsids()`, `networkCountFor()`; `destination-pane.ts` `createDestinationOption()`, `buildPreview()`; `move-dialog.ts` `reviewRows()`; `networks-view.ts` `networkItemLabel()`. Main builds `ssidList` from local data only in `omada-validators.ts`.
- The docs the fixes made stale were updated: `docs/omada-cloud-openapi.md` §6 (scrub sentence) and §12 (sites row).

## Leftovers (none blocking)

- The renderer shows an AP with no reported group name as "Unassigned" (should be unknown — I-1c).
- `applyMovedGroup()` keeps a stale `wlanId` until the reload; no renderer code reads it yet.
- Live unknowns: `docs/omada-cloud-openapi.md` §11 items 8–12 (`ap-groups/aps` fields and `deviceType` through the tunnel, the move PATCH and its re-read latency, view-only write answers, rate limit during bulk moves, the tunnel's site-id format).
