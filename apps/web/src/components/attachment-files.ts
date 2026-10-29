import { isAllowedAttachment } from '@defect/shared';
import type { PendingFile } from '../api/upload';

export const MAX_FILES = 10;
export const MAX_BYTES = 200 * 1024 * 1024;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 粘贴进来的图片：截图工具复制的图片在剪贴板里通常都叫 image.png（或没有扩展名），
 * 改成带时间的名字，便于区分；从文件夹复制的文件保留原名。
 */
export function namePasted(files: File[], now = new Date()): File[] {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return files.map((f, i) => {
    const generic = !f.name || /^image\.\w+$/i.test(f.name) || !f.name.includes('.');
    if (!generic) return f;
    const ext = f.type.startsWith('image/') ? f.type.slice(6).replace('jpeg', 'jpg') : 'png';
    const suffix = files.length > 1 ? `-${i + 1}` : '';
    return new File([f], `粘贴截图-${stamp}${suffix}.${ext}`, { type: f.type || 'image/png' });
  });
}

/** 把新文件加到待上传列表：跳过不支持的类型、超过 200 MB 的文件，总数最多 10 个 */
export function addFiles(
  current: PendingFile[],
  incoming: File[],
): { files: PendingFile[]; rejected: string[] } {
  const rejected: string[] = [];
  const accepted: PendingFile[] = [];
  for (const f of incoming) {
    if (!isAllowedAttachment(f.name)) rejected.push(`${f.name}（不支持的文件类型）`);
    else if (f.size > MAX_BYTES) rejected.push(`${f.name}（超过 200 MB）`);
    else accepted.push({ file: f });
  }
  const files = [...current, ...accepted];
  for (const extra of files.slice(MAX_FILES))
    rejected.push(`${extra.file.name}（最多 ${MAX_FILES} 个）`);
  return { files: files.slice(0, MAX_FILES), rejected };
}
