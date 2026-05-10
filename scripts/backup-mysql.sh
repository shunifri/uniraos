#!/bin/bash
# =============================================================================
# RAOS MySQL 备份脚本
# 每日全量 mysqldump + 增量 binlog，保留 7 天
# =============================================================================
set -e

BACKUP_DIR="${BACKUP_DIR:-/var/backups/raos/mysql}"
RETENTION_DAYS=7
DATE=$(date +%Y%m%d_%H%M%S)

# 从环境变量读取连接信息
MYSQL_HOST="${MYSQL_PRIMARY_HOST:-localhost}"
MYSQL_PORT="${MYSQL_PRIMARY_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-raos}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:?MYSQL_PASSWORD is required}"
MYSQL_DATABASE="${MYSQL_DATABASE:-raos}"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting MySQL backup..."

# 全量备份
mysqldump -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" \
  --single-transaction --routines --triggers --databases "$MYSQL_DATABASE" \
  > "$BACKUP_DIR/full_${DATE}.sql"

echo "[$(date)] Full backup completed: $BACKUP_DIR/full_${DATE}.sql"

# 清理旧备份
find "$BACKUP_DIR" -name "full_*.sql" -mtime +$RETENTION_DAYS -delete
echo "[$(date)] Cleaned backups older than $RETENTION_DAYS days"
