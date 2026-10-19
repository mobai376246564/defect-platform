# 缺陷管理平台

类 TAPD 的缺陷管理后台，打通三件事：

1. **提单带证据**：测试在网页提单（截图、录屏、日志），线上用户在 APP 内提单，附件直传腾讯云 COS。
2. **自动建单**：APP 反馈经 COS 事件 → SCF → 平台，幂等建单、提取日志摘要、按崩溃指纹去重，并有定时对账兜底。
3. **本地 Claude Code 修复**：平台提供 MCP Server，开发在本地 Claude Code 里输入缺陷编号，Claude 读取描述、截图、录屏关键帧、日志，结合本地代码分析修复，并回写结论。

技术方案与调研见 [调研/缺陷管理平台技术方案报告.md](调研/缺陷管理平台技术方案报告.md)，部署见 [docs/deploy-tencent-cloud.md](docs/deploy-tencent-cloud.md)。

## 目录结构

```
apps/server            NestJS 服务端：REST API、APP 反馈接入、后台任务、MCP Server
  prisma/              数据模型、迁移、初始化数据
  scripts/             dev-db（嵌入式 PostgreSQL）、simulate-feedback（模拟 APP 反馈）
  test/                e2e 测试（嵌入式 PostgreSQL + 官方 MCP 客户端）
apps/web               React + Ant Design 管理后台
packages/shared        前后端共享：字段枚举、工作流引擎、权限矩阵、manifest 校验
deploy/                Dockerfile、Nginx、docker-compose、SCF 转发函数
docs/                  部署手册
调研/                  技术方案报告
```

## 本地开发

需要 Node.js 22.12+。Windows 上嵌入式 PostgreSQL 依赖 Visual C++ 运行库（`winget install Microsoft.VCRedist.2015+.x64`）。

```bash
npm install
cp apps/server/.env.example apps/server/.env
npm run db:start                                   # 终端 1：启动本地 PostgreSQL（5433 端口）
npm run db:deploy -w @defect/server && npm run db:seed -w @defect/server
npm run dev:server                                 # 终端 2：http://localhost:3000/api/v1
npm run dev:web                                    # 终端 3：http://localhost:5173
```

本地开发账号见 `apps/server/prisma/seed.ts`（仅限本地，生产环境用 `SEED_ADMIN_*` 环境变量创建管理员）。

模拟一条 APP 反馈（在 `apps/server` 目录）：

```bash
npx tsx scripts/simulate-feedback.ts
```

## 常用命令

| 命令                                   | 作用                                                               |
| -------------------------------------- | ------------------------------------------------------------------ |
| `npm test`                             | 全部测试（shared 单测、server 单测与 e2e、web 单测、SCF 转发函数） |
| `npm run typecheck`                    | 全部类型检查                                                       |
| `npm run lint` / `npm run format`      | ESLint / Prettier                                                  |
| `npm run build`                        | 构建全部包                                                         |
| `npm run db:migrate -w @defect/server` | 修改 `schema.prisma` 后生成迁移                                    |

## 在 Claude Code 中使用

1. 登录平台 →「个人设置与 Claude Code 接入」→ 创建 Token。
2. 在终端执行页面给出的命令：

   ```bash
   claude mcp add --transport http defects https://<平台域名>/api/v1/mcp --header "Authorization: Bearer <Token>"
   ```

3. 在项目目录打开 Claude Code，输入 `/mcp__defects__fix_bug APP-1024`，或直接说“看一下 APP-1024 并修复”。

MCP 工具：`search_defects`、`get_defect`、`get_screenshots`、`get_video_frames`、`grep_log`、`read_log`、`download_attachments`、`add_comment`、`transition_defect`、`link_commit`；资源 `defect://<编号>`；提示词 `fix_bug`。只读 Token 不能调用写工具。

## 关键设计

- **工作流可配置**：状态归属四个类别（未开始 / 进行中 / 待验证 / 已完成），统计与 SLA 按类别计算；流转校验角色、必填字段与说明，见 `packages/shared/src/workflow.ts`。
- **对象存储抽象**：开发用本地磁盘（签名 URL 模拟 COS 预签名），生产用 COS + STS，业务代码只依赖 `ObjectStorage` 接口。
- **任务队列**：基于 PostgreSQL `FOR UPDATE SKIP LOCKED`，带去重键与指数退避，MVP 不引入 Redis / 消息队列。
- **APP 反馈幂等**：`reportId` 贯穿 COS 目录、manifest 与缺陷单；事件重复投递、对账补登都只建一单。
- **权限**：服务端统一校验，前端只控制按钮显示；MCP 以 Token 所属用户的身份与角色执行。
