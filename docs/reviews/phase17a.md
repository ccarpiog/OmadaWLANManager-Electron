Reviewer: codex adversarial review

Codex adversarial review of the working tree at /Users/ccarpio/Dropbox/AA_Trabajo/InformáticaHispanoInglés/Nuevo/Development/Varios/omada-electron.
Codex verdict: needs-attention. 2 finding(s): 1 blocker(s), 1 should-fix.

Do not ship yet: the read can silently return an incomplete catalog, and malformed AP-group identifiers are treated as a known scope.

- [BLOCKER] high · confidence 0.98 — src/main/openapi-client.ts:730 — Short pages can silently bypass completeness checks and the 128-network cap
    `listAll()` stops whenever a page contains fewer than `pageSize` entries, even when `totalRows` explicitly says more entries exist. For example, a response with `totalRows: 150` an…
    Fix: When a sane `totalRows` is present, continue until the raw fetched count reaches it. If a page is empty/short before that point, totals chan…
- [SHOULD-FIX] medium · confidence 0.99 — src/main/wifi-network-model.ts:58 — Malformed AP-group IDs are accepted as authoritative bindings
    The comment states controller object IDs are 24 hex digits, but `NETWORK_ID_REGEX` accepts any 1–128-character alphanumeric, underscore, or hyphen string. Because `readIdList()` an…
    Fix: Use separate validators for SSID IDs and AP-group IDs. Validate bound AP-group IDs with the existing 24-hex rule (and, if required by the de…

Scope: the working tree only — anything already committed for this phase was outside it.

VERDICT: ship-with-fixes
BLOCKERS: src/main/openapi-client.ts:730 — Short pages can silently bypass completeness checks and the 128-network cap — When a sane `totalRows` is present, continue until the raw fetched count reaches it. If a page is empty/short before that point, totals chan…
SHOULD-FIX: src/main/wifi-network-model.ts:58 — Malformed AP-group IDs are accepted as authoritative bindings — Use separate validators for SSID IDs and AP-group IDs. Validate bound AP-group IDs with the existing 24-hex rule (and, if required by the de…
NOT-VERIFIED: Fix and test pagination completeness against contradictory or controller-capped page responses.
NOT-VERIFIED: Tighten AP-group binding ID validation and add fail-closed scope tests.
