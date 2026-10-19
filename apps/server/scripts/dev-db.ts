/**
 * 本地开发数据库：启动嵌入式 PostgreSQL（无需 Docker）。
 * 数据保存在仓库根目录 .data/pg，端口 5433，账号 defect/defect，库名 defect。
 * 用法：npm run db:start（保持窗口运行，Ctrl+C 停止）
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const dataDir = path.resolve(__dirname, '../../../.data/pg');
const port = Number(process.env.DEV_DB_PORT ?? 5433);

async function main(): Promise<void> {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: 'defect',
    password: 'defect',
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => undefined,
  });

  const fresh = !existsSync(path.join(dataDir, 'PG_VERSION'));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase('defect');

  console.log(`PostgreSQL 已启动：postgresql://defect:defect@localhost:${port}/defect`);
  console.log('按 Ctrl+C 停止');

  const stop = async (): Promise<void> => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
