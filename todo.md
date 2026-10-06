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

### ✅ 1.2 Windows packaging references a missing icon file
- **Where:** `package.json` → `build.win.icon: "assets/icon.ico"`; `assets/` only contains `icon.icns` and `icon.png`.
- **What:** `npm run package:win` will fail or produce a package without the intended icon, because `assets/icon.ico` does not exist.
- **Fix:** Generate a multi-resolution `icon.ico` from `icon.png` and add it to `assets/`, or remove the `win.icon` entry to use electron-builder's fallback.
- **Done:** generated `assets/icon.ico` from `assets/icon.png` (sips-resized frames at 256/128/64/48/32/24/16 px, packed as PNG-compressed entries into an ICO container — the same layout electron-builder's own icon pipeline emits, valid on Windows Vista+), so `build.win.icon` now points at a real file.

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

### ✅ 1.10 Online status mapping may mislabel APs
- **Where:** `src/renderer/renderer.ts` — `renderApList()` (~line 341): `isOnline = statusCategory === 1 || statusCategory === 2`.
- **What:** In the Omada API, statusCategory 0 = disconnected, 1 = connected, 2 = pending (adopting), 3 = heartbeat missed, 4 = isolated. Treating "pending" as online is questionable; "heartbeat missed" shown as plain offline also loses information.
- **Fix:** Verify the categories against the controller and show distinct states (at minimum a different color for pending/heartbeat-missed). *Needs verification against a live controller before changing.*
- **Done:** `isOnline` (which collapsed 5 categories into green/red) is gone. A new `AP_STATUS` table in `renderer.ts` maps each documented category to its own colour class and label key — 0 disconnected (red), 1 connected (green), 2 pending/adopting (blue, the accent colour: in progress, neither healthy nor broken), 3 heartbeat missed and 4 isolated (both orange: present but not working, told apart by their labels) — and `getApStatus()` falls back to a neutral grey "unknown" for any category a future firmware adds, so an unrecognised value can no longer masquerade as disconnected. The status dot now also carries `title` + `role="img"`/`aria-label`, so the state is never conveyed by colour alone. New i18n keys `statusApConnected`, `statusApPending`, `statusApHeartbeatMissed`, `statusApIsolated`, `statusApDisconnected`, `statusApUnknown` (es+en, parity enforced by the `Translations` interface).
- **Verified:** not against live hardware — the categories were rendered by stubbing the main-process IPC handlers (`scratchpad/smoke-status.mjs`, 23/23) so the renderer walks its real connect → loadData → renderApList path with one AP per category plus an unknown one. Class, computed colour and label asserted for each. The numeric → meaning mapping is still the documented Omada one, not something confirmed against a controller.

### ✅ 1.11 Multi-site controllers: first site is silently picked
- **Where:** `src/main/omada-api.ts` — `resolveSiteId()` (~line 85): `this.siteId = sites[0].id`.
- **What:** If the account can see several sites, the app silently manages whichever site the API lists first — the user gets no choice and no indication which site they're editing. (Pagination is capped at 100 sites; fine in practice.)
- **Fix:** Add `siteId` to config and expose a site selector when `sites.length > 1`; reuse the stored id only if it is still in the authorized-site list; auto-select only when exactly one site exists.
- **Done:** `OmadaController.connect(preferredSiteId?)` now loads the authorized sites (`loadSites()`, ids strict / names normalized to the id) and never picks silently: it auto-selects only when exactly one site exists, reuses the stored `config.siteId` only when still in the authorized list, and otherwise returns `needsSiteSelection` + the site list through `OMADA_CONNECT`; the renderer shows a site-selection modal (`showSiteSelection()` — one button per site, focus trap/inert/Escape like the other modals, cancel returns to disconnected) and completes via the new `OMADA_SELECT_SITE` handler (sender-asserted, `SITE_ID_REGEX` format guard, exact-match against the authorized list in `selectSite()`), which persists the choice via `saveStoredSiteId()` (dropped by `saveConfig()` when the URL changes) so the next connect reuses it without asking.

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

### ✅ 2.3 Certificate trust is all-or-nothing for the configured host *(part a done; part b scheduled as 4.4 — phase 11)*
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

### ✅ 3.1 Replace blocking `alert()` calls with in-app toasts
- **Where:** `src/renderer/renderer.ts` — `saveSettings()`, `applyChange()`.
- **Why:** `alert()` in Electron has a long-standing macOS bug where the window loses keyboard focus after the dialog closes (inputs stop accepting typing until the window is refocused). It also blocks the renderer.
- **Fix:** Add a small toast/notification component (styled div with auto-dismiss) for "change applied" / error messages; the confirm-modal pattern already exists for questions.
- **Done:** added `showToast(message, type)` in `renderer.ts` (DOM-built, auto-dismisses after 4 s with a fade transition) rendering into a fixed `#toastContainer` (`role="status"`, `aria-live="polite"`, z-index above the modals) styled via new `.toast`/`.toast-success`/`.toast-error`/`.toast-info` classes in `styles.css`; every `alert()` call in `saveSettings()` and `applyChange()` was replaced (validation errors → error toasts, "change applied" → success toast), and a failed reload after a successful apply now reports the new `loadError` message instead of the misleading `changeError`.

### ✅ 3.2 Add a Refresh button and loading indicators
- **Why:** The only way to re-read APs/WLANs is disconnect + reconnect. There is also no spinner while `loadData()` runs.
- **Fix:** Add a refresh icon-button (header or next to the filters) that calls `loadData()`; show a lightweight loading state in the panels while fetching.
- **Done:** added a refresh icon-button (`#refreshBtn`) to the header, enabled only while connected (`setStatus()` gates it) and guarded against re-entry (`isLoadingData`); `loadData()` now shows a spinner in both panels (`createLoadingState()` using the existing `.loading`/`.spinner` styles, `role="status"` + localized `aria-label`) and spins the refresh icon (`.btn-icon.spinning`); on refresh failure `refreshData()` re-renders the previous lists and shows an error toast (`loadError`, es/en).

### 🟢 3.3 Update Electron (28 → current) and dev dependencies — scheduled as 4.3 (phase 10)
- **Why:** Electron 28 (Dec 2023) is long EOL; it embeds an old Chromium/Node with known CVEs. electron-builder 24 is similarly outdated.
- **Fix:** Bump `electron`, `electron-builder`, `typescript`, `@types/node` incrementally; retest cert verification, sandboxed preload behavior, and packaging on all three platforms.

### ✅ 3.4 Share types between renderer and the rest of the app (bundler) — done as 4.1 (phase 8)
- **Where:** `src/renderer/renderer.ts` duplicates `AccessPoint`/`WlanGroup`/`Language` because the renderer is compiled as a plain non-module script.
- **Why:** Duplicated types drift; one accidental `import` in renderer.ts breaks the app at runtime (CommonJS `exports` doesn't exist in the browser).
- **Fix:** Introduce esbuild (single small dev-dep) to bundle `renderer.ts` → `renderer.js`; then import shared types and drop the duplicates. Also lets you split the inline i18n table into its own module.
- **Done:** see 4.1 — the renderer is now an esbuild-bundled set of ES modules that `import type` `AccessPoint`/`WlanGroup`/`Language`/`SiteInfo`/`ConfigSavePayload`/`OmadaAPI` from `src/shared/types.ts`; the duplicates are gone.

### ✅ 3.5 Trim the packaged app
- **Where:** `tsconfig.json` emits `.d.ts`, `.d.ts.map`, `.js.map` into `dist/`, and `package.json` `build.files` includes all of `dist/**/*`.
- **Fix:** Either disable `declaration`/`declarationMap`/`sourceMap` for production builds or exclude `*.map`/`*.d.ts` in `build.files`.
- **Done:** added `!dist/**/*.map` and `!dist/**/*.d.ts` exclusions to `build.files` in `package.json` (`*.map` covers both `.js.map` and `.d.ts.map`), so packages ship only runtime `.js` plus the static HTML/CSS while dev builds keep source maps and declarations.

### ✅ 3.6 Validate and normalize the controller URL on save (require HTTPS)
- **Where:** `src/renderer/renderer.ts` — `saveSettings()`; also validate in the main-process `CONFIG_SAVE` handler (the renderer's `type="url"` input enforces nothing since there is no form submission).
- **Fix:** Parse with `new URL(...)`; require `protocol === 'https:'` (plain `http://` would send credentials unencrypted); reject embedded credentials/fragments; strip the trailing slash; show an i18n'd error if invalid. Prevents bug 1.5 at the source.
- **Done:** `validateControllerUrl()` (renderer) and `normalizeControllerUrl()` (main, enforced inside `saveConfig()`) both parse with `new URL(...)`, require `protocol === 'https:'`, reject embedded credentials/fragments, and strip a trailing slash; an invalid URL shows the new `invalidUrl` i18n key (es and en) in the renderer, and the main-process `CONFIG_SAVE` handler returns `{success: false, error: 'invalidUrl'}` instead of throwing.

### ✅ 3.7 Keyboard/UX niceties in the settings modal
- Enter submits only from the password field; make URL and username fields submit too (or wrap fields in a `<form>` and handle `submit`).
- After Escape-closing settings on first run (no config), the app sits idle with no hint; consider keeping the modal open or showing a "configure connection" empty state.
- **Done:** Enter now submits from URL, username, and password fields (one shared keydown handler per field — a real `<form>` was avoided because the CSP sets `form-action 'none'`); on first run (no stored config, tracked by `hasStoredConfig`) both panels show a localized "configure the connection in Settings" empty state (`configureHint`, es/en) instead of the misleading "connect to see data" message, so Escape-closing the settings modal no longer leaves the app without guidance; the confirm modal now moves keyboard focus to its Confirm button when opened (Enter confirms, Escape cancels).

### ✅ 3.8 i18n and accessibility polish
- `<html lang="es">` is static; update `document.documentElement.lang` in `setLanguage()`.
- Icon-only buttons (settings, modal close) need localized `aria-label`s.
- List items are non-focusable `<div>`s — keyboard-only users cannot select an AP or WLAN. Render them as `<button>`s or add `role="radio"`, `tabindex="0"`, `aria-checked` and Enter/Space handlers, with radiogroup labels on both panels.
- The hard-coded Spanish strings in `index.html` flash briefly for English users; consider rendering empty and applying translations before `show()`.
- **Done:** `setLanguage()` now updates `document.documentElement.lang`; the icon-only buttons (settings, refresh, modal close) get localized `title` + `aria-label` in `applyTranslations()` (new `close`/`refresh` keys, es/en); list items are now keyboard-operable radios — `role="radio"`, `tabindex="0"`, `aria-checked`, Enter/Space toggle with focus restored after the re-render (`focusListItemByData()`) and a `:focus-visible` outline — inside `role="radiogroup"` panels labeled via `aria-label`; `index.html` now ships with no user-facing text at all (filled by `applyTranslations()` before the async init completes), so English users never see a Spanish flash.
- **Done (OMADA_CONNECT i18n, flagged in phase 3):** the `OMADA_CONNECT` handler in `src/main/index.ts` no longer returns hardcoded Spanish strings — it sends stable error codes (`configIncomplete` | `connectFailed` | `connectError`, typed as `ConnectionErrorCode` in `shared/types.ts`, plus an optional technical `detail`) which `connectionErrorMessage()` in the renderer maps to es/en i18n strings (new `configIncomplete`/`connectFailed` keys), consistent with the `saveConfig` error-code pattern; the remaining internal `'No conectado al controlador'` throws in `index.ts` were rewritten in English (they are diagnostics — the renderer already maps them to generic i18n errors).

### ✅ 3.9 Remove dead code
- `src/renderer/renderer.ts`: `currentServerUrl` is written and cleared but never read. Delete it.
- `IPC_CHANNELS.OMADA_DISCONNECT` becomes live again once 1.12 is fixed.
- **Done:** deleted the `currentServerUrl` declaration and both writes in `renderer.ts`; `IPC_CHANNELS.OMADA_DISCONNECT` is now live via the 1.12 fix.

### 🟢 3.10 Add lint/format/test scaffolding — tests scheduled as 4.2 (phase 9); ESLint/CI still optional
- No ESLint, no Prettier config, no tests, no CI. For a codebase this size, at least add ESLint (typescript-eslint) + a `lint` script; a couple of unit tests for `OmadaController.request`/cookie handling (with the net module mocked) would catch regressions like 1.3.

### 🟢 3.11 Dev environment note (Dropbox)
- `node_modules/.bin` is currently **empty** — Dropbox sync strips npm's symlinks, so `npm run build` fails with `tsc: command not found` until `npm install` is re-run. Consider moving the working copy outside Dropbox or excluding `node_modules` from sync; re-run `npm install` after any sync-related breakage. (Type-check verified clean today via `node node_modules/typescript/bin/tsc --noEmit`.)

### ✅ 3.12 Serialize connection attempts
- **Where:** `src/main/index.ts` `OMADA_CONNECT`; `src/renderer/renderer.ts` `connect()`/`saveSettings()`.
- **Why:** Settings stay usable while connecting; saving can start a second connect while the first is in flight. The second IPC call overwrites the global `omadaController`, so the first flow's `loadData()` can hit a not-yet-authenticated controller.
- **Fix:** Serialize attempts in the main process (create the controller in a local variable, assign globally only after successful auth, discard stale generations); disable Settings/Save during connect.
- **Done:** main-process side (the missing part — phase 6's renderer flags already serialized the renderer's own operations, and `isOperationInProgress()` already blocked Save during connect): `OMADA_CONNECT` now builds the controller in a LOCAL variable, bumps/captures a `connectGeneration` counter, and installs the controller globally only after `connect()` succeeds AND the generation is still current — a stale attempt (newer connect or disconnect meanwhile, `OMADA_DISCONNECT`/`before-quit` bump the counter too) is logged out and reported as `connectionSuperseded` (new i18n-mapped error code), and any replaced predecessor is released via `releaseController()`; renderer side, the Settings button is additionally disabled while `connect()` is in flight (re-enabled generation-checked in its `finally`) and `openSettings()` guards on `isConnecting`.

### ✅ 3.13 Runtime validation of API responses
- **Where:** `src/main/omada-api.ts` — results are trusted via TypeScript casts and immediately dereferenced (`name.localeCompare`, `ssidList.map`).
- **Why:** A different controller version returning missing/differently-typed fields crashes list loading even though the HTTP request succeeded.
- **Fix:** Add small runtime validators (strings, arrays, optional fields); normalize absent names/SSID lists or fail with an explicit "unsupported API response" error.
- **Done:** added `validateAccessPoints()` and `validateWlanGroups()`, plus site-list validation in `resolveSiteId()`: they throw an explicit `Unsupported API response (devices/WLANs/sites)` error when the payload isn't the expected array, when an entry isn't an object, or when a required identifier (`mac`, `wlanId`, site `id`) is missing, and normalize only optional display fields (missing names to the MAC or `''`, missing SSID lists to `[]`).

### ✅ 3.14 Tighten the CSP
- **Where:** `src/renderer/index.html` (~line 6) allows `style-src 'unsafe-inline'` solely because `updateSelectionInfo()` emits inline `style` attributes.
- **Fix:** Replace the inline muted-color styles with a CSS class, then use `style-src 'self'`; add `object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`.
- **Done:** the muted spans in `updateSelectionInfo()` now use the new `.selection-detail .muted-text` class in `styles.css` (the DOM rewrite from 1.9 removed every inline `style` attribute — none remain anywhere in HTML or TS), and the CSP is now `default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'` (`img-src ... data:` added after Codex review so the `data:` SVG select arrow in `styles.css` keeps rendering).

### ✅ 3.15 Scope macOS title-bar styling to macOS
- **Where:** `src/main/index.ts` (~line 23) `titleBarStyle: 'hiddenInset'`; `src/renderer/styles.css` (~lines 63–83) fixed 80 px traffic-light padding.
- **Why:** Windows/Linux get unnecessary left padding and non-native framing.
- **Fix:** Apply `hiddenInset` only when `process.platform === 'darwin'`; add a platform class to `<body>` and scope the padding to it.
- **Done:** `titleBarStyle` is now `process.platform === 'darwin' ? 'hiddenInset' : 'default'`; the sandbox-safe preload exposes `platform: process.platform` on the `omadaAPI` bridge (a value captured at preload time — no IPC round-trip), `applyPlatformClass()` in `renderer.ts` tags `<body>` with `platform-<os>` before first paint, and the 80 px padding moved to a `body.platform-darwin .title-bar` rule in `styles.css`.

---

## 4. Omada 6.3: AP groups & Wi-Fi network management (planned 2026-10-06)

Plan agreed with the user after live tests on controller 6.3.0.45 and two Codex reviews. **Spec:**
`docs/management-design.md` (decisions, architecture, security, UI). **API facts:**
`docs/omada-6.3-api-findings.md` + `docs/omada-openapi-ops.md`. One item = one autoclaude phase
(phase numbers continue PROGRESS.md). Every phase: `npm run build` exits 0, es/en i18n parity, JSDoc
on every function, closing-brace comments on blocks > 10 lines, **no contact with the real controller
and no use of the real `~/.omada-wlan-manager/` config** (design spec §1, D4).

### ✅ 4.1 Renderer modularization with esbuild — phase 8 (absorbs 3.4)
- **What:** Bundle the renderer with esbuild (`renderer.ts` → `renderer.js`), split the ~1,950-line `renderer.ts` into modules (i18n table, DOM helpers, AP list, group list, modals, toasts, state), import shared types from `src/shared/types.ts` and delete the duplicated renderer types.
- **Constraints:** no behavior or markup change; CSP stays `script-src 'self'` (no inline/eval bundle output); `npm run build` still produces a runnable `dist/`; packaged files list still correct.
- **Acceptance:** build exit 0; one bundled renderer script loaded by `index.html`; no duplicated `AccessPoint`/`WlanGroup`/`Language` types; renderer behavior unchanged (manual reasoning + phase 9 smoke).
- **Done:** `npm run build` = `tsc` (root tsconfig now excludes `src/renderer`) → `tsc -p src/renderer` (type-check only, ESM/bundler resolution, no Node types) → `scripts/build-renderer.mjs` (esbuild, deletes `dist/renderer` then emits one strict-mode IIFE `renderer.js`, `chrome120`, linked map) → copy-static; `index.html`/`styles.css` unchanged. `renderer.ts` is now the entry (event wiring + init) over 17 modules (`state`, `elements`, `i18n`, `apply-translations`, `status`, `toast`, `validation`, `dom-helpers`, `panels`, `ap-list`, `wlan-list`, `modal-focus`, `settings-modal`, `confirm-modal`, `site-modal`, `connection`, `apply-change`; no import cycles), with all mutable state in one `state` object; function bodies moved verbatim (only `state.` qualification). `OmadaAPI` moved from the preload to `src/shared/types.ts` (`platform: string`), the `Window` augmentation to `src/renderer/global.d.ts`, and the preload checks its bridge with `satisfies OmadaAPI` (compiled preload unchanged apart from a comment). `npm run watch:renderer` rebuilds the bundle on change.

### 🟢 4.2 Test harness — phase 9 (absorbs part of 3.10; ESLint stays optional)
- **What:** (a) `npm test` with `node:test` (+ esbuild/tsx transpile if needed) and JSON fixtures for the API response validators, cookie merge and config normalization; extract validators/transport behind an interface so they are testable without Electron's `net`. (b) Commit a Playwright `_electron` GUI smoke harness under `tests/smoke/` that stubs the main-process IPC handlers, launches with `HOME` pointed at a temp dir, and supports an `ELECTRON_PATH` override (Dropbox breaks `node_modules/electron/dist` — see PROGRESS.md "GUI smoke test").
- **Acceptance:** `npm test` exit 0 with ≥ 1 fixture test per validator; `npm run smoke` covers startup in es and en, first-run, connect → lists rendered, single AP move with confirm/cancel, and zero console errors.

### 🟢 4.3 Electron upgrade — phase 10 (absorbs 3.3)
- **What:** Electron 28 → current stable major; bump electron-builder, TypeScript, @types/node. Re-check sandboxed preload, `setCertificateVerifyProc`, `certificate-error`, CSP, `net.request` behavior and packaging config (`mac.notarize` must stay plain `true`, see PROGRESS.md release notes).
- **Acceptance:** build, `npm test`, `npm run smoke` all exit 0 on the new Electron; `electron-builder --mac --dir` (unsigned, output under `/private/tmp`) succeeds; breaking changes noted in PROGRESS.md.

### 🟡 4.4 URL-scoped credentials + certificate TOFU pinning — phase 11 (completes 2.3b)
- **What:** Changing the controller URL clears password, Client Secret, site id and pin and requires new credentials (today a blank password reuses the old controller's password — `src/main/config.ts` `saveConfig()`). TOFU pinning per normalized origin with a first-use fingerprint confirmation dialog, mismatch dialog, and "Reset trusted certificate" in Settings; no credential is sent before the pin check passes. Fix README's stale "Python-compatible / plaintext" config note.
- **Acceptance:** unit tests for URL-change clearing and pin match/mismatch/first-use; smoke covers the first-use dialog and the mismatch dialog (stubbed); es/en strings added.

### 🔴 4.5 Omada 6.3 correctness & terminology — phase 12
- **What:** Keep `controllerVer` from `/api/info`; derive `groupModel`; load the authoritative group list from `GET setting/wlans` (includes **empty** groups such as `zNinguna`, which the app currently cannot show) and outer-join SSID names from `GET setting/ssids`; ignore entries whose `deviceType` is not an AP type; vocabulary switches "AP groups" (6.3+) vs "WLAN groups (legacy)"; README/package description updated.
- **Acceptance:** fixtures: 6.3 payload with an empty group renders it; legacy payload keeps "WLAN group" wording; unit tests for the join; smoke shows an empty group as selectable.

### 🟢 4.6 New app shell + Access points view — phase 13
- **What:** Sidebar navigation (Access points / AP groups / Wi-Fi networks with counts), site + connection state, refresh with "Updated hh:mm"; Access points view per spec §4.3: native checkbox multi-select, range select, selection that survives filters, always-visible destination pane with group/SSID search, "Silence" section for empty groups, gains/losses preview, review dialog, **sequential bulk move with per-AP results and Retry failed**, specific button labels. Moves use only the internal `PATCH eaps/{mac}` path.
- **Acceptance:** smoke: single move, bulk move (all succeed / partial failure / cancel), selection survives filtering, keyboard-only move, empty group selectable and labelled; AP groups / Wi-Fi networks nav items present (placeholder content allowed until phase 14).

### 🟢 4.7 Read-only AP groups & Wi-Fi networks views, cross-navigation, responsive layout — phase 14
- **What:** Spec §4.4/§4.5 in read-only form from internal data (group → SSID names; network → groups/APs); cross-links with "Back to …"; all states from §4.6 (first run, disconnected, loading, refreshing, no data vs no results, errors, read-only banner with reason); responsive breakpoints and keyboard rules from §4.7.
- **Acceptance:** smoke at 1200, 900 and 720 px widths; cross-navigation round trip; Cmd/Ctrl+F and Escape behavior; read-only banner shows the "no management credentials" reason.

### 🟡 4.8 Open API credentials, client & capability detection — phase 15
- **What:** Settings "Management access (optional)" (Client ID, Client Secret — `safeStorage` only, refuse plaintext persistence, session-only fallback); `OpenApiClient` (token lifecycle with single shared re-acquire, `AccessToken=` header, pagination, explicit v1/v2 paths, DELETE support, validators, central redactor); `ControllerSession` facade; capability checks and reason codes from spec §2.2; "Test management access" button.
- **Acceptance:** unit tests: token acquire/expiry/re-acquire-once, redaction (no secret in logs/errors/IPC), capability matrix (each failing check → management off with the right reason), site/group id-set mismatch disables management; Client Secret never returned over IPC (`hasClientSecret` only).

### 🟡 4.9 AP group management — phase 16
- **What:** Create (empty, name only), rename, delete (only non-default, 0 APs, no bindings — app policy), per-band capacity display, "Move access points here" reusing the phase-13 move flow (internal path). New IPC channels follow spec §3.
- **Acceptance:** contract tests against fixtures for each Open API call (method, path version, body); smoke: create → rename → delete-blocked-when-non-empty → delete-empty; UI hidden/explained when the capability is off.

### 🟢 4.10 Wi-Fi network read model (Open API) — phase 17
- **What:** Paginated v2 SSID catalog, v1 detail and per-SSID AP-group bindings; renderer DTO strips `securityKey` (exposes `hasPassphrase`); enable-field fallback per spec §5; "All access points" scope detection (`chooseDevices = 0`); networks view switches to this source when management is available.
- **Acceptance:** tests prove nested secrets cannot reach the preload/renderer; malformed payloads rejected; smoke renders scopes "All access points" and "N groups · M APs".

### 🟡 4.11 Wi-Fi network editing (Open + WPA-Personal) — phase 18
- **What:** Create (disabled by default, bound to selected groups), staged edit of basic settings via main-process read-merge-write, **Change password**, enable/disable via the `enable` endpoint, delete with impact summary; WPA-Personal `basic-config` saves require re-typing the passphrase (spec §3/§5); Enterprise/PPSK: no edit/create, explained in the UI.
- **Acceptance:** fixture tests for Open and WPA-Personal bodies (required fields present, passphrase only when typed, UTF-8 SSID ≤ 32 bytes, 8–63 char passphrase); smoke for create/edit/cancel/delete confirmations.

### 🟡 4.12 "Broadcast on" binding editor — phase 19
- **What:** The single canonical SSID ↔ AP-group editor (spec §4.5): searchable group checkboxes, before/after reach diff, per-band capacity validation naming the failing groups/bands, confirmation; "All access points" networks stay read-only (never converted).
- **Acceptance:** tests: capacity validation, no binding PATCH ever sent for All-devices networks, diff computation; smoke: change bindings → confirm → refreshed state shown.

### 🟢 4.13 Integration, hardening, docs & live-test checklist — phase 20
- **What:** IPC and redaction audit, async-race review across views, accessibility/keyboard smoke at the three widths, README + a short user guide (es/en UI terms), and `docs/live-test-checklist.md` per spec §6 for the user's manual run on "EAP Carpio" with disposable resources.
- **Acceptance:** build + tests + smoke exit 0; no secret strings in renderer/IPC/log fixtures; every destructive path confirmed; checklist covers every unknown in spec §5.
