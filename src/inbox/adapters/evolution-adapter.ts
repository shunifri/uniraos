/**
 * Evolution Adapter — 将 Evolution PendingApproval 转换为 InboxItem
 */

import type { CreateInboxItemInput } from "../inbox-types.js";

export interface EvolutionAdapter {
  toInboxItem(approval: any): Promise<CreateInboxItemInput>;
}

export function createEvolutionAdapter(): EvolutionAdapter {
  return {
    async toInboxItem(approval: any): Promise<CreateInboxItemInput> {
      return {
        userId: "admin", // Evolution 审批默认给管理员
        type: "approval",
        category: "evolution_approval",
        source: "evolution",
        sourceId: approval.id,
        title: `Skill 生成审批: ${approval.name}`,
        description: approval.description || "",
        priority: "high",
        payload: {
          content: approval.code?.slice(0, 500),
          metadata: {
            capabilities: approval.capabilities,
            generatedBy: approval.generatedBy,
            depth: approval.depth,
          },
          actions: [
            { action: "approve", label: "允许上线", primary: true },
            { action: "reject", label: "拒绝", danger: true },
            { action: "review", label: "需要修改" },
          ],
        },
      };
    },
  };
}
