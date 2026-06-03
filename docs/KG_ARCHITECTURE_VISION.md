# RAOS 知识双轨架构设计（KG Vision）

> 文档版本: v1.0  
> 与 `docs/KNOWLEDGE_GRAPH_REVIEW_v2.md` 配套：那篇是"现状 review + bug 清单"，这篇是"目标架构 + 改造路线"。  
> 核心思路（用户原话）：
> - 构建侧：**知识 → 知识库 → 知识图谱**（一个逐级精炼的蒸馏过程）
> - 消费侧：**知识 → 知识图谱 → 反馈**（KG 是检索入口，不是后置增强）

---

## 0. TL;DR

把"KB 和 KG 谁优先"这个事想清楚之后，整个检索系统可以从现在的 **"两条平行线 + 后置融合"** 改成 **"KG 先收敛，KB 再补全"**：

```
现在:  query → [KB向量+关键词]  ┐
                              ├─ RRF 融合 → 答案
      query → [KG BFS]  ──────┘  (可选后置增强)

未来:  query → [KG 实体+子图+社区] → KB chunks 补全 → LLM 合成 → 答案
                ↑                        ↑
                └──── 反馈环路 ←──────────┘
```

核心差异是**KG 不再是 KB 的补充，而是 KB 的索引**。KG 的节点是 KB 内容的语义化指针，KG 的边是 KB 内容的语义关系，KG 的社区是 KB 内容的语义聚类。

---

## 1. 愿景架构图

### 1.1 沉淀侧（构建）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Stage 1: 知识层 (Knowledge)                                                  │
│   原始输入：文档(pdf/docx/md/txt) | 网页 | 对话 | LTM 记忆 | 表格            │
│   形态：非结构化 / 半结构化                                                  │
│   关键操作：ingest (路径或 content)                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ Stage 2: 知识库层 (Knowledge Base)                                           │
│   目标：让"找得到"成为可能                                                    │
│   操作：                                                                      │
│     · 分块 (chunk by heading / token window)                                │
│     · 向量化 (embedding → Qdrant)                                           │
│     · 全文索引 (MySQL FULLTEXT)                                             │
│     · 关键词提取 (LLM / KeyBERT)                                            │
│     · 元数据 (owner, tags, collection, version)                             │
│   关键产出：kb_chunks / kb_documents / kb_keywords / kb_vectors             │
│   角色：**KB chunks 是图谱的"源"**，每个 chunk 在 KG 里都有对应节点          │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ Stage 3: 知识图谱层 (Knowledge Graph)                                        │
│   目标：让"理解关系"成为可能                                                  │
│   操作（**离线 + 增量**两条腿）：                                            │
│     · 实体抽取 (LLM: 文档 → entities)                                       │
│     · 关系抽取 (LLM: chunks → relations，含 source/target/weight)          │
│     · 实体归一 (entity linking: "苹果"/"Apple"/"🍎" 合并)                  │
│     · 关系归一 (rel type 标准化: related_to/depends_on/part_of...)          │
│     · 社区检测 (Louvain 增量)                                                │
│     · 中心性计算 (god nodes / bridge nodes)                                  │
│     · 图谱质量评估 (孤立节点、重复边、连通性)                                │
│   关键产出：kb_graph_nodes / kb_graph_edges / communities / embeddings       │
│   角色：**KG 是 KB 的语义索引**（每个 entity 节点都反向指向一个或多个 chunk）│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 消费侧（检索）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 用户 Query                                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 1: Query Understanding (classifyQuery + entity linking)                │
│   · 类型分类：factual | relational | discovery | hybrid                     │
│   · 关键实体抽取 (offline-trained NER + online LLM 兜底)                    │
│   · Query 改写 (展开同义词、补全省略、跨语言)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 2: Graph Recall (KG-first 入口)                                        │
│   · 实体匹配：query entities → graph nodes (含 entity linking)               │
│   · 子图召回：BFS 扩展 (depth=2-3)，按关系类型权重                            │
│   · 社区召回：seed node 所在社区的其他 relevant entities                      │
│   · 中心节点召回：god nodes / bridge nodes 兜底                              │
│   · 路径召回：relational query 触发 path search                              │
│   · 召回产物：seed entities + related entities + paths + communities         │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 3: Chunk Expansion (KG → KB 跳回)                                     │
│   · 每个 entity 节点反查：它从哪些 kb_chunks 里抽出来的？                    │
│   · 用图谱边作为 chunk 之间的"软连接"，做 chunk 级别扩展                      │
│   · 召回 KB chunks (top-N per entity, MMR 去重)                             │
│   · 这一步是**图谱优势**真正发挥的地方：能用关系做 chunk 关联，而不仅是相似度│
└─────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 4: LLM Synthesis (合成)                                                 │
│   · 输入：query + entities + relations + chunks                              │
│   · 提示模板：明确告诉 LLM "用图谱的结构 + 原文的内容"                        │
│   · 输出：answer + 引用 (entity 引用 + chunk 引用 + 关系路径)                │
│   · 引用可点击 → 跳到图谱对应节点的可视化                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 5: Feedback Capture (反馈采集)                                          │
│   · 显式：采纳/拒绝/复制/评分                                                 │
│   · 隐式：停留时长、点击位置、follow-up query                                │
│   · 关联到具体 (query, entity, chunk) 三元组                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ↓
                          (反哺) 反馈环路
