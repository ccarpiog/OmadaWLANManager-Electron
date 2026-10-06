// Controller connection state machine (todo.md 3.12, 1.11 and 4.4). It owns
// every piece of main-process state that decides which controller instance may
// act for the configured controller:
// - the connect generation: every connect, disconnect and controller
//   transition bumps it; an async flow that captured an older value is stale;
// - the installed controller (the one the data/AP-move IPC handlers use);
// - the pending site selection (a connect that authenticated on a multi-site
//   controller parks its controller here until OMADA_SELECT_SITE completes it);
// - the pending certificate trust decision (a first-use rejection's
//   fingerprint, pinned only through CERT_TRUST with the matching nonce);
// - the pin-rejection bookkeeping fed by the certificate hooks.
// index.ts wires the IPC handlers to it. Everything Electron-specific (the
// controller session, config persistence, controller construction) is
// injected, so this module never imports Electron and is unit-tested with fake
// controllers (tests/unit/connection-manager.test.ts).
//
// Controller transitions: a change of the trust inputs that can make an
// authenticated controller illegitimate — a controller URL change
// (applyConfigSave()) or a certificate reset (resetCertificate()) — goes
// through invalidateControllerState(), which in ONE synchronous step bumps the
// generation, consumes the pending trust decision, detaches the pending site
// selection and the installed controller, starts their logouts on the outgoing
// controller session, and switches to a fresh session. Every async flow
// (connect, trust) re-checks after each await that its generation and the
// configured URL are still the ones it started with, and otherwise installs,
// parks and persists nothing (a stale connect is logged out and reported as
// connectionSuperseded, exactly like one overtaken by a newer connect).

import { randomBytes } from 'crypto';
import { CertificateActionResult, ConnectionResult } from '../shared/types';
import { CertificatePin, CertificatePinRejection, controllerOriginOf, isValidFingerprint, normalizeHostname } from './cert-pinning';
import type { ConnectOutcome } from './omada-api';

// Upper bound for how long the outgoing controller session is kept open so the
// logouts of the controllers detached by a transition can complete on it
// (a slow or unreachable controller must not delay the transition for long)
export const DEFAULT_LOGOUT_DRAIN_MS = 3000;

/**
 * What the state machine needs from a controller instance (OmadaController in
 * production, a fake in the unit tests).
 */
export interface ManagedController {
  connect(preferredSiteId?: string): Promise<ConnectOutcome>;
  selectSite(siteId: string): boolean;
  logout(): Promise<void>;
}

/**
 * The stored connection credentials (decrypted in the main process only).
 */
export interface ConnectionCredentials {
  url: string;
  username: string;
  password: string;
}

/**
 * Injected dependencies (index.ts: config.ts, OmadaController and the
 * ControllerTlsSessions of cert-verify.ts).
 */
export interface ConnectionManagerDeps<C extends ManagedController> {
  // The stored credentials (the password decrypted in the main process)
  getCredentials(): ConnectionCredentials;
  // Creates a controller client; nothing may be sent before its connect()
  createController(credentials: ConnectionCredentials): C;
  // The configured controller URL ('' when none), read from memory
  getConfiguredUrl(): string;
  // The site id remembered for the configured controller ('' when none)
  getStoredSiteId(): string;
  // Remembers the site id the user chose (write failures are logged there)
  saveStoredSiteId(siteId: string): void;
  // Persists a trusted certificate pin; false when the write failed
  saveCertificatePin(pin: CertificatePin): boolean;
  // Removes the stored pin; false when the write failed
  clearCertificatePin(): boolean;
  // Replaces the controller session. Contract: the switch to the fresh session
  // happens SYNCHRONOUSLY, before this function returns its promise, so every
  // request created afterwards uses the new session. The promise settles once
  // the outgoing session is retired; when `drain` is given, the outgoing
  // session's connections are closed only after `drain` settles (it is
  // already bounded by the caller)
  resetControllerSession(drain?: Promise<void>): Promise<void>;
  // Override of DEFAULT_LOGOUT_DRAIN_MS (the unit tests shorten it)
  logoutDrainMs?: number;
}

/**
 * A connect that authenticated but still needs the user to pick a site.
 * `generation` is the connect generation the attempt captured, `url` the
 * configured URL it connected to, and `nonce` the opaque one-time token the
 * renderer must echo back verbatim through OMADA_SELECT_SITE.
 */
interface PendingSiteSelection<C> {
  controller: C;
  generation: number;
  url: string;
  nonce: string;
}

