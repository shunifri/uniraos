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

export const saveLLMConfig = (config: unknown) => api.put('/api/config/llm', config);

export const saveAgentConfig = (config: unknown) => api.put('/api/config/agent', config);

export const saveMultimodalConfig = (config: unknown) => api.put('/api/config/multimodal', config);

export const testLLM = (payload: unknown) => api.post('/api/config/llm/test', payload);

// ---------------------------------------------------------------------------
// Config (admin) - Federation & Evolution
// ---------------------------------------------------------------------------

export const getFederationConfig = () => api.get('/api/config/federation');

export const saveFederationConfig = (config: unknown) =>
  api.put('/api/config/federation', config);

export const addPeer = (peer: unknown) => api.post('/api/config/federation/peers', peer);

export const removePeer = (peerId: string) =>
  api.del(`/api/config/federation/peers/${peerId}`);

export const getEvolutionConfig = () => api.get('/api/config/evolution');

export const saveEvolutionConfig = (config: unknown) =>
  api.put('/api/config/evolution', config);

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export const getSkills = () => api.get('/api/skills');

export const executeSkill = (skillId: string, params: unknown) =>
  api.post(`/api/skills/${skillId}/execute`, params);

// ---------------------------------------------------------------------------
// Chat (streaming)
// ---------------------------------------------------------------------------

export async function streamChat(body: unknown): Promise<ReadableStream> {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? res.statusText);
  }
  if (!res.body) {
    throw new Error('Response body is empty');
  }
  return res.body;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export const getSTM = () => api.get('/api/memory/stm');

export const getLTM = () => api.get('/api/memory/ltm');

export const getArchives = () => api.get('/api/memory/archives');

export const getSchedule = () => api.get('/api/memory/schedule');

export const startSchedule = () => api.post('/api/memory/schedule/start');

export const stopSchedule = () => api.post('/api/memory/schedule/stop');

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
  api.put('/api/evolution/config', config);

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

export const searchMarketplace = (query?: unknown) =>
  api.post('/api/marketplace/search', query);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const getTasks = () => api.get('/api/tasks');

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export const getPlugins = () => api.get('/api/plugins');

export const reloadPlugins = () => api.post('/api/plugins/reload');
