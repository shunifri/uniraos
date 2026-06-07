# RAOS 部署指南

## 环境要求

- Docker 24.0+ & Docker Compose v2+
- 4C8G 以上服务器（生产建议 8C16G）
- 20GB+ 可用磁盘空间

## 重要提示：生产环境必须使用预编译镜像（bytenode 字节码保护）

> ⚠️ **生产环境只能走"拉镜像"模式, 不能走"本地 build"**
>
> Backend Dockerfile 的构建产物是 bytenode 字节码 (`.jsc`), **不是可读的 JavaScript 源码**。
> 这是源代码保护设计, 但也意味着:
> - 生产容器里**没有可读代码**, `docker exec raos-backend cat ...` 看到的是字节码
> - 任何 hotfix、debug、配置调整都必须重新 `build-and-push` 一次, **不能进容器改文件**
> - build 模式**仅供本地开发/测试**使用, 不要在生产服务器上跑
>
> 推送流程: 开发机 build → 推到 SWR → 生产服务器 pull → restart

## 重要提示：Mac Apple Silicon (M1/M2/M3) 构建多架构镜像

> ⚠️ **Mac Apple Silicon 推镜像到生产 (CentOS/amd64) 必须用 `./scripts/build-and-push.sh`**
>
> 我们的 `scripts/build-and-push.sh` 默认走 buildx + multi-arch manifest list:
> - 同时构建 `linux/amd64` (CentOS/RHEL) 和 `linux/arm64` (鲲鹏/飞腾/Apple Silicon)
> - push 到 SWR 的镜像是一个 **manifest list**, 生产 `docker pull` 时 Docker daemon 自动选匹配架构
>
> 常见踩坑:
>
> 1. **不要再用 `./scripts/build-and-push-huawei.sh`** — 该脚本已删除 (用 `docker build` 单架构, Mac M1 push arm64 only, CentOS 拉不到)
> 2. **不要在 Dockerfile 里写 `FROM xxx@sha256:...`** — sha256 是单架构 digest, 会导致 multi-arch build 失败
> 3. 第一次跑 buildx 会下载 buildkit image (~500MB) + qemu emulation, Mac M1 build 一次大约 10-20min
> 4. 如要单架构快速 build (只 build 当前 host arch): `SWR_PLATFORMS=linux/arm64 ./scripts/build-and-push.sh v1.0.0`
>
> 验证多架构镜像:
> ```bash
> docker buildx imagetools inspect swr.cn-north-4.myhuaweicloud.com/kavin/raos-backend:v1.0.0
> # 应该看到 ManifestList, 含 linux/amd64 + linux/arm64 两个 entry
> ```

## 目录结构

```
raos/
├── deploy/
│   ├── deploy.sh      # 一键部署
│   ├── upgrade.sh     # 一键升级
│   └── backup.sh      # 全量备份
├── docker-compose.yml # 生产环境编排
├── .env.example       # 环境变量模板
└── DEPLOY.md          # 本文件
```

---

## 一键部署（推荐）

### 交互式向导部署（全新环境）

```bash
# 1. 克隆代码
git clone <repo> && cd raos

# 2. 启动交互式部署向导
./deploy/deploy.sh
```

向导将引导你完成：
1. **选择部署方式**：本地构建 / 拉取远程镜像 / 纯镜像快速部署
2. **环境检查**：自动检测 Docker、端口占用、磁盘空间
3. **配置引导**：逐行填写必填项，自动生成强密码，可确认或修改
4. **可选配置**：LLM API Key、Neo4j 图数据库、Redis 密码等
5. **配置摘要**：部署前显示脱敏配置，确认后执行
6. **自动部署**：镜像准备 → 启动基础设施 → 数据库迁移 → 启动应用 → 健康检查

> 💡 **LLM API Key 无需预先配置**。在向导中可选择跳过，首次启动后登录系统，在「系统设置 → LLM 配置」中填写即可。

### 命令行快速部署

如果你熟悉配置，也可以直接通过参数部署：

```bash
# 本地构建镜像（开发/测试环境）
./deploy/deploy.sh --build

# 拉取远程镜像（生产环境，无需等待构建）
./deploy/deploy.sh

# 非交互模式（CI/CD 自动化场景）
./deploy/deploy.sh --non-interactive --build

# 纯镜像快速部署（无源码，仅下载配置文件和镜像）
./deploy/deploy.sh --quick
```

部署完成后访问：
- **前端**: http://localhost
- **API**: http://localhost:3000
- **健康检查**: http://localhost:3000/health

> ⚠️ 首次部署后请立即使用默认账号 `admin / admin` 登录并修改密码。

