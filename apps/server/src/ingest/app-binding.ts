import { BadRequestException } from '@nestjs/common';
import type { Project } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/** 绑定关键字最短长度，太短（如 “a”）会误匹配几乎所有 APP */
export const APP_KEYWORD_MIN_LENGTH = 3;

/**
 * APP 标识绑定：项目里填完整包名或关键字（如 BudBox），APP 提单的 appId 包含其中一项即匹配，不区分大小写。
 * 一个 APP 有多个渠道包名时填一个共同的关键字即可。
 * 多个项目都匹配时取匹配到的最长那一项（更具体的优先，如单独绑定的某个渠道包名）；一样长时无法判断，拒绝提单。
 */
export function matchAppBinding<P extends Pick<Project, 'name' | 'appIds'>>(
  projects: P[],
  appId: string,
): { project: P } | { ambiguous: string[] } | null {
  const target = appId.toLowerCase();
  let best: { length: number; projects: P[] } | null = null;
  for (const project of projects) {
    const length = Math.max(
      0,
      ...project.appIds.filter((k) => target.includes(k.toLowerCase())).map((k) => k.length),
    );
    if (!length) continue;
    if (!best || length > best.length) best = { length, projects: [project] };
    else if (length === best.length) best.projects.push(project);
  }
  if (!best) return null;
  if (best.projects.length > 1) return { ambiguous: best.projects.map((p) => p.name) };
  return { project: best.projects[0]! };
}

/** 按 APP 标识找到要建单的项目；没绑定或无法判断时抛出给 APP 看的提示 */
export async function projectOfApp(prisma: PrismaService, appId: string): Promise<Project> {
  // 绑定了 APP 的项目只有几个，全部取出在内存里匹配
  const projects = await prisma.project.findMany({ where: { NOT: { appIds: { isEmpty: true } } } });
  const match = matchAppBinding(projects, appId);
  if (!match) {
    throw new BadRequestException(
      `APP 标识 ${appId} 还没有绑定到任何项目，请联系平台管理员在「项目设置 → APP 接入」中绑定`,
    );
  }
  if ('ambiguous' in match) {
    throw new BadRequestException(
      `APP 标识 ${appId} 同时匹配项目「${match.ambiguous.join('」「')}」的绑定，请联系平台管理员调整「项目设置 → APP 接入」`,
    );
  }
  return match.project;
}
