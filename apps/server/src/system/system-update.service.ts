import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env';

const exec = promisify(execFile);

export interface CommitInfo {
  commit: string;
  shortCommit: string;
  subject: string;
  committedAt: string;
}

export interface VersionInfo {
  current: CommitInfo | null;
  /** 远程分支最新提交；未检查或未开启在线更新时为 null */
  latest: CommitInfo | null;
  /** 远程比本地多出的提交数 */
  behind: number;
  /** 新提交列表（最多 50 条，新的在前） */
  commits: CommitInfo[];
  checkedAt: string | null;
  checkError: string | null;
  selfUpdate: { enabled: boolean; reason: string | null; remote: string; branch: string };
}

export interface UpdateStatus {
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  step: string;
  message: string;
  from: string;
  to: string;
  backup: string;
  startedAt: string | null;
  updatedAt: string | null;
  log: string;
}

const FIELD_SEP = '\x1f';
const LOG_FORMAT = ['%H', '%h', '%s', '%cI'].join('%x1f');
/** 超过这个时间仍是 running，视为更新进程已异常退出，允许重新发起 */
const STALE_MS = 30 * 60_000;
const LOG_TAIL_LINES = 200;

/**
 * 版本检查与在线更新：比较本地与远程分支的提交，管理员确认后在后台启动 deploy/pm2/self-update.sh。
 * 更新脚本会重启本服务，所以用“脱离父进程”的方式启动，进度写在 .data/update/status.json。
 */
