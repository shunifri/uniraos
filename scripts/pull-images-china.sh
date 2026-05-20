#!/bin/bash
# =============================================================================
# 国内环境 Docker 镜像预拉取脚本
# 用于解决 Docker Hub 无法访问的问题
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

function log_ok()    { echo -e "${GREEN}[OK]${NC}   $1"; }
function log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
function log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 定义需要拉取的镜像（目标镜像名 -> 可选的国内镜像源）
declare -A IMAGES=(
  ["mysql:8.0"]=""
  ["redis:7-alpine"]=""
  ["qdrant/qdrant:v1.9.0"]=""
  ["rabbitmq:3.12-management-alpine"]=""
  ["minio/minio:RELEASE.2024-03-03T17-50-39Z"]=""
  ["neo4j:5.15.0-community"]=""
  ["prom/prometheus:v2.51.0"]=""
  ["grafana/grafana:10.4.1"]=""
)

# 国内镜像源候选列表（按优先级）
MIRRORS=(
  "docker.mirrors.ustc.edu.cn"
  "hub-mirror.c.163.com"
  "mirror.baidubce.com"
  "docker.m.daocloud.io"
)

function try_pull() {
  local image="$1"
  local mirror="$2"
  local source_image=""
  
  # 处理 library 官方镜像
  if [[ "$image" != */* ]]; then
    source_image="${mirror}/library/${image}"
  else
    source_image="${mirror}/${image}"
  fi
  
  echo "  尝试从 ${mirror} 拉取..."
  if docker pull "$source_image" >/dev/null 2>&1; then
    docker tag "$source_image" "$image"
    docker rmi "$source_image" >/dev/null 2>&1 || true
    return 0
  fi
  return 1
}

function pull_image() {
  local image="$1"
  echo ""
  echo "▶ 拉取 ${image}"
  
  # 先检查本地是否已有
  if docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^${image}$"; then
    log_ok "本地已存在 ${image}，跳过"
    return 0
  fi
  
  # 尝试直接从 Docker Hub 拉取（可能加速器能透传）
  if docker pull "$image" >/dev/null 2>&1; then
    log_ok "直接拉取成功: ${image}"
    return 0
  fi
  
  # 尝试各个国内镜像源
  for mirror in "${MIRRORS[@]}"; do
    if try_pull "$image" "$mirror"; then
      log_ok "镜像源拉取成功: ${image}"
      return 0
    fi
  done
  
  log_error "所有镜像源均失败: ${image}"
  return 1
}

# 主流程
echo "=========================================="
echo "  RAOS 基础镜像预拉取（国内环境）"
echo "=========================================="
echo ""

failed=0
for image in "${!IMAGES[@]}"; do
  if ! pull_image "$image"; then
    ((failed++)) || true
  fi
done

echo ""
echo "=========================================="
if [ "$failed" -eq 0 ]; then
  log_ok "所有镜像拉取完成"
  echo "可以重新运行 ./deploy/deploy.sh 继续部署"
else
  log_warn "有 ${failed} 个镜像拉取失败"
  echo "建议："
  echo "  1. 配置阿里云个人镜像加速器（最稳定）"
  echo "     访问 https://cr.console.aliyun.com/cn-hangzhou/instances/mirrors"
  echo "  2. 在有外网的环境 docker save 导出后 docker load 导入"
  echo "  3. 联系运维开放 registry-1.docker.io 访问"
fi
