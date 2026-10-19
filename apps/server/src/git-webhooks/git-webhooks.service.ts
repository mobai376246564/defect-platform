import type { IncomingHttpHeaders } from 'node:http';
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { WorkflowDefinition } from '@defect/shared';
import { DefectsService } from '../defects/defects.service';
import type { LinkInput } from '../defects/defects.dto';
import type { Project } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../projects/project-access.service';
import { findDefectCodes } from './defect-refs';
import type { GitEvent, GitProvider } from './git-provider';
import { githubProvider } from './github.provider';
import { gitlabProvider } from './gitlab.provider';

/** 已支持的平台；新增腾讯工蜂等平台时在此追加适配器 */
export const GIT_PROVIDERS: GitProvider[] = [githubProvider, gitlabProvider];

/** MR 合并时执行的工作流流转（默认工作流：待代码审核 → 已解决） */
export const MERGE_TRANSITION = 'merged';

export interface WebhookResult {
  provider: string;
  event: string;
  ignored?: boolean;
  linked: { code: string; kind: LinkInput['kind']; target: string }[];
  transitioned: string[];
}

/**
 * Git 平台 Webhook（方案 7.7 回写与追溯）：
 * 按分支名、提交信息、MR 标题识别缺陷编号并关联 branch / commit / mr；
 * MR 合并时把处于“待代码审核”的缺陷以系统身份流转为“已解决”。
 */
@Injectable()
export class GitWebhooksService {
  private readonly logger = new Logger(GitWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defects: DefectsService,
  ) {}

  async receive(
    projectKey: string,
    headers: IncomingHttpHeaders,
    rawBody: Buffer,
    body: unknown,
  ): Promise<WebhookResult> {
    const provider = GIT_PROVIDERS.find((p) => p.matches(headers));
    if (!provider) throw new BadRequestException('无法识别的 Webhook 来源');
    const project = await this.prisma.project.findUnique({
      where: { key: projectKey.toUpperCase() },
    });
    // 项目不存在、未配置密钥与签名错误统一返回 401，不泄露项目是否存在
    if (!project?.webhookSecret || !provider.verify(headers, rawBody, project.webhookSecret)) {
      throw new UnauthorizedException('签名错误');
    }
    const result: WebhookResult = {
      provider: provider.name,
      event: provider.eventName(headers),
      linked: [],
      transitioned: [],
    };
    const event = provider.parse(headers, unwrapForm(body));
    if (!event) return { ...result, ignored: true };
    await this.handle(project, event, result);
    return result;
  }

  private async handle(project: Project, event: GitEvent, result: WebhookResult): Promise<void> {
    const ctx: ProjectContext = {
      project,
      workflow: project.workflow as unknown as WorkflowDefinition,
      role: 'admin',
    };
    const key = project.key;

    if (event.kind === 'push') {
      const branchCodes = findDefectCodes(key, event.branch);
      const links: { code: string; link: LinkInput }[] = branchCodes.map((code) => ({
        code,
        link: { kind: 'branch', target: event.branch },
      }));
      for (const c of event.commits) {
        // 分支已指明缺陷时，分支上的每个提交都归属该缺陷
        for (const code of new Set([...findDefectCodes(key, c.message), ...branchCodes])) {
          links.push({ code, link: { kind: 'commit', target: c.sha } });
        }
      }
      for (const { code, link } of links) await this.link(ctx, code, link, result);
      return;
    }

    const fixVersion = event.merged ? await this.fixVersion(project) : null;
    for (const code of findDefectCodes(key, event.title, event.sourceBranch)) {
      const defect = await this.link(
        ctx,
        code,
        { kind: 'mr', target: event.url, state: event.state },
        result,
      );
      if (!defect || !event.merged) continue;
      // 只有工作流里存在从当前状态出发的“已合并”流转（默认即待代码审核）时才流转，其他状态只关联
      const canMerge = ctx.workflow.transitions.some(
        (t) => t.key === MERGE_TRANSITION && t.from === defect.status,
      );
      if (!canMerge) continue;
      // 填入当前迭代版本作为修复版本；已手动填过的不覆盖
      const setVersion = fixVersion && !defect.versionFixedId ? fixVersion : null;
      await this.defects.transition(
        ctx,
        { kind: 'system' },
        code,
        {
          transition: MERGE_TRANSITION,
          values: setVersion ? { versionFixedId: setVersion.id } : {},
          comment: setVersion
            ? `MR 已合并：${event.url}，修复版本 ${setVersion.name}`
            : `MR 已合并：${event.url}`,
        },
        'system',
      );
      result.transitioned.push(code);
    }
  }

  /** 项目设置里的“当前迭代版本”；未设置或版本已不属于本项目时返回 null，此时只流转不填版本 */
  private async fixVersion(project: Project): Promise<{ id: string; name: string } | null> {
    if (!project.fixVersionId) return null;
    return this.prisma.version.findFirst({
      where: { id: project.fixVersionId, projectId: project.id },
      select: { id: true, name: true },
    });
  }

  /** 关联到缺陷；缺陷不存在时跳过，已有相同关联时不重复写历史（平台会重复投递、MR 每次更新都会推送）。 */
  private async link(
    ctx: ProjectContext,
    code: string,
    link: LinkInput,
    result: WebhookResult,
  ): Promise<{ id: string; status: string; versionFixedId: string | null } | null> {
    const defect = await this.prisma.defect.findFirst({
      where: { projectId: ctx.project.id, code, deletedAt: null },
      select: { id: true, status: true, versionFixedId: true },
    });
    if (!defect) {
      this.logger.debug(`Webhook 引用的缺陷 ${code} 不存在，忽略`);
      return null;
    }
    const existing = await this.prisma.defectLink.findUnique({
      where: {
        defectId_kind_target: { defectId: defect.id, kind: link.kind, target: link.target },
      },
    });
    if (!existing || existing.state !== (link.state ?? null)) {
      await this.defects.addLink(ctx, { kind: 'system' }, code, link, 'system');
      result.linked.push({ code, kind: link.kind, target: link.target });
    }
    return defect;
  }
}

/** GitHub 选择 application/x-www-form-urlencoded 时，事件 JSON 放在 payload 字段里 */
function unwrapForm(body: unknown): unknown {
  if (
    body &&
    typeof body === 'object' &&
    typeof (body as { payload?: unknown }).payload === 'string'
  ) {
    try {
      return JSON.parse((body as { payload: string }).payload);
    } catch {
      return null;
    }
  }
  return body;
}
