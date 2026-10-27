import type { Config } from '#src/config.ts';
import { newId } from '#src/lib/ids.ts';
import { SIGNATURE_HEADER, signPayload } from '#src/lib/signature.ts';
import {
  type Attempt,
  type Delivery,
  deliveryState,
  type StoredEvent,
  type Store,
} from '#src/store/store.ts';

import { MAX_ATTEMPTS, nextRetryDelayMs } from './retry-schedule.ts';

const TIMEOUT_MS = 10_000;
const CHAOS_MAX_DELAY_MS = 8_000;
const CHAOS_DUPLICATE_RATE = 0.3;
const RESPONSE_BODY_LIMIT_BYTES = 2048;

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

/** Headers of a webhook request, in the case shown to integrators. */
export const webhookHeaders = (eventId: string, signature: string) => ({
  'Content-Type': 'application/json',
  'User-Agent': 'PayFlow-Webhooks/1.0',
  'PayFlow-Event-Id': eventId,
  [SIGNATURE_HEADER]: signature,
});

export const publicDelivery = (delivery: Delivery, attempts: Attempt[]) => ({
  id: delivery.id,
  eventId: delivery.eventId,
  url: delivery.url,
  status: deliveryState(delivery),
  nextAttemptAt:
    deliveryState(delivery) === 'pending' && delivery.nextAttemptAt !== null
      ? new Date(delivery.nextAttemptAt).toISOString()
      : null,
  createdAt: delivery.createdAt,
  updatedAt: delivery.updatedAt,
  attempts: attempts.map((attempt) => ({
    id: attempt.id,
    attemptedAt: attempt.attemptedAt,
    url: attempt.url ?? delivery.url,
    signature: attempt.signature,
    statusCode: attempt.statusCode,
    error: attempt.error,
    durationMs: attempt.durationMs,
    responseBody: attempt.responseBody,
  })),
});

/** Network errors from `fetch` hide the useful message in `cause`, sometimes one per address. */
const describeError = (caught: unknown) => {
  if (!(caught instanceof Error)) {
    return 'request failed';
  }
  const { cause } = caught;
  if (cause instanceof AggregateError && cause.errors.length > 0) {
    return cause.errors
      .map((error: unknown) => (error instanceof Error ? error.message : String(error)))
      .join('; ');
  }
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  return caught.message || caught.name;
};

/** Reads at most `RESPONSE_BODY_LIMIT_BYTES`, then drops the rest of the stream. */
const readBodyStart = async (response: Response) => {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < RESPONSE_BODY_LIMIT_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    // Keep what was read before the stream failed.
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(
    Buffer.concat(chunks).subarray(0, RESPONSE_BODY_LIMIT_BYTES),
  );
};

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
    const signature = signPayload(
      this.config.webhookSecret,
      body,
      Math.floor(startedAt / 1000),
    );
    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;

    try {
      const response = await this.fetch(delivery.url, {
        method: 'POST',
        headers: webhookHeaders(event.id, signature),
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      statusCode = response.status;
      responseBody = await readBodyStart(response);
    } catch (caught) {
      error = describeError(caught);
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
      url: delivery.url,
      signature,
      statusCode,
      error,
      durationMs: this.now() - startedAt,
      responseBody,
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
