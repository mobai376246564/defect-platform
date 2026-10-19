# 管理后台镜像：Vite 构建静态文件，Nginx 提供静态资源并反向代理 /api 到服务端
#   docker build -f deploy/web.Dockerfile -t defect-web:<版本> .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @defect/shared --workspace @defect/web --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @defect/shared && npm run build -w @defect/web

FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
