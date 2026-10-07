// Controller connection state machine (todo.md 3.12, 1.11 and 4.4; inbox
// I-1b2b1). It owns every piece of main-process state that decides which
// controller instance may act for the app:
// - the connection target (connection-target.ts): the configured local
//   controller (`{kind: 'local'}`, the default) or a controller of the
//   TP-Link cloud account (`{kind: 'cloud', omadacId}`); switchTarget()
//   changes it;
// - the connect generation: every connect, disconnect, controller
//   transition and target switch bumps it; an async flow that captured an
//   older value is stale;
// - the installed controller (the one the data/AP-move and management-access
//   IPC handlers use; in production a ControllerSession, controller-session.ts);
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
// selection and the installed controller (closing them: a ControllerSession
// drops its Open API client and token and discards its capability checks),
// starts their logouts on the outgoing controller session, and switches to a
// fresh session. Every async flow
// (connect, trust) re-checks after each await that its generation and the
// configured URL are still the ones it started with, and otherwise installs,
// parks and persists nothing (a stale connect is logged out and reported as
// connectionSuperseded, exactly like one overtaken by a newer connect).
//
// A new connect attempt claims the generation and, in the same synchronous
// step, closes the installed controller (ManagedController.close(): a
// ControllerSession drops its Open API client and token, discards its
// capability checks and answers the management-access calls as not
// connected) — see connect() for why its internal client stays installed
// until the attempt succeeds.
//
// Targets (inbox I-1b2b1; spec "ConnectionManager target"): switchTarget()
// runs the very transition of a URL change (invalidateControllerState(),
// synchronous: in-flight connects, the pending site choice and trust
// decision, the installed session — its tokens and its managed reads and
// writes — are superseded, and their late results are dropped), persists
// `activeController` and connects to the new target. A local connect is the
// phase-7 flow above; on success it also learns the controller's omadacId
// (`localOmadacId`, persisted only when it changed). A cloud connect reads a
// FRESH organization entry for the omadacId (CloudConnectionDeps
// .lookupController(): cloud-connect.ts over CloudAccessService), refuses an
// unknown or non-connectable one with a code-first `detail` before any
// session exists, else builds the Open-API-only ControllerSession and
// connects it with the site remembered in `cloudSites[omadacId]`; a site the
// user picks is persisted there, never in the local `siteId`. A cloud
// failure's `detail` starts with its stable code (describeCloudSessionError()).
// A config save that leaves a cloud target without a usable cloud credential
// (Remove cloud access) returns the target to local in the save's own
// synchronous step, together with the transition (applyConfigSave()).
// Wiring (inbox I-1b2b2): OMADA_SWITCH_CONTROLLER calls switchTarget() with a
// target its guard checked (ipc-guards.ts), and index.ts sets the startup
// target with startOn() — resolveStartupTarget(): the stored cloud controller
// while the cloud credential is usable, else local — before the window exists.

import { randomBytes } from 'crypto';
import { CertificateActionResult, ConnectionResult } from '../shared/types';
import { CertificatePin, CertificatePinRejection, controllerOriginOf, isValidFingerprint, normalizeHostname } from './cert-pinning';
import { isOmadacId } from './cloud-account-model';
import { CloudSessionError, describeCloudSessionError } from './cloud-controller-session';
import { activeControllerValue, CloudConnectionTarget, ConnectionTarget, isSameTarget, localTarget, normalizeConnectionTarget } from './connection-target';
import type { ConnectOutcome } from './omada-api';
import { redactErrorMessage, redactText } from './redact';

// Upper bound for how long the outgoing controller session is kept open so the
// logouts of the controllers detached by a transition can complete on it
// (a slow or unreachable controller must not delay the transition for long)
export const DEFAULT_LOGOUT_DRAIN_MS = 3000;

/**
 * What an installed controller adds to a successful connect or site-selection
 * result (ControllerSession: the site name, the session nonce and, for a
 * TP-Link cloud controller only, its name).
 */
export type InstalledDetails = Pick<ConnectionResult, 'siteName' | 'sessionNonce' | 'controllerName'>;

/**
 * What the state machine needs from a controller instance (ControllerSession
 * in production, a fake in the unit tests).
 */
