# 腾讯云部署手册

本文按顺序给出把缺陷平台部署到腾讯云的全部步骤，对应技术方案第八章。MVP 采用「1 台 CVM + Docker Compose + TencentDB for PostgreSQL + COS」，后续可平滑迁移到 TKE。

```
开发者 Claude Code ──HTTPS──┐
测试 / 浏览器 ─────HTTPS──┤
各 APP 提单（接口）─HTTPS──┤
                          ▼
                 CLB（HTTPS 证书）
                          │ 80
                 CVM：Docker Compose
                 ├─ web（Nginx：静态页面 + 反代 /api）
                 ├─ server（NestJS：API、APP 提单、MCP、后台任务）
                 └─ migrate（一次性：数据库迁移 + 初始化管理员）
                          │ 内网
     TencentDB for PostgreSQL      COS 存储桶（附件：截图、录屏、日志）
```

APP 通过 `POST /api/v1/app/defects` 把描述和附件一次性提交给平台，平台写入 COS 并建单，接口说明见 [app-integration.md](app-integration.md)。

## 0. 准备清单

| 资源                     | 规格建议                              | 说明                          |
| ------------------------ | ------------------------------------- | ----------------------------- |
| 地域                     | 与 COS 桶相同，如广州 ap-guangzhou    | 内网访问 COS 更快且不收流量费 |
| 私有网络 VPC             | 1 个，含 1 个子网                     | CVM、数据库同 VPC             |
| CVM                      | 4 核 8 GB，Ubuntu 22.04，系统盘 50 GB | 运行 Docker                   |
| TencentDB for PostgreSQL | 2 核 4 GB，PostgreSQL 16，双节点      | 开启自动备份，保留 7 天       |
| COS 存储桶               | 私有读写                              | 测试、正式各一个              |
| CLB                      | 应用型负载均衡 + SSL 证书             | 域名如 defects.example.com    |
| 域名与证书               | 已备案域名 + 证书                     | 证书可在 SSL 证书服务免费申请 |

## 1. 数据库

1. 创建 TencentDB for PostgreSQL 实例，选择与 CVM 相同的 VPC 与子网。
2. 创建账号 `defect` 与数据库 `defect`（字符集 UTF8）。
3. 安全组只放行 CVM 所在子网访问 5432。
4. 记下内网地址，得到 `DATABASE_URL=postgresql://defect:<密码>@<内网IP>:5432/defect`。

## 2. COS 存储桶与访问权限

