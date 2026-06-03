# graphContext Schema 变更日志（GRAPH_CONTEXT_CHANGELOG.md）

> `graphContext` 是 `kb_search` 结果里传给 LLM 的"图上下文"——目的是让 LLM 真正"理解知识之间的关联关系"，而不是只看到一堆 id 和 count。
> 本文件记录 `graphContext` 字段的**所有 schema 变更**和**为什么变**。

---

## 当前 schema（v2.0，2026-06-03 起）

```typescript
{
  queryType: "factual" | "relational" | "discovery" | "hybrid";
  seedEntities: Array<{
    id: string;        // 节点 id（如 "kb_doc_xxx" 或 "ext_xxx"）
    label: string;     // 节点 label（人类可读）
    type: string;      // 节点类型（entity / person / organization / concept / kb_document ...）
    importance: number; // 0-1 重要性评分
    communityId?: number; // 所属 Louvain 社区 id
  }>;
  relatedEntities: Array<{  // 同上
    id: string; label: string; type: string;
    importance: number; communityId?: number;
  }>;
  paths: Array<{
    nodes: Array<{ id: string; label: string }>;     // 路径上的所有节点
    relationLabels: string[];                        // 边上的关系标签（"mentors" / "uses" / "part_of" ...）
  }>;
  subgraphSummary: string;  // 人类可读子图摘要，**LLM 直接喂这个**就能用
  communityIds: number[];   // 涉及的社区 id（用于"以这个社区为中心展开"模式）
}
```

**关键设计点**：
- **`subgraphSummary` 是 LLM 实际消费的字段**——其他都是结构化备份，给程序后续用
- **`compactNode` 精简到 5 个字段**，省 token
- **`paths.relationLabels` 是字符串数组**（不是嵌套对象）——LLM 解析最稳

---

## 变更历史

### v1.0 → v2.0（2026-06-03, KG v2 修 1）

#### 之前 v1.0 的 schema（**作废**）

```typescript
{
  seedEntities: string[];      // ⚠️ 只有 id，**丢失 label 和 type**
  relatedEntities: number;     // ⚠️ 只是 count，**LLM 完全看不到节点是谁**
  paths: number;               // ⚠️ 只是 count，**LLM 看不到关系结构**
  // 没有 subgraphSummary
}
```

#### 问题（用户反馈）

> "kb_search 总是给我返回通用结果，没体现我对知识图谱的查询意图。"

具体症状：
1. `seedEntities: string[]` 只传 id → LLM 必须回去查 label，浪费 token
2. `relatedEntities: number` 只是 count → **LLM 完全不知道图里有什么**，等于没传
3. `paths: number` 只是 count → LLM 不知道 A→B→C 的关联结构，**核心 KG 价值完全没体现**
4. 没有 `subgraphSummary` → LLM 拿到的就是 `{seed: [3 ids], related: 12, paths: 2}`，**这跟没图谱没区别**

#### 修法（KG v2 修 1）

完整结构化字段替换计数器 + 加 `subgraphSummary` 人类可读摘要。

文件：
- `src/memory/knowledge-graph/recall.ts:91+` — `summarizeSubgraph(understanding, recallResult)` 生成可读文本
- `src/skills/knowledge-skills.ts:2970-2981` — 构造 `fullGraphContext` 传给 kb_search 结果

#### Breaking change 影响

调用方如果依赖旧 schema（只读 id/count），需要迁移。**项目内部无外部调用方**（graphContext 是私有 API），无破坏性影响。

---

## 子图摘要格式规范

`subgraphSummary` 是 LLM 主要消费的字段，格式如下：

```
[种子节点]
- 张三（person，importance 0.9）
- 李四（person，importance 0.7）

[关联节点]
- 王五（person，importance 0.5）
- 苹果公司（organization，importance 0.85）
- iPhone（product，importance 0.7）

[关系路径]
- 张三 → 李四 (mentors)
- 王五 → 赵六 (mentors)
- 苹果公司 → iPhone (produces)

[社区]
- community_3（涉及 5 个节点）
```

LLM 用这个就能直接生成"基于图谱的回复"。

---

## 配套字段

`kb_search` 的每条结果还带以下关联字段（**不属于 graphContext 本体**）：

```typescript
{
  ...item,                          // KB chunk 字段
  graphContext: GraphContext,       // ← 本文件主题
  queryId: string,                  // 关联 feedback 事件（KG v2 阶段 4）
  recallSnapshot: {                 // 召回快照（用于反哺训练 / debug）
    seedEntities: [...],
    relatedEntities: [...],
    edges: [...],
    paths: [...],
  },
  graphScore: number,               // 该 chunk 的图谱综合得分
}
```

---

## 变更流程

修改 `graphContext` 字段时请：
1. 在本文件**先**写 schema 变更 + reason
2. 改 `src/memory/knowledge-graph/recall.ts:RecallResult` 类型 + `src/skills/knowledge-skills.ts:kb_search` 构造逻辑
3. 加 e2e 测试覆盖新字段
4. 更新 `CHANGELOG_KG.md`（vX.Y 段）

## 已知 backlog

- [ ] v2.1：加 `evidence` 字段（边上的 evidence 文本，让 LLM 知道"为什么 A→B"）
- [ ] v2.1：加 `graphStats` 字段（avgDegree / communityCount，让 LLM 知道"这个子图有多密"）
- [ ] v2.2：拆 `subgraphSummary` 多种格式（token-efficient / human-readable / structured）

---

## 相关 commit

| SHA | 标题 | 与本文档关系 |
|-----|------|--------------|
| [`3646570`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **P2-7 标定 + OPERATIONS/GRAPH_CONTEXT** | 本文档是这次 commit 引入的；v1.0→v2.0 完整 schema 变更 + 摘要格式规范 |
| [`6930a90`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **阶段 3: KG-first 检索** | v2.0 schema 的 `recallResult.seedEntities` / `relatedEntities` / `paths` 来源——这个 commit 改了 `recall.ts` 决定结构 |
| [`b6a6e75`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **阶段 1-2: 地基 + 离线化抽取** | `summarizeSubgraph` 函数 + `fullGraphContext` 装配在 `knowledge-skills.ts` 都在这次 commit 引入 |

详细索引见 [CHANGELOG_KG.md §Commit Map](CHANGELOG_KG.md#-commit-mapcommit--docs)。
