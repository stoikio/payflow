import { describe, expect, it } from 'vitest';

import {
  MAX_ATTEMPTS,
  nextRetryDelayMs,
  RETRY_DELAYS_HOURS,
} from '#src/engine/retry-schedule.ts';

describe('webhook retry schedule', () => {
  it('spreads retries over less than 72 hours in real time', () => {
    const totalHours = RETRY_DELAYS_HOURS.reduce((total, hours) => total + hours, 0);

    expect(totalHours).toBeLessThan(72);
    expect(MAX_ATTEMPTS).toBe(9);
    expect(nextRetryDelayMs(1, 3600)).toBe(60_000);
    expect(nextRetryDelayMs(4, 3600)).toBe(2 * 60 * 60 * 1000);
  });

  it('compresses one hour into one second in sandbox, with a one second floor', () => {
    expect(nextRetryDelayMs(1, 1)).toBe(1000);
    expect(nextRetryDelayMs(5, 1)).toBe(6000);
    expect(nextRetryDelayMs(8, 1)).toBe(24_000);
  });

  it('stops after the last retry', () => {
    expect(nextRetryDelayMs(MAX_ATTEMPTS, 1)).toBeNull();
  });
});
