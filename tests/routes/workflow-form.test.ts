import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

let testDb: Database.Database;

vi.mock("../../src/db/database.js", () => ({
  getDb: () => testDb,
  isMySQL: () => false,
}));

// Dynamic import after mock is set up so the service uses the mock
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

describe("Workflow Form Binding", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  it("should create binding", async () => {
    const binding = await createWorkflowFormBinding({
      definitionKey: "leave_approval",
      nodeId: "manager_approval",
      formId: "form-001",
      formVersion: 1,
      isRequired: true,
      mappingJson: { variableName: "leaveForm" },
    });
    expect(binding.definition_key).toBe("leave_approval");
    expect(binding.node_id).toBe("manager_approval");
    expect(binding.mapping_json.variableName).toBe("leaveForm");
  });

  it("should get binding by id", async () => {
    const created = await createWorkflowFormBinding({
      definitionKey: "expense_approval",
      nodeId: "finance_approval",
      formId: "form-002",
    });
    const fetched = await getWorkflowFormBinding(created.id);
    expect(fetched.id).toBe(created.id);
  });

  it("should list bindings by definition key", async () => {
    await createWorkflowFormBinding({ definitionKey: "test_flow", nodeId: "node1", formId: "f1" });
    await createWorkflowFormBinding({ definitionKey: "test_flow", nodeId: "node2", formId: "f2" });
    const bindings = await listWorkflowFormBindings("test_flow");
    expect(bindings.length).toBeGreaterThanOrEqual(2);
  });

  it("should update binding", async () => {
    const created = await createWorkflowFormBinding({
      definitionKey: "test_flow",
      nodeId: "node3",
      formId: "f3",
    });
    const updated = await updateWorkflowFormBinding(created.id, { isRequired: false });
    expect(updated.is_required).toBe(0); // SQLite boolean stored as 0/1
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
});
