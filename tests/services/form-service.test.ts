import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

let testDb: Database.Database;

vi.mock("../../src/db/database.js", () => ({
  getDb: () => testDb,
  isMySQL: () => false,
}));

const {
  createFormDefinition,
  getFormDefinition,
  getFormDefinitionByKey,
  listFormDefinitions,
  updateFormDefinition,
  deleteFormDefinition,
  createFormInstance,
  getFormInstance,
  updateFormInstance,
} = await import("../../src/services/form-service.js");

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

    CREATE TABLE IF NOT EXISTS form_instances (
      id TEXT PRIMARY KEY,
      definition_id TEXT NOT NULL,
      definition_version INTEGER DEFAULT 1,
      data_json TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      submitted_by TEXT,
      submitted_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

describe("Form Service", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  describe("Form Definitions", () => {
    it("should create a form definition", async () => {
      const def = await createFormDefinition({
        key: "test-form",
        name: "Test Form",
        schemaJson: { type: "object", properties: {} },
        createdBy: "user_1",
      });
      expect(def).toBeDefined();
      expect(def.key).toBe("test-form");
      expect(def.name).toBe("Test Form");
      expect(def.schema_json).toEqual({ type: "object", properties: {} });
      expect(def.created_by).toBe("user_1");
    });

    it("should get form definition by id", async () => {
      const created = await createFormDefinition({
        key: "get-test",
        name: "Get Test",
        schemaJson: { type: "string" },
        createdBy: "user_1",
      });
      const found = await getFormDefinition(created.id);
      expect(found).toBeDefined();
      expect(found.id).toBe(created.id);
      expect(found.name).toBe("Get Test");
    });

    it("should get form definition by key", async () => {
      await createFormDefinition({
        key: "by-key-test",
        name: "By Key Test",
        schemaJson: { type: "number" },
        createdBy: "user_1",
      });
      const found = await getFormDefinitionByKey("by-key-test");
      expect(found).toBeDefined();
      expect(found.key).toBe("by-key-test");
      expect(found.name).toBe("By Key Test");
    });

    it("should list form definitions with pagination", async () => {
      await createFormDefinition({
        key: "list-1",
        name: "List One",
        schemaJson: {},
        createdBy: "user_1",
      });
      await createFormDefinition({
        key: "list-2",
        name: "List Two",
        schemaJson: {},
        createdBy: "user_1",
      });

      const defs = await listFormDefinitions({ page: 1, pageSize: 10 });
      expect(defs.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter form definitions by category", async () => {
      await createFormDefinition({
        key: "cat-1",
        name: "Cat One",
        schemaJson: {},
        categoryId: "cat_a",
        createdBy: "user_1",
      });
      await createFormDefinition({
        key: "cat-2",
        name: "Cat Two",
        schemaJson: {},
        categoryId: "cat_b",
        createdBy: "user_1",
      });

      const defs = await listFormDefinitions({ categoryId: "cat_a" });
      expect(defs.length).toBe(1);
      expect(defs[0].key).toBe("cat-1");
    });

    it("should update a form definition", async () => {
      const created = await createFormDefinition({
        key: "update-test",
        name: "Original",
        schemaJson: { type: "string" },
        createdBy: "user_1",
      });
      const updated = await updateFormDefinition(created.id, {
        name: "Updated",
        schemaJson: { type: "number" },
      });
      expect(updated.name).toBe("Updated");
      expect(updated.schema_json).toEqual({ type: "number" });
    });

    it("should delete a form definition", async () => {
      const created = await createFormDefinition({
        key: "delete-test",
        name: "Delete Me",
        schemaJson: {},
        createdBy: "user_1",
      });
      await deleteFormDefinition(created.id);
      const found = await getFormDefinition(created.id);
      expect(found).toBeUndefined();
    });
  });

  describe("Form Instances", () => {
    it("should create a form instance", async () => {
      const def = await createFormDefinition({
        key: "inst-test",
        name: "Instance Test",
        schemaJson: { type: "object" },
        createdBy: "user_1",
      });
      const instance = await createFormInstance({
        definitionId: def.id,
        dataJson: { name: "John" },
      });
      expect(instance).toBeDefined();
      expect(instance.definition_id).toBe(def.id);
      expect(instance.data_json).toEqual({ name: "John" });
      expect(instance.status).toBe("draft");
    });

    it("should get a form instance", async () => {
      const def = await createFormDefinition({
        key: "get-inst",
        name: "Get Instance",
        schemaJson: {},
        createdBy: "user_1",
      });
      const created = await createFormInstance({
        definitionId: def.id,
        dataJson: { a: 1 },
      });
      const found = await getFormInstance(created.id);
      expect(found).toBeDefined();
      expect(found.id).toBe(created.id);
      expect(found.data_json).toEqual({ a: 1 });
    });

    it("should update a form instance", async () => {
      const def = await createFormDefinition({
        key: "update-inst",
        name: "Update Instance",
        schemaJson: {},
        createdBy: "user_1",
      });
      const created = await createFormInstance({
        definitionId: def.id,
        dataJson: { a: 1 },
      });
      const updated = await updateFormInstance(created.id, {
        dataJson: { a: 2, b: 3 },
      });
      expect(updated.data_json).toEqual({ a: 2, b: 3 });
      expect(updated.status).toBe("draft");
    });

    it("should reject direct status update", async () => {
      const def = await createFormDefinition({
        key: "status-inst",
        name: "Status Instance",
        schemaJson: {},
        createdBy: "user_1",
      });
      const created = await createFormInstance({
        definitionId: def.id,
        dataJson: {},
      });
      await expect(
        updateFormInstance(created.id, { status: "submitted" })
      ).rejects.toThrow("不能直接修改表单状态");
    });

    it("should handle submitted_by on update", async () => {
      const def = await createFormDefinition({
        key: "submit-inst",
        name: "Submit Instance",
        schemaJson: {},
        createdBy: "user_1",
      });
      const created = await createFormInstance({
        definitionId: def.id,
        dataJson: {},
      });
      const updated = await updateFormInstance(created.id, {
        submittedBy: "user_2",
      });
      expect(updated.status).toBe("draft");
      expect(updated.submitted_by).toBe("user_2");
    });
  });
});
