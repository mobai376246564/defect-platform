/**
 * 单机部署（无 Docker）：用 pm2 托管数据库、服务端与管理后台三个进程。
 * 适合测试机、演示机；正式环境见 docs/deploy-tencent-cloud.md。
 *
 * 前置：在仓库根目录 npm ci && npm run build，并按 docs/deploy-single-host.md 写好 apps/server/.env。
 * 启动：pm2 start deploy/pm2/ecosystem.config.cjs   （在仓库根目录执行）
 * 端口可用环境变量覆盖：WEB_PORT（默认 5180）、API_PORT（3100）、DB_PORT（5433）。
 */
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const WEB_PORT = process.env.WEB_PORT || '5180';
const API_PORT = process.env.API_PORT || '3100';
const DB_PORT = process.env.DB_PORT || '5433';

module.exports = {
  apps: [
    {
      // 嵌入式 PostgreSQL，数据在仓库根目录 .data/pg
      name: 'defect-db',
      cwd: path.join(root, 'apps/server'),
      script: 'scripts/dev-db.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      env: { DEV_DB_PORT: DB_PORT },
      kill_timeout: 10000,
    },
    {
      // 服务端：其余配置读取 apps/server/.env
      name: 'defect-server',
      cwd: path.join(root, 'apps/server'),
      script: 'dist/main.js',
      env: { PORT: API_PORT },
      // 数据库还没起来时会启动失败，延迟后自动重试
      restart_delay: 3000,
      max_restarts: 50,
    },
    {
      // 管理后台：vite preview 提供构建好的静态页面，并把 /api 转发给服务端
      name: 'defect-web',
      cwd: path.join(root, 'apps/web'),
      script: path.join(root, 'node_modules/vite/bin/vite.js'),
      args: `preview --host 0.0.0.0 --port ${WEB_PORT} --strictPort`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
};
