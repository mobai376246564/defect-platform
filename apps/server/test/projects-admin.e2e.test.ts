import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

describe('project management (e2e)', () => {
  let ctx: TestContext;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let member: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createUser(ctx, { isSystemAdmin: true, name: '管理员' });
    member = await createUser(ctx, { name: '项目管理员' });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('lists projects with counts, and deletes a project with confirmation', async () => {
    const key = projectKey('DEL');
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key, name: '待删除', appIds: ['com.test.del'] })
      .expect(201);
    await ctx.http
      .post(`/api/v1/projects/${key}/members`)
      .set(auth(admin.token))
      .send({ email: member.email, role: 'admin' })
      .expect(201);
    const created = await ctx.http
      .post(`/api/v1/projects/${key}/defects`)
      .set(auth(member.token))
      .send({ title: '会被一起删除', severity: 'normal' })
      .expect(201);
    await ctx.http
      .post(`/api/v1/projects/${key}/views`)
      .set(auth(member.token))
      .send({ name: '视图', query: {} })
      .expect(201);
    // APP 提单带附件，并有一条 MCP 调用记录：删项目时文件与记录都要清掉
    const submitted = await ctx.http
      .post('/api/v1/app/defects')
      .field('appId', 'com.test.del')
      .field('description', 'APP 提的单')
      .attach('files', Buffer.from('E/App: crash'), 'app.log')
      .expect(201);
    const prismaBefore = ctx.app.get(PrismaService);
    const attachment = await prismaBefore.attachment.findFirstOrThrow({
      where: { defect: { code: submitted.body.code } },
    });
    const attachmentFile = path.join(ctx.storageDir, attachment.storageKey);
    expect(existsSync(attachmentFile)).toBe(true);
    const projectRow = await prismaBefore.project.findUniqueOrThrow({ where: { key } });
    await prismaBefore.mcpAudit.create({
      data: { userId: admin.id, tool: 'get_defect', projectId: projectRow.id },
    });

    const list = await ctx.http.get('/api/v1/projects').set(auth(admin.token)).expect(200);
    expect(list.body.find((p: { key: string }) => p.key === key)).toMatchObject({
      name: '待删除',
      appIds: ['com.test.del'],
      totalDefects: 2,
      openDefects: 2,
      memberCount: 2,
    });

    // 项目管理员不能删项目，只有系统管理员可以；必须输入正确的项目标识
    await ctx.http
      .delete(`/api/v1/projects/${key}?confirm=${key}`)
      .set(auth(member.token))
      .expect(403);
    await ctx.http.delete(`/api/v1/projects/${key}`).set(auth(admin.token)).expect(400);
    await ctx.http
      .delete(`/api/v1/projects/${key}?confirm=WRONG`)
      .set(auth(admin.token))
      .expect(400);
    await ctx.http
      .delete(`/api/v1/projects/${key}?confirm=${key}`)
      .set(auth(admin.token))
      .expect(204);

    await ctx.http.get(`/api/v1/projects/${key}`).set(auth(admin.token)).expect(404);
    const prisma = ctx.app.get(PrismaService);
    expect(await prisma.defect.count({ where: { id: created.body.id } })).toBe(0);
    expect(await prisma.savedView.count({ where: { project: { key } } })).toBe(0);
    expect(await prisma.feedbackReport.count({ where: { appId: 'com.test.del' } })).toBe(0);
    expect(await prisma.mcpAudit.count({ where: { projectId: projectRow.id } })).toBe(0);
    expect(existsSync(attachmentFile)).toBe(false);
    await ctx.http
      .delete(`/api/v1/projects/${key}?confirm=${key}`)
      .set(auth(admin.token))
      .expect(404);

    // 标识释放后可以重新创建
    await ctx.http
      .post('/api/v1/projects')
      .set(auth(admin.token))
      .send({ key, name: '重新创建' })
      .expect(201);
  });
});
