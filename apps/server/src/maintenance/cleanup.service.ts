import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { reportDate } from '@defect/shared';
import { APP_ENV, type AppEnv } from '../config/env';
import { purgeStaleUploads } from '../ingest/upload-dir';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, dayStart } from '../reports/report-math';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.types';

const CLEANUP_JOB = 'maintenance.daily-cleanup';

/** 凌晨 03:30（北京时间）执行，避开白天使用高峰 */
const RUN_AFTER_MIDNIGHT_MS = 3.5 * 3600_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** 保留期。缺陷（包括已删除的）及其附件永久保留，不在清理范围内 */
const RETENTION = {
  /** 写进存储却没有挂到缺陷上的文件（网页上传到一半放弃、APP 提单失败等） */
  orphanUploadHours: 24,
  /** APP 提单停在“处理中”超过这么久，视为处理中断（如服务重启） */
  stalePendingHours: 1,
  /** 已完成 / 已失败的后台任务记录 */
  finishedJobDays: 30,
  /** 已读通知 */
  readNotificationDays: 90,
};

/** 存放上传文件的目录：web/ 网页提单，feedback/ APP 提单 */
const UPLOAD_PREFIXES = ['web/', 'feedback/'];
const KEY_BATCH = 1000;

export interface CleanupResult {
  orphanUploads: number;
  staleSubmissions: number;
  tempFiles: number;
  jobs: number;
  notifications: number;
}

/**
 * 每日清理（磁盘与表只增不删的问题）：
 * - 超过 24 小时仍没挂到缺陷上的上传文件；
 * - 停在“处理中”超过 1 小时的 APP 提单记为失败，服务端临时目录里的残留上传文件；
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
    const olderThan = new Date(now.getTime() - RETENTION.orphanUploadHours * HOUR_MS);
    return {
      staleSubmissions: await this.failStaleSubmissions(now),
      orphanUploads: await this.purgeOrphanUploads(olderThan),
      tempFiles: await purgeStaleUploads(olderThan),
      jobs: await this.pruneJobs(now),
      notifications: await this.pruneNotifications(now),
    };
  }

  private async failStaleSubmissions(now: Date): Promise<number> {
    const { count } = await this.prisma.feedbackReport.updateMany({
      where: {
        status: 'pending',
        receivedAt: { lt: new Date(now.getTime() - RETENTION.stalePendingHours * HOUR_MS) },
      },
      data: {
        status: 'failed',
        error: '处理中断（服务重启等），APP 可用同一个 reportId 重新提交',
        processedAt: now,
      },
    });
    return count;
  }

  /** 列出上传目录里的旧文件，按批查是否已挂到缺陷上，没挂上的删除 */
  private async purgeOrphanUploads(olderThan: Date): Promise<number> {
    let removed = 0;
    for (const prefix of UPLOAD_PREFIXES) {
      const keys = await this.storage.listKeys(prefix, { olderThan });
      for (let i = 0; i < keys.length; i += KEY_BATCH) {
        const batch = keys.slice(i, i + KEY_BATCH);
        const registered = new Set(
          (
            await this.prisma.attachment.findMany({
              where: { storageKey: { in: batch } },
              select: { storageKey: true },
            })
          ).map((r) => r.storageKey),
        );
        const orphans = batch.filter((k) => !registered.has(k));
        if (orphans.length) await this.storage.deleteObjects(orphans);
        removed += orphans.length;
      }
    }
    return removed;
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
