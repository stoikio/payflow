import { describe, expect, it } from 'vitest';

import { ibanFor, isValidIban, normalizeIban } from '#src/lib/iban.ts';

describe('iban', () => {
  it.each([
    'DE89 3704 0044 0532 0130 00',
    'NL91ABNA0417164300',
    'fr1420041010050500013m02606',
  ])('accepts %s', (iban) => {
    expect(isValidIban(iban)).toBe(true);
  });

  it.each(['DE89370400440532013001', 'NL91ABNA041716430', '1234', ''])(
    'rejects %j',
    (iban) => {
      expect(isValidIban(iban)).toBe(false);
    },
  );

  it('computes check digits', () => {
    expect(ibanFor('DE', '370400440532013000')).toBe('DE89370400440532013000');
  });

  it('normalizes spacing and case', () => {
    expect(normalizeIban(' nl91 abna 0417 1643 00 ')).toBe('NL91ABNA0417164300');
  });
});
