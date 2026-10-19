import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

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

  it('creates a user who can log in by account or email, and lists without password hashes', async () => {
    const username = `New${Date.now()}`;
    const email = `${username}@Test.local`;
    await ctx.http
      .post('/api/v1/admin/users')
      .set(auth(admin.token))
      .send({ username, email, name: '新同学', password: 'short' })
      .expect(400);
    await ctx.http
      .post('/api/v1/admin/users')
      .set(auth(admin.token))
      .send({ username: 'a b', name: '新同学', password: 'initPass123' })
      .expect(400);
    const created = await ctx.http
      .post('/api/v1/admin/users')
      .set(auth(admin.token))
      .send({ username, email, name: '新同学', position: 'design', password: 'initPass123' })
      .expect(201);
    expect(created.body).toMatchObject({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      position: 'design',
      status: 'active',
    });
    await ctx.http
      .post('/api/v1/admin/users')
      .set(auth(admin.token))
      .send({ username: username.toUpperCase(), name: '重复', password: 'initPass123' })
      .expect(409);
    await login(username.toUpperCase(), 'initPass123').expect(200);
    await login(email, 'initPass123').expect(200);

    // 邮箱选填
    await ctx.http
      .post('/api/v1/admin/users')
      .set(auth(admin.token))
      .send({ username: `${username}_2`, name: '无邮箱', password: 'initPass123' })
      .expect(201);

    const list = await ctx.http.get('/api/v1/admin/users').set(auth(admin.token)).expect(200);
    const row = (list.body as Array<Record<string, unknown>>).find((r) => r.id === created.body.id);
    expect(row).toMatchObject({ name: '新同学', isSystemAdmin: false, disabledAt: null });
    expect(row).not.toHaveProperty('passwordHash');
  });

  it('registers a pending account that can only log in after approval', async () => {
    const username = `reg${Date.now()}`;
    const register = (body: Record<string, unknown>) =>
      ctx.http.post('/api/v1/auth/register').send(body);

    await register({ username, password: 'regPass123' }).expect(400); // 缺职位
    await register({ username, password: 'regPass123', position: 'boss' }).expect(400);
    await register({ username, password: 'short', position: 'tester' }).expect(400);
    await register({ username: 'ab', password: 'regPass123', position: 'tester' }).expect(400);

    const res = await register({ username, password: 'regPass123', position: 'tester' }).expect(
      201,
    );
    expect(res.body).toMatchObject({ username, status: 'pending' });
    await register({
      username: username.toUpperCase(),
      password: 'x12345678',
      position: 'art',
    }).expect(409);

    // 待审核：密码正确也不能登录，并提示审核状态；密码错误仍按普通失败处理
    const pending = await login(username, 'regPass123').expect(403);
    expect(pending.body.message).toBe('账号待管理员审核');
    await login(username, 'wrongPass1').expect(401);

    const count = await ctx.http
      .get('/api/v1/admin/users/pending-count')
      .set(auth(admin.token))
      .expect(200);
    expect(count.body.count).toBeGreaterThanOrEqual(1);
    const list = await ctx.http.get('/api/v1/admin/users').set(auth(admin.token)).expect(200);
    const row = (list.body as Array<Record<string, unknown>>).find((r) => r.id === res.body.id);
    expect(row).toMatchObject({ name: username, position: 'tester', status: 'pending' });

    const someone = await createUser(ctx);
    await ctx.http
      .post(`/api/v1/admin/users/${res.body.id}/approve`)
      .set(auth(someone.token))
      .send({})
      .expect(403);

    const approved = await ctx.http
      .post(`/api/v1/admin/users/${res.body.id}/approve`)
      .set(auth(admin.token))
      .send({ isSystemAdmin: true })
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'active', isSystemAdmin: true });
    const ok = await login(username, 'regPass123').expect(200);
    expect(ok.body.user).toMatchObject({ username, isSystemAdmin: true });
    await ctx.http
      .post(`/api/v1/admin/users/${res.body.id}/approve`)
      .set(auth(admin.token))
      .send({})
      .expect(400);
  });

  it('rejects a registration so it cannot log in', async () => {
    const username = `rej${Date.now()}`;
    const res = await ctx.http
      .post('/api/v1/auth/register')
      .send({ username, name: '路人', password: 'regPass123', position: 'other' })
      .expect(201);
    await ctx.http
      .post(`/api/v1/admin/users/${res.body.id}/reject`)
      .set(auth(admin.token))
      .expect(200);
    const denied = await login(username, 'regPass123').expect(403);
    expect(denied.body.message).toContain('未通过审核');
    // 只能拒绝待审核的账号；被拒绝的账号可以重新通过
    await ctx.http
      .post(`/api/v1/admin/users/${res.body.id}/reject`)
      .set(auth(admin.token))
      .expect(400);
    await ctx.http
      .post(`/api/v1/admin/users/${res.body.id}/approve`)
      .set(auth(admin.token))
      .send({})
      .expect(200);
    await login(username, 'regPass123').expect(200);
  });

  it('adds project members by account with a role defaulted from position', async () => {
    const project = await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key: projectKey('MEM'), name: '成员测试' })
      .expect(201);
    const key = project.body.key as string;
    const dev = await createUser(ctx, { position: 'developer' });
    const planner = await createUser(ctx, { position: 'design' });
    const artist = await createUser(ctx, { position: 'art' });

    await ctx.http
      .post(`/api/v1/projects/${key}/members`)
      .set(auth(admin.token))
      .send({ account: dev.username.toUpperCase() })
      .expect(201);
    await ctx.http
      .post(`/api/v1/projects/${key}/members`)
      .set(auth(admin.token))
      .send({ account: planner.email })
      .expect(201);
    await ctx.http
      .post(`/api/v1/projects/${key}/members`)
      .set(auth(admin.token))
      .send({ account: artist.username, role: 'tester' })
      .expect(201);
    // 已有成员不传角色时保持原角色
    await ctx.http
      .post(`/api/v1/projects/${key}/members`)
      .set(auth(admin.token))
      .send({ account: artist.username })
      .expect(201);

    const pendingName = `pend${Date.now()}`;
    await ctx.http
      .post('/api/v1/auth/register')
      .send({ username: pendingName, password: 'regPass123', position: 'developer' })
      .expect(201);
    await ctx.http
      .post(`/api/v1/projects/${key}/members`)
      .set(auth(admin.token))
      .send({ account: pendingName })
      .expect(400);
    await ctx.http
      .post(`/api/v1/projects/${key}/members`)
      .set(auth(admin.token))
      .send({ account: 'nobody-here' })
      .expect(404);

    const detail = await ctx.http.get(`/api/v1/projects/${key}`).set(auth(admin.token)).expect(200);
    const roleOf = (id: string) =>
      (detail.body.members as Array<{ id: string; role: string; username: string }>).find(
        (m) => m.id === id,
      );
    expect(roleOf(dev.id)).toMatchObject({ role: 'developer', username: dev.username });
    expect(roleOf(planner.id)?.role).toBe('product');
    expect(roleOf(artist.id)?.role).toBe('tester');
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
