import { describe, expect, it } from 'vitest';
import { cx, fmtDate, fmtDateTime, isExpired, usd } from './format';

describe('usd()', () => {
  it('formats dollars and cents in en-US', () => {
    expect(usd(5.5)).toBe('$5.50');
    expect(usd(0)).toBe('$0.00');
    expect(usd(1234.5)).toBe('$1,234.50');
  });

  it('tolerates nullish and garbage input', () => {
    expect(usd(null)).toBe('$0.00');
    expect(usd(undefined)).toBe('$0.00');
    expect(usd('12.34')).toBe('$12.34');
  });
});

describe('date formatters', () => {
  it('renders short US dates and datetimes', () => {
    expect(fmtDate('2028-06-01T00:00:00.000Z')).toMatch(/Jun/);
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('garbage')).toBe('—');
    expect(fmtDateTime(null)).toBe('—');
    // month/day/time by design (no year); date-only helper carries the year
    expect(fmtDateTime('2028-06-01T13:05:00.000Z')).toMatch(/Jun 1/);
    expect(fmtDate('2028-06-01T00:00:00.000Z')).toMatch(/2028/);
  });
});

describe('isExpired()', () => {
  it('flags past dates only', () => {
    expect(isExpired('2020-01-01T00:00:00.000Z')).toBe(true);
    expect(isExpired('2030-01-01T00:00:00.000Z')).toBe(false);
    expect(isExpired(null)).toBe(false);
    expect(isExpired(undefined)).toBe(false);
  });
});

describe('cx()', () => {
  it('joins truthy class parts', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
    expect(cx()).toBe('');
  });
});