### 启用监控（可选）

```bash
docker compose --profile monitoring up -d
```

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001

---

## 镜像拉取部署（无需源码，推荐生产环境）

如果你只需要部署而不需要修改源码，可以直接拉取华为云 SWR 上的预编译镜像。后端镜像已使用 **bytenode 字节码编译**，源码不可见。

### 方式 1: 交互式向导（推荐）

下载部署脚本后启动交互式向导，自动下载配置文件并引导完成部署：

```bash
# 下载部署脚本
curl -O https://raw.githubusercontent.com/your-org/raos/main/deploy/deploy.sh
chmod +x deploy.sh

# 启动交互式向导（自动下载 docker-compose.yml、.env.example 等）
./deploy.sh --quick
```

向导会自动完成：下载配置 → 环境检查 → 引导填写环境变量 → 拉取镜像 → 启动服务 → 健康检查。

### 方式 2: 手动部署

如果你需要完全手动控制部署过程：

#### 1. 创建部署目录并下载文件

```bash
mkdir raos-deploy && cd raos-deploy

# 下载编排文件
curl -O https://raw.githubusercontent.com/your-org/raos/main/docker-compose.yml

# 下载环境变量模板
curl -O https://raw.githubusercontent.com/your-org/raos/main/.env.example

# 下载配置文件（docker-compose 挂载必需）
mkdir -p docker/frontend docker/mysql/init docker/rabbitmq
curl -o docker/frontend/nginx.conf \
  https://raw.githubusercontent.com/your-org/raos/main/docker/frontend/nginx.conf
curl -o docker/mysql/primary.cnf \
  https://raw.githubusercontent.com/your-org/raos/main/docker/mysql/primary.cnf
curl -o docker/rabbitmq/rabbitmq.conf \
  https://raw.githubusercontent.com/your-org/raos/main/docker/rabbitmq/rabbitmq.conf
```

#### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少填写以下必填项
vim .env
```

**必填环境变量**：

| 变量 | 说明 | 示例 |
|------|------|------|
| `JWT_SECRET` | JWT 签名密钥，≥32 位随机字符 | `openssl rand -base64 32` |
| `MYSQL_ROOT_PASSWORD` | MySQL root 密码 | 强密码 |
| `MYSQL_PASSWORD` | MySQL 应用密码 | 强密码 |
| `RABBITMQ_PASS` | RabbitMQ 密码 | 强密码 |
| `MINIO_PASSWORD` | MinIO 密码 | 强密码 |

**可选环境变量**：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | LLM API Key（也可首次启动后在系统设置中配置） | - |
| `LLM_BASE_URL` | LLM API 基础 URL | `https://api.openai.com/v1` |
| `REDIS_PASSWORD` | Redis 密码（生产环境强烈建议） | 空 |
| `NEO4J_AUTH` | Neo4j 认证（启用图数据库时） | `neo4j/raos` |
| `GRAPH_STORE_BACKEND` | 图存储后端：`mysql` / `neo4j` | `mysql` |
| `IMAGE_TAG` | 镜像版本标签 | `latest` |
| `LOG_LEVEL` | 日志级别 | `info` |

> 快速生成强密码：`openssl rand -base64 24`

#### 3. 启动服务

```bash
# 拉取镜像（首次或升级时）
docker compose pull

# 启动所有服务
docker compose up -d

# 查看服务状态（等待所有服务 healthy）
docker compose ps

# 查看后端启动日志
docker logs -f raos-backend
```

启动完成后访问：
- **前端**: http://localhost
- **API 健康检查**: http://localhost:3000/health
- **RabbitMQ 管理面板**: http://localhost:15672（guest/guest 已被禁用，使用 RABBITMQ_USER/RABBITMQ_PASS）

### 首次启动后初始化

#### 1. 登录系统

默认管理员账号：
- **用户名**: `admin`
- **密码**: `admin`

> ⚠️ 首次登录后请立即修改密码。

#### 2. 配置 LLM

如果部署时未在 `.env` 中配置 `LLM_API_KEY`，请在首次登录后进入 **系统设置 → LLM 配置**，填写：
- **API Key**: 你的 LLM 服务密钥，如 `sk-...`
- **Base URL**: 默认 `https://api.openai.com/v1`，或你的自定义代理地址
- **模型**: 如 `gpt-4o`, `deepseek-chat` 等

> 💡 推荐做法：生产环境将 `LLM_API_KEY` 留空，首次启动后由管理员在系统内配置，避免密钥硬编码在环境文件中。

也可通过 API 直接配置：
```bash
curl -X POST http://localhost:3000/api/config/llm \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -d '{
    "apiKey": "sk-your-key",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }'
```

