# =============================================================================
# RAOS Frontend Dockerfile
# 多阶段构建，生产环境使用 Nginx
#
# 多架构 build: builder 阶段用 BUILDPLATFORM (只 build, 不需要 target arch),
#               runtime 阶段用 TARGETPLATFORM (让 buildx 选 amd64/arm64 对应的 nginx alpine)
# 不要用 @sha256: 锁住单架构 digest — 那样 multi-arch build 会失败
# =============================================================================

# -----------------------------------------------------------------------------
# 阶段 1: 构建
# -----------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

WORKDIR /app

# 国内环境配置 npm 镜像源
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

# 安装依赖
COPY web/package*.json ./
RUN npm ci --legacy-peer-deps && npm cache clean --force

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
FROM --platform=$TARGETPLATFORM nginx:1.25-alpine

# 安装安全更新
RUN apk update && apk upgrade && rm -rf /var/cache/apk/*

# 复制构建产物
COPY --from=builder /src/ui /usr/share/nginx/html

# 复制 Nginx 配置
COPY docker/frontend/nginx.conf /etc/nginx/nginx.conf

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

# 暴露端口
EXPOSE 80 443

# 启动 Nginx
CMD ["nginx", "-g", "daemon off;"]