export interface ManagedController {
  connect(preferredSiteId?: string): Promise<ConnectOutcome>;
  selectSite(siteId: string): boolean;
  logout(): Promise<void>;
  // Optional: synchronously drops everything the instance holds besides its
  // server-side session (ControllerSession: the Open API client — its token
  // discarded — and any capability check in flight, whose late result is then
  // ignored). Idempotent. Called when the instance is detached or released,
  // before its logout starts, and when a newer connect attempt starts while
  // it is installed (the instance stays logged in until it is released; the
  // data and AP-move IPC handlers refuse a closed session since inbox I-1b2b2)
  close?(): void;
  // Optional: called synchronously when the instance becomes the installed
  // controller (ControllerSession starts its capability checks here); returns
  // the details the success result carries
  activate?(): InstalledDetails;
  // Optional: the controller id the connect learned (ControllerSession: a
  // local controller's /api/info omadacId; null before it was read). A local
  // connect that installs the instance persists it as `localOmadacId`
  readonly omadacId?: string | null;
  // Optional (inbox I-1c2a): true when the latest connect() failed because
  // the controller never answered at all — its FIRST request got no response
  // (ControllerSession: OmadaController.connectUnreachable, from the
  // transport's typed failure). A failed local connect then carries
  // `unreachable: true`
  readonly connectUnreachable?: boolean;
}

/**
 * What the cloud side found for a cloud target's connect
 * (CloudConnectionDeps.lookupController()): for a connectable organization a
 * factory of its (not yet connected) controller and the values to scrub from
 * a failure by value (the routing identifiers and the account's live
 * secrets); otherwise a stable code with a codes-only diagnostic, and no
 * controller.
 */
export type CloudControllerLookup<C> =
  | { ok: true; create(): C; secrets(): string[] }
  | { ok: false; code: string; diagnostic?: string };

/**
 * The cloud side of the connection targets (index.ts: cloud-connect.ts over
 * CloudAccessService, and config.ts).
 */
export interface CloudConnectionDeps<C> {
  // Reads a FRESH organization entry for the omadacId and, when it is
  // connectable, offers the controller factory (never rejects)
  lookupController(omadacId: string): Promise<CloudControllerLookup<C>>;
  // The site remembered for a cloud controller (`cloudSites`; '' when none)
  getCloudSiteId(omadacId: string): string;
  // Remembers the site the user picked on a cloud controller (`cloudSites`)
  saveCloudSiteId(omadacId: string, siteId: string): void;
  // Whether the cloud credential is usable now (production: config.ts
  // getCloudCredentials() !== null — a cloud Client ID with a secret, the
  // session-only one included; the same test as the startup target). A
  // config save that leaves a cloud target without one returns the target
  // to local (applyConfigSave())
  hasUsableCredential(): boolean;
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
 * Injected dependencies (index.ts: config.ts, ControllerSession and the
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
  // Optional (inbox I-1b2b1; config.ts in production): the omadacId stored
  // for the configured controller ('' when none), and its persistence for the
  // URL a local connect used — called only when a successful local connect
  // learned a different one. Without them nothing is learned
  getLocalOmadacId?(): string;
  saveLocalOmadacId?(url: string, omadacId: string): void;
  // Optional: persists the active controller of a switchTarget() ('local' or
  // a cloud omadacId); false when the write failed. Without it the target is
  // kept in memory only
  saveActiveController?(activeController: string): boolean;
  // Optional: the cloud targets. Without it a cloud target's connect is
  // refused with the detail 'cloudUnavailable'
  cloud?: CloudConnectionDeps<C>;
}

/**
 * A connect that authenticated but still needs the user to pick a site.
 * `generation` is the connect generation the attempt captured, `target` the
 * connection target it connected, `url` the configured URL it connected to
 * ('' for a cloud target), and `nonce` the opaque one-time token the
 * renderer must echo back verbatim through OMADA_SELECT_SITE.
 */
interface PendingSiteSelection<C> {
  controller: C;
  generation: number;
  target: ConnectionTarget;
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
 * The `detail` of a cloud connect refused before any session existed: the
 * stable code first (an account code such as 'notConfigured' or
 * 'credentialInvalid', 'listIncomplete', 'unknownController', or the organization's reason
 * such as 'offline' or 'versionTooOld'), then the codes-only diagnostic
 * without a leading repeat of the code (CloudAccessService diagnostics start
 * with it). Redacted again here.
 * @param {string} code - The stable code.
 * @param {string} [diagnostic] - The codes-only diagnostic.
 * @returns {string} "<code>" or "<code> (<diagnostic>)".
 */
export function cloudRefusalDetail(code: string, diagnostic?: string): string {
  let rest = diagnostic ?? '';
  if (rest === code) {
    rest = '';
  } else if (rest.startsWith(`${code}, `)) {
    rest = rest.slice(code.length + 2);
  }
  return redactText(rest === '' ? code : `${code} (${rest})`);
} // End of function cloudRefusalDetail()

/**
 * The `detail` of a failed connect: a cloud session failure
 * (CloudSessionError) as its code-first text (describeCloudSessionError()),
 * anything else as its redacted message (the local controller's text,
 * unchanged); either way scrubbed of `secrets` by value.
 * @param {unknown} failure - What the connect threw.
 * @param {readonly string[]} secrets - Values to scrub by value.
 * @returns {string} The detail.
 */
export function connectFailureDetail(failure: unknown, secrets: readonly string[]): string {
  if (failure instanceof CloudSessionError) {
    return redactText(describeCloudSessionError(failure.code, failure.diagnostic, failure.openApiCode), secrets);
  }
  return redactErrorMessage(failure, secrets);
}

/**
 * The main-process controller connection state machine (see the header).
 */
export class ConnectionManager<C extends ManagedController> {
  private readonly deps: ConnectionManagerDeps<C>;
  private readonly logoutDrainMs: number;
  // See the header: the controller connect() connects to (local at start)
  private activeTarget: ConnectionTarget = localTarget();
  // See the header: bumped by every connect, disconnect, transition and switch
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
   * The current connection target (a copy): the local controller until
   * switchTarget() names another one.
   * @returns {ConnectionTarget} The target connect() connects to.
   */
  get target(): ConnectionTarget {
    return this.activeTarget.kind === 'cloud' ? { kind: 'cloud', omadacId: this.activeTarget.omadacId } : localTarget();
  }

