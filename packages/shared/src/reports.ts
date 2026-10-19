/**
 * 统计报表口径（方案 6.9）与 SLA 默认值（方案 6.7）。
 * 服务端计算报表、前端展示图例都从这里取，保证两边口径一致。
 */
import type { Severity } from './enums';

/** 报表按北京时间（UTC+8，无夏令时）切分日期与判断工作日。 */
export const REPORT_UTC_OFFSET_MINUTES = 480;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface SlaLimit {
  /** 响应时限：确认 → 首次进入“进行中”类别 */
  responseMs: number;
  /** 解决时限：确认 → 首次进入“待验证”类别 */
  resolveMs: number;
}

/** 默认 SLA（工作日计时）；提示、建议不设时限。 */
export const DEFAULT_SLA: Partial<Record<Severity, SlaLimit>> = {
  fatal: { responseMs: 1 * HOUR, resolveMs: 1 * DAY },
  serious: { responseMs: 4 * HOUR, resolveMs: 3 * DAY },
  normal: { responseMs: 1 * DAY, resolveMs: 7 * DAY },
};

export function slaOf(severity: string): SlaLimit | undefined {
  return DEFAULT_SLA[severity as Severity];
}

/**
 * 两个时间点之间的工作日时长（毫秒）：周六、周日不计时，按北京时间判断星期。
 * 法定节假日与挂起时段暂不扣除。end 早于 start 时返回 0。
 */
export function workingMs(
  start: Date | string,
  end: Date | string,
  offsetMinutes = REPORT_UTC_OFFSET_MINUTES,
): number {
  const offset = offsetMinutes * 60_000;
  const s = new Date(start).getTime() + offset;
  const e = new Date(end).getTime() + offset;
  if (!(e > s)) return 0;
  let total = 0;
  for (let dayStart = Math.floor(s / DAY) * DAY; dayStart < e; dayStart += DAY) {
    const weekday = new Date(dayStart).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    total += Math.min(e, dayStart + DAY) - Math.max(s, dayStart);
  }
  return total;
}

/** 缺陷年龄分段（方案 6.9 缺陷年龄报表），max 为该段最大天数（含）。 */
export const AGE_BUCKETS = [
  { key: '0-3', label: '0–3 天', max: 3 },
  { key: '4-7', label: '4–7 天', max: 7 },
  { key: '8-14', label: '8–14 天', max: 14 },
  { key: '15-30', label: '15–30 天', max: 30 },
  { key: '30+', label: '>30 天', max: Infinity },
] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number]['key'];

/** 创建时间 → now 的整天数所在分段。 */
export function ageBucketOf(createdAt: Date | string, now: Date = new Date()): AgeBucket {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / DAY));
  return AGE_BUCKETS.find((b) => days <= b.max)!.key;
}

/** 某时刻在报表时区下的日期字符串 YYYY-MM-DD。 */
export function reportDate(at: Date | string, offsetMinutes = REPORT_UTC_OFFSET_MINUTES): string {
  return new Date(new Date(at).getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD 所在周的周一（同样为 YYYY-MM-DD）。 */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10);
}

/** 闭区间 [from, to] 内的每一天（YYYY-MM-DD）。 */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** 站内通知类型（方案 6.4 通知中心）。 */
export const NOTIFICATION_KIND = {
  assigned: '指派给我',
  mentioned: '@ 我',
  status_changed: '状态变更',
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KIND;
