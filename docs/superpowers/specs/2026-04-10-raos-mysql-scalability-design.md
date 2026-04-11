# RAOS MySQL 可扩展架构设计

## 概述

将 RAOS 从 SQLite 单文件架构升级为 MySQL 主从集群架构，支持水平扩展至 100+ 并发用户。

## 设计约束

- **数据库**: MySQL 8.0+（使用 mysql2 驱动）
- **并发目标**: 100+ 并发用户
- **扩展策略**: 水平扩展优先
- **部署模式**: 开源优先，自托管

## 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Load Balancer (Nginx/HAProxy)                │
│                     - SSL Termination                           │
│                     - Rate Limiting                             │
│                     - Health Checks                             │
└──────────────┬─────────────────────────────────┬────────────────┘
               │                                 │
   ┌───────────▼──────────┐       ┌──────────────▼───────────────┐
   │   RAOS Node 1        │       │   RAOS Node 2 (可扩展)       │
   │   - Express API      │       │   - Express API              │
   │   - Skill Execution  │       │   - Skill Execution          │
   │   - 无状态设计       │       │   - 无状态设计               │
   └───────┬──────────────┘       └──────────────┬───────────────┘
           │                                     │
           └──────────────────┬──────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │      Redis Cluster (6节点)     │
              │   ┌────────────────────────┐   │
              │   │ - Session Store        │   │
              │   │ - Rate Limit Counter   │   │
              │   │ - Cache Layer          │   │
              │   │ - Pub/Sub for SSE      │   │
              │   │ - Distributed Lock     │   │
              │   └────────────────────────┘   │
              └───────────────┬────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │    RabbitMQ / Apache Pulsar    │
              │   ┌────────────────────────┐   │
              │   │ - LLM Request Queue    │   │
              │   │ - Async Task Queue     │   │
              │   │ - Dead Letter Queue    │   │
              │   │ - Delayed Jobs         │   │
              │   └────────────────────────┘   │
              └───────────────┬────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │      MySQL 8.0 Cluster         │
              │   ┌────────────────────────┐   │
              │   │  ┌──────────────────┐  │   │
              │   │  │   Primary Node   │  │   │
              │   │  │  (Write + Read)  │  │   │
              │   │  └────────┬─────────┘  │   │
              │   │           │ Binlog     │   │
              │   │  ┌────────▼─────────┐  │   │
              │   │  │  Replica Node 1  │  │   │
              │   │  │    (Read Only)   │  │   │
              │   │  └────────┬─────────┘  │   │
              │   │  ┌────────▼─────────┐  │   │
              │   │  │  Replica Node 2  │  │   │
              │   │  │    (Read Only)   │  │   │
              │   │  └──────────────────┘  │   │
              │   └────────────────────────┘   │
              │         ProxySQL (可选)         │
              │    - 自动读写分离               │
              │    - 连接池管理                 │
              └────────────────────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │      MinIO Cluster             │
              │   - 文档文件存储               │
              │   - 知识库图片/视频            │
              │   - 备份归档                   │
              └────────────────────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │    Milvus / Qdrant Cluster     │
              │   - 向量存储与检索             │
              │   - 近似最近邻搜索 (ANN)       │
              │   - 混合检索 (向量+标量)       │
              └────────────────────────────────┘
```

## 详细设计

### 1. MySQL 数据库层

#### 1.1 主从复制架构

**主节点 (Primary)**:
- 负责所有写入操作 (INSERT, UPDATE, DELETE)
- 半同步复制 (semi-sync) 保证数据一致性
- binlog 格式: ROW 模式

**从节点 (Replicas)**:
- 2-3 个只读副本
- 负载均衡读请求
- 故障时自动提升为主节点

#### 1.2 连接池配置

```typescript
// 主库连接池 (写操作)
const primaryPool = mysql.createPool({
  host: process.env.MYSQL_PRIMARY_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: 'raos',
  connectionLimit: 20,        // 主库连接数限制
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true
});

// 从库连接池 (读操作)
const replicaPool = mysql.createPoolCluster();
replicaPool.add('REPLICA1', { host: '...', connectionLimit: 30 });
replicaPool.add('REPLICA2', { host: '...', connectionLimit: 30 });
```

#### 1.3 读写分离策略

```typescript
// 数据库路由中间件
class DatabaseRouter {
  // 写操作路由到主库
  async write(sql: string, params: any[]) {
    return primaryPool.execute(sql, params);
  }
  
  // 读操作路由到从库 (轮询/随机)
  async read(sql: string, params: any[]) {
    const replica = this.getLeastLoadedReplica();
    return replica.execute(sql, params);
  }
}
```

#### 1.4 Schema 优化

**索引策略**:
```sql
-- 用户表优化
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  department_id VARCHAR(36),
  status ENUM('active', 'disabled', 'deleted') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_department (department_id),
  INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 知识库分片策略（按用户ID哈希）
