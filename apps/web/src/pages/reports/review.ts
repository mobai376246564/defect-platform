/**
 * 复盘概览的指标定义、环比、自动结论与周报 / 月报文本（纯函数，便于单测）。
 * 结论只挑需要在复盘会上讨论的事：存量变化、高等级缺陷、超期、修复质量、模块热点、个人重开。
 */
import { SEVERITY, findState, type Severity } from '@defect/shared';
import type { ProjectDetail, ReviewDefect, ReviewKpis, ReviewReport } from '../../api/types';
import { duration, pct } from './charts';

type Format = 'count' | 'signed' | 'rate' | 'hours';

export interface KpiDef {
  key: keyof ReviewKpis;
  label: string;
  /** 变化方向的好坏：up 越大越好，down 越小越好，none 不判断 */
  better: 'up' | 'down' | 'none';
  format: Format;
  hint?: string;
}

export const REVIEW_KPIS: KpiDef[] = [
  { key: 'created', label: '新增缺陷', better: 'none', format: 'count' },
  { key: 'seriousCreated', label: '新增致命 / 严重', better: 'down', format: 'count' },
  { key: 'resolved', label: '解决', better: 'up', format: 'count', hint: '首次解决' },
  { key: 'closed', label: '关闭', better: 'up', format: 'count' },
  {
    key: 'netChange',
    label: '净增',
    better: 'down',
    format: 'signed',
    hint: '新增 − 关闭，正数表示存量在增加',
  },
  { key: 'open', label: '期末未关闭', better: 'down', format: 'count' },
  { key: 'reopened', label: '被重新打开', better: 'down', format: 'count' },
  {
    key: 'reopenRate',
    label: '重开率',
    better: 'down',
    format: 'rate',
    hint: '期内解决的缺陷中被重开过的比例',
  },
  { key: 'slaRate', label: 'SLA 达成率', better: 'up', format: 'rate' },
  {
    key: 'avgResolveHours',
    label: '平均解决时长',
    better: 'down',
    format: 'hours',
    hint: '确认 → 首次解决，工作日计时',
  },
  {
    key: 'invalidRate',
    label: '无效缺陷率',
    better: 'down',
    format: 'rate',
    hint: '期内关闭的缺陷中重复、设计如此、无法重现等的比例',
  },
];

export function formatKpi(v: number | null, format: Format): string {
  if (v === null) return '—';
  switch (format) {
    case 'rate':
      return pct(v);
    case 'hours':
      return duration(v);
    case 'signed':
      return v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0';
    default:
      return String(v);
  }
}

export interface Delta {
  text: string;
  tone: 'good' | 'bad' | 'neutral';
}

/** 与上一期相比的变化；任一期没有数据时返回 null。 */
export function kpiDelta(def: KpiDef, cur: number | null, prev: number | null): Delta | null {
  if (cur === null || prev === null) return null;
  const diff = cur - prev;
  if (Math.abs(diff) < 1e-9) return { text: '持平', tone: 'neutral' };
  const sign = diff > 0 ? '+' : '−';
  let text: string;
  if (def.format === 'rate') text = `${sign}${(Math.abs(diff) * 100).toFixed(1)} 个百分点`;
  else if (def.format === 'hours') text = `${sign}${duration(Math.abs(diff))}`;
  else {
    text = `${sign}${Math.abs(diff)}`;
    if (def.format === 'count' && prev > 0)
      text += `（${sign}${Math.round((Math.abs(diff) / prev) * 100)}%）`;
  }
  const tone =
    def.better === 'none' ? 'neutral' : diff > 0 === (def.better === 'up') ? 'good' : 'bad';
  return { text, tone };
}

export interface Insight {
  tone: 'good' | 'bad' | 'info';
  text: string;
}

const REOPEN_ALERT = 0.15;
const SLA_ALERT = 0.8;
const INVALID_ALERT = 0.2;
/** 个人重开：解决至少 3 个且重开率 ≥ 30% 才提示，避免样本太小 */
const PERSON_MIN_RESOLVED = 3;
const PERSON_REOPEN_ALERT = 0.3;
/** 解决时长变慢：至少慢 50% 且至少多 4 个工作小时，几十分钟的波动不提示 */
const SLOWER_RATIO = 1.5;
const SLOWER_MIN_HOURS = 4;

