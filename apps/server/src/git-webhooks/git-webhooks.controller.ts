import { Controller, HttpCode, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/auth-user';
import { GitWebhooksService } from './git-webhooks.service';

/**
 * Git 平台 Webhook 入口（方案 7.7）：每个项目一个地址，GitHub / GitLab 共用，按请求头识别平台。
 * 鉴权由各平台的签名或 Token 完成（密钥在项目设置的“集成”中生成），不走登录。
 */
@Public()
@Controller('webhooks/git')
export class GitWebhooksController {
  constructor(private readonly webhooks: GitWebhooksService) {}

  @Post(':projectKey')
  @HttpCode(200)
  receive(@Param('projectKey') projectKey: string, @Req() req: RawBodyRequest<Request>) {
    return this.webhooks.receive(
      projectKey,
      req.headers,
      req.rawBody ?? Buffer.alloc(0),
      req.body as unknown,
    );
  }
}
