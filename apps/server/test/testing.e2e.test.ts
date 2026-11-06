import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };

/** Claude 生成稿（POC 格式）里的一条用例：执行方式写中文、前置条件和测试数据用 pre / data */
const POC_CASE = {
  id: 'WEA-02',
  module: '天气',
  priority: 'P1',
  title: '关闭「显示时间」时隐藏「显示天气」',
  pre: 'BOX 在线',
  steps: ['关闭「显示时间」', '再打开「显示时间」'],
  expected: ['关闭后「显示天气」隐藏', '打开后恢复'],
  data: '',
  mode: '自动',
  env: '编辑器、真机',
  source: '一、2',
};

describe('automated testing: cases and runs (e2e)', () => {
  let ctx: TestContext;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let tester: Awaited<ReturnType<typeof createUser>>;
  let dev: Awaited<ReturnType<typeof createUser>>;
  let key: string;
  let url: URL;
  const base = () => `/api/v1/projects/${key}/tests`;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0, '127.0.0.1');
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    url = new URL(`http://127.0.0.1:${port}/api/v1/mcp`);

    admin = await createUser(ctx, { isSystemAdmin: true });
    tester = await createUser(ctx, { name: '测试' });
    dev = await createUser(ctx, { name: '开发' });
    key = projectKey('TST');
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key, name: '测试项目' })
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
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('imports Claude-generated cases as drafts with sequential codes', async () => {
    const res = await ctx.http
      .post(`${base()}/cases/import`)
      .set(auth(tester.token))
      .send({
        source: 'https://claude.ai/artifact/doc',
        origin: 'ai',
        cases: [
          POC_CASE,
          {
            ...POC_CASE,
            title: 'BOX 离线时不能切换',
            mode: '人工',
            manualReason: '需要让 BOX 离线',
          },
        ],
      })
      .expect(201);
    expect(res.body).toEqual({ count: 2, codes: ['TC-1', 'TC-2'] });

    const list = await ctx.http.get(`${base()}/cases`).set(auth(dev.token)).expect(200);
    expect(list.body.total).toBe(2);
    const [first, second] = list.body.items;
    expect(first).toMatchObject({
      code: 'TC-1',
      status: 'draft',
      origin: 'ai',
      mode: 'auto',
      precondition: 'BOX 在线',
      source: '一、2',
      steps: POC_CASE.steps,
    });
    expect(second).toMatchObject({ code: 'TC-2', mode: 'manual', manualReason: '需要让 BOX 离线' });
  });

  it('rejects writes from developers and bad payloads', async () => {
    await ctx.http
      .post(`${base()}/cases`)
      .set(auth(dev.token))
      .send({ title: 'x', steps: ['a'], expected: ['b'] })
      .expect(403);
    const bad = await ctx.http
      .post(`${base()}/cases`)
      .set(auth(tester.token))
      .send({ title: '没有步骤', steps: [], expected: ['b'], mode: '半自动' })
      .expect(400);
    expect(JSON.stringify(bad.body.issues)).toContain('steps');
  });

  it('creates, edits, filters and bulk-reviews cases', async () => {
    const created = await ctx.http
      .post(`${base()}/cases`)
      .set(auth(tester.token))
      .send({
        title: '首页 4 格',
        module: '首页框架',
        steps: ['进入首页'],
        expected: ['显示 4 格'],
        testData: '经期关怀：关',
      })
      .expect(201);
    expect(created.body).toMatchObject({ code: 'TC-3', origin: 'manual', status: 'draft' });

    await ctx.http
      .patch(`${base()}/cases/${created.body.id}`)
      .set(auth(tester.token))
      .send({ priority: 'P0', testData: '经期关怀：关 / 开' })
      .expect(200);

    const all = await ctx.http.get(`${base()}/cases`).set(auth(tester.token)).expect(200);
    const ids = all.body.items.map((c: { id: string }) => c.id);
    await ctx.http
      .post(`${base()}/cases/bulk`)
      .set(auth(tester.token))
      .send({ ids, action: 'approve' })
      .expect(201);

    const approved = await ctx.http
      .get(`${base()}/cases`)
      .query({ status: 'approved', module: '首页框架' })
      .set(auth(tester.token))
      .expect(200);
    expect(approved.body.items).toHaveLength(1);
    expect(approved.body.items[0]).toMatchObject({ priority: 'P0', testData: '经期关怀：关 / 开' });

    const byCode = await ctx.http
      .get(`${base()}/cases`)
      .query({ keyword: 'tc-3' })
      .set(auth(tester.token))
      .expect(200);
    expect(byCode.body.items.map((c: { code: string }) => c.code)).toEqual(['TC-3']);

    const modules = await ctx.http.get(`${base()}/cases/modules`).set(auth(dev.token)).expect(200);
    expect(modules.body).toEqual([
      { module: '天气', count: 2 },
      { module: '首页框架', count: 1 },
    ]);
  });

  it('runs cases, records results and links a defect', async () => {
    const cases = (await ctx.http.get(`${base()}/cases`).set(auth(tester.token)).expect(200)).body
      .items as { id: string; code: string }[];
    const run = await ctx.http
      .post(`${base()}/runs`)
      .set(auth(tester.token))
      .send({
        name: '1.0.2 冒烟',
        env: '华为 SEA-AL10',
        build: 'cn_1.0.2',
        caseIds: cases.map((c) => c.id),
      })
      .expect(201);
    expect(run.body).toMatchObject({ code: 'RUN-1', status: 'running' });

    const caseId = cases[0].id;
    await ctx.http
      .patch(`${base()}/runs/${run.body.id}/results/${caseId}`)
      .set(auth(dev.token))
      .send({ status: 'passed' })
      .expect(403);
    await ctx.http
      .patch(`${base()}/runs/${run.body.id}/results/${caseId}`)
      .set(auth(tester.token))
      .send({ status: 'failed', note: '显示天气没有隐藏', defectCode: `${key}-999` })
      .expect(400);

    const defect = await ctx.http
      .post(`/api/v1/projects/${key}/defects`)
      .set(auth(tester.token))
      .send({ title: '显示天气没有隐藏', severity: 'normal' })
      .expect(201);
    await ctx.http
      .patch(`${base()}/runs/${run.body.id}/results/${caseId}`)
      .set(auth(tester.token))
      .send({ status: 'failed', note: '显示天气没有隐藏', defectCode: defect.body.code })
      .expect(200);
    await ctx.http
      .patch(`${base()}/runs/${run.body.id}/results/${cases[1].id}`)
      .set(auth(tester.token))
      .send({ status: 'doubtful', note: '文案不同' })
      .expect(200);

    const detail = await ctx.http
      .get(`${base()}/runs/${run.body.id}`)
      .set(auth(dev.token))
      .expect(200);
    expect(detail.body.results).toHaveLength(cases.length);
    expect(detail.body.results[0]).toMatchObject({
      status: 'failed',
      executor: 'manual',
      executedByName: '测试',
      defectCode: defect.body.code,
      testCase: { code: 'TC-1' },
    });

    const runs = await ctx.http.get(`${base()}/runs`).set(auth(dev.token)).expect(200);
    expect(runs.body[0]).toMatchObject({
      code: 'RUN-1',
      createdByName: '测试',
      stats: { failed: 1, doubtful: 1, pending: cases.length - 2 },
    });

    const done = await ctx.http
      .patch(`${base()}/runs/${run.body.id}`)
      .set(auth(tester.token))
      .send({ status: 'done' })
      .expect(200);
    expect(done.body.finishedAt).toBeTruthy();
  });

  it('refuses obsolete cases in a new run', async () => {
    const cases = (await ctx.http.get(`${base()}/cases`).set(auth(tester.token)).expect(200)).body
      .items as { id: string }[];
    await ctx.http
      .post(`${base()}/cases/bulk`)
      .set(auth(tester.token))
      .send({ ids: [cases[0].id], action: 'obsolete' })
      .expect(201);
    const res = await ctx.http
      .post(`${base()}/runs`)
      .set(auth(tester.token))
      .send({ name: '回归', caseIds: [cases[0].id] })
      .expect(400);
    expect(res.body.message).toContain('已废弃');
  });

  it('lets Claude save and list cases through MCP', async () => {
    const token = (
      await ctx.http
        .post('/api/v1/auth/tokens')
        .set(auth(tester.token))
        .send({ name: 'Claude Code' })
        .expect(201)
    ).body.token as string;
    const client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    try {
      const prompt = await client.getPrompt({
        name: 'gen_test_cases',
        arguments: { project: key, source: 'https://claude.ai/artifact/doc' },
      });
      expect(JSON.stringify(prompt.messages)).toContain('save_test_cases');

      const saved = (await client.callTool({
        name: 'save_test_cases',
        arguments: {
          project: key,
          source: 'https://claude.ai/artifact/doc',
          cases: [{ ...POC_CASE, title: '纪念日入口' }],
        },
      })) as ToolResult;
      expect(saved.isError).toBeFalsy();
      expect(saved.content[0].text).toContain('已保存 1 条用例（自动 1，人工 0）');

      const listed = (await client.callTool({
        name: 'list_test_cases',
        arguments: { project: key, keyword: '纪念日' },
      })) as ToolResult;
      expect(listed.content[0].text).toMatch(/TC-\d+\t\[draft\/auto\/P1\]\t天气\t纪念日入口/);
    } finally {
      await client.close();
    }
  });
});
