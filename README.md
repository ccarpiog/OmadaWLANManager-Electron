# Omada WLAN Manager (Electron)

A modern desktop application for moving TP-Link Omada Controller access points between AP groups
(Omada 6.3 and later) or WLAN groups (older controllers).

## Features

- Connect to TP-Link Omada Controller
- View all access points with their status, group, number of Wi-Fi networks and
  connected clients; search and filter them by status and group; click one to see its
  details (status, MAC, group, clients and the Wi-Fi networks its group broadcasts)
- Browse the **AP groups** (with their access points and Wi-Fi networks, including groups
  without any network — see [Controller versions](#controller-versions)) and the
  **Wi-Fi networks** (with the groups and access points that broadcast each one);
  names link between the views, with **Back to …** to return
- With management access (Omada 6.3 and later): create, rename and delete AP groups, and
  see how many more Wi-Fi networks each band of a group can take (the Wi-Fi networks view
  stays read-only)
- Move one or more access points into another group, including an empty one to silence them,
  after reviewing which Wi-Fi networks they gain and lose; access points are moved one at a time,
  with a per-access-point result and **Retry failed**
- Supports the self-signed certificates Omada controllers use, with
  trust-on-first-use pinning: you confirm the certificate's SHA-256
  fingerprint once, and a different certificate is refused afterwards
- Modern, native-looking UI with dark mode support

## Requirements

- Node.js 22.18+ (or 24.2+) for development. The `electron` npm package needs
  22.12+, and Node 22.12–22.17 and 24.0–24.1 have a module-resolution bug with
  non-ASCII project paths ([nodejs/node#58586](https://github.com/nodejs/node/issues/58586))
  that makes `electron-builder` fail with `Cannot find module ...` when the
  checkout lives under a path such as `.../InformáticaHispanoInglés/...`. On an
  affected Node, run it as
  `node --no-turbo-fast-api-calls node_modules/electron-builder/cli.js ...`.
- npm or yarn
- macOS 13 (Ventura) or later to run the macOS build (Electron 44 dropped macOS 12)
- TP-Link Omada Controller (tested with controller versions 5.x and 6.1.0.19;
  the internal API calls the app makes were verified on 6.3.0.45)

Toolchain: Electron 44 (Chromium 152, Node.js 24), TypeScript 7, esbuild,
electron-builder 26, Playwright (`playwright-core`) for the GUI smoke test.

## Installation

```bash
# Install dependencies
npm install

# Build the application
npm run build

# Run in development mode
npm run dev
```

## Usage

1. Launch the application
2. Click **Settings** (gear icon, at the bottom of the sidebar), or **Configure connection** on first launch, to configure your Omada Controller connection:
   - **URL**: Your controller URL (e.g., `https://192.168.1.1:8043`)
   - **Username**: Your Omada Controller username
   - **Password**: Your Omada Controller password
   - **Management access (optional)**: the **Client ID** and **Client Secret** of an
     Open API application created in the controller's settings (client credentials
     mode). They unlock AP-group management (Wi-Fi network management is not
     available yet). While connected, the app checks whether they grant it
     (Omada 6.3 or later, an access token, and the connected site and its AP
     groups must match what the controller reports), and **Test management
     access** shows the precise result
3. Click **Connect** to connect to the controller. The first time, the app
   shows the controller certificate's SHA-256 fingerprint: compare it with the
   certificate of your controller and choose **Trust and connect** (no password
   is sent before you do)
4. In the **Access points** view, tick one or more access points (Shift-click or
   Shift+arrow keys select a range). Access points stay selected while a search or
   filter hides them; the count under the list says how many are hidden
5. Pick the destination in the **Move selected APs** pane next to the list (one
   option per AP group on Omada 6.3+, per WLAN group on older controllers; in a
   window narrower than 800 px, **Choose destination** opens it in the list's
   place, and its **←** returns to the list). Its
   search matches group names and Wi-Fi network names; groups without networks
   are listed under **Silence**. The pane previews the networks the selected
   access points gain, lose and keep, says how many are already in that group
   (those are skipped), and how many the filters hide. Access points only
   report their group's name, so a group whose name another group shares is
   listed but cannot be picked: rename one of them in Omada
6. Click **Move AP** / **Move N APs**. A review dialog shows the current groups,
   the destination, the access points that move, the network changes and the
   clients connected to them; it opens on **Cancel**, so press the move button
   to confirm. The access points are moved one at a time (the move is not
   atomic). The results list each access point as moved or failed, with the
   controller's message; the failed ones stay selected, and **Retry failed**
   moves only those, through the same review (the results say how many failed
   access points left the controller meanwhile, and those are skipped; if the
   destination group is gone, they say so instead of offering the retry)
7. Click an access point's row (anywhere but its checkbox), or press Enter on its
   checkbox, to open its details in place of the move pane; **Close details**
   brings the move pane back. The details list the Wi-Fi networks of its group;
   per-access-point network overrides set in Omada are not shown
8. The **AP groups** and **Wi-Fi networks** views (sidebar) each have their own
   search. A group shows its access points and networks, and **Move access points
   here**, which opens **Access points** with that group already picked as the
   destination (tick the access points and move them as in step 6); a network shows
   the groups and access points that broadcast it ("N groups · M APs", or "at least
   M APs" when some access points' groups cannot be identified). Clicking a
   group, network or access point name opens it in its view; **Back to …** returns
   to where you were. Security, bands and whether a network is enabled are not
   shown: they need management access, which the Wi-Fi networks view does not use
   yet. With management access, the AP groups view adds **New group** (an empty
   group, name only), **Rename** and **Delete**, and each group's remaining
   capacity per band ("Not reported" when the controller does not say); a group
   the controller reports full on a band (no room for another Wi-Fi network)
   carries a **Capacity warning** badge in the list, whose tooltip names the
   band. The default group has no **Delete**; another group can be deleted only
   when it has no access points and no networks — otherwise the disabled
   **Delete** says why — and a deletion asks for confirmation. Without
   management access, a banner on both views says why they are read-only: the
   controller is older than 6.3, Open API credentials are not configured, the
   management check is still running (also while **Test management access**
   checks again: the management actions are hidden until it passes), or which
   check failed (credentials rejected, no access token, the site or the AP
   groups do not match, no answer); it disappears once every check passes
9. **Cmd+F** (macOS) / **Ctrl+F** focuses the current view's search; **Escape**
   clears the search, and otherwise closes the open dialog. If the connection or
   its first data load fails, each view shows the error with **Retry** and
   **Settings**; if a refresh fails, the data stays on screen with a notice
   giving the time it is from, and **Retry**
10. The window adapts to its width (minimum 700×500): from 1000 px the sidebar
    shows labels, from 800 px only icons and counts (labels as tooltips), and
    below 800 px the views switch from a bar at the top and show one pane at a
    time (the move pane, AP details and a group's or network's details open in
    the list's place, each with **←** back to the list)

## Controller versions

The app reads the controller version from `/api/info` when it connects:

- **Omada 6.3 and later** use AP groups (6.3 turned WLAN groups into AP
  groups). The list comes from the controller's complete AP-group list, so
  groups without Wi-Fi networks are shown too, labelled "No Wi-Fi networks —
  silences these APs": moving an access point there stops it broadcasting.
- **Older controllers**, and any controller whose version is missing or cannot
  be read, are treated as legacy: the groups are called "WLAN groups (legacy)".
  The app still asks for the complete group list and, when the controller does
  not offer it, shows the groups that have Wi-Fi networks, as earlier versions
  of the app did.

Moving an access point always uses the same controller call (`PATCH
eaps/{mac}` with the group id), whatever the version.

## Building for Distribution

```bash
# Build for macOS
npm run package:mac

# Build for Windows
npm run package:win

# Build for Linux
npm run package:linux
```

The packaged application will be created in the `release/` directory.

## Configuration

Configuration is stored in `~/.omada-wlan-manager/config.json` (directory mode
`0700`, file mode `0600`, written atomically). The format is no longer
compatible with the old Python version of this application.

- **Password:** stored encrypted with Electron's `safeStorage` (the macOS
  Keychain, DPAPI on Windows, the secret service on Linux) and decrypted only in
  the main process; the window never receives it. A plaintext password from an
  older config is encrypted on first load. Only when the OS offers no
  encryption (e.g. a Linux session without a secret service) is it kept in
  plaintext, with a warning.
- **Management access (optional):** the Open API Client ID is stored in plain
  text (it is not a secret); the Client Secret only encrypted with
  `safeStorage`. When the OS offers no real secret store (no encryption, or on
  Linux the obfuscation-only `basic_text` backend or an `unknown` one), the
  Client Secret is never written to disk: it is kept in memory until the app
  quits, and Settings says so. The window never receives the secret: Settings shows "(unchanged)" when one
  is stored, and leaving the field blank keeps it for the same Client ID and
  controller URL (a new Client ID needs its secret). **Remove management
  access** deletes both when you save.
- **Credentials are tied to the controller URL:** saving a different URL drops
  the stored password, the Open API Client ID and Client Secret (stored or kept
  for the session), the chosen site and the trusted certificate, and asks for
  the new controller's password. Leaving the password blank keeps it only while the URL is unchanged.
  Saving a different URL also closes the current connection: a connection
  attempt or site choice still in progress for the old controller is discarded.
- **Trusted certificate:** the SHA-256 fingerprint you confirmed on the first
  connection, with the controller origin and the time you trusted it. Settings
  shows it, and **Reset trusted certificate** forgets it and closes the current
  connection, including one still being established (the next connection asks
  again). A controller that later presents a different self-signed
  certificate is refused with a "certificate changed" dialog until you reset it.

## Development

```bash
# Watch for TypeScript changes (main process, preload, shared types)
npm run watch

# Rebuild the renderer bundle on change
npm run watch:renderer

# Run the app (after building)
npm start
```

`npm run build` compiles the main process, preload and shared types with
`tsc`, type-checks the renderer (`tsc -p src/renderer`), bundles the renderer
modules into a single `dist/renderer/renderer.js` with esbuild
(`scripts/build-renderer.mjs`), and copies `index.html` and `styles.css` next
to it. Every `tsc` run goes through `scripts/tsc.mjs`, which starts the
compiler with Node directly rather than through `node_modules/.bin`, whose
symlinks Dropbox strips.

## Testing

```bash
npm test          # unit tests (plain Node, no Electron needed)
npm run smoke     # build, then the GUI smoke test against a stubbed main process
npm run tls-probe # build, then the opt-in certificate-pinning probe (local HTTPS only)
```

- `npm test` type-checks `tests/` (`tsc -p tests`), bundles
  `tests/unit/**/*.test.ts` with esbuild into a temp directory (never `dist/`,
  so no test code is packaged) and runs them with `node:test`. Fixtures are
  JSON files under `tests/fixtures/`. Covered: the API response validators,
  the group-list join (6.3 and legacy payloads) and the controller-version
  rule, cookie-jar merging, controller URL normalization, the hardened HTTP
  transport, and `OmadaController` driven through a fake transport. A test
  that imports Electron fails the bundle step.
- `npm run smoke` launches Electron through Playwright (`playwright-core`, which
  downloads no browsers) with `tests/smoke/stub-main.cjs` as the main process:
  the real preload and renderer, with fixture-driven fake IPC handlers. It
  prints PASS/FAIL per check and exits non-zero on any failure.
- **Electron binary:** `ELECTRON_PATH` (an executable or an `.app` bundle) wins;
  otherwise the `electron` npm package's binary is used if it was already
  downloaded and runs. Since Electron 42, `npm install` no longer downloads the
  binary: the package fetches it on first use (`npm start`, `npx electron`, or
  `npx install-electron --no`); the smoke runner never triggers that download.
  In a Dropbox checkout `node_modules/electron/dist` is broken (Dropbox strips
  symlinks and exec bits), so extract the matching Electron release zip outside
  Dropbox (`ditto -x -k` keeps the symlinks) and run e.g.
  `ELECTRON_PATH=/private/tmp/electron/Electron.app/Contents/MacOS/Electron npm run smoke`.
  The smoke fails unless every launch runs exactly the installed `electron`
  package version (it prints the running Electron, Chromium and Node versions).
- `npm run tls-probe` (opt-in, not part of `npm test` or the smoke; needs
  `ELECTRON_PATH` and the `openssl` CLI) checks certificate pinning against the
  real Chromium network stack: it generates self-signed certificates for
  `127.0.0.1` with `openssl`, serves them from local HTTPS servers, and runs
  (1) the app's verify proc and controller sessions through `net.request()`
  (first use rejected before any HTTP request, retry after trust, mismatch also
  on another port, first use again after a reset) and (2) the real main process
  and renderer against a local fake controller, including adversarial
  concurrency checks (a certificate reset or a URL change while a connection
  or site choice is still in progress must leave nothing connected or saved).
  HOME is a temp dir and the macOS Keychain is not used.
- **Isolation:** both commands point `HOME` (and `USERPROFILE`) at a fresh temp
  directory. The smoke stub refuses to start with the real home, keeps
  Electron's profile inside the temp dir, never loads the real main process,
  cancels every non-`file:` request and writes no files. Neither command
  contacts a controller or touches `~/.omada-wlan-manager/`.

## Project Structure

```
omada-electron/
├── src/
│   ├── main/           # Main process (Node.js)
│   │   ├── index.ts    # Entry point, window management, IPC handlers
│   │   ├── config.ts   # Configuration file management
│   │   ├── omada-api.ts # Omada Controller API client
│   │   ├── omada-transport.ts # HTTP transport interface + hardened implementation
│   │   ├── net-transport.ts   # Production transport (Electron's net module)
│   │   ├── cert-verify.ts     # Certificate hooks + replaceable controller session
│   │   ├── connection-manager.ts # Connection state machine (connect, site choice, trust, reset, URL change)
│   │   ├── controller-session.ts # Controller session facade (internal + Open API clients, management capability checks, AP-group operations)
│   │   ├── openapi-client.ts  # Open API client (token, paths, pagination, AP-group calls)
│   │   ├── omada-validators.ts, cookie-jar.ts, url.ts, # Pure, unit-tested helpers
│   │   │   cert-pinning.ts, config-model.ts, controller-version.ts, redact.ts,
│   │   │   ap-group-policy.ts, ipc-guards.ts
│   │   └── preload.ts  # Preload script for secure IPC
│   ├── renderer/       # Renderer process (Browser), bundled by esbuild
│   │   ├── index.html  # Main HTML
│   │   ├── styles.css  # Styles with dark mode support
│   │   ├── renderer.ts # Entry module: event wiring and startup
│   │   └── *.ts        # UI modules (state, i18n, lists, modals, connection, ...)
│   └── shared/         # Shared types
│       └── types.ts    # TypeScript interfaces
├── scripts/            # Build and test scripts (renderer bundle, unit-test runner)
├── tests/              # unit/ (node:test), smoke/ (Playwright GUI smoke), tls-probe/ (opt-in), fixtures/ (JSON)
├── assets/             # Icons and resources
├── dist/               # Compiled JavaScript (generated)
└── release/            # Packaged applications (generated)
```

## Security Notes

- Certificate checks are relaxed only for the configured controller, and only
  for a self-signed certificate whose SHA-256 fingerprint matches the one you
  trusted (trust on first use). Other hosts and CA-issued certificates get
  Chromium's normal verification. The first request is already gated, so the
  password is never sent to an unconfirmed or changed certificate
- The application uses Electron's `contextIsolation` and disables `nodeIntegration` for security
- IPC communication is limited to specific, validated channels

## License

MIT