CREATE TABLE kb_documents_0 LIKE kb_documents_template;
CREATE TABLE kb_documents_1 LIKE kb_documents_template;
-- ... 分片数量根据数据量动态调整
```

### 2. Redis 缓存层

#### 2.1 缓存策略

| 数据类型 | 缓存策略 | TTL |
|---------|---------|-----|
| 用户 Session | 集中存储 | 24h |
| 技能元数据 | 本地缓存 + Redis | 5min |
| 知识库搜索结果 | 分布式缓存 | 10min |
| LLM Token 计数 | Redis Counter | 1h |
| 频率限制 | Sliding Window | 1min |

#### 2.2 Session 外置

```typescript
// Redis Session Store
class RedisSessionStore {
  async get(sessionId: string): Promise<SessionData> {
    return redis.get(`session:${sessionId}`);
  }
  
  async set(sessionId: string, data: SessionData, ttl: number) {
    return redis.setex(`session:${sessionId}`, ttl, JSON.stringify(data));
  }
}
```

### 3. 消息队列层

#### 3.1 队列设计

```typescript
// 队列定义
const QUEUES = {
  // LLM 请求队列（削峰填谷）
  LLM_REQUESTS: 'llm:requests',
  
  // 异步任务队列
  ASYNC_TASKS: 'tasks:async',
  
  // 文档解析队列
  DOC_PARSING: 'docs:parsing',
  
  // 记忆整理队列
  MEMORY_CONSOLIDATION: 'memory:consolidation',
  
  // 死信队列
  DLQ: 'dead:letter'
};
```

#### 3.2 生产者-消费者模式

```typescript
// LLM 请求生产者
class LLMRequestProducer {
  async enqueue(request: LLMRequest) {
    await rabbitmq.publish(QUEUES.LLM_REQUESTS, {
      ...request,
      priority: request.urgent ? 10 : 5,
      timestamp: Date.now()
    });
  }
}

// LLM 请求消费者（多实例）
class LLMRequestConsumer {
  async start() {
    await rabbitmq.consume(QUEUES.LLM_REQUESTS, async (msg) => {
      const result = await this.processLLMRequest(msg);
      // 通过 Redis Pub/Sub 通知结果
      await redis.publish(`llm:result:${msg.correlationId}`, result);
    });
  }
}
```

### 4. 应用层改造

#### 4.1 无状态化改造

**需要移除/修改的组件**:

```typescript
// ❌ 移除：内存中的执行历史
// private history: ExecutionResult[] = [];

// ✅ 替换为：Redis 存储
class ExecutionHistoryStore {
  async append(userId: string, result: ExecutionResult) {
    await redis.lpush(`history:${userId}`, JSON.stringify(result));
    await redis.ltrim(`history:${userId}`, 0, 999); // 保留最近1000条
  }
}

// ❌ 移除：本地 WAL 文件存储
// const walStore = new FileWALStore(...);

// ✅ 替换为：MySQL WAL 表
class MySQLWALStore {
  async append(entry: WALEntry) {
    await db.execute(
      'INSERT INTO wal_entries (id, data, created_at) VALUES (?, ?, NOW())',
      [entry.id, JSON.stringify(entry)]
    );
  }
}
```

#### 4.2 数据库访问层重构

```typescript
// 抽象数据库接口
interface DatabaseAdapter {
  query(sql: string, params: any[]): Promise<any[]>;
  execute(sql: string, params: any[]): Promise<any>;
  transaction<T>(fn: (trx: Transaction) => Promise<T>): Promise<T>;
}

// MySQL 实现
class MySQLAdapter implements DatabaseAdapter {
  private primaryPool: Pool;
  private replicaPool: PoolCluster;
  
  // 写操作
  async execute(sql: string, params: any[]) {
    const [result] = await this.primaryPool.execute(sql, params);
    return result;
  }
  
  // 读操作
  async query(sql: string, params: any[]) {
    const [rows] = await this.replicaPool.execute(sql, params);
    return rows;
  }
}
```

### 5. 部署架构

#### 5.1 Docker Compose 配置

```yaml
# docker-compose.yml
version: '3.8'

