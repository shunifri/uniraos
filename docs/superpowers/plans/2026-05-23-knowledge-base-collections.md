# 知识库分类（多知识库集合）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 RAOS 知识库支持"多知识库集合"概念，用户可创建多个知识库（如"招生政策库"、"课程资料库"），上传文档时归类到指定知识库，并在知识库间独立搜索浏览。支持知识库共享。删除知识库时文档移回默认库。知识图谱严格隔离（各知识库互不可见）。

**Architecture:** 采用"中度改造方案"——新增 `kb_collections` 集合表，`kb_documents` 增加 `collection_id` 外键，所有查询按 `collection_id` 过滤；知识图谱层不改表结构（图谱仍按 `owner_id` 统一存储），但在 KB 搜索/列表的应用层通过 `doc_id → collection_id` 映射做集合隔离。向后兼容：现有文档全部归入"默认知识库"。

**Tech Stack:** TypeScript, MySQL/SQLite, Express, React/Ant Design, Node.js

---

## 1. 研究发现与约束

### 1.1 当前架构（平面知识库）

```
用户 (owner_id)
  └── 知识库空间（隐式，1个/用户）
       ├── kb_documents  (owner_id)
       ├── kb_chunks     (通过 doc_id JOIN)
       ├── kb_keywords   (通过 chunk_id JOIN)
       ├── kb_tags       (通过 doc_id JOIN)
       └── kb_versions   (通过 doc_id JOIN)
```

- **无集合表**：没有 `knowledge_bases` / `kb_collections` 表
- **隔离字段**：所有查询只过滤 `owner_id`，没有 `kb_id`
- **唯一约束**：`UNIQUE(name, owner_id)` 在 `kb_documents`
- **文件存储**：`.raos/knowledge/{owner_id}/page-images/{doc_id}/`

### 1.2 知识图谱关联（关键约束）

| 发现 | 影响 |
|------|------|
| 每个用户**只有一个**知识图谱（`KnowledgeGraphManager` 按 `userId` 实例化） | 不能为每个知识库创建独立图谱 |
| `kb_graph_nodes` / `kb_graph_edges` **没有 `kb_id` 字段** | 改图谱表结构风险高，需全量迁移 |
| 社区检测（Louvain）在**整个用户图谱**上运行 | 如果拆分成多个图谱，社区结果会完全不同 |
| `graph_query` 通过 `allowedDocIds` 做权限过滤 | 可以通过在 `allowedDocIds` 阶段加入 collection 过滤实现逻辑隔离 |
| `graph_path`, `graph_communities`, `graph_deduplicate` **没有** doc ID 过滤 | 这些技能会跨 collection 看到所有节点，是已知限制 |

### 1.3 决策：不改图谱表结构

**原因：**
1. 图谱是全局语义网络，拆分会破坏 LLM 提取的跨文档关系
2. `graph_query`（主要查询入口）已有 `allowedDocIds` 过滤机制
3. 表结构改动涉及 MySQL + SQLite + Neo4j 三套存储适配，风险大
4. 社区检测、中心性计算等算法假设统一图

**替代方案：** 在 KB 搜索/列表层通过 `doc_id → collection_id` 映射做隔离，图谱层保持统一。

---

## 2. 文件结构

### 2.1 新建文件

| 文件 | 职责 |
|------|------|
| `src/db/migrations/v14-kb-collections.ts` | MySQL 迁移：创建 `kb_collections` 表，给 `kb_documents` 加 `collection_id` |
| `src/db/migrations/v14-kb-collections-sqlite.ts` | SQLite 迁移（同上） |
| `src/services/kb-collection-service.ts` | 知识库集合 CRUD 服务 |
| `src/routes/kb-collection-routes.ts` | REST API：集合的增删改查 |
| `web/src/pages/KnowledgeCollectionSelector.tsx` | 前端：知识库选择/创建组件 |

### 2.2 修改文件

