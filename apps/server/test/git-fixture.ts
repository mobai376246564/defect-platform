import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** 在线更新测试用的临时仓库：origin（裸仓库）、dev（开发者推送用）、deploy（被更新的部署目录） */
export interface GitFixture {
  root: string;
  origin: string;
  dev: string;
  deploy: string;
  /** 在 dev 中提交一个改动并推送到 origin，返回提交号 */
  push(subject: string, files?: Record<string, string>): string;
  head(dir: string): string;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test.local',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test.local',
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

/** 统一用正斜杠，Git Bash 与 POSIX 都能识别 */
const slash = (p: string) => p.replace(/\\/g, '/');

export function createGitFixture(): GitFixture {
  const root = slash(mkdtempSync(path.join(tmpdir(), 'defect-update-')));
  const origin = `${root}/origin.git`;
  const dev = `${root}/dev`;
  const deploy = `${root}/deploy`;
  git(root, 'init', '--bare', '--initial-branch=main', origin);
  git(root, 'clone', origin, dev);
  git(dev, 'checkout', '-B', 'main');

  // 部署目录里需要更新脚本本身（与正式部署一致，从仓库里取）
  const script = readFileSync(
    path.resolve(__dirname, '../../../deploy/pm2/self-update.sh'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  mkdirSync(`${dev}/deploy/pm2`, { recursive: true });
  writeFileSync(`${dev}/deploy/pm2/self-update.sh`, script);
  writeFileSync(`${dev}/package-lock.json`, '{"v":1}\n');
  writeFileSync(`${dev}/.gitignore`, '.data/\n');
  git(dev, 'add', '-A');
  git(dev, 'commit', '-m', 'init');
  git(dev, 'push', 'origin', 'main');
  git(root, 'clone', origin, deploy);

  const fixture: GitFixture = {
    root,
    origin,
    dev,
    deploy,
    push(subject, files = { 'CHANGELOG.md': `${subject}\n` }) {
      for (const [name, content] of Object.entries(files)) {
        const file = `${dev}/${name}`;
        const prev = existsSync(file) ? readFileSync(file, 'utf8') : '';
        writeFileSync(file, prev + content);
      }
      git(dev, 'add', '-A');
      git(dev, 'commit', '-m', subject);
      git(dev, 'push', 'origin', 'main');
      return git(dev, 'rev-parse', 'HEAD');
    },
    head: (dir) => git(dir, 'rev-parse', 'HEAD'),
  };
  return fixture;
}

/** 找 bash：Windows 上用 Git for Windows 自带的 bash（不是 WSL 的 bash.exe） */
export function findBash(): string | null {
  if (process.platform !== 'win32') return 'bash';
  try {
    const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    // …\Git\mingw64\libexec\git-core → …\Git\bin\bash.exe
    const bash = path.resolve(execPath, '../../../bin/bash.exe');
    return existsSync(bash) ? bash : null;
  } catch {
    return null;
  }
}

/** 模拟重启后的健康检查接口 */
export async function startHealthServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_, res) => res.end('{"status":"ok"}'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/v1/health`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
