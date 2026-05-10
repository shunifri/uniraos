#!/bin/bash
# =============================================================================
# RAOS 一键部署脚本
# 全新环境或重新部署时执行
# 用法: ./deploy/deploy.sh [--build] [--env-file <path>]
# =============================================================================

set -euo pipefail

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 默认配置
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_DIR}/.env"
BUILD_LOCAL=false
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"

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
    --help|-h)
      echo "用法: $0 [--build] [--env-file <path>]"
      echo "  --build        本地构建镜像，而不是拉取远程镜像"
      echo "  --env-file     指定环境变量文件路径（默认: .env）"
      exit 0
      ;;
    *)
      echo "未知参数: $1"
      exit 1
      ;;
  esac
done

function log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
function log_ok()    { echo -e "${GREEN}[OK]${NC}   $1"; }
function log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
function log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# =============================================================================
# 1. 环境检查
# =============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              RAOS 一键 Docker 部署脚本                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

log_info "检查 Docker 环境..."

if ! command -v docker &> /dev/null; then
  log_error "Docker 未安装，请先安装 Docker: https://docs.docker.com/get-docker/"
  exit 1
fi

if ! command -v docker compose &> /dev/null && ! command -v docker-compose &> /dev/null; then
  log_error "Docker Compose 未安装，请先安装"
  exit 1
fi

# 使用 docker compose（新版）或 docker-compose（旧版）
if command -v docker compose &> /dev/null; then
  COMPOSE_CMD="docker compose"
else
  COMPOSE_CMD="docker-compose"
fi

DOCKER_VERSION=$(docker --version | awk '{print $3}' | tr -d ',')
log_ok "Docker 版本: $DOCKER_VERSION"
log_ok "Compose 命令: $COMPOSE_CMD"

# 检查 compose 文件存在
if [[ ! -f "$COMPOSE_FILE" ]]; then
  log_error "未找到 docker-compose.yml: $COMPOSE_FILE"
  exit 1
fi

# =============================================================================
# 2. 环境变量配置
# =============================================================================
echo ""
log_info "检查环境变量配置..."

if [[ ! -f "$ENV_FILE" ]]; then
  log_warn "未找到 .env 文件，将从 .env.example 生成..."
  
  if [[ ! -f "${PROJECT_DIR}/.env.example" ]]; then
    log_error "未找到 .env.example 模板文件"
    exit 1
  fi
  
  # 生成随机密码和 JWT_SECRET
  JWT_SECRET=$(openssl rand -base64 48 2>/dev/null || dd if=/dev/urandom bs=48 count=1 2>/dev/null | base64)
  MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)
  MYSQL_PASSWORD=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)
  REDIS_PASSWORD=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)
  RABBITMQ_PASS=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)
  MINIO_PASSWORD=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)
  NEO4J_PASSWORD=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24)
  
  cp "${PROJECT_DIR}/.env.example" "$ENV_FILE"
  
  # 替换占位符
  sed -i.bak \
    -e "s/JWT_SECRET=__REPLACE_IN_PRODUCTION__/JWT_SECRET=${JWT_SECRET}/" \
    -e "s/MYSQL_ROOT_PASSWORD=.*/MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}/" \
    -e "s/MYSQL_PASSWORD=__REPLACE_IN_PRODUCTION__/MYSQL_PASSWORD=${MYSQL_PASSWORD}/" \
    -e "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=${REDIS_PASSWORD}/" \
    -e "s/RABBITMQ_PASS=.*/RABBITMQ_PASS=${RABBITMQ_PASS}/" \
    -e "s/MINIO_PASSWORD=.*/MINIO_PASSWORD=${MINIO_PASSWORD}/" \
    -e "s/NEO4J_PASSWORD=.*/NEO4J_PASSWORD=${NEO4J_PASSWORD}/" \
    -e "s/NEO4J_AUTH=.*/NEO4J_AUTH=neo4j\/${NEO4J_PASSWORD}/" \
    -e "s/NODE_ENV=development/NODE_ENV=production/" \
    "$ENV_FILE" 2>/dev/null || true
  
  rm -f "${ENV_FILE}.bak"
  
  log_ok ".env 已生成，关键密码已自动设置"
  log_warn "建议查看并修改 .env 中的其他配置（如域名、邮件等）"
else
  log_ok ".env 已存在: $ENV_FILE"
fi

# 加载环境变量
set -a
source "$ENV_FILE"
set +a

# 检查必填变量
for var in JWT_SECRET MYSQL_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    log_error "环境变量 $var 未设置，请检查 $ENV_FILE"
    exit 1
  fi
done

