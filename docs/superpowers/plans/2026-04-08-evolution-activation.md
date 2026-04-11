# RAOS 进化闭环激活 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the end-to-end evolution loop: strategies detect bottlenecks → generate/optimize actions → executors use LLM to create/improve Skills → canary deployment → human approval for high-risk actions. Also hook EmergenceDetector into execution flow.

**Architecture:** The EvolutionEngine (5-phase cycle), EvolutionController (red lines/approval), SkillLifecycleManager (canary), and EmergenceDetector all exist and are tested. Missing pieces: action executors for "optimize" and "generate" types, EmergenceDetector not wired into execution, and approval workflow not exposed via API. We fill these gaps without changing existing architecture.

**Tech Stack:** TypeScript, Vitest, existing Worker sandbox, existing LLM providers, Express routes (in src/routes/).

---

## File Structure

### New Files
- `src/federation/executors/optimize-executor.ts` — Optimize action executor (LLM-driven skill rewrite)
- `src/federation/executors/generate-executor.ts` — Generate action executor (create new skill from description)
- `src/federation/executors/canary-executor.ts` — Canary deployment executor
- `src/federation/executors/index.ts` — Executor barrel export
- `tests/federation/executors/optimize-executor.test.ts`
- `tests/federation/executors/generate-executor.test.ts`
- `tests/federation/executors/canary-executor.test.ts`
- `tests/engine/emergence-integration.test.ts`

### Modified Files
- `src/engine/execution-engine.ts` — Call emergenceDetector.record() after each execution
- `src/federation/evolution-engine.ts` — Register new executors, pass LLM provider to executor context
- `src/routes/evolution-routes.ts` — Add approval workflow endpoints
- `src/server.ts` — Wire LLM provider into evolution engine, ensure start() is called

---

## Task 1: Hook EmergenceDetector into ExecutionEngine

**Files:**
- Modify: `src/engine/execution-engine.ts`
- Create: `tests/engine/emergence-integration.test.ts`

The EmergenceDetector is set via `engine.setEmergenceDetector()` but `record()` is never called. Fix this.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/emergence-integration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionEngine } from "../../src/engine/execution-engine.js";
import { SkillRegistry } from "../../src/registry/index.js";
import { WALManager } from "../../src/wal/index.js";
import { defineSkill } from "../../src/types/index.js";

