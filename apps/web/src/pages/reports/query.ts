import { reviewPeriod, type ReviewPeriodKind } from '@defect/shared';

/** 报表筛选写在 URL 上（方案 6.6“筛选即 URL”），这里在 URL 参数与接口参数之间转换。 */

export const REPORT_TABS = [
  { key: 'review', label: '复盘概览' },
  { key: 'trend', label: '缺陷趋势' },
  { key: 'distribution', label: '缺陷分布' },
  { key: 'age', label: '缺陷年龄' },
  { key: 'versions', label: '版本质量' },
  { key: 'efficiency', label: '处理效率' },
  { key: 'quality', label: '修复质量' },
  { key: 'process', label: '测试与流程' },
  { key: 'feedback', label: 'APP 提单' },
  { key: 'claude', label: 'Claude 参与修复' },
] as const;
export type ReportTab = (typeof REPORT_TABS)[number]['key'];
export const DEFAULT_TAB: ReportTab = 'review';

const FILTER_KEYS = ['from', 'to', 'moduleId', 'versionId', 'severity', 'granularity'] as const;
const GRANULARITIES = ['day', 'week', 'month'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function currentTab(params: URLSearchParams): ReportTab {
  const tab = params.get('tab');
  return REPORT_TABS.find((t) => t.key === tab)?.key ?? DEFAULT_TAB;
}

/** 取出合法的筛选参数；日期格式不对的丢弃，交给服务端默认最近 30 天。 */
export function reportQuery(params: URLSearchParams): Record<string, string> {
  const q: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (!v) continue;
    if ((k === 'from' || k === 'to') && !DATE.test(v)) continue;
    if (k === 'granularity' && !GRANULARITIES.includes(v)) continue;
    q[k] = v;
  }
  return q;
}

/**
 * 复盘概览的周期：period=week|month（默认周）；URL 上有时间段就沿用（也可以是自定义时间段），
 * 没有就取今天所在的自然周 / 月。
 */
export function reviewQuery(
  params: URLSearchParams,
  today: string,
): { kind: ReviewPeriodKind; query: Record<string, string> } {
  const kind: ReviewPeriodKind = params.get('period') === 'month' ? 'month' : 'week';
  const q = reportQuery(params);
  delete q.granularity;
  if (!q.from || !q.to) Object.assign(q, reviewPeriod(kind, today, today));
  return { kind, query: q };
}
