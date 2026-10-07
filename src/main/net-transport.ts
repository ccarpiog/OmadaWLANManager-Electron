// Production transports for the Omada API clients: the hardened transport
// from omada-transport.ts over Electron's net module. This is the only
// Electron-dependent piece of the HTTP stack; index.ts injects the controller
// transport into every ControllerSession it creates, which uses it for both
// its internal client and its Open API client, and the cloud transport into
// the TP-Link cloud access (unit tests inject a fake transport instead).

import { net, Session } from 'electron';
import { createAllowlistedCloudTransport } from './cloud-transport';
import { createHardenedTransport, OmadaTransport } from './omada-transport';

/**
 * Creates the production controller transport. Every request is sent on the
 * session returned by `getSession()` AT REQUEST TIME — the controller session
 * from ControllerTlsSessions (cert-verify.ts), whose verify proc applies the
 * TOFU certificate pin and which is replaced whenever the trust inputs change
 * — so no request (not even one from an older controller instance) can ride a
 * verdict cached before the change. Stateless otherwise: one instance serves
 * every controller.
 * @param {() => Session} getSession - Returns the current controller session.
 * @returns {OmadaTransport} The transport.
 */
export function createNetTransport(getSession: () => Session): OmadaTransport {
  return createHardenedTransport((options) => net.request({ ...options, session: getSession() }));
}

/**
 * Creates the production cloud transport (cloud-transport.ts): the hardened
 * transport over Electron's net module on the cloud session (its own
 * partition, Chromium's normal certificate verification), behind the cloud
 * origin allowlist; a redirect fails the request instead of being followed,
 * so the token cannot be carried to another host.
 * @param {() => Session} getSession - Returns the cloud session.
 * @returns {OmadaTransport} The transport.
 */
export function createCloudNetTransport(getSession: () => Session): OmadaTransport {
  return createAllowlistedCloudTransport(
    createHardenedTransport((options) => net.request({ ...options, session: getSession(), redirect: 'error' }))
  );
}
