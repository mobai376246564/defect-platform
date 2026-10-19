# 腾讯云部署手册

本文按顺序给出把缺陷平台部署到腾讯云的全部步骤，对应技术方案第八章。MVP 采用「1 台 CVM + Docker Compose + TencentDB for PostgreSQL + COS」，后续可平滑迁移到 TKE。

```
开发者 Claude Code ──HTTPS──┐
测试 / 浏览器 ─────HTTPS──┤
                          ▼
                 CLB（HTTPS 证书）
                          │ 80
                 CVM：Docker Compose
                 ├─ web（Nginx：静态页面 + 反代 /api）
                 ├─ server（NestJS：API、MCP、后台任务）
                 └─ migrate（一次性：数据库迁移 + 初始化管理员）
                          │ 内网
     TencentDB for PostgreSQL      COS 存储桶 ◀── APP 直传（STS）
                                        │ 上传 manifest.json
                                        ▼
                                   SCF 云函数 ──签名事件──▶ server
```

## 0. 准备清单

| 资源                     | 规格建议                              | 说明                          |
| ------------------------ | ------------------------------------- | ----------------------------- |
| 地域                     | 与 COS 桶相同，如广州 ap-guangzhou    | SCF 只能触发同地域 COS        |
| 私有网络 VPC             | 1 个，含 1 个子网                     | CVM、数据库、SCF 同 VPC       |
| CVM                      | 4 核 8 GB，Ubuntu 22.04，系统盘 50 GB | 运行 Docker                   |
| TencentDB for PostgreSQL | 2 核 4 GB，PostgreSQL 16，双节点      | 开启自动备份，保留 7 天       |
| COS 存储桶               | 私有读写                              | 测试、正式各一个              |
| CLB                      | 应用型负载均衡 + SSL 证书             | 域名如 defects.example.com    |
| SCF                      | Node.js 18 及以上                     | 转发 COS 事件                 |
| 域名与证书               | 已备案域名 + 证书                     | 证书可在 SSL 证书服务免费申请 |

## 1. 数据库

1. 创建 TencentDB for PostgreSQL 实例，选择与 CVM 相同的 VPC 与子网。
2. 创建账号 `defect` 与数据库 `defect`（字符集 UTF8）。
3. 安全组只放行 CVM 所在子网访问 5432。
4. 记下内网地址，得到 `DATABASE_URL=postgresql://defect:<密码>@<内网IP>:5432/defect`。

## 2. COS 存储桶与访问权限（方案 5.4 ②）

1. 创建存储桶，如 `feedback-1250000000`，访问权限选择「私有读写」。
2. 生命周期规则：`feedback/` 前缀 90 天转低频存储、180 天删除；`derived/` 前缀 180 天删除。
3. 跨域（CORS）：允许来源 `https://defects.example.com`，方法 `PUT, POST, GET, HEAD`，允许头 `*`，暴露头 `ETag`。（网页提单由浏览器直传 COS，需要此设置。）
4. 在访问管理 CAM 创建两个子账号（仅编程访问）：

   **defect-platform（给平台）**

   ```json
   {
     "version": "2.0",
     "statement": [
       {
         "effect": "allow",
         "action": ["name/cos:GetObject", "name/cos:HeadObject", "name/cos:GetBucket"],
         "resource": ["qcs::cos:ap-guangzhou:uid/1250000000:feedback-1250000000/*"]
       },
       {
         "effect": "allow",
         "action": [
           "name/cos:PutObject",
           "name/cos:InitiateMultipartUpload",
           "name/cos:ListMultipartUploads",
           "name/cos:ListParts",
           "name/cos:UploadPart",
           "name/cos:CompleteMultipartUpload"
         ],
         "resource": [
           "qcs::cos:ap-guangzhou:uid/1250000000:feedback-1250000000/web/*",
           "qcs::cos:ap-guangzhou:uid/1250000000:feedback-1250000000/derived/*"
         ]
       },
       { "effect": "allow", "action": ["name/sts:GetFederationToken"], "resource": ["*"] }
     ]
   }
   ```

   **feedback-sts（给 APP 服务端，用于签发 APP 上传凭证）**：只授予 `feedback/*` 的上传动作与 `sts:GetFederationToken`。

5. 两个子账号的密钥放入 SSM 凭据管理，不要通过聊天工具或邮件传递。

## 3. CVM 与 Docker

```bash
# Ubuntu 22.04
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 重新登录后生效
docker compose version
```

安全组只放行：CLB 访问 80、运维 IP 访问 22。

## 4. 配置与启动

```bash
git clone <仓库地址> defect-platform && cd defect-platform
cp deploy/.env.production.example deploy/.env.production
vim deploy/.env.production      # 填写数据库、COS、密钥、管理员账号
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build
docker compose -f deploy/docker-compose.prod.yml logs -f server
```

- `migrate` 服务先执行 `prisma migrate deploy` 与初始化管理员，成功后 `server` 才启动。
- 生成密钥：`openssl rand -base64 48`（JWT_SECRET）、`openssl rand -hex 32`（INGEST_HMAC_SECRET）。
- 健康检查：`curl http://localhost/api/v1/health` 返回 `{"status":"ok"}`。

> 正式环境建议镜像在 CI 中构建并推送到腾讯云容器镜像服务 TCR，CVM 上只 `pull` 与 `up`，避免在生产机器上编译。

## 5. CLB 与 HTTPS

1. 创建应用型 CLB，添加 HTTPS:443 监听器，绑定证书。
2. 转发规则：域名 `defects.example.com`、路径 `/` → 后端 CVM 80 端口。
3. 健康检查路径 `/api/v1/health`。
4. 再加一个 HTTP:80 监听器，重定向到 HTTPS。
5. 如需限制访问，可在 CLB 或 WAF 上配置公司出口 IP 白名单；注意开发者在家办公时的 MCP 访问。

