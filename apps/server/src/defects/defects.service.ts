import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  availableTransitions,
  checkTransition,
  findState,
  hasPermission,
  type DefectSource,
  type ProjectRole,
  type WorkflowTransition,
} from '@defect/shared';
import type { AuthUser } from '../common/auth-user';
import { Prisma, type Defect } from '../generated/prisma/client';
import { NotificationsService, type NotifyInput } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../projects/project-access.service';
import type {
  CreateDefectInput,
  LinkInput,
  ListQuery,
  TransitionInput,
  UpdateDefectInput,
} from './defects.dto';

/** 操作来源：web 网页、claude 经 MCP、api 个人 Token 脚本、system 系统（Webhook、建单任务） */
export type Via = 'web' | 'claude' | 'api' | 'system';

export type Actor = { kind: 'user'; user: AuthUser; role: ProjectRole } | { kind: 'system' };

export function userActor(ctx: ProjectContext, user: AuthUser): Actor {
  return { kind: 'user', user, role: ctx.role };
}

const actorId = (a: Actor): string | null => (a.kind === 'user' ? a.user.id : null);
const actorName = (a: Actor): string => (a.kind === 'user' ? a.user.name : '系统');

/** APP 反馈等系统建单时携带的额外字段 */
export interface SystemDefectExtras {
  source: DefectSource;
  appCommit?: string | null;
  deviceInfo?: Prisma.InputJsonValue;
  logSummary?: string | null;
  fingerprint?: string | null;
}

const TRACKED_FIELDS = [
  'title',
  'description',
  'steps',
  'expected',
  'actual',
  'severity',
  'priority',
  'frequency',
  'bugType',
  'rootCause',
  'resolution',
  'moduleId',
  'ownerIds',
  'ccIds',
  'versionFoundId',
  'versionFixedId',
  'dueAt',
  'customFields',
] as const;

