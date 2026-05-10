#!/bin/bash
# =============================================================================
# RAOS 全量备份脚本
# 备份所有数据：MySQL、Redis、Qdrant、MinIO、Neo4j、配置
# 用法: ./deploy/backup.sh [--output <dir>] [--retention <days>]
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
BACKUP_BASE="${PROJECT_DIR}/backups"
RETENTION_DAYS=7

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --output|-o)
      BACKUP_BASE="$2"
      shift 2
      ;;
    --retention|-r)
      RETENTION_DAYS="$2"
      shift 2
      ;;
    --help|-h)
      echo "用法: $0 [选项]"
      echo ""
      echo "选项:"
      echo "  --output <dir>     备份输出目录（默认: ./backups）"
      echo "  --retention <days> 保留天数（默认: 7）"
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
  log_error "未找到 .env 文件"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

# =============================================================================
# 初始化备份目录
# =============================================================================
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_BASE}/${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              RAOS 全量备份                                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
log_info "备份时间: $(date '+%Y-%m-%d %H:%M:%S')"
log_info "备份目录: $BACKUP_DIR"
echo ""

# 记录备份元信息
cat > "${BACKUP_DIR}/backup.meta" << EOF
backup_time=$(date -Iseconds)
project_dir=${PROJECT_DIR}
hostname=$(hostname)
docker_version=$(docker --version)
compose_version=$($COMPOSE_CMD version 2>/dev/null || $COMPOSE_CMD --version)
EOF

# =============================================================================
# 1. 备份 MySQL
# =============================================================================
log_info "[1/6] 备份 MySQL 数据库..."

MYSQL_HOST="${MYSQL_PRIMARY_HOST:-mysql-primary}"
MYSQL_PORT="${MYSQL_PRIMARY_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-raos}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DATABASE="${MYSQL_DATABASE:-raos}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"

if docker ps | grep -q "raos-mysql-primary"; then
  # 使用 root 密码（如果有）或应用密码
  DB_PASS="${MYSQL_ROOT_PASSWORD:-$MYSQL_PASSWORD}"
  DB_USER="${MYSQL_ROOT_PASSWORD:+root}"
  DB_USER="${DB_USER:-$MYSQL_USER}"
  
  if docker exec raos-mysql-primary mysqldump \
    -u "$DB_USER" -p"$DB_PASS" \
    --single-transaction --routines --triggers \
    --databases "$MYSQL_DATABASE" \
    > "${BACKUP_DIR}/mysql_full.sql" 2>/dev/null; then
    
    # 压缩
    gzip -f "${BACKUP_DIR}/mysql_full.sql"
    BACKUP_SIZE=$(du -h "${BACKUP_DIR}/mysql_full.sql.gz" | cut -f1)
    log_ok "MySQL 备份完成 (${BACKUP_SIZE})"
  else
    log_error "MySQL 备份失败，请检查密码和连接"
    rm -f "${BACKUP_DIR}/mysql_full.sql"
  fi
else
  log_warn "MySQL 容器未运行，跳过 MySQL 备份"
fi

# =============================================================================
# 2. 备份 Redis
# =============================================================================
log_info "[2/6] 备份 Redis 数据..."

if docker ps | grep -q "raos-redis"; then
  # 触发 BGSAVE
  docker exec raos-redis redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} BGSAVE > /dev/null 2>&1 || true
  sleep 2
  
  # 复制 RDB 文件
  if docker cp raos-redis:/data/dump.rdb "${BACKUP_DIR}/redis_dump.rdb" 2>/dev/null; then
    BACKUP_SIZE=$(du -h "${BACKUP_DIR}/redis_dump.rdb" | cut -f1)
    log_ok "Redis 备份完成 (${BACKUP_SIZE})"
  else
    log_warn "Redis RDB 文件复制失败，尝试从 volume 备份..."
    REDIS_VOLUME=$(docker volume ls -q | grep "raos.*redis" | head -1)
    if [[ -n "$REDIS_VOLUME" ]]; then
      docker run --rm -v "$REDIS_VOLUME:/data" -v "$BACKUP_DIR:/backup" alpine \
        cp /data/dump.rdb /backup/redis_dump.rdb 2>/dev/null || true
      if [[ -f "${BACKUP_DIR}/redis_dump.rdb" ]]; then
        log_ok "Redis 备份完成 (从 volume)"
      else
        log_warn "Redis 备份失败"
      fi
    fi
  fi
else
  log_warn "Redis 容器未运行，跳过 Redis 备份"
fi

# =============================================================================
# 3. 备份 Qdrant
# =============================================================================
log_info "[3/6] 备份 Qdrant 向量数据..."

if docker ps | grep -q "raos-qdrant"; then
  QDRANT_VOLUME=$(docker volume ls -q | grep "raos.*qdrant" | head -1)
  if [[ -n "$QDRANT_VOLUME" ]]; then
    docker run --rm -v "$QDRANT_VOLUME:/qdrant/storage" -v "$BACKUP_DIR:/backup" alpine \
      sh -c "tar czf /backup/qdrant_storage.tar.gz -C /qdrant/storage ." 2>/dev/null
    if [[ -f "${BACKUP_DIR}/qdrant_storage.tar.gz" ]]; then
      BACKUP_SIZE=$(du -h "${BACKUP_DIR}/qdrant_storage.tar.gz" | cut -f1)
      log_ok "Qdrant 备份完成 (${BACKUP_SIZE})"
    else
      log_warn "Qdrant 备份失败"
    fi
  fi
