# Codex review — Phase 1 aggregate (2026-08-24)

Scope: working-tree diff for todo.md items 1.1, 1.4, 1.5, 1.12, 1.13, 1.14 (minimal), 1.15, 3.9.

## Finding

- **[P1] Normal connection failures bypass full cleanup** — `src/renderer/renderer.ts:500`

  When `omadaAPI.connect()` resolves with `{ success: false }`, the branch only changes status and calls `showEmptyStates()`. It does not call `clearData()` or `disconnect()`.

  This matters when reconnecting after saving settings while already connected: previous AP/WLAN arrays and selections remain, and Apply can remain enabled despite the error. Additionally, the main process assigns `omadaController` before attempting login at `src/main/index.ts:132`, so a failed login leaves that controller object retained.

  The `{ success: false }` branch should perform the same data reset and IPC disconnect as the exception path.

## Verdict

**Not safe to commit yet** because item 1.13 is incomplete.

The remaining reviewed changes look correct:

- Confirm, Cancel, and Escape resolve each confirmation once and remove all associated listeners.
- `will-navigate` correctly checks `file:`.
- Malformed status URLs are handled.
- Explicit disconnect awaits IPC and clears UI in `finally`.
- Blank-password handling and the new Spanish/English translations are complete.
- `loadFile()` failures are caught and surfaced.
- Dead `currentServerUrl` state is removed.
- Renderer contains no `import`/`export`.
- TypeScript checking and `git diff --check` pass.

## Resolution

The P1 finding was fixed before commit: the `{ success: false }` branch in `connect()` now calls `clearData()` and awaits `window.omadaAPI.disconnect()` (same cleanup as the exception path). Build re-verified (exit 0). The related note about `omadaController` being assigned before login in `index.ts` is addressed by the renderer now always releasing the controller on failure; full serialization of connection attempts is scheduled as todo.md item 3.12 (phase 7).
