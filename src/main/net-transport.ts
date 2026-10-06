// Production transport for the Omada API client: the hardened transport from
// omada-transport.ts over Electron's net module. This is the only
// Electron-dependent piece of the HTTP stack; index.ts injects it into every
// OmadaController it creates (unit tests inject a fake transport instead).

import { net } from 'electron';
import { createHardenedTransport, OmadaTransport } from './omada-transport';

// Stateless, so one instance serves every controller. Electron's net module
// handles SSL certificates via the app's certificate verify proc (index.ts)
export const netTransport: OmadaTransport = createHardenedTransport((options) => net.request(options));
