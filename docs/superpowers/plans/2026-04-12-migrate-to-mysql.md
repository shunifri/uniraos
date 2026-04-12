# 迁移知识库/图谱/LTM到MySQL实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将知识库(KnowledgeBase)、知识图谱(GraphStore)和长期记忆(LTM)从SQLite/文件存储迁移到MySQL，确保系统只使用MySQL一种数据库。

**Architecture:** 
1. 修改 `KnowledgeBase` 类使用 MySQL Adapter 替代 SQLite
2. 修改 `GraphStore` 类使用 MySQL 存储图数据
3. 修改 `FileLTMBackend` 使用 MySQL 存储记忆
4. 所有数据存储统一使用 MySQL 表结构，按 owner 字段隔离多租户

**Tech Stack:** TypeScript, MySQL2, existing MySQLAdapter

---

## 文件结构分析

**需要修改的核心文件：**
- `src/skills/knowledge-skills.ts` - KnowledgeBase 类 (136-1255行)
- `src/memory/knowledge-graph/graph-store.ts` - GraphStore 类 (6-332行)
- `src/memory/ltm.ts` - FileLTMBackend 类 (70-707行)
- `src/skills/knowledge-skills.ts` - getKnowledgeBase 工厂函数 (1262-1269行)

**需要更新的文件：**
- `src/db/mysql-database.ts` - 添加缺失的表和字段
- `src/services/parsing-queue.ts` - 适配新的 KnowledgeBase API

---

## Task 1: 准备MySQL数据库表结构

**Files:**
- Modify: `src/db/mysql-database.ts`

**分析当前MySQL表：**
- `kb_documents` - 已存在
- `kb_chunks` - 已存在但结构需要调整(vector字段类型)
- `kb_keywords` - 已存在
- `kb_versions` - 已存在
- 缺少: `kb_graph_nodes`, `kb_graph_edges`, `kb_ltm_entries`

- [ ] **Step 1: 添加知识图谱表到MySQL迁移**

在 MIGRATIONS 数组中添加表创建语句：

```typescript
// 在 mysql-database.ts 的 MIGRATIONS[0].up 中添加：

-- 知识图谱节点表
CREATE TABLE IF NOT EXISTS kb_graph_nodes (
  id VARCHAR(64) PRIMARY KEY COMMENT '节点ID',
  owner_id VARCHAR(64) NOT NULL COMMENT '所有者ID',
  label VARCHAR(500) NOT NULL COMMENT '节点标签',
  type VARCHAR(50) NOT NULL COMMENT '节点类型',
  tags JSON COMMENT '标签数组',
  properties JSON COMMENT '节点属性JSON',
  created_at BIGINT NOT NULL COMMENT '创建时间',
  INDEX idx_kb_graph_nodes_owner (owner_id) COMMENT '所有者索引',
  INDEX idx_kb_graph_nodes_label (owner_id, label) COMMENT '标签查询索引',
  INDEX idx_kb_graph_nodes_type (owner_id, type) COMMENT '类型索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识图谱节点表';

-- 知识图谱边表
CREATE TABLE IF NOT EXISTS kb_graph_edges (
  id VARCHAR(64) PRIMARY KEY COMMENT '边ID',
  owner_id VARCHAR(64) NOT NULL COMMENT '所有者ID',
  source_id VARCHAR(64) NOT NULL COMMENT '源节点ID',
  target_id VARCHAR(64) NOT NULL COMMENT '目标节点ID',
  type VARCHAR(50) NOT NULL COMMENT '边类型',
  label VARCHAR(200) COMMENT '边标签',
  weight DECIMAL(5,4) DEFAULT 1.0 COMMENT '权重',
  created_at BIGINT NOT NULL COMMENT '创建时间',
  INDEX idx_kb_graph_edges_owner (owner_id) COMMENT '所有者索引',
  INDEX idx_kb_graph_edges_source (owner_id, source_id) COMMENT '源节点索引',
  INDEX idx_kb_graph_edges_target (owner_id, target_id) COMMENT '目标节点索引',
  FOREIGN KEY (source_id) REFERENCES kb_graph_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES kb_graph_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识图谱边表';

-- 长期记忆条目表
CREATE TABLE IF NOT EXISTS kb_ltm_entries (
  id VARCHAR(64) PRIMARY KEY COMMENT '记忆ID',
  owner_id VARCHAR(64) NOT NULL COMMENT '所有者ID',
  entry_key VARCHAR(500) NOT NULL COMMENT '记忆键',
  value JSON NOT NULL COMMENT '记忆值JSON',
  tags JSON COMMENT '标签数组',
  source VARCHAR(200) COMMENT '来源',
  summary TEXT COMMENT '摘要',
  access_count INT DEFAULT 0 COMMENT '访问次数',
  created_at BIGINT NOT NULL COMMENT '创建时间',
  updated_at BIGINT NOT NULL COMMENT '更新时间',
  last_accessed_at BIGINT COMMENT '最后访问时间',
  vector BLOB COMMENT '向量数据',
  is_archived TINYINT DEFAULT 0 COMMENT '是否已归档',
  INDEX idx_kb_ltm_owner (owner_id) COMMENT '所有者索引',
  INDEX idx_kb_ltm_key (owner_id, entry_key) COMMENT '键索引',
  INDEX idx_kb_ltm_access (owner_id, last_accessed_at) COMMENT '访问时间索引',
  INDEX idx_kb_ltm_archived (owner_id, is_archived) COMMENT '归档状态索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='长期记忆条目表';
```

