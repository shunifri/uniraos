# RAOS 部署文档

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                         Nginx (Load Balancer)                   │
└──────────────┬─────────────────────────────────┬────────────────┘
               │                                 │
   ┌───────────▼──────────┐       ┌──────────────▼───────────────┐
   │   RAOS Node 1        │       │   RAOS Node 2 (可扩展)       │
   └───────┬──────────────┘       └──────────────┬───────────────┘
           │                                     │
           └──────────────────┬──────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │      Redis Cluster             │
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

### 方式 1: 本地开发 (推荐)

```bash
# 1. 安装依赖服务
brew install mysql redis

# 2. 启动服务
./scripts/setup-local.sh

# 3. 配置环境
cp .env.example .env

# 4. 启动应用
npm run dev
```

### 方式 2: Docker Compose (完整环境)

```bash
# 1. 启动基础设施
docker-compose -f docker-compose.infra.yml up -d

# 2. 启动应用
docker-compose -f docker-compose.app.yml up -d

# 3. 启动监控
docker-compose -f docker-compose.monitoring.yml up -d
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MYSQL_PRIMARY_HOST` | MySQL 主库地址 | localhost |
| `REDIS_HOSTS` | Redis 地址 | localhost:6379 |
| `QDRANT_HOST` | Qdrant 地址 | localhost |
| `RABBITMQ_URL` | RabbitMQ URL | amqp://localhost:5672 |
| `JWT_SECRET` | JWT 密钥 | - |

## 监控

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001
- **RabbitMQ Management**: http://localhost:15672

## 性能测试

```bash
# 简单测试
node tests/performance/simple-load-test.js

# k6 测试 (如果已安装)
k6 run tests/performance/k6-script.js
```

## 故障排查

### 检查服务状态

```bash
curl http://localhost:3000/health
```

### 查看日志

```bash
# 本地日志
tail -f logs/app.log

# Docker 日志
docker-compose logs -f raos-node-1
```

## 扩展指南

### 添加更多应用节点

编辑 `docker-compose.app.yml`，添加 `raos-node-3` 等服务。

### 配置 MySQL 主从

参考 `mysql/primary.cnf` 和 `mysql/replica.cnf` 配置文件。

## 更多信息

- [本地开发设置](./local-dev-setup.md)
- [架构设计](../superpowers/specs/2026-04-10-raos-mysql-scalability-design.md)
