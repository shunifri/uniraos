// Inbox Adapters — 各来源到 InboxItem 的转换器
//
// 使用方式:
//   import { createEvolutionAdapter } from "./inbox/adapters";
//   const adapter = createEvolutionAdapter();
//   const inboxItem = await adapter.toInboxItem(approval);

export { createEvolutionAdapter } from "./evolution-adapter.js";
export { createSystemAdapter } from "./system-adapter.js";
