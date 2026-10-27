const HOUR_MS = 60 * 60 * 1000;

/** Delay before each retry, in hours: the last attempt lands about 70 hours after the first. */
export const RETRY_DELAYS_HOURS = [1 / 60, 5 / 60, 0.5, 2, 6, 12, 24, 24];

export const MAX_ATTEMPTS = RETRY_DELAYS_HOURS.length + 1;

/**
 * Delay before the next attempt once `attemptCount` attempts failed, or null when retries
 * are exhausted. `secondsPerHour` compresses the schedule: 3600 is real time.
 */
export const nextRetryDelayMs = (attemptCount: number, secondsPerHour: number) => {
  const hours = RETRY_DELAYS_HOURS[attemptCount - 1];
  if (hours === undefined) {
    return null;
  }
  return Math.max(1000, Math.round((hours * HOUR_MS * secondsPerHour) / 3600));
};