#### 3. 验证功能

```bash
# 测试聊天接口
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -d '{"message": "Hello RAOS"}'
```

### 镜像地址

| 服务 | 镜像 | 说明 |
|------|------|------|
| 后端 API | `swr.cn-north-4.myhuaweicloud.com/kavin/raos-backend:latest` | bytenode 字节码保护 |
| Worker | `swr.cn-north-4.myhuaweicloud.com/kavin/raos-backend:latest` | 与后端共用镜像 |
| 前端 Web | `swr.cn-north-4.myhuaweicloud.com/kavin/raos-frontend:latest` | Vite + Nginx |
| MySQL | `mysql:8.0` | 主从复制（从库可选） |
| Redis | `redis:7-alpine` | 缓存 + Session |
| Qdrant | `qdrant/qdrant:v1.9.0` | 向量数据库 |
| RabbitMQ | `rabbitmq:3.12-management-alpine` | 消息队列 |
| MinIO | `minio/minio:RELEASE.2024-03-03T17-50-39Z` | 对象存储 |
| Neo4j | `neo4j:5.15.0-community` | 图数据库（可选） |

> 如需指定版本，修改 `.env` 中的 `IMAGE_TAG` 变量，或在 `docker-compose.yml` 中修改镜像标签。

---

## 版本升级

### 一键升级

```bash
# 升级到指定版本（从远程仓库拉取）
./deploy/upgrade.sh --version v1.2.0

# 本地重新构建后升级
./deploy/upgrade.sh --build

# 跳过自动备份（不推荐）
# ./deploy/upgrade.sh --version v1.2.0 --skip-backup
```

`upgrade.sh` 会自动完成以下操作：
1. **自动备份**（升级前全量备份，除非 `--skip-backup`）
2. **拉取/构建新镜像**
3. **数据库迁移**（在临时容器中执行，不影响运行中的服务）
4. **滚动重启**（先停 Worker → 重启后端 → 等待健康 → 重启 Worker + 前端）
5. **健康检查**（轮询 `/health`，超时 60 秒）
6. **失败自动回滚**（如健康检查失败，自动恢复上一版本）

### 数据持久化保障

所有数据存储在 Docker **命名卷**（named volumes）中：

| 服务 | 卷名 | 数据 |
|------|------|------|
| MySQL | `mysql_primary_data` | 所有业务数据 |
| Redis | `redis_data` | 缓存、会话 |
| Qdrant | `qdrant_storage` | 向量数据 |
| MinIO | `minio_data` | 文件对象 |
| Neo4j | `neo4j_data` | 图数据 |
| RabbitMQ | `rabbitmq_data` | 消息队列 |
| 后端/Worker | `raos_data` | WAL、配置(config.json)、LTM 记忆 |

**升级不会删除数据**：
- `docker compose up -d` 会保留现有卷
- 只有显式执行 `docker compose down -v` 才会清除数据
- 迁移脚本（`db:migrate`）只会增加/修改表结构，不会删除用户数据

### 手动升级（高级）

如果一键升级不满足需求，可以手动执行：

```bash
# 1. 备份数据卷（重要！）
docker run --rm \
  -v raos_mysql_primary_data:/mysql \
  -v raos_raos_data:/raos \
  -v $(pwd)/backups:/backup alpine \
  tar czf /backup/raos-backup-$(date +%Y%m%d_%H%M%S).tar.gz /mysql /raos

# 2. 拉取新镜像
docker compose pull

# 3. 滚动重启（先停 Worker，再重启后端，最后启动 Worker + 前端）
docker compose stop raos-workers
docker compose up -d raos-backend
# 等待后端 healthy（自动执行数据库迁移）
until curl -f http://localhost:3000/health; do sleep 5; done
docker compose up -d raos-workers raos-frontend

# 4. 验证
curl -f http://localhost:3000/health
curl -f http://localhost/health
```

> 数据库迁移在 **后端启动时自动执行**（`initDatabaseAsync` + `runInboxSchedulerMigration`），无需手动干预。升级后首次启动可能稍慢，请观察日志确认迁移成功。

---

## 备份与恢复

### 全量备份

```bash
# 一键全量备份
./deploy/backup.sh

# 指定输出目录和保留天数
./deploy/backup.sh --output /mnt/backup --retention 30
```