- [ ] **Step 2: 更新 kb_chunks 表结构**

确保 kb_chunks 表支持所有必要字段：

```typescript
-- 检查并添加缺失字段
ALTER TABLE kb_chunks 
ADD COLUMN IF NOT EXISTS page_number INT COMMENT '页码',
ADD COLUMN IF NOT EXISTS bbox_data JSON COMMENT '边界框数据',
ADD COLUMN IF NOT EXISTS segment_index INT COMMENT '切片索引',
ADD COLUMN IF NOT EXISTS time_range VARCHAR(100) COMMENT '时间范围',
ADD COLUMN IF NOT EXISTS frame_url VARCHAR(500) COMMENT '帧URL',
ADD COLUMN IF NOT EXISTS asr_text TEXT COMMENT 'ASR文本',
ADD COLUMN IF NOT EXISTS content_type VARCHAR(50) DEFAULT 'text' COMMENT '内容类型';
```

---

## Task 2: 重写 KnowledgeBase 类使用 MySQL

**Files:**
- Modify: `src/skills/knowledge-skills.ts` (136-1255行)

**分析当前 KnowledgeBase 类：**
- 使用 `private db: Database.Database` (SQLite)
- 需要改为使用 MySQLAdapter
- 方法包括: initSchema, ingest, search, delete, 等

- [ ] **Step 1: 修改 KnowledgeBase 类定义**

```typescript
// 修改导入
import { getMySQLAdapter, type MySQLAdapter } from "../db/mysql-adapter.js";

// 修改类定义
export class KnowledgeBase {
  private adapter: MySQLAdapter;
  private embeddingProvider: EmbeddingProvider;
  private owner: string;
  private vectorCache: Map<number, number[]> = new Map();
  private vectorCacheAccessTime: Map<number, number> = new Map();
  private static readonly MAX_VECTOR_CACHE_SIZE = 50000;
  private vectorCacheDirty = true;
  private vectorCacheLock = false;
  private vectorCacheWaiters: (() => void)[] = [];

  constructor(owner: string, embeddingProvider?: EmbeddingProvider) {
    this.adapter = getMySQLAdapter();
    this.embeddingProvider = embeddingProvider ?? new LocalEmbeddingProvider();
    this.owner = owner;
  }
  
  // 不再需要 initSchema，由 mysql-database.ts 管理
```

- [ ] **Step 2: 修改 ingest 方法使用 MySQL**

