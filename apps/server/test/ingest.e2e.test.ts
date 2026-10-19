import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { feedbackPrefix } from '@defect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../src/common/crypto';
import { JobsService } from '../src/jobs/jobs.service';
import { IngestService } from '../src/ingest/ingest.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TEST_HMAC_SECRET,
  auth,
  createTestApp,
  createUser,
  projectKey,
  type TestContext,
} from './helpers';

const CRASH_LOG = [
  '10-16 10:21:01.100 I/OrderPage: onResume',
  '10-16 10:21:02.200 E/AndroidRuntime: FATAL EXCEPTION: main',
  'java.lang.IllegalStateException: order status not refreshed',
  '    at com.example.order.OrderDetailActivity.refresh(OrderDetailActivity.kt:88)',
  '    at com.example.order.OrderDetailActivity.onResume(OrderDetailActivity.kt:42)',
].join('\n');

describe('APP feedback ingest (e2e)', () => {
  let ctx: TestContext;
  let key: string;
  let appId: string;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const admin = await createUser(ctx, { isSystemAdmin: true });
    adminToken = admin.token;
    key = projectKey('ING');
    appId = `com.test.${key.toLowerCase()}`;
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(adminToken))
      .send({ key, name: '接入测试', appIds: [appId] })
      .expect(201);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** 模拟 APP：按约定目录写入附件与 manifest（本地存储即磁盘目录） */
  function writeFeedback(opts: { title: string; log?: string; withMissing?: boolean }): {
    key: string;
    reportId: string;
  } {
    const reportId = randomUUID();
    const prefix = feedbackPrefix(appId, new Date(), reportId);
    const dir = path.join(ctx.storageDir, prefix);
    mkdirSync(dir, { recursive: true });
    const attachments: { key: string; type: string; size: number }[] = [];
    if (opts.log) {
      writeFileSync(path.join(dir, 'app.log'), opts.log);
      attachments.push({ key: 'app.log', type: 'log', size: opts.log.length });
    }
    if (opts.withMissing) attachments.push({ key: 'screenshot_1.webp', type: 'image', size: 10 });
    const manifest = {
      schemaVersion: 1,
      reportId,
      appId,
      title: opts.title,
      description: '用微信支付后返回 APP，订单状态未刷新',
      category: 'CRASH',
      reproducible: 'ALWAYS',
      app: { version: '3.12.0', build: '31200', commit: 'a1b2c3d' },
      device: { os: 'Android 15', model: 'Pixel 9' },
      context: { page: 'OrderDetailActivity', trail: ['Home', 'Pay', 'OrderDetail'] },
      attachments,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    return { key: `${prefix}manifest.json`, reportId };
  }

  function signed(body: unknown, ts = Math.floor(Date.now() / 1000)) {
    const raw = JSON.stringify(body);
    return {
      raw,
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': String(ts),
        'X-Signature': hmacSha256Hex(TEST_HMAC_SECRET, `${ts}.${raw}`),
      },
    };
  }

  it('rejects unsigned, mis-signed and stale events', async () => {
    const body = { key: 'feedback/x/20261016/y/manifest.json' };
    await ctx.http.post('/api/v1/ingest/cos-event').send(body).expect(401);
    const s = signed(body);
    await ctx.http
      .post('/api/v1/ingest/cos-event')
      .set({ ...s.headers, 'X-Signature': '0'.repeat(64) })
      .send(s.raw)
      .expect(401);
    const stale = signed(body, Math.floor(Date.now() / 1000) - 3600);
    await ctx.http.post('/api/v1/ingest/cos-event').set(stale.headers).send(stale.raw).expect(401);
  });

  it('creates a defect from a signed COS event, idempotently, and merges duplicates', async () => {
    const jobs = ctx.app.get(JobsService);
    const prisma = ctx.app.get(PrismaService);
    const first = writeFeedback({ title: '订单页闪退', log: CRASH_LOG, withMissing: true });

    const s = signed({ key: first.key });
    const res = await ctx.http
      .post('/api/v1/ingest/cos-event')
      .set(s.headers)
      .send(s.raw)
      .expect(200);
    expect(res.body.results[0]).toMatchObject({ accepted: true, reportId: first.reportId });
    // SCF 重复投递
    const again = signed({ events: [{ key: first.key }] });
    await ctx.http.post('/api/v1/ingest/cos-event').set(again.headers).send(again.raw).expect(200);
    await jobs.drain();

    const report = await prisma.feedbackReport.findUniqueOrThrow({
      where: { reportId: first.reportId },
    });
    expect(report.status).toBe('created');
    const list = await ctx.http
      .get(`/api/v1/projects/${key}/defects`)
      .set(auth(adminToken))
      .expect(200);
    expect(list.body.total).toBe(1);

    const detail = await ctx.http
      .get(`/api/v1/projects/${key}/defects/${list.body.items[0].code}`)
      .set(auth(adminToken))
      .expect(200);
    expect(detail.body).toMatchObject({
      source: 'app',
      severity: 'serious',
      frequency: 'always',
      appCommit: 'a1b2c3d',
      steps: '操作路径：Home → Pay → OrderDetail',
    });
    expect(detail.body.description).toContain('附件不完整，缺少：screenshot_1.webp');
    expect(detail.body.logSummary).toContain('IllegalStateException');
    expect(detail.body.fingerprint).toBeTruthy();
    expect(detail.body.attachments).toHaveLength(1);

    // 相同崩溃的第二条反馈：合并而不是新建
    const second = writeFeedback({ title: '又闪退了', log: CRASH_LOG.replace(':88)', ':90)') });
    const s2 = signed({ key: second.key });
    await ctx.http.post('/api/v1/ingest/cos-event').set(s2.headers).send(s2.raw).expect(200);
    await jobs.drain();
    const merged = await prisma.feedbackReport.findUniqueOrThrow({
      where: { reportId: second.reportId },
    });
    expect(merged.status).toBe('merged');
    const after = await ctx.http
      .get(`/api/v1/projects/${key}/defects/${list.body.items[0].code}`)
      .set(auth(adminToken))
      .expect(200);
    expect(after.body.dupCount).toBe(1);
    expect(after.body.attachments).toHaveLength(2);
  });

  it('reconciles manifests whose events were lost', async () => {
    const lost = writeFeedback({ title: '事件丢失的反馈', log: 'I/App: ok' });
    const added = await ctx.app.get(IngestService).reconcile();
    expect(added).toBe(1);
    await ctx.app.get(JobsService).drain();
    const report = await ctx.app
      .get(PrismaService)
      .feedbackReport.findUniqueOrThrow({ where: { reportId: lost.reportId } });
    expect(report.status).toBe('created');
    expect(await ctx.app.get(IngestService).reconcile()).toBe(0);
  });

  it('marks feedback from unknown apps as failed without retrying', async () => {
    const reportId = randomUUID();
    const prefix = feedbackPrefix('com.unknown.app', new Date(), reportId);
    mkdirSync(path.join(ctx.storageDir, prefix), { recursive: true });
    writeFileSync(
      path.join(ctx.storageDir, prefix, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        reportId,
        appId: 'com.unknown.app',
        title: 'x',
        app: { version: '1.0' },
        createdAt: new Date().toISOString(),
      }),
    );
    const s = signed({ key: `${prefix}manifest.json` });
    await ctx.http.post('/api/v1/ingest/cos-event').set(s.headers).send(s.raw).expect(200);
    await ctx.app.get(JobsService).drain();
    const report = await ctx.app
      .get(PrismaService)
      .feedbackReport.findUniqueOrThrow({ where: { reportId } });
    expect(report).toMatchObject({ status: 'failed', error: '没有项目绑定 APP com.unknown.app' });
  });
});