| 文件 | 修改内容 |
|------|---------|
| `src/db/mysql-database.ts` | 初始化脚本加入 `kb_collections` 表和 `kb_documents.collection_id` |
| `src/db/database.ts` | SQLite 初始化脚本同上 |
| `src/skills/knowledge-skills.ts` | `kb_ingest`, `kb_list`, `kb_search`, `kb_stats`, `kb_delete` 支持 `collectionId` |
| `src/memory/knowledge-base.ts` | `KnowledgeBase` 类所有查询方法增加 `collectionId` 过滤 |
| `src/routes/knowledge-routes.ts` | 所有端点读取 `collectionId` query/body 参数 |
| `src/routes/index.ts` | 挂载 `kb-collection-routes` |
| `src/kb-graph-sync.ts` | 可选：`syncSharedKBToGraphs` 传递 collection 信息到节点 properties |
| `web/src/pages/Knowledge.tsx` | 加入知识库选择器、创建弹窗、上传时选择知识库 |
| `web/src/pages/Files.tsx` | 加入知识库弹窗支持选择目标知识库 |
| `web/src/api/index.ts` | 添加 KB 集合相关 API 函数 |
| `AGENTS.md` / 相关文档 | 更新知识库架构说明 |

---

## 3. 数据库设计

### 3.1 `kb_collections` 表

```sql
CREATE TABLE kb_collections (
  id VARCHAR(64) PRIMARY KEY,           -- kb_xxx 格式
  name VARCHAR(200) NOT NULL,
  description VARCHAR(500) DEFAULT '',
  owner_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT,
  INDEX(owner_id),
  UNIQUE(name, owner_id)
);
```

### 3.2 `kb_documents` 修改

```sql
-- MySQL
ALTER TABLE kb_documents
  ADD COLUMN collection_id VARCHAR(64) DEFAULT NULL AFTER owner_id,
  ADD INDEX (collection_id),
  ADD FOREIGN KEY (collection_id) REFERENCES kb_collections(id) ON DELETE SET NULL;

-- 更新现有数据：创建"默认知识库"并关联
INSERT INTO kb_collections (id, name, description, owner_id, created_at)
SELECT DISTINCT CONCAT('kb_default_', owner_id), '默认知识库', '系统自动创建的默认知识库', owner_id, UNIX_TIMESTAMP()*1000
FROM kb_documents;

UPDATE kb_documents d
JOIN kb_collections c ON c.owner_id = d.owner_id AND c.name = '默认知识库'
SET d.collection_id = c.id;
```

### 3.3 SQLite 适配

SQLite 语法相同，但外键约束可选（SQLite 默认关闭）。

---

## 4. 后端任务（按依赖顺序）

### Phase 1: 数据库迁移

- [ ] **Task 1.1**: 编写 MySQL 迁移 `v14-kb-collections.ts`
  - 创建 `kb_collections` 表
  - `kb_documents` 加 `collection_id` 列
  - 数据回填：为每个现有 owner 创建"默认知识库"
  - 将现有文档的 `collection_id` 设为默认库
- [ ] **Task 1.2**: 编写 SQLite 迁移 `v14-kb-collections-sqlite.ts`
  - 同上，SQLite 语法
- [ ] **Task 1.3**: 更新 `src/db/mysql-database.ts` 初始化脚本
  - 确保新部署自动包含 `kb_collections` 和 `collection_id`
- [ ] **Task 1.4**: 更新 `src/db/database.ts` 初始化脚本
  - 同上，SQLite 版本
- [ ] **Task 1.5**: 运行迁移，验证数据完整性
  - `npm run db:migrate`
  - 检查所有现有文档都有 `collection_id`

### Phase 2: 核心服务层

- [ ] **Task 2.1**: 创建 `src/services/kb-collection-service.ts`
  - `createCollection(ownerId, name, description)` → 返回 collection
  - `listCollections(ownerId)` → 返回集合列表
  - `getCollection(id)` → 返回单个集合
  - `updateCollection(id, updates)` → 更新
  - `deleteCollection(id, ownerId)` → 删除（需处理：该集合下的文档移回默认库或报错）
  - `getOrCreateDefaultCollection(ownerId)` → 获取/创建默认库
