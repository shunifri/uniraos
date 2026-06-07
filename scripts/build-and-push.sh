#!/bin/bash

# =============================================================================
# RAOS 镜像构建推送脚本 (华为云 SWR / 任何兼容 Docker Registry v2 的仓库)
#
# 多架构 build: 默认 linux/amd64,linux/arm64 (CentOS + 国产 arm 服务器 + Mac M-series)
# 单架构: SWR_PLATFORMS=linux/amd64 ./scripts/build-and-push.sh v1.0.0
#
# 前置:
#   1. SWR_USERNAME / SWR_PASSWORD env var (CI 走 secret, 本地用 export)
#   2. Docker buildx + qemu emulation (macOS Docker Desktop 自带, Linux 需 apt install qemu-user-static)
#
# 注意:
#   - Backend Dockerfile 是 bytenode 字节码, 镜像里**没有可读 JS**, 不能进容器改代码
#   - 第一次 buildx build 会下载 buildkit image (~500MB), 后续会缓存
#   - 多架构 build 在 Mac Apple Silicon 上用 qemu emulation, 慢 (10-20min)
# =============================================================================

set -euo pipefail

# 华为云 SWR 配置（从环境变量读取，禁止硬编码）
SWR_REGISTRY="${SWR_REGISTRY:-swr.cn-north-4.myhuaweicloud.com}"
SWR_NAMESPACE="${SWR_NAMESPACE:-kavin}"  # 默认 kavin (跟 docker-compose.yml / swarm.yml 一致)
SWR_USERNAME="${SWR_USERNAME:?错误：SWR_USERNAME 环境变量未设置}"
SWR_PASSWORD="${SWR_PASSWORD:?错误：SWR_PASSWORD 环境变量未设置}"

# 多架构平台 — 默认 amd64 + arm64
# 单架构: SWR_PLATFORMS=linux/amd64 ./scripts/build-and-push.sh v1.0.0
# 不带 v8 的: SWR_PLATFORMS=linux/amd64/v8 (跟 buildx 完整语法一致)
SWR_PLATFORMS="${SWR_PLATFORMS:-linux/amd64,linux/arm64}"

# 镜像标签
VERSION=${1:-latest}
BACKEND_IMAGE="${SWR_REGISTRY}/${SWR_NAMESPACE}/raos-backend:${VERSION}"
FRONTEND_IMAGE="${SWR_REGISTRY}/${SWR_NAMESPACE}/raos-frontend:${VERSION}"

echo "=============================================="
echo "RAOS 镜像构建推送"
echo "=============================================="
echo "仓库: ${SWR_REGISTRY}/${SWR_NAMESPACE}"
echo "平台: ${SWR_PLATFORMS}"
echo "版本: ${VERSION}"
echo "后端镜像: ${BACKEND_IMAGE}"
echo "前端镜像: ${FRONTEND_IMAGE}"
echo ""

# -----------------------------------------------------------------------------
# 1. 登录华为云 SWR
# -----------------------------------------------------------------------------
echo "[1/6] 登录华为云 SWR..."
echo "${SWR_PASSWORD}" | docker login -u "${SWR_USERNAME}" --password-stdin "${SWR_REGISTRY}" 2>/dev/null || {
    echo "❌ 登录失败，尝试直接登录..."
    docker login -u "${SWR_USERNAME}" -p "${SWR_PASSWORD}" "${SWR_REGISTRY}"
}
echo "✅ 登录成功"
echo ""

# -----------------------------------------------------------------------------
# 2. 设置构建器 (支持多架构)
# -----------------------------------------------------------------------------
echo "[2/6] 设置多架构构建器..."
if ! docker buildx inspect multiarch > /dev/null 2>&1; then
    docker buildx create --name multiarch --driver docker-container --use
    docker buildx inspect --bootstrap
else
    docker buildx use multiarch
fi
echo "✅ 构建器就绪"
echo ""

# -----------------------------------------------------------------------------
# 3. 构建并推送后端镜像
# -----------------------------------------------------------------------------
echo "[3/6] 构建后端镜像 (平台: ${SWR_PLATFORMS})..."
docker buildx build \
    --platform "${SWR_PLATFORMS}" \
    --file docker/backend/Dockerfile \
    --tag "${BACKEND_IMAGE}" \
    --push \
    --cache-from "type=registry,ref=${SWR_REGISTRY}/${SWR_NAMESPACE}/raos-backend:cache" \
    --cache-to "type=registry,ref=${SWR_REGISTRY}/${SWR_NAMESPACE}/raos-backend:cache,mode=max" \
    .
echo "✅ 后端镜像推送成功"
echo ""

# -----------------------------------------------------------------------------
# 4. 构建并推送前端镜像
# -----------------------------------------------------------------------------
echo "[4/6] 构建前端镜像 (平台: ${SWR_PLATFORMS})..."
docker buildx build \
    --platform "${SWR_PLATFORMS}" \
    --file docker/frontend/Dockerfile \
    --tag "${FRONTEND_IMAGE}" \
    --push \
    --cache-from "type=registry,ref=${SWR_REGISTRY}/${SWR_NAMESPACE}/raos-frontend:cache" \
    --cache-to "type=registry,ref=${SWR_REGISTRY}/${SWR_NAMESPACE}/raos-frontend:cache,mode=max" \
    .
echo "✅ 前端镜像推送成功"
echo ""

# -----------------------------------------------------------------------------
# 5. 验证镜像
# -----------------------------------------------------------------------------
echo "[5/6] 验证镜像..."
docker manifest inspect "${BACKEND_IMAGE}" > /dev/null && echo "✅ 后端镜像可拉取"
docker manifest inspect "${FRONTEND_IMAGE}" > /dev/null && echo "✅ 前端镜像可拉取"
echo ""

# -----------------------------------------------------------------------------
# 6. 生成部署配置
# -----------------------------------------------------------------------------
echo "[6/6] 生成集群部署配置..."

# 更新 docker-compose.yml 镜像标签
sed -i.bak "s|swr.cn-north-4.myhuaweicloud.com/kavin/raos-backend:.*|${BACKEND_IMAGE}|g" docker-compose.swarm.yml 2>/dev/null || true
sed -i.bak "s|swr.cn-north-4.myhuaweicloud.com/kavin/raos-frontend:.*|${FRONTEND_IMAGE}|g" docker-compose.swarm.yml 2>/dev/null || true

echo "✅ 部署配置已更新"
echo ""

# -----------------------------------------------------------------------------
# 完成
# -----------------------------------------------------------------------------
echo "=============================================="
echo "🎉 镜像构建推送完成!"
echo "=============================================="
echo ""
echo "后端镜像: ${BACKEND_IMAGE}"
echo "前端镜像: ${FRONTEND_IMAGE}"
echo ""
echo "部署命令:"
echo "  # Docker Compose (单机)"
echo "  docker-compose up -d"
echo ""
echo "  # Docker Swarm (集群)"
echo "  docker stack deploy -c docker-compose.swarm.yml raos"
echo ""
