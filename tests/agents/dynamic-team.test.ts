/**
 * 动态团队组建测试
 *
 * 验证：
 * - 任务分析正确识别所需技能
 * - 动态团队根据任务类型选择正确的专家组合
 * - 显式成员配置可覆盖动态组建
 * - 流式模式发出 team_formed 事件
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

const testDb = new Database(":memory:");
vi.mock("../../src/db/database.js", () => ({
  getDb: () => testDb,
  isMySQL: () => false,
}));

import { Orchestrator } from "../../src/agents/orchestrator.js";
import type { LLMProvider, Message } from "../../src/llm/types.js";
import type { AgentDeps, AgentProfile } from "../../src/agents/types.js";
import { Protocol as ProtocolEnum } from "../../src/agents/types.js";

class MockLLMProvider implements LLMProvider {
  name = "mock";
  model = "mock-model";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chat(___messages: Message[]): Promise<{ content?: string }> {
    return { content: JSON.stringify({ level: "team", protocol: "HIERARCHICAL", reasoning: "mock" }) };
  }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
  async embedding(___text: string): Promise<number[]> {
    return Array(384).fill(0);
  }
}

function createMockDeps(): AgentDeps {
  return {
    provider: new MockLLMProvider(),
    engine: {
      execute: vi.fn().mockResolvedValue({ success: true, data: "ok", trace: [], traceId: "t1" }),
    } as unknown as AgentDeps["engine"],
    registry: {
      listVisible: vi.fn().mockReturnValue([]),
      lookup: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      onChange: vi.fn(),
    } as unknown as AgentDeps["registry"],
  };
}

describe("Dynamic Team Formation", () => {
  let orchestrator: Orchestrator;
  let deps: AgentDeps;

  beforeEach(() => {
    deps = createMockDeps();
    orchestrator = new Orchestrator(deps, { autoStrategy: true, maxIterations: 15 });
  });

  describe.skip("analyzeTaskRequirements", () => {
    // TODO: analyzeTaskRequirements method not yet implemented on Orchestrator
    it("should detect coding tasks", () => {
      const req = orchestrator.analyzeTaskRequirements("帮我写一个快速排序的代码");
      expect(req.primarySkills).toContain("coding");
      expect(req.complexity).toBeOneOf(["low", "medium", "high"]);
      expect(req.estimatedSteps).toBeGreaterThanOrEqual(1);
    });

    it("should detect research tasks", () => {
      const req = orchestrator.analyzeTaskRequirements("研究一下唐朝的历史背景");
      expect(req.primarySkills).toContain("research");
    });

    it("should detect creative tasks", () => {
      const req = orchestrator.analyzeTaskRequirements("帮我写一首关于春天的诗");
      expect(req.primarySkills).toContain("creative");
      expect(req.needsCreativity).toBe(true);
    });

    it("should detect high complexity from markers", () => {
      const req = orchestrator.analyzeTaskRequirements("请详细分析这个复杂的系统架构，并进行深度优化");
      expect(req.complexity).toBe("high");
    });

    it("should suggest SEQUENTIAL for coding tasks", () => {
      const req = orchestrator.analyzeTaskRequirements("debug 这段代码");
      expect(req.suggestedProtocol).toBe(ProtocolEnum.SEQUENTIAL);
    });

    it("should suggest SWARM for creative tasks", () => {
      const req = orchestrator.analyzeTaskRequirements("头脑风暴几个产品创意");
      expect(req.suggestedProtocol).toBe(ProtocolEnum.SWARM);
    });

    it("should be fast (<10ms) for rule-based path", () => {
      const start = performance.now();
      orchestrator.analyzeTaskRequirements("帮我写一个快速排序的代码");
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(10);
    });
  });

  describe.skip("formTeam", () => {
    // TODO: formTeam method not yet implemented on Orchestrator
    it("should select coder + reviewer for coding tasks", () => {
      const req = orchestrator.analyzeTaskRequirements("写一个快速排序函数");
      const members = orchestrator.formTeam(req);
      const roles = members.map((m) => m.role);
      expect(roles).toContain("coder");
      expect(roles).toContain("reviewer");
    });

    it("should select researcher + analyst for research tasks", () => {
      const req = orchestrator.analyzeTaskRequirements("调研一下人工智能的发展历程");
      const members = orchestrator.formTeam(req);
      const roles = members.map((m) => m.role);
      expect(roles).toContain("researcher");
      expect(roles).toContain("analyst");
    });

    it("should select creative + writer for creative tasks", () => {
      const req = orchestrator.analyzeTaskRequirements("设计一个品牌文案");
      const members = orchestrator.formTeam(req);
      const roles = members.map((m) => m.role);
      expect(roles).toContain("creative");
      expect(roles).toContain("writer");
    });

    it("should include reviewer for high-complexity tasks", () => {
      const req = orchestrator.analyzeTaskRequirements("请详细审查这个复杂系统的架构设计");
      const members = orchestrator.formTeam(req);
      const roles = members.map((m) => m.role);
      expect(roles).toContain("reviewer");
    });

    it("should fall back to default team for unknown task types", () => {
      const req = orchestrator.analyzeTaskRequirements("好的");
      const members = orchestrator.formTeam(req);
      expect(members.length).toBeGreaterThanOrEqual(2);
    });

    it("should limit team size to 2-4 members", () => {
      const req = orchestrator.analyzeTaskRequirements(
        "帮我写一个复杂的程序，需要详细分析数据，然后写一份报告，还要头脑风暴一些创意功能",
      );
      const members = orchestrator.formTeam(req);
      expect(members.length).toBeGreaterThanOrEqual(2);
      expect(members.length).toBeLessThanOrEqual(4);
    });
  });

  describe("runTeam with explicit members", () => {
    it("should use explicit members and skip dynamic formation", async () => {
      const explicitMembers: AgentProfile[] = [
        { role: "custom_expert", personality: "Custom.", expertise: ["custom"], allowedSkills: [] },
        { role: "custom_expert2", personality: "Custom2.", expertise: ["custom2"], allowedSkills: [] },
      ];

      const teamResponse = JSON.stringify({
        level: "team",
        protocol: "HIERARCHICAL",
        reasoning: "test",
        team: {
          members: explicitMembers,
        },
      });

      const chatSpy = vi.spyOn(deps.provider, "chat");
      chatSpy.mockResolvedValueOnce({ content: teamResponse });

      // Mock TeamAgent execution via provider
      chatSpy.mockResolvedValueOnce({
        content: '```json\n{"decision":"complete","summary":"Explicit team result"}\n```',
        toolCalls: [],
        finishReason: "stop",
      });

      const result = await orchestrator.run({
        message: "任意任务",
        userId: "test-user",
      });

      expect(result.level).toBe("team");
    });
  });

  describe.skip("runTeamStream", () => {
    // TODO: team_formed event not yet emitted in runStream
    it("should emit team_formed event with correct members", async () => {
      const teamResponse = JSON.stringify({
        level: "team",
        protocol: "SWARM",
        reasoning: "creative task",
        team: {
          members: [
            { role: "creative", expertise: ["creative"], personality: "创意思维" },
            { role: "writer", expertise: ["writing"], personality: "文案写作" },
          ],
        },
      });

      const chatSpy = vi.spyOn(deps.provider, "chat");
      let callCount = 0;
      chatSpy.mockImplementation(async (messages: Message[]) => {
        callCount++;
        if (callCount === 1) {
          return { content: teamResponse };
        }
        const content = messages[messages.length - 1]?.content ?? "";
        if (content.includes("handoff") || content.includes("移交")) {
          return { content: "Agent B final answer", toolCalls: [], finishReason: "stop" };
        }
        return {
          content: '```json\n{"handoff": true, "target": "writer", "reason": "creative writing"}\n```',
          toolCalls: [],
          finishReason: "stop",
        };
      });

      const events: { event: string; data?: Record<string, unknown> }[] = [];
      for await (const event of orchestrator.runStream({
        message: "帮我设计一个品牌文案",
        userId: "test-user",
      })) {
        events.push(event);
      }

      const teamFormedEvent = events.find((e) => e.event === "team_formed");
      expect(teamFormedEvent).toBeDefined();
      expect(teamFormedEvent!.data).toHaveProperty("members");
      const members = teamFormedEvent!.data!.members as string[];
      expect(members).toContain("creative");
      expect(members).toContain("writer");
      expect(teamFormedEvent!.data).toHaveProperty("protocol");
    });
  });
});
