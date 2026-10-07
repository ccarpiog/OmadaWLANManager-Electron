# Phase 19a — SSID ↔ AP-group binding write in main (2026-10-07)

- **Plan item:** `todo.md` 4.12, first half (split recorded there as "Split (2026-10-07)"); the detailed "how" and the phase 20 live checks are in 4.12 "Done (19a)".
- **Risk:** high. **Workers:** opus (phase), opus (review fixes). Run under `/autoclaude-opus`.

## What was built

- `OpenApiClient.updateSsidApGroups()` — `PATCH /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}/ap-groups` with exactly `{apGroupIds}` (the body the ops doc documents), same token / retry / error handling as the other v1 writes.
- New pure `src/main/network-binding-plan.ts` — input check (deduplicated 24-hex ids via `isApGroupId()`, at least one group), ids must be in the fresh AP-group list, added / removed diff, an identical request refused (`nothingToChange`), per-band capacity for every ADDED group on every band the network uses (unknown fails closed), every failing group + band returned in a structured `capacityProblems` list. Removed groups are not checked.
- `ControllerSession.updateNetworkBindings()` / `#updateBindings()` — gated like the 18a writes; inside the shared serialized write queue with the management epoch it re-reads the SSID catalog (complete, ≤ 128, must list the target), the write-detail and bindings, then the AP-group list, and derives scope, bands and bound ids through the read model's own `toManagedNetwork()`, so catalog / detail disagreement → `scopeUnknown`. "All access points" (`chooseDevices` 0) → `scopeAllAccessPoints`. Refusals happen before any PATCH; `superseded` on invalidation, queued or in flight. Enterprise / PPSK may be bound (D3).
- MLO: `mloEnable` from the fresh detail is carried into the binding facts. Absent / null / non-boolean → `networkStateUnknown` when groups are added (the create and edit schemas require the field, and 18a already refuses a detail without it). MLO on → every added group gets an `mlo` entry in `capacityProblems` unless a known MLO remaining value > 0 exists; no MLO `remainingBinding` key is documented, so `MLO_REMAINING_BINDING_KEY = null` and **an MLO network cannot gain any group until phase 20 confirms a key**. `NetworkCapacityProblem.band` is `NetworkBand | 'mlo'`.
- Error type `NetworkBindingsError` (separate from `NetworkOperationError`, so the 18b code → text table is untouched): new `scopeAllAccessPoints`, `scopeUnknown`, `capacityInsufficient`, `networkListIncomplete`, `networkNotFound`, plus reused `groupsRequired`, `nothingToChange`, `groupNotFound`, `groupListIncomplete`, `networkStateUnknown`, `requestFailed` and the session codes.
- Guarded IPC `management:network-bindings` (session nonce, SSID id, ≤ 256 deduplicated 24-hex ids, unknown keys refused, same sender checks as the other management channels) + preload `updateNetworkBindings()`.
- Smoke stub: the channel applies the change to the fake controller (bindings, groups' SSID lists, `remainingBinding`), mirrors main's refusals (an unknown network answers `networkNotFound`), scripted answers through the existing `networkResults` knob under the new key, writes recorded in `networkWrites` as `op: 'bindings'`. One new smoke check drives the preload method.
- Fixture `tests/fixtures/openapi/ssid-bindings.json`; tests `tests/unit/network-binding-plan.test.ts`, `tests/unit/network-bindings-session.test.ts`, additions to `openapi-client.test.ts` and `ipc-guards.test.ts`.

## Acceptance (met)

- `npm run build` exit 0; `npm test` 956/956 (was 903); `ELECTRON_PATH=… npm run smoke` 220/220; `ELECTRON_PATH=… npm run tls-probe` 25/25; compiled preload requires only `electron`; no conflicted copies.
- Covered: plan / capacity / diff (every failing group + band, unknown capacity fails closed, dedupe, ids absent from the fresh list); exact PATCH method, path and body; refusals before any request; fresh data contradicting the renderer; superseding paths (queued and in flight); no PATCH for All-access-points, unknown-scope, catalog / detail disagreement, target missing from or incomplete catalog; MLO with room / without room / unknown, `mloEnable` malformed and absent; IPC guard shapes.
- Revert checks done by the workers (each new safety test failed when its guard was broken): scope rule, fresh-list check, identical-request check, capacity first-only and unknown-as-room, check order, queue, epoch, scope without the catalog, no catalog read, catalog read outside the queue, MLO-state refusal, MLO capacity, `mloEnable` not passed. Two redundant "late answer" checks cannot be caught by a test because every invalidation also closes the client (same as 18a).

## Review

- Codex, `docs/reviews/phase19a.md`, **ship-with-fixes**, 1 blocker + 1 should-fix:
  - BLOCKER — catalog / detail disagreement bypassed the unknown-scope guard (the write re-read only detail + bindings) → the catalog is re-read inside the serialized operation and scope comes from `toManagedNetwork()`; fixed by an opus worker with tests that fail on revert.
  - SHOULD-FIX — MLO networks bypassed capacity validation → `mloEnable` carried and checked fail-closed as above; fixed by the same worker.
- Orchestrator re-ran build, tests, smoke and probe after the fixes: all green.

## Leftovers for 19b / phase 20 (none blocking)

- 19b must map the `NetworkBindingsError` codes and `capacityProblems` (incl. band `mlo`) to es / en text, and should not offer adding groups to an MLO network while the MLO key is unknown (main refuses anyway).
- Phase 20 live checks (full list in `todo.md` 4.12 "Done (19a)"): whether the PATCH replaces or merges the bindings; whether the network stays on "selected AP groups"; the error code for a full group; whether `remainingBinding` has an MLO key and MLO needs its own slot; whether the catalog and detail agree on scope for every real network.
- An unknown MLO state or unknown bands only refuse additions; a removal-only change still goes through.
