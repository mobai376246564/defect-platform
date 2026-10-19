import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, createUser, type TestContext } from './helpers';

describe('auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('rejects anonymous requests and wrong passwords', async () => {
    await ctx.http.get('/api/v1/projects').expect(401);
    await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: 'x' })
      .expect(401);
  });

  it('exposes the health check without login', async () => {
    const res = await ctx.http.get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('logs in and returns the current user', async () => {
    const u = await createUser(ctx, { name: '小王' });
    const me = await ctx.http.get('/api/v1/auth/me').set(auth(u.token)).expect(200);
    expect(me.body).toMatchObject({ id: u.id, name: '小王', via: 'jwt' });
  });

  it('issues personal API tokens that work once and can be revoked', async () => {
    const u = await createUser(ctx);
    const created = await ctx.http
      .post('/api/v1/auth/tokens')
      .set(auth(u.token))
      .send({ name: 'Claude Code' })
      .expect(201);
    const apiToken = created.body.token as string;
    expect(apiToken).toMatch(/^dp_/);

    const me = await ctx.http.get('/api/v1/auth/me').set(auth(apiToken)).expect(200);
    expect(me.body.via).toBe('token');

    const list = await ctx.http.get('/api/v1/auth/tokens').set(auth(u.token)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty('tokenHash');

    await ctx.http.delete(`/api/v1/auth/tokens/${created.body.id}`).set(auth(u.token)).expect(204);
    await ctx.http.get('/api/v1/auth/me').set(auth(apiToken)).expect(401);
  });

  it('blocks REST writes with a read-only token', async () => {
    const u = await createUser(ctx);
    const created = await ctx.http
      .post('/api/v1/auth/tokens')
      .set(auth(u.token))
      .send({ name: 'ro', readOnly: true })
      .expect(201);
    await ctx.http.get('/api/v1/projects').set(auth(created.body.token)).expect(200);
    await ctx.http
      .post('/api/v1/auth/tokens')
      .set(auth(created.body.token))
      .send({ name: 'x' })
      .expect(403);
  });
});
