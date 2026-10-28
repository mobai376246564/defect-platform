/** 浏览器 / APP 直传附件所需的信息。 */
export interface UploadTarget {
  driver: 'local' | 'cos';
  /** 本次上传允许写入的目录 */
  prefix: string;
  /** 凭证过期时间（Unix 秒） */
  expiresAt: number;
  /** driver=cos：用 STS 临时密钥 + COS SDK 直传 */
  cos?: {
    bucket: string;
    region: string;
    credentials: { tmpSecretId: string; tmpSecretKey: string; sessionToken: string };
    startTime: number;
  };
  /** driver=local：逐个文件的签名 PUT 地址 */
  uploads?: { name: string; key: string; url: string }[];
}

export interface StoredObject {
  size: number;
  contentType?: string;
}

/**
 * 对象存储抽象。生产用腾讯云 COS，本地开发用磁盘目录；
 * 业务代码只依赖这个接口，便于测试与切换。
 */
export interface ObjectStorage {
  readonly driver: 'local' | 'cos';
  getObject(key: string): Promise<Buffer>;
  /** 把对象写到本地文件（大文件如录屏用它，不整个读进内存） */
  downloadToFile(key: string, dest: string): Promise<void>;
  headObject(key: string): Promise<StoredObject | null>;
  putObject(key: string, body: Buffer, contentType?: string): Promise<void>;
  /** 把本地文件写入存储（APP 提单的录屏等大文件，不整个读进内存） */
  putFile(key: string, localPath: string, contentType?: string): Promise<void>;
  /** 删除对象（不存在的忽略），清理任务用 */
  deleteObjects(keys: string[]): Promise<void>;
  /** 列出某前缀下的对象 key；suffix 用于过滤（如 manifest.json），olderThan 只列出在该时间之前写入的 */
  listKeys(
    prefix: string,
    opts?: { suffix?: string; limit?: number; olderThan?: Date },
  ): Promise<string[]>;
  /** 生成限时下载地址 */
  presignGet(key: string, expiresSec?: number): Promise<string>;
  /** 为某目录生成上传凭证，只允许写入该目录 */
  createUploadTarget(
    prefix: string,
    fileNames: string[],
    expiresSec?: number,
  ): Promise<UploadTarget>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** 校验对象 key，拒绝目录穿越与绝对路径。 */
export function assertSafeKey(key: string): string {
  const normalized = key.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => part === '..' || part === '.') ||
    normalized.includes('\0')
  ) {
    throw new Error(`非法的对象 key：${key}`);
  }
  return normalized;
}

/** 生成存储用的安全文件名：保留扩展名，去掉路径与特殊字符。 */
export function safeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const cleaned = base.replace(/[^\w.\-一-龥]+/g, '_').replace(/^\.+/, '');
  return cleaned.slice(-120) || 'file';
}