```

### 1.3 反馈环路

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 反馈 → KG 反哺                                                              │
│                                                                              │
│   1. 边权重调整：                                                             │
│      · 用户采纳的 (entity_a, relation, entity_b) → weight++                  │
│      · 用户拒绝的 → weight--                                                  │
│      · 基于 weight 的 Louvain 增量重算                                       │
│                                                                              │
│   2. 关系抽取样本库：                                                          │
│      · (chunk_text, accepted_relations) 作为正样本                            │
│      · (chunk_text, rejected_relations) 作为负样本                            │
│      · 用于微调 LLM extractor 或训练轻量分类器                                │
│                                                                              │
│   3. 实体重要性评分：                                                         │
│      · god node 不再只看度数，结合"被引用于答案的次数"                         │
│      · 把"查询命中频率 × 反馈采纳率"作为节点 importance                       │
│                                                                              │
│   4. 召回质量监控：                                                            │
│      · Top-K recall、MRR、采纳率、拒绝率                                     │
│      · 按 query type (factual/relational/discovery) 分别看                    │
│      · 触发告警：连续 N 次某 query type 召回失败                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 现状 vs 愿景的鸿沟

把 v2 review 里的发现映射到愿景上，每条都标注"差距"和"改造点"：

| 愿景要素 | 现状 | 差距 | 改造点 |
|---------|------|------|--------|
| KB chunks → KG entity 反向链接 | 没有 | 🔴 大 | KG entity 节点增加 `sourceChunkIds: string[]` 属性 |
| KG-first 检索 | graphSearch 只是 hybrid search 的可选前置 | 🔴 大 | 新增独立的 `kgRecall` 流程，KB 只做 chunk expansion |
| 实体抽取 (entity-only) | 只有关系抽取 (entities 是关系副产品) | 🔴 大 | 新增 `extractEntities(text)`，独立于 `extractRelationships` |
| 实体归一 / entity linking | 没有 | 🟠 中 | 引入实体的 canonical form 概念，处理同义词、缩写、跨语言 |
| 图谱版本管理 | 没有 | 🟠 中 | KG 节点加 `version` / `validFrom` / `validTo`，支持回滚 |
| 反馈环路 | 没有 | 🔴 大 | 新增 `feedback` 表 + 反馈采集 skill + 反哺管线 |
| Query entity linking | 只有 query classification (4 类) | 🟠 中 | classification 上加 entity extraction |
| Chunk expansion (用图谱关系) | 用向量相似度，无图谱关系 | 🟠 中 | 利用 (entity_a → entity_b) 关系把"语义相关但字面不相似"的 chunk 串起来 |
| 引用 + 跳转 | search 结果只给 docId + chunkIndex | 🟢 小 | 在 answer 里加 entity/chunk/relation 引用，前端能跳到图谱可视化 |
| 图谱健康度 | 只有 stats (node/edge/community 数) | 🟢 小 | 加 health (孤立节点率、重复边率、覆盖率) |

---

## 3. 沉淀链路重构

### 3.1 Stage 1 → 2 改进

当前 `kb_ingest` 已经做得很扎实：分块、向量化、关键词、版面识别、媒体提取。要补的是**幂等性**和**版本管理**：

- **幂等性**：当前基于 content hash 判等，**OK**。但 LLM 抽取的实体和关系需要**重跑幂等**——同一份内容重 ingest 不应产生重复图谱节点（v2 review §2.1 的 e.relation bug 修了之后才能保证）。
- **chunk_id 稳定**：建议用 `sha256(docId + content_hash + chunk_index)` 而不是 UUID，让 chunk 的 identity 和内容绑定。这样图谱节点可以**稳定地反查**到 chunk。

### 3.2 Stage 2 → 3 改进（核心）

**当前的现实**（v2 review §3）：
- LLM 关系抽取在三处重复实现（`knowledge-skills.ts`、`parsing-queue.ts:599`、`parsing-queue.ts:1266`）
- 三处参数、限制、anchor 都不一致
- 抽取出的实体是"关系的副产物"——只覆盖 relation 两端的实体，不覆盖文档里的所有命名实体
- 边去重失效（v2 §2.1）

**新设计**：

```typescript
// 新增：src/memory/knowledge-graph/extraction-pipeline.ts