备份内容包含：
- MySQL 完整 dump（`mysql_full.sql.gz`）
- Redis RDB（`redis_dump.rdb`）
- Qdrant 向量存储（`qdrant_storage.tar.gz`）
- MinIO 对象存储（`minio_data.tar.gz`）
- Neo4j 图数据（`neo4j_data.tar.gz`）
- 后端/Worker 持久化数据（`raos_data.tar.gz`）— 包含 WAL、config.json、LTM
- 上传文件（`uploads.tar.gz`）
- 配置文件（`.env`、`docker-compose.yml`）

备份存储在 `backups/YYYYMMDD_HHMMSS/` 目录，默认保留 7 天。

### 恢复

```bash
# MySQL 恢复
zcat backups/20240115_120000/mysql_full.sql.gz | \
  docker exec -i raos-mysql-primary mysql -u root -p"$MYSQL_ROOT_PASSWORD" raos

# Redis 恢复（需先停止 Redis）
docker cp backups/20240115_120000/redis_dump.rdb raos-redis:/data/dump.rdb
docker restart raos-redis

# Qdrant/MinIO/Neo4j 恢复
docker run --rm -v <volume>:/target -v $(pwd)/backups/20240115_120000:/backup alpine \
  sh -c "cd /target && tar xzf /backup/qdrant_storage.tar.gz"
```

---

## 环境变量速查表

首次部署时 `deploy.sh` 会自动从 `.env.example` 生成 `.env` 并随机填充密码。以下是需要手动检查/修改的变量：

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `NODE_ENV` | 是 | `production` | 运行环境 |
| `JWT_SECRET` | 是 | 随机生成 | JWT 签名密钥（≥32 字符） |
| `MYSQL_ROOT_PASSWORD` | 是 | 随机生成 | MySQL root 密码 |
| `MYSQL_PASSWORD` | 是 | 随机生成 | MySQL 应用密码 |
| `REDIS_PASSWORD` | 否 | 随机生成 | Redis 密码 |
| `RABBITMQ_PASS` | 是 | 随机生成 | RabbitMQ 密码 |
| `MINIO_PASSWORD` | 是 | 随机生成 | MinIO 密码 |
| `NEO4J_PASSWORD` | 否 | - | Neo4j 密码（使用 Neo4j 时必填） |
| `LLM_API_KEY` | 否 | - | LLM API Key（OpenAI 兼容，也可系统内配置） |
| `LLM_BASE_URL` | 否 | - | LLM API 基础 URL |
| `ALLOWED_ORIGINS` | 是 | - | CORS 白名单，逗号分隔域名 |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `IMAGE_TAG` | 否 | `latest` | 镜像版本标签（升级时用） |

### 修改环境变量

```bash
# 编辑 .env
vim .env

# 重启生效
docker compose up -d
```

---

## 常用运维命令

```bash
# 查看所有服务状态
docker compose ps

# 查看日志
docker logs -f raos-backend
docker logs -f raos-frontend

# 进入容器调试
docker exec -it raos-backend sh

# 重启单个服务
docker compose restart raos-backend

# 停止所有服务（保留数据）
docker compose down

# 完全清除（⚠️ 删除所有数据卷）
docker compose down -v

# 查看资源占用
docker stats
```

---

## 故障排查

| 现象 | 排查 |
|------|------|
| 部署脚本报错 | 检查 Docker / Docker Compose 版本；检查 `.env` 是否存在 |
| 服务启动后无法访问 | 检查防火墙是否放行 80/443/3000 端口 |
| `/health` 返回 503 | 检查 MySQL/Redis/Qdrant 是否正常运行：`docker compose ps` |
| `/ready` 返回 503 | 检查数据库迁移是否成功：`docker logs raos-backend` |
| 升级后数据丢失 | 检查是否误执行了 `docker compose down -v`；从备份恢复 |
| LLM 无响应 | 检查系统设置中 LLM 配置；如通过环境变量配置，检查 `.env` 中 LLM API Key 和额度 |
| 内存溢出 OOM | 调整 `docker-compose.yml` 中的 `deploy.resources.limits` |
| 镜像拉取失败 / 400 Bad Request | 镜像使用 `docker buildx` 构建，确保 Docker ≥24.0；检查 SWR 登录状态 |
| 前端页面空白 / 404 | 检查 `docker/frontend/nginx.conf` 是否存在；检查 `.raos/ui` 卷数据 |
| Worker 未启动 / 队列堆积 | 检查 `raos-workers` 容器状态：`docker logs raos-workers` |
| SQLite 报错（生产环境） | 检查 `.env` 中 `USE_MYSQL=true` 是否设置；检查 MySQL 容器健康状态 |

---

## 多机部署（Swarm/K8s）

对于多节点高可用部署，请参考：
- `docker-compose.swarm.yml` — Docker Swarm 模式
- `k8s/` 目录（如有）— Kubernetes 部署清单
