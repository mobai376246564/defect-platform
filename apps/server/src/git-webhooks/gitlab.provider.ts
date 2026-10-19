import { z } from 'zod';
import { safeEqual } from '../common/crypto';
import { branchOf, header, type GitEvent, type GitProvider } from './git-provider';

const ZERO_SHA = /^0+$/;

const pushSchema = z.object({
  ref: z.string(),
  after: z.string().optional(),
  commits: z
    .array(z.object({ id: z.string(), message: z.string(), url: z.string().optional() }).loose())
    .default([]),
});

const mergeRequestSchema = z.object({
  object_attributes: z
    .object({
      title: z.string(),
      url: z.string(),
      state: z.string(),
      action: z.string().optional(),
      source_branch: z.string(),
      merge_commit_sha: z.string().nullish(),
    })
    .loose(),
});

/**
 * GitLab：X-Gitlab-Event 区分事件，X-Gitlab-Token 原样携带 Webhook 中填写的 Secret token。
 * 支持 Push Hook 与 Merge Request Hook，其他事件忽略。
 */
export const gitlabProvider: GitProvider = {
  name: 'gitlab',

  matches: (headers) => !!header(headers, 'x-gitlab-event'),

  verify(headers, _rawBody, secret) {
    const token = header(headers, 'x-gitlab-token');
    return !!token && safeEqual(token, secret);
  },

  eventName: (headers) => header(headers, 'x-gitlab-event'),

  parse(headers, body): GitEvent | null {
    switch (header(headers, 'x-gitlab-event')) {
      case 'Push Hook': {
        const p = pushSchema.safeParse(body);
        const branch = p.success ? branchOf(p.data.ref) : null;
        // after 全为 0 表示删除分支
        if (!p.success || !branch || ZERO_SHA.test(p.data.after ?? '')) return null;
        return {
          kind: 'push',
          branch,
          commits: p.data.commits.map((c) => ({ sha: c.id, message: c.message, url: c.url })),
        };
      }
      case 'Merge Request Hook': {
        const p = mergeRequestSchema.safeParse(body);
        if (!p.success) return null;
        const mr = p.data.object_attributes;
        const merged = mr.action === 'merge';
        return {
          kind: 'merge_request',
          title: mr.title,
          url: mr.url,
          state: mr.state,
          merged,
          sourceBranch: mr.source_branch,
          mergeCommitSha: merged ? mr.merge_commit_sha : null,
        };
      }
      default:
        return null;
    }
  },
};
