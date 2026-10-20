import { DEFAULT_WORKFLOW } from '@defect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../src/common/crypto';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

describe('free workflow and field visibility (e2e)', () => {
  let ctx: TestContext;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let tester: Awaited<ReturnType<typeof createUser>>;
  let dev: Awaited<ReturnType<typeof createUser>>;
  let viewer: Awaited<ReturnType<typeof createUser>>;
  let key: string;
  const base = () => `/api/v1/projects/${key}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createUser(ctx, { isSystemAdmin: true, name: '管理员' });
    tester = await createUser(ctx, { name: '测试' });
    dev = await createUser(ctx, { name: '开发' });
    viewer = await createUser(ctx, { name: '只读' });
    key = projectKey('FREE');
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key, name: '自由流转' })
      .expect(201);
    for (const [u, role] of [
      [tester, 'tester'],
      [dev, 'developer'],
      [viewer, 'viewer'],
    ] as const) {
      await ctx.http
        .post(`${base()}/members`)
        .set(auth(admin.token))
        .send({ email: u.email, role })
        .expect(201);
    }
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const create = async (title = '支付后订单状态不刷新') =>
    (
      await ctx.http
        .post(`${base()}/defects`)
        .set(auth(tester.token))
        .send({ title, severity: 'serious' })
        .expect(201)
    ).body as { code: string; status: string };
  const move = (code: string, token: string, to: string, status = 200) =>
    ctx.http
      .post(`${base()}/defects/${code}/transitions`)
      .set(auth(token))
      .send({ transition: `to_${to}` })
      .expect(status);
  const detail = async (code: string) =>
    (await ctx.http.get(`${base()}/defects/${code}`).set(auth(admin.token)).expect(200)).body;

  it('creates new defects as 待处理 and lets editors switch to any state', async () => {
    const project = (await ctx.http.get(base()).set(auth(tester.token)).expect(200)).body;
    expect(project.workflow).toMatchObject({ mode: 'free', initialState: 'pending' });
    expect(project.workflow.states.map((s: { name: string }) => s.name)).toEqual([
      '待处理',
      '处理中',
      '待回归',
      '测试通过',
      '重新打开',
      '不是bug',
    ]);

    const { code, status } = await create();
    expect(status).toBe('pending');
    const d0 = await detail(code);
    expect(d0.transitions.map((t: { label: string }) => t.label)).toEqual([
      '处理中',
      '待回归',
      '测试通过',
      '重新打开',
      '不是bug',
    ]);

    // 只读成员不能改状态
    await move(code, viewer.token, 'in_progress', 403);

    // 开发开始处理：记下开发人员
    const d1 = (await move(code, dev.token, 'in_progress')).body;
    expect(d1).toMatchObject({
      status: 'in_progress',
      statusCategory: 'doing',
      developerId: dev.id,
    });
    expect(d1.startedAt).toBeTruthy();

    // 改为待回归：指派给提单人验证
    const d2 = (await move(code, dev.token, 'to_verify')).body;
    expect(d2).toMatchObject({
      status: 'to_verify',
      statusCategory: 'verifying',
      ownerIds: [tester.id],
    });

    // 测试重新打开：指派回开发、累计重开次数
    const d3 = (await move(code, tester.token, 'reopened')).body;
    expect(d3).toMatchObject({ status: 'reopened', ownerIds: [dev.id], reopenCount: 1 });

    await move(code, dev.token, 'to_verify');
    const d4 = (await move(code, tester.token, 'passed')).body;
    expect(d4).toMatchObject({ status: 'passed', statusCategory: 'done' });
    expect(d4.closedAt).toBeTruthy();

    // 不能“切换”到当前状态
    await move(code, tester.token, 'passed', 409);
  });

  it('applies state changes made by the admin immediately, migrating defects of removed states', async () => {
    const a = await create('A');
    const b = await create('B');
    await move(b.code, dev.token, 'in_progress');

    const custom = {
      ...DEFAULT_WORKFLOW,
      states: [
        ...DEFAULT_WORKFLOW.states.filter((s) => s.key !== 'not_bug'),
        { key: 'deferred', name: '延期处理', category: 'done', color: '#999999' },
      ],
    };
    await ctx.http.put(`${base()}/workflow`).set(auth(tester.token)).send(custom).expect(403);
    await ctx.http.put(`${base()}/workflow`).set(auth(admin.token)).send(custom).expect(200);
    // 新状态立刻出现在可选状态里
    const labels = (await detail(a.code)).transitions.map((t: { label: string }) => t.label);
    expect(labels).toContain('延期处理');
    expect(labels).not.toContain('不是bug');
    await move(a.code, dev.token, 'deferred');
    await move(a.code, dev.token, 'not_bug', 400);

    // 删除还有缺陷的“处理中”：不指定迁移目标时拒绝，并告诉前端有哪些缺陷
    const withoutProgress = {
      ...custom,
      states: custom.states.filter((s) => s.key !== 'in_progress'),
    };
    const refused = await ctx.http
      .put(`${base()}/workflow`)
      .set(auth(admin.token))
      .send(withoutProgress)
      .expect(400);
    expect(refused.body.orphans).toEqual([{ status: 'in_progress', count: 1 }]);

    await ctx.http
      .put(`${base()}/workflow`)
      .set(auth(admin.token))
      .send({ ...withoutProgress, remap: { in_progress: 'reopened' } })
      .expect(200);
    const moved = await detail(b.code);
    expect(moved).toMatchObject({ status: 'reopened', statusCategory: 'doing' });
    expect(moved.history).toContainEqual(
      expect.objectContaining({ field: 'status', oldValue: 'in_progress', newValue: 'reopened' }),
    );

    // 删除还在用的初始状态以外的状态都可以，但至少要有一个“已完成”状态
    const invalid = await ctx.http
      .put(`${base()}/workflow`)
      .set(auth(admin.token))
      .send({
        ...withoutProgress,
        states: withoutProgress.states.filter((s) => s.category !== 'done'),
      })
      .expect(400);
    expect(invalid.body.issues).toContain('至少需要一个“已完成”类别的状态');

    await ctx.http
      .put(`${base()}/workflow`)
      .set(auth(admin.token))
      .send(DEFAULT_WORKFLOW)
      .expect(400);
    await ctx.http
      .put(`${base()}/workflow`)
      .set(auth(admin.token))
      .send({ ...DEFAULT_WORKFLOW, remap: { deferred: 'not_bug' } })
      .expect(200);
  });

  it('lets project admins choose which detail fields are shown', async () => {
    await ctx.http
      .patch(base())
      .set(auth(admin.token))
      .send({ hiddenFields: ['passwordHash'] })
      .expect(400);
    await ctx.http
      .patch(base())
      .set(auth(tester.token))
      .send({ hiddenFields: ['priority'] })
      .expect(403);
    await ctx.http
      .patch(base())
      .set(auth(admin.token))
      .send({ hiddenFields: ['priority', 'deviceInfo', 'claude'] })
      .expect(200);
    const asDev = await ctx.http.get(base()).set(auth(dev.token)).expect(200);
    expect(asDev.body.hiddenFields).toEqual(['priority', 'deviceInfo', 'claude']);
    await ctx.http.patch(base()).set(auth(admin.token)).send({ hiddenFields: [] }).expect(200);
  });

  it('moves open defects to the merge target when an MR is merged', async () => {
    const secret = (
      await ctx.http.post(`${base()}/webhook-secret`).set(auth(admin.token)).expect(201)
    ).body.secret as string;
    const merge = (code: string, n: number) => {
      const raw = JSON.stringify({
        action: 'closed',
        pull_request: {
          title: `fix(${code}): 修复`,
          html_url: `https://github.com/acme/app/pull/${n}`,
          state: 'closed',
          merged: true,
          merge_commit_sha: 'a'.repeat(40),
          head: { ref: 'fix' },
        },
      });
      return ctx.http
        .post(`/api/v1/webhooks/git/${key}`)
        .set({
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'pull_request',
          'X-Hub-Signature-256': `sha256=${hmacSha256Hex(secret, raw)}`,
        })
        .send(raw)
        .expect(200);
    };

    const working = await create('处理中的缺陷');
    await move(working.code, dev.token, 'in_progress');
    const done = await create('已通过的缺陷');
    await move(done.code, tester.token, 'passed');

    expect((await merge(working.code, 1)).body.transitioned).toEqual([working.code]);
    expect((await merge(done.code, 2)).body.transitioned).toEqual([]);
    const w = await detail(working.code);
    expect(w).toMatchObject({ status: 'to_verify', ownerIds: [tester.id] });
    expect(w.comments.at(-1).body).toContain('MR 已合并');
    expect((await detail(done.code)).status).toBe('passed');

    // 管理员改了合并目标后按新目标流转
    await ctx.http
      .put(`${base()}/workflow`)
      .set(auth(admin.token))
      .send({ ...DEFAULT_WORKFLOW, mergeTarget: 'passed' })
      .expect(200);
    const another = await create('另一个缺陷');
    await merge(another.code, 3);
    expect((await detail(another.code)).status).toBe('passed');
  });
});
