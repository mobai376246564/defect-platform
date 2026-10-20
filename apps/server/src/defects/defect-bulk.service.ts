import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { availableTransitions, findState } from '@defect/shared';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../projects/project-access.service';
import { buildDefectOrderBy, buildDefectWhere } from './defect-query';
import {
  MAX_BULK,
  listQuerySchema,
  todoQuerySchema,
  type BulkInput,
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
    const where = {
      deletedAt: null,
      ownerIds: { has: user.id },
      project: {
        members: { some: { userId: user.id } },
        ...(q.project?.length ? { key: { in: q.project } } : {}),
      },
      ...(q.statusCategory?.length ? { statusCategory: { in: q.statusCategory } } : {}),
      ...(q.severity?.length ? { severity: { in: q.severity } } : {}),
      ...(q.priority?.length ? { priority: { in: q.priority } } : {}),
      ...(q.keyword
        ? {
            OR: [
              { code: { equals: q.keyword.toUpperCase() } },
              { title: { contains: q.keyword, mode: 'insensitive' as const } },
              { description: { contains: q.keyword, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
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
}

function messageOf(err: HttpException): string {
  const body = err.getResponse();
  if (typeof body === 'string') return body;
  const m = (body as { message?: unknown }).message;
  return Array.isArray(m) ? m.join('；') : typeof m === 'string' ? m : err.message;
}
