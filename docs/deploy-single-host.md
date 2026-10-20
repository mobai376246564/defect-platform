# 单机部署（测试机 / 演示机，无 Docker）

在一台装有 Node.js 22.12+ 的 macOS 或 Linux 机器上，用 pm2 托管三个进程：嵌入式 PostgreSQL、服务端、管理后台。数据与附件都存在仓库目录下的 `.data/`，适合测试与演示；正式环境请按 [deploy-tencent-cloud.md](deploy-tencent-cloud.md) 部署。

| 进程          | 端口（默认） | 说明                                                |
| ------------- | ------------ | --------------------------------------------------- |
| defect-db     | 5433         | 嵌入式 PostgreSQL，数据在 `.data/pg`                |
| defect-server | 3100         | API、MCP、后台任务                                  |
| defect-web    | 5180         | 管理后台，`/api` 转发到服务端；对外只需开放这个端口 |

## 首次部署

```bash
cd ~/DefectManagement
npm ci                      # 网络受限时可设 FFMPEG_BINARIES_URL 指向镜像，或 brew install ffmpeg 后设 FFMPEG_PATH
npm run build
cp apps/server/.env.example apps/server/.env
```

修改 `apps/server/.env`（`<本机 IP>` 换成实际地址）：

```ini
PORT=3100
PUBLIC_BASE_URL=http://<本机 IP>:5180
WEB_ORIGIN=http://<本机 IP>:5180
DATABASE_URL=postgresql://defect:defect@localhost:5433/defect
JWT_SECRET=<openssl rand -base64 48 的结果>
LOCAL_STORAGE_SECRET=<openssl rand -hex 32 的结果>
INGEST_HMAC_SECRET=<openssl rand -hex 32 的结果>
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

| 操作              | 命令                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| 查看状态          | `pm2 ls`                                                                                |
| 查看日志          | `pm2 logs defect-server`                                                                |
| 更新代码          | 后台「系统更新」一键更新（见下节），或在仓库根目录执行 `bash deploy/pm2/self-update.sh` |
| 停止              | `pm2 stop defect-web defect-server defect-db`                                           |
| 模拟一条 APP 反馈 | `cd apps/server && npx tsx scripts/simulate-feedback.ts`                                |

## 在线更新（系统更新）

开启后，系统管理员可以在后台「系统更新」页查看当前版本、检查新版本并一键更新；有新版本时页面顶部会提示。

更新脚本 `deploy/pm2/self-update.sh` 依次执行：拉取 → 备份数据库（`.data/backups/`）→ 快进合并 → 依赖变化时 `npm ci` → 构建 → 数据库迁移 → pm2 重启 → 健康检查。构建失败会自动回滚到更新前的版本；迁移失败会保留新代码但不重启，页面上会给出备份文件位置。

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
- pm2 重启时沿用原来的进程配置；如果更新改动了 `deploy/pm2/ecosystem.config.cjs`，需要手动 `pm2 delete` 后重新 `pm2 start`。

本地 Claude Code 接入：在后台「个人设置」创建 Token，然后执行
`claude mcp add --transport http defects http://<本机 IP>:5180/api/v1/mcp --header "Authorization: Bearer <Token>"`。
