# TODO — Omada WLAN Manager (Electron)

Findings from a full code review (Claude + Codex second opinion, 2026-08-24).
Codex independently confirmed items 1.1–1.3, 1.6, 1.9, 1.11, 2.1–2.3, 3.3 and 3.6; items 1.12–1.15, 2.5–2.7, 3.12–3.15 come from the Codex review.

Legend: 🔴 bug (misbehaves today) · 🟡 robustness/security gap · 🟢 improvement

---

## 1. Bugs

### ✅ 1.1 Escape key on the confirm modal leaks the promise → possible double-apply
- **Where:** `src/renderer/renderer.ts` — `showConfirm()` (~line 612) and the global `keydown` handler (~line 714).
- **What:** Pressing Escape while the confirm modal is open hides it with `confirmModal.classList.remove('visible')` directly, without resolving the promise created by `showConfirm()` and without removing its click listeners. `applyChange()` stays awaiting forever, and the stale Confirm/Cancel listeners remain attached. The next time the modal is used, one click fires both the old and the new handlers, so the old `applyChange()` resumes too — the WLAN assignment can be applied twice (or a previously cancelled change gets applied).
- **Fix:** Give `showConfirm()` a single `finish(result)` function that hides the modal, removes **all** listeners (including its own Escape listener) and resolves exactly once. The global Escape handler must call that cancel path instead of manipulating the modal class directly.
- **Done:** `showConfirm()` now uses a guarded `finish(result)` that hides the modal, removes the confirm/cancel click listeners and its own document-level Escape listener, and resolves exactly once; Escape routes through `handleCancel()`, and the global keydown handler no longer touches the confirm modal class.

### 🔴 1.2 Windows packaging references a missing icon file
- **Where:** `package.json` → `build.win.icon: "assets/icon.ico"`; `assets/` only contains `icon.icns` and `icon.png`.
- **What:** `npm run package:win` will fail or produce a package without the intended icon, because `assets/icon.ico` does not exist.
- **Fix:** Generate a multi-resolution `icon.ico` from `icon.png` and add it to `assets/`, or remove the `win.icon` entry to use electron-builder's fallback.

### ✅ 1.3 Cookie jar is replaced, not merged, on every response
- **Where:** `src/main/omada-api.ts` — `request()` (~lines 189–195).
- **What:** Each response's `Set-Cookie` **overwrites** `this.cookies` entirely. If any later response sets a single cookie without repeating the session cookie (`TPOMADA_SESSIONID`), the session cookie is dropped and every subsequent call fails with an auth error until reconnect.
- **Fix:** Parse cookies by name into a `Map<name, value>` and merge updates (honoring deletions/expiry). Alternatively, use a dedicated Electron session partition and let its cookie store handle this instead of hand-building the `Cookie` header.
- **Done:** the jar is now a `Map<name, value>`; a new `mergeCookies()` parses each `Set-Cookie` header by name and merges it into the jar (an empty value, `Max-Age <= 0`, or a past `Expires` deletes the cookie), and the `Cookie` header is rebuilt from the map, so `TPOMADA_SESSIONID` survives responses that set unrelated cookies.

### ✅ 1.4 `will-navigate` origin check compares against the wrong value
- **Where:** `src/main/index.ts` (~lines 41–46).
- **What:** For `file://` URLs, `new URL(url).origin` is the string `"null"`, never `"file://"`, so the condition `parsedUrl.origin !== 'file://'` is true for *all* URLs — including legitimate internal ones. It happens to be fail-safe today (the app never navigates), but the check doesn't do what the comment claims.
- **Fix:** Compare `parsedUrl.protocol !== 'file:'` instead.
- **Done:** the `will-navigate` handler now compares `parsedUrl.protocol !== 'file:'` (with a comment explaining why origin cannot be used).

### ✅ 1.5 `setStatus('connected', url)` crashes the renderer on a malformed URL
- **Where:** `src/renderer/renderer.ts` — `setStatus()` (~line 299): `new URL(message).host`.
- **What:** If the stored config URL is malformed (user typed `192.168.1.1:8043` without scheme), `new URL()` throws inside the status handler right after a successful connect, leaving the UI in a broken state.
- **Fix:** Wrap in try/catch and fall back to the raw string; better, validate/normalize the URL when saving settings (see 3.6).
- **Done:** the `connected` case wraps `new URL(message).host` in try/catch and falls back to the raw `message` string (URL normalization on save stays with 3.6).

