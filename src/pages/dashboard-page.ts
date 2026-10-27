import type { Charge, Mandate } from '#src/domain/types.ts';
import { MAX_ATTEMPTS } from '#src/engine/retry-schedule.ts';
import {
  type Delivery,
  type DeliveryState,
  deliveryState,
  DELIVERY_STATES,
  type StoredEvent,
} from '#src/store/store.ts';

import { escape, layout, status, table, time } from './html.ts';

export const lastResult = (delivery: Delivery) =>
  delivery.lastStatusCode
    ? `HTTP ${delivery.lastStatusCode}`
    : (delivery.lastError ?? '');

const deliveryRowClass = (delivery: Delivery) => {
  const state = deliveryState(delivery);
  if (state === 'failed') {
    return 'failed';
  }
  return state === 'pending' && delivery.attemptCount > 0 ? 'retrying' : '';
};

const FILTER_LABELS: Record<DeliveryState, string> = {
  failed: 'Failed',
  pending: 'Pending',
  delivered: 'Delivered',
};

const filters = (
  current: DeliveryState | undefined,
  counts: Record<DeliveryState, number>,
) => {
  const total = DELIVERY_STATES.reduce((sum, state) => sum + counts[state], 0);
  const options = [
    { label: 'All', href: '/dashboard#deliveries', count: total, active: !current },
    ...(['failed', 'pending', 'delivered'] as const).map((state) => ({
      label: FILTER_LABELS[state],
      href: `/dashboard?deliveries=${state}#deliveries`,
      count: counts[state],
      active: current === state,
    })),
  ];
  return `<nav class="filters" aria-label="Filter deliveries">${options
    .map(
      (option) =>
        `<a href="${option.href}"${option.active ? ' aria-current="true"' : ''}>${option.label} ${option.count}</a>`,
    )
    .join('')}</nav>`;
};

export const dashboardPage = ({
  mandates,
  charges,
  events,
  deliveries,
  deliveryCounts,
  deliveryFilter,
  webhookUrl,
  chaos,
}: {
  mandates: Mandate[];
  charges: Charge[];
  events: Map<string, StoredEvent>;
  deliveries: Delivery[];
  deliveryCounts: Record<DeliveryState, number>;
  deliveryFilter?: DeliveryState;
  webhookUrl: string;
  chaos: boolean;
}) =>
  layout({
    title: 'PayFlow sandbox dashboard',
    refreshSeconds: 3,
    current: 'dashboard',
    body: `<p class="muted">Refreshes every 3 seconds. Webhooks go to <code>${escape(webhookUrl)}</code>${
      chaos ? ' (chaos mode on)' : ''
    }.</p>
<h2>Mandates</h2>
${table(
  [
    'ID',
    'Customer reference',
    'Status',
    'IBAN',
    'Failure / cancellation',
    'Created',
    'Updated',
  ],
  mandates.map((mandate) => [
    `<code>${escape(mandate.id)}</code>`,
    escape(mandate.customerReference),
    status(mandate.status),
    mandate.iban ? `<code>${escape(mandate.iban)}</code>` : '',
    escape(mandate.failureCode ?? mandate.cancellationReason ?? ''),
    time(mandate.createdAt),
    time(mandate.updatedAt),
  ]),
)}
<h2>Charges</h2>
${table(
  [
    'ID',
    'Mandate',
    'Amount',
    'Charge date',
    'Status',
    'Failure code',
    'Metadata',
    'Updated',
  ],
  charges.map((charge) => [
    `<code>${escape(charge.id)}</code>`,
    `<code>${escape(charge.mandateId)}</code>`,
    `${(charge.amount / 100).toFixed(2)} ${escape(charge.currency)}`,
    escape(charge.chargeDate),
    status(charge.status),
    escape(charge.failureCode ?? ''),
    `<code>${escape(JSON.stringify(charge.metadata))}</code>`,
    time(charge.updatedAt),
  ]),
)}
<div class="section-title" id="deliveries"><h2>Webhook deliveries</h2>${filters(deliveryFilter, deliveryCounts)}</div>
${table(
  [
    'Delivery',
    'Event',
    'Type',
    'Resource',
    'Status',
    'Attempts',
    'Last result',
    'Next attempt',
  ],
  deliveries.map((delivery) => {
    const event = events.get(delivery.eventId);
    const state = deliveryState(delivery);
    return [
      `<a href="/dashboard/deliveries/${escape(delivery.id)}"><code>${escape(delivery.id)}</code></a>`,
      `<code>${escape(delivery.eventId)}</code>`,
      escape(event?.type ?? ''),
      `<code>${escape(event?.resourceId ?? '')}</code>`,
      status(state),
      `${delivery.attemptCount} / ${MAX_ATTEMPTS}`,
      state === 'delivered'
        ? escape(lastResult(delivery))
        : `<span class="result-error">${escape(lastResult(delivery))}</span>`,
      time(state === 'pending' ? delivery.nextAttemptAt : null),
    ];
  }),
  deliveries.map(deliveryRowClass),
)}`,
  });