  /**
   * Sets the target the app starts with (index.ts: resolveStartupTarget() at
   * startup, before the window exists), without the transition, the
   * `activeController` write or the connect of switchTarget(): the stored
   * choice is not rewritten — a local fallback for an unusable cloud
   * credential must leave `activeController` as stored. Accepted only while
   * nothing has happened yet (no connect, disconnect, transition or switch
   * ran; nothing installed or pending); a later call changes nothing.
   * @param {ConnectionTarget} target - `{kind: 'local'}` or `{kind: 'cloud', omadacId}`.
   * @returns {boolean} True when the target was set.
   * @throws {Error} Before any state change, when `target` is not a valid target.
   */
  startOn(target: ConnectionTarget): boolean {
    const next = normalizeConnectionTarget(target);
    if (next === null) {
      throw new Error('Connection target rejected: not a local or cloud target');
    }
    if (this.generation !== 0 || this.installed !== null || this.pendingSite !== null || this.pendingTrust !== null) {
      return false;
    }
    this.activeTarget = next;
    return true;
  } // End of function startOn()

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
   * True while an async flow that captured `generation` for `target` (and,
   * for the local target, the configured URL `url`) may still act: no
   * connect, disconnect, transition or switch started since, the target is
   * unchanged and, locally, so is the configured URL (the last two are
   * belt-and-braces checks — every switch and every URL change also bumps the
   * generation).
   * @param {number} generation - The generation the flow captured.
   * @param {string} url - The configured URL the flow started with ('' for a cloud target).
   * @param {ConnectionTarget} target - The target the flow connects.
   * @returns {boolean} True when the flow is still current.
   */
  private isCurrent(generation: number, url: string, target: ConnectionTarget): boolean {
    if (generation !== this.generation || !isSameTarget(target, this.activeTarget)) {
      return false;
    }
    return target.kind === 'cloud' || this.deps.getConfiguredUrl() === url;
  }

  /**
   * Best-effort logout that never rejects (logout() swallows network errors
   * itself; this guard only keeps an unexpected rejection from surfacing).
   * The instance is closed first (close(), synchronous), so nothing but the
   * logout itself can still go out for it.
   * @param {C} controller - The controller to log out.
   * @returns {Promise<void>} Settles when the logout attempt is over.
   */
  private logoutQuietly(controller: C): Promise<void> {
    controller.close?.();
    return controller.logout().catch((error) => {
      console.warn('Error releasing a controller session:', redactErrorMessage(error));
    });
  }

