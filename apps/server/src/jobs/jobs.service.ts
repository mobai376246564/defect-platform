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
 * 基于 PostgreSQL 的轻量任务队列：
 * - SELECT ... FOR UPDATE SKIP LOCKED 取任务，多实例并发安全；
 * - 失败指数退避重试，超过 maxAttempts 标记 failed 便于告警与人工重试；
 * - dedupeKey 保证同一业务键只入队一次（如同一个 reportId）。
 * MVP 不额外引入 Redis / 消息队列，规模上来后可替换为 TDMQ。
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private timer?: NodeJS.Timeout;
  private running = false;
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
    this.schedule(1000);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    let worked = false;
    try {
      worked = await this.runOnce();
    } catch (err) {
      this.logger.error('任务轮询失败', err as Error);
    }
    // 有任务时立即取下一个，空闲时 2 秒轮询一次
    this.schedule(worked ? 0 : 2000);
  }

  /** 取一个到期任务并执行；返回是否处理了任务。测试中可直接调用。 */
  async runOnce(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      // Prisma 把 DateTime 按 UTC 存进不带时区的 timestamp 列，而 now() 与这类列比较时会按会话时区换算
      // （嵌入式 / 云数据库常为 Asia/Shanghai），所以统一用 UTC 墙上时间比较，否则任务会提前 8 小时到期
      const [job] = await this.prisma.$queryRaw<Job[]>`
        UPDATE "Job" SET status = 'running', "lockedAt" = (now() AT TIME ZONE 'UTC'),
          attempts = attempts + 1, "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE id = (
          SELECT id FROM "Job"
          WHERE (status = 'queued' AND "runAt" <= (now() AT TIME ZONE 'UTC'))
             OR (status = 'running' AND "lockedAt" < (now() AT TIME ZONE 'UTC') - interval '10 minutes')
          ORDER BY "runAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *`;
      if (!job) return false;
      await this.execute(job);
      return true;
    } finally {
      this.running = false;
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