@Injectable()
export class DefectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    ctx: ProjectContext,
    actor: Actor,
    input: CreateDefectInput,
    via: Via,
    extras: SystemDefectExtras = {
      source: via === 'system' ? 'app' : via === 'api' ? 'api' : 'web',
    },
  ): Promise<Defect> {
    if (actor.kind === 'user' && !hasPermission(actor.role, 'defect.create')) {
      throw new ForbiddenException('没有权限创建缺陷');
    }
    const { project, workflow } = ctx;
    const initial = findState(workflow, workflow.initialState);
    if (!initial) throw new BadRequestException('项目工作流缺少初始状态');

    const ownerIds = input.ownerIds?.length
      ? input.ownerIds
      : await this.defaultOwners(project.id, input.moduleId, project.defaultOwnerId);

    const created = await this.prisma.$transaction(async (tx) => {
      const { defectSeq } = await tx.project.update({
        where: { id: project.id },
        data: { defectSeq: { increment: 1 } },
        select: { defectSeq: true },
      });
      const reporterId = actorId(actor);
      const defect = await tx.defect.create({
        data: {
          projectId: project.id,
          seq: defectSeq,
          code: `${project.key}-${defectSeq}`,
          title: input.title,
          description: input.description,
          steps: input.steps,
          expected: input.expected,
          actual: input.actual,
          severity: input.severity,
          priority: input.priority,
          frequency: input.frequency,
          bugType: input.bugType,
          moduleId: input.moduleId,
          ownerIds,
          ccIds: input.ccIds ?? [],
          versionFoundId: input.versionFoundId,
          dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
          customFields: (input.customFields ?? {}) as Prisma.InputJsonValue,
          status: initial.key,
          statusCategory: initial.category,
          reporterId,
          verifierId: reporterId,
          source: extras.source,
          appCommit: extras.appCommit,
          deviceInfo: extras.deviceInfo,
          logSummary: extras.logSummary,
          fingerprint: extras.fingerprint,
        },
      });
      await tx.defectHistory.create({
        data: {
          defectId: defect.id,
          field: 'created',
          newValue: defect.code,
          operatorId: reporterId,
          via,
        },
      });
      return defect;
    });
    await this.notifyChange(ctx, actor, null, created);
    return created;
  }

  async list(ctx: ProjectContext, user: AuthUser, q: ListQuery) {
    const where: Prisma.DefectWhereInput = { projectId: ctx.project.id, deletedAt: null };
    if (q.status?.length) where.status = { in: q.status };
    if (q.statusCategory?.length) where.statusCategory = { in: q.statusCategory };
    if (q.severity?.length) where.severity = { in: q.severity };
    if (q.priority?.length) where.priority = { in: q.priority };
    if (q.source?.length) where.source = { in: q.source };
    if (q.owner) where.ownerIds = { has: q.owner === 'me' ? user.id : q.owner };
    if (q.reporter) where.reporterId = q.reporter === 'me' ? user.id : q.reporter;
    if (q.moduleId) where.moduleId = q.moduleId;
    if (q.createdFrom || q.createdTo) {
      where.createdAt = {
        ...(q.createdFrom ? { gte: new Date(q.createdFrom) } : {}),
        ...(q.createdTo ? { lte: new Date(q.createdTo) } : {}),
      };
    }
    if (q.keyword) {
      where.OR = [
        { code: { equals: q.keyword.toUpperCase() } },
        { title: { contains: q.keyword, mode: 'insensitive' } },
        { description: { contains: q.keyword, mode: 'insensitive' } },
        { logSummary: { contains: q.keyword, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.defect.findMany({
        where,
        orderBy: [{ [q.sort]: q.order }, { seq: 'desc' }],
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
        },
      }),
      this.prisma.defect.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async detail(ctx: ProjectContext, code: string) {
    const defect = await this.prisma.defect.findFirst({
      where: { projectId: ctx.project.id, code, deletedAt: null },
      include: {
        attachments: { orderBy: { createdAt: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' } },
        history: { orderBy: { createdAt: 'desc' }, take: 200 },
        links: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!defect) throw new NotFoundException(`缺陷 ${code} 不存在`);
    return {
      ...defect,
      transitions: availableTransitions(ctx.workflow, defect.status, ctx.role),
      fixCommand: `/fix-bug ${defect.code}`,
    };
  }

  async findByCode(projectId: string, code: string): Promise<Defect> {
    const defect = await this.prisma.defect.findFirst({
      where: { projectId, code, deletedAt: null },
    });
    if (!defect) throw new NotFoundException(`缺陷 ${code} 不存在`);
    return defect;
  }

  async update(
    ctx: ProjectContext,
    actor: Actor,
    code: string,
    patch: UpdateDefectInput,
    via: Via,
  ) {
    const defect = await this.findByCode(ctx.project.id, code);
    if (actor.kind === 'user') {
      if (!hasPermission(actor.role, 'defect.edit'))
        throw new ForbiddenException('没有权限编辑缺陷');
      // 开发只能编辑处理中的缺陷（方案 6.8）
      if (actor.role === 'developer' && defect.statusCategory !== 'doing') {
        throw new ForbiddenException('开发只能编辑处理中的缺陷');
      }
    }
    const data: Prisma.DefectUpdateInput = {
      ...patch,
      dueAt:
        patch.dueAt === undefined ? undefined : patch.dueAt === null ? null : new Date(patch.dueAt),
      customFields: patch.customFields as Prisma.InputJsonValue | undefined,
    };
    const updated = await this.applyChanges(defect, data, actorId(actor), via);
    await this.notifyChange(ctx, actor, defect, updated);
    return updated;
  }

  async transition(
    ctx: ProjectContext,
    actor: Actor,
    code: string,
    input: TransitionInput,
    via: Via,
  ) {
    const defect = await this.findByCode(ctx.project.id, code);
    const merged: Record<string, unknown> = { ...defect, ...input.values };
    const check = checkTransition(ctx.workflow, {
      transitionKey: input.transition,
      currentState: defect.status,
      actor: actor.kind === 'system' ? 'system' : actor.role,
      values: merged,
      comment: input.comment,
    });
    if (!check.ok) {
      switch (check.reason) {
        case 'not_found':
          throw new BadRequestException(`未知的流转：${input.transition}`);
        case 'wrong_state':
          throw new ConflictException('缺陷当前状态不允许该流转，请刷新后重试');
        case 'forbidden':
          throw new ForbiddenException('你的角色不能执行该流转');
        case 'missing_fields':
          throw new BadRequestException({ message: '缺少流转必填字段', missing: check.missing });
        case 'missing_comment':
          throw new BadRequestException('该流转需要填写说明');
      }
    }
    const t = check.transition;
    const target = findState(ctx.workflow, t.to);
    if (!target) throw new BadRequestException(`工作流缺少状态 ${t.to}`);

    const now = new Date();
    const data: Prisma.DefectUpdateInput = {
      ...input.values,
      status: t.to,
      statusCategory: target.category,
    };
    if (
      !defect.confirmedAt &&
      defect.status === ctx.workflow.initialState &&
      target.category !== 'done'
    ) {
      data.confirmedAt = now;
    }
    if (target.category === 'doing' && !defect.startedAt) data.startedAt = now;
    if (target.category === 'verifying' && !defect.resolvedAt) data.resolvedAt = now;
    data.closedAt = target.category === 'done' ? now : null;
    Object.assign(data, await this.runActions(t, defect, merged, actor, ctx));

    const updated = await this.applyChanges(defect, data, actorId(actor), via, {
      field: 'status',
      oldValue: defect.status,
      newValue: t.to,
    });
    if (input.comment?.trim()) {
      await this.prisma.comment.create({
        data: {
          defectId: defect.id,
          authorId: actorId(actor),
          via,
          body: `【${t.label}】${input.comment.trim()}`,
        },
      });
    }
    await this.notifyChange(ctx, actor, defect, updated, { comment: input.comment });
    return updated;
  }

  async addComment(ctx: ProjectContext, actor: Actor, code: string, body: string, via: Via) {
    if (actor.kind === 'user' && !hasPermission(actor.role, 'comment.create')) {
      throw new ForbiddenException('没有权限评论');
    }
    const defect = await this.findByCode(ctx.project.id, code);
    const comment = await this.prisma.comment.create({
      data: { defectId: defect.id, authorId: actorId(actor), via, body },
    });
    await this.notifyChange(ctx, actor, defect, defect, { comment: body });
    return comment;
  }

  async addLink(ctx: ProjectContext, actor: Actor, code: string, link: LinkInput, via: Via) {
    if (actor.kind === 'user' && !hasPermission(actor.role, 'defect.edit')) {
      throw new ForbiddenException('没有权限关联提交');
    }
    const defect = await this.findByCode(ctx.project.id, code);
    const saved = await this.prisma.defectLink.upsert({
      where: {
        defectId_kind_target: { defectId: defect.id, kind: link.kind, target: link.target },
      },
      create: { defectId: defect.id, ...link },
      update: { state: link.state },
    });
    await this.prisma.defectHistory.create({
      data: {
        defectId: defect.id,
        field: `link.${link.kind}`,
        newValue: link.target,
        operatorId: actorId(actor),
        via,
      },
    });
    return saved;
  }

  async softDelete(ctx: ProjectContext, user: AuthUser, code: string): Promise<void> {
    if (!hasPermission(ctx.role, 'defect.delete'))
      throw new ForbiddenException('只有项目管理员可以删除缺陷');
    const defect = await this.findByCode(ctx.project.id, code);
    await this.applyChanges(defect, { deletedAt: new Date() }, user.id, 'web', {
      field: 'deleted',
      oldValue: null,
      newValue: true,
    });
  }

  /**
   * 站内通知（方案 6.4）：新增的处理人收到“指派给我”，评论或流转说明里 @ 到的成员收到“@ 我”，
   * 状态变化时通知创建人、验证人、前后处理人与抄送人。同一人一次操作只收一条，按上述顺序优先。
   */
  private async notifyChange(
    ctx: ProjectContext,
    actor: Actor,
    before: Defect | null,
    after: Defect,
    opts: { comment?: string } = {},
  ): Promise<void> {
    const name = actorName(actor);
    const inputs: NotifyInput[] = [];
    const previousOwners = new Set(before?.ownerIds ?? []);
    const assigned = after.ownerIds.filter((id) => !previousOwners.has(id));
    if (assigned.length) {
      inputs.push({
        kind: 'assigned',
        userIds: assigned,
        title: `${name} 把 ${after.code} 指派给了你`,
      });
    }
    const comment = opts.comment?.trim();
    if (comment) {
      inputs.push({
        kind: 'mentioned',
        userIds: await this.notifications.mentionedMembers(after.projectId, comment),
        title: `${name} 在 ${after.code} 中提到了你`,
        body: comment.length > 200 ? `${comment.slice(0, 200)}…` : comment,
      });
    }
    if (before && before.status !== after.status) {
      const from = findState(ctx.workflow, before.status)?.name ?? before.status;
      const to = findState(ctx.workflow, after.status)?.name ?? after.status;
      inputs.push({
        kind: 'status_changed',
        userIds: [
          after.reporterId,
          after.verifierId,
          ...before.ownerIds,
          ...after.ownerIds,
          ...after.ccIds,
        ],
        title: `${name} 把 ${after.code} 从“${from}”改为“${to}”`,
      });
    }
    if (inputs.length) await this.notifications.send(after, actorId(actor), inputs);
  }

  /** 写入变更并逐字段记录历史（方案 6.2 defect_history）。 */
  private async applyChanges(
    defect: Defect,
    data: Prisma.DefectUpdateInput,
    operatorId: string | null,
    via: Via,
    extra?: { field: string; oldValue: unknown; newValue: unknown },
  ): Promise<Defect> {
    const history: Prisma.DefectHistoryCreateManyInput[] = [];
    for (const field of TRACKED_FIELDS) {
      if (!(field in data) || data[field as keyof typeof data] === undefined) continue;
      const before = defect[field];
      const after = data[field as keyof typeof data];
      if (JSON.stringify(normalize(before)) === JSON.stringify(normalize(after))) continue;
      history.push({
        defectId: defect.id,
        field,
        oldValue: toJson(before),
        newValue: toJson(after),
        operatorId,
        via,
      });
    }
    if (extra) {
      history.push({
        defectId: defect.id,
        field: extra.field,
        oldValue: toJson(extra.oldValue),
        newValue: toJson(extra.newValue),
        operatorId,
        via,
      });
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.defect.update({ where: { id: defect.id }, data }),
      this.prisma.defectHistory.createMany({ data: history }),
    ]);
    return updated;
  }

  private async runActions(
    t: WorkflowTransition,
    defect: Defect,
    merged: Record<string, unknown>,
    actor: Actor,
    ctx: ProjectContext,
  ): Promise<Prisma.DefectUpdateInput> {
    const data: Prisma.DefectUpdateInput = {};
    for (const action of t.actions ?? []) {
      switch (action) {
        case 'auto_assign': {
          const owners = await this.defaultOwners(
            ctx.project.id,
            (merged.moduleId as string | null) ?? null,
            ctx.project.defaultOwnerId,
          );
          if (owners.length) data.ownerIds = owners;
          break;
        }
        case 'record_developer':
          if (actor.kind === 'user') {
            data.developerId = actor.user.id;
            if (defect.ownerIds.length === 0) data.ownerIds = [actor.user.id];
          }
          break;
        case 'assign_to_verifier': {
          const verifier = defect.verifierId ?? defect.reporterId;
          if (verifier) data.ownerIds = [verifier];
          break;
        }
        case 'assign_back_to_developer':
          if (defect.developerId) data.ownerIds = [defect.developerId];
          break;
        case 'increment_reopen':
          data.reopenCount = { increment: 1 };
          break;
      }
    }
    return data;
  }

  /** 自动指派：模块负责人（子模块未配置时继承父模块）→ 项目默认处理人（方案 6.7） */
  private async defaultOwners(
    projectId: string,
    moduleId: string | null | undefined,
    projectDefault: string | null,
  ): Promise<string[]> {
    let current = moduleId;
    for (let depth = 0; current && depth < 10; depth++) {
      const mod = await this.prisma.module.findFirst({ where: { id: current, projectId } });
      if (!mod) break;
      if (mod.ownerId) return [mod.ownerId];
      current = mod.parentId;
    }
    return projectDefault ? [projectDefault] : [];
  }
}

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toISOString();
  return v ?? null;
}

function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const n = normalize(v);
  return n === null ? Prisma.JsonNull : (n as Prisma.InputJsonValue);
}
