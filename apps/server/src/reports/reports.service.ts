import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AGE_BUCKETS,
  SERIOUS_SEVERITIES,
  SEVERITY,
  ageBucketOf,
  dateRange,
  isInvalidDefect,
  previousPeriod,
  reportDate,
  slaOf,
  workingMs,
} from '@defect/shared';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../projects/project-access.service';
import { severitySchema } from '../defects/defects.dto';
import {
  addDays,
  average,
  bucketOf,
  countBy,
  dayStart,
  ratio,
  toHours,
  type Granularity,
} from './report-math';

/** 报表统一筛选（方案 6.9）：时间段、模块（含子模块）、发现版本、严重程度。 */
export const reportFilterSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  moduleId: z.uuid().optional(),
  versionId: z.uuid().optional(),
  severity: severitySchema.optional(),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  /** 分布报表：open 当前未关闭的缺陷；created 时间段内新建的缺陷 */
  scope: z.enum(['open', 'created']).default('open'),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;
const SEVERITIES = Object.keys(SEVERITY);
/** 复盘清单每张最多列出的缺陷数 */
const REVIEW_LIST_LIMIT = 50;

/** 复盘清单里的缺陷行 */
const LIST_SELECT = {
  id: true,
  code: true,
  title: true,
  status: true,
  severity: true,
  ownerIds: true,
  createdAt: true,
  reopenCount: true,
} satisfies Prisma.DefectSelect;

interface Scope {
  where: Prisma.DefectWhereInput;
  from: string;
  to: string;
  /** [start, end) 为时间段对应的时刻区间 */
  start: Date;
  end: Date;
  granularity: Granularity;
}

/** 时刻区间 [start, end) */
interface Window {
  start: Date;
  end: Date;
}

