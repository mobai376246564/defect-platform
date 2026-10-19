import { describe, expect, it } from 'vitest';
import { ageBucketOf, dateRange, reportDate, slaOf, weekStart, workingMs } from './reports';

const HOUR = 3_600_000;

describe('workingMs', () => {
  it('counts plain weekday time', () => {
    // 2026-10-19 是周一（北京时间）
    expect(workingMs('2026-10-19T02:00:00Z', '2026-10-19T05:00:00Z')).toBe(3 * HOUR);
  });

  it('skips weekends in Beijing time', () => {
    // 周五 20:00 → 周一 10:00（北京时间）：周五 4 小时 + 周一 10 小时
    expect(workingMs('2026-10-16T12:00:00Z', '2026-10-19T02:00:00Z')).toBe(14 * HOUR);
  });

  it('returns 0 for reversed or weekend-only spans', () => {
    expect(workingMs('2026-10-19T05:00:00Z', '2026-10-19T02:00:00Z')).toBe(0);
    // 周六 08:00 → 周日 20:00（北京时间）
    expect(workingMs('2026-10-17T00:00:00Z', '2026-10-18T12:00:00Z')).toBe(0);
  });
});

describe('ageBucketOf', () => {
  const now = new Date('2026-10-19T00:00:00Z');
  it.each([
    [0, '0-3'],
    [3, '0-3'],
    [4, '4-7'],
    [14, '8-14'],
    [30, '15-30'],
    [31, '30+'],
  ])('%i days old → %s', (days, bucket) => {
    expect(ageBucketOf(new Date(now.getTime() - days * 24 * HOUR - 1000), now)).toBe(bucket);
  });
});

describe('date helpers', () => {
  it('uses Beijing time for report dates', () => {
    expect(reportDate('2026-10-18T16:30:00Z')).toBe('2026-10-19');
    expect(reportDate('2026-10-18T15:30:00Z')).toBe('2026-10-18');
  });

  it('finds the Monday of a week', () => {
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
  });

  it('lists every day in a closed range', () => {
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(dateRange('2026-10-02', '2026-10-01')).toEqual([]);
  });

  it('has no SLA for low severities', () => {
    expect(slaOf('fatal')?.resolveMs).toBe(24 * HOUR);
    expect(slaOf('advice')).toBeUndefined();
  });
});
