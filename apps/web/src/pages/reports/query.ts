/** 报表筛选写在 URL 上（方案 6.6“筛选即 URL”），这里在 URL 参数与接口参数之间转换。 */

export const REPORT_TABS = [
  { key: 'trend', label: '缺陷趋势' },
  { key: 'distribution', label: '缺陷分布' },
  { key: 'age', label: '缺陷年龄' },
  { key: 'versions', label: '版本质量' },
  { key: 'efficiency', label: '处理效率' },
  { key: 'quality', label: '修复质量' },
  { key: 'feedback', label: '线上反馈' },
  { key: 'claude', label: 'Claude 参与修复' },
] as const;
export type ReportTab = (typeof REPORT_TABS)[number]['key'];

const FILTER_KEYS = ['from', 'to', 'moduleId', 'versionId', 'severity', 'granularity'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function currentTab(params: URLSearchParams): ReportTab {
  const tab = params.get('tab');
  return REPORT_TABS.find((t) => t.key === tab)?.key ?? 'trend';
}

/** 取出合法的筛选参数；日期格式不对的丢弃，交给服务端默认最近 30 天。 */
export function reportQuery(params: URLSearchParams): Record<string, string> {
  const q: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (!v) continue;
    if ((k === 'from' || k === 'to') && !DATE.test(v)) continue;
    if (k === 'granularity' && v !== 'day' && v !== 'week') continue;
    q[k] = v;
  }
  return q;
}