  /**
   * Makes `controller` the installed controller and activates it
   * (ManagedController.activate(): a ControllerSession starts its capability
   * checks), returning the success result with the details it reports.
   * Synchronous: callers have just verified that their flow is current.
   * @param {C} controller - The controller that now owns the session.
   * @returns {ConnectionResult} The success result.
   */
  private install(controller: C): ConnectionResult {
    this.installed = controller;
    const details = controller.activate?.();
    return details ? { success: true, ...details } : { success: true };
  }

  /**
   * install() for the attempt of `target`; a local controller's omadacId is
   * learned right after (learnLocalOmadacId()). Synchronous, like install().
   * @param {C} controller - The controller that now owns the session.
   * @param {string} url - The configured URL the attempt used ('' for a cloud target).
   * @param {ConnectionTarget} target - The attempt's target.
   * @returns {ConnectionResult} The success result.
   */
  private installFor(controller: C, url: string, target: ConnectionTarget): ConnectionResult {
    const result = this.install(controller);
    if (target.kind === 'local') {
      this.learnLocalOmadacId(controller, url);
    }
    return result;
  }

  /**
   * Persists the omadacId a successful local connect learned (the internal
   * client read it from /api/info), only when it is usable and differs from
   * the stored one; the persistence ties it to `url` (config.ts drops a
   * value for another URL, and a URL change drops the stored one).
   * @param {C} controller - The installed local controller.
   * @param {string} url - The configured URL the connect used.
   */
  private learnLocalOmadacId(controller: C, url: string): void {
    const omadacId = controller.omadacId;
    if (!this.deps.saveLocalOmadacId || !isOmadacId(omadacId)) {
      return;
    }
    if (this.deps.getLocalOmadacId?.() === omadacId) {
      return;
    }
    this.deps.saveLocalOmadacId(url, omadacId);
  } // End of function learnLocalOmadacId()

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
   * the pending certificate trust decision, and detaches and closes
   * (ManagedController.close(): the Open API client and its token are dropped,
   * capability checks in flight are discarded) the pending site selection's
   * controller and the installed controller. The caller owns the returned
   * controllers and must log them out.
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
    for (const controller of detached) {
      controller.close?.();
    }
    return detached;
  } // End of function detachAll()

  /**
   * The atomic controller transition required when the trust inputs change
   * (controller URL changed, certificate pin reset) or the target does
   * (switchTarget(); a cloud credential change on a cloud target). Everything up to the
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
   * is still valid. The same transition runs when the save changed the cloud
   * credential while the target is a cloud controller (`cloudCredentialsChanged`):
   * the cloud session and any cloud connect in flight were built on the
   * replaced account client. A successful save that leaves a cloud target
   * without a usable cloud credential (Remove cloud access, inbox I-1c2b
   * review; cloudCredentialUsable()) also returns the target to local in that
   * same step, before the transition: CONFIG_LOAD's `connectionTarget` reads
   * 'local' as soon as the save replies, the next connect reaches the local
   * controller, and nothing is ever served for the cloud controller again.
   * The run's target only — like startOn()'s fallback, the stored
   * `activeController` is not written here (a removal has already dropped it
   * with the cloud fields, config-model.ts). A save that changes none of
   * these leaves the connection alone. The result tells whether the
   * transition ran (`connectionReset`), decided in the same synchronous step,
   * so CONFIG_SAVE reports it for every cause.
   * @param {() => R} save - Persists the config; reports success, urlChanged
   *   and (optional) cloudCredentialsChanged.
   * @returns {Promise<R & { connectionReset: boolean }>} The save result plus
   *   whether the transition ran, once it is done.
   */
  async applyConfigSave<R extends { success: boolean; urlChanged?: boolean; cloudCredentialsChanged?: boolean }>(
    save: () => R
  ): Promise<R & { connectionReset: boolean }> {
    const result = save();
    const onCloud = this.activeTarget.kind === 'cloud';
    const cloudChanged = result.cloudCredentialsChanged === true && onCloud;
    // Decided right after the write, with no await in between
    const cloudTargetLost = result.success && onCloud && !this.cloudCredentialUsable();
    if (cloudTargetLost) {
      this.activeTarget = localTarget();
    }
    const connectionReset = result.success && (result.urlChanged === true || cloudChanged || cloudTargetLost);
    if (connectionReset) {
      await this.invalidateControllerState();
    }
    return { ...result, connectionReset };
  } // End of function applyConfigSave()

