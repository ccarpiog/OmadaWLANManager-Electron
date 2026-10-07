// Production transport for the Omada API clients: the hardened transport from
// omada-transport.ts over Electron's net module. This is the only
// Electron-dependent piece of the HTTP stack; index.ts injects it into every
// ControllerSession it creates, which uses it for both its internal client and
// its Open API client (unit tests inject a fake transport instead).

import { net, Session } from 'electron';
import { createHardenedTransport, OmadaTransport } from './omada-transport';

/**
 * Creates the production transport. Every request is sent on the session
 * returned by `getSession()` AT REQUEST TIME — the controller session from
 * ControllerTlsSessions (cert-verify.ts), whose verify proc applies the TOFU
 * certificate pin and which is replaced whenever the trust inputs change — so
 * no request (not even one from an older controller instance) can ride a
 * verdict cached before the change. Stateless otherwise: one instance serves
 * every controller.
 * @param {() => Session} getSession - Returns the current controller session.
 * @returns {OmadaTransport} The transport.
 */
export function createNetTransport(getSession: () => Session): OmadaTransport {
  return createHardenedTransport((options) => net.request({ ...options, session: getSession() }));
}
