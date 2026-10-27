import type { Config } from '#src/config.ts';
import { chargePlan, mandatePlan, SUCCESS_PATH } from '#src/domain/scenarios.ts';
import {
  CHARGE_TRANSITIONS,
  type Charge,
  type ChargeStatus,
  FailureCode,
  type Mandate,
  type Step,
} from '#src/domain/types.ts';
import { addBusinessDays } from '#src/lib/business-days.ts';
import { ApiError, notFound } from '#src/lib/errors.ts';
import { isValidIban, normalizeIban } from '#src/lib/iban.ts';
import { newId, newToken } from '#src/lib/ids.ts';
import type { StoredEvent, Store } from '#src/store/store.ts';

import type { WebhookDispatcher } from './webhooks.ts';

export const MIN_CHARGE_LEAD_BUSINESS_DAYS = 3;

const FINAL_CHARGE_STATUSES: ChargeStatus[] = ['failed', 'charged_back', 'cancelled'];

export type PaymentServiceOptions = {
  store: Store;
  dispatcher: WebhookDispatcher;
  config: Pick<Config, 'publicUrl' | 'transitionSeconds'>;
  now: () => number;
};

export class PaymentService {
  private readonly store: Store;
  private readonly dispatcher: WebhookDispatcher;
  private readonly config: PaymentServiceOptions['config'];
  private readonly now: () => number;

  constructor(options: PaymentServiceOptions) {
    this.store = options.store;
    this.dispatcher = options.dispatcher;
    this.config = options.config;
    this.now = options.now;
  }

  publicMandate(mandate: Mandate) {
    return {
      id: mandate.id,
      customerReference: mandate.customerReference,
      status: mandate.status,
      authorizationUrl: `${this.config.publicUrl}/authorize/${mandate.authorizationToken}`,
      returnUrl: mandate.returnUrl,
      bankAccount: mandate.iban
        ? {
            accountHolderName: mandate.accountHolderName,
            country: mandate.iban.slice(0, 2),
            ibanLast4: mandate.iban.slice(-4),
          }
        : null,
      failureCode: mandate.failureCode,
      cancellationReason: mandate.cancellationReason,
      metadata: mandate.metadata,
      createdAt: mandate.createdAt,
      updatedAt: mandate.updatedAt,
    };
  }

  publicCharge(charge: Charge) {
    return {
      id: charge.id,
      mandateId: charge.mandateId,
      amount: charge.amount,
      currency: charge.currency,
      chargeDate: charge.chargeDate,
      description: charge.description,
      metadata: charge.metadata,
      status: charge.status,
      failureCode: charge.failureCode,
      createdAt: charge.createdAt,
      updatedAt: charge.updatedAt,
    };
  }

  earliestChargeDate() {
    return addBusinessDays(new Date(this.now()), MIN_CHARGE_LEAD_BUSINESS_DAYS);
  }

  getMandate(id: string) {
    const mandate = this.store.findMandate(id);
    if (!mandate) {
      throw notFound('mandate', id);
    }
    return mandate;
  }

  getCharge(id: string) {
    const charge = this.store.findCharge(id);
    if (!charge) {
      throw notFound('charge', id);
    }
    return charge;
  }

