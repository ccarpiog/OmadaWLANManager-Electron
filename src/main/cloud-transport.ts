// The TP-Link cloud's network path (docs/omada-cloud-openapi.md §8). Only
// TYPES are imported from 'electron', so this compiled module can be loaded by
// the unit tests and by the opt-in TLS probe (tests/tls-probe/probe-main.cjs)
// exactly as the app uses it; net-transport.ts adds Electron's net module.
//
// - Session: cloud requests use their own in-memory Electron session partition
//   (CLOUD_SESSION_PARTITION, no "persist:" prefix), never the controller's
//   pinned ControllerTlsSessions session nor the default session. It keeps
//   Chromium's normal certificate verification: no verify proc is installed
//   (setCertificateVerifyProc(null) is called explicitly), so no TOFU pin,
//   no self-signed exception and no certificate dialog can apply to it; the
//   app's pin code additionally never accepts a certificate for a cloud API
//   host (decideCertificate() in cert-pinning.ts).
// - Origin allowlist (defense in depth): the cloud transport refuses every
//   request whose URL is not on an allowlisted cloud API origin
//   (isAllowlistedCloudUrl(), cloud-hosts.ts) before anything is sent, so the
//   access token cannot leave for another host even through a programming
//   error; redirects are refused too (net-transport.ts: redirect 'error').

import type { Session } from 'electron';
import { isAllowlistedCloudUrl } from './cloud-hosts';
import type { OmadaTransport } from './omada-transport';

// The cloud session's partition (in memory: nothing is written to disk)
export const CLOUD_SESSION_PARTITION = 'omada-cloud-account';

// The rejection of a request outside the allowlist (fixed text: the URL is
// never quoted)
export const CLOUD_ORIGIN_REFUSED_MESSAGE = 'Cloud request refused: not an allowlisted TP-Link cloud API origin';

/**
 * Creates the cloud session: an in-memory partition with Chromium's own
 * certificate verification (any verify proc removed explicitly).
 * @param {(partition: string) => Session} fromPartition - Session factory
 *   (the app passes session.fromPartition; requires the app to be ready).
 * @returns {Session} The cloud session.
 */
export function createCloudSession(fromPartition: (partition: string) => Session): Session {
  const created = fromPartition(CLOUD_SESSION_PARTITION);
  created.setCertificateVerifyProc(null);
  return created;
}

/**
 * Wraps a transport so it only ever sends to an allowlisted cloud API origin;
 * any other URL is refused before the inner transport is called.
 * @param {OmadaTransport} inner - The transport that sends.
 * @returns {OmadaTransport} The guarded transport.
 */
export function createAllowlistedCloudTransport(inner: OmadaTransport): OmadaTransport {
  return {
    send: (request, onResponseHeaders) => {
      if (!isAllowlistedCloudUrl(request.url)) {
        return Promise.reject(new Error(CLOUD_ORIGIN_REFUSED_MESSAGE));
      }
      return inner.send(request, onResponseHeaders);
    }
  };
} // End of function createAllowlistedCloudTransport()