/**
 * A connect that failed on a first-use rejection: CERT_TRUST pins
 * `fingerprint` (recorded by the verify proc, never supplied by the renderer)
 * for `origin` only while this record is current.
 */
interface PendingCertificateTrust {
  generation: number;
  nonce: string;
  origin: string;
  fingerprint: string;
}

/**
 * Creates an opaque one-time nonce that ties a pending site selection or a
 * pending certificate trust decision to the connect attempt that produced it:
 * 16 random bytes, hex-encoded (32 lowercase hex characters — index.ts checks
 * that format on every nonce coming back over IPC).
 * @returns {string} The freshly generated nonce.
 */
export function createNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Returns a promise that settles once `work` settles or `ms` elapse, whichever
 * comes first, and never rejects. The timer is cleared when `work` settles
 * first, so it never keeps the process alive needlessly.
 * @param {Promise<unknown>} work - The work to wait for.
 * @param {number} ms - Upper bound in milliseconds.
 * @returns {Promise<void>} Resolves when the work settled or the time is up.
 */
export function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    /**
     * Settles the bound early once the work is done (either way).
     */
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    work.then(done, done);
  });
} // End of function settleWithin()

/**
 * The main-process controller connection state machine (see the header).
 */
export class ConnectionManager<C extends ManagedController> {
  private readonly deps: ConnectionManagerDeps<C>;
  private readonly logoutDrainMs: number;
  // See the header: bumped by every connect, disconnect and transition
  private generation = 0;
  private installed: C | null = null;
  private pendingSite: PendingSiteSelection<C> | null = null;
  private pendingTrust: PendingCertificateTrust | null = null;
  // The most recent first-use / mismatch rejection reported by the
  // certificate hooks, numbered so connect() can tell whether ITS attempt
  // caused it (sequence greater than the value captured before the attempt)
  private lastPinRejection: (CertificatePinRejection & { sequence: number }) | null = null;
  private pinRejectionSequence = 0;
  // True when a pin rejection was recorded since the controller session was
  // last replaced. The network service caches the verify proc's verdict per
  // certificate + hostname, so after a rejection the next connect starts from
  // a fresh controller session — otherwise the cached rejection would fail it
  // without running (and recording) the verify proc again
  private pinRejectionSinceReset = false;

  /**
   * Creates the state machine (nothing installed, nothing pending).
   * @param {ConnectionManagerDeps<C>} deps - The injected dependencies.
   */
  constructor(deps: ConnectionManagerDeps<C>) {
    this.deps = deps;
    this.logoutDrainMs = deps.logoutDrainMs ?? DEFAULT_LOGOUT_DRAIN_MS;
  }

  /**
   * The installed controller (null when not connected). Only this instance
   * may serve the data and AP-move IPC handlers.
   * @returns {C | null} The installed controller, or null.
   */
  get controller(): C | null {
    return this.installed;
  }

  /**
   * Records a first-use or mismatch rejection reported by the certificate
   * hooks (index.ts: CertificateTrustSource.onPinRejection).
   * @param {CertificatePinRejection} rejection - The rejection.
   */
  recordPinRejection(rejection: CertificatePinRejection): void {
    this.pinRejectionSequence++;
    this.lastPinRejection = { ...rejection, sequence: this.pinRejectionSequence };
    this.pinRejectionSinceReset = true;
  }

  /**
   * True while an async flow that captured `generation` for the configured
   * URL `url` may still act: no connect, disconnect or transition started
   * since, and the configured URL is unchanged (the second test is a
   * belt-and-braces check — every URL change also bumps the generation).
   * @param {number} generation - The generation the flow captured.
   * @param {string} url - The configured URL the flow started with.
   * @returns {boolean} True when the flow is still current.
   */
  private isCurrent(generation: number, url: string): boolean {
    return generation === this.generation && this.deps.getConfiguredUrl() === url;
  }

  /**
   * Best-effort logout that never rejects (logout() swallows network errors
   * itself; this guard only keeps an unexpected rejection from surfacing).
   * @param {C} controller - The controller to log out.
   * @returns {Promise<void>} Settles when the logout attempt is over.
   */
  private logoutQuietly(controller: C): Promise<void> {
    return controller.logout().catch((error) => {
      console.warn('Error releasing a controller session:', error);
    });
  }

  /**
   * Fire-and-forget release of a controller instance that lost its right to
   * act (superseded attempt, replaced predecessor, failed connect).
   * @param {C} controller - The controller to log out and drop.
   */
  private releaseController(controller: C): void {
    void this.logoutQuietly(controller);
  }

