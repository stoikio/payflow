import { describe, expect, it } from 'vitest';

import { addBusinessDays } from '#src/lib/business-days.ts';

describe('addBusinessDays', () => {
  it('counts weekdays only', () => {
    // Thursday + 3 business days = Tuesday
    expect(addBusinessDays(new Date('2026-10-22T15:00:00Z'), 3)).toBe('2026-10-27');
  });

  it('starts counting from a weekend day', () => {
    // Saturday + 3 business days = Wednesday
    expect(addBusinessDays(new Date('2026-10-24T09:00:00Z'), 3)).toBe('2026-10-28');
  });
});