const moduleName = (project: ProjectDetail, key: string) =>
  key ? (project.modules.find((m) => m.id === key)?.name ?? '已删除模块') : '未设置模块';
const memberName = (project: ProjectDetail, key: string) =>
  key ? (project.members.find((m) => m.id === key)?.name ?? '已移除成员') : '未指派';

/** 根据本期与上期的数据生成复盘结论，需要关注的排在前面。 */
export function reviewInsights(r: ReviewReport, project: ProjectDetail): Insight[] {
  const c = r.current;
  const b = r.before;
  const out: Insight[] = [];

  if (c.netChange > 0) {
    out.push({
      tone: 'bad',
      text: `存量增加 ${c.netChange} 个：新增 ${c.created} 个、关闭 ${c.closed} 个，关闭速度跟不上新增`,
    });
  } else if (c.netChange < 0) {
    out.push({ tone: 'good', text: `存量减少 ${-c.netChange} 个，期末未关闭 ${c.open} 个` });
  }
  if (c.seriousCreated > 0) {
    out.push({
      tone: 'bad',
      text: `新增致命 / 严重缺陷 ${c.seriousCreated} 个（上期 ${b.seriousCreated} 个），需逐个确认根因与修复进度`,
    });
  }
  if (r.overdueCount > 0) {
    out.push({
      tone: 'bad',
      text: `当前有 ${r.overdueCount} 个缺陷超期（过了截止时间或超过 SLA），需要明确负责人和完成时间`,
    });
  }
  if (c.reopenRate !== null && c.reopenRate >= REOPEN_ALERT && c.reopened > 0) {
    out.push({
      tone: 'bad',
      text: `重开率 ${pct(c.reopenRate)}（上期 ${pct(b.reopenRate)}），修复质量需要关注`,
    });
  }
  if (c.slaRate !== null && c.slaRate < SLA_ALERT) {
    out.push({ tone: 'bad', text: `SLA 达成率 ${pct(c.slaRate)}，低于 ${pct(SLA_ALERT)}` });
  }
  if (
    c.avgResolveHours !== null &&
    b.avgResolveHours !== null &&
    b.avgResolveHours > 0 &&
    c.avgResolveHours >= b.avgResolveHours * SLOWER_RATIO &&
    c.avgResolveHours - b.avgResolveHours >= SLOWER_MIN_HOURS
  ) {
    out.push({
      tone: 'bad',
      text: `平均解决时长 ${duration(c.avgResolveHours)}，比上期（${duration(b.avgResolveHours)}）明显变慢`,
    });
  }
  if (c.invalidRate !== null && c.invalidRate >= INVALID_ALERT) {
    out.push({
      tone: 'bad',
      text: `无效缺陷率 ${pct(c.invalidRate)}，提单前需要确认重现步骤和需求`,
    });
  }

  // 模块热点：新增至少 3 个，且比上期翻倍（上期为 0 也算）
  for (const m of r.modules.slice(0, 5)) {
    if (m.created >= 3 && m.created >= m.prevCreated * 2) {
      out.push({
        tone: 'bad',
        text: `「${moduleName(project, m.key)}」新增 ${m.created} 个（上期 ${m.prevCreated} 个），当前未关闭 ${m.open} 个`,
      });
    }
  }
  const top = r.modules[0];
  if (top && c.created >= 5 && top.created / c.created >= 0.4) {
    out.push({
      tone: 'info',
      text: `新增集中在「${moduleName(project, top.key)}」，占 ${pct(top.created / c.created)}`,
    });
  }
  for (const d of r.developers) {
    if (d.resolved >= PERSON_MIN_RESOLVED && (d.reopenRate ?? 0) >= PERSON_REOPEN_ALERT) {
      out.push({
        tone: 'bad',
        text: `${memberName(project, d.key)} 解决 ${d.resolved} 个，其中 ${d.reopened} 个被重新打开（${pct(d.reopenRate)}）`,
      });
    }
  }
  if (b.created > 0 && Math.abs(c.created - b.created) >= 3) {
    const change = (c.created - b.created) / b.created;
    if (Math.abs(change) >= 0.3) {
      out.push({
        tone: 'info',
        text: `新增缺陷 ${c.created} 个，比上期${change > 0 ? '多' : '少'} ${pct(Math.abs(change))}`,
      });
    }
  }
  if (!out.some((i) => i.tone === 'bad')) {
    out.push({ tone: 'good', text: '没有需要特别关注的问题，各项指标平稳' });
  }
  return out;
}

