import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  createTestApp,
  createUser,
  projectKey,
  type TestContext,
  useClassicWorkflow,
} from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;

describe('notifications (e2e)', () => {
  let ctx: TestContext;
  let admin: User;
  let tester: User;
  let dev: User;
  let dev2: User;
  let key: string;
  let moduleId: string;
  const base = () => `/api/v1/projects/${key}`;

  const inbox = async (u: User, query = '') =>
    (await ctx.http.get(`/api/v1/notifications${query}`).set(auth(u.token)).expect(200)).body as {
      items: {
        id: string;
        kind: string;
        title: string;
        body: string;
        defectCode: string;
        projectKey: string;
        actorName: string | null;
        readAt: string | null;
      }[];
      total: number;
      unread: number;
    };

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createUser(ctx, { isSystemAdmin: true });
    tester = await createUser(ctx, { name: '通知测试员' });
    dev = await createUser(ctx, { name: '通知开发' });
    dev2 = await createUser(ctx, { name: '通知开发二号' });
    key = projectKey('N');
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key, name: '通知项目' })
      .expect(201);
    await useClassicWorkflow(ctx, key, admin.token);
    for (const [u, role] of [
      [tester, 'tester'],
      [dev, 'developer'],
      [dev2, 'developer'],
    ] as const) {
      await ctx.http
        .post(`${base()}/members`)
        .set(auth(admin.token))
        .send({ email: u.email, role })
        .expect(201);
    }
    const mod = await ctx.http
      .post(`${base()}/modules`)
      .set(auth(admin.token))
      .send({ name: '登录', ownerId: dev.id })
      .expect(201);
    moduleId = mod.body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('notifies on assignment, @mentions and status changes, never the actor', async () => {
    const created = await ctx.http
      .post(`${base()}/defects`)
      .set(auth(tester.token))
      .send({ title: '登录页白屏', severity: 'serious', moduleId })
      .expect(201);
    const code = created.body.code as string;
    const url = `${base()}/defects/${code}`;

    // 建单自动指派给模块负责人
    let devBox = await inbox(dev);
    expect(devBox.items[0]).toMatchObject({
      kind: 'assigned',
      defectCode: code,
      projectKey: key,
      actorName: '通知测试员',
      body: '登录页白屏',
    });
    expect((await inbox(tester)).total).toBe(0);

    // @ 两位开发；“通知开发二号”不能被误识别为“通知开发”，@ 自己不通知
    await ctx.http
      .post(`${url}/comments`)
      .set(auth(tester.token))
      .send({ body: '@通知开发二号 帮忙看下，@通知测试员 自己备注' })
      .expect(201);
    expect((await inbox(dev2)).items[0]).toMatchObject({
      kind: 'mentioned',
      body: '@通知开发二号 帮忙看下，@通知测试员 自己备注',
    });
    devBox = await inbox(dev);
    expect(devBox.total).toBe(1);
    expect((await inbox(tester)).total).toBe(0);

    // 状态变更通知处理人（开发）；操作者（测试）本人不收
    await ctx.http
      .post(`${url}/transitions`)
      .set(auth(tester.token))
      .send({ transition: 'confirm', values: { priority: 'high', moduleId } })
      .expect(200);
    devBox = await inbox(dev);
    expect(devBox.items[0]).toMatchObject({ kind: 'status_changed', defectCode: code });
    expect(devBox.items[0]!.title).toContain('从“新建”改为“已确认”');
    expect((await inbox(tester)).total).toBe(0);

    // 开发开始处理 → 创建人收到状态变更
    await ctx.http
      .post(`${url}/transitions`)
      .set(auth(dev.token))
      .send({ transition: 'start' })
      .expect(200);
    expect((await inbox(tester)).items[0]).toMatchObject({ kind: 'status_changed' });

    // 增加处理人：新处理人收到“指派”，已有处理人不重复收到
    const before = (await inbox(dev)).total;
    await ctx.http
      .patch(url)
      .set(auth(dev.token))
      .send({ ownerIds: [dev.id, dev2.id] })
      .expect(200);
    expect((await inbox(dev2)).items[0]).toMatchObject({ kind: 'assigned', defectCode: code });
    expect((await inbox(dev)).total).toBe(before);

    // 流转说明中的 @ 也会通知；同一次操作里一个人只收一条（指派优先于状态变更）
    await ctx.http
      .post(`${url}/transitions`)
      .set(auth(dev.token))
      .send({
        transition: 'resolve',
        values: { resolution: 'failed_to_recur' },
        comment: '无法重现，@通知开发二号 你那边也试试',
      })
      .expect(200);
    const dev2Box = await inbox(dev2);
    expect(dev2Box.items[0]).toMatchObject({ kind: 'mentioned' });
    expect(dev2Box.items.filter((n) => n.kind === 'status_changed')).toHaveLength(0);
    // 解决后指派给验证人（创建人）：测试收到“指派”而不是“状态变更”
    const testerBox = await inbox(tester);
    expect(testerBox.items[0]).toMatchObject({ kind: 'assigned' });
  });

  it('lists, counts and marks notifications read for the owner only', async () => {
    const box = await inbox(dev2);
    expect(box.unread).toBeGreaterThan(0);
    const count = await ctx.http
      .get('/api/v1/notifications/unread-count')
      .set(auth(dev2.token))
      .expect(200);
    expect(count.body.count).toBe(box.unread);

    const first = box.items[0]!;
    // 别人不能标记，非法 id 返回 400
    await ctx.http.post(`/api/v1/notifications/${first.id}/read`).set(auth(dev.token)).expect(404);
    await ctx.http.post('/api/v1/notifications/nope/read').set(auth(dev2.token)).expect(400);

    await ctx.http.post(`/api/v1/notifications/${first.id}/read`).set(auth(dev2.token)).expect(204);
    const unreadOnly = await inbox(dev2, '?unread=true');
    expect(unreadOnly.items.find((n) => n.id === first.id)).toBeUndefined();
    expect(unreadOnly.unread).toBe(box.unread - 1);

    const all = await ctx.http
      .post('/api/v1/notifications/read-all')
      .set(auth(dev2.token))
      .expect(200);
    expect(all.body.updated).toBe(box.unread - 1);
    expect((await inbox(dev2)).unread).toBe(0);
    // 别人的未读不受影响
    expect((await inbox(dev)).unread).toBeGreaterThan(0);
  });
});