  /**
   * Replaces the controller session (see the resetControllerSession()
   * contract: the switch itself is synchronous) and clears the
   * rejection-since-reset flag, since the fresh session has no cached verdict.
   * @param {Promise<void>} [drain] - Settles when the outgoing session may close.
   * @returns {Promise<void>} Settles once the outgoing session is retired.
   */
  private resetSession(drain?: Promise<void>): Promise<void> {
    this.pinRejectionSinceReset = false;
    return this.deps.resetControllerSession(drain);
  }

  /**
   * Discards the pending site-selection record, if any, releasing its parked
   * controller (best-effort logout). Once discarded, a later selectSite() or
   * nonce-scoped disconnect() for that record is rejected as stale.
   */
  private discardPendingSiteSelection(): void {
    if (this.pendingSite) {
      const pending = this.pendingSite;
      this.pendingSite = null;
      this.releaseController(pending.controller);
    }
  }

  /**
   * Synchronously invalidates every controller-related state: bumps the
   * generation (so any in-flight connect or trust flow becomes stale), drops
   * the pending certificate trust decision, and detaches the pending site
   * selection's controller and the installed controller. The caller owns the
   * returned controllers and must log them out.
   * Used by disconnect(), by invalidateControllerState() and on quit.
   * @returns {C[]} The detached controllers (installed and/or parked).
   */
  detachAll(): C[] {
    this.generation++;
    this.pendingTrust = null;
    const detached: C[] = [];
    if (this.pendingSite) {
      detached.push(this.pendingSite.controller);
      this.pendingSite = null;
    }
    if (this.installed) {
      detached.push(this.installed);
      this.installed = null;
    }
    return detached;
  } // End of function detachAll()

  /**
   * The atomic controller transition required when the trust inputs change
   * (controller URL changed, certificate pin reset). Everything up to the
   * session switch runs synchronously, so no other IPC handler can observe a
   * half-done transition: detachAll() (generation bump, pending trust and
   * site selection dropped, installed controller detached), then the detached
   * controllers' logouts are STARTED — their requests are created now, on
   * the outgoing session, which can still reach the controller they were
   * authenticated with — and then the controller session is replaced. The
   * outgoing session is closed once those logouts settle (bounded by the
   * drain limit). Any flow that was in flight finds its generation stale
   * after its next await and installs or persists nothing.
   * @returns {Promise<void>} Settles once the outgoing session is retired.
   */
  private invalidateControllerState(): Promise<void> {
    const detached = this.detachAll();
    const logouts = detached.map((controller) => this.logoutQuietly(controller));
    const drain = logouts.length > 0 ? settleWithin(Promise.all(logouts), this.logoutDrainMs) : undefined;
    return this.resetSession(drain);
  } // End of function invalidateControllerState()

  /**
   * Applies a configuration save together with the controller transition it
   * requires. `save` persists the new config synchronously (config.ts
   * saveConfig()); when it reports a controller URL change, the transition
   * (invalidateControllerState()) follows in the same synchronous step, so
   * there is no instant where the new URL is configured while an attempt,
   * site selection, trust decision, controller or TLS session of the old one
   * is still valid. A save that keeps the URL leaves the connection alone.
   * @param {() => R} save - Persists the config; reports success and urlChanged.
   * @returns {Promise<R>} The save result, once the transition (if any) is done.
   */
  async applyConfigSave<R extends { success: boolean; urlChanged?: boolean }>(save: () => R): Promise<R> {
    const result = save();
    if (result.success && result.urlChanged) {
      await this.invalidateControllerState();
    }
    return result;
  } // End of function applyConfigSave()

  /**
   * Turns a connect failure caused by a certificate pin rejection into the
   * matching result. Only a rejection recorded AFTER `rejectionMark` (i.e.
   * during this attempt) for the configured controller's hostname counts. A
   * first-use rejection parks a pending trust record (fingerprint as recorded
   * by the verify proc, origin, generation, fresh nonce) and returns
   * certificateUntrusted with the nonce; a mismatch returns certificateChanged
   * with both fingerprints (no nonce: the dialog offers no trust action — the
   * user resets the pin explicitly in Settings).
   * @param {number} rejectionMark - pinRejectionSequence before the attempt.
   * @param {string} url - The configured controller URL the attempt used.
   * @param {number} generation - The attempt's connect generation.
   * @returns {ConnectionResult | null} The certificate result, or null when the
   *   failure was not a pin rejection.
   */
  private certificateRejectionResult(rejectionMark: number, url: string, generation: number): ConnectionResult | null {
    const rejection = this.lastPinRejection;
    const origin = controllerOriginOf(url);
    if (!rejection || rejection.sequence <= rejectionMark || !origin) {
      return null;
    }
    const parsedOrigin = new URL(origin);
    if (rejection.hostname !== normalizeHostname(parsedOrigin.hostname) || !isValidFingerprint(rejection.fingerprint)) {
      return null;
    }
    if (rejection.kind === 'mismatch') {
      return {
        success: false,
        error: 'certificateChanged',
        certificate: { host: parsedOrigin.host, fingerprint: rejection.fingerprint, pinnedFingerprint: rejection.pinnedFingerprint }
      };
    }
    const nonce = createNonce();
    this.pendingTrust = { generation, nonce, origin, fingerprint: rejection.fingerprint };
    return {
      success: false,
      error: 'certificateUntrusted',
      certificate: { host: parsedOrigin.host, fingerprint: rejection.fingerprint },
      trustNonce: nonce
    };
  } // End of function certificateRejectionResult()

