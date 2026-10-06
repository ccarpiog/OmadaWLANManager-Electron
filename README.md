# Omada WLAN Manager (Electron)

A modern desktop application for managing TP-Link Omada Controller WLAN group assignments for access points.

## Features

- Connect to TP-Link Omada Controller
- View all access points with online/offline status
- View all WLAN groups with their SSIDs
- Assign WLAN groups to specific access points
- Supports self-signed SSL certificates (common with Omada controllers)
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
- TP-Link Omada Controller (tested with controller versions 5.x and 6.1.0.19)

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
2. Click the **Settings** button (gear icon) to configure your Omada Controller connection:
   - **URL**: Your controller URL (e.g., `https://192.168.1.1:8043`)
   - **Username**: Your Omada Controller username
   - **Password**: Your Omada Controller password
3. Click **Connect** to connect to the controller
4. Select an Access Point from the left panel
5. Select a WLAN Group from the right panel
6. Click **Apply Change** to assign the WLAN group to the access point

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

Configuration is stored in `~/.omada-wlan-manager/config.json` and is compatible with the Python version of this application.

**Note**: Credentials are stored in plain text. For production use, consider using OS keychain storage.

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
npm test        # unit tests (plain Node, no Electron needed)
npm run smoke   # build, then the GUI smoke test against a stubbed main process
```

- `npm test` type-checks `tests/` (`tsc -p tests`), bundles
  `tests/unit/**/*.test.ts` with esbuild into a temp directory (never `dist/`,
  so no test code is packaged) and runs them with `node:test`. Fixtures are
  JSON files under `tests/fixtures/`. Covered: the API response validators,
  cookie-jar merging, controller URL normalization, the hardened HTTP
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
│   │   ├── omada-validators.ts, cookie-jar.ts, url.ts # Pure, unit-tested helpers
│   │   └── preload.ts  # Preload script for secure IPC
│   ├── renderer/       # Renderer process (Browser), bundled by esbuild
│   │   ├── index.html  # Main HTML
│   │   ├── styles.css  # Styles with dark mode support
│   │   ├── renderer.ts # Entry module: event wiring and startup
│   │   └── *.ts        # UI modules (state, i18n, lists, modals, connection, ...)
│   └── shared/         # Shared types
│       └── types.ts    # TypeScript interfaces
├── scripts/            # Build and test scripts (renderer bundle, unit-test runner)
├── tests/              # unit/ (node:test), smoke/ (Playwright GUI smoke), fixtures/ (JSON)
├── assets/             # Icons and resources
├── dist/               # Compiled JavaScript (generated)
└── release/            # Packaged applications (generated)
```

## Security Notes

- SSL certificate validation is bypassed only for the configured Omada Controller URL
- The application uses Electron's `contextIsolation` and disables `nodeIntegration` for security
- IPC communication is limited to specific, validated channels

## License

MIT
