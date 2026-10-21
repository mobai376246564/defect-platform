import { describe, expect, it } from 'vitest';
import {
  ageBucketOf,
  dateRange,
  isInvalidDefect,
  monthEnd,
  previousPeriod,
  reportDate,
  reviewPeriod,
  slaOf,
  weekStart,
  workingMs,
} from './reports';

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

  it('finds the last day of a month', () => {
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
    expect(monthEnd('2026-12-31')).toBe('2026-12-31');
  });

  it('has no SLA for low severities', () => {
    expect(slaOf('fatal')?.resolveMs).toBe(24 * HOUR);
    expect(slaOf('advice')).toBeUndefined();
  });
});

describe('review periods', () => {
  it('picks the natural week or month, capped at today', () => {
    // 2026-10-21 是周三
    expect(reviewPeriod('week', '2026-10-21', '2026-10-21')).toEqual({
      from: '2026-10-19',
      to: '2026-10-21',
    });
    expect(reviewPeriod('week', '2026-10-14', '2026-10-21')).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
    });
    expect(reviewPeriod('month', '2026-09-03', '2026-10-21')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(reviewPeriod('month', '2026-10-05', '2026-10-21')).toEqual({
      from: '2026-10-01',
      to: '2026-10-21',
    });
  });

  it('compares a week with the same days of the week before', () => {
    expect(previousPeriod('2026-10-12', '2026-10-18')).toEqual({
      from: '2026-10-05',
      to: '2026-10-11',
    });
    expect(previousPeriod('2026-10-19', '2026-10-21')).toEqual({
      from: '2026-10-16',
      to: '2026-10-18',
    });
  });

  it('compares a month with the previous month', () => {
    // 整月对整月，天数不同也取整月
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(previousPeriod('2026-02-01', '2026-02-28')).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
    // 进行中的月份对比上月同样的天数
    expect(previousPeriod('2026-10-01', '2026-10-21')).toEqual({
      from: '2026-09-01',
      to: '2026-09-21',
    });
    expect(previousPeriod('2026-03-01', '2026-03-30')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});

describe('isInvalidDefect', () => {
  it('treats invalid resolutions and rejected states as invalid', () => {
    expect(isInvalidDefect({ resolution: 'duplicated', status: 'closed' })).toBe(true);
    expect(isInvalidDefect({ resolution: null, status: 'not_bug' })).toBe(true);
    expect(isInvalidDefect({ resolution: 'fixed', status: 'closed' })).toBe(false);
    expect(isInvalidDefect({ resolution: 'fix_later', status: 'passed' })).toBe(false);
  });
});