services:
  # MySQL 主节点
  mysql-primary:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: raos
    volumes:
      - mysql_primary_data:/var/lib/mysql
      - ./mysql/primary.cnf:/etc/mysql/conf.d/custom.cnf
    command: --server-id=1 --log-bin=mysql-bin --binlog-format=ROW
    
  # MySQL 从节点 1
  mysql-replica-1:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
    volumes:
      - mysql_replica1_data:/var/lib/mysql
      - ./mysql/replica.cnf:/etc/mysql/conf.d/custom.cnf
    command: --server-id=2 --read-only=1
    
  # Redis Cluster
  redis-node-1:
    image: redis:7-alpine
    command: redis-server --appendonly yes --cluster-enabled yes
    volumes:
      - redis1_data:/data
      
  # RabbitMQ
  rabbitmq:
    image: rabbitmq:3-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS}
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
      
  # RAOS 应用节点 (可横向扩展)
  raos-node-1:
    build: .
    environment:
      NODE_ENV: production
      MYSQL_PRIMARY_HOST: mysql-primary
      MYSQL_REPLICA_HOSTS: mysql-replica-1,mysql-replica-2
      REDIS_HOSTS: redis-node-1:6379,redis-node-2:6379
      RABBITMQ_HOST: rabbitmq
    depends_on:
      - mysql-primary
      - redis-node-1
      - rabbitmq
      
  # Nginx 负载均衡
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - raos-node-1

volumes:
  mysql_primary_data:
  mysql_replica1_data:
  redis1_data:
  rabbitmq_data:
```

#### 5.2 Kubernetes 部署 (可选)

```yaml
# k8s/raos-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: raos-app
spec:
  replicas: 3  # 可水平扩展
  selector:
    matchLabels:
      app: raos
  template:
    metadata:
      labels:
        app: raos
    spec:
      containers:
      - name: raos
        image: raos:latest
        env:
        - name: MYSQL_PRIMARY_HOST
          valueFrom:
            secretKeyRef:
              name: mysql-secret
              key: primary-host
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: raos-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: raos-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### 6. 向量数据库层 (Milvus/Qdrant)

#### 6.1 为什么需要专用向量数据库？

| 特性 | MySQL VECTOR | 专用向量数据库 |
|------|--------------|----------------|
| 维度支持 | 最多 1024 维 | 无限制 |
| 索引类型 | 暴力搜索 | HNSW、IVF、DiskANN 等 |
| 查询性能 (100万向量) | ~500ms | ~10ms |
| 混合检索 | 不支持 | 支持向量+标量过滤 |
| 并发能力 | 低 | 高 (分布式) |

#### 6.2 架构选择：Qdrant (推荐)

**选择 Qdrant 的理由**:
- 开源 (Apache 2.0)，完全自托管
- 纯 Rust 实现，性能优异
- 支持混合检索（向量 + payload 过滤）
- 分布式集群原生支持
- 与 MySQL 配合良好

```
┌─────────────────────────────────────────────────┐
│              Qdrant Cluster                     │
│                                                 │
│   ┌─────────────┐      ┌─────────────┐         │
│   │   Node 1    │◄────►│   Node 2    │         │
│   │  (Shard 1)  │  Raft│  (Shard 2)  │         │
│   └──────┬──────┘      └──────┬──────┘         │
│          │                    │                 │
│   ┌──────▼────────────────────▼──────┐          │
│   │      Qdrant API (gRPC/HTTP)      │          │
│   │   - 向量插入/更新/删除           │          │
│   │   - 相似度搜索                   │          │
│   │   - Payload 过滤                 │          │
│   └──────────────────────────────────┘          │
└─────────────────────────────────────────────────┘
```

#### 6.3 数据模型映射

```typescript
// MySQL 存储元数据
interface ChunkMetadata {
  id: string;           // UUID
  doc_id: string;       // 关联文档
  content: string;      // 文本内容
  content_type: 'text' | 'image' | 'video' | 'audio';
  page_number?: number;
  created_at: Date;
}

// Qdrant 存储向量
interface VectorPoint {
  id: string;           // 与 MySQL id 一致
  vector: number[];     // 1536 维 (OpenAI) 或 768 维 (本地)
  payload: {
    doc_id: string;     // 用于过滤
    content_type: string;
    page_number?: number;
    // 不存储完整 content，只存索引字段
  }
}
```

#### 6.4 混合检索实现

```typescript
class HybridSearchService {
  constructor(
    private mysql: MySQLAdapter,
    private qdrant: QdrantClient
  ) {}
  
  async search(params: SearchParams) {
    // Step 1: Qdrant 向量检索 (Top-K)
    const vectorResults = await this.qdrant.search('kb_chunks', {
      vector: params.embedding,
      limit: params.limit * 3,  // 扩大召回
      filter: {
        must: [
          { key: 'doc_id', match: { any: params.docIds } },
          { key: 'content_type', match: { value: params.contentType } }
        ]
      }
    });
    
    // Step 2: MySQL 获取完整元数据
    const ids = vectorResults.map(r => r.id);
    const metadata = await this.mysql.query(
      'SELECT * FROM kb_chunks WHERE id IN (?)',
      [ids]
    );
    
    // Step 3: 合并结果
    return this.mergeResults(vectorResults, metadata);
  }
}
```

#### 6.5 部署配置

