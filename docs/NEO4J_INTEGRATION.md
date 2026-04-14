# Neo4j 图数据库集成文档

## 概述

RAOS 现在支持使用 Neo4j 作为知识图谱的存储后端，作为 MySQL 的高性能替代方案。Neo4j 是一个成熟的原生图数据库，特别适合处理复杂的图查询和大规模图数据。

## 架构

### 存储后端

RAOS 现在支持两种存储后端：

1. **MySQL** (默认) - 现有实现，适合中小规模图数据
2. **Neo4j** - 高性能图数据库，适合大规模图数据和复杂图查询

### 核心组件

- `Neo4jGraphStore` - Neo4j 存储实现
- `KnowledgeGraphManager` - 支持后端选择的知识图谱管理器
- 环境变量配置 - `GRAPH_STORE_BACKEND` 用于切换后端

## 快速开始

### 1. 环境配置

在 `.env.local` 或 Docker 环境中配置：

```bash
# 选择存储后端: mysql 或 neo4j
GRAPH_STORE_BACKEND=neo4j

# Neo4j 连接配置
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=raospassword
NEO4J_DATABASE=raos
```

### 2. 启动 Neo4j 服务

使用 Docker Compose 启动 Neo4j：

```bash
# 启动完整基础设施（包括 Neo4j）
docker-compose up -d neo4j

# 或启动所有服务
docker-compose up -d
```

### 3. 验证连接

访问 Neo4j 浏览器：http://localhost:7474

## 使用方式

### 代码中使用

```typescript
import { KnowledgeGraphManager } from './memory/knowledge-graph/manager.js';

// 使用默认后端（从环境变量读取）
const manager = new KnowledgeGraphManager(ownerId, llmProvider);

// 或显式指定后端
const managerNeo4j = new KnowledgeGraphManager(ownerId, llmProvider, 'neo4j');
const managerMysql = new KnowledgeGraphManager(ownerId, llmProvider, 'mysql');

// 使用与之前完全相同的 API
const subgraph = await manager.querySubgraph('查询主题');
const path = await manager.getPath('节点A', '节点B');
```

### Neo4jGraphStore 直接使用

```typescript
import { Neo4jGraphStore } from './memory/knowledge-graph/neo4j-store.js';

const store = new Neo4jGraphStore(
  ownerId,
  'bolt://localhost:7687',
  'neo4j',
  'password',
  'raos'
);

// 验证连接
const ok = await store.verifyConnection();

// 基本操作
const node = await store.addNode({ label: '测试', type: 'ltm', tags: [] });
await store.addEdge(node.id, otherNode.id, 'EXTRACTED', '相关');
```

## 数据模型

### Neo4j 数据结构

**节点标签：**
- `KBNode` - 所有知识图谱节点的基础标签
- 动态标签：对应 `NodeType` (如 `ltm`, `concept`, `document` 等)

**节点属性：**
- `id` - 节点唯一 ID
- `ownerId` - 所有者 ID（用于多租户）
- `label` - 节点标签
- `type` - 节点类型
- `tags` - 标签数组
- `properties` - JSON 属性
- `createdAt` - 创建时间戳

**关系类型：**
- 动态关系类型：对应 `EdgeType` (如 `EXTRACTED`, `TEMPORAL`, `HIERARCHICAL` 等)

**关系属性：**
- `id` - 边唯一 ID
- `label` - 关系标签
- `type` - 关系类型
- `weight` - 权重
- `createdAt` - 创建时间戳

## 迁移策略

### 渐进式迁移（推荐）

1. **并行运行阶段**
   - 保持 `GRAPH_STORE_BACKEND=mysql`
   - 同时写入两个后端（如需实现双写逻辑）

2. **数据同步**
   - 将 MySQL 中的现有图数据导出
   - 导入到 Neo4j

3. **切换阶段**
   - 更新环境变量为 `GRAPH_STORE_BACKEND=neo4j`
   - 验证功能正常后，停止使用 MySQL 后端

### 数据导出/导入

**从 MySQL 导出：**
```javascript
// 使用 KnowledgeGraphManager 导出所有数据
const manager = new KnowledgeGraphManager(owner, llm, 'mysql');
const allNodes = await manager.getStore().getAllNodes();
const allEdges = await manager.getStore().getAllEdges();
```

**导入到 Neo4j：**
```javascript
const manager = new KnowledgeGraphManager(owner, llm, 'neo4j');
for (const node of allNodes) {
  await manager.getStore().addNode(node);
}
for (const edge of allEdges) {
  await manager.getStore().addEdge(
    edge.source, edge.target, edge.type, edge.label, edge.weight
  );
}
```

## 性能对比

### MySQL vs Neo4j

| 操作 | MySQL (小规模) | MySQL (大规模) | Neo4j (大规模) |
|------|----------------|----------------|----------------|
| 节点查询 | 快 | 中等 | 快 |
| 邻居查询 | O(n) | 慢 | O(1) |
| 路径查找 | 极慢 | 不可用 | 快 |
| 社区检测 | 慢 | 不可用 | 快 |
| 写入性能 | 快 | 中等 | 快 |

### 何时使用 Neo4j

✅ **推荐使用 Neo4j：**
- 知识图谱节点数 > 10,000
- 需要复杂的图查询（路径查找、子图提取）
- 需要社区检测、中心性分析等图算法
- 关系查询频繁且深度 > 2

✅ **推荐使用 MySQL：**
- 中小规模图数据
- 主要是简单的节点和边 CRUD
- 已有 MySQL 基础设施且不想增加复杂度

## 高级功能

### Cypher 查询

```typescript
// Neo4jGraphStore 内部使用 Cypher 查询
// 你也可以直接使用 driver 执行自定义查询
const store = new Neo4jGraphStore(owner);
const session = store.driver.session({ database: 'raos' });

try {
  const result = await session.run(
    `MATCH (a:KBNode {ownerId: $owner})-[r]->(b:KBNode)
     RETURN a, r, b LIMIT 10`,
    { owner }
  );
  // 处理结果
} finally {
  await session.close();
}
```

### APOC 扩展

Neo4j 容器已启用 APOC 扩展，可用于高级图算法：
- 社区检测
- 路径查找
- 图生成
- 数据导入/导出

## 故障排查

### 连接问题

**问题：无法连接到 Neo4j**
```
检查：
1. Neo4j 容器是否运行：docker ps | grep neo4j
2. 端口是否正确：7687 (Bolt), 7474 (HTTP)
3. 认证信息是否正确
4. 防火墙设置
```

**问题：认证失败**
```
解决方案：
1. 访问 http://localhost:7474
2. 使用默认密码 neo4j/neo4j 登录
3. 按提示修改密码
4. 更新 .env.local 中的 NEO4J_PASSWORD
```

### 性能问题

**问题：查询慢**
```
优化建议：
1. 确保 ownerId 和 id 上有索引
2. 使用 LIMIT 限制结果集
3. 考虑分页查询
4. 检查 Neo4j 内存配置
```

## 维护

### 备份

```bash
# Neo4j 数据备份
docker exec raos-neo4j neo4j-admin dump --database=raos --to=/backups/raos.dump

# 从备份恢复
docker exec raos-neo4j neo4j-admin load --from=/backups/raos.dump --database=raos --force
```

### 监控

Neo4j 提供了内置的监控页面：
- 浏览器：http://localhost:7474
- 查询性能分析
- 数据库状态监控

## 参考资料

- [Neo4j 官方文档](https://neo4j.com/docs/)
- [Cypher 查询语言](https://neo4j.com/docs/cypher-manual/)
- [APOC 扩展库](https://neo4j.com/labs/apoc/)
