import { reportDate } from '@defect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SnapshotService } from '../src/reports/snapshot.service';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;

/**
 * 报表口径测试：先走真实流转产生数据，再把关键时间戳改成固定值，
 * 使统计窗口 2026-10-12（周一）～ 2026-10-18（周日，北京时间）内的指标可精确断言。
 */
describe('reports (e2e)', () => {
  let ctx: TestContext;
  let prisma: PrismaService;
  let admin: User;
  let tester: User;
  let dev: User;
  let outsider: User;
  let key: string;
  let projectId: string;
  let moduleId: string;
  let subModuleId: string;
  let versionId: string;
  const codes: Record<'d1' | 'd2' | 'd3', string> = { d1: '', d2: '', d3: '' };
  const base = () => `/api/v1/projects/${key}`;
  const WEEK = 'from=2026-10-12&to=2026-10-18';

  const report = async (name: string, query = WEEK, u: User = tester) =>
    (await ctx.http.get(`${base()}/reports/${name}?${query}`).set(auth(u.token)).expect(200)).body;

  const move = (code: string, data: Record<string, unknown>) =>
    prisma.defect.update({ where: { projectId_code: { projectId, code } }, data });

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.app.get(PrismaService);
    admin = await createUser(ctx, { isSystemAdmin: true });
    tester = await createUser(ctx, { name: '报表测试' });
    dev = await createUser(ctx, { name: '报表开发' });
    outsider = await createUser(ctx);
    key = projectKey('R');
    const project = await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key, name: '报表项目', appIds: [`com.reports.${key.toLowerCase()}`] })
      .expect(201);
    projectId = project.body.id;
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
    subModuleId = (
      await ctx.http
        .post(`${base()}/modules`)
        .set(auth(admin.token))
        .send({ name: '退款', parentId: moduleId })
        .expect(201)
    ).body.id;
    versionId = (
      await ctx.http
        .post(`${base()}/versions`)
        .set(auth(admin.token))
        .send({ name: '1.0.0' })
        .expect(201)
    ).body.id;

    const create = async (body: Record<string, unknown>) =>
      (await ctx.http.post(`${base()}/defects`).set(auth(tester.token)).send(body).expect(201)).body
        .code as string;
    const go = (code: string, u: User, body: Record<string, unknown>) =>
      ctx.http
        .post(`${base()}/defects/${code}/transitions`)
        .set(auth(u.token))
        .send(body)
        .expect(200);

    // D1：致命，支付模块，1.0.0；解决 → 重新打开 → 再解决 → 关闭
    codes.d1 = await create({
      title: '支付失败',
      severity: 'fatal',
      moduleId,
      versionFoundId: versionId,
    });
    await go(codes.d1, tester, { transition: 'confirm', values: { priority: 'urgent', moduleId } });
    await go(codes.d1, dev, { transition: 'start' });
    await go(codes.d1, dev, {
      transition: 'resolve',
      values: { resolution: 'fixed' },
      comment: '已修',
    });
    await go(codes.d1, tester, { transition: 'reopen', comment: '还能复现' });
    await go(codes.d1, dev, { transition: 'submit_review' });
    await go(codes.d1, dev, { transition: 'merged' });
    await go(codes.d1, tester, { transition: 'verify' });

    // D2：一般，退款子模块；Claude 读取过后解决，停在“已解决”
    codes.d2 = await create({ title: '退款金额错误', severity: 'normal', moduleId: subModuleId });
    await go(codes.d2, tester, {
      transition: 'confirm',
      values: { priority: 'high', moduleId: subModuleId },
    });
    await go(codes.d2, dev, { transition: 'start' });
    await go(codes.d2, dev, { transition: 'submit_review' });
    await go(codes.d2, dev, { transition: 'merged' });

    // D3：严重，未分诊，APP 反馈来源且有 4 次重复反馈
    codes.d3 = await create({ title: '启动崩溃', severity: 'serious' });

    const d1 = await move(codes.d1, {
      createdAt: new Date('2026-10-12T01:00:00Z'),
      // 周一 10:00 确认，11:00 开始（响应 1h），周三 10:00 解决（48 工作小时，超出致命 1 天 SLA）
      confirmedAt: new Date('2026-10-12T02:00:00Z'),
      startedAt: new Date('2026-10-12T03:00:00Z'),
      resolvedAt: new Date('2026-10-14T02:00:00Z'),
      closedAt: new Date('2026-10-15T02:00:00Z'),
    });
    const d2 = await move(codes.d2, {
      createdAt: new Date('2026-10-12T01:00:00Z'),
      // 周五 10:00 确认，14:00 开始（4h），周日 10:00 解决：周末不计时，解决 14 工作小时
      confirmedAt: new Date('2026-10-16T02:00:00Z'),
      startedAt: new Date('2026-10-16T06:00:00Z'),
      resolvedAt: new Date('2026-10-18T02:00:00Z'),
    });
    await move(codes.d3, {
      createdAt: new Date('2026-10-12T01:00:00Z'),
      source: 'app',
      dupCount: 4,
    });
    await prisma.version.update({
      where: { id: versionId },
      data: { releasedAt: new Date('2026-10-13T00:00:00Z') },
    });

    // Claude：D2 解决前有 MCP 读取；D1 的 Claude 评论在解决之后，不算参与
    await prisma.mcpAudit.create({
      data: {
        userId: dev.id,
        tool: 'get_defect',
        defectId: d2.id,
        createdAt: new Date('2026-10-17T00:00:00Z'),
      },
    });
    await prisma.comment.create({
      data: {
        defectId: d1.id,
        authorId: dev.id,
        via: 'claude',
        body: '分析',
        createdAt: new Date('2026-10-15T00:00:00Z'),
      },
    });

    // APP 反馈：窗口内 4 条（2 条建单），窗口外 1 条
    const appId = `com.reports.${key.toLowerCase()}`;
    const feedback = [
      ['created', '2026-10-13T02:00:00Z'],
      ['merged', '2026-10-13T03:00:00Z'],
      ['created', '2026-10-14T02:00:00Z'],
      ['failed', '2026-10-18T15:00:00Z'],
      ['created', '2026-10-18T16:30:00Z'], // 北京时间 10-19，窗口外
    ];
    for (const [status, at] of feedback) {
      await prisma.feedbackReport.create({
        data: {
          reportId: crypto.randomUUID(),
          appId,
          storagePrefix: 'x/',
          status: status!,
          receivedAt: new Date(at!),
        },
      });
    }
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('checks access and filters', async () => {
    await ctx.http.get(`${base()}/reports/trend`).set(auth(outsider.token)).expect(404);
    await ctx.http.get(`${base()}/reports/nope`).set(auth(tester.token)).expect(404);
    await ctx.http
      .get(`${base()}/reports/trend?from=2026-10-18&to=2026-10-12`)
      .set(auth(tester.token))
      .expect(400);
    await ctx.http
      .get(`${base()}/reports/trend?from=2025-01-01&to=2026-10-12`)
      .set(auth(tester.token))
      .expect(400);
    await ctx.http.get(`${base()}/reports/trend?from=bad`).set(auth(tester.token)).expect(400);
    // 默认最近 30 天
    const def = await report('trend', '');
    expect(def.points).toHaveLength(30);
    expect(def.to).toBe(reportDate(new Date()));
  });

  it('draws the trend from timestamps and daily snapshots', async () => {
    const snapshots = ctx.app.get(SnapshotService);
    await snapshots.write('2026-10-17');
    const rows = await prisma.defectDailySnapshot.findMany({
      where: { projectId, date: new Date('2026-10-17T00:00:00Z') },
    });
    expect(rows.map((r) => [r.statusCategory, r.severity, r.count]).sort()).toEqual([
      ['done', 'fatal', 1],
      ['todo', 'serious', 1],
      ['verifying', 'normal', 1],
    ]);
    // 改大快照里的数字，证明存量取自快照
    await prisma.defectDailySnapshot.update({
      where: {
        projectId_date_statusCategory_severity: {
          projectId,
          date: new Date('2026-10-17T00:00:00Z'),
          statusCategory: 'todo',
          severity: 'serious',
        },
      },
      data: { count: 5 },
    });

    const trend = await report('trend');
    expect(trend.snapshotDays).toBe(1);
    const at = (d: string) => trend.points.find((p: { date: string }) => p.date === d);
    expect(at('2026-10-12')).toEqual({
      date: '2026-10-12',
      created: 3,
      resolved: 0,
      closed: 0,
      open: 3,
    });
    expect(at('2026-10-14')).toMatchObject({ resolved: 1, open: 3 });
    expect(at('2026-10-15')).toMatchObject({ closed: 1, open: 2 });
    expect(at('2026-10-17')).toMatchObject({ open: 6 });
    expect(at('2026-10-18')).toMatchObject({ resolved: 1, open: 2 });

    // 按模块筛选时不能用快照；模块包含子模块
    const byModule = await report('trend', `${WEEK}&moduleId=${moduleId}`);
    expect(byModule.snapshotDays).toBe(0);
    expect(byModule.points[0]).toMatchObject({ created: 2, open: 2 });
    expect(byModule.points[5]).toMatchObject({ open: 1 });

    const weekly = await report('trend', `${WEEK}&granularity=week`);
    expect(weekly.points).toEqual([
      { date: '2026-10-12', created: 3, resolved: 2, closed: 1, open: 2 },
    ]);
  });

  it('writes the snapshot from the daily job and schedules the next day', async () => {
    const jobs = ctx.app.get(JobsService);
    const snapshots = ctx.app.get(SnapshotService);
    const today = reportDate(new Date());
    const yesterday = reportDate(new Date(Date.now() - 86_400_000));
    await snapshots.schedule(yesterday);
    await jobs.drain();
    const count = await prisma.defectDailySnapshot.count({
      where: { projectId, date: new Date(`${yesterday}T00:00:00Z`) },
    });
    expect(count).toBe(3);
    const next = await prisma.job.findUnique({ where: { dedupeKey: `snapshot:${today}` } });
    expect(next).toMatchObject({ status: 'queued' });
    expect(next!.runAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not run jobs early when the database session is not in UTC', async () => {
    const jobs = ctx.app.get(JobsService);
    // 嵌入式 PostgreSQL 跟随系统时区（Asia/Shanghai）；曾因 now() 与 UTC 存储的 runAt 比较而提前 8 小时执行
    const job = await jobs.enqueue('test.not-due', {}, { runAt: new Date(Date.now() + 3_600_000) });
    await jobs.drain();
    expect(await prisma.job.findUnique({ where: { id: job.id } })).toMatchObject({
      status: 'queued',
      attempts: 0,
    });
    await prisma.job.delete({ where: { id: job.id } });
  });

  it('breaks down open defects and their age', async () => {
    const dist = await report('distribution');
    expect(dist.total).toBe(2);
    expect(dist.status).toEqual(
      expect.arrayContaining([
        { key: 'new', count: 1 },
        { key: 'resolved', count: 1 },
      ]),
    );
    // D3 没有处理人，D2 已指派给验证人（测试）
    expect(dist.owner).toEqual(
      expect.arrayContaining([
        { key: '', count: 1 },
        { key: tester.id, count: 1 },
      ]),
    );
    const created = await report('distribution', `${WEEK}&scope=created`);
    expect(created.total).toBe(3);
    expect(created.severity).toHaveLength(3);

    const age = await report('age');
    expect(age.total).toBe(2);
    expect(age.rows.reduce((n: number, r: { total: number }) => n + r.total, 0)).toBe(2);
    expect(age.rows.map((r: { bucket: string }) => r.bucket)).toEqual([
      '0-3',
      '4-7',
      '8-14',
      '15-30',
      '30+',
    ]);
    expect(age.oldest.map((d: { code: string }) => d.code).sort()).toEqual(
      [codes.d2, codes.d3].sort(),
    );
  });

  it('reports version quality including defects open at release', async () => {
    const { rows } = await report('versions');
    expect(rows[0]).toMatchObject({
      name: '1.0.0',
      total: 1,
      open: 0,
      openAtRelease: 1,
      bySeverity: { fatal: 1, serious: 0 },
    });
    expect(rows[1]).toMatchObject({ versionId: null, total: 2, open: 2, openAtRelease: null });
  });

  it('measures efficiency in working hours with SLA attainment', async () => {
    const eff = await report('efficiency');
    expect(eff.byPerson.total).toMatchObject({
      responseCount: 2,
      avgResponseHours: 2.5,
      resolveCount: 2,
      avgResolveHours: 31,
      slaMet: 1,
      slaTotal: 2,
      slaRate: 0.5,
      inHand: 2,
    });
    const devRow = eff.byPerson.rows.find((r: { key: string }) => r.key === dev.id);
    expect(devRow).toMatchObject({ resolveCount: 2, inHand: 0 });
    const payRow = eff.byModule.rows.find((r: { key: string }) => r.key === moduleId);
    expect(payRow).toMatchObject({ avgResponseHours: 1, avgResolveHours: 48, slaRate: 0 });
  });

  it('computes reopen rate and first-pass rate', async () => {
    const q = await report('quality');
    expect(q.summary).toEqual({ resolved: 2, reopened: 1, reopenRate: 0.5, firstPassRate: 0.5 });
    expect(q.points).toHaveLength(7);
    expect(q.points.find((p: { date: string }) => p.date === '2026-10-14')).toMatchObject({
      resolved: 1,
      reopenRate: 1,
    });
  });

  it('summarizes APP feedback and the most duplicated defects', async () => {
    const fb = await report('feedback');
    expect(fb.summary).toMatchObject({
      total: 4,
      created: 2,
      merged: 1,
      failed: 1,
      createRate: 0.5,
    });
    expect(fb.points.find((p: { date: string }) => p.date === '2026-10-13')).toMatchObject({
      total: 2,
      created: 1,
      merged: 1,
    });
    expect(fb.top[0]).toMatchObject({ code: codes.d3, dupCount: 4, feedbackCount: 5 });
  });

  it('compares defects fixed with and without Claude', async () => {
    const c = await report('claude');
    expect(c.summary).toEqual({
      resolved: 2,
      withClaude: 1,
      ratio: 0.5,
      mcpCalls: 1,
      claudeComments: 1,
    });
    expect(c.compare).toEqual({
      withClaude: { count: 1, avgResolveHours: 14, reopenRate: 0 },
      withoutClaude: { count: 1, avgResolveHours: 48, reopenRate: 1 },
    });
  });
});
