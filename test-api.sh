#!/bin/bash
# 测试 API 接口

echo "=== 测试登录 ==="
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | \
  python3 -c "import sys, json; d = json.load(sys.stdin); print(d['token'] if d.get('success') else 'ERROR: ' + d.get('error', 'unknown'))")

if [[ $TOKEN == ERROR* ]]; then
  echo "登录失败: $TOKEN"
  exit 1
fi

echo "登录成功，Token: ${TOKEN:0:50}..."

echo -e "\n=== 测试 /api/users 接口 ==="
curl -s -X GET http://localhost:3000/api/users \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