interface ExtractionResult {
  entities: Array<{
    canonicalForm: string;      // 归一化后
    surfaceForms: string[];     // 原文里出现过的各种形式
    entityType: NodeType;       // PERSON / ORG / CONCEPT / PRODUCT / ...
    importance: number;         // 0-1，LLM 给的
    sourceChunkIds: string[];   // 反向链接到 KB chunks
  }>;
  relations: Array<{
    source: string;             // canonical form
    target: string;             // canonical form
    relation: string;           // 标准化的关系类型
    confidence: number;         // 0-1
    sourceChunkId: string;      // 从哪个 chunk 抽出来的
    evidence: string;           // 原文片段
  }>;
}

async function extractFromChunk(
  chunkText: string,
  chunkId: string,
  llmProvider: LLMProvider,
  options: { existingEntities?: Map<string, GraphNode> }
): Promise<ExtractionResult> {
  // 1. 单次 LLM 调用，输出 entities + relations 一起
  //    prompt: "从以下文本中抽取所有命名实体和它们之间的关系..."
  //    避免两次调用产生的 entity 不一致
  // 2. 实体归一：先查 existingEntities，hit 就复用
  // 3. 关系归一：rel type 标准化
  // 4. 返回带 sourceChunkId 的完整结果
}

async function extractFromDocument(
  docId: string,
  chunks: KBChunk[],
  llmProvider: LLMProvider
): Promise<ExtractionResult> {
  // 1. 顺序处理 chunks（避免 LLM 限流）
  // 2. 跨 chunk 的 entity linking：把上一 chunk 的 canonical form 传到下一 chunk
  // 3. 合并所有结果
  // 4. 去重 + 边合并
}
```

**核心改进**：

1. **entities 和 relations 一次抽**（而不是先抽关系再倒推实体）
2. **chunkId 反向链接**：每个抽取的实体/关系都带 `sourceChunkId`，写入 graph 节点
3. **跨 chunk entity linking**：处理"苹果"在 chunk 1 出现，"Apple Inc." 在 chunk 5 出现的情况
4. **收敛到单一管线**：替换现在 3 处重复实现

### 3.3 图谱的版本与增量

```typescript
// GraphNode 新增字段
interface GraphNode {
  // ... 现有字段
  version: number;             // 节点版本，每次 update 自增
  sourceChunkIds: string[];    // 反向链接到 KB chunks
  firstSeen: number;           // 首次出现时间
  lastUpdated: number;         // 最近更新
  validFrom?: number;          // 时间有效性（可选，用于时序图谱）
  validTo?: number;
  supersedes?: string;         // 实体合并时，指向被合并的旧节点 ID
  supersedesChain?: string[];  // 多步合并链
}

// GraphEdge 新增字段
interface GraphEdge {
  // ... 现有字段
  sourceChunkId?: string;      // 关系从哪个 chunk 抽出来的
  evidence?: string;           // 原文证据
  version: number;
  feedbackScore: number;       // 由反馈环路调整，初始 0
  // weight = base_weight * (1 + tanh(feedbackScore))
}
```

**为什么需要 version**：
- 文档更新时，旧的实体/关系要被**作废**而不是删除
- 用 `validTo` 标记，新版本用新的 `validFrom`
- 检索时默认只返回 `validTo === undefined` 的节点
- 支持"展示节点的演化历史"

### 3.4 离线 vs 在线

抽取 pipeline 应该**离线跑**（在 `kb_ingest` 完成后异步触发），而不是同步阻塞：
- 新建 `kg-extraction-queue`（参考 `kb-graph-sync.ts` 的设计）
- 入库后入队，后台 worker 消费
- 失败重试 + 死信队列
- 监控：队列长度、平均处理时间、成功率

`onFactStored` 触发的 TEMPORAL 边可以保持**在线**（即时、轻量、不依赖 LLM）。

---

## 4. 消费链路重构

### 4.1 Step 1: Query Understanding

```typescript
// src/memory/knowledge-graph/query-understanding.ts

