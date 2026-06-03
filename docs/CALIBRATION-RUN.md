# CALIBRATION 实跑记录（CALIBRATION-RUN.md）

> 配套 `docs/CALIBRATION.md`（标定手册）和 `scripts/calibrate-from-real-data.ts`（pipeline）。
> 本文档记录 2026-06-03 在 dev MySQL 上**实际跑了一次**标定 pipeline 的结果，含 critical finding。

## TL;DR

| 指标 | 数值 | 评估 |
|------|------|------|
| 真实数据 tuples | **0** | 唯一 6 个 unique query 都是 "test"，recall_snapshot 只有 edges/seedEntities ids 没有可用的 query-label 对 |
| Synthetic fallback tuples | **183** | dev DB 235 节点中 user_admin 占 183，从 label 拆词生成 query |
| 总标定数据 | 183 | |
| **best k** | **1.10** | vs current k=2 改善 0.78%（数据分布极端，k 调整边际） |
| **Raw=0 的比例** | **60% (109/183)** | ⚠️ critical finding：FULLTEXT 召回不到但语义相关的占大半 |

## 数据画像

### Raw score 分布

```
[   0- 0.5] 109 ████████████████████████████████
[ 0.5-   1]  13 ████
[   1- 1.5]   0 
[ 1.5-   2]  11 ███
[   2-   3]  26 ███████
[   3-   4]  12 ███
[   4-   5]   3 █
[   5-  10]   9 ██
```

**60% raw=0**——因为短词（"user", "location"）过不了 FULLTEXT min_word_len=4，**就算有 alias 也没匹配上**。

### Relevance 分布

- min: 0.40, max: 1.00, mean: 0.785
- 全是 heuristic 打分；raw=0 的样本里 relevance 高达 0.95+

## 标定结果

| k | RMSE | 备注 |
|---|------|------|
| 0.5 | 0.6685 | 太激进，raw=1 标到 0.92 太极端 |
| **1.0** | 0.6593 | 接近最优 |
| **1.10** | **0.6584** | **推荐** |
| 1.5 | 0.6596 | baseline |
| 2.0 | 0.6636 | **当前默认** |
| 3.0 | 0.6654 | 太保守 |

**总改善 0.78%**——数据太极端，k 调整边际小。

## ⚠️ Critical Finding

**TOP 10 highest-error points（k=1.10）**：

```
raw=0.00  truth=1.00  pred=0.00  | kb:上海应用技术大学...docx:paragraph:0 → kb:上海应用技术大学...docx:paragraph:0
raw=0.00  truth=1.00  pred=0.00  | kb:上海应用技术大学...docx:paragraph:1 → kb:上海应用技术大学...docx:paragraph:1
raw=0.00  truth=1.00  pred=0.00  | kb:上海应用技术大学...docx:paragraph:2 → kb:上海应用技术大学...docx:paragraph:2
... (10 行都是 raw=0, truth=1, pred=0)
```

**所有最高误差点都是同一个 pattern**：
- `query` 和 `nodeLabel` 完全等值（semantically 完美匹配）
- `MySQL MATCH AGAINST` 返回 **0**（FULLTEXT 召回失败）
- 预测归一化分数 = 0（**致命**——给最有意义的匹配打 0 分）

**这意味着**：
- 当前 `normalizeFtsScore` 数学上没毛病（tanh(0) = 0）
- **问题是数据**——FULLTEXT 召回不到但应该召回的，被标 0 分
- **k 调整救不了**——raw=0 在任何 k 下都映射到 0

## 真因分析

`kb:...docx:paragraph:N` 这种长 label 包含特殊字符 `:`，FULLTEXT BOOLEAN MODE 把它当 token 边界处理，导致整体 tokenization 失败。

修复路径（按 ROI 排序）：

| 修复 | ROI | 工作量 | 影响 |
|------|-----|--------|------|
| **1. ngram parser 索引** | 🟢 高 | 0（v21 migration 已加）| 中文 2-gram 切分，避免短词问题 |
| **2. alias 路径 fallback** | 🟢 高 | 1-2 天 | 用 `surfaceToCanonical` + label substring match 作为第二路召回 |
| **3. exact-match bonus** | 🟡 中 | 0.5 天 | `searchNodesByKeywords` 加一步 `WHERE label = ?` 精确匹配，命中后 boost score |
| **4. AI 重新评估 ground truth** | 🟡 中 | 1 天 | "kb:...docx:paragraph:0" 这种 label 算不算"完全相关"？可能应该 relevance=0.7 而非 1.0 |
| **5. 调 k=1.10** | 🔴 低 | 0 | 0.78% 改善基本无感，不值得动 |

