#!/bin/bash
# 加载 .env 文件并运行修复脚本
set -a
source .env
set +a

npx tsx fix-user-roles.ts
