# RAOS Docker 部署故障排查 (2026-06-12)

> **适用范围**: RAOS `master` 分支 (commit `2d3c4ad` 之后). 同事拉代码 + 部署遇到容器起不来 / 连不上 MySQL / admin 登不进时参考本文.

---

## 0. 5 分钟完整部署序列 (含 admin 密码)

```bash
# 1. 拉代码 + 确认 commit
git pull origin master
git log --oneline -3
# 应该看到:
#   2d3c4ad fix(deploy): 修 admin 密码鸡生蛋 (设 INITIAL_ADMIN_PASSWORD 走明文)
#   bb1b586 fix(deploy): 加 MYSQL_PRIMARY_HOST validation + 部署故障排查文档
#   6f7c88e fix(deploy): 修 raos-backend 启动 EACCES (.raos/audit 子目录权限)

# 2. .env 准备 (从 .env.example 拷贝)
cp .env.example .env
# 编辑 .env 设强密码:
#   MYSQL_ROOT_PASSWORD=<强密码>
#   MYSQL_PASSWORD=<强密码>
#   MINIO_PASSWORD=<强密码>
#   RABBITMQ_PASS=<强密码>
#   JWT_SECRET=<openssl rand -hex 32>
#   REDIS_PASSWORD=<强密码>
#   NEO4J_AUTH=neo4j/<强密码>
#   INITIAL_ADMIN_PASSWORD=MySecurePass123!  ← 必加 (>= 8 字符)

# 3. 起 stack
docker compose down -v       # 清旧 named volume
docker compose up -d         # 起 8 个容器

# 4. 验证
docker compose ps            # 全部 Up (healthy)
docker logs raos-backend --tail 50
# 应该看到:
#   [bootstrap] ensured runtime data dirs: 6 created
#   ✅ Environment validation passed
#   ║  Password: MySecurePass123!        ← dev/staging 明文打印
#   RAOS server listening on port 3000

# 5. 浏览器登入
# http://<server>/
# admin / MySecurePass123!
```

**生产部署** (`NODE_ENV=production`):
- 不设 `INITIAL_ADMIN_PASSWORD` (production 走随机密码 + hidden)
- 首次部署完用修法 2 (改 MySQL bcrypt hash) 重置 admin 密码
- 或者: 部署完第一次通过别的方式登入, 进 System Settings 改 admin 密码

---

## 1. EACCES: permission denied, open '/app/.raos/audit/audit.log'

**症状**: `docker logs raos-backend` 报
```
Error: EACCES: permission denied, open '/app/.raos/audit/audit.log'
```
容器 restart loop, `docker ps -a` 看到 `Exited (1)` 或 restart count 涨.

**根因**: Named volume `raos_data:/app/.raos` 第一次挂载时是 docker 自动建空目录 (owner=root:root mode=0755), 容器内 `USER raos` (UID 1001) 启动时没写权限建子目录.

**修法**: commit `6f7c88e` 已修. 必须拉最新代码:
```bash
git pull origin master
# 验证 commit 6f7c88e 在
git log --oneline -3
# 应该看到: fix(deploy): 修 raos-backend 启动 EACCES (.raos/audit 子目录权限)
```

**清空旧 named volume** (因为旧 volume 是 root:root 锁住的):
```bash
docker compose down -v
# -v 删 named volume, 下次 up 时会重新建空目录
```

**重新 build + 起**:
```bash
# 方式 1: 拉预编译镜像 (推荐, 生产)
./deploy/deploy.sh
# 选 2 (拉取远程镜像部署)
# 选 SWR 镜像地址 (跟 main 一致)

# 方式 2: 本地 build
./deploy/deploy.sh
# 选 1 (本地构建部署)
# 注意: 本地 build 模式只构建当前 host 架构, 镜像不能直接推生产

# 方式 3 (脚本化多架构推送, 生产跨架构)
./scripts/build-and-push.sh
# 默认 linux/amd64,linux/arm64
# 推到华为云 SWR
```