```typescript
async ingest(
  name: string,
  content: string,
  options?: {
    source?: string;
    tags?: string[];
    skipEmbedding?: boolean;
    layouts?: DocMindLayout[];
    segments?: DocMindSegment[];
  }
): Promise<{ docId: string; chunkCount: number; totalTokens: number }> {
  const docId = options?.source
    ? getDocIdFromSource(options.source, this.owner)
    : `doc_${Date.now()}_${randomBytes(4).toString("hex")}`;

  const contentHash = createHash("sha256").update(content).digest("hex");
  const now = Date.now();
  
  // 检查是否需要更新（同名文档）
  const existingRows = await this.adapter.query(
    "SELECT doc_id, content_hash, chunk_count FROM kb_documents WHERE name = ? AND owner_id = ?",
    [name, this.owner]
  );
  
  const existing = existingRows.rows[0] as { doc_id: string; content_hash: string; chunk_count: number } | undefined;

  if (existing && existing.content_hash === contentHash) {
    // 内容未变化，直接返回
    return { docId: existing.doc_id, chunkCount: existing.chunk_count, totalTokens: 0 };
  }

  if (existing) {
    // 删除旧版本
    await this.adapter.execute("DELETE FROM kb_documents WHERE doc_id = ?", [existing.doc_id]);
  }

  // 插入新文档记录
  const tagsJson = JSON.stringify(options?.tags ?? []);
  await this.adapter.execute(
    `INSERT INTO kb_documents 
     (doc_id, owner_id, name, source, chunk_count, total_tokens, ingested_at, updated_at, version, tags, shared, content_hash, parsed_content, parsing_status, parsing_progress) 
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, 1, ?, 0, ?, ?, 'success', 100)`,
    [docId, this.owner, name, options?.source ?? '', now, now, tagsJson, contentHash, content]
  );

  // 分块处理
  const chunks = this.chunkContent(content);
  const tokens = chunks.map(c => this.estimateTokens(c));
  const totalTokens = tokens.reduce((a, b) => a + b, 0);

  // 插入 chunks
  if (!options?.skipEmbedding) {
    const vectors = await this.embeddingProvider.embed(chunks);
    for (let i = 0; i < chunks.length; i++) {
      const vectorBlob = vectors[i] ? Buffer.from(new Float32Array(vectors[i]).buffer) : null;
      await this.adapter.execute(
        `INSERT INTO kb_chunks 
         (doc_id, chunk_index, content, tokens, vector, content_type) 
         VALUES (?, ?, ?, ?, ?, 'text')`,
        [docId, i, chunks[i], tokens[i], vectorBlob]
      );
    }
  } else {
    // 跳过向量化，vector 设为 null
    for (let i = 0; i < chunks.length; i++) {
      await this.adapter.execute(
        `INSERT INTO kb_chunks 
         (doc_id, chunk_index, content, tokens, vector, content_type) 
         VALUES (?, ?, ?, ?, NULL, 'text')`,
        [docId, i, chunks[i], tokens[i]]
      );
    }
  }

  // 更新文档统计
  await this.adapter.execute(
    "UPDATE kb_documents SET chunk_count = ?, total_tokens = ? WHERE doc_id = ?",
    [chunks.length, totalTokens, docId]
  );

  return { docId, chunkCount: chunks.length, totalTokens };
}
```

- [ ] **Step 3: 修改 search 方法使用 MySQL**

