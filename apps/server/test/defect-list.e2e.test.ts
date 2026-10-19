import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

describe('defect list: combined filters, grouping, sorting and saved views (e2e)', () => {
  let ctx: TestContext;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let tester: Awaited<ReturnType<typeof createUser>>;
  let dev: Awaited<ReturnType<typeof createUser>>;
  let key: string;
  let moduleId: string;
  const codes: Record<string, string> = {};
  const base = () => `/api/v1/projects/${key}`;

  const list = async (token: string, query: Record<string, unknown>, status = 200) =>
    (
      await ctx.http
        .get(`${base()}/defects`)
        .set(auth(token))
        .query(
          Object.fromEntries(
            Object.entries(query).map(([k, v]) => [
              k,
              typeof v === 'string' ? v : JSON.stringify(v),
            ]),
          ),
        )
        .expect(status)
    ).body;

  const codesOf = (body: { items: { code: string }[] }) => body.items.map((d) => d.code);

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createUser(ctx, { isSystemAdmin: true, name: '管理员' });
    tester = await createUser(ctx, { name: '测试' });
    dev = await createUser(ctx, { name: '开发' });
    key = projectKey('LST');
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key, name: '列表' })
      .expect(201);
    for (const [u, role] of [
      [tester, 'tester'],
      [dev, 'developer'],
    ] as const) {
      await ctx.http
        .post(`${base()}/members`)
        .set(auth(admin.token))
        .send({ email: u.email, role })
        .expect(201);
    }
    moduleId = (
      await ctx.http
        .post(`${base()}/modules`)
        .set(auth(admin.token))
        .send({ name: '支付', ownerId: dev.id })
        .expect(201)
    ).body.id;

    const make = async (name: string, body: Record<string, unknown>) => {
      const res = await ctx.http
        .post(`${base()}/defects`)
        .set(auth(tester.token))
        .send({ title: `${name} 标题`, ...body })
        .expect(201);
      codes[name] = res.body.code;
    };
    // 创建顺序：a 最早，e 最晚
    await make('a', { severity: 'advice', priority: 'low' });
    await make('b', { severity: 'fatal' });
    await make('c', { severity: 'normal', priority: 'urgent', moduleId, ownerIds: [dev.id] });
    await make('d', { severity: 'serious', priority: 'medium', description: '支付回调超时' });
    await make('e', { severity: 'fatal', priority: 'high', ownerIds: [dev.id, tester.id] });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('sorts severity and priority by level, with multiple keys and nulls last', async () => {
    const bySeverity = await list(tester.token, { sort: 'severity:desc,createdAt:asc' });
    expect(codesOf(bySeverity)).toEqual([codes.b, codes.e, codes.d, codes.c, codes.a]);

    const byPriority = await list(tester.token, { sort: 'priority:desc' });
    // 没有优先级的 b 排最后
    expect(codesOf(byPriority)).toEqual([codes.c, codes.e, codes.d, codes.a, codes.b]);

    // 旧写法仍可用
    const legacy = await list(tester.token, { sort: 'createdAt', order: 'asc' });
    expect(codesOf(legacy)[0]).toBe(codes.a);

    // 修改严重程度后按新等级排序
    await ctx.http
      .patch(`${base()}/defects/${codes.a}`)
      .set(auth(tester.token))
      .send({ severity: 'fatal' })
      .expect(200);
    const after = await list(tester.token, { sort: 'severity:desc,createdAt:asc' });
    expect(codesOf(after).slice(0, 3)).toEqual([codes.a, codes.b, codes.e]);
    await ctx.http
      .patch(`${base()}/defects/${codes.a}`)
      .set(auth(tester.token))
      .send({ severity: 'advice' })
      .expect(200);
  });

  it('applies combined filters with AND / OR logic', async () => {
    const or = await list(tester.token, {
      sort: 'createdAt:asc',
      filters: {
        logic: 'or',
        conditions: [
          { field: 'severity', op: 'in', value: ['advice'] },
          { field: 'priority', op: 'in', value: ['urgent'] },
        ],
      },
    });
    expect(codesOf(or)).toEqual([codes.a, codes.c]);

    const and = await list(tester.token, {
      sort: 'createdAt:asc',
      filters: {
        logic: 'and',
        conditions: [
          { field: 'severity', op: 'in', value: ['fatal'] },
          { field: 'priority', op: 'nempty' },
        ],
      },
    });
    expect(codesOf(and)).toEqual([codes.e]);

    // “不属于”包含未填写优先级的缺陷
    const nin = await list(tester.token, {
      sort: 'createdAt:asc',
      filters: {
        logic: 'and',
        conditions: [{ field: 'priority', op: 'nin', value: ['urgent', 'high'] }],
      },
    });
    expect(codesOf(nin)).toEqual([codes.a, codes.b, codes.d]);

    // 处理人包含“我”
    const mine = await list(dev.token, {
      sort: 'createdAt:asc',
      filters: { logic: 'and', conditions: [{ field: 'ownerIds', op: 'in', value: ['me'] }] },
    });
    expect(codesOf(mine)).toEqual([codes.c, codes.e]);

    const text = await list(tester.token, {
      filters: {
        logic: 'and',
        conditions: [{ field: 'description', op: 'contains', value: '回调' }],
      },
    });
    expect(codesOf(text)).toEqual([codes.d]);

    const modules = await list(tester.token, {
      sort: 'createdAt:asc',
      filters: { logic: 'and', conditions: [{ field: 'moduleId', op: 'empty' }] },
    });
    expect(codesOf(modules)).toEqual([codes.a, codes.b, codes.d, codes.e]);

    const dates = await list(tester.token, {
      filters: {
        logic: 'and',
        conditions: [
          {
            field: 'createdAt',
            op: 'between',
            value: [new Date(Date.now() - 3600_000).toISOString(), null],
          },
          { field: 'reopenCount', op: 'eq', value: 0 },
        ],
      },
    });
    expect(dates.total).toBe(5);

    // 不支持的运算符、非法 JSON
    await list(
      tester.token,
      {
        filters: { logic: 'and', conditions: [{ field: 'severity', op: 'empty' }] },
      },
      400,
    );
    await list(tester.token, { filters: '{not json' }, 400);
    await list(
      tester.token,
      {
        filters: { logic: 'and', conditions: [{ field: 'passwordHash', op: 'in', value: ['x'] }] },
      },
      400,
    );
  });

  it('counts groups and lists one group at a time', async () => {
    const bySeverity = (
      await ctx.http
        .get(`${base()}/defects/groups`)
        .set(auth(tester.token))
        .query({ groupBy: 'severity' })
        .expect(200)
    ).body;
    expect(bySeverity).toMatchObject({
      groupBy: 'severity',
      total: 5,
      groups: [
        { value: 'fatal', count: 2 },
        { value: 'serious', count: 1 },
        { value: 'normal', count: 1 },
        { value: 'advice', count: 1 },
      ],
    });

    const byOwner = (
      await ctx.http
        .get(`${base()}/defects/groups`)
        .set(auth(tester.token))
        .query({ groupBy: 'owner' })
        .expect(200)
    ).body;
    // e 有两个处理人，分别计入两组；没有处理人的放在最后
    expect(byOwner.groups).toEqual([
      { value: dev.id, count: 2 },
      { value: tester.id, count: 1 },
      { value: '__none__', count: 3 },
    ]);

    const noPriority = await list(tester.token, { groupField: 'priority', groupValue: '__none__' });
    expect(codesOf(noPriority)).toEqual([codes.b]);
    const devGroup = await list(tester.token, {
      groupField: 'owner',
      groupValue: dev.id,
      sort: 'createdAt:asc',
    });
    expect(codesOf(devGroup)).toEqual([codes.c, codes.e]);

    // 分组统计同样受筛选条件约束
    const filtered = (
      await ctx.http
        .get(`${base()}/defects/groups`)
        .set(auth(tester.token))
        .query({ groupBy: 'severity', severity: 'fatal' })
        .expect(200)
    ).body;
    expect(filtered.groups).toEqual([{ value: 'fatal', count: 2 }]);
  });

  it('saves personal and shared views with permission checks', async () => {
    const query = {
      filters: { logic: 'and', conditions: [] },
      sort: 'severity:desc',
      groupBy: 'owner',
    };
    const mine = await ctx.http
      .post(`${base()}/views`)
      .set(auth(dev.token))
      .send({ name: '我的严重缺陷', query })
      .expect(201);
    expect(mine.body).toMatchObject({ name: '我的严重缺陷', shared: false, ownerId: dev.id });

    // 测试不能发布公开视图，项目管理员可以
    await ctx.http
      .post(`${base()}/views`)
      .set(auth(tester.token))
      .send({ name: '公开', shared: true, query })
      .expect(403);
    const shared = await ctx.http
      .post(`${base()}/views`)
      .set(auth(admin.token))
      .send({ name: '本周致命', shared: true, query })
      .expect(201);

    const testerViews = await ctx.http.get(`${base()}/views`).set(auth(tester.token)).expect(200);
    expect(testerViews.body.map((v: { name: string }) => v.name)).toEqual(['本周致命']);
    const devViews = await ctx.http.get(`${base()}/views`).set(auth(dev.token)).expect(200);
    expect(devViews.body.map((v: { name: string }) => v.name)).toEqual([
      '本周致命',
      '我的严重缺陷',
    ]);

    // 别人的个人视图看不到也改不了；公开视图只有发布者或有发布权限的人能改
    await ctx.http
      .patch(`${base()}/views/${mine.body.id}`)
      .set(auth(tester.token))
      .send({ name: 'x' })
      .expect(404);
    await ctx.http.delete(`${base()}/views/${shared.body.id}`).set(auth(dev.token)).expect(403);
    await ctx.http
      .patch(`${base()}/views/${mine.body.id}`)
      .set(auth(dev.token))
      .send({ name: '严重缺陷' })
      .expect(200);
    await ctx.http.delete(`${base()}/views/${mine.body.id}`).set(auth(dev.token)).expect(204);
    await ctx.http.delete(`${base()}/views/${shared.body.id}`).set(auth(admin.token)).expect(204);
  });
});