### ✅ 1.12 Renderer `disconnect()` never calls the IPC disconnect
- **Where:** `src/renderer/renderer.ts` — `disconnect()` (~line 498); `src/main/index.ts` `OMADA_DISCONNECT` handler (~line 166).
- **What:** "Disconnect" only clears the UI. `window.omadaAPI.disconnect()` is never invoked, so the authenticated `OmadaController` (cookies + CSRF token) stays alive in the main process. The IPC channel exists but is dead code.
- **Fix:** Make `disconnect()` async, call `await window.omadaAPI.disconnect()`, and clear the UI in `finally`. Combine with 1.8 (server-side logout).
- **Done:** `disconnect()` is now async, awaits `window.omadaAPI.disconnect()` inside try/catch, and clears the UI (status, button, data via the new `clearData()` helper) in `finally`; server-side logout remains for 1.8.

### ✅ 1.13 Failed `loadData()` leaves the UI in an inconsistent state
- **Where:** `src/renderer/renderer.ts` — `connect()` (~line 471) and `loadData()` (~line 526).
- **What:** If connect succeeds but `loadData()` fails, its catch calls `setStatus('error')` (which sets `isConnected = false`) but the button still reads "Disconnect" (set by `connect()`), and previously loaded AP/WLAN arrays are not cleared — stale data stays actionable.
- **Fix:** Let `loadData()` throw and handle the whole failure in `connect()`: reset button text, clear data/selections, disable Apply, and disconnect the main-process controller.
- **Done:** `loadData()` no longer swallows errors; `connect()`'s catch now sets the error status, resets the button text, calls `clearData()` (clears data/selections/filters and disables Apply via `updateSelectionInfo()`), and awaits `window.omadaAPI.disconnect()` to release the main-process controller.

### ✅ 1.14 Settings accepts an empty password that the main process then rejects
- **Where:** `src/renderer/renderer.ts` — `saveSettings()` (~line 588) only checks `url` and `username`; `src/main/index.ts` `OMADA_CONNECT` (~line 122) requires password.
- **What:** Saving with a blank password overwrites any previously stored password with an empty string, closes the dialog, and auto-connects into a guaranteed "Configuración incompleta" error.
- **Fix:** Require a password for new configurations; when editing, treat a blank field as "keep existing password" (send an explicit `passwordChanged` flag rather than the raw value).
- **Done (minimal, renderer-side only):** `saveSettings()` now shows an i18n'd validation error (`passwordRequired`, es/en) when the password field is blank and no stored password exists, and keeps the stored password when the field is left blank while editing; the `passwordChanged`-flag IPC mechanism is deferred to a later phase (pairs with 2.5).
- **Done (final):** the renderer now sends an optional `password` field only when the user actually typed one (`ConfigSavePayload`); the main-process `saveConfig()` keeps the previously stored (encrypted) password when the field is absent and rejects a save with no password at all with the `passwordRequired` error code, which the renderer maps to the existing i18n key (renderer-side validation kept as a first line of defense).

### ✅ 1.15 `loadFile()` promise is unhandled — silent no-window failure
- **Where:** `src/main/index.ts` — `createWindow()` (~line 28); window is only shown on `ready-to-show`.
- **What:** If renderer loading fails (packaging/path error), the rejection is unhandled and the app keeps running with no visible window.
- **Fix:** `.catch()` the promise: log the error and `show()` the window (or display an error dialog) so failure is visible.
- **Done:** `loadFile()` now has a `.catch()` that logs the error via `console.error` and calls `mainWindow?.show()` so the failure is visible.

