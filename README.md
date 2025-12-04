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

- Node.js 18+
- npm or yarn
- TP-Link Omada Controller (tested with controller version 5.x)

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
# Watch for TypeScript changes
npm run watch

# Run the app (after building)
npm start
```

## Project Structure

```
omada-electron/
├── src/
│   ├── main/           # Main process (Node.js)
│   │   ├── index.ts    # Entry point, window management, IPC handlers
│   │   ├── config.ts   # Configuration file management
│   │   ├── omada-api.ts # Omada Controller API client
│   │   └── preload.ts  # Preload script for secure IPC
│   ├── renderer/       # Renderer process (Browser)
│   │   ├── index.html  # Main HTML
│   │   ├── styles.css  # Styles with dark mode support
│   │   └── renderer.ts # UI logic
│   └── shared/         # Shared types
│       └── types.ts    # TypeScript interfaces
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
