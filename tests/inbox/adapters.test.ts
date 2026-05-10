/**
 * Inbox Adapters Tests
 *
 * Tests for evolution-adapter, system-adapter, and workflow-adapter.
 */

import { describe, it, expect } from "vitest";
import { createEvolutionAdapter } from "../../src/inbox/adapters/evolution-adapter.js";
import { createSystemAdapter } from "../../src/inbox/adapters/system-adapter.js";
import { createWorkflowAdapter } from "../../src/inbox/adapters/workflow-adapter.js";

describe("Evolution Adapter", () => {
  it("should convert evolution approval to inbox item", async () => {
    const adapter = createEvolutionAdapter();
    const approval = {
      id: "evo_123",
      name: "Test Skill",
      description: "A test skill",
      code: "const x = 1;",
      capabilities: ["cap1"],
      generatedBy: "agent",
      depth: 1,
    };

    const item = await adapter.toInboxItem(approval);

    expect(item).toMatchObject({
      userId: "admin",
      type: "approval",
      category: "evolution_approval",
      source: "evolution",
      sourceId: "evo_123",
      title: "Skill 生成审批: Test Skill",
      description: "A test skill",
      priority: "high",
      payload: {
        content: "const x = 1;",
        metadata: { generatedBy: "agent" },
        actions: [
          { action: "approve", label: "允许上线", primary: true },
          { action: "reject", label: "拒绝", danger: true },
          { action: "review", label: "需要修改" },
        ],
      },
    });
  });

  it("should handle approval without description", async () => {
    const adapter = createEvolutionAdapter();
    const approval = {
      id: "evo_456",
      name: "Minimal Skill",
    };

    const item = await adapter.toInboxItem(approval);

    expect(item.title).toBe("Skill 生成审批: Minimal Skill");
    expect(item.description).toBe("");
    expect(item.payload?.content).toBeUndefined();
  });
});

describe("System Adapter", () => {
  it("should convert system event to inbox item", async () => {
    const adapter = createSystemAdapter();
    const event = {
      id: "sys_001",
      userId: "user_123",
      title: "系统告警",
      description: "CPU 使用率过高",
      type: "alert",
      category: "system_alert",
      priority: "high",
      content: "CPU > 90%",
      link: "/monitoring",
      metadata: { server: "prod-1" },
    };

    const item = await adapter.toInboxItem(event);

    expect(item).toMatchObject({
      userId: "user_123",
      type: "alert",
      category: "system_alert",
      source: "system",
      sourceId: "sys_001",
      title: "系统告警",
      description: "CPU 使用率过高",
      priority: "high",
      payload: {
        content: "CPU > 90%",
        link: "/monitoring",
        metadata: { server: "prod-1" },
      },
    });
  });

  it("should use defaults when fields are missing", async () => {
    const adapter = createSystemAdapter();
    const event = {
      id: "sys_002",
      title: "通知",
    };

    const item = await adapter.toInboxItem(event);

    expect(item.userId).toBe("system");
    expect(item.type).toBe("notification");
    expect(item.category).toBe("system_alert");
    expect(item.priority).toBe("normal");
    expect(item.sourceId).toBe("sys_002");
  });
});

describe("Workflow Adapter", () => {
  it("should convert workflow task to inbox item", async () => {
    const adapter = createWorkflowAdapter();
    const task = {
      id: 42,
      assignee: "user_789",
      dueDate: "2025-12-31",
    };
    const node = {
      id: "node_1",
      name: "审批节点",
      form: { fields: [] },
      actions: [
        { action: "approve", label: "通过" },
        { action: "reject", label: "驳回" },
      ],
      dueDuration: 86400,
    };
    const instance = {
      id: "inst_1",
      name: "请假流程",
    };

    const item = await adapter.toInboxItem(task, node, instance);

    expect(item).toMatchObject({
      userId: "user_789",
      type: "approval",
      category: "workflow_task",
      source: "workflow",
      sourceId: "42",
      title: "审批节点",
      description: "请假流程",
      priority: "high",
      dueAt: new Date("2025-12-31").getTime(),
      payload: {
        schema: { fields: [] },
        actions: [
          { action: "approve", label: "通过" },
          { action: "reject", label: "驳回" },
        ],
        metadata: { instanceId: "inst_1", taskId: 42 },
      },
    });
  });

  it("should fallback to candidateUsers when assignee is missing", async () => {
    const adapter = createWorkflowAdapter();
    const task = {
      id: 99,
      candidateUsers: ["user_a", "user_b"],
    };
    const node = {
      id: "node_2",
      name: "复核节点",
    };
    const instance = {
      id: "inst_2",
      name: "报销流程",
    };

    const item = await adapter.toInboxItem(task, node, instance);

    expect(item).toMatchObject({
      userId: "user_a",
      title: "复核节点",
      priority: "normal",
      payload: {
        actions: [
          { action: "approve", label: "通过", primary: true },
          { action: "reject", label: "驳回", danger: true },
          { action: "transfer", label: "转交" },
        ],
      },
    });
    expect(item.dueAt).toBeUndefined();
  });

  it("should fallback to system when no assignee or candidates", async () => {
    const adapter = createWorkflowAdapter();
    const task = { id: 100 };
    const node = { id: "node_3" };
    const instance = { id: "inst_3" };

    const item = await adapter.toInboxItem(task, node, instance);

    expect(item).toMatchObject({ userId: "system", title: "node_3" });
  });
});
