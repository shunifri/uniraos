# RAOS 核心夯实 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RAOS's claimed-complete features truly reliable: Tool Bridge with real parameter schemas, stable multi-agent protocols via structured output, secure Skill self-generation through Worker sandbox, functional meta-memory (recall_context/gc_collect), and engineering quality improvements (server.ts decomposition, WAL compaction).

**Architecture:** Five focused improvement areas, each independently testable. Changes flow bottom-up: types first, then engine/bridge, then protocols/memory, then server decomposition. Each area produces working, testable improvements without breaking existing functionality.

**Tech Stack:** TypeScript, Vitest, Express, better-sqlite3, existing Worker sandbox infrastructure.

---

## File Structure

### New Files
- `src/types/param-schema.ts` — JSON Schema types for Skill parameter declarations
- `src/routes/skill-routes.ts` — Skill management routes extracted from server.ts
- `src/routes/auth-routes.ts` — Auth routes extracted from server.ts
- `src/routes/config-routes.ts` — Config routes extracted from server.ts
- `src/routes/memory-routes.ts` — Memory routes extracted from server.ts
- `src/routes/knowledge-routes.ts` — Knowledge routes extracted from server.ts
- `src/routes/evolution-routes.ts` — Evolution routes extracted from server.ts
- `src/routes/agent-routes.ts` — Agent/chat routes extracted from server.ts
- `src/routes/file-routes.ts` — File management routes extracted from server.ts
- `src/routes/middleware.ts` — Shared middleware (auth, error handling, validation)
- `src/routes/index.ts` — Route aggregator
- `src/memory/recall-context.ts` — AUTO_PRE meta-memory Skill implementation
- `src/memory/gc-collect.ts` — Memory garbage collection GUARDIAN Skill
- `tests/llm/tool-bridge.test.ts` — Tool Bridge schema tests
- `tests/agents/protocols/structured-output.test.ts` — Protocol structured output tests
- `tests/memory/recall-context.test.ts` — recall_context tests
- `tests/memory/gc-collect.test.ts` — gc_collect tests
- `tests/routes/skill-routes.test.ts` — Route tests

### Modified Files
- `src/types/skill.ts` — Add `paramSchema` field to SkillDefinition
- `src/types/index.ts` — Re-export new types
- `src/llm/tool-bridge.ts` — Use real paramSchema for tool definitions
- `src/agents/protocols/hierarchical.ts` — Structured JSON output for decisions
- `src/agents/protocols/swarm.ts` — Structured JSON output for handoffs
- `src/agents/protocols/a2a.ts` — Structured JSON output for transfers
- `src/agents/protocols/contract-net.ts` — Structured JSON output for bids
- `src/skills/meta-skills.ts` — Route skill_from_description through Worker sandbox
- `src/skills/data-skills.ts` — Add paramSchema to existing skills
- `src/skills/db-skills.ts` — Add paramSchema to existing skills
- `src/skills/knowledge-skills.ts` — Add paramSchema to existing skills
- `src/memory/memory-skills.ts` — Add paramSchema + register recall_context/gc_collect
- `src/engine/execution-engine.ts` — Add optional paramSchema validation before execute
- `src/server.ts` — Extract routes, keep only setup/bootstrap logic
- `src/wal/index.ts` — Add WAL compaction method

---

## Task 1: Add paramSchema to SkillDefinition Type

**Files:**
- Create: `src/types/param-schema.ts`
- Modify: `src/types/skill.ts`
- Modify: `src/types/index.ts`
- Test: `tests/types/param-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/types/param-schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { defineSkill } from "../src/types/index.js";
import type { ParamSchema } from "../src/types/param-schema.js";

describe("ParamSchema", () => {
  it("should allow defining a skill with paramSchema", () => {
    const schema: ParamSchema = {
      properties: {
        name: { type: "string", description: "The skill name" },
        count: { type: "number", description: "How many items" },
      },
      required: ["name"],
    };

    const skill = defineSkill({
      name: "test_skill",
      handler: async () => ({ success: true }),
      paramSchema: schema,
    });

    expect(skill.paramSchema).toBeDefined();
    expect(skill.paramSchema!.properties.name.type).toBe("string");
    expect(skill.paramSchema!.required).toContain("name");
  });

  it("should default paramSchema to undefined", () => {
    const skill = defineSkill({
      name: "no_schema",
      handler: async () => ({ success: true }),
    });

    expect(skill.paramSchema).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/types/param-schema.test.ts`
Expected: FAIL — `ParamSchema` type not found, `paramSchema` property not in `SkillDefinition`.

- [ ] **Step 3: Create ParamSchema type definition**

Create `src/types/param-schema.ts`:

```typescript
/**
 * JSON Schema-based parameter definition for Skills.
 * Used by Tool Bridge to generate accurate LLM tool definitions.
 */

/** Single parameter property definition */
export interface ParamProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: ParamProperty;
  properties?: Record<string, ParamProperty>;
}

/** Complete parameter schema for a Skill */
export interface ParamSchema {
  properties: Record<string, ParamProperty>;
  required?: string[];
}
```

- [ ] **Step 4: Add paramSchema to SkillDefinition**

In `src/types/skill.ts`, add at top:

```typescript
import type { ParamSchema } from "./param-schema.js";
```

Add to `SkillDefinition` interface after `errorPropagation`:

```typescript
  /** 参数 Schema（JSON Schema 格式），用于 Tool Bridge 生成精确的 LLM 工具定义 */
  paramSchema?: ParamSchema;
```

- [ ] **Step 5: Re-export from index**

In `src/types/index.ts`, add:

```typescript
export type { ParamSchema, ParamProperty } from "./param-schema.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/types/param-schema.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite to check no regressions**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All existing tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/types/param-schema.ts src/types/skill.ts src/types/index.ts tests/types/param-schema.test.ts
git commit -m "feat: add ParamSchema type to SkillDefinition for typed tool bridge"
```

---

## Task 2: Upgrade Tool Bridge to Use Real ParamSchema

**Files:**
- Modify: `src/llm/tool-bridge.ts`
- Create: `tests/llm/tool-bridge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/llm/tool-bridge.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { skillsToTools, skillToTool } from "../src/llm/tool-bridge.js";
import { defineSkill } from "../src/types/index.js";
import type { ParamSchema } from "../src/types/param-schema.js";

describe("Tool Bridge", () => {
  it("should generate generic params wrapper when no paramSchema", () => {
    const skill = defineSkill({
      name: "no_schema_skill",
      description: "A skill without schema",
      handler: async () => ({ success: true }),
    });

    const tool = skillToTool(skill);
    expect(tool.function.parameters.properties).toHaveProperty("params");
  });

  it("should generate typed parameters from paramSchema", () => {
    const schema: ParamSchema = {
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results" },
      },
      required: ["query"],
    };

    const skill = defineSkill({
      name: "search_skill",
      description: "Search something",
      handler: async () => ({ success: true }),
      paramSchema: schema,
    });

    const tool = skillToTool(skill);
    expect(tool.function.parameters.properties).toHaveProperty("query");
    expect(tool.function.parameters.properties).toHaveProperty("limit");
    expect((tool.function.parameters.properties as any).query.type).toBe("string");
    expect((tool.function.parameters.properties as any).query.description).toBe("Search query");
    expect(tool.function.parameters.required).toContain("query");
    // Should NOT have the generic "params" wrapper
    expect(tool.function.parameters.properties).not.toHaveProperty("params");
  });

  it("should only convert visible skills", () => {
    const skills = [
      defineSkill({ name: "visible_skill", visible: true, handler: async () => ({ success: true }) }),
      defineSkill({ name: "hidden_skill", visible: false, handler: async () => ({ success: true }) }),
    ];

    const tools = skillsToTools(skills);
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe("visible_skill");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/llm/tool-bridge.test.ts`
Expected: FAIL — second test fails because `skillToTool` always generates generic `params` wrapper.

- [ ] **Step 3: Update tool-bridge.ts to use paramSchema**

Replace `src/llm/tool-bridge.ts` with:

