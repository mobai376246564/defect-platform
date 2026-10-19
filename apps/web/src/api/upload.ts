import { api } from './client';
import type { Attachment, UploadTarget } from './types';

export interface PendingFile {
  file: File;
  /** 视频中“问题出现”的时间点（毫秒） */
  markedAtMs?: number;
}

/**
 * 上传附件：向平台申请上传凭证 → 浏览器直传存储 → 登记到缺陷。
 * 存储为 COS 时用 STS 临时密钥直传，本地开发时 PUT 到签名地址。
 */
export async function uploadAttachments(
  projectKey: string,
  code: string,
  files: PendingFile[],
  onProgress?: (done: number, total: number) => void,
): Promise<Attachment[]> {
  if (files.length === 0) return [];
  const base = `/projects/${projectKey}/defects/${code}/attachments`;
  const target = await api<UploadTarget>(`${base}/upload-target`, {
    method: 'POST',
    body: { files: files.map((f) => ({ name: f.file.name, size: f.file.size })) },
  });

  const keys: string[] = [];
  if (target.driver === 'local') {
    for (const [i, f] of files.entries()) {
      const u = target.uploads![i]!;
      const res = await fetch(u.url, { method: 'PUT', body: f.file });
      if (!res.ok) throw new Error(`上传 ${f.file.name} 失败（${res.status}）`);
      keys.push(u.key);
      onProgress?.(i + 1, files.length);
    }
  } else {
    const { default: COS } = await import('cos-js-sdk-v5');
    const c = target.cos!;
    const cos = new COS({
      getAuthorization: (_opts, callback) =>
        callback({
          TmpSecretId: c.credentials.tmpSecretId,
          TmpSecretKey: c.credentials.tmpSecretKey,
          SecurityToken: c.credentials.sessionToken,
          StartTime: c.startTime,
          ExpiredTime: target.expiresAt,
        }),
    });
    for (const [i, f] of files.entries()) {
      const key = `${target.prefix}${safeName(f.file.name)}`;
      await cos.uploadFile({ Bucket: c.bucket, Region: c.region, Key: key, Body: f.file });
      keys.push(key);
      onProgress?.(i + 1, files.length);
    }
  }

  return api<Attachment[]>(base, {
    method: 'POST',
    body: {
      items: files.map((f, i) => ({ key: keys[i], name: f.file.name, markedAtMs: f.markedAtMs })),
    },
  });
}

/** 与服务端 safeFileName 保持一致 */
function safeName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const cleaned = base.replace(/[^\w.\-一-龥]+/g, '_').replace(/^\.+/, '');
  return cleaned.slice(-120) || 'file';
}
