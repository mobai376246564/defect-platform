import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AGE_BUCKETS,
  SEVERITY,
  ageBucketOf,
  dateRange,
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
  granularity: z.enum(['day', 'week']).default('day'),
  /** 分布报表：open 当前未关闭的缺陷；created 时间段内新建的缺陷 */
  scope: z.enum(['open', 'created']).default('open'),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;
const SEVERITIES = Object.keys(SEVERITY);

interface Scope {
  where: Prisma.DefectWhereInput;
  from: string;
  to: string;
  /** [start, end) 为时间段对应的时刻区间 */
  start: Date;
  end: Date;
  granularity: Granularity;
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
    const openAt = (day: string): number => {
      const end = dayStart(addDays(day, 1));
      return defects.filter(
        (d) =>
          d.createdAt < end &&
          (d.statusCategory !== 'done' || (d.closedAt !== null && d.closedAt >= end)),
      ).length;
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
    const defects = await this.prisma.defect.findMany({
      where,
      select: {
        status: true,
        severity: true,
        moduleId: true,
        ownerIds: true,
        bugType: true,
        rootCause: true,
      },
    });
    return {
      scope: f.scope,
      total: defects.length,
      status: countBy(defects, (d) => d.status),
      severity: countBy(defects, (d) => d.severity),
      module: countBy(defects, (d) => d.moduleId),
      owner: countBy(defects, (d) => d.ownerIds),
      bugType: countBy(defects, (d) => d.bugType),
      rootCause: countBy(defects, (d) => d.rootCause),
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
    ].map((v) => {
      const list = defects.filter((d) => d.versionFoundId === v.id);
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
    return { rows: rows.filter((r) => r.versionId !== null || r.total > 0) };
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
          acc.set(key, (a = { response: [], resolve: [], slaMet: 0, slaTotal: 0, inHand: 0 }));
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

  /** 线上反馈：APP 反馈量与处理结果、建单率、重复反馈最多的缺陷。 */
  async feedback(ctx: ProjectContext, f: ReportFilter) {
    const s = await this.scope(ctx, f);
    const appIds = ctx.project.appIds;
    const [reports, top] = await Promise.all([
      appIds.length
        ? this.prisma.feedbackReport.findMany({
            where: { appId: { in: appIds }, receivedAt: { gte: s.start, lt: s.end } },
            select: { status: true, receivedAt: true },
          })
        : Promise.resolve([]),
      this.prisma.defect.findMany({
        where: { ...s.where, source: 'app' },
        orderBy: [{ dupCount: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        select: {
          code: true,
          title: true,
          status: true,
          severity: true,
          dupCount: true,
          createdAt: true,
        },
      }),
    ]);
    const STATUSES = ['created', 'merged', 'archived', 'failed', 'pending'] as const;
    const empty = (): Record<string, number> => ({
      ...Object.fromEntries(STATUSES.map((k) => [k, 0])),
      total: 0,
    });
    const points = new Map<string, Record<string, number>>();
    for (const day of dateRange(s.from, s.to)) {
      points.set(bucketOf(day, s.granularity), empty());
    }
    const totals = empty();
    for (const r of reports) {
      const p = points.get(bucketOf(reportDate(r.receivedAt), s.granularity));
      const status = (STATUSES as readonly string[]).includes(r.status) ? r.status : 'pending';
      for (const t of [p, totals]) {
        if (!t) continue;
        t[status]!++;
        t.total!++;
      }
    }
    return {
      granularity: s.granularity,
      summary: { ...totals, createRate: ratio(totals.created!, totals.total!) },
      points: [...points].map(([date, v]) => ({ date, ...v })),
      top: top.map((d) => ({ ...d, feedbackCount: d.dupCount + 1 })),
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
    const [audits, comments, activity] = await Promise.all([
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
      this.prisma.$queryRaw<{ mcpCalls: bigint; claudeComments: bigint }[]>`
        SELECT
          (SELECT count(*) FROM "McpAudit" a JOIN "Defect" d ON d.id = a."defectId"
            WHERE d."projectId" = ${ctx.project.id}::uuid
              AND a."createdAt" >= ${s.start} AND a."createdAt" < ${s.end}) AS "mcpCalls",
          (SELECT count(*) FROM "Comment" c JOIN "Defect" d ON d.id = c."defectId"
            WHERE d."projectId" = ${ctx.project.id}::uuid AND c.via = 'claude'
              AND c."createdAt" >= ${s.start} AND c."createdAt" < ${s.end}) AS "claudeComments"`,
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
        mcpCalls: Number(activity[0]?.mcpCalls ?? 0),
        claudeComments: Number(activity[0]?.claudeComments ?? 0),
      },
      compare: { withClaude: group(claude), withoutClaude: group(others) },
      points: [...buckets].map(([date, b]) => ({
        date,
        ...b,
        ratio: ratio(b.withClaude, b.resolved),
      })),
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
