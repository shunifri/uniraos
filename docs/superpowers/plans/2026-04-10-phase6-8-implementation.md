# RAOS Phase 6-8 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 完成消息队列异步化、负载均衡多节点部署、性能测试优化

**Architecture:** RabbitMQ 处理异步任务，Nginx 负载均衡，多节点水平扩展

**Tech Stack:** RabbitMQ, amqplib, Nginx, Docker Compose, k6 (性能测试)

---

## Phase 6: 消息队列 + 异步化 (5天)

### Task 6.1: RabbitMQ 客户端

**Files:**
- Create: `src/queue/rabbitmq-client.ts`
- Create: `src/queue/types.ts`
- Create: `tests/queue/rabbitmq-client.test.ts`

**Requirements:**
1. RabbitMQ 连接管理（支持集群）
2. 生产者/消费者模式
3. 消息确认机制
4. 死信队列支持
5. 连接健康检查

```typescript
// src/queue/types.ts
export interface QueueMessage<T = any> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
  retryCount: number;
}

export interface QueueConfig {
  url: string;
  prefetch?: number;
  reconnectInterval?: number;
}
```

```typescript
// src/queue/rabbitmq-client.ts
import amqp from 'amqplib';

export class RabbitMQClient {
  async connect(): Promise<void>
  async publish(queue: string, message: QueueMessage): Promise<void>
  async consume(queue: string, handler: (msg: QueueMessage) => Promise<void>): Promise<void>
  async createQueue(name: string, options?: QueueOptions): Promise<void>
  async healthCheck(): Promise<boolean>
  async close(): Promise<void>
}
```

**Steps:**
1. Install: `npm install amqplib @types/amqplib`
2. Create types and client
3. Create tests with mocked amqp
4. Commit: "feat(queue): add RabbitMQ client"

---

### Task 6.2: LLM 异步任务队列

**Files:**
- Create: `src/queue/llm-producer.ts`
- Create: `src/queue/llm-consumer.ts`
- Create: `src/queue/llm-queue-manager.ts`
- Modify: `src/llm/agent-loop.ts` (集成异步调用)

**Requirements:**
1. LLM 请求生产者
2. LLM 请求消费者（多实例）
3. 结果回调机制（Redis Pub/Sub）
4. 任务状态跟踪

```typescript
// src/queue/llm-producer.ts
export class LLMProducer {
  async enqueue(request: LLMRequest): Promise<string> // 返回任务ID
  async getStatus(taskId: string): Promise<TaskStatus>
}

// src/queue/llm-consumer.ts
export class LLMConsumer {
  async start(): Promise<void>
  async stop(): Promise<void>
  private processRequest(request: LLMRequest): Promise<void>
}
```

**Integration with Agent Loop:**
```typescript
// src/llm/agent-loop.ts
async function streamChat(body: any): Promise<ReadableStream> {
  // 如果启用异步模式
  if (config.asyncLLM) {
    const taskId = await llmProducer.enqueue(body);
    // 返回任务ID，客户端通过 SSE 等待结果
    return createAsyncStream(taskId);
  }
  // 原有同步逻辑
}
```

**Steps:**
1. Create producer/consumer
2. Create queue manager
3. Modify agent-loop for async mode
4. Create tests
5. Commit: "feat(queue): add LLM async task queue"

---

### Task 6.3: 文档解析异步队列

**Files:**
- Create: `src/queue/doc-parser-producer.ts`
- Create: `src/queue/doc-parser-consumer.ts`
- Modify: `src/services/doc-parser.ts`

**Requirements:**
1. 文档上传后进入解析队列
2. 消费者异步处理解析
3. 进度通知（SSE/Redis Pub/Sub）
4. 支持批量处理

**Steps:**
1. Create producer/consumer
2. Integrate with doc-parser
3. Add progress notifications
4. Commit: "feat(queue): add document parsing async queue"

---

## Phase 7: 负载均衡 + 多节点部署 (3天)

