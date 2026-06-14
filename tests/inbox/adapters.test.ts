/**
 * Inbox Adapters Tests
 *
 * Tests for evolution-adapter, system-adapter, and workflow-adapter.
 */

import { describe, it, expect } from "vitest";
import { createEvolutionAdapter } from "../../src/inbox/adapters/evolution-adapter.js";
import { createSystemAdapter } from "../../src/inbox/adapters/system-adapter.js";

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

