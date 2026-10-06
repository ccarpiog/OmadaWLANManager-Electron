// Type declaration for the API the sandboxed preload exposes on the
// contextBridge (src/main/preload.ts). The interface itself lives in
// src/shared/types.ts so the preload and the renderer share one definition.

import type { OmadaAPI } from '../shared/types';

declare global {
  interface Window {
    omadaAPI: OmadaAPI;
  }
}

export {};
