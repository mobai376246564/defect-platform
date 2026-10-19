import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../src/common/crypto';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

describe('Git webhooks (e2e)', () => {
  let ctx: TestContext;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let tester: Awaited<ReturnType<typeof createUser>>;
  let dev: Awaited<ReturnType<typeof createUser>>;
  let key: string;
  let moduleId: string;
  let secret: string;
  const base = () => `/api/v1/projects/${key}`;
  const hook = () => `/api/v1/webhooks/git/${key}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createUser(ctx, { isSystemAdmin: true, name: '管理员' });
    tester = await createUser(ctx, { name: '测试' });
    dev = await createUser(ctx, { name: '开发' });
    key = projectKey('GIT');
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key, name: 'Webhook 测试' })
      .expect(201);
    for (const [user, role] of [
      [tester, 'tester'],
      [dev, 'developer'],
    ] as const) {
      await ctx.http
        .post(`${base()}/members`)
        .set(auth(admin.token))
        .send({ email: user.email, role })
        .expect(201);
    }
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

  /** 由测试提单，并按默认工作流推进到指定状态 */
  async function newDefect(state: 'confirmed' | 'in_progress' | 'in_review'): Promise<string> {
    const created = await ctx.http
      .post(`${base()}/defects`)
      .set(auth(tester.token))
      .send({ title: '支付后订单仍显示待支付', severity: 'serious' })
      .expect(201);
    const code = created.body.code as string;
    const steps: [string, string, Record<string, unknown>?][] = [
      [tester.token, 'confirm', { priority: 'high', moduleId }],
      [dev.token, 'start'],
      [dev.token, 'submit_review'],
    ];
    const count = { confirmed: 1, in_progress: 2, in_review: 3 }[state];
    for (const [token, transition, values] of steps.slice(0, count)) {
      await ctx.http
        .post(`${base()}/defects/${code}/transitions`)
        .set(auth(token))
        .send({ transition, values })
        .expect(200);
    }
    return code;
  }

  const detail = async (code: string) =>
    (await ctx.http.get(`${base()}/defects/${code}`).set(auth(admin.token)).expect(200)).body;

  function github(event: string, body: unknown, signWith = secret) {
    const raw = JSON.stringify(body);
    return ctx.http
      .post(hook())
      .set({
        'Content-Type': 'application/json',
        'X-GitHub-Event': event,
        'X-GitHub-Delivery': randomUUID(),
        'X-Hub-Signature-256': `sha256=${hmacSha256Hex(signWith, raw)}`,
      })
      .send(raw);
  }

  function gitlab(event: string, body: unknown, token = secret) {
    return ctx.http
      .post(hook())
      .set({ 'Content-Type': 'application/json', 'X-Gitlab-Event': event, 'X-Gitlab-Token': token })
      .send(JSON.stringify(body));
  }

  const githubPr = (code: string, action: string, merged: boolean, n: number) => ({
    action,
    number: n,
    pull_request: {
      number: n,
      title: `fix(${code}): 支付回调后刷新订单状态`,
      html_url: `https://github.com/acme/app/pull/${n}`,
      state: action === 'closed' ? 'closed' : 'open',
      merged,
      merge_commit_sha: merged ? 'c0ffee' + String(n).padStart(34, '0') : null,
      head: { ref: 'feature/pay' },
      base: { ref: 'main' },
    },
  });

  const gitlabMr = (code: string, action: string, state: string, iid: number) => ({
    object_kind: 'merge_request',
    object_attributes: {
      iid,
      title: '支付回调后刷新订单状态',
      url: `https://gitlab.example.com/acme/app/-/merge_requests/${iid}`,
      state,
      action,
      source_branch: `fix/${code.toLowerCase()}-pay`,
      target_branch: 'main',
      merge_commit_sha: state === 'merged' ? 'beef'.padEnd(40, '1') : null,
    },
  });

  it('shows the webhook settings to project admins only and generates a secret', async () => {
    const before = await ctx.http.get(base()).set(auth(admin.token)).expect(200);
    expect(before.body.webhook).toEqual({
      url: `http://localhost:3999/api/v1/webhooks/git/${key}`,
      secretConfigured: false,
    });
    expect(before.body.webhookSecret).toBeUndefined();
    const asDev = await ctx.http.get(base()).set(auth(dev.token)).expect(200);
    expect(asDev.body.webhook).toBeNull();
    await ctx.http.post(`${base()}/webhook-secret`).set(auth(dev.token)).expect(403);

    // 未配置密钥时一律拒绝
    secret = 'not-configured';
    await github('push', { ref: 'refs/heads/main', commits: [] }).expect(401);

    const res = await ctx.http.post(`${base()}/webhook-secret`).set(auth(admin.token)).expect(201);
    expect(res.body.url).toBe(before.body.webhook.url);
    expect(res.body.secret).toMatch(/^[0-9a-f]{64}$/);
    secret = res.body.secret;

    const after = await ctx.http.get(base()).set(auth(admin.token)).expect(200);
    expect(after.body.webhook.secretConfigured).toBe(true);
    // 修改项目设置的响应里不带密钥
    const patched = await ctx.http
      .patch(base())
      .set(auth(admin.token))
      .send({ description: 'x' })
      .expect(200);
    expect(patched.body.webhookSecret).toBeUndefined();
  });

  it('rejects bad signatures, wrong tokens, unknown projects and unknown sources', async () => {
    const push = { ref: 'refs/heads/main', commits: [] };
    // 缺少签名
    await ctx.http
      .post(hook())
      .set({ 'Content-Type': 'application/json', 'X-GitHub-Event': 'push' })
      .send(JSON.stringify(push))
      .expect(401);
    await github('push', push, 'wrong-secret').expect(401);
    // 签名对，但请求体被篡改
    const raw = JSON.stringify(push);
    await ctx.http
      .post(hook())
      .set({
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'push',
        'X-Hub-Signature-256': `sha256=${hmacSha256Hex(secret, raw)}`,
      })
      .send(raw.replace('main', 'evil'))
      .expect(401);
    await gitlab('Push Hook', push, 'wrong-token').expect(401);
    await ctx.http
      .post('/api/v1/webhooks/git/NOSUCH')
      .set({
        'Content-Type': 'application/json',
        'X-Gitlab-Event': 'Push Hook',
        'X-Gitlab-Token': secret,
      })
      .send(JSON.stringify(push))
      .expect(401);
    await ctx.http.post(hook()).send(push).expect(400);

    const ping = await github('ping', { zen: 'Keep it logically awesome.' }).expect(200);
    expect(ping.body).toMatchObject({ provider: 'github', event: 'ping', ignored: true });
  });

  it('links branches and commits from a GitHub push by branch name and commit message', async () => {
    const a = await newDefect('in_progress');
    const b = await newDefect('in_progress');
    const branch = `fix/${a.toLowerCase()}-pay-refresh`;
    const res = await github('push', {
      ref: `refs/heads/${branch}`,
      deleted: false,
      commits: [
        {
          id: 'a'.repeat(40),
          message: `fix(${b}): 支付回调后刷新订单\n\n顺带修复 ${key}-9999 与 OTHER-1`,
        },
        { id: 'b'.repeat(40), message: 'chore: 整理代码' },
      ],
    }).expect(200);
    expect(res.body).toMatchObject({ provider: 'github', event: 'push', transitioned: [] });

    const da = await detail(a);
    expect(
      da.links.map((l: { kind: string; target: string }) => `${l.kind}:${l.target}`).sort(),
    ).toEqual([`branch:${branch}`, `commit:${'a'.repeat(40)}`, `commit:${'b'.repeat(40)}`]);
    const db = await detail(b);
    expect(db.links).toEqual([expect.objectContaining({ kind: 'commit', target: 'a'.repeat(40) })]);
    expect(db.history).toContainEqual(
      expect.objectContaining({ field: 'link.commit', via: 'system', operatorId: null }),
    );

    // 平台重复投递不重复写历史
    const again = await github('push', {
      ref: `refs/heads/${branch}`,
      commits: [{ id: 'b'.repeat(40), message: 'chore: 整理代码' }],
    }).expect(200);
    expect(again.body.linked).toEqual([]);
    // 删除分支的推送忽略
    const deleted = await github('push', {
      ref: `refs/heads/${branch}`,
      deleted: true,
      commits: [],
    }).expect(200);
    expect(deleted.body.ignored).toBe(true);
  });

  it('links an opened PR without changing status, and resolves in_review defects when merged', async () => {
    const code = await newDefect('in_review');

    const opened = await github('pull_request', githubPr(code, 'opened', false, 7)).expect(200);
    expect(opened.body.linked).toEqual([
      { code, kind: 'mr', target: 'https://github.com/acme/app/pull/7' },
    ]);
    expect((await detail(code)).status).toBe('in_review');

    const merged = await github('pull_request', githubPr(code, 'closed', true, 7)).expect(200);
    expect(merged.body.transitioned).toEqual([code]);

    const d = await detail(code);
    expect(d).toMatchObject({
      status: 'resolved',
      statusCategory: 'verifying',
      ownerIds: [tester.id],
    });
    expect(d.resolvedAt).toBeTruthy();
    expect(d.links).toEqual([
      expect.objectContaining({
        kind: 'mr',
        target: 'https://github.com/acme/app/pull/7',
        state: 'merged',
      }),
    ]);
    expect(d.comments).toContainEqual(
      expect.objectContaining({
        via: 'system',
        authorId: null,
        body: '【标记已合并】MR 已合并：https://github.com/acme/app/pull/7',
      }),
    );
    expect(d.history).toContainEqual(
      expect.objectContaining({
        field: 'status',
        oldValue: 'in_review',
        newValue: 'resolved',
        via: 'system',
      }),
    );

    // 重复投递：已不在待代码审核，不再流转
    const redelivered = await github('pull_request', githubPr(code, 'closed', true, 7)).expect(200);
    expect(redelivered.body).toMatchObject({ linked: [], transitioned: [] });
    expect((await detail(code)).status).toBe('resolved');
  });

  it('does not transition a closed-but-unmerged PR', async () => {
    const code = await newDefect('in_review');
    const res = await github('pull_request', githubPr(code, 'closed', false, 8)).expect(200);
    expect(res.body.transitioned).toEqual([]);
    const d = await detail(code);
    expect(d.status).toBe('in_review');
    expect(d.links[0]).toMatchObject({ kind: 'mr', state: 'closed' });
  });

  it('handles GitLab push and merge request hooks; merges outside in_review only link', async () => {
    const reviewing = await newDefect('in_review');
    const working = await newDefect('in_progress');

    const push = await gitlab('Push Hook', {
      object_kind: 'push',
      ref: 'refs/heads/main',
      after: 'c'.repeat(40),
      commits: [
        {
          id: 'c'.repeat(40),
          message: `fix(${working}): 修复空指针`,
          url: 'https://gitlab.example.com/c',
        },
      ],
    }).expect(200);
    expect(push.body).toMatchObject({
      provider: 'gitlab',
      event: 'Push Hook',
      linked: [{ code: working, kind: 'commit', target: 'c'.repeat(40) }],
    });

    // 处理中的缺陷：MR 合并只关联、不流转
    const mergedWorking = await gitlab(
      'Merge Request Hook',
      gitlabMr(working, 'merge', 'merged', 3),
    ).expect(200);
    expect(mergedWorking.body.transitioned).toEqual([]);
    const dw = await detail(working);
    expect(dw.status).toBe('in_progress');
    expect(dw.links).toContainEqual(
      expect.objectContaining({
        kind: 'mr',
        target: 'https://gitlab.example.com/acme/app/-/merge_requests/3',
        state: 'merged',
      }),
    );

    // MR 更新（非合并）不流转
    const updated = await gitlab(
      'Merge Request Hook',
      gitlabMr(reviewing, 'update', 'opened', 4),
    ).expect(200);
    expect(updated.body.transitioned).toEqual([]);
    expect((await detail(reviewing)).status).toBe('in_review');

    const merged = await gitlab(
      'Merge Request Hook',
      gitlabMr(reviewing, 'merge', 'merged', 4),
    ).expect(200);
    expect(merged.body.transitioned).toEqual([reviewing]);
    const dr = await detail(reviewing);
    expect(dr.status).toBe('resolved');
    expect(dr.links).toEqual([expect.objectContaining({ kind: 'mr', state: 'merged' })]);
    expect(dr.comments.at(-1)).toMatchObject({
      via: 'system',
      body: '【标记已合并】MR 已合并：https://gitlab.example.com/acme/app/-/merge_requests/4',
    });
  });
});
