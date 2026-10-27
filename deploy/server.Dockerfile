# 缺陷平台服务端镜像（多阶段构建），在仓库根目录执行：
#   docker build -f deploy/server.Dockerfile --target runtime  -t defect-server:<版本> .
#   docker build -f deploy/server.Dockerfile --target migrator -t defect-migrator:<版本> .
# runtime：只含运行所需依赖；migrator：带 prisma CLI，执行数据库迁移与初始化管理员后退出。
#
# 国内网络构建时可传镜像源（都可不传）：
#   --build-arg NPM_REGISTRY=https://mirrors.cloud.tencent.com/npm/
#   --build-arg DEBIAN_MIRROR=http://mirrors.tencentyun.com   （腾讯云 CVM 内网源；在腾讯云外构建用 http://mirrors.aliyun.com）
#   Debian 源必须是 http 且不跳转 https：此时镜像里还没有 CA 证书
#   --build-arg FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ARG DEBIAN_MIRROR=
ARG NPM_REGISTRY=
RUN if [ -n "$DEBIAN_MIRROR" ]; then \
      sed -i "s|http://deb.debian.org|$DEBIAN_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
  && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi

FROM base AS build
WORKDIR /app
# prisma.config.ts 读取 DATABASE_URL；构建（prisma generate）时不连库，给一个占位值，运行时由 env_file 覆盖
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
# ffmpeg-static 安装时从 GitHub 下载 ffmpeg（录屏抽帧用），国内可改用镜像
ARG FFMPEG_BINARIES_URL=
ENV FFMPEG_BINARIES_URL=${FFMPEG_BINARIES_URL}
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @defect/shared --workspace @defect/server --include-workspace-root \
    --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w @defect/shared && npm run build -w @defect/server

# 迁移镜像：保留完整依赖（含 prisma CLI 与 tsx）
FROM build AS migrator
ENV NODE_ENV=production
WORKDIR /app/apps/server
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts"]

# 运行镜像的依赖：单独只装生产依赖。@prisma/client 把 prisma CLI、TypeScript 声明为可选 peer，
# npm 仍会装上（连带 Prisma Studio、内嵌数据库等）；运行时用不到，装完后删掉，约 190 MB
FROM base AS deps
WORKDIR /app
ARG FFMPEG_BINARIES_URL=
ENV FFMPEG_BINARIES_URL=${FFMPEG_BINARIES_URL}
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @defect/shared --workspace @defect/server \
    --include-workspace-root --no-audit --no-fund \
  && cd node_modules && rm -rf prisma typescript react react-dom @electric-sql \
    @prisma/studio-core @prisma/engines @prisma/dev @prisma/fetch-engine

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    # 本地存储模式下附件写到这里，由 compose 挂载数据卷；用 COS 时不使用
    LOCAL_STORAGE_DIR=/data/storage
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app \
  && mkdir -p /data/storage && chown -R app:app /data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
WORKDIR /app/apps/server
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
