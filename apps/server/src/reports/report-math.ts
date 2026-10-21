import { REPORT_UTC_OFFSET_MINUTES, monthStart, weekStart } from '@defect/shared';

const DAY = 86_400_000;

export type Granularity = 'day' | 'week' | 'month';

export interface Count {
  /** 维度取值；未设置为空字符串 */
  key: string;
  count: number;
}

/** 按维度计数，值为数组时每个元素各计一次（如多个处理人）；按数量倒序。 */
export function countBy<T>(
  items: T[],
  keyOf: (item: T) => string | null | undefined | (string | null | undefined)[],
): Count[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const raw = keyOf(item);
    const keys = Array.isArray(raw) ? (raw.length ? raw : [null]) : [raw];
    for (const k of keys) counts.set(k ?? '', (counts.get(k ?? '') ?? 0) + 1);
  }
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** 比率保留 4 位小数；分母为 0 时返回 null（前端显示“—”而不是 0%）。 */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

/** 毫秒 → 小时，保留 2 位小数（不足 1 小时的响应前端显示为分钟）。 */
export function toHours(ms: number | null): number | null {
  return ms === null ? null : Math.round(ms / 36_000) / 100;
}

/** 报表时区下某天 00:00 对应的时刻。 */
export function dayStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - REPORT_UTC_OFFSET_MINUTES * 60_000);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** 日期所属的统计桶：按日为当天，按周为当周周一，按月为当月 1 日。 */
export function bucketOf(date: string, granularity: Granularity): string {
  if (granularity === 'week') return weekStart(date);
  if (granularity === 'month') return monthStart(date);
  return date;
}
