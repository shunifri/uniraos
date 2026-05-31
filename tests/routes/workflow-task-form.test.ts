import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import Database from "better-sqlite3";

let testDb: Database.Database;

vi.mock("../../src/db/database.js", () => ({
  getDb: () => testDb,
  isMySQL: () => false,
}));

vi.mock("../../src/services/form-service.js", () => ({
  getFormDefinition: vi.fn(),
  getFormDefinitionByKey: vi.fn(),
}));

vi.mock("../../src/workflow/repository.js", () => ({
  getWorkflowRepository: vi.fn(),
}));

const { loadTaskForm } = await import("../../src/services/workflow-task-form-service.js");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { getFormDefinition, getFormDefinitionByKey } = await import("../../src/services/form-service.js");
const { getWorkflowRepository } = await import("../../src/workflow/repository.js");

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL DEFAULT 1,
      category TEXT,
      definition TEXT NOT NULL,
      form_schema TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

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

describe("Workflow Task Form Service", () => {
  let mockRepo: any;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);

    mockRepo = {
      getTaskById: vi.fn(),
      getInstanceById: vi.fn(),
      getVariables: vi.fn(),
      getDefinitionById: vi.fn(async (id: number) => {
        const row = testDb.prepare("SELECT * FROM workflow_definitions WHERE id = ?").get(id);
        return row || null;
      }),
    };
    (getWorkflowRepository as Mock).mockReturnValue(mockRepo);
    vi.clearAllMocks();
  });

  function insertDefinition(key: string): number {
    const stmt = testDb.prepare(`
      INSERT INTO workflow_definitions (name, key, version, definition)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(key, key, 1, "{}");
    return Number(result.lastInsertRowid);
  }

  function insertBinding(definitionKey: string, nodeId: string, formId: string, mappingJson?: any): string {
    const id = crypto.randomUUID();
    testDb.prepare(`
      INSERT INTO workflow_form_bindings (id, definition_key, node_id, form_id, mapping_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, definitionKey, nodeId, formId, mappingJson ? JSON.stringify(mappingJson) : null);
    return id;
  }

  it("should return schema and initial data for a valid task", async () => {
    const defId = insertDefinition("leave_approval");
    insertBinding("leave_approval", "manager_approval", "form-001");

    (getFormDefinition as Mock).mockReturnValue({
      id: "form-001",
      key: "leave_form",
      name: "Leave Form",
      schema_json: { type: "object", properties: { days: { type: "number" } } },
    });

    mockRepo.getTaskById.mockResolvedValue({
      id: 1,
      instanceId: 100,
      nodeId: "manager_approval",
      status: "pending",
      formData: undefined,
    });

    mockRepo.getInstanceById.mockResolvedValue({
      id: 100,
      definitionId: defId,
      status: "running",
    });

    mockRepo.getVariables.mockResolvedValue({
      days: 5,
      reason: "sick",
    });

    const result = await loadTaskForm(1);

    expect(result.taskId).toBe(1);
    expect(result.schema).toEqual({ type: "object", properties: { days: { type: "number" } } });
    // 自动从流程变量按字段名匹配回填（days 变量与表单字段名匹配）
    expect(result.initialData).toEqual({ days: 5 });
    expect(result.mappingApplied).toBe(false);
    expect(result.binding.form_id).toBe("form-001");
  });

  it("should apply variableName mapping", async () => {
    const defId = insertDefinition("expense_approval");
    insertBinding("expense_approval", "finance_approval", "form-002", {
      variableName: "expenseForm",
    });

    (getFormDefinition as Mock).mockReturnValue({
      id: "form-002",
      schema_json: { type: "object" },
    });

    mockRepo.getTaskById.mockResolvedValue({
      id: 2,
      instanceId: 200,
      nodeId: "finance_approval",
      status: "pending",
    });

    mockRepo.getInstanceById.mockResolvedValue({
      id: 200,
      definitionId: defId,
    });

    mockRepo.getVariables.mockResolvedValue({
      expenseForm: { amount: 1000, category: "travel" },
      otherVar: "ignored",
    });

    const result = await loadTaskForm(2);

    expect(result.initialData).toEqual({ amount: 1000, category: "travel" });
    expect(result.mappingApplied).toBe(true);
  });

  it("should apply fieldMappings", async () => {
    const defId = insertDefinition("procurement");
    insertBinding("procurement", "director_approval", "form-003", {
      fieldMappings: { total: "budget", dept: "department" },
    });

    (getFormDefinition as Mock).mockReturnValue({
      id: "form-003",
      schema_json: { type: "object" },
    });

    mockRepo.getTaskById.mockResolvedValue({
      id: 3,
      instanceId: 300,
      nodeId: "director_approval",
    });

    mockRepo.getInstanceById.mockResolvedValue({
      id: 300,
      definitionId: defId,
    });

    mockRepo.getVariables.mockResolvedValue({
      budget: 50000,
      department: "IT",
      ignored: "value",
    });

    const result = await loadTaskForm(3);

    expect(result.initialData).toEqual({ total: 50000, dept: "IT" });
    expect(result.mappingApplied).toBe(true);
  });

  it("should merge task.formData with priority over variables", async () => {
    const defId = insertDefinition("leave_approval");
    insertBinding("leave_approval", "manager_approval", "form-001", {
      variableName: "leaveForm",
    });

    (getFormDefinition as Mock).mockReturnValue({
      id: "form-001",
      schema_json: { type: "object" },
    });

    mockRepo.getTaskById.mockResolvedValue({
      id: 4,
      instanceId: 400,
      nodeId: "manager_approval",
      formData: { days: 10, note: "urgent" },
    });

    mockRepo.getInstanceById.mockResolvedValue({
      id: 400,
      definitionId: defId,
    });

    mockRepo.getVariables.mockResolvedValue({
      leaveForm: { days: 5, reason: "sick" },
    });

    const result = await loadTaskForm(4);

    expect(result.initialData).toEqual({ days: 10, reason: "sick", note: "urgent" });
    expect(result.mappingApplied).toBe(true);
  });

  it("should throw when no binding exists", async () => {
    const defId = insertDefinition("no_binding_flow");

    mockRepo.getTaskById.mockResolvedValue({
      id: 5,
      instanceId: 500,
      nodeId: "orphan_node",
    });

    mockRepo.getInstanceById.mockResolvedValue({
      id: 500,
      definitionId: defId,
    });

    mockRepo.getVariables.mockResolvedValue({});

    await expect(loadTaskForm(5)).rejects.toThrow("No form binding for node orphan_node in workflow no_binding_flow");
  });

  it("should throw when task not found", async () => {
    mockRepo.getTaskById.mockResolvedValue(undefined);

    await expect(loadTaskForm(999)).rejects.toThrow("Task 999 not found");
  });
});
