# Review brief — phase I-1b2a (renderer honors `ssidListUnknown`)

- **Repo:** current working directory (Omada WLAN Manager, Electron + TypeScript). Review the **uncommitted** tree.
- **Review file:** `docs/reviews/phaseI-1b2a.md`
- **Time budget:** 10 minutes.

## Goal

Phase I-1b1 added a cloud controller session whose AP-group mapper emits `ssidList: []` + `ssidListUnknown: true`
when the cloud API does not report a group's SSID names (`src/main/cloud-controller-session.ts`; optional field on
`WlanGroup` in `src/shared/`). Its review found that renderer consumers read that as "this group broadcasts no
networks". This phase makes every renderer consumer treat such a group's network list as **unknown** (fail-closed):
no definitive "0 networks", no reach diff (networks gained / lost) in the move preview / review for an AP whose source
or destination group is unknown, no network or broadcaster count presented as exact when an unknown group is
involved. es / en text for the unknown states. Local data never sets the flag, so local behavior must be identical.
The cloud session is not wired yet (phase I-1b2b).

Worker choices to scrutinize: combined counts are shown as a lower bound ("at least N", or "unknown" when nothing is
known; sidebar badge "N+"); an unknown group matches destination search only by its own name; a network that only an
unknown group might broadcast is not listed; an AP in a shared-name group reads "unknown" if either group is unknown;
the AP-group Delete check treats an unknown network count as unknown rather than 0.

## Changed files (`git diff --stat`; ignore `PROGRESS.*`, `todo.md` is the plan record)

`src/renderer/{move-plan,move-text,move-dialog,destination-pane,inventory-model,inventory-ui,ap-selection,ap-list,ap-details,groups-view,networks-view,managed-networks-view,group-management,shell,i18n-strings}.ts`;
tests `tests/unit/renderer-{move-plan,inventory-model,ap-selection,group-management}.test.ts`.

**Not part of this phase — ignore:** `tests/smoke/stub-main.cjs`, `tests/tls-probe/app-main.cjs`,
`tests/smoke/window-placement.cjs` (the user's own uncommitted edits).

## Verification run (orchestrator)

- `npm run build` → exit 0
- `npm test` → exit 0, 1180/1180 (was 1156)
- `ELECTRON_PATH=… npm run smoke` → exit 0, 271/271 (no smoke edits)
- `fd -H "conflicted copy"` → empty

## Risks to check

1. **Local behavior drift:** with no group flagged, does every changed function return exactly what it returned
   before (texts, counts, ordering, the move plan's diff and warnings, the "Silence" / empty-group warnings)?
2. **Remaining consumers:** any place in `src/renderer/` still deriving "0 networks", an empty / "no change" reach
   diff, or an exact count from a flagged group (`rg ssidList src/renderer`) — including the Broadcast-on editor,
   managed networks view, Delete rules, and Back-navigation.
3. **Move review safety:** a mixed selection (known + unknown groups) must keep the known APs' diffs and flag the
   unknown ones; a destination that is unknown must not show the empty-group warning as if certain, nor claim "no
   networks lost".
4. **Lower-bound arithmetic:** "at least N" must never overstate (N must be a true lower bound — e.g. deduplication
   of SSIDs across known groups) and must not be shown where a value is exact.
5. **i18n:** every new key present in both es and en, with interpolation placeholders matching.