## ✅ 修复后重跑（commit eb66da1 + follow-up）

### 第二轮：commit eb66da1 (multi-stage search fallback) 之后

```
stage distribution:
  stage  0 (no match       ): 11
  stage  1 (FULLTEXT       ): 13
  stage  2 (exact/canonical): 111
  stage  4 (substring      ): 48
rescued by fallback: 159 / 183 (86.9%)
production RMSE: 0.2612
```

**86.9% 召回被 multi-stage fallback 救回**——之前 100% raw=0 的样本现在 86.9% 拿到 0.65-0.99 的 production score。

### 第三轮（这次）：修复触发条件 + 加 production score 到 calibration

**发现**：FULLTEXT 对短 query（"kb:" 之类）会召回 20 个**噪声**命中（raw=0.02, score 0.01），数量上看 ≥ 50% limit，**但 top score 极低**——根本不是真匹配。
**修复**：把触发 fallback 的条件从"只看数量"改成"数量 OR top score 极低（< 0.5）"。

```
stage distribution:
  stage  0 (no match       ): 9     ← 少了 2
  stage  1 (FULLTEXT       ): 4     ← 少了 9（噪声被排除）
  stage  2 (exact/canonical): 120   ← 多了 9（噪声让位给真匹配）
  stage  4 (substring      ): 50    ← +2
rescued by fallback: 170 / 183 (92.9%)  ← 86.9% → 92.9%
production RMSE: 0.2372                ← 0.2612 → 0.2372
```

**生产 score RMSE 改善 9%**（0.2612 → 0.2372），这才是用户实际看到的提升。

### 三轮对比

| 版本 | raw=0 比例 | rescued % | production RMSE | 备注 |
|------|-----------|-----------|----------------|------|
| 修复前 | 60% (109/183) | 0% | n/a | raw→0, pred→0 |
| v1: multi-stage fallback (eb66da1) | 60% (109/183) | 86.9% | 0.2612 | score 不一样了 |
| **v2: + 低质量 trigger（当前）** | 60% (109/183) | **92.9%** | **0.2372** | best |

**结论**：multi-stage fallback 不只是补救——是**降低** raw=0 噪声对召回排序影响的关键。后续调 k 才有意义（不然 k 调优是在 noise 上调）。

## 实际改动建议

**短期（这次不动）**：
- 在 `searchNodesByKeywords` 旁边加一个 `searchNodesByExactLabel(query, owner)` 函数
- 当 FULLTEXT 返回 0 hits 时调用，对 label 字符串做 `LIKE '%query%'` / canonical 匹配
- 把 exact-match 的节点直接插入结果（score 给个高但 < 1 的值，如 0.85）

**中期（ops 真实数据接入后）**：
- 跑 `npx tsx scripts/calibrate-from-real-data.ts --llm` 拿真相关性分数
- 对比 k=1.10 vs k=2 的 acceptance rate
- 选真正有用的 k

**长期（生产化）**：
- CI 每周自动跑 `scripts/calibrate-from-real-data.ts` → 输出 `ground_truth_weekly.json` → 跟历史对比
- 漂移 > 5% 自动告警

## 跑这次的命令

```bash
# 1. 跑 pipeline，输出 ground_truth.json
npx tsx scripts/calibrate-from-real-data.ts --out /tmp/real-gt.json

# 2. 详细分析 raw/relevance 分布、k 网格搜索、top error
npx tsx scripts/analyze-calibration.ts /tmp/real-gt.json

# 3. （如果有 LLM provider）用 LLM 评分
npx tsx scripts/calibrate-from-real-data.ts --llm --out /tmp/real-gt-llm.json
```

## 配套代码改动

- `scripts/calibrate-from-real-data.ts`: 主 pipeline（calibrate-fts-score.ts 已 export 函数）
- `scripts/analyze-calibration.ts`: **新增**——详细分析（分布、correlation、RMSE by bucket、top error points）
- `docs/CALIBRATION.md`: 标定手册
- `docs/CALIBRATION-RUN.md`: **本文档**——实跑记录

## 跑这场的环境

- DB: MySQL 8.0 (port 3307, dev container)
- data: 235 nodes / 114 feedback events / 6 unique queries
- LLM: 未启用（dev 环境没装 LLM provider），用 heuristic fallback
- script 版本: `scripts/calibrate-from-real-data.ts` @ commit fffb0b9
- 时间: 2026-06-03 14:34 (Asia/Shanghai)
