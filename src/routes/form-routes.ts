import { Router } from 'express';
import { requireAuth } from '../permissions/middleware/auth-middleware.js';
import {
  createFormDefinition, getFormDefinition, listFormDefinitions,
  updateFormDefinition, deleteFormDefinition,
  createFormInstance, getFormInstance, updateFormInstance
} from '../services/form-service.js';
import { resolveDataSource } from '../services/data-source-service.js';
import { testConnection, testConnectionConfig } from '../services/database-connector.js';
import { generateForm } from '../services/form-llm-generator.js';
import type { RouteDependencies } from './types.js';

export function createFormRoutes(deps: RouteDependencies): Router {
  const { getCurrentProvider } = deps;
  const router = Router();

// Form Definitions
router.post('/form/definitions', requireAuth, async (req, res) => {
  try {
    const def = await createFormDefinition({ ...req.body, createdBy: req.user!.id });
    res.json({ success: true, data: def });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.get('/form/definitions', requireAuth, async (req, res) => {
  try {
    const defs = await listFormDefinitions({
      categoryId: req.query.categoryId as string,
      status: req.query.status as string,
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string) : 20
    });
    res.json({ success: true, data: defs });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/form/definitions/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const def = await getFormDefinition(id);
    if (!def) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: def });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.put('/form/definitions/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const def = await updateFormDefinition(id, req.body);
    res.json({ success: true, data: def });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.delete('/form/definitions/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteFormDefinition(id);
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Form Instances
router.post('/form/instances', requireAuth, async (req, res) => {
  try {
    const instance = await createFormInstance({ ...req.body, submittedBy: req.user!.id });
    res.json({ success: true, data: instance });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.get('/form/instances/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const instance = await getFormInstance(id);
    if (!instance) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: instance });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.put('/form/instances/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const instance = await updateFormInstance(id, req.body);
    res.json({ success: true, data: instance });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// Data Source Resolution
router.post('/form/resolve-data-source', requireAuth, async (req, res) => {
  try {
    const result = await resolveDataSource(req.body);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// LLM Form Generation
router.post('/form/generate', requireAuth, async (req, res) => {
  try {
    const result = await generateForm(req.body, getCurrentProvider);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// Database Connection Testing
router.post('/connections/test/:id', requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await testConnection(id);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: (error as Error).message });
  }
});

router.post('/connections/test-config', requireAuth, async (req, res) => {
  try {
    const result = await testConnectionConfig(req.body);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: (error as Error).message });
  }
});

  return router;
}