### ✅ 1.6 No HTTP status, timeout, or size limit in the API client
- **Where:** `src/main/omada-api.ts` — `request()`.
- **What:** (a) The response status code is never checked; a 401/500 HTML error page surfaces as the cryptic `Error parsing response: <html>…` with the full body in the message. (b) There is no request timeout: an unreachable-but-routed controller (firewalled IP) leaves "Conectando..." hanging indefinitely. (c) The response body accumulates without any size ceiling.
- **Fix:** Reject non-2xx `statusCode` with a bounded body excerpt; add an abort timer (e.g. 15 s) cleared on all terminal events; cap the accumulated response size.
- **Done:** `rawRequest()` now rejects non-2xx statuses with `HTTP <status>: <first 200 chars>`, runs a 15 s abort timer, and caps the body at 5 MB (aborting on overflow); all resolve/reject paths go through `settleResolve()`/`settleReject()` helpers that clear the timer and guarantee single settlement, so the timer can never fire after a completed request.

### ✅ 1.7 Session expiry is not handled — no re-login, misleading errors
- **Where:** `src/main/omada-api.ts` / `src/main/index.ts`.
- **What:** Omada web sessions expire (idle timeout). After expiry the app still shows "Connected" but every action fails with a raw controller error (e.g. errorCode -1200 "login required") until the user manually disconnects and reconnects.
- **Fix:** Detect the "not logged in" error codes in `request()` and transparently re-run `connect()` once, then retry the original call; surface a "session expired, reconnecting…" status if it fails.
- **Done:** `request()` checks the result against `AUTH_ERROR_CODES` (`-1200`); when hit after a successful login it joins a shared in-flight re-login (`sharedRelogin()` — concurrent expirations await the same login operation) and retries the original call exactly once through `rawRequest()`, so neither the re-login nor the retry can trigger another re-login; a failed re-login clears all local auth state (cookies, CSRF token, site id) and rejects with a clear "Session expired; re-login failed" error.

