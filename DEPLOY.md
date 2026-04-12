# RAOS 快速全镜像部署指南

## 镜像清单（全部来自华为云 SWR）

| 服务 | 镜像地址 | 状态 |
|------|----------|------|
| MySQL | `swr.cn-north-4.myhuaweicloud.com/kavin/mysql:8.0` | ✅ 已推送 |
| Redis | `swr.cn-north-4.myhuaweicloud.com/kavin/redis:7-alpine` | ✅ 已推送 |
| RabbitMQ | `swr.cn-north-4.myhuaweicloud.com/kavin/rabbitmq:3.12-management-alpine` | ✅ 已推送 |
| Qdrant | `swr.cn-north-4.myhuaweicloud.com/kavin/qdrant:v1.9.0` | ✅ 已推送 |
| Backend | `swr.cn-north-4.myhuaweicloud.com/kavin/raos-backend:{VERSION}` | ✅ 已推送 |
| Frontend | `swr.cn-north-4.myhuaweicloud.com/kavin/raos-frontend:{VERSION}` | ✅ 已推送 |

## 快速启动（本地测试）

```bash
# 启动基础设施（全部从华为云拉取）
docker-compose -f docker-compose.local.yml up -d

# 查看状态
docker ps
```

## 服务端口

| 服务 | 端口 | 访问地址 |
|------|------|----------|
| MySQL | 3306 | localhost:3306 |
| Redis | 6379 | localhost:6379 |
| RabbitMQ | 5672, 15672 | localhost:15672 (raos/raospassword) |
| Qdrant | 6333 | localhost:6333 |

## 生产部署

```bash
# 单机部署
sudo ./deploy.sh standalone v1.0.0

# 集群部署
sudo ./deploy.sh cluster v1.0.0
```

## 推送基础镜像（管理员）

如需更新基础镜像：

```bash
./scripts/push-all-base-images.sh
```