else
  log_warn "Qdrant 容器未运行，跳过 Qdrant 备份"
fi

# =============================================================================
# 4. 备份 MinIO
# =============================================================================
log_info "[4/6] 备份 MinIO 对象存储..."

if docker ps | grep -q "raos-minio"; then
  MINIO_VOLUME=$(docker volume ls -q | grep "raos.*minio" | head -1)
  if [[ -n "$MINIO_VOLUME" ]]; then
    docker run --rm -v "$MINIO_VOLUME:/data" -v "$BACKUP_DIR:/backup" alpine \
      sh -c "tar czf /backup/minio_data.tar.gz -C /data ." 2>/dev/null
    if [[ -f "${BACKUP_DIR}/minio_data.tar.gz" ]]; then
      BACKUP_SIZE=$(du -h "${BACKUP_DIR}/minio_data.tar.gz" | cut -f1)
      log_ok "MinIO 备份完成 (${BACKUP_SIZE})"
    else
      log_warn "MinIO 备份失败"
    fi
  fi
else
  log_warn "MinIO 容器未运行，跳过 MinIO 备份"
fi

# =============================================================================
# 5. 备份 Neo4j
# =============================================================================
log_info "[5/6] 备份 Neo4j 图数据库..."

if docker ps | grep -q "raos-neo4j"; then
  NEO4J_VOLUME=$(docker volume ls -q | grep "raos.*neo4j_data" | head -1)
  if [[ -n "$NEO4J_VOLUME" ]]; then
    docker run --rm -v "$NEO4J_VOLUME:/data" -v "$BACKUP_DIR:/backup" alpine \
      sh -c "tar czf /backup/neo4j_data.tar.gz -C /data ." 2>/dev/null
    if [[ -f "${BACKUP_DIR}/neo4j_data.tar.gz" ]]; then
      BACKUP_SIZE=$(du -h "${BACKUP_DIR}/neo4j_data.tar.gz" | cut -f1)
      log_ok "Neo4j 备份完成 (${BACKUP_SIZE})"
    else
      log_warn "Neo4j 备份失败"
    fi
  fi
else
  log_warn "Neo4j 容器未运行，跳过 Neo4j 备份"
fi

# =============================================================================
# 6. 备份配置文件
# =============================================================================
log_info "[6/6] 备份配置文件..."

# 备份 .env（脱敏处理）
if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "${BACKUP_DIR}/env.backup"
  # 创建脱敏版本用于查看
  sed 's/=.*$/=***/g' "$ENV_FILE" > "${BACKUP_DIR}/env.backup.preview"
  log_ok ".env 配置已备份"
fi

# 备份 docker-compose.yml
cp "$COMPOSE_FILE" "${BACKUP_DIR}/docker-compose.yml.backup"
log_ok "docker-compose.yml 已备份"

# 备份 uploads 目录（如果使用本地存储）
if [[ -d "${PROJECT_DIR}/uploads" ]]; then
  tar czf "${BACKUP_DIR}/uploads.tar.gz" -C "$PROJECT_DIR" uploads 2>/dev/null || true
  if [[ -f "${BACKUP_DIR}/uploads.tar.gz" ]]; then
    BACKUP_SIZE=$(du -h "${BACKUP_DIR}/uploads.tar.gz" | cut -f1)
    log_ok "上传文件备份完成 (${BACKUP_SIZE})"
  fi
fi

# =============================================================================
# 7. 清理旧备份
# =============================================================================
echo ""
log_info "清理 ${RETENTION_DAYS} 天前的旧备份..."

DELETED_COUNT=$(find "$BACKUP_BASE" -maxdepth 1 -type d -name "[0-9]*_[0-9]*" -mtime +$RETENTION_DAYS | wc -l)
find "$BACKUP_BASE" -maxdepth 1 -type d -name "[0-9]*_[0-9]*" -mtime +$RETENTION_DAYS -exec rm -rf {} + 2>/dev/null || true

if [[ "$DELETED_COUNT" -gt 0 ]]; then
  log_ok "已清理 ${DELETED_COUNT} 个旧备份"
else
  log_ok "没有需要清理的旧备份"
fi

# =============================================================================
# 备份完成
# =============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   💾 备份完成！                               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "  📁 备份目录:   $BACKUP_DIR"
echo "  📦 总大小:     $TOTAL_SIZE"
echo ""
echo "  备份内容:"
ls -lh "$BACKUP_DIR" | tail -n +2 | awk '{printf "    %-20s %s\n", $9, $5}'
echo ""
echo "  恢复命令:"
echo "    MySQL:   mysql -u root -p < ${BACKUP_DIR}/mysql_full.sql.gz | gunzip"
echo "    Redis:   docker cp ${BACKUP_DIR}/redis_dump.rdb raos-redis:/data/dump.rdb"
echo "    全部:    tar xzf ${BACKUP_DIR}/*.tar.gz -C <目标目录>"
echo ""
