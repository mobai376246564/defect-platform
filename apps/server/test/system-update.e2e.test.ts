import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGitFixture, startHealthServer, type GitFixture } from './git-fixture';
import { auth, createTestApp, createUser, type TestContext } from './helpers';

describe('version check and self-update (e2e)', () => {
  let ctx: TestContext;
  let repo: GitFixture;
  let health: Awaited<ReturnType<typeof startHealthServer>>;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let user: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    repo = createGitFixture();
    health = await startHealthServer();
    // 服务端把临时仓库当作自己的代码目录；更新脚本的耗时命令换成桩命令（子进程继承这些环境变量）
    Object.assign(process.env, {
      SELF_UPDATE: 'true',
      UPDATE_REPO_DIR: repo.deploy,
      UPDATE_CHECK_INTERVAL_MINUTES: '0',
      UPDATE_BACKUP_CMD: 'echo backup-ran',
      UPDATE_DEPS_CMD: 'echo deps-ran',
      UPDATE_BUILD_CMD: 'echo build-ran',
      UPDATE_MIGRATE_CMD: 'echo migrate-ran',
      UPDATE_RESTART_CMD: 'echo restart-ran',
      UPDATE_HEALTH_URL: health.url,
    });
    ctx = await createTestApp();
    admin = await createUser(ctx, { isSystemAdmin: true });
    user = await createUser(ctx);
  });

  afterAll(async () => {
    await ctx.app.close();
    await health.close();
  });

  it('shows the running version to everyone and finds new commits for admins', async () => {
    const v = await ctx.http.get('/api/v1/system/version').set(auth(user.token)).expect(200);
    expect(v.body.current).toMatchObject({ commit: repo.head(repo.deploy), subject: 'init' });
    expect(v.body).toMatchObject({ behind: 0, latest: null });
    expect(v.body.selfUpdate).toMatchObject({ remote: 'origin', branch: 'main' });

    await ctx.http.post('/api/v1/system/version/check').set(auth(user.token)).expect(403);
    await ctx.http.get('/api/v1/system/update').set(auth(user.token)).expect(403);
    await ctx.http.post('/api/v1/system/update').set(auth(user.token)).expect(403);

    const upToDate = await ctx.http
      .post('/api/v1/system/version/check')
      .set(auth(admin.token))
      .expect(200);
    expect(upToDate.body).toMatchObject({ behind: 0, commits: [], checkError: null });

    repo.push('feat: 新功能 A');
    const latest = repo.push('fix: 修复问题 B');
    const res = await ctx.http
      .post('/api/v1/system/version/check')
      .set(auth(admin.token))
      .expect(200);
    expect(res.body).toMatchObject({ behind: 2, latest: { commit: latest } });
    expect(res.body.commits.map((c: { subject: string }) => c.subject)).toEqual([
      'fix: 修复问题 B',
      'feat: 新功能 A',
    ]);
    expect(res.body.checkedAt).toBeTruthy();

    const idle = await ctx.http.get('/api/v1/system/update').set(auth(admin.token)).expect(200);
    expect(idle.body.state).toBe('idle');
  });

  it.skipIf(process.platform !== 'win32')('refuses to self-update on Windows', async () => {
    const res = await ctx.http.post('/api/v1/system/update').set(auth(admin.token)).expect(400);
    expect(res.body.message).toContain('macOS / Linux');
  });

  it.skipIf(process.platform === 'win32')(
    'runs the update script in the background and reports progress',
    async () => {
      const target = repo.head(repo.dev);
      const started = await ctx.http
        .post('/api/v1/system/update')
        .set(auth(admin.token))
        .expect(202);
      expect(started.body.state).toBe('running');
      // 同时只能有一个更新
      await ctx.http.post('/api/v1/system/update').set(auth(admin.token)).expect(409);

      let status: { state: string; log: string; to: string } = started.body;
      for (let i = 0; i < 60 && status.state === 'running'; i++) {
        await new Promise((r) => setTimeout(r, 500));
        status = (await ctx.http.get('/api/v1/system/update').set(auth(admin.token))).body;
      }
      expect(status).toMatchObject({ state: 'succeeded', to: target });
      expect(status.log).toContain('restart-ran');
      expect(repo.head(repo.deploy)).toBe(target);

      const v = await ctx.http.get('/api/v1/system/version').set(auth(user.token)).expect(200);
      expect(v.body.current.commit).toBe(target);
      await ctx.http.post('/api/v1/system/update').set(auth(admin.token)).expect(400);
    },
  );
});
