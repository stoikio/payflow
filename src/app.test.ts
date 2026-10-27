import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '#src/app.ts';
import { loadConfig } from '#src/config.ts';
import { MAGIC_IBANS } from '#src/domain/scenarios.ts';
import { verifySignature } from '#src/lib/signature.ts';
import { openDatabase } from '#src/store/database.ts';

const API_KEY = 'sk_sandbox_test_0123456789';
const SECRET = 'whsec_test_0123456789';

type Received = { body: string; headers: Headers };

const setup = ({ webhookStatus = 200, rateLimit = 100 } = {}) => {
  let clock = new Date('2026-10-22T09:00:00.000Z').getTime();
  const received: Received[] = [];
  const config = loadConfig({
    PAYFLOW_API_KEY: API_KEY,
    WEBHOOK_SECRET: SECRET,
    WEBHOOK_URL: 'http://receiver.test/webhooks',
    SANDBOX_TRANSITION_SECONDS: '5',
    RATE_LIMIT_PER_SECOND: String(rateLimit),
  });
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    received.push({ body: String(init?.body), headers: new Headers(init?.headers) });
    return new Response(null, { status: webhookStatus });
  }) as typeof fetch;
  const { app, tick } = createApp({
    database: openDatabase(':memory:'),
    config,
    now: () => clock,
    fetch: fakeFetch,
  });

  const call = async <Body = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as Body,
    };
  };

  const advance = async (seconds: number) => {
    for (let elapsed = 0; elapsed < seconds; elapsed++) {
      clock += 1000;
      await tick();
    }
  };

  const activeMandate = async (iban: string) => {
    const mandate = await call<{ id: string; authorizationUrl: string }>(
      'POST',
      '/mandates',
      {
        customerReference: 'customer-42',
        returnUrl: 'http://merchant.test/return?step=done',
      },
    );
    const token = mandate.body.authorizationUrl.split('/authorize/')[1];
    const form = await app.request(`/authorize/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ accountHolderName: 'Jane Doe', iban }).toString(),
    });
    await advance(5);
    return {
      id: mandate.body.id,
      redirect: form.headers.get('location'),
      formStatus: form.status,
    };
  };

  const charge = (mandateId: string, key: string, extra: object = {}) =>
    call<{ id: string; status: string; chargeDate: string }>(
      'POST',
      '/charges',
      { mandateId, amount: 12_000, currency: 'EUR', ...extra },
      { 'idempotency-key': key },
    );

  const statusOf = async (chargeId: string) =>
    (
      await call<{ status: string; failureCode: string | null }>(
        'GET',
        `/charges/${chargeId}`,
      )
    ).body;

  const eventTypes = () =>
    received.map(({ body }) => (JSON.parse(body) as { type: string }).type);

  return {
    app,
    call,
    advance,
    activeMandate,
    charge,
    statusOf,
    eventTypes,
    received,
    now: () => clock,
  };
};

describe('PayFlow sandbox', () => {
  let sandbox: ReturnType<typeof setup>;

  beforeEach(() => {
    sandbox = setup();
  });

  it('rejects requests without the API key', async () => {
    const response = await sandbox.app.request('/mandates');

    expect(response.status).toBe(401);
  });

  it('authorizes a mandate on the hosted page and activates it', async () => {
    const { id, redirect, formStatus } = await sandbox.activeMandate(MAGIC_IBANS.success);

    expect(formStatus).toBe(303);
    expect(redirect).toBe(`http://merchant.test/return?step=done&mandateId=${id}`);
    expect((await sandbox.call('GET', `/mandates/${id}`)).body).toMatchObject({
      status: 'active',
      bankAccount: { ibanLast4: MAGIC_IBANS.success.slice(-4), country: 'NL' },
    });
    expect(sandbox.eventTypes()).toEqual(['mandate.active']);
  });

  it('shows the form again for an invalid IBAN', async () => {
    const mandate = await sandbox.call<{ authorizationUrl: string }>(
      'POST',
      '/mandates',
      {
        customerReference: 'c',
        returnUrl: 'http://merchant.test/return',
      },
    );
    const response = await sandbox.app.request(
      new URL(mandate.body.authorizationUrl).pathname,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'accountHolderName=Jane&iban=NL00PAYF0000000001',
      },
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Enter a valid IBAN');
  });

  it('fails a mandate with the mandate failure IBAN', async () => {
    const { id } = await sandbox.activeMandate(MAGIC_IBANS.mandateFailed);

    expect((await sandbox.call('GET', `/mandates/${id}`)).body).toMatchObject({
      status: 'failed',
      failureCode: 'invalid_bank_details',
    });
    expect(sandbox.eventTypes()).toEqual(['mandate.failed']);
  });

  it('collects a charge up to paid_out and signs every webhook', async () => {
    const { id: mandateId } = await sandbox.activeMandate(MAGIC_IBANS.success);
    const created = await sandbox.charge(mandateId, 'key-1');

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'pending_submission',
      chargeDate: '2026-10-27',
    });

    await sandbox.advance(15);

    expect(await sandbox.statusOf(created.body.id)).toMatchObject({ status: 'paid_out' });
    expect(sandbox.eventTypes()).toEqual([
      'mandate.active',
      'charge.submitted',
      'charge.confirmed',
      'charge.paid_out',
    ]);
    for (const { body, headers } of sandbox.received) {
      const header = headers.get('payflow-signature') ?? '';
      expect(
        verifySignature({
          secret: SECRET,
          body,
          header,
          now: Math.floor(sandbox.now() / 1000),
        }),
      ).toBe(true);
    }
  });

  it.each([
    ['insufficientFunds', 'insufficient_funds'],
    ['referToPayer', 'refer_to_payer'],
    ['failedWithoutCode', null],
  ] as const)('fails a charge with the %s IBAN', async (scenario, failureCode) => {
    const { id: mandateId } = await sandbox.activeMandate(MAGIC_IBANS[scenario]);
    const created = await sandbox.charge(mandateId, `key-${scenario}`);

    await sandbox.advance(15);

    expect(await sandbox.statusOf(created.body.id)).toEqual(
      expect.objectContaining({ status: 'failed', failureCode }),
    );
  });

  it('succeeds on retry after insufficient funds once', async () => {
    const { id: mandateId } = await sandbox.activeMandate(
      MAGIC_IBANS.insufficientFundsOnce,
    );
    const first = await sandbox.charge(mandateId, 'first');
    await sandbox.advance(10);
    const retry = await sandbox.charge(mandateId, 'retry');
    await sandbox.advance(15);

    expect(await sandbox.statusOf(first.body.id)).toMatchObject({
      status: 'failed',
      failureCode: 'insufficient_funds',
    });
    expect(await sandbox.statusOf(retry.body.id)).toMatchObject({ status: 'paid_out' });
  });

  it('cancels the mandate when the account is closed', async () => {
    const { id: mandateId } = await sandbox.activeMandate(MAGIC_IBANS.accountClosed);
    const created = await sandbox.charge(mandateId, 'closed');
    await sandbox.advance(10);

    expect(await sandbox.statusOf(created.body.id)).toMatchObject({
      status: 'failed',
      failureCode: 'account_closed',
    });
    expect((await sandbox.call('GET', `/mandates/${mandateId}`)).body).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'bank_account_closed',
    });
    expect(sandbox.eventTypes().slice(-2)).toEqual([
      'charge.failed',
      'mandate.cancelled',
    ]);
  });

  it('charges back a paid out charge with the chargeback IBAN', async () => {
    const { id: mandateId } = await sandbox.activeMandate(MAGIC_IBANS.chargeback);
    const created = await sandbox.charge(mandateId, 'chargeback');
    await sandbox.advance(20);

    expect(await sandbox.statusOf(created.body.id)).toMatchObject({
      status: 'charged_back',
    });
    expect(sandbox.eventTypes().at(-1)).toBe('charge.charged_back');
  });

  it('fails pending charges when the payer cancels the mandate', async () => {
    const { id: mandateId } = await sandbox.activeMandate(MAGIC_IBANS.success);
    const created = await sandbox.charge(mandateId, 'pending');

    await sandbox.call('POST', `/sandbox/mandates/${mandateId}/cancel`);
    await sandbox.advance(1);

    expect(await sandbox.statusOf(created.body.id)).toMatchObject({
      status: 'failed',
      failureCode: 'mandate_cancelled',
    });
    expect((await sandbox.charge(mandateId, 'after-cancel')).status).toBe(422);
  });

  it('returns the same charge for the same idempotency key', async () => {
    const { id: mandateId } = await sandbox.activeMandate(MAGIC_IBANS.success);
    const first = await sandbox.charge(mandateId, 'same');
    const second = await sandbox.charge(mandateId, 'same');
    const conflicting = await sandbox.charge(mandateId, 'same', { amount: 1 });
    const missingKey = await sandbox.call('POST', '/charges', {
      mandateId,
      amount: 100,
      currency: 'EUR',
    });

    expect(second.body.id).toBe(first.body.id);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(conflicting.status).toBe(422);
    expect(missingKey.status).toBe(400);
    expect(
      (await sandbox.call<{ data: unknown[] }>('GET', `/charges?mandateId=${mandateId}`))
        .body.data,
    ).toHaveLength(1);
  });

  it('refuses a charge date less than three business days ahead', async () => {
    const { id: mandateId } = await sandbox.activeMandate(MAGIC_IBANS.success);
    const response = await sandbox.charge(mandateId, 'early', {
      chargeDate: '2026-10-26',
    });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: { code: 'charge_date_too_early', earliestChargeDate: '2026-10-27' },
    });
  });

  it('forces a transition and replays an event', async () => {
    const { id: mandateId } = await sandbox.activeMandate(MAGIC_IBANS.success);
    const created = await sandbox.charge(mandateId, 'forced');

    const forced = await sandbox.call(
      'POST',
      `/sandbox/charges/${created.body.id}/transition`,
      {
        status: 'failed',
        failureCode: 'refer_to_payer',
      },
    );
    const invalid = await sandbox.call(
      'POST',
      `/sandbox/charges/${created.body.id}/transition`,
      { status: 'paid_out' },
    );
    const events = await sandbox.call<{ data: { id: string }[] }>(
      'GET',
      `/events?resourceId=${created.body.id}`,
    );
    const eventId = events.body.data[0]?.id ?? '';
    await sandbox.call('POST', `/sandbox/events/${eventId}/replay`);
    await sandbox.advance(1);

    expect(forced.body).toMatchObject({
      status: 'failed',
      failureCode: 'refer_to_payer',
    });
    expect(invalid.status).toBe(422);
    expect(sandbox.eventTypes().filter((type) => type === 'charge.failed')).toHaveLength(
      2,
    );
  });
});

describe('PayFlow sandbox webhooks and limits', () => {
  it('retries a failing receiver with backoff', async () => {
    const sandbox = setup({ webhookStatus: 500 });
    await sandbox.activeMandate(MAGIC_IBANS.success);
    expect(sandbox.received).toHaveLength(1);

    await sandbox.advance(3);
    expect(sandbox.received.length).toBe(4);

    await sandbox.advance(80);
    expect(sandbox.received.length).toBe(9);
  });

  it('answers 429 with Retry-After over the rate limit', async () => {
    const sandbox = setup({ rateLimit: 2 });
    const statuses = [];
    for (let request = 0; request < 3; request++) {
      statuses.push(await sandbox.call('GET', '/mandates'));
    }

    expect(statuses.map((response) => response.status)).toEqual([200, 200, 429]);
    expect(statuses[2]?.headers.get('retry-after')).toBe('1');
  });
});
