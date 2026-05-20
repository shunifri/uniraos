#!/bin/bash
# =============================================================================
# RAOS 非交互式部署脚本（供 CI/CD 使用）
# 由 deploy.sh --non-interactive 调用
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_DIR}/.env"
BUILD_LOCAL=false
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"

function log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
function log_ok()    { echo -e "${GREEN}[OK]${NC}   $1"; }
function log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
function log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --build)
      BUILD_LOCAL=true
      shift
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    *)
      echo "未知参数: $1"
      exit 1
      ;;
  esac
done

# Docker 环境
if ! command -v docker &>/dev/null; then
  log_error "Docker 未安装"
  exit 1
fi

if command -v docker compose &>/dev/null; then
  COMPOSE_CMD="docker compose"
else
  COMPOSE_CMD="docker-compose"
fi

# 检查 compose 文件
if [[ ! -f "$COMPOSE_FILE" ]]; then
  log_error "未找到 docker-compose.yml"
  exit 1
fi

# 环境变量配置
echo ""
log_info "检查环境变量配置..."

if [[ ! -f "$ENV_FILE" ]]; then
  log_warn "未找到 .env 文件，将从 .env.example 生成..."

  if [[ ! -f "${PROJECT_DIR}/.env.example" ]]; then
    log_error "未找到 .env.example 模板文件"
    exit 1
  fi

  JWT_SECRET=$(openssl rand -base64 48 2>/dev/null || dd if=/dev/urandom bs=48 count=1 2>/dev/null | base64)
  MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)
  MYSQL_PASSWORD=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)
  REDIS_PASSWORD=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)
  RABBITMQ_PASS=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)
  MINIO_PASSWORD=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)
  NEO4J_PASSWORD=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)

  cp "${PROJECT_DIR}/.env.example" "$ENV_FILE"

  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' \
      -e "s/JWT_SECRET=__REPLACE_IN_PRODUCTION__/JWT_SECRET=${JWT_SECRET}/" \
      -e "s/MYSQL_ROOT_PASSWORD=.*/MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}/" \
      -e "s/MYSQL_PASSWORD=__REPLACE_IN_PRODUCTION__/MYSQL_PASSWORD=${MYSQL_PASSWORD}/" \
      -e "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=${REDIS_PASSWORD}/" \
      -e "s/RABBITMQ_PASS=.*/RABBITMQ_PASS=${RABBITMQ_PASS}/" \
      -e "s/MINIO_PASSWORD=.*/MINIO_PASSWORD=${MINIO_PASSWORD}/" \
      -e "s/NEO4J_PASSWORD=.*/NEO4J_PASSWORD=${NEO4J_PASSWORD}/" \
      -e "s/NEO4J_AUTH=.*/NEO4J_AUTH=neo4j\/${NEO4J_PASSWORD}/" \
      -e "s/NODE_ENV=development/NODE_ENV=production/" \
      "$ENV_FILE"
  else
    sed -i \
      -e "s/JWT_SECRET=__REPLACE_IN_PRODUCTION__/JWT_SECRET=${JWT_SECRET}/" \
      -e "s/MYSQL_ROOT_PASSWORD=.*/MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}/" \
      -e "s/MYSQL_PASSWORD=__REPLACE_IN_PRODUCTION__/MYSQL_PASSWORD=${MYSQL_PASSWORD}/" \
      -e "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=${REDIS_PASSWORD}/" \
      -e "s/RABBITMQ_PASS=.*/RABBITMQ_PASS=${RABBITMQ_PASS}/" \
      -e "s/MINIO_PASSWORD=.*/MINIO_PASSWORD=${MINIO_PASSWORD}/" \
      -e "s/NEO4J_PASSWORD=.*/NEO4J_PASSWORD=${NEO4J_PASSWORD}/" \
      -e "s/NEO4J_AUTH=.*/NEO4J_AUTH=neo4j\/${NEO4J_PASSWORD}/" \
      -e "s/NODE_ENV=development/NODE_ENV=production/" \
      "$ENV_FILE"
  fi

  log_ok ".env 已生成"
else
  log_ok ".env 已存在"
fi

# 加载并检查
set -a
source "$ENV_FILE"
set +a

for var in JWT_SECRET MYSQL_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    log_error "环境变量 $var 未设置"
    exit 1
  fi
done

# 镜像准备
echo ""
if $BUILD_LOCAL; then
  log_info "本地构建镜像..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --no-cache
  log_ok "构建完成"
else
  log_info "拉取远程镜像..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull
  log_ok "拉取完成"
fi

# 启动基础设施
echo ""
log_info "启动基础设施..."
$COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d \
  mysql-primary redis qdrant rabbitmq minio neo4j

# 等待就绪
log_info "等待基础设施就绪..."
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  MYSQL_READY=false
  if docker exec raos-mysql-primary mysqladmin ping -h localhost -u root -p"${MYSQL_ROOT_PASSWORD:-}" --silent 2>/dev/null; then
    MYSQL_READY=true
  fi

  REDIS_READY=false
  if docker exec raos-redis redis-cli ping 2>/dev/null | grep -q PONG; then
    REDIS_READY=true
  fi

  QDRANT_READY=false
  if curl -sf http://localhost:6333/healthz > /dev/null 2>&1; then
    QDRANT_READY=true
  fi

  RABBIT_READY=false
  if docker exec raos-rabbitmq rabbitmq-diagnostics -q ping 2>/dev/null | grep -q ok; then
    RABBIT_READY=true
  fi

  if $MYSQL_READY && $REDIS_READY && $QDRANT_READY && $RABBIT_READY; then
    log_ok "基础设施已就绪"
    break
  fi

  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo -n "."
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo ""
  log_error "基础设施启动超时"
  exit 1
fi

# 数据库迁移
echo ""
log_info "运行数据库迁移..."
$COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm \
  --entrypoint sh raos-backend -c "npm run db:migrate"
log_ok "迁移完成"

# 启动应用
echo ""
log_info "启动应用服务..."
$COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d \
  raos-backend raos-workers raos-frontend
log_ok "应用已启动"

# 健康检查
echo ""
log_info "健康检查..."
TIMEOUT=60
ELAPSED=0
BACKEND_HEALTHY=false
FRONTEND_HEALTHY=false

while [ $ELAPSED -lt $TIMEOUT ]; do
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    BACKEND_HEALTHY=true
  fi
  if curl -sf http://localhost/health > /dev/null 2>&1 || curl -sf -o /dev/null -w "%{http_code}" http://localhost | grep -qE "200|301"; then
    FRONTEND_HEALTHY=true
  fi
  if $BACKEND_HEALTHY && $FRONTEND_HEALTHY; then
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo -n "."
done

echo ""
echo ""
if $BACKEND_HEALTHY; then
  log_ok "后端健康: http://localhost:3000/health"
else
  log_warn "后端健康检查未通过"
fi

if $FRONTEND_HEALTHY; then
  log_ok "前端健康: http://localhost"
else
  log_warn "前端健康检查未通过"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   🎉 部署完成！                               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  前端:     http://localhost"
echo "  API:      http://localhost:3000"
echo "  默认账号: admin / admin"
echo ""
