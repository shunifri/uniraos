# 设计文档：查询分类器LLM化 + 图谱检索基准测试 + 持续安全审计

> **日期**: 2026-04-29  
> **状态**: 已批准  
> **关联建议**: 对标分析报告 7.3 节建议 7/8/9

---

## 1. 查询分类器 LLM 化

### 1.1 目标
将 `classifyQuery()` 从纯规则引擎升级为**规则引擎 + LLM fallback**的双模式分类器，提升 relational/discovery 模糊查询的分类准确率。

### 1.2 当前状态
- **文件**: `src/skills/knowledge-skills.ts:179-211`
- **实现**: 纯关键词匹配，3类指标（factual/relational/discovery），无 LLM 调用
- **局限**: 对无关键词的模糊查询（如 "这两者有什么联系"）分类准确率低

### 1.3 设计方案

**双模式架构**:
```
classifyQuery(query) → ClassifiedQuery
  ├── 规则引擎（快速路径，<1ms）
  │     └── 如果有明确关键词匹配 → 直接返回
  └── LLM fallback（慢速路径，~100-500ms）
        └── 规则引擎置信度低时 → 调用 LLM
```

**规则引擎置信度判定**:
- `maxScore === 0`（无任何关键词匹配）→ 触发 LLM
- `maxScore > 0` 但 `type === 'hybrid'`（分数并列）→ 触发 LLM
- 否则 → 规则引擎结果直接返回

**LLM Prompt 设计**:
```
System: 你是一个查询分类专家。将用户查询分类为以下类型之一：
- factual: 事实查询（定义、说明、how to）
- relational: 关系查询（关联、区别、路径、连接）
- discovery: 发现查询（探索、新发现、意外）
- hybrid: 混合查询（无法明确归类）

返回 JSON: { "type": "factual|relational|discovery|hybrid", "confidence": 0-1, "reasoning": "简要说明" }
```

**缓存策略**:
- 使用 `Map<string, { result: ClassifiedQuery; expiresAt: number }>` 内存缓存
- TTL: 1小时（查询分类结果具有时间稳定性）
- Key: 查询文本的规范化形式（小写 + 去空格）

**Provider 获取**:
- 优先使用 `sessionManager` 中当前 session 的 LLM provider
- Fallback 到 `providerManager.getProvider()`
- 如果 LLM 不可用，返回 `hybrid`（安全降级）

### 1.4 测试策略
- 单元测试：20个标注查询（各类5个），验证分类准确率 > 80%
- 边界测试：空字符串、超长查询、无意义字符串
- 降级测试：LLM 不可用时返回 hybrid

---

## 2. 图谱检索基准测试

### 2.1 目标
建立 `kb_search` 纯混合检索 vs 图谱增强检索的专项性能基准，量化 P3 知识图谱原生检索的价值。

### 2.2 测试文件
`tests/performance/kg-retrieval.benchmark.ts`

### 2.3 测试数据集
- **文档**: 20个知识库文档（技术文档、业务文档混合）
- **图谱**: 通过 `onFactStored` 自动构建知识图谱
- **查询集**: 15个人工标注查询
  - factual × 5（如 "什么是 RAOS"）
  - relational × 5（如 "RAOS 和 OpenClaw 有什么关系"）
  - discovery × 5（如 "知识图谱检索有什么新特性"）

### 2.4 对比指标

| 指标 | 纯混合检索 | 图谱增强检索 | 说明 |
|------|-----------|-------------|------|
| 平均延迟 (ms) | 测量 | 测量 | 端到端 `kb_search` 延迟 |
| 准确率@5 | 测量 | 测量 | top-5 结果中包含人工标注正确答案的比例 |
| 召回率@5 | 测量 | 测量 | 正确答案在 top-5 中的排名 |
| 图谱使用率 | N/A | 测量 | 使用图谱增强的查询比例 |

### 2.5 实现方式
- 使用 Vitest `bench()` 进行延迟基准测试
- 准确率/召回率通过自定义断言验证
- 输出 JSON 报告到 `.raos/benchmarks/kg-retrieval.json`

---

## 3. 持续安全审计

### 3.1 目标
防止 `new Function()`、`eval()` 等动态代码执行模式回归，建立自动化安全扫描。

### 3.2 审计脚本
`scripts/security-audit.js`

### 3.3 扫描规则

| 模式 | 严重性 | 说明 |
|------|--------|------|
| `new Function(` | ERROR | 必须替换为 `vm.runInNewContext` |
| `eval(` | ERROR | 禁止使用 |
| `setTimeout(.*new Function` | ERROR | 定时器内动态代码执行 |
| `new Function(` in Worker | WARN | Worker 内风险较低，但需标注 |
| `vm.runInNewContext` without `timeout` | WARN | 必须设置超时 |

**白名单**:
- `node_modules/` 目录不扫描
- `src/engine/worker-sandbox-worker.ts` 允许 `runInNewContext`（Worker 已隔离）
- 注释中的 `new Function()` 字符串不报警

### 3.4 CI 集成
- 在 `package.json` 中新增 `npm run security:audit`
- 建议在 `npm test` 前自动运行（或作为独立 CI step）
- 发现 ERROR 级别违规时 exit code 1，阻断提交

### 3.5 输出格式
```
Security Audit Report
=====================
Files scanned: 226
Issues found: 0 ✅

(or)

ERROR src/foo.ts:42
  Pattern: new Function(
  Suggestion: Replace with vm.runInNewContext(code, {}, { timeout: 100 })
```

---

## 4. 实施顺序

3个任务**相互独立**，可并行实施：

```
Task 1: 查询分类器LLM化 ──┐
Task 2: 图谱检索基准测试 ─┼──→ 无依赖关系，可并行
Task 3: 持续安全审计 ─────┘
```

**推荐顺序**:
1. Task 3（安全审计）— 最快，15分钟完成，先建立防线
2. Task 2（基准测试）— 中等，30-60分钟，需要准备测试数据
3. Task 1（LLM化）— 最复杂，60-90分钟，需要设计 prompt 和缓存
