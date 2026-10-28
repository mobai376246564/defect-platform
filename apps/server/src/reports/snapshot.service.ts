import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { reportDate } from '@defect/shared';
import { APP_ENV, type AppEnv } from '../config/env';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, dayStart } from './report-math';

const SNAPSHOT_JOB = 'report.daily-snapshot';

/** 凌晨 00:05（北京时间）写前一天的快照，留几分钟给跨零点的请求落库 */
const RUN_AFTER_MIDNIGHT_MS = 5 * 60_000;

/**
 * 每日缺陷快照（方案 6.9 defect_daily_snapshot）：
 * 每天凌晨按 项目 × 状态类别 × 严重程度 统计前一天结束时的缺陷数，供趋势报表画存量。
 * 用任务队列的 runAt 定时，dedupeKey 按日期去重，多实例或重启都只会写一次；
 * 每次执行先排好下一天的任务，即使本次失败重试也不会断链。
 */
@Injectable()
export class SnapshotService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {
    this.jobs.register(SNAPSHOT_JOB, async (payload) => {
      const date = String(payload.date);
      await this.schedule(addDays(date, 1));
      await this.write(date);
    });
  }

  onApplicationBootstrap(): void {
    if (!this.env.RUN_WORKER) return;
    this.schedule(reportDate(new Date())).catch((err: Error) =>
      this.logger.error('排定每日快照任务失败', err),
    );
  }

  /** 排定“date 这一天”的快照任务，在次日凌晨执行。 */
  schedule(date: string) {
    return this.jobs.enqueue(
      SNAPSHOT_JOB,
      { date },
      {
        dedupeKey: `snapshot:${date}`,
        runAt: new Date(dayStart(addDays(date, 1)).getTime() + RUN_AFTER_MIDNIGHT_MS),
      },
    );
  }

  /** 以当前缺陷状态写入 date 的快照（覆盖同日旧数据），返回写入行数。 */
  async write(date: string): Promise<number> {
    const groups = await this.prisma.defect.groupBy({
      by: ['projectId', 'statusCategory', 'severity'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const day = new Date(`${date}T00:00:00Z`);
    await this.prisma.$transaction([
      this.prisma.defectDailySnapshot.deleteMany({ where: { date: day } }),
      this.prisma.defectDailySnapshot.createMany({
        data: groups.map((g) => ({
          projectId: g.projectId,
          date: day,
          statusCategory: g.statusCategory,
          severity: g.severity,
          count: g._count._all,
        })),
      }),
    ]);
    this.logger.log(`已写入 ${date} 的缺陷快照（${groups.length} 行）`);
    return groups.length;
  }
}
