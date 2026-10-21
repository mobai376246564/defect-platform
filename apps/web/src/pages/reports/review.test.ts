import { CLASSIC_WORKFLOW } from '@defect/shared';
import { describe, expect, it } from 'vitest';
import type { ProjectDetail, ReviewKpis, ReviewReport } from '../../api/types';
import { reviewQuery } from './query';
import { REVIEW_KPIS, kpiDelta, overdueText, reviewInsights, reviewMarkdown } from './review';

const project = {
  key: 'APP',
  name: '示例APP',
  workflow: CLASSIC_WORKFLOW,
  modules: [{ id: 'm1', name: '支付', parentId: null, ownerId: null }],
  members: [{ id: 'u1', username: 'wang', name: '小王', email: 'w@x', role: 'developer' }],
} as unknown as ProjectDetail;

const kpis = (over: Partial<ReviewKpis> = {}): ReviewKpis => ({
  created: 0,
  seriousCreated: 0,
  resolved: 0,
  closed: 0,
  netChange: 0,
  open: 0,
  reopened: 0,
  reopenRate: null,
  slaRate: null,
  avgResolveHours: null,
  invalidRate: null,
  ...over,
});

const report = (over: Partial<ReviewReport> = {}): ReviewReport => ({
  period: { from: '2026-10-12', to: '2026-10-18' },
  previous: { from: '2026-10-05', to: '2026-10-11' },
  current: kpis(),
  before: kpis(),
  overdueCount: 0,
  modules: [],
  developers: [],
  lists: {
    serious: { total: 0, items: [] },
    overdue: { total: 0, items: [] },
    reopened: { total: 0, items: [] },
  },
  ...over,
});

const def = (key: keyof ReviewKpis) => REVIEW_KPIS.find((d) => d.key === key)!;

describe('kpiDelta', () => {
  it('colors changes by whether bigger is better', () => {
    expect(kpiDelta(def('resolved'), 12, 8)).toEqual({ text: '+4（+50%）', tone: 'good' });
    expect(kpiDelta(def('open'), 12, 8)).toEqual({ text: '+4（+50%）', tone: 'bad' });
    expect(kpiDelta(def('created'), 6, 8)).toEqual({ text: '−2（−25%）', tone: 'neutral' });
    expect(kpiDelta(def('reopenRate'), 0.2, 0.1)).toEqual({ text: '+10.0 个百分点', tone: 'bad' });
    expect(kpiDelta(def('avgResolveHours'), 12, 36)).toEqual({ text: '−1.0 天', tone: 'good' });
    expect(kpiDelta(def('closed'), 3, 3)).toEqual({ text: '持平', tone: 'neutral' });
    expect(kpiDelta(def('slaRate'), 0.5, null)).toBeNull();
  });
});

describe('reviewInsights', () => {
  it('says all is calm when nothing needs attention', () => {
    expect(reviewInsights(report(), project)).toEqual([
      { tone: 'good', text: '没有需要特别关注的问题，各项指标平稳' },
    ]);
  });

  it('flags growing backlog, serious defects, overdue, hot modules and frequent reopens', () => {
    const r = report({
      current: kpis({
        created: 10,
        closed: 4,
        netChange: 6,
        seriousCreated: 2,
        reopened: 2,
        reopenRate: 0.25,
        slaRate: 0.6,
      }),
      before: kpis({ created: 4, seriousCreated: 0, reopenRate: 0 }),
      overdueCount: 3,
      modules: [{ key: 'm1', created: 6, prevCreated: 1, open: 5 }],
      developers: [{ key: 'u1', resolved: 4, reopened: 2, reopenRate: 0.5 }],
    });
    const texts = reviewInsights(r, project).map((i) => i.text);
    expect(texts).toEqual([
      '存量增加 6 个：新增 10 个、关闭 4 个，关闭速度跟不上新增',
      '新增致命 / 严重缺陷 2 个（上期 0 个），需逐个确认根因与修复进度',
      '当前有 3 个缺陷超期（过了截止时间或超过 SLA），需要明确负责人和完成时间',
      '重开率 25.0%（上期 0.0%），修复质量需要关注',
      'SLA 达成率 60.0%，低于 80.0%',
      '「支付」新增 6 个（上期 1 个），当前未关闭 5 个',
      '新增集中在「支付」，占 60.0%',
      '小王 解决 4 个，其中 2 个被重新打开（50.0%）',
      '新增缺陷 10 个，比上期多 150.0%',
    ]);
  });
});

describe('reviewMarkdown', () => {
  it('writes KPIs, conclusions and defect lists with links', () => {
    const text = reviewMarkdown(
      report({
        current: kpis({ created: 2, closed: 3, netChange: -1 }),
        before: kpis({ created: 1 }),
        overdueCount: 1,
        lists: {
          serious: { total: 0, items: [] },
          overdue: {
            total: 1,
            items: [
              {
                code: 'APP-7',
                title: '启动崩溃',
                status: 'new',
                severity: 'serious',
                ownerIds: ['u1'],
                createdAt: '2026-10-12T00:00:00Z',
                reopenCount: 0,
                reason: 'sla',
                overHours: 30,
              },
            ],
          },
          reopened: { total: 0, items: [] },
        },
      }),
      project,
      { title: '示例APP 缺陷周报', origin: 'http://host', filters: '模块 支付' },
    );
    expect(text).toContain('# 示例APP 缺陷周报');
    expect(text).toContain('对比上期 2026-10-05 ~ 2026-10-11；筛选：模块 支付');
    expect(text).toContain('| 新增缺陷 | 2 | 1 | +1（+100%） |');
    expect(text).toContain('| 净增 | −1 | 0 | −1 |');
    expect(text).toContain('- ✅ 存量减少 1 个，期末未关闭 0 个');
    expect(text).toContain(
      '- [APP-7](http://host/p/APP/bugs/APP-7) 启动崩溃（严重 · 新建 · 小王） — 超 SLA 1.3 天',
    );
    expect(text).toContain('## 本期新增致命 / 严重缺陷（0）\n\n无');
  });

  it('describes how far a defect is overdue', () => {
    expect(overdueText('due', 5)).toBe('超过截止时间 1 天');
    expect(overdueText('due', 50)).toBe('超过截止时间 3 天');
    expect(overdueText('sla', 3)).toBe('超 SLA 3.0 小时');
  });
});

describe('reviewQuery', () => {
  it('defaults to the natural week and keeps an explicit period', () => {
    expect(reviewQuery(new URLSearchParams('granularity=week'), '2026-10-21')).toEqual({
      kind: 'week',
      query: { from: '2026-10-19', to: '2026-10-21' },
    });
    expect(reviewQuery(new URLSearchParams('period=month'), '2026-10-21').query).toEqual({
      from: '2026-10-01',
      to: '2026-10-21',
    });
    expect(
      reviewQuery(new URLSearchParams('from=2026-09-01&to=2026-09-30&period=month'), '2026-10-21'),
    ).toEqual({ kind: 'month', query: { from: '2026-09-01', to: '2026-09-30' } });
  });
});
