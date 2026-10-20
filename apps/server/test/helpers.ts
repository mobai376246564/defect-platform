import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { CLASSIC_WORKFLOW } from '@defect/shared';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

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
  // 环境变量在模块编译（ConfigModule 的工厂执行）时才读取，所以先设置再编译
  const storageDir = setTestEnv();
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
  opts: { name?: string; isSystemAdmin?: boolean; position?: string } = {},
): Promise<{ id: string; username: string; email: string; token: string }> {
  const prisma = ctx.app.get(PrismaService);
  const username = `user${Date.now()}${seq++}`;
  const email = `${username}@test.local`;
  const password = 'Passw0rd!';
  const user = await prisma.user.create({
    data: {
      username,
      email,
      name: opts.name ?? email,
      position: opts.position ?? 'other',
      isSystemAdmin: opts.isSystemAdmin ?? false,
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  const res = await ctx.http.post('/api/v1/auth/login').send({ email, password }).expect(200);
  return { id: user.id, username, email, token: res.body.accessToken as string };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** 生成不重复的项目标识（每个测试文件用自己的项目，互不干扰） */
export function projectKey(prefix: string): string {
  return `${prefix}${String(Date.now()).slice(-5)}${seq++}`.toUpperCase().slice(0, 10);
}

/**
 * 把项目切换到经典工作流（严格流转：确认 → 开始处理 → 提交审核 → 已合并 → 验证）。
 * 新项目默认是自由流转；依赖经典流程的测试在建项目后调用，继续覆盖严格模式。
 */
export async function useClassicWorkflow(ctx: TestContext, key: string, token: string) {
  await ctx.http
    .put(`/api/v1/projects/${key}/workflow`)
    .set(auth(token))
    .send(CLASSIC_WORKFLOW)
    .expect(200);
}
