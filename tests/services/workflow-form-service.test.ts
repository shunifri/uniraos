import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

let testDb: Database.Database;

vi.mock("../../src/db/database.js", () => ({
  getDb: () => testDb,
  isMySQL: () => false,
}));

const {
  createWorkflowFormBinding,
  getWorkflowFormBinding,
  getWorkflowFormBindingByNode,
  listWorkflowFormBindings,
  updateWorkflowFormBinding,
  deleteWorkflowFormBinding,
} = await import("../../src/services/workflow-form-service.js");

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_form_bindings (
      id TEXT PRIMARY KEY,
      definition_key TEXT NOT NULL,
      node_id TEXT NOT NULL,
      form_id TEXT NOT NULL,
      form_version INTEGER DEFAULT -1,
      is_required INTEGER DEFAULT 1,
      mapping_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(definition_key, node_id)
    );
  `);
}

describe("Workflow Form Service", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  it("should create binding with defaults", async () => {
    const binding = await createWorkflowFormBinding({
      definitionKey: "leave_approval",
      nodeId: "manager_approval",
      formId: "form-001",
    });
    expect(binding.definition_key).toBe("leave_approval");
    expect(binding.node_id).toBe("manager_approval");
    expect(binding.form_version).toBe(-1);
    expect(binding.is_required).toBe(1);
    expect(binding.mapping_json).toBeNull();
  });

  it("should create binding with all fields", async () => {
    const binding = await createWorkflowFormBinding({
      definitionKey: "expense_approval",
      nodeId: "finance_approval",
      formId: "form-002",
      formVersion: 2,
      isRequired: false,
      mappingJson: { variableName: "expenseForm" },
    });
    expect(binding.form_version).toBe(2);
    expect(binding.is_required).toBe(0);
    expect(binding.mapping_json.variableName).toBe("expenseForm");
  });

  it("should get binding by id", async () => {
    const created = await createWorkflowFormBinding({
      definitionKey: "test_flow",
      nodeId: "node1",
      formId: "f1",
    });
    const fetched = await getWorkflowFormBinding(created.id);
    expect(fetched.id).toBe(created.id);
  });

  it("should list bindings by definition key", async () => {
    await createWorkflowFormBinding({ definitionKey: "test_flow", nodeId: "node1", formId: "f1" });
    await createWorkflowFormBinding({ definitionKey: "test_flow", nodeId: "node2", formId: "f2" });
    await createWorkflowFormBinding({ definitionKey: "other_flow", nodeId: "node3", formId: "f3" });
    const bindings = await listWorkflowFormBindings("test_flow");
    expect(bindings.length).toBe(2);
  });

  it("should update binding fields", async () => {
    const created = await createWorkflowFormBinding({
      definitionKey: "test_flow",
      nodeId: "node3",
      formId: "f3",
    });
    const updated = await updateWorkflowFormBinding(created.id, {
      formVersion: 5,
      isRequired: false,
      mappingJson: { fieldMappings: { a: "b" } },
    });
    expect(updated.form_version).toBe(5);
    expect(updated.is_required).toBe(0);
    expect(updated.mapping_json.fieldMappings.a).toBe("b");
  });

  it("should delete binding", async () => {
    const created = await createWorkflowFormBinding({
      definitionKey: "test_flow",
      nodeId: "node4",
      formId: "f4",
    });
    await deleteWorkflowFormBinding(created.id);
    const fetched = await getWorkflowFormBinding(created.id);
    expect(fetched).toBeUndefined();
  });

  it("should get binding by node", async () => {
    await createWorkflowFormBinding({
      definitionKey: "test_flow",
      nodeId: "node5",
      formId: "f5",
    });
    const binding = await getWorkflowFormBindingByNode("test_flow", "node5");
    expect(binding.node_id).toBe("node5");
  });

  it("should return undefined for non-existent binding", async () => {
    const binding = await getWorkflowFormBinding("non-existent-id");
    expect(binding).toBeUndefined();
  });

  it("should return undefined for non-existent node binding", async () => {
    const binding = await getWorkflowFormBindingByNode("unknown", "unknown");
    expect(binding).toBeUndefined();
  });
});
