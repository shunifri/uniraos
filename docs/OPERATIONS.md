# RAOS KG v2 运维手册（OPERATIONS.md）

> 部署、监控、故障排查的 single source of truth。配套 `docs/CHANGELOG_KG.md` 和 `docs/KG_ARCHITECTURE_VISION.md`。

---

## 1. 部署

### 1.1 依赖

| 依赖 | 版本 | 必需 | 备注 |
|------|------|------|------|
| Node.js | ≥ 22 | ✅ | 用了顶层 `await` / `nodejieba` 原生模块 |
| MySQL | ≥ 8.0 | ✅ | FULLTEXT 索引 + ngram parser 都需要 8.0+。5.7 缺 ngram 但默认 FULLTEXT 仍可用 |
| MySQL ngram 解析器 | — | ❌ optional | v21 migration 是 `optional: true`，缺插件时降级 |
| Neo4j | 5.x | ❌ optional | 当前默认 MySQL；切到 Neo4j 设 `GRAPH_STORE_BACKEND=neo4j` |
| nodejieba | 3.5.8 | ✅ | 中文分词；装不上时 `isChineseTokenizerActive() === false`，降级到启发式 |

### 1.2 启动流程

```bash
# 1. 安装依赖
npm install

# 2. 设置环境变量
cp .env.example .env.local
# 必须配置: MYSQL_PRIMARY_HOST / MYSQL_PRIMARY_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE

# 3. 启动 server
npm start
# 启动时自动调 initMySQLDatabase()，跑 v1-v21 所有迁移
```

### 1.3 迁移版本表

| 版本 | 名称 | 必选 | 备注 |
|------|------|------|------|
| v1-v17 | — | ✅ | 历史 |
| v18 | `kg_v2_field_extensions` | ✅ | GraphNode 加 community_id / version / importance |
| v19 | `kg_feedback_events` | ✅ | 反馈环路表 |
| **v20** | `kg_graph_nodes_fulltext_label` | ✅ | 默认 FULLTEXT 索引（ft_min_word_len=4） |
| **v21** | `kg_graph_nodes_fulltext_label_ngram` | optional | ngram 索引（中文 2-gram）。**失败不 halt runner** |

---

## 2. 监控

### 2.1 健康检查端点

```bash
GET /api/graph/health
```

返回示例：
```json
{
  "nodeCount": 1247,
  "edgeCount": 3891,
  "avgDegree": 6.24,
  "isolatedNodeCount": 23,
  "communityCount": 14,
  "topCommunitySize": 312,
  "acceptedRateAllTime": { "total": 1240, "accepted": 893, "rate": 0.72 },
  "perQueryType": [
    { "type": "factual", "total": 540, "accepted": 410, "rate": 0.76 },
    { "type": "relational", "total": 380, "accepted": 290, "rate": 0.76 },
    { "type": "discovery", "total": 220, "accepted": 130, "rate": 0.59 },
    { "type": "hybrid", "total": 100, "accepted": 63, "rate": 0.63 }
  ],
  "tokenizer": {
    "backend": "nodejieba",
    "note": "中文按 cppjieba 精度切分（推荐）"
  }
}
```

**告警阈值**（建议）：

| 指标 | 告警 | 原因 |
|------|------|------|
| `tokenizer.backend === "heuristic"` | 🔴 Critical | nodejieba 装失败，**中文分词精度会断崖下降** |
| `nodeCount === 0` 且用户已 1h+ | 🟡 Warning | 抽取 pipeline 没在工作 |
| `avgDegree < 1` | 🟡 Warning | 大部分节点孤立，知识图谱不连通 |
| `perQueryType[].rate < 0.5` | 🟡 Warning | 该类型 query 采纳率低 |
| `acceptedRateAllTime.rate < 0.5` | 🔴 Critical | 用户整体不满意 |

### 2.2 关键日志

```bash
# LLM 调用失败
grep "kg_extraction_failed" server.log

# 抽取任务超时
grep "KgExtractionQueue.*timeout" server.log

# 慢查询
grep "kb_graph.*duration_ms" server.log | awk '$NF > 1000'

# FULLTEXT 索引缺失
grep "ft_kb_graph_nodes_label" server.log
```

