#!/bin/bash

# Qdrant 启动脚本

set -e

QDRANT_VERSION="v1.9.0"
QDRANT_PORT=6333

echo "=== Qdrant 启动脚本 ==="

# 检查端口是否被占用
if lsof -i :$QDRANT_PORT > /dev/null 2>&1; then
    echo "✅ Qdrant 已在运行 (端口 $QDRANT_PORT)"
    exit 0
fi

# 尝试 Docker 启动
echo "尝试使用 Docker 启动 Qdrant..."

# 方法 1: Docker Hub
echo "[1/3] 尝试 Docker Hub..."
if docker pull qdrant/qdrant:latest 2>/dev/null; then
    docker run -d \
        --name raos-qdrant \
        -p 6333:6333 \
        -p 6334:6334 \
        -v qdrant_storage:/qdrant/storage \
        qdrant/qdrant:latest
    echo "✅ Qdrant 已通过 Docker Hub 启动"
    exit 0
fi

# 方法 2: 使用镜像存档（如果存在）
if [ -f "qdrant-image.tar" ]; then
    echo "[2/3] 尝试加载本地镜像..."
    docker load < qdrant-image.tar
    docker run -d \
        --name raos-qdrant \
        -p 6333:6333 \
        -p 6334:6334 \
        -v qdrant_storage:/qdrant/storage \
        qdrant/qdrant:latest
    echo "✅ Qdrant 已从本地镜像启动"
    exit 0
fi

# 方法 3: 本地二进制安装
echo "[3/3] 尝试本地安装..."
if command -v qdrant &> /dev/null; then
    echo "启动本地 Qdrant..."
    qdrant &
    sleep 2
    echo "✅ Qdrant 本地启动"
    exit 0
fi

# 所有方法失败
echo ""
echo "❌ 无法自动启动 Qdrant"
echo ""
echo "请手动安装 Qdrant:"
echo ""
echo "选项 1: 使用 Homebrew"
echo "  brew tap qdrant/tap"
echo "  brew install qdrant"
echo "  qdrant"
echo ""
echo "选项 2: 下载二进制"
echo "  访问: https://github.com/qdrant/qdrant/releases"
echo "  下载对应系统的二进制文件并运行"
echo ""
echo "选项 3: 使用 Docker（需 VPN）"
echo "  docker run -d -p 6333:6333 qdrant/qdrant"
echo ""
echo "选项 4: 跳过（向量搜索将不可用）"
echo "  应用仍可使用，但知识库搜索功能受限"
echo ""
exit 1
