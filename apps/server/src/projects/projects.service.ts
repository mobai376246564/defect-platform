import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_WORKFLOW,
  defaultRoleForPosition,
  stateRank,
  validateWorkflow,
  type WorkflowDefinition,
} from '@defect/shared';
import { API_PREFIX } from '../bootstrap';
import type { AuthUser } from '../common/auth-user';
import { APP_ENV, type AppEnv } from '../config/env';
import type { Prisma, ProjectRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAccessService } from './project-access.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async listForUser(user: AuthUser) {
    const where: Prisma.ProjectWhereInput = user.isSystemAdmin
      ? {}
      : { members: { some: { userId: user.id } } };
    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { members: { where: { userId: user.id }, select: { role: true } } },
    });
    const openCounts = await this.prisma.defect.groupBy({
      by: ['projectId'],
      where: {
        projectId: { in: projects.map((p) => p.id) },
        statusCategory: { not: 'done' },
        deletedAt: null,
      },
      _count: { _all: true },
    });
    const countMap = new Map(openCounts.map((c) => [c.projectId, c._count._all]));
    const [totals, memberCounts] = await Promise.all([
      this.prisma.defect.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projects.map((p) => p.id) }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.projectMember.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projects.map((p) => p.id) } },
        _count: { _all: true },
      }),
    ]);
    const totalMap = new Map(totals.map((c) => [c.projectId, c._count._all]));
    const memberMap = new Map(memberCounts.map((c) => [c.projectId, c._count._all]));
    return projects.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      appIds: p.appIds,
      createdAt: p.createdAt,
      role: user.isSystemAdmin ? 'admin' : p.members[0]?.role,
      openDefects: countMap.get(p.id) ?? 0,
      totalDefects: totalMap.get(p.id) ?? 0,
      memberCount: memberMap.get(p.id) ?? 0,
    }));
  }

  /**
   * 删除项目（仅系统管理员）：连同缺陷、附件记录、评论、历史、成员、模块、版本、视图一起删除，
   * 需要传入项目标识二次确认。对象存储里的附件文件不立即删除，由存储桶生命周期规则清理。
   */
  async remove(projectKey: string, user: AuthUser, confirmKey: string | undefined): Promise<void> {
    if (!user.isSystemAdmin) throw new ForbiddenException('只有系统管理员可以删除项目');
    const project = await this.prisma.project.findUnique({ where: { key: projectKey } });
    if (!project) throw new NotFoundException('项目不存在');
    if (confirmKey !== project.key) {
      throw new BadRequestException('请输入项目标识确认删除');
    }
    await this.prisma.$transaction([
      // 这两张表没有外键约束，需要手动清理
      this.prisma.notification.deleteMany({ where: { projectId: project.id } }),
      this.prisma.defectDailySnapshot.deleteMany({ where: { projectId: project.id } }),
      this.prisma.project.delete({ where: { id: project.id } }),
    ]);
  }

  async create(
    user: AuthUser,
    input: { key: string; name: string; description?: string; appIds?: string[] },
  ) {
    if (!user.isSystemAdmin) throw new ForbiddenException('只有系统管理员可以创建项目');
    const exists = await this.prisma.project.findUnique({ where: { key: input.key } });
    if (exists) throw new ConflictException(`项目标识 ${input.key} 已存在`);
    return this.prisma.project.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description ?? '',
        appIds: input.appIds ?? [],
        workflow: DEFAULT_WORKFLOW as unknown as Prisma.InputJsonValue,
        members: { create: { userId: user.id, role: 'admin' } },
      },
    });
  }

  async detail(projectKey: string, user: AuthUser) {
    const { project, role, workflow } = await this.access.resolve(projectKey, user);
    const [modules, versions, members] = await Promise.all([
      this.prisma.module.findMany({ where: { projectId: project.id }, orderBy: { name: 'asc' } }),
      this.prisma.version.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.projectMember.findMany({
        where: { projectId: project.id },
        include: {
          user: { select: { id: true, username: true, name: true, email: true, position: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      id: project.id,
      key: project.key,
      name: project.name,
      description: project.description,
      appIds: project.appIds,
      repoUrl: project.repoUrl,
      defaultOwnerId: project.defaultOwnerId,
      fixVersionId: project.fixVersionId,
      hiddenFields: project.hiddenFields,
      myRole: role,
      workflow,
      modules,
      versions,
      members: members.map((m) => ({ ...m.user, role: m.role })),
      // Webhook 地址与密钥状态只给项目管理员看
      webhook:
        role === 'admin'
          ? { url: this.webhookUrl(project.key), secretConfigured: !!project.webhookSecret }
          : null,
    };
  }

  /** 生成或重置 Git Webhook 密钥（方案 7.7），明文只在本次响应中返回 */
  async resetWebhookSecret(projectKey: string, user: AuthUser) {
    const { project } = await this.access.require(projectKey, user, 'project.configure');
    const secret = randomBytes(32).toString('hex');
    await this.prisma.project.update({
      where: { id: project.id },
      data: { webhookSecret: secret },
    });
    return { url: this.webhookUrl(project.key), secret };
  }

  private webhookUrl(projectKey: string): string {
    const base = this.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
    return `${base}/${API_PREFIX}/webhooks/git/${projectKey}`;
  }

  async update(
    projectKey: string,
    user: AuthUser,
    patch: {
      name?: string;
      description?: string;
      appIds?: string[];
      repoUrl?: string | null;
      defaultOwnerId?: string | null;
      fixVersionId?: string | null;
      hiddenFields?: string[];
    },
  ) {
    const { project } = await this.access.require(projectKey, user, 'project.configure');
    if (patch.fixVersionId) {
      const version = await this.prisma.version.findFirst({
        where: { id: patch.fixVersionId, projectId: project.id },
      });
      if (!version) throw new BadRequestException('当前迭代版本必须是本项目的版本');
    }
    return this.prisma.project.update({
      where: { id: project.id },
      data: patch,
      omit: { webhookSecret: true },
    });
  }

  /**
   * 保存工作流（缺陷状态）。删除的状态上如果还有缺陷，必须在 remap 里指定迁移到哪个状态（方案 6.7），
   * 迁移会写入变更历史；状态类别改了也同步到缺陷的冗余字段。保存后立即对所有人生效。
   */
  async updateWorkflow(
    projectKey: string,
    user: AuthUser,
    workflow: WorkflowDefinition,
    remap: Record<string, string> = {},
  ) {
    const { project } = await this.access.require(projectKey, user, 'project.configure');
    const errors = validateWorkflow(workflow);
    if (errors.length > 0)
      throw new BadRequestException({ message: '工作流配置有误', issues: errors });
    const states = new Map(workflow.states.map((s) => [s.key, s]));
    const orphans = await this.prisma.defect.groupBy({
      by: ['status'],
      where: { projectId: project.id, status: { notIn: [...states.keys()] }, deletedAt: null },
      _count: { _all: true },
    });
    const unmapped = orphans.filter((o) => !states.has(remap[o.status] ?? ''));
    if (unmapped.length > 0) {
      throw new BadRequestException({
        message: '还有缺陷处于被删除的状态，请选择迁移到哪个状态',
        orphans: orphans.map((o) => ({ status: o.status, count: o._count._all })),
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: project.id },
        data: { workflow: workflow as unknown as Prisma.InputJsonValue },
      });
      // 被删除状态下的缺陷迁移到指定状态：直接在数据库里写历史、改状态，不把成千上万个 id 拉到内存里拼 IN
      const now = new Date();
      for (const o of orphans) {
        const target = states.get(remap[o.status]!)!;
        await tx.$executeRaw`
          INSERT INTO "DefectHistory" (id, "defectId", field, "oldValue", "newValue", "operatorId", via, "createdAt")
          SELECT gen_random_uuid(), id, 'status', to_jsonb(${o.status}::text), to_jsonb(${target.key}::text),
                 ${user.id}::uuid, 'web', ${now}
          FROM "Defect"
          WHERE "projectId" = ${project.id}::uuid AND status = ${o.status} AND "deletedAt" IS NULL`;
        await tx.$executeRaw`
          UPDATE "Defect"
          SET status = ${target.key}, "statusCategory" = ${target.category},
              "statusRank" = ${stateRank(workflow, target.key)}, "updatedAt" = ${now}
          WHERE "projectId" = ${project.id}::uuid AND status = ${o.status} AND "deletedAt" IS NULL`;
      }
      // 状态类别、顺序可能被修改，同步冗余字段：只改确实变化的行，也不刷新“更新时间”
      // （这不是对缺陷本身的修改，否则保存一次工作流，所有缺陷都会排到“最近更新”最前面）
      for (const s of workflow.states) {
        const rank = stateRank(workflow, s.key);
        await tx.$executeRaw`
          UPDATE "Defect" SET "statusCategory" = ${s.category}, "statusRank" = ${rank}
          WHERE "projectId" = ${project.id}::uuid AND status = ${s.key}
            AND ("statusCategory" <> ${s.category} OR "statusRank" <> ${rank})`;
      }
    });
    return workflow;
  }

  /** 按账号或邮箱添加成员；未指定角色时新成员按职位取默认角色，已有成员保持原角色。 */
  async addMember(projectKey: string, user: AuthUser, account: string, role?: ProjectRole) {
    const { project } = await this.access.require(projectKey, user, 'project.members');
    const key = account.trim().toLowerCase();
    const target = await this.prisma.user.findFirst({
      where: { OR: [{ username: key }, { email: key }] },
    });
    if (!target) throw new NotFoundException(`用户 ${account} 不存在，请先注册或由系统管理员创建`);
    if (target.status !== 'active' || target.disabledAt) {
      throw new BadRequestException(`用户 ${account} 尚未通过审核或已被禁用`);
    }
    return this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: target.id } },
      create: {
        projectId: project.id,
        userId: target.id,
        role: role ?? defaultRoleForPosition(target.position),
      },
      update: role ? { role } : {},
    });
  }

  async removeMember(projectKey: string, user: AuthUser, userId: string): Promise<void> {
    const { project } = await this.access.require(projectKey, user, 'project.members');
    await this.prisma.projectMember.deleteMany({ where: { projectId: project.id, userId } });
  }

  async addModule(
    projectKey: string,
    user: AuthUser,
    input: { name: string; parentId?: string | null; ownerId?: string | null },
  ) {
    const { project } = await this.access.require(projectKey, user, 'project.configure');
    return this.prisma.module.create({ data: { projectId: project.id, ...input } });
  }

  async updateModule(
    projectKey: string,
    user: AuthUser,
    id: string,
    patch: { name?: string; ownerId?: string | null },
  ) {
    const { project } = await this.access.require(projectKey, user, 'project.configure');
    const { count } = await this.prisma.module.updateMany({
      where: { id, projectId: project.id },
      data: patch,
    });
    if (count === 0) throw new NotFoundException('模块不存在');
  }

  async addVersion(
    projectKey: string,
    user: AuthUser,
    input: { name: string; build?: string; commit?: string },
  ) {
    const { project } = await this.access.require(projectKey, user, 'project.configure');
    return this.prisma.version.create({ data: { projectId: project.id, ...input } });
  }
}
