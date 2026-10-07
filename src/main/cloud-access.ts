// The TP-Link cloud access of the app (inbox item I-1a; docs/omada-cloud-openapi.md
// §10). Electron-free: the saved credentials and the cloud transport are
// injected (index.ts passes config.ts's getCloudCredentials() and the cloud
// net transport), so the IPC replies of `cloud:test` and `cloud:controllers`
// are unit-tested on fixtures (tests/unit/cloud-access.test.ts).
//
// - One CloudAccountClient (with its own CloudRequestThrottle) per saved
//   credential: it is created on first use and replaced — the old one closed,
//   its tokens dropped — as soon as the saved credentials differ from the
//   ones it was built with. invalidate() (called by index.ts after every save
//   that changes or removes the cloud credentials) does the same at once.
// - Saved credentials only: nothing the renderer sends is used (the channels
//   take no argument), so a form with unsaved cloud edits must be saved
//   first — the renderer refuses "Test cloud access" itself then, as it does
//   for "Test management access". No saved credentials → 'notConfigured'.
// - Stale replies: there is no session nonce to bind to (a cloud call has no
//   local controller session: it must work while disconnected), so the
//   service keeps a credential generation instead; a call whose credentials
//   were saved, removed or replaced while it ran answers 'superseded'.
// - Replies: the controller DTOs (toCloudController(): never a deviceId,
//   serverHost or token) or a stable code with a codes-only diagnostic
//   (TP-Link's message, redacted, only for an unknown errorCode), scrubbed of
//   the live secret and tokens by value.

import type { CloudAccessError, CloudAccessResult } from '../shared/types';
import { CloudAccountClient } from './cloud-account-client';
import { CloudAccountError, CloudAccountErrorCode, CloudCredentials, MAX_CLOUD_DIAGNOSTIC_CHARS, toCloudController } from './cloud-account-model';
import { CloudRequestThrottle } from './cloud-throttle';
import { OmadaTransport } from './omada-transport';
import { redactErrorMessage, redactText } from './redact';

// How each client failure reaches the renderer ('clientClosed': the client was
// replaced or closed while the call ran)
const REPLY_ERRORS: Readonly<Record<CloudAccountErrorCode, CloudAccessError>> = {
  credentialInvalid: 'credentialInvalid',
  tokenRejected: 'tokenRejected',
  rateLimited: 'rateLimited',
  httpError: 'httpError',
  timeout: 'timeout',
  networkError: 'networkError',
  apiError: 'apiError',
  malformedResponse: 'malformedResponse',
  clientClosed: 'superseded'
};

/** Constructor options of CloudAccessService. */
export interface CloudAccessServiceOptions {
  // The saved credentials (stored or session-only secret), or null
  getCredentials: () => CloudCredentials | null;
  // The cloud transport (production: its own session, origin allowlist)
  transport: OmadaTransport;
  // Clock and sleep (tests inject fakes; they reach the client and the throttle)
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Builds the codes-only diagnostic of a client failure: the code, the HTTP
 * status and TP-Link's errorCode when known; for 'apiError' (an errorCode the
 * app does not know) the client's own diagnostic, which carries TP-Link's
 * redacted message.
 * @param {CloudAccountError} failure - The failure.
 * @returns {string} The diagnostic.
 */
function describeCloudFailure(failure: CloudAccountError): string {
  if (failure.code === 'apiError') {
    return `apiError, ${failure.diagnostic}`;
  }
  const parts: string[] = [failure.code];
  if (failure.httpStatus !== null) {
    parts.push(`HTTP ${failure.httpStatus}`);
  }
  if (failure.apiErrorCode !== null) {
    parts.push(`errorCode ${failure.apiErrorCode}`);
  }
  return parts.join(', ');
} // End of function describeCloudFailure()

/**
 * The cloud access of main (see the header).
 */
export class CloudAccessService {
  readonly #options: CloudAccessServiceOptions;
  #client: CloudAccountClient | null = null;
  // Bumped whenever the credentials change or the client is replaced: a call
  // started under an older generation answers 'superseded'
  #generation = 0;

  /**
   * Creates the service. Nothing is sent until the first call.
   * @param {CloudAccessServiceOptions} options - Credentials source, transport, clock.
   */
  constructor(options: CloudAccessServiceOptions) {
    this.#options = options;
  }

