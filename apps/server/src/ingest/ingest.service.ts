import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  SEVERITY,
  attachmentKindOf,
  type Frequency,
  type Severity,
  type WorkflowDefinition,
} from '@defect/shared';
import { DefectsService } from '../defects/defects.service';
import type { Attachment, Prisma, Project } from '../generated/prisma/client';
import { readLogArchive } from '../logs/log-archive';
import { fingerprintOf, summarizeLogs } from '../logs/log-summary';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { OBJECT_STORAGE, safeFileName, type ObjectStorage } from '../storage/storage.types';

/** APP 提单的文件限制：单个文件、文件个数、一次提交的总大小 */
export const APP_FILE_MAX_BYTES = 200 * 1024 * 1024;
export const APP_MAX_FILES = 10;
export const APP_TOTAL_MAX_BYTES = 500 * 1024 * 1024;
/** 超过这个大小的日志不解析（仍作为附件保存） */
const MAX_LOG_BYTES = 30 * 1024 * 1024;
const TITLE_MAX = 60;

/** APP 提交的缺陷内容（字段说明见 docs/app-integration.md） */
export interface AppDefectInput {
  appId: string;
  description: string;
  title?: string;
  reportId?: string;
  reporterName?: string;
  /** 处理人姓名，可以多个 */
  ownerNames?: string[];
  severity?: Severity;
  frequency?: Frequency;
  steps?: string;
  appVersion?: string;
  appBuild?: string;
  appCommit?: string;
  deviceModel?: string;
  osVersion?: string;
  page?: string;
  extra?: Record<string, unknown>;
}

/** 已落到服务端临时目录的上传文件 */
export interface UploadedFile {
  originalName: string;
  path: string;
  size: number;
  mimeType?: string;
}

export interface AppDefectResult {
  reportId: string;
  code: string;
  /** 缺陷详情页地址 */
  url: string;
  /** false 表示同一个 reportId 之前已经建过单（APP 重试），直接返回原来的编号 */
  created: boolean;
}

interface StoredFile {
  key: string;
  name: string;
  size: number;
}

