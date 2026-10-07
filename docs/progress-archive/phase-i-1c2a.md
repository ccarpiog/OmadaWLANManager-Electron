# Phase I-1c2a — switcher data, cloud-only save and Settings note (2026-10-07)

- **Risk:** high. **Worker:** opus (phase; the same worker, resumed, for the review fix).
- **Split:** I-1c2 was split into I-1c2a / I-1c2b before starting (recorded in `todo.md` §5 "I-1c"): I-1c2a = main + pure models + Settings + stub; I-1c2b = the switcher UI, state reset, header name, cloud error states, "Connect through TP-Link cloud", the renderer `init()` cloud-only start and the `[cloud]` smoke launch.
- **How:** `todo.md` §5 "Done (I-1c2a)" holds the full description (`localOmadacId` in the cloud replies, `config:load` `connectionTarget`, the cloud-only save and its shared shape guard, startup, the typed unreachable rule, the unknown AP group, the pure switcher model, strings, the Settings certificate note, the smoke stub, tests) and the exact calls for I-1c2b ("For I-1c2b").

## Acceptance

| Criterion | Met | Evidence |
|---|---|---|
| `localOmadacId` reaches the renderer through a guarded reply; malformed → absent; Settings' Test result handles the local duplicate | yes | `cloud-access.test.ts`, `renderer-cloud-form.test.ts` (`parseLocalOmadacId()`); smoke `[cloudset]` "Esta red" / "This network" mark |
| Cloud-only save through `config:save`; partial local sections fail as before; local rules unchanged; renderer mirror agrees | yes | `config-cloud.test.ts`, `ipc-guards.test.ts`; `renderer-cloud-form.test.ts` mirror vs `applyConfigSave()` over a 192-case matrix; smoke cloud-only save with its refusals |
| Startup target for a cloud-only config correct and tested | yes | `connection-targets.test.ts` (no code change needed) |
| Pure switcher model, "Connect through TP-Link cloud" decision, busy predicate | yes | new `tests/unit/renderer-controller-switcher.test.ts` |
| es / en strings for every new text | yes | parity tests in the new suites |
| Settings cloud certificate note (es / en) | yes | smoke `[cloudset]` note hidden / shown |
| Unknown AP group on cloud data, local rendering unchanged | yes | `renderer-ap-selection` / `-inventory-model` / `-move-plan` tests |
| Smoke stub honors the `cloudAccess` flags and carries `localOmadacId`; user's hunks intact | yes | smoke `[es]` cloud channels; `git diff` shows the user's `window-placement.cjs` lines unchanged |
| `unreachable: true` only when the controller never answered (review fix) | yes | stage tests in `connection-manager.test.ts` / `connection-targets.test.ts` / `omada-transport.test.ts` |
| `npm run build` exit 0 | yes | orchestrator, after the review fix |
| `npm test` all pass | yes | 1344/1344 (was 1280) |
| `npm run smoke` all pass | yes | 295/295 (was 291) |
| `npm run tls-probe` all pass | yes | 29/29 |
| No conflicted copies; no controller / `tplinkcloud.com` contact | yes | `fd -H "conflicted copy"` empty; fixtures and stub only |

## Decisions

- **`localOmadacId` travels in the successful `cloud:test` / `cloud:controllers` replies**, not `config:load`: the switcher needs it beside the list it filters. Never in a failure reply or a diagnostic.
- **Settings marks the local duplicate "This network"** rather than hiding it (Settings is a credential test; the switcher hides it).
- **`config:load` reports `connectionTarget`** (main's current target), because the stored `activeController` can differ after a startup fallback.
- **Management fields in a cloud-only save are refused** with the new code `managementNeedsController` (an Open API application belongs to a local controller; silently dropping a typed secret would hide the mistake). A removal is accepted and changes nothing.
- **A cloud-only save neither sets `hasStoredConfig` nor auto-connects**; I-1c2b decides the start flow.
- **The config-save shape guard moved to `ipc-guards.ts`** (`isValidConfigSavePayload()`), shared by `index.ts`, the unit tests and the smoke stub.
- **Unreachable is typed, not text-matched** (review fix): `TransportError` (`kind`, `netError`, `responded`), `OmadaController.connect()` sets `connectUnreachable` only when `/api/info` failed before any response; certificate results keep precedence; cloud sessions always report false.

## Review

- Codex, `docs/reviews/phaseI-1c2a.md`, **ship-with-fixes**, 0 blockers.
- Should-fix (`src/main/connection-manager.ts`: `unreachable` inferred from the failure text of the whole connect sequence, so a timeout or reset during login or the site list counted as "never answered") → **fixed** by the worker (resumed): typed first-request rule above, old `isUnreachableFailure()` removed, stage regression tests. Build, `npm test` 1344/1344, smoke 295/295 and tls-probe 29/29 re-run by the orchestrator after the fix.

## Leftovers (for I-1c2b, none blocking)

- The switcher UI, state reset, header name, cloud error states, "Connect through TP-Link cloud", the `init()` cloud-only start (including after a cloud-only save) and the `[cloud]` smoke launch — exact calls in `todo.md` §5 "For I-1c2b".
- A cloud-only save leaves main's target on the unconfigured local controller unless a cloud controller is stored; I-1c2b's `init()` must read `connectionTarget` and fetch the cloud list.
