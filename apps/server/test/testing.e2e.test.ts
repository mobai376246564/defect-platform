import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };

const HEADER = [
  '用例编号',
  '需求文档',
  '模块',
  '子模块',
  '测试点',
  '用例标题',
  '优先级',
  '用例类型',
  '前置条件',
  '测试步骤',
  '预期结果',
  '实际结果',
  '测试结果',
  '备注',
];

/** 按团队用例表的格式造一个 Excel：概览、测试点汇总、需求待确认、两个模块工作表 */
async function teamWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ov = wb.addWorksheet('概览');
  ov.getCell('A1').value = 'BUD BOX 1.0.2 需求测试用例';
  ov.getCell('A3').value = '需求来源';
  ov.getCell('A4').value = 'https://claude.ai/artifact/doc（rev 148）';
  ov.getRow(6).values = ['需求文档', '模块', '工作表', '用例数', 'P0', 'P1', 'P2', 'P3'];
  ov.getRow(7).values = ['BUD BOX 1.0.2 需求', '首页框架与多台BOX', '首页与多台BOX', 1, 1, 0, 0, 0];
  ov.getRow(8).values = ['BUD BOX 1.0.2 需求', '天气', '天气', 2, 1, 1, 0, 0];
  ov.getRow(9).values = ['合计', { formula: 'SUM(D7:D8)', result: 3 }];
  ov.getCell('A11').value = '优先级说明：P0 核心功能';
  wb.addWorksheet('测试点汇总').addRow(['序号', '需求文档', '模块', '子模块', '测试点']);
  const q = wb.addWorksheet('需求待确认');
  q.addRow(['序号', '需求文档', '模块', '问题描述', '确认结果', '确认人']);
  q.addRow([1, 'BUD BOX 1.0.2 需求', '天气', '35℃ 是否含 35℃？', '', '']);
  const home = wb.addWorksheet('首页与多台BOX');
  home.addRow(HEADER);
  home.addRow([
    'HOME-001',
    'BUD BOX 1.0.2 需求',
    '首页框架与多台BOX',
    '首页功能格',
    '格子布局',
    '未开经期时 4 格',
    'P0',
    '功能',
    '经期关怀未开启',
    '1. 进入首页',
    '显示 4 格',
    '',
    '未执行',
    '',
  ]);
  const weather = wb.addWorksheet('天气');
  weather.addRow(HEADER);
  weather.addRow([
    'WEA-001',
    'BUD BOX 1.0.2 需求',
    '天气',
    '硬件显示',
    '天气显示',
    'BOX 时间旁显示天气',
    'P0',
    '硬件',
    'BOX 在线',
    '1. 查看 BOX',
    '显示图标 + 温度',
    '',
    '未执行',
    '',
  ]);
  weather.addRow([
    'WEA-002',
    'BUD BOX 1.0.2 需求',
    '天气',
    '设置开关',
    '联动',
    { richText: [{ text: '关闭显示时间' }, { text: '隐藏显示天气' }] },
    'P1',
    '功能',
    '',
    '1. 关闭「显示时间」\n2. 查看页面',
    '「显示天气」隐藏',
    '已隐藏',
    '通过',
    '',
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('automated testing: case files (e2e)', () => {
  let ctx: TestContext;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let tester: Awaited<ReturnType<typeof createUser>>;
  let dev: Awaited<ReturnType<typeof createUser>>;
  let key: string;
  let url: URL;
  let suiteId: string;
  const base = () => `/api/v1/projects/${key}/tests/suites`;

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

  it('imports a team-format Excel as one case file', async () => {
    await ctx.http
      .post(`${base()}/import`)
      .set(auth(dev.token))
      .attach('file', await teamWorkbook(), 'x.xlsx')
      .expect(403);

    const res = await ctx.http
      .post(`${base()}/import`)
      .set(auth(tester.token))
      .attach('file', await teamWorkbook(), 'BUD BOX 用例.xlsx')
      .expect(201);
    expect(res.body).toMatchObject({ name: 'BUD BOX 1.0.2 需求测试用例', total: 3 });
    suiteId = res.body.id;

    const suite = (await ctx.http.get(`${base()}/${suiteId}`).set(auth(dev.token)).expect(200))
      .body;
    expect(suite).toMatchObject({
      docName: 'BUD BOX 1.0.2 需求',
      source: 'https://claude.ai/artifact/doc（rev 148）',
      notes: ['优先级说明：P0 核心功能'],
      round: 1,
      sheets: [
        { name: '首页与多台BOX', module: '首页框架与多台BOX' },
        { name: '天气', module: '天气' },
      ],
      questions: [{ seq: 1, module: '天气', question: '35℃ 是否含 35℃？' }],
    });
    expect(suite.cases.map((c: { code: string }) => c.code)).toEqual([
      'HOME-001',
      'WEA-001',
      'WEA-002',
    ]);
    // 硬件类按用例类型推断为人工；富文本、已填的结果都能读出来
    expect(suite.cases[1]).toMatchObject({ mode: 'manual', priority: 'P0', result: 'pending' });
    expect(suite.cases[2]).toMatchObject({
      mode: 'auto',
      title: '关闭显示时间隐藏显示天气',
      steps: '1. 关闭「显示时间」\n2. 查看页面',
      actualResult: '已隐藏',
      result: 'passed',
    });

    const list = await ctx.http.get(base()).set(auth(dev.token)).expect(200);
    expect(list.body[0]).toMatchObject({
      total: 3,
      sheetCount: 2,
      stats: { pending: 2, passed: 1 },
    });
  });

  it('rejects files that are not team-format test cases', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['随便', '什么']);
    const res = await ctx.http
      .post(`${base()}/import`)
      .set(auth(tester.token))
      .attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 'x.xlsx')
      .expect(400);
    expect(res.body.message).toContain('用例编号');
    await ctx.http
      .post(`${base()}/import`)
      .set(auth(tester.token))
      .attach('file', Buffer.from('a,b'), 'x.csv')
      .expect(400);
  });

  it('records results, links defects and starts a new round', async () => {
    const suite = (await ctx.http.get(`${base()}/${suiteId}`).set(auth(tester.token))).body;
    const home = suite.cases[0];
    await ctx.http
      .patch(`${base()}/${suiteId}/cases/${home.id}`)
      .set(auth(dev.token))
      .send({ result: '通过' })
      .expect(403);

    const defect = await ctx.http
      .post(`/api/v1/projects/${key}/defects`)
      .set(auth(tester.token))
      .send({ title: '首页只有 3 格', severity: 'normal' })
      .expect(201);
    const updated = await ctx.http
      .patch(`${base()}/${suiteId}/cases/${home.id}`)
      .set(auth(tester.token))
      .send({ result: '失败', actualResult: '只有 3 格', defectCode: defect.body.code })
      .expect(200);
    expect(updated.body).toMatchObject({
      result: 'failed',
      executor: 'manual',
      defectCode: defect.body.code,
    });

    // 只改传了的字段：改备注不会把结果重置
    await ctx.http
      .patch(`${base()}/${suiteId}/cases/${home.id}`)
      .set(auth(tester.token))
      .send({ remark: '安卓复现' })
      .expect(200);
    const after = (await ctx.http.get(`${base()}/${suiteId}`).set(auth(tester.token))).body;
    expect(after.cases[0]).toMatchObject({
      result: 'failed',
      remark: '安卓复现',
      executedByName: '测试',
    });

    const q = after.questions[0];
    await ctx.http
      .patch(`${base()}/${suiteId}/questions/${q.id}`)
      .set(auth(tester.token))
      .send({ answer: '含 35℃', confirmer: '产品' })
      .expect(200);

    const round = await ctx.http
      .post(`${base()}/${suiteId}/rounds`)
      .set(auth(tester.token))
      .expect(201);
    expect(round.body).toEqual({ round: 2 });
    const reset = (await ctx.http.get(`${base()}/${suiteId}`).set(auth(tester.token))).body;
    expect(reset.cases.every((c: { result: string }) => c.result === 'pending')).toBe(true);
    expect(reset.cases[0]).toMatchObject({
      remark: '安卓复现',
      defectCode: null,
      actualResult: '',
    });
    expect(reset.rounds[0]).toMatchObject({
      round: 1,
      stats: { failed: 1, passed: 1, pending: 1 },
    });

    const archived = await ctx.http
      .get(`${base()}/${suiteId}/rounds/1`)
      .set(auth(dev.token))
      .expect(200);
    expect(archived.body.results[0]).toMatchObject({
      code: 'HOME-001',
      result: 'failed',
      defectCode: defect.body.code,
    });
  });

  it('exports an Excel that imports back to the same file', async () => {
    const res = await ctx.http
      .get(`${base()}/${suiteId}/export`)
      .set(auth(dev.token))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-disposition']).toContain(
      encodeURIComponent('BUD BOX 1.0.2 需求测试用例'),
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      '概览',
      '测试点汇总',
      '需求待确认',
      '首页与多台BOX',
      '天气',
    ]);
    const weather = wb.getWorksheet('天气')!;
    expect(weather.getRow(1).getCell(15).value).toBe('执行方式');
    expect(weather.getRow(2).getCell(15).value).toBe('人工');
    expect(weather.getRow(2).getCell(13).dataValidation?.formulae?.[0]).toContain('存疑');
    expect(wb.getWorksheet('需求待确认')!.getRow(2).getCell(5).value).toBe('含 35℃');
    expect(wb.getWorksheet('测试点汇总')!.getRow(3).values).toContain('WEA-001');

    const again = await ctx.http
      .post(`${base()}/import`)
      .set(auth(tester.token))
      .attach('file', res.body as Buffer, 'export.xlsx')
      .expect(201);
    const copy = (await ctx.http.get(`${base()}/${again.body.id}`).set(auth(tester.token))).body;
    expect(copy.sheets).toEqual([
      { name: '首页与多台BOX', module: '首页框架与多台BOX' },
      { name: '天气', module: '天气' },
    ]);
    expect(copy.cases.map((c: { code: string; mode: string }) => [c.code, c.mode])).toEqual([
      ['HOME-001', 'auto'],
      ['WEA-001', 'manual'],
      ['WEA-002', 'auto'],
    ]);
    expect(copy.questions[0]).toMatchObject({ answer: '含 35℃', confirmer: '产品' });

    await ctx.http.delete(`${base()}/${again.body.id}`).set(auth(tester.token)).expect(204);
  });

  it('lets Claude generate a case file through MCP', async () => {
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
      // Claude Code 连接时会先列出工具，入参 schema 必须能转成 JSON Schema
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'list_test_suites',
          'create_test_suite',
          'add_test_cases',
          'add_requirement_questions',
        ]),
      );
      const prompt = await client.getPrompt({
        name: 'gen_test_cases',
        arguments: { project: key, source: 'https://claude.ai/artifact/doc' },
      });
      expect(JSON.stringify(prompt.messages)).toContain('add_test_cases');

      const created = (await client.callTool({
        name: 'create_test_suite',
        arguments: {
          project: key,
          name: '专注需求测试用例',
          docName: '专注需求',
          source: 'https://claude.ai/artifact/doc',
          sheets: [{ name: '专注', module: '专注' }],
        },
      })) as ToolResult;
      const id = /id：(\S+)/.exec(created.content[0].text ?? '')?.[1];
      expect(id).toBeTruthy();

      const added = (await client.callTool({
        name: 'add_test_cases',
        arguments: {
          project: key,
          suiteId: id,
          sheet: '专注',
          cases: [
            {
              code: 'FOC-001',
              module: '专注',
              subModule: '聊天开始',
              testPoint: '时长上限',
              title: '专注 90 分钟按 60 分钟',
              priority: 'P1',
              caseType: '边界',
              steps: ['发送「专注 90 分钟」', '点开始'],
              expected: '伙伴说明按 60 分钟',
            },
            {
              code: 'FOC-002',
              title: 'BOX 旋钮结束专注',
              caseType: '硬件',
              steps: '1. 拧旋钮',
              expected: '专注结束',
            },
          ],
        },
      })) as ToolResult;
      expect(added.isError).toBeFalsy();
      expect(added.content[0].text).toContain('已写入 2 条');

      await client.callTool({
        name: 'add_requirement_questions',
        arguments: {
          project: key,
          suiteId: id,
          questions: [{ module: '专注', question: '专注中被唤醒时伙伴怎么回应？' }],
        },
      });

      const suite = (await ctx.http.get(`${base()}/${id}`).set(auth(tester.token))).body;
      expect(suite.cases[0]).toMatchObject({
        steps: '1. 发送「专注 90 分钟」\n2. 点开始',
        mode: 'auto',
      });
      expect(suite.cases[1]).toMatchObject({ mode: 'manual', priority: 'P2' });
      expect(suite.questions).toHaveLength(1);

      const dup = (await client.callTool({
        name: 'add_test_cases',
        arguments: {
          project: key,
          suiteId: id,
          sheet: '专注',
          cases: [{ code: 'FOC-001', title: '重复', steps: 'x', expected: 'y' }],
        },
      })) as ToolResult;
      expect(dup.isError).toBe(true);
      expect(dup.content[0].text).toContain('FOC-001');
    } finally {
      await client.close();
    }
  });
});
