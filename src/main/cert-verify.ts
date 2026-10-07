// Certificate verification glue: applies the TOFU decision (cert-pinning.ts)
// to Electron's two certificate hooks and gives the controller requests a TLS
// state that can be thrown away when the trust inputs change. Electron objects
// are passed in (only TYPES are imported from 'electron'), so this compiled
// module requires nothing but ./cert-pinning and can be loaded by the opt-in
// TLS probe (tests/tls-probe/) exactly as the app uses it.
//
// Cache / pooled-connection handling (measured by the TLS probe on Electron
// 44.5.1): the network service caches the verify proc's VERDICT per
// certificate + hostname (not per port) and reuses pooled keep-alive TLS
// connections. Neither session.closeAllConnections() nor re-installing the
// verify proc clears that verdict cache: after one first-use rejection the
// proc is never consulted again for that certificate, so the retry after
// "trust" would keep failing, and after a reset a cached acceptance (or a
// pooled connection) would keep accepting the old certificate. The only way
// to drop it is a new network context, so controller requests go through a
// dedicated in-memory session partition (ControllerTlsSessions) that is
// replaced by a fresh one — new verifier cache, socket pool and TLS session
// cache, with the verify proc installed — whenever the trust inputs change.

import type { Certificate, Session } from 'electron';
import {
  CertificateDecision,
  CertificatePin,
  CertificatePinRejection,
  computeCertificateFingerprint,
  decideCertificate,
  decideCertificateError,
  normalizeHostname
} from './cert-pinning';
import { redactErrorMessage } from './redact';

/**
 * Where the verification hooks read their trust inputs from (index.ts: the
 * in-memory config cache — the verify proc is a hot path and must never touch
 * the filesystem) and where they report actionable rejections.
 */
export interface CertificateTrustSource {
  // The configured controller URL ('' when none)
  getConfiguredUrl(): string;
  // The stored pin, or null
  getCertificatePin(): CertificatePin | null;
  // Called for every first-use or mismatch rejection, BEFORE the TLS
  // handshake is failed (so the record exists when the request errors out)
  onPinRejection(rejection: CertificatePinRejection): void;
}

/**
 * Runs the TOFU decision for one presented certificate and reports a
 * first-use or mismatch rejection to the trust source.
 * @param {CertificateTrustSource} source - Trust inputs and rejection sink.
 * @param {CertificateDecision} decision - The decision already taken.
 * @param {string} hostname - Hostname the certificate was presented for.
 */
function reportRejection(source: CertificateTrustSource, decision: CertificateDecision, hostname: string): void {
  if (decision.action === 'reject-first-use') {
    source.onPinRejection({ kind: 'first-use', hostname: normalizeHostname(hostname), fingerprint: decision.fingerprint });
  } else if (decision.action === 'reject-mismatch') {
    source.onPinRejection({
      kind: 'mismatch',
      hostname: normalizeHostname(hostname),
      fingerprint: decision.fingerprint,
      pinnedFingerprint: decision.pinnedFingerprint
    });
  }
} // End of function reportRejection()

/**
 * The verify-proc side: decides for one verification request (hostname +
 * Chromium's result + presented leaf certificate) and reports rejections.
 * @param {CertificateTrustSource} source - Trust inputs and rejection sink.
 * @param {string} hostname - Request hostname (no port).
 * @param {string} verificationResult - Chromium's verification result.
 * @param {Certificate | undefined} certificate - The presented certificate.
 * @returns {CertificateDecision} The decision.
 */
export function evaluateCertificate(
  source: CertificateTrustSource,
  hostname: string,
  verificationResult: string,
  certificate: Certificate | undefined
): CertificateDecision {
  const decision = decideCertificate({
    hostname: hostname || '',
    verificationResult: verificationResult || '',
    fingerprint: computeCertificateFingerprint(certificate?.data),
    configuredUrl: source.getConfiguredUrl(),
    pin: source.getCertificatePin()
  });
  reportRejection(source, decision, hostname || '');
  return decision;
} // End of function evaluateCertificate()

/**
 * Maps a decision to the verify proc's callback value: 0 accepts, -2 fails,
 * -3 keeps Chromium's own verdict.
 * @param {CertificateDecision} decision - The decision.
 * @returns {number} The callback value.
 */
export function verifyProcResult(decision: CertificateDecision): number {
  switch (decision.action) {
    case 'accept':
      return 0;
    case 'default':
      return -3;
    default:
      return -2;
  }
} // End of function verifyProcResult()

/**
 * Installs the certificate verify proc on a session. This proc is what lets
 * net.request() reach a controller with a self-signed certificate (app
 * 'certificate-error' only covers webContents loads), and it runs on every
 * TLS verification Chromium does not answer from its cache, so the source
 * must read from memory. Its verdicts are cached by the session's network
 * context, which only a new session drops (see ControllerTlsSessions).
 * @param {Session} targetSession - The session (the app uses session.defaultSession).
 * @param {CertificateTrustSource} source - Trust inputs and rejection sink.
 */
