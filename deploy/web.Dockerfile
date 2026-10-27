# 网页镜像：Vite 构建静态文件，Nginx 提供静态资源并反向代理 /api 到服务端，在仓库根目录执行：
#   docker build -f deploy/web.Dockerfile -t defect-web:<版本> .
# 国内网络构建时可传 npm 镜像：--build-arg NPM_REGISTRY=https://mirrors.cloud.tencent.com/npm/
# 反代目标默认是 compose 里的 server:3000，其他编排方式用 --build-arg API_UPSTREAM=<主机:端口> 修改。

ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY=
WORKDIR /app
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @defect/shared --workspace @defect/web --include-workspace-root \
    --ignore-scripts --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @defect/shared && npm run build -w @defect/web

FROM ${NGINX_IMAGE} AS runtime
ARG API_UPSTREAM=server:3000
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i "s|__API_UPSTREAM__|${API_UPSTREAM}|" /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
