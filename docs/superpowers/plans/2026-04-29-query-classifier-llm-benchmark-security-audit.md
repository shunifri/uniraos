# 查询分类器LLM化 + 图谱检索基准测试 + 持续安全审计 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 实施对标分析报告中的3个建议：查询分类器LLM化、图谱检索基准测试、持续安全审计

**Architecture:** 3个独立任务，无依赖关系，可并行实施

**Tech Stack:** TypeScript, Vitest, Node.js vm, LLM Provider

---

### Task 1: 持续安全审计脚本

**Files:**
- Create: `scripts/security-audit.js`
- Modify: `package.json` (scripts 字段)
- Test: `scripts/security-audit.test.js` (可选)

- [ ] **Step 1: 编写安全审计脚本**

扫描 `src/` 目录下的 TypeScript 文件，查找以下模式：
- `new Function(` (ERROR)
- `eval(` (ERROR)
- `vm.runInNewContext` without `timeout` (WARN)

白名单：
- `node_modules/` 不扫描
- 注释中的模式不报警
- `src/engine/worker-sandbox-worker.ts` 允许 `runInNewContext`

输出格式：
```
Security Audit Report
=====================
Files scanned: N
Issues found: N

[ERROR|WARN] file.ts:line:column
  Pattern: ...
  Suggestion: ...
```

Exit code: 0 (clean) or 1 (issues found)

- [ ] **Step 2: 添加到 package.json scripts**

```json
"security:audit": "node scripts/security-audit.js"
```

- [ ] **Step 3: 运行验证**

```bash
npm run security:audit
```

预期输出：0 issues found（因为当前已全部清理）

---

### Task 2: 查询分类器 LLM 化

**Files:**
- Modify: `src/skills/knowledge-skills.ts:179-211`
- Create: `tests/skills/query-classifier.test.ts`

- [ ] **Step 1: 提取 classifyQuery 为独立模块**

从 `knowledge-skills.ts` 中提取 `classifyQuery`，但保持内联（不新建文件，因为函数较小）。

修改后的函数结构：
```typescript
function classifyQuery(query: string, llmProvider?: LLMProvider): ClassifiedQuery {
  // 1. 规则引擎快速路径
  const ruleResult = classifyByRules(query);
  if (ruleResult.confidence > 0) {
    return ruleResult;
  }

  // 2. LLM fallback
  if (llmProvider) {
    return classifyByLLM(query, llmProvider);
  }

  // 3. 安全降级
  return { type: 'hybrid', confidence: 0, keywords: [], entities: [], relations: [] };
}
```

- [ ] **Step 2: 实现 classifyByLLM**

Prompt:
```
将以下查询分类为 factual/relational/discovery/hybrid 之一。
只返回 JSON，不要其他文字：{"type":"...","confidence":0.X,"reasoning":"..."}

查询："${query}"
```

缓存：内存 Map，TTL 1小时。

- [ ] **Step 3: 集成到 kb_search handler**

在 `kb_search` handler 中获取当前 session 的 LLM provider，传给 `classifyQuery`。

- [ ] **Step 4: 编写测试**

20个标注查询，验证分类准确率 > 80%。

- [ ] **Step 5: 运行测试**

```bash
npx vitest run tests/skills/query-classifier.test.ts
```

---

### Task 3: 图谱检索基准测试

**Files:**
- Create: `tests/performance/kg-retrieval.benchmark.ts`

- [ ] **Step 1: 准备测试数据**

使用现有的知识图谱测试基础设施：
- 复用 `tests/memory/knowledge-graph/integration.test.ts` 的 setup 逻辑
- 预置 10-15 个文档，构建图谱

- [ ] **Step 2: 实现基准测试**

对比：
- `kb.search()` — 纯混合检索（关键词 + 向量）
- `graphManager.graphSearch()` — 图谱检索

测量：
- 延迟（`Date.now()` 差值）
- 准确率（top-5 包含正确答案的比例）

- [ ] **Step 3: 运行基准测试**

```bash
npx vitest run tests/performance/kg-retrieval.benchmark.ts
```

- [ ] **Step 4: 输出报告**

将结果写入 `.raos/benchmarks/kg-retrieval.json`
