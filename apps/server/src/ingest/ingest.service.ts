import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  SEVERITY,
  attachmentKindOf,
  isParsableLog,
  type Frequency,
  type Severity,
  type WorkflowDefinition,
} from '@defect/shared';
import { DefectsService } from '../defects/defects.service';
import type { Attachment, FeedbackReport, Prisma, Project } from '../generated/prisma/client';
import { readLogArchive, type LogFile } from '../logs/log-archive';
import { summarizeLogs } from '../logs/log-summary';
import { projectOfApp } from './app-binding';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  OBJECT_STORAGE,
  contentTypeOf,
  safeFileName,
  type ObjectStorage,
} from '../storage/storage.types';

/** APP 提单的文件限制：单个文件、文件个数、一次提交的总大小 */
export const APP_FILE_MAX_BYTES = 200 * 1024 * 1024;
export const APP_MAX_FILES = 10;
const APP_TOTAL_MAX_BYTES = 500 * 1024 * 1024;
/** 超过这个大小的日志不解析（仍作为附件保存） */
const MAX_LOG_BYTES = 30 * 1024 * 1024;
/** 一次提交里所有日志解析后的文本总量上限，避免多个大日志包一起解压把内存撑满 */
const MAX_LOG_TEXT_CHARS = 60 * 1024 * 1024;
/** 同一个 reportId 正在处理时，超过这么久还没结束就认为处理中断（如服务重启），允许重试接手 */
const STALE_PENDING_MS = 10 * 60_000;
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
 * - 文件写入对象存储，日志自动解析出摘要；
 * - 提单人、处理人按姓名匹配平台用户；
 * - 每次提交都新建缺陷；
 * - 以 reportId 幂等：先“认领”这条提交再处理，APP 超时重试或并发重试都不会重复建单。
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
    const project = await projectOfApp(this.prisma, input.appId);
    const reportId = input.reportId ?? randomUUID();
    const storagePrefix = appPrefix(input.appId, new Date(), reportId);
    const meta = {
      ...input,
      files: files.map((f) => ({ name: f.originalName, size: f.size })),
    } as Prisma.InputJsonValue;

    const claim = await this.claim(reportId, input.appId, project.id, storagePrefix, meta);
    if (claim.done) return this.result(reportId, project.key, claim.done, false);

    try {
      const summary = await this.summarize(files);
      const stored = await this.store(storagePrefix, files);
      const reporter = await this.matchReporter(project, input.reporterName);
      const owners = await this.matchOwners(project, input.ownerNames ?? []);
      const ctx = {
        project,
        workflow: project.workflow as unknown as WorkflowDefinition,
        role: 'admin' as const,
      };
      let attachments: Attachment[] = [];
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
          reporterId: reporter.userId,
          // 附件与“这条提交已建单”和缺陷在同一个事务里提交：不会出现建了单却没挂上附件
          onCreated: async (tx, d) => {
            attachments = await this.createAttachments(tx, d.id, stored);
            await tx.feedbackReport.update({
              where: { reportId },
              data: { defectId: d.id, status: 'created', processedAt: new Date() },
            });
          },
        },
      );
      await this.media.enqueueFor(attachments);
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

  /**
   * 认领一条提交：新 reportId 直接登记为处理中；已建过单的返回原缺陷编号；
   * 失败过、或处理中断超过 10 分钟的，用“状态与接收时间没变”作条件改回处理中，只有一个请求能认领成功。
   * 另一个请求正在处理同一个 reportId 时返回 409，APP 稍后用同一个 reportId 重试即可拿到编号。
   */
  private async claim(
    reportId: string,
    appId: string,
    projectId: string,
    storagePrefix: string,
    meta: Prisma.InputJsonValue,
  ): Promise<{ done?: string }> {
    const previous = await this.prisma.feedbackReport.findUnique({ where: { reportId } });
    if (!previous) {
      try {
        await this.prisma.feedbackReport.create({
          data: { reportId, appId, projectId, storagePrefix, meta },
        });
        return {};
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') throw this.inProgress();
        throw err;
      }
    }
    if (previous.defectId) {
      const defect = await this.prisma.defect.findUnique({
        where: { id: previous.defectId },
        select: { code: true },
      });
      if (defect) return { done: defect.code };
    }
    if (isActive(previous)) throw this.inProgress();
    const { count } = await this.prisma.feedbackReport.updateMany({
      where: { reportId, status: previous.status, receivedAt: previous.receivedAt },
      data: {
        status: 'pending',
        error: null,
        defectId: null,
        projectId,
        storagePrefix,
        meta,
        receivedAt: new Date(),
        processedAt: null,
      },
    });
    if (count === 0) throw this.inProgress();
    // 上次失败时已写入的文件不再使用（新目录按今天的日期），由每日清理删除
    return {};
  }

  private inProgress(): ConflictException {
    return new ConflictException('这条提交正在处理中，请稍后用同一个 reportId 重试');
  }

  private result(reportId: string, projectKey: string, code: string, created: boolean) {
    return {
      reportId,
      code,
      url: `/p/${projectKey}/bugs/${code}`,
      created,
    };
  }

  /** 文件写入对象存储；同名文件自动加序号，避免互相覆盖。类型按扩展名定，不信任客户端声明的 */
  private async store(prefix: string, files: UploadedFile[]): Promise<StoredFile[]> {
    const used = new Set<string>();
    const out: StoredFile[] = [];
    for (const f of files) {
      const name = uniqueName(safeFileName(f.originalName), used);
      const key = `${prefix}${name}`;
      await this.storage.putFile(key, f.path, contentTypeOf(name));
      out.push({ key, name, size: f.size });
    }
    return out;
  }

  /** 解析文本日志（.log / .txt / .json / zip 包）生成摘要；所有日志合计有文本量上限 */
  private async summarize(files: UploadedFile[]): Promise<string | null> {
    const logs = files.filter((f) => isParsableLog(f.originalName) && f.size <= MAX_LOG_BYTES);
    if (logs.length === 0) return null;
    const parsed: LogFile[] = [];
    let chars = 0;
    for (const l of logs) {
      if (chars >= MAX_LOG_TEXT_CHARS) break;
      try {
        for (const f of await readLogArchive(l.originalName, await readFile(l.path))) {
          if (chars >= MAX_LOG_TEXT_CHARS) break;
          parsed.push(f);
          chars += f.text.length;
        }
      } catch (err) {
        this.logger.warn(`日志 ${l.originalName} 解析失败：${(err as Error).message}`);
      }
    }
    return summarizeLogs(parsed) || null;
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

  private async createAttachments(
    tx: Prisma.TransactionClient,
    defectId: string,
    stored: StoredFile[],
  ): Promise<Attachment[]> {
    const created: Attachment[] = [];
    for (const f of stored) {
      created.push(
        await tx.attachment.create({
          data: {
            defectId,
            kind: attachmentKindOf(f.name),
            fileName: f.name,
            storageKey: f.key,
            size: f.size,
            contentType: contentTypeOf(f.name),
          },
        }),
      );
    }
    return created;
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

/** 另一个请求正在处理（处理中且未超时） */
function isActive(r: FeedbackReport): boolean {
  return r.status === 'pending' && Date.now() - r.receivedAt.getTime() < STALE_PENDING_MS;
}

/** 标题：APP 没传时取描述的第一句话，最多 60 个字 */
function titleOf(input: { title?: string; description: string }): string {
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
