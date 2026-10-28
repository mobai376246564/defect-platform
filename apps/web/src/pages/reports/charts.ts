/**
 * 报表图表的 ECharts 配置（纯函数，便于单测）。
 * 配色：分类序列用固定顺序的分类色；严重程度是有序维度，用单一蓝色由浅到深（越严重越深）。
 * 不用双 Y 轴：量纲不同的指标拆成两张图或指标卡。
 */
import { BUG_TYPE, ROOT_CAUSE, SEVERITY, findState, type Severity } from '@defect/shared';
import type { EChartsOption } from 'echarts';
import type {
  AgeReport,
  ClaudeReport,
  FeedbackReportData,
  Granularity,
  ProjectDetail,
  QualityReport,
  TrendReport,
  VersionReport,
} from '../../api/types';

const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];

export const SEVERITY_COLORS: Record<Severity, string> = {
  fatal: '#104281',
  serious: '#1c5cab',
  normal: '#2a78d6',
  prompt: '#5598e7',
  advice: '#86b6ef',
};

const SEVERITIES = Object.keys(SEVERITY) as Severity[];

const AXIS = {
  axisLine: { lineStyle: { color: 'rgba(139, 152, 167, 0.45)' } },
  axisLabel: { color: '#8b98a7' },
  splitLine: { lineStyle: { color: 'rgba(139, 152, 167, 0.16)' } },
};
const GRID = { left: 8, right: 16, top: 40, bottom: 8, containLabel: true };
const LEGEND = { top: 0, left: 0, itemWidth: 12, itemHeight: 8 };
const TOOLBOX = { right: 0, top: 0, feature: { saveAsImage: { title: '保存图片' } } };

/** 0.4567 → 45.7%；无数据显示 — */
export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}