interface QueryUnderstanding {
  raw: string;
  normalized: string;            // 小写、归一化、跨语言展开
  queryType: 'factual' | 'relational' | 'discovery' | 'hybrid';
  entities: Array<{
    surfaceForm: string;         // 原文里出现的形式
    canonicalForm: string;       // 归一化形式
    entityType: NodeType;
    confidence: number;
  }>;
  intent: string;                // "找出 A 和 B 的关系"/"总结关于 X 的所有信息"...
  keywords: string[];            // 分类用的关键词
}

async function understandQuery(
  query: string,
  graphManager: KnowledgeGraphManager,
  llmProvider?: LLMProvider
): Promise<QueryUnderstanding> {
  // 1. classifyQuery(query) → queryType (已存在)
  // 2. NER + entity linking:
  //    a. 先用图谱中已有的 entity labels 做精确匹配
  //    b. 没匹配的用 LLM 抽（带提示"尽量使用图谱中的 canonical form"）
  //    c. 跨语言：zh → en via 图谱的 ZH_TAG_MAP 或 LLM
  // 3. 输出 QueryUnderstanding
}
```

**关键**：
- **优先利用图谱已有的 entity vocabulary**——比从零抽 NER 准确得多
- LLM NER 只在图谱匹配失败时兜底
- entity linking 是**闭环**的：每轮反馈都会让 linking 字典更准

### 4.2 Step 2: Graph Recall（核心）

把现在散落在 `querySubgraph` / `graphSearch` / `pathSearch` 里的能力，**重组成一个统一的 recall 流程**：

```typescript
// src/memory/knowledge-graph/recall.ts

interface RecallOptions {
  maxSeeds?: number;             // 默认 5
  maxDepth?: number;             // 默认 3
  maxEntities?: number;          // 默认 100
  includeCommunities?: boolean;  // 默认 true
  includeGodNodes?: boolean;     // 默认 false（仅 discovery 模式）
  allowedDocIds?: string[];      // ACL
}

interface RecallResult {
  seedEntities: GraphNode[];     // 直接匹配
  relatedEntities: GraphNode[];  // 通过边扩展
  paths: Array<{ nodes: GraphNode[]; edges: GraphEdge[] }>;  // 仅 relational
  communities: Array<{ id: number; entityIds: string[] }>;
  scores: Map<string, number>;   // entity id → relevance score
}

async function recallFromGraph(
  query: QueryUnderstanding,
  graphManager: KnowledgeGraphManager,
  options?: RecallOptions
): Promise<RecallResult> {
  const store = await graphManager.getStore();

  // Stage A: Seed Entity Discovery
  const seedEntities = await findSeedEntities(query, store, options);

  // Stage B: Subgraph Expansion (按关系类型权重剪枝)
  const subgraph = await expandSubgraph(seedEntities, store, options);

  // Stage C: Community Lookup (仅当 query 是 discovery 类型)
  let communities: Array<...> = [];
  if (query.queryType === 'discovery' || options.includeCommunities) {
    communities = await lookupCommunities(seedEntities, graphManager);
  }

  // Stage D: Path Discovery (仅当 query 是 relational 类型)
  let paths: Array<...> = [];
  if (query.queryType === 'relational' && query.entities.length >= 2) {
    paths = await findPathsBetween(query.entities[0], query.entities[1], store);
  }

  // Stage E: Score Entities (Pagerank / Personalized PR / 简单 BFS 距离)
  const scores = await scoreEntities(subgraph, seedEntities);

  return { seedEntities, relatedEntities: subgraph.nodes, paths, communities, scores };
}
```

**关键改进点**：

1. **Seed 发现用图谱自身索引**（v2 §5.2）：不再 `getAllNodes()` 全量匹配，而是：
   - MySQL 后端：用 `WHERE label IN (...)` 或 FULLTEXT
   - Neo4j 后端：用 fulltext index
2. **关系类型权重剪枝**：扩展子图时，按 (rel_type, query_intent) 加权，例如"找 A 和 B 的关系"会优先扩展 `related_to` / `depends_on` 而不是 `shared_tag`
3. **Personalized Pagerank**：用 query entities 作为种子节点算 PR，比 BFS 距离更准
4. **路径发现**走 Neo4j `shortestPath()`（如果用 Neo4j 后端）

### 4.3 Step 3: Chunk Expansion（KG → KB 跳回）

```typescript
// src/memory/knowledge-graph/chunk-expander.ts

