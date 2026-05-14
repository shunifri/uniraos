#!/bin/bash

# =============================================================================
# RAOS 华为云 SWR 镜像构建推送脚本
# 组织名称: kavin
# 特性: 后端使用 bytenode 字节码编译保护源码
# 使用方法: sudo ./scripts/build-and-push-huawei.sh [版本号]
# =============================================================================

set -e

# 检查是否使用 sudo
if [ "$EUID" -ne 0 ]; then 
    echo "请使用 sudo 运行此脚本"
    echo "示例: sudo ./scripts/build-and-push-huawei.sh v1.0.0"
    exit 1
fi

# 华为云 SWR 配置
# ⚠️ WARNING: SWR_USERNAME and SWR_PASSWORD must be set via environment variables or CI secrets.
# Do NOT hardcode credentials in this file.
SWR_REGISTRY="swr.cn-north-4.myhuaweicloud.com"
SWR_ORG="kavin"
SWR_USERNAME="${SWR_USERNAME:?SWR_USERNAME is required}"
SWR_PASSWORD="${SWR_PASSWORD:?SWR_PASSWORD is required}"

# 版本号
VERSION=${1:-latest}
BACKEND_IMAGE_LOCAL="raos-backend:${VERSION}"
FRONTEND_IMAGE_LOCAL="raos-frontend:${VERSION}"
BACKEND_IMAGE_SWR="${SWR_REGISTRY}/${SWR_ORG}/raos-backend:${VERSION}"
FRONTEND_IMAGE_SWR="${SWR_REGISTRY}/${SWR_ORG}/raos-frontend:${VERSION}"

echo "=============================================="
echo "RAOS 华为云 SWR 镜像构建推送"
echo "=============================================="
echo "组织: ${SWR_ORG}"
echo "版本: ${VERSION}"
echo "后端镜像: ${BACKEND_IMAGE_SWR}"
echo "前端镜像: ${FRONTEND_IMAGE_SWR}"
echo ""

# -----------------------------------------------------------------------------
# 1. 登录华为云 SWR
# -----------------------------------------------------------------------------
echo "[1/5] 登录华为云 SWR..."
echo "${SWR_PASSWORD}" | docker login -u "${SWR_USERNAME}" --password-stdin "${SWR_REGISTRY}" 2>/dev/null || {
    echo "尝试标准登录方式..."
    docker login -u "${SWR_USERNAME}" -p "${SWR_PASSWORD}" "${SWR_REGISTRY}"
}
echo "✅ 登录成功"
echo ""

# -----------------------------------------------------------------------------
# 2. 构建后端镜像
# -----------------------------------------------------------------------------
echo "[2/5] 构建后端镜像..."
docker build \
    --file docker/backend/Dockerfile \
    --tag "${BACKEND_IMAGE_LOCAL}" \
    .
echo "✅ 后端镜像构建成功"
echo ""

# -----------------------------------------------------------------------------
# 3. 构建前端镜像
# -----------------------------------------------------------------------------
echo "[3/5] 构建前端镜像..."
docker build \
    --file docker/frontend/Dockerfile \
    --tag "${FRONTEND_IMAGE_LOCAL}" \
    .
echo "✅ 前端镜像构建成功"
echo ""

# -----------------------------------------------------------------------------
# 4. 标记并推送镜像到华为云 SWR
# -----------------------------------------------------------------------------
echo "[4/4] 验证镜像..."

# 后端镜像
echo "标记后端镜像..."
docker tag "${BACKEND_IMAGE_LOCAL}" "${BACKEND_IMAGE_SWR}"
echo "推送后端镜像..."
docker push "${BACKEND_IMAGE_SWR}"

# 前端镜像
echo "标记前端镜像..."
docker tag "${FRONTEND_IMAGE_LOCAL}" "${FRONTEND_IMAGE_SWR}"
echo "推送前端镜像..."
docker push "${FRONTEND_IMAGE_SWR}"

echo "✅ 镜像推送成功"
echo ""

# -----------------------------------------------------------------------------
# 5. 验证并更新部署配置
# -----------------------------------------------------------------------------
echo "[5/5] 验证镜像并更新配置..."

# 验证镜像存在
docker pull "${BACKEND_IMAGE_SWR}" > /dev/null 2>&1 && echo "✅ 后端镜像可拉取"
docker pull "${FRONTEND_IMAGE_SWR}" > /dev/null 2>&1 && echo "✅ 前端镜像可拉取"

# 更新 Swarm 部署配置
if [ -f "docker-compose.swarm.yml" ]; then
    sed -i.bak "s|image:.*raos-backend:.*|image: ${BACKEND_IMAGE_SWR}|g" docker-compose.swarm.yml
    sed -i.bak "s|image:.*raos-frontend:.*|image: ${FRONTEND_IMAGE_SWR}|g" docker-compose.swarm.yml
    rm -f docker-compose.swarm.yml.bak
    echo "✅ Swarm 部署配置已更新"
fi

# 更新标准 docker-compose 配置
if [ -f "docker-compose.yml" ]; then
    sed -i.bak "s|image:.*raos-backend:.*|image: ${BACKEND_IMAGE_SWR}|g" docker-compose.yml
    sed -i.bak "s|image:.*raos-frontend:.*|image: ${FRONTEND_IMAGE_SWR}|g" docker-compose.yml
    rm -f docker-compose.yml.bak
    echo "✅ Compose 配置已更新"
fi

echo ""

# -----------------------------------------------------------------------------
# 完成
# -----------------------------------------------------------------------------
echo "=============================================="
echo "🎉 镜像构建推送完成!"
echo "=============================================="
echo ""
echo "后端镜像: ${BACKEND_IMAGE_SWR}"
echo "前端镜像: ${FRONTEND_IMAGE_SWR}"
echo ""
echo "部署命令:"
echo ""
echo "  # 方法 1: Docker Compose (单机)"
echo "  sudo docker-compose up -d"
echo ""
echo "  # 方法 2: Docker Swarm (集群)"
echo "  sudo docker stack deploy -c docker-compose.swarm.yml raos"
echo ""
echo "  # 方法 3: 手动拉取运行"
echo "  sudo docker pull ${BACKEND_IMAGE_SWR}"
echo "  sudo docker pull ${FRONTEND_IMAGE_SWR}"
echo ""
