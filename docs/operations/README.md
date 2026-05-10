# RAOS 运维手册

## SLO / SLA 定义

| SLO | 目标 | 测量方式 | 错误预算 |
|-----|------|----------|----------|
| **可用性** | > 99.9% | `/health` 200 响应率 | 0.1% / 月 (~43min) |
| **p99 延迟** | < 500ms | Prometheus `http_request_duration_seconds` | — |
| **错误率** | < 1% | 5xx 响应占比 | — |
| **WAL 恢复时间** | < 5s | 从进程启动到 WAL replay 完成 | — |
| **部署频率** | 按需 | 无固定窗口 | — |
| **回滚时间** | < 2min | 从告警触发到旧版本恢复 | — |

## 日常检查清单

### 每日
- [ ] 检查 `/health` 端点状态
- [ ] 查看错误日志（搜索 `[FATAL]`、`[ERROR]`）
- [ ] 确认备份任务执行成功

### 每周
- [ ] 检查磁盘使用率（MySQL、WAL、日志）
- [ ] 检查 Redis 内存使用
- [ ] 审查 `/metrics` 中的请求延迟和错误率

## 日志查看

```bash
# 查看实时日志（JSON 格式）
tail -f /var/log/raos/app.log | jq

# 搜索特定用户的请求
cat /var/log/raos/app.log | jq 'select(.userId == "user_xxx")'

# 搜索错误
cat /var/log/raos/app.log | jq 'select(.level == "error")'
```

## 监控告警

| 指标 | 阈值 | 告警级别 |
|------|------|---------|
| /ready 返回 503 | 持续 30s | P1 |
| 请求错误率 > 5% | 5min | P1 |
| 平均响应时间 > 5s | 5min | P2 |
| MySQL 连接池使用率 > 80% | - | P2 |
| 磁盘使用率 > 85% | - | P2 |

## 扩容步骤

### 水平扩容（后端）

```bash
# 1. 配置负载均衡（Nginx）
upstream raos_backend {
    server raos-1:3000;
    server raos-2:3000;
}

# 2. 启动新实例
docker-compose up -d --scale raos-backend=2
```

### 垂直扩容

1. 增加 MySQL 连接池：`MYSQL_CONN_LIMIT`
2. 增加 Worker 进程数：启动多个 `node dist/workers/index.js`
3. 增加 Redis 内存：`--maxmemory`

## 常用命令

```bash
# 手动触发 WAL 压缩
curl -X POST http://localhost:3000/api/admin/wal/compact

# 查看知识图谱统计
curl http://localhost:3000/api/graph/stats

# 重建知识库索引
curl -X POST http://localhost:3000/api/knowledge/rebuild
```
