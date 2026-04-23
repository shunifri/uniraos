#!/bin/bash
# 加载 .env 文件并运行调试脚本
set -a
source .env
set +a

npx tsx debug-api.ts
