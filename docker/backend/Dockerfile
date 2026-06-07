# =============================================================================
# RAOS Backend Dockerfile
# 多阶段构建：bytenode 字节码保护 + 华为云 SWR
# =============================================================================

# -----------------------------------------------------------------------------
# 阶段 1: 依赖安装
# -----------------------------------------------------------------------------
FROM node:20-alpine@sha256:afdf98210b07b586eb71fa22ba2e432e058e4cd1304d31ed60888755b8c865fb AS dependencies

WORKDIR /app

RUN apk add --no-cache python3 make g++

# 国内环境配置 npm 镜像源（如有需要可注释或替换）
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

COPY package*.json ./
COPY tsconfig.json ./

# 安装生产依赖 + bytenode + babel（构建需要）
RUN npm ci --only=production && \
    npm install bytenode @babel/core @babel/preset-env --no-save && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# 阶段 2: 构建 + bytenode 编译
# -----------------------------------------------------------------------------
FROM node:20-alpine@sha256:afdf98210b07b586eb71fa22ba2e432e058e4cd1304d31ed60888755b8c865fb AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

# 国内环境配置 npm 镜像源
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

# 复制依赖
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package*.json ./
COPY --from=dependencies /app/tsconfig.json ./

# 复制源码
COPY src ./src
COPY web ./web
COPY scripts/build-bytenode.cjs ./scripts/build-bytenode.cjs

# TypeScript 编译
RUN npm run build

# bytenode 字节码编译（ESM → CJS → .jsc）
RUN node scripts/build-bytenode.cjs

# -----------------------------------------------------------------------------
# 阶段 3: 生产运行
# -----------------------------------------------------------------------------
FROM node:20-alpine@sha256:afdf98210b07b586eb71fa22ba2e432e058e4cd1304d31ed60888755b8c865fb AS production

RUN apk update && apk upgrade && apk add --no-cache curl && rm -rf /var/cache/apk/*

RUN addgroup -g 1001 -S raos && adduser -S raos -u 1001

WORKDIR /app

# 复制生产依赖
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package*.json ./

# 移除 ESM 声明，避免生产环境将 .js 当作 ES Module 处理
RUN sed -i '/"type": *"module"/d' package.json

# 复制 bytenode 编译产物（只保留字节码 + loader）
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server-loader.cjs ./server-loader.cjs
COPY --from=builder /app/worker-loader.cjs ./worker-loader.cjs

# 设置权限 + 切换到非 root 用户
RUN chown -R raos:raos /app
USER raos

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

# 默认启动后端服务
CMD ["node", "server-loader.cjs"]
