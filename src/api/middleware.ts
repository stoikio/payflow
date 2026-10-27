import { createHash, timingSafeEqual } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import { ApiError } from '#src/lib/errors.ts';

const sameSecret = (left: string, right: string) => {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
};

/** `Authorization: Bearer <api key>` */
export const requireApiKey =
  (apiKey: string): MiddlewareHandler =>
  async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token || !sameSecret(token, apiKey)) {
      throw new ApiError({
        status: 401,
        type: 'authentication_error',
        code: 'invalid_api_key',
        message: 'Missing or invalid API key',
      });
    }
    await next();
  };

/** Fixed one-second window per API key. */
export const rateLimit = ({
  limit,
  now,
}: {
  limit: number;
  now: () => number;
}): MiddlewareHandler => {
  let windowStart = 0;
  let count = 0;

  return async (c, next) => {
    const second = Math.floor(now() / 1000);
    if (second !== windowStart) {
      windowStart = second;
      count = 0;
    }
    count++;
    c.header('RateLimit-Limit', String(limit));
    c.header('RateLimit-Remaining', String(Math.max(0, limit - count)));
    if (count > limit) {
      c.header('Retry-After', '1');
      throw new ApiError({
        status: 429,
        type: 'rate_limit_error',
        code: 'rate_limited',
        message: `Too many requests: the limit is ${limit} per second`,
      });
    }
    await next();
  };
};
