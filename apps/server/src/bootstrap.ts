import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_ENV, type AppEnv } from './config/env';

export const API_PREFIX = 'api/v1';

/** main.ts 与 e2e 测试共用的应用配置，保证测试环境与线上一致。 */
export function configureApp(app: INestApplication): void {
  const env = app.get<AppEnv>(APP_ENV);
  const express = app as NestExpressApplication;
  express.setGlobalPrefix(API_PREFIX);
  express.useBodyParser('json', { limit: '2mb' });
  express.enableCors({
    origin: env.WEB_ORIGIN.split(',').map((s) => s.trim()),
    credentials: false,
  });
  express.disable('x-powered-by');
  express.set('trust proxy', 1);
  app.enableShutdownHooks();
}
