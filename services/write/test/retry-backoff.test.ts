// Spec 03 §6.4, WU17 and WQ5, WE5: the backoff a retryable outcome sets as
// the message's visibility.
import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { retryVisibilitySeconds } from '../src/retry-backoff';
import { writePathSettings } from '../src/write-path-settings';

describe('retryVisibilitySeconds (§6.4)', () => {
  it("uses the provider's Retry-After when present, in whole seconds, without jitter", () => {
    expect(
      retryVisibilitySeconds({
        receiveCount: 1,
        retryAfterMilliseconds: 2_000,
        randomFraction: 0.9,
      }),
    ).toBe(2);
    expect(
      retryVisibilitySeconds({
        receiveCount: 3,
        retryAfterMilliseconds: 1_500,
        randomFraction: 0.9,
      }),
    ).toBe(2);
  });

  it('otherwise doubles from the 5 second base on each receive, up to the 300 second cap', () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7, 8].map((receiveCount) =>
        retryVisibilitySeconds({ receiveCount, randomFraction: 0 }),
      ),
    ).toEqual([5, 10, 20, 40, 80, 160, 300, 300]);
  });

  it('takes jitter off the delay, never adding to it, so the cap is a true maximum (WQ5)', () => {
    expect(retryVisibilitySeconds({ receiveCount: 8, randomFraction: 0.999_999 })).toBe(241);
    expect(retryVisibilitySeconds({ receiveCount: 1, randomFraction: 0.5 })).toBe(5);
  });

  it('holds the WU17 values', () => {
    expect(writePathSettings).toMatchObject({
      retryBackoffBaseSeconds: 5,
      retryBackoffCapSeconds: 300,
      retryBackoffJitterFraction: 0.2,
    });
  });

  test.prop([
    fc.integer({ min: 1, max: 1_000 }),
    fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
  ])(
    'is always a whole number of seconds between 80 per cent of the delay and the delay',
    (receiveCount, randomFraction) => {
      const unjittered = Math.min(
        writePathSettings.retryBackoffCapSeconds,
        writePathSettings.retryBackoffBaseSeconds * 2 ** Math.min(receiveCount - 1, 30),
      );
      const visibility = retryVisibilitySeconds({ receiveCount, randomFraction });
      expect(Number.isInteger(visibility)).toBe(true);
      expect(visibility).toBeGreaterThanOrEqual(Math.ceil(unjittered * 0.8));
      expect(visibility).toBeLessThanOrEqual(unjittered);
    },
  );
});
