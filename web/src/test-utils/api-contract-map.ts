/**
 * API Contract Map — Frontend-to-Backend Endpoint Alignment
 *
 * This file documents every API function in `web/src/api/index.ts` and maps it
 * to the corresponding Express route in `src/routes/*.ts`.
 *
 * Mismatches are flagged with 🔴 (critical), 🟡 (warning), 🟢 (ok).
 *
 * Generated: 2026-05-08
 */

export interface ContractEntry {
  frontendFn: string;
  frontendMethod: "GET" | "POST" | "PUT" | "DELETE";
  frontendPath: string;
  backendFile: string;
  backendMethod: "GET" | "POST" | "PUT" | "DELETE";
  backendPath: string;
  status: "ok" | "mismatch-method" | "mismatch-path" | "frontend-only" | "backend-only";
  note: string;
}

export const apiContract: ContractEntry[] = [
  // ===================== Config =====================
  {
    frontendFn: "getConfig",
    frontendMethod: "GET", frontendPath: "/api/config",
    backendFile: "config-routes.ts", backendMethod: "GET", backendPath: "/api/config",
    status: "ok", note: "",
  },
  {
    frontendFn: "saveLLMConfig",
    frontendMethod: "PUT", frontendPath: "/api/config/llm",
    backendFile: "config-routes.ts", backendMethod: "POST", backendPath: "/api/config/llm",
    status: "ok",
    note: "✅ 已修复：前端改为 POST，与后端一致。",
  },
  {
    frontendFn: "saveAgentConfig",
    frontendMethod: "PUT", frontendPath: "/api/config/agent",
    backendFile: "config-routes.ts", backendMethod: "POST", backendPath: "/api/config/agent",
    status: "ok",
    note: "✅ 已修复：前端改为 POST，与后端一致。",
  },
  {
    frontendFn: "saveMultimodalConfig",
    frontendMethod: "PUT", frontendPath: "/api/config/multimodal",
    backendFile: "config-routes.ts", backendMethod: "POST", backendPath: "/api/config/multimodal",
    status: "ok",
    note: "✅ 已修复：前端改为 POST，与后端一致。",
  },
  {
    frontendFn: "testLLM",
    frontendMethod: "POST", frontendPath: "/api/config/llm/test",
    backendFile: "config-routes.ts", backendMethod: "POST", backendPath: "/api/config/model-cards/:type/test",
    status: "mismatch-path",
    note: "🟡 前端路径 /api/config/llm/test，后端路径 /api/config/model-cards/:type/test，需确认是否兼容。",
  },
  {
    frontendFn: "getFederationConfig",
    frontendMethod: "GET", frontendPath: "/api/config/federation",
    backendFile: "config-routes.ts", backendMethod: "GET", backendPath: "/api/config/federation",
    status: "ok", note: "",
  },
  {
    frontendFn: "saveFederationConfig",
    frontendMethod: "PUT", frontendPath: "/api/config/federation",
    backendFile: "config-routes.ts", backendMethod: "POST", backendPath: "/api/config/federation",
    status: "ok",
    note: "✅ 已修复：前端改为 POST，与后端一致。",
  },
  {
    frontendFn: "addPeer",
    frontendMethod: "POST", frontendPath: "/api/config/federation/peers",
    backendFile: "config-routes.ts", backendMethod: "POST", backendPath: "/api/config/federation/peers",
    status: "ok", note: "",
  },
  {
    frontendFn: "removePeer",
    frontendMethod: "DELETE", frontendPath: "/api/config/federation/peers/:peerId",
    backendFile: "config-routes.ts", backendMethod: "DELETE", backendPath: "/api/config/federation/peers",
    status: "ok",
    note: "✅ 已修复：前端改为 body 传参 { endpoint: peerId }，与后端一致。",
  },
  {
    frontendFn: "getEvolutionConfig",
    frontendMethod: "GET", frontendPath: "/api/config/evolution",
    backendFile: "config-routes.ts", backendMethod: "GET", backendPath: "/api/config/evolution-engine",
    status: "ok",
    note: "✅ 已修复：前端改为 /api/config/evolution-engine，与后端一致。",
  },
  {
    frontendFn: "saveEvolutionConfig",
    frontendMethod: "PUT", frontendPath: "/api/config/evolution",
    backendFile: "config-routes.ts", backendMethod: "POST", backendPath: "/api/config/evolution-engine",
    status: "ok",
    note: "✅ 已修复：前端改为 POST /api/config/evolution-engine，与后端一致。",
  },

  // ===================== Skills =====================
  {
    frontendFn: "getSkills",
    frontendMethod: "GET", frontendPath: "/api/skills",
    backendFile: "skill-routes.ts", backendMethod: "GET", backendPath: "/api/skills",
    status: "ok", note: "",
  },
  {
    frontendFn: "registerSkill",
    frontendMethod: "POST", frontendPath: "/api/skills",
    backendFile: "skill-routes.ts", backendMethod: "POST", backendPath: "/api/skills",
    status: "ok", note: "",
  },
  {
    frontendFn: "deleteSkill",
    frontendMethod: "DELETE", frontendPath: "/api/skills/:name",
    backendFile: "skill-routes.ts", backendMethod: "DELETE", backendPath: "/api/skills/:name",
    status: "ok", note: "",
  },
  {
    frontendFn: "executeSkill",
    frontendMethod: "POST", frontendPath: "/api/skills/:skillId/execute",
    backendFile: "skill-routes.ts", backendMethod: "POST", backendPath: "/api/execute",
    status: "ok",
    note: "✅ 已修复：前端改为 POST /api/execute 并传 { skillName, params }，与后端一致。",
  },

  // ===================== Chat =====================
  {
    frontendFn: "startChatStream",
    frontendMethod: "POST", frontendPath: "/api/agent/chat/start",
    backendFile: "agent-routes.ts", backendMethod: "POST", backendPath: "/api/agent/chat/start",
    status: "ok",
    note: "WebSocket streaming",
  },

  // ===================== Memory =====================
  {
    frontendFn: "getSTM",
    frontendMethod: "GET", frontendPath: "/api/memory/stm",
    backendFile: "memory-routes.ts", backendMethod: "GET", backendPath: "/api/memory/stm",
    status: "ok", note: "",
  },
  {
    frontendFn: "getLTM",
    frontendMethod: "GET", frontendPath: "/api/memory/ltm",
    backendFile: "memory-routes.ts", backendMethod: "GET", backendPath: "/api/memory/ltm",
    status: "ok", note: "",
  },
  {
    frontendFn: "getArchives",
    frontendMethod: "GET", frontendPath: "/api/memory/archives",
    backendFile: "memory-routes.ts", backendMethod: "GET", backendPath: "/api/memory/archives",
    status: "ok", note: "",
  },
  {
    frontendFn: "getSchedule",
    frontendMethod: "GET", frontendPath: "/api/memory/schedule",
    backendFile: "memory-routes.ts", backendMethod: "GET", backendPath: "/api/memory/schedule",
    status: "ok", note: "",
  },
  {
    frontendFn: "startSchedule",
    frontendMethod: "POST", frontendPath: "/api/memory/schedule/start",
    backendFile: "memory-routes.ts", backendMethod: "POST", backendPath: "/api/memory/schedule",
    status: "ok",
    note: "✅ 已修复：前端改为 POST /api/memory/schedule { action: 'start' }，与后端一致。",
  },
  {
    frontendFn: "stopSchedule",
    frontendMethod: "POST", frontendPath: "/api/memory/schedule/stop",
    backendFile: "memory-routes.ts", backendMethod: "DELETE", backendPath: "/api/memory/schedule",
    status: "ok",
    note: "✅ 已修复：前端改为 POST /api/memory/schedule { action: 'stop' }，与后端一致。",
  },

  // ===================== Admin =====================
  {
    frontendFn: "getUsers",
    frontendMethod: "GET", frontendPath: "/api/users",
    backendFile: "auth-routes.ts", backendMethod: "GET", backendPath: "/api/users",
    status: "ok", note: "",
  },
  {
    frontendFn: "createUser",
    frontendMethod: "POST", frontendPath: "/api/users",
    backendFile: "auth-routes.ts", backendMethod: "POST", backendPath: "/api/users",
    status: "ok", note: "",
  },
  {
    frontendFn: "updateUser",
    frontendMethod: "PUT", frontendPath: "/api/users/:userId",
    backendFile: "auth-routes.ts", backendMethod: "PUT", backendPath: "/api/users/:id",
    status: "ok", note: "参数名差异不影响调用",
  },
  {
    frontendFn: "deleteUser",
    frontendMethod: "DELETE", frontendPath: "/api/users/:userId",
    backendFile: "auth-routes.ts", backendMethod: "DELETE", backendPath: "/api/users/:id",
    status: "ok", note: "参数名差异不影响调用",
  },
  {
    frontendFn: "getDepartments",
    frontendMethod: "GET", frontendPath: "/api/departments",
    backendFile: "auth-routes.ts", backendMethod: "GET", backendPath: "/api/departments",
    status: "ok", note: "",
  },
  {
    frontendFn: "createDept",
    frontendMethod: "POST", frontendPath: "/api/departments",
    backendFile: "auth-routes.ts", backendMethod: "POST", backendPath: "/api/departments",
    status: "ok", note: "",
  },
  {
    frontendFn: "deleteDept",
    frontendMethod: "DELETE", frontendPath: "/api/departments/:deptId",
    backendFile: "auth-routes.ts", backendMethod: "DELETE", backendPath: "/api/departments/:id",
    status: "ok", note: "参数名差异不影响调用",
  },
  {
    frontendFn: "getRoles",
    frontendMethod: "GET", frontendPath: "/api/roles",
    backendFile: "auth-routes.ts", backendMethod: "GET", backendPath: "/api/roles",
    status: "ok", note: "",
  },
  {
    frontendFn: "createRole",
    frontendMethod: "POST", frontendPath: "/api/roles",
    backendFile: "auth-routes.ts", backendMethod: "POST", backendPath: "/api/roles",
    status: "ok", note: "",
  },
  {
    frontendFn: "getResources",
    frontendMethod: "GET", frontendPath: "/api/resources",
    backendFile: "auth-routes.ts", backendMethod: "GET", backendPath: "/api/resources",
    status: "ok", note: "",
  },

  // ===================== Federation =====================
  {
    frontendFn: "getFederationStatus",
    frontendMethod: "GET", frontendPath: "/api/federation/status",
    backendFile: "evolution-routes.ts", backendMethod: "GET", backendPath: "/api/federation/status",
    status: "ok", note: "",
  },

  // ===================== Evolution =====================
  {
    frontendFn: "getEvolutionControllerConfig",
    frontendMethod: "GET", frontendPath: "/api/evolution/config",
    backendFile: "evolution-routes.ts", backendMethod: "GET", backendPath: "/api/evolution/config",
    status: "ok", note: "",
  },
  {
    frontendFn: "updateEvolutionControllerConfig",
    frontendMethod: "PUT", frontendPath: "/api/evolution/config",
    backendFile: "evolution-routes.ts", backendMethod: "POST", backendPath: "/api/evolution/config",
    status: "ok",
    note: "✅ 已修复：前端改为 POST，与后端一致。",
  },
  {
    frontendFn: "getPendingApprovals",
    frontendMethod: "GET", frontendPath: "/api/evolution/approvals",
    backendFile: "evolution-routes.ts", backendMethod: "GET", backendPath: "/api/evolution/approvals",
    status: "ok", note: "",
  },
  {
    frontendFn: "approveEvolution",
    frontendMethod: "POST", frontendPath: "/api/evolution/approvals/:id/approve",
    backendFile: "evolution-routes.ts", backendMethod: "POST", backendPath: "/api/evolution/approvals/:id/approve",
    status: "ok", note: "",
  },
  {
    frontendFn: "rejectEvolution",
    frontendMethod: "POST", frontendPath: "/api/evolution/approvals/:id/reject",
    backendFile: "evolution-routes.ts", backendMethod: "POST", backendPath: "/api/evolution/approvals/:id/reject",
    status: "ok", note: "",
  },

  // ===================== Lifecycle =====================
  {
    frontendFn: "getLifecycle",
    frontendMethod: "GET", frontendPath: "/api/lifecycle",
    backendFile: "evolution-routes.ts", backendMethod: "GET", backendPath: "/api/lifecycle",
    status: "ok", note: "",
  },

  // ===================== Marketplace =====================
  {
    frontendFn: "searchMarketplace",
    frontendMethod: "POST", frontendPath: "/api/marketplace/search",
    backendFile: "evolution-routes.ts", backendMethod: "GET", backendPath: "/api/marketplace",
    status: "ok",
    note: "✅ 已修复：前端改为 GET /api/marketplace?q=xxx，与后端一致。",
  },

  // ===================== Tasks =====================
  {
    frontendFn: "getTasks",
    frontendMethod: "GET", frontendPath: "/api/tasks",
    backendFile: "skill-routes.ts", backendMethod: "GET", backendPath: "/api/tasks",
    status: "ok", note: "",
  },

  // ===================== Plugins =====================
  {
    frontendFn: "getPlugins",
    frontendMethod: "GET", frontendPath: "/api/plugins",
    backendFile: "skill-routes.ts", backendMethod: "GET", backendPath: "/api/plugins",
    status: "ok", note: "",
  },
  {
    frontendFn: "reloadPlugins",
    frontendMethod: "POST", frontendPath: "/api/plugins/reload",
    backendFile: "skill-routes.ts", backendMethod: "POST", backendPath: "/api/plugins/reload",
    status: "ok", note: "",
  },

  // ===================== Conversations =====================
  {
    frontendFn: "apiCreateConversation",
    frontendMethod: "POST", frontendPath: "/api/conversations",
    backendFile: "agent-routes.ts", backendMethod: "POST", backendPath: "/api/conversations",
    status: "ok", note: "",
  },

  // ===================== Connections =====================
  {
    frontendFn: "listConnections",
    frontendMethod: "GET", frontendPath: "/api/connections",
    backendFile: "connections-routes.ts", backendMethod: "GET", backendPath: "/api/connections",
    status: "ok", note: "",
  },
  {
    frontendFn: "getConnection",
    frontendMethod: "GET", frontendPath: "/api/connections/:id",
    backendFile: "connections-routes.ts", backendMethod: "GET", backendPath: "/api/connections/:id",
    status: "ok", note: "",
  },
  {
    frontendFn: "createConnection",
    frontendMethod: "POST", frontendPath: "/api/connections",
    backendFile: "connections-routes.ts", backendMethod: "POST", backendPath: "/api/connections",
    status: "ok", note: "",
  },
  {
    frontendFn: "updateConnection",
    frontendMethod: "PUT", frontendPath: "/api/connections/:id",
    backendFile: "connections-routes.ts", backendMethod: "PUT", backendPath: "/api/connections/:id",
    status: "ok", note: "",
  },
  {
    frontendFn: "deleteConnection",
    frontendMethod: "DELETE", frontendPath: "/api/connections/:id",
    backendFile: "connections-routes.ts", backendMethod: "DELETE", backendPath: "/api/connections/:id",
    status: "ok", note: "",
  },
  {
    frontendFn: "testConnection",
    frontendMethod: "POST", frontendPath: "/api/connections/:id/test",
    backendFile: "connections-routes.ts", backendMethod: "POST", backendPath: "/api/connections/:id/test",
    status: "ok", note: "",
  },

  // ===================== Workflow =====================
  {
    frontendFn: "getWorkflowTasks",
    frontendMethod: "GET", frontendPath: "/api/workflow/tasks",
    backendFile: "workflow-task-routes.ts", backendMethod: "GET", backendPath: "/api/workflow/tasks",
    status: "ok", note: "",
  },
  {
    frontendFn: "getWorkflowTaskForm",
    frontendMethod: "GET", frontendPath: "/api/workflow/tasks/:taskId/form",
    backendFile: "workflow-form-routes.ts", backendMethod: "GET", backendPath: "/api/workflow/tasks/:taskId/form",
    status: "ok", note: "",
  },
  {
    frontendFn: "completeWorkflowTask",
    frontendMethod: "POST", frontendPath: "/api/workflow/tasks/:taskId/complete",
    backendFile: "workflow-task-routes.ts", backendMethod: "POST", backendPath: "/api/workflow/tasks/:taskId/complete",
    status: "ok", note: "",
  },
  {
    frontendFn: "getWorkflowDefinition",
    frontendMethod: "GET", frontendPath: "/api/workflow/definitions/:key",
    backendFile: "workflow-definition-routes.ts", backendMethod: "GET", backendPath: "/api/workflow/definitions/:key",
    status: "ok", note: "",
  },
  {
    frontendFn: "createWorkflowDefinition",
    frontendMethod: "POST", frontendPath: "/api/workflow/definitions",
    backendFile: "workflow-definition-routes.ts", backendMethod: "POST", backendPath: "/api/workflow/definitions",
    status: "ok", note: "",
  },
  {
    frontendFn: "updateWorkflowDefinition",
    frontendMethod: "PUT", frontendPath: "/api/workflow/definitions/:key",
    backendFile: "workflow-definition-routes.ts", backendMethod: "PUT", backendPath: "/api/workflow/definitions/:key",
    status: "ok", note: "",
  },
  {
    frontendFn: "validateWorkflowDefinition",
    frontendMethod: "POST", frontendPath: "/api/workflow/definitions/:key/validate",
    backendFile: "workflow-definition-routes.ts", backendMethod: "POST", backendPath: "/api/workflow/definitions/:key/validate",
    status: "ok", note: "",
  },
  {
    frontendFn: "testWorkflowDefinition",
    frontendMethod: "POST", frontendPath: "/api/workflow/definitions/:key/test",
    backendFile: "workflow-definition-routes.ts", backendMethod: "POST", backendPath: "/api/workflow/definitions/:key/test",
    status: "ok", note: "",
  },
];

/** Count mismatches by severity */
export function getContractStats() {
  const critical = apiContract.filter((c) => c.status === "mismatch-path" || c.status === "mismatch-method");
  const warnings = apiContract.filter((c) => c.note.includes("🟡"));
  const ok = apiContract.filter((c) => c.status === "ok");
  return { critical: critical.length, warnings: warnings.length, ok: ok.length, total: apiContract.length };
}

/** List only mismatched entries */
export function getMismatches(): ContractEntry[] {
  return apiContract.filter((c) => c.status !== "ok");
}
