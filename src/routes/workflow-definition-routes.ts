import { Router } from "express";
import { requireAuth, requireAdmin } from "../permissions/middleware/auth-middleware.js";
import { getWorkflowRepository } from "../workflow/repository.js";
import { WorkflowEngine } from "../workflow/engine.js";
import type { WorkflowSpec, WorkflowNode } from "../workflow/types.js";

const router = Router();

// ===== Validation helpers =====

export function validateWorkflowSpec(spec: WorkflowSpec): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nodes = spec.nodes ?? [];

  if (!spec.key || spec.key.trim().length === 0) {
    errors.push("Workflow key is required");
  }
  if (!spec.name || spec.name.trim().length === 0) {
    errors.push("Workflow name is required");
  }

  if (nodes.length === 0) {
    errors.push("Workflow must have at least one node");
    return { valid: false, errors };
  }

  const nodeIds = new Set<string>();
  const startEvents = nodes.filter((n) => n.type === "start_event");
  const endEvents = nodes.filter((n) => n.type === "end_event");

  if (startEvents.length === 0) {
    errors.push("Workflow must have a start_event");
  }
  if (startEvents.length > 1) {
    errors.push("Workflow must have exactly one start_event");
  }
  if (endEvents.length === 0) {
    errors.push("Workflow must have at least one end_event");
  }

  for (const node of nodes) {
    if (!node.id || node.id.trim().length === 0) {
      errors.push("Node has empty id");
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
  }

  // Validate next references
  for (const node of nodes) {
    if (node.next && !nodeIds.has(node.next)) {
      errors.push(`Node ${node.id} references unknown next node: ${node.next}`);
    }
    if (node.type === "exclusive_gateway") {
      const gw = node as Extract<WorkflowNode, { type: "exclusive_gateway" }>;
      if (!gw.conditions || gw.conditions.length === 0) {
        errors.push(`Exclusive gateway ${node.id} must have at least one condition`);
      } else {
        for (const cond of gw.conditions) {
          if (!cond.next) {
            errors.push(`Condition in gateway ${node.id} missing next`);
          } else if (!nodeIds.has(cond.next)) {
            errors.push(`Gateway ${node.id} condition references unknown node: ${cond.next}`);
          }
        }
      }
    }
    if (node.type === "parallel_gateway") {
      const pg = node as Extract<WorkflowNode, { type: "parallel_gateway" }>;
      if (pg.mode === "split" && pg.branches) {
        for (const branchId of pg.branches) {
          if (!nodeIds.has(branchId)) {
            errors.push(`Parallel gateway ${node.id} references unknown branch: ${branchId}`);
          }
        }
      }
    }
  }

  // Check reachability from start
  if (startEvents.length === 1) {
    const reachable = new Set<string>();
    const queue = [startEvents[0].id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const node = nodes.find((n) => n.id === id);
      if (!node) continue;
      if (node.next) {
        queue.push(node.next);
      }
      if (node.type === "exclusive_gateway") {
        const gw = node as Extract<WorkflowNode, { type: "exclusive_gateway" }>;
        for (const cond of gw.conditions ?? []) {
          if (cond.next) queue.push(cond.next);
        }
      }
      if (node.type === "parallel_gateway") {
        const pg = node as Extract<WorkflowNode, { type: "parallel_gateway" }>;
        for (const branchId of pg.branches ?? []) {
          queue.push(branchId);
        }
      }
    }
    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        errors.push(`Node ${node.id} is unreachable from start_event`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ===== Routes =====

/** GET /workflow/definitions */
router.get("/workflow/definitions", requireAuth, async (_req, res) => {
  try {
    const repo = getWorkflowRepository();
    const defs = await repo.listDefinitions();
    res.json({ success: true, data: defs });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** GET /workflow/definitions/:key */
router.get("/workflow/definitions/:key", requireAuth, async (req, res) => {
  try {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const repo = getWorkflowRepository();
    const def = await repo.getDefinitionByKey(key);
    if (!def) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: def });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /workflow/definitions */
router.post("/workflow/definitions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, key, category, definition, formSchema } = req.body;
    if (!name || !key || !definition) {
      return res.status(400).json({ success: false, error: "name, key, and definition are required" });
    }

    const validation = validateWorkflowSpec(definition);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: "Validation failed", details: validation.errors });
    }

    const repo = getWorkflowRepository();
    const existing = await repo.getDefinitionByKey(key);
    if (existing) {
      return res.status(409).json({ success: false, error: `Definition with key '${key}' already exists` });
    }

    const def = await repo.createDefinition({
      name,
      key,
      version: 1,
      category,
      definition,
      formSchema,
      createdBy: req.user!.id,
    });
    res.json({ success: true, data: def });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

/** PUT /workflow/definitions/:key */
router.put("/workflow/definitions/:key", requireAuth, requireAdmin, async (req, res) => {
  try {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const { name, category, definition, formSchema } = req.body;
    const repo = getWorkflowRepository();
    const existing = await repo.getDefinitionByKey(key);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Not found" });
    }

    if (definition) {
      const validation = validateWorkflowSpec(definition);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: "Validation failed", details: validation.errors });
      }
    }

    const updates: Partial<typeof existing> = {};
    if (name !== undefined) updates.name = name;
    if (category !== undefined) updates.category = category;
    if (definition !== undefined) updates.definition = definition;
    if (formSchema !== undefined) updates.formSchema = formSchema;

    await repo.updateDefinition(existing.id, updates);
    const updated = await repo.getDefinitionByKey(key);
    res.json({ success: true, data: updated });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

/** DELETE /workflow/definitions/:key */
router.delete("/workflow/definitions/:key", requireAuth, requireAdmin, async (req, res) => {
  try {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const repo = getWorkflowRepository();
    const existing = await repo.getDefinitionByKey(key);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    await repo.deleteDefinition(existing.id);
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /workflow/definitions/:key/validate */
router.post("/workflow/definitions/:key/validate", requireAuth, async (req, res) => {
  try {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const repo = getWorkflowRepository();
    const existing = await repo.getDefinitionByKey(key);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    const validation = validateWorkflowSpec(existing.definition);
    res.json({ success: true, data: { valid: validation.valid, errors: validation.errors } });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /workflow/definitions/:key/test */
router.post("/workflow/definitions/:key/test", requireAuth, async (req, res) => {
  try {
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const repo = getWorkflowRepository();
    const existing = await repo.getDefinitionByKey(key);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    const engine = new WorkflowEngine();
    const result = await engine.startInstance(key, req.user!.id, req.body.variables ?? {});
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error?.message || "Test run failed" });
    }
    res.json({ success: true, data: { instance: result.instance, task: result.task } });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