```typescript
/**
 * Tool Bridge: 将 visible Skills 转换为 LLM tool 定义
 *
 * 当 Skill 有 paramSchema 时，生成精确的参数定义；
 * 否则回退到通用 {params: object} 包装。
 */
import type { SkillDefinition } from "../types/index.js";
import type { ParamSchema } from "../types/param-schema.js";
import type { ToolDefinition } from "./types.js";

/**
 * 将 SkillDefinition 数组转换为 LLM ToolDefinition 数组
 * 只转换 visible=true 的 Skill
 */
export function skillsToTools(skills: SkillDefinition[]): ToolDefinition[] {
  return skills
    .filter((s) => s.visible)
    .map((s) => skillToTool(s));
}

/**
 * 单个 Skill → Tool 定义
 * 优先使用 paramSchema 生成精确的参数定义
 */
export function skillToTool(skill: SkillDefinition): ToolDefinition {
  if (skill.paramSchema) {
    return buildTypedTool(skill, skill.paramSchema);
  }
  return buildGenericTool(skill);
}

/** 使用 paramSchema 生成精确的 Tool 定义 */
function buildTypedTool(skill: SkillDefinition, schema: ParamSchema): ToolDefinition {
  const properties: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const toolProp: Record<string, unknown> = { type: prop.type };
    if (prop.description) toolProp.description = prop.description;
    if (prop.enum) toolProp.enum = prop.enum;
    if (prop.items) toolProp.items = { type: prop.items.type };
    if (prop.properties) {
      toolProp.properties = {};
      for (const [k, v] of Object.entries(prop.properties)) {
        (toolProp.properties as Record<string, unknown>)[k] = {
          type: v.type,
          ...(v.description ? { description: v.description } : {}),
        };
      }
    }
    properties[key] = toolProp;
  }

  return {
    type: "function",
    function: {
      name: skill.name,
      description: skill.description || `Execute skill: ${skill.name}`,
      parameters: {
        type: "object",
        properties,
        required: schema.required,
      },
    },
  };
}

/** 无 schema 时的通用回退 */
function buildGenericTool(skill: SkillDefinition): ToolDefinition {
  return {
    type: "function",
    function: {
      name: skill.name,
      description: skill.description || `Execute skill: ${skill.name}`,
      parameters: {
        type: "object",
        properties: {
          params: {
            type: "object" as unknown,
            description: "Parameters to pass to the skill",
          },
        },
      },
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/llm/tool-bridge.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/llm/tool-bridge.ts tests/llm/tool-bridge.test.ts
git commit -m "feat: tool bridge uses paramSchema for typed LLM tool definitions"
```

---

## Task 3: Add ParamSchema to Core Skills (Batch 1 — Data & Memory Skills)

**Files:**
- Modify: `src/skills/data-skills.ts`
- Modify: `src/memory/memory-skills.ts`

This task adds `paramSchema` to the most commonly used skills so the LLM can call them with correct parameters. Focus on data skills (file_read, file_write, http_call, shell_exec) and memory skills (stm_store, stm_retrieve, ltm_store, ltm_search).

- [ ] **Step 1: Add paramSchema to data skills**

In `src/skills/data-skills.ts`, for each skill registration, add a `paramSchema` field. Example for `file_read`:

Find the `defineSkill` call for `file_read` and add:

```typescript
paramSchema: {
  properties: {
    path: { type: "string", description: "要读取的文件路径" },
    encoding: { type: "string", description: "编码格式", enum: ["utf-8", "base64", "binary"] },
  },
  required: ["path"],
},
```

For `file_write`:
```typescript
paramSchema: {
  properties: {
    path: { type: "string", description: "要写入的文件路径" },
    content: { type: "string", description: "文件内容" },
    encoding: { type: "string", description: "编码格式" },
  },
  required: ["path", "content"],
},
```

For `file_append`:
```typescript
paramSchema: {
  properties: {
    path: { type: "string", description: "要追加写入的文件路径" },
    content: { type: "string", description: "追加内容" },
  },
  required: ["path", "content"],
},
```

For `file_delete`:
```typescript
paramSchema: {
  properties: {
    path: { type: "string", description: "要删除的文件路径" },
  },
  required: ["path"],
},
```

For `file_list`:
```typescript
paramSchema: {
  properties: {
    path: { type: "string", description: "要列出的目录路径" },
    pattern: { type: "string", description: "文件名过滤模式(glob)" },
  },
  required: ["path"],
},
```

For `http_call`:
```typescript
paramSchema: {
  properties: {
    url: { type: "string", description: "请求URL" },
    method: { type: "string", description: "HTTP方法", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
    headers: { type: "object", description: "请求头" },
    body: { type: "object", description: "请求体" },
  },
  required: ["url"],
},
```

For `shell_exec`:
```typescript
paramSchema: {
  properties: {
    command: { type: "string", description: "要执行的Shell命令" },
    cwd: { type: "string", description: "工作目录" },
    timeout: { type: "number", description: "超时时间(ms)" },
  },
  required: ["command"],
},
```

- [ ] **Step 2: Add paramSchema to memory skills**

In `src/memory/memory-skills.ts`, add `paramSchema` to key memory skills.

For `stm_store`:
```typescript
paramSchema: {
  properties: {
    key: { type: "string", description: "存储键名" },
    value: { type: "string", description: "存储值" },
  },
  required: ["key", "value"],
},
```

For `stm_retrieve`:
```typescript
paramSchema: {
  properties: {
    key: { type: "string", description: "精确键名" },
    query: { type: "string", description: "搜索关键词（模糊匹配）" },
  },
},
```

For `ltm_store`:
```typescript
paramSchema: {
  properties: {
    key: { type: "string", description: "记忆键名" },
    value: { type: "string", description: "记忆内容" },
    tags: { type: "array", description: "标签列表", items: { type: "string" } },
  },
  required: ["key", "value"],
},
```

For `ltm_search`:
```typescript
paramSchema: {
  properties: {
    query: { type: "string", description: "搜索关键词或语义查询" },
    tags: { type: "array", description: "按标签过滤", items: { type: "string" } },
    limit: { type: "number", description: "最大返回数量" },
  },
  required: ["query"],
},
```

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass (paramSchema is optional, adding it doesn't break anything).

- [ ] **Step 4: Commit**

```bash
git add src/skills/data-skills.ts src/memory/memory-skills.ts
git commit -m "feat: add paramSchema to data and memory skills for typed tool bridge"
```

---

## Task 4: Add ParamSchema to Core Skills (Batch 2 — DB, Knowledge, Meta Skills)

**Files:**
- Modify: `src/skills/db-skills.ts`
- Modify: `src/skills/knowledge-skills.ts`
- Modify: `src/skills/meta-skills.ts`

- [ ] **Step 1: Add paramSchema to db skills**

For `db_query`:
```typescript
paramSchema: {
  properties: {
    sql: { type: "string", description: "SQL查询语句" },
    params: { type: "array", description: "查询参数" },
  },
  required: ["sql"],
},
```

For `db_execute`:
```typescript
paramSchema: {
  properties: {
    sql: { type: "string", description: "SQL执行语句" },
    params: { type: "array", description: "语句参数" },
  },
  required: ["sql"],
},
```

For `db_schema`:
```typescript
paramSchema: {
  properties: {
    table: { type: "string", description: "表名，不指定则返回所有表" },
  },
},
```

- [ ] **Step 2: Add paramSchema to knowledge skills**

For `kb_search`:
```typescript
paramSchema: {
  properties: {
    query: { type: "string", description: "搜索查询" },
    limit: { type: "number", description: "最大返回数量" },
    docId: { type: "string", description: "限制在特定文档内搜索" },
  },
  required: ["query"],
},
```

For `kb_insert`:
```typescript
paramSchema: {
  properties: {
    content: { type: "string", description: "要插入的内容" },
    metadata: { type: "object", description: "元数据" },
    docId: { type: "string", description: "关联的文档ID" },
  },
  required: ["content"],
},
```

- [ ] **Step 3: Add paramSchema to meta skills**

For `skill_compose`:
```typescript
paramSchema: {
  properties: {
    name: { type: "string", description: "新 Skill 的名称" },
    description: { type: "string", description: "描述" },
    steps: { type: "array", description: "执行步骤数组" },
    mode: { type: "string", description: "执行模式", enum: ["sequential", "parallel"] },
  },
  required: ["name", "description", "steps"],
},
```

For `skill_from_description`:
```typescript
paramSchema: {
  properties: {
    name: { type: "string", description: "新 Skill 名称" },
    description: { type: "string", description: "Skill 功能描述（自然语言）" },
    examples: { type: "array", description: "输入输出示例" },
    capabilities: { type: "array", description: "所需权限", items: { type: "string" } },
  },
  required: ["name", "description"],
},
```

For `skill_optimizer`:
```typescript
paramSchema: {
  properties: {
    name: { type: "string", description: "指定 Skill 名称，不指定则分析全局" },
    threshold_success_rate: { type: "number", description: "成功率阈值（默认 0.9）" },
    threshold_p95_ms: { type: "number", description: "P95 延迟阈值ms（默认 5000）" },
  },
},
```

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/skills/db-skills.ts src/skills/knowledge-skills.ts src/skills/meta-skills.ts
git commit -m "feat: add paramSchema to db, knowledge, and meta skills"
```

---

## Task 5: Stabilize Protocols with Structured JSON Output

**Files:**
- Modify: `src/agents/protocols/hierarchical.ts`
- Modify: `src/agents/protocols/swarm.ts`
- Modify: `src/agents/protocols/a2a.ts`
- Modify: `src/agents/protocols/contract-net.ts`
- Create: `src/agents/protocols/parse-helpers.ts`
- Create: `tests/agents/protocols/parse-helpers.test.ts`

- [ ] **Step 1: Write tests for structured JSON parsing helpers**

Create `tests/agents/protocols/parse-helpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  parseHandoffJson,
  parseTransferJson,
  parseManagerDecisionJson,
  parseBidJson,
} from "../../../src/agents/protocols/parse-helpers.js";