  /**
   * OMADA_CONNECT. The controller is created in a LOCAL variable and
   * installed only after authentication succeeds while the attempt is still
   * current (isCurrent() after every await); a stale attempt is logged out and
   * reported as connectionSuperseded. A newer connect supersedes any pending
   * site selection and trust decision. Multi-site (todo.md 1.11): with no
   * pickable site the controller is parked as a pending site selection (not
   * installed) and needsSiteSelection is returned with an opaque nonce.
   * Certificate pinning (todo.md 4.4): the very first request (/api/info) is
   * already gated by the verify proc, so on a pin rejection the login POST is
   * never sent; the failure is reported as certificateUntrusted (with a trust
   * nonce) or certificateChanged.
   * @returns {Promise<ConnectionResult>} The connect result.
   */
  async connect(): Promise<ConnectionResult> {
    const generation = ++this.generation;
    this.discardPendingSiteSelection();
    this.pendingTrust = null;
    const credentials = this.deps.getCredentials();

    if (!credentials.url || !credentials.username || !credentials.password) {
      return { success: false, error: 'configIncomplete' };
    }

    // After a pin rejection the network service may answer the next handshake
    // from its verdict cache without consulting the verify proc: start from a
    // fresh controller session so the rejection is evaluated (and recorded)
    // again — e.g. a user who cancelled the first-use dialog sees it again
    if (this.pinRejectionSinceReset) {
      await this.resetSession();
      if (!this.isCurrent(generation, credentials.url)) {
        return { success: false, error: 'connectionSuperseded' };
      }
    }
    const rejectionMark = this.pinRejectionSequence;

    const controller = this.deps.createController(credentials);
    try {
      const outcome = await controller.connect(this.deps.getStoredSiteId());

      if (!this.isCurrent(generation, credentials.url)) {
        // Superseded while authenticating (newer connect, disconnect, URL
        // change or certificate reset): discard this attempt entirely
        this.releaseController(controller);
        return { success: false, error: 'connectionSuperseded' };
      }

      // This attempt owns the session now: release any previously installed
      // controller so repeated connects cannot leak sessions
      const previous = this.installed;
      this.installed = null;
      if (previous) {
        this.releaseController(previous);
      }

      if (!outcome.siteSelected) {
        // Park the controller until the user picks a site: selectSite() must
        // echo this nonce and succeeds only while this record is current
        const nonce = createNonce();
        this.pendingSite = { controller, generation, url: credentials.url, nonce };
        return { success: false, needsSiteSelection: true, sites: outcome.sites, selectionNonce: nonce };
      }

      this.installed = controller;
      return { success: true };
    } catch (error) {
      console.error('Error connecting to the Omada controller:', error);
      // The login may have partially succeeded before the failure: log the
      // local controller out best-effort (it was never installed)
      this.releaseController(controller);
      if (!this.isCurrent(generation, credentials.url)) {
        return { success: false, error: 'connectionSuperseded' };
      }
      const certificateResult = this.certificateRejectionResult(rejectionMark, credentials.url, generation);
      if (certificateResult) {
        return certificateResult;
      }
      const detail = error instanceof Error ? error.message : String(error);
      return { success: false, error: 'connectError', detail };
    }
  } // End of function connect()

