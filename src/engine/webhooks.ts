import type { Config } from '#src/config.ts';
import { newId } from '#src/lib/ids.ts';
import { SIGNATURE_HEADER, signPayload } from '#src/lib/signature.ts';
import type { Delivery, StoredEvent, Store } from '#src/store/store.ts';

import { MAX_ATTEMPTS, nextRetryDelayMs } from './retry-schedule.ts';

const TIMEOUT_MS = 10_000;
const CHAOS_MAX_DELAY_MS = 8_000;
const CHAOS_DUPLICATE_RATE = 0.3;

export type WebhookDispatcherOptions = {
  store: Store;
  config: Pick<
    Config,
    'webhookUrl' | 'webhookSecret' | 'webhookChaos' | 'webhookRetrySecondsPerHour'
  >;
  now: () => number;
  fetch?: typeof fetch;
  random?: () => number;
};

export const serializeEvent = (event: StoredEvent) =>
  JSON.stringify({
    id: event.id,
    type: event.type,
    createdAt: event.createdAt,
    resourceType: event.resourceType,
    data: event.data,
  });

export class WebhookDispatcher {
  private readonly store: Store;
  private readonly config: WebhookDispatcherOptions['config'];
  private readonly now: () => number;
  private readonly fetch: typeof fetch;
  private readonly random: () => number;

  constructor(options: WebhookDispatcherOptions) {
    this.store = options.store;
    this.config = options.config;
    this.now = options.now;
    this.fetch = options.fetch ?? fetch;
    this.random = options.random ?? Math.random;
  }

  /** Queues the delivery of a new event. In chaos mode it may be delayed and sent twice. */
  enqueue(event: StoredEvent) {
    const copies =
      this.config.webhookChaos && this.random() < CHAOS_DUPLICATE_RATE ? 2 : 1;
    for (let copy = 0; copy < copies; copy++) {
      const delay = this.config.webhookChaos
        ? Math.round(this.random() * CHAOS_MAX_DELAY_MS)
        : 0;
      this.createDelivery(event.id, this.now() + delay);
    }
  }

  replay(event: StoredEvent) {
    return this.createDelivery(event.id, this.now());
  }

  /** Sends every delivery that is due. Resolves once all of them got an answer or failed. */
  async tick() {
    const due = this.store.dueDeliveries(this.now());
    for (const delivery of due) {
      this.store.saveDelivery({
        ...delivery,
        status: 'sending',
        updatedAt: this.isoNow(),
      });
    }
    await Promise.allSettled(due.map((delivery) => this.send(delivery)));
  }

  private createDelivery(eventId: string, nextAttemptAt: number) {
    const delivery: Delivery = {
      id: newId('WD'),
      eventId,
      url: this.config.webhookUrl,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt,
      lastStatusCode: null,
      lastError: null,
      firstAttemptAt: null,
      createdAt: this.isoNow(),
      updatedAt: this.isoNow(),
    };
    this.store.saveDelivery(delivery);
    return delivery;
  }

  private async send(delivery: Delivery) {
    const event = this.store.findEvent(delivery.eventId);
    if (!event) {
      return;
    }

    const body = serializeEvent(event);
    const startedAt = this.now();
    let statusCode: number | null = null;
    let error: string | null = null;

    try {
      const response = await this.fetch(delivery.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'PayFlow-Webhooks/1.0',
          'payflow-event-id': event.id,
          [SIGNATURE_HEADER]: signPayload(
            this.config.webhookSecret,
            body,
            Math.floor(startedAt / 1000),
          ),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      statusCode = response.status;
      await response.body?.cancel();
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.cause instanceof Error
            ? caught.cause.message
            : caught.message
          : 'request failed';
    }

    const attemptCount = delivery.attemptCount + 1;
    const succeeded = statusCode !== null && statusCode >= 200 && statusCode < 300;
    const retryDelay = succeeded
      ? null
      : nextRetryDelayMs(attemptCount, this.config.webhookRetrySecondsPerHour);

    this.store.insertAttempt({
      id: newId('WA'),
      deliveryId: delivery.id,
      attemptedAt: new Date(startedAt).toISOString(),
      statusCode,
      error: error ?? (succeeded ? null : `HTTP ${statusCode}`),
      durationMs: this.now() - startedAt,
    });
    this.store.saveDelivery({
      ...delivery,
      status: succeeded
        ? 'succeeded'
        : retryDelay === null || attemptCount >= MAX_ATTEMPTS
          ? 'failed'
          : 'pending',
      attemptCount,
      nextAttemptAt: retryDelay === null ? null : this.now() + retryDelay,
      lastStatusCode: statusCode,
      lastError: succeeded ? null : (error ?? `HTTP ${statusCode}`),
      firstAttemptAt: delivery.firstAttemptAt ?? startedAt,
      updatedAt: this.isoNow(),
    });
  }

  private isoNow() {
    return new Date(this.now()).toISOString();
  }
}
