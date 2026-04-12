#!/bin/bash

# =============================================================================
# 将所有基础镜像推送到华为云 SWR
# 避免 Docker Hub 网络问题
# =============================================================================

set -e

SWR_REGISTRY="swr.cn-north-4.myhuaweicloud.com"
SWR_ORG="kavin"

echo "========================================"
echo "基础镜像推送到华为云 SWR"
echo "========================================"

# 登录华为云
echo ""
echo "[0/4] 登录华为云 SWR..."
docker login -u cn-north-4@HPUATFLDVQ30DWEOVMBZ -p c047c1f5ca9490b8fa37d139a10a81f94edd2c148067fd11b912118dbcf9afa3 ${SWR_REGISTRY}

# MySQL
echo ""
echo "[1/4] 推送 MySQL 8.0..."
docker pull mysql:8.0
docker tag mysql:8.0 ${SWR_REGISTRY}/${SWR_ORG}/mysql:8.0
docker push ${SWR_REGISTRY}/${SWR_ORG}/mysql:8.0
echo "✓ MySQL 推送完成"

# Redis
echo ""
echo "[2/4] 推送 Redis 7-alpine..."
docker pull redis:7-alpine
docker tag redis:7-alpine ${SWR_REGISTRY}/${SWR_ORG}/redis:7-alpine
docker push ${SWR_REGISTRY}/${SWR_ORG}/redis:7-alpine
echo "✓ Redis 推送完成"

# RabbitMQ
echo ""
echo "[3/4] 推送 RabbitMQ 3.12-management-alpine..."
docker pull rabbitmq:3.12-management-alpine
docker tag rabbitmq:3.12-management-alpine ${SWR_REGISTRY}/${SWR_ORG}/rabbitmq:3.12-management-alpine
docker push ${SWR_REGISTRY}/${SWR_ORG}/rabbitmq:3.12-management-alpine
echo "✓ RabbitMQ 推送完成"

# Qdrant
echo ""
echo "[4/4] 推送 Qdrant v1.9.0..."
docker pull qdrant/qdrant:v1.9.0
docker tag qdrant/qdrant:v1.9.0 ${SWR_REGISTRY}/${SWR_ORG}/qdrant:v1.9.0
docker push ${SWR_REGISTRY}/${SWR_ORG}/qdrant:v1.9.0
echo "✓ Qdrant 推送完成"

echo ""
echo "========================================"
echo "所有基础镜像推送完成！"
echo "========================================"
echo ""
echo "镜像列表:"
echo "  - ${SWR_REGISTRY}/${SWR_ORG}/mysql:8.0"
echo "  - ${SWR_REGISTRY}/${SWR_ORG}/redis:7-alpine"
echo "  - ${SWR_REGISTRY}/${SWR_ORG}/rabbitmq:3.12-management-alpine"
echo "  - ${SWR_REGISTRY}/${SWR_ORG}/qdrant:v1.9.0"
echo ""
