import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { validateWorkflowSpec } from "../../src/routes/workflow-definition-routes.js";
import { SQLiteWorkflowRepository, setWorkflowRepository, resetWorkflowRepository } from "../../src/workflow/repository.js";
import type { WorkflowSpec } from "../../src/workflow/types.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _testDb: Database.Database;

vi.mock("../../src/db/database.js", () => ({
// eslint-disable-next-line no-undef
  getDb: () => testDb,
}));

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
      sign_group TEXT,
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
    CREATE TABLE connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      credentials TEXT,
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
  `);
  return db;
}

describe("validateWorkflowSpec", () => {
  it("returns valid for a simple workflow", () => {
    const spec: WorkflowSpec = {
      key: "test",
      name: "Test",
      nodes: [
        { id: "start", type: "start_event", next: "end" },
        { id: "end", type: "end_event" },
      ],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("requires a start_event", () => {
    const spec: WorkflowSpec = {
      key: "test",
      name: "Test",
      nodes: [{ id: "end", type: "end_event" }],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Workflow must have a start_event");
  });

  it("requires at least one end_event", () => {
    const spec: WorkflowSpec = {
      key: "test",
      name: "Test",
      nodes: [{ id: "start", type: "start_event", next: "task1" }, { id: "task1", type: "user_task" }],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Workflow must have at least one end_event");
  });

  it("detects duplicate node ids", () => {
    const spec: WorkflowSpec = {
      key: "test",
      name: "Test",
      nodes: [
        { id: "start", type: "start_event", next: "start" },
        { id: "start", type: "end_event" },
      ],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  it("detects unknown next references", () => {
    const spec: WorkflowSpec = {
      key: "test",
      name: "Test",
      nodes: [
        { id: "start", type: "start_event", next: "missing" },
        { id: "end", type: "end_event" },
      ],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown next node"))).toBe(true);
  });

  it("detects unreachable nodes", () => {
    const spec: WorkflowSpec = {
      key: "test",
      name: "Test",
      nodes: [
        { id: "start", type: "start_event", next: "end" },
        { id: "end", type: "end_event" },
        { id: "orphan", type: "user_task" },
      ],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unreachable"))).toBe(true);
  });

  it("validates exclusive gateway conditions", () => {
    const spec: WorkflowSpec = {
      key: "test",
      name: "Test",
      nodes: [
        { id: "start", type: "start_event", next: "gw" },
        { id: "gw", type: "exclusive_gateway", conditions: [{ expression: "default", next: "end" }] },
        { id: "end", type: "end_event" },
      ],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(true);
  });

  it("detects exclusive gateway with empty conditions", () => {
    const spec: WorkflowSpec = {
      key: "test",
      name: "Test",
      nodes: [
        { id: "start", type: "start_event", next: "gw" },
        { id: "gw", type: "exclusive_gateway", conditions: [] },
        { id: "end", type: "end_event" },
      ],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("at least one condition"))).toBe(true);
  });

  it("detects unknown condition next references", () => {
    const spec: WorkflowSpec = {
      key: "test",
      name: "Test",
      nodes: [
        { id: "start", type: "start_event", next: "gw" },
        { id: "gw", type: "exclusive_gateway", conditions: [{ expression: "default", next: "missing" }] },
        { id: "end", type: "end_event" },
      ],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown node"))).toBe(true);
  });

  it("validates parallel gateway branches", () => {
    const spec: WorkflowSpec = {
      key: "test",
      name: "Test",
      nodes: [
        { id: "start", type: "start_event", next: "pg" },
        { id: "pg", type: "parallel_gateway", mode: "split", branches: ["b1", "b2"], next: "end" },
        { id: "b1", type: "user_task", next: "end" },
        { id: "b2", type: "user_task", next: "end" },
        { id: "end", type: "end_event" },
      ],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(true);
  });

  it("detects unknown parallel gateway branches", () => {
    const spec: WorkflowSpec = {
      key: "test",
      name: "Test",
      nodes: [
        { id: "start", type: "start_event", next: "pg" },
        { id: "pg", type: "parallel_gateway", mode: "split", branches: ["missing"], next: "end" },
        { id: "end", type: "end_event" },
      ],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown branch"))).toBe(true);
  });

  it("requires key and name", () => {
    const spec: WorkflowSpec = {
      key: "",
      name: "",
      nodes: [
        { id: "start", type: "start_event", next: "end" },
        { id: "end", type: "end_event" },
      ],
    };
    const result = validateWorkflowSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Workflow key is required");
    expect(result.errors).toContain("Workflow name is required");
  });
});

describe("WorkflowDefinition CRUD via Repository", () => {
  let db: Database.Database;
  let repo: SQLiteWorkflowRepository;

  beforeEach(() => {
    db = createMemoryDb();
    repo = new SQLiteWorkflowRepository(db);
    setWorkflowRepository(repo);
  });

  afterEach(() => {
    db.close();
    resetWorkflowRepository();
  });

  it("creates a definition", async () => {
    const def = await repo.createDefinition({
      name: "Leave Approval",
      key: "leave_approval",
      version: 1,
      definition: {
        key: "leave_approval",
        name: "Leave Approval",
        nodes: [
          { id: "start", type: "start_event", next: "end" },
          { id: "end", type: "end_event" },
        ],
      },
    });
    expect(def.id).toBeGreaterThan(0);
    expect(def.key).toBe("leave_approval");
    expect(def.name).toBe("Leave Approval");
  });

  it("gets definition by key", async () => {
    await repo.createDefinition({
      name: "Test",
      key: "test_key",
      version: 1,
      definition: { key: "test_key", name: "Test", nodes: [] },
    });
    const found = await repo.getDefinitionByKey("test_key");
    expect(found).toBeDefined();
    expect(found!.key).toBe("test_key");
  });

  it("lists definitions", async () => {
    await repo.createDefinition({
      name: "A",
      key: "a",
      version: 1,
      definition: { key: "a", name: "A", nodes: [] },
    });
    await repo.createDefinition({
      name: "B",
      key: "b",
      version: 1,
      definition: { key: "b", name: "B", nodes: [] },
    });
    const defs = await repo.listDefinitions();
    expect(defs.length).toBe(2);
  });

  it("updates a definition", async () => {
    const def = await repo.createDefinition({
      name: "Old",
      key: "update_test",
      version: 1,
      definition: { key: "update_test", name: "Old", nodes: [] },
    });
    await repo.updateDefinition(def.id, { name: "New", category: "updated" });
    const updated = await repo.getDefinitionByKey("update_test");
    expect(updated!.name).toBe("New");
    expect(updated!.category).toBe("updated");
  });

  it("deletes a definition", async () => {
    const def = await repo.createDefinition({
      name: "Delete",
      key: "delete_test",
      version: 1,
      definition: { key: "delete_test", name: "Delete", nodes: [] },
    });
    await repo.deleteDefinition(def.id);
    const found = await repo.getDefinitionByKey("delete_test");
    expect(found).toBeUndefined();
  });
});
