import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

const CRASH_LOG = [
  '10-16 10:21:01.100 I/OrderPage: onResume',
  '10-16 10:21:02.200 E/AndroidRuntime: FATAL EXCEPTION: main',
  'java.lang.IllegalStateException: order status not refreshed',
  '    at com.example.order.OrderDetailActivity.refresh(OrderDetailActivity.kt:88)',
  '    at com.example.order.OrderDetailActivity.onResume(OrderDetailActivity.kt:42)',
].join('\n');
// 1×1 透明 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

describe('APP defect submission (e2e)', () => {
  let ctx: TestContext;
  let prisma: PrismaService;
  let key: string;
  let appId: string;
  let adminToken: string;
  let testerId: string;
  let testerName: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.app.get(PrismaService);
    const admin = await createUser(ctx, { isSystemAdmin: true });
    adminToken = admin.token;
    key = projectKey('ING');
    appId = `com.test.${key.toLowerCase()}`;
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(adminToken))
      .send({ key, name: '接入测试', appIds: [appId] })
      .expect(201);
    testerName = `提单测试${key}`;
    const tester = await createUser(ctx, { name: testerName });
    testerId = tester.id;
    await ctx.http
      .post(`/api/v1/projects/${key}/members`)
      .set(auth(adminToken))
      .send({ email: tester.email, role: 'tester' })
      .expect(201);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const submit = (fields: Record<string, string>, files: [Buffer, string][] = []) => {
    let req = ctx.http.post('/api/v1/app/defects');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    for (const [data, name] of files) req = req.attach('files', data, name);
    return req;
  };

  const detail = async (code: string) =>
    (await ctx.http.get(`/api/v1/projects/${key}/defects/${code}`).set(auth(adminToken))).body;

  it('rejects requests without required fields or with an unbound APP', async () => {
    const missing = await submit({ description: '没有 appId' }).expect(400);
    expect(missing.body.message).toContain('appId');
    await submit({ appId }).expect(400);
    const unbound = await submit({ appId: 'com.not.bound', description: '未绑定' }).expect(400);
    expect(unbound.body.message).toContain('还没有绑定到任何项目');
    await submit({ appId, description: 'x', severity: 'urgent' }).expect(400);
    await submit({ appId, description: 'x', reportId: 'not-a-uuid' }).expect(400);
  });

  it('creates a defect with files, log summary and the matched reporter', async () => {
    const reportId = randomUUID();
    const res = await submit(
      {
        appId,
        reportId,
        description: '支付成功后返回 APP，订单页仍显示待支付。随后闪退',
        reporterName: testerName,
        appVersion: '3.12.0',
        appBuild: '31200',
        appCommit: 'a1b2c3d',
        deviceModel: 'Pixel 9',
        osVersion: 'Android 15',
        page: 'OrderDetailActivity',
        frequency: 'always',
        // multipart 里的换行按规范是 \r\n，保存时统一成 \n
        steps: '1. 支付\r\n2. 返回订单页',
        extra: JSON.stringify({ network: 'WIFI' }),
      },
      [
        [PNG, '截图1.png'],
        [Buffer.from(CRASH_LOG), 'app.log'],
      ],
    ).expect(201);
    expect(res.body).toMatchObject({ reportId, created: true });
    expect(res.body.code).toMatch(new RegExp(`^${key}-\\d+$`));
    expect(res.body.url).toBe(`/p/${key}/bugs/${res.body.code}`);

    const d = await detail(res.body.code);
    expect(d).toMatchObject({
      source: 'app',
      // 没传标题时取描述的第一句
      title: '支付成功后返回 APP，订单页仍显示待支付',
      severity: 'normal',
      frequency: 'always',
      steps: '1. 支付\n2. 返回订单页',
      appCommit: 'a1b2c3d',
      reporterId: testerId,
      verifierId: testerId,
    });
    expect(d.description).toContain(`APP：${appId} 3.12.0 (31200)`);
    expect(d.description).toContain('页面：OrderDetailActivity');
    expect(d.description).toContain('设备：Pixel 9 / Android 15');
    expect(d.description).not.toContain('提单人');
    expect(d.logSummary).toContain('IllegalStateException');
    expect(d.attachments.map((a: { fileName: string }) => a.fileName).sort()).toEqual([
      'app.log',
      '截图1.png',
    ]);
    expect(d.deviceInfo).toMatchObject({
      app: { id: appId, version: '3.12.0' },
      device: { model: 'Pixel 9' },
      extra: { network: 'WIFI' },
    });
    const report = await prisma.feedbackReport.findUniqueOrThrow({ where: { reportId } });
    expect(report.status).toBe('created');

    // APP 超时重试：同一个 reportId 不重复建单，返回原来的编号
    const retry = await submit({ appId, reportId, description: '重试' }, [[PNG, 'a.png']]).expect(
      201,
    );
    expect(retry.body).toMatchObject({ code: res.body.code, created: false });
    expect((await detail(res.body.code)).attachments).toHaveLength(2);
  });

  it('creates a new defect every time, even for the same crash', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await submit({ appId, title: `同一个崩溃 ${i}`, description: '闪退' }, [
        [Buffer.from(CRASH_LOG), 'crash.log'],
      ]).expect(201);
      codes.push(r.body.code);
    }
    expect(new Set(codes).size).toBe(2);
    expect(await detail(codes[1]!)).toMatchObject({ title: '同一个崩溃 1' });
  });

  it('creates only one defect when the same reportId is submitted concurrently', async () => {
    const reportId = randomUUID();
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        submit({ appId, reportId, description: '并发重试' }, [[Buffer.from(CRASH_LOG), 'a.log']]),
      ),
    );
    const ok = results.filter((r) => r.status === 201);
    // 认领成功的一个建单；其余要么正在处理（409），要么拿到同一个编号
    expect(ok.filter((r) => r.body.created)).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(new Set(ok.map((r) => r.body.code)).size).toBe(1);
    const again = await submit({ appId, reportId, description: '并发重试' }).expect(201);
    expect(again.body).toMatchObject({ code: ok[0]!.body.code, created: false });
    const d = await detail(ok[0]!.body.code);
    expect(d.attachments).toHaveLength(1);
  });

  it('rejects unsupported file types and unbound APPs before storing files', async () => {
    const html = await submit({ appId, description: '网页文件' }, [
      [Buffer.from('<script>alert(1)</script>'), 'x.html'],
    ]).expect(400);
    expect(html.body.message).toContain('不支持的文件类型：x.html');
    const unbound = await submit({ appId: 'com.not.bound', description: '未绑定' }, [
      [PNG, 'a.png'],
    ]).expect(400);
    expect(unbound.body.message).toContain('还没有绑定到任何项目');
    // 录音等格式可以上传，原样保存为“其他”附件
    const voice = await submit({ appId, description: '带录音' }, [
      [Buffer.from('fake-m4a'), 'voice.m4a'],
    ]).expect(201);
    expect((await detail(voice.body.code)).attachments[0]).toMatchObject({
      fileName: 'voice.m4a',
      kind: 'other',
    });
  });

  it('keeps the reporter name in the description when no unique user matches', async () => {
    const unknown = await submit({
      appId,
      description: '按钮点击无响应',
      reporterName: '不存在的人',
      severity: 'serious',
    }).expect(201);
    const d = await detail(unknown.body.code);
    expect(d).toMatchObject({ reporterId: null, severity: 'serious' });
    expect(d.description).toContain('提单人：不存在的人（未匹配到平台用户）');

    const twin = `同名${key}`;
    await createUser(ctx, { name: twin });
    await createUser(ctx, { name: twin });
    const dup = await submit({ appId, description: '同名', reporterName: twin }).expect(201);
    expect((await detail(dup.body.code)).description).toContain('平台有多个同名用户');
  });

  it('limits the number of files and keeps same-named files apart', async () => {
    const many = Array.from({ length: 11 }, (_, i): [Buffer, string] => [PNG, `${i}.png`]);
    await submit({ appId, description: '太多文件' }, many).expect(400);

    const same = await submit({ appId, description: '同名文件' }, [
      [PNG, 'shot.png'],
      [PNG, 'shot.png'],
    ]).expect(201);
    const names = (await detail(same.body.code)).attachments.map(
      (a: { fileName: string }) => a.fileName,
    );
    expect(names.sort()).toEqual(['shot-2.png', 'shot.png']);
  });

  it('allows an APP identifier to be bound to only one project', async () => {
    const conflict = await ctx.http
      .post('/api/v1/projects')
      .set(auth(adminToken))
      .send({ key: projectKey('ING'), name: '另一个项目', appIds: [appId] })
      .expect(409);
    expect(conflict.body.message).toContain('已绑定到项目「接入测试」');
  });

  it('assigns owners by name, including users outside the project', async () => {
    const devName = `处理开发${key}`;
    const dev = await createUser(ctx, { name: devName });
    await ctx.http
      .post(`/api/v1/projects/${key}/members`)
      .set(auth(adminToken))
      .send({ email: dev.email, role: 'developer' })
      .expect(201);
    const outsiderName = `项目外${key}`;
    const outsider = await createUser(ctx, { name: outsiderName });

    // 逗号、顿号分隔，重复的名字只算一次
    const res = await submit({
      appId,
      description: '指派处理人',
      ownerNames: `${devName}，${outsiderName}、查无此人,${devName}`,
    }).expect(201);
    const d = await detail(res.body.code);
    expect(d.ownerIds).toEqual([dev.id, outsider.id]);
    expect(d.description).toContain(
      `处理人：${outsiderName}（不是项目成员，加入项目后才能看到并处理）；查无此人（未匹配到平台用户）`,
    );

    // 一个都匹配不上：照常建单，按默认规则指派（本项目没配模块负责人和默认处理人，所以为空）
    const none = await submit({ appId, description: '无人匹配', ownerNames: '谁也不是' }).expect(
      201,
    );
    const n = await detail(none.body.code);
    expect(n.ownerIds).toEqual([]);
    expect(n.description).toContain('处理人：谁也不是（未匹配到平台用户）；已按默认规则指派处理人');

    await submit({
      appId,
      description: '太多处理人',
      ownerNames: Array.from({ length: 11 }, (_, i) => `人${i}`).join(','),
    }).expect(400);
  });
});
