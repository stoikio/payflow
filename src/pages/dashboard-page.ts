import type { Charge, Mandate } from '#src/domain/types.ts';
import type { Delivery, StoredEvent } from '#src/store/store.ts';

import { escape, layout } from './html.ts';

const status = (value: string) =>
  `<span class="status ${escape(value)}">${escape(value)}</span>`;
const time = (value: string | number | null) =>
  value === null
    ? ''
    : escape(new Date(value).toISOString().replace('T', ' ').slice(0, 19));

const table = (headers: string[], rows: string[][]) =>
  rows.length === 0
    ? '<p class="muted">Nothing yet.</p>'
    : `<table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows
        .map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;

export const dashboardPage = ({
  mandates,
  charges,
  events,
  deliveries,
  webhookUrl,
  chaos,
}: {
  mandates: Mandate[];
  charges: Charge[];
  events: Map<string, StoredEvent>;
  deliveries: Delivery[];
  webhookUrl: string;
  chaos: boolean;
}) =>
  layout({
    title: 'PayFlow sandbox dashboard',
    refreshSeconds: 3,
    body: `<p class="muted">Read only, refreshes every 3 seconds. Webhooks go to <code>${escape(webhookUrl)}</code>${
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
<h2>Webhook deliveries</h2>
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
    return [
      `<code>${escape(delivery.id)}</code>`,
      `<code>${escape(delivery.eventId)}</code>`,
      escape(event?.type ?? ''),
      `<code>${escape(event?.resourceId ?? '')}</code>`,
      status(delivery.status),
      String(delivery.attemptCount),
      escape(
        delivery.lastStatusCode
          ? `HTTP ${delivery.lastStatusCode}`
          : (delivery.lastError ?? ''),
      ),
      time(delivery.status === 'pending' ? delivery.nextAttemptAt : null),
    ];
  }),
)}`,
  });
