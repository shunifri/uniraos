# RAOS 运维手册

## 日常运维

### 服务状态检查

```bash
# 健康检查
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

### 日志管理

```bash
# 查看应用日志
tail -f logs/app.log | grep ERROR

# 查看 MySQL 慢查询
mysql -u root -e "SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10;"
```

### 备份策略

```bash
# MySQL 全量备份
mysqldump -u root -p raos > backup_$(date +%Y%m%d).sql

# Redis 备份
redis-cli BGSAVE
cp /usr/local/var/db/redis/dump.rdb backup/
```

## 故障处理

### MySQL 主库故障

```bash
# 切换到从库，提升为主库
STOP SLAVE; RESET SLAVE ALL;
```

### Redis 故障

```bash
brew services restart redis
```

## 性能优化

```sql
-- 分析慢查询
ANALYZE TABLE kb_documents;
OPTIMIZE TABLE kb_chunks;
```

## 升级指南

```bash
# 滚动升级
git pull
npm install
npm run db:migrate
# 重启节点
docker-compose restart raos-node-2
sleep 30
docker-compose restart raos-node-1
```
