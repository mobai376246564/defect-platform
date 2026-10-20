import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { attachmentKindOf, type Frequency, type Severity } from '@defect/shared';
import {
  feedbackManifestSchema,
  feedbackPrefix,
  parseManifestKey,
  type FeedbackManifest,
} from '@defect/shared/manifest';
import { APP_ENV, type AppEnv } from '../config/env';
import { DefectsService } from '../defects/defects.service';
import type { Attachment, Prisma, Project } from '../generated/prisma/client';
import { JobsService } from '../jobs/jobs.service';
import { readLogArchive } from '../logs/log-archive';
import { MediaService } from '../media/media.service';
import { fingerprintOf, summarizeLogs } from '../logs/log-summary';
import { PrismaService } from '../prisma/prisma.service';
import type { WorkflowDefinition } from '@defect/shared';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.types';

export const INGEST_JOB = 'feedback.ingest';
const MAX_LOG_BYTES = 30 * 1024 * 1024;
/** 同一个问题的前几条重复反馈保留附件与说明评论，之后只累加次数 */
export const DUPLICATE_DETAIL_LIMIT = 3;

interface PresentFile {
  key: string;
  name: string;
  size: number;
  kind: string;
}

/**
 * APP 反馈自动建单（方案 5.2）：
 * COS 事件 / 对账任务 → handleManifestKey 入队 → process 拉取 manifest、校验附件、
 * 解析日志、按指纹去重，最后建单或合并到已有缺陷。整个流程以 reportId 幂等。
 */
