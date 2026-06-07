#!/bin/bash

# =============================================================================
# Qdrant 镜像推送到华为云 SWR
# 从 Docker Hub 拉取并推送到华为云，避免网络问题
# =============================================================================

set -euo pipefail

SWR_REGISTRY="swr.cn-north-4.myhuaweicloud.com"
SWR_ORG="kavin"
QDRANT_VERSION="v1.9.0"

echo "========================================"
echo "Qdrant 镜像推送脚本"
echo "========================================"

# 登录华为云
echo "[1/4] 登录华为云 SWR..."
docker login -u cn-north-4@HPUATFLDVQ30DWEOVMBZ -p c047c1f5ca9490b8fa37d139a10a81f94edd2c148067fd11b912118dbcf9afa3 ${SWR_REGISTRY}

# 拉取官方镜像
echo "[2/4] 从 Docker Hub 拉取 Qdrant ${QDRANT_VERSION}..."
docker pull qdrant/qdrant:${QDRANT_VERSION}

# 打标签
echo "[3/4] 打标签..."
docker tag qdrant/qdrant:${QDRANT_VERSION} ${SWR_REGISTRY}/${SWR_ORG}/qdrant:${QDRANT_VERSION}
docker tag qdrant/qdrant:${QDRANT_VERSION} ${SWR_REGISTRY}/${SWR_ORG}/qdrant:latest

# 推送到华为云
echo "[4/4] 推送到华为云 SWR..."
docker push ${SWR_REGISTRY}/${SWR_ORG}/qdrant:${QDRANT_VERSION}
docker push ${SWR_REGISTRY}/${SWR_ORG}/qdrant:latest

echo ""
echo "========================================"
echo "推送完成！"
echo "镜像地址: ${SWR_REGISTRY}/${SWR_ORG}/qdrant:${QDRANT_VERSION}"
echo "========================================"
