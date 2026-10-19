import type { IncomingHttpHeaders } from 'node:http';

/** 推送事件：一个分支上新增的提交 */
export interface GitPushEvent {
  kind: 'push';
  branch: string;
  commits: { sha: string; message: string; url?: string }[];
}

/** MR / PR 事件，merged 表示本次事件就是“合并”动作 */
export interface GitMergeRequestEvent {
  kind: 'merge_request';
  title: string;
  url: string;
  /** 链接上记录的状态：opened / merged / closed */
  state: string;
  merged: boolean;
  sourceBranch: string;
  mergeCommitSha?: string | null;
}

/** 平台无关的事件；null 表示无需处理（ping、tag 推送、删除分支、其他事件类型） */
export type GitEvent = GitPushEvent | GitMergeRequestEvent;

/**
 * 一个 Git 托管平台的适配器。新增平台（如腾讯工蜂）时实现该接口并加入 GIT_PROVIDERS 即可。
 */
export interface GitProvider {
  readonly name: string;
  /** 根据请求头判断是否为该平台发来的 Webhook */
  matches(headers: IncomingHttpHeaders): boolean;
  /** 按平台约定校验签名或 Token */
  verify(headers: IncomingHttpHeaders, rawBody: Buffer, secret: string): boolean;
  /** 事件类型名，用于日志与响应 */
  eventName(headers: IncomingHttpHeaders): string;
  parse(headers: IncomingHttpHeaders, body: unknown): GitEvent | null;
}

export function header(headers: IncomingHttpHeaders, name: string): string {
  const v = headers[name.toLowerCase()];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

export function branchOf(ref: unknown): string | null {
  return typeof ref === 'string' && ref.startsWith('refs/heads/')
    ? ref.slice('refs/heads/'.length)
    : null;
}
