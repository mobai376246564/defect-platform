import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { NotificationKind } from '@defect/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { extractMentions } from './mentions';

/** 产生通知的缺陷（只用到这几个字段） */
export interface NotifyDefect {
  id: string;
  projectId: string;
  code: string;
  title: string;
}

export interface NotifyInput {
  kind: NotificationKind;
  userIds: Iterable<string | null | undefined>;
  title: string;
  body?: string;
}

/**
 * 站内通知（方案 6.4 通知中心）。
 * 由 DefectsService 在指派、@、状态变更后调用；通知写失败只记日志，不影响业务操作本身。
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 批量发送一次操作产生的通知：不通知操作者本人；同一个人在一次操作里只收一条，
   * 按传入顺序优先（例如先“指派给我”，就不再重复发“状态变更”）。
   */
  async send(defect: NotifyDefect, actorId: string | null, inputs: NotifyInput[]): Promise<void> {
    const seen = new Set<string>(actorId ? [actorId] : []);
    const rows: Prisma.NotificationCreateManyInput[] = [];
    for (const input of inputs) {
      for (const userId of input.userIds) {
        if (!userId || seen.has(userId)) continue;
        seen.add(userId);
        rows.push({
          userId,
          projectId: defect.projectId,
          defectId: defect.id,
          defectCode: defect.code,
          kind: input.kind,
          title: input.title,
          body: input.body ?? defect.title,
          actorId,
        });
      }
    }
    if (rows.length === 0) return;
    try {
      // 停用的用户不再接收通知
      const active = await this.prisma.user.findMany({
        where: { id: { in: rows.map((r) => r.userId) }, disabledAt: null },
        select: { id: true },
      });
      const ids = new Set(active.map((u) => u.id));
      await this.prisma.notification.createMany({ data: rows.filter((r) => ids.has(r.userId)) });
    } catch (err) {
      this.logger.warn(`缺陷 ${defect.code} 的通知写入失败：${(err as Error).message}`);
    }
  }

  /** 正文中 @ 到的项目成员 id。 */
  async mentionedMembers(projectId: string, body: string): Promise<string[]> {
    if (!body.includes('@')) return [];
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: { user: { select: { id: true, name: true, username: true, email: true } } },
    });
    return extractMentions(
      body,
      members.map((m) => m.user),
    );
  }

  async list(userId: string, q: { unread: boolean; page: number; pageSize: number }) {
    const where: Prisma.NotificationWhereInput = { userId, ...(q.unread ? { readAt: null } : {}) };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    // 带上项目标识与触发人姓名，前端直接拼跳转链接与展示
    const [projects, actors] = await Promise.all([
      this.prisma.project.findMany({
        where: { id: { in: [...new Set(items.map((n) => n.projectId))] } },
        select: { id: true, key: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(items.flatMap((n) => (n.actorId ? [n.actorId] : [])))] } },
        select: { id: true, name: true },
      }),
    ]);
    const projectOf = new Map(projects.map((p) => [p.id, p]));
    const actorOf = new Map(actors.map((u) => [u.id, u.name]));
    return {
      items: items.map((n) => ({
        ...n,
        projectKey: projectOf.get(n.projectId)?.key ?? null,
        projectName: projectOf.get(n.projectId)?.name ?? null,
        actorName: n.actorId ? (actorOf.get(n.actorId) ?? null) : null,
      })),
      total,
      unread,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    // 别人的通知与不存在一样返回 404
    if (count === 0) throw new NotFoundException('通知不存在');
  }

  async markAllRead(userId: string): Promise<number> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }
}
