import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import {
  GROUP_NONE,
  PRIORITY_RANK,
  SEVERITY_RANK,
  availableTransitions,
  findState,
  type Priority,
  type Severity,
} from '@defect/shared';
import type { AuthUser } from '../common/auth-user';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../projects/project-access.service';
import { buildDefectOrderBy, buildDefectWhere, keywordWhere } from './defect-query';
import {
  MAX_BULK,
  listQuerySchema,
  todoGroupsSchema,
  todoQuerySchema,
  type BulkInput,
  type TodoGroupsQuery,
  type TodoQuery,
  type UpdateDefectInput,
} from './defects.dto';
import { DefectsService, userActor, type Via } from './defects.service';

export interface BulkResult {
  total: number;
  updated: number;
  failed: { code: string; message: string }[];
}

/**
 * 批量修改与“我的待办”。
 * 批量修改逐个调用单个修改 / 流转的逻辑，权限、变更历史、通知与单个操作完全一致；
 * 某个缺陷失败（如开发改非处理中的缺陷）不影响其他缺陷，失败原因一并返回。
 */
@Injectable()
export class DefectBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defects: DefectsService,
  ) {}

  async bulkUpdate(ctx: ProjectContext, user: AuthUser, input: BulkInput, via: Via) {
    const codes = input.codes ?? (await this.codesMatching(ctx, user, input.query ?? {}));
    const { status, ...fields } = input.changes;
    const target = status ? findState(ctx.workflow, status) : undefined;
    if (status && !target) throw new BadRequestException(`状态不存在：${status}`);
    const actor = userActor(ctx, user);
    const result: BulkResult = { total: codes.length, updated: 0, failed: [] };

    for (const code of codes) {
      try {
        if (Object.keys(fields).length > 0) {
          await this.defects.update(ctx, actor, code, fields as UpdateDefectInput, via);
        }
        if (target) {
          const defect = await this.defects.findByCode(ctx.project.id, code);
          if (defect.status !== target.key) {
            // 找一条从当前状态到目标状态、本人可执行且不需要额外填写的流转
            const t = availableTransitions(ctx.workflow, defect.status, ctx.role).find(
              (x) => x.to === target.key,
            );
            if (!t) throw new BadRequestException(`当前状态不能直接改为“${target.name}”`);
            if (t.requiresComment || t.requiredFields.length) {
              throw new BadRequestException(`改为“${target.name}”需要填写说明或字段，请单独操作`);
            }
            await this.defects.transition(ctx, actor, code, { transition: t.key, values: {} }, via);
          }
        }
        result.updated++;
      } catch (err) {
        const message = err instanceof HttpException ? messageOf(err) : '修改失败，请稍后重试';
        result.failed.push({ code, message });
      }
    }
    return result;
  }

  /** 按列表的查询条件取出全部匹配的缺陷编号（“选择全部筛选结果”） */
  private async codesMatching(ctx: ProjectContext, user: AuthUser, raw: Record<string, string>) {
    const parsed = listQuerySchema.safeParse({ ...raw, page: '1', pageSize: '1' });
    if (!parsed.success) throw new BadRequestException('筛选条件有误');
    const where = buildDefectWhere(ctx.project.id, user, parsed.data);
    const total = await this.prisma.defect.count({ where });
    if (total > MAX_BULK) {
      throw new BadRequestException(
        `一次最多修改 ${MAX_BULK} 个缺陷，当前筛选出 ${total} 个，请缩小范围`,
      );
    }
    const rows = await this.prisma.defect.findMany({
      where,
      orderBy: buildDefectOrderBy(parsed.data),
      select: { code: true },
    });
    return rows.map((r) => r.code);
  }

  /** 我的待办：我所在的项目里，处理人包含我的缺陷 */
  async todos(user: AuthUser, raw: TodoQuery) {
    const q = todoQuerySchema.parse(raw);
    const where = todoWhere(user, q);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.defect.findMany({
        where,
        orderBy: buildDefectOrderBy(q),
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
          statusCategory: true,
          severity: true,
          priority: true,
          moduleId: true,
          ownerIds: true,
          reporterId: true,
          source: true,
          dupCount: true,
          dueAt: true,
          createdAt: true,
          updatedAt: true,
          project: { select: { key: true, name: true } },
        },
      }),
      this.prisma.defect.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  /** 我的待办分组：每组的值、显示名与数量；项目按名称排，严重程度、优先级、状态按等级排，空值组放最后 */
  async todoGroups(user: AuthUser, raw: TodoGroupsQuery) {
    const q = todoGroupsSchema.parse(raw);
    const where = todoWhere(user, { ...q, groupField: undefined });
    let groups: { value: string; label?: string; count: number }[];
    if (q.groupBy === 'project') {
      const rows = await this.prisma.defect.groupBy({
        by: ['projectId'],
        where,
        _count: { _all: true },
      });
      const projects = await this.prisma.project.findMany({
        where: { id: { in: rows.map((r) => r.projectId) } },
        select: { id: true, key: true, name: true },
      });
      const byId = new Map(projects.map((p) => [p.id, p]));
      groups = rows
        .map((r) => ({
          value: byId.get(r.projectId)?.key ?? GROUP_NONE,
          label: byId.get(r.projectId)?.name,
          count: r._count._all,
        }))
        .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', 'zh-CN'));
    } else {
      const field = q.groupBy;
      const rows = await this.prisma.defect.groupBy({ by: [field], where, _count: { _all: true } });
      const rank = TODO_RANK[field];
      groups = rows
        .map((r) => ({
          value:
            (r as Record<string, unknown>)[field] == null
              ? GROUP_NONE
              : String((r as Record<string, unknown>)[field]),
          count: r._count._all,
        }))
        .sort((a, b) => (rank[a.value] ?? 99) - (rank[b.value] ?? 99));
    }
    const total = await this.prisma.defect.count({ where });
    return { groupBy: q.groupBy, total, groups };
  }
}

const TODO_RANK: Record<'statusCategory' | 'severity' | 'priority', Record<string, number>> = {
  statusCategory: { todo: 0, doing: 1, verifying: 2, done: 3 },
  severity: SEVERITY_RANK as Record<Severity, number>,
  priority: PRIORITY_RANK as Record<Priority, number>,
};

/** 我的待办的查询条件：我所在项目里处理人包含我，再叠加筛选、关键字与当前分组 */
function todoWhere(user: AuthUser, q: TodoQuery): Prisma.DefectWhereInput {
  const and: Prisma.DefectWhereInput[] = [
    {
      deletedAt: null,
      ownerIds: { has: user.id },
      project: {
        members: { some: { userId: user.id } },
        ...(q.project?.length ? { key: { in: q.project } } : {}),
      },
    },
  ];
  if (q.statusCategory?.length) and.push({ statusCategory: { in: q.statusCategory } });
  if (q.severity?.length) and.push({ severity: { in: q.severity } });
  if (q.priority?.length) and.push({ priority: { in: q.priority } });
  if (q.keyword) and.push(keywordWhere(q.keyword));
  if (q.groupField && q.groupValue !== undefined) {
    const none = q.groupValue === GROUP_NONE;
    and.push(
      q.groupField === 'project'
        ? { project: { key: q.groupValue } }
        : { [q.groupField]: none ? null : q.groupValue },
    );
  }
  return { AND: and };
}

function messageOf(err: HttpException): string {
  const body = err.getResponse();
  if (typeof body === 'string') return body;
  const m = (body as { message?: unknown }).message;
  return Array.isArray(m) ? m.join('；') : typeof m === 'string' ? m : err.message;
}