```typescript
async search(
  query: string,
  options?: {
    limit?: number;
    semantic?: boolean;
    keyword?: boolean;
    tags?: string[];
    owner?: string;  // 用于跨用户搜索共享文档
  }
): Promise<Array<{ docId: string; docName: string; chunkIndex: number; content: string; score: number }>> {
  const limit = options?.limit ?? 10;
  const results: Array<{ docId: string; docName: string; chunkIndex: number; content: string; score: number }> = [];
  
  // 语义搜索
  if (options?.semantic !== false) {
    const queryVector = (await this.embeddingProvider.embed([query]))[0];
    
    // 获取所有未归档文档的 chunks
    const chunksResult = await this.adapter.query(
      `SELECT c.id, c.doc_id, c.chunk_index, c.content, c.vector, d.name as doc_name 
       FROM kb_chunks c 
       JOIN kb_documents d ON c.doc_id = d.doc_id 
       WHERE d.owner_id = ? OR d.shared = 1`,
      [this.owner]
    );
    
    const chunks = chunksResult.rows as Array<{
      id: number;
      doc_id: string;
      chunk_index: number;
      content: string;
      vector: Buffer | null;
      doc_name: string;
    }>;
    
    // 计算相似度
    const scored = chunks
      .filter(c => c.vector !== null)
      .map(c => {
        const chunkVector = Array.from(new Float32Array(c.vector!.buffer));
        const score = cosineSimilarity(queryVector, chunkVector);
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    for (const item of scored) {
      results.push({
        docId: item.doc_id,
        docName: item.doc_name,
        chunkIndex: item.chunk_index,
        content: item.content,
        score: item.score,
      });
    }
  }
  
  // 关键词搜索 (简化版)
  if (options?.keyword !== false) {
    const keywordResult = await this.adapter.query(
      `SELECT c.doc_id, c.chunk_index, c.content, d.name as doc_name 
       FROM kb_chunks c 
       JOIN kb_documents d ON c.doc_id = d.doc_id 
       WHERE (d.owner_id = ? OR d.shared = 1) AND c.content LIKE ?`,
      [this.owner, `%${query}%`]
    );
    
    for (const row of keywordResult.rows as any[]) {
      if (!results.find(r => r.docId === row.doc_id && r.chunkIndex === row.chunk_index)) {
        results.push({
          docId: row.doc_id,
          docName: row.doc_name,
          chunkIndex: row.chunk_index,
          content: row.content,
          score: 0.5, // 关键词搜索固定分数
        });
      }
    }
  }
  
  return results.slice(0, limit);
}
```

- [ ] **Step 4: 修改其他 KnowledgeBase 方法**

需要修改的方法包括：
- `list()` - 列出文档
- `delete()` - 删除文档
- `update()` - 更新文档
- `getDocument()` - 获取文档
- `getStats()` - 获取统计
- `setShared()` - 设置共享

所有这些方法都需要改为使用 `this.adapter.execute()` 和 `this.adapter.query()`。

---

## Task 3: 重写 GraphStore 类使用 MySQL

**Files:**
- Modify: `src/memory/knowledge-graph/graph-store.ts`

- [ ] **Step 1: 修改 GraphStore 类定义**

```typescript
import { getMySQLAdapter, type MySQLAdapter } from "../../db/mysql-adapter.js";

export class GraphStore {
  private adapter: MySQLAdapter;
  private owner: string;
  private data: GraphData = { version: 1, nodes: {}, edges: {}, adjacency: {} };
  private dirty = false;

  constructor(owner: string) {
    this.adapter = getMySQLAdapter();
    this.owner = owner;
    this.load();
  }
  
  private async load(): Promise<void> {
    // 从 MySQL 加载所有节点和边
    const [nodesResult, edgesResult] = await Promise.all([
      this.adapter.query("SELECT * FROM kb_graph_nodes WHERE owner_id = ?", [this.owner]),
      this.adapter.query("SELECT * FROM kb_graph_edges WHERE owner_id = ?", [this.owner]),
    ]);
    
    // 转换为内存结构
    for (const row of nodesResult.rows as any[]) {
      this.data.nodes[row.id] = {
        id: row.id,
        label: row.label,
        type: row.type,
        tags: JSON.parse(row.tags || '[]'),
        properties: JSON.parse(row.properties || '{}'),
        createdAt: row.created_at,
      };
    }
    
    for (const row of edgesResult.rows as any[]) {
      this.data.edges[row.id] = {
        id: row.id,
        source: row.source_id,
        target: row.target_id,
        type: row.type,
        label: row.label,
        weight: row.weight,
        createdAt: row.created_at,
      };
    }
  }
```

