import { ibanFor, normalizeIban } from '#src/lib/iban.ts';

import {
  type ChargeStatus,
  FailureCode,
  type MandateStatus,
  type Step,
} from './types.ts';

/** Sandbox IBANs with a deterministic outcome. Any other valid IBAN behaves like `success`. */
export const MAGIC_IBANS = {
  success: ibanFor('NL', 'PAYF0000000001'),
  insufficientFunds: ibanFor('NL', 'PAYF0000000002'),
  insufficientFundsOnce: ibanFor('NL', 'PAYF0000000003'),
  accountClosed: ibanFor('NL', 'PAYF0000000004'),
  referToPayer: ibanFor('NL', 'PAYF0000000005'),
  failedWithoutCode: ibanFor('NL', 'PAYF0000000006'),
  chargeback: ibanFor('NL', 'PAYF0000000007'),
  mandateFailed: ibanFor('NL', 'PAYF0000000008'),
  mandateCancelledByPayer: ibanFor('NL', 'PAYF0000000009'),
} as const;

const scenarioOf = (iban: string) =>
  (Object.entries(MAGIC_IBANS).find(([, magic]) => magic === normalizeIban(iban))?.[0] ??
    'success') as keyof typeof MAGIC_IBANS;

export const mandatePlan = (iban: string): Step<MandateStatus>[] => {
  switch (scenarioOf(iban)) {
    case 'mandateFailed':
      return [{ status: 'failed', failureCode: 'invalid_bank_details' }];
    case 'mandateCancelledByPayer':
      return [
        { status: 'active' },
        { status: 'cancelled', cancellationReason: 'cancelled_by_payer' },
      ];
    default:
      return [{ status: 'active' }];
  }
};

export const SUCCESS_PATH: Step<ChargeStatus>[] = [
  { status: 'submitted' },
  { status: 'confirmed' },
  { status: 'paid_out' },
];

const failure = (
  failureCode: string | null,
  cancelMandate = false,
): Step<ChargeStatus>[] => [
  { status: 'submitted' },
  { status: 'failed', failureCode, cancelMandate },
];

/** `previousCharges` counts the charges already created on the same mandate. */
export const chargePlan = (
  iban: string,
  previousCharges: number,
): Step<ChargeStatus>[] => {
  switch (scenarioOf(iban)) {
    case 'insufficientFunds':
      return failure(FailureCode.InsufficientFunds);
    case 'insufficientFundsOnce':
      return previousCharges === 0
        ? failure(FailureCode.InsufficientFunds)
        : SUCCESS_PATH;
    case 'accountClosed':
      return failure(FailureCode.AccountClosed, true);
    case 'referToPayer':
      return failure(FailureCode.ReferToPayer);
    case 'failedWithoutCode':
      return failure(null);
    case 'chargeback':
      return [...SUCCESS_PATH, { status: 'charged_back' }];
    default:
      return SUCCESS_PATH;
  }
};