/**
 * APP 提单：APP 一次请求带上描述、APP 标识与截图 / 录屏 / 日志，平台同步建单并返回缺陷编号。
 * - 按 APP 标识找到绑定它的项目（项目设置里配置）；
 * - 文件写入对象存储，日志自动解析出摘要与异常特征；
 * - 提单人按姓名匹配平台用户，匹配上记为创建人；
 * - 每次提交都新建缺陷，不按崩溃特征合并；
 * - 以 reportId 幂等：APP 超时重试时不会重复建单。
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defects: DefectsService,
    private readonly media: MediaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async submit(input: AppDefectInput, files: UploadedFile[]): Promise<AppDefectResult> {
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > APP_TOTAL_MAX_BYTES) {
      throw new BadRequestException(
        `附件总大小超过 ${APP_TOTAL_MAX_BYTES / 1024 / 1024} MB，请压缩录屏或分开提交`,
      );
    }
    const project = await this.prisma.project.findFirst({
      where: { appIds: { has: input.appId } },
    });
    if (!project) {
      throw new BadRequestException(
        `APP 标识 ${input.appId} 还没有绑定到任何项目，请联系平台管理员在「项目设置 → APP 接入」中绑定`,
      );
    }

    const reportId = input.reportId ?? randomUUID();
    const previous = await this.prisma.feedbackReport.findUnique({ where: { reportId } });
    if (previous?.defectId) {
      const defect = await this.prisma.defect.findUnique({ where: { id: previous.defectId } });
      if (defect) return this.result(reportId, project.key, defect.code, false);
    }

    const storagePrefix = appPrefix(input.appId, new Date(), reportId);
    const meta = {
      ...input,
      files: files.map((f) => ({ name: f.originalName, size: f.size })),
    } as Prisma.InputJsonValue;
    await this.prisma.feedbackReport.upsert({
      where: { reportId },
      create: { reportId, appId: input.appId, storagePrefix, manifest: meta },
      update: { status: 'pending', error: null, storagePrefix, manifest: meta },
    });

    try {
      const { summary, fingerprint } = await this.analyzeLogs(files, input.appVersion);
      const stored = await this.store(storagePrefix, files);
      const reporter = await this.matchReporter(project, input.reporterName);
      const owners = await this.matchOwners(project, input.ownerNames ?? []);
      const ctx = {
        project,
        workflow: project.workflow as unknown as WorkflowDefinition,
        role: 'admin' as const,
      };
      const defect = await this.defects.create(
        ctx,
        { kind: 'system' },
        {
          title: titleOf(input),
          description: this.describe(input, reportId, reporter.note, owners.notes),
          steps: input.steps ?? '',
          ownerIds: owners.ownerIds,
          expected: '',
          actual: '',
          severity: input.severity ?? 'normal',
          frequency: input.frequency,
        },
        'system',
        {
          source: 'app',
          appCommit: input.appCommit ?? null,
          deviceInfo: {
            app: { id: input.appId, version: input.appVersion, build: input.appBuild },
            device: { model: input.deviceModel, os: input.osVersion },
            page: input.page,
            extra: input.extra,
          } as Prisma.InputJsonValue,
          logSummary: summary,
          fingerprint,
          reporterId: reporter.userId,
          onCreated: async (tx, d) => {
            await tx.feedbackReport.update({ where: { reportId }, data: { defectId: d.id } });
          },
        },
      );
      await this.attach(defect.id, stored);
      await this.prisma.feedbackReport.update({
        where: { reportId },
        data: { status: 'created', processedAt: new Date() },
      });
      this.logger.log(`APP 提单 ${input.appId} → ${defect.code}（reportId ${reportId}）`);
      return this.result(reportId, project.key, defect.code, true);
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      this.logger.warn(`APP 提单 ${reportId} 建单失败：${message}`);
      await this.prisma.feedbackReport.update({
        where: { reportId },
        data: { status: 'failed', error: message, processedAt: new Date() },
      });
      throw err;
    }
  }

  private result(reportId: string, projectKey: string, code: string, created: boolean) {
    return {
      reportId,
      code,
      url: `/p/${projectKey}/bugs/${code}`,
      created,
    };
  }

  /** 文件写入对象存储；同名文件自动加序号，避免互相覆盖 */
  private async store(prefix: string, files: UploadedFile[]): Promise<StoredFile[]> {
    const used = new Set<string>();
    const out: StoredFile[] = [];
    for (const f of files) {
      const name = uniqueName(safeFileName(f.originalName), used);
      const key = `${prefix}${name}`;
      await this.storage.putFile(key, f.path, f.mimeType);
      out.push({ key, name, size: f.size });
    }
    return out;
  }

  /** 解析日志（.log / .txt / 压缩包）：生成摘要，并按异常类型与位置算出特征值，便于检索相同问题 */
  private async analyzeLogs(
    files: UploadedFile[],
    appVersion: string | undefined,
  ): Promise<{ summary: string | null; fingerprint: string | null }> {
    const logs = files.filter(
      (f) => attachmentKindOf(f.originalName) === 'log' && f.size <= MAX_LOG_BYTES,
    );
    if (logs.length === 0) return { summary: null, fingerprint: null };
    const parsed = [];
    for (const l of logs) {
      try {
        parsed.push(...(await readLogArchive(l.originalName, await readFile(l.path))));
      } catch (err) {
        this.logger.warn(`日志 ${l.originalName} 解析失败：${(err as Error).message}`);
      }
    }
    const { summary, exception } = summarizeLogs(parsed);
    return {
      summary: summary || null,
      fingerprint: fingerprintOf(exception, appVersion ?? ''),
    };
  }

  /**
   * 按姓名匹配平台用户：先在项目成员里找，再在全部正常账号里找，唯一匹配才关联。
   * 匹配不上（或有重名）时返回说明，由调用方写进描述。
   */
  private async matchUser(
    project: Project,
    name: string,
  ): Promise<{ userId: string; member: boolean } | { userId: null; note: string }> {
    const active = { name, status: 'active', disabledAt: null };
    const members = await this.prisma.user.findMany({
      where: { ...active, memberships: { some: { projectId: project.id } } },
      select: { id: true },
      take: 2,
    });
    if (members.length === 1) return { userId: members[0]!.id, member: true };
    const candidates = members.length
      ? members
      : await this.prisma.user.findMany({ where: active, select: { id: true }, take: 2 });
    if (candidates.length === 1) return { userId: candidates[0]!.id, member: false };
    return {
      userId: null,
      note:
        candidates.length > 1
          ? `${name}（平台有多个同名用户，未自动关联）`
          : `${name}（未匹配到平台用户）`,
    };
  }

  /** 提单人：唯一匹配才记为创建人，否则只把姓名写进描述 */
  private async matchReporter(
    project: Project,
    name: string | undefined,
  ): Promise<{ userId: string | null; note: string | null }> {
    if (!name) return { userId: null, note: null };
    const m = await this.matchUser(project, name);
    return 'note' in m ? { userId: null, note: m.note } : { userId: m.userId, note: null };
  }

  /**
   * 处理人：逐个按姓名匹配，匹配上的指派（全平台用户都可以）；一个都匹配不上时返回空，
   * 由建单按默认规则（模块负责人 / 项目默认处理人）指派。匹配不上的、不是项目成员的写进描述。
   */
  private async matchOwners(
    project: Project,
    names: string[],
  ): Promise<{ ownerIds: string[] | undefined; notes: string[] }> {
    const ownerIds: string[] = [];
    const notes: string[] = [];
    for (const name of names) {
      const m = await this.matchUser(project, name);
      if ('note' in m) notes.push(m.note);
      else {
        if (!ownerIds.includes(m.userId)) ownerIds.push(m.userId);
        if (!m.member) notes.push(`${name}（不是项目成员，加入项目后才能看到并处理）`);
      }
    }
    if (names.length && ownerIds.length === 0) notes.push('已按默认规则指派处理人');
    return { ownerIds: ownerIds.length ? ownerIds : undefined, notes };
  }

  /** 挂附件并排录屏抽帧任务 */
  private async attach(defectId: string, stored: StoredFile[]): Promise<void> {
    const created: Attachment[] = [];
    for (const f of stored) {
      created.push(
        await this.prisma.attachment.create({
          data: {
            defectId,
            kind: attachmentKindOf(f.name),
            fileName: f.name,
            storageKey: f.key,
            size: f.size,
          },
        }),
      );
    }
    await this.media.enqueueFor(created);
  }

  private describe(
    input: AppDefectInput,
    reportId: string,
    reporterNote: string | null,
    ownerNotes: string[],
  ): string {
    const lines = [input.description, '', '---', `来源：APP 提单（reportId ${reportId}）`];
    const version = [input.appVersion, input.appBuild && `(${input.appBuild})`]
      .filter(Boolean)
      .join(' ');
    lines.push(`APP：${input.appId}${version ? ` ${version}` : ''}`);
    if (reporterNote) lines.push(`提单人：${reporterNote}`);
    if (ownerNotes.length) lines.push(`处理人：${ownerNotes.join('；')}`);
    const device = [input.deviceModel, input.osVersion].filter(Boolean).join(' / ');
    if (device) lines.push(`设备：${device}`);
    if (input.page) lines.push(`页面：${input.page}`);
    return lines.join('\n');
  }
}

/** 标题：APP 没传时取描述的第一句话，最多 60 个字 */
export function titleOf(input: { title?: string; description: string }): string {
  if (input.title?.trim()) return input.title.trim().slice(0, 120);
  const first =
    input.description
      .split(/[\n。！？!?；;]/)
      .map((s) => s.trim())
      .find(Boolean) ?? '';
  if (!first) return 'APP 提交的缺陷';
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX)}…` : first;
}

/** 存储目录：feedback/{APP 标识}/{yyyyMMdd}/{reportId}/ */
function appPrefix(appId: string, date: Date, reportId: string): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `feedback/${safeFileName(appId)}/${day}/${reportId}/`;
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name;
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 2; used.has(candidate); i++) candidate = `${base}-${i}${ext}`;
  used.add(candidate);
  return candidate;
}

export const SEVERITY_KEYS = Object.keys(SEVERITY) as [Severity, ...Severity[]];
