# RAOS 基础设施迁移设计文档

## 1. 当前架构分析

### 1.1 数据源清单

| 数据源 | 位置 | 类型 | 用途 | 优先级 |
|--------|------|------|------|--------|
| raos.db | .raos/raos.db | SQLite | 主数据库（用户、角色、权限、会话、聊天） | P0 |
| evolution.db | .raos/evolution.db | SQLite | 进化引擎数据 | P0 |
| api-registry.db | .raos/api-registry.db | SQLite | API 技能注册表 | P1 |
| LTM | .raos/ltm/ | 文件系统 | 长期记忆存储 | P1 |
| 知识库 | .raos/knowledge/ | 文件+向量 | 文档和向量索引 | P0 |
| WAL | .raos/wal.jsonl | JSONL | 预写日志 | P2 |
| 配置 | .raos/config.json | JSON | 系统配置 | P0 |

### 1.2 目标基础设施

```yaml
MySQL (Docker):
  host: localhost:3307
  database: raos
  user: raos
  password: raospassword
  用途: 主数据存储（替代 SQLite）
  
Qdrant (Docker):
  host: localhost:6334
  用途: 向量存储（知识库向量）
  
Redis (Docker):
  host: localhost:6380
  用途: 缓存、会话、消息队列
```

## 2. 迁移方案

### 方案 A: 完整 MySQL 迁移（推荐）

将所有 SQLite 数据迁移到 MySQL，包括：
- 主数据库表（用户、角色、权限等）
- Evolution 数据
- API Registry 数据
- LTM 元数据（实际数据存 Redis）

**优点：**
- 统一的关系型数据库管理
- 更好的并发支持
- 易于备份和恢复
- 支持主从复制

**缺点：**
- 需要数据类型转换
- 外键关系需要重新建立

### 方案 B: 混合存储（备选）

- MySQL: 核心业务数据
- SQLite: 保留部分本地数据
- Qdrant: 向量数据
- Redis: 缓存和会话

**缺点：** 数据分散，维护复杂

## 3. 数据库 Schema 设计

### 3.1 主数据库（MySQL）

包含以下模块：
1. **用户权限模块**: users, roles, permissions, user_roles, role_permissions
2. **组织架构模块**: departments, department_resources
3. **会话聊天模块**: sessions, conversations, chat_messages
4. **资源管理模块**: resources, share_rules
5. **知识库模块**: kb_documents, kb_chunks（元数据）
6. **LTM 模块**: ltm_facts, ltm_entities
7. **Evolution 模块**: evolution_generations, evolution_violations, evolution_approvals
8. **API Registry 模块**: api_services, api_endpoints
9. **系统配置模块**: system_config

### 3.2 向量存储（Qdrant）

Collections:
- `kb_vectors`: 知识库文档向量
- `memory_vectors`: 记忆向量

### 3.3 缓存（Redis）

Keys:
- `session:{token}`: 用户会话
- `cache:{key}`: 应用缓存
- `ltm:{user_id}:{key}`: LTM 数据
- `queue:{name}`: 消息队列

## 4. 迁移步骤

### Phase 1: 准备
1. 创建完整的 MySQL Schema
2. 准备数据迁移脚本
3. 备份现有数据

### Phase 2: 数据迁移
1. 导出 SQLite 数据为 SQL/JSON
2. 转换数据格式（时间戳、JSON 等）
3. 导入到 MySQL
4. 验证数据完整性

### Phase 3: 应用改造
1. 更新数据库连接配置
2. 修改代码使用 MySQL 连接
3. 添加 Redis 缓存层
4. 配置 Qdrant 向量存储

### Phase 4: 验证
1. 功能测试
2. 性能测试
3. 数据一致性检查

## 5. 风险控制

### 回滚方案
- 保留原始 SQLite 数据库备份
- 应用支持双模式运行（SQLite/MySQL）
- 配置热切换

### 数据一致性检查
- 记录数对比
- 关键业务数据校验
- 外键关系验证

