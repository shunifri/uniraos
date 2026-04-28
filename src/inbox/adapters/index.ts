// Inbox Adapters — 各来源到 InboxItem 的转换器
//
// 使用方式:
//   import { createWorkflowAdapter } from "./inbox/adapters";
//   const adapter = createWorkflowAdapter();
//   const inboxItem = await adapter.toInboxItem(task, node, instance);

export { createWorkflowAdapter } from "./workflow-adapter.js";
export { createEvolutionAdapter } from "./evolution-adapter.js";
export { createSystemAdapter } from "./system-adapter.js";
