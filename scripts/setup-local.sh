#!/bin/bash

# RAOS 本地开发环境快速启动脚本

set -e

echo "=== RAOS 本地环境启动 ==="

# 1. 检查并启动 MySQL
echo "[1/4] 检查 MySQL..."
if ! mysqladmin ping -h localhost --silent 2>/dev/null; then
    echo "启动 MySQL..."
    brew services start mysql
    sleep 3
fi
echo "✅ MySQL 运行中"

# 2. 检查并启动 Redis
echo "[2/4] 检查 Redis..."
if ! redis-cli ping | grep -q PONG; then
    echo "启动 Redis..."
    brew services start redis
    sleep 2
fi
echo "✅ Redis 运行中"

# 3. 初始化数据库（如果不存在）
echo "[3/4] 初始化数据库..."
mysql -u root -e "CREATE DATABASE IF NOT EXISTS raos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null || true
mysql -u root -e "CREATE USER IF NOT EXISTS 'raos'@'localhost' IDENTIFIED BY 'raospassword';" 2>/dev/null || true
mysql -u root -e "GRANT ALL PRIVILEGES ON raos.* TO 'raos'@'localhost';" 2>/dev/null || true
mysql -u root -e "FLUSH PRIVILEGES;" 2>/dev/null || true
echo "✅ 数据库已初始化"

# 4. 检查 Qdrant（如果没有则提示）
echo "[4/4] 检查 Qdrant..."
if curl -s http://localhost:6333/healthz > /dev/null 2>&1; then
    echo "✅ Qdrant 运行中"
else
    echo "⚠️  Qdrant 未启动，向量搜索将不可用"
    echo "   启动命令: docker run -d -p 6333:6333 qdrant/qdrant"
fi

echo ""
echo "=== 环境就绪 ==="
echo "启动应用: npm run dev"
echo ""
