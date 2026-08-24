# Codex review — Phase 3 aggregate (2026-08-24)

Scope: working-tree diff for todo.md items 2.1, 2.4, 2.5, 1.14-final, 2.7, 3.6 (`src/main/config.ts` rewrite, `src/main/index.ts`, `src/main/preload.ts`, `src/renderer/renderer.ts`, `src/shared/types.ts`).

Verdict: **not safe to commit yet** — legacy plaintext credentials could remain in an inadequately protected file when encryption is unavailable.

## Findings

- **[HIGH]** `src/main/config.ts:133` — When `safeStorage` is unavailable, legacy migration returns without rewriting or chmodding the old config. An existing plaintext password may remain in a mode such as `0644` (from the previous implementation's default umask); `writeConfigFile()` only corrected directory permissions when creating a new directory, not for an existing one. Needs `0700` applied to the existing config directory and `0600` to the retained legacy file.

- **[LOW]** `src/main/config.ts:193` — A corrupt or no-longer-decryptable blob still reported `hasPassword: true`, while connection silently converted the decryption failure into an empty password ("incomplete configuration"). Subsequent blank-password saves then retained the unusable blob. Suggested distinguishing "stored password cannot be decrypted" so the UI asks for a replacement.

## Checks that passed

No other findings: no password-leakage paths to the renderer, migration cannot lose or double-encrypt a password, config cache is coherent across save/TLS/auto-connect, atomic writes apply the intended modes, renderer/main URL validation agrees.

## Resolution

Both findings fixed by the orchestrator before commit:

- New best-effort `tightenPermissions()` helper: the unavailable-encryption migration branch now chmods the config dir to `0o700` and the retained plaintext file to `0o600`; `writeConfigFile()` also tightens an existing directory's mode on every write.
- `getRendererConfig().hasPassword` now tests actual decryptability (`getDecryptedPassword(config) !== ''`), and `saveConfig()`'s keep-existing branch rejects with `passwordRequired` when the stored password cannot be produced — a corrupt blob can no longer be silently retained; the settings dialog naturally asks for a new password.

Re-verified: `npm run build` exit 0.
