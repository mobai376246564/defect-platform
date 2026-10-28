import { createReadStream, createWriteStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { hmacSha256Hex, safeEqual } from '../common/crypto';
import {
  assertSafeKey,
  safeFileName,
  type ObjectStorage,
  type StoredObject,
  type UploadTarget,
} from './storage.types';

/**
 * 本地磁盘存储，仅用于开发与测试。下载 / 上传地址用 HMAC 签名并限时，
 * 行为上模拟 COS 的预签名 URL。
 */
export class LocalStorage implements ObjectStorage {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly secret: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = path.resolve(rootDir);
  }

  /** 对象在磁盘上的绝对路径（下载接口用 sendFile 直接发送，支持断点续传与拖动进度） */
  filePath(key: string): string {
    return this.fullPath(key);
  }

  private fullPath(key: string): string {
    const p = path.resolve(this.root, assertSafeKey(key));
    if (!p.startsWith(this.root + path.sep)) throw new Error(`非法的对象 key：${key}`);
    return p;
  }

  async getObject(key: string): Promise<Buffer> {
    return readFile(this.fullPath(key));
  }

  async downloadToFile(key: string, dest: string): Promise<void> {
    // 支持时用写时复制（APFS / btrfs），否则普通复制
    await copyFile(this.fullPath(key), dest, constants.COPYFILE_FICLONE);
  }

  createReadStream(key: string): Readable {
    return createReadStream(this.fullPath(key));
  }

  async headObject(key: string): Promise<StoredObject | null> {
    try {
      const s = await stat(this.fullPath(key));
      return s.isFile() ? { size: s.size } : null;
    } catch {
      return null;
    }
  }

  async putObject(key: string, body: Buffer): Promise<void> {
    const p = this.fullPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async putFile(key: string, localPath: string): Promise<void> {
    // 先复制到同目录的临时文件再改名：复制中途失败不会留下残缺的“已上传”文件
    const p = this.fullPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.part-${randomBytes(4).toString('hex')}`;
    try {
      await copyFile(localPath, tmp, constants.COPYFILE_FICLONE);
      await rename(tmp, p);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  /**
   * 流式写入：先写到同目录的临时文件，完整收到（且与声明的大小一致）后再改名，
   * 上传中断或超限时删除临时文件，不会留下被当成“已上传”的残缺文件。
   */
  async writeStream(
    key: string,
    stream: Readable,
    maxBytes: number,
    expectedBytes?: number,
  ): Promise<number> {
    const p = this.fullPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.part-${randomBytes(4).toString('hex')}`;
    let total = 0;
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) stream.destroy(new Error('文件超过大小限制'));
    });
    try {
      await pipeline(stream, createWriteStream(tmp));
      if (expectedBytes && total !== expectedBytes) {
        throw new Error(`上传不完整：收到 ${total} 字节，应为 ${expectedBytes} 字节`);
      }
      await rename(tmp, p);
      return total;
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  async deleteObjects(keys: string[]): Promise<void> {
    for (const key of keys) await rm(this.fullPath(key), { force: true });
  }

  async listKeys(prefix: string, opts: { olderThan?: Date } = {}): Promise<string[]> {
    const safe = assertSafeKey(prefix);
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else {
          const key = path.relative(this.root, full).split(path.sep).join('/');
          if (
            key.startsWith(safe) &&
            (!opts.olderThan || (await stat(full)).mtime < opts.olderThan)
          )
            out.push(key);
        }
      }
    };
    // 从前缀所在的最深目录开始遍历
    const dirPart = safe.includes('/') ? safe.slice(0, safe.lastIndexOf('/')) : '';
    await walk(path.join(this.root, dirPart));
    return out.sort();
  }

  async presignGet(key: string, expiresSec = 600): Promise<string> {
    return this.signedUrl('get', key, expiresSec);
  }

  async createUploadTarget(
    prefix: string,
    fileNames: string[],
    expiresSec = 1800,
  ): Promise<UploadTarget> {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresSec;
    return {
      driver: 'local',
      prefix,
      expiresAt,
      uploads: fileNames.map((name) => {
        const key = `${prefix}${safeFileName(name)}`;
        return { name, key, url: this.signedUrl('put', key, expiresSec) };
      }),
    };
  }

  /** 校验签名链接，供 LocalStorageController 使用。 */
  verify(op: 'get' | 'put', key: string, exp: string, sig: string): boolean {
    const expNum = Number(exp);
    if (!Number.isFinite(expNum) || expNum < Date.now() / 1000) return false;
    return safeEqual(sig, hmacSha256Hex(this.secret, `${op}:${key}:${exp}`));
  }

  private signedUrl(op: 'get' | 'put', key: string, expiresSec: number): string {
    const safe = assertSafeKey(key);
    const exp = String(Math.floor(Date.now() / 1000) + expiresSec);
    const sig = hmacSha256Hex(this.secret, `${op}:${safe}:${exp}`);
    const encoded = safe.split('/').map(encodeURIComponent).join('/');
    return `${this.publicBaseUrl}/api/v1/storage/local/${encoded}?op=${op}&exp=${exp}&sig=${sig}`;
  }
}