  /**
   * Whether the cloud credential is usable now
   * (CloudConnectionDeps.hasUsableCredential()). Fails closed: without the
   * cloud side, or when the check throws, a cloud target cannot be served.
   * @returns {boolean} True when a cloud connect could authenticate.
   */
  private cloudCredentialUsable(): boolean {
    try {
      return this.deps.cloud?.hasUsableCredential() === true;
    } catch {
      return false;
    }
  } // End of function cloudCredentialUsable()

  /**
   * Switches the connection target (see the header). In ONE synchronous step,
   * before any await: the target changes, the transition of a URL change runs
   * (invalidateControllerState(): every in-flight connect becomes stale, the
   * pending site choice and trust decision are dropped, the installed session
   * is detached and closed — its Open API clients and their tokens dropped,
   * its management reads and writes answering superseded — and logged out,
   * and the controller TLS session is replaced), `activeController` is
   * persisted ('local' or the omadacId; a failed write is logged and the
   * switch applies to this run only), and the connect to the new target
   * starts. A late result of anything started before the switch is never
   * installed or persisted. Switching to the CURRENT target is not a no-op: it
   * is a plain reconnect through the same full transition (every switch call
   * supersedes everything in flight; the caller decides whether to offer it).
   * @param {ConnectionTarget} target - `{kind: 'local'}` or `{kind: 'cloud', omadacId}`.
   * @returns {Promise<ConnectionResult>} The new target's connect result
   *   (connectionSuperseded when another switch, connect, disconnect or
   *   transition overtook it).
   * @throws {Error} Before any state change, when `target` is not a valid target.
   */
  async switchTarget(target: ConnectionTarget): Promise<ConnectionResult> {
    const next = normalizeConnectionTarget(target);
    if (next === null) {
      throw new Error('Connection target rejected: not a local or cloud target');
    }
    this.activeTarget = next;
    const transition = this.invalidateControllerState();
    if (this.deps.saveActiveController && !this.deps.saveActiveController(activeControllerValue(next))) {
      console.warn('The active controller could not be saved; the switch applies to this run only');
    }
    // Both promises get their handlers now: the outgoing session's retirement
    // is only awaited (a failure there is logged), the connect decides the result
    const retired = transition.catch(() => {
      console.warn('Retiring the outgoing controller session failed during a target switch');
    });
    const [result] = await Promise.all([this.connect(), retired]);
    return result;
  } // End of function switchTarget()

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
   * OMADA_CONNECT, to the current target (connectLocal() or connectCloud()).
   * The controller is created in a LOCAL variable and installed only after
   * the connect succeeds while the attempt is still current (isCurrent()
   * after every await); a stale attempt is logged out and reported as
   * connectionSuperseded. A newer connect supersedes any pending site
   * selection and trust decision, and closes the installed controller at
   * once (see the comment in the body). Multi-site (todo.md 1.11): with no
   * pickable site the controller is parked as a pending site selection (not
   * installed) and needsSiteSelection is returned with an opaque nonce.
   * @returns {Promise<ConnectionResult>} The connect result.
   */
  async connect(): Promise<ConnectionResult> {
    const generation = ++this.generation;
    this.discardPendingSiteSelection();
    this.pendingTrust = null;
    // The installed controller loses its management side NOW, before the
    // first await: close() drops a ControllerSession's Open API client and
    // token and discards its capability checks (a late result is ignored),
    // and its session nonce answers notConnected on MANAGEMENT_CAPABILITIES /
    // MANAGEMENT_TEST from here on — the new internal login may take long,
    // and no Open API session of the old connection may stay usable
    // meanwhile. Since inbox I-1b2b2 the data and AP-move handlers refuse it
    // the same way (sessionDataReply(): a closed session is notConnected).
    // Its INTERNAL client deliberately stays installed (phase-7 behavior):
    // it is released (logged out) only once this attempt succeeds or parks a
    // site selection, and a failed or superseded attempt leaves it to the
    // next disconnect (the renderer disconnects after a failed attempt) or
    // controller transition. close() is idempotent, so the later release
    // closes nothing twice. The same holds for a cloud session's data client
    this.installed?.close?.();
    const target = this.activeTarget;
    if (target.kind === 'cloud') {
      return this.connectCloud(target, generation);
    }
    return this.connectLocal(target, generation);
  } // End of function connect()

