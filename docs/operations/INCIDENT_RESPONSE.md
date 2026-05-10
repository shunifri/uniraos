# RAOS 故障响应手册

## 常见故障

### 1. 服务无法启动

**症状**: `node dist/server.js` 立即退出

**排查**:
```bash
# 检查 JWT_SECRET
node -e "if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) { console.error('JWT_SECRET invalid'); process.exit(1) }"

# 检查 MySQL 连通性
curl http://localhost:3000/ready

# 查看启动日志
node dist/server.js 2>&1 | head -n 50
```

**解决**: 确保 `.env` 中所有必填变量已设置，依赖服务已启动。

### 2. 数据库连接失败

**症状**: `/ready` 返回 503，日志显示 MySQL 错误

**排查**:
```bash
docker logs raos-mysql-primary
mysql -h localhost -P 3306 -u raos -p -e "SELECT 1"
```

**解决**:
- 检查 MySQL 容器状态：`docker ps | grep mysql`
- 检查密码是否正确
- 检查连接数是否耗尽：`SHOW PROCESSLIST;`

### 3. LLM 调用超时

**症状**: Agent 响应慢，日志显示 `timed out`

**排查**:
```bash
# 检查 LLM provider 配置
curl http://localhost:3000/api/config/llm

# 测试直接调用 LLM API
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}'
```

**解决**:
- 检查 API Key 余额
- 调整 `chatTimeout` 配置
- 切换到备用模型

### 4. 内存溢出

**症状**: OOM Killer，服务崩溃

**排查**:
```bash
# 查看内存使用
free -h
docker stats --no-stream

# 查看 Node.js 堆内存
node --expose-gc -e "const v8 = require('v8'); console.log(v8.getHeapStatistics())"
```

**解决**:
- 增加服务器内存
- 减少 `MYSQL_CONN_LIMIT`
- 限制 Worker 并发数
- 重启服务释放内存

## 回滚流程

```bash
# 1. 停止服务
pm2 stop raos

# 2. 恢复代码
git checkout <previous-tag>

# 3. 恢复数据库（如需要）
./scripts/restore.sh mysql /var/backups/raos/mysql/full_xxx.sql

# 4. 重新构建并启动
npm run build
pm2 start dist/server.js --name raos
```

## 联系人

| 角色 | 职责 |
|------|------|
| 值班工程师 | 故障响应、初步排查 |
| 系统架构师 | 复杂故障、架构调整 |
| DBA | 数据库故障、数据恢复 |
