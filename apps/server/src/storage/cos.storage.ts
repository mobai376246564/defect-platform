import { createWriteStream } from 'node:fs';
import COS from 'cos-nodejs-sdk-v5';
import STS from 'qcloud-cos-sts';
import {
  assertSafeKey,
  type ObjectStorage,
  type StoredObject,
  type UploadTarget,
} from './storage.types';

export interface CosConfig {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  appId: string;
}

/** 腾讯云 COS 存储。使用平台专用子账号 defect-platform（方案 5.4 ②）。 */
export class CosStorage implements ObjectStorage {
  readonly driver = 'cos' as const;
  private readonly cos: COS;

  constructor(private readonly cfg: CosConfig) {
    this.cos = new COS({ SecretId: cfg.secretId, SecretKey: cfg.secretKey });
  }

  private base(key: string) {
    return { Bucket: this.cfg.bucket, Region: this.cfg.region, Key: assertSafeKey(key) };
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.cos.getObject(this.base(key));
    return res.Body;
  }

  async downloadToFile(key: string, dest: string): Promise<void> {
    // SDK 的 Output 参数把响应流直接写入文件
    await this.cos.getObject({ ...this.base(key), Output: createWriteStream(dest) });
  }

  async headObject(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.cos.headObject(this.base(key));
      const headers = (res.headers ?? {}) as Record<string, string>;
      return {
        size: Number(headers['content-length'] ?? 0),
        contentType: headers['content-type'],
      };
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }

  async putObject(key: string, body: Buffer, contentType?: string): Promise<void> {
    await this.cos.putObject({ ...this.base(key), Body: body, ContentType: contentType });
  }

  async deleteObjects(keys: string[]): Promise<void> {
    // 批量删除接口一次最多 1000 个
    for (let i = 0; i < keys.length; i += 1000) {
      await this.cos.deleteMultipleObject({
        Bucket: this.cfg.bucket,
        Region: this.cfg.region,
        Objects: keys.slice(i, i + 1000).map((k) => ({ Key: assertSafeKey(k) })),
        Quiet: true,
      });
    }
  }

  async listKeys(
    prefix: string,
    opts: { suffix?: string; limit?: number; olderThan?: Date } = {},
  ): Promise<string[]> {
    const out: string[] = [];
    let marker: string | undefined;
    for (;;) {
      const res = await this.cos.getBucket({
        Bucket: this.cfg.bucket,
        Region: this.cfg.region,
        Prefix: assertSafeKey(prefix),
        Marker: marker,
        MaxKeys: 1000,
      });
      for (const obj of res.Contents ?? []) {
        const old = !opts.olderThan || new Date(obj.LastModified) < opts.olderThan;
        if (old && (!opts.suffix || obj.Key.endsWith(opts.suffix))) out.push(obj.Key);
        if (opts.limit && out.length >= opts.limit) return out;
      }
      const page = res as unknown as { IsTruncated?: string; NextMarker?: string };
      if (page.IsTruncated !== 'true' || !page.NextMarker) return out;
      marker = page.NextMarker;
    }
  }

  async presignGet(key: string, expiresSec = 600): Promise<string> {
    return this.cos.getObjectUrl({ ...this.base(key), Sign: true, Expires: expiresSec });
  }

  async createUploadTarget(
    prefix: string,
    _fileNames: string[],
    expiresSec = 1800,
  ): Promise<UploadTarget> {
    const safePrefix = assertSafeKey(prefix);
    const resource = `qcs::cos:${this.cfg.region}:uid/${this.cfg.appId}:${this.cfg.bucket}/${safePrefix}*`;
    const res = await STS.getCredential({
      secretId: this.cfg.secretId,
      secretKey: this.cfg.secretKey,
      durationSeconds: expiresSec,
      policy: {
        version: '2.0',
        statement: [
          {
            effect: 'allow',
            action: [
              'name/cos:PutObject',
              'name/cos:InitiateMultipartUpload',
              'name/cos:ListMultipartUploads',
              'name/cos:ListParts',
              'name/cos:UploadPart',
              'name/cos:CompleteMultipartUpload',
            ],
            resource: [resource],
          },
        ],
      },
    });
    return {
      driver: 'cos',
      prefix: safePrefix,
      expiresAt: res.expiredTime,
      cos: {
        bucket: this.cfg.bucket,
        region: this.cfg.region,
        credentials: res.credentials,
        startTime: res.startTime,
      },
    };
  }
}
