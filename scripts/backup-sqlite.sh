#!/bin/bash
# =============================================================================
# RAOS SQLite 备份脚本
# 使用 SQLite 内置 .backup 命令备份 .raos/*.db 文件，保留 7 天
# =============================================================================
set -e

BACKUP_DIR="${BACKUP_DIR:-/var/backups/raos/sqlite}"
RETENTION_DAYS=7
DATE=$(date +%Y%m%d_%H%M%S)
RAOS_DIR="${RAOS_DIR:-.raos}"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting SQLite backup..."

# 备份所有 .db 文件
for db in "$RAOS_DIR"/*.db; do
  if [ -f "$db" ]; then
    BASENAME=$(basename "$db")
    BACKUP_PATH="$BACKUP_DIR/${BASENAME}.${DATE}.bak"
    sqlite3 "$db" ".backup '$BACKUP_PATH'"
    echo "[$(date)] Backed up: $db"

    # 同时备份 WAL 和 SHM 文件（如存在）
    for ext in -wal -shm; do
      if [ -f "${db}${ext}" ]; then
        cp "${db}${ext}" "$BACKUP_DIR/${BASENAME}${ext}.${DATE}.bak"
        echo "[$(date)] Backed up: ${db}${ext}"
      fi
    done
  fi
done

# 清理旧备份
find "$BACKUP_DIR" -name "*.bak" -mtime +$RETENTION_DAYS -delete
echo "[$(date)] Cleaned backups older than $RETENTION_DAYS days"