### Task 7.1: Docker Compose 编排

**Files:**
- Create: `docker-compose.infra.yml`
- Create: `docker-compose.app.yml`
- Create: `.env.example`

**Requirements:**
1. MySQL 主从容器编排
2. Redis Cluster 容器编排
3. Qdrant 容器编排
4. RabbitMQ 容器编排
5. RAOS 应用多实例

```yaml
# docker-compose.infra.yml
version: '3.8'
services:
  mysql-primary:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: raos
    volumes:
      - mysql_primary_data:/var/lib/mysql
      - ./mysql/primary.cnf:/etc/mysql/conf.d/custom.cnf
    command: --server-id=1 --log-bin=mysql-bin --binlog-format=ROW
    ports:
      - "3306:3306"
      
  mysql-replica:
    image: mysql:8.0
    depends_on:
      - mysql-primary
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
    command: --server-id=2 --read-only=1
    
  redis-node-1:
    image: redis:7-alpine
    command: redis-server --appendonly yes --cluster-enabled yes
    
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_storage:/qdrant/storage
      
  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS}

volumes:
  mysql_primary_data:
  qdrant_storage:
```

```yaml
# docker-compose.app.yml
version: '3.8'
services:
  raos-node-1:
    build: .
    environment:
      - NODE_ENV=production
      - MYSQL_PRIMARY_HOST=mysql-primary
      - REDIS_HOSTS=redis-node-1:6379
      - QDRANT_HOST=qdrant
      - RABBITMQ_URL=amqp://rabbitmq:5672
    depends_on:
      - mysql-primary
      - redis-node-1
      - qdrant
      - rabbitmq
    
  raos-node-2:
    build: .
    environment:
      - NODE_ENV=production
      - MYSQL_PRIMARY_HOST=mysql-primary
      - REDIS_HOSTS=redis-node-1:6379
      - QDRANT_HOST=qdrant
      - RABBITMQ_URL=amqp://rabbitmq:5672
    depends_on:
      - mysql-primary
      - redis-node-1
      - qdrant
      - rabbitmq
      
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - raos-node-1
      - raos-node-2
```

**Steps:**
1. Create docker-compose.infra.yml
2. Create docker-compose.app.yml
3. Create .env.example
4. Test locally
5. Commit: "feat(deploy): add Docker Compose orchestration"

---

### Task 7.2: Nginx 负载均衡配置

**Files:**
- Create: `nginx.conf`
- Create: `nginx/ssl/.gitkeep`

**Requirements:**
1. 轮询负载均衡
2. 健康检查
3. WebSocket 支持（SSE）
4. SSL/TLS 终端
5. 静态文件缓存

```nginx
# nginx.conf
upstream raos_backend {
    least_conn;  # 最少连接数
    server raos-node-1:3000 weight=5 max_fails=3 fail_timeout=30s;
    server raos-node-2:3000 weight=5 max_fails=3 fail_timeout=30s;
    keepalive 32;
}

server {
    listen 80;
    server_name localhost;
    
    location / {
        proxy_pass http://raos_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
    
    location /health {
        access_log off;
        proxy_pass http://raos_backend/health;
    }
}
```

**Steps:**
1. Create nginx.conf
2. Create SSL directory placeholder
3. Test configuration
4. Commit: "feat(deploy): add Nginx load balancer config"

---

### Task 7.3: 应用无状态化改造

**Files:**
- Modify: `src/server.ts`
- Create: `src/health/health-check.ts`
- Create: `src/middleware/request-id.ts`

**Requirements:**
1. 移除全局状态（使用 Redis 替代）
2. 添加健康检查端点
3. 请求 ID 追踪
4. 优雅关闭

