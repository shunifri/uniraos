#!/bin/bash

# =============================================================================
# 基础镜像推送脚本 - 推送到华为云 SWR
# 使用方法: sudo ./scripts/push-base-images.sh [版本号]
# =============================================================================

set -e

SWR_REGISTRY="swr.cn-north-4.myhuaweicloud.com"
SWR_ORG="kavin"
VERSION=${1:-latest}

echo "=============================================="
echo "基础镜像推送到华为云 SWR"
echo "=============================================="
echo "组织: ${SWR_ORG}"
echo "版本: ${VERSION}"
echo ""

# 登录华为云 SWR
echo "[1/2] 登录华为云 SWR..."
docker login -u cn-north-4@HPUATFLDVQ30DWEOVMBZ -p c047c1f5ca9490b8fa37d139a10a81f94edd2c148067fd11b912118dbcf9afa3 ${SWR_REGISTRY} 2>/dev/null || {
    echo "❌ 登录失败"
    exit 1
}
echo "✅ 登录成功"
echo ""

# 定义基础镜像列表
BASE_IMAGES=(
    "mysql:8.0"
    "redis:7-alpine"
    "rabbitmq:3.12-management-alpine"
    "qdrant/qdrant:v1.9.0"
    "nginx:1.25-alpine"
)

echo "[2/2] 推送基础镜像..."
for image in "${BASE_IMAGES[@]}"; do
    # 提取镜像名称
    image_name=$(echo $image | cut -d':' -f1 | tr '/' '-')
    target_image="${SWR_REGISTRY}/${SWR_ORG}/${image_name}:${VERSION}"
    
    echo ""
    echo "处理: ${image}"
    
    # 检查本地是否存在
    if docker images | grep -q "^${image_name}\s*${VERSION}"; then
        echo "  镜像已在本地"
    else
        echo "  拉取镜像..."
        docker pull ${image} || {
            echo "  ⚠️ 拉取失败，跳过"
            continue
        }
    fi
    
    # 标记镜像
    echo "  标记镜像: ${target_image}"
    docker tag ${image} ${target_image}
    
    # 推送镜像
    echo "  推送镜像..."
    docker push ${target_image} || {
        echo "  ⚠️ 推送失败"
        continue
    }
    
    echo "  ✅ 完成: ${target_image}"
done

echo ""
echo "=============================================="
echo "✅ 基础镜像推送完成"
echo "=============================================="
echo ""
echo "镜像列表:"
for image in "${BASE_IMAGES[@]}"; do
    image_name=$(echo $image | cut -d':' -f1 | tr '/' '-')
    echo "  - ${SWR_REGISTRY}/${SWR_ORG}/${image_name}:${VERSION}"
done
echo ""
