import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { FREQUENCY, type Frequency } from '@defect/shared';
import { z } from 'zod';
import { Public } from '../common/auth-user';
import {
  APP_FILE_MAX_BYTES,
  APP_MAX_FILES,
  IngestService,
  SEVERITY_KEYS,
  type AppDefectInput,
  type UploadedFile,
} from './ingest.service';

/** multipart 表单里的文本字段都是字符串；空字符串按未填处理 */
const text = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional(),
  );

const appDefectSchema = z.object({
  appId: z
    .string({ error: '缺少 appId（APP 标识）' })
    .trim()
    .min(1, '缺少 appId（APP 标识）')
    .max(200),
  description: z
    .string({ error: '缺少 description（缺陷描述）' })
    .trim()
    .min(1, '缺少 description（缺陷描述）')
    .max(20000),
  title: text(120),
  reportId: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.uuid('reportId 必须是 UUID').optional(),
  ),
  reporterName: text(50),
  severity: z.preprocess((v) => (v === '' ? undefined : v), z.enum(SEVERITY_KEYS).optional()),
  frequency: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(Object.keys(FREQUENCY) as [Frequency, ...Frequency[]]).optional(),
  ),
  steps: text(5000),
  appVersion: text(50),
  appBuild: text(50),
  appCommit: text(64),
  deviceModel: text(100),
  osVersion: text(100),
  page: text(200),
  /** 其他上下文，JSON 对象字符串，原样存到缺陷的设备信息里 */
  extra: z.preprocess(
    (v) => {
      if (typeof v !== 'string' || v.trim() === '') return undefined;
      try {
        return JSON.parse(v) as unknown;
      } catch {
        return v;
      }
    },
    z.record(z.string(), z.unknown(), { error: 'extra 必须是 JSON 对象' }).optional(),
  ),
});

const UPLOAD_DIR = path.join(tmpdir(), 'defect-app-uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const uploadOptions = {
  dest: UPLOAD_DIR,
  limits: { fileSize: APP_FILE_MAX_BYTES, files: APP_MAX_FILES, fieldSize: 1024 * 1024 },
  // 文件名按 UTF-8 解析，中文文件名不乱码
  defParamCharset: 'utf8',
} as MulterOptions;

interface MulterFile {
  originalname: string;
  path: string;
  size: number;
  mimetype?: string;
}

/**
 * APP 提单接口（docs/app-integration.md）：
 * POST /api/v1/app/defects，multipart/form-data，一次带上缺陷内容与截图 / 录屏 / 日志（字段名 files）。
 * 不需要登录：按 APP 标识（appId）找到绑定的项目，由 APP 端控制只有白名单用户能看到提单入口。
 */
@Public()
@Controller('app')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post('defects')
  @HttpCode(201)
  @UseInterceptors(FilesInterceptor('files', APP_MAX_FILES, uploadOptions))
  async create(@Body() body: unknown, @UploadedFiles() uploaded: MulterFile[] | undefined) {
    const files: UploadedFile[] = (uploaded ?? []).map((f) => ({
      originalName: f.originalname,
      path: f.path,
      size: f.size,
      mimeType: f.mimetype,
    }));
    try {
      const parsed = appDefectSchema.safeParse(body ?? {});
      if (!parsed.success) {
        throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('；'));
      }
      return await this.ingest.submit(parsed.data as AppDefectInput, files);
    } finally {
      // 临时文件已复制到对象存储（或请求失败），都删掉
      await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
    }
  }
}
