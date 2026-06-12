# =============================================================================
# RAOS Backend Dockerfile
# 多阶段构建：bytenode 字节码保护 + 华为云 SWR
# =============================================================================

# =============================================================================
# 多架构 build: 每个 stage 用 --platform=$TARGETPLATFORM
# 不要用 @sha256: 锁住单架构 digest — 那样 multi-arch build 会失败
#
# 为什么不用 $BUILDPLATFORM 加速: backend 有 native deps (better-sqlite3, sharp),
# 装 deps 时需要 target arch 的 prebuilt binary, 跨 arch copy 会挂
#
# Base image 走国内 mirror (docker.m.daocloud.io), 跟华为云 SWR 团队一致, 避 docker hub 网络
# 镜像版本: alpine 标签会跟随 node upstream 更新, 如需严格 pin 用具体 tag (e.g. 20.18.0-alpine)
# =============================================================================

# -----------------------------------------------------------------------------
# 阶段 1: 依赖安装
# -----------------------------------------------------------------------------
FROM --platform=$TARGETPLATFORM docker.m.daocloud.io/library/node:20-alpine AS dependencies

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
FROM --platform=$TARGETPLATFORM docker.m.daocloud.io/library/node:20-alpine AS builder

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
FROM --platform=$TARGETPLATFORM docker.m.daocloud.io/library/node:20-alpine AS production

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
# P2-3 修复: 预创建 .raos 子目录, 跟 src/utils/data-dirs.ts RUNTIME_DATA_DIRS 保持一致.
# named volume 第一次挂载时是 root:root 0755, raos 启动后建子目录会 EACCES.
# 镜像层先建好 + chown, 容器启动时 named volume mount 进这些 pre-existing dirs.
RUN mkdir -p /app/.raos/audit \
              /app/.raos/kb_images \
              /app/.raos/ltm \
              /app/.raos/calibration \
              /app/.raos/workspace && \
    chown -R raos:raos /app
USER raos

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

# 默认启动后端服务
CMD ["node", "server-loader.cjs"]
