import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  hasPermission,
  type Permission,
  type ProjectRole,
  type WorkflowDefinition,
} from '@defect/shared';
import type { AuthUser } from '../common/auth-user';
import type { Project } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ProjectContext {
  project: Project;
  workflow: WorkflowDefinition;
  role: ProjectRole;
}

/** 解析“当前用户在某项目中的角色”，所有项目内接口都先经过这里。 */
@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(projectKey: string, user: AuthUser): Promise<ProjectContext> {
    const project = await this.prisma.project.findUnique({ where: { key: projectKey } });
    if (!project) throw new NotFoundException('项目不存在');
    let role: ProjectRole | undefined;
    if (user.isSystemAdmin) {
      role = 'admin';
    } else {
      const member = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: project.id, userId: user.id } },
      });
      role = member?.role;
    }
    // 非成员与不存在一样返回 404，避免泄露项目是否存在
    if (!role) throw new NotFoundException('项目不存在');
    return { project, workflow: project.workflow as unknown as WorkflowDefinition, role };
  }

  async require(
    projectKey: string,
    user: AuthUser,
    permission: Permission,
  ): Promise<ProjectContext> {
    const ctx = await this.resolve(projectKey, user);
    if (!hasPermission(ctx.role, permission)) throw new ForbiddenException('没有权限执行该操作');
    return ctx;
  }
}
