import { DEFAULT_WORKFLOW } from '@defect/shared';
import { describe, expect, it } from 'vitest';
import type { ProjectDetail, TrendReport } from '../../api/types';
import {
  axisDate,
  barsOption,
  dimensionLabel,
  duration,
  flowOption,
  pct,
  SEVERITY_COLORS,
  ageOption,
} from './charts';
import { currentTab, reportQuery } from './query';

const project = {
  workflow: DEFAULT_WORKFLOW,
  modules: [{ id: 'm1', name: '支付', parentId: null, ownerId: null }],
  members: [{ id: 'u1', name: '小王', email: 'w@x', role: 'developer' }],
} as unknown as ProjectDetail;

describe('formatting', () => {
  it('formats rates and working durations, with — for missing data', () => {
    expect(pct(0.4567)).toBe('45.7%');
    expect(pct(null)).toBe('—');
    expect(duration(0.25)).toBe('15 分钟');
    expect(duration(2.5)).toBe('2.5 小时');
    expect(duration(36)).toBe('1.5 天');
    expect(duration(null)).toBe('—');
    expect(axisDate('2026-10-19', 'day')).toBe('10-19');
    expect(axisDate('2026-10-19', 'week')).toBe('10-19 周');
  });

  it('labels distribution keys with names from the project', () => {
    expect(dimensionLabel('status', 'in_review', project)).toBe('待代码审核');
    expect(dimensionLabel('severity', 'fatal', project)).toBe('致命');
    expect(dimensionLabel('module', 'm1', project)).toBe('支付');
    expect(dimensionLabel('module', 'gone', project)).toBe('已删除模块');
    expect(dimensionLabel('owner', 'u1', project)).toBe('小王');
    expect(dimensionLabel('owner', '', project)).toBe('未指派');
    expect(dimensionLabel('rootCause', '', project)).toBe('未设置');
    expect(dimensionLabel('bugType', 'crash', project)).toBe('崩溃');
  });
});

describe('chart options', () => {
  it('draws created / resolved / closed as three lines on one axis', () => {
    const r: TrendReport = {
      from: '2026-10-18',
      to: '2026-10-19',
      granularity: 'day',
      snapshotDays: 0,
      points: [
        { date: '2026-10-18', created: 3, resolved: 1, closed: 0, open: 5 },
        { date: '2026-10-19', created: 1, resolved: 2, closed: 2, open: 4 },
      ],
    };
    const option = flowOption(r);
    const series = option.series as { name: string; data: number[] }[];
    expect(series.map((s) => [s.name, s.data])).toEqual([
      ['新增', [3, 1]],
      ['解决', [1, 2]],
      ['关闭', [0, 2]],
    ]);
    expect(Array.isArray(option.yAxis)).toBe(false);
  });

  it('puts the largest bar on top of a horizontal bar chart', () => {
    const option = barsOption([
      { name: 'a', count: 1 },
      { name: 'b', count: 5 },
    ]);
    expect((option.yAxis as { data: string[] }).data).toEqual(['a', 'b']);
  });

  it('stacks age buckets by severity from light to dark', () => {
    const option = ageOption({
      total: 1,
      oldest: [],
      rows: [{ bucket: '0-3', label: '0–3 天', total: 1, bySeverity: { fatal: 1 } }],
    });
    const series = option.series as {
      name: string;
      data: number[];
      itemStyle: { color: string };
    }[];
    expect(series[0]).toMatchObject({
      name: '致命',
      data: [1],
      itemStyle: { color: SEVERITY_COLORS.fatal },
    });
    expect(series[1]!.data).toEqual([0]);
  });
});

describe('report query', () => {
  it('keeps only valid filters from the URL', () => {
    const params = new URLSearchParams(
      'tab=claude&from=2026-10-01&to=bad&granularity=month&moduleId=m1&severity=fatal',
    );
    expect(currentTab(params)).toBe('claude');
    expect(reportQuery(params)).toEqual({ from: '2026-10-01', moduleId: 'm1', severity: 'fatal' });
    expect(currentTab(new URLSearchParams('tab=nope'))).toBe('trend');
  });
});