interface ExpandedChunk {
  chunkId: string;
  docId: string;
  content: string;
  // 关键：图谱的"关系路径"作为相关性信号
  graphSignal: {
    pathFromQuery: GraphNode[];   // 从 query entity 到这个 chunk 的实体节点的路径
    intermediateRelations: GraphEdge[];  // 路径上的边
    communityBoost: number;       // 如果 chunk 所在社区和 query 社区一致，加分
  };
  vectorScore: number;            // 兜底相似度
  graphScore: number;             // 图谱相关性评分
  combinedScore: number;          // 0.6 * graphScore + 0.4 * vectorScore
}

async function expandToChunks(
  recall: RecallResult,
  kb: KnowledgeBase,
  options: { maxChunks?: number; perEntityLimit?: number }
): Promise<ExpandedChunk[]> {
  // 1. 每个 recall entity → 反查它的 sourceChunkIds
  // 2. 把 chunks 按 entity 关联强度排序
  // 3. MMR 去重（避免同一 chunk 因多 entity 被重复加进来）
  // 4. 关键：用图谱的 path 作为排序信号，不只是相似度
}
```

**核心价值**：这一步是"图谱优势"真正发挥的地方。比如用户问"A 公司和 B 公司的合作历史"：
- 字面相似度检索：能召回直接提到 "A 公司" / "B 公司" 的 chunk
- 图谱增强召回：**还能召回**通过 `A公司 -合作-> C项目 -参与-> B公司` 这种间接关系连起来的 chunk

### 4.4 Step 4: LLM Synthesis

```typescript
// 提示模板（关键）
const synthesisPrompt = `
# 用户问题
${query.raw}

# 知识图谱召回（语义结构）
${formatGraphRecall(recall)}

# 相关原文片段
${formatChunks(expandedChunks)}

# 任务
基于以上信息回答用户问题。回答时：
1. 优先使用知识图谱的结构信息（实体、关系、社区）
2. 用原文片段补充细节
3. 每个事实都标注引用 [entity:xxx] [chunk:yyy] [path:zzz]
4. 如果信息不足，明确说明

# 回答
`;
```

**关键设计**：
- LLM 看到的不是一堆 chunks，而是 **结构化的图谱 + 原文**——这能极大提升回答质量
- 引用规范统一：`[entity:xxx]` 跳图谱节点，`[chunk:yyy]` 跳原文，`[path:zzz]` 跳图谱路径可视化
- 回答模板：先给结论 → 给支撑事实 → 给不确定部分

### 4.5 Step 5: Feedback Capture

```typescript
// 新增：src/memory/knowledge-graph/feedback-store.ts

interface FeedbackEvent {
  id: string;
  userId: string;
  queryId: string;
  query: string;
  queryUnderstanding: QueryUnderstanding;
  recallResult: RecallResult;     // 检索时的快照
  expandedChunks: ExpandedChunk[];
  // 用户反馈
  accepted: boolean;              // 是否采纳回答
  rating?: number;                // 1-5
  rejectedEntities?: string[];    // 明确点踩的实体
  acceptedChunks?: string[];      // 用户展开/复制的 chunk
  dwellTimeMs?: number;           // 停留时长
  followUpQuery?: string;         // 追问
  timestamp: number;
}
```

**采集方式**：
- 显式：前端"采纳/拒绝"按钮
- 半显式：用户展开 chunk 详情、复制引用
- 隐式：停留时间、追问时是否引用同一图谱节点

---

## 5. 反馈环路

### 5.1 边权重反哺

```typescript
// src/memory/knowledge-graph/feedback-pipeline.ts

