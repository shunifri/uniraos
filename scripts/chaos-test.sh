#!/bin/bash
# =============================================================================
# RAOS 混沌测试脚本
# =============================================================================
set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
TOKEN="${TOKEN:?TOKEN is required}"

echo "=============================================="
echo "RAOS 混沌测试"
echo "=============================================="
echo ""

# 1. DB 断开恢复测试
echo "[1/3] MySQL 断开恢复测试..."
echo "  1. 检查服务健康..."
curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" | grep -q "200" && echo "  ✓ 服务正常" || echo "  ✗ 服务异常"

echo "  2. 模拟 MySQL 断开 (停止容器)..."
docker stop raos-mysql-primary 2>/dev/null || true
sleep 3

echo "  3. 检查服务状态 (应返回 503)..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/ready" || echo "000")
echo "  /ready returns: $STATUS"
if [ "$STATUS" = "503" ]; then
  echo "  ✓ 服务正确返回 503"
else
  echo "  ! 服务返回 $STATUS (预期 503)"
fi

echo "  4. 恢复 MySQL..."
docker start raos-mysql-primary 2>/dev/null || true
sleep 5

echo "  5. 等待服务恢复..."
for i in $(seq 1 30); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/ready" || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "  ✓ 服务在 ${i}s 后恢复"
    break
  fi
  sleep 1
done
if [ "$STATUS" != "200" ]; then
  echo "  ✗ 服务未在 30s 内恢复"
fi
echo ""

# 2. Redis 断开恢复测试
echo "[2/3] Redis 断开恢复测试..."
echo "  1. 停止 Redis 容器..."
docker stop raos-redis 2>/dev/null || true
sleep 3

echo "  2. 检查服务状态..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/ready" || echo "000")
echo "  /ready returns: $STATUS"

echo "  3. 恢复 Redis..."
docker start raos-redis 2>/dev/null || true
sleep 3

echo "  4. 等待服务恢复..."
for i in $(seq 1 30); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/ready" || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "  ✓ 服务在 ${i}s 后恢复"
    break
  fi
  sleep 1
done
echo ""

# 3. LLM 超时测试
echo "[3/3] LLM 超时测试..."
echo "  发送一个需要 LLM 响应的请求..."
START=$(date +%s)
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Hello"}' \
  "${BASE_URL}/api/agent/chat" || echo "TIMEOUT")
END=$(date +%s)
ELAPSED=$((END - START))
echo "  响应时间: ${ELAPSED}s"
echo "  响应: $(echo "$RESPONSE" | tail -n 1)"
echo ""

echo "=============================================="
echo "混沌测试完成"
echo "=============================================="