@Injectable()
export class SystemUpdateService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SystemUpdateService.name);
  private repoDir: string | null = null;
  private timer?: NodeJS.Timeout;
  private checking: Promise<void> | null = null;
  private remoteState: Pick<
    VersionInfo,
    'latest' | 'behind' | 'commits' | 'checkedAt' | 'checkError'
  > = { latest: null, behind: 0, commits: [], checkedAt: null, checkError: null };

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  async onApplicationBootstrap(): Promise<void> {
    this.repoDir = await this.findRepoDir();
    if (!this.checkUnsupportedReason() && this.env.UPDATE_CHECK_INTERVAL_MINUTES > 0) {
      // 启动后稍等再检查，避免和启动时的其他任务抢资源
      setTimeout(() => void this.check().catch(() => undefined), 10_000).unref();
      this.timer = setInterval(
        () => void this.check().catch(() => undefined),
        this.env.UPDATE_CHECK_INTERVAL_MINUTES * 60_000,
      );
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 不能检查新版本的原因；为 null 表示可以 */
  private checkUnsupportedReason(): string | null {
    if (!this.env.SELF_UPDATE) return '未开启在线更新（服务端环境变量 SELF_UPDATE=true）';
    if (!this.repoDir) return '服务端不在 git 仓库目录中，无法在线更新';
    return null;
  }

  /** 不能执行在线更新的原因：更新脚本依赖 bash 与 pm2，只支持 macOS / Linux */
  private unsupportedReason(): string | null {
    if (process.platform === 'win32') return '在线更新只支持 macOS / Linux 上的 pm2 单机部署';
    return this.checkUnsupportedReason();
  }

  async version(): Promise<VersionInfo> {
    const reason = this.unsupportedReason();
    return {
      current: this.repoDir ? await this.commitInfo('HEAD').catch(() => null) : null,
      ...this.remoteState,
      selfUpdate: {
        enabled: !reason,
        reason,
        remote: this.env.UPDATE_REMOTE,
        branch: this.env.UPDATE_BRANCH,
      },
    };
  }

  /** 拉取远程分支并统计新提交；同一时间只跑一次 */
  async check(): Promise<VersionInfo> {
    const reason = this.checkUnsupportedReason();
    if (reason) throw new BadRequestException(reason);
    this.checking ??= this.doCheck().finally(() => (this.checking = null));
    await this.checking;
    return this.version();
  }

  private async doCheck(): Promise<void> {
    const ref = `${this.env.UPDATE_REMOTE}/${this.env.UPDATE_BRANCH}`;
    try {
      await this.git(['fetch', '--quiet', this.env.UPDATE_REMOTE, this.env.UPDATE_BRANCH], 60_000);
      const behind = Number((await this.git(['rev-list', '--count', `HEAD..${ref}`])).trim());
      const log = await this.git(['log', `--format=${LOG_FORMAT}`, '-n', '50', `HEAD..${ref}`]);
      this.remoteState = {
        latest: await this.commitInfo(ref),
        behind,
        commits: log.split('\n').filter(Boolean).map(parseCommit),
        checkedAt: new Date().toISOString(),
        checkError: null,
      };
    } catch (err) {
      const message = (err as { stderr?: string }).stderr?.trim() || (err as Error).message;
      this.logger.warn(`检查新版本失败：${message}`);
      this.remoteState = {
        ...this.remoteState,
        checkedAt: new Date().toISOString(),
        checkError: `检查失败：${message.split('\n')[0]}`,
      };
    }
  }

  status(): UpdateStatus {
    const dir = this.updateDir();
    const empty: UpdateStatus = {
      state: 'idle',
      step: '',
      message: '',
      from: '',
      to: '',
      backup: '',
      startedAt: null,
      updatedAt: null,
      log: '',
    };
    if (!dir) return empty;
    let status = empty;
    try {
      status = {
        ...empty,
        ...(JSON.parse(readFileSync(path.join(dir, 'status.json'), 'utf8')) as object),
      };
    } catch {
      // 还没有更新过
    }
    try {
      status.log = readFileSync(path.join(dir, 'update.log'), 'utf8')
        .split('\n')
        .slice(-LOG_TAIL_LINES)
        .join('\n');
    } catch {
      // 没有日志
    }
    if (status.state === 'running' && status.updatedAt) {
      const age = Date.now() - new Date(status.updatedAt).getTime();
      if (age > STALE_MS)
        status = { ...status, state: 'failed', message: '更新进程长时间无响应，可能已异常退出' };
    }
    return status;
  }

  /** 发起更新：先重新检查一次，确认有新版本且没有正在进行的更新 */
  async start(requestedBy: string): Promise<UpdateStatus> {
    const reason = this.unsupportedReason();
    if (reason) throw new BadRequestException(reason);
    const info = await this.check();
    if (info.checkError) throw new BadRequestException(info.checkError);
    if (info.behind === 0) throw new BadRequestException('已是最新版本');
    if (this.status().state === 'running') throw new ConflictException('已有更新正在进行');

    const repoDir = this.repoDir!;
    const dir = this.updateDir()!;
    mkdirSync(dir, { recursive: true });
    const script = path.join(repoDir, 'deploy/pm2/self-update.sh');
    if (!existsSync(script))
      throw new BadRequestException('找不到更新脚本 deploy/pm2/self-update.sh');
    const now = new Date().toISOString();
    writeFileSync(
      path.join(dir, 'status.json'),
      JSON.stringify({
        state: 'running',
        step: 'queued',
        message: '等待更新脚本启动',
        from: info.current?.commit ?? '',
        to: info.latest?.commit ?? '',
        backup: '',
        startedAt: now,
        updatedAt: now,
      }),
    );
    writeFileSync(path.join(dir, 'update.log'), `== ${now} 由 ${requestedBy} 发起更新\n`);

    // sh 启动后台进程后立即退出，脚本被系统接管：pm2 重启本服务时不会连带杀掉它
    const child = spawn(
      '/bin/sh',
      ['-c', 'nohup bash "$0" >> "$1" 2>&1 &', script, path.join(dir, 'update.log')],
      {
        cwd: repoDir,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          UPDATE_REPO_DIR: repoDir,
          UPDATE_DIR: dir,
          UPDATE_REMOTE: this.env.UPDATE_REMOTE,
          UPDATE_BRANCH: this.env.UPDATE_BRANCH,
          PORT: String(this.env.PORT),
        },
      },
    );
    child.unref();
    this.logger.log(
      `${requestedBy} 发起在线更新：${info.current?.shortCommit} → ${info.latest?.shortCommit}`,
    );
    return this.status();
  }

  private updateDir(): string | null {
    return this.repoDir ? path.join(this.repoDir, '.data/update') : null;
  }

  private async findRepoDir(): Promise<string | null> {
    try {
      const cwd = this.env.UPDATE_REPO_DIR ?? process.cwd();
      return (
        await exec('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 10_000 })
      ).stdout.trim();
    } catch {
      return null;
    }
  }

  private async commitInfo(ref: string): Promise<CommitInfo> {
    return parseCommit((await this.git(['log', '-1', `--format=${LOG_FORMAT}`, ref])).trim());
  }

  private async git(args: string[], timeout = 15_000): Promise<string> {
    const { stdout } = await exec('git', args, {
      cwd: this.repoDir!,
      timeout,
      // 拉取时不弹出交互式认证
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  }
}

function parseCommit(line: string): CommitInfo {
  const [commit = '', shortCommit = '', subject = '', committedAt = ''] = line.split(FIELD_SEP);
  return { commit, shortCommit, subject, committedAt };
}
