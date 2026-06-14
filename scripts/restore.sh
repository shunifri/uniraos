#!/bin/bash
# =============================================================================
# RAOS 恢复脚本
# 从备份恢复 MySQL / SQLite / WAL
# =============================================================================
set -e

function usage() {
  echo "Usage: $0 <mysql|sqlite|wal> <backup_file>"
  echo "  mysql:  restore from .sql file (requires mysql client)"
  echo "  sqlite: restore from .bak file"
  echo "  wal:    restore from .tar.gz file"
  exit 1
}

if [ $# -lt 2 ]; then
  usage
fi

TYPE=$1
FILE=$2

if [ ! -f "$FILE" ]; then
  echo "Error: backup file not found: $FILE"
  exit 1
fi

case $TYPE in
  mysql)
    MYSQL_HOST="${MYSQL_PRIMARY_HOST:-localhost}"
    MYSQL_PORT="${MYSQL_PRIMARY_PORT:-3306}"
    MYSQL_USER="${MYSQL_USER:-raos}"
    MYSQL_PASSWORD="${MYSQL_PASSWORD:?MYSQL_PASSWORD is required}"
    MYSQL_DATABASE="${MYSQL_DATABASE:-raos}"
    echo "Restoring MySQL from $FILE..."
    # 用 MYSQL_PWD env 传密码, 避免 ps 看到明文 (mysql client 8 也支持 stdin --defaults-extra-file, 但 MYSQL_PWD 兼容老版本)
    MYSQL_PWD="$MYSQL_PASSWORD" mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" "$MYSQL_DATABASE" < "$FILE"
    echo "MySQL restore completed."
    ;;
  sqlite)
    RAOS_DIR="${RAOS_DIR:-.raos}"
    echo "Restoring SQLite to $RAOS_DIR..."
    cp "$FILE" "$RAOS_DIR/raos.db"
    echo "SQLite restore completed."
    ;;
  wal)
    WAL_DIR="${WAL_DIR:-.raos/wal}"
    echo "Restoring WAL to $WAL_DIR..."
    rm -rf "$WAL_DIR"
    tar xzf "$FILE" -C "$(dirname "$WAL_DIR")"
    echo "WAL restore completed."
    ;;
  *)
    usage
    ;;
esac