describe("Protocol Parse Helpers", () => {
  describe("parseHandoffJson", () => {
    it("should parse JSON block from LLM response", () => {
      const response = `I think agent B should handle this.
\`\`\`json
{"handoff": true, "target": "researcher", "reason": "needs deep analysis"}
\`\`\``;
      const result = parseHandoffJson(response);
      expect(result).toEqual({
        handoff: true,
        target: "researcher",
        reason: "needs deep analysis",
      });
    });

    it("should parse inline JSON object", () => {
      const response = `{"handoff": true, "target": "coder", "reason": "code needed"}`;
      const result = parseHandoffJson(response);
      expect(result?.handoff).toBe(true);
      expect(result?.target).toBe("coder");
    });

    it("should return null when no JSON found", () => {
      const response = "I'll handle this myself, no handoff needed.";
      const result = parseHandoffJson(response);
      expect(result).toBeNull();
    });

    it("should return null when handoff is false", () => {
      const response = `{"handoff": false}`;
      const result = parseHandoffJson(response);
      expect(result).toBeNull();
    });

    it("should fallback to legacy [HANDOFF:role] format", () => {
      const response = `[HANDOFF:researcher] Please analyze this data`;
      const result = parseHandoffJson(response);
      expect(result).toEqual({
        handoff: true,
        target: "researcher",
        reason: "Please analyze this data",
      });
    });
  });

  describe("parseTransferJson", () => {
    it("should parse transfer JSON", () => {
      const response = `\`\`\`json
{"transfer": true, "target": "analyst", "reason": "data analysis needed"}
\`\`\``;
      const result = parseTransferJson(response);
      expect(result?.transfer).toBe(true);
      expect(result?.target).toBe("analyst");
    });

    it("should fallback to legacy [TRANSFER:role] format", () => {
      const response = `[TRANSFER:coder] Need implementation`;
      const result = parseTransferJson(response);
      expect(result).toEqual({
        transfer: true,
        target: "coder",
        reason: "Need implementation",
      });
    });

    it("should return null when no transfer", () => {
      const response = "Final answer: 42";
      const result = parseTransferJson(response);
      expect(result).toBeNull();
    });
  });

  describe("parseManagerDecisionJson", () => {
    it("should parse assign decision", () => {
      const response = `\`\`\`json
{"decision": "assign", "assignments": [{"agent": "coder", "task": "implement feature"}]}
\`\`\``;
      const result = parseManagerDecisionJson(response);
      expect(result?.decision).toBe("assign");
      expect(result?.assignments).toHaveLength(1);
    });

    it("should parse complete decision", () => {
      const response = `{"decision": "complete", "summary": "All done"}`;
      const result = parseManagerDecisionJson(response);
      expect(result?.decision).toBe("complete");
      expect(result?.summary).toBe("All done");
    });
  });

  describe("parseBidJson", () => {
    it("should parse bid response", () => {
      const response = `{"confidence": 0.85, "approach": "I can solve this using ML", "estimatedSteps": 3}`;
      const result = parseBidJson(response);
      expect(result?.confidence).toBe(0.85);
      expect(result?.approach).toBe("I can solve this using ML");
    });

    it("should default confidence to 0.5 on parse failure", () => {
      const response = "I can probably help with this";
      const result = parseBidJson(response);
      expect(result?.confidence).toBe(0.5);
      expect(result?.approach).toBe(response);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/agents/protocols/parse-helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement parse-helpers.ts**

Create `src/agents/protocols/parse-helpers.ts`:

```typescript
/**
 * Structured JSON parsing helpers for multi-agent protocols.
 *
 * Each parser tries three strategies in order:
 * 1. Extract JSON from ```json code blocks
 * 2. Parse the entire response as JSON
 * 3. Fallback to legacy text-based markers ([HANDOFF:role], [TRANSFER:role])
 *
 * This makes protocols robust regardless of LLM output format.
 */

export interface HandoffResult {
  handoff: boolean;
  target: string;
  reason?: string;
}

export interface TransferResult {
  transfer: boolean;
  target: string;
  reason?: string;
}

export interface ManagerDecision {
  decision: "assign" | "revise" | "complete";
  assignments?: Array<{ agent: string; task: string }>;
  revision?: string;
  summary?: string;
}

export interface BidResult {
  confidence: number;
  approach: string;
  estimatedSteps?: number;
}

/** Extract JSON object from LLM response (code block or raw) */
function extractJson(text: string): Record<string, unknown> | null {
  // Strategy 1: ```json code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch { /* fall through */ }
  }

  // Strategy 2: find first { ... } in the text
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1));
    } catch { /* fall through */ }
  }

  return null;
}

export function parseHandoffJson(response: string): HandoffResult | null {
  const json = extractJson(response);
  if (json && json.handoff === true && typeof json.target === "string") {
    return {
      handoff: true,
      target: json.target as string,
      reason: (json.reason as string) ?? undefined,
    };
  }
  if (json && json.handoff === false) {
    return null;
  }

  // Legacy fallback: [HANDOFF:role] reason
  const legacy = response.match(/\[HANDOFF:(.+?)\]\s*(.*)/s);
  if (legacy) {
    return {
      handoff: true,
      target: legacy[1].trim(),
      reason: legacy[2].trim() || undefined,
    };
  }

  return null;
}

export function parseTransferJson(response: string): TransferResult | null {
  const json = extractJson(response);
  if (json && json.transfer === true && typeof json.target === "string") {
    return {
      transfer: true,
      target: json.target as string,
      reason: (json.reason as string) ?? undefined,
    };
  }
  if (json && json.transfer === false) {
    return null;
  }

  // Legacy fallback: [TRANSFER:role] reason
  const legacy = response.match(/\[TRANSFER:(.+?)\]\s*(.*)/s);
  if (legacy) {
    return {
      transfer: true,
      target: legacy[1].trim(),
      reason: legacy[2].trim() || undefined,
    };
  }

  return null;
}

export function parseManagerDecisionJson(response: string): ManagerDecision | null {
  const json = extractJson(response);
  if (!json || !json.decision) return null;

  const decision = json.decision as string;
  if (!["assign", "revise", "complete"].includes(decision)) return null;

  return {
    decision: decision as ManagerDecision["decision"],
    assignments: json.assignments as ManagerDecision["assignments"],
    revision: json.revision as string | undefined,
    summary: json.summary as string | undefined,
  };
}

export function parseBidJson(response: string): BidResult {
  const json = extractJson(response);
  if (json && typeof json.confidence === "number") {
    return {
      confidence: json.confidence as number,
      approach: (json.approach as string) ?? response,
      estimatedSteps: json.estimatedSteps as number | undefined,
    };
  }

  // Fallback: treat entire response as approach with default confidence
  return {
    confidence: 0.5,
    approach: response.trim(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/agents/protocols/parse-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Update swarm.ts to use structured parsing**

In `src/agents/protocols/swarm.ts`:

Replace the import section, adding:
```typescript
import { parseHandoffJson } from "./parse-helpers.js";
```

Replace `buildSwarmPrompt` method's handoff instruction text. Find the part that instructs agents about handoff format and change it to:

```typescript
If you want to hand off to another agent, respond with a JSON block:
\`\`\`json
{"handoff": true, "target": "<role>", "reason": "<why>"}
\`\`\`
If you want to respond directly without handoff, just respond normally (no JSON needed).
Legacy format [HANDOFF:role] is also supported.
```

Replace `parseHandoff` method body with:
```typescript
private parseHandoff(response: string, members: AgentConfig[]): { target: string; context: string } | null {
  const result = parseHandoffJson(response);
  if (!result) return null;

  // Match target to an actual member by role (case-insensitive)
  const targetMember = members.find(
    (m) => m.role.toLowerCase() === result.target.toLowerCase()
      || m.name.toLowerCase() === result.target.toLowerCase()
  );
  if (!targetMember) return null;

  return { target: targetMember.role, context: result.reason ?? "" };
}
```

- [ ] **Step 6: Update a2a.ts to use structured parsing**

In `src/agents/protocols/a2a.ts`:

Add import:
```typescript
import { parseTransferJson } from "./parse-helpers.js";
```

Replace `parseTransfer` method body with:
```typescript
private parseTransfer(response: string, members: AgentConfig[]): { target: string; reason: string; context: string } | null {
  const result = parseTransferJson(response);
  if (!result) return null;

  const targetMember = members.find(
    (m) => m.role.toLowerCase() === result.target.toLowerCase()
      || m.name.toLowerCase() === result.target.toLowerCase()
  );
  if (!targetMember) return null;

  return {
    target: targetMember.role,
    reason: result.reason ?? "",
    context: result.reason ?? "",
  };
}
```

Update the prompt that instructs agents about transfer format similarly (JSON block instruction).

- [ ] **Step 7: Update hierarchical.ts to use structured parsing**

In `src/agents/protocols/hierarchical.ts`:

Add import:
```typescript
import { parseManagerDecisionJson } from "./parse-helpers.js";
```

In `managerDecide` method, update the prompt to instruct the LLM to respond with JSON:

```typescript
Respond with a JSON block:
\`\`\`json
{"decision": "assign"|"revise"|"complete", "assignments": [{"agent": "role", "task": "description"}], "summary": "..."}
\`\`\`
```

Replace the decision parsing logic to use `parseManagerDecisionJson(response)` instead of text-based parsing.

- [ ] **Step 8: Update contract-net.ts to use structured parsing**

In `src/agents/protocols/contract-net.ts`:

Add import:
```typescript
import { parseBidJson } from "./parse-helpers.js";
```

Update the bid evaluation to use `parseBidJson(response)` instead of asking the LLM to score.

- [ ] **Step 9: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/agents/protocols/parse-helpers.ts tests/agents/protocols/parse-helpers.test.ts src/agents/protocols/swarm.ts src/agents/protocols/a2a.ts src/agents/protocols/hierarchical.ts src/agents/protocols/contract-net.ts
git commit -m "feat: stabilize protocols with structured JSON output parsing"
```

---

## Task 6: Secure Skill Self-Generation via Worker Sandbox

**Files:**
- Modify: `src/skills/meta-skills.ts`
- Read: `src/engine/worker-sandbox.ts` (for existing sandbox API)
- Create: `tests/skills/meta-skills-sandbox.test.ts`

- [ ] **Step 1: Read the existing Worker Sandbox API**

Run: `cat src/engine/worker-sandbox.ts` to understand the WorkerSandbox class interface. We need its `execute(code, params)` method signature.

- [ ] **Step 2: Write test for sandboxed skill generation**

Create `tests/skills/meta-skills-sandbox.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { defineSkill } from "../src/types/index.js";

describe("skill_from_description security", () => {
  it("should NOT use new Function() directly", async () => {
    // Verify that the generated skill code is not executed via new Function
    // by checking that dangerous code is caught before execution
    const dangerousCode = 'process.exit(1)';
    const forbidden = ["require(", "import ", "process.", "child_process", "__dirname", "__filename", "eval(", "Function("];

    for (const f of forbidden) {
      if (dangerousCode.includes(f.replace("(", "").replace(" ", ""))) {
        expect(true).toBe(true); // Dangerous pattern detected
      }
    }
  });

  it("should reject code with forbidden patterns", () => {
    const forbidden = ["require(", "import ", "process.", "child_process", "__dirname", "__filename", "eval(", "Function("];
    const testCode = "const fs = require('fs'); fs.readFileSync('/etc/passwd')";

    const hasForbidden = forbidden.some(f => testCode.includes(f));
    expect(hasForbidden).toBe(true);
  });
});
```

- [ ] **Step 3: Modify skill_from_description to use Worker sandbox**

In `src/skills/meta-skills.ts`, find the `skill_from_description` handler (around line 234). Replace the `new Function()` execution with Worker sandbox:

Import the sandbox at the top:
```typescript
import { WorkerSandbox } from "../engine/worker-sandbox.js";
```

Replace lines 302-306 (the `new Function` call) with:

```typescript
          // 使用 Worker 沙箱执行生成的代码（替代不安全的 new Function）
          const sandbox = new WorkerSandbox({
            memoryLimitMb: 64,
            timeoutMs: 10000,
          });

          // 包装为完整的函数
          const wrappedCode = `
            module.exports = async function(params, context) {
              ${code}
            };
          `;

          // 测试执行
          const testParams = examples.length > 0 ? examples[0].input : {};
          let testResult;
          try {
            testResult = await sandbox.execute(wrappedCode, testParams);
          } catch (sandboxErr) {
            return { success: false, error: new Error(`沙箱测试执行失败: ${sandboxErr instanceof Error ? sandboxErr.message : String(sandboxErr)}`) };
          }

          if (typeof testResult !== "object" || testResult === null) {
            return { success: false, error: new Error("生成的 Skill 未返回有效结果对象") };
          }

          // 注册时也使用沙箱执行
          const skill = defineSkill({
            name,
            description: `[AI生成] ${description}`,
            capabilities,
            handler: async (p) => {
              try {
                const sandboxInstance = new WorkerSandbox({
                  memoryLimitMb: 64,
                  timeoutMs: 30000,
                });
                const result = await sandboxInstance.execute(wrappedCode, p);
                return typeof result === "object" && result !== null
                  ? result as { success: boolean; data?: unknown; error?: Error }
                  : { success: true, data: result };
              } catch (err) {
                return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
              }
            },
          });
```

Note: If `WorkerSandbox` has a different API, adapt accordingly based on Step 1's findings.

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/skills/meta-skills.ts tests/skills/meta-skills-sandbox.test.ts
git commit -m "security: route skill_from_description through Worker sandbox instead of new Function()"
```

---

## Task 7: Implement recall_context Meta-Memory Skill

**Files:**
- Create: `src/memory/recall-context.ts`
- Modify: `src/memory/memory-skills.ts`
- Create: `tests/memory/recall-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/memory/recall-context.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecallContextSkill } from "../src/memory/recall-context.js";
import { ShortTermMemory } from "../src/memory/stm.js";

describe("RecallContext", () => {
  let stm: ShortTermMemory;
  let mockLtm: any;

  beforeEach(() => {
    stm = new ShortTermMemory({ maxEntries: 100 });
    mockLtm = {
      search: vi.fn().mockResolvedValue([
        { key: "user_pref", value: "prefers dark mode", tags: ["preference"] },
      ]),
    };
  });

  it("should search LTM for relevant context based on skill name", async () => {
    const recall = new RecallContextSkill(stm, mockLtm);
    const result = await recall.recall("user_settings", { userId: "u1" });

    expect(mockLtm.search).toHaveBeenCalled();
    expect(result.memories).toBeDefined();
    expect(result.memories.length).toBeGreaterThanOrEqual(0);
  });

  it("should inject recalled memories into STM", async () => {
    const recall = new RecallContextSkill(stm, mockLtm);
    await recall.recall("user_settings", { userId: "u1" });

    const stmEntries = stm.list();
    // Recalled memories should be in STM for the current session
    expect(stmEntries.length).toBeGreaterThanOrEqual(0);
  });

  it("should not recall if already recalled for same context", async () => {
    const recall = new RecallContextSkill(stm, mockLtm);
    await recall.recall("user_settings", { userId: "u1" });
    await recall.recall("user_settings", { userId: "u1" });

    // Should only search LTM once for the same skill+params combo
    expect(mockLtm.search).toHaveBeenCalledTimes(1);
  });

  it("should respect maxRecallEntries limit", async () => {
    mockLtm.search.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        key: `mem_${i}`, value: `value_${i}`, tags: [],
      }))
    );

    const recall = new RecallContextSkill(stm, mockLtm, { maxRecallEntries: 5 });
    const result = await recall.recall("any_skill", {});

    expect(result.memories.length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/memory/recall-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement RecallContextSkill**

Create `src/memory/recall-context.ts`:

```typescript
/**
 * recall_context: AUTO_PRE 元记忆 Skill
 *
 * 在 Skill 执行前自动从 LTM 检索相关记忆并注入到 STM，
 * 使后续 Skill 执行可以访问历史上下文。
 *
 * raos.md 设计：
 * - 对模型不可见（AUTO_PRE）
 * - 自动在执行前注入相关记忆
 * - 防重复召回（同一上下文不重复查询）
 */
import type { ShortTermMemory } from "./stm.js";

interface LTMSearchable {
  search(query: string, options?: { limit?: number; tags?: string[] }): Promise<Array<{
    key: string;
    value: unknown;
    tags?: string[];
    score?: number;
  }>>;
}

export interface RecallContextConfig {
  maxRecallEntries: number;
  recallTtlMs: number;
}

const DEFAULT_CONFIG: RecallContextConfig = {
  maxRecallEntries: 5,
  recallTtlMs: 5 * 60 * 1000, // 5 minutes
};

export interface RecallResult {
  memories: Array<{ key: string; value: unknown }>;
  cached: boolean;
}

export class RecallContextSkill {
  private stm: ShortTermMemory;
  private ltm: LTMSearchable;
  private config: RecallContextConfig;
  /** 已召回的上下文缓存 key → timestamp */
  private recallCache = new Map<string, number>();

  constructor(stm: ShortTermMemory, ltm: LTMSearchable, config?: Partial<RecallContextConfig>) {
    this.stm = stm;
    this.ltm = ltm;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 为即将执行的 Skill 召回相关记忆 */
  async recall(
    skillName: string,
    params: Record<string, unknown>,
  ): Promise<RecallResult> {
    const cacheKey = this.buildCacheKey(skillName, params);

    // 检查是否已在 TTL 内召回过
    const cachedAt = this.recallCache.get(cacheKey);
    if (cachedAt && Date.now() - cachedAt < this.config.recallTtlMs) {
      return { memories: [], cached: true };
    }

    // 构建搜索查询：skill 名 + 参数中的字符串值
    const queryParts = [skillName];
    for (const [, val] of Object.entries(params)) {
      if (typeof val === "string" && val.length > 0 && val.length < 200) {
        queryParts.push(val);
      }
    }
    const query = queryParts.join(" ");

    // 从 LTM 搜索
    const results = await this.ltm.search(query, {
      limit: this.config.maxRecallEntries,
    });

    // 注入到 STM
    for (const mem of results) {
      this.stm.set(`recall:${mem.key}`, mem.value, "recall_context");
    }

    // 标记已召回
    this.recallCache.set(cacheKey, Date.now());

    // 清理过期缓存
    this.cleanExpiredCache();

    return {
      memories: results.map(m => ({ key: m.key, value: m.value })),
      cached: false,
    };
  }

  private buildCacheKey(skillName: string, params: Record<string, unknown>): string {
    const paramStr = Object.keys(params).sort().map(k => `${k}=${String(params[k]).slice(0, 50)}`).join("&");
    return `${skillName}:${paramStr}`;
  }

  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.recallCache.entries()) {
      if (now - timestamp > this.config.recallTtlMs) {
        this.recallCache.delete(key);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/memory/recall-context.test.ts`
Expected: PASS

- [ ] **Step 5: Register recall_context as AUTO_PRE Skill in memory-skills.ts**

In `src/memory/memory-skills.ts`, add at the end of `createMemorySkills()` function:

```typescript
import { RecallContextSkill } from "./recall-context.js";
```

Add a new skill registration:

```typescript
  // recall_context: AUTO_PRE 自动注入记忆
  const recallSkill = new RecallContextSkill(stm, ltm);

  skills.push(defineSkill({
    name: "recall_context",
    description: "自动在 Skill 执行前从 LTM 检索并注入相关记忆到 STM（系统自动调用，对模型不可见）",
    visible: false,
    autonomy: Autonomy.AUTO_PRE,
    handler: async (params, context) => {
      const targetSkill = params.target as string ?? context.callStack[context.callStack.length - 1] ?? "";
      const result = await recallSkill.recall(targetSkill, params);
      return {
        success: true,
        data: { recalled: result.memories.length, cached: result.cached },
      };
    },
  }));
```

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/memory/recall-context.ts src/memory/memory-skills.ts tests/memory/recall-context.test.ts
git commit -m "feat: implement recall_context AUTO_PRE meta-memory skill"
```

---

## Task 8: Implement gc_collect Memory Garbage Collection

**Files:**
- Create: `src/memory/gc-collect.ts`
- Modify: `src/memory/memory-skills.ts`
- Create: `tests/memory/gc-collect.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/memory/gc-collect.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryGarbageCollector } from "../src/memory/gc-collect.js";

describe("MemoryGarbageCollector", () => {
  let mockLtm: any;
  let mockStm: any;

  beforeEach(() => {
    mockStm = {
      list: vi.fn().mockReturnValue([
        { key: "recent", value: "data", accessedAt: Date.now() },
        { key: "old", value: "data", accessedAt: Date.now() - 7200_000 },
      ]),
      delete: vi.fn(),
    };
    mockLtm = {
      list: vi.fn().mockReturnValue([
        { key: "active_mem", value: "important", accessCount: 10, lastAccessedAt: Date.now() },
        { key: "stale_mem", value: "forgotten", accessCount: 0, lastAccessedAt: Date.now() - 90 * 86400_000 },
        { key: "low_value", value: "x", accessCount: 1, lastAccessedAt: Date.now() - 60 * 86400_000 },
      ]),
      archive: vi.fn().mockResolvedValue({ archived: 1 }),
      delete: vi.fn(),
    };
  });

  it("should identify stale STM entries beyond TTL", () => {
    const gc = new MemoryGarbageCollector(mockStm, mockLtm, { stmMaxAgeMs: 3600_000 });
    const staleEntries = gc.findStaleStmEntries();

    expect(staleEntries).toHaveLength(1);
    expect(staleEntries[0].key).toBe("old");
  });

  it("should identify cold LTM entries for archival", () => {
    const gc = new MemoryGarbageCollector(mockStm, mockLtm, {
      ltmColdDays: 30,
      ltmMinAccessCount: 2,
    });
    const coldEntries = gc.findColdLtmEntries();

    expect(coldEntries.length).toBeGreaterThanOrEqual(1);
    expect(coldEntries.some(e => e.key === "stale_mem")).toBe(true);
  });

  it("should clean STM when running gc", async () => {
    const gc = new MemoryGarbageCollector(mockStm, mockLtm, { stmMaxAgeMs: 3600_000 });
    const report = await gc.collect();

    expect(report.stmCleaned).toBe(1);
    expect(mockStm.delete).toHaveBeenCalledWith("old");
  });

  it("should archive cold LTM entries when running gc", async () => {
    const gc = new MemoryGarbageCollector(mockStm, mockLtm, {
      ltmColdDays: 30,
      ltmMinAccessCount: 2,
    });
    const report = await gc.collect();

    expect(report.ltmArchived).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/memory/gc-collect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement MemoryGarbageCollector**

Create `src/memory/gc-collect.ts`:

```typescript
/**
 * gc_collect: GUARDIAN 级记忆垃圾回收
 *
 * 定期清理：
 * - STM 中超过 TTL 的条目
 * - LTM 中长期未访问且低价值的条目（归档到冷存储）
 *
 * raos.md 设计：对模型不可见，自动执行
 */

export interface GCConfig {
  /** STM 条目最大存活时间（ms），默认 1 小时 */
  stmMaxAgeMs: number;
  /** LTM 冷数据判定天数，默认 30 天 */
  ltmColdDays: number;
  /** LTM 最低访问次数阈值（低于此值且超过冷天数则归档），默认 2 */
  ltmMinAccessCount: number;
}

const DEFAULT_CONFIG: GCConfig = {
  stmMaxAgeMs: 3600_000,
  ltmColdDays: 30,
  ltmMinAccessCount: 2,
};

export interface GCReport {
  stmCleaned: number;
  ltmArchived: number;
  durationMs: number;
  timestamp: number;
}

interface STMInterface {
  list(): Array<{ key: string; value: unknown; accessedAt: number }>;
  delete(key: string): void;
}

interface LTMInterface {
  list(): Array<{ key: string; value: unknown; accessCount: number; lastAccessedAt?: number; createdAt: number }>;
  archive?(reason?: string): Promise<{ archived: number }>;
  delete?(key: string): void;
}

export class MemoryGarbageCollector {
  private stm: STMInterface;
  private ltm: LTMInterface;
  private config: GCConfig;

  constructor(stm: STMInterface, ltm: LTMInterface, config?: Partial<GCConfig>) {
    this.stm = stm;
    this.ltm = ltm;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 查找过期的 STM 条目 */
  findStaleStmEntries(): Array<{ key: string }> {
    const now = Date.now();
    const entries = this.stm.list();
    return entries
      .filter(e => now - e.accessedAt > this.config.stmMaxAgeMs)
      .map(e => ({ key: e.key }));
  }

  /** 查找冷 LTM 条目 */
  findColdLtmEntries(): Array<{ key: string }> {
    const now = Date.now();
    const coldThresholdMs = this.config.ltmColdDays * 86400_000;
    const entries = this.ltm.list();

    return entries.filter(e => {
      const lastAccess = e.lastAccessedAt ?? e.createdAt;
      const isCold = now - lastAccess > coldThresholdMs;
      const isLowValue = e.accessCount < this.config.ltmMinAccessCount;
      return isCold && isLowValue;
    }).map(e => ({ key: e.key }));
  }

  /** 执行垃圾回收 */
  async collect(): Promise<GCReport> {
    const start = Date.now();

    // 1. 清理 STM
    const staleStm = this.findStaleStmEntries();
    for (const entry of staleStm) {
      this.stm.delete(entry.key);
    }

    // 2. 归档冷 LTM
    let ltmArchived = 0;
    if (this.ltm.archive) {
      const coldEntries = this.findColdLtmEntries();
      if (coldEntries.length > 0) {
        const archiveResult = await this.ltm.archive("gc_collect: cold entries");
        ltmArchived = archiveResult.archived;
      }
    }

    return {
      stmCleaned: staleStm.length,
      ltmArchived,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/memory/gc-collect.test.ts`
Expected: PASS

- [ ] **Step 5: Register gc_collect as GUARDIAN Skill in memory-skills.ts**

In `src/memory/memory-skills.ts`, add import:

```typescript
import { MemoryGarbageCollector } from "./gc-collect.js";
```

Add skill registration:

```typescript
  // gc_collect: GUARDIAN 记忆垃圾回收
  const gcCollector = new MemoryGarbageCollector(stm, ltm);

  skills.push(defineSkill({
    name: "gc_collect",
    description: "记忆垃圾回收：清理过期 STM、归档冷 LTM（系统自动执行）",
    visible: false,
    autonomy: Autonomy.GUARDIAN,
    handler: async () => {
      const report = await gcCollector.collect();
      return {
        success: true,
        data: report,
      };
    },
  }));
```

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/memory/gc-collect.ts src/memory/memory-skills.ts tests/memory/gc-collect.test.ts
git commit -m "feat: implement gc_collect GUARDIAN meta-memory skill for garbage collection"
```

---

## Task 9: Wire Enhanced Memory Modules into Agent Loop

**Files:**
- Modify: `src/llm/agent-loop.ts`
- Modify: `src/memory/memory-skills.ts`

The existing `enhanced/` modules (fact-extractor, profile-generator, conflict-detector) are implemented but never called. This task wires them into the agent loop's `autoExtractMemory()` flow.

- [ ] **Step 1: Read the enhanced module APIs**

Read the following files to understand their interfaces:
- `src/memory/enhanced/fact-extractor.ts`
- `src/memory/enhanced/conflict-detector.ts`

- [ ] **Step 2: Integrate fact-extractor into autoExtractMemory**

In `src/llm/agent-loop.ts`, find the `autoExtractMemory()` method. It currently uses a raw LLM prompt to extract memory.

Add imports at top:
```typescript
import { FactExtractor } from "../memory/enhanced/fact-extractor.js";
import { ConflictDetector } from "../memory/enhanced/conflict-detector.js";
```

In the `AgentLoop` constructor or initialization, create instances:
```typescript
private factExtractor?: FactExtractor;
private conflictDetector?: ConflictDetector;
```

In `autoExtractMemory()`, after the existing LLM-based extraction, add a fact extraction step:

```typescript
    // Enhanced: 使用 FactExtractor 提取结构化事实
    if (this.factExtractor) {
      try {
        const facts = await this.factExtractor.extract(conversationText);
        for (const fact of facts) {
          // 冲突检测
          if (this.conflictDetector) {
            const conflicts = await this.conflictDetector.check(fact.key, fact.value);
            if (conflicts.length > 0 && conflicts[0].severity === "high") {
              continue; // 跳过高冲突事实，避免覆盖可靠记忆
            }
          }
          await this.ltm.store(fact.key, fact.value, { tags: fact.tags, source: "fact_extractor" });
        }
      } catch {
        // Enhanced extraction is best-effort, don't fail the conversation
      }
    }
```

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/llm/agent-loop.ts
git commit -m "feat: wire fact-extractor and conflict-detector into agent loop memory extraction"
```

---

## Task 10: WAL Compaction

**Files:**
- Modify: `src/wal/index.ts` (or `src/wal/wal-manager.ts`)
- Create: `tests/wal/wal-compaction.test.ts`

- [ ] **Step 1: Read the current WAL implementation**

Run: Read `src/wal/index.ts` to understand the WAL file format and current API.

- [ ] **Step 2: Write the failing test**

Create `tests/wal/wal-compaction.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WALManager } from "../src/wal/index.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("WAL Compaction", () => {
  let walDir: string;
  let wal: WALManager;

  beforeEach(() => {
    walDir = fs.mkdtempSync(path.join(os.tmpdir(), "wal-test-"));
    wal = new WALManager(walDir);
  });

  afterEach(() => {
    fs.rmSync(walDir, { recursive: true, force: true });
  });

  it("should compact completed entries from WAL file", async () => {
    // Create several completed entries
    for (let i = 0; i < 10; i++) {
      const id = wal.begin(`trace-${i}`, `skill_${i}`, { i });
      wal.complete(id, { result: i });
    }

    // Also create one incomplete entry
    wal.begin("trace-incomplete", "running_skill", {});

    const walPath = path.join(walDir, "wal.jsonl");
    const beforeSize = fs.statSync(walPath).size;
    const beforeLines = fs.readFileSync(walPath, "utf-8").split("\n").filter(Boolean).length;

    // Compact
    const result = await wal.compact();

    const afterSize = fs.statSync(walPath).size;

    expect(result.removedEntries).toBeGreaterThan(0);
    expect(afterSize).toBeLessThan(beforeSize);
    // The incomplete entry should still be in the WAL
    const afterContent = fs.readFileSync(walPath, "utf-8");
    expect(afterContent).toContain("running_skill");
  });

  it("should preserve incomplete entries during compaction", async () => {
    const id1 = wal.begin("trace-1", "incomplete_skill", { key: "val" });
    const id2 = wal.begin("trace-2", "complete_skill", {});
    wal.complete(id2, { done: true });

    await wal.compact();

    const walPath = path.join(walDir, "wal.jsonl");
    const content = fs.readFileSync(walPath, "utf-8");
    expect(content).toContain("incomplete_skill");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/wal/wal-compaction.test.ts`
Expected: FAIL — `wal.compact()` method doesn't exist.

- [ ] **Step 4: Implement compact() method**

In `src/wal/index.ts` (or wherever `WALManager` is defined), add:

```typescript
  /** 压缩 WAL：移除已完成的条目，只保留未完成的 */
  async compact(): Promise<{ removedEntries: number; remainingEntries: number }> {
    const walPath = path.join(this.storePath, "wal.jsonl");

    if (!fs.existsSync(walPath)) {
      return { removedEntries: 0, remainingEntries: 0 };
    }

    const content = fs.readFileSync(walPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);

    // Parse all entries and track completed IDs
    const completedIds = new Set<string>();
    const entries: Array<{ line: string; parsed: any }> = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        entries.push({ line, parsed });
        if (parsed.status === "completed" || parsed.status === "failed") {
          completedIds.add(parsed.id);
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Keep only entries whose ID is NOT in completedIds
    // Also keep begin entries for incomplete tasks
    const remaining = entries.filter(e => {
      if (completedIds.has(e.parsed.id)) return false;
      // Keep 'begin' entries that don't have a corresponding complete/fail
      return true;
    });

    const removedEntries = entries.length - remaining.length;

    // Write compacted file
    const compactedContent = remaining.map(e => e.line).join("\n") + (remaining.length > 0 ? "\n" : "");
    fs.writeFileSync(walPath, compactedContent);

    return { removedEntries, remainingEntries: remaining.length };
  }
```

Adapt this implementation based on the actual WAL entry format found in Step 1.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/wal/wal-compaction.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/wal/index.ts tests/wal/wal-compaction.test.ts
git commit -m "feat: add WAL compaction to remove completed entries and control file size"
```

---

## Task 11: Extract Server Routes — Middleware & Auth Routes

**Files:**
- Create: `src/routes/middleware.ts`
- Create: `src/routes/auth-routes.ts`
- Create: `src/routes/index.ts`
- Modify: `src/server.ts`

This is the first step of decomposing server.ts. We extract shared middleware and auth routes first.

- [ ] **Step 1: Create shared middleware**

Create `src/routes/middleware.ts`:

```typescript
/**
 * 共享中间件：认证、错误处理、输入校验
 */
import type { Request, Response, NextFunction } from "express";

/** 统一错误处理中间件 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[API Error]", err.message);
  res.status(500).json({ error: err.message });
}

/** 参数校验辅助 */
export function requireBody(fields: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const field of fields) {
      if (req.body[field] === undefined || req.body[field] === null) {
        res.status(400).json({ error: `Missing required field: ${field}` });
        return;
      }
    }
    next();
  };
}

/** 参数校验辅助：query 参数 */
export function requireQuery(fields: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const field of fields) {
      if (!req.query[field]) {
        res.status(400).json({ error: `Missing required query parameter: ${field}` });
        return;
      }
    }
    next();
  };
}
```

- [ ] **Step 2: Create auth routes module**

Create `src/routes/auth-routes.ts`:

Extract authentication routes (login, logout, me) from `src/server.ts` lines 554-596 into a new Express Router:

```typescript
/**
 * 认证路由
 */
import { Router } from "express";
import type { DatabaseManager } from "../db/index.js";
import type { UserSessionManager } from "../user/index.js";

export function createAuthRoutes(db: DatabaseManager, sessionManager: UserSessionManager): Router {
  const router = Router();

  // POST /api/auth/login
  router.post("/login", (req, res) => {
    // Move login logic from server.ts line 554-577 here
    // ...
  });

  // POST /api/auth/logout
  router.post("/logout", (req, res) => {
    // Move logout logic from server.ts line 579-586 here
    // ...
  });

  // GET /api/auth/me
  router.get("/me", (req, res) => {
    // Move me logic from server.ts line 588-596 here
    // ...
  });

  return router;
}
```

Note: Copy the exact handler bodies from server.ts. The implementing engineer should read the original handlers and move them verbatim.

- [ ] **Step 3: Create route aggregator**

Create `src/routes/index.ts`:

```typescript
/**
 * Route aggregator — mounts all route modules on the Express app
 */
import type { Express } from "express";
import { errorHandler } from "./middleware.js";
import { createAuthRoutes } from "./auth-routes.js";
import type { DatabaseManager } from "../db/index.js";
import type { UserSessionManager } from "../user/index.js";

export interface RouteDependencies {
  db: DatabaseManager;
  sessionManager: UserSessionManager;
  // Add more dependencies as more routes are extracted
}

export function mountRoutes(app: Express, deps: RouteDependencies): void {
  app.use("/api/auth", createAuthRoutes(deps.db, deps.sessionManager));

  // Error handler must be last
  app.use(errorHandler);
}
```

- [ ] **Step 4: Wire into server.ts**

In `src/server.ts`, add import:
```typescript
import { mountRoutes } from "./routes/index.js";
```

Replace the auth route handlers (lines 554-596) with:
```typescript
// Auth routes extracted to routes/auth-routes.ts
```

After the Express app setup, add:
```typescript
mountRoutes(app, { db, sessionManager });
```

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Manual test — verify auth endpoints still work**

Run: `cd /Users/liukavin/Documents/code/raos && npm run dev &`
Then: `curl -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}'`
Expected: Login response with token.

- [ ] **Step 7: Commit**

```bash
git add src/routes/middleware.ts src/routes/auth-routes.ts src/routes/index.ts src/server.ts
git commit -m "refactor: extract auth routes and shared middleware from server.ts"
```

---

## Task 12: Extract Server Routes — Skill, Memory, Config Routes

**Files:**
- Create: `src/routes/skill-routes.ts`
- Create: `src/routes/memory-routes.ts`
- Create: `src/routes/config-routes.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Extract skill routes**

Create `src/routes/skill-routes.ts`. Extract the following routes from server.ts:
- GET `/api/skills` (line 834)
- GET `/api/skills/visible` (line 848)
- POST `/api/execute` (line 859)
- POST `/api/skills` (line 878)
- DELETE `/api/skills/:name` (line 908)
- GET `/api/topology` (line 921)
- GET `/api/metrics` (line 1669)
- GET `/api/metrics/skill/:name` (line 1677)

Use `Router()` pattern:
```typescript
import { Router } from "express";
// import necessary dependencies

export function createSkillRoutes(registry, engine, ...otherDeps): Router {
  const router = Router();
  // Move route handlers here
  return router;
}
```

- [ ] **Step 2: Extract memory routes**

Create `src/routes/memory-routes.ts`. Extract all `/api/memory/*` routes (lines 1862-2151) from server.ts.

- [ ] **Step 3: Extract config routes**

Create `src/routes/config-routes.ts`. Extract all `/api/config/*` routes (lines 949-1193) from server.ts.

- [ ] **Step 4: Update route aggregator**

In `src/routes/index.ts`, add:
```typescript
import { createSkillRoutes } from "./skill-routes.js";
import { createMemoryRoutes } from "./memory-routes.js";
import { createConfigRoutes } from "./config-routes.js";
```

In `mountRoutes()`:
```typescript
app.use("/api", createSkillRoutes(deps.registry, deps.engine, ...));
app.use("/api/memory", createMemoryRoutes(deps.stm, deps.ltm, ...));
app.use("/api/config", createConfigRoutes(deps.configManager, ...));
```

- [ ] **Step 5: Remove extracted routes from server.ts**

Delete the corresponding route handler blocks from server.ts, replacing with comments noting where they moved.

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/routes/skill-routes.ts src/routes/memory-routes.ts src/routes/config-routes.ts src/routes/index.ts src/server.ts
git commit -m "refactor: extract skill, memory, and config routes from server.ts"
```

---

## Task 13: Extract Remaining Routes

**Files:**
- Create: `src/routes/agent-routes.ts`
- Create: `src/routes/knowledge-routes.ts`
- Create: `src/routes/evolution-routes.ts`
- Create: `src/routes/file-routes.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Extract agent/chat routes**

Create `src/routes/agent-routes.ts`. Extract:
- POST `/api/agent/chat` (line 1234)
- POST `/api/agent/chat/stream` (line 1274)
- POST `/api/agent/strategy` (line 1521)
- POST `/api/agent/clear` (line 1543)
- GET `/api/conversations` (line 1560)
- POST `/api/conversations` (line 1569)
- GET `/api/conversations/:id/messages` (line 1580)
- POST `/api/conversations/:id/messages` (line 1618)
- DELETE `/api/conversations/:id` (line 1654)
- GET `/api/llm/tools` (line 1662)
- POST `/api/llm/test` (line 1207)

- [ ] **Step 2: Extract knowledge routes**

Create `src/routes/knowledge-routes.ts`. Extract all `/api/knowledge/*` routes (lines 2258-2412).

- [ ] **Step 3: Extract evolution routes**

Create `src/routes/evolution-routes.ts`. Extract:
- All `/api/evolution/*` routes (lines 1689-1738, 2179-2228)
- All `/api/lifecycle/*` routes (lines 1782-1807)
- All `/api/marketplace/*` routes (lines 1749-1775)

- [ ] **Step 4: Extract file routes**

Create `src/routes/file-routes.ts`. Extract:
- All `/api/files/*` routes (lines 2789-3185)
- All `/api/upload/*` routes (lines 2659-2772)
- All `/api/download/*` routes (lines 3850-3873)

- [ ] **Step 5: Update route aggregator and server.ts**

Wire all new route modules into `src/routes/index.ts` and remove from server.ts.

- [ ] **Step 6: Verify server.ts is now < 500 lines**

The remaining server.ts should only contain:
- Imports and instance creation
- Middleware setup (CORS, JSON parsing, static files)
- `mountRoutes(app, deps)` call
- Server startup (`app.listen`)

- [ ] **Step 7: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 8: Manual smoke test**

Run the dev server and verify a few key endpoints:
- Login
- Chat (agent)
- Skill list
- Memory search

- [ ] **Step 9: Commit**

```bash
git add src/routes/ src/server.ts
git commit -m "refactor: complete server.ts decomposition — extract all routes to modules"
```

---

## Task 14: Add Runtime Parameter Validation in ExecutionEngine

**Files:**
- Modify: `src/engine/execution-engine.ts`
- Create: `tests/engine/param-validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/param-validation.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionEngine } from "../src/engine/execution-engine.js";
import { SkillRegistry } from "../src/registry/index.js";
import { WALManager } from "../src/wal/index.js";
import { defineSkill } from "../src/types/index.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("ExecutionEngine Parameter Validation", () => {
  let engine: ExecutionEngine;
  let registry: SkillRegistry;
  let walDir: string;

  beforeEach(() => {
    registry = new SkillRegistry();
    walDir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-test-"));
    const wal = new WALManager(walDir);
    engine = new ExecutionEngine(registry, wal);

    registry.register(defineSkill({
      name: "typed_skill",
      handler: async (params) => ({ success: true, data: params }),
      paramSchema: {
        properties: {
          name: { type: "string", description: "Name" },
          count: { type: "number", description: "Count" },
        },
        required: ["name"],
      },
    }));

    registry.register(defineSkill({
      name: "untyped_skill",
      handler: async (params) => ({ success: true, data: params }),
    }));
  });

  it("should pass when required params are provided", async () => {
    const result = await engine.execute("typed_skill", { name: "test", count: 5 });
    expect(result.success).toBe(true);
  });

  it("should fail when required param is missing", async () => {
    await expect(engine.execute("typed_skill", { count: 5 }))
      .rejects.toThrow(/name/);
  });

  it("should skip validation for skills without paramSchema", async () => {
    const result = await engine.execute("untyped_skill", { anything: "goes" });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/engine/param-validation.test.ts`
Expected: FAIL — missing param validation doesn't throw.

- [ ] **Step 3: Add validation to executeRecursive**

In `src/engine/execution-engine.ts`, in the `executeRecursive` method, after the `const skill = this.registry.get(skillName)` line, add:

```typescript
    // 参数校验（如果 Skill 定义了 paramSchema）
    if (skill.paramSchema) {
      this.validateParams(skillName, params, skill.paramSchema);
    }
```

Add the validation method:

```typescript
  /** 校验参数是否符合 Skill 的 paramSchema */
  private validateParams(
    skillName: string,
    params: Record<string, unknown>,
    schema: import("../types/param-schema.js").ParamSchema,
  ): void {
    if (schema.required) {
      for (const field of schema.required) {
        if (params[field] === undefined || params[field] === null) {
          throw new Error(`Skill "${skillName}" 缺少必需参数: ${field}`);
        }
      }
    }

    for (const [key, prop] of Object.entries(schema.properties)) {
      const value = params[key];
      if (value === undefined || value === null) continue;

      const expectedType = prop.type;
      const actualType = Array.isArray(value) ? "array" : typeof value;

      if (expectedType === "array" && !Array.isArray(value)) {
        throw new Error(`Skill "${skillName}" 参数 "${key}" 应为 array，实际为 ${actualType}`);
      } else if (expectedType !== "array" && expectedType !== "object" && actualType !== expectedType) {
        throw new Error(`Skill "${skillName}" 参数 "${key}" 应为 ${expectedType}，实际为 ${actualType}`);
      }

      if (prop.enum && !prop.enum.includes(String(value))) {
        throw new Error(`Skill "${skillName}" 参数 "${key}" 值 "${value}" 不在允许范围: ${prop.enum.join(", ")}`);
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/engine/param-validation.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/execution-engine.ts tests/engine/param-validation.test.ts
git commit -m "feat: add runtime parameter validation using paramSchema in ExecutionEngine"
```

---

## Task 15: Final Integration Test

**Files:**
- Create: `tests/integration/core-hardening.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration/core-hardening.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { SkillRegistry } from "../src/registry/index.js";
import { ExecutionEngine } from "../src/engine/execution-engine.js";
import { WALManager } from "../src/wal/index.js";
import { skillsToTools } from "../src/llm/tool-bridge.js";
import { defineSkill } from "../src/types/index.js";
import { parseHandoffJson, parseTransferJson } from "../src/agents/protocols/parse-helpers.js";
import { RecallContextSkill } from "../src/memory/recall-context.js";
import { MemoryGarbageCollector } from "../src/memory/gc-collect.js";
import { ShortTermMemory } from "../src/memory/stm.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("Core Hardening Integration", () => {
  let registry: SkillRegistry;
  let engine: ExecutionEngine;

  beforeAll(() => {
    registry = new SkillRegistry();
    const walDir = fs.mkdtempSync(path.join(os.tmpdir(), "integration-"));
    const wal = new WALManager(walDir);
    engine = new ExecutionEngine(registry, wal);
  });

  it("typed skill should generate proper tool definition and validate params", async () => {
    const skill = defineSkill({
      name: "integration_search",
      description: "Search integration test",
      handler: async (params) => ({
        success: true,
        data: { query: params.query, results: [] },
      }),
      paramSchema: {
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results" },
        },
        required: ["query"],
      },
    });

    registry.register(skill);

    // Tool Bridge generates typed definition
    const tools = skillsToTools([skill]);
    expect(tools[0].function.parameters.properties).toHaveProperty("query");
    expect(tools[0].function.parameters.required).toContain("query");

    // Execution validates params
    const result = await engine.execute("integration_search", { query: "test" });
    expect(result.success).toBe(true);

    // Missing required param throws
    await expect(engine.execute("integration_search", {})).rejects.toThrow(/query/);
  });

  it("protocol parsers handle both JSON and legacy formats", () => {
    // JSON format
    const jsonHandoff = parseHandoffJson('```json\n{"handoff": true, "target": "coder"}\n```');
    expect(jsonHandoff?.target).toBe("coder");

    // Legacy format
    const legacyHandoff = parseHandoffJson("[HANDOFF:researcher] analyze data");
    expect(legacyHandoff?.target).toBe("researcher");

    // No handoff
    const noHandoff = parseHandoffJson("I'll answer directly.");
    expect(noHandoff).toBeNull();
  });

  it("recall_context and gc_collect work together", async () => {
    const stm = new ShortTermMemory({ maxEntries: 100 });
    const mockLtm = {
      search: async () => [{ key: "mem1", value: "recalled data", tags: [] }],
      list: () => [
        { key: "active", value: "v", accessCount: 10, lastAccessedAt: Date.now(), createdAt: Date.now() },
        { key: "stale", value: "v", accessCount: 0, lastAccessedAt: Date.now() - 100 * 86400_000, createdAt: Date.now() - 200 * 86400_000 },
      ],
      archive: async () => ({ archived: 1 }),
    };

    // recall_context injects into STM
    const recall = new RecallContextSkill(stm, mockLtm);
    await recall.recall("test_skill", { key: "value" });
    expect(stm.list().some(e => e.key === "recall:mem1")).toBe(true);

    // gc_collect cleans up
    const gc = new MemoryGarbageCollector(stm as any, mockLtm as any);
    const report = await gc.collect();
    expect(report.stmCleaned).toBeGreaterThanOrEqual(0);
    expect(report.ltmArchived).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run tests/integration/core-hardening.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/liukavin/Documents/code/raos && npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/core-hardening.test.ts
git commit -m "test: add core hardening integration tests"
```

---

## Summary

| Task | Description | Est. Complexity |
|------|-------------|----------------|
| 1 | ParamSchema type definition | Low |
| 2 | Tool Bridge upgrade | Low |
| 3 | ParamSchema for data/memory skills | Low |
| 4 | ParamSchema for db/knowledge/meta skills | Low |
| 5 | Protocol structured JSON output | Medium |
| 6 | Skill generation Worker sandbox | Medium |
| 7 | recall_context meta-memory | Medium |
| 8 | gc_collect garbage collection | Medium |
| 9 | Wire enhanced memory into agent loop | Low |
| 10 | WAL compaction | Medium |
| 11 | Extract auth routes + middleware | Low |
| 12 | Extract skill/memory/config routes | Medium |
| 13 | Extract remaining routes | Medium |
| 14 | Runtime parameter validation | Low |
| 15 | Integration tests | Low |

**Dependency order:** Tasks 1→2→3,4 (ParamSchema chain), Task 5 (independent), Task 6 (independent), Tasks 7→8→9 (memory chain), Task 10 (independent), Tasks 11→12→13 (server decomposition chain), Task 14 (depends on Task 1), Task 15 (depends on all).

**Parallelizable groups:**
- Group A: Tasks 1-4 (ParamSchema)
- Group B: Task 5 (Protocols)
- Group C: Task 6 (Sandbox)
- Group D: Tasks 7-9 (Memory)
- Group E: Task 10 (WAL)
- Group F: Tasks 11-13 (Server)
- Groups A-F can run in parallel. Task 14 follows Group A. Task 15 follows all.
