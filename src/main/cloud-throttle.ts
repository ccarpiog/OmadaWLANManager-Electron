// The request throttle of one TP-Link cloud credential (docs/omada-cloud-openapi.md
// §7). Pure (no Electron; the clock and the sleep are injected), unit-tested
// in tests/unit/cloud-throttle.test.ts.
//
// TP-Link limits the Account Level Open API to 10 requests per second per
// application (credential) and answers -7132 above it. Every request sent
// with one credential — its token requests, the organization list
// (CloudAccountClient) and the Open API calls of the cloud route
// (OpenApiClient with route 'cloud') — first takes a slot here, so together
// they never start more than CLOUD_MAX_REQUESTS_PER_WINDOW (5, half the
// documented limit) requests in any CLOUD_RATE_WINDOW_MS (1 s) window. Slots
// are granted in call order (FIFO). A -7132 answer (or HTTP 429) blocks every
// user of the credential for a growing backoff (rateLimited(): 1 s, 2 s, 4 s,
// then 8 s), and the caller retries at most CLOUD_RATE_LIMIT_MAX_RETRIES times;
// a successful answer resets the backoff (succeeded()). Main keeps exactly
// one throttle per saved credential (CloudAccessService in cloud-access.ts
// creates it with the credential's CloudAccountClient).

// At most this many request starts per window, across every user of the credential
export const CLOUD_MAX_REQUESTS_PER_WINDOW = 5;
export const CLOUD_RATE_WINDOW_MS = 1000;
// The backoff after consecutive rate-limit answers (the last value repeats)
export const CLOUD_RATE_LIMIT_BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000];
// How many times one request is retried after a rate-limit answer
export const CLOUD_RATE_LIMIT_MAX_RETRIES = 3;

/** Constructor options of CloudRequestThrottle (tests shrink or fake them). */
export interface CloudThrottleOptions {
  maxRequests?: number;
  windowMs?: number;
  // Clock (epoch ms) and sleep; tests inject a fake clock that sleep advances
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Waits the given time with a real timer.
 * @param {number} ms - Milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The shared throttle of one cloud credential (see the header).
 */
export class CloudRequestThrottle {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  // Start times of the requests granted within the current window (oldest first)
  #starts: number[] = [];
  // No slot is granted before this time (a rate-limit backoff)
  #blockedUntil = 0;
  // Consecutive rate-limit answers (the backoff index)
  #penalties = 0;
  // The tail of the FIFO queue of acquisitions
  #queue: Promise<void> = Promise.resolve();

  /**
   * Creates a throttle.
   * @param {CloudThrottleOptions} [options] - Limits, clock and sleep.
   */
  constructor(options: CloudThrottleOptions = {}) {
    this.maxRequests = options.maxRequests ?? CLOUD_MAX_REQUESTS_PER_WINDOW;
    this.windowMs = options.windowMs ?? CLOUD_RATE_WINDOW_MS;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? realSleep;
  }

  /**
   * Waits for a request slot (FIFO): no earlier than the end of a rate-limit
   * backoff, and only while fewer than maxRequests requests started in the
   * last windowMs. The slot is taken when this resolves.
   * @returns {Promise<void>} Resolves when the request may be sent.
   */
  acquire(): Promise<void> {
    const turn = this.#queue.then(() => this.#waitForSlot());
    // A failing sleep must not jam the queue for the next caller
    this.#queue = turn.catch(() => undefined);
    return turn;
  }

  /**
   * Records a rate-limit answer (-7132 / HTTP 429): every user of the
   * credential is held back for the next backoff step.
   * @returns {number} The backoff applied (ms).
   */
  rateLimited(): number {
    const index = Math.min(this.#penalties, CLOUD_RATE_LIMIT_BACKOFF_MS.length - 1);
    const delay = CLOUD_RATE_LIMIT_BACKOFF_MS[index];
    this.#penalties++;
    this.#blockedUntil = Math.max(this.#blockedUntil, this.#now() + delay);
    return delay;
  }

  /**
   * Records an answer that was not a rate-limit refusal: the backoff starts
   * over at its first step.
   */
  succeeded(): void {
    this.#penalties = 0;
  }

  /**
   * Waits until a slot is free and takes it (only called in queue order).
   * @returns {Promise<void>} Resolves once the slot is taken.
   */
  async #waitForSlot(): Promise<void> {
    for (;;) {
      const now = this.#now();
      this.#starts = this.#starts.filter((start) => now - start < this.windowMs);
      const blockedFor = this.#blockedUntil - now;
      const windowFullFor = this.#starts.length >= this.maxRequests ? this.#starts[0] + this.windowMs - now : 0;
      const wait = Math.max(blockedFor, windowFullFor, 0);
      if (wait <= 0) {
        this.#starts.push(now);
        return;
      }
      await this.#sleep(wait);
    } // End of the loop that waits for a free slot
  } // End of function #waitForSlot()
} // End of class CloudRequestThrottle
