import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../src/db/database.js', () => ({
  getDb: () => testDb,
}));

vi.mock('../../src/services/form-service.js', () => ({
  getFormDefinition: vi.fn(),
  getFormDefinitionByKey: vi.fn(),
}));

vi.mock('../../src/workflow/repository.js', () => ({
  getWorkflowRepository: vi.fn(),
}));

const { saveTaskForm } = await import('../../src/services/workflow-task-form-service.js');
const { getFormDefinition, getFormDefinitionByKey } = await import('../../src/services/form-service.js');
const { getWorkflowRepository } = await import('../../src/workflow/repository.js');

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

describe('Workflow Task Form Save Service', () => {
  let mockRepo: any;

  beforeEach(() => {
    testDb = new Database(':memory:');
    initSchema(testDb);

    mockRepo = {
      getTaskById: vi.fn(),
      getInstanceById: vi.fn(),
      updateTask: vi.fn(),
      setVariable: vi.fn(),
      getVariables: vi.fn(),
    };
    (getWorkflowRepository as Mock).mockReturnValue(mockRepo);
    vi.clearAllMocks();
  });

  function insertDefinition(key: string): number {
    const stmt = testDb.prepare(`
      INSERT INTO workflow_definitions (name, key, version, definition)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(key, key, 1, '{}');
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

  it('should save formData and sync to variableName', async () => {
    const defId = insertDefinition('leave_approval');
    insertBinding('leave_approval', 'manager_approval', 'form-001', {
      variableName: 'leaveForm',
    });

    (getFormDefinition as Mock).mockReturnValue({
      id: 'form-001',
      schema_json: { type: 'object' },
    });

    mockRepo.getTaskById.mockResolvedValue({
      id: 1,
      instanceId: 100,
      nodeId: 'manager_approval',
      status: 'pending',
    });

    mockRepo.getInstanceById.mockResolvedValue({
      id: 100,
      definitionId: defId,
    });

    mockRepo.getVariables.mockResolvedValue({
      leaveForm: { days: 10, reason: 'personal' },
    });

    const formData = { days: 10, reason: 'personal' };
    const result = await saveTaskForm(1, { formData, comment: 'submit', action: 'approve' });

    expect(mockRepo.updateTask).toHaveBeenCalledWith(1, {
      formData,
      comment: 'submit',
      action: 'approve',
    });
    expect(mockRepo.setVariable).toHaveBeenCalledWith(100, 'leaveForm', formData, 'json');
    expect(result.taskId).toBe(1);
    expect(result.initialData).toEqual(formData);
  });

  it('should sync fieldMappings individually', async () => {
    const defId = insertDefinition('procurement');
    insertBinding('procurement', 'director_approval', 'form-003', {
      fieldMappings: { total: 'budget', dept: 'department', approved: 'isApproved' },
    });

    (getFormDefinition as Mock).mockReturnValue({
      id: 'form-003',
      schema_json: { type: 'object' },
    });

    mockRepo.getTaskById.mockResolvedValue({
      id: 2,
      instanceId: 200,
      nodeId: 'director_approval',
    });

    mockRepo.getInstanceById.mockResolvedValue({
      id: 200,
      definitionId: defId,
    });

    mockRepo.getVariables.mockResolvedValue({
      budget: 50000,
      department: 'IT',
      isApproved: false,
    });

    const formData = { total: 60000, dept: 'HR', approved: true };
    await saveTaskForm(2, { formData });

    expect(mockRepo.setVariable).toHaveBeenCalledWith(200, 'budget', 60000, 'number');
    expect(mockRepo.setVariable).toHaveBeenCalledWith(200, 'department', 'HR', 'string');
    expect(mockRepo.setVariable).toHaveBeenCalledWith(200, 'isApproved', true, 'boolean');
  });

  it('should only save task.formData when no binding exists', async () => {
    const defId = insertDefinition('no_binding_flow');

    mockRepo.getTaskById.mockResolvedValue({
      id: 3,
      instanceId: 300,
      nodeId: 'orphan_node',
    });

    mockRepo.getInstanceById.mockResolvedValue({
      id: 300,
      definitionId: defId,
    });

    const formData = { note: 'test' };
    const result = await saveTaskForm(3, { formData });

    expect(mockRepo.updateTask).toHaveBeenCalledWith(3, {
      formData,
      comment: undefined,
      action: undefined,
    });
    expect(mockRepo.setVariable).not.toHaveBeenCalled();
    expect(result.taskId).toBe(3);
    expect(result.initialData).toEqual(formData);
    expect(result.binding).toBeNull();
    expect(result.mappingApplied).toBe(false);
  });

  it('should infer types for process variables (number/boolean/object)', async () => {
    const defId = insertDefinition('type_test');
    insertBinding('type_test', 'node1', 'form-004', {
      fieldMappings: {
        count: 'varCount',
        flag: 'varFlag',
        meta: 'varMeta',
        name: 'varName',
      },
    });

    (getFormDefinition as Mock).mockReturnValue({
      id: 'form-004',
      schema_json: { type: 'object' },
    });

    mockRepo.getTaskById.mockResolvedValue({
      id: 4,
      instanceId: 400,
      nodeId: 'node1',
    });

    mockRepo.getInstanceById.mockResolvedValue({
      id: 400,
      definitionId: defId,
    });

    mockRepo.getVariables.mockResolvedValue({});

    const formData = { count: 42, flag: true, meta: { a: 1 }, name: 'test' };
    await saveTaskForm(4, { formData });

    expect(mockRepo.setVariable).toHaveBeenCalledWith(400, 'varCount', 42, 'number');
    expect(mockRepo.setVariable).toHaveBeenCalledWith(400, 'varFlag', true, 'boolean');
    expect(mockRepo.setVariable).toHaveBeenCalledWith(400, 'varMeta', { a: 1 }, 'json');
    expect(mockRepo.setVariable).toHaveBeenCalledWith(400, 'varName', 'test', 'string');
  });

  it('should throw when task not found', async () => {
    mockRepo.getTaskById.mockResolvedValue(undefined);

    await expect(saveTaskForm(999, { formData: {} })).rejects.toThrow('Task 999 not found');
  });
});
