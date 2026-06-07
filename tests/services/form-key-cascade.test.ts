import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

let testDb: Database.Database;

vi.mock("../../src/db/database.js", () => ({
  getDb: () => testDb,
  isMySQL: () => false,
}));

const {
  createFormDefinition,
  updateFormDefinition,
  getFormDefinition,
  getFormDefinitionByKey,
} = await import("../../src/services/form-service.js");

const wfSvc = await import("../../src/services/workflow-form-service.js");

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS form_definitions (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category_id TEXT,
      schema_json TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      status TEXT DEFAULT 'draft',
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      published_at DATETIME,
      deprecated_at DATETIME
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(definition_key, node_id)
    );
  `);
}

describe("Form Key Cascade (Q3 W2 Item #5)", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  it("should cascade: changing form key updates workflow_form_bindings.form_id atomically", async () => {
    // Setup: create a form definition
    const form = await createFormDefinition({
      key: "leave_form",
      name: "Leave Form",
      schemaJson: { type: "object", properties: { days: { type: "number" } } },
      createdBy: "user_1",
    });

    // Create workflow bindings referencing the form by key
    await wfSvc.createWorkflowFormBinding({
      definitionKey: "leave_approval",
      nodeId: "manager_approval",
      formId: "leave_form", // key-based reference
    });
    await wfSvc.createWorkflowFormBinding({
      definitionKey: "leave_approval",
      nodeId: "hr_approval",
      formId: "leave_form", // key-based reference
    });

    // Sanity: 2 bindings point to old key
    const beforeBindings = testDb.prepare(
      "SELECT * FROM workflow_form_bindings WHERE form_id = ?"
    ).all("leave_form");
    expect(beforeBindings).toHaveLength(2);

    // Act: change the form key
    await updateFormDefinition(form.id, { key: "leave_request_v2" } as any);

    // Assert 1: form_definitions.key is the new value
    const updated = await getFormDefinition(form.id);
    expect(updated?.key).toBe("leave_request_v2");

    // Assert 2: form can now be fetched by new key
    const byNewKey = await getFormDefinitionByKey("leave_request_v2");
    expect(byNewKey?.id).toBe(form.id);

    // Assert 3: cascade — bindings now point to new key
    const afterBindingsNew = testDb.prepare(
      "SELECT * FROM workflow_form_bindings WHERE form_id = ?"
    ).all("leave_request_v2");
    expect(afterBindingsNew).toHaveLength(2);

    // Assert 4: no stale bindings with old key
    const staleBindings = testDb.prepare(
      "SELECT * FROM workflow_form_bindings WHERE form_id = ?"
    ).all("leave_form");
    expect(staleBindings).toHaveLength(0);

    // Assert 5: listWorkflowFormBindingsByFormId still works (via new key)
    const listed = await wfSvc.listWorkflowFormBindings("leave_approval");
    expect(listed).toHaveLength(2);
    expect(listed.every((b: any) => b.form_id === "leave_request_v2")).toBe(true);
  });

  it("should rollback: when key change throws, workflow_form_bindings stays intact", async () => {
    // Setup: create a form with a binding
    const form = await createFormDefinition({
      key: "expense_form",
      name: "Expense Form",
      schemaJson: { type: "object" },
      createdBy: "user_1",
    });

    await wfSvc.createWorkflowFormBinding({
      definitionKey: "expense_approval",
      nodeId: "finance",
      formId: "expense_form",
    });

    // Snapshot bindings before
    const before = testDb.prepare(
      "SELECT * FROM workflow_form_bindings"
    ).all();
    expect(before).toHaveLength(1);
    expect((before[0] as any).form_id).toBe("expense_form");

    // Inject a failure: try to change to a key that violates UNIQUE constraint
    // First, create another form with the target key
    await createFormDefinition({
      key: "expense_v2",
      name: "Other Form",
      schemaJson: { type: "object" },
      createdBy: "user_2",
    });

    // Attempt to change to "expense_v2" — should throw on UNIQUE
    await expect(
      updateFormDefinition(form.id, { key: "expense_v2" } as any)
    ).rejects.toThrow();

    // Assert: form_definitions.key stays as old value
    const after = await getFormDefinition(form.id);
    expect(after?.key).toBe("expense_form");

    // Assert: bindings unchanged (transaction rolled back)
    const afterBindings = testDb.prepare(
      "SELECT * FROM workflow_form_bindings"
    ).all();
    expect(afterBindings).toHaveLength(1);
    expect((afterBindings[0] as any).form_id).toBe("expense_form");
  });

  it("should be a no-op when changing key but no workflow bindings reference it", async () => {
    // Setup: create a form with NO bindings
    const form = await createFormDefinition({
      key: "lonely_form",
      name: "Lonely Form",
      schemaJson: { type: "object" },
      createdBy: "user_1",
    });

    // Sanity: 0 bindings
    const count = await wfSvc.countWorkflowFormBindingsByFormId(form.id);
    expect(count).toBe(0);

    // Act: change key
    const result = await updateFormDefinition(form.id, {
      key: "lonely_form_v2",
    } as any);

    // Assert: form_definitions.key updated
    expect(result.key).toBe("lonely_form_v2");

    // Assert: still 0 bindings
    const newCount = await wfSvc.countWorkflowFormBindingsByFormId(form.id);
    expect(newCount).toBe(0);

    // Assert: no errors thrown
  });

  it("should NOT touch UUID-based bindings when key changes", async () => {
    // Setup: form with both key-based and UUID-based bindings
    const form = await createFormDefinition({
      key: "shared_form",
      name: "Shared Form",
      schemaJson: { type: "object" },
      createdBy: "user_1",
    });

    // key-based binding
    await wfSvc.createWorkflowFormBinding({
      definitionKey: "wf1",
      nodeId: "node1",
      formId: "shared_form",
    });
    // UUID-based binding
    await wfSvc.createWorkflowFormBinding({
      definitionKey: "wf2",
      nodeId: "node1",
      formId: form.id,
    });

    // Act
    await updateFormDefinition(form.id, { key: "shared_form_renamed" } as any);

    // Assert: key-based binding updated
    const k1 = testDb.prepare(
      "SELECT form_id FROM workflow_form_bindings WHERE definition_key = ? AND node_id = ?"
    ).get("wf1", "node1") as any;
    expect(k1.form_id).toBe("shared_form_renamed");

    // Assert: UUID-based binding UNCHANGED
    const k2 = testDb.prepare(
      "SELECT form_id FROM workflow_form_bindings WHERE definition_key = ? AND node_id = ?"
    ).get("wf2", "node1") as any;
    expect(k2.form_id).toBe(form.id);
  });

  it("should skip cascade when new key equals old key (no-op)", async () => {
    const form = await createFormDefinition({
      key: "stable_form",
      name: "Stable Form",
      schemaJson: { type: "object" },
      createdBy: "user_1",
    });

    await wfSvc.createWorkflowFormBinding({
      definitionKey: "stable_wf",
      nodeId: "node1",
      formId: "stable_form",
    });

    // Update with SAME key
    const result = await updateFormDefinition(form.id, {
      key: "stable_form",
      name: "Updated Name",
    } as any);

    expect(result.key).toBe("stable_form");
    expect(result.name).toBe("Updated Name");

    // Bindings should still be intact
    const bindings = testDb.prepare(
      "SELECT * FROM workflow_form_bindings"
    ).all();
    expect(bindings).toHaveLength(1);
    expect((bindings[0] as any).form_id).toBe("stable_form");
  });

  it("updateWorkflowFormBindingsFormIdByFormId returns 0 for empty/identical values", async () => {
    // Empty old value: returns 0
    const r1 = await wfSvc.updateWorkflowFormBindingsFormIdByFormId("", "new");
    expect(r1).toBe(0);

    // Same old and new: returns 0
    const r2 = await wfSvc.updateWorkflowFormBindingsFormIdByFormId("same", "same");
    expect(r2).toBe(0);

    // Setup real change
    await wfSvc.createWorkflowFormBinding({
      definitionKey: "test",
      nodeId: "n1",
      formId: "old_key",
    });
    const r3 = await wfSvc.updateWorkflowFormBindingsFormIdByFormId("old_key", "new_key");
    expect(r3).toBe(1);

    const rows = testDb.prepare(
      "SELECT form_id FROM workflow_form_bindings WHERE definition_key = ?"
    ).all("test");
    expect((rows[0] as any).form_id).toBe("new_key");
  });
});