## 6. SCF：COS 事件转发（方案 5.4 ③）

1. 新建函数：运行环境 Node.js 18+，代码上传 `deploy/scf-cos-forwarder/index.js`，执行方法 `index.main_handler`，超时 10 秒。
2. 环境变量：`PLATFORM_URL=https://defects.example.com`、`INGEST_HMAC_SECRET=<与平台相同>`。
3. 网络：开启「私有网络」并选择平台所在 VPC 时，`PLATFORM_URL` 可填 CVM 内网地址，例如 `http://10.0.0.5`。
4. 触发器：COS 触发，存储桶选择上面的桶，事件 `cos:ObjectCreated:*`，前缀 `feedback/`，后缀 `manifest.json`。
5. 验证：在本地 `apps/server` 目录配置 `STORAGE_DRIVER=cos` 后执行 `npx tsx scripts/simulate-feedback.ts --no-event`，几秒内平台应出现新缺陷（经 SCF 转发）；关闭触发器再执行一次，10 分钟内由对账任务补单。

## 7. 在 GitHub/GitLab 配置 Webhook（方案 7.7）

配置后，平台按分支名、提交信息、MR 标题里的缺陷编号自动关联 branch / commit / MR；MR 合并时，处于「待代码审核」的缺陷以系统身份流转为「已解决」并指派给验证人，评论中记录 MR 链接。其他状态的缺陷只关联、不流转。若在「项目设置 → 版本」里选了「当前迭代版本」，自动解决时会把它填为缺陷的修复版本（已手动填过的不覆盖）；发版后记得切换到下一个迭代版本。每个项目单独配置。

1. **生成密钥**：项目管理员打开「项目设置 → 集成」，复制 Webhook 地址（形如 `https://defects.example.com/api/v1/webhooks/git/APP`，GitHub、GitLab 共用），点击「生成密钥」并立即复制（只显示一次）。重置后旧密钥立即失效，需同步更新 Git 平台。
2. **GitHub**：仓库 Settings → Webhooks → Add webhook
   - Payload URL：上面的 Webhook 地址
   - Content type：`application/json`
   - Secret：上面的密钥（平台按 `X-Hub-Signature-256` 校验 HMAC-SHA256 签名）
   - 事件：选「Let me select individual events」，勾选 **Pushes** 与 **Pull requests**
   - 保存后 GitHub 会发送 ping，Recent Deliveries 中返回 200 即连通
3. **GitLab**：项目 Settings → Webhooks → Add new webhook
   - URL：上面的 Webhook 地址
   - Secret token：上面的密钥（平台比对 `X-Gitlab-Token`）
   - 触发：勾选 **Push events**（可限定分支）与 **Merge request events**
   - 开启 SSL verification；保存后用「Test → Push events」验证返回 200
4. **网络**：Git 平台必须能访问 Webhook 地址。若第 5 节配置了 IP 白名单，需放行 GitHub 的 Webhook 出口 IP（见 `https://api.github.com/meta` 的 `hooks` 字段）或自建 GitLab 的出口 IP；自建 GitLab 访问内网地址时，需要管理员在 Admin → Settings → Network → Outbound requests 中允许。
5. **团队约定**：提交信息写 `fix(APP-12): 修复支付后订单未刷新`，或分支命名 `fix/APP-12-pay-refresh`（大小写均可），MR 标题带上编号。分支名含编号时，该分支上的所有提交都会关联到该缺陷。
6. **排查**：签名或 Token 不对、项目未生成密钥时返回 401；无法识别来源返回 400；ping、tag 推送、删除分支等事件返回 200 并带 `ignored: true`。响应体中的 `linked`、`transitioned` 列出本次关联与流转的缺陷，可在 Git 平台的投递记录中查看。

> 腾讯工蜂与 GitLab 的 Webhook 格式相近，后续接入只需在 `apps/server/src/git-webhooks/` 新增一个适配器（实现 `GitProvider`）并加入 `GIT_PROVIDERS`。

## 8. 上线后检查

- [ ] 用管理员账号登录，创建项目、绑定 APP 包名、添加成员与模块
- [ ] 网页提单并上传截图、录屏、日志，详情页可预览，录屏关键帧已生成
- [ ] 个人设置中创建 Token，按页面提示在 Claude Code 中执行 `claude mcp add`，`/mcp` 显示 defects 已连接
- [ ] Claude Code 中执行 `/mcp__defects__fix_bug <缺陷编号>`，能读到描述、截图、日志
- [ ] APP 测试包提单后自动建单（或用 simulate-feedback 模拟）
- [ ] 配置 Git Webhook 后，把一个缺陷推进到「待代码审核」，合并带编号的 MR，缺陷自动变为「已解决」

## 9. 运维

| 事项     | 做法                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------- |
| 日志     | `docker compose logs`；建议接入 CLS 日志服务                                                          |
| 监控告警 | 云监控：CVM CPU/内存、数据库连接数；CLB 5xx；业务侧关注任务表 `Job` 中 `status='failed'` 的数量       |
| 备份     | TencentDB 自动备份；COS 开启版本控制                                                                  |
| 升级     | `git pull && docker compose ... up -d --build`，迁移会在 server 启动前自动执行                        |
| 扩容     | 多实例部署时只让一个实例 `RUN_WORKER=true`，或单独部署 worker；附件与任务都在共享存储，服务本身无状态 |
| 回滚     | 镜像按版本打标签，`image:` 指回上一版本；数据库迁移只做向后兼容的变更                                 |
