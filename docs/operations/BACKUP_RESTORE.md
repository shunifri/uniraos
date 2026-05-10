# RAOS 备份与恢复指南

## 备份策略

| 数据类型 | 备份脚本 | 频率 | 保留期 |
|---------|---------|------|-------|
| MySQL | `scripts/backup-mysql.sh` | 每日 | 7 天 |
| SQLite | `scripts/backup-sqlite.sh` | 每日 | 7 天 |
| WAL | `scripts/backup-wal.sh` | 每日 | 7 天 |

## 环境变量

所有备份脚本支持以下环境变量：

```bash
export BACKUP_DIR=/var/backups/raos        # 备份存放目录
export MYSQL_PRIMARY_HOST=localhost        # MySQL 主机
export MYSQL_PRIMARY_PORT=3306             # MySQL 端口
export MYSQL_USER=raos                     # MySQL 用户
export MYSQL_PASSWORD=your_password        # MySQL 密码（必填）
export MYSQL_DATABASE=raos                 # MySQL 数据库名
export RAOS_DIR=.raos                      # RAOS 数据目录
export WAL_DIR=.raos/wal                   # WAL 目录
```

## 手动备份

```bash
# MySQL
MYSQL_PASSWORD=xxx ./scripts/backup-mysql.sh

# SQLite
./scripts/backup-sqlite.sh

# WAL
./scripts/backup-wal.sh
```

## 定时备份（crontab）

```bash
# 每天凌晨 2 点执行备份
0 2 * * * cd /path/to/raos && MYSQL_PASSWORD=xxx ./scripts/backup-mysql.sh >> /var/log/raos-backup.log 2>&1
0 2 * * * cd /path/to/raos && ./scripts/backup-sqlite.sh >> /var/log/raos-backup.log 2>&1
0 2 * * * cd /path/to/raos && ./scripts/backup-wal.sh >> /var/log/raos-backup.log 2>&1
```

## 恢复

```bash
# MySQL 恢复
./scripts/restore.sh mysql /var/backups/raos/mysql/full_20240101_000000.sql

# SQLite 恢复
./scripts/restore.sh sqlite /var/backups/raos/sqlite/raos.db.20240101_000000.bak

# WAL 恢复
./scripts/restore.sh wal /var/backups/raos/wal/wal_20240101_000000.tar.gz
```

**注意**：恢复前请先停止 RAOS 服务，避免数据冲突。
