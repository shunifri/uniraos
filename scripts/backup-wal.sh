#!/bin/bash
# =============================================================================
# RAOS WAL 备份脚本
# 复制 .raos/wal/ 目录，保留 7 天
# =============================================================================
set -e

BACKUP_DIR="${BACKUP_DIR:-/var/backups/raos/wal}"
RETENTION_DAYS=7
DATE=$(date +%Y%m%d_%H%M%S)
WAL_DIR="${WAL_DIR:-.raos/wal}"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting WAL backup..."

if [ -d "$WAL_DIR" ]; then
  tar czf "$BACKUP_DIR/wal_${DATE}.tar.gz" -C "$(dirname "$WAL_DIR")" "$(basename "$WAL_DIR")"
  echo "[$(date)] WAL backup completed: $BACKUP_DIR/wal_${DATE}.tar.gz"
else
  echo "[$(date)] WAL directory not found: $WAL_DIR"
fi

# 清理旧备份
find "$BACKUP_DIR" -name "wal_*.tar.gz" -mtime +$RETENTION_DAYS -delete
echo "[$(date)] Cleaned backups older than $RETENTION_DAYS days"
