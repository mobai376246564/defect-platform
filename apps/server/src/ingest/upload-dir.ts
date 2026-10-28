import { mkdirSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** APP 提单上传文件的临时目录：请求结束后文件即删除，进程异常退出时的残留由每日清理删掉 */
export const APP_UPLOAD_DIR = path.join(tmpdir(), 'defect-app-uploads');
mkdirSync(APP_UPLOAD_DIR, { recursive: true });

/** 删除临时目录里早于 olderThan 的残留文件，返回删除个数 */
export async function purgeStaleUploads(olderThan: Date): Promise<number> {
  let removed = 0;
  for (const name of await readdir(APP_UPLOAD_DIR).catch(() => [])) {
    const file = path.join(APP_UPLOAD_DIR, name);
    try {
      if ((await stat(file)).mtime < olderThan) {
        await unlink(file);
        removed++;
      }
    } catch {
      // 正被其他请求使用或已删除，跳过
    }
  }
  return removed;
}
