import { describe, it, expect } from 'vitest';
import { toLocalDateValue } from './program';
import { toPlanDate } from './plan';

describe('toLocalDateValue — the one yyyy-mm-dd formatter', () => {
  it('formats a LOCAL calendar date (not the UTC one) from a Date or a timestamp', () => {
    const d = new Date(2026, 6, 27, 23, 30); // late evening local time
    expect(toLocalDateValue(d)).toBe('2026-07-27');
    expect(toLocalDateValue(d.getTime())).toBe('2026-07-27');
  });

  it('zero-pads month and day', () => {
    expect(toLocalDateValue(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('is what the plan dates are built from', () => {
    const d = new Date(2026, 2, 9);
    expect(toPlanDate(d)).toBe(toLocalDateValue(d));
  });
});
