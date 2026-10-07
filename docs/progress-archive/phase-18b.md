# Phase 18b — Wi-Fi network editing UI (2026-10-07)

- **Plan item:** `todo.md` 4.11, second half (18a = main-side writes + IPC, 18b = renderer). The detailed "how" is `todo.md` 4.11 "Done (18b)", incl. its "Review fixes" paragraph.
- **Risk:** high. **Workers:** opus (phase), opus (review fixes). Run under `/autoclaude-opus` (driven).
- **Commit:** see `PROGRESS.md` → Git state.

## What was built

- **Actions** only while `networkManagementOn()` holds, so they are hidden while management is off, a capability check runs, on legacy controllers and with a read-only reason. **New network** sits above the list. The detail gets the actions of the pure `networkActions()` (`network-editing.ts`):
  - **Edit**: Open and WPA-Personal only.
  - **Change password**: WPA-Personal only.
  - **Enable / Disable**: every security mode, but only while the enabled state is known (spec §5); otherwise a note says why it is missing.
  - **Delete**: every security mode.
  - An Enterprise, PPSK or unknown-security network gets no Edit or Change password, plus a note naming its mode.
- **Dialog** `network-dialog.ts`: one static `#networkModal` whose form is built with DOM APIs each time it opens. It keeps the `modal-focus.ts` trap and an inert background; Escape cancels; confirmations open with focus on Cancel.
- **Flows** `network-flow.ts`: one exclusive operation (`state.isManagingNetwork`, part of `isOperationInProgress()`). Each write goes through these steps:
  1. A client-side check that mirrors 18a's rules.
  2. A re-check of `isNetworkManagementOn()` that fails closed.
  3. One guarded write carrying the session nonce.
  4. Main's answer shown as text, with its codes-only diagnostic.
  5. On success: reload the data, then the capabilities and the managed list (`applyCapabilities()` now also awaits the network list), then a toast and focus.
- **New network:**
  - Fields: name, Open / WPA-Personal, the passphrase typed twice, bands, and the AP groups to bind (at least one).
  - The network is created **disabled**. "Enable after creating" sends a second write, and only with the id main returned.
  - An open network with 6 GHz is explained up front; main refuses it as `securityBandConflict`.
- **Edit** (staged): name, Open ↔ WPA-Personal and bands.
  - "Review changes" lists each change as before → after, plus notes. It includes a PMF note, stated as a possibility: "Mandatory" may be lowered to "Capable".
  - Back keeps the form. Cancel or Escape discards the edit and sends nothing.
  - Save sends one `updateNetwork()` with only the edited fields.
  - Every save whose result is WPA-Personal needs the re-typed passphrase.
- **Change password**: its own dialog with two empty password fields.
- **Enable / Disable / Delete**: a confirmation with an impact summary from `impactRows()`.
  - The scope: "All access points", "N groups · M APs" or "Unknown scope".
  - The bound groups by name.
  - A note for "All access points" and one for an unknown scope.
- **Passphrase hygiene:**
  - The fields are `type="password"` with `autocomplete="new-password"`, never prefilled, and read only right before a check or a write.
  - They are emptied when hidden, after a successful write and when the dialog closes, and are removed from the DOM with the form.
  - The passphrase never appears in a toast, a log line, the state or a pure-module return value.
- **Texts:** every `NetworkOperationError`, plus the renderer's own `passphraseMismatch` and `failed`, in es and en (99 keys). The string tables moved to the new DOM-free `i18n-strings.ts`, so unit tests can check them. The scope text is now built by the pure `scopeSummaryText()`.

## Acceptance (met)

- `npm run build`: exit 0.
- `npm test`: 897/897 after the phase and 903/903 after the review fixes (858 before).
- Smoke: 213/213 after the phase and 219/219 after the fixes, from a new 8th launch `[netedit]` run in es and then en.
  - It covers: actions per security mode, actions hidden during a re-check and with management off, and create with and without "Enable after creating" (plus an answer without an id).
  - Also: a `nameTaken` refusal shown with its diagnostic, edit → review → Back → Save, and an edit cancelled from the review and by Escape (nothing in `networkWrites`).
  - Also: Change password, the Disable and Enable confirmations with their impact, a `securityBandConflict` naming Enhanced IoT Connectivity, and Delete with its impact.
  - Finally, no sentinel passphrase is in the DOM or in any input value after any dialog closes.
- TLS probe: 25/25.
- No `innerHTML`; the compiled preload requires only `electron`; no conflicted copies.

## Decisions and deviations

- Edit is a two-step dialog, not an in-view edit mode. The 14b `escapeAction()` edit-mode stub stays unused; phase 19's binding editor may use it.
- `applyCapabilities()` now also waits for the managed network list, so the 16b AP-group post-write reload waits for it too.
- When the enabled state is unknown, Enable / Disable is hidden and a note says why.
- The `[nets]` launch's "no edit control" check now expects exactly New network, plus Delete and two notes on the Enterprise / PPSK network.
- No main-side change.

## Review — Codex, `docs/reviews/phase18b.md`, ship-with-fixes

- **Blocker:** Delete, and other writes, could act on a known-stale snapshot, so a confirmation could understate the impact. Fixed as follows:
  - The pure `networkWriteBlock()` holds every network write back while the internal data is stale (`refreshError`), the managed list's last read failed, or a read is running or has not run yet. The actions then render disabled with the reason.
  - A flow that starts anyway refuses with a toast.
  - `guardedWrite()` re-checks the block right before writing, together with `sameManagedNetwork()`. If the network changed on the managed list, the new renderer-only code `networkChanged` refuses the write.
  - Enable, Disable and Delete first re-read the data and the managed list (`rereadForConfirmation()`), so the impact summary is built from fresh data.
  - Four new es/en messages.
- **Should-fix:** a double-click on "Review changes" could save without a review. Fixed: the confirming button ignores clicks with `event.detail > 1`, and the repeats of a held Enter key are swallowed while the dialog is open.
- Each fix has tests, unit and smoke (including a real Playwright `dblclick`), and the worker checked that every one fails when its part of the fix is reverted. The orchestrator then re-ran build, tests (903), smoke (219) and probe (25), all exit 0.

## Leftovers for the phase 20 live checklist

- Whether the controller really lowers PMF "Mandatory" to "Capable" on a band change, as the note warns, and which combinations it accepts.
- That a created network appears disabled and is enabled by the follow-up `enable` call with the id main reported, and how often `result.id` is missing.
- Which duplicate-name rule the controller applies (`nameTaken`).
- That disabling or deleting a network disconnects only the clients on its own scope.
- How an Enterprise or PPSK network behaves when enabled, disabled or deleted from the app.
- (UI) A click made while a background re-read runs is refused with a toast rather than disabling the buttons at the start of every re-read, which would make them flicker and lose focus. The smoke double-click check pins the dialog's size so both clicks land on the button.
