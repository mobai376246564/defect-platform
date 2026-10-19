/**
 * e2e 测试全局准备：启动一个独立的嵌入式 PostgreSQL（端口 5434，数据在 .data/pg-test，每次重建），
 * 执行全部迁移，并把连接串写入环境变量供测试进程使用。
 */
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const port = 5434;
const dataDir = path.resolve(__dirname, '../../../.data/pg-test');
const url = `postgresql://test:test@localhost:${port}/defect_test`;

// Windows 上 postgres 进程退出后目录句柄会晚一点释放，立即删除会 EBUSY，所以带重试
const removeDataDir = () =>
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

export default async function setup(): Promise<() => Promise<void>> {
  removeDataDir();
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: 'test',
    password: 'test',
    // 不让 embedded-postgres 在 stop 时自己删目录（它不重试），由下面的 teardown 删除
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('defect_test');

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  process.env.DATABASE_URL = url;

  return async () => {
    await pg.stop();
    // 收尾清理尽力而为：删不掉（进程仍占用文件）也不影响测试结果，下次启动前会再删
    try {
      removeDataDir();
    } catch (err) {
      console.warn(`测试数据库目录暂未删除，将在下次运行前清理：${(err as Error).message}`);
    }
  };
}
