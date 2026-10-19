import { z } from 'zod';
import { hmacSha256Hex, safeEqual } from '../common/crypto';
import { branchOf, header, type GitEvent, type GitProvider } from './git-provider';

const pushSchema = z.object({
  ref: z.string(),
  deleted: z.boolean().optional(),
  commits: z
    .array(z.object({ id: z.string(), message: z.string(), url: z.string().optional() }).loose())
    .default([]),
});

const pullRequestSchema = z.object({
  action: z.string(),
  pull_request: z
    .object({
      title: z.string(),
      html_url: z.string(),
      state: z.string(),
      merged: z.boolean().nullish(),
      merge_commit_sha: z.string().nullish(),
      head: z.object({ ref: z.string() }).loose(),
    })
    .loose(),
});

/**
 * GitHub：X-GitHub-Event 区分事件，X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(secret, 原始请求体)。
 * 支持 push 与 pull_request，其他事件（含创建 Webhook 时的 ping）忽略。
 */
export const githubProvider: GitProvider = {
  name: 'github',

  matches: (headers) => !!header(headers, 'x-github-event'),

  verify(headers, rawBody, secret) {
    const sig = header(headers, 'x-hub-signature-256');
    const expected = `sha256=${hmacSha256Hex(secret, rawBody)}`;
    return !!sig && safeEqual(sig, expected);
  },

  eventName: (headers) => header(headers, 'x-github-event'),

  parse(headers, body): GitEvent | null {
    switch (header(headers, 'x-github-event')) {
      case 'push': {
        const p = pushSchema.safeParse(body);
        const branch = p.success ? branchOf(p.data.ref) : null;
        if (!p.success || !branch || p.data.deleted) return null;
        return {
          kind: 'push',
          branch,
          commits: p.data.commits.map((c) => ({ sha: c.id, message: c.message, url: c.url })),
        };
      }
      case 'pull_request': {
        const p = pullRequestSchema.safeParse(body);
        if (!p.success) return null;
        const pr = p.data.pull_request;
        const merged = p.data.action === 'closed' && pr.merged === true;
        return {
          kind: 'merge_request',
          title: pr.title,
          url: pr.html_url,
          state: merged ? 'merged' : pr.state === 'open' ? 'opened' : pr.state,
          merged,
          sourceBranch: pr.head.ref,
          mergeCommitSha: merged ? pr.merge_commit_sha : null,
        };
      }
      default:
        return null;
    }
  },
};
