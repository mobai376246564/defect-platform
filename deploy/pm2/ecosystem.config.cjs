/**
 * 单机部署（无 Docker）：用 pm2 托管数据库、服务端与网页三个进程。
 * 适合测试机、演示机；正式环境见 docs/deploy-tencent-cloud.md。
 *
 * 目录约定（见 docs/deploy-single-host.md）：
 *   仓库目录（HOME）：git、apps/server/.env、.data（数据库、附件、备份、更新状态）
 *   .releases/<版本>/：在线更新时每个版本独立安装依赖与构建；.releases/current 指向正在运行的版本
 * 还没有 .releases/current 时（首次部署、本地开发）直接用仓库目录里的构建产物。
 *
 * 启动：pm2 start deploy/pm2/ecosystem.config.cjs   （在仓库根目录执行）
 * 端口可用环境变量覆盖：WEB_PORT（默认 5180）、API_PORT（3100）、DB_PORT（5433）。
 * PG_BIN_DIR：改用系统安装的 PostgreSQL（如 /opt/homebrew/opt/postgresql@16/bin），
 *   数据目录为 .data/pg-system，需先按 docs/deploy-single-host.md 初始化。
 *   嵌入式 PostgreSQL 在 Apple Silicon 上依赖 Rosetta，未安装时用这种方式。
 * NGINX_BIN：nginx 可执行文件；不设置时在常见位置查找。找到时由 nginx 提供网页（gzip、静态资源长缓存），
 *   找不到时退回 vite preview。
 */
const fs = require('node:fs');
const path = require('node:path');

const here = path.resolve(__dirname, '../..');
// 本文件可能在 .releases/<版本>/deploy/pm2 下（在线更新重启时从新版本目录加载），据此找回仓库目录
const HOME = path.basename(path.dirname(here)) === '.releases' ? path.resolve(here, '../..') : here;
const CURRENT = path.join(HOME, '.releases/current');
// 进程的工作目录用 current 软链路径而不是解析后的真实目录，切换版本后重启即生效
const CODE = fs.existsSync(CURRENT) ? CURRENT : HOME;

const WEB_PORT = process.env.WEB_PORT || '5180';
const API_PORT = process.env.API_PORT || '3100';
const DB_PORT = process.env.DB_PORT || '5433';
const PG_BIN_DIR = process.env.PG_BIN_DIR;

const db = PG_BIN_DIR
  ? {
      // 系统 PostgreSQL，数据在仓库目录 .data/pg-system
      name: 'defect-db',
      script: path.join(PG_BIN_DIR, 'postgres'),
      args: `-D ${path.join(HOME, '.data/pg-system')} -p ${DB_PORT}`,
      interpreter: 'none',
      // macOS 上未设置 LC_ALL 时 postmaster 会因 "became multithreaded during startup" 退出
      env: { LC_ALL: 'en_US.UTF-8' },
      kill_timeout: 10000,
    }
  : {
      // 嵌入式 PostgreSQL，数据在仓库目录 .data/pg；固定从仓库目录运行，在线更新不会动它的依赖
      name: 'defect-db',
      cwd: path.join(HOME, 'apps/server'),
      script: 'scripts/dev-db.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      env: { DEV_DB_PORT: DB_PORT },
      kill_timeout: 10000,
    };

function findNginx() {
  const candidates = [
    process.env.NGINX_BIN,
    '/opt/homebrew/bin/nginx',
    '/usr/local/bin/nginx',
    '/usr/sbin/nginx',
    '/usr/bin/nginx',
  ];
  return candidates.find((c) => c && fs.existsSync(c));
}

