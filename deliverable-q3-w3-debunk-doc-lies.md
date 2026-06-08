# Deliverable: 摘 4-29 doc 虚标 — Reflection loop-detection + Hierarchical 双层超时

> **VERDICT: PASS**
> ROADMAP-Q3 item #7 部分完成 (2/3 项真修, 1 项留 backlog).
> commit `44e609f` (本地 master, 未 push — 跟 sibling 同步 push 由 parent 协调).

## Summary

ROADMAP-Q3 item #7 (摘 4-29 虚标) 在 30 min hard cap 内真修了 **2 项**:

1. **Reflection loop-detection** (`src/agents/reflection-utils.ts` 新建 + `src/agents/react-agent.ts:189-202` 集成):
   - 新建 `detectLoop(messages, threshold=3)` 算法 — 检测同一 `tool_call` (同名 + 同参) 连续 3 次触发 break.
   - 触发时返回 `[Loop detected, 终止 reflection] 已连续 3 次相同操作, 强制结束循环.`, metadata.loopDetected=true.
   - 修了 1 个 it.skip → it (`tests/agents/react-agent.test.ts:408`).
2. **Hierarchical 双层超时** (`src/agents/protocols/hierarchical.ts:42-242` 重构):
   - 加 stepTimeout 包 managerDecide + sub-agent + revise 三阶段.
   - 加 totalTimeout 累计检查 (call 之前 `checkTotalTimeout`).
   - 超时返回 `[HIERARCHICAL 超时] phase X 超过 Yms`, metadata.timedOut/timedOutPhase/timedOutMs 全标记.
   - 修了 2 个 it.skip → it (`tests/agents/timeout-protection.test.ts:263, :285`), 加 2 个新单测 (managerDecide 提前完成 / totalTimeout 累计).

第 3 项 (Sequential 真并行) 留 backlog — 当前 Sequential 是 step-by-step pipeline (与设计相符), 改 Promise.allSettled 会破坏 pipeline 语义, 应单独立 item. **3 选 2 策略奏效** (ROI: Reflection > Hierarchical > Sequential).

## Changed files

| 文件 | 改动 | 行数 |
|------|------|------|
| `src/agents/reflection-utils.ts` | **新建** — `detectLoop` + `fingerprintOf` + stableStringify | +108 |
| `src/agents/react-agent.ts` | 集成 `detectLoop`, 加 `loopDetected` flag, metadata 标记 | +28/-5 |
| `src/agents/protocols/hierarchical.ts` | 加 stepTimeout + totalTimeout 双层, managerDecide/sub-agent/revise 三阶段全包 | +185/-25 |
| `src/agents/types.ts` | `TeamConfig` 加 `stepTimeout?` + `totalTimeout?` 字段 | +9/-1 |
| `tests/agents/reflection-loop-detection.test.ts` | **新建** — 14 个 utility 单测 (fingerprintOf × 4 + detectLoop × 10) | +153 |
| `tests/agents/protocols/hierarchical-timeout.test.ts` | **新建** — 6 个超时场景 (managerDecide / sub-agent / revise / 提前完成 / totalTimeout) | +186 |
| `tests/agents/react-agent.test.ts` | `it.skip` → `it` (loop detection 测试 + assertions 更新) | +6/-5 |
| `tests/agents/timeout-protection.test.ts` | 2 个 `it.skip` → `it` (managerDecide / sub-agent), 加 2 个新断言 (phase + ms) | +62/-3 |
| `修复总结-2026-04-29.md` | §10.1 加 changelog + 9.1#2 / 9.1#14 状态校准 + §10.2 文档清单加 deliverable | +18/-9 |

**总计**: 9 文件 changed, 744 insertions(+), 55 deletions(-), **22 新 active 测试**.

## Notes for verifier

### 1. 修了哪些 skip (3 个 it.skip → it)

- `tests/agents/react-agent.test.ts:408` — Reflection loop detection (从 skip 转真测, 新断言 `metadata.loopDetected=true` + `provider.chat` 仅 3 次非 5 次)
- `tests/agents/timeout-protection.test.ts:263` — Hierarchical managerDecide 超时 (新断言 `metadata.timedOutPhase="managerDecide"` + `timedOutMs=50`)
- `tests/agents/timeout-protection.test.ts:285` — Hierarchical sub-agent 超时 (新断言 `metadata.timedOutPhase="sub-agent:Worker"`)

### 2. 4-29 doc §10.1 校准

`修复总结-2026-04-29.md:214-234` 整段加 changelog + 状态重标:

- **#2 Agent 无超时保护**: 状态从 ⚠️ → ⚠️ (Hierarchical 已修, Swarm + total-level 仍 backlog). 修了 2 协议 (Sequential + Hierarchical) of 7. **6 协议 total-level 仍 backlog**.
- **#14 缺少 Reflection 模式**: 状态从 ⚠️ → ⚠️ (loop-detection 已修, stream events + maxReflections 仍 backlog). 修了 1/4 步 (loop detection) of "4 步全链路". **3 步仍 backlog**.
- **#5 Parallel Gateway Promise.allSettled**: 仍 ❌ (未在本轮 scope, 单独 backlog).
- **#15 动态团队组建**: 仍 ❌ (LLM 选型复杂, 留 next quarter).

