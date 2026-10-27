import { describe, expect, it } from 'vitest';

import { signPayload, verifySignature } from '#src/lib/signature.ts';

const SECRET = 'whsec_test';
const BODY = '{"id":"ev_1","type":"charge.paid_out"}';

describe('webhook signature', () => {
  it('verifies its own signature', () => {
    const header = signPayload(SECRET, BODY, 1_800_000_000);

    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(
      verifySignature({ secret: SECRET, body: BODY, header, now: 1_800_000_010 }),
    ).toBe(true);
  });

  it('rejects a modified body, another secret or a stale timestamp', () => {
    const header = signPayload(SECRET, BODY, 1_800_000_000);

    expect(
      verifySignature({ secret: SECRET, body: `${BODY} `, header, now: 1_800_000_000 }),
    ).toBe(false);
    expect(
      verifySignature({ secret: 'other', body: BODY, header, now: 1_800_000_000 }),
    ).toBe(false);
    expect(
      verifySignature({ secret: SECRET, body: BODY, header, now: 1_800_001_000 }),
    ).toBe(false);
  });
});
