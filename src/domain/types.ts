export const MandateStatus = {
  PendingCustomerApproval: 'pending_customer_approval',
  PendingSubmission: 'pending_submission',
  Active: 'active',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type MandateStatus = (typeof MandateStatus)[keyof typeof MandateStatus];

export const ChargeStatus = {
  PendingSubmission: 'pending_submission',
  Submitted: 'submitted',
  Confirmed: 'confirmed',
  PaidOut: 'paid_out',
  Failed: 'failed',
  ChargedBack: 'charged_back',
  Cancelled: 'cancelled',
} as const;
export type ChargeStatus = (typeof ChargeStatus)[keyof typeof ChargeStatus];

export const FailureCode = {
  InsufficientFunds: 'insufficient_funds',
  AccountClosed: 'account_closed',
  MandateCancelled: 'mandate_cancelled',
  ReferToPayer: 'refer_to_payer',
} as const;
export type FailureCode = (typeof FailureCode)[keyof typeof FailureCode];

/** One scheduled transition of a mandate or a charge. */
export type Step<Status extends string> = {
  status: Status;
  failureCode?: string | null;
  /** On a charge step: also cancels its mandate (the payer's account is closed). */
  cancelMandate?: boolean;
  /** On a mandate step: why it was cancelled. */
  cancellationReason?: string;
};

export type Mandate = {
  id: string;
  customerReference: string;
  returnUrl: string;
  status: MandateStatus;
  authorizationToken: string;
  accountHolderName: string | null;
  iban: string | null;
  failureCode: string | null;
  cancellationReason: string | null;
  metadata: Record<string, string>;
  plan: Step<MandateStatus>[];
  nextTransitionAt: number | null;
  createdAt: string;
  updatedAt: string;
};

export type Charge = {
  id: string;
  mandateId: string;
  amount: number;
  currency: string;
  chargeDate: string;
  description: string | null;
  metadata: Record<string, string>;
  status: ChargeStatus;
  failureCode: string | null;
  plan: Step<ChargeStatus>[];
  nextTransitionAt: number | null;
  createdAt: string;
  updatedAt: string;
};

export const CHARGE_TRANSITIONS: Record<ChargeStatus, ChargeStatus[]> = {
  pending_submission: ['submitted', 'cancelled', 'failed'],
  submitted: ['confirmed', 'failed'],
  confirmed: ['paid_out', 'charged_back'],
  paid_out: ['charged_back'],
  failed: [],
  charged_back: [],
  cancelled: [],
};