  /**
   * Settles an attempt whose connect() succeeded while it was current: the
   * attempt owns the session now, so any previously installed controller is
   * released (repeated connects cannot leak sessions); then the controller is
   * installed, or parked as the pending site selection when no site could be
   * picked. Synchronous: callers have just verified that their flow is current.
   * @param {C} controller - The attempt's controller.
   * @param {ConnectOutcome} outcome - Its connect outcome.
   * @param {number} generation - The attempt's connect generation.
   * @param {string} url - The configured URL it used ('' for a cloud target).
   * @param {ConnectionTarget} target - The attempt's target.
   * @returns {ConnectionResult} The success or needsSiteSelection result.
   */
  private settleAttempt(controller: C, outcome: ConnectOutcome, generation: number, url: string, target: ConnectionTarget): ConnectionResult {
    const previous = this.installed;
    this.installed = null;
    if (previous) {
      this.releaseController(previous);
    }
    if (!outcome.siteSelected) {
      // Park the controller until the user picks a site: selectSite() must
      // echo this nonce and succeeds only while this record is current
      const nonce = createNonce();
      this.pendingSite = { controller, generation, target, url, nonce };
      return { success: false, needsSiteSelection: true, sites: outcome.sites, selectionNonce: nonce };
    }
    return this.installFor(controller, url, target);
  } // End of function settleAttempt()

  /**
   * The local target's connect (the phase-7 flow; see connect()). On success
   * the controller's omadacId is learned (installFor()). Certificate pinning
   * (todo.md 4.4): the very first request (/api/info) is already gated by the
   * verify proc, so on a pin rejection the login POST is never sent; the
   * failure is reported as certificateUntrusted (with a trust nonce) or
   * certificateChanged. Any other failure is connectError with the redacted
   * message as `detail`, plus `unreachable: true` when the controller never
   * answered at all (inbox I-1c2a): the controller reports that its first
   * request got no response (ManagedController.connectUnreachable — a timeout
   * or an unreachable net error on /api/info, never a failure after any
   * response, an HTTP error or a certificate error).
   * @param {ConnectionTarget} target - The local target.
   * @param {number} generation - The attempt's connect generation.
   * @returns {Promise<ConnectionResult>} The connect result.
   */
  private async connectLocal(target: ConnectionTarget, generation: number): Promise<ConnectionResult> {
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
      if (!this.isCurrent(generation, credentials.url, target)) {
        return { success: false, error: 'connectionSuperseded' };
      }
    }
    const rejectionMark = this.pinRejectionSequence;

    const controller = this.deps.createController(credentials);
    try {
      const outcome = await controller.connect(this.deps.getStoredSiteId());

      if (!this.isCurrent(generation, credentials.url, target)) {
        // Superseded while authenticating (newer connect, disconnect, URL
        // change, certificate reset or target switch): discard this attempt
        // entirely — nothing installed, no omadacId or site persisted
        this.releaseController(controller);
        return { success: false, error: 'connectionSuperseded' };
      }
      return this.settleAttempt(controller, outcome, generation, credentials.url, target);
    } catch (error) {
      // The failure text can quote the controller (a login message, a
      // redacted HTTP excerpt). A ControllerSession has already scrubbed the
      // session's live credentials (CSRF tokens, session cookies) from it by
      // value (#internalCall()); redacted again here, with this attempt's
      // password scrubbed by value, before it reaches the log or the renderer
      const detail = redactErrorMessage(error, [credentials.password]);
      console.error('Error connecting to the Omada controller:', detail);
      // The login may have partially succeeded before the failure: log the
      // local controller out best-effort (it was never installed)
      this.releaseController(controller);
      if (!this.isCurrent(generation, credentials.url, target)) {
        return { success: false, error: 'connectionSuperseded' };
      }
      const certificateResult = this.certificateRejectionResult(rejectionMark, credentials.url, generation);
      if (certificateResult) {
        return certificateResult;
      }
      // A controller that never answered at all is marked (inbox I-1c2a; the
      // controller's own record of its first request, never the message
      // text): the renderer may offer its cloud duplicate then
      return controller.connectUnreachable === true ? { success: false, error: 'connectError', detail, unreachable: true } : { success: false, error: 'connectError', detail };
    }
  } // End of function connectLocal()

