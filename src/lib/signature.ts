import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'PayFlow-Signature';

const digest = (secret: string, timestamp: number, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` */
export const signPayload = (secret: string, body: string, timestamp: number) =>
  `t=${timestamp},v1=${digest(secret, timestamp, body)}`;

export const verifySignature = ({
  secret,
  body,
  header,
  now,
  toleranceSeconds = 300,
}: {
  secret: string;
  body: string;
  header: string;
  now: number;
  toleranceSeconds?: number;
}) => {
  const parts = Object.fromEntries(
    header.split(',').map((part) => part.split('=', 2) as [string, string]),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) {
    return false;
  }
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = Buffer.from(digest(secret, timestamp, body));
  const received = Buffer.from(parts.v1);
  return expected.length === received.length && timingSafeEqual(expected, received);
};
