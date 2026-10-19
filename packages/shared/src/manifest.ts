/**
 * APP 反馈 manifest.json 约定（方案 4.3 / 5.4）。
 * schemaVersion 升级时只加字段不删字段；未知字段保留不报错。
 */
import { z } from 'zod';

export const FEEDBACK_PREFIX = 'feedback/';
export const MANIFEST_FILE = 'manifest.json';

const attachmentSchema = z.object({
  key: z
    .string()
    .min(1)
    .refine((k) => !k.includes('/') && !k.includes('..'), '附件 key 只能是本目录下的文件名'),
  type: z.enum(['image', 'video', 'log', 'other']),
  size: z.number().int().nonnegative(),
  sha256: z.string().optional(),
});

export const feedbackManifestSchema = z.looseObject({
  schemaVersion: z.literal(1),
  reportId: z.uuid(),
  appId: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  description: z.string().max(20000).default(''),
  category: z.string().max(50).optional(),
  reproducible: z.enum(['ALWAYS', 'RANDOM', 'NEVER']).optional(),
  app: z.looseObject({
    version: z.string().min(1),
    build: z.string().optional(),
    commit: z.string().optional(),
    channel: z.string().optional(),
  }),
  device: z.record(z.string(), z.unknown()).default({}),
  context: z
    .looseObject({
      page: z.string().optional(),
      trail: z.array(z.string()).optional(),
      crashId: z.string().nullable().optional(),
    })
    .default({}),
  user: z.looseObject({ uidHash: z.string().optional() }).default({}),
  attachments: z.array(attachmentSchema).max(20).default([]),
  createdAt: z.iso.datetime({ offset: true }),
});

export type FeedbackManifest = z.infer<typeof feedbackManifestSchema>;

/**
 * 解析 COS 对象 key：feedback/{appId}/{yyyyMMdd}/{reportId}/manifest.json
 * 返回 null 表示不是合法的 manifest 路径。
 */
export function parseManifestKey(
  key: string,
): { appId: string; date: string; reportId: string; prefix: string } | null {
  const m = /^feedback\/([^/]+)\/(\d{8})\/([0-9a-fA-F-]{36})\/manifest\.json$/.exec(key);
  if (!m) return null;
  const [, appId, date, reportId] = m as unknown as [string, string, string, string];
  return { appId, date, reportId, prefix: `feedback/${appId}/${date}/${reportId}/` };
}

/** 构造某次反馈在 COS 上的目录前缀。 */
export function feedbackPrefix(appId: string, date: Date, reportId: string): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${FEEDBACK_PREFIX}${appId}/${y}${mo}${d}/${reportId}/`;
}
