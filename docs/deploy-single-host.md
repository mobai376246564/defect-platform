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

| 操作              | 命令                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| 查看状态          | `pm2 ls`                                                                                                             |
| 查看日志          | `pm2 logs defect-server`                                                                                             |
| 更新代码          | `git pull && npm ci && npm run build && npm run db:deploy -w @defect/server && pm2 restart defect-server defect-web` |
| 停止              | `pm2 stop defect-web defect-server defect-db`                                                                        |
| 模拟一条 APP 反馈 | `cd apps/server && npx tsx scripts/simulate-feedback.ts`                                                             |

本地 Claude Code 接入：在后台「个人设置」创建 Token，然后执行
`claude mcp add --transport http defects http://<本机 IP>:5180/api/v1/mcp --header "Authorization: Bearer <Token>"`。
