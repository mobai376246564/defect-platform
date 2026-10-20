import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGitFixture, findBash, git, startHealthServer, type GitFixture } from './git-fixture';

const bash = findBash();

/**
 * 更新脚本靠软链切换版本。Windows 默认没有创建软链的权限（Git Bash 的 ln -s 会退化为复制），
 * 这类环境跳过；部署目标 macOS / Linux 上照常运行。
 */
function canSymlink(): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), 'defect-link-'));
  try {
    symlinkSync(dir, path.join(dir, 'link'), 'dir');
    return process.platform !== 'win32';
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 直接运行 deploy/pm2/self-update.sh：安装、构建、迁移、重启等命令用桩命令替换 */
describe.skipIf(!bash || !canSymlink())('self-update.sh', () => {
  let repo: GitFixture;
  let health: Awaited<ReturnType<typeof startHealthServer>>;
  let statusDir: string;
  let releases: string;

  beforeAll(async () => {
    repo = createGitFixture();
    health = await startHealthServer();
    statusDir = `${repo.root}/update-status`;
    releases = `${repo.deploy}/.releases`;
  });

  afterAll(async () => {
    await health.close();
  });

  /** current 软链指向的版本目录名（没有时为 null） */
  const current = () =>
    existsSync(`${releases}/current`) ? path.basename(realpathSync(`${releases}/current`)) : null;
  const releaseDirs = () =>
    readdirSync(releases).filter((d) => d !== 'current' && !d.endsWith('.staging'));

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
        // 安装依赖的桩命令在发布目录里建出 node_modules，后续更新才能复用
        UPDATE_DEPS_CMD: 'mkdir -p node_modules && echo deps-ran',
        // 构建产物写在当前目录，用来确认构建是在发布目录里执行的
        UPDATE_BUILD_CMD: 'echo "$APP_COMMIT" > built.txt && echo build-ran',
        UPDATE_MIGRATE_CMD: 'echo migrate-ran',
        UPDATE_RESTART_CMD: 'echo restart-ran',
        UPDATE_HEALTH_URL: health.url,
        UPDATE_WEB_HEALTH_URL: health.url,
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

  it('builds the new version in its own release directory, switches to it and passes the health check', async () => {
    const from = repo.head(repo.deploy);
    const to = repo.push('feat: 新功能');
    const { code, out, status } = await run();
    expect(code).toBe(0);
    expect(status).toMatchObject({ state: 'succeeded', step: 'done', from, to });
    expect(status.message).toContain(to.slice(0, 7));
    // 仓库目录快进到新版本，current 指向新版本目录，构建在发布目录里完成
    expect(repo.head(repo.deploy)).toBe(to);
    expect(current()).toBe(to.slice(0, 12));
    expect(readFileSync(`${releases}/${to.slice(0, 12)}/built.txt`, 'utf8').trim()).toBe(to);
    // 发布目录共享仓库目录的数据
    expect(existsSync(`${releases}/${to.slice(0, 12)}/.data`)).toBe(true);
    for (const s of ['backup-ran', 'deps-ran', 'build-ran', 'migrate-ran', 'restart-ran'])
      expect(out).toContain(s);
  });

  it('reports up to date when there is nothing new', async () => {
    const { code, status } = await run();
    expect(code).toBe(0);
    expect(status).toMatchObject({ state: 'succeeded', message: '已是最新版本' });
  });

  it('reuses dependencies when package-lock.json is unchanged and installs them when it changes', async () => {
    const reuse = repo.push('feat: 只改代码');
    const first = await run();
    expect(first.code).toBe(0);
    expect(first.out).toContain('复用上一版本的依赖');
    expect(first.out).not.toContain('deps-ran');
    expect(existsSync(`${releases}/${reuse.slice(0, 12)}/node_modules`)).toBe(true);

    repo.push('chore: 升级依赖', { 'package-lock.json': '{"v":2}\n' });
    const second = await run({ UPDATE_KEEP_RELEASES: '2' });
    expect(second.code).toBe(0);
    expect(second.out).toContain('deps-ran');
    // 只保留最近 2 个版本目录
    expect(releaseDirs()).toHaveLength(2);
  });

  it('keeps the running version untouched when the build fails', async () => {
    const before = repo.head(repo.deploy);
    const running = current();
    repo.push('feat: 构建会失败的提交');
    const { code, out, status } = await run({ UPDATE_BUILD_CMD: 'echo build-failed; exit 1' });
    expect(code).toBe(1);
    expect(status).toMatchObject({ state: 'failed', step: 'build' });
    expect(status.message).toContain('不受影响');
    expect(repo.head(repo.deploy)).toBe(before);
    expect(current()).toBe(running);
    expect(out).not.toContain('restart-ran');
    expect(readdirSync(releases).some((d) => d.endsWith('.staging'))).toBe(false);
  });

  it('switches back to the previous release when the new one fails the health check', async () => {
    const before = repo.head(repo.deploy);
    const running = current();
    const { code, out, status } = await run({
      UPDATE_HEALTH_URL: 'http://127.0.0.1:1/api/v1/health',
      UPDATE_HEALTH_TRIES: '1',
    });
    expect(code).toBe(1);
    expect(status).toMatchObject({ state: 'failed', step: 'verify' });
    expect(status.message).toContain('已切回原版本');
    expect(current()).toBe(running);
    expect(repo.head(repo.deploy)).toBe(before);
    // 切换后重启一次，切回后再重启一次
    expect(out.match(/^restart-ran$/gm)).toHaveLength(2);
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
      'step prepare ',
      'echo "$NOT_DEFINED_IN_TEST"\nstep prepare ',
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
      .filter(({ line }) => /\$[A-Za-z_0-9][A-Za-z0-9_]*[^\p{ASCII}]/u.test(line));
    expect(offending).toEqual([]);
  });
});
