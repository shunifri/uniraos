# FULLTEXT Score 标定手册（CALIBRATION.md）

> 配套 `docs/CHANGELOG_KG.md` P2-7 标定、`scripts/calibrate-fts-score.ts` 脚本、`normalizeFtsScore` 函数。

## 为什么需要标定

`searchNodesByKeywords` 拿到的 MySQL `MATCH AGAINST` 原始分数是 0-10 范围的"relevance"，
不是 0-1 的归一化分数。我们用 `tanh(raw / k)` 把它归一化，但 **k 是经验值**。

之前固定写死 `k=2`，是拍脑袋的经验值：
- raw=0.5 → 0.245（噪声，偏低）
- raw=1.0 → 0.462（中等命中）
- raw=2.0 → 0.762（强命中）

**生产数据出来后**应该用真实 query 重新拟合 k。本文档说明流程。

## 标定公式

```
normalized = tanh(raw_score / k)
```

- `k=2`（当前默认）：曲线偏保守，raw=4 才到 0.96
- `k=1.80`（synthetic 标定推荐）：曲线稍激进，raw=4 同样到 0.96 但 raw=1 多 4% 命中分
- `k=1.5`：更激进，raw=2 已到 0.96
- `k=3.0`：更保守，raw=6 才到 0.99

**S 曲线形状不变**（tanh 数学性质），只是平移/陡峭程度不同。

## 标定流程（生产用）

### Step 1: 收集真实 query → raw score → human relevance 三元组

```sql
-- 拉最近 1000 个 query + 召回的 top 5 节点
SELECT q.query, r.node_id, r.raw_score
FROM query_log q
JOIN kg_search_results r ON r.query_id = q.id
WHERE q.created_at > NOW() - INTERVAL 7 DAY
LIMIT 5000;
```

### Step 2: 让人（或 LLM）打 0-1 relevance 分

对每个 `(query, node, raw_score)` 三元组：
- **1.0**：完全相关
- **0.7-0.9**：相关但有噪声
- **0.4-0.6**：部分相关
- **0.1-0.3**：基本不相关
- **0.0**：完全不相关

输出 `ground_truth.json`：
```json
[
  { "raw": 0.5, "relevance": 0.3 },
  { "raw": 1.0, "relevance": 0.5 },
  ...
]
```

### Step 3: 跑标定脚本

```bash
npx tsx scripts/calibrate-fts-score.ts --data ground_truth.json
```

输出示例：
```
[calibrate] current default k=2, RMSE=0.0325
[calibrate] best k in [0.5, 5]: k=1.80, RMSE=0.0143
[calibrate] recommendation:
  ⚠ current k=2 is suboptimal, best k=1.80
  → set FTS_SCORE_K=1.80 in .env.local
  → expected RMSE improvement: 56.1%
```

### Step 4: 应用

把推荐 k 写到 `.env.local`：
```bash
echo "FTS_SCORE_K=1.80" >> .env.local
```

无需改代码——`normalizeFtsScore` 自动读 env。

### Step 5: 监控

标定后用 `/api/graph/health` 看 `kg_acceptance_rate`：
- 标定前 baseline（先记下来）
- 标定后 1-3 天对比
- 期望：`factual` 类 query 采纳率 +3-10%

## 标定频率

- **第一次**：上线 1-2 周后（积累足够 query）
- **之后**：每 3 个月一次，或 `kg_acceptance_rate` 跌 5% 时触发
- **大版本 LLM 切换后**：立即重标定（新 LLM 抽出的 entity 分布可能变）

## 边界情况

### 多峰分布

如果 ground truth 在 raw=1 和 raw=3 各有一个峰（说明有两类命中强度不同），
tanh 单峰 S 曲线**拟合不出**，需要更复杂的模型（piecewise / spline）。当前标定脚本
只支持单峰，复杂场景记在 backlog。

### k=0 或负数

脚本已 clamp 到 k=2 default（非法 k 不会 crash）。

### 训练数据 bias

如果 query 偏查询"苹果公司"这类强词，raw=2 的样本会多，标定结果 k 会偏小。
建议 ground truth 跨 query 类型做 stratified sample（factual / relational / discovery / hybrid 各 250 条）。

## 与其他模块的关系

- **`normalizeFtsScore(raw, k?)`** — `src/memory/knowledge-graph/graph-store.ts`
  通过 `process.env.FTS_SCORE_K` 读 k（fallback 到默认 2）
- **`searchNodesByKeywords(terms, limit)`** — 调 `normalizeFtsScore` 把 MySQL raw 归一化
- **`bfs-extractor.ts:scoreNodes`** — 用归一化后的 score 给节点排序，**直接影响召回**

## Backlog

- [ ] 真数据收集脚本（自动从 query_log 拉 + LLM 打分）
- [ ] 多峰分布支持（piecewise linear）
- [ ] 标定漂移监控（acceptance rate 跌 5% 自动告警）
- [ ] 双盲 A/B 测试框架（k=1.80 vs k=2.0 同时跑 1 周对比）
