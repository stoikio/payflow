import { MAX_ATTEMPTS } from '#src/engine/retry-schedule.ts';
import { serializeEvent, webhookHeaders } from '#src/engine/webhooks.ts';
import {
  type Attempt,
  type Delivery,
  deliveryState,
  type StoredEvent,
} from '#src/store/store.ts';

import { lastResult } from './dashboard-page.ts';
import { escape, layout, status, table, time } from './html.ts';

const succeeded = (attempt: Attempt) =>
  attempt.statusCode !== null && attempt.statusCode >= 200 && attempt.statusCode < 300;

const attemptResult = (attempt: Attempt) =>
  attempt.statusCode === null
    ? `<span class="result-error">${escape(attempt.error ?? 'No response')}</span>`
    : `<span class="status ${succeeded(attempt) ? 'delivered' : 'failed'}">HTTP ${attempt.statusCode}</span>`;

const responseBody = (attempt: Attempt) => {
  if (attempt.responseBody === null) {
    return '<span class="muted">No response</span>';
  }
  return attempt.responseBody === ''
    ? '<span class="muted">Empty</span>'
    : `<pre class="response">${escape(attempt.responseBody)}</pre>`;
};

const STYLES = `<style>
  .title-row { display: flex; align-items: center; gap: 12px; margin: 8px 0 16px; }
  .title-row h1 { font-size: 18px; margin: 0; }
  .title-row form { margin-left: auto; }
  dl.summary { display: grid; grid-template-columns: max-content 1fr; gap: 6px 24px; margin: 0; }
  dl.summary dt { color: #697386; }
  dl.summary dd { margin: 0; }
  .attempts td { white-space: normal; vertical-align: top; }
  .attempts td:first-child, .attempts td:nth-child(2), .attempts td:nth-child(5) { white-space: nowrap; }
  .attempts code { word-break: break-all; }
  .attempts .status { white-space: nowrap; }
  pre.response { max-height: 160px; max-width: 360px; padding: 8px 10px; white-space: pre-wrap; word-break: break-all; }
  h3 { font-size: 13px; margin: 16px 0 6px; color: #697386; font-weight: 500; }
</style>`;

export const deliveryPage = ({
  delivery,
  event,
  attempts,
  otherDeliveries,
}: {
  delivery: Delivery;
  event: StoredEvent;
  attempts: Attempt[];
  otherDeliveries: Delivery[];
}) => {
  const state = deliveryState(delivery);
  const lastAttempt = attempts.at(-1);
  const headers = lastAttempt?.signature
    ? Object.entries(webhookHeaders(event.id, lastAttempt.signature))
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n')
    : null;
  const nextAttempt =
    state === 'pending' && delivery.nextAttemptAt !== null
      ? time(delivery.nextAttemptAt)
      : '';

  return layout({
    title: `Delivery ${delivery.id}`,
    refreshSeconds: state === 'pending' ? 3 : undefined,
    current: 'dashboard',
    head: STYLES,
    body: `<p><a href="/dashboard#deliveries">&larr; Webhook deliveries</a></p>
<div class="title-row">
  <h1>Delivery <code>${escape(delivery.id)}</code></h1>
  ${status(state)}
  <form method="post" action="/dashboard/deliveries/${escape(delivery.id)}/replay">
    <button type="submit" class="inline">Replay event</button>
  </form>
</div>
<div class="card">
<dl class="summary">
  <dt>Event</dt><dd><code>${escape(event.id)}</code> ${escape(event.type)}</dd>
  <dt>Resource</dt><dd><code>${escape(event.resourceId)}</code></dd>
  <dt>URL</dt><dd><code>${escape(delivery.url)}</code></dd>
  <dt>Attempts</dt><dd>${delivery.attemptCount} of ${MAX_ATTEMPTS}</dd>
  <dt>Last result</dt><dd>${
    state === 'delivered'
      ? escape(lastResult(delivery))
      : `<span class="result-error">${escape(lastResult(delivery))}</span>`
  }</dd>
  ${nextAttempt ? `<dt>Next attempt</dt><dd>${nextAttempt}</dd>` : ''}
  <dt>Created</dt><dd>${time(delivery.createdAt)}</dd>
</dl>
</div>
<h2>Attempts</h2>
<div class="attempts">
${table(
  ['#', 'Attempted at', 'URL', 'Result', 'Duration', 'Signature', 'Response body'],
  attempts.map((attempt, index) => [
    String(index + 1),
    time(attempt.attemptedAt),
    `<code>${escape(attempt.url ?? delivery.url)}</code>`,
    attemptResult(attempt),
    `${attempt.durationMs} ms`,
    attempt.signature ? `<code>${escape(attempt.signature)}</code>` : '',
    responseBody(attempt),
  ]),
  attempts.map((attempt) => (succeeded(attempt) ? '' : 'failed')),
)}
</div>
<h2>Request</h2>
<h3>Headers${lastAttempt ? ', last attempt' : ''}</h3>
${headers ? `<pre>${escape(headers)}</pre>` : '<p class="muted">Not sent yet.</p>'}
<h3>Body</h3>
<pre>${escape(JSON.stringify(JSON.parse(serializeEvent(event)), null, 2))}</pre>
<h2>Other deliveries of this event</h2>
${table(
  ['Delivery', 'Status', 'Attempts', 'Last result', 'Created'],
  otherDeliveries.map((other) => [
    `<a href="/dashboard/deliveries/${escape(other.id)}"><code>${escape(other.id)}</code></a>`,
    status(deliveryState(other)),
    String(other.attemptCount),
    escape(lastResult(other)),
    time(other.createdAt),
  ]),
)}`,
  });
};