**验证修复**:
```bash
docker compose up -d
docker logs raos-backend 2>&1 | grep -i "bootstrap\|ensured"
# 应该看到: [bootstrap] ensured runtime data dirs: 6 created
```

---

## 1.5 401 Unauthorized "Invalid credentials" 登录失败 (admin 密码未知)

**症状**: 浏览器到 `http://<server>/` 看到登录页, 输 `admin` + 任意密码 → 红框 "Invalid credentials", DevTools Network 看到 `/api/auth/login` 返回 **401 Unauthorized**.

**根因** (commit `2d3c4ad` 修前): `src/db/user-repository.ts` `ensureAdminExists()` 首次启动自动创建 admin 用户, 密码是 `randomBytes(16).toString("hex")` 32 位**随机**, 然后 `console.warn` 只打印 "Password: [hidden — please reset via system settings]". 鸡生蛋: 没法登入就没法进系统设置.

**修法 1 (推荐)**: 拉新代码 + 设 `INITIAL_ADMIN_PASSWORD` env

```bash
git pull origin master
# 验证 commit 2d3c4ad 在
git log --oneline -3
# 应该看到: fix(deploy): 修 admin 密码鸡生蛋 (设 INITIAL_ADMIN_PASSWORD 走明文)

# 编辑 .env 加 (>= 8 字符, 强密码):
echo "INITIAL_ADMIN_PASSWORD=MySecurePass123!" >> .env

# 清掉旧 admin 用户 (因为它已经有随机密码 hash, 重置不会自动跑)
docker compose down -v
# ↑ -v 删 named volume, 删旧 .raos/wal.jsonl + .raos/audit + mysql 容器 db data
#   下次 up 时 MySQL 重新 init, ensureAdminExists 重新跑 (用新 env)

# 起 stack
docker compose up -d

# 找 admin 密码 (dev/staging 会明文打印, production 不会)
docker logs raos-backend | grep -A6 "DEFAULT ADMIN"
# 应该看到:
#   ╔════════════════════════════════════════════════════════════════════════════╗
#   ║  DEV/STAGING: Default admin account created with INITIAL_ADMIN_PASSWORD    ║
#   ╠════════════════════════════════════════════════════════════════════════════╣
#   ║  Username: admin                                                           ║
#   ║  Password: MySecurePass123!                                                ║
#   ║  ⚠️  在 production 请勿设置 INITIAL_ADMIN_PASSWORD, 否则密码会明文打印    ║
#   ╚════════════════════════════════════════════════════════════════════════════╝

# 浏览器 admin / MySecurePass123! 登入
```

**修法 2 (不重新 build, 直接改 MySQL)**: 已部署好的生产想重置 admin 密码, 不拉代码不动 env

```bash
# 1. 在 raos 仓库根生成 bcrypt hash (跟 src 用的同一算法)
cd /path/to/raos  # 必须有 node_modules (含 bcrypt)
node -e "const bcrypt=require('bcrypt');bcrypt.hash('YourNewPass123!',10).then(h=>console.log(h))"
# 输出: $2b$10$... (bcrypt hash, 60 字符)

# 2. 进 MySQL 改 admin
docker exec -it raos-mysql-primary mysql -uroot -p"$MYSQL_ROOT_PASSWORD" raos
# (输 MYSQL_ROOT_PASSWORD, 从 .env 看)

mysql> UPDATE users SET password_hash='<paste-bcrypt-here>' WHERE username='admin';
mysql> UPDATE users SET status='active' WHERE username='admin';
mysql> SELECT id, username, status FROM users WHERE username='admin';
# 应该看到 status='active'
mysql> \q

# 3. 浏览器 admin / YourNewPass123! 登入
```

**修法 3 (不重置, 用 UI 改 admin 密码)**: 仅当你有另一个 admin / 高级用户能登入

- 登入系统 → System Settings → Users → admin → 重置密码
- 不需要拉新代码

**安全边界**:
| 场景 | INITIAL_ADMIN_PASSWORD 行为 |
|------|---------------------------|
| 设了 + >= 8 字符 + NODE_ENV != production | ✅ 用之, 明文打印到 log |
| 设了 + < 8 字符 | ⚠️ 忽略, 走随机 (防弱密码) |
| 没设 + NODE_ENV != production | ⚠️ 走随机 + hidden |
| NODE_ENV = production | ⚠️ 走随机 + hidden (无论是否设 env, 防误配泄露) |