/** 工作时长：不足 1 小时显示分钟，不足 24 小时显示小时，否则折算为天（24 工作小时 = 1 天）。 */
export function duration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} 分钟`;
  return hours < 24 ? `${hours.toFixed(1)} 小时` : `${(hours / 24).toFixed(1)} 天`;
}

/** 日期轴标签：按日显示 MM-DD，按周显示“MM-DD 周”，按月显示 YYYY-MM。 */
export function axisDate(date: string, granularity: Granularity): string {
  if (granularity === 'month') return date.slice(0, 7);
  const md = date.slice(5);
  return granularity === 'week' ? `${md} 周` : md;
}

export type Dimension = 'status' | 'severity' | 'module' | 'owner' | 'bugType' | 'rootCause';

export const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: 'status', label: '状态' },
  { key: 'severity', label: '严重程度' },
  { key: 'module', label: '模块' },
  { key: 'owner', label: '处理人' },
  { key: 'bugType', label: '缺陷类型' },
  { key: 'rootCause', label: '缺陷根源' },
];

/** 分布维度取值的显示名。 */
export function dimensionLabel(dim: Dimension, key: string, project: ProjectDetail): string {
  if (!key) return dim === 'owner' ? '未指派' : '未设置';
  switch (dim) {
    case 'status':
      return findState(project.workflow, key)?.name ?? key;
    case 'severity':
      return SEVERITY[key as Severity] ?? key;
    case 'module':
      return project.modules.find((m) => m.id === key)?.name ?? '已删除模块';
    case 'owner':
      return project.members.find((m) => m.id === key)?.name ?? '已移除成员';
    case 'bugType':
      return BUG_TYPE[key as keyof typeof BUG_TYPE] ?? key;
    case 'rootCause':
      return ROOT_CAUSE[key as keyof typeof ROOT_CAUSE] ?? key;
  }
}

/** 新增、解决、关闭的流量折线。 */
export function flowOption(r: TrendReport): EChartsOption {
  const x = r.points.map((p) => axisDate(p.date, r.granularity));
  const line = (name: string, values: number[], i: number) => ({
    name,
    type: 'line' as const,
    data: values,
    smooth: false,
    symbolSize: 8,
    showSymbol: r.points.length <= 14,
    lineStyle: { width: 2 },
    itemStyle: { color: SERIES_COLORS[i] },
  });
  return {
    tooltip: { trigger: 'axis' },
    legend: LEGEND,
    toolbox: TOOLBOX,
    grid: GRID,
    xAxis: { type: 'category', data: x, ...AXIS },
    yAxis: { type: 'value', minInterval: 1, ...AXIS },
    series: [
      line(
        '新增',
        r.points.map((p) => p.created),
        0,
      ),
      line(
        '解决',
        r.points.map((p) => p.resolved),
        1,
      ),
      line(
        '关闭',
        r.points.map((p) => p.closed),
        2,
      ),
    ],
  };
}

/** 未关闭存量面积图。 */
export function openOption(r: TrendReport): EChartsOption {
  return {
    tooltip: { trigger: 'axis' },
    toolbox: TOOLBOX,
    grid: { ...GRID, top: 32 },
    xAxis: {
      type: 'category',
      data: r.points.map((p) => axisDate(p.date, r.granularity)),
      ...AXIS,
    },
    yAxis: { type: 'value', minInterval: 1, ...AXIS },
    series: [
      {
        name: '未关闭',
        type: 'line',
        data: r.points.map((p) => p.open),
        showSymbol: false,
        lineStyle: { width: 2, color: SERIES_COLORS[0] },
        itemStyle: { color: SERIES_COLORS[0] },
        areaStyle: { color: SERIES_COLORS[0], opacity: 0.15 },
      },
    ],
  };
}

/** 横向条形图，数量多的在上。 */
export function barsOption(items: { name: string; count: number }[]): EChartsOption {
  const sorted = [...items].sort((a, b) => a.count - b.count);
  return {
    tooltip: { trigger: 'item' },
    toolbox: TOOLBOX,
    grid: { ...GRID, top: 32 },
    xAxis: { type: 'value', minInterval: 1, ...AXIS },
    yAxis: { type: 'category', data: sorted.map((i) => i.name), ...AXIS },
    series: [
      {
        name: '缺陷数',
        type: 'bar',
        data: sorted.map((i) => i.count),
        barMaxWidth: 18,
        itemStyle: { color: SERIES_COLORS[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: '#8b98a7' },
      },
    ],
  };
}

const severityStack = (rowsBySeverity: Record<string, number>[], horizontal = false) =>
  SEVERITIES.map((s, i) => ({
    name: SEVERITY[s],
    type: 'bar' as const,
    stack: 'severity',
    data: rowsBySeverity.map((r) => r[s] ?? 0),
    barMaxWidth: 36,
    itemStyle: {
      color: SEVERITY_COLORS[s],
      borderColor: 'transparent',
      borderWidth: 1,
      // 只有最外层一段圆角
      borderRadius: i === SEVERITIES.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0,
    },
  }));

/** 缺陷年龄：存活天数分段 × 严重程度堆叠。 */
export function ageOption(r: AgeReport): EChartsOption {
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: LEGEND,
    toolbox: TOOLBOX,
    grid: GRID,
    xAxis: { type: 'category', data: r.rows.map((row) => row.label), ...AXIS },
    yAxis: { type: 'value', minInterval: 1, ...AXIS },
    series: severityStack(r.rows.map((row) => row.bySeverity)),
  };
}

/** 版本质量：每个发现版本的缺陷数按严重程度堆叠。 */
export function versionOption(r: VersionReport): EChartsOption {
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: LEGEND,
    toolbox: TOOLBOX,
    grid: GRID,
    xAxis: { type: 'category', data: r.rows.map((v) => v.name), ...AXIS },
    yAxis: { type: 'value', minInterval: 1, ...AXIS },
    series: severityStack(r.rows.map((v) => v.bySeverity)),
  };
}

/** 环节耗时：每行一个严重程度，等待处理 / 修复 / 验证三段横向堆叠，最长的一段就是瓶颈。 */
export function stageOption(
  rows: { name: string; wait: number | null; fix: number | null; verify: number | null }[],
): EChartsOption {
  const stages = [
    { key: 'wait', name: '等待处理' },
    { key: 'fix', name: '修复' },
    { key: 'verify', name: '验证' },
  ] as const;
  const ordered = [...rows].reverse();
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v) => duration(typeof v === 'number' ? v : null),
    },
    legend: LEGEND,
    toolbox: TOOLBOX,
    grid: GRID,
    xAxis: {
      type: 'value',
      ...AXIS,
      axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => duration(v) },
    },
    yAxis: { type: 'category', data: ordered.map((r) => r.name), ...AXIS },
    series: stages.map((s, i) => ({
      name: s.name,
      type: 'bar' as const,
      stack: 'stage',
      barMaxWidth: 22,
      data: ordered.map((r) => r[s.key] ?? 0),
      itemStyle: { color: SERIES_COLORS[i] },
    })),
  };
}

/** 修复质量：重开率与一次修复率（同为百分比，共用一个轴）。 */
export function qualityOption(r: QualityReport): EChartsOption {
  const x = r.points.map((p) => axisDate(p.date, r.granularity));
  const toPct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v === null ? '—' : `${String(v)}%`) },
    legend: LEGEND,
    toolbox: TOOLBOX,
    grid: GRID,
    xAxis: { type: 'category', data: x, ...AXIS },
    yAxis: {
      type: 'value',
      max: 100,
      axisLabel: { formatter: '{value}%', color: '#8b98a7' },
      splitLine: AXIS.splitLine,
    },
    series: [
      {
        name: '重开率',
        type: 'line',
        data: r.points.map((p) => toPct(p.reopenRate)),
        connectNulls: true,
        symbolSize: 8,
        lineStyle: { width: 2 },
        itemStyle: { color: SERIES_COLORS[1] },
      },
      {
        name: '一次修复率',
        type: 'line',
        data: r.points.map((p) => toPct(p.firstPassRate)),
        connectNulls: true,
        symbolSize: 8,
        lineStyle: { width: 2 },
        itemStyle: { color: SERIES_COLORS[0] },
      },
    ],
  };
}

const FEEDBACK_STATUS: {
  key: 'created' | 'failed' | 'pending';
  label: string;
}[] = [
  { key: 'created', label: '建单成功' },
  { key: 'failed', label: '建单失败' },
  { key: 'pending', label: '处理中' },
];

/** APP 提单量，按处理结果堆叠。 */
export function feedbackOption(r: FeedbackReportData): EChartsOption {
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: LEGEND,
    toolbox: TOOLBOX,
    grid: GRID,
    xAxis: {
      type: 'category',
      data: r.points.map((p) => axisDate(p.date, r.granularity)),
      ...AXIS,
    },
    yAxis: { type: 'value', minInterval: 1, ...AXIS },
    series: FEEDBACK_STATUS.map((s, i) => ({
      name: s.label,
      type: 'bar' as const,
      stack: 'feedback',
      data: r.points.map((p) => p[s.key]),
      barMaxWidth: 24,
      itemStyle: { color: SERIES_COLORS[i], borderColor: 'transparent', borderWidth: 1 },
    })),
  };
}

/** 解决的缺陷中 Claude 参与与未参与的数量（堆叠），比例放在指标卡里。 */
export function claudeOption(r: ClaudeReport): EChartsOption {
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: LEGEND,
    toolbox: TOOLBOX,
    grid: GRID,
    xAxis: {
      type: 'category',
      data: r.points.map((p) => axisDate(p.date, r.granularity)),
      ...AXIS,
    },
    yAxis: { type: 'value', minInterval: 1, ...AXIS },
    series: [
      {
        name: 'Claude 参与',
        type: 'bar',
        stack: 'resolved',
        data: r.points.map((p) => p.withClaude),
        barMaxWidth: 24,
        itemStyle: { color: SERIES_COLORS[0], borderColor: 'transparent', borderWidth: 1 },
      },
      {
        name: '未参与',
        type: 'bar',
        stack: 'resolved',
        data: r.points.map((p) => p.resolved - p.withClaude),
        barMaxWidth: 24,
        itemStyle: {
          color: '#bfbfbf',
          borderColor: 'transparent',
          borderWidth: 1,
          borderRadius: [4, 4, 0, 0],
        },
      },
    ],
  };
}