  createMandate(input: {
    customerReference: string;
    returnUrl: string;
    metadata: Record<string, string>;
  }) {
    const timestamp = this.isoNow();
    const mandate: Mandate = {
      id: newId('MD'),
      customerReference: input.customerReference,
      returnUrl: input.returnUrl,
      status: 'pending_customer_approval',
      authorizationToken: newToken(),
      accountHolderName: null,
      iban: null,
      failureCode: null,
      cancellationReason: null,
      metadata: input.metadata,
      plan: [],
      nextTransitionAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.store.saveMandate(mandate);
    return mandate;
  }

  /** The payer confirmed the hosted authorization page. */
  authorizeMandate(token: string, input: { accountHolderName: string; iban: string }) {
    const mandate = this.store.findMandateByToken(token);
    if (!mandate) {
      throw new ApiError({
        status: 404,
        code: 'resource_missing',
        message: 'Unknown authorization link',
      });
    }
    if (mandate.status !== 'pending_customer_approval') {
      throw new ApiError({
        status: 410,
        code: 'authorization_used',
        message: 'This authorization link was already used',
      });
    }
    const iban = normalizeIban(input.iban);
    if (!isValidIban(iban)) {
      throw new ApiError({
        status: 400,
        code: 'invalid_iban',
        message: 'Enter a valid IBAN',
        param: 'iban',
      });
    }
    if (input.accountHolderName.trim().length === 0) {
      throw new ApiError({
        status: 400,
        code: 'invalid_account_holder',
        message: 'Enter the account holder name',
        param: 'accountHolderName',
      });
    }

    const authorized: Mandate = {
      ...mandate,
      status: 'pending_submission',
      accountHolderName: input.accountHolderName.trim(),
      iban,
      plan: mandatePlan(iban),
      nextTransitionAt: this.nextTransitionAt(),
      updatedAt: this.isoNow(),
    };
    this.store.saveMandate(authorized);
    return authorized;
  }

  cancelMandate(
    id: string,
    reason: 'cancelled_by_merchant' | 'cancelled_by_payer' | 'bank_account_closed',
  ) {
    return this.store.transaction(() =>
      this.cancelMandateInTransaction(this.getMandate(id), reason),
    );
  }

  createCharge(input: {
    mandateId: string;
    amount: number;
    currency: string;
    chargeDate?: string;
    description?: string;
    metadata: Record<string, string>;
  }) {
    const mandate = this.store.findMandate(input.mandateId);
    if (!mandate) {
      throw new ApiError({
        status: 404,
        code: 'resource_missing',
        message: `No such mandate: '${input.mandateId}'`,
        param: 'mandateId',
      });
    }
    if (mandate.status !== 'active' || !mandate.iban) {
      throw new ApiError({
        status: 422,
        code: 'mandate_not_active',
        message: `Mandate ${mandate.id} is ${mandate.status}`,
        param: 'mandateId',
      });
    }
    if (input.currency !== 'EUR') {
      throw new ApiError({
        status: 422,
        code: 'unsupported_currency',
        message: 'Only EUR is supported',
        param: 'currency',
      });
    }
    const earliest = this.earliestChargeDate();
    const chargeDate = input.chargeDate ?? earliest;
    if (chargeDate < earliest) {
      throw new ApiError({
        status: 422,
        code: 'charge_date_too_early',
        message: `chargeDate must be on or after ${earliest}`,
        param: 'chargeDate',
        extra: { earliestChargeDate: earliest },
      });
    }

    const timestamp = this.isoNow();
    const charge: Charge = {
      id: newId('CH'),
      mandateId: mandate.id,
      amount: input.amount,
      currency: input.currency,
      chargeDate,
      description: input.description ?? null,
      metadata: input.metadata,
      status: 'pending_submission',
      failureCode: null,
      plan: chargePlan(mandate.iban, this.store.countCharges(mandate.id)),
      nextTransitionAt: this.nextTransitionAt(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.store.saveCharge(charge);
    return charge;
  }

  cancelCharge(id: string) {
    return this.store.transaction(() => {
      const charge = this.getCharge(id);
      if (charge.status !== 'pending_submission') {
        throw new ApiError({
          status: 422,
          code: 'charge_not_cancellable',
          message: `Charge ${charge.id} is ${charge.status}: only pending_submission charges can be cancelled`,
        });
      }
      return this.applyChargeStep(charge, { status: 'cancelled' }, []);
    });
  }

  /** Sandbox: moves a charge to `status` now, then lets it continue from there. */
  forceChargeTransition(
    id: string,
    step: { status: ChargeStatus; failureCode?: string | null },
  ) {
    return this.store.transaction(() => {
      const charge = this.getCharge(id);
      if (!CHARGE_TRANSITIONS[charge.status].includes(step.status)) {
        throw new ApiError({
          status: 422,
          code: 'invalid_transition',
          message: `A ${charge.status} charge cannot become ${step.status}`,
          extra: { allowed: CHARGE_TRANSITIONS[charge.status] },
        });
      }
      const index = charge.plan.findIndex((planned) => planned.status === step.status);
      const successIndex = SUCCESS_PATH.findIndex(
        (planned) => planned.status === step.status,
      );
      const rest =
        index >= 0 ? charge.plan.slice(index + 1) : SUCCESS_PATH.slice(successIndex + 1);
      const failureCode =
        step.status === 'failed'
          ? step.failureCode !== undefined
            ? step.failureCode
            : (charge.plan[index]?.failureCode ?? null)
          : null;

      return this.applyChargeStep(charge, { status: step.status, failureCode }, rest);
    });
  }

  replayEvent(id: string) {
    const event = this.store.findEvent(id);
    if (!event) {
      throw notFound('event', id);
    }
    return this.dispatcher.replay(event);
  }

  /** Applies every scheduled transition that is due. */
  advance() {
    const now = this.now();
    for (const mandate of this.store.dueMandates(now)) {
      this.store.transaction(() => this.advanceMandate(mandate));
    }
    for (const charge of this.store.dueCharges(now)) {
      this.store.transaction(() => {
        const current = this.store.findCharge(charge.id);
        const [step, ...rest] = current?.plan ?? [];
        if (
          current &&
          step &&
          current.nextTransitionAt !== null &&
          current.nextTransitionAt <= now
        ) {
          this.applyChargeStep(current, step, rest);
        }
      });
    }
  }

  private advanceMandate(mandate: Mandate) {
    const [step, ...rest] = mandate.plan;
    if (!step) {
      this.store.saveMandate({ ...mandate, nextTransitionAt: null });
      return;
    }
    if (step.status === 'cancelled') {
      this.cancelMandateInTransaction(
        mandate,
        step.cancellationReason === 'cancelled_by_payer'
          ? 'cancelled_by_payer'
          : 'bank_account_closed',
      );
      return;
    }
    const updated: Mandate = {
      ...mandate,
      status: step.status,
      failureCode: step.failureCode ?? null,
      plan: rest,
      nextTransitionAt: rest.length > 0 ? this.nextTransitionAt() : null,
      updatedAt: this.isoNow(),
    };
    this.store.saveMandate(updated);
    this.recordEvent(
      `mandate.${updated.status}`,
      'mandate',
      updated.id,
      this.publicMandate(updated),
    );
  }

  private cancelMandateInTransaction(mandate: Mandate, reason: string) {
    if (
      !['pending_customer_approval', 'pending_submission', 'active'].includes(
        mandate.status,
      )
    ) {
      throw new ApiError({
        status: 422,
        code: 'mandate_not_cancellable',
        message: `Mandate ${mandate.id} is ${mandate.status}`,
      });
    }
    const cancelled: Mandate = {
      ...mandate,
      status: 'cancelled',
      cancellationReason: reason,
      plan: [],
      nextTransitionAt: null,
      updatedAt: this.isoNow(),
    };
    this.store.saveMandate(cancelled);
    this.recordEvent(
      'mandate.cancelled',
      'mandate',
      cancelled.id,
      this.publicMandate(cancelled),
    );

    for (const charge of this.store.listCharges(
      { mandateId: mandate.id },
      { limit: 1000 },
    )) {
      if (charge.status === 'pending_submission' || charge.status === 'submitted') {
        this.applyChargeStep(
          charge,
          { status: 'failed', failureCode: FailureCode.MandateCancelled },
          [],
        );
      }
    }
    return cancelled;
  }

  private applyChargeStep(
    charge: Charge,
    step: Step<ChargeStatus>,
    rest: Step<ChargeStatus>[],
  ) {
    const remaining = FINAL_CHARGE_STATUSES.includes(step.status) ? [] : rest;
    const updated: Charge = {
      ...charge,
      status: step.status,
      failureCode:
        step.status === 'failed' ? (step.failureCode ?? null) : charge.failureCode,
      plan: remaining,
      nextTransitionAt: remaining.length > 0 ? this.nextTransitionAt() : null,
      updatedAt: this.isoNow(),
    };
    this.store.saveCharge(updated);
    this.recordEvent(
      `charge.${updated.status}`,
      'charge',
      updated.id,
      this.publicCharge(updated),
    );

    if (step.cancelMandate) {
      const mandate = this.store.findMandate(charge.mandateId);
      if (mandate?.status === 'active') {
        this.cancelMandateInTransaction(mandate, 'bank_account_closed');
      }
    }
    return updated;
  }

  private recordEvent(
    type: string,
    resourceType: StoredEvent['resourceType'],
    resourceId: string,
    data: object,
  ) {
    const event: StoredEvent = {
      id: newId('EV'),
      type,
      resourceType,
      resourceId,
      data: { ...data },
      createdAt: this.isoNow(),
    };
    this.store.insertEvent(event);
    this.dispatcher.enqueue(event);
  }

  private nextTransitionAt() {
    return this.now() + this.config.transitionSeconds * 1000;
  }

  private isoNow() {
    return new Date(this.now()).toISOString();
  }
}
