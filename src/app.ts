import { Hono } from 'hono';
import { logger } from 'hono/logger';

import { apiRoutes } from '#src/api/routes.ts';
import { rateLimit, requireApiKey } from '#src/api/middleware.ts';
import type { Config } from '#src/config.ts';
import { PaymentService } from '#src/engine/payments.ts';
import { WebhookDispatcher } from '#src/engine/webhooks.ts';
import { ApiError } from '#src/lib/errors.ts';
import { authorizePage, messagePage } from '#src/pages/authorize-page.ts';
import { dashboardPage } from '#src/pages/dashboard-page.ts';
import type { Database } from '#src/store/database.ts';
import { Store } from '#src/store/store.ts';

export type AppOptions = {
  database: Database;
  config: Config;
  now?: () => number;
  fetch?: typeof fetch;
  random?: () => number;
  logRequests?: boolean;
};

export const createApp = ({
  database,
  config,
  now = Date.now,
  fetch,
  random,
  logRequests = false,
}: AppOptions) => {
  const store = new Store(database);
  const dispatcher = new WebhookDispatcher({ store, config, now, fetch, random });
  const payments = new PaymentService({ store, dispatcher, config, now });

  const app = new Hono();
  if (logRequests) {
    app.use(logger());
  }

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(error.toJSON(), error.status);
    }
    console.error(error);
    return c.json(
      new ApiError({
        status: 500,
        type: 'api_error',
        code: 'internal_error',
        message: 'Internal error',
      }).toJSON(),
      500,
    );
  });
  app.notFound((c) =>
    c.json(
      new ApiError({
        status: 404,
        code: 'route_not_found',
        message: 'Route not found',
      }).toJSON(),
      404,
    ),
  );

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/authorize/:token', (c) => {
    const mandate = store.findMandateByToken(c.req.param('token'));
    if (!mandate) {
      return c.html(
        messagePage('Link not found', 'This authorization link does not exist.'),
        404,
      );
    }
    if (mandate.status !== 'pending_customer_approval') {
      return c.html(
        messagePage('Already confirmed', 'This bank debit was already set up.'),
        410,
      );
    }
    return c.html(authorizePage({ mandate, merchantName: config.merchantName }));
  });

  app.post('/authorize/:token', async (c) => {
    const form = await c.req.parseBody();
    const values = {
      accountHolderName: String(form.accountHolderName ?? ''),
      iban: String(form.iban ?? ''),
    };
    try {
      const mandate = payments.authorizeMandate(c.req.param('token'), values);
      const returnUrl = new URL(mandate.returnUrl);
      returnUrl.searchParams.set('mandateId', mandate.id);
      return c.redirect(returnUrl.toString(), 303);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      const mandate = store.findMandateByToken(c.req.param('token'));
      if (error.status === 400 && mandate) {
        return c.html(
          authorizePage({
            mandate,
            merchantName: config.merchantName,
            error: error.message,
            values,
          }),
          400,
        );
      }
      return c.html(messagePage('Cannot confirm', error.message), error.status);
    }
  });

  app.get('/dashboard', (c) => {
    const deliveries = store.listDeliveries(100);
    const events = new Map(
      deliveries.flatMap((delivery) => {
        const event = store.findEvent(delivery.eventId);
        return event ? [[event.id, event] as const] : [];
      }),
    );
    return c.html(
      dashboardPage({
        mandates: store.listMandates({}, { limit: 50 }),
        charges: store.listCharges({}, { limit: 100 }),
        events,
        deliveries,
        webhookUrl: config.webhookUrl,
        chaos: config.webhookChaos,
      }),
    );
  });

  const api = new Hono();
  api.use(requireApiKey(config.apiKey));
  api.use(rateLimit({ limit: config.rateLimitPerSecond, now }));
  api.route('/', apiRoutes({ payments, store, now }));
  app.route('/', api);

  /** Runs scheduled transitions and due webhook deliveries. */
  const tick = async () => {
    payments.advance();
    await dispatcher.tick();
  };

  return { app, tick, store };
};