### 2.3 Prometheus 指标（建议自接）

- `kg_node_count` (gauge, by owner_id)
- `kg_edge_count` (gauge, by owner_id)
- `kg_search_latency_ms` (histogram, by backend)
- `kg_extraction_queue_size` (gauge)
- `kg_extraction_duration_ms` (histogram, by status)
- `kg_acceptance_rate` (gauge, by query_type)
- `kg_tokenizer_backend` (gauge: 1=nodejieba, 0=heuristic)

---

## 3. 故障排查

### 3.1 中文分词不准确

**症状**：用户 query 含中文但召回不到相关节点
**检查**：
```bash
curl http://localhost:3000/api/graph/health | jq .tokenizer.backend
# 期望: "nodejieba"
# 实际: "heuristic" → 装 nodejieba 失败
```

**修复**：
```bash
# macOS
brew install cmake
npm rebuild nodejieba

# 验证
node -e "const j=require('nodejieba'); console.log(j.cut('苹果公司'))"
# 期望: [ '苹果', '公司' ]
```

### 3.2 抽取 pipeline 不写图

**症状**：kb_ingest 后 GraphStore 节点数不增长
**检查**：
```bash
# 1. 看 kgExtractionQueue 状态
curl http://localhost:3000/api/graph/extraction/queue/status

# 2. 看 LLM provider 是否注入
grep "No llmProvider" server.log
# 出现 → sessionManager.getLLMProvider() 返回 null

# 3. 看是不是 LLM 返回格式不对
grep "extractRelationsToGraph.*empty" server.log
```

**修复**：
- LLM provider 没注入 → 检查 `user-session.ts` 的 `getLLMProvider()` 链路
- LLM 返回格式不对 → 已用 P2-10 容错（array 兜底），不应再 fail
- 抽取任务被 debounce 拦截 → 等 30s 再试

### 3.3 chunk-expander SQL 慢

**症状**：`expandToChunks` 耗时 > 1s
**原因**：P0-3 之前是 N+1 SQL，每加 1 个 entity 一次查询
**检查**：
```bash
grep "expandToChunks.*duration" server.log
```
**修复**：
- 确认用最新版（带 `fetchChunksByDocAndIndex` 批量查询）
- 如果仍慢 → 看是否是 `perEntityLimit` 设置过大（默认 3）

### 3.4 MySQL FULLTEXT 不命中

**症状**：`searchNodesByKeywords` 始终返回 0 hits
**检查**：
```sql
SHOW INDEX FROM kb_graph_nodes WHERE Index_type='FULLTEXT';
-- 期望: ft_kb_graph_nodes_label (无 ngram) 或 ft_kb_graph_nodes_label_ngram
```
**修复**：
- 没索引 → 跑 `initMySQLDatabase()` 重跑 v20/v21
- 索引 lag → 等 InnoDB FULLTEXT 异步刷新（通常 < 1s）
- 词太短（< 4 字符）→ 用 ngram 索引（v21）或换 prefix 查询

### 3.5 反馈采纳率突然下降

**症状**：`perQueryType[].rate` 跌到 0.3 以下
**诊断**：
```bash
# 看哪些 query 被点踩
SELECT query, COUNT(*) as cnt
FROM kg_feedback_events
WHERE accepted = 0
  AND created_at > NOW() - INTERVAL 1 HOUR
GROUP BY query
ORDER BY cnt DESC
LIMIT 10;
```
**常见原因**：
- LLM 升级后行为变了（KG 抽取的 entity 跟用户 query 不匹配）
- 新 KB 文档结构变了（标题/分类变了导致 recall 偏差）
- tokenizer 降级到启发式（中文切分错了）

