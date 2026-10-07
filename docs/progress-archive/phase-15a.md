# Phase 15a — Open API credentials, `OpenApiClient`, central redactor (2026-10-07)

- **Plan item:** `todo.md` 4.8, first half (split recorded there on 2026-10-07: 15a = credentials + client + redactor, 15b = `ControllerSession` + capability detection + "Test management access" + banner inputs). Spec: `docs/management-design.md` §2.1–2.3, §3, §5.
- **Risk:** high. **Workers:** opus (phase), opus (review fixes). Run under `/autoclaude-opus`.

## Acceptance criteria and evidence

| Criterion | Met | Evidence |
|---|---|---|
| Settings "Management access (optional)" section (Client ID, Client Secret) in es and en, matching the read-only banner's pointer | yes | `management-form.ts` + `settings-modal.ts`; smoke `[mgmt]` launch (es + en) |
| Client Secret persisted only as the `safeStorage` blob `encryptedClientSecret`; without secure storage nothing secret is written and the secret is session-only with a visible note | yes | `config-model.ts` unit tests; tls-probe e2e check against the real main with `safeStorage` disabled (only the Client ID on disk) |
| No IPC reply or renderer state carries the secret (`hasClientSecret`, `clientSecretSessionOnly`, `canPersistClientSecret` only) | yes | config-model tests; tls-probe e2e check (reply, `CONFIG_LOAD`, file, logs) |
| URL change and Remove clear the Client ID, the stored blob and the session secret | yes | config-model tests; tls-probe e2e (URL change) |
| `OpenApiClient`: token acquire (URL, body), `AccessToken=` header, proactive expiry, one shared re-acquire + one retry, no loop, pagination + cap, explicit v1/v2, PUT/DELETE, validators | yes | `tests/unit/openapi-client.test.ts` with `tests/fixtures/openapi/*.json` |
| Central redactor: keys deep and case-insensitive, free-text forms; no secret or token in any client error | yes | `tests/unit/redact.test.ts`, `openapi-client.test.ts`, `omada-transport.test.ts` |
| `npm run build`, `npm test`, smoke, tls-probe exit 0; preload `electron`-only; no `innerHTML`/inline styles | yes | see Verification |

## What was built

- **Config** (`config-model.ts`, `config.ts`, `index.ts`, `types.ts`): `clientId` stored in plain config (1–128 `[A-Za-z0-9._-]`); the Client Secret only as `encryptedClientSecret`, through `secureSecretStorageAvailable()` — on Linux it requires the `gnome_libsecret` or `kwallet*` backend (`basic_text`, `unknown`, an unrecognised name, or a missing/throwing backend query mean "cannot persist"); macOS and Windows use `isEncryptionAvailable()` only. Otherwise the secret is held in main memory for the session. A blank secret keeps the existing one only for the same URL and Client ID. Remove (staged in Settings, applied by Save) and a URL change clear the Client ID, the blob and the session secret. The `CONFIG_SAVE` payload guard now rejects unknown keys. The password keeps its old rule (documented plaintext fallback), unchanged.
- **Settings UI** (`management-form.ts`, `settings-modal.ts`, `index.html`, `styles.css`, `i18n.ts`): "Acceso de gestión (opcional)" / "Management access (optional)" with Client ID, Client Secret ("(unchanged)" placeholder and the "(required for the new URL / Client ID)" variants), a generic help line, the session-only note plus an info toast after such a save, Remove with an inline confirmation and undo. 16 new i18n keys (es/en).
- **Redactor** (`redact.ts`): `redactValue()` for structured data (keys `password`, `client_secret`/`clientSecret`, `securityKey`, `psk`, `authorization`, `cookie`/`set-cookie`, `csrf`/`Csrf-Token`, access/refresh tokens, `token`; deep, case-insensitive) and free-text redaction (`AccessToken=`, `Bearer`, query parameters, `key=value` unquoted / single- / double-quoted / escaped / unterminated, JSON-ish pairs, header lines, `TPOMADA_SESSIONID`, known secret values). The transport redacts the whole error body before cutting the 200-char excerpt.
- **`OpenApiClient`** (`openapi-client.ts`): Electron-free over the injected transport (now GET/POST/PATCH/PUT/DELETE with custom headers). Client-credentials token (`POST /openapi/authorize/token?grant_type=client_credentials`, body `{omadacId, client_id, client_secret}`), memory only, secret in a private closure; proactive renewal before expiry; on a rejected token one shared re-acquire and one retry; explicit `'v1' | 'v2'` path builder; pagination with a 50-page cap and dedupe; `listSites()` and `listApGroups()` (keeps `apNum`, `ssidNameList`, `remainingBinding`); typed errors with stable codes and redacted diagnostics. Not yet called by the connect flow (15b).

## Decisions

- Client ID cleared on a URL change too: an Open API application is created per controller.
- Remove is staged and applied by Save, so no new IPC channel was needed.
- The `CONFIG_SAVE` guard became strict (unknown keys refused) — stricter than the previous pattern, deliberately.
- A blob written earlier under an insecure Linux backend is ignored (not used or reported) while storage is insecure, but kept on disk so a temporarily missing keyring does not destroy a good blob. Such a blob cannot be told apart from a good one later; no released build ever stored the secret, so this is documented in a comment, not handled.

## Deviations

- The smoke gained a 4th launch (`[mgmt]`), so `EXPECTED_LAUNCHES` went 3 → 4; no existing smoke assertion changed.
- The redactor now also removes a URL fragment right after a secret (`access_token=X#frag`); one existing test expecting `#frag` to survive was updated.

## Unverified (for the phase 20 live checklist)

- Token endpoint and reply shape; `expiresIn` (default 300 s when absent).
- Error codes: -44112 / -44113 (+ HTTP 401) treated as token rejected, -44106 as bad Client ID or Secret — taken from TP-Link's published Open API guide, not from this controller.
- Client ID format (1–128 `[A-Za-z0-9._-]`).

## Review

- Codex, `docs/reviews/phase15a.md` (brief `docs/reviews/phase15a.brief.md`): **ship-with-fixes**, 2 blockers, 0 should-fix.
  1. Linux `basic_text` backend treated as secure persistence → fixed: `secureSecretStorageAvailable()` (see Config above), unit-tested across platforms and backends.
  2. Quoted `key=value` secrets passed through the redactor → fixed: quoted, escaped and unterminated value rules, unquoted values consumed to the next delimiter, redaction before truncation in the transport; 14 new tests incl. a secret straddling the 200-char cut.
- Both fixed by an opus worker; the orchestrator re-ran build, tests, smoke and probe, all exit 0.

## Verification (orchestrator, after the review fixes)

- `npm run build` — exit 0
- `node scripts/run-unit-tests.mjs` (= `npm test`) — 530/530 pass
- `ELECTRON_PATH=/private/tmp/omada-p10-smoke/electron/Electron.app/Contents/MacOS/Electron npm run smoke` — 133/133
- `ELECTRON_PATH=… npm run tls-probe` — 22/22
- `rg -n "require\(" dist/main/preload.js` — only `electron`; `rg -n "innerHTML|insertAdjacentHTML|\.style\." src/renderer` — no hits; `fd -H "conflicted copy"` — none

## Leftovers (none blocking)

- The Linux backend check is unit-tested only (no real-app probe on Linux).
- Redactor gaps documented in `redact.ts`: a JSON key whose own quotes are escaped inside a JSON string, and an array of plain values under a sensitive JSON key in free text (`redactValue()` covers both for structured data).
