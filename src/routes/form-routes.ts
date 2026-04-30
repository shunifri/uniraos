import { Router } from 'express';
import { requireAuth } from '../db/auth-middleware.js';
import {
  createFormDefinition, getFormDefinition, listFormDefinitions,
  updateFormDefinition, deleteFormDefinition,
  createFormInstance, getFormInstance, updateFormInstance
} from '../services/form-service.js';
import { resolveDataSource } from '../services/data-source-service.js';
import { testConnection, testConnectionConfig } from '../services/database-connector.js';
import { generateForm } from '../services/form-llm-generator.js';
import type { RouteDependencies } from './index.js';

export function createFormRoutes(deps: RouteDependencies): Router {
  const { getCurrentProvider } = deps;
  const router = Router();

// Form Definitions
router.post('/form/definitions', requireAuth, (req, res) => {
  try {
    const def = createFormDefinition({ ...req.body, createdBy: req.user!.id });
    res.json({ success: true, data: def });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/form/definitions', requireAuth, (req, res) => {
  try {
    const defs = listFormDefinitions({
      categoryId: req.query.categoryId as string,
      status: req.query.status as string,
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string) : 20
    });
    res.json({ success: true, data: defs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/form/definitions/:id', requireAuth, (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const def = getFormDefinition(id);
    if (!def) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: def });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/form/definitions/:id', requireAuth, (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const def = updateFormDefinition(id, req.body);
    res.json({ success: true, data: def });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/form/definitions/:id', requireAuth, (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    deleteFormDefinition(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Form Instances
router.post('/form/instances', requireAuth, (req, res) => {
  try {
    const instance = createFormInstance({ ...req.body, submittedBy: req.user!.id });
    res.json({ success: true, data: instance });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/form/instances/:id', requireAuth, (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const instance = getFormInstance(id);
    if (!instance) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: instance });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/form/instances/:id', requireAuth, (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const instance = updateFormInstance(id, req.body);
    res.json({ success: true, data: instance });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/form/instances/:id/submit', requireAuth, (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const instance = updateFormInstance(id, { status: 'submitted', submittedBy: req.user!.id });
    res.json({ success: true, data: instance });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Data Source Resolver
router.post('/form/data-source/resolve', requireAuth, async (req, res) => {
  try {
    const result = await resolveDataSource(req.body);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Data Source Connection Test
router.post('/form/data-source/test-connection', requireAuth, async (req, res) => {
  try {
    const { connectionId, config } = req.body;
    let result;
    if (connectionId) {
      result = await testConnection(connectionId);
    } else if (config) {
      result = await testConnectionConfig(config);
    } else {
      return res.status(400).json({ success: false, error: 'connectionId or config required' });
    }
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate form from natural language
router.post('/form/generate', requireAuth, async (req, res) => {
  try {
    const { key, name, description, category, existingId } = req.body;
    if (!key || !name) {
      return res.status(400).json({ success: false, error: 'key and name are required' });
    }

    const result = await generateForm(
      { key, name, description, category, existingId },
      () => getCurrentProvider()
    );

    if (result.success) {
      res.json({ success: true, data: result.definition });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error('[FORM_GENERATE_ERROR]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

  return router;
}