- [ ] **Task 2.2**: 修改 `src/memory/knowledge-base.ts`
  - 构造函数：保持 `owner`，内部通过参数接收 `collectionId`
  - `ingest()`: 增加 `collectionId` 参数，写入 `kb_documents.collection_id`
  - `listDocuments()`: 增加 `collectionId` 过滤条件
  - `search()`: 增加 `collectionId` 过滤（先按 collection_id 过滤文档，再搜索）
  - `deleteDocument()`: 检查文档是否属于指定 collection
  - `getStats()`: 支持按 `collectionId` 统计
  - `getAllTags()`: 支持按 `collectionId` 过滤
  - **注意**：保持向后兼容，`collectionId` 为 `undefined` 时不过滤（即查全部）
- [ ] **Task 2.3**: 修改 `src/db/database.ts` / `mysql-database.ts` 中的 `getKnowledgeBase` 函数签名
  - 保持现有 `getKnowledgeBase(owner)` 不变
  - 增加 `getKnowledgeBaseForCollection(owner, collectionId)` 或改为可选参数

### Phase 3: Skill 层

- [ ] **Task 3.1**: 修改 `kb_ingest`
  - `paramSchema` 增加 `collectionId?: string`
  - handler 中传入 `collectionId` 到 `kb.ingest()`
  - 如果未提供 `collectionId`，使用默认知识库
- [ ] **Task 3.2**: 修改 `kb_list`
  - `paramSchema` 增加 `collectionId?: string`
  - handler 中传入 `collectionId` 到 `kb.listDocuments()`
- [ ] **Task 3.3**: 修改 `kb_search`
  - `paramSchema` 增加 `collectionId?: string`
  - handler 中先按 collection 过滤文档 ID，再执行搜索
- [ ] **Task 3.4**: 修改 `kb_stats`
  - `paramSchema` 增加 `collectionId?: string`
  - 统计按 collection 过滤
- [ ] **Task 3.5**: 修改 `kb_delete`
  - 删除时验证文档属于该 collection（或不验证，保持原有权限检查即可）
- [ ] **Task 3.6**: 新增 Skill `kb_collection_create`
  - 描述：创建知识库集合
  - 参数：name, description?
- [ ] **Task 3.7**: 新增 Skill `kb_collection_list`
  - 描述：列出当前用户的所有知识库集合
- [ ] **Task 3.8**: 新增 Skill `kb_collection_delete`
  - 描述：删除知识库集合（集合内文档移回默认库）

### Phase 4: API 路由层

- [ ] **Task 4.1**: 创建 `src/routes/kb-collection-routes.ts`
  - `GET /api/knowledge/collections` → listCollections
  - `POST /api/knowledge/collections` → createCollection
  - `GET /api/knowledge/collections/:id` → getCollection
  - `PUT /api/knowledge/collections/:id` → updateCollection
  - `DELETE /api/knowledge/collections/:id` → deleteCollection
- [ ] **Task 4.2**: 修改 `src/routes/knowledge-routes.ts`
  - 所有现有端点读取 `req.query.collectionId` 或 `req.body.collectionId`
  - 传给 engine.execute 时附加 `collectionId`
  - `POST /knowledge/ingest` 支持 `collectionId`
  - `GET /knowledge/documents` 支持 `collectionId`
  - `GET /knowledge/search` 支持 `collectionId`
  - `GET /knowledge/stats` 支持 `collectionId`
- [ ] **Task 4.3**: 修改 `src/routes/index.ts`
  - 在 `mountRoutes` 中挂载 `kb-collection-routes`

### Phase 5: 知识图谱影响处理

- [ ] **Task 5.1**: 评估 `kb-graph-sync.ts`
  - 当前文档同步到图谱时，节点 properties 中不记录 collection
  - **决定**：在 `graphManager.onFactStored()` 调用时，将 `collection_id` 写入 node.properties
  - 这样图谱节点保留了 collection 信息，但不影响图谱结构
- [ ] **Task 5.2**: 修改 `kb_search` 的图谱增强搜索
  - 当使用 `graphManager.graphSearch()` 时，获取结果 docIds 后
  - 用 `allowedDocIds` 过滤时，额外加入 collection 限制
  - 即：`allowedDocIds = 有权限的文档 ∩ 属于当前 collection 的文档`
