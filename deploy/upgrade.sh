#!/bin/bash
# =============================================================================
# RAOS 一键升级脚本
# 零停机升级，自动备份，失败可回滚
# 用法: ./deploy/upgrade.sh [--version <tag>] [--build] [--skip-backup]
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
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
BACKUP_DIR="${PROJECT_DIR}/backups"

# 升级参数
VERSION=""
BUILD_LOCAL=false
SKIP_BACKUP=false
ROLLBACK_ON_FAILURE=true

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --version|-v)
      VERSION="$2"
      shift 2
      ;;
    --build)
      BUILD_LOCAL=true
      shift
      ;;
    --skip-backup)
      SKIP_BACKUP=true
      shift
      ;;
    --no-rollback)
      ROLLBACK_ON_FAILURE=false
      shift
      ;;
    --help|-h)
      echo "用法: $0 [选项]"
      echo ""
      echo "选项:"
      echo "  --version <tag>    指定升级到的镜像版本标签"
      echo "  --build            本地重新构建镜像"
      echo "  --skip-backup      跳过升级前自动备份（不推荐）"
      echo "  --no-rollback      升级失败时不自动回滚"
      echo ""
      echo "示例:"
      echo "  $0 --version v1.2.0          # 升级到 v1.2.0"
      echo "  $0 --build                   # 本地构建最新代码"
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

# 使用 docker compose（新版）或 docker-compose（旧版）
if command -v docker compose &> /dev/null; then
  COMPOSE_CMD="docker compose"
else
  COMPOSE_CMD="docker-compose"
fi

# =============================================================================
# 加载环境变量
# =============================================================================
if [[ ! -f "$ENV_FILE" ]]; then
  log_error "未找到 .env 文件，请先运行 deploy.sh 进行初始部署"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

# =============================================================================
# 0. 升级前检查
# =============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              RAOS 一键升级脚本                                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

log_info "检查当前部署状态..."

# 检查服务是否运行
if ! $COMPOSE_CMD -f "$COMPOSE_FILE" ps | grep -q "raos-backend"; then
  log_error "RAOS 服务未运行，请先执行 deploy.sh 部署"
  exit 1
fi