  /**
   * Drops the current client (its tokens included) at once: the cloud
   * credentials were saved or removed. A call in flight answers 'superseded'.
   */
  invalidate(): void {
    this.#generation++;
    this.#client?.close();
    this.#client = null;
  }

  /**
   * The live cloud secret and tokens, for scrubbing free text by value
   * (index.ts adds them to the stored secrets of the IPC registrar).
   * @returns {string[]} The values (none when no client is live).
   */
  liveSecrets(): string[] {
    return this.#client?.liveSecrets() ?? [];
  }

  /**
   * "Test cloud access": a FRESH token from the saved credentials, then the
   * organization list.
   * @returns {Promise<CloudAccessResult>} The controllers, or a stable code.
   */
  test(): Promise<CloudAccessResult> {
    return this.#run(true);
  }

  /**
   * The account's controllers, reusing a valid token.
   * @returns {Promise<CloudAccessResult>} The controllers, or a stable code.
   */
  controllers(): Promise<CloudAccessResult> {
    return this.#run(false);
  }

  /**
   * Runs one organization listing with the current client.
   * @param {boolean} fresh - Whether to require a new token first.
   * @returns {Promise<CloudAccessResult>} The reply.
   */
  async #run(fresh: boolean): Promise<CloudAccessResult> {
    const client = this.#currentClient();
    if (client === null) {
      return { success: false, error: 'notConfigured' };
    }
    const generation = this.#generation;
    try {
      await client.authorize({ fresh });
      const list = await client.listOrganizations();
      if (this.#isStale(generation, client)) {
        return { success: false, error: 'superseded' };
      }
      return { success: true, controllers: list.items.map(toCloudController), truncated: list.truncated };
    } catch (failure) {
      if (this.#isStale(generation, client)) {
        return { success: false, error: 'superseded' };
      }
      return this.#failureReply(failure, client);
    }
  } // End of function #run()

  /**
   * Whether a call that started under `generation` with `client` is stale.
   * @param {number} generation - The generation at the start.
   * @param {CloudAccountClient} client - The client it used.
   * @returns {boolean} True when the credentials changed meanwhile.
   */
  #isStale(generation: number, client: CloudAccountClient): boolean {
    return generation !== this.#generation || client.isClosed || this.#client !== client;
  }

  /**
   * Returns the client for the saved credentials: the current one while they
   * are unchanged, else a new one (the old one closed, the generation
   * bumped). None when nothing usable is saved.
   * @returns {CloudAccountClient | null} The client, or null.
   */
  #currentClient(): CloudAccountClient | null {
    let credentials: CloudCredentials | null;
    try {
      credentials = this.#options.getCredentials();
    } catch {
      credentials = null;
    }
    if (credentials === null) {
      if (this.#client !== null) {
        this.invalidate();
      }
      return null;
    }
    if (this.#client !== null && !this.#client.isClosed && this.#client.usesCredentials(credentials)) {
      return this.#client;
    }
    if (this.#client !== null) {
      this.invalidate();
    }
    const { now, sleep, transport } = this.#options;
    this.#client = new CloudAccountClient({
      region: credentials.region,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      transport,
      throttle: new CloudRequestThrottle({ now, sleep }),
      now
    });
    return this.#client;
  } // End of function #currentClient()

  /**
   * Turns a failure into the reply: a stable code and a codes-only
   * diagnostic, scrubbed of the client's live secret and tokens. Anything
   * but a CloudAccountError is a programming error: logged redacted, reported
   * as 'networkError' with fixed text.
   * @param {unknown} failure - What the call threw.
   * @param {CloudAccountClient} client - The client of the call.
   * @returns {CloudAccessResult} The reply.
   */
  #failureReply(failure: unknown, client: CloudAccountClient): CloudAccessResult {
    const secrets = client.liveSecrets();
    if (!(failure instanceof CloudAccountError)) {
      console.warn('Unexpected cloud access failure:', redactErrorMessage(failure, secrets));
      return { success: false, error: 'networkError', diagnostic: 'unexpected failure' };
    }
    const code = REPLY_ERRORS[failure.code];
    const diagnostic = redactText(describeCloudFailure(failure), secrets).slice(0, MAX_CLOUD_DIAGNOSTIC_CHARS);
    console.warn(`Cloud access failed: ${diagnostic}`);
    return { success: false, error: code, diagnostic };
  } // End of function #failureReply()
} // End of class CloudAccessService
