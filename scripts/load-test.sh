#!/bin/bash
# =============================================================================
# RAOS 压力测试脚本
# =============================================================================
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TOKEN="${TOKEN:?TOKEN is required}"
DURATION="${DURATION:-60}"
CONCURRENCY="${CONCURRENCY:-20}"

echo "=============================================="
echo "RAOS 压力测试"
echo "=============================================="
echo "目标: $BASE_URL"
echo "并发: $CONCURRENCY"
echo "持续时间: ${DURATION}s"
echo ""

# 检查依赖
if ! command -v curl &> /dev/null; then
  echo "Error: curl is required"
  exit 1
fi
if ! command -v jq &> /dev/null; then
  echo "Warning: jq not found, some tests will be limited"
fi

# 1. Agent 并发聊天测试
echo "[1/4] Agent 并发聊天测试..."
for i in $(seq 1 $CONCURRENCY); do
  (
    START=$(date +%s%N)
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"message":"你好，请简单介绍一下自己"}' \
      "${BASE_URL}/api/agent/chat" || echo "000")
    END=$(date +%s%N)
    DURATION_MS=$(( (END - START) / 1000000 ))
    echo "  request $i: HTTP $HTTP_CODE, ${DURATION_MS}ms"
  ) &
done
wait
echo ""

# 2. 文件上传测试（模拟）
echo "[2/4] 文件上传并发测试..."
TMPFILE=$(mktemp)
dd if=/dev/urandom of="$TMPFILE" bs=1M count=10 2>/dev/null
for i in $(seq 1 5); do
  (
    START=$(date +%s%N)
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "Authorization: Bearer $TOKEN" \
      -F "file=@$TMPFILE" \
      "${BASE_URL}/api/upload" || echo "000")
    END=$(date +%s%N)
    DURATION_MS=$(( (END - START) / 1000000 ))
    echo "  upload $i: HTTP $HTTP_CODE, ${DURATION_MS}ms"
  ) &
done
wait
rm -f "$TMPFILE"
echo ""

# 3. 知识图谱写入测试
echo "[3/4] 知识图谱批量写入测试..."
START=$(date +%s%N)
for i in $(seq 1 50); do
  (
    curl -s -o /dev/null \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{\"label\":\"Node_$i\",\"type\":\"test\"}" \
      "${BASE_URL}/api/graph/node" || true
  ) &
  if (( i % 10 == 0 )); then
    wait
  fi
done
wait
END=$(date +%s%N)
DURATION_MS=$(( (END - START) / 1000000 ))
echo "  50 nodes inserted in ${DURATION_MS}ms"
echo ""

# 4. SSE 长连接稳定性测试
echo "[4/4] SSE 长连接稳定性测试 (5秒)..."
curl -s -N \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Hello"}' \
  "${BASE_URL}/api/agent/chat/stream" | \
  timeout 5 cat > /dev/null && echo "  SSE: OK" || echo "  SSE: FAILED"
echo ""

echo "=============================================="
echo "压力测试完成"
echo "=============================================="
