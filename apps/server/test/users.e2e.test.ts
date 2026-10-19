import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, createUser, type TestContext } from './helpers';

describe('admin users (e2e)', () => {
  let ctx: TestContext;
  let admin: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createUser(ctx, { isSystemAdmin: true });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const login = (email: string, password: string) =>
    ctx.http.post('/api/v1/auth/login').send({ email, password });

  it('only lets system admins manage users', async () => {
    const u = await createUser(ctx);
    await ctx.http.get('/api/v1/admin/users').set(auth(u.token)).expect(403);
    await ctx.http
      .patch(`/api/v1/admin/users/${u.id}`)
      .set(auth(u.token))
      .send({ isSystemAdmin: true })
      .expect(403);
    await ctx.http
      .post(`/api/v1/admin/users/${u.id}/password`)
      .set(auth(u.token))
      .send({ password: 'whatever123' })
      .expect(403);
  });

  it('creates a user who can then log in, and lists without password hashes', async () => {
    const email = `New${Date.now()}@Test.local`;
    await ctx.http
      .post('/api/v1/admin/users')
      .set(auth(admin.token))
      .send({ email, name: '新同学', password: 'short' })
      .expect(400);
    const created = await ctx.http
      .post('/api/v1/admin/users')
      .set(auth(admin.token))
      .send({ email, name: '新同学', password: 'initPass123' })
      .expect(201);
    expect(created.body.email).toBe(email.toLowerCase());
    await ctx.http
      .post('/api/v1/admin/users')
      .set(auth(admin.token))
      .send({ email, name: '重复', password: 'initPass123' })
      .expect(409);
    await login(email, 'initPass123').expect(200);

    const list = await ctx.http.get('/api/v1/admin/users').set(auth(admin.token)).expect(200);
    const row = (list.body as Array<Record<string, unknown>>).find((r) => r.id === created.body.id);
    expect(row).toMatchObject({ name: '新同学', isSystemAdmin: false, disabledAt: null });
    expect(row).not.toHaveProperty('passwordHash');
  });

  it('updates name and system admin flag', async () => {
    const u = await createUser(ctx);
    const res = await ctx.http
      .patch(`/api/v1/admin/users/${u.id}`)
      .set(auth(admin.token))
      .send({ name: '改名了', isSystemAdmin: true })
      .expect(200);
    expect(res.body).toMatchObject({ id: u.id, name: '改名了', isSystemAdmin: true });
    // 管理员身份每次请求从库里读取，立即生效
    await ctx.http.get('/api/v1/admin/users').set(auth(u.token)).expect(200);

    await ctx.http
      .patch('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
      .set(auth(admin.token))
      .send({ name: 'x' })
      .expect(404);
    await ctx.http
      .patch('/api/v1/admin/users/not-a-uuid')
      .set(auth(admin.token))
      .send({ name: 'x' })
      .expect(400);
  });

  it('resets another user password', async () => {
    const u = await createUser(ctx);
    await ctx.http
      .post(`/api/v1/admin/users/${u.id}/password`)
      .set(auth(admin.token))
      .send({ password: '1234567' })
      .expect(400);
    await ctx.http
      .post(`/api/v1/admin/users/${u.id}/password`)
      .set(auth(admin.token))
      .send({ password: 'resetPass99' })
      .expect(204);
    await login(u.email, 'Passw0rd!').expect(401);
    await login(u.email, 'resetPass99').expect(200);
  });

  it('disables an account: login, JWT and API tokens are rejected until re-enabled', async () => {
    const u = await createUser(ctx);
    const created = await ctx.http
      .post('/api/v1/auth/tokens')
      .set(auth(u.token))
      .send({ name: 'Claude Code' })
      .expect(201);
    const apiToken = created.body.token as string;

    const res = await ctx.http
      .patch(`/api/v1/admin/users/${u.id}`)
      .set(auth(admin.token))
      .send({ disabled: true })
      .expect(200);
    expect(res.body.disabledAt).not.toBeNull();

    await login(u.email, 'Passw0rd!').expect(401);
    await ctx.http.get('/api/v1/auth/me').set(auth(u.token)).expect(401);
    await ctx.http.get('/api/v1/auth/me').set(auth(apiToken)).expect(401);

    await ctx.http
      .patch(`/api/v1/admin/users/${u.id}`)
      .set(auth(admin.token))
      .send({ disabled: false })
      .expect(200);
    await login(u.email, 'Passw0rd!').expect(200);
    await ctx.http.get('/api/v1/auth/me').set(auth(apiToken)).expect(200);
  });

  it('refuses to demote or disable yourself', async () => {
    await ctx.http
      .patch(`/api/v1/admin/users/${admin.id}`)
      .set(auth(admin.token))
      .send({ isSystemAdmin: false })
      .expect(400);
    await ctx.http
      .patch(`/api/v1/admin/users/${admin.id}`)
      .set(auth(admin.token))
      .send({ disabled: true })
      .expect(400);
    // 改自己的姓名不受限制
    await ctx.http
      .patch(`/api/v1/admin/users/${admin.id}`)
      .set(auth(admin.token))
      .send({ name: '管理员', isSystemAdmin: true, disabled: false })
      .expect(200);
    await ctx.http.get('/api/v1/admin/users').set(auth(admin.token)).expect(200);
  });
});