**生产部署提醒**:
- ❌ 生产**别**设 `INITIAL_ADMIN_PASSWORD` (会拿弱密码风险 + 假设没人看 log)
- ✅ 生产部署完, 用修法 2 改 admin 密码为强密码
- ✅ 或者: 首次登入后, 在 System Settings → Users 改 admin 密码

---

## 2. ECONNREFUSED 172.29.0.2:3306 (MySQL 连不上)

**症状**: 容器起了, 但日志里:
```
Error: connect ECONNREFUSED 172.29.0.2:3306
```
或
```
mysql_adapter_query_error error="connect ECONNREFUSED <some-ip>:3306"
```

**根因诊断 3 步**:

### 2.1 看容器是否在 `raos-backend` 网络里
```bash
docker network ls | grep raos
# 应该看到 raos-backend
docker network inspect raos-backend
# 应该看到 raos-backend, raos-workers, mysql-primary, redis 等都连了
```

**如果只有 raos-backend 一个容器接了**:
- 说明 mysql-primary 容器**没在起**, 跑 `docker compose ps` 看 mysql-primary 状态
- 应该是 `Up` (healthy) 或 `Up` (starting). 如果 `Exited` 看 `docker logs raos-mysql-primary`

### 2.2 看 mysql-primary 容器 healthcheck
```bash
docker inspect raos-mysql-primary --format '{{.State.Health.Status}}'
# 应该: healthy
# 如果: starting → 还在启动, 等 30-60s
# 如果: unhealthy → 看 logs
docker logs raos-mysql-primary 2>&1 | tail -30
```

**常见 unhealthy 原因**:
- `MYSQL_ROOT_PASSWORD` 没设或空 (env-validation 不会拦, 但 mysql 启动后会 access denied)
- `MYSQL_PASSWORD` 弱密码 (env-validation 会拦, 启动时就退出)
- 端口 3306 已被宿主机占用 → 改 `docker-compose.yml` 端口映射

### 2.3 看 `MYSQL_PRIMARY_HOST` env 实际值
```bash
docker exec raos-backend env | grep MYSQL
# 应该: MYSQL_PRIMARY_HOST=mysql-primary
# 错: MYSQL_PRIMARY_HOST=172.29.0.2 (说明 env 配错)
# 错: MYSQL_PRIMARY_HOST=localhost (容器内 localhost 是自己, 连不到 mysql)
```

**如果是 `172.29.0.2`**: 这是 docker 内部网络 IP, 每次容器重启会变. 应该用 service name `mysql-primary` (compose 自动 DNS).

**如果是 `localhost` / `127.0.0.1`**: 容器内 localhost = 容器自己, 不是 host. 错.

**正确做法**: 删 `.env` 里 `MYSQL_PRIMARY_HOST=...` 这一行, 让 compose 走默认 (已经 hardcode 在 `docker-compose.yml:217`).

### 2.4 手动测容器 → mysql 网络
```bash
# 进 raos-backend 容器
docker exec -it raos-backend sh
# 容器内 ping mysql
getent hosts mysql-primary
# 应该: 172.x.x.x mysql-primary
# 或: nslookup mysql-primary
# 应该解析到 mysql-primary 容器的 IP

# 测端口
nc -zv mysql-primary 3306
# 应该: succeeded
# 错: Connection refused
```

如果 `getent hosts mysql-primary` 解析不到, 说明容器**不在 raos-backend network**:
- 跑 `docker network inspect raos-backend` 看 `Containers` 段
- 你的容器名应该在里面
- 不在的话, 你的容器是手 `docker run` 起的, 没用 compose

### 2.5 修法: 全用 docker compose

**不要**手动 `docker run`. 用 compose 起整个 stack, 容器间网络自动配:
```bash
cd /path/to/raos  # 项目根
docker compose down -v  # 清掉旧
docker compose up -d    # 起完整 stack
docker compose ps       # 看所有容器状态
```

