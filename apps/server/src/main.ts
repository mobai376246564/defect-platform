import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { APP_ENV, type AppEnv } from './config/env';

// 本地开发读取 .env；生产环境由容器注入环境变量，不放 .env 文件
if (existsSync('.env')) process.loadEnvFile('.env');

async function bootstrap(): Promise<void> {
  // rawBody：COS 事件回调需要对原始请求体验签
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);
  const env = app.get<AppEnv>(APP_ENV);
  await app.listen(env.PORT, '0.0.0.0');
  Logger.log(`缺陷平台服务已启动：http://localhost:${env.PORT}/api/v1`, 'Bootstrap');
}

void bootstrap();
