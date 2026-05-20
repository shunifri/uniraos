# RAOS 部署文档

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                         Nginx (Frontend)                        │
└──────────────┬─────────────────────────────────┬────────────────┘
               │                                 │
   ┌───────────▼──────────┐       ┌──────────────▼───────────────┐
   │   RAOS Backend       │◄─────►│   RAOS Workers               │
   └───────┬──────────────┘       └──────────────────────────────┘
           │
           └──────────────────┬──────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │      Redis                     │
              │   - Session / Cache / Pub-Sub  │
              └───────────────┬────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │      RabbitMQ                  │
              │   - Async Task Queue           │
              └───────────────┬────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │      MySQL 8.0 + Qdrant        │
              └────────────────────────────────┘
```

## 快速开始

### 方式 1: 生产部署 (推荐)

使用一键部署脚本，自动完成环境检查、配置生成、服务启动：

```bash
# 1. 克隆代码
git clone <repo> && cd raos

# 2. 一键部署（自动构建镜像 + 生成配置 + 启动全部服务）
./deploy/deploy.sh --build
```

详细说明参见项目根目录的 [DEPLOY.md](../../DEPLOY.md)。

### 方式 2: 本地开发

```bash
# 1. 安装依赖
npm install
cd web && npm install && cd ..

# 2. 启动基础设施（MySQL、Redis、Qdrant、RabbitMQ）
docker compose -f docker-compose.local.yml up -d

# 3. 配置环境
cp .env.example .env
# 编辑 .env，填写必填项（JWT_SECRET、MYSQL_PASSWORD、RABBITMQ_PASS、MINIO_PASSWORD）
# LLM API Key 可留空，启动后在系统设置中配置

# 4. 运行数据库迁移
npm run db:migrate

# 5. 启动开发服务器（前后端热更新）
npm run dev
```

详细说明参见 [本地开发设置](./local-dev-setup.md)。

## 环境变量

| 变量 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `JWT_SECRET` | 是 | JWT 签名密钥（≥32 位） | - |
| `MYSQL_PASSWORD` | 是 | MySQL 应用密码 | - |
| `RABBITMQ_PASS` | 是 | RabbitMQ 密码 | - |
| `MINIO_PASSWORD` | 是 | MinIO 密码 | - |
| `LLM_API_KEY` | 否 | LLM API Key（也可系统内配置） | - |
| `LLM_BASE_URL` | 否 | LLM API 基础 URL | `https://api.openai.com/v1` |
| `NEO4J_AUTH` | 否 | Neo4j 认证（启用图数据库时） | `neo4j/raos` |
| `REDIS_PASSWORD` | 否 | Redis 密码 | - |
| `LOG_LEVEL` | 否 | 日志级别 | `info` |

> 💡 **关于 LLM API Key**：系统支持在运行时通过 **系统设置 → LLM 配置** 页面或 `/api/config/llm` API 进行配置，无需在 `.env` 中硬编码。

## 监控

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001
- **RabbitMQ Management**: http://localhost:15672

启用监控：
```bash
docker compose --profile monitoring up -d
```

## 性能测试

```bash
# 简单测试
node tests/performance/simple-load-test.js
```

## 故障排查

### 检查服务状态

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

### 查看日志

```bash
# 本地日志
tail -f logs/app.log

# Docker 日志
docker logs -f raos-backend
docker logs -f raos-workers
```

## 更多信息

- [DEPLOY.md](../../DEPLOY.md) — 详细部署与运维指南
- [本地开发设置](./local-dev-setup.md) — 本地环境搭建
- [架构设计](../ARCHITECTURE.md) — 系统架构设计
