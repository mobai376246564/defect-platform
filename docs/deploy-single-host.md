# 单机部署（测试机 / 演示机，无 Docker）

在一台装有 Node.js 22.12+ 的 macOS 或 Linux 机器上，用 pm2 托管三个进程：PostgreSQL、服务端、网页（nginx）。数据与附件都存在仓库目录下的 `.data/`，适合测试与演示；正式环境请按 [deploy-tencent-cloud.md](deploy-tencent-cloud.md) 部署。

目录结构：

| 位置                                | 内容                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| 仓库目录（如 `~/DefectManagement`） | git、`apps/server/.env`、`.data/`（数据库、附件、备份、更新状态、nginx 配置与日志）   |
| `.releases/<版本>/`                 | 在线更新时每个版本单独安装依赖、单独构建；里面的 `.env`、`.data` 是指向仓库目录的软链 |
| `.releases/current`                 | 软链，指向正在运行的版本；还没有时直接用仓库目录里的构建产物                          |

| 进程          | 端口（默认） | 说明                                                                                                              |
| ------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| defect-db     | 5433         | 嵌入式 PostgreSQL，数据在 `.data/pg`                                                                              |
| defect-server | 3100         | API、MCP、后台任务                                                                                                |
| defect-web    | 5180         | nginx 提供网页（gzip、静态资源长缓存），`/api` 转发到服务端；对外只需开放这个端口。没装 nginx 时退回 vite preview |

## 首次部署

```bash
brew install nginx          # Linux 用 apt / yum 安装；只装不启动，由 pm2 管理
cd ~/DefectManagement
npm ci                      # 网络受限时可设 FFMPEG_BINARIES_URL 指向镜像，或 brew install ffmpeg 后设 FFMPEG_PATH
npm run build
cp apps/server/.env.example apps/server/.env
```

修改 `apps/server/.env`（`<本机 IP>` 换成实际地址）：

```ini
NODE_ENV=production
PORT=3100
PUBLIC_BASE_URL=http://<本机 IP>:5180
WEB_ORIGIN=http://<本机 IP>:5180
DATABASE_URL=postgresql://defect:defect@localhost:5433/defect
JWT_SECRET=<openssl rand -base64 48 的结果>
LOCAL_STORAGE_SECRET=<openssl rand -hex 32 的结果>
```

嵌入式 PostgreSQL 在 Apple Silicon Mac 上是 x86_64 二进制，需要 Rosetta（`softwareupdate --install-rosetta`）。不想装 Rosetta 时改用 Homebrew 的 PostgreSQL，先初始化项目自己的数据目录，之后的 pm2 命令都带上 `PG_BIN_DIR`：

```bash
brew install postgresql@16
export PG_BIN_DIR=/opt/homebrew/opt/postgresql@16/bin
echo defect > /tmp/pgpw && $PG_BIN_DIR/initdb -D .data/pg-system -U defect --pwfile=/tmp/pgpw -A scram-sha-256 -E UTF8 --locale=en_US.UTF-8 && rm /tmp/pgpw
```

迁移执行前还要建库：`PGPASSWORD=defect $PG_BIN_DIR/createdb -h localhost -p 5433 -U defect defect`（在 `pm2 start` 之后执行）。

启动并初始化数据库：

```bash
pm2 start deploy/pm2/ecosystem.config.cjs
npm run db:deploy -w @defect/server     # 执行迁移
npm run db:seed -w @defect/server       # 创建开发账号与示例项目（账号见 apps/server/prisma/seed.ts）
pm2 restart defect-server
pm2 save                                 # 开机自启需再执行一次 pm2 startup 并按提示操作
```

浏览器访问 `http://<本机 IP>:5180`。

## 日常操作

| 操作              | 命令                                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| 查看状态          | `pm2 ls`                                                                    |
| 查看日志          | `pm2 logs defect-server`                                                    |
| 更新代码          | 后台「系统更新」一键更新（见下节）；命令行手动更新见下节末尾                |
| 停止              | `pm2 stop defect-web defect-server defect-db`                               |
| 模拟一条 APP 提单 | `cd apps/server && npx tsx scripts/simulate-app-defect.ts --app <APP 标识>` |

