import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  generateWorkflow,
  __test__,
} from "../../src/workflow/workflow-llm-generator.js";
import { SQLiteWorkflowRepository, setWorkflowRepository, resetWorkflowRepository } from "../../src/workflow/repository.js";
import type { LLMProvider } from "../../src/llm/types.js";

function createMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE workflow_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL DEFAULT 1,
      category TEXT,
      definition TEXT NOT NULL,
      form_schema TEXT,
      created_by TEXT,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE workflow_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      definition_id INTEGER NOT NULL,
      definition_version INTEGER NOT NULL DEFAULT 1,
      business_key TEXT,
      starter TEXT,
      status TEXT NOT NULL,
      current_node_id TEXT,
      variables TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE workflow_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      node_name TEXT,
      task_type TEXT NOT NULL,
      assignee TEXT,
      candidate_users TEXT,
      candidate_groups TEXT,
      status TEXT NOT NULL,
      form_data TEXT,
      comment TEXT,
      action TEXT,
      due_date INTEGER,
      created_at INTEGER NOT NULL,
      claimed_at INTEGER,
      completed_at INTEGER
    );
    CREATE TABLE workflow_variables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      type TEXT,
      UNIQUE(instance_id, name)
    );
  `);
  return db;
}

function createMockProvider(content: string): LLMProvider {
  return {
    name: "mock",
    model: "mock-model",
    async chat() {
      return {
        content,
        toolCalls: [],
        finishReason: "stop" as const,
      };
    },
  };
}

function createFailingProvider(error: string): LLMProvider {
  return {
    name: "mock",
    model: "mock-model",
    async chat() {
      return {
        content: error,
        toolCalls: [],
        finishReason: "error" as const,
      };
    },
  };
}

describe("WorkflowLLMGenerator", () => {
  let db: Database.Database;
  let repo: SQLiteWorkflowRepository;

  beforeEach(async () => {
    db = createMemoryDb();
    repo = new SQLiteWorkflowRepository(db);
    setWorkflowRepository(repo);
  });

  afterEach(() => {
    resetWorkflowRepository();
    db.close();
  });

  describe("extractJson", () => {
    it("extracts JSON from markdown code block", () => {
      const text = 'Some text\n\n```json\n{"key": "value"}\n```\nMore text';
      expect(__test__.extractJson(text)).toBe('{"key": "value"}');
    });

    it("extracts JSON from plain code block", () => {
      const text = '```\n{"key": "value"}\n```';
      expect(__test__.extractJson(text)).toBe('{"key": "value"}');
    });

    it("returns raw JSON if no code block", () => {
      const text = '{"key": "value"}';
      expect(__test__.extractJson(text)).toBe('{"key": "value"}');
    });

    it("returns null for non-JSON text", () => {
      expect(__test__.extractJson("just some text")).toBeNull();
    });
  });

  describe("validateWorkflowJson", () => {
    it("validates a correct workflow", () => {
      const wf = {
        key: "test_flow",
        name: "测试流程",
        nodes: [
          { id: "start", type: "start_event", next: "task1" },
          { id: "task1", type: "user_task", name: "任务1", next: "end" },
          { id: "end", type: "end_event" },
        ],
        formSchema: {
          fields: [{ key: "reason", label: "原因", type: "text", required: true }],
        },
      };
      expect(__test__.validateWorkflowJson(wf)).toEqual({ valid: true });
    });

    it("fails when missing start_event", () => {
      const wf = {
        key: "test",
        name: "测试",
        nodes: [
          { id: "task1", type: "user_task", name: "任务1", next: "end" },
          { id: "end", type: "end_event" },
        ],
      };
      const result = __test__.validateWorkflowJson(wf);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("start_event");
    });

    it("fails when missing end_event", () => {
      const wf = {
        key: "test",
        name: "测试",
        nodes: [
          { id: "start", type: "start_event", next: "task1" },
          { id: "task1", type: "user_task", name: "任务1" },
        ],
      };
      const result = __test__.validateWorkflowJson(wf);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("end_event");
    });

    it("fails when next references non-existent node", () => {
      const wf = {
        key: "test",
        name: "测试",
        nodes: [
          { id: "start", type: "start_event", next: "missing" },
          { id: "end", type: "end_event" },
        ],
      };
      const result = __test__.validateWorkflowJson(wf);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("missing");
    });

    it("fails when duplicate node ids", () => {
      const wf = {
        key: "test",
        name: "测试",
        nodes: [
          { id: "start", type: "start_event", next: "end" },
          { id: "start", type: "end_event" },
        ],
      };
      const result = __test__.validateWorkflowJson(wf);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("重复");
    });

    it("fails when form field has invalid type", () => {
      const wf = {
        key: "test",
        name: "测试",
        nodes: [
          { id: "start", type: "start_event", next: "end" },
          { id: "end", type: "end_event" },
        ],
        formSchema: {
          fields: [{ key: "f1", label: "字段", type: "invalid_type" }],
        },
      };
      const result = __test__.validateWorkflowJson(wf);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("无效的类型");
    });
  });

  describe("generateWorkflow", () => {
    it("returns error when provider is null", async () => {
      const result = await generateWorkflow(
        { description: "test", name: "测试", key: "test" },
        () => null,
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("未配置");
    });

    it("creates a new workflow from LLM output", async () => {
      const llmOutput = JSON.stringify({
        key: "contract_approval",
        name: "合同审批",
        category: "legal",
        nodes: [
          { id: "start", type: "start_event", next: "fill_form" },
          { id: "fill_form", type: "user_task", name: "填写合同申请", next: "manager_approval" },
          { id: "manager_approval", type: "user_task", name: "经理审批", actions: ["approve", "reject"], next: "end" },
          { id: "end", type: "end_event" },
        ],
        formSchema: {
          fields: [
            { key: "contract_name", label: "合同名称", type: "text", required: true },
            { key: "amount", label: "合同金额", type: "number", required: true },
          ],
        },
      });

      const result = await generateWorkflow(
        { description: "合同审批流程", name: "合同审批", key: "contract_approval", category: "legal" },
        () => createMockProvider(llmOutput),
      );

      expect(result.success).toBe(true);
      expect(result.definition).toBeDefined();
      expect(result.definition!.key).toBe("contract_approval");
      expect(result.definition!.name).toBe("合同审批");
      expect(result.definition!.definition.nodes).toHaveLength(4);
      expect(result.definition!.formSchema).toBeDefined();
      expect(result.definition!.formSchema!.fields).toHaveLength(2);
    });

    it("updates existing workflow when key exists", async () => {
      // 先创建现有流程
      await repo.createDefinition({
        name: "旧合同审批",
        key: "contract_approval",
        version: 1,
        category: "general",
        definition: {
          key: "contract_approval",
          name: "旧合同审批",
          nodes: [
            { id: "start", type: "start_event", next: "end" },
            { id: "end", type: "end_event" },
          ],
        },
        createdBy: "test",
      });

      const llmOutput = JSON.stringify({
        key: "contract_approval",
        name: "合同审批（新版）",
        category: "legal",
        nodes: [
          { id: "start", type: "start_event", next: "fill_form" },
          { id: "fill_form", type: "user_task", name: "填写合同申请", next: "end" },
          { id: "end", type: "end_event" },
        ],
        formSchema: {
          fields: [{ key: "name", label: "名称", type: "text", required: true }],
        },
      });

      const result = await generateWorkflow(
        { description: "更新合同审批流程", name: "合同审批（新版）", key: "contract_approval" },
        () => createMockProvider(llmOutput),
      );

      expect(result.success).toBe(true);
      expect(result.definition!.name).toBe("合同审批（新版）");
      expect(result.definition!.version).toBe(1); // version 不变
      expect(result.definition!.definition.nodes).toHaveLength(3);
    });

    it("modifies workflow based on existingKey", async () => {
      // 先创建现有流程
      await repo.createDefinition({
        name: "请假审批",
        key: "leave_approval_v2",
        version: 1,
        category: "hr",
        definition: {
          key: "leave_approval_v2",
          name: "请假审批",
          nodes: [
            { id: "start", type: "start_event", next: "fill_form" },
            { id: "fill_form", type: "user_task", name: "填写请假单", next: "end" },
            { id: "end", type: "end_event" },
          ],
        },
        formSchema: {
          fields: [{ key: "days", label: "天数", type: "number", required: true }],
        },
        createdBy: "test",
      });

      const llmOutput = JSON.stringify({
        key: "leave_approval_v2",
        name: "请假审批（增强版）",
        category: "hr",
        nodes: [
          { id: "start", type: "start_event", next: "fill_form" },
          { id: "fill_form", type: "user_task", name: "填写请假单", next: "manager_approval" },
          { id: "manager_approval", type: "user_task", name: "经理审批", actions: ["approve", "reject"], next: "end" },
          { id: "end", type: "end_event" },
        ],
        formSchema: {
          fields: [
            { key: "days", label: "天数", type: "number", required: true },
            { key: "reason", label: "原因", type: "textarea", required: true },
          ],
        },
      });

      const result = await generateWorkflow(
        { description: "增加经理审批环节和原因字段", name: "请假审批（增强版）", key: "leave_approval_v2", existingKey: "leave_approval_v2" },
        () => createMockProvider(llmOutput),
      );

      expect(result.success).toBe(true);
      expect(result.definition!.name).toBe("请假审批（增强版）");
      expect(result.definition!.definition.nodes).toHaveLength(4);
      expect(result.definition!.formSchema!.fields).toHaveLength(2);
    });

    it("returns error for invalid LLM output", async () => {
      const result = await generateWorkflow(
        { description: "test", name: "测试", key: "test" },
        () => createMockProvider("not json at all"),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("JSON");
    });

    it("returns error for structurally invalid workflow", async () => {
      const llmOutput = JSON.stringify({
        key: "bad_flow",
        name: "坏流程",
        nodes: [
          { id: "start", type: "start_event" }, // missing next
        ],
      });

      const result = await generateWorkflow(
        { description: "test", name: "测试", key: "bad_flow" },
        () => createMockProvider(llmOutput),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("end_event");
    });

    it("returns error when LLM fails", async () => {
      const result = await generateWorkflow(
        { description: "test", name: "测试", key: "test" },
        () => createFailingProvider("API rate limit"),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("生成失败");
    });

    it("returns error when existingKey not found", async () => {
      const result = await generateWorkflow(
        { description: "test", name: "测试", key: "test", existingKey: "non_existent" },
        () => createMockProvider("{}"),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("未找到");
    });
  });
});
