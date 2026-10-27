import type { Charge, Mandate } from '#src/domain/types.ts';

import type { Database } from './database.ts';

type Row = Record<string, unknown>;

const str = (value: unknown) =>
  value === null || value === undefined ? null : String(value);
const num = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);

const toMandate = (row: Row): Mandate => ({
  id: String(row.id),
  customerReference: String(row.customer_reference),
  returnUrl: String(row.return_url),
  status: String(row.status) as Mandate['status'],
  authorizationToken: String(row.authorization_token),
  accountHolderName: str(row.account_holder_name),
  iban: str(row.iban),
  failureCode: str(row.failure_code),
  cancellationReason: str(row.cancellation_reason),
  metadata: JSON.parse(String(row.metadata)),
  plan: JSON.parse(String(row.plan)),
  nextTransitionAt: num(row.next_transition_at),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const toCharge = (row: Row): Charge => ({
  id: String(row.id),
  mandateId: String(row.mandate_id),
  amount: Number(row.amount),
  currency: String(row.currency),
  chargeDate: String(row.charge_date),
  description: str(row.description),
  metadata: JSON.parse(String(row.metadata)),
  status: String(row.status) as Charge['status'],
  failureCode: str(row.failure_code),
  plan: JSON.parse(String(row.plan)),
  nextTransitionAt: num(row.next_transition_at),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export type StoredEvent = {
  id: string;
  type: string;
  resourceType: 'mandate' | 'charge';
  resourceId: string;
  data: Record<string, unknown>;
  createdAt: string;
};

const toEvent = (row: Row): StoredEvent => ({
  id: String(row.id),
  type: String(row.type),
  resourceType: String(row.resource_type) as StoredEvent['resourceType'],
  resourceId: String(row.resource_id),
  data: JSON.parse(String(row.data)),
  createdAt: String(row.created_at),
});

export type Delivery = {
  id: string;
  eventId: string;
  url: string;
  status: 'pending' | 'sending' | 'succeeded' | 'failed';
  attemptCount: number;
  nextAttemptAt: number | null;
  lastStatusCode: number | null;
  lastError: string | null;
  firstAttemptAt: number | null;
  createdAt: string;
  updatedAt: string;
};

const toDelivery = (row: Row): Delivery => ({
  id: String(row.id),
  eventId: String(row.event_id),
  url: String(row.url),
  status: String(row.status) as Delivery['status'],
  attemptCount: Number(row.attempt_count),
  nextAttemptAt: num(row.next_attempt_at),
  lastStatusCode: num(row.last_status_code),
  lastError: str(row.last_error),
  firstAttemptAt: num(row.first_attempt_at),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export type Page = { limit: number; startingAfter?: string };

/** Newest first, paginated with the id of the last item of the previous page. */
const page = (
  table: string,
  where: string,
  params: (string | number)[],
  { limit, startingAfter }: Page,
) => {
  const clauses = where ? [where] : [];
  const values = [...params];
  if (startingAfter) {
    clauses.push(`rowid < (SELECT rowid FROM ${table} WHERE id = ?)`);
    values.push(startingAfter);
  }
  const condition = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return {
    sql: `SELECT * FROM ${table} ${condition} ORDER BY rowid DESC LIMIT ?`,
    values: [...values, limit],
  };
};

export class Store {
  readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  transaction<T>(work: () => T) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  saveMandate(mandate: Mandate) {
    this.database
      .prepare(
        `INSERT INTO mandates (id, customer_reference, return_url, status, authorization_token,
           account_holder_name, iban, failure_code, cancellation_reason, metadata, plan,
           next_transition_at, created_at, updated_at)
         VALUES (:id, :customer_reference, :return_url, :status, :authorization_token,
           :account_holder_name, :iban, :failure_code, :cancellation_reason, :metadata, :plan,
           :next_transition_at, :created_at, :updated_at)
         ON CONFLICT (id) DO UPDATE SET
           status = excluded.status, account_holder_name = excluded.account_holder_name,
           iban = excluded.iban, failure_code = excluded.failure_code,
           cancellation_reason = excluded.cancellation_reason, plan = excluded.plan,
           next_transition_at = excluded.next_transition_at, updated_at = excluded.updated_at`,
      )
      .run({
        id: mandate.id,
        customer_reference: mandate.customerReference,
        return_url: mandate.returnUrl,
        status: mandate.status,
        authorization_token: mandate.authorizationToken,
        account_holder_name: mandate.accountHolderName,
        iban: mandate.iban,
        failure_code: mandate.failureCode,
        cancellation_reason: mandate.cancellationReason,
        metadata: JSON.stringify(mandate.metadata),
        plan: JSON.stringify(mandate.plan),
        next_transition_at: mandate.nextTransitionAt,
        created_at: mandate.createdAt,
        updated_at: mandate.updatedAt,
      });
  }

  findMandate(id: string) {
    const row = this.database.prepare('SELECT * FROM mandates WHERE id = ?').get(id);
    return row ? toMandate(row) : null;
  }

  findMandateByToken(token: string) {
    const row = this.database
      .prepare('SELECT * FROM mandates WHERE authorization_token = ?')
      .get(token);
    return row ? toMandate(row) : null;
  }

  listMandates(filter: { customerReference?: string }, pagination: Page) {
    const { sql, values } = filter.customerReference
      ? page('mandates', 'customer_reference = ?', [filter.customerReference], pagination)
      : page('mandates', '', [], pagination);
    return this.database
      .prepare(sql)
      .all(...values)
      .map(toMandate);
  }

  dueMandates(now: number) {
    return this.database
      .prepare(
        'SELECT * FROM mandates WHERE next_transition_at <= ? ORDER BY next_transition_at',
      )
      .all(now)
      .map(toMandate);
  }

  saveCharge(charge: Charge) {
    this.database
      .prepare(
        `INSERT INTO charges (id, mandate_id, amount, currency, charge_date, description, metadata,
           status, failure_code, plan, next_transition_at, created_at, updated_at)
         VALUES (:id, :mandate_id, :amount, :currency, :charge_date, :description, :metadata,
           :status, :failure_code, :plan, :next_transition_at, :created_at, :updated_at)
         ON CONFLICT (id) DO UPDATE SET
           status = excluded.status, failure_code = excluded.failure_code, plan = excluded.plan,
           next_transition_at = excluded.next_transition_at, updated_at = excluded.updated_at`,
      )
      .run({
        id: charge.id,
        mandate_id: charge.mandateId,
        amount: charge.amount,
        currency: charge.currency,
        charge_date: charge.chargeDate,
        description: charge.description,
        metadata: JSON.stringify(charge.metadata),
        status: charge.status,
        failure_code: charge.failureCode,
        plan: JSON.stringify(charge.plan),
        next_transition_at: charge.nextTransitionAt,
        created_at: charge.createdAt,
        updated_at: charge.updatedAt,
      });
  }

  findCharge(id: string) {
    const row = this.database.prepare('SELECT * FROM charges WHERE id = ?').get(id);
    return row ? toCharge(row) : null;
  }

  listCharges(filter: { mandateId?: string }, pagination: Page) {
    const { sql, values } = filter.mandateId
      ? page('charges', 'mandate_id = ?', [filter.mandateId], pagination)
      : page('charges', '', [], pagination);
    return this.database
      .prepare(sql)
      .all(...values)
      .map(toCharge);
  }

  countCharges(mandateId: string) {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM charges WHERE mandate_id = ?')
      .get(mandateId);
    return Number(row?.count ?? 0);
  }

  dueCharges(now: number) {
    return this.database
      .prepare(
        'SELECT * FROM charges WHERE next_transition_at <= ? ORDER BY next_transition_at',
      )
      .all(now)
      .map(toCharge);
  }

  insertEvent(event: StoredEvent) {
    this.database
      .prepare(
        `INSERT INTO events (id, type, resource_type, resource_id, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.type,
        event.resourceType,
        event.resourceId,
        JSON.stringify(event.data),
        event.createdAt,
      );
  }

  findEvent(id: string) {
    const row = this.database.prepare('SELECT * FROM events WHERE id = ?').get(id);
    return row ? toEvent(row) : null;
  }

  listEvents(filter: { type?: string; resourceId?: string }, pagination: Page) {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.type) {
      clauses.push('type = ?');
      params.push(filter.type);
    }
    if (filter.resourceId) {
      clauses.push('resource_id = ?');
      params.push(filter.resourceId);
    }
    const { sql, values } = page('events', clauses.join(' AND '), params, pagination);
    return this.database
      .prepare(sql)
      .all(...values)
      .map(toEvent);
  }

  saveDelivery(delivery: Delivery) {
    this.database
      .prepare(
        `INSERT INTO webhook_deliveries (id, event_id, url, status, attempt_count, next_attempt_at,
           last_status_code, last_error, first_attempt_at, created_at, updated_at)
         VALUES (:id, :event_id, :url, :status, :attempt_count, :next_attempt_at,
           :last_status_code, :last_error, :first_attempt_at, :created_at, :updated_at)
         ON CONFLICT (id) DO UPDATE SET
           status = excluded.status, attempt_count = excluded.attempt_count,
           next_attempt_at = excluded.next_attempt_at, last_status_code = excluded.last_status_code,
           last_error = excluded.last_error, first_attempt_at = excluded.first_attempt_at,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: delivery.id,
        event_id: delivery.eventId,
        url: delivery.url,
        status: delivery.status,
        attempt_count: delivery.attemptCount,
        next_attempt_at: delivery.nextAttemptAt,
        last_status_code: delivery.lastStatusCode,
        last_error: delivery.lastError,
        first_attempt_at: delivery.firstAttemptAt,
        created_at: delivery.createdAt,
        updated_at: delivery.updatedAt,
      });
  }

  dueDeliveries(now: number) {
    return this.database
      .prepare(
        "SELECT * FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at",
      )
      .all(now)
      .map(toDelivery);
  }

  listDeliveries(limit: number) {
    return this.database
      .prepare('SELECT * FROM webhook_deliveries ORDER BY rowid DESC LIMIT ?')
      .all(limit)
      .map(toDelivery);
  }

  /** Deliveries left in flight by a previous process go back to the queue. */
  requeueInFlightDeliveries(now: number) {
    this.database
      .prepare(
        "UPDATE webhook_deliveries SET status = 'pending', next_attempt_at = ? WHERE status = 'sending'",
      )
      .run(now);
  }

  insertAttempt(attempt: {
    id: string;
    deliveryId: string;
    attemptedAt: string;
    statusCode: number | null;
    error: string | null;
    durationMs: number;
  }) {
    this.database
      .prepare(
        `INSERT INTO webhook_attempts (id, delivery_id, attempted_at, status_code, error, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attempt.id,
        attempt.deliveryId,
        attempt.attemptedAt,
        attempt.statusCode,
        attempt.error,
        attempt.durationMs,
      );
  }

  findIdempotentResponse(key: string, notBefore: number) {
    const row = this.database
      .prepare('SELECT * FROM idempotency_keys WHERE key = ? AND created_at >= ?')
      .get(key, notBefore);
    return row
      ? {
          fingerprint: String(row.fingerprint),
          status: Number(row.response_status),
          body: String(row.response_body),
        }
      : null;
  }

  saveIdempotentResponse(entry: {
    key: string;
    fingerprint: string;
    status: number;
    body: string;
    createdAt: number;
  }) {
    this.database
      .prepare(
        `INSERT INTO idempotency_keys (key, fingerprint, response_status, response_body, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET fingerprint = excluded.fingerprint,
           response_status = excluded.response_status, response_body = excluded.response_body,
           created_at = excluded.created_at`,
      )
      .run(entry.key, entry.fingerprint, entry.status, entry.body, entry.createdAt);
  }
}