- [ ] **Task 5.3**: 文档说明
  - 在计划中注明：`graph_path`, `graph_communities`, `graph_deduplicate` 仍全局可见
  - 这是可接受的，因为这些是分析型技能，不是查询型技能

---

## 5. 前端任务

### Phase 6: 知识库页面改造

- [ ] **Task 6.1**: 创建 `web/src/pages/KnowledgeCollectionSelector.tsx`
  - Ant Design 的 `Select` 组件，显示用户所有知识库
  - 支持搜索知识库
  - 底部有"+ 新建知识库"选项
  - props: `value`, `onChange`, `ownerId`
- [ ] **Task 7.2**: 修改 `web/src/pages/Knowledge.tsx`
  - 顶部工具栏加入 `KnowledgeCollectionSelector`
  - 状态：`selectedCollectionId`（默认选中"默认知识库"）
  - 所有 API 调用（loadDocuments, loadStats, handleUpload, handleSearch）传入 `collectionId`
  - 上传弹窗中增加"归类到知识库"选择器（默认当前选中的知识库）
  - 新建知识库弹窗：名称 + 描述输入
- [ ] **Task 7.3**: 修改 `web/src/pages/Files.tsx`
  - "加入知识库"弹窗中，标签输入下方增加知识库选择器
  - 调用 `/api/knowledge/ingest` 时传入 `collectionId`
- [ ] **Task 7.4**: 修改 `web/src/api/index.ts`
  - 添加 `listKBCollections`, `createKBCollection`, `deleteKBCollection` 函数
- [ ] **Task 7.5**: 修改 `web/src/components/AppDesignCard.tsx`（如有知识库相关按钮）
  - 知识库"去上传"按钮跳转 `/knowledge` 后，用户仍需手动选择知识库
  - 如需直接定位，可以传 query string：`/knowledge?collection=xxx`

---

## 6. 测试计划

- [ ] **Test 1**: 迁移后验证所有现有文档在"默认知识库"中
- [ ] **Test 2**: 创建新知识库"招生政策库"
- [ ] **Test 3**: 上传 PDF 到"招生政策库"，验证 `kb_documents.collection_id` 正确
- [ ] **Test 4**: 在"招生政策库"中搜索，结果只包含该库文档
- [ ] **Test 5**: 切换到"默认知识库"，搜索不包含"招生政策库"文档
- [ ] **Test 6**: 删除知识库，文档移回默认库
- [ ] **Test 7**: 知识图谱中仍能看到所有文档节点（全局图谱）
- [ ] **Test 8**: `graph_query` 按 collection 过滤正确
- [ ] **Test 9**: 共享文档功能不受 collection 影响
- [ ] **Test 10**: 前端标签筛选与 collection 筛选同时工作

---

## 7. 风险与回滚

| 风险 | 缓解措施 |
|------|---------|
| 迁移失败导致数据丢失 | 先备份 `kb_documents` 表；迁移脚本使用事务 |
| `collection_id` 导致查询变慢 | 给 `kb_documents.collection_id` 加索引 |
| 知识图谱社区检测结果变化 | 不改图谱表结构，仅做应用层过滤，社区检测不受影响 |
| 前端缓存旧数据 | 刷新页面后重新加载 collection 列表 |
| 向后兼容 | `collectionId` 为 optional；不传时查全部，保持现有行为 |

**回滚方案：**
- 如果出问题，删除 `kb_collections` 表，移除 `kb_documents.collection_id` 列
- 回滚迁移脚本（需手动编写 down 迁移）

---

## 8. 工作量估算

| Phase | 预估时间 |
|-------|---------|
| Phase 1: 数据库迁移 | 1-2 小时 |
| Phase 2: 核心服务层 | 2-3 小时 |
| Phase 3: Skill 层 | 2-3 小时 |
| Phase 4: API 路由层 | 1-2 小时 |
| Phase 5: 知识图谱处理 | 1 小时 |
| Phase 6: Collection 共享机制 | 1-2 小时 |
| Phase 7: 前端改造 | 3-4 小时 |
| 测试与修复 | 2-3 小时 |
| **总计** | **14-20 小时** |
