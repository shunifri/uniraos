# =============================================================================
# RAOS Frontend Dockerfile
# 多阶段构建，生产环境使用 Nginx
# =============================================================================

# -----------------------------------------------------------------------------
# 阶段 1: 构建
# -----------------------------------------------------------------------------
FROM node:20-alpine@sha256:afdf98210b07b586eb71fa22ba2e432e058e4cd1304d31ed60888755b8c865fb AS builder

WORKDIR /app

# 安装依赖
COPY web/package*.json ./
RUN npm ci && npm cache clean --force

# 复制源码
COPY web/ ./

# 构建参数
ARG VITE_API_BASE_URL=/api
ARG VITE_WS_URL=ws://localhost:3000

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_WS_URL=${VITE_WS_URL}

# 构建
RUN npm run build

# -----------------------------------------------------------------------------
# 阶段 2: 生产运行 (Nginx)
# -----------------------------------------------------------------------------
FROM nginx:1.25-alpine@sha256:516475cc129da42866742567714ddc681e5eed7b9ee0b9e9c015e464b4221a00

# 安装安全更新
RUN apk update && apk upgrade && rm -rf /var/cache/apk/*

# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 复制 Nginx 配置
COPY docker/frontend/nginx.conf /etc/nginx/nginx.conf

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

# 暴露端口
EXPOSE 80 443

# 启动 Nginx
CMD ["nginx", "-g", "daemon off;"]