## 在线更新（系统更新）

开启后，系统管理员可以在后台「系统更新」页查看当前版本、检查新版本并一键更新；有新版本时页面顶部会提示。

更新脚本 `deploy/pm2/self-update.sh` 采用“发布目录 + 软链切换”，正在运行的版本在新版本准备好之前完全不受影响：

1. 拉取 → 备份数据库（`.data/backups/`，保留最近 10 份）；
2. 在 `.releases/<版本>/` 导出新版本代码，依赖没变化时直接复用上一版本的 `node_modules`（写时复制，几乎不占时间和空间），变化时 `npm ci`；
3. 构建 → 数据库迁移；
4. `.releases/current` 切到新版本，按新版本的 `ecosystem.config.cjs` 重启服务端和网页；
5. 健康检查（API 与网页）通过后，仓库目录快进到新版本，保留最近 3 个版本目录；不通过时自动切回上一版本并重启。

安装依赖、构建失败时直接放弃这次更新，服务不会中断；迁移失败时不切换版本，页面上会给出备份文件位置。

一次性准备（在部署机的仓库根目录执行）：

1. 生成只读部署密钥，把公钥添加到 GitHub 仓库 **Settings → Deploy keys**（不要勾选 Allow write access）：

   ```bash
   ssh-keygen -t ed25519 -N '' -C defect-deploy -f ~/.ssh/defect_deploy
   cat ~/.ssh/defect_deploy.pub
   ```

2. 让 git 用这把密钥访问 GitHub，并把仓库设为远程 `origin`（已有 origin 时把 `add` 换成 `set-url`）：

   ```bash
   printf 'Host github-defect\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/defect_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
   ssh-keyscan github.com >> ~/.ssh/known_hosts
   git remote add origin git@github-defect:<owner>/<repo>.git
   git fetch origin main
   ```

3. 在 `apps/server/.env` 加上 `SELF_UPDATE=true`，然后执行 `pm2 restart defect-server`。

说明：

- 只支持 macOS / Linux 上的 pm2 单机部署；Docker 部署请按镜像方式更新。
- 代码目录不能有未提交的改动，本地也不能有远程没有的提交，否则会拒绝更新。
- 服务端默认每 60 分钟检查一次新版本（`UPDATE_CHECK_INTERVAL_MINUTES`），页面上也可以点「检查更新」；更新来源默认是 `origin/main`（`UPDATE_REMOTE`、`UPDATE_BRANCH`）。
- 更新日志在 `.data/update/update.log`，进度在 `.data/update/status.json`。
- 每次更新都会按新版本的 `ecosystem.config.cjs` 重新启动服务端和网页，进程配置的改动自动生效；数据库进程不重启。
- 端口不是默认值时，启动 pm2 和服务端的环境里要有 `WEB_PORT` / `API_PORT`，更新时会沿用。
- 命令行手动更新：在仓库根目录执行 `set -a && . apps/server/.env && set +a && bash deploy/pm2/self-update.sh`。要先加载 `.env`，脚本备份数据库时需要 `DATABASE_URL`（后台一键更新时由服务端传入）。
- 从旧版本（原地构建）升级到发布目录方式：先 `brew install nginx`，再在仓库根目录执行一次 `bash deploy/pm2/self-update.sh`。没有 `.releases/current` 时即使已是最新版本也会执行一遍，完成切换。

每日维护：服务端每天凌晨 03:30（北京时间）自动清理超过 24 小时仍没挂到缺陷上的上传文件（网页上传到一半放弃、APP 提单失败留下的）、停在“处理中”超过 1 小时的 APP 提交（记为失败）、服务端临时目录里的残留上传、30 天前已结束的后台任务和 90 天前的已读通知。缺陷（包括已删除的）及其附件永久保留；删除项目时连同它的附件文件一起删除。

本地 Claude Code 接入：在后台「个人设置」创建 Token，然后执行
`claude mcp add -s user --transport http defects http://<本机 IP>:5180/api/v1/mcp --header "Authorization: Bearer <Token>"`。
