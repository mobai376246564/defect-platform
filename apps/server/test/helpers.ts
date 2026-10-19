import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';

export const TEST_HMAC_SECRET = 'test-ingest-secret';

/** 测试环境变量：本地存储放临时目录，后台任务由测试手动驱动（RUN_WORKER=false）。 */
export function setTestEnv(): string {
  const storageDir = mkdtempSync(path.join(tmpdir(), 'defect-storage-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-0123456789',
    INGEST_HMAC_SECRET: TEST_HMAC_SECRET,
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: storageDir,
    LOCAL_STORAGE_SECRET: 'test-local-secret',
    PUBLIC_BASE_URL: 'http://localhost:3999',
    RUN_WORKER: 'false',
    RECONCILE_INTERVAL_MINUTES: '0',
  });
  return storageDir;
}

export interface TestContext {
  app: INestApplication;
  http: TestAgent;
  storageDir: string;
}

export async function createTestApp(): Promise<TestContext> {
  const storageDir = setTestEnv();
  // 必须在设置环境变量之后再加载应用模块
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  return { app, http: request(app.getHttpServer()), storageDir };
}

let seq = 0;

/** 直接写库创建用户，返回登录后的 token。 */
export async function createUser(
  ctx: TestContext,
  opts: { name?: string; isSystemAdmin?: boolean } = {},
): Promise<{ id: string; email: string; token: string }> {
  const { PrismaService } = await import('../src/prisma/prisma.service');
  const prisma = ctx.app.get(PrismaService);
  const email = `user${Date.now()}${seq++}@test.local`;
  const password = 'Passw0rd!';
  const user = await prisma.user.create({
    data: {
      email,
      name: opts.name ?? email,
      isSystemAdmin: opts.isSystemAdmin ?? false,
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  const res = await ctx.http.post('/api/v1/auth/login').send({ email, password }).expect(200);
  return { id: user.id, email, token: res.body.accessToken as string };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** 生成不重复的项目标识（每个测试文件用自己的项目，互不干扰） */
export function projectKey(prefix: string): string {
  return `${prefix}${String(Date.now()).slice(-5)}${seq++}`.toUpperCase().slice(0, 10);
}