### 2.6 同事实际遇到: ECONNREFUSED 192.168.32.6:3306 + 顺带 admin 密码 hidden (2026-06-12 18:15)

**症状**: 启动后日志:
```
Unhandled error in main: Error: connect ECONNREFUSED 192.168.32.6:3306
...
║  Password: [hidden — please reset via system settings after first login]   ║
```

**两个错一起修** (按顺序):

#### 错 1: MySQL 连不上 (跟 §2.1/2.2/2.3 同根因, 但你 .env 写错了 host)

你的 `.env` 里有 `MYSQL_PRIMARY_HOST=192.168.32.6` (raw IP, 不是 service name). 这个 IP 是**你本机**, 没跑 MySQL. MySQL 在 compose 起的容器里, service name `mysql-primary`.

**修法**:
```bash
# 1. 删 .env 里的 MYSQL_PRIMARY_HOST 这一行
sed -i '/^MYSQL_PRIMARY_HOST=/d' .env
grep MYSQL .env
# 应该: 只有 MYSQL_ROOT_PASSWORD / MYSQL_PASSWORD / MYSQL_USER / MYSQL_DATABASE, 没了 MYSQL_PRIMARY_HOST

# 2. 重起 backend (mysql-primary 容器不需要重起, 它一直在 raos-backend network)
docker compose restart raos-backend
docker logs raos-backend --tail 30
# 应该: 没有 ECONNREFUSED, 后端正常启动
```

**别 `docker compose down -v`** — `-v` 会删 MySQL 数据, 你 admin 用户没了, 但 admin 密码还 hidden, 鸡生蛋更严重.

#### 错 2: admin 密码 hidden (NODE_ENV=production 时, INITIAL_ADMIN_PASSWORD 故意不打印)

你看到 "Password: [hidden]" 是因为 `NODE_ENV=production` (env-validation 故意 production 隐藏, 防止 env 误配泄露).

**修法 A (不重 build, 改 MySQL 直接重置 admin 密码)**:

> **重要**: 用 **scrypt v2** 不是 bcrypt. 同事参考的网上 bcrypt 教程不对! 必须按下面步骤:

```bash
# 1. 在 raos 仓库根生成 scrypt v2 hash (跟 src/db/user-repository.ts:hashPassword 同一算法)
node -e "
const { scryptSync, randomBytes } = require('crypto');
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCRYPT_KEYLEN = 64;
const password = 'MySecurePass123!';  // 改成你要的密码 (>= 8 字符)
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString('hex');
console.log('v2:' + salt + ':' + hash);
"
# 输出: v2:7647f8141978592f4095f5c89b296dd5:b05029c5504d38e3b0efd6953f699c91...
# 复制这一整行 (v2:开头)

# 2. 进 MySQL 改 admin 密码
docker exec -it raos-mysql-primary mysql -uroot -p"$MYSQL_ROOT_PASSWORD" raos
# (输 MYSQL_ROOT_PASSWORD, 从 .env 看)

mysql> UPDATE users SET password_hash='v2:7647f8141978592f4095f5c89b296dd5:b05029c5504d38e3b0efd6953f699c91...' WHERE username='admin';
mysql> UPDATE users SET status='active' WHERE username='admin';
mysql> SELECT id, username, status, LEFT(password_hash, 30) AS hash_prefix FROM users WHERE username='admin';
# 应该: status='active', hash_prefix='v2:...'
mysql> \q

# 3. 浏览器 admin / MySecurePass123! 登入
```

**修法 B (用 mysqldump 验证 admin 行存在)**:
```bash
docker exec raos-mysql-primary mysql -uroot -p"$MYSQL_ROOT_PASSWORD" raos -e \
  "SELECT id, username, status, created_at FROM users WHERE username='admin';"
# 应该看到 1 行 admin / status='active' / created_at 是首次启动时间
# 如果 0 行 → 数据库初始化有问题, 见 §2.2 mysql healthcheck
```

