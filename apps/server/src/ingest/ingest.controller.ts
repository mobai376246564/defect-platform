import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../common/auth-user';
import { hmacSha256Hex, safeEqual } from '../common/crypto';
import { APP_ENV, type AppEnv } from '../config/env';
import { IngestService } from './ingest.service';

/** 单个事件 { key, ... } 或批量 { events: [{ key, ... }] } */
const eventSchema = z
  .object({
    key: z.string().min(1).optional(),
    events: z
      .array(z.object({ key: z.string().min(1) }).loose())
      .min(1)
      .max(100)
      .optional(),
  })
  .loose()
  .refine((d) => d.key || d.events, '缺少 key 或 events');

const MAX_SKEW_SECONDS = 300;

/**
 * 接收 SCF 转发的 COS 上传事件（方案 5.4 ③）。
 * 鉴权：X-Signature = HMAC-SHA256(INGEST_HMAC_SECRET, `${X-Timestamp}.${原始请求体}`)，时间偏差不超过 5 分钟。
 */
@Public()
@Controller('ingest')
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  @Post('cos-event')
  @HttpCode(200)
  async cosEvent(@Req() req: RawBodyRequest<Request>) {
    this.verifySignature(req);
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestException('事件格式错误');
    const keys = parsed.data.events?.map((e) => e.key) ?? [parsed.data.key!];
    const results = [];
    for (const key of keys) results.push({ key, ...(await this.ingest.handleManifestKey(key)) });
    return { results };
  }

  private verifySignature(req: RawBodyRequest<Request>): void {
    const ts = String(req.headers['x-timestamp'] ?? '');
    const sig = String(req.headers['x-signature'] ?? '');
    const raw = req.rawBody?.toString('utf8') ?? '';
    const tsNum = Number(ts);
    if (!ts || !sig || !Number.isFinite(tsNum)) throw new UnauthorizedException('缺少签名');
    if (Math.abs(Date.now() / 1000 - tsNum) > MAX_SKEW_SECONDS)
      throw new UnauthorizedException('签名已过期');
    if (!safeEqual(sig, hmacSha256Hex(this.env.INGEST_HMAC_SECRET, `${ts}.${raw}`))) {
      throw new UnauthorizedException('签名错误');
    }
  }
}