/**
 * 统计报表（方案 6.9），指标口径见方案“指标口径”表：
 * - 未关闭 = 状态类别 ≠ 已完成；
 * - 响应 / 解决时长 = 确认 → 首次进入“进行中” / “待验证”类别，工作日计时；
 * - 重开率 = 时间段内解决过的缺陷中被重新打开过的比例；
 * - Claude 参与 = 解决前有过 MCP 调用记录或 Claude 回写评论。
 * 趋势的存量优先取每日快照，缺快照的日期（含今天）与按模块 / 版本筛选时用缺陷时间戳还原。
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async trend(ctx: ProjectContext, f: ReportFilter) {
    const s = await this.scope(ctx, f);
    const defects = await this.prisma.defect.findMany({
      where: { ...s.where, createdAt: { lt: s.end } },
      select: { createdAt: true, resolvedAt: true, closedAt: true, statusCategory: true },
    });
    const days = dateRange(s.from, s.to);
    const inRange = (at: Date | null) =>
      at && at >= s.start && at < s.end ? reportDate(at) : null;
    const tally = (pick: (d: (typeof defects)[number]) => Date | null) => {
      const m = new Map<string, number>();
      for (const d of defects) {
        const day = inRange(pick(d));
        if (day) m.set(day, (m.get(day) ?? 0) + 1);
      }
      return m;
    };
    const created = tally((d) => d.createdAt);
    const resolved = tally((d) => d.resolvedAt);
    const closed = tally((d) => (d.statusCategory === 'done' ? d.closedAt : null));

    // 快照只有项目 × 状态类别 × 严重程度维度，按模块 / 版本筛选时无法使用
    const snapshotOpen = new Map<string, number>();
    if (!f.moduleId && !f.versionId) {
      const rows = await this.prisma.defectDailySnapshot.findMany({
        where: {
          projectId: ctx.project.id,
          date: { gte: new Date(`${s.from}T00:00:00Z`), lte: new Date(`${s.to}T00:00:00Z`) },
          ...(f.severity ? { severity: f.severity } : {}),
        },
      });
      for (const r of rows) {
        const day = r.date.toISOString().slice(0, 10);
        const open = r.statusCategory === 'done' ? 0 : r.count;
        snapshotOpen.set(day, (snapshotOpen.get(day) ?? 0) + open);
      }
    }
    // 某天结束时的存量 = 此前创建的 − 此前已关闭的（当前仍是已完成状态的）。
    // 两组时间各排一次序，每天二分查找，复杂度 O(N log N + 天数)，而不是每天把全部缺陷过滤一遍
    const createdTimes = defects.map((d) => d.createdAt.getTime()).sort((a, b) => a - b);
    const closedTimes = defects
      .filter((d) => d.statusCategory === 'done' && d.closedAt)
      .map((d) => d.closedAt!.getTime())
      .sort((a, b) => a - b);
    const openAt = (day: string): number => {
      const end = dayStart(addDays(day, 1)).getTime();
      return countBefore(createdTimes, end) - countBefore(closedTimes, end);
    };

    const points = new Map<
      string,
      { date: string; created: number; resolved: number; closed: number; open: number }
    >();
    for (const day of days) {
      const key = bucketOf(day, s.granularity);
      const p = points.get(key) ?? { date: key, created: 0, resolved: 0, closed: 0, open: 0 };
      p.created += created.get(day) ?? 0;
      p.resolved += resolved.get(day) ?? 0;
      p.closed += closed.get(day) ?? 0;
      // 按周时存量取该周（时间段内）最后一天
      p.open = snapshotOpen.get(day) ?? openAt(day);
      points.set(key, p);
    }
    return {
      from: s.from,
      to: s.to,
      granularity: s.granularity,
      snapshotDays: days.filter((d) => snapshotOpen.has(d)).length,
      points: [...points.values()],
    };
  }

  async distribution(ctx: ProjectContext, f: ReportFilter) {
    const s = await this.scope(ctx, f);
    const where: Prisma.DefectWhereInput =
      f.scope === 'open'
        ? { ...s.where, statusCategory: { not: 'done' } }
        : { ...s.where, createdAt: { gte: s.start, lt: s.end } };
    // 单值字段交给数据库分组计数；处理人是数组，只取这一列在内存里展开
    const group = async (field: 'status' | 'severity' | 'moduleId' | 'bugType' | 'rootCause') => {
      const rows = await this.prisma.defect.groupBy({
        by: [field],
        where,
        _count: { _all: true },
      });
      // 与 countBy 的输出一致：空值记为 ''，数量相同按 key 排序
      return rows
        .map((r) => ({
          key: ((r as Record<string, unknown>)[field] as string | null) ?? '',
          count: r._count._all,
        }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    };
    const [status, severity, module, bugType, rootCause, owners] = await Promise.all([
      group('status'),
      group('severity'),
      group('moduleId'),
      group('bugType'),
      group('rootCause'),
      this.prisma.defect.findMany({ where, select: { ownerIds: true } }),
    ]);
    return {
      scope: f.scope,
      total: owners.length,
      status,
      severity,
      module,
      owner: countBy(owners, (d) => d.ownerIds),
      bugType,
      rootCause,
    };
  }

  async age(ctx: ProjectContext, f: ReportFilter, now = new Date()) {
    const s = await this.scope(ctx, f);
    const defects = await this.prisma.defect.findMany({
      where: { ...s.where, statusCategory: { not: 'done' } },
      select: {
        code: true,
        title: true,
        status: true,
        severity: true,
        ownerIds: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const rows = AGE_BUCKETS.map((b) => ({
      bucket: b.key,
      label: b.label,
      total: 0,
      bySeverity: Object.fromEntries(SEVERITIES.map((k) => [k, 0])) as Record<string, number>,
    }));
    for (const d of defects) {
      const row = rows.find((r) => r.bucket === ageBucketOf(d.createdAt, now))!;
      row.total++;
      row.bySeverity[d.severity] = (row.bySeverity[d.severity] ?? 0) + 1;
    }
    return {
      total: defects.length,
      rows,
      oldest: defects.slice(0, 10).map((d) => ({
        ...d,
        ageDays: Math.floor((now.getTime() - d.createdAt.getTime()) / 86_400_000),
      })),
    };
  }

  /** 版本质量：每个发现版本的缺陷数、严重程度构成、当前未关闭数与发版时未关闭数。 */
  async versions(ctx: ProjectContext, f: ReportFilter) {
    const s = await this.scope(ctx, { ...f, versionId: undefined });
    const [versions, defects] = await Promise.all([
      this.prisma.version.findMany({
        where: { projectId: ctx.project.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.defect.findMany({
        where: s.where,
        select: {
          versionFoundId: true,
          severity: true,
          statusCategory: true,
          createdAt: true,
          closedAt: true,
        },
      }),
    ]);
    const rows = [
      ...versions.map((v) => ({
        id: v.id as string | null,
        name: v.name,
        releasedAt: v.releasedAt,
      })),
      { id: null, name: '未指定版本', releasedAt: null },
    ];
    // 一次遍历按版本分组，而不是每个版本都把全部缺陷过滤一遍
    const byVersion = new Map<string | null, typeof defects>();
    for (const d of defects) {
      const list = byVersion.get(d.versionFoundId);
      if (list) list.push(d);
      else byVersion.set(d.versionFoundId, [d]);
    }
    const result = rows.map((v) => {
      const list = byVersion.get(v.id) ?? [];
      const released = v.releasedAt;
      return {
        versionId: v.id,
        name: v.name,
        releasedAt: released,
        total: list.length,
        open: list.filter((d) => d.statusCategory !== 'done').length,
        openAtRelease: released
          ? list.filter(
              (d) =>
                d.createdAt <= released &&
                (d.statusCategory !== 'done' || (d.closedAt !== null && d.closedAt > released)),
            ).length
          : null,
        bySeverity: Object.fromEntries(
          SEVERITIES.map((k) => [k, list.filter((d) => d.severity === k).length]),
        ) as Record<string, number>,
      };
    });
    return { rows: result.filter((r) => r.versionId !== null || r.total > 0) };
  }

  /**
   * 处理效率：时间段内开始处理的缺陷算响应时长，时间段内解决的缺陷算解决时长与 SLA，
   * 在手数为当前未关闭且由其处理的缺陷。按人以开发人员（无则主处理人）归属。
   */
  async efficiency(ctx: ProjectContext, f: ReportFilter) {
    const s = await this.scope(ctx, f);
    const window = { gte: s.start, lt: s.end };
    const [handled, open] = await Promise.all([
      this.prisma.defect.findMany({
        where: {
          ...s.where,
          confirmedAt: { not: null },
          OR: [{ startedAt: window }, { resolvedAt: window }],
        },
        select: {
          severity: true,
          moduleId: true,
          developerId: true,
          ownerIds: true,
          confirmedAt: true,
          startedAt: true,
          resolvedAt: true,
          reopenCount: true,
        },
      }),
      this.prisma.defect.findMany({
        where: { ...s.where, statusCategory: { not: 'done' } },
        select: { moduleId: true, ownerIds: true },
      }),
    ]);
    const inWindow = (at: Date | null): at is Date => !!at && at >= s.start && at < s.end;

    type Acc = {
      response: number[];
      resolve: number[];
      /** 时间段内解决的缺陷中被重新打开过的个数 */
      reopened: number;
      slaMet: number;
      slaTotal: number;
      inHand: number;
    };
    const build = (
      keysOfHandled: (d: (typeof handled)[number]) => string | null,
      keysOfOpen: (d: (typeof open)[number]) => (string | null)[],
    ) => {
      const acc = new Map<string, Acc>();
      const get = (k: string | null) => {
        const key = k ?? '';
        let a = acc.get(key);
        if (!a)
          acc.set(
            key,
            (a = { response: [], resolve: [], reopened: 0, slaMet: 0, slaTotal: 0, inHand: 0 }),
          );
        return a;
      };
      const total = get('__total__');
      for (const d of handled) {
        const targets = [get(keysOfHandled(d)), total];
        if (inWindow(d.startedAt) && d.startedAt >= d.confirmedAt!) {
          const ms = workingMs(d.confirmedAt!, d.startedAt);
          for (const t of targets) t.response.push(ms);
        }
        if (inWindow(d.resolvedAt) && d.resolvedAt >= d.confirmedAt!) {
          const ms = workingMs(d.confirmedAt!, d.resolvedAt);
          const sla = slaOf(d.severity);
          for (const t of targets) {
            t.resolve.push(ms);
            if (d.reopenCount > 0) t.reopened++;
            if (sla) {
              t.slaTotal++;
              if (ms <= sla.resolveMs) t.slaMet++;
            }
          }
        }
      }
      for (const d of open) {
        const keys = keysOfOpen(d);
        for (const k of keys.length ? keys : [null]) get(k).inHand++;
        total.inHand++;
      }
      const row = (key: string, a: Acc) => ({
        key,
        responseCount: a.response.length,
        avgResponseHours: toHours(average(a.response)),
        resolveCount: a.resolve.length,
        avgResolveHours: toHours(average(a.resolve)),
        reopened: a.reopened,
        reopenRate: ratio(a.reopened, a.resolve.length),
        slaMet: a.slaMet,
        slaTotal: a.slaTotal,
        slaRate: ratio(a.slaMet, a.slaTotal),
        inHand: a.inHand,
      });
      return {
        rows: [...acc]
          .filter(([k]) => k !== '__total__')
          .map(([k, a]) => row(k, a))
          .sort((a, b) => b.resolveCount - a.resolveCount || b.inHand - a.inHand),
        total: row('', total),
      };
    };
    return {
      byPerson: build(
        (d) => d.developerId ?? d.ownerIds[0] ?? null,
        (d) => d.ownerIds,
      ),
      byModule: build(
        (d) => d.moduleId,
        (d) => [d.moduleId],
      ),
    };
  }

  /** 修复质量：时间段内解决过的缺陷中，重新打开过的比例（重开率）与一次修复率。 */
  async quality(ctx: ProjectContext, f: ReportFilter) {
    const s = await this.scope(ctx, f);
    const resolved = await this.prisma.defect.findMany({
      where: { ...s.where, resolvedAt: { gte: s.start, lt: s.end } },
      select: { resolvedAt: true, reopenCount: true },
    });
    const summarize = (list: typeof resolved) => {
      const reopened = list.filter((d) => d.reopenCount > 0).length;
      const reopenRate = ratio(reopened, list.length);
      return {
        resolved: list.length,
        reopened,
        reopenRate,
        firstPassRate: reopenRate === null ? null : Math.round((1 - reopenRate) * 10_000) / 10_000,
      };
    };
    const buckets = new Map<string, typeof resolved>();
    for (const day of dateRange(s.from, s.to)) buckets.set(bucketOf(day, s.granularity), []);
    for (const d of resolved)
      buckets.get(bucketOf(reportDate(d.resolvedAt!), s.granularity))?.push(d);
    return {
      granularity: s.granularity,
      summary: summarize(resolved),
      points: [...buckets].map(([date, list]) => ({ date, ...summarize(list) })),
    };
  }

  /**
   * APP 提单：项目绑定的各 APP 提交量、建单成功与失败、各 APP 的分布，以及最近的失败原因。
   * 历史数据里“合并到已有缺陷”（merged）也算成功；pending 是正在处理的提交。
   */
  async feedback(ctx: ProjectContext, f: ReportFilter) {
    const s = await this.scope(ctx, f);
    const appIds = ctx.project.appIds;
    const reports = appIds.length
      ? await this.prisma.feedbackReport.findMany({
          where: { appId: { in: appIds }, receivedAt: { gte: s.start, lt: s.end } },
          select: { reportId: true, appId: true, status: true, error: true, receivedAt: true },
          orderBy: { receivedAt: 'desc' },
        })
      : [];
    type Tally = { total: number; created: number; failed: number; pending: number };
    const empty = (): Tally => ({ total: 0, created: 0, failed: 0, pending: 0 });
    const outcome = (status: string): keyof Omit<Tally, 'total'> =>
      status === 'created' || status === 'merged'
        ? 'created'
        : status === 'failed'
          ? 'failed'
          : 'pending';
    const points = new Map<string, Tally>();
    for (const day of dateRange(s.from, s.to)) points.set(bucketOf(day, s.granularity), empty());
    const byApp = new Map<string, Tally>(appIds.map((a) => [a, empty()]));
    const totals = empty();
    for (const r of reports) {
      const k = outcome(r.status);
      for (const t of [
        points.get(bucketOf(reportDate(r.receivedAt), s.granularity)),
        byApp.get(r.appId),
        totals,
      ]) {
        if (!t) continue;
        t[k]++;
        t.total++;
      }
    }
    return {
      granularity: s.granularity,
      summary: { ...totals, successRate: ratio(totals.created, totals.total) },
      points: [...points].map(([date, v]) => ({ date, ...v })),
      byApp: [...byApp].map(([appId, v]) => ({ appId, ...v })),
      failures: reports
        .filter((r) => r.status === 'failed')
        .slice(0, 10)
        .map((r) => ({
          reportId: r.reportId,
          appId: r.appId,
          error: r.error,
          receivedAt: r.receivedAt,
        })),
    };
  }

  /**
   * Claude 参与修复：时间段内解决的缺陷中，解决前有过 MCP 调用记录或 Claude 回写评论的比例，
   * 并对比参与与未参与两组的平均解决时长和重开率。
   */
  async claude(ctx: ProjectContext, f: ReportFilter) {
    const s = await this.scope(ctx, f);
    const resolved = await this.prisma.defect.findMany({
      where: { ...s.where, resolvedAt: { gte: s.start, lt: s.end } },
      select: { id: true, confirmedAt: true, resolvedAt: true, reopenCount: true },
    });
    const ids = resolved.map((d) => d.id);
    const window = { gte: s.start, lt: s.end };
    const [audits, comments, mcpCalls, claudeComments] = await Promise.all([
      ids.length
        ? this.prisma.mcpAudit.groupBy({
            by: ['defectId'],
            where: { defectId: { in: ids } },
            _min: { createdAt: true },
          })
        : Promise.resolve([]),
      ids.length
        ? this.prisma.comment.groupBy({
            by: ['defectId'],
            where: { defectId: { in: ids }, via: 'claude' },
            _min: { createdAt: true },
          })
        : Promise.resolve([]),
      // 审计记录冗余了项目 id，直接按 (projectId, createdAt) 索引计数
      this.prisma.mcpAudit.count({ where: { projectId: ctx.project.id, createdAt: window } }),
      this.prisma.comment.count({
        where: { via: 'claude', createdAt: window, defect: { projectId: ctx.project.id } },
      }),
    ]);
    const firstTouch = new Map<string, Date>();
    for (const row of [...audits, ...comments]) {
      const at = row._min.createdAt;
      if (!row.defectId || !at) continue;
      const prev = firstTouch.get(row.defectId);
      if (!prev || at < prev) firstTouch.set(row.defectId, at);
    }
    const withClaude = (d: (typeof resolved)[number]) => {
      const at = firstTouch.get(d.id);
      return !!at && at <= d.resolvedAt!;
    };
    const group = (list: typeof resolved) => ({
      count: list.length,
      avgResolveHours: toHours(
        average(
          list
            .filter((d) => d.confirmedAt && d.confirmedAt <= d.resolvedAt!)
            .map((d) => workingMs(d.confirmedAt!, d.resolvedAt!)),
        ),
      ),
      reopenRate: ratio(list.filter((d) => d.reopenCount > 0).length, list.length),
    });
    const claude = resolved.filter(withClaude);
    const others = resolved.filter((d) => !withClaude(d));
    const buckets = new Map<string, { resolved: number; withClaude: number }>();
    for (const day of dateRange(s.from, s.to)) {
      buckets.set(bucketOf(day, s.granularity), { resolved: 0, withClaude: 0 });
    }
    for (const d of resolved) {
      const b = buckets.get(bucketOf(reportDate(d.resolvedAt!), s.granularity));
      if (!b) continue;
      b.resolved++;
      if (withClaude(d)) b.withClaude++;
    }
    return {
      granularity: s.granularity,
      summary: {
        resolved: resolved.length,
        withClaude: claude.length,
        ratio: ratio(claude.length, resolved.length),
        mcpCalls,
        claudeComments,
      },
      compare: { withClaude: group(claude), withoutClaude: group(others) },
      points: [...buckets].map(([date, b]) => ({
        date,
        ...b,
        ratio: ratio(b.withClaude, b.resolved),
      })),
    };
  }

  /**
   * 复盘概览：本期与上一期（previousPeriod）的核心指标对比、各模块新增对比、按人的重开情况，
   * 以及三张清单：本期新增的致命 / 严重缺陷、当前超期的缺陷、本期被重新打开的缺陷。
   * - 被重新打开 = 状态从“待验证 / 已完成”类别回到“未开始 / 进行中”类别，按状态变更记录统计；
   * - 超期 = 未关闭且过了截止时间，或尚未解决且超过 SLA 解决时限（未确认的从创建算起，
   *   否则没人理的缺陷永远不会超期）；超期看的是当前，不随时间段变化。
   */
  async review(ctx: ProjectContext, f: ReportFilter, now = new Date()) {
    const s = await this.scope(ctx, f);
    const previous = previousPeriod(s.from, s.to);
    const cur: Window = { start: s.start, end: s.end };
    const prev: Window = {
      start: dayStart(previous.from),
      end: dayStart(addDays(previous.to, 1)),
    };
    const within = (at: Date | null, w: Window): at is Date => !!at && at >= w.start && at < w.end;

    const [defects, statusChanges] = await Promise.all([
      this.prisma.defect.findMany({
        where: s.where,
        select: {
          id: true,
          status: true,
          statusCategory: true,
          severity: true,
          resolution: true,
          moduleId: true,
          ownerIds: true,
          developerId: true,
          reopenCount: true,
          dueAt: true,
          createdAt: true,
          confirmedAt: true,
          resolvedAt: true,
          closedAt: true,
        },
      }),
      this.prisma.defectHistory.findMany({
        where: { field: 'status', createdAt: { gte: prev.start, lt: cur.end }, defect: s.where },
        select: { defectId: true, oldValue: true, newValue: true, createdAt: true },
      }),
    ]);

    const categoryOf = new Map(ctx.workflow.states.map((st) => [st.key, st.category]));
    const reopenedIn = (w: Window) => {
      const ids = new Set<string>();
      for (const h of statusChanges) {
        if (!within(h.createdAt, w)) continue;
        const from = categoryOf.get(String(h.oldValue));
        const to = categoryOf.get(String(h.newValue));
        if ((from === 'verifying' || from === 'done') && (to === 'todo' || to === 'doing')) {
          ids.add(h.defectId);
        }
      }
      return ids;
    };

    const kpis = (w: Window) => {
      const created = defects.filter((d) => within(d.createdAt, w));
      const resolved = defects.filter((d) => within(d.resolvedAt, w));
      const closed = defects.filter((d) => d.statusCategory === 'done' && within(d.closedAt, w));
      const resolveMs: number[] = [];
      let slaMet = 0;
      let slaTotal = 0;
      for (const d of resolved) {
        if (!d.confirmedAt || d.resolvedAt! < d.confirmedAt) continue;
        const ms = workingMs(d.confirmedAt, d.resolvedAt!);
        resolveMs.push(ms);
        const sla = slaOf(d.severity);
        if (sla) {
          slaTotal++;
          if (ms <= sla.resolveMs) slaMet++;
        }
      }
      return {
        created: created.length,
        seriousCreated: created.filter((d) => SERIOUS_SEVERITIES.includes(d.severity)).length,
        resolved: resolved.length,
        closed: closed.length,
        /** 新增 − 关闭 */
        netChange: created.length - closed.length,
        /** 期末未关闭（口径同趋势报表的存量） */
        open: defects.filter(
          (d) =>
            d.createdAt < w.end &&
            !(d.statusCategory === 'done' && d.closedAt && d.closedAt < w.end),
        ).length,
        reopened: reopenedIn(w).size,
        reopenRate: ratio(resolved.filter((d) => d.reopenCount > 0).length, resolved.length),
        slaRate: ratio(slaMet, slaTotal),
        avgResolveHours: toHours(average(resolveMs)),
        invalidRate: ratio(closed.filter(isInvalidDefect).length, closed.length),
      };
    };

    const severityRank = (sev: string) => SEVERITIES.indexOf(sev);
    type Overdue = {
      d: (typeof defects)[number];
      /** due：过了截止时间（日历时长）；sla：超过 SLA 解决时限（工作日时长） */
      reason: 'due' | 'sla';
      overHours: number;
    };
    const overdue = defects
      .flatMap((d): Overdue[] => {
        if (d.statusCategory === 'done') return [];
        if (d.dueAt && d.dueAt < now) {
          return [{ d, reason: 'due', overHours: toHours(now.getTime() - d.dueAt.getTime())! }];
        }
        const sla = slaOf(d.severity);
        if (sla && !d.resolvedAt) {
          const ms = workingMs(d.confirmedAt ?? d.createdAt, now);
          if (ms > sla.resolveMs) {
            return [{ d, reason: 'sla', overHours: toHours(ms - sla.resolveMs)! }];
          }
        }
        return [];
      })
      .sort(
        (a, b) =>
          severityRank(a.d.severity) - severityRank(b.d.severity) || b.overHours - a.overHours,
      );

    const modules = new Map<
      string,
      { key: string; created: number; prevCreated: number; open: number }
    >();
    const moduleRow = (k: string | null) => {
      const key = k ?? '';
      let row = modules.get(key);
      if (!row) modules.set(key, (row = { key, created: 0, prevCreated: 0, open: 0 }));
      return row;
    };
    for (const d of defects) {
      if (within(d.createdAt, cur)) moduleRow(d.moduleId).created++;
      if (within(d.createdAt, prev)) moduleRow(d.moduleId).prevCreated++;
      if (d.statusCategory !== 'done') moduleRow(d.moduleId).open++;
    }

    const developers = new Map<string, { key: string; resolved: number; reopened: number }>();
    for (const d of defects) {
      if (!within(d.resolvedAt, cur)) continue;
      const key = d.developerId ?? d.ownerIds[0] ?? '';
      const row = developers.get(key) ?? { key, resolved: 0, reopened: 0 };
      row.resolved++;
      if (d.reopenCount > 0) row.reopened++;
      developers.set(key, row);
    }

    const serious = defects
      .filter((d) => within(d.createdAt, cur) && SERIOUS_SEVERITIES.includes(d.severity))
      .sort(
        (a, b) =>
          severityRank(a.severity) - severityRank(b.severity) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
    const reopened = [...reopenedIn(cur)];
    const listed = [
      ...serious.slice(0, REVIEW_LIST_LIMIT).map((d) => d.id),
      ...overdue.slice(0, REVIEW_LIST_LIMIT).map((o) => o.d.id),
      ...reopened.slice(0, REVIEW_LIST_LIMIT),
    ];
    const rows = listed.length
      ? await this.prisma.defect.findMany({
          where: { id: { in: [...new Set(listed)] } },
          select: LIST_SELECT,
        })
      : [];
    const byId = new Map(rows.map(({ id, ...row }) => [id, row]));
    const pick = (ids: string[]) =>
      ids.slice(0, REVIEW_LIST_LIMIT).flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });

    return {
      period: { from: s.from, to: s.to },
      previous,
      current: kpis(cur),
      before: kpis(prev),
      overdueCount: overdue.length,
      modules: [...modules.values()]
        .filter((m) => m.created > 0 || m.prevCreated > 0)
        .sort(
          (a, b) =>
            b.created - a.created || b.created - b.prevCreated - (a.created - a.prevCreated),
        ),
      developers: [...developers.values()]
        .map((d) => ({ ...d, reopenRate: ratio(d.reopened, d.resolved) }))
        .sort((a, b) => b.resolved - a.resolved),
      lists: {
        serious: { total: serious.length, items: pick(serious.map((d) => d.id)) },
        overdue: {
          total: overdue.length,
          items: overdue.slice(0, REVIEW_LIST_LIMIT).flatMap((o) => {
            const row = byId.get(o.d.id);
            return row ? [{ ...row, reason: o.reason, overHours: o.overHours }] : [];
          }),
        },
        reopened: { total: reopened.length, items: pick(reopened) },
      },
    };
  }

  /**
   * 测试与流程：
   * - 环节耗时：时间段内关闭的有效缺陷，等待处理（创建 → 开始处理）、修复（开始处理 → 首次解决）、
   *   验证（首次解决 → 关闭，含被打回后的返工）与全程（创建 → 关闭），工作日计时；
   * - 关闭结论：时间段内关闭的缺陷按解决方式分布（未填解决方式的按关闭时的状态）与无效缺陷率；
   * - 提单质量：时间段内新建的缺陷按创建人统计，无效率 = 已关闭的缺陷中无效的比例；
   * - 验证：当前待验证的缺陷按处理人统计积压与最久等待天数，
   *   时间段内关闭的有效缺陷按验证人（未设置时为创建人）统计验证时长；
   * - 数据完整度：时间段内关闭的有效缺陷各统计字段的填写率。
   */
  async process(ctx: ProjectContext, f: ReportFilter, now = new Date()) {
    const s = await this.scope(ctx, f);
    const window = { gte: s.start, lt: s.end };
    const [closed, created, verifying] = await Promise.all([
      this.prisma.defect.findMany({
        where: { ...s.where, statusCategory: 'done', closedAt: window },
        select: {
          severity: true,
          status: true,
          resolution: true,
          rootCause: true,
          bugType: true,
          moduleId: true,
          versionFoundId: true,
          reporterId: true,
          verifierId: true,
          createdAt: true,
          startedAt: true,
          resolvedAt: true,
          closedAt: true,
        },
      }),
      this.prisma.defect.findMany({
        where: { ...s.where, createdAt: window },
        select: {
          reporterId: true,
          severity: true,
          statusCategory: true,
          status: true,
          resolution: true,
        },
      }),
      this.prisma.defect.findMany({
        where: { ...s.where, statusCategory: 'verifying' },
        select: { id: true, ownerIds: true, resolvedAt: true },
      }),
    ]);
    const valid = closed.filter((d) => !isInvalidDefect(d));

    type Stage = { wait: number[]; fix: number[]; verify: number[]; lead: number[] };
    const stages = new Map<string, Stage>();
    const stageOf = (key: string) => {
      let st = stages.get(key);
      if (!st) stages.set(key, (st = { wait: [], fix: [], verify: [], lead: [] }));
      return st;
    };
    const total = stageOf('');
    for (const d of valid) {
      const targets = [stageOf(d.severity), total];
      const push = (key: keyof Stage, from: Date | null, to: Date | null) => {
        if (!from || !to || to < from) return;
        const ms = workingMs(from, to);
        for (const t of targets) t[key].push(ms);
      };
      push('wait', d.createdAt, d.startedAt);
      push('fix', d.startedAt, d.resolvedAt);
      push('verify', d.resolvedAt, d.closedAt);
      push('lead', d.createdAt, d.closedAt);
    }
    const stageRow = (key: string, st: Stage) => ({
      key,
      count: st.lead.length,
      waitHours: toHours(average(st.wait)),
      fixHours: toHours(average(st.fix)),
      verifyHours: toHours(average(st.verify)),
      leadHours: toHours(average(st.lead)),
    });

    type Reporter = {
      key: string;
      created: number;
      serious: number;
      closed: number;
      invalid: number;
      open: number;
    };
    const reporters = new Map<string, Reporter>();
    for (const d of created) {
      const key = d.reporterId ?? '';
      let row = reporters.get(key);
      if (!row)
        reporters.set(key, (row = { key, created: 0, serious: 0, closed: 0, invalid: 0, open: 0 }));
      row.created++;
      if (SERIOUS_SEVERITIES.includes(d.severity)) row.serious++;
      if (d.statusCategory === 'done') {
        row.closed++;
        if (isInvalidDefect(d)) row.invalid++;
      } else row.open++;
    }

    // 待验证从最近一次进入当前状态算起（被打回后重新提交的不算上一轮的时间）
    const enteredAt = new Map<string, Date>();
    if (verifying.length) {
      const latest = await this.prisma.defectHistory.groupBy({
        by: ['defectId'],
        where: { defectId: { in: verifying.map((d) => d.id) }, field: 'status' },
        _max: { createdAt: true },
      });
      for (const r of latest) if (r._max.createdAt) enteredAt.set(r.defectId, r._max.createdAt);
    }
    type Verifier = { key: string; waiting: number; oldestWaitDays: number; verify: number[] };
    const verifiers = new Map<string, Verifier>();
    const verifierRow = (key: string) => {
      let row = verifiers.get(key);
      if (!row) verifiers.set(key, (row = { key, waiting: 0, oldestWaitDays: 0, verify: [] }));
      return row;
    };
    for (const d of verifying) {
      const since = enteredAt.get(d.id) ?? d.resolvedAt;
      const days = since ? Math.floor((now.getTime() - since.getTime()) / 86_400_000) : 0;
      for (const owner of d.ownerIds.length ? d.ownerIds : ['']) {
        const row = verifierRow(owner);
        row.waiting++;
        row.oldestWaitDays = Math.max(row.oldestWaitDays, days);
      }
    }
    for (const d of valid) {
      if (!d.resolvedAt || !d.closedAt || d.closedAt < d.resolvedAt) continue;
      verifierRow(d.verifierId ?? d.reporterId ?? '').verify.push(
        workingMs(d.resolvedAt, d.closedAt),
      );
    }

    const filled = (pick: (d: (typeof valid)[number]) => string | null) =>
      valid.filter((d) => pick(d) !== null).length;
    return {
      stages: {
        rows: SEVERITIES.filter((k) => stages.has(k)).map((k) => stageRow(k, stages.get(k)!)),
        total: stageRow('', total),
      },
      outcome: {
        closed: closed.length,
        invalid: closed.length - valid.length,
        invalidRate: ratio(closed.length - valid.length, closed.length),
        // 未填解决方式的按关闭时的状态归类，如默认工作流的“测试通过 / 不是bug”
        resolutions: countBy(closed, (d) => d.resolution ?? `status:${d.status}`),
      },
      reporters: [...reporters.values()]
        .map((r) => ({ ...r, invalidRate: ratio(r.invalid, r.closed) }))
        .sort((a, b) => b.created - a.created),
      verifiers: [...verifiers.values()]
        .map(({ verify, ...r }) => ({
          ...r,
          verified: verify.length,
          avgVerifyHours: toHours(average(verify)),
        }))
        .sort((a, b) => b.waiting - a.waiting || b.verified - a.verified),
      completeness: {
        total: valid.length,
        rootCause: filled((d) => d.rootCause),
        bugType: filled((d) => d.bugType),
        moduleId: filled((d) => d.moduleId),
        versionFoundId: filled((d) => d.versionFoundId),
      },
    };
  }

  /** 解析时间段与公共筛选条件；模块筛选包含其全部子模块。 */
  private async scope(ctx: ProjectContext, f: ReportFilter): Promise<Scope> {
    const to = f.to ?? reportDate(new Date());
    const from = f.from ?? addDays(to, -(DEFAULT_DAYS - 1));
    if (from > to) throw new BadRequestException('开始日期不能晚于结束日期');
    if (dateRange(from, to).length > MAX_DAYS) {
      throw new BadRequestException(`时间段最长 ${MAX_DAYS} 天`);
    }
    const where: Prisma.DefectWhereInput = { projectId: ctx.project.id, deletedAt: null };
    if (f.severity) where.severity = f.severity;
    if (f.versionId) where.versionFoundId = f.versionId;
    if (f.moduleId) {
      const modules = await this.prisma.module.findMany({
        where: { projectId: ctx.project.id },
        select: { id: true, parentId: true },
      });
      const ids = new Set([f.moduleId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const m of modules) {
          if (m.parentId && ids.has(m.parentId) && !ids.has(m.id)) {
            ids.add(m.id);
            grew = true;
          }
        }
      }
      where.moduleId = { in: [...ids] };
    }
    return {
      where,
      from,
      to,
      start: dayStart(from),
      end: dayStart(addDays(to, 1)),
      granularity: f.granularity,
    };
  }
}

/** 有序数组中小于 limit 的元素个数（二分查找） */
function countBefore(sorted: number[], limit: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
