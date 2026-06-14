#!/bin/bash
# Docker 镜像拉取诊断脚本

set -uo pipefail

echo "========================================"
echo "  Docker 镜像拉取诊断"
echo "========================================"
echo ""

# 1. 检查 Docker 版本和镜像加速器配置
echo "【1】Docker 信息"
docker info 2>/dev/null | grep -E "Server Version|Registry Mirrors" || true
echo ""

# 2. 测试网络连通性
echo "【2】网络连通性测试"
echo -n "ping baidu.com: "
ping -c 1 -W 3 baidu.com >/dev/null 2>&1 && echo "通" || echo "不通"

echo -n "ping registry-1.docker.io: "
ping -c 1 -W 3 registry-1.docker.io >/dev/null 2>&1 && echo "通" || echo "不通"

echo -n "ping docker.m.daocloud.io: "
ping -c 1 -W 3 docker.m.daocloud.io >/dev/null 2>&1 && echo "通" || echo "不通"

echo ""

# 3. 测试各镜像源拉取 mysql:8.0
echo "【3】拉取测试 (mysql:8.0)"

# 直接拉取（走加速器）
echo -n "  docker pull mysql:8.0 (加速器): "
if docker pull mysql:8.0 >/dev/null 2>&1; then
  echo "成功"
  docker rmi mysql:8.0 >/dev/null 2>&1 || true
else
  echo "失败"
fi

# DaoCloud 直接前缀
echo -n "  docker pull docker.m.daocloud.io/library/mysql:8.0: "
if docker pull docker.m.daocloud.io/library/mysql:8.0 >/dev/null 2>&1; then
  echo "成功"
  docker rmi docker.m.daocloud.io/library/mysql:8.0 >/dev/null 2>&1 || true
else
  echo "失败"
fi

# 华为云代理
echo -n "  docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/mysql:8.0: "
if docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/mysql:8.0 >/dev/null 2>&1; then
  echo "成功"
  docker rmi swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/mysql:8.0 >/dev/null 2>&1 || true
else
  echo "失败"
fi

echo ""

# 4. 测试第三方镜像
echo "【4】第三方镜像拉取测试"

echo -n "  docker pull qdrant/qdrant:v1.9.0: "
if docker pull qdrant/qdrant:v1.9.0 >/dev/null 2>&1; then
  echo "成功"
else
  echo "失败"
fi

echo -n "  docker pull minio/minio:RELEASE.2024-03-03T17-50-39Z: "
if docker pull minio/minio:RELEASE.2024-03-03T17-50-39Z >/dev/null 2>&1; then
  echo "成功"
else
  echo "失败"
fi

echo ""
echo "诊断完成。如果全部失败，说明服务器完全无法访问 Docker Hub 及镜像代理。"
echo "如果 DaoCloud 或华为云成功，可以使用 docker-compose.override.yml 覆盖镜像地址。"