describe("EmergenceDetector Integration", () => {
  let engine: ExecutionEngine;
  let registry: SkillRegistry;
  let mockDetector: any;

  beforeEach(() => {
    registry = new SkillRegistry();
    const wal = new WALManager();
    engine = new ExecutionEngine(registry, wal);

    mockDetector = {
      record: vi.fn(),
    };
    engine.setEmergenceDetector(mockDetector);

    registry.register(defineSkill({
      name: "test_skill",
      handler: async () => ({ success: true, data: "ok" }),
    }));

    registry.register(defineSkill({
      name: "failing_skill",
      handler: async () => { throw new Error("intentional"); },
    }));
  });

  it("should call detector.record() on successful execution", async () => {
    await engine.execute("test_skill", {});
    expect(mockDetector.record).toHaveBeenCalledWith(
      "test_skill",
      expect.objectContaining({
        success: true,
        callStack: expect.arrayContaining(["test_skill"]),
      }),
    );
  });

  it("should call detector.record() on failed execution", async () => {
    try {
      await engine.execute("failing_skill", {});
    } catch { /* expected */ }
    expect(mockDetector.record).toHaveBeenCalledWith(
      "failing_skill",
      expect.objectContaining({
        success: false,
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run tests/engine/emergence-integration.test.ts`
Expected: FAIL — `mockDetector.record` never called.

- [ ] **Step 3: Read execution-engine.ts and add detector.record() calls**

In `src/engine/execution-engine.ts`, find the `executeRecursive` method. The EmergenceDetector is already stored as `this.emergenceDetector`. Find the success and failure paths:

In the **success path** (after metrics.record, around where `log("info", "skill.executed", ...)` is), verify `this.emergenceDetector?.record()` is called. According to our earlier review, it IS already called at two places in the code. Let me verify — if it's already there, the test should pass and this task is just adding the test.

If the calls ARE already present, just create the test file to verify. If NOT present, add:

```typescript
      // 涌现检测
      this.emergenceDetector?.record(skillName, {
        callStack: childContext.callStack,
        depth: context.depth,
        success: true,
        duration,
      });
```

In the **failure path** (in the catch block), similarly add/verify the record call.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run tests/engine/emergence-integration.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `./node_modules/.bin/vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/execution-engine.ts tests/engine/emergence-integration.test.ts
git commit -m "feat: verify EmergenceDetector is hooked into ExecutionEngine execution flow"
```

---

## Task 2: Implement OptimizeActionExecutor

**Files:**
- Create: `src/federation/executors/optimize-executor.ts`
- Create: `src/federation/executors/index.ts`
- Create: `tests/federation/executors/optimize-executor.test.ts`

The "optimize" action is generated by BottleneckDetectionStrategy when a skill has low success rate or high latency. The executor uses LLM to analyze the skill's code and generate an improved version, then deploys it as a canary.

- [ ] **Step 1: Write the failing test**

Create `tests/federation/executors/optimize-executor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OptimizeActionExecutor } from "../../../src/federation/executors/optimize-executor.js";
import type { EvolutionAction } from "../../../src/federation/types.js";

describe("OptimizeActionExecutor", () => {
  let executor: OptimizeActionExecutor;
  let mockLlm: any;
  let mockRegistry: any;
  let mockMetrics: any;
  let mockLifecycle: any;

  beforeEach(() => {
    mockLlm = {
      chat: vi.fn().mockResolvedValue({
        content: `const value = params.input;\nreturn { success: true, data: { result: value } };`,
      }),
    };
    mockRegistry = {
      lookup: vi.fn().mockReturnValue({
        name: "slow_skill",
        version: "1.0.0",
        description: "A slow skill",
        handler: async () => ({ success: true }),
        visible: true,
        dependencies: [],
      }),
      register: vi.fn(),
    };
    mockMetrics = {
      getMetrics: vi.fn().mockReturnValue({
        skillName: "slow_skill",
        totalCalls: 100,
        successRate: 0.6,
        avgDurationMs: 5000,
        p95DurationMs: 8000,
        errorDistribution: { TimeoutError: 30 },
      }),
    };
    mockLifecycle = {
      startCanary: vi.fn(),
    };

    executor = new OptimizeActionExecutor(mockLlm, mockLifecycle);
  });

  it("should have actionType 'optimize'", () => {
    expect(executor.actionType).toBe("optimize");
  });

  it("should call LLM to generate optimized code", async () => {
    const action: EvolutionAction = {
      type: "optimize",
      skillName: "slow_skill",
      payload: { reason: "Low success rate", currentSuccessRate: 0.6 },
      priority: 40,
      requiresApproval: false,
    };

    const result = await executor.execute(action, {
      registry: mockRegistry,
      metrics: mockMetrics,
    });

    expect(mockLlm.chat).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("should register optimized skill with version suffix", async () => {
    const action: EvolutionAction = {
      type: "optimize",
      skillName: "slow_skill",
      payload: { reason: "High latency" },
      priority: 30,
      requiresApproval: false,
    };

    await executor.execute(action, {
      registry: mockRegistry,
      metrics: mockMetrics,
    });

    expect(mockRegistry.register).toHaveBeenCalled();
  });

  it("should return failure when skill not found", async () => {
    mockRegistry.lookup.mockReturnValue(null);
    const action: EvolutionAction = {
      type: "optimize",
      skillName: "nonexistent",
      payload: {},
      priority: 10,
      requiresApproval: false,
    };

    const result = await executor.execute(action, {
      registry: mockRegistry,
      metrics: mockMetrics,
    });

    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run tests/federation/executors/optimize-executor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement OptimizeActionExecutor**

Create `src/federation/executors/optimize-executor.ts`:

```typescript
/**
 * OptimizeActionExecutor
 *
 * When a skill has poor metrics (low success rate, high latency),
 * uses LLM to analyze the issue and generate an improved handler.
 * Registers the new version and optionally starts canary deployment.
 */
import type { ActionExecutor } from "../evolution-engine.js";
import type { EvolutionAction } from "../types.js";
import type { SkillRegistry } from "../../registry/index.js";
import type { MetricsCollector } from "../../engine/metrics.js";
import type { LLMProvider } from "../../llm/types.js";
import type { SkillLifecycleManager } from "../../engine/skill-lifecycle.js";
import { defineSkill } from "../../types/index.js";
import { runInSandbox } from "../../engine/worker-sandbox.js";

export class OptimizeActionExecutor implements ActionExecutor {
  readonly actionType = "optimize";

  private llm: LLMProvider;
  private lifecycle: SkillLifecycleManager;

  constructor(llm: LLMProvider, lifecycle: SkillLifecycleManager) {
    this.llm = llm;
    this.lifecycle = lifecycle;
  }

  async execute(
    action: EvolutionAction,
    ctx: { registry: SkillRegistry; metrics: MetricsCollector },
  ): Promise<{ success: boolean; message: string }> {
    const skill = ctx.registry.lookup(action.skillName);
    if (!skill) {
      return { success: false, message: `Skill "${action.skillName}" not found` };
    }

    const metrics = ctx.metrics.getMetrics(action.skillName);

    // Build optimization prompt
    const prompt = `你是一个 Skill 优化器。以下 Skill 存在性能问题，请生成优化后的处理函数体。

Skill 名称: ${skill.name}
Skill 描述: ${skill.description}

性能问题:
${action.payload.reason}

当前指标:
- 成功率: ${metrics ? (metrics.successRate * 100).toFixed(1) + "%" : "未知"}
- 平均延迟: ${metrics ? metrics.avgDurationMs.toFixed(0) + "ms" : "未知"}
- 错误分布: ${metrics ? JSON.stringify(metrics.errorDistribution) : "未知"}

要求:
1. 函数接收 params 对象，返回 { success: boolean, data?: unknown, error?: Error }
2. 只输出函数体代码（不需要 function 关键字）
3. 重点优化导致失败/超时的问题
4. 保持功能不变，只改善可靠性和性能
5. 不能使用 require、import、process、eval

只输出纯代码，不要解释。`;

    try {
      const response = await this.llm.chat([{ role: "user", content: prompt }]);
      let code = (response.content ?? "").trim();

      // Clean markdown
      if (code.startsWith("```")) {
        code = code.replace(/^```(?:javascript|js|typescript|ts)?\n?/, "").replace(/\n?```$/, "");
      }

      // Safety check
      const forbidden = ["require(", "import ", "process.", "child_process", "eval(", "Function("];
      for (const f of forbidden) {
        if (code.includes(f)) {
          return { success: false, message: `Generated code contains forbidden pattern: ${f}` };
        }
      }

      // Test in sandbox
      try {
        await runInSandbox(code, {});
      } catch (sandboxErr) {
        return { success: false, message: `Sandbox test failed: ${sandboxErr instanceof Error ? sandboxErr.message : String(sandboxErr)}` };
      }

      // Register optimized version
      const newVersion = this.bumpVersion(skill.version);
      const optimizedSkill = defineSkill({
        ...skill,
        version: newVersion,
        description: `[优化] ${skill.description}`,
        handler: async (params, context) => {
          try {
            return await runInSandbox(code, params);
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      });

      ctx.registry.register(optimizedSkill);

      // Start canary deployment
      try {
        this.lifecycle.startCanary(action.skillName, skill.version, newVersion, {
          trafficPercent: 10,
          minCalls: 20,
          successRateThreshold: Math.max(0.8, (metrics?.successRate ?? 0) + 0.1),
        });
      } catch {
        // Canary start failure is non-fatal
      }

      return {
        success: true,
        message: `Skill "${action.skillName}" optimized: ${skill.version} → ${newVersion} (canary at 10%)`,
      };
    } catch (err) {
      return { success: false, message: `Optimization failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private bumpVersion(version: string): string {
    const parts = version.split(".");
    const patch = parseInt(parts[2] ?? "0", 10) + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }
}
```

- [ ] **Step 4: Create barrel export**

Create `src/federation/executors/index.ts`:

```typescript
export { OptimizeActionExecutor } from "./optimize-executor.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run tests/federation/executors/optimize-executor.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `./node_modules/.bin/vitest run`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/federation/executors/ tests/federation/executors/
git commit -m "feat: implement OptimizeActionExecutor with LLM-driven skill rewriting"
```

---

## Task 3: Implement GenerateActionExecutor

**Files:**
- Create: `src/federation/executors/generate-executor.ts`
- Modify: `src/federation/executors/index.ts`
- Create: `tests/federation/executors/generate-executor.test.ts`

The "generate" action creates entirely new Skills. Uses the same LLM + sandbox approach as skill_from_description but integrated into the evolution loop.

- [ ] **Step 1: Write the failing test**

Create `tests/federation/executors/generate-executor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GenerateActionExecutor } from "../../../src/federation/executors/generate-executor.js";
import type { EvolutionAction } from "../../../src/federation/types.js";

describe("GenerateActionExecutor", () => {
  let executor: GenerateActionExecutor;
  let mockLlm: any;
  let mockRegistry: any;
  let mockMetrics: any;
  let mockController: any;

  beforeEach(() => {
    mockLlm = {
      chat: vi.fn().mockResolvedValue({
        content: `return { success: true, data: { generated: true } };`,
      }),
    };
    mockRegistry = {
      lookup: vi.fn().mockReturnValue(null), // Skill doesn't exist yet
      register: vi.fn(),
    };
    mockMetrics = {};
    mockController = {
      canGenerate: vi.fn().mockReturnValue({ allowed: true }),
      recordGeneration: vi.fn(),
      submitForApproval: vi.fn().mockReturnValue("approval-123"),
    };

    executor = new GenerateActionExecutor(mockLlm, mockController);
  });

  it("should have actionType 'generate'", () => {
    expect(executor.actionType).toBe("generate");
  });

  it("should generate and register a new skill", async () => {
    const action: EvolutionAction = {
      type: "generate",
      skillName: "new_helper",
      payload: {
        description: "A helper that formats dates",
        capabilities: [],
      },
      priority: 50,
      requiresApproval: false,
    };

    const result = await executor.execute(action, {
      registry: mockRegistry,
      metrics: mockMetrics,
    });

    expect(result.success).toBe(true);
    expect(mockLlm.chat).toHaveBeenCalled();
    expect(mockRegistry.register).toHaveBeenCalled();
    expect(mockController.recordGeneration).toHaveBeenCalledWith("new_helper", "evolution-engine");
  });

  it("should submit for approval when requiresApproval is true", async () => {
    const action: EvolutionAction = {
      type: "generate",
      skillName: "risky_skill",
      payload: { description: "A risky skill", capabilities: ["network:outbound"] },
      priority: 50,
      requiresApproval: true,
    };

    const result = await executor.execute(action, {
      registry: mockRegistry,
      metrics: mockMetrics,
    });

    expect(result.success).toBe(true);
    expect(mockController.submitForApproval).toHaveBeenCalled();
    // Should NOT register directly when approval required
    expect(mockRegistry.register).not.toHaveBeenCalled();
  });

  it("should fail when skill already exists", async () => {
    mockRegistry.lookup.mockReturnValue({ name: "existing" });
    const action: EvolutionAction = {
      type: "generate",
      skillName: "existing",
      payload: { description: "Already exists" },
      priority: 50,
      requiresApproval: false,
    };

    const result = await executor.execute(action, {
      registry: mockRegistry,
      metrics: mockMetrics,
    });

    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run tests/federation/executors/generate-executor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement GenerateActionExecutor**

Create `src/federation/executors/generate-executor.ts`:

```typescript
/**
 * GenerateActionExecutor
 *
 * Creates entirely new Skills from evolution strategy suggestions.
 * Uses LLM to generate handler code, validates in sandbox,
 * then either registers directly or submits for human approval.
 */
import type { ActionExecutor } from "../evolution-engine.js";
import type { EvolutionAction } from "../types.js";
import type { SkillRegistry } from "../../registry/index.js";
import type { MetricsCollector } from "../../engine/metrics.js";
import type { LLMProvider } from "../../llm/types.js";
import type { EvolutionController } from "../../engine/evolution-controller.js";
import { defineSkill } from "../../types/index.js";
import { runInSandbox } from "../../engine/worker-sandbox.js";

export class GenerateActionExecutor implements ActionExecutor {
  readonly actionType = "generate";

  private llm: LLMProvider;
  private controller: EvolutionController;

  constructor(llm: LLMProvider, controller: EvolutionController) {
    this.llm = llm;
    this.controller = controller;
  }

  async execute(
    action: EvolutionAction,
    ctx: { registry: SkillRegistry; metrics: MetricsCollector },
  ): Promise<{ success: boolean; message: string }> {
    // Check if skill already exists
    if (ctx.registry.lookup(action.skillName)) {
      return { success: false, message: `Skill "${action.skillName}" already exists` };
    }

    const description = (action.payload.description as string) ?? action.skillName;
    const capabilities = (action.payload.capabilities as string[]) ?? [];

    // Generate code via LLM
    const prompt = `你是一个 Skill 代码生成器。根据以下描述生成 JavaScript 函数体。

Skill 名称: ${action.skillName}
Skill 描述: ${description}

要求:
1. 函数接收 params 对象，返回 { success: boolean, data?: unknown, error?: Error }
2. 只输出函数体代码
3. 代码简洁、安全
4. 不能使用 require、import、process、eval、Function

只输出纯代码。`;

    try {
      const response = await this.llm.chat([{ role: "user", content: prompt }]);
      let code = (response.content ?? "").trim();

      if (code.startsWith("```")) {
        code = code.replace(/^```(?:javascript|js|typescript|ts)?\n?/, "").replace(/\n?```$/, "");
      }

      // Safety check
      const forbidden = ["require(", "import ", "process.", "child_process", "eval(", "Function("];
      for (const f of forbidden) {
        if (code.includes(f)) {
          return { success: false, message: `Generated code contains forbidden: ${f}` };
        }
      }

      // Sandbox test
      try {
        await runInSandbox(code, {});
      } catch (err) {
        return { success: false, message: `Sandbox test failed: ${err instanceof Error ? err.message : String(err)}` };
      }

      // If requires approval, submit instead of registering
      if (action.requiresApproval) {
        const approvalId = this.controller.submitForApproval(
          action.skillName,
          description,
          code,
          capabilities,
          "evolution-engine",
        );
        return {
          success: true,
          message: `Skill "${action.skillName}" submitted for approval (ID: ${approvalId})`,
        };
      }

      // Register directly
      const skill = defineSkill({
        name: action.skillName,
        description: `[进化生成] ${description}`,
        capabilities,
        handler: async (params) => {
          try {
            return await runInSandbox(code, params);
          } catch (err) {
            return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
          }
        },
      });

      ctx.registry.register(skill);
      this.controller.recordGeneration(action.skillName, "evolution-engine");

      return { success: true, message: `Skill "${action.skillName}" generated and registered` };
    } catch (err) {
      return { success: false, message: `Generation failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
```

- [ ] **Step 4: Update barrel export**

In `src/federation/executors/index.ts`, add:

```typescript
export { GenerateActionExecutor } from "./generate-executor.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run tests/federation/executors/generate-executor.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `./node_modules/.bin/vitest run`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/federation/executors/ tests/federation/executors/
git commit -m "feat: implement GenerateActionExecutor with LLM generation and approval flow"
```

---

## Task 4: Implement CanaryActionExecutor

**Files:**
- Create: `src/federation/executors/canary-executor.ts`
- Modify: `src/federation/executors/index.ts`
- Create: `tests/federation/executors/canary-executor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/federation/executors/canary-executor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CanaryActionExecutor } from "../../../src/federation/executors/canary-executor.js";

describe("CanaryActionExecutor", () => {
  let executor: CanaryActionExecutor;
  let mockLifecycle: any;
  let mockRegistry: any;
  let mockMetrics: any;

  beforeEach(() => {
    mockLifecycle = {
      evaluateCanary: vi.fn().mockReturnValue("promote"),
      promoteCanary: vi.fn(),
      rollbackCanary: vi.fn(),
    };
    mockRegistry = {
      lookup: vi.fn().mockReturnValue({ name: "test_skill", version: "1.0.1" }),
    };
    mockMetrics = {};
    executor = new CanaryActionExecutor(mockLifecycle);
  });

  it("should have actionType 'canary'", () => {
    expect(executor.actionType).toBe("canary");
  });

  it("should promote when evaluation says promote", async () => {
    const result = await executor.execute(
      { type: "canary", skillName: "test_skill", payload: { action: "evaluate" }, priority: 50, requiresApproval: false },
      { registry: mockRegistry, metrics: mockMetrics },
    );

    expect(result.success).toBe(true);
    expect(mockLifecycle.promoteCanary).toHaveBeenCalledWith("test_skill");
  });

  it("should rollback when evaluation says rollback", async () => {
    mockLifecycle.evaluateCanary.mockReturnValue("rollback");
    const result = await executor.execute(
      { type: "canary", skillName: "test_skill", payload: { action: "evaluate" }, priority: 50, requiresApproval: false },
      { registry: mockRegistry, metrics: mockMetrics },
    );

    expect(result.success).toBe(true);
    expect(mockLifecycle.rollbackCanary).toHaveBeenCalledWith("test_skill");
  });
});
```

- [ ] **Step 2: Implement CanaryActionExecutor**

Create `src/federation/executors/canary-executor.ts`:

```typescript
/**
 * CanaryActionExecutor
 *
 * Evaluates canary deployments and promotes/rollbacks based on metrics.
 */
import type { ActionExecutor } from "../evolution-engine.js";
import type { EvolutionAction } from "../types.js";
import type { SkillRegistry } from "../../registry/index.js";
import type { MetricsCollector } from "../../engine/metrics.js";
import type { SkillLifecycleManager } from "../../engine/skill-lifecycle.js";

export class CanaryActionExecutor implements ActionExecutor {
  readonly actionType = "canary";

  private lifecycle: SkillLifecycleManager;

  constructor(lifecycle: SkillLifecycleManager) {
    this.lifecycle = lifecycle;
  }

  async execute(
    action: EvolutionAction,
    ctx: { registry: SkillRegistry; metrics: MetricsCollector },
  ): Promise<{ success: boolean; message: string }> {
    const evaluation = this.lifecycle.evaluateCanary(action.skillName);

    switch (evaluation) {
      case "promote":
        this.lifecycle.promoteCanary(action.skillName);
        return { success: true, message: `Canary "${action.skillName}" promoted to production` };
      case "rollback":
        this.lifecycle.rollbackCanary(action.skillName);
        return { success: true, message: `Canary "${action.skillName}" rolled back` };
      case "continue":
        return { success: true, message: `Canary "${action.skillName}" continues (insufficient data)` };
      case "not_canary":
        return { success: false, message: `"${action.skillName}" is not in canary state` };
      default:
        return { success: false, message: `Unknown evaluation: ${evaluation}` };
    }
  }
}
```

- [ ] **Step 3: Update barrel export**

Add to `src/federation/executors/index.ts`:
```typescript
export { CanaryActionExecutor } from "./canary-executor.js";
```

- [ ] **Step 4: Run tests, commit**

Run: `./node_modules/.bin/vitest run`
Commit: `git commit -m "feat: implement CanaryActionExecutor for canary deployment management"`

---

## Task 5: Register Executors in EvolutionEngine and Wire LLM

**Files:**
- Modify: `src/federation/evolution-engine.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Read current EvolutionEngine constructor**

Read `src/federation/evolution-engine.ts` lines 218-238 to understand constructor signature.

- [ ] **Step 2: Extend EvolutionEngine to accept LLM and register executors**

In `src/federation/evolution-engine.ts`, add imports at top:

```typescript
import { OptimizeActionExecutor, GenerateActionExecutor, CanaryActionExecutor } from "./executors/index.js";
import type { LLMProvider } from "../llm/types.js";
```

Extend the constructor's `opts` parameter to accept optional `llmProvider`:

```typescript
  constructor(opts: {
    registry: SkillRegistry;
    metrics: MetricsCollector;
    evolutionController: EvolutionController;
    lifecycleManager: SkillLifecycleManager;
    config?: Partial<EvolutionEngineConfig>;
    llmProvider?: LLMProvider;
  }) {
```

After the existing built-in executor registration, add:

```typescript
    // 注册 LLM 驱动的执行器（需要 LLM Provider）
    if (opts.llmProvider) {
      this.addExecutor(new OptimizeActionExecutor(opts.llmProvider, opts.lifecycleManager));
      this.addExecutor(new GenerateActionExecutor(opts.llmProvider, opts.evolutionController));
    }
    this.addExecutor(new CanaryActionExecutor(opts.lifecycleManager));
```

- [ ] **Step 3: Wire LLM provider in server.ts**

In `src/server.ts`, find where EvolutionEngine is constructed. Add `llmProvider` to the constructor call. Read server.ts to find the LLM provider reference (likely a lazy getter function).

The evolution engine construction should become:

```typescript
const evolutionEngine = new EvolutionEngine({
  registry,
  metrics: engine.metrics,
  evolutionController,
  lifecycleManager,
  llmProvider: getProvider(), // or however the LLM provider is accessed
  config: { /* ... */ },
});
```

If the LLM provider is lazily initialized (which it likely is since it depends on user config), pass a getter pattern or set it after initialization.

- [ ] **Step 4: Verify evolution engine starts**

Check that `evolutionEngine.start()` is called in server.ts. If not, add it after app.listen().

- [ ] **Step 5: Run full test suite**

Run: `./node_modules/.bin/vitest run`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/federation/evolution-engine.ts src/server.ts
git commit -m "feat: register optimize/generate/canary executors in EvolutionEngine with LLM"
```

---

## Task 6: Add Approval Workflow API Endpoints

**Files:**
- Modify: `src/routes/evolution-routes.ts`

- [ ] **Step 1: Read evolution-routes.ts to understand current endpoints**

Read `src/routes/evolution-routes.ts` to see existing evolution endpoints and the dependencies passed in.

- [ ] **Step 2: Add approval workflow endpoints**

Add these routes to the evolution router:

```typescript
// GET /api/evolution/approvals — List pending approvals
router.get("/approvals", (req, res) => {
  const pending = evolutionController.getPendingApprovals();
  res.json({ approvals: pending });
});

// POST /api/evolution/approvals/:id/approve — Approve a pending skill
router.post("/approvals/:id/approve", async (req, res) => {
  const approval = evolutionController.approve(req.params.id);
  if (!approval) {
    res.status(404).json({ error: "Approval not found or already processed" });
    return;
  }

  // Register the approved skill
  try {
    const { defineSkill } = await import("../../types/index.js");
    const { runInSandbox } = await import("../../engine/worker-sandbox.js");

    const code = approval.code;
    const skill = defineSkill({
      name: approval.name,
      description: `[已审批] ${approval.description}`,
      capabilities: approval.capabilities,
      handler: async (params) => {
        try {
          return await runInSandbox(code, params);
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    });

    registry.register(skill);
    evolutionController.recordGeneration(approval.name, approval.generatedBy);

    res.json({ approved: true, skillName: approval.name });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/evolution/approvals/:id/reject — Reject a pending skill
router.post("/approvals/:id/reject", (req, res) => {
  const reason = req.body.reason ?? "Rejected by admin";
  const success = evolutionController.reject(req.params.id, reason);
  if (!success) {
    res.status(404).json({ error: "Approval not found or already processed" });
    return;
  }
  res.json({ rejected: true, reason });
});

// GET /api/evolution/engine/status — Get evolution engine status
router.get("/engine/status", (req, res) => {
  res.json(evolutionEngine.getStatus());
});

// POST /api/evolution/engine/cycle — Manually trigger evolution cycle
router.post("/engine/cycle", async (req, res) => {
  const result = await evolutionEngine.runCycle();
  res.json({
    actions: result.actions.length,
    executed: result.executed.length,
    details: result,
  });
});

// GET /api/evolution/engine/actions — Get pending and executed actions
router.get("/engine/actions", (req, res) => {
  res.json({
    pending: evolutionEngine.getPendingActions(),
    executed: evolutionEngine.getExecutedActions(),
  });
});
```

Ensure the evolution router function receives `evolutionController`, `evolutionEngine`, and `registry` as dependencies.

- [ ] **Step 3: Run full test suite**

Run: `./node_modules/.bin/vitest run`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/routes/evolution-routes.ts
git commit -m "feat: add approval workflow and evolution engine control API endpoints"
```

---

## Task 7: End-to-End Evolution Integration Test

**Files:**
- Create: `tests/integration/evolution-loop.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration/evolution-loop.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionEngine, BottleneckDetectionStrategy, RetireActionExecutor } from "../../src/federation/evolution-engine.js";
import { EvolutionController } from "../../src/engine/evolution-controller.js";
import { SkillLifecycleManager } from "../../src/engine/skill-lifecycle.js";
import { SkillRegistry } from "../../src/registry/index.js";
import { MetricsCollector } from "../../src/engine/metrics.js";
import { defineSkill } from "../../src/types/index.js";

describe("Evolution Loop Integration", () => {
  let registry: SkillRegistry;
  let metrics: MetricsCollector;
  let controller: EvolutionController;
  let lifecycle: SkillLifecycleManager;
  let engine: EvolutionEngine;

  beforeEach(() => {
    registry = new SkillRegistry();
    metrics = new MetricsCollector();
    controller = new EvolutionController();
    lifecycle = new SkillLifecycleManager(registry, metrics);

    engine = new EvolutionEngine({
      registry,
      metrics,
      evolutionController: controller,
      lifecycleManager: lifecycle,
      config: { autoExecute: true, skipApprovalRequired: true, maxActionsPerCycle: 10 },
    });
  });

  it("should detect bottleneck and suggest optimization", async () => {
    // Register a "bad" skill
    registry.register(defineSkill({
      name: "bad_skill",
      handler: async () => ({ success: false, error: new Error("fail") }),
    }));

    // Simulate poor metrics
    for (let i = 0; i < 30; i++) {
      metrics.record("bad_skill", 100, i < 10, i >= 10 ? "Error" : undefined);
    }

    const result = await engine.runCycle();

    // BottleneckDetectionStrategy should detect low success rate
    const optimizeActions = result.actions.filter(a => a.type === "optimize");
    expect(optimizeActions.length).toBeGreaterThan(0);
    expect(optimizeActions[0].skillName).toBe("bad_skill");
  });

  it("should retire inactive non-system skills", async () => {
    // Register a user-created skill
    registry.register(defineSkill({
      name: "custom_unused_skill",
      handler: async () => ({ success: true }),
    }));

    // Simulate old metrics (last called 60 days ago)
    const oldTimestamp = Date.now() - 60 * 86400_000;
    (metrics as any).records.set("custom_unused_skill", [{
      timestamp: oldTimestamp,
      durationMs: 100,
      success: true,
    }]);

    const result = await engine.runCycle();

    // InactiveRetirementStrategy should suggest retire
    const retireActions = result.actions.filter(a => a.type === "retire");
    expect(retireActions.some(a => a.skillName === "custom_unused_skill")).toBe(true);

    // With autoExecute, the retire executor should have run
    const executed = result.executed.filter(e => e.action.skillName === "custom_unused_skill");
    expect(executed.length).toBeGreaterThan(0);
    expect(executed[0].result.success).toBe(true);
  });

  it("should respect evolution controller red lines", async () => {
    const result = engine.getStatus();
    expect(result.strategies.length).toBeGreaterThanOrEqual(3);
    expect(result.executors.length).toBeGreaterThanOrEqual(1);

    // Verify red lines are enforced
    const check = controller.canGenerate("file_read", "evolution-engine", []);
    expect(check.allowed).toBe(false); // core skills are protected
  });

  it("should track evolution cycle count", async () => {
    await engine.runCycle();
    await engine.runCycle();
    const status = engine.getStatus();
    expect(status.cycleCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test**

Run: `./node_modules/.bin/vitest run tests/integration/evolution-loop.test.ts`
Expected: PASS

- [ ] **Step 3: Run full suite**

Run: `./node_modules/.bin/vitest run`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/evolution-loop.test.ts
git commit -m "test: add end-to-end evolution loop integration tests"
```

---

## Summary

| Task | Description | Complexity |
|------|-------------|-----------|
| 1 | Hook EmergenceDetector into ExecutionEngine | Low |
| 2 | OptimizeActionExecutor (LLM rewrite + canary) | Medium |
| 3 | GenerateActionExecutor (LLM create + approval) | Medium |
| 4 | CanaryActionExecutor (evaluate/promote/rollback) | Low |
| 5 | Register executors + wire LLM into EvolutionEngine | Low |
| 6 | Approval workflow API endpoints | Low |
| 7 | End-to-end integration test | Low |

**Dependency order:** Task 1 (independent) → Tasks 2,3,4 (parallel, independent) → Task 5 (depends on 2,3,4) → Task 6 (depends on 5) → Task 7 (depends on all)

**After completion:** The evolution loop will be fully operational:
- BottleneckDetection → OptimizeExecutor → LLM rewrite → Canary deployment
- InactiveRetirement → RetireExecutor → Skill unregistration
- FederatedAdoption → GenerateExecutor → Human approval queue → Registration
- EmergenceDetector monitors all execution for anomalies
- HTTP API for manual cycle trigger, approval management, status monitoring
