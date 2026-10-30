import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
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
import { APP_KEYWORD_MIN_LENGTH } from '../ingest/app-binding';
import { PrismaService } from '../prisma/prisma.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.types';
import { ProjectAccessService } from './project-access.service';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
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
   * 删除项目（仅系统管理员，需传入项目标识二次确认）：连同缺陷、附件、评论、历史、成员、模块、版本、视图，
   * 以及通知、每日快照、MCP 调用记录、APP 提单记录一起删除；数据提交后再删对象存储里的附件、
   * 缩略图、关键帧与没建成单的提交文件。删文件失败只记日志（数据已删，残留文件不影响使用）。
   */
  async remove(projectKey: string, user: AuthUser, confirmKey: string | undefined): Promise<void> {
    if (!user.isSystemAdmin) throw new ForbiddenException('只有系统管理员可以删除项目');
    const project = await this.prisma.project.findUnique({ where: { key: projectKey } });
    if (!project) throw new NotFoundException('项目不存在');
    if (confirmKey !== project.key) {
      throw new BadRequestException('请输入项目标识确认删除');
    }
    const inProject = { defect: { projectId: project.id } };
    const [attachments, frames, unlinkedReports] = await Promise.all([
      this.prisma.attachment.findMany({ where: inProject, select: { id: true, storageKey: true } }),
      this.prisma.videoFrame.findMany({
        where: { attachment: inProject },
        select: { storageKey: true },
      }),
      this.prisma.feedbackReport.findMany({
        where: { projectId: project.id, defectId: null },
        select: { storagePrefix: true },
      }),
    ]);
    await this.prisma.$transaction(async (tx) => {
      const defectIds = (
        await tx.defect.findMany({ where: { projectId: project.id }, select: { id: true } })
      ).map((d) => d.id);
      // 这几张表没有外键约束，需要手动清理
      await tx.notification.deleteMany({ where: { projectId: project.id } });
      await tx.defectDailySnapshot.deleteMany({ where: { projectId: project.id } });
      await tx.mcpAudit.deleteMany({ where: { projectId: project.id } });
      // 匹配到本项目的 APP 提交记录，以及建到本项目缺陷上的
      await tx.feedbackReport.deleteMany({
        where: { OR: [{ projectId: project.id }, { defectId: { in: defectIds } }] },
      });
      await tx.project.delete({ where: { id: project.id } });
    });

    const keys = [
      ...attachments.flatMap((a) => [a.storageKey, `derived/thumbs/${a.id}.webp`]),
      ...frames.map((f) => f.storageKey),
    ];
    try {
      for (const r of unlinkedReports) keys.push(...(await this.storage.listKeys(r.storagePrefix)));
      await this.storage.deleteObjects(keys);
    } catch (err) {
      this.logger.warn(`项目 ${project.key} 已删除，清理存储文件失败：${(err as Error).message}`);
    }
  }

  async create(
    user: AuthUser,
    input: { key: string; name: string; description?: string; appIds?: string[] },
  ) {
    if (!user.isSystemAdmin) throw new ForbiddenException('只有系统管理员可以创建项目');
    const exists = await this.prisma.project.findUnique({ where: { key: input.key } });
    if (exists) throw new ConflictException(`项目标识 ${input.key} 已存在`);
    const appIds = await this.checkAppIds(input.appIds ?? [], null);
    return this.prisma.project.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description ?? '',
        appIds,
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
    if (patch.appIds) patch.appIds = await this.checkAppIds(patch.appIds, project.id);
    return this.prisma.project.update({
      where: { id: project.id },
      data: patch,
      omit: { webhookSecret: true },
    });
  }

  /**
   * 绑定的 APP 标识（完整包名或关键字，匹配规则见 matchAppBinding）去空格、不区分大小写去重；
   * 同一个标识只能绑定一个项目，否则平台不知道该把提单建到哪个项目。
   */
  private async checkAppIds(appIds: string[], projectId: string | null): Promise<string[]> {
    const ids: string[] = [];
    for (const a of appIds.map((x) => x.trim()).filter(Boolean)) {
      if (a.length < APP_KEYWORD_MIN_LENGTH) {
        throw new BadRequestException(
          `APP 标识「${a}」太短，至少 ${APP_KEYWORD_MIN_LENGTH} 个字符，避免误匹配其他 APP`,
        );
      }
      if (!ids.some((x) => x.toLowerCase() === a.toLowerCase())) ids.push(a);
    }
    if (ids.length === 0) return ids;
    const others = await this.prisma.project.findMany({
      where: {
        NOT: { appIds: { isEmpty: true } },
        ...(projectId ? { id: { not: projectId } } : {}),
      },
      select: { name: true, appIds: true },
    });
    for (const other of others) {
      const taken = new Set(other.appIds.map((x) => x.toLowerCase()));
      const dup = ids.filter((a) => taken.has(a.toLowerCase()));
      if (dup.length) {
        throw new ConflictException(
          `APP 标识 ${dup.join('、')} 已绑定到项目「${other.name}」，一个标识只能绑定一个项目`,
        );
      }
    }
    return ids;
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