  /**
   * A cloud target's connect (see the header): a FRESH organization entry for
   * the omadacId first — an unusable cloud credential, an unknown omadacId or
   * a non-connectable organization (offline, below 6.3, unsupported host…)
   * refuses the connect with connectError and a code-first `detail`
   * (cloudRefusalDetail()), and no session is built; otherwise the
   * Open-API-only session is built and connected with the site remembered in
   * `cloudSites[omadacId]`. A session failure's `detail` starts with its
   * CloudSessionError code (connectFailureDetail(), scrubbed of the routing
   * identifiers and the account's live secrets by value). There is no
   * certificate result: the cloud hosts get Chromium's normal verification
   * in their own session, never the pin dialog.
   * @param {CloudConnectionTarget} target - The cloud target.
   * @param {number} generation - The attempt's connect generation.
   * @returns {Promise<ConnectionResult>} The connect result.
   */
  private async connectCloud(target: CloudConnectionTarget, generation: number): Promise<ConnectionResult> {
    const cloud = this.deps.cloud;
    if (!cloud) {
      return { success: false, error: 'connectError', detail: cloudRefusalDetail('cloudUnavailable') };
    }
    let lookup: CloudControllerLookup<C>;
    try {
      lookup = await cloud.lookupController(target.omadacId);
    } catch {
      // The lookup never rejects by contract; fail closed with fixed text
      lookup = { ok: false, code: 'networkError', diagnostic: 'unexpected failure' };
    }
    if (!this.isCurrent(generation, '', target)) {
      return { success: false, error: 'connectionSuperseded' };
    }
    if (!lookup.ok) {
      const refusal = cloudRefusalDetail(lookup.code, lookup.diagnostic);
      console.warn(`Cloud controller connect refused: ${refusal}`);
      return { success: false, error: 'connectError', detail: refusal };
    }
    const found = lookup;
    let controller: C;
    try {
      controller = found.create();
    } catch {
      return { success: false, error: 'connectError', detail: cloudRefusalDetail('requestFailed', 'cloud session unavailable') };
    }
    try {
      const outcome = await controller.connect(cloud.getCloudSiteId(target.omadacId));
      if (!this.isCurrent(generation, '', target)) {
        // Superseded while listing the sites: nothing installed or persisted
        this.releaseController(controller);
        return { success: false, error: 'connectionSuperseded' };
      }
      return this.settleAttempt(controller, outcome, generation, '', target);
    } catch (failure) {
      const detail = connectFailureDetail(failure, found.secrets());
      console.error('Error connecting to the cloud controller:', detail);
      this.releaseController(controller);
      if (!this.isCurrent(generation, '', target)) {
        return { success: false, error: 'connectionSuperseded' };
      }
      return { success: false, error: 'connectError', detail };
    }
  } // End of function connectCloud()

  /**
   * OMADA_SELECT_SITE: completes the pending connection that returned
   * needsSiteSelection. Accepted only for the CURRENT pending record (exact
   * nonce, unchanged generation, target and — locally — configured URL) and
   * an id from the controller's authorized-site list; the controller is
   * installed and the id persisted only then: the local `siteId` for the
   * local target (whose omadacId is learned too), `cloudSites[omadacId]` for
   * a cloud target. Synchronous on purpose: there is no await between the
   * ownership check and the install/persist.
   * @param {string} siteId - The chosen site id (format-checked by index.ts).
   * @param {string} nonce - The selection nonce echoed by the renderer.
   * @returns {ConnectionResult} Success, or siteUnavailable.
   */
  selectSite(siteId: string, nonce: string): ConnectionResult {
    const pending = this.pendingSite;
    if (!pending || pending.nonce !== nonce || !this.isCurrent(pending.generation, pending.url, pending.target)) {
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
    const result = this.installFor(pending.controller, pending.url, pending.target);
    if (previous) {
      this.releaseController(previous);
    }
    if (pending.target.kind === 'cloud') {
      this.deps.cloud?.saveCloudSiteId(pending.target.omadacId, siteId);
    } else {
      this.deps.saveStoredSiteId(siteId);
    }
    return result;
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
