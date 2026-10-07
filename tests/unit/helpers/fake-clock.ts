// Fake clock for the cloud tests: `now()` reads a number that only `sleep()`
// (and `advance()`) move forward, so a CloudRequestThrottle or a token's
// expiry can be driven instantly and deterministically.

/**
 * A manual clock with a sleep that advances it.
 */
export class FakeClock {
  // Current time (epoch ms)
  time: number;
  // Every sleep requested, in order (ms)
  readonly sleeps: number[] = [];

  /**
   * Creates the clock.
   * @param {number} [start] - The start time (epoch ms).
   */
  constructor(start = 1_800_000_000_000) {
    this.time = start;
  }

  /**
   * The current time.
   * @returns {number} Epoch ms.
   */
  readonly now = (): number => this.time;

  /**
   * "Sleeps": records the delay, advances the clock and yields once.
   * @param {number} ms - Milliseconds.
   * @returns {Promise<void>} Resolves after the clock moved.
   */
  readonly sleep = async (ms: number): Promise<void> => {
    this.sleeps.push(ms);
    this.time += ms;
    await Promise.resolve();
  };

  /**
   * Moves the clock forward.
   * @param {number} ms - Milliseconds.
   */
  advance(ms: number): void {
    this.time += ms;
  }
} // End of class FakeClock
