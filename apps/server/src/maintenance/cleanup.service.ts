import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { reportDate } from '@defect/shared';
import { APP_ENV, type AppEnv } from '../config/env';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, dayStart } from '../reports/report-math';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.types';

export const CLEANUP_JOB = 'maintenance.daily-cleanup';

/** 凌晨 03:30（北京时间）执行，避开白天使用高峰 */
const RUN_AFTER_MIDNIGHT_MS = 3.5 * 3600_000;
const DAY_MS = 86_400_000;

/** 保留期。缺陷（包括已删除的）及其附件永久保留，不在清理范围内 */
export const RETENTION = {
  /** 申请了上传地址却一直没有登记成附件的文件（上传到一半放弃、关掉页面等） */
  orphanUploadHours: 24,
  /** 已完成 / 已失败的后台任务记录 */
  finishedJobDays: 30,
  /** 已读通知 */
  readNotificationDays: 90,
};

/** 单次最多检查的上传文件数，避免一次清理占用太久；剩下的第二天继续 */
const ORPHAN_SCAN_LIMIT = 5000;

export interface CleanupResult {
  orphanUploads: number;
  jobs: number;
  notifications: number;
}

/**
 * 每日清理（磁盘与表只增不删的问题）：
 * - web/ 下超过 24 小时仍未登记为附件的上传文件（含中断上传留下的临时文件）；
 * - 30 天前已结束的后台任务、90 天前的已读通知。
 * 缺陷及其附件永久保留。与每日快照一样用任务队列的 runAt 定时、dedupeKey 按日期去重。
 */
@Injectable()
export class CleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {
    this.jobs.register(CLEANUP_JOB, async (payload) => {
      const date = String(payload.date);
      await this.schedule(addDays(date, 1));
      const result = await this.run();
      this.logger.log(`每日清理完成：${JSON.stringify(result)}`);
    });
  }

  onApplicationBootstrap(): void {
    if (!this.env.RUN_WORKER) return;
    this.schedule(reportDate(new Date())).catch((err: Error) =>
      this.logger.error('排定每日清理任务失败', err),
    );
  }

  /** 排定“date 这一天”结束后的清理，在次日凌晨执行 */
  schedule(date: string) {
    return this.jobs.enqueue(
      CLEANUP_JOB,
      { date },
      {
        dedupeKey: `cleanup:${date}`,
        runAt: new Date(dayStart(addDays(date, 1)).getTime() + RUN_AFTER_MIDNIGHT_MS),
      },
    );
  }

  async run(now = new Date()): Promise<CleanupResult> {
    return {
      orphanUploads: await this.purgeOrphanUploads(now),
      jobs: await this.pruneJobs(now),
      notifications: await this.pruneNotifications(now),
    };
  }

  private async purgeOrphanUploads(now: Date): Promise<number> {
    const olderThan = new Date(now.getTime() - RETENTION.orphanUploadHours * 3600_000);
    const keys = await this.storage.listKeys('web/', { olderThan, limit: ORPHAN_SCAN_LIMIT });
    if (!keys.length) return 0;
    const registered = new Set<string>();
    for (let i = 0; i < keys.length; i += 1000) {
      const rows = await this.prisma.attachment.findMany({
        where: { storageKey: { in: keys.slice(i, i + 1000) } },
        select: { storageKey: true },
      });
      for (const r of rows) registered.add(r.storageKey);
    }
    const orphans = keys.filter((k) => !registered.has(k));
    if (orphans.length) await this.storage.deleteObjects(orphans);
    return orphans.length;
  }

  private async pruneJobs(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION.finishedJobDays * DAY_MS);
    const { count } = await this.prisma.job.deleteMany({
      where: { status: { in: ['done', 'failed'] }, updatedAt: { lt: cutoff } },
    });
    return count;
  }

  private async pruneNotifications(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION.readNotificationDays * DAY_MS);
    const { count } = await this.prisma.notification.deleteMany({
      where: { readAt: { not: null }, createdAt: { lt: cutoff } },
    });
    return count;
  }
}
