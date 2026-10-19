import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hasPermission } from '@defect/shared';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../projects/project-access.service';

/** 视图保存的是列表页的查询状态，结构由前端维护，这里只限制大小 */
export const viewSchema = z.object({
  name: z.string().trim().min(1).max(30),
  shared: z.boolean().default(false),
  query: z
    .record(z.string(), z.unknown())
    .refine((q) => JSON.stringify(q).length <= 10_000, '视图条件过长'),
});
export const viewUpdateSchema = viewSchema.partial();
export type ViewInput = z.infer<typeof viewSchema>;

/**
 * 自定义视图（方案 6.6）：个人视图只有自己可见；公开视图全项目可见，
 * 发布、修改、删除公开视图需要 view.publish 权限（项目管理员、产品）。
 */
@Injectable()
export class ViewsService {
  constructor(private readonly prisma: PrismaService) {}

  list(ctx: ProjectContext, user: AuthUser) {
    return this.prisma.savedView.findMany({
      where: { projectId: ctx.project.id, OR: [{ shared: true }, { ownerId: user.id }] },
      orderBy: [{ shared: 'desc' }, { createdAt: 'asc' }],
    });
  }

  create(ctx: ProjectContext, user: AuthUser, input: ViewInput) {
    if (input.shared) this.requirePublish(ctx);
    return this.prisma.savedView.create({
      data: {
        projectId: ctx.project.id,
        ownerId: user.id,
        name: input.name,
        shared: input.shared,
        query: input.query as Prisma.InputJsonValue,
      },
    });
  }

  async update(ctx: ProjectContext, user: AuthUser, id: string, patch: Partial<ViewInput>) {
    const view = await this.findEditable(ctx, user, id);
    if (patch.shared && !view.shared) this.requirePublish(ctx);
    return this.prisma.savedView.update({
      where: { id: view.id },
      data: {
        name: patch.name,
        shared: patch.shared,
        query: patch.query as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async remove(ctx: ProjectContext, user: AuthUser, id: string): Promise<void> {
    const view = await this.findEditable(ctx, user, id);
    await this.prisma.savedView.delete({ where: { id: view.id } });
  }

  /** 自己的视图可改；公开视图有发布权限的人也可改 */
  private async findEditable(ctx: ProjectContext, user: AuthUser, id: string) {
    const view = await this.prisma.savedView.findFirst({
      where: { id, projectId: ctx.project.id },
    });
    if (!view || (!view.shared && view.ownerId !== user.id)) {
      throw new NotFoundException('视图不存在');
    }
    if (view.ownerId !== user.id) this.requirePublish(ctx);
    return view;
  }

  private requirePublish(ctx: ProjectContext): void {
    if (!hasPermission(ctx.role, 'view.publish')) {
      throw new ForbiddenException('只有项目管理员和产品可以发布公开视图');
    }
  }
}