@Injectable()
export class IngestService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IngestService.name);
  private reconcileTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly defects: DefectsService,
    private readonly media: MediaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {
    this.jobs.register(INGEST_JOB, (payload) => this.process(String(payload.reportId)));
  }

  onApplicationBootstrap(): void {
    const minutes = this.env.RECONCILE_INTERVAL_MINUTES;
    if (!this.env.RUN_WORKER || minutes === 0) return;
    this.reconcileTimer = setInterval(() => {
      this.reconcile().catch((err: Error) => this.logger.error('对账任务失败', err));
    }, minutes * 60_000);
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  /** 收到 manifest.json 的对象 key：登记反馈并入队。重复调用安全。 */
  async handleManifestKey(key: string): Promise<{ accepted: boolean; reportId?: string }> {
    const parsed = parseManifestKey(key);
    if (!parsed) return { accepted: false };
    await this.prisma.feedbackReport.upsert({
      where: { reportId: parsed.reportId },
      create: { reportId: parsed.reportId, appId: parsed.appId, storagePrefix: parsed.prefix },
      update: {},
    });
    await this.jobs.enqueue(
      INGEST_JOB,
      { reportId: parsed.reportId },
      { dedupeKey: `feedback:${parsed.reportId}` },
    );
    return { accepted: true, reportId: parsed.reportId };
  }

  /** 扫描今天与昨天的反馈目录，补登漏掉的 manifest（方案 5.1 方案 B）。 */
  async reconcile(now = new Date()): Promise<number> {
    const projects = await this.prisma.project.findMany({ select: { appIds: true } });
    const appIds = [...new Set(projects.flatMap((p) => p.appIds))];
    let added = 0;
    for (const appId of appIds) {
      for (const day of [now, new Date(now.getTime() - 86_400_000)]) {
        const dayPrefix = feedbackPrefix(appId, day, 'x').replace(/x\/$/, '');
        const keys = await this.storage.listKeys(dayPrefix, { suffix: 'manifest.json' });
        for (const key of keys) {
          const parsed = parseManifestKey(key);
          if (!parsed) continue;
          const known = await this.prisma.feedbackReport.findUnique({
            where: { reportId: parsed.reportId },
          });
          if (known) continue;
          await this.handleManifestKey(key);
          added++;
        }
      }
    }
    if (added > 0) this.logger.warn(`对账补登 ${added} 条反馈，请检查 COS 事件通知是否正常`);
    return added;
  }

  async process(reportId: string): Promise<void> {
    const report = await this.prisma.feedbackReport.findUnique({ where: { reportId } });
    if (!report || ['created', 'merged', 'archived'].includes(report.status)) return;

    // manifest 读取失败（网络等）抛错交给队列重试；格式错误属于永久失败，直接标记
    const raw = await this.storage.getObject(`${report.storagePrefix}manifest.json`);
    let manifest: FeedbackManifest;
    try {
      manifest = feedbackManifestSchema.parse(JSON.parse(raw.toString('utf8')));
    } catch (err) {
      await this.markFailed(reportId, `manifest 格式错误：${(err as Error).message.slice(0, 500)}`);
      return;
    }
    if (manifest.reportId !== reportId) {
      await this.markFailed(reportId, 'manifest 中的 reportId 与目录不一致');
      return;
    }

    const project = await this.prisma.project.findFirst({
      where: { appIds: { has: manifest.appId } },
    });
    if (!project) {
      await this.markFailed(reportId, `没有项目绑定 APP ${manifest.appId}`);
      return;
    }

    // 逐个核对附件是否已上传
    const present: PresentFile[] = [];
    const missing: string[] = [];
    for (const a of manifest.attachments) {
      const head = await this.storage.headObject(report.storagePrefix + a.key);
      if (head)
        present.push({
          key: report.storagePrefix + a.key,
          name: a.key,
          size: head.size,
          kind: a.type,
        });
      else missing.push(a.key);
    }

    const { summary, fingerprint } = await this.analyzeLogs(present, manifest.app.version);

    // 上次处理时缺陷已建好、但后续步骤（挂附件等）失败而重试：不再重复建单，只补完剩下的步骤
    if (report.defectId) {
      await this.attach(report.defectId, present);
      await this.finish(reportId, 'created', report.defectId, manifest);
      return;
    }

    const handled = fingerprint
      ? // 同一指纹的反馈可能同时到达：按“项目 + 指纹”加事务级咨询锁串行查重，避免各建一单
        await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${project.id}:${fingerprint}`}))`;
            const duplicate = await tx.defect.findFirst({
              where: {
                projectId: project.id,
                fingerprint,
                statusCategory: { not: 'done' },
                deletedAt: null,
              },
            });
            if (duplicate) return this.mergeDuplicate(tx, duplicate, reportId, manifest, present);
            await this.createDefect(
              project,
              reportId,
              manifest,
              present,
              missing,
              summary,
              fingerprint,
            );
            return null;
          },
          { timeout: 60_000, maxWait: 60_000 },
        )
      : (await this.createDefect(project, reportId, manifest, present, missing, summary, null),
        null);
    // 合并时新挂的附件在事务提交后再排抽帧任务
    if (handled?.length) await this.media.enqueueFor(handled);
  }

  /**
   * 建单：缺陷与“这条反馈已建单”在同一个事务里提交，任务中途失败重试时不会重复建单。
   * 挂附件放在事务外（失败重试时按 defectId 继续，已挂的不重复挂）。
   */
  private async createDefect(
    project: Project,
    reportId: string,
    manifest: FeedbackManifest,
    present: PresentFile[],
    missing: string[],
    summary: string | null,
    fingerprint: string | null,
  ): Promise<void> {
    const ctx = {
      project,
      workflow: project.workflow as unknown as WorkflowDefinition,
      role: 'admin' as const,
    };
    const defect = await this.defects.create(
      ctx,
      { kind: 'system' },
      {
        title: manifest.title,
        description: this.describe(manifest, missing),
        steps: manifest.context.trail?.length
          ? `操作路径：${manifest.context.trail.join(' → ')}`
          : '',
        expected: '',
        actual: '',
        severity: severityOf(manifest),
        frequency: frequencyOf(manifest),
      },
      'system',
      {
        source: 'app',
        appCommit: manifest.app.commit ?? null,
        deviceInfo: {
          app: manifest.app,
          device: manifest.device,
          context: manifest.context,
        } as Prisma.InputJsonValue,
        logSummary: summary,
        fingerprint,
        onCreated: async (tx, d) => {
          await tx.feedbackReport.update({ where: { reportId }, data: { defectId: d.id } });
        },
      },
    );
    await this.attach(defect.id, present);
    await this.finish(reportId, 'created', defect.id, manifest);
    this.logger.log(`APP 反馈 ${reportId} 已建单 ${defect.code}`);
  }

  /**
   * 合并为重复反馈（在调用方的事务里，与“这条反馈已合并”一起提交）：累加重复次数。
   * 前几条重复反馈保留附件和一条说明评论，便于对比；之后只计数，避免一个高频崩溃让单个缺陷的附件、评论无限增长。
   * 每条反馈的完整 manifest 都留在 FeedbackReport 里。返回新挂的附件，提交后再排抽帧任务。
   */
  private async mergeDuplicate(
    tx: Prisma.TransactionClient,
    duplicate: { id: string; dupCount: number },
    reportId: string,
    manifest: FeedbackManifest,
    present: PresentFile[],
  ): Promise<Attachment[]> {
    const n = duplicate.dupCount + 1;
    await tx.defect.update({ where: { id: duplicate.id }, data: { dupCount: n } });
    let created: Attachment[] = [];
    if (n <= DUPLICATE_DETAIL_LIMIT) {
      const note = n === DUPLICATE_DETAIL_LIMIT ? `；之后的相同反馈只累加次数，不再附带附件` : '';
      await tx.comment.create({
        data: {
          defectId: duplicate.id,
          via: 'system',
          body: `又收到 1 条相同的 APP 反馈（reportId ${reportId}，版本 ${manifest.app.version}）：${manifest.title}${note}`,
        },
      });
      created = await this.createAttachments(tx, duplicate.id, present);
    }
    await tx.feedbackReport.update({
      where: { reportId },
      data: {
        status: 'merged',
        defectId: duplicate.id,
        manifest: manifest as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });
    return created;
  }

  private async finish(
    reportId: string,
    status: 'created',
    defectId: string,
    manifest: FeedbackManifest,
  ): Promise<void> {
    await this.prisma.feedbackReport.update({
      where: { reportId },
      data: {
        status,
        defectId,
        manifest: manifest as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });
  }

  private async analyzeLogs(
    present: PresentFile[],
    appVersion: string,
  ): Promise<{ summary: string | null; fingerprint: string | null }> {
    const logs = present.filter((p) => p.kind === 'log' && p.size <= MAX_LOG_BYTES);
    if (logs.length === 0) return { summary: null, fingerprint: null };
    const files = [];
    for (const l of logs) {
      try {
        files.push(...(await readLogArchive(l.name, await this.storage.getObject(l.key))));
      } catch (err) {
        this.logger.warn(`日志 ${l.key} 解析失败：${(err as Error).message}`);
      }
    }
    const { summary, exception } = summarizeLogs(files);
    return { summary: summary || null, fingerprint: fingerprintOf(exception, appVersion) };
  }

  /** 挂附件并排抽帧任务；可重复调用，已挂过的文件不会重复挂 */
  private async attach(defectId: string, present: PresentFile[]): Promise<void> {
    const created = await this.createAttachments(this.prisma, defectId, present);
    await this.media.enqueueFor(created);
  }

  private async createAttachments(
    db: Prisma.TransactionClient,
    defectId: string,
    present: PresentFile[],
  ): Promise<Attachment[]> {
    const existing = new Set(
      (
        await db.attachment.findMany({
          where: { defectId, storageKey: { in: present.map((p) => p.key) } },
          select: { storageKey: true },
        })
      ).map((a) => a.storageKey),
    );
    const created: Attachment[] = [];
    for (const p of present.filter((x) => !existing.has(x.key))) {
      created.push(
        await db.attachment.create({
          data: {
            defectId,
            kind: attachmentKindOf(p.name),
            fileName: p.name,
            storageKey: p.key,
            size: p.size,
          },
        }),
      );
    }
    return created;
  }

  private describe(m: FeedbackManifest, missing: string[]): string {
    const lines = [
      m.description || '（用户未填写描述）',
      '',
      '---',
      `来源：APP 用户反馈（reportId ${m.reportId}）`,
    ];
    lines.push(`APP：${m.appId} ${m.app.version}${m.app.build ? ` (${m.app.build})` : ''}`);
    if (m.context.page) lines.push(`页面：${m.context.page}`);
    if (m.context.crashId) lines.push(`崩溃 ID：${m.context.crashId}`);
    if (missing.length) lines.push(`⚠ 附件不完整，缺少：${missing.join('、')}`);
    return lines.join('\n');
  }

  private async markFailed(reportId: string, error: string): Promise<void> {
    this.logger.warn(`APP 反馈 ${reportId} 建单失败：${error}`);
    await this.prisma.feedbackReport.update({
      where: { reportId },
      data: { status: 'failed', error, processedAt: new Date() },
    });
  }
}

function severityOf(m: FeedbackManifest): Severity {
  return m.category?.toUpperCase() === 'CRASH' ? 'serious' : 'normal';
}

function frequencyOf(m: FeedbackManifest): Frequency | undefined {
  switch (m.reproducible) {
    case 'ALWAYS':
      return 'always';
    case 'RANDOM':
      return 'random';
    case 'NEVER':
      return 'never';
    default:
      return undefined;
  }
}