### ✅ 1.8 Disconnect never logs out of the controller
- **Where:** `src/main/index.ts` — `OMADA_DISCONNECT` handler just sets `omadaController = null` (and see 1.12 — it isn't even called).
- **What:** The server-side session stays alive on the controller. Repeated connect/disconnect cycles accumulate sessions (controllers cap concurrent sessions and can start rejecting logins).
- **Fix:** Add a `logout()` method calling `POST /{omadacId}/api/v2/logout` and invoke it from the disconnect handler (and on app quit); clear cookies, token, and site id in the controller instance.
- **Done:** `OmadaController.logout()` POSTs `/{omadacId}/api/v2/logout` best-effort (network errors are logged and swallowed) and clears cookies, CSRF token, and site id; the `OMADA_DISCONNECT` handler awaits it before dropping the reference, and a `before-quit` handler in `index.ts` runs it on app quit (bounded to 3 s via `Promise.race`, then re-enters `app.quit()`).

### ✅ 1.9 Unescaped values interpolated into HTML attributes
- **Where:** `src/renderer/renderer.ts` — `renderApList()` (`data-mac="${ap.mac}"`, ~line 346) and `renderWlanList()` (`data-wlan-id="${wlan.wlanId}"`, ~line 406).
- **What:** Text content is escaped via `escapeHtml()`, but attribute values are not (and `escapeHtml()` doesn't escape quotes anyway). Data comes from the controller API, so a compromised/malicious controller could inject markup. CSP (`script-src 'self'`) blocks script execution, but HTML/attribute injection is still possible.
- **Fix:** Stop building HTML strings for list items: create elements with `document.createElement`, set labels via `textContent`, assign ids via `element.dataset`. Additionally validate MAC/WLAN-id formats in both renderer and main.
- **Done:** all rendering now uses DOM APIs — `createApListItem()`/`createWlanListItem()`/`createEmptyState()` build nodes with `document.createElement`, labels via `textContent`, ids via `element.dataset`, and `renderApList()`/`renderWlanList()`/`updateSelectionInfo()`/`showEmptyStates()` insert them with `replaceChildren()` (no `innerHTML` left; `escapeHtml()` deleted); MAC/WLAN-id formats are validated on both sides of the boundary: `isValidMac()`/`isValidWlanId()` in the renderer (entries filtered on `loadData()`, re-checked in `applyChange()`) and `MAC_REGEX`/`WLAN_ID_REGEX` in the main-process `OMADA_SET_WLAN` handler (see 2.6).

### 🟡 1.10 Online status mapping may mislabel APs
- **Where:** `src/renderer/renderer.ts` — `renderApList()` (~line 341): `isOnline = statusCategory === 1 || statusCategory === 2`.
- **What:** In the Omada API, statusCategory 0 = disconnected, 1 = connected, 2 = pending (adopting), 3 = heartbeat missed, 4 = isolated. Treating "pending" as online is questionable; "heartbeat missed" shown as plain offline also loses information.
- **Fix:** Verify the categories against the controller and show distinct states (at minimum a different color for pending/heartbeat-missed). *Needs verification against a live controller before changing.*

### 🟡 1.11 Multi-site controllers: first site is silently picked
- **Where:** `src/main/omada-api.ts` — `resolveSiteId()` (~line 85): `this.siteId = sites[0].id`.
- **What:** If the account can see several sites, the app silently manages whichever site the API lists first — the user gets no choice and no indication which site they're editing. (Pagination is capped at 100 sites; fine in practice.)
- **Fix:** Add `siteId` to config and expose a site selector when `sites.length > 1`; reuse the stored id only if it is still in the authorized-site list; auto-select only when exactly one site exists.

---

## 2. Security hardening

### ✅ 2.1 Password stored in plain text
- **Where:** `src/main/config.ts` — `~/.omada-wlan-manager/config.json`.
- **What:** Already acknowledged in the README. The controller password sits unencrypted on disk (and gets synced/backed up with the home dir).
- **Fix:** Encrypt the password with Electron `safeStorage` (Keychain-backed on macOS) and store only the blob; migrate the old plaintext value once on first load. Note: this breaks config compatibility with the Python version — decide whether that still matters.
- **Done:** the password is stored as a base64 `safeStorage` blob (`encryptedPassword`) and decrypted only in the main process (`getDecryptedPassword()` in `config.ts`); a legacy plaintext `password` field is migrated once on first load (encrypted, file rewritten, plaintext dropped — `migrateLegacyPassword()`), and when `safeStorage.isEncryptionAvailable()` is false the plaintext is kept with a console warning (documented fallback) instead of crashing.

### ✅ 2.2 `sandbox: false` is no longer necessary
- **Where:** `src/main/index.ts` — `webPreferences.sandbox: false` with the comment "Required for preload to work properly with contextBridge".
- **What:** The comment is inaccurate — since Electron 20, sandboxed preload scripts can use `contextBridge` + `ipcRenderer.invoke` fine. Disabling the sandbox needlessly enlarges the attack surface (and amplifies 1.9).
- **Fix:** Set `sandbox: true`, keep `contextIsolation: true` / `nodeIntegration: false`, and verify the preload still works.
- **Done:** `sandbox: true` set (contextIsolation/nodeIntegration untouched); `preload.ts` was made sandbox-compatible by removing its one runtime dependency on a project file — the `IPC_CHANNELS` value import from `shared/types` (a sandboxed preload's polyfilled `require()` cannot load project files) is now a local copy compile-time-checked against the shared table via `typeof SHARED_IPC_CHANNELS`, and every other import is `import type`; the compiled `dist/main/preload.js` only `require`s `electron`, which the sandbox provides.

### ✅ 2.3 Certificate trust is all-or-nothing for the configured host *(part a done; part b deferred)*
- **Where:** `src/main/index.ts` — `setCertificateVerifyProc` (accepts *any* cert for the configured hostname, ignoring fingerprint/port) and the `certificate-error` handler (`url.startsWith(configUrl)` — a prefix match, so `https://192.168.1.1` also matches `https://192.168.1.100`, and `https://controller` matches `https://controller.attacker.example`).
- **What:** Necessary for self-signed certs, but it silently accepts a MITM cert too — an interceptor can capture the login credentials and alter API responses.
- **Fix:** (a) In `certificate-error`, compare parsed origins (`new URL(configUrl).origin === new URL(url).origin`) instead of `startsWith` — or remove the handler once (b) is done. (b) Trust-on-first-use pinning: store `request.certificate.fingerprint256` after explicit first-use confirmation and return `-3` on any mismatch.
- **Done (a):** the `certificate-error` handler now compares parsed origins (`new URL(configUrl).origin === new URL(url).origin`) inside try/catch (a malformed URL falls through to rejection); the `setCertificateVerifyProc` hostname check is kept (its `request` object exposes no port, so origin-level scoping is impossible there) but narrowed after Codex review: the bypass now also requires the verification failure to be a self-signed class (`isSelfSignedVerificationResult()` — authority-invalid, name-mismatch, or expired; revoked/weak-signature certs are never bypassed). **(b) trust-on-first-use pinning remains deferred** — it needs a UX decision on the first-use confirmation dialog (tracked in PROGRESS.md's deferred list).

### ✅ 2.4 Config file read synchronously on every TLS verification
- **Where:** `src/main/index.ts` — `setCertificateVerifyProc` calls `getConfigValue('url')`, which does `fs.readFileSync` + `JSON.parse` of the config file on **every** HTTPS request the app makes.
- **Fix:** Cache the config in memory (invalidate on `CONFIG_SAVE`).
- **Done:** `config.ts` caches the parsed config in memory (`cachedConfig`, loaded lazily via `getCachedConfig()` and replaced after every successful `CONFIG_SAVE`); `setCertificateVerifyProc` and the `certificate-error` handler read the URL through `getConfiguredUrl()`, which never touches the filesystem.

### ✅ 2.5 Plaintext password is shipped to the renderer
- **Where:** `src/main/index.ts` `CONFIG_LOAD` → `src/main/preload.ts` `loadConfig()` → `src/renderer/renderer.ts` `openSettings()` (password placed into a DOM input).
- **What:** Any renderer compromise or DOM injection (see 1.9) gains the controller password; context isolation doesn't protect secrets deliberately exposed through the bridge.
- **Fix:** Have the load IPC return `{url, username, language, hasPassword}`; add a separate main-process-only path that updates the password when the user actually types a new one (pairs with 1.14). Login stays entirely in the main process.
- **Done:** `CONFIG_LOAD` (and preload `loadConfig()`) returns the sanitized `RendererConfig` `{url, username, language, hasPassword}` built by `getRendererConfig()`; the settings dialog leaves the password input empty with an i18n'd `passwordUnchanged` placeholder ("(sin cambios)"/"(unchanged)") when `hasPassword` is true, and connect/auto-connect decrypt the password exclusively in the main process (`getConnectionCredentials()`).

### ✅ 2.6 IPC handlers trust sender and argument shapes
- **Where:** `src/main/index.ts` — all `ipcMain.handle` calls (~lines 108–168).
- **What:** TypeScript annotations don't validate data arriving over IPC at runtime. A compromised renderer could overwrite config with arbitrary values or pass forged MAC/WLAN ids.
- **Fix:** Validate `event.senderFrame.url` is the packaged `file:` URL; add runtime guards for each payload (types, string lengths, MAC/id formats, HTTPS-only URL).
- **Done:** every `ipcMain.handle` now calls `assertTrustedIpcSender()` first — `isTrustedIpcSender()` requires a sender frame whose URL is `file:` and, decoded via `fileURLToPath()`, resolves to exactly the packaged `dist/renderer/index.html` (path comparison avoids percent-encoding false negatives); `CONFIG_SAVE` shape-checks its payload with `isValidConfigSavePayload()` (object, non-empty string url/username with 2048/256 length caps, language enum, optional string password capped at 512) returning `saveFailed` on violation, and `OMADA_SET_WLAN` throws on MAC/WLAN ids not matching `MAC_REGEX`/`WLAN_ID_REGEX` (same patterns as the renderer); the HTTPS-only URL rule stays enforced in `saveConfig()` → `normalizeControllerUrl()`.

### ✅ 2.7 Config file permissions and non-atomic writes
- **Where:** `src/main/config.ts` — `saveConfig()` / `loadConfig()`.
- **What:** The config file inherits the default umask (may be group/world-readable) and is overwritten in place — a crash mid-write leaves truncated JSON, which `loadConfig()` silently swallows, resetting the app to defaults. Parsed values are trusted via casts.
- **Fix:** Create the dir with mode `0o700` and the file with `0o600`; write to a temp file in the same directory and rename atomically; validate parsed fields (types + language enum) instead of casting.
- **Done:** `writeConfigFile()` creates the config dir with mode `0o700`, writes a temp file with mode `0o600` in the same directory and `fs.renameSync`s it over `config.json` (atomic); `validateStoredConfig()` checks every field's type and the language enum (falling back to `'es'`) instead of blind casts, and unparseable JSON is treated as "no config" with a `console.warn` instead of being silently swallowed.

---

## 3. Improvements (prioritized)

### 🟢 3.1 Replace blocking `alert()` calls with in-app toasts
- **Where:** `src/renderer/renderer.ts` — `saveSettings()`, `applyChange()`.
- **Why:** `alert()` in Electron has a long-standing macOS bug where the window loses keyboard focus after the dialog closes (inputs stop accepting typing until the window is refocused). It also blocks the renderer.
- **Fix:** Add a small toast/notification component (styled div with auto-dismiss) for "change applied" / error messages; the confirm-modal pattern already exists for questions.

### 🟢 3.2 Add a Refresh button and loading indicators
- **Why:** The only way to re-read APs/WLANs is disconnect + reconnect. There is also no spinner while `loadData()` runs.
- **Fix:** Add a refresh icon-button (header or next to the filters) that calls `loadData()`; show a lightweight loading state in the panels while fetching.

### 🟢 3.3 Update Electron (28 → current) and dev dependencies
- **Why:** Electron 28 (Dec 2023) is long EOL; it embeds an old Chromium/Node with known CVEs. electron-builder 24 is similarly outdated.
- **Fix:** Bump `electron`, `electron-builder`, `typescript`, `@types/node` incrementally; retest cert verification, sandboxed preload behavior, and packaging on all three platforms.

### 🟢 3.4 Share types between renderer and the rest of the app (bundler)
- **Where:** `src/renderer/renderer.ts` duplicates `AccessPoint`/`WlanGroup`/`Language` because the renderer is compiled as a plain non-module script.
- **Why:** Duplicated types drift; one accidental `import` in renderer.ts breaks the app at runtime (CommonJS `exports` doesn't exist in the browser).
- **Fix:** Introduce esbuild (single small dev-dep) to bundle `renderer.ts` → `renderer.js`; then import shared types and drop the duplicates. Also lets you split the inline i18n table into its own module.

### 🟢 3.5 Trim the packaged app
- **Where:** `tsconfig.json` emits `.d.ts`, `.d.ts.map`, `.js.map` into `dist/`, and `package.json` `build.files` includes all of `dist/**/*`.
- **Fix:** Either disable `declaration`/`declarationMap`/`sourceMap` for production builds or exclude `*.map`/`*.d.ts` in `build.files`.

### ✅ 3.6 Validate and normalize the controller URL on save (require HTTPS)
- **Where:** `src/renderer/renderer.ts` — `saveSettings()`; also validate in the main-process `CONFIG_SAVE` handler (the renderer's `type="url"` input enforces nothing since there is no form submission).
- **Fix:** Parse with `new URL(...)`; require `protocol === 'https:'` (plain `http://` would send credentials unencrypted); reject embedded credentials/fragments; strip the trailing slash; show an i18n'd error if invalid. Prevents bug 1.5 at the source.
- **Done:** `validateControllerUrl()` (renderer) and `normalizeControllerUrl()` (main, enforced inside `saveConfig()`) both parse with `new URL(...)`, require `protocol === 'https:'`, reject embedded credentials/fragments, and strip a trailing slash; an invalid URL shows the new `invalidUrl` i18n key (es and en) in the renderer, and the main-process `CONFIG_SAVE` handler returns `{success: false, error: 'invalidUrl'}` instead of throwing.

### 🟢 3.7 Keyboard/UX niceties in the settings modal
- Enter submits only from the password field; make URL and username fields submit too (or wrap fields in a `<form>` and handle `submit`).
- After Escape-closing settings on first run (no config), the app sits idle with no hint; consider keeping the modal open or showing a "configure connection" empty state.

### 🟢 3.8 i18n and accessibility polish
- `<html lang="es">` is static; update `document.documentElement.lang` in `setLanguage()`.
- Icon-only buttons (settings, modal close) need localized `aria-label`s.
- List items are non-focusable `<div>`s — keyboard-only users cannot select an AP or WLAN. Render them as `<button>`s or add `role="radio"`, `tabindex="0"`, `aria-checked` and Enter/Space handlers, with radiogroup labels on both panels.
- The hard-coded Spanish strings in `index.html` flash briefly for English users; consider rendering empty and applying translations before `show()`.

### ✅ 3.9 Remove dead code
- `src/renderer/renderer.ts`: `currentServerUrl` is written and cleared but never read. Delete it.
- `IPC_CHANNELS.OMADA_DISCONNECT` becomes live again once 1.12 is fixed.
- **Done:** deleted the `currentServerUrl` declaration and both writes in `renderer.ts`; `IPC_CHANNELS.OMADA_DISCONNECT` is now live via the 1.12 fix.

### 🟢 3.10 Add lint/format/test scaffolding
- No ESLint, no Prettier config, no tests, no CI. For a codebase this size, at least add ESLint (typescript-eslint) + a `lint` script; a couple of unit tests for `OmadaController.request`/cookie handling (with the net module mocked) would catch regressions like 1.3.

### 🟢 3.11 Dev environment note (Dropbox)
- `node_modules/.bin` is currently **empty** — Dropbox sync strips npm's symlinks, so `npm run build` fails with `tsc: command not found` until `npm install` is re-run. Consider moving the working copy outside Dropbox or excluding `node_modules` from sync; re-run `npm install` after any sync-related breakage. (Type-check verified clean today via `node node_modules/typescript/bin/tsc --noEmit`.)

### 🟢 3.12 Serialize connection attempts
- **Where:** `src/main/index.ts` `OMADA_CONNECT`; `src/renderer/renderer.ts` `connect()`/`saveSettings()`.
- **Why:** Settings stay usable while connecting; saving can start a second connect while the first is in flight. The second IPC call overwrites the global `omadaController`, so the first flow's `loadData()` can hit a not-yet-authenticated controller.
- **Fix:** Serialize attempts in the main process (create the controller in a local variable, assign globally only after successful auth, discard stale generations); disable Settings/Save during connect.

### ✅ 3.13 Runtime validation of API responses
- **Where:** `src/main/omada-api.ts` — results are trusted via TypeScript casts and immediately dereferenced (`name.localeCompare`, `ssidList.map`).
- **Why:** A different controller version returning missing/differently-typed fields crashes list loading even though the HTTP request succeeded.
- **Fix:** Add small runtime validators (strings, arrays, optional fields); normalize absent names/SSID lists or fail with an explicit "unsupported API response" error.
- **Done:** added `validateAccessPoints()` and `validateWlanGroups()`, plus site-list validation in `resolveSiteId()`: they throw an explicit `Unsupported API response (devices/WLANs/sites)` error when the payload isn't the expected array, when an entry isn't an object, or when a required identifier (`mac`, `wlanId`, site `id`) is missing, and normalize only optional display fields (missing names to the MAC or `''`, missing SSID lists to `[]`).

### ✅ 3.14 Tighten the CSP
- **Where:** `src/renderer/index.html` (~line 6) allows `style-src 'unsafe-inline'` solely because `updateSelectionInfo()` emits inline `style` attributes.
- **Fix:** Replace the inline muted-color styles with a CSS class, then use `style-src 'self'`; add `object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`.
- **Done:** the muted spans in `updateSelectionInfo()` now use the new `.selection-detail .muted-text` class in `styles.css` (the DOM rewrite from 1.9 removed every inline `style` attribute — none remain anywhere in HTML or TS), and the CSP is now `default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'` (`img-src ... data:` added after Codex review so the `data:` SVG select arrow in `styles.css` keeps rendering).

### 🟢 3.15 Scope macOS title-bar styling to macOS
- **Where:** `src/main/index.ts` (~line 23) `titleBarStyle: 'hiddenInset'`; `src/renderer/styles.css` (~lines 63–83) fixed 80 px traffic-light padding.
- **Why:** Windows/Linux get unnecessary left padding and non-native framing.
- **Fix:** Apply `hiddenInset` only when `process.platform === 'darwin'`; add a platform class to `<body>` and scope the padding to it.