# 获取当前版本
current_backend_image=$($COMPOSE_CMD -f "$COMPOSE_FILE" ps --format json raos-backend 2>/dev/null | grep -o '"Image":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
log_info "当前后端镜像: ${current_backend_image}"

if [[ -n "$VERSION" ]]; then
  log_info "目标版本: $VERSION"
fi

# =============================================================================
# 1. 自动备份（升级前）
# =============================================================================
echo ""
if $SKIP_BACKUP; then
  log_warn "已跳过自动备份"
else
  log_info "执行升级前自动备份..."
  "$SCRIPT_DIR/backup.sh"
  log_ok "备份完成"
fi

# 记录备份时间戳用于回滚
BACKUP_TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# =============================================================================
# 2. 准备新镜像
# =============================================================================
echo ""
if $BUILD_LOCAL; then
  log_info "本地构建新镜像..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build
  log_ok "镜像构建完成"
elif [[ -n "$VERSION" ]]; then
  log_info "切换镜像版本到 $VERSION..."
  
  # 更新 .env 中的 IMAGE_TAG
  if grep -q "^IMAGE_TAG=" "$ENV_FILE"; then
    sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=${VERSION}/" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    echo "IMAGE_TAG=${VERSION}" >> "$ENV_FILE"
  fi
  
  log_info "拉取新镜像..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull
  log_ok "镜像拉取完成"
else
  log_info "拉取最新镜像..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull
  log_ok "镜像拉取完成"
fi

# =============================================================================
# 3. 数据库迁移（在旧服务运行时执行）
# =============================================================================
echo ""
log_info "运行数据库迁移..."

# 使用临时容器运行迁移，不影响运行中的服务
if ! $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm \
  --entrypoint sh raos-backend -c "npm run db:migrate"; then
  log_error "数据库迁移失败"
  
  if $ROLLBACK_ON_FAILURE; then
    log_warn "开始回滚..."
    if [[ -n "$VERSION" ]]; then
      # 恢复原来的 IMAGE_TAG
      sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=${current_backend_image##*:}/" "$ENV_FILE"
      rm -f "${ENV_FILE}.bak"
    fi
    log_info "请检查数据库状态后重试，或从备份恢复: $BACKUP_DIR/${BACKUP_TIMESTAMP}"
  fi
  
  exit 1
fi

log_ok "数据库迁移成功"

# =============================================================================
# 4. 滚动重启服务
# =============================================================================
echo ""
log_info "重启应用服务（Docker Compose 将按依赖顺序滚动更新）..."

# 先停 worker，避免升级期间处理任务导致不一致
$COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop raos-workers || true

# 重启后端（会自动拉取新镜像）
$COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps raos-backend

# 等待后端就绪
log_info "等待后端就绪..."
TIMEOUT=60
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    log_ok "后端已就绪"
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  echo -n "."
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  log_error "后端健康检查超时"
  
  if $ROLLBACK_ON_FAILURE; then
    log_warn "开始回滚到上一版本..."
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down
    if [[ -n "$VERSION" ]]; then
      sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=${current_backend_image##*:}/" "$ENV_FILE"
      rm -f "${ENV_FILE}.bak"
    fi
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
    log_info "回滚完成，服务已恢复到升级前状态"
    log_info "如需恢复数据，请从备份还原: $BACKUP_DIR/${BACKUP_TIMESTAMP}"
  fi
  
  exit 1
fi

# 重启 Worker 和前端
$COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps raos-workers raos-frontend

log_ok "所有服务已重启"

# =============================================================================
# 5. 升级后验证
# =============================================================================
echo ""
log_info "执行升级后验证..."

# 等待前端就绪
sleep 5

FRONTEND_OK=false
if curl -sf -o /dev/null -w "%{http_code}" http://localhost | grep -qE "200|301"; then
  FRONTEND_OK=true
fi

# 检查 API 关键端点
API_OK=false
if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
  API_OK=true
fi

READY_OK=false
if curl -sf http://localhost:3000/ready > /dev/null 2>&1; then
  READY_OK=true
fi

echo ""
if $API_OK; then
  log_ok "✅ API 健康检查通过 (/health)"
else
  log_error "❌ API 健康检查失败"
fi

if $READY_OK; then
  log_ok "✅ 就绪检查通过 (/ready)"
else
  log_warn "⚠️  就绪检查未完全通过（部分依赖可能仍在初始化）"
fi

if $FRONTEND_OK; then
  log_ok "✅ 前端服务正常"
else
  log_warn "⚠️  前端服务响应异常"
fi

# =============================================================================
# 6. 清理旧镜像
# =============================================================================
echo ""
log_info "清理旧版本镜像..."
docker image prune -f --filter "label=com.docker.compose.project=$(basename "$PROJECT_DIR")" 2>/dev/null || true

# =============================================================================
# 7. 升级完成
# =============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   🎉 升级完成！                               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

new_backend_image=$($COMPOSE_CMD -f "$COMPOSE_FILE" ps --format json raos-backend 2>/dev/null | grep -o '"Image":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
echo "  📦 后端镜像: ${current_backend_image} → ${new_backend_image}"
echo ""
echo "  🌐 前端访问:     http://localhost"
echo "  🔌 API 访问:     http://localhost:3000"
echo "  📊 健康检查:     http://localhost:3000/health"
echo ""

if ! $SKIP_BACKUP; then
  echo "  💾 升级前备份:   ${BACKUP_DIR}/${BACKUP_TIMESTAMP}"
  echo "  🔄 如需回滚:     ${SCRIPT_DIR}/restore.sh ${BACKUP_DIR}/${BACKUP_TIMESTAMP}"
fi

echo ""
echo "  📋 常用命令:"
echo "     查看日志:     docker logs -f raos-backend"
echo "     查看状态:     ${COMPOSE_CMD} -f ${COMPOSE_FILE} ps"
echo "     进入容器:     docker exec -it raos-backend sh"
echo ""