# =============================================================================
# 3. 镜像准备
# =============================================================================
echo ""
if $BUILD_LOCAL; then
  log_info "本地构建镜像..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --no-cache
  log_ok "镜像构建完成"
else
  log_info "拉取远程镜像..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull
  log_ok "镜像拉取完成"
fi

# =============================================================================
# 4. 启动基础设施
# =============================================================================
echo ""
log_info "启动基础设施服务（MySQL、Redis、Qdrant、RabbitMQ、MinIO、Neo4j）..."

$COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d \
  mysql-primary redis qdrant rabbitmq minio neo4j

log_info "等待基础设施就绪（最多 120 秒）..."

TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  # 检查 MySQL
  MYSQL_READY=false
  if docker exec raos-mysql-primary mysqladmin ping -h localhost -u root -p"${MYSQL_ROOT_PASSWORD:-}" --silent 2>/dev/null; then
    MYSQL_READY=true
  fi
  
  # 检查 Redis
  REDIS_READY=false
  if docker exec raos-redis redis-cli ping 2>/dev/null | grep -q PONG; then
    REDIS_READY=true
  fi
  
  # 检查 Qdrant
  QDRANT_READY=false
  if curl -sf http://localhost:6333/healthz > /dev/null 2>&1; then
    QDRANT_READY=true
  fi
  
  # 检查 RabbitMQ
  RABBIT_READY=false
  if docker exec raos-rabbitmq rabbitmq-diagnostics -q ping 2>/dev/null | grep -q ok; then
    RABBIT_READY=true
  fi
  
  if $MYSQL_READY && $REDIS_READY && $QDRANT_READY && $RABBIT_READY; then
    log_ok "所有基础设施服务已就绪"
    break
  fi
  
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo -n "."
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  log_error "基础设施服务启动超时，请检查日志:"
  echo "  MySQL:    docker logs raos-mysql-primary"
  echo "  Redis:    docker logs raos-redis"
  echo "  Qdrant:   docker logs raos-qdrant"
  echo "  RabbitMQ: docker logs raos-rabbitmq"
  exit 1
fi

# =============================================================================
# 5. 数据库迁移
# =============================================================================
echo ""
log_info "运行数据库迁移..."

# 使用临时容器运行迁移
$COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm \
  --entrypoint sh raos-backend -c "npm run db:migrate"

log_ok "数据库迁移完成"

# =============================================================================
# 6. 启动应用服务
# =============================================================================
echo ""
log_info "启动应用服务（后端、Worker、前端）..."

$COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d \
  raos-backend raos-workers raos-frontend

log_ok "应用服务已启动"

# =============================================================================
# 7. 健康检查
# =============================================================================
echo ""
log_info "执行健康检查（最多 60 秒）..."

TIMEOUT=60
ELAPSED=0
BACKEND_HEALTHY=false
FRONTEND_HEALTHY=false

while [ $ELAPSED -lt $TIMEOUT ]; do
  # 后端健康检查
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    BACKEND_HEALTHY=true
  fi
  
  # 前端健康检查
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

if $BACKEND_HEALTHY; then
  log_ok "后端服务健康: http://localhost:3000/health"
else
  log_warn "后端服务健康检查未通过，请查看日志: docker logs raos-backend"
fi

if $FRONTEND_HEALTHY; then
  log_ok "前端服务健康: http://localhost"
else
  log_warn "前端服务健康检查未通过，请查看日志: docker logs raos-frontend"
fi

# =============================================================================
# 8. 部署完成
# =============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   🎉 部署完成！                               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  🌐 前端访问:     http://localhost"
echo "  🔌 API 访问:     http://localhost:3000"
echo "  📊 健康检查:     http://localhost:3000/health"
echo "  📈 指标监控:     http://localhost:3000/metrics"
echo ""
echo "  🗄️  数据库:"
echo "     MySQL:       localhost:3306 (user: ${MYSQL_USER:-raos})"
echo "     Redis:       localhost:6379"
echo "     Qdrant:      localhost:6333"
echo "     RabbitMQ:    localhost:15672 (mgmt)"
echo "     Neo4j:       localhost:7474 (browser)"
echo ""
echo "  📁 数据卷位置:   docker volume ls | grep raos"
echo "  📋 查看日志:     docker logs -f raos-backend"
echo "  🛑 停止服务:     ${COMPOSE_CMD} -f ${COMPOSE_FILE} down"
echo ""
echo "  ⚠️  默认账号:    admin / admin (请尽快修改密码)"
echo ""
log_info "如需监控面板，请附加 --profile monitoring 启动:"
echo "  ${COMPOSE_CMD} -f ${COMPOSE_FILE} --profile monitoring up -d"
echo ""