/** 生成 nginx 配置（每次加载本文件时重写，端口与目录总是和当前设置一致） */
function writeNginxConf() {
  const prefix = path.join(HOME, '.data/nginx');
  for (const d of ['logs', 'tmp']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
  const dist = path.join(CODE, 'apps/web/dist');
  const conf = `# 由 deploy/pm2/ecosystem.config.cjs 自动生成，修改请改该文件
worker_processes 1;
pid ${prefix}/nginx.pid;
error_log ${prefix}/logs/error.log warn;
events { worker_connections 1024; }

http {
  types {
    text/html html;
    text/css css;
    application/javascript js mjs;
    application/json json;
    image/svg+xml svg;
    image/png png;
    image/jpeg jpg jpeg;
    image/webp webp;
    image/x-icon ico;
    font/woff2 woff2;
    font/woff woff;
    text/plain txt;
  }
  default_type application/octet-stream;
  access_log ${prefix}/logs/access.log;
  sendfile on;
  keepalive_timeout 65;
  server_tokens off;
  client_body_temp_path ${prefix}/tmp/body;
  proxy_temp_path ${prefix}/tmp/proxy;
  fastcgi_temp_path ${prefix}/tmp/fastcgi;
  uwsgi_temp_path ${prefix}/tmp/uwsgi;
  scgi_temp_path ${prefix}/tmp/scgi;

  gzip on;
  gzip_vary on;
  gzip_min_length 1024;
  gzip_types text/plain text/css application/javascript application/json image/svg+xml;

  server {
    listen ${WEB_PORT};
    root ${dist};
    # 网页提单在本地存储模式下经由服务端上传附件（最大 200 MB）
    client_max_body_size 200m;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location /api/ {
      proxy_pass http://127.0.0.1:${API_PORT};
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      # 大文件上传直接流给服务端，不先落到 nginx 临时目录；慢网上传 200 MB 也不超时
      proxy_request_buffering off;
      proxy_read_timeout 600s;
      proxy_send_timeout 600s;
      # MCP 返回大段文本 / 图片时不要缓冲截断
      proxy_buffering off;
    }

    # 带指纹的静态资源长期缓存
    location /assets/ {
      expires 1y;
      add_header Cache-Control "public, immutable";
      try_files $uri =404;
    }

    # 不对外提供 sourcemap
    location ~ \\.map$ {
      return 404;
    }

    # 单页应用：其余路径回落到 index.html，且每次都向服务器确认是否有新版本
    location / {
      try_files $uri /index.html;
      add_header Cache-Control "no-cache";
    }
  }
}
`;
  const file = path.join(prefix, 'nginx.conf');
  fs.writeFileSync(file, conf);
  return { prefix, file };
}

function webApp() {
  const nginx = findNginx();
  if (nginx) {
    const { prefix, file } = writeNginxConf();
    return {
      // 网页：nginx 提供构建好的静态页面（gzip、长缓存），并把 /api 转发给服务端
      name: 'defect-web',
      script: nginx,
      args: [
        '-p',
        prefix,
        '-e',
        path.join(prefix, 'logs/error.log'),
        '-c',
        file,
        '-g',
        'daemon off;',
      ],
      interpreter: 'none',
      kill_timeout: 5000,
    };
  }
  return {
    // 没装 nginx 时退回 vite preview（无压缩、无长缓存，仅适合临时使用）
    name: 'defect-web',
    cwd: path.join(CODE, 'apps/web'),
    script: path.join(CODE, 'node_modules/vite/bin/vite.js'),
    args: `preview --host 0.0.0.0 --port ${WEB_PORT} --strictPort`,
    env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
  };
}

module.exports = {
  apps: [
    db,
    {
      // 服务端：其余配置读取 apps/server/.env（发布目录里是指向仓库目录 .env 的软链）
      name: 'defect-server',
      cwd: path.join(CODE, 'apps/server'),
      script: 'dist/main.js',
      // 在线更新与版本检查操作的是仓库目录的 git，而不是发布目录
      env: { PORT: API_PORT, UPDATE_REPO_DIR: HOME },
      // 数据库还没起来时会启动失败，延迟后自动重试
      restart_delay: 3000,
      max_restarts: 50,
      kill_timeout: 10000,
    },
    webApp(),
  ],
};
