import { useAuthStore } from '../store/auth';

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = useAuthStore.getState().token;
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    useAuthStore.getState().logout();
  }

  return res;
}

async function json<T = unknown>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? res.statusText);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export const api = {
  async get<T = unknown>(url: string): Promise<T> {
    return json<T>(await apiFetch(url));
  },

  async post<T = unknown>(url: string, body?: unknown): Promise<T> {
    return json<T>(
      await apiFetch(url, {
        method: 'POST',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  },

  async put<T = unknown>(url: string, body?: unknown): Promise<T> {
    return json<T>(
      await apiFetch(url, {
        method: 'PUT',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  },

  async del<T = unknown>(url: string, body?: unknown): Promise<T> {
    return json<T>(
      await apiFetch(url, {
        method: 'DELETE',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  },
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * 生成带认证 token 的页面图片 URL（用于 <img src> 等无法设置 header 的场景）
 */
export function pageImageUrl(docId: string, page: number): string {
  const token = useAuthStore.getState().token;
  const base = `/api/knowledge/documents/${docId}/pages?page=${page}`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

/**
 * 生成带认证 token 的视频帧图片 URL
 */
export function videoFrameUrl(docId: string, framePath: string): string {
  const token = useAuthStore.getState().token;
  const base = `/api/knowledge/documents/${docId}/frame?path=${encodeURIComponent(framePath)}`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

export const getConfig = () => api.get('/api/config');

export const saveLLMConfig = (config: unknown) => api.post('/api/config/llm', config);

export const saveAgentConfig = (config: unknown) => api.post('/api/config/agent', config);

export const saveMultimodalConfig = (config: unknown) => api.post('/api/config/multimodal', config);

export const testLLM = (payload: unknown) => api.post('/api/config/llm/test', payload);

// ---------------------------------------------------------------------------
// Config (admin) - Federation & Evolution
// ---------------------------------------------------------------------------

export const getFederationConfig = () => api.get('/api/config/federation');

export const saveFederationConfig = (config: unknown) =>
  api.put('/api/config/federation', config);

export const addPeer = (peer: unknown) => api.post('/api/config/federation/peers', peer);

export const removePeer = (peerId: string) =>
  api.del('/api/config/federation/peers', { endpoint: peerId });

export const getEvolutionConfig = () => api.get('/api/config/evolution-engine');

export const saveEvolutionConfig = (config: unknown) =>
  api.post('/api/config/evolution-engine', config);

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export const getSkills = () => api.get('/api/skills');

export const registerSkill = (payload: unknown) => api.post('/api/skills', payload);

export const deleteSkill = (name: string) => api.del(`/api/skills/${name}`);

export const executeSkill = (skillId: string, params: unknown) =>
  api.post('/api/execute', { skillName: skillId, params });

// ---------------------------------------------------------------------------
// Chat (streaming)
// ---------------------------------------------------------------------------

export async function startChatStream(body: unknown): Promise<{ streamId: string }> {
  const res = await apiFetch('/api/agent/chat/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? res.statusText);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export const getSTM = () => api.get('/api/memory/stm');

export const getLTM = () => api.get('/api/memory/ltm');

export const getArchives = () => api.get('/api/memory/archives');

export const getSchedule = () => api.get('/api/memory/schedule');

export const startSchedule = () => api.post('/api/memory/schedule', { action: 'start' });

export const stopSchedule = () => api.post('/api/memory/schedule', { action: 'stop' });

// ---------------------------------------------------------------------------
// Admin - Calibration (manual trigger, status, history)
// ---------------------------------------------------------------------------

export interface CalibrationRun {
  runId: string;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "success" | "failed";
  exitCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
  resultJsonPath?: string;
  bestK?: number;
  productionRmse?: number;
  error?: string;
}

export const runCalibration = () =>
  api.post<{ message: string; run: CalibrationRun }>('/api/admin/calibration/run');

export const getCalibrationStatus = () =>
  api.get<{ currentRun: CalibrationRun | null; isRunning: boolean }>(
    '/api/admin/calibration/status'
  );

export const getCalibrationHistory = (limit = 10) =>
  api.get<{ runs: CalibrationRun[]; count: number }>(
    `/api/admin/calibration/history?limit=${limit}`
  );

// ---------------------------------------------------------------------------
// Admin - Score Candidates (候选池 + auto-promote)
// ---------------------------------------------------------------------------

export type CandidateStatus = "active" | "candidate" | "rejected" | "deleted";

export interface ScoreCandidate {
  id: string;
  k: number;
  rmse: number;
  sampleSize: number;
  runId: string;
  status: CandidateStatus;
  createdAt: number;
  activatedAt?: number;
  rejectedAt?: number;
  notes?: string;
  improvementVsPrevious?: number;
}

export interface CandidateListResp {
  candidates: ScoreCandidate[];
  active: ScoreCandidate | null;
  currentK: { k: number; source: "env" | "candidate"; setAt: number };
  count: number;
}

export const getCandidates = () =>
  api.get<CandidateListResp>('/api/admin/calibration/candidates');

export const promoteCandidate = (id: string) =>
  api.post<{ ok: boolean; reason: string }>(`/api/admin/calibration/candidates/${id}/promote`);

export const rejectCandidate = (id: string, notes?: string) =>
  api.post<{ ok: boolean; reason: string }>(`/api/admin/calibration/candidates/${id}/reject`, { notes });

export const deleteCandidate = (id: string) =>
  api.del<{ ok: boolean; reason: string }>(`/api/admin/calibration/candidates/${id}`);

export const revertActiveCandidate = () =>
  api.post<{ ok: boolean; reason: string }>('/api/admin/calibration/candidates/revert');

export const getCandidateSettings = () =>
  api.get<{ autoPromote: boolean; improvementThresholdPct: number }>(
    '/api/admin/calibration/candidates/settings'
  );

export const updateCandidateSettings = (settings: { autoPromote?: boolean; improvementThresholdPct?: number }) =>
  api.post<{ ok: boolean; autoPromote: boolean; improvementThresholdPct: number }>(
    '/api/admin/calibration/candidates/settings',
    settings
  );

// ---------------------------------------------------------------------------
// Admin - Users / Departments / Roles / Resources
// ---------------------------------------------------------------------------

export const getUsers = () => api.get('/api/users');

export const createUser = (user: unknown) => api.post('/api/users', user);

export const updateUser = (userId: string, data: unknown) =>
  api.put(`/api/users/${userId}`, data);

export const deleteUser = (userId: string) => api.del(`/api/users/${userId}`);

export const getDepartments = () => api.get('/api/departments');

export const createDept = (dept: unknown) => api.post('/api/departments', dept);

export const deleteDept = (deptId: string) =>
  api.del(`/api/departments/${deptId}`);

export const getRoles = () => api.get('/api/roles');

export const createRole = (role: unknown) => api.post('/api/roles', role);

export const getResources = () => api.get('/api/resources');

// ---------------------------------------------------------------------------
// Federation
// ---------------------------------------------------------------------------

export const getFederationStatus = () => api.get('/api/federation/status');

// ---------------------------------------------------------------------------
// Evolution
// ---------------------------------------------------------------------------

export const getEvolutionControllerConfig = () => api.get('/api/evolution/config');

export const updateEvolutionControllerConfig = (config: unknown) =>
  api.post('/api/evolution/config', config);

export const getPendingApprovals = () => api.get('/api/evolution/approvals');

export const approveEvolution = (id: string) =>
  api.post(`/api/evolution/approvals/${id}/approve`);

export const rejectEvolution = (id: string) =>
  api.post(`/api/evolution/approvals/${id}/reject`);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const getLifecycle = () => api.get('/api/lifecycle');

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

export const searchMarketplace = (query?: string) =>
  api.get('/api/marketplace' + (query ? '?q=' + encodeURIComponent(query) : ''));

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const getTasks = () => api.get('/api/tasks');

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export const getPlugins = () => api.get('/api/plugins');

export const reloadPlugins = () => api.post('/api/plugins/reload');

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function apiCreateConversation(title: string): Promise<string | null> {
  try {
    const res = await apiFetch("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ title })
    });
    const data = await res.json();
    return data.success ? data.id : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export interface ConnectionItem {
  id: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  isActive: boolean;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

export const listConnections = (type?: string) =>
  api.get<{ success: boolean; data: ConnectionItem[] }>(`/api/connections${type ? `?type=${type}` : ''}`);

export const getConnection = (id: number) =>
  api.get<{ success: boolean; data: ConnectionItem }>(`/api/connections/${id}`);

export const createConnection = (body: Partial<ConnectionItem>) =>
  api.post<{ success: boolean; data: ConnectionItem }>('/api/connections', body);

export const updateConnection = (id: number, body: Partial<ConnectionItem>) =>
  api.put<{ success: boolean; data: { id: number } }>(`/api/connections/${id}`, body);

export const deleteConnection = (id: number) =>
  api.del<{ success: boolean }>(`/api/connections/${id}`);

export const testConnection = (id: number) =>
  api.post<{ success: boolean; data: { success: boolean; message: string } }>(`/api/connections/${id}/test`);

// ---------------------------------------------------------------------------
// Workflow Tasks (审批中心)
// ---------------------------------------------------------------------------

export const getWorkflowTasks = (params?: { page?: number; pageSize?: number; status?: string }) =>
  api.get<{ success: boolean; data: any[]; pagination: { total: number } }>(`/api/workflow/tasks?page=${params?.page || 1}&pageSize=${params?.pageSize || 20}`);

export const getWorkflowTaskForm = (taskId: number) =>
  api.get<{ success: boolean; data: any }>(`/api/workflow/tasks/${taskId}/form`);

export const completeWorkflowTask = (taskId: number, body: { action: string; comment?: string; formData?: any }) =>
  api.post<{ success: boolean; data: any }>(`/api/workflow/tasks/${taskId}/complete`, body);

// ---------------------------------------------------------------------------
// Workflow Definitions
// ---------------------------------------------------------------------------

export const getWorkflowDefinition = (key: string) =>
  api.get<{ success: boolean; data: any }>(`/api/workflow/definitions/${key}`);

export const createWorkflowDefinition = (payload: unknown) =>
  api.post<{ success: boolean; data: any }>('/api/workflow/definitions', payload);

export const updateWorkflowDefinition = (key: string, payload: unknown) =>
  api.put<{ success: boolean; data: any }>(`/api/workflow/definitions/${key}`, payload);

export const validateWorkflowDefinition = (key: string) =>
  api.post<{ success: boolean; data: { valid: boolean; errors: string[] } }>(`/api/workflow/definitions/${key}/validate`);

export const testWorkflowDefinition = (key: string) =>
  api.post<{ success: boolean; data: any; error?: string }>(`/api/workflow/definitions/${key}/test`);