export function installCertificateVerifyProc(targetSession: Session, source: CertificateTrustSource): void {
  targetSession.setCertificateVerifyProc((request, callback) => {
    let decision: CertificateDecision;
    try {
      decision = evaluateCertificate(source, request.hostname, request.verificationResult, request.certificate);
    } catch (error) {
      // Never let an unexpected error accept anything: keep Chromium's verdict
      console.error('Certificate verification error:', redactErrorMessage(error));
      decision = { action: 'default' };
    }
    callback(verifyProcResult(decision));
  }); // End of the certificate verify proc
} // End of function installCertificateVerifyProc()

/**
 * The 'certificate-error' side (webContents loads): true when the load may
 * proceed, i.e. the URL's origin is exactly the configured origin AND the
 * certificate matches the pin (the same decision as the verify proc).
 * Rejections are reported like the verify proc's.
 * @param {CertificateTrustSource} source - Trust inputs and rejection sink.
 * @param {string} url - The URL whose load failed verification.
 * @param {string} error - Chromium's error string.
 * @param {Certificate | undefined} certificate - The presented certificate.
 * @returns {boolean} True to allow the load (callback(true)).
 */
export function isCertificateErrorAllowed(
  source: CertificateTrustSource,
  url: string,
  error: string,
  certificate: Certificate | undefined
): boolean {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Malformed URL: decideCertificateError() keeps the rejection
  }
  const decision = decideCertificateError({
    url,
    error: error || '',
    fingerprint: computeCertificateFingerprint(certificate?.data),
    configuredUrl: source.getConfiguredUrl(),
    pin: source.getCertificatePin()
  });
  reportRejection(source, decision, hostname);
  return decision.action === 'accept';
} // End of function isCertificateErrorAllowed()

/**
 * The session controller requests use, replaceable as a whole. Each instance
 * of the session is an in-memory partition (no "persist:" prefix: nothing is
 * written to disk) with the verify proc installed; reset() switches to a
 * brand-new partition, so no verdict cached by the old network context, no
 * pooled connection and no resumable TLS session can influence the next
 * verification. Electron keeps a partition's session alive for the life of
 * the app, so resets are limited to trust-input changes (see index.ts) —
 * a handful per run, not one per request.
 */
export class ControllerTlsSessions {
  private readonly fromPartition: (partition: string) => Session;
  private readonly source: CertificateTrustSource;
  private readonly partitionPrefix: string;
  private sequence = 0;
  private currentSession: Session;

  /**
   * Creates the first controller session.
   * @param {(partition: string) => Session} fromPartition - Session factory
   *   (the app passes session.fromPartition; requires the app to be ready).
   * @param {CertificateTrustSource} source - Trust inputs and rejection sink.
   * @param {string} [partitionPrefix] - Prefix of the partition names.
   */
  constructor(fromPartition: (partition: string) => Session, source: CertificateTrustSource, partitionPrefix = 'omada-controller-tls') {
    this.fromPartition = fromPartition;
    this.source = source;
    this.partitionPrefix = partitionPrefix;
    this.currentSession = this.createSession();
  }

  /**
   * The session every controller request must use right now.
   * @returns {Session} The current controller session.
   */
  get session(): Session {
    return this.currentSession;
  }

  /**
   * Replaces the controller session with a fresh partition (fresh verifier
   * cache, socket pool and TLS session cache) and closes the old session's
   * connections. The switch happens synchronously, before the first await,
   * so every request created once this call has returned its promise uses
   * the new session. When `drain` is given (connection-manager.ts: the
   * logouts of the controllers a transition detached, which were started on
   * the old session), the old session's connections are closed only after it
   * settles — the caller bounds it in time.
   * @param {Promise<void>} [drain] - Settles when the old session may close.
   * @returns {Promise<void>} Settles once the old session's connections are closed.
   */
  async reset(drain?: Promise<void>): Promise<void> {
    const previous = this.currentSession;
    this.currentSession = this.createSession();
    if (drain) {
      await drain;
    }
    try {
      await previous.closeAllConnections();
    } catch (error) {
      console.warn('Could not close the previous controller session\'s connections:', redactErrorMessage(error));
    }
  } // End of function reset()

  /**
   * Creates the next in-memory partition and installs the verify proc on it.
   * @returns {Session} The new session.
   */
  private createSession(): Session {
    this.sequence++;
    const created = this.fromPartition(`${this.partitionPrefix}-${this.sequence}`);
    installCertificateVerifyProc(created, this.source);
    return created;
  }
} // End of class ControllerTlsSessions
