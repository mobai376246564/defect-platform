import { describe, expect, it } from 'vitest';
import { addDays, average, bucketOf, countBy, dayStart, ratio, toHours } from './report-math';

describe('report math', () => {
  it('counts values, spreading arrays and treating empty as unset', () => {
    const rows = [{ o: ['a', 'b'] }, { o: ['a'] }, { o: [] }, { o: null }];
    expect(countBy(rows, (r) => r.o)).toEqual([
      { key: '', count: 2 },
      { key: 'a', count: 2 },
      { key: 'b', count: 1 },
    ]);
  });

  it('returns null instead of zero when there is nothing to divide', () => {
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(0, 0)).toBeNull();
    expect(average([])).toBeNull();
    expect(average([1, 2, 6])).toBe(3);
    expect(toHours(5_400_000)).toBe(1.5);
    expect(toHours(null)).toBeNull();
  });

  it('maps report dates to Beijing midnight and buckets by week', () => {
    expect(dayStart('2026-10-19').toISOString()).toBe('2026-10-18T16:00:00.000Z');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(bucketOf('2026-10-22', 'week')).toBe('2026-10-19');
    expect(bucketOf('2026-10-22', 'day')).toBe('2026-10-22');
  });
});