  /**
   * OMADA_SELECT_SITE: completes the pending connection that returned
   * needsSiteSelection. Accepted only for the CURRENT pending record (exact
   * nonce, unchanged generation and configured URL) and an id from the
   * controller's authorized-site list; the controller is installed and the
   * id persisted only then. Synchronous on purpose: there is no await
   * between the ownership check and the install/persist.
   * @param {string} siteId - The chosen site id (format-checked by index.ts).
   * @param {string} nonce - The selection nonce echoed by the renderer.
   * @returns {ConnectionResult} Success, or siteUnavailable.
   */
  selectSite(siteId: string, nonce: string): ConnectionResult {
    const pending = this.pendingSite;
    if (!pending || pending.nonce !== nonce || !this.isCurrent(pending.generation, pending.url)) {
      // No selection is pending, or the caller does not own the current one
      return { success: false, error: 'siteUnavailable' };
    }
    if (!pending.controller.selectSite(siteId)) {
      return { success: false, error: 'siteUnavailable' };
    }
    // Selection complete: consume the record and install its controller.
    // `previous` is null by construction (the connect that parked the record
    // released its predecessor) — released defensively regardless
    this.pendingSite = null;
    const previous = this.installed;
    this.installed = pending.controller;
    if (previous) {
      this.releaseController(previous);
    }
    this.deps.saveStoredSiteId(siteId);
    return { success: true };
  } // End of function selectSite()

  /**
   * OMADA_DISCONNECT. Without a nonce: unconditional disconnect — detachAll()
   * (any in-flight connect becomes stale, pending decisions are dropped) and
   * both detached controllers are logged out. With a selection nonce: an
   * ownership-scoped abort of the CURRENT pending site selection only — a
   * stale caller's call is a no-op, so it can never log out a session a newer
   * flow installed or parked.
   * @param {string} [nonce] - Selection nonce (format-checked by index.ts).
   * @returns {Promise<void>} Settles once the logouts are over.
   */
  async disconnect(nonce?: string): Promise<void> {
    if (nonce !== undefined) {
      const pending = this.pendingSite;
      if (!pending || pending.nonce !== nonce || pending.generation !== this.generation) {
        return;
      }
      // Abort the owned pending selection: invalidate the generation (so the
      // record can never be resurrected) and log its parked controller out
      this.generation++;
      this.pendingSite = null;
      await this.logoutQuietly(pending.controller);
      return;
    }
    const detached = this.detachAll();
    await Promise.all(detached.map((controller) => this.logoutQuietly(controller)));
  } // End of function disconnect()

  /**
   * CERT_TRUST ("Trust and connect"): pins the fingerprint recorded for the
   * CURRENT pending first-use record (exact nonce, unchanged generation, the
   * configured origin still the one the certificate was presented for), then
   * replaces the controller session so the renderer's reconnect is verified
   * afresh against the new pin. After that await the generation is checked
   * again: when a newer connect, a disconnect or a transition happened
   * meanwhile, the stale flow is told trustUnavailable (a transition has also
   * removed the pin again) so it does not go on to reconnect.
   * @param {string} nonce - The trust nonce (format-checked by index.ts).
   * @returns {Promise<CertificateActionResult>} The action result.
   */
  async trustCertificate(nonce: string): Promise<CertificateActionResult> {
    const pending = this.pendingTrust;
    if (
      !pending ||
      pending.nonce !== nonce ||
      pending.generation !== this.generation ||
      pending.origin !== controllerOriginOf(this.deps.getConfiguredUrl()) ||
      !isValidFingerprint(pending.fingerprint)
    ) {
      return { success: false, error: 'trustUnavailable' };
    }
    // One-time: consume the record before acting on it
    this.pendingTrust = null;
    const saved = this.deps.saveCertificatePin({ origin: pending.origin, sha256: pending.fingerprint, trustedAt: new Date().toISOString() });
    if (!saved) {
      return { success: false, error: 'saveFailed' };
    }
    await this.resetSession();
    if (pending.generation !== this.generation) {
      return { success: false, error: 'trustUnavailable' };
    }
    return { success: true };
  } // End of function trustCertificate()

  /**
   * CERT_RESET ("Reset trusted certificate"): removes the pin and runs the
   * controller transition in the same synchronous step, regardless of what
   * the renderer did before: any in-flight connect becomes stale, pending
   * decisions are dropped, the installed controller is detached and logged
   * out, and the controller session is replaced — so neither a controller nor
   * a cached acceptance nor a pooled connection outlives the reset. The
   * transition also runs when the pin could not be removed (fail-safe: the
   * user asked to stop trusting it). The result always reports
   * connectionReset, so the renderer mirrors the disconnection.
   * @returns {Promise<CertificateActionResult>} The action result.
   */
  async resetCertificate(): Promise<CertificateActionResult> {
    const cleared = this.deps.clearCertificatePin();
    await this.invalidateControllerState();
    return cleared ? { success: true, connectionReset: true } : { success: false, error: 'saveFailed', connectionReset: true };
  } // End of function resetCertificate()
} // End of class ConnectionManager