**修法 C (System Settings 改密码, 不需要 SQL)**:
- 如果你**已经有别的 admin / 用户**能登入, 走 UI:
  System Settings → Users → admin → 重置密码
- 不需要拉新代码 / 不需要改 MySQL

#### 完整一气呵成序列 (错 1 + 错 2 一起修)

```bash
cd /path/to/raos

# A. 修 .env
sed -i '/^MYSQL_PRIMARY_HOST=/d' .env
# (不用 INITIAL_ADMIN_PASSWORD, 走修法 A 改 MySQL)

# B. 重起 backend
docker compose restart raos-backend
docker logs raos-backend --tail 30
# 验证: 没有 ECONNREFUSED

# C. 进 MySQL 改 admin 密码
node -e "const{scryptSync,randomBytes}=require('crypto');const o={N:32768,r:8,p:1,maxmem:67108864};const h=scryptSync('MySecurePass123!',randomBytes(16).toString('hex'),64,o).toString('hex');console.log('v2:'+randomBytes(16).toString('hex').length+'—actually full line below');" 2>&1 | tail -1
# ^ 上面那条命令有点 hack, 用下面这条
node <<'EOF'
const { scryptSync, randomBytes } = require('crypto');
const o = { N: 32768, r: 8, p: 1, maxmem: 64*1024*1024 };
const pwd = 'MySecurePass123!';
const salt = randomBytes(16).toString('hex');
const h = scryptSync(pwd, salt, 64, o).toString('hex');
console.log('v2:' + salt + ':' + h);
EOF
# 复制输出 (v2:xxx:yyy)

docker exec -it raos-mysql-primary mysql -uroot -p"$MYSQL_ROOT_PASSWORD" raos
mysql> UPDATE users SET password_hash='<paste-here>' WHERE username='admin';
mysql> UPDATE users SET status='active' WHERE username='admin';
mysql> \q

# D. 浏览器 admin / MySecurePass123! 登入
```

---

## 3. 容器起来了但 `raos-backend` 一直 restart

```bash
docker compose ps
# 看 STATUS 栏
# 一直 Restarting → 看 logs
docker logs raos-backend --tail 100
```

**常见原因**:
- EACCES (见 §1)
- MySQL 连不上 (见 §2)
- 健康检查失败 (HEALTHCHECK 走 `curl http://localhost:3000/health`, 如果 3000 端口没起就是 failed)
- `node server-loader.cjs` 启动失败 → 看 stack trace

---

## 4. 路径错提醒

部署时 `build-and-push.sh` 在 **`scripts/` 目录下**, 不是项目根:
```bash
./scripts/build-and-push.sh   # 正确
./build-and-push.sh           # 错, 找不到
```

这个错在 `deploy/deploy.sh:906` 的 hint log 里也出现过:
```
log_warn "如需多架构镜像推到 SWR, 请用 ./scripts/build-and-push.sh"
```
注意是 `./scripts/...` 不是 `./...`.

---

## 5. 一键检查脚本 (给你写)

```bash
#!/bin/bash
# quick-check.sh - 一键检查 RAOS 部署状态
set -e

echo "=== 1. 网络 ==="
docker network inspect raos-backend --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\n"}}{{end}}' 2>/dev/null || echo "raos-backend 网络不存在"

echo ""
echo "=== 2. 容器 ==="
docker compose ps 2>/dev/null

echo ""
echo "=== 3. MySQL 健康 ==="
docker inspect raos-mysql-primary --format '{{.State.Health.Status}}' 2>/dev/null || echo "无 mysql-primary 容器"

echo ""
echo "=== 4. raos-backend 日志最近 20 行 ==="
docker logs raos-backend --tail 20 2>/dev/null || echo "无 raos-backend 容器"

echo ""
echo "=== 5. env ==="
docker exec raos-backend env 2>/dev/null | grep -E "^(MYSQL|REDIS|QDRANT|RABBITMQ|MINIO|NEO4J|USE_MYSQL|GRAPH_STORE)" || echo "无 raos-backend 容器"
```

保存为 `quick-check.sh`, `chmod +x`, 跑 `./quick-check.sh` 一键看状态.