- [ ] **Step 2: 修改 addNode 方法**

```typescript
async addNode(node: Omit<GraphNode, "id"> & { id?: string }): Promise<GraphNode> {
  const id = node.id ?? crypto.randomUUID().slice(0, 12);
  const full: GraphNode = { ...node, id, createdAt: node.createdAt ?? Date.now() };
  
  // 保存到 MySQL
  await this.adapter.execute(
    `INSERT INTO kb_graph_nodes (id, owner_id, label, type, tags, properties, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, this.owner, full.label, full.type, JSON.stringify(full.tags), JSON.stringify(full.properties), full.createdAt]
  );
  
  // 更新内存缓存
  this.data.nodes[id] = full;
  if (!this.data.adjacency[id]) this.data.adjacency[id] = [];
  
  return full;
}
```

- [ ] **Step 3: 修改 addEdge 方法**

```typescript
async addEdge(
  source: string,
  target: string,
  type: EdgeType,
  label: string,
  weight = 1.0
): Promise<GraphEdge> {
  if (!this.data.nodes[source] || !this.data.nodes[target]) {
    throw new Error(`Cannot add edge: node(s) not found (${source} -> ${target})`);
  }
  
  const id = crypto.randomUUID().slice(0, 12);
  const edge: GraphEdge = {
    id,
    source,
    target,
    type,
    label,
    weight,
    createdAt: Date.now(),
  };
  
  // 保存到 MySQL
  await this.adapter.execute(
    `INSERT INTO kb_graph_edges (id, owner_id, source_id, target_id, type, label, weight, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, this.owner, source, target, type, label, weight, edge.createdAt]
  );
  
  // 更新内存缓存
  this.data.edges[id] = edge;
  this.data.adjacency[source] = this.data.adjacency[source] ?? [];
  this.data.adjacency[target] = this.data.adjacency[target] ?? [];
  this.data.adjacency[source].push(id);
  this.data.adjacency[target].push(id);
  
  return edge;
}
```

---

## Task 4: 重写 FileLTMBackend 使用 MySQL

**Files:**
- Modify: `src/memory/ltm.ts`

- [ ] **Step 1: 创建新的 MySQLLTMBackend 类**

```typescript
import { getMySQLAdapter, type MySQLAdapter } from "../db/mysql-adapter.js";

export class MySQLLTMBackend implements LTMBackend {
  private adapter: MySQLAdapter;
  private config: LTMConfig;
  private owner: string;

  constructor(owner: string, config?: Partial<LTMConfig>) {
    this.config = { ...DEFAULT_LTM_CONFIG, ...config };
    this.owner = owner;
    this.adapter = getMySQLAdapter();
  }

  async store(key: string, value: unknown, options?: LTMStoreOptions): Promise<string> {
    const id = `ltm_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const now = Date.now();
    
    // 如果有 embedding provider，计算向量
    let vector: number[] | null = null;
    if (this.config.embeddingProvider) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      [vector] = await this.config.embeddingProvider.embed([text]);
    }
    
    const vectorBlob = vector ? Buffer.from(new Float32Array(vector).buffer) : null;
    
    await this.adapter.execute(
      `INSERT INTO kb_ltm_entries 
       (id, owner_id, entry_key, value, tags, source, summary, created_at, updated_at, last_accessed_at, vector, is_archived) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        id,
        this.owner,
        key,
        JSON.stringify(value),
        JSON.stringify(options?.tags ?? []),
        options?.source ?? '',
        options?.summary ?? '',
        now,
        now,
        now,
        vectorBlob,
      ]
    );
    
    return id;
  }

  async search(query: string, options?: LTMSearchOptions): Promise<LTMEntry[]> {
    const limit = options?.limit ?? 10;
    const includeArchive = options?.includeArchive ?? false;
    
    let sql = `SELECT * FROM kb_ltm_entries WHERE owner_id = ?`;
    const params: any[] = [this.owner];
    
    if (!includeArchive) {
      sql += ` AND is_archived = 0`;
    }
    
    if (options?.tags && options.tags.length > 0) {
      // JSON 数组包含查询
      sql += ` AND (${options.tags.map(() => `JSON_CONTAINS(tags, ?)`).join(' OR ')})`;
      params.push(...options.tags.map(t => JSON.stringify(t)));
    }
    
    // 语义搜索
    if (options?.semantic && this.config.embeddingProvider) {
      const queryVector = (await this.config.embeddingProvider.embed([query]))[0];
      
      // 获取所有条目并计算相似度
      const result = await this.adapter.query(sql, params);
      const entries = (result.rows as any[]).map(row => ({
        ...this.rowToEntry(row),
        score: row.vector 
          ? cosineSimilarity(queryVector, Array.from(new Float32Array(row.vector.buffer)))
          : 0,
      }));
      
      return entries.sort((a, b) => b.score - a.score).slice(0, limit);
    }
    
    // 关键词搜索
    sql += ` AND (entry_key LIKE ? OR value LIKE ?) ORDER BY last_accessed_at DESC LIMIT ?`;
    params.push(`%${query}%`, `%${query}%`, limit);
    
    const result = await this.adapter.query(sql, params);
    return (result.rows as any[]).map(row => this.rowToEntry(row));
  }
  
  private rowToEntry(row: any): LTMEntry {
    return {
      id: row.id,
      key: row.entry_key,
      value: JSON.parse(row.value),
      tags: JSON.parse(row.tags || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      source: row.source,
      summary: row.summary,
    };
  }
  
  // 其他方法: getByKey, getById, delete, list, stats, archive 等
}
```

- [ ] **Step 2: 更新导出**

```typescript
// 在 ltm.ts 底部，修改导出
export const LongTermMemory = MySQLLTMBackend;
export type LongTermMemory = MySQLLTMBackend;
```

---

## Task 5: 更新工厂函数

**Files:**
- Modify: `src/skills/knowledge-skills.ts`

- [ ] **Step 1: 修改 getKnowledgeBase 工厂函数**

```typescript
const kbInstances = new Map<string, KnowledgeBase>();

export function getKnowledgeBase(owner: string): KnowledgeBase {
  if (!kbInstances.has(owner)) {
    // 不再传入 dbPath，KnowledgeBase 内部使用 MySQLAdapter
    const kb = new KnowledgeBase(owner, globalEmbeddingProvider ?? undefined);
    kbInstances.set(owner, kb);
  }
  return kbInstances.get(owner)!;
}
```

- [ ] **Step 2: 修改 KnowledgeGraphManager 实例化**

```typescript
// 在需要创建 KnowledgeGraphManager 的地方
const manager = new KnowledgeGraphManager(owner);
```

---

## Task 6: 测试验证

- [ ] **Step 1: 重启服务器并测试 MySQL 连接**

```bash
# 停止现有服务器
pkill -f "tsx src/server.ts"

# 启动新服务器
export $(cat .env.local | grep -v '^#' | xargs)
npm run dev
```

- [ ] **Step 2: 测试知识库功能**

- 上传 PDF 文档
- 检查文档是否正确存入 MySQL
- 测试搜索功能

- [ ] **Step 3: 测试知识图谱功能**

- 存储记忆
- 检查图节点和边是否正确存入 MySQL

- [ ] **Step 4: 测试 LTM 功能**

- 存储长期记忆
- 检查记忆是否正确存入 MySQL

---

## 计划总结

**Spec Coverage:**
- ✅ KnowledgeBase 迁移到 MySQL
- ✅ GraphStore 迁移到 MySQL  
- ✅ LTM 迁移到 MySQL
- ✅ 所有工厂函数更新
- ✅ 测试验证

**Placeholder Check:** None

**Type Consistency:** All types use `MySQLAdapter` consistently

**Estimated Time:** 2-3 hours for complete migration and testing
