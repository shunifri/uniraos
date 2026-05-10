#!/bin/bash

# =============================================================================
# RAOS 华为云 SWR 镜像构建推送脚本
# 支持多架构构建 (amd64/arm64) 和集群部署
# =============================================================================

set -e

# 华为云 SWR 配置（从环境变量读取，禁止硬编码）
SWR_REGISTRY="${SWR_REGISTRY:-swr.cn-north-4.myhuaweicloud.com}"
SWR_NAMESPACE="${SWR_NAMESPACE:-raos}"
SWR_USERNAME="${SWR_USERNAME:?错误：SWR_USERNAME 环境变量未设置}"
SWR_PASSWORD="${SWR_PASSWORD:?错误：SWR_PASSWORD 环境变量未设置}"

# 镜像标签
VERSION=${1:-latest}
BACKEND_IMAGE="${SWR_REGISTRY}/${SWR_NAMESPACE}/raos-backend:${VERSION}"
FRONTEND_IMAGE="${SWR_REGISTRY}/${SWR_NAMESPACE}/raos-raos-frontend:${VERSION}"

echo "=============================================="
echo "RAOS 华为云 SWR 镜像构建推送"
echo "=============================================="
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
echo "[3/6] 构建后端镜像..."
docker buildx build \
    --platform linux/amd64,linux/arm64 \
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
echo "[4/6] 构建前端镜像..."
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --file docker/frontend/Dockerfile \
    --tag "${FRONTEND_IMAGE}" \
    --push \
    --cache-from "type=registry,ref=${SWR_REGISTRY}/${SWR_NAMESPACE}/raos-raos-frontend:cache" \
    --cache-to "type=registry,ref=${SWR_REGISTRY}/${SWR_NAMESPACE}/raos-raos-frontend:cache,mode=max" \
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
sed -i.bak "s|swr.cn-north-4.myhuaweicloud.com/raos/raos-backend:.*|${BACKEND_IMAGE}|g" docker-compose.swarm.yml 2>/dev/null || true
sed -i.bak "s|swr.cn-north-4.myhuaweicloud.com/raos/raos-raos-frontend:.*|${FRONTEND_IMAGE}|g" docker-compose.swarm.yml 2>/dev/null || true

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
