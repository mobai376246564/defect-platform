import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env';
import { Prisma, type Job } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type JobHandler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

/**
 * 任务通道：每条通道一个串行的消费者。耗时长的录屏抽帧单独一条，
 * 不会堵住每日快照、每日清理等其他任务。any 不区分类型（测试与运维脚本的 drain 用）。
 */
export type JobLane = 'media' | 'default' | 'any';
const MEDIA_TYPE = 'video.%';
const laneFilter = (lane: JobLane) =>
  lane === 'media'
    ? Prisma.sql`AND type LIKE ${MEDIA_TYPE}`
    : lane === 'default'
      ? Prisma.sql`AND type NOT LIKE ${MEDIA_TYPE}`
      : Prisma.empty;

/** 执行中的任务每隔这么久续租一次；超过 STALE 没有续租的“运行中”任务视为执行者已退出，可被重新领取 */
const LEASE_RENEW_MS = 60_000;
/** 停服时最多等进行中的任务这么久 */
const SHUTDOWN_WAIT_MS = 8_000;

/**
 * 基于 PostgreSQL 的轻量任务队列：
 * - SELECT ... FOR UPDATE SKIP LOCKED 取任务，多实例并发安全；
 * - 失败指数退避重试，超过 maxAttempts 标记 failed 便于告警与人工重试；
 * - dedupeKey 保证同一业务键只入队一次（如同一个附件的抽帧、同一天的快照）。
 * MVP 不额外引入 Redis / 消息队列，规模上来后可替换为 TDMQ。
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private readonly timers = new Map<JobLane, NodeJS.Timeout>();
  private readonly running = new Set<JobLane>();
  private readonly inFlight = new Set<Promise<void>>();
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  /** 入队；dedupeKey 已存在时直接返回已有任务。 */
  async enqueue(
    type: string,
    payload: Record<string, unknown>,
    opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {},
  ): Promise<Job> {
    try {
      return await this.prisma.job.create({
        data: {
          type,
          payload: payload as Prisma.InputJsonValue,
          dedupeKey: opts.dedupeKey,
          runAt: opts.runAt,
          maxAttempts: opts.maxAttempts,
        },
      });
    } catch (err) {
      if (
        opts.dedupeKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.prisma.job.findUniqueOrThrow({ where: { dedupeKey: opts.dedupeKey } });
      }
      throw err;
    }
  }

  onApplicationBootstrap(): void {
    if (!this.env.RUN_WORKER) return;
    this.schedule('default', 1000);
    this.schedule('media', 1500);
  }

  /** 停服：不再取新任务，并等进行中的任务收尾（pm2 的 kill_timeout 为 10 秒） */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    if (this.inFlight.size) {
      await Promise.race([
        Promise.allSettled([...this.inFlight]),
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS)),
      ]);
    }
  }

  private schedule(lane: JobLane, delayMs: number): void {
    if (this.stopped) return;
    this.timers.set(
      lane,
      setTimeout(() => void this.tick(lane), delayMs),
    );
  }

  private async tick(lane: JobLane): Promise<void> {
    let worked = false;
    try {
      worked = await this.runOnce(lane);
    } catch (err) {
      this.logger.error('任务轮询失败', err as Error);
    }
    // 有任务时立即取下一个，空闲时 2 秒轮询一次
    this.schedule(lane, worked ? 0 : 2000);
  }

  /** 从指定通道取一个到期任务并执行；返回是否处理了任务。测试中可直接调用。 */
  async runOnce(lane: JobLane = 'any'): Promise<boolean> {
    if (this.running.has(lane)) return false;
    this.running.add(lane);
    try {
      // Prisma 把 DateTime 按 UTC 存进不带时区的 timestamp 列，而 now() 与这类列比较时会按会话时区换算
      // （嵌入式 / 云数据库常为 Asia/Shanghai），所以统一用 UTC 墙上时间比较，否则任务会提前 8 小时到期
      const [job] = await this.prisma.$queryRaw<Job[]>`
        UPDATE "Job" SET status = 'running', "lockedAt" = (now() AT TIME ZONE 'UTC'),
          attempts = attempts + 1, "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE id = (
          SELECT id FROM "Job"
          WHERE ((status = 'queued' AND "runAt" <= (now() AT TIME ZONE 'UTC'))
             OR (status = 'running' AND "lockedAt" < (now() AT TIME ZONE 'UTC') - interval '10 minutes'))
            ${laneFilter(lane)}
          ORDER BY "runAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *`;
      if (!job) return false;
      const run = this.execute(job);
      this.inFlight.add(run);
      try {
        await run;
      } finally {
        this.inFlight.delete(run);
      }
      return true;
    } finally {
      this.running.delete(lane);
    }
  }

  /** 处理完队列中所有到期任务（测试与运维脚本使用）。 */
  async drain(max = 100): Promise<number> {
    let n = 0;
    while (n < max && (await this.runOnce())) n++;
    return n;
  }

  private async execute(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.fail(job, `没有注册任务类型 ${job.type} 的处理器`, true);
      return;
    }
    // 执行中进程退出（如内存不足被杀）的任务会被重新领取，每次领取都计入次数；超过上限不再执行，
    // 否则一个能把进程打挂的任务会每 10 分钟重来一次
    if (job.attempts > job.maxAttempts) {
      await this.fail(
        job,
        `已领取 ${job.attempts - 1} 次仍未完成（执行中进程可能退出了），不再重试`,
        true,
      );
      return;
    }
    // 长任务（如抽帧）执行期间定期续租，避免超过 10 分钟后被当成“执行者已退出”而重复领取
    const lease = setInterval(() => {
      void this.prisma.$executeRaw`
        UPDATE "Job" SET "lockedAt" = (now() AT TIME ZONE 'UTC')
        WHERE id = ${job.id}::uuid AND status = 'running'`.catch(() => undefined);
    }, LEASE_RENEW_MS);
    try {
      await handler(job.payload as Record<string, unknown>, job);
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: 'done', lockedAt: null, lastError: null },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`任务 ${job.type}#${job.id} 第 ${job.attempts} 次失败：${message}`);
      await this.fail(job, message, job.attempts >= job.maxAttempts);
    } finally {
      clearInterval(lease);
    }
  }

  private async fail(job: Job, message: string, final: boolean): Promise<void> {
    // 退避：30s、2min、8min、32min……
    const delayMs = 30_000 * 4 ** Math.max(0, job.attempts - 1);
    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: final ? 'failed' : 'queued',
        lockedAt: null,
        lastError: message.slice(0, 2000),
        runAt: final ? undefined : new Date(Date.now() + delayMs),
      },
    });
    if (final) this.logger.error(`任务 ${job.type}#${job.id} 最终失败：${message}`);
  }
}