```typescript
// src/health/health-check.ts
export async function healthCheck(): Promise<HealthStatus> {
  const [mysql, redis, qdrant, rabbitmq] = await Promise.all([
    checkMySQL(),
    checkRedis(),
    checkQdrant(),
    checkRabbitMQ(),
  ]);
  
  return {
    status: mysql && redis && qdrant ? 'healthy' : 'unhealthy',
    services: { mysql, redis, qdrant, rabbitmq },
    timestamp: Date.now(),
  };
}
```

**Steps:**
1. Create health check module
2. Add /health and /ready endpoints
3. Add request ID middleware
4. Implement graceful shutdown
5. Commit: "feat(server): add health checks and stateless design"

---

## Phase 8: 性能测试 + 优化 (3天)

### Task 8.1: 性能测试套件

**Files:**
- Create: `tests/performance/load-test.js`
- Create: `tests/performance/k6-script.js`
- Create: `tests/performance/benchmark-report.md`

**Requirements:**
1. k6 负载测试脚本
2. API 端点性能测试
3. 并发用户测试
4. 数据库查询性能测试

```javascript
// tests/performance/k6-script.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up
    { duration: '5m', target: 100 },   // Steady state
    { duration: '2m', target: 200 },   // Spike
    { duration: '5m', target: 200 },   // Sustained load
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95% requests under 500ms
    http_req_failed: ['rate<0.01'],     // Error rate < 1%
  },
};

export default function () {
  const res = http.get('http://localhost:3000/api/health');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });
  sleep(1);
}
```

**Steps:**
1. Install k6: `brew install k6` (或 Docker)
2. Create k6 test scripts
3. Run load tests
4. Generate benchmark report
5. Commit: "test(perf): add k6 performance test suite"

---

### Task 8.2: 性能优化

**Files:**
- Modify: `src/db/mysql-adapter.ts`
- Modify: `src/cache/redis-client.ts`
- Create: `src/cache/query-cache.ts`

**Requirements:**
1. 查询缓存层
2. 连接池优化
3. N+1 查询优化
4. 慢查询日志

```typescript
// src/cache/query-cache.ts
export class QueryCache {
  async getCachedQuery<T>(
    sql: string, 
    params: any[], 
    ttlSeconds: number = 60
  ): Promise<T[]>
  
  async invalidateTable(tableName: string): Promise<void>
}
```

**Steps:**
1. Add query caching
2. Optimize connection pools
3. Add slow query logging
4. Commit: "perf: add query caching and connection pool optimization"

---

### Task 8.3: 监控和日志

**Files:**
- Create: `src/metrics/metrics-collector.ts`
- Create: `src/middleware/metrics-middleware.ts`
- Create: `docker-compose.monitoring.yml`

**Requirements:**
1. Prometheus 指标收集
2. Grafana 仪表盘
3. 分布式追踪（OpenTelemetry）
4. 日志聚合

```typescript
// src/metrics/metrics-collector.ts
import promClient from 'prom-client';

export const metrics = {
  httpRequests: new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
  }),
  
  dbQueryDuration: new promClient.Histogram({
    name: 'db_query_duration_seconds',
    help: 'Database query duration',
    labelNames: ['operation', 'table'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  }),
};
```

**Steps:**
1. Add Prometheus metrics
2. Create middleware for HTTP metrics
3. Create docker-compose.monitoring.yml
4. Commit: "feat(monitoring): add Prometheus metrics and Grafana"

---

## 自我审查

### Spec 覆盖检查

| 设计文档要求 | 实现任务 | 状态 |
|-------------|---------|------|
| RabbitMQ 消息队列 | Task 6.1-6.3 | ✅ |
| LLM 异步化 | Task 6.2 | ✅ |
| Docker Compose 编排 | Task 7.1 | ✅ |
| Nginx 负载均衡 | Task 7.2 | ✅ |
| 健康检查 | Task 7.3 | ✅ |
| 性能测试 (k6) | Task 8.1 | ✅ |
| 查询缓存 | Task 8.2 | ✅ |
| 监控指标 | Task 8.3 | ✅ |

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-04-10-phase6-8-implementation.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach would you prefer?