**自动化报警**：`scripts/check-acceptance-rate.ts` (commit 4dfc558+)
- cron 跑：`*/30 * * * * cd /path && npx tsx scripts/check-acceptance-rate.ts || alert`
- 阈值：`ACCEPTANCE_THRESHOLD=0.5` (24h rate 低于告警)
- 最小样本：`MIN_VOLUME=20` (避免 noise)
- exit 0 = OK, exit 1 = ALERT, exit 2 = script error
- 干跑：`DRY_RUN=1 npx tsx scripts/check-acceptance-rate.ts`

---

## 4. 性能基准

### 4.1 推荐配置（10K 节点 / 30K 边）

| 后端 | 读 | 写 | 备注 |
|------|----|----|------|
| MySQL 8.0 + ngram | 50ms / query | 100ms / node | FULLTEXT 索引建议 `innodb_ft_min_token_size=2` |
| Neo4j 5.x fulltext | 30ms / query | 80ms / node | `CALL db.index.fulltext.queryNodes` |
| SQLite（开发） | 200ms / query | 50ms / node | 适合 < 1K 节点本地开发 |

### 4.2 优化 checklist

- [ ] `innodb_ft_min_token_size = 2`（默认 4 中文不友好）
- [ ] ngram 索引已建（v21 optional migration）
- [ ] `QUERY_CACHE` 已用（query-understanding.ts:100 自动启用）
- [ ] `kgExtractionQueue` debounce 30s 合理
- [ ] LLM 调合并 `extractEntitiesAndRelationships`（不要 2 次独立调用）

---

## 5. 升级 / 回滚

### 5.1 升级

```bash
git pull
npm install
npm start  # 自动跑新迁移
```

### 5.2 回滚（migration v21 是 optional，可跳过）

```bash
# 1. 备份
mysqldump -h$HOST -u$USER -p$PASS raos > backup_$(date +%F).sql

# 2. 跑 down migration（如果 v21 失败想回滚）
mysql -h$HOST -u$USER -p$PASS raos -e "DELETE FROM schema_version WHERE version = 21; ALTER TABLE kb_graph_nodes DROP INDEX ft_kb_graph_nodes_label_ngram;"
```

### 5.3 切到 Neo4j 后端

```bash
# 1. .env.local 加
GRAPH_STORE_BACKEND=neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=xxx

# 2. 重启 server
# 自动用 Neo4jGraphStore，索引由 ensureFulltextIndex 异步建
```

---

## 6. 已知限制 / 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| ngram 解析器不在所有 MySQL 镜像里 | 🟡 Medium | v21 optional migration + runtime probe，已优雅降级 |
| MySQL JSON 列 auto-parse 触发 parseTags 双层嵌套 bug | 🟢 Low | P2-11 顺带修了 |
| 测试用 `setTimeout(100)` 等 FULLTEXT 索引刷新 | 🟡 Medium | 生产有 race risk，P2-9 backlog |
| LLM 偷懒返回 array 格式 | 🟢 Low | P2-10 兜底 |
| ACL 用 `n.id === "kb_doc_${docId}"` 精确等值 | 🟢 Low | P2-11 修了之前的 includes 误中 |
| `normalizeFtsScore` 用 tanh 经验值未用真数据校准 | 🟡 Medium | P2-7 单元测试覆盖 S 曲线行为，真数据校准在 backlog |

---

## 相关 commit

| SHA | 标题 | 与本文档关系 |
|-----|------|--------------|
| [`3646570`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **P2-7 标定 + OPERATIONS/GRAPH_CONTEXT** | 本文档是这次 commit 引入的；含 §1 部署 / §2 监控 / §3 故障排查 / §4 性能基准 / §5 升级回滚 / §6 已知风险 |
| [`341d902`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **阶段 5-6 Neo4j fulltext + nodejieba** | §1.1 依赖（ngram 插件 / nodejieba 3.5.8）来自这个 commit |
| [`ad546a9`](CHANGELOG_KG.md#-commit-mapcommit--docs) | **deps(kg): nodejieba 3.5.8** | nodejieba 安装失败时的处理路径见 §3.1 中文分词不准确 |

详细索引见 [CHANGELOG_KG.md §Commit Map](CHANGELOG_KG.md#-commit-mapcommit--docs)。
