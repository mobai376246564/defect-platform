# 缺陷平台服务端镜像（多阶段构建）
#   docker build -f deploy/server.Dockerfile --target runtime  -t defect-server:<版本> .
#   docker build -f deploy/server.Dockerfile --target migrator -t defect-migrator:<版本> .
# runtime：只含运行所需依赖；migrator：带 prisma CLI，用于执行数据库迁移与初始化数据。

FROM node:22-bookworm-slim AS build
WORKDIR /app
# prisma.config.ts 读取 DATABASE_URL；构建（prisma generate）时不连库，给一个占位值，运行时由 env_file 覆盖
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @defect/shared --workspace @defect/server --include-workspace-root
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w @defect/shared && npm run build -w @defect/server

# 迁移镜像：保留完整依赖（含 prisma CLI 与 tsx）
FROM build AS migrator
ENV NODE_ENV=production
WORKDIR /app/apps/server
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts"]

FROM build AS prune
RUN npm prune --omit=dev --workspace @defect/shared --workspace @defect/server

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r app && useradd -r -g app app
COPY --from=prune /app/node_modules ./node_modules
COPY --from=prune /app/packages/shared/package.json packages/shared/package.json
COPY --from=prune /app/packages/shared/dist packages/shared/dist
COPY --from=prune /app/apps/server/package.json apps/server/package.json
COPY --from=prune /app/apps/server/dist apps/server/dist
WORKDIR /app/apps/server
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
