#!/bin/bash
# 加载 .env 文件并运行 MySQL 数据检查脚本
set -a
source .env
set +a

npx tsx check-mysql-data.ts