1. 创建存储桶，如 `feedback-1250000000`，访问权限选择「私有读写」。目录约定：`feedback/` 为 APP 提单的附件，`web/` 为网页提单的附件，`derived/` 为缩略图、录屏关键帧。
2. 生命周期规则：缺陷要永久保留，**不要**给 `feedback/`、`web/` 配置删除规则。可以按需配置 90 天后转低频存储以节省费用；`derived/` 可以随时重新生成，可配置 180 天删除。
3. 跨域（CORS）：允许来源 `https://defects.example.com`，方法 `PUT, POST, GET, HEAD`，允许头 `*`，暴露头 `ETag`。（网页提单由浏览器直传 COS，需要此设置。）
4. 在访问管理 CAM 创建一个子账号（仅编程访问）：

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
           "qcs::cos:ap-guangzhou:uid/1250000000:feedback-1250000000/feedback/*",
           "qcs::cos:ap-guangzhou:uid/1250000000:feedback-1250000000/web/*",
           "qcs::cos:ap-guangzhou:uid/1250000000:feedback-1250000000/derived/*"
         ]
       },
       {
         "effect": "allow",
         "action": ["name/cos:DeleteObject", "name/cos:DeleteMultipleObject"],
         "resource": [
           "qcs::cos:ap-guangzhou:uid/1250000000:feedback-1250000000/web/*",
           "qcs::cos:ap-guangzhou:uid/1250000000:feedback-1250000000/derived/*"
         ]
       },
       { "effect": "allow", "action": ["name/sts:GetFederationToken"], "resource": ["*"] }
     ]
   }
   ```

   - `feedback/*`：平台收到 APP 提单后把附件写进去。
   - `web/*`：网页提单时签发临时凭证，由浏览器直传。
   - 删除权限只给 `web/`、`derived/`：每天清理没有挂到缺陷上的残留上传。缺陷附件不会被删除。

5. 子账号密钥放入 SSM 凭据管理，不要通过聊天工具或邮件传递。

## 3. CVM 与 Docker

```bash
# Ubuntu 22.04
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 重新登录后生效
docker compose version
```

国内 CVM 拉 Docker Hub 的基础镜像（`node`、`nginx`）容易超时，配置腾讯云内网镜像加速：

```bash
sudo mkdir -p /etc/docker
echo '{ "registry-mirrors": ["https://mirror.ccs.tencentyun.com"] }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

安全组只放行：CLB 访问 80、运维 IP 访问 22。

## 4. 镜像说明

仓库里与容器部署有关的文件都在 `deploy/` 下，交给运维的就是这几个：

| 文件                             | 作用                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `deploy/server.Dockerfile`       | 服务端镜像（API、MCP、后台任务）。`--target runtime` 是运行镜像，`--target migrator` 是迁移镜像 |
| `deploy/web.Dockerfile`          | 网页镜像：Nginx 托管前端页面，并把 `/api` 反代到 server                                         |
| `deploy/nginx.conf`              | 网页镜像里的 Nginx 配置（缓存、200 MB 上传、10 分钟超时）                                       |
| `deploy/docker-compose.prod.yml` | 单台 CVM 的编排：migrate → server → web                                                         |
| `deploy/.env.production.example` | 配置模板，复制为 `deploy/.env.production` 填写（不要提交）                                      |
| `.dockerignore`                  | 构建时排除 node_modules、本地数据等                                                             |

三个镜像都在**仓库根目录**构建（构建上下文是整个仓库，因为前后端共用 `packages/shared`）：

```bash
docker build -f deploy/server.Dockerfile --target runtime  -t defect-server:<版本> .
docker build -f deploy/server.Dockerfile --target migrator -t defect-migrator:<版本> .
docker build -f deploy/web.Dockerfile -t defect-web:<版本> .
```

- 国内网络构建加上镜像源参数：`--build-arg NPM_REGISTRY=https://mirrors.cloud.tencent.com/npm/ --build-arg DEBIAN_MIRROR=http://mirrors.tencentyun.com --build-arg FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static`（用 compose 构建时这几个值从 `.env.production` 读取）。`mirrors.tencentyun.com` 是 CVM 内网源，在腾讯云外构建（如 CI、本机）改用 `http://mirrors.aliyun.com`；Debian 源必须用 http 且不能跳转到 https。
- 在 Mac（Apple 芯片）上构建给 x86 的 CVM 用，要加 `--platform linux/amd64`。
- 服务端容器以非 root 用户运行，自带健康检查（`/api/v1/health`）；`migrate` 每次启动都执行 `prisma migrate deploy` 与初始化管理员，执行完退出。
- 数据库迁移会执行 `CREATE EXTENSION IF NOT EXISTS pg_trgm`（模糊搜索的索引）。TencentDB 上如果 `defect` 账号没有权限，先在控制台「插件管理」里给 `defect` 库安装 `pg_trgm`。

## 5. 配置与启动

**方式一：在 CVM 上直接构建（最简单）**

```bash
git clone <仓库地址> defect-platform && cd defect-platform
cp deploy/.env.production.example deploy/.env.production
vim deploy/.env.production      # 填写数据库、COS、密钥、管理员账号
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build
docker compose -f deploy/docker-compose.prod.yml logs -f server
```

**方式二：CI 构建并推送到腾讯云容器镜像服务 TCR，CVM 只拉镜像（正式环境推荐）**

```bash
# CI 或构建机上，在仓库根目录
docker login ccr.ccs.tencentyun.com --username <账号 ID>
REG=ccr.ccs.tencentyun.com/<命名空间>
TAG=$(git rev-parse --short HEAD)
docker build -f deploy/server.Dockerfile --target runtime  -t $REG/defect-server:$TAG .
docker build -f deploy/server.Dockerfile --target migrator -t $REG/defect-migrator:$TAG .
docker build -f deploy/web.Dockerfile -t $REG/defect-web:$TAG .
docker push $REG/defect-server:$TAG && docker push $REG/defect-migrator:$TAG && docker push $REG/defect-web:$TAG

# CVM 上：.env.production 里设置 IMAGE_REGISTRY=$REG、IMAGE_TAG=$TAG，然后
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d
```

- `migrate` 服务先执行 `prisma migrate deploy` 与初始化管理员，成功后 `server` 才启动。
- 生成密钥：`openssl rand -base64 48`（JWT_SECRET）。
- `TRUST_PROXY_HOPS=2`：请求经过 CLB 和容器里的 Nginx 两层代理，服务端据此取真实客户端 IP 做登录限流；填错会把所有人当成同一个 IP 一起限流。
- 附件推荐存 COS（`STORAGE_DRIVER=cos`）。没有 COS 时可用 `STORAGE_DRIVER=local`，附件存在数据卷 `server-data` 里，需要自己备份这个卷，并设置 `LOCAL_STORAGE_SECRET`。
- 健康检查：`curl http://localhost/api/v1/health` 返回 `{"status":"ok"}`。
- 容器部署不使用管理后台的「系统更新」（那是单机 pm2 部署的在线更新），升级按第 9 节换镜像。

## 6. CLB 与 HTTPS

1. 创建应用型 CLB，添加 HTTPS:443 监听器，绑定证书。
2. 转发规则：域名 `defects.example.com`、路径 `/` → 后端 CVM 80 端口。
3. 健康检查路径 `/api/v1/health`。
4. 再加一个 HTTP:80 监听器，重定向到 HTTPS。
5. **APP 提单带大附件**：一次请求最大约 500 MB（单个文件 200 MB）。请把 CLB 监听器的「请求体大小上限」调到 512 MB 以上，后端请求超时调到 600 秒，否则大录屏会被 CLB 拒绝或中途断开。
6. 如需限制访问，可在 CLB 或 WAF 上配置公司出口 IP 白名单。注意开发者在家办公时的 MCP 访问，以及 APP 提单接口 `/api/v1/app/defects` 要允许 APP 所在网络访问。

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
4. **网络**：Git 平台必须能访问 Webhook 地址。若第 6 节配置了 IP 白名单，需放行 GitHub 的 Webhook 出口 IP（见 `https://api.github.com/meta` 的 `hooks` 字段）或自建 GitLab 的出口 IP；自建 GitLab 访问内网地址时，需要管理员在 Admin → Settings → Network → Outbound requests 中允许。
5. **团队约定**：提交信息写 `fix(APP-12): 修复支付后订单未刷新`，或分支命名 `fix/APP-12-pay-refresh`（大小写均可），MR 标题带上编号。分支名含编号时，该分支上的所有提交都会关联到该缺陷。
6. **排查**：签名或 Token 不对、项目未生成密钥时返回 401；无法识别来源返回 400；ping、tag 推送、删除分支等事件返回 200 并带 `ignored: true`。响应体中的 `linked`、`transitioned` 列出本次关联与流转的缺陷，可在 Git 平台的投递记录中查看。

> 腾讯工蜂与 GitLab 的 Webhook 格式相近，后续接入只需在 `apps/server/src/git-webhooks/` 新增一个适配器（实现 `GitProvider`）并加入 `GIT_PROVIDERS`。

## 8. 上线后检查

- [ ] 用管理员账号登录，创建项目、在「项目设置 → APP 接入」绑定 APP 标识、添加成员与模块
- [ ] 网页提单并上传截图、录屏、日志，详情页可预览，录屏关键帧已生成
- [ ] 个人设置中创建 Token，按页面提示在 Claude Code 中执行 `claude mcp add`，`/mcp` 显示 defects 已连接
- [ ] Claude Code 中执行 `/mcp__defects__fix_bug <缺陷编号>`，能读到描述、截图、日志
- [ ] APP 测试包提单后自动建单，返回缺陷编号（没有 APP 时在 `apps/server` 目录执行 `npx tsx scripts/simulate-app-defect.ts --app <APP 标识> --base https://defects.example.com` 模拟）
- [ ] 配置 Git Webhook 后，把一个缺陷推进到「待代码审核」，合并带编号的 MR，缺陷自动变为「已解决」

## 9. 运维

| 事项     | 做法                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 日志     | `docker compose logs`；建议接入 CLS 日志服务                                                                                          |
| 监控告警 | 云监控：CVM CPU/内存、数据库连接数；CLB 5xx；业务侧关注任务表 `Job` 中 `status='failed'` 的数量                                       |
| 备份     | TencentDB 自动备份；COS 开启版本控制                                                                                                  |
| 升级     | 方式一：`git pull` 后 `docker compose ... up -d --build`；方式二：改 `IMAGE_TAG` 后 `pull` 再 `up -d`。迁移会在 server 启动前自动执行 |
| 扩容     | 多实例部署时只让一个实例 `RUN_WORKER=true`，或单独部署 worker；附件与任务都在共享存储，服务本身无状态                                 |
| 回滚     | 镜像按版本打标签，`IMAGE_TAG` 改回上一版本后 `up -d`；数据库迁移只做向后兼容的变更                                                    |
