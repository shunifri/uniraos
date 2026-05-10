# =============================================================================
# RAOS Backend Dockerfile
# 多阶段构建，支持华为云 SWR
# =============================================================================

# -----------------------------------------------------------------------------
# 阶段 1: 依赖安装
# -----------------------------------------------------------------------------
FROM node:20-alpine@sha256:afdf98210b07b586eb71fa22ba2e432e058e4cd1304d31ed60888755b8c865fb AS dependencies

WORKDIR /app

# 安装构建依赖
RUN apk add --no-cache python3 make g++

# 复制依赖配置
COPY package*.json ./
COPY tsconfig.json ./

# 安装生产依赖
RUN npm ci --only=production && npm cache clean --force

# -----------------------------------------------------------------------------
# 阶段 2: 构建
# -----------------------------------------------------------------------------
FROM node:20-alpine@sha256:afdf98210b07b586eb71fa22ba2e432e058e4cd1304d31ed60888755b8c865fb AS builder

WORKDIR /app

# 复制依赖
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig.json ./

# 复制源码
COPY src ./src
COPY web ./web

# 构建
RUN npm run build

# -----------------------------------------------------------------------------
# 阶段 3: 生产运行
# -----------------------------------------------------------------------------
FROM node:20-alpine@sha256:afdf98210b07b586eb71fa22ba2e432e058e4cd1304d31ed60888755b8c865fb AS production

# 安装安全更新
RUN apk update && apk upgrade && apk add --no-cache curl && rm -rf /var/cache/apk/*

# 创建非 root 用户
RUN addgroup -g 1001 -S raos && adduser -S raos -u 1001

WORKDIR /app

# 复制生产依赖
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json ./

# 复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist

# 设置权限
RUN chown -R raos:raos /app

# 切换到非 root 用户
USER raos

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "dist/server.js"]