```yaml
# docker-compose.qdrant.yml
version: '3.8'

services:
  qdrant-node-1:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"  # HTTP API
      - "6334:6334"  # gRPC API
    volumes:
      - qdrant_storage:/qdrant/storage
    environment:
      QDRANT__CLUSTER__ENABLED: "true"
      QDRANT__CLUSTER__P2P__PORT: "6335"
    command: ./qdrant --uri http://qdrant-node-1:6335
    
  qdrant-node-2:
    image: qdrant/qdrant:latest
    volumes:
      - qdrant_storage_2:/qdrant/storage
    environment:
      QDRANT__CLUSTER__ENABLED: "true"
    command: ./qdrant --bootstrap http://qdrant-node-1:6335 --uri http://qdrant-node-2:6335
    
volumes:
  qdrant_storage:
  qdrant_storage_2:
```

#### 6.6 现有向量数据迁移

```typescript
// 迁移脚本
async function migrateVectors() {
  const batchSize = 1000;
  let offset = 0;
  
  while (true) {
    // 1. 从 SQLite 读取批次
    const chunks = sqlite.prepare(
      'SELECT id, vector, doc_id, content_type FROM kb_chunks WHERE vector IS NOT NULL LIMIT ? OFFSET ?'
    ).all(batchSize, offset);
    
    if (chunks.length === 0) break;
    
    // 2. 转换向量格式
    const points = chunks.map(c => ({
      id: c.id,
      vector: Array.from(new Float32Array(c.vector.buffer)),
      payload: {
        doc_id: c.doc_id,
        content_type: c.content_type
      }
    }));
    
    // 3. 批量插入 Qdrant
    await qdrant.upsert('kb_chunks', { points });
    
    offset += batchSize;
    console.log(`Migrated ${offset} vectors...`);
  }
}
```

## 数据迁移策略

### 迁移步骤

1. **Schema 迁移**:
   ```bash
   # 导出 SQLite Schema
   sqlite3 raos.db .schema > schema.sql
   
   # 转换为 MySQL 语法
   # - AUTOINCREMENT → AUTO_INCREMENT
   # - TEXT → VARCHAR/TEXT
   # - INTEGER → INT/BIGINT
   # - 添加 ENGINE=InnoDB
   ```

2. **数据导出/导入**:
   ```bash
   # 使用工具导出为 CSV
   sqlite3 raos.db -csv "SELECT * FROM users" > users.csv
   
   # MySQL 导入
   LOAD DATA INFILE '/path/users.csv' INTO TABLE users
   FIELDS TERMINATED BY ',' ENCLOSED BY '"';
   ```

3. **零停机迁移**:
   - 双写阶段：同时写入 SQLite 和 MySQL
   - 验证数据一致性
   - 切换读取到 MySQL
   - 停止 SQLite 写入

## 性能基准

| 指标 | 当前 (SQLite) | 目标 (MySQL + Qdrant 集群) |
|------|---------------|---------------------------|
| 并发连接 | 1 | 100+ |
| QPS (读) | ~500 | 5000+ |
| QPS (写) | ~100 | 2000+ |
| 向量检索延迟 (100万) | ~2000ms | ~20ms |
| 混合检索延迟 | N/A | ~50ms |
| 平均延迟 | 10ms | <50ms (P99) |
| 可用性 | 单点 | 99.9% |
| 数据容量 | 单文件限制 | 无限制 (水平扩展) |

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 数据迁移失败 | 高 | 完整备份，回滚脚本 |
| 主从延迟 | 中 | 读写分离策略，延迟监控 |
| Redis 单点 | 中 | Redis Cluster 模式 |
| 网络分区 | 中 | 熔断机制，降级策略 |

## 实施计划

| 阶段 | 任务 | 预计时间 | 依赖 |
|------|------|----------|------|
| Phase 1 | MySQL 部署 + Schema 迁移 | 3 天 | 无 |
| Phase 2 | 数据库访问层重构 | 5 天 | Phase 1 |
| Phase 3 | Redis 集成 + Session 外置 | 3 天 | Phase 2 |
| Phase 4 | Qdrant 部署 + 向量迁移 | 4 天 | Phase 2 |
| Phase 5 | 混合检索服务实现 | 3 天 | Phase 4 |
| Phase 6 | 消息队列 + 异步化 | 5 天 | Phase 3 |
| Phase 7 | 负载均衡 + 多节点部署 | 3 天 | Phase 5,6 |
| Phase 8 | 性能测试 + 优化 | 3 天 | Phase 7 |

**总计: ~29 个工作日**

### 关键里程碑

- **Week 2**: MySQL 主从 + Qdrant 基础集群可用
- **Week 4**: 向量检索服务完全迁移
- **Week 6**: 消息队列 + 全异步化
- **Week 7**: 生产环境多节点部署

---

*设计文档版本: 1.0*
*最后更新: 2026-04-10*
