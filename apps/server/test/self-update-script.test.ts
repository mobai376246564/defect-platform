import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGitFixture, findBash, git, startHealthServer, type GitFixture } from './git-fixture';

const bash = findBash();

/** 直接运行 deploy/pm2/self-update.sh：构建、迁移、重启等命令用桩命令替换 */
describe.skipIf(!bash)('self-update.sh', () => {
  let repo: GitFixture;
  let health: Awaited<ReturnType<typeof startHealthServer>>;
  let statusDir: string;

  beforeAll(async () => {
    repo = createGitFixture();
    health = await startHealthServer();
    statusDir = `${repo.root}/update-status`;
  });

  afterAll(async () => {
    await health.close();
  });

  // 用异步子进程：同步执行会卡住事件循环，本进程里的健康检查服务就无法响应
  async function run(
    env: Record<string, string> = {},
    script = `${repo.deploy}/deploy/pm2/self-update.sh`,
  ) {
    const child = spawn(bash!, [script], {
      cwd: repo.deploy,
      env: {
        ...process.env,
        UPDATE_REPO_DIR: repo.deploy,
        UPDATE_DIR: statusDir,
        UPDATE_BACKUP_CMD: 'echo backup-ran',
        UPDATE_DEPS_CMD: 'echo deps-ran',
        UPDATE_BUILD_CMD: 'echo build-ran',
        UPDATE_MIGRATE_CMD: 'echo migrate-ran',
        UPDATE_RESTART_CMD: 'echo restart-ran',
        UPDATE_HEALTH_URL: health.url,
        ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    const status = JSON.parse(readFileSync(`${statusDir}/status.json`, 'utf8')) as Record<
      string,
      string
    >;
    return { code, out, status };
  }

  it('fast-forwards, builds, migrates, restarts and passes the health check', async () => {
    const from = repo.head(repo.deploy);
    const to = repo.push('feat: 新功能');
    const { code, out, status } = await run();
    expect(code).toBe(0);
    expect(repo.head(repo.deploy)).toBe(to);
    expect(status).toMatchObject({ state: 'succeeded', step: 'done', from, to });
    expect(status.message).toContain(to.slice(0, 7));
    // 依赖没变时不安装
    expect(out).not.toContain('deps-ran');
    for (const s of ['backup-ran', 'build-ran', 'migrate-ran', 'restart-ran'])
      expect(out).toContain(s);
  });

  it('reports up to date when there is nothing new', async () => {
    const { code, status } = await run();
    expect(code).toBe(0);
    expect(status).toMatchObject({ state: 'succeeded', message: '已是最新版本' });
  });

  it('installs dependencies only when package-lock.json changes', async () => {
    repo.push('chore: 升级依赖', { 'package-lock.json': '{"v":2}\n' });
    const { code, out } = await run();
    expect(code).toBe(0);
    expect(out).toContain('deps-ran');
  });

  it('rolls back to the previous commit and rebuilds when the build fails', async () => {
    const before = repo.head(repo.deploy);
    repo.push('feat: 构建会失败的提交');
    const marker = `${repo.root}/built-once`;
    // 第一次构建失败，回滚后的重新构建成功
    const { code, out, status } = await run({
      UPDATE_BUILD_CMD: `if [ -f "${marker}" ]; then echo rebuilt; else touch "${marker}"; exit 1; fi`,
    });
    expect(code).toBe(1);
    expect(repo.head(repo.deploy)).toBe(before);
    expect(status).toMatchObject({ state: 'failed', step: 'build' });
    expect(status.message).toContain('已回滚');
    expect(out).toContain('rebuilt');
    expect(out).not.toContain('restart-ran');
  });

  it('refuses to update a working tree with uncommitted changes', async () => {
    const before = repo.head(repo.deploy);
    writeFileSync(`${repo.deploy}/CHANGELOG.md`, 'local edit\n');
    const { code, status } = await run();
    expect(code).toBe(1);
    expect(status).toMatchObject({ state: 'failed', step: 'fetch' });
    expect(status.message).toContain('未提交的改动');
    expect(repo.head(repo.deploy)).toBe(before);
    git(repo.deploy, 'checkout', '--', 'CHANGELOG.md');
  });

  it('marks the update as failed when the script exits unexpectedly', async () => {
    const before = repo.head(repo.deploy);
    repo.push('feat: 触发脚本内部错误');
    // 模拟脚本自身的运行时错误（set -u 下引用未定义变量），脚本放在仓库外以免弄脏工作区
    const broken = readFileSync(`${repo.deploy}/deploy/pm2/self-update.sh`, 'utf8').replace(
      'step merge ',
      'echo "$NOT_DEFINED_IN_TEST"\nstep merge ',
    );
    const script = `${repo.root}/broken-update.sh`;
    writeFileSync(script, broken);
    const { code, out, status } = await run({}, script);
    expect(code).not.toBe(0);
    expect(out).toContain('意外退出');
    expect(status).toMatchObject({ state: 'failed', step: 'backup' });
    expect(status.message).toContain('意外退出');
    expect(repo.head(repo.deploy)).toBe(before);
  });
});

describe('self-update.sh compatibility', () => {
  /**
   * macOS 自带 bash 3.2 会把紧跟在 $变量名 后的非 ASCII 字符（如中文括号）当成变量名的一部分，
   * 在 set -u 下直接报错退出。中文前的变量必须写成 ${变量名}。
   */
  it('wraps variables followed by non-ASCII text in braces', () => {
    const script = readFileSync(
      path.resolve(__dirname, '../../../deploy/pm2/self-update.sh'),
      'utf8',
    );
    const offending = script
      .split('\n')
      .map((line, i) => ({ line, no: i + 1 }))
      .filter(({ line }) => !line.trimStart().startsWith('#'))
      .filter(({ line }) => /\$[A-Za-z_][A-Za-z0-9_]*[^\p{ASCII}]/u.test(line));
    expect(offending).toEqual([]);
  });
});
