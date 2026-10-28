import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/auth-user';
import { LocalStorage } from './local.storage';
import { OBJECT_STORAGE, contentTypeOf, type ObjectStorage } from './storage.types';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * 本地存储的签名上传 / 下载端点，仅在 STORAGE_DRIVER=local 时可用。
 * 鉴权靠 URL 上的 HMAC 签名，因此标记为 @Public。
 */
@Public()
@Controller('storage/local')
export class LocalStorageController {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  private local(): LocalStorage {
    if (!(this.storage instanceof LocalStorage)) throw new NotFoundException();
    return this.storage;
  }

  private keyOf(req: Request): string {
    const raw = req.path.split('/storage/local/')[1] ?? '';
    return raw.split('/').map(decodeURIComponent).join('/');
  }

  @Get('*path')
  async download(
    @Req() req: Request,
    @Res() res: Response,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
  ): Promise<void> {
    const storage = this.local();
    const key = this.keyOf(req);
    if (!storage.verify('get', key, exp, sig)) throw new ForbiddenException('链接无效或已过期');
    const head = await storage.headObject(key);
    if (!head) throw new NotFoundException();
    // sendFile 自带 Range（视频可拖动进度）、Last-Modified / ETag；
    // 读文件出错时走回调，不会因为流的 error 事件没人处理而让进程崩溃。
    // 只有图片、音视频在页面里直接打开，其他文件一律下载，不在平台域名下当网页渲染
    const type = contentTypeOf(key);
    const inline = /^(image|video|audio)\//.test(type);
    await new Promise<void>((resolve) => {
      res.sendFile(
        storage.filePath(key),
        {
          acceptRanges: true,
          lastModified: true,
          dotfiles: 'allow',
          cacheControl: false,
          headers: {
            'Cache-Control': 'private, max-age=300',
            'Content-Type': type,
            'X-Content-Type-Options': 'nosniff',
            ...(inline ? {} : { 'Content-Disposition': 'attachment' }),
          },
        },
        (err?: Error) => {
          if (err && !res.headersSent) res.status(404).end();
          resolve();
        },
      );
    });
  }

  @Put('*path')
  @HttpCode(200)
  async upload(
    @Req() req: Request,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
  ): Promise<{ key: string; size: number }> {
    const storage = this.local();
    const key = this.keyOf(req);
    if (!storage.verify('put', key, exp, sig)) throw new ForbiddenException('链接无效或已过期');
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_UPLOAD_BYTES) throw new BadRequestException('文件超过 200 MB');
    let size: number;
    try {
      size = await storage.writeStream(key, req, MAX_UPLOAD_BYTES, declared || undefined);
    } catch (err) {
      throw new BadRequestException(`上传失败：${(err as Error).message}`);
    }
    return { key, size };
  }
}
