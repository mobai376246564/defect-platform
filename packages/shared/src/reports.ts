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

/** YYYY-MM-DD 所在月的 1 日。 */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** YYYY-MM-DD 所在月的最后一天。 */
export function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export type ReviewPeriodKind = 'week' | 'month';

/**
 * 复盘周期：某天所在的自然周（周一～周日）或自然月；进行中的周期截止到今天，
 * 与上一期的同样天数对比（如本周一～周三对比上周一～周三）。
 */
export function reviewPeriod(
  kind: ReviewPeriodKind,
  date: string,
  today: string,
): { from: string; to: string } {
  const from = kind === 'week' ? weekStart(date) : monthStart(date);
  const end = kind === 'week' ? shiftDays(from, 6) : monthEnd(from);
  return { from, to: end < today ? end : today };
}

/**
 * 复盘对比的上一期：时间段从某月 1 日开始且不跨月时取上个月的同一段（整月对整月），
 * 否则取紧挨着的、天数相同的前一段（自然周对上周）。
 */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const days = dateRange(from, to).length;
  if (from.endsWith('-01') && from.slice(0, 7) === to.slice(0, 7)) {
    const prevFrom = monthStart(shiftDays(from, -1));
    const prevEnd = monthEnd(prevFrom);
    const sameSpan = shiftDays(prevFrom, days - 1);
    return { from: prevFrom, to: to === monthEnd(to) || sameSpan > prevEnd ? prevEnd : sameSpan };
  }
  return { from: shiftDays(from, -days), to: shiftDays(from, -1) };
}

/** 复盘关注的高等级缺陷 */
export const SERIOUS_SEVERITIES: readonly string[] = ['fatal', 'serious'];

/** 无效缺陷的解决方式：重复、设计如此、描述不准确、无法重现、无需解决 */
export const INVALID_RESOLUTIONS: readonly string[] = [
  'duplicated',
  'intentional_design',
  'unclear_description',
  'failed_to_recur',
  'ignore',
];
/** 直接关闭为无效的状态：默认工作流的“不是bug”、经典工作流的“已拒绝” */
export const INVALID_STATES: readonly string[] = ['not_bug', 'rejected'];

/** 已关闭的缺陷是否为无效缺陷（提单质量口径）。 */
export function isInvalidDefect(d: { resolution: string | null; status: string }): boolean {
  return (
    (d.resolution !== null && INVALID_RESOLUTIONS.includes(d.resolution)) ||
    INVALID_STATES.includes(d.status)
  );
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