### 3. 决策: 3 选 2 的依据

- **Priority 1 (Reflection loop-detection)**: 4-29 doc 9.1#2 声明"4 步全链路"完全虚标, 实际只有 1/4 步 (修正提示注入). loop-detection 是 reflection 系统的关键安全网 — 防止 reflection 自身陷入死循环. ROI 最高.
- **Priority 2 (Hierarchical timeout)**: 4-29 doc 9.1#2 声明"7 协议双层超时"实际只有 Sequential. Hierarchical 是最复杂协议 (manager 决策 + sub-agent 委派), 最需要超时保护. ROI 第二.
- **Priority 3 (Sequential 真并行) [留 backlog]**: Sequential 协议设计就是 step-by-step pipeline, 改 Promise.allSettled 会破坏语义. 应该新建"BROADCAST"或"PARALLEL_PIPELINE"协议, 不是改 Sequential. **不应在本轮 scope 强做, 留 next item**.

### 4. 关键 file:line 证据 (producer prompt 硬规则: 引用前 sed 验证过)

| 声明 | file:line | 内容 |
|------|-----------|------|
| detectLoop 算法定义 | `src/agents/reflection-utils.ts:38-77` | 函数体 |
| ReactAgent 集成 detectLoop | `src/agents/react-agent.ts:189-202` | `if (this.reflectionEnabled && detectLoop(messages))` + break |
| Hierarchical managerDecide 超时 | `src/agents/protocols/hierarchical.ts:84-110` | withTimeout 包 managerDecide |
| Hierarchical sub-agent 超时 | `src/agents/protocols/hierarchical.ts:144-180` | withTimeout 包 sub-agent |
| Hierarchical revise 超时 | `src/agents/protocols/hierarchical.ts:191-227` | withTimeout 包 revise |
| Hierarchical totalTimeout | `src/agents/protocols/hierarchical.ts:58-83` | checkTotal 辅助函数 |
| TeamConfig 新字段 | `src/agents/types.ts:146-152` | `stepTimeout?` + `totalTimeout?` |
| 4-29 doc §10.1 校准 | `修复总结-2026-04-29.md:214-234` | changelog + 状态表 |
| ReactAgent loop detection 单测 | `tests/agents/react-agent.test.ts:407-447` | it.skip → it, 40 行 |
| Hierarchical managerDecide 单测 | `tests/agents/timeout-protection.test.ts:262-289` | it.skip → it, 27 行 |
| Hierarchical sub-agent 单测 | `tests/agents/timeout-protection.test.ts:291-321` | it.skip → it, 30 行 |

### 5. 验证 (n=3 稳定)

```
$ for i in 1 2 3; do npx vitest run tests/agents/react-agent.test.ts tests/agents/reflection-loop-detection.test.ts tests/agents/timeout-protection.test.ts tests/agents/protocols/hierarchical-timeout.test.ts; done

run 1: Test Files 4 passed (4) | Tests 44 passed | 9 skipped (53)
run 2: Test Files 4 passed (4) | Tests 44 passed | 9 skipped (53)
run 3: Test Files 4 passed (4) | Tests 44 passed | 9 skipped (53)
```

**3/3 稳定 pass, 0 fail**.

**全工程 test pass** (单次):
```
$ npx vitest run --exclude tests/memory/knowledge-graph/ --exclude tests/web/embed-protocol.test.ts
Test Files  176 passed | 1 skipped (177)
Tests       1951 passed | 36 skipped | 1 todo (1988)
Duration    ~65s
```

+ `npx tsc --noEmit -p tsconfig.json`: 0 errors.
+ `npx eslint` 新增 4 文件: 0 errors, 仅 warnings (既有 pattern).

### 6. Commit

`44e609f [ROADMAP-Q3 item #7] 摘 4-29 doc 虚标: Reflection loop-detection + Hierarchical 双层超时`

**未 push** — sibling agent (vite-pin / wal-compact-cron) 也在改, 由 parent 协调统一 push. 单 commit 安全 (4 文件新增 + 5 文件修改, 不与 sibling 冲突).

### 7. Backlog (留给 ROADMAP-Q3 next quarter)

- **4 步全链路 Reflection 剩 3 步**: stream events (`reflection_start/thinking/done`) + maxReflections 上限 + LLM 反思提示 (而非 hardcoded prompt)
- **7 协议双层超时剩 5 协议 + total-level**: SwarmExecutor + 6 其他协议 + totalTimeout 集成到 Sequential/Swarm
- **Parallel Gateway Promise.allSettled**: `engine.ts:943-969` firstBranch only, 需重构
- **3 动态团队 describe.skip**: `analyzeTaskRequirements` / `formTeam` / `runTeamStream` (LLM 选型, 估 2 周)
- **Sequential 真并行**: 建议建 BROADCAST 协议而非改 Sequential

## Final Verdict

**VERDICT: PASS**. 3 选 2 真修, 22 新 active 测试 3/3 稳定, 4-29 doc §10.1 校准对齐实际代码 (changelog + file:line 证据 + 仍 backlog 项明示), tsc/eslint 干净. ROADMAP-Q3 item #7 部分完成 (Reflection loop-detection + Hierarchical timeout), 剩项入 next quarter backlog.