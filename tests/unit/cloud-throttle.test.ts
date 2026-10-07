// Tests for the shared cloud request throttle (src/main/cloud-throttle.ts),
// on a fake clock: at most 5 request starts in any 1-second window across
// every concurrent caller (FIFO), the rate-limit backoff (1 s, 2 s, 4 s, then
// 8 s) that holds every caller back, and its reset after a success.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CLOUD_MAX_REQUESTS_PER_WINDOW,
  CLOUD_RATE_LIMIT_BACKOFF_MS,
  CLOUD_RATE_LIMIT_MAX_RETRIES,
  CLOUD_RATE_WINDOW_MS,
  CloudRequestThrottle
} from '../../src/main/cloud-throttle';
import { FakeClock } from './helpers/fake-clock';

/**
 * Asserts that no window of `windowMs` holds more than `max` of the starts.
 * @param {number[]} starts - Start times, ascending.
 * @param {number} max - Allowed starts per window.
 * @param {number} windowMs - Window length.
 */
function assertRate(starts: number[], max: number, windowMs: number): void {
  for (let index = max; index < starts.length; index++) {
    assert.ok(starts[index] - starts[index - max] >= windowMs, `start ${index} is ${starts[index] - starts[index - max]} ms after start ${index - max}`);
  }
}

describe('CloudRequestThrottle', () => {
  test('the documented limits: 5 per second (half of TP-Link\'s 10), three retries', () => {
    assert.equal(CLOUD_MAX_REQUESTS_PER_WINDOW, 5);
    assert.equal(CLOUD_RATE_WINDOW_MS, 1000);
    assert.equal(CLOUD_RATE_LIMIT_MAX_RETRIES, 3);
    assert.deepEqual(CLOUD_RATE_LIMIT_BACKOFF_MS, [1000, 2000, 4000, 8000]);
  });

  test('12 concurrent callers: never more than 5 starts in any 1 s window, granted in call order', async () => {
    const clock = new FakeClock();
    const throttle = new CloudRequestThrottle({ now: clock.now, sleep: clock.sleep });
    const order: number[] = [];
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        throttle.acquire().then(() => {
          order.push(index);
          starts.push(clock.time);
        })
      )
    );
    assert.deepEqual(order, [...Array(12).keys()], 'FIFO');
    assertRate(starts, 5, 1000);
    // The first five go at once, the next five a window later, then two more
    const t0 = starts[0];
    assert.deepEqual(starts.map((start) => start - t0), [0, 0, 0, 0, 0, 1000, 1000, 1000, 1000, 1000, 2000, 2000]);
  }); // End of test "12 concurrent callers..."

  test('callers spread over time are not delayed while under the limit', async () => {
    const clock = new FakeClock();
    const throttle = new CloudRequestThrottle({ now: clock.now, sleep: clock.sleep });
    for (let index = 0; index < 8; index++) {
      await throttle.acquire();
      clock.advance(250);
    }
    assert.deepEqual(clock.sleeps, [], 'four per second never waits');
  });

  test('rateLimited() holds EVERY caller back for a growing backoff; succeeded() resets it', async () => {
    const clock = new FakeClock();
    const throttle = new CloudRequestThrottle({ now: clock.now, sleep: clock.sleep });
    await throttle.acquire();
    const start = clock.time;
    assert.equal(throttle.rateLimited(), 1000);
    await throttle.acquire();
    assert.equal(clock.time - start, 1000, 'the next slot waits out the first backoff');
    assert.equal(throttle.rateLimited(), 2000);
    assert.equal(throttle.rateLimited(), 4000);
    assert.equal(throttle.rateLimited(), 8000);
    assert.equal(throttle.rateLimited(), 8000, 'the last step repeats');
    const before = clock.time;
    await Promise.all([throttle.acquire(), throttle.acquire()]);
    assert.ok(clock.time - before >= 8000, 'both callers waited');
    throttle.succeeded();
    assert.equal(throttle.rateLimited(), 1000, 'after a success the backoff starts over');
  }); // End of test "rateLimited() holds EVERY caller back..."

  test('a failing sleep rejects that caller only; the queue keeps working', async () => {
    const clock = new FakeClock();
    let fail = true;
    const throttle = new CloudRequestThrottle({
      maxRequests: 1,
      now: clock.now,
      sleep: async (ms) => {
        if (fail) {
          fail = false;
          throw new Error('sleep failed');
        }
        await clock.sleep(ms);
      }
    });
    await throttle.acquire();
    await assert.rejects(throttle.acquire(), /sleep failed/);
    await throttle.acquire();
    assert.ok(clock.time > 0);
  });
});
