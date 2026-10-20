import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { setTestEnv } from './helpers';

/** 其他测试里不限流（NODE_ENV=test）；这里单独起一个开启限流的应用 */
describe('rate limiting (e2e)', () => {
  let app: INestApplication;
  const saved = { NODE_ENV: process.env.NODE_ENV, AUTH: process.env.AUTH_RATE_LIMIT_PER_MINUTE };

  beforeAll(async () => {
    setTestEnv();
    process.env.NODE_ENV = 'development';
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.AUTH === undefined) delete process.env.AUTH_RATE_LIMIT_PER_MINUTE;
    else process.env.AUTH_RATE_LIMIT_PER_MINUTE = saved.AUTH;
  });

  it('limits repeated login attempts from the same IP', async () => {
    const http = request(app.getHttpServer());
    const attempt = () =>
      http.post('/api/v1/auth/login').send({ account: 'nobody', password: 'wrong-password' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    // 其他接口不受登录限流影响
    expect((await http.get('/api/v1/health')).status).toBe(200);
  });
});
