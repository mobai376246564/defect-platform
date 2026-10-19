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
import { OBJECT_STORAGE, type ObjectStorage } from './storage.types';

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
    res.setHeader('Content-Length', String(head.size));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.type(key.split('.').pop() ?? 'application/octet-stream');
    storage.createReadStream(key).pipe(res);
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
    const size = await storage.writeStream(key, req, MAX_UPLOAD_BYTES);
    return { key, size };
  }
}
