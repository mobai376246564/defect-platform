import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

describe('bulk edit and my to-dos (e2e)', () => {
  let ctx: TestContext;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let tester: Awaited<ReturnType<typeof createUser>>;
  let dev: Awaited<ReturnType<typeof createUser>>;
  let keyA: string;
  let keyB: string;
  let moduleId: string;

  const createProject = async (key: string) => {
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key, name: key })
      .expect(201);
    for (const [u, role] of [
      [tester, 'tester'],
      [dev, 'developer'],
    ] as const) {
      await ctx.http
        .post(`/api/v1/projects/${key}/members`)
        .set(auth(admin.token))
        .send({ email: u.email, role })
        .expect(201);
    }
  };
  const create = async (key: string, body: Record<string, unknown>) =>
    (
      await ctx.http
        .post(`/api/v1/projects/${key}/defects`)
        .set(auth(tester.token))
        .send({ title: '缺陷', severity: 'normal', ...body })
        .expect(201)
    ).body.code as string;
  const detail = async (key: string, code: string) =>
    (
      await ctx.http
        .get(`/api/v1/projects/${key}/defects/${code}`)
        .set(auth(admin.token))
        .expect(200)
    ).body;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createUser(ctx, { isSystemAdmin: true });
    tester = await createUser(ctx, { name: '测试' });
    dev = await createUser(ctx, { name: '开发' });
    keyA = projectKey('BKA');
    keyB = projectKey('BKB');
    await createProject(keyA);
    await createProject(keyB);
    moduleId = (
      await ctx.http
        .post(`/api/v1/projects/${keyA}/modules`)
        .set(auth(admin.token))
        .send({ name: '支付' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('bulk-updates selected defects, reporting per-defect failures', async () => {
    const a = await create(keyA, {});
    const b = await create(keyA, {});
    const c = await create(keyA, {});
    const res = await ctx.http
      .post(`/api/v1/projects/${keyA}/defects/bulk`)
      .set(auth(tester.token))
      .send({
        codes: [a, b, `${keyA}-9999`],
        changes: {
          severity: 'fatal',
          priority: 'urgent',
          moduleId,
          ownerIds: [dev.id],
          status: 'in_progress',
        },
      })
      .expect(200);
    expect(res.body).toMatchObject({ total: 3, updated: 2 });
    expect(res.body.failed).toEqual([
      { code: `${keyA}-9999`, message: `缺陷 ${keyA}-9999 不存在` },
    ]);
    for (const code of [a, b]) {
      expect(await detail(keyA, code)).toMatchObject({
        severity: 'fatal',
        priority: 'urgent',
        moduleId,
        ownerIds: [dev.id],
        status: 'in_progress',
      });
    }
    expect((await detail(keyA, c)).severity).toBe('normal');
    // 每个缺陷都有自己的变更历史
    expect((await detail(keyA, a)).history).toContainEqual(
      expect.objectContaining({ field: 'severity', newValue: 'fatal' }),
    );

    // 开发只能改处理中的缺陷：c 还是待处理，失败；a 在处理中，成功
    const devRes = await ctx.http
      .post(`/api/v1/projects/${keyA}/defects/bulk`)
      .set(auth(dev.token))
      .send({ codes: [a, c], changes: { priority: 'low' } })
      .expect(200);
    expect(devRes.body.updated).toBe(1);
    expect(devRes.body.failed).toEqual([{ code: c, message: '开发只能编辑处理中的缺陷' }]);

    await ctx.http
      .post(`/api/v1/projects/${keyA}/defects/bulk`)
      .set(auth(tester.token))
      .send({ codes: [a], changes: {} })
      .expect(400);
    await ctx.http
      .post(`/api/v1/projects/${keyA}/defects/bulk`)
      .set(auth(tester.token))
      .send({ codes: [a], changes: { status: 'nope' } })
      .expect(400);
  });

  it('bulk-updates every defect matching the list filters', async () => {
    const x = await create(keyA, { severity: 'advice', title: '批量全部 X' });
    const y = await create(keyA, { severity: 'advice', title: '批量全部 Y' });
    const z = await create(keyA, { severity: 'prompt', title: '批量全部 Z' });
    const res = await ctx.http
      .post(`/api/v1/projects/${keyA}/defects/bulk`)
      .set(auth(tester.token))
      .send({ query: { keyword: '批量全部', severity: 'advice' }, changes: { status: 'not_bug' } })
      .expect(200);
    expect(res.body).toMatchObject({ total: 2, updated: 2, failed: [] });
    expect((await detail(keyA, x)).status).toBe('not_bug');
    expect((await detail(keyA, y)).status).toBe('not_bug');
    expect((await detail(keyA, z)).status).toBe('pending');
  });

  it('lists defects assigned to me across projects with filters and sorting', async () => {
    const mine1 = await create(keyA, { title: '待办一', severity: 'serious', ownerIds: [dev.id] });
    const mine2 = await create(keyB, { title: '待办二', severity: 'fatal', ownerIds: [dev.id] });
    await create(keyB, { title: '别人的', ownerIds: [tester.id] });

    const all = await ctx.http
      .get('/api/v1/me/todos')
      .set(auth(dev.token))
      .query({ statusCategory: 'todo,doing,verifying', sort: 'severity:desc', keyword: '待办' })
      .expect(200);
    expect(all.body.items.map((d: { code: string }) => d.code)).toEqual([mine2, mine1]);
    expect(all.body.items[0].project).toEqual({ key: keyB, name: keyB });

    const onlyA = await ctx.http
      .get('/api/v1/me/todos')
      .set(auth(dev.token))
      .query({ project: keyA, keyword: '待办' })
      .expect(200);
    expect(onlyA.body.items.map((d: { code: string }) => d.code)).toEqual([mine1]);

    // 测试没有被指派这两个缺陷
    const tester2 = await ctx.http
      .get('/api/v1/me/todos')
      .set(auth(tester.token))
      .query({ keyword: '待办' })
      .expect(200);
    expect(tester2.body.total).toBe(0);
  });

  it('searches by partial words and sorts by workflow status order', async () => {
    const a = await create(keyB, { title: '模糊搜索 登录态在后台丢失' });
    const b = await create(keyB, { title: '模糊搜索 首页白屏' });
    await ctx.http
      .post(`/api/v1/projects/${keyB}/defects/${a}/transitions`)
      .set(auth(admin.token))
      .send({ transition: 'to_to_verify', values: {} })
      .expect(200);

    const words = await ctx.http
      .get(`/api/v1/projects/${keyB}/defects`)
      .set(auth(admin.token))
      .query({ keyword: '登录  丢失' })
      .expect(200);
    expect(words.body.items.map((d: { code: string }) => d.code)).toEqual([a]);

    // 编号部分匹配：只输入数字也能搜到
    const seq = b.split('-').pop()!;
    const byCode = await ctx.http
      .get(`/api/v1/projects/${keyB}/defects`)
      .set(auth(admin.token))
      .query({ keyword: `${keyB.toLowerCase()}-${seq}` })
      .expect(200);
    expect(byCode.body.items.map((d: { code: string }) => d.code)).toContain(b);

    const asc = await ctx.http
      .get(`/api/v1/projects/${keyB}/defects`)
      .set(auth(admin.token))
      .query({ keyword: '模糊搜索', sort: 'status:asc' })
      .expect(200);
    expect(asc.body.items.map((d: { code: string }) => d.code)).toEqual([b, a]);
    const desc = await ctx.http
      .get(`/api/v1/projects/${keyB}/defects`)
      .set(auth(admin.token))
      .query({ keyword: '模糊搜索', sort: 'status:desc' })
      .expect(200);
    expect(desc.body.items.map((d: { code: string }) => d.code)).toEqual([a, b]);
  });

  it('groups my to-dos by project and severity', async () => {
    await create(keyA, { title: '分组待办 A', severity: 'fatal', ownerIds: [tester.id] });
    await create(keyB, { title: '分组待办 B1', severity: 'fatal', ownerIds: [tester.id] });
    await create(keyB, { title: '分组待办 B2', severity: 'prompt', ownerIds: [tester.id] });

    const byProject = await ctx.http
      .get('/api/v1/me/todos/groups')
      .set(auth(tester.token))
      .query({ groupBy: 'project', keyword: '分组待办' })
      .expect(200);
    expect(byProject.body.total).toBe(3);
    expect(byProject.body.groups).toEqual([
      { value: keyA, label: keyA, count: 1 },
      { value: keyB, label: keyB, count: 2 },
    ]);

    const bySeverity = await ctx.http
      .get('/api/v1/me/todos/groups')
      .set(auth(tester.token))
      .query({ groupBy: 'severity', keyword: '分组待办' })
      .expect(200);
    expect(bySeverity.body.groups).toEqual([
      { value: 'fatal', count: 2 },
      { value: 'prompt', count: 1 },
    ]);

    const inGroup = await ctx.http
      .get('/api/v1/me/todos')
      .set(auth(tester.token))
      .query({ keyword: '分组待办', groupField: 'project', groupValue: keyB })
      .expect(200);
    expect(inGroup.body.total).toBe(2);
  });
});
