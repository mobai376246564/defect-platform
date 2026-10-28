import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_UPLOAD_DIR } from '../src/ingest/upload-dir';
import { CleanupService } from '../src/maintenance/cleanup.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

const DAY = 86_400_000;

describe('daily cleanup (e2e)', () => {
  let ctx: TestContext;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let key: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.app.get(PrismaService);
    admin = await createUser(ctx, { isSystemAdmin: true });
    key = projectKey('CLN');
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key, name: key })
      .expect(201);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** 建一个缺陷并上传一个文件；register=false 时只上传、不登记成附件（孤儿文件） */
  async function defectWithFile(register: boolean) {
    const code = (
      await ctx.http
        .post(`/api/v1/projects/${key}/defects`)
        .set(auth(admin.token))
        .send({ title: '清理测试', severity: 'normal' })
        .expect(201)
    ).body.code as string;
    const target = await ctx.http
      .post(`/api/v1/projects/${key}/defects/${code}/attachments/upload-target`)
      .set(auth(admin.token))
      .send({ files: [{ name: 'a.log', size: 5 }] })
      .expect(201);
    const upload = target.body.uploads[0] as { key: string; url: string };
    const url = new URL(upload.url);
    await ctx.http
      .put(url.pathname + url.search)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('hello'))
      .expect(200);
    if (register) {
      await ctx.http
        .post(`/api/v1/projects/${key}/defects/${code}/attachments`)
        .set(auth(admin.token))
        .send({ items: [{ key: upload.key, name: 'a.log' }] })
        .expect(201);
    }
    return { code, file: path.join(ctx.storageDir, upload.key) };
  }

  const age = (file: string, days: number) => {
    const t = new Date(Date.now() - days * DAY);
    utimesSync(file, t, t);
  };

  it('removes stale orphan uploads but keeps every defect attachment, even of deleted defects', async () => {
    const oldDeleted = await defectWithFile(true);
    const recentDeleted = await defectWithFile(true);
    const alive = await defectWithFile(true);
    const staleOrphan = await defectWithFile(false);
    const freshOrphan = await defectWithFile(false);
    for (const d of [oldDeleted, recentDeleted]) {
      await ctx.http
        .delete(`/api/v1/projects/${key}/defects/${d.code}`)
        .set(auth(admin.token))
        .expect((r) => expect([200, 204]).toContain(r.status));
    }
    await prisma.defect.updateMany({
      where: { code: oldDeleted.code },
      data: { deletedAt: new Date(Date.now() - 31 * DAY) },
    });
    // 已登记的文件即使很旧也不算孤儿
    for (const f of [oldDeleted.file, alive.file, staleOrphan.file]) age(f, 2);

    const result = await ctx.app.get(CleanupService).run();

    // 缺陷永久保留：删除很久的缺陷，附件文件与记录也都还在
    expect(existsSync(oldDeleted.file)).toBe(true);
    expect(await prisma.attachment.count({ where: { defect: { code: oldDeleted.code } } })).toBe(1);
    expect(existsSync(recentDeleted.file)).toBe(true);
    expect(existsSync(alive.file)).toBe(true);
    // 只清理一直没有登记成附件、且超过 24 小时的上传文件
    expect(existsSync(staleOrphan.file)).toBe(false);
    expect(existsSync(freshOrphan.file)).toBe(true);
    expect(result.orphanUploads).toBeGreaterThanOrEqual(1);
  });

  it('prunes old finished jobs and old read notifications', async () => {
    const old = new Date(Date.now() - 40 * DAY);
    const job = await prisma.job.create({
      data: { type: 'test.noop', payload: {}, status: 'done' },
    });
    await prisma.$executeRaw`UPDATE "Job" SET "updatedAt" = ${old} WHERE id = ${job.id}::uuid`;
    const queued = await prisma.job.create({
      data: { type: 'test.noop', payload: {}, status: 'queued', runAt: new Date(Date.now() + DAY) },
    });
    const project = await prisma.project.findUniqueOrThrow({ where: { key } });
    const veryOld = new Date(Date.now() - 100 * DAY);
    const readOld = await prisma.notification.create({
      data: {
        userId: admin.id,
        projectId: project.id,
        kind: 'assigned',
        title: '旧通知',
        readAt: veryOld,
        createdAt: veryOld,
      },
    });
    const unreadOld = await prisma.notification.create({
      data: {
        userId: admin.id,
        projectId: project.id,
        kind: 'assigned',
        title: '未读旧通知',
        createdAt: veryOld,
      },
    });

    await ctx.app.get(CleanupService).run();

    expect(await prisma.job.findUnique({ where: { id: job.id } })).toBeNull();
    expect(await prisma.job.findUnique({ where: { id: queued.id } })).not.toBeNull();
    expect(await prisma.notification.findUnique({ where: { id: readOld.id } })).toBeNull();
    // 未读的通知不清理
    expect(await prisma.notification.findUnique({ where: { id: unreadOld.id } })).not.toBeNull();
    await prisma.job.delete({ where: { id: queued.id } });
  });

  it('cleans up after failed or interrupted APP submissions', async () => {
    const write = (rel: string) => {
      const file = path.join(ctx.storageDir, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, 'x');
      age(file, 2);
      return file;
    };
    // 建单失败留下的文件（没挂到缺陷上）删除；已挂到缺陷上的 APP 附件保留
    const failedFile = write(`feedback/com.cleanup/20260101/${randomUUID()}/crash.log`);
    const keptKey = `feedback/com.cleanup/20260101/${randomUUID()}/shot.png`;
    const keptFile = write(keptKey);
    const { code } = await defectWithFile(true);
    const defect = await prisma.defect.findFirstOrThrow({ where: { code } });
    await prisma.attachment.create({
      data: {
        defectId: defect.id,
        kind: 'image',
        fileName: 'shot.png',
        storageKey: keptKey,
        size: 1,
      },
    });
    // 停在“处理中”超过 1 小时的提交记为失败
    const stale = await prisma.feedbackReport.create({
      data: {
        reportId: randomUUID(),
        appId: 'com.cleanup',
        storagePrefix: 'feedback/com.cleanup/x/',
        receivedAt: new Date(Date.now() - 2 * 3_600_000),
      },
    });
    // 服务端临时目录里的残留上传文件
    const temp = path.join(APP_UPLOAD_DIR, `stale-${randomUUID()}`);
    writeFileSync(temp, 'x');
    age(temp, 2);

    const result = await ctx.app.get(CleanupService).run();

    expect(existsSync(failedFile)).toBe(false);
    expect(existsSync(keptFile)).toBe(true);
    expect(existsSync(temp)).toBe(false);
    expect(
      await prisma.feedbackReport.findUniqueOrThrow({ where: { reportId: stale.reportId } }),
    ).toMatchObject({ status: 'failed' });
    expect(result).toMatchObject({ staleSubmissions: 1 });
    expect(result.tempFiles).toBeGreaterThanOrEqual(1);
  });
});