/** 超期原因：截止时间按日历天，SLA 按工作日时长 */
export function overdueText(reason: 'due' | 'sla', overHours: number): string {
  return reason === 'due'
    ? `超过截止时间 ${Math.max(1, Math.ceil(overHours / 24))} 天`
    : `超 SLA ${duration(overHours)}`;
}

const MD_LIST_LIMIT = 20;

/** 复制到群聊或文档的周报 / 月报（Markdown）。 */
export function reviewMarkdown(
  r: ReviewReport,
  project: ProjectDetail,
  opts: { title: string; origin: string; filters?: string },
): string {
  const lines: string[] = [];
  const link = (d: ReviewDefect) => `[${d.code}](${opts.origin}/p/${project.key}/bugs/${d.code})`;
  const describe = (d: ReviewDefect) => {
    const owners = d.ownerIds.map((id) => memberName(project, id)).join('、') || '未指派';
    const status = findState(project.workflow, d.status)?.name ?? d.status;
    return `${link(d)} ${d.title}（${SEVERITY[d.severity as Severity] ?? d.severity} · ${status} · ${owners}）`;
  };

  lines.push(`# ${opts.title}`, '');
  lines.push(
    `时间：${r.period.from} ~ ${r.period.to}，对比上期 ${r.previous.from} ~ ${r.previous.to}${opts.filters ? `；筛选：${opts.filters}` : ''}`,
    '',
  );
  lines.push('## 核心指标', '', '| 指标 | 本期 | 上期 | 变化 |', '| --- | --- | --- | --- |');
  for (const def of REVIEW_KPIS) {
    const cur = r.current[def.key];
    const prev = r.before[def.key];
    lines.push(
      `| ${def.label} | ${formatKpi(cur, def.format)} | ${formatKpi(prev, def.format)} | ${kpiDelta(def, cur, prev)?.text ?? '—'} |`,
    );
  }
  lines.push(`| 当前超期 | ${r.overdueCount} | — | — |`, '');

  lines.push('## 结论', '');
  for (const i of reviewInsights(r, project)) {
    lines.push(`- ${i.tone === 'bad' ? '⚠️ ' : i.tone === 'good' ? '✅ ' : ''}${i.text}`);
  }
  lines.push('');

  const section = (
    title: string,
    list: { total: number; items: ReviewDefect[] },
    extra?: (d: ReviewDefect) => string,
  ) => {
    lines.push(`## ${title}（${list.total}）`, '');
    if (list.total === 0) lines.push('无', '');
    else {
      for (const d of list.items.slice(0, MD_LIST_LIMIT)) {
        lines.push(`- ${describe(d)}${extra ? ` — ${extra(d)}` : ''}`);
      }
      if (list.total > MD_LIST_LIMIT) lines.push(`- ……另有 ${list.total - MD_LIST_LIMIT} 个`);
      lines.push('');
    }
  };
  section('本期新增致命 / 严重缺陷', r.lists.serious);
  section('当前超期缺陷', r.lists.overdue, (d) => {
    const o = d as ReviewReport['lists']['overdue']['items'][number];
    return overdueText(o.reason, o.overHours);
  });
  section('本期被重新打开的缺陷', r.lists.reopened, (d) => `累计重开 ${d.reopenCount} 次`);
  return lines.join('\n').trimEnd() + '\n';
}
