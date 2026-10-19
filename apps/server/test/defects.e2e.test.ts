import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

describe('defect lifecycle (e2e)', () => {
  let ctx: TestContext;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let tester: Awaited<ReturnType<typeof createUser>>;
  let dev: Awaited<ReturnType<typeof createUser>>;
  let outsider: Awaited<ReturnType<typeof createUser>>;
  let key: string;
  let moduleId: string;
  const base = () => `/api/v1/projects/${key}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createUser(ctx, { isSystemAdmin: true, name: '管理员' });
    tester = await createUser(ctx, { name: '测试' });
    dev = await createUser(ctx, { name: '开发' });
    outsider = await createUser(ctx, { name: '路人' });
    key = projectKey('P');

    await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key, name: '项目' })
      .expect(201);
    await ctx.http
      .post(`${base()}/members`)
      .set(auth(admin.token))
      .send({ email: tester.email, role: 'tester' })
      .expect(201);
    await ctx.http
      .post(`${base()}/members`)
      .set(auth(admin.token))
      .send({ email: dev.email, role: 'developer' })
      .expect(201);
    const mod = await ctx.http
      .post(`${base()}/modules`)
      .set(auth(admin.token))
      .send({ name: '订单', ownerId: dev.id })
      .expect(201);
    moduleId = mod.body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('hides projects from non-members', async () => {
    await ctx.http.get(base()).set(auth(outsider.token)).expect(404);
    await ctx.http.get(`${base()}/defects`).set(auth(outsider.token)).expect(404);
    const list = await ctx.http.get('/api/v1/projects').set(auth(outsider.token)).expect(200);
    expect(list.body.find((p: { key: string }) => p.key === key)).toBeUndefined();
  });

  it('only system admins create projects', async () => {
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(tester.token))
      .send({ key: 'NOPE', name: 'x' })
      .expect(403);
  });

  it('runs the full default workflow with role checks, required fields and history', async () => {
    const created = await ctx.http
      .post(`${base()}/defects`)
      .set(auth(tester.token))
      .send({ title: '支付后订单仍显示待支付', severity: 'serious', steps: '1. 下单 2. 支付' })
      .expect(201);
    const code = created.body.code as string;
    expect(code).toBe(`${key}-1`);
    expect(created.body).toMatchObject({
      status: 'new',
      statusCategory: 'todo',
      source: 'web',
      reporterId: tester.id,
    });

    const url = `${base()}/defects/${code}`;
    // 开发不能分诊
    await ctx.http
      .post(`${url}/transitions`)
      .set(auth(dev.token))
      .send({ transition: 'confirm' })
      .expect(403);
    // 确认需要优先级与模块
    const missing = await ctx.http
      .post(`${url}/transitions`)
      .set(auth(tester.token))
      .send({ transition: 'confirm' })
      .expect(400);
    expect(missing.body.missing).toEqual(['priority', 'moduleId']);

    const confirmed = await ctx.http
      .post(`${url}/transitions`)
      .set(auth(tester.token))
      .send({ transition: 'confirm', values: { priority: 'high', moduleId } })
      .expect(200);
    // 自动指派给模块负责人
    expect(confirmed.body).toMatchObject({ status: 'confirmed', ownerIds: [dev.id] });
    expect(confirmed.body.confirmedAt).toBeTruthy();

    // 状态不对的流转返回 409
    await ctx.http
      .post(`${url}/transitions`)
      .set(auth(tester.token))
      .send({ transition: 'verify' })
      .expect(409);

    await ctx.http
      .post(`${url}/transitions`)
      .set(auth(dev.token))
      .send({ transition: 'start' })
      .expect(200);
    // 开发在处理中可以编辑字段
    await ctx.http.patch(url).set(auth(dev.token)).send({ rootCause: 'coding' }).expect(200);
    await ctx.http
      .post(`${url}/transitions`)
      .set(auth(dev.token))
      .send({ transition: 'submit_review' })
      .expect(200);
    const merged = await ctx.http
      .post(`${url}/transitions`)
      .set(auth(dev.token))
      .send({ transition: 'merged' })
      .expect(200);
    // 解决后处理人改为验证人（创建人）
    expect(merged.body).toMatchObject({
      status: 'resolved',
      statusCategory: 'verifying',
      ownerIds: [tester.id],
    });
    expect(merged.body.resolvedAt).toBeTruthy();

    // 开发不能在已解决状态编辑
    await ctx.http.patch(url).set(auth(dev.token)).send({ title: 'x' }).expect(403);

    // 重新打开需要说明
    await ctx.http
      .post(`${url}/transitions`)
      .set(auth(tester.token))
      .send({ transition: 'reopen' })
      .expect(400);
    const reopened = await ctx.http
      .post(`${url}/transitions`)
      .set(auth(tester.token))
      .send({ transition: 'reopen', comment: '回到订单页仍未刷新' })
      .expect(200);
    expect(reopened.body).toMatchObject({
      status: 'in_progress',
      reopenCount: 1,
      ownerIds: [dev.id],
    });

    const detail = await ctx.http.get(url).set(auth(dev.token)).expect(200);
    expect(detail.body.fixCommand).toBe(`/fix-bug ${code}`);
    expect(detail.body.transitions.map((t: { key: string }) => t.key)).toEqual([
      'submit_review',
      'resolve',
    ]);
    expect(detail.body.comments[0].body).toBe('【重新打开】回到订单页仍未刷新');
    const fields = detail.body.history.map((h: { field: string }) => h.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        'created',
        'status',
        'priority',
        'moduleId',
        'ownerIds',
        'rootCause',
      ]),
    );
  });

  it('filters, searches and paginates the list', async () => {
    for (const [title, severity] of [
      ['登录页闪退', 'fatal'],
      ['首页图标错位', 'prompt'],
      ['登录验证码收不到', 'normal'],
    ] as const) {
      await ctx.http
        .post(`${base()}/defects`)
        .set(auth(tester.token))
        .send({ title, severity })
        .expect(201);
    }
    const byKeyword = await ctx.http
      .get(`${base()}/defects?keyword=登录`)
      .set(auth(dev.token))
      .expect(200);
    expect(byKeyword.body.total).toBe(2);

    const bySeverity = await ctx.http
      .get(`${base()}/defects?severity=fatal,prompt&sort=seq&order=asc`)
      .set(auth(dev.token))
      .expect(200);
    expect(bySeverity.body.items.map((d: { title: string }) => d.title)).toEqual([
      '登录页闪退',
      '首页图标错位',
    ]);

    const mine = await ctx.http
      .get(`${base()}/defects?owner=me&statusCategory=doing`)
      .set(auth(dev.token))
      .expect(200);
    expect(mine.body.total).toBe(1);

    const page = await ctx.http
      .get(`${base()}/defects?pageSize=2&page=2`)
      .set(auth(dev.token))
      .expect(200);
    expect(page.body).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect(page.body.items).toHaveLength(2);

    await ctx.http.get(`${base()}/defects?severity=bogus`).set(auth(dev.token)).expect(400);
  });

  it('uploads attachments through signed local URLs and serves them back', async () => {
    const created = await ctx.http
      .post(`${base()}/defects`)
      .set(auth(tester.token))
      .send({ title: '带附件', severity: 'normal' })
      .expect(201);
    const code = created.body.code;
    const target = await ctx.http
      .post(`${base()}/defects/${code}/attachments/upload-target`)
      .set(auth(tester.token))
      .send({ files: [{ name: 'app.log', size: 11 }] })
      .expect(201);
    expect(target.body.driver).toBe('local');
    const upload = target.body.uploads[0];
    const uploadPath = new URL(upload.url).pathname + new URL(upload.url).search;
    await ctx.http
      .put(uploadPath)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('hello world'))
      .expect(200);

    // 不属于该缺陷的路径被拒绝
    await ctx.http
      .post(`${base()}/defects/${code}/attachments`)
      .set(auth(tester.token))
      .send({ items: [{ key: 'web/OTHER/X-1/a.log', name: 'a.log' }] })
      .expect(400);

    const reg = await ctx.http
      .post(`${base()}/defects/${code}/attachments`)
      .set(auth(tester.token))
      .send({ items: [{ key: upload.key, name: 'app.log' }] })
      .expect(201);
    expect(reg.body[0]).toMatchObject({ kind: 'log', size: 11 });

    const link = await ctx.http
      .get(`${base()}/attachments/${reg.body[0].id}/url`)
      .set(auth(dev.token))
      .expect(200);
    const dl = new URL(link.body.url);
    const file = await ctx.http.get(dl.pathname + dl.search).expect(200);
    expect(file.text ?? file.body.toString()).toBe('hello world');
    // 篡改签名
    await ctx.http.get(dl.pathname + dl.search.replace(/sig=\w/, 'sig=0')).expect(403);
  });

  it('rejects invalid workflows', async () => {
    const res = await ctx.http
      .put(`${base()}/workflow`)
      .set(auth(admin.token))
      .send({
        initialState: 'a',
        states: [
          { key: 'a', name: 'A', category: 'todo', color: '#000' },
          { key: 'b', name: 'B', category: 'doing', color: '#000' },
        ],
        transitions: [],
      })
      .expect(400);
    expect(res.body.issues).toContain('至少需要一个“已完成”类别的状态');
  });
});
