import { getDb } from '../db/database.js';
import { getWorkflowRepository } from '../workflow/repository.js';
import { getTaskFormSchema } from '../workflow/engine.js';
import { getFormDefinition, getFormDefinitionByKey } from './form-service.js';
import { getWorkflowFormBindingByNode } from './workflow-form-service.js';
import type { TaskAction } from '../workflow/types.js';

export interface TaskFormPayload {
  taskId: number;
  schema: any;
  initialData: Record<string, any>;
  binding: any;
  mappingApplied: boolean;
}

function safeParseRecord(value: unknown): Record<string, any> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, any>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function inferVariableType(value: unknown): string {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object') return 'json';
  return 'string';
}

export interface SaveTaskFormInput {
  formData: Record<string, any>;
  comment?: string;
  action?: TaskAction;
}

export async function saveTaskForm(
  taskId: number,
  input: SaveTaskFormInput,
): Promise<TaskFormPayload> {
  const repo = getWorkflowRepository();

  // 1. 获取 task
  const task = await repo.getTaskById(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (!task.instanceId) throw new Error(`Task ${taskId} has no instance`);

  // 2. 获取 instance
  const instance = await repo.getInstanceById(task.instanceId);
  if (!instance) throw new Error(`Instance ${task.instanceId} not found`);

  // 3. 获取流程定义
  const def = await repo.getDefinitionById(instance.definitionId);
  if (!def) throw new Error(`Definition ${instance.definitionId} not found`);
  const definitionKey = def.key;

  // 4. 获取节点绑定（用于向后兼容）
  const binding = await getWorkflowFormBindingByNode(definitionKey, task.nodeId);

  // 5. 保存到 task
  await repo.updateTask(taskId, {
    formData: input.formData,
    comment: input.comment,
    action: input.action,
  });

  // 6. 根据 binding.mapping_json 回写流程变量
  if (binding) {
    const mapping = safeParseRecord(binding.mapping_json);
    if (mapping && typeof mapping === 'object') {
      if (mapping.variableName) {
        await repo.setVariable(instance.id, mapping.variableName, input.formData, 'json');
      }

      if (mapping.fieldMappings && typeof mapping.fieldMappings === 'object') {
        for (const [formField, varName] of Object.entries(mapping.fieldMappings)) {
          const value = input.formData[formField];
          if (value !== undefined) {
            const type = inferVariableType(value);
            await repo.setVariable(instance.id, varName as string, value, type);
          }
        }
      }
    }
  }

  // 7. 返回 loadTaskForm（有 binding 时）或简化 payload（无 binding 时）
  if (binding) {
    return loadTaskForm(taskId);
  }

  return {
    taskId,
    schema: null,
    initialData: input.formData,
    binding: null,
    mappingApplied: false,
  };
}

export async function loadTaskForm(taskId: number): Promise<TaskFormPayload> {
  const repo = getWorkflowRepository();

  // 1. 获取 task
  const task = await repo.getTaskById(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (!task.instanceId) throw new Error(`Task ${taskId} has no instance`);

  // 2. 获取 instance
  const instance = await repo.getInstanceById(task.instanceId);
  if (!instance) throw new Error(`Instance ${task.instanceId} not found`);

  // 3. 获取流程定义
  const def = await repo.getDefinitionById(instance.definitionId);
  if (!def) throw new Error(`Definition ${instance.definitionId} not found`);
  const definitionKey = def.key;

  // 4. 获取表单定义（优先从流程定义节点中解析，支持表单中心引用和内嵌表单）
  let formSchema: any = null;
  const instanceDef = def.definition;
  if (instanceDef) {
    const formResult = await getTaskFormSchema(task, instanceDef);
    if (formResult) {
      formSchema = formResult.schema;
      // 字段权限可返回给前端
      // formResult.fieldPermissions
    }
  }

  let binding: any = null;

  // 如果没有从节点获取到 schema，保持原有逻辑（用于向后兼容）
  if (!formSchema) {
    // 4.1 获取节点绑定
    binding = await getWorkflowFormBindingByNode(definitionKey, task.nodeId);
    if (!binding) {
      throw new Error(`No form binding for node ${task.nodeId} in workflow ${definitionKey}`);
    }

    // 4.2 获取表单定义（优先按 ID 查询， fallback 按 key）
    let formDef = await getFormDefinition(binding.form_id);
    if (!formDef) {
      formDef = await getFormDefinitionByKey(binding.form_id);
    }
    if (!formDef) throw new Error(`Form ${binding.form_id} not found`);

    formSchema = typeof formDef.schema_json === 'string' ? JSON.parse(formDef.schema_json) : formDef.schema_json;
  }

  // 6. 获取流程变量
  const variables = await repo.getVariables(task.instanceId);

  // 7. 应用 mapping
  let initialData: Record<string, any> = {};
  let mappingApplied = false;

  const mapping = safeParseRecord(binding.mapping_json);
  if (mapping && typeof mapping === 'object') {
    if (mapping.variableName && variables[mapping.variableName] !== undefined) {
      const varValue = variables[mapping.variableName];
      if (typeof varValue === 'object' && varValue !== null) {
        initialData = { ...(varValue as Record<string, any>) };
        mappingApplied = true;
      }
    }

    if (mapping.fieldMappings && typeof mapping.fieldMappings === 'object') {
      for (const [formField, varName] of Object.entries(mapping.fieldMappings)) {
        if (variables[varName as string] !== undefined) {
          initialData[formField] = variables[varName as string];
          mappingApplied = true;
        }
      }
    }
  }

  // 8. 如果 task 本身有 form_data，合并（优先级高于流程变量）
  const taskFormData = safeParseRecord(task.formData);
  if (taskFormData) {
    initialData = { ...initialData, ...taskFormData };
  }

  return {
    taskId,
    schema: formSchema,
    initialData,
    binding,
    mappingApplied,
  };
}
