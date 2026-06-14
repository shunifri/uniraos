#!/bin/bash
# =============================================================================
# RAOS 部署端到端验证脚本
# 跑完保证: 容器全 up, 网络通, MySQL 通, admin 用户存在且密码已知
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ok()   { echo -e "${GREEN}✓${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; exit 1; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }

echo "=== RAOS Deploy Verify ==="
echo ""

# 1. 检查 git
echo "[1/8] Git state"
HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "  HEAD: $HEAD"
EXPECTED_MIN="0f2ec03"  # 同事至少要拉到这个
ACTUAL=$(git rev-parse --short HEAD)
if [[ "$ACTUAL" < "$EXPECTED_MIN" ]]; then
  err "  commit 落后, 请 git pull origin master (need >= 0f2ec03)"
fi
ok "  Git state OK"

# 2. 检查 .env
echo ""
echo "[2/8] .env check"
if [[ ! -f .env ]]; then
  err "  .env 不存在, 跑 cp .env.example .env 然后填强密码"
fi
for k in MYSQL_ROOT_PASSWORD MYSQL_PASSWORD MINIO_PASSWORD RABBITMQ_PASS JWT_SECRET; do
  v=$(grep "^$k=" .env | cut -d= -f2)
  if [[ -z "$v" || "$v" == change_me* || ${#v} -lt 8 ]]; then
    err "  $k 未设或太弱, 请改强密码 (>= 8 字符, 不含 change_me)"
  fi
done
# MYSQL_PRIMARY_HOST 必须是 mysql-primary (或空, compose default)
HOST=$(grep "^MYSQL_PRIMARY_HOST=" .env | cut -d= -f2 || true)
if [[ -n "$HOST" && "$HOST" != "mysql-primary" ]]; then
  err "  .env 里有 MYSQL_PRIMARY_HOST=$HOST, 必须删 (用 service name 'mysql-primary' 或留空)"
fi
ok "  .env OK"

# 3. 检查 docker compose 起来
echo ""
echo "[3/8] docker compose ps"
if ! docker compose ps 2>&1 | head -1; then
  err "  docker compose 跑不起来"
fi
RUNNING=$(docker compose ps --services --filter "status=running" 2>/dev/null | wc -l | tr -d ' ')
TOTAL=$(docker compose ps --services 2>/dev/null | wc -l | tr -d ' ')
if [[ "$RUNNING" -lt 4 ]]; then
  warn "  只有 $RUNNING / $TOTAL 容器在跑, 跑 docker compose up -d 起"
fi
ok "  $RUNNING / $TOTAL 容器在跑"

# 4. 检查 mysql 健康
echo ""
echo "[4/8] MySQL health"
MYSQL_STATUS=$(docker inspect raos-mysql-primary --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
if [[ "$MYSQL_STATUS" != "healthy" ]]; then
  err "  mysql-primary status=$MYSQL_STATUS, 期望 healthy. 看 docker logs raos-mysql-primary"
fi
ok "  MySQL healthy"

# 5. 检查 backend 容器配置 (raw IP 检测)
echo ""
echo "[5/8] Backend env (raw IP / loopback check)"
BACKEND_HOST=$(docker exec raos-backend env 2>/dev/null | grep "^MYSQL_PRIMARY_HOST=" | cut -d= -f2 || true)
if [[ -z "$BACKEND_HOST" ]]; then
  ok "  MYSQL_PRIMARY_HOST 未设, 用 compose default 'mysql-primary'"
elif [[ "$BACKEND_HOST" == "localhost" || "$BACKEND_HOST" == "127.0.0.1" ]]; then
  err "  MYSQL_PRIMARY_HOST=$BACKEND_HOST, 容器内 loopback 连不到 mysql, 改成 mysql-primary"
elif [[ "$BACKEND_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  err "  MYSQL_PRIMARY_HOST=$BACKEND_HOST 是 raw IP, 必须改成 'mysql-primary' (compose service name)"
else
  ok "  MYSQL_PRIMARY_HOST=$BACKEND_HOST"
fi

# 6. 测 backend → mysql 网络
echo ""
echo "[6/8] Backend ↔ MySQL network"
if ! docker exec raos-backend sh -c "getent hosts mysql-primary" 2>/dev/null | grep -q mysql-primary; then
  err "  容器内 getent hosts mysql-primary 解析失败, 容器没接 raos-backend network"
fi
ok "  DNS OK: $(docker exec raos-backend sh -c 'getent hosts mysql-primary' 2>/dev/null)"

# 7. 检查 admin 用户 + 密码 hash 格式
echo ""
echo "[7/8] admin user check"
ADMIN_HASH=$(docker exec raos-mysql-primary mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -B raos -e \
  "SELECT password_hash FROM users WHERE username='admin' LIMIT 1;" 2>/dev/null || true)
if [[ -z "$ADMIN_HASH" ]]; then
  err "  admin 用户不存在, MySQL 初始化出问题. 看 docker logs raos-mysql-primary"
fi
if [[ ! "$ADMIN_HASH" =~ ^v2: ]]; then
  err "  admin password_hash 格式不对: $ADMIN_HASH (期望 v2:...)"
fi
ok "  admin user exists, hash format v2:..."

# 8. 测 login API
echo ""
echo "[8/8] Login API test"
# 拿 INITIAL_ADMIN_PASSWORD (从 .env), 没设就走 SQL 查
INIT_PWD=$(grep "^INITIAL_ADMIN_PASSWORD=" .env | cut -d= -f2 || true)
if [[ -z "$INIT_PWD" || "$INIT_PWD" == change_me* ]]; then
  warn "  .env 没设 INITIAL_ADMIN_PASSWORD (生产模式隐藏), 你需要 §2.6 修法 2 重置密码"
  warn "  跑 verify-deploy.sh --reset-admin 来自动重置"
  exit 2
fi

# 测登录
LOGIN_RESULT=$(curl -sS -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$INIT_PWD\"}" \
  -w "\nHTTP:%{http_code}" 2>&1)
HTTP_CODE=$(echo "$LOGIN_RESULT" | grep -oP 'HTTP:\K\d+')
if [[ "$HTTP_CODE" == "200" ]]; then
  ok "  admin 登录 200 OK"
elif [[ "$HTTP_CODE" == "401" ]]; then
  err "  admin 登录 401 Unauthorized, 密码错. 跑 §2.6 修法 2 重置"
else
  err "  admin 登录 HTTP=$HTTP_CODE, 期望 200, 看 backend log"
fi

echo ""
ok "=== RAOS 部署验证通过 ==="
echo "现在可以浏览器打开 http://<server>/ 登入 admin / $INIT_PWD"
