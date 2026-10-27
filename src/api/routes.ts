import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import { z } from 'zod';

import { ChargeStatus } from '#src/domain/types.ts';
import type { PaymentService } from '#src/engine/payments.ts';
import { ApiError, notFound } from '#src/lib/errors.ts';
import { serializeEvent } from '#src/engine/webhooks.ts';
import type { Store } from '#src/store/store.ts';

import { jsonBody, listResponse, Metadata, Pagination, parse } from './validation.ts';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const CreateMandateBody = z.object({
  customerReference: z.string().trim().min(1).max(100),
  returnUrl: z.url(),
  metadata: Metadata,
});

const CreateChargeBody = z.object({
  mandateId: z.string(),
  amount: z.int().min(1).max(50_000_000),
  currency: z.string().length(3).toUpperCase(),
  chargeDate: z.iso.date().optional(),
  description: z.string().max(140).optional(),
  metadata: Metadata,
});

const TransitionBody = z.object({
  status: z.enum(ChargeStatus),
  failureCode: z.string().nullable().optional(),
});

export const apiRoutes = ({
  payments,
  store,
  now,
}: {
  payments: PaymentService;
  store: Store;
  now: () => number;
}) => {
  const router = new Hono();

  router.post('/mandates', async (c) => {
    const body = parse(CreateMandateBody, await jsonBody(c));
    return c.json(payments.publicMandate(payments.createMandate(body)), 201);
  });

  router.get('/mandates', (c) => {
    const query = parse(
      Pagination.extend({ customerReference: z.string().optional() }),
      c.req.query(),
    );
    const mandates = store.listMandates(query, { ...query, limit: query.limit + 1 });
    return c.json(
      listResponse(
        mandates.map((mandate) => payments.publicMandate(mandate)),
        query.limit,
      ),
    );
  });

  router.get('/mandates/:id', (c) =>
    c.json(payments.publicMandate(payments.getMandate(c.req.param('id')))),
  );

  router.post('/mandates/:id/cancel', (c) =>
    c.json(
      payments.publicMandate(
        payments.cancelMandate(c.req.param('id'), 'cancelled_by_merchant'),
      ),
    ),
  );

  router.post('/charges', async (c) => {
    const key = c.req.header('idempotency-key');
    if (!key || key.length > 255) {
      throw new ApiError({
        status: 400,
        code: 'idempotency_key_missing',
        message: 'POST /charges requires an Idempotency-Key header (1 to 255 characters)',
      });
    }
    const raw = await jsonBody(c);
    const fingerprint = createHash('sha256').update(JSON.stringify(raw)).digest('hex');

    const previous = store.findIdempotentResponse(key, now() - IDEMPOTENCY_TTL_MS);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new ApiError({
          status: 422,
          code: 'idempotency_key_reused',
          message: 'This Idempotency-Key was used with a different request body',
        });
      }
      c.header('Idempotent-Replayed', 'true');
      return c.body(previous.body, previous.status as 201, {
        'content-type': 'application/json',
      });
    }

    const body = parse(CreateChargeBody, raw);
    const charge = payments.publicCharge(payments.createCharge(body));
    store.saveIdempotentResponse({
      key,
      fingerprint,
      status: 201,
      body: JSON.stringify(charge),
      createdAt: now(),
    });
    return c.json(charge, 201);
  });

  router.get('/charges', (c) => {
    const query = parse(
      Pagination.extend({ mandateId: z.string().optional() }),
      c.req.query(),
    );
    const charges = store.listCharges(query, { ...query, limit: query.limit + 1 });
    return c.json(
      listResponse(
        charges.map((charge) => payments.publicCharge(charge)),
        query.limit,
      ),
    );
  });

  router.get('/charges/:id', (c) =>
    c.json(payments.publicCharge(payments.getCharge(c.req.param('id')))),
  );

  router.post('/charges/:id/cancel', (c) =>
    c.json(payments.publicCharge(payments.cancelCharge(c.req.param('id')))),
  );

  router.get('/events', (c) => {
    const query = parse(
      Pagination.extend({
        type: z.string().optional(),
        resourceId: z.string().optional(),
      }),
      c.req.query(),
    );
    const events = store.listEvents(query, { ...query, limit: query.limit + 1 });
    return c.json(
      listResponse(
        events.map((event) => JSON.parse(serializeEvent(event))),
        query.limit,
      ),
    );
  });

  router.get('/events/:id', (c) => {
    const event = store.findEvent(c.req.param('id'));
    if (!event) {
      throw notFound('event', c.req.param('id'));
    }
    return c.json(JSON.parse(serializeEvent(event)));
  });

  router.post('/sandbox/charges/:id/transition', async (c) => {
    const body = parse(TransitionBody, await jsonBody(c));
    return c.json(
      payments.publicCharge(payments.forceChargeTransition(c.req.param('id'), body)),
    );
  });

  router.post('/sandbox/mandates/:id/cancel', (c) =>
    c.json(
      payments.publicMandate(
        payments.cancelMandate(c.req.param('id'), 'cancelled_by_payer'),
      ),
    ),
  );

  router.post('/sandbox/events/:id/replay', (c) => {
    const delivery = payments.replayEvent(c.req.param('id'));
    return c.json(
      { deliveryId: delivery.id, eventId: delivery.eventId, url: delivery.url },
      202,
    );
  });

  return router;
};