async function applyFeedback(feedback: FeedbackEvent): Promise<void> {
  const graphManager = await getGraphManager(feedback.userId);
  const store = await graphManager.getStore();

  // 1. 调整相关边的 feedbackScore
  for (const edge of feedback.recallResult.edges) {
    const delta = feedback.accepted ? +1 : -1;
    await store.incrementEdgeScore(edge.id, delta);
  }

  // 2. 更新实体的 importance
  for (const entity of feedback.recallResult.seedEntities) {
    await store.incrementEntityImportance(entity.id, feedback.accepted ? +0.05 : -0.1);
  }

  // 3. 把 (query, accepted_relations) 存为抽取样本
  if (feedback.accepted && feedback.expandedChunks.length > 0) {
    await saveExtractionSample(feedback);
  }

  // 4. 如果拒绝且有明确点踩的 entity，做 entity 黑名单（短期）
  if (feedback.rejectedEntities) {
    for (const entityId of feedback.rejectedEntities) {
      await store.markEntityNegative(entityId, feedback.userId, ttl: 24h);
    }
  }
}
```

**关键设计**：
- 边权重用 **tanh 缩放** 防止单边 feedback 把 weight 推到无穷
- 实体 importance 用**指数移动平均**而不是简单累加
- 反馈样本进入"抽取训练集"——可以定期 fine-tune LLM extractor

### 5.2 监控指标

| 指标 | 计算 | 用途 |
|------|------|------|
| **Top-K recall** | 被采纳的 chunk 在 Top-K 里的比例 | 召回质量 |
| **采纳率** | accepted / total | 整体满意度 |
| **MRR** | 第一个被采纳结果的倒数排名 | 排序质量 |
| **按 query type 分桶的采纳率** | factual/relational/discovery 分别看 | 哪类查询最弱 |
| **图谱覆盖率** | recall entity 中 type=kb_document 节点 / 总 doc 数 | KG 是否覆盖全量 KB |
| **实体归一准确率** | entity linking 后人工 review 的一致率 | NER 质量 |
| **Louvain 稳定性** | 两次重算的 NMI | 社区是否稳定 |
| **抽取成本** | 每次 ingest 的 LLM 调用次数 × token | 性能成本 |

**输出位置**：
- `/api/graph/health` 暴露核心指标
- `/api/graph/feedback/stats` 暴露反馈统计
- 定时任务每天计算并存储

---

## 6. 关键技术决策

### 6.1 数据模型

| 选择 | 决定 | 理由 |
|------|------|------|
| KG 节点 ID 模式 | `<type>_<canonical>_<chunkId>` (e.g. `entity_苹果_chunk_abc123`) | 稳定可读，entity linking 命中快 |
| KG 节点 vs KB chunk 关系 | 1:N (一个实体可能从多个 chunk 抽出) | 一致性优先 |
| 关系是否带 source chunk | 是 | 用于证据回溯 |
| 实体归一 key | `(canonicalForm, language)` | 跨语言归一 |
| 关系归一字典 | 维护一个静态 + LLM 扩展的 rel_type registry | 控制图谱的"语义空间" |
| 关系存储 | 双向存（incoming + outgoing） | 减少查询时反查 |
| 节点 embedding | 每个 entity 节点存一个 (中心化: 多 surfaceForm 的均值) | 语义检索 fallback |

### 6.2 检索架构

| 选择 | 决定 | 理由 |
|------|------|------|
| 入口选择 | KG-first | 用户明确要求 |
| Fallback 策略 | KG 召回为空时退化到 KB 向量+关键词 | 不强求全 KG |
| 召回融合 | 不用 RRF，KG 召回作为"硬约束 + 排序信号" | KG 节点强相关，KB chunk 弱相关 |
| LLM 介入时机 | 仅在 query understanding 和 synthesis 阶段 | 中间过程零 LLM，延迟可控 |
| 缓存 | recall 结果按 (userId, query hash) 缓存 5 分钟 | 高频 query 提速 |
| 增量更新触发 | 文档 ingest 完成 → extraction queue → graph update | 不阻塞主流程 |

### 6.3 性能预算

| 阶段 | 目标 P95 | 当前实际 |
|------|---------|---------|
| Query Understanding | 200ms | ~100ms (纯规则) |
| KG Recall | 500ms | 依赖图大小 |
| Chunk Expansion | 800ms | ~600ms |
| LLM Synthesis | 5s | 5-8s |
| **端到端** | 7s | ~10s |

### 6.4 多租户隔离

- 每个用户的 KG 完全独立（已实现）
- 共享 KB 的 KG 节点处理：shared KB 的 entity 节点**同时存在于共享者和被共享者的 KG**，通过 `sourceChunkIds` 反向链接共享 chunk
- 跨用户图谱融合：不支持（用户隔离优先）

### 6.5 失败与降级

| 失败点 | 降级策略 |
|--------|---------|
| LLM NER 失败 | 用规则匹配 + 关键词 |
| KG 召回为空 | 直接走 KB 向量+关键词 |
| Neo4j 不可用 | 切换 MySQL 后端 |
| 社区检测超时 | 跳过 community，使用 god nodes |
| Chunk 检索失败 | 返回空，synthesis 提示"未找到具体引用" |

---

## 7. 与现有代码的对接

### 7.1 保留（不要动）

- `kb_graph_nodes` / `kb_graph_edges` 表结构（加字段，不改结构）
- `GraphNode` / `GraphEdge` 类型（加字段，兼容老数据）
- `KnowledgeGraphManager` 类签名（`querySubgraph`、`graphSearch`、`pathSearch`、`getPath`、`getCommunities`、`syncFromLTM`）
- Neo4j + MySQL 双后端架构
- `graph_query` / `graph_path` / `graph_communities` / `graph_deduplicate` 4 个 skill（增强不重写）
- 前端可视化（ECharts 力导向图）

### 7.2 改（增量改造）

| 模块 | 改什么 |
|------|--------|
| `manager.ts` | `onFactStored` 拆成两层：`onFactStored`（在线轻量）+ `extractFromChunk`（离线 LLM） |
| `bfs-extractor.ts` | `scoreNodes` 改为 DB 端索引查询；`extractSubgraph` 加 `maxRelTypeWeights` 参数 |
| `relationship-extractor.ts` | 拆出 `extractEntities`，与 `extractRelationships` 并列；合并成单次 LLM 调用的 `extractFromChunk` |
| `graph-store.ts` / `neo4j-store.ts` | `addNode` 支持 `sourceChunkIds`；`addEdge` 支持 `sourceChunkId` + `evidence`；新增 `incrementEdgeScore` / `incrementEntityImportance` / `markEntityNegative` |
| `types.ts` | `GraphNode` 加 `version` / `sourceChunkIds` / `importance` / `supersedesChain`；`GraphEdge` 加 `version` / `feedbackScore` / `sourceChunkId` / `evidence`；`EdgeType` 补全 6 种字面量（v2 §2.2） |
| `knowledge-skills.ts` (kb_ingest) | ingest 完成后入 `kg-extraction-queue`，不内联 LLM 抽取 |
| `knowledge-skills.ts` (kb_search) | 重写为 KG-first（Step 2 → Step 3 → Step 4） |
| `hybrid-search.ts` | 改名为 `vector-fallback-search.ts`，只做 fallback 路径；新增 `kg-recall.ts` 作为主路径 |
| `parsing-queue.ts` | 移除两处重复的 LLM 抽取（v2 §3），改为入队 |
| `user-session.ts` | 默认 backend 改 `mysql`（v2 §2.4） |
| `kb-graph-sync.ts` | 共享 KB 时同步 entity 节点（不只是 doc 节点） |

### 7.3 新建

| 模块 | 作用 |
|------|------|
| `src/memory/knowledge-graph/extraction-pipeline.ts` | 抽取主流程（entities + relations 一次抽） |
| `src/memory/knowledge-graph/entity-linker.ts` | 实体归一（surface form → canonical form） |
| `src/memory/knowledge-graph/recall.ts` | 统一 KG recall（替换散落的 querySubgraph/graphSearch） |
| `src/memory/knowledge-graph/chunk-expander.ts` | KG → KB 反查与排序 |
| `src/memory/knowledge-graph/query-understanding.ts` | Query 理解（classification + NER） |
| `src/memory/knowledge-graph/feedback-store.ts` | 反馈事件存储 |
| `src/memory/knowledge-graph/feedback-pipeline.ts` | 反馈 → 边权重 / importance / 训练样本 |
| `src/memory/knowledge-graph/health-metrics.ts` | 图谱健康度指标 |
| `src/services/kg-extraction-queue.ts` | 抽取离线队列 |
| `src/routes/feedback-routes.ts` | 反馈采集 API |
| `src/routes/kg-health-routes.ts` | 图谱健康度 API |

### 7.4 数据迁移

老数据需要兼容：
- 老节点没有 `sourceChunkIds` / `version` / `importance` → 默认值
- 老边没有 `feedbackScore` / `sourceChunkId` → 默认值
- `e.relation` 字段不存在的历史数据 → 读取时用 `e.label` 兜底
- 老 LTM 节点 (`ltm` type) 没有图谱关系 → 不动，作为 "个人记忆层"，不参与 KG-first 检索

**一次性迁移脚本**（建议在 v2 行动项 P0 修完后跑）：
```typescript
// scripts/migrate-kg-v2.ts
// 1. 补字段默认值
// 2. 重建缺失的 sourceChunkIds (从 chunk embedding 反向找最近 entity)
// 3. 跑一次社区检测 + god node 重算
// 4. 写入 version 字段
```

---

## 8. 实施路线

### 8.1 阶段 1：地基（1-2 周）

把 v2 review 的 P0/P1 全部修掉，给新架构铺路。

- [ ] 修 `e.relation` → `e.label`（v2 §2.1）
- [ ] 修 `EdgeType` 字面量联合（v2 §2.2）
- [ ] 修 `graph_deduplicate` await（v2 §2.3）
- [ ] 统一后端默认值为 `mysql`（v2 §2.4）
- [ ] 收敛三处 LLM 抽取逻辑为单一 pipeline（v2 §3）
- [ ] `GraphNode` / `GraphEdge` 字段扩展（sourceChunkIds, version, feedbackScore）
- [ ] Neo4j `removeEdge` 加 ownerId 限定
- [ ] 预计算锁改为 Promise inflight tracker

**阶段 1 验收**：老功能完全保留，新字段默认值不破坏现有数据。

### 8.2 阶段 2：抽取离线化 + 双轨接入（2-3 周）

- [ ] 新建 `kg-extraction-queue`
- [ ] `extractFromChunk`（单 chunk 抽 entities + relations）
- [ ] `extractFromDocument`（跨 chunk 合并 + entity linking）
- [ ] `entity-linker` 基础版（基于表面形式 + LLM 归一）
- [ ] `kb_ingest` 完成 → 自动入队 → 后台抽取
- [ ] `parsing-queue` 移除内联抽取
- [ ] 抽取质量监控：每日跑一次 evaluation set

**阶段 2 验收**：文档入库后能在 5 分钟内看到对应实体节点；同一文档重 ingest 不产生重复节点。

### 8.3 阶段 3：KG-first 检索（2-3 周）

- [ ] `query-understanding.ts`（classify + NER + entity linking）
- [ ] `recall.ts`（统一 recall 入口）
- [ ] `chunk-expander.ts`（KG → KB 跳回）
- [ ] 重写 `kb_search` 主流程为 KG-first
- [ ] synthesis 提示模板 + 引用规范
- [ ] `hybrid-search.ts` 改名为 fallback
- [ ] A/B 测试：旧 hybrid-only vs 新 kg-first，对比 Top-K recall 和采纳率

**阶段 3 验收**：同一 query 走新流程的采纳率显著高于旧流程（目标 +20%）；relational/discovery 类查询质量提升 >50%。

### 8.4 阶段 4：反馈环路（1-2 周）

- [ ] `feedback-store.ts` + 反馈 API
- [ ] 前端采纳/拒绝按钮
- [ ] 隐式反馈采集（停留时间、追问）
- [ ] `feedback-pipeline.ts`（边权重 + importance + 训练样本）
- [ ] 监控指标 + 定时计算
- [ ] 告警：连续 N 次某 query type 召回失败

**阶段 4 验收**：连续一周运行后，能看到 god node importance 因反馈而调整；新增的抽取样本能提升 NER 准确率。

### 8.5 阶段 5：Neo4j 原生化（可选，1-2 周）

仅在生产用 Neo4j 时推进：

- [ ] Neo4j session 复用 + 连接池
- [ ] Neo4j fulltext index 替代 `scoreNodes` 全量扫描
- [ ] Neo4j GDS Pagerank 替代手写 BFS
- [ ] Neo4j APOC shortestPath 替代手写 BFS 最短路径
- [ ] 增量 Louvain 替代全量 Louvain

---

## 9. 一句话总结

**把"KB 和 KG 谁先"想清楚**比"再加一个抽取模型"重要十倍。一旦 KG 是入口、KB 是兜底，整个系统的语义能力、解释性、反馈性都顺了。

**最关键的三件事**：
1. **KG 节点要能反查 KB chunks**（`sourceChunkIds` 字段）——这是 KG-first 的物理基础
2. **抽取离线化 + 单一管线**——v2 review 那 3 处重复必须收敛，否则 KG 质量不可控
3. **反馈环路必须建**——没有反馈的图谱是死的；有了反馈，整个系统会自己变好

做完后，RAOS 的图谱就不再是"KB 的影子"，而是真正的"知识的中枢神经"。
