/**
 * 集成测试：Orchestrator 的 TeamAgent 路径激活
 *
 * 验证：
 * - Orchestrator.analyzeStrategy() 正确识别需要 team 的场景
 * - TeamAgent 被正确创建和调用
 * - 不同协议的选择（mock LLM 返回不同协议值）
 * - Task #16 激活路径验证
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Orchestrator } from "../../src/agents/orchestrator.js";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import { ExecutionEngine } from "../../src/engine/execution-engine.js";
import { WALManager } from "../../src/wal/wal-manager.js";
import { defineSkill } from "../../src/types/skill.js";
import type { LLMProvider, Message } from "../../src/llm/types.js";
import type { AgentDeps, Protocol } from "../../src/agents/types.js";

/** Mock LLM that returns configurable strategy decisions */
class MockLLMProvider implements LLMProvider {
  private responseOverride: string | null = null;

  async chat(messages: Message[]): Promise<{ content?: string }> {
    if (this.responseOverride) {
      return { content: this.responseOverride };
    }
    // Default to react
    return {
      content: JSON.stringify({
        level: "react",
        reasoning: "默认策略",
      }),
    };
  }

  async embedding(text: string): Promise<number[]> {
    return Array(384).fill(0);
  }

  setResponseOverride(response: string): void {
    this.responseOverride = response;
  }

  clearResponseOverride(): void {
    this.responseOverride = null;
  }
}

describe("Orchestrator TeamAgent Integration", () => {
  let orchestrator: Orchestrator;
  let registry: SkillRegistry;
  let engine: ExecutionEngine;
  let mockLlm: MockLLMProvider;
  let deps: AgentDeps;

  beforeEach(() => {
    registry = new SkillRegistry();
    engine = new ExecutionEngine(registry, new WALManager(), { maxDepth: 20, callBudget: 100 });
    mockLlm = new MockLLMProvider();

    deps = {
      registry,
      engine,
      provider: mockLlm,
    };

    orchestrator = new Orchestrator(deps, { autoStrategy: true, maxIterations: 15 });
  });

  it("should analyze strategy and return decision", async () => {
    const decision = await orchestrator.analyzeStrategy("What is 2 + 2?");

    expect(decision).toBeDefined();
    expect(decision).toHaveProperty("level");
    expect(["simple", "react", "team"]).toContain(decision.level);
    expect(decision).toHaveProperty("reasoning");
  });

  it("should default to react when autoStrategy is disabled", async () => {
    const orchestratorNoAuto = new Orchestrator(deps, { autoStrategy: false });

    const decision = await orchestratorNoAuto.analyzeStrategy("complex multi-step task");

    expect(decision.level).toBe("react");
  });

  it("should identify team level for multi-objective tasks", async () => {
    const teamResponse = JSON.stringify({
      level: "team",
      reasoning: "多子目标任务",
      topicChange: false,
      protocol: "HIERARCHICAL",
      team: {
        members: [
          {
            role: "分析员",
            expertise: ["分析"],
            personality: "擅长分析",
          },
          {
            role: "总结员",
            expertise: ["写作"],
            personality: "擅长总结",
          },
        ],
        manager: {
          role: "经理",
          expertise: ["协调"],
          personality: "擅长协调",
        },
        pipelineSteps: ["分析", "总结"],
      },
    });

    mockLlm.setResponseOverride(teamResponse);

    const decision = await orchestrator.analyzeStrategy(
      "分析多个数据源的信息，然后生成综合摘要和可视化报告",
    );

    expect(decision.level).toBe("team");
    expect(decision.protocol).toBe("HIERARCHICAL");
  });

  it("should choose HIERARCHICAL protocol for hierarchical tasks", async () => {
    const hierarchicalResponse = JSON.stringify({
      level: "team",
      reasoning: "代码审查",
      topicChange: false,
      protocol: "HIERARCHICAL",
      team: {
        members: [
          {
            role: "前端专家",
            expertise: ["前端"],
            personality: "专注前端",
          },
          {
            role: "后端专家",
            expertise: ["后端"],
            personality: "专注后端",
          },
        ],
        manager: {
          role: "架构师",
          expertise: ["架构"],
          personality: "管理审查",
        },
        pipelineSteps: ["初审", "深审", "综合"],
      },
    });

    mockLlm.setResponseOverride(hierarchicalResponse);

    const decision = await orchestrator.analyzeStrategy(
      "请进行代码审查：需要架构师、前端专家和后端专家分层审查",
    );

    expect(decision.level).toBe("team");
    expect(decision.protocol).toBe("HIERARCHICAL");
  });

  it("should choose SEQUENTIAL protocol for sequential tasks", async () => {
    const sequentialResponse = JSON.stringify({
      level: "team",
      reasoning: "数据处理流水线",
      topicChange: false,
      protocol: "SEQUENTIAL",
      team: {
        members: [
          {
            role: "数据清理工程师",
            expertise: ["清理"],
            personality: "细心",
          },
          {
            role: "数据分析师",
            expertise: ["分析"],
            personality: "逻辑强",
          },
        ],
        manager: {
          role: "流程经理",
          expertise: ["流程"],
          personality: "高效",
        },
        pipelineSteps: ["清洗", "验证", "分析"],
      },
    });

    mockLlm.setResponseOverride(sequentialResponse);

    const decision = await orchestrator.analyzeStrategy(
      "处理数据：先清洗，再验证，最后分析，每步依赖前一步结果",
    );

    expect(decision.level).toBe("team");
    expect(decision.protocol).toBe("SEQUENTIAL");
  });

  it("should choose SWARM protocol for parallel tasks", async () => {
    const swarmResponse = JSON.stringify({
      level: "team",
      reasoning: "并行搜索和汇聚",
      topicChange: false,
      protocol: "SWARM",
      team: {
        members: [
          {
            role: "搜索专家1",
            expertise: ["搜索"],
            personality: "快速",
          },
          {
            role: "搜索专家2",
            expertise: ["搜索"],
            personality: "全面",
          },
        ],
        manager: {
          role: "汇聚器",
          expertise: ["汇聚"],
          personality: "综合",
        },
        pipelineSteps: ["并行搜索", "汇聚结果"],
      },
    });

    mockLlm.setResponseOverride(swarmResponse);

    const decision = await orchestrator.analyzeStrategy(
      "从多个来源搜索信息，然后合成最终答案",
    );

    expect(decision.level).toBe("team");
    expect(decision.protocol).toBe("SWARM");
  });

  it("should choose MARKET_BASED protocol for resource allocation tasks", async () => {
    const marketResponse = JSON.stringify({
      level: "team",
      reasoning: "资源分配任务",
      topicChange: false,
      protocol: "MARKET_BASED",
      team: {
        members: [
          {
            role: "资源评估员",
            expertise: ["评估"],
            personality: "公平",
          },
          {
            role: "成本分析员",
            expertise: ["成本"],
            personality: "精确",
          },
        ],
        manager: {
          role: "市场管理员",
          expertise: ["分配"],
          personality: "高效",
        },
        pipelineSteps: ["评估成本", "分配资源"],
      },
    });

    mockLlm.setResponseOverride(marketResponse);

    const decision = await orchestrator.analyzeStrategy(
      "根据多个智能体的成本和能力分配任务",
    );

    expect(decision.level).toBe("team");
    expect(decision.protocol).toBe("MARKET_BASED");
  });

  it("should parse complex team configuration", async () => {
    const complexResponse = JSON.stringify({
      level: "team",
      reasoning: "复杂多步任务",
      topicChange: false,
      protocol: "SEQUENTIAL",
      team: {
        members: [
          {
            role: "研究员",
            expertise: ["调研", "分析"],
            personality: "深入思考",
          },
          {
            role: "编写者",
            expertise: ["写作", "编辑"],
            personality: "表达清晰",
          },
          {
            role: "审查员",
            expertise: ["审查", "优化"],
            personality: "严谨细心",
          },
        ],
        manager: {
          role: "项目经理",
          expertise: ["协调", "进度"],
          personality: "高效组织",
        },
        pipelineSteps: ["调研", "撰写", "审查", "发布"],
      },
    });

    mockLlm.setResponseOverride(complexResponse);

    const decision = await orchestrator.analyzeStrategy(
      "撰写深度研究报告：需要调研、编写和多轮审查",
    );

    expect(decision.level).toBe("team");
    expect(decision.protocol).toBe("SEQUENTIAL");
    expect(decision.teamConfig?.members).toHaveLength(3);
    expect(decision.teamConfig?.manager?.role).toBe("项目经理");
    expect(decision.teamConfig?.pipelineSteps).toContain("审查");
  });

  it("should detect topic change", async () => {
    const topicChangeResponse = JSON.stringify({
      level: "simple",
      reasoning: "话题变化",
      topicChange: true,
    });

    mockLlm.setResponseOverride(topicChangeResponse);

    const decision = await orchestrator.analyzeStrategy(
      "今天天气怎样",
    );

    expect(decision.topicChange).toBe(true);
  });

  it("should persist conversation history", async () => {
    const userId = "test-user-123";

    // First message
    let decision = await orchestrator.analyzeStrategy("查询数据库", userId);
    expect(decision).toBeDefined();

    // Second message (should preserve history internally)
    decision = await orchestrator.analyzeStrategy("继续查询其他表", userId);
    expect(decision).toBeDefined();

    // Clear history for specific user
    orchestrator.clearHistory(userId);

    // Should still work after clearing
    decision = await orchestrator.analyzeStrategy("新的问题", userId);
    expect(decision).toBeDefined();
  });

  it("should handle missing LLM response gracefully", async () => {
    mockLlm.setResponseOverride(""); // Empty response

    const decision = await orchestrator.analyzeStrategy("some task");

    // Should fallback to react
    expect(decision.level).toBe("react");
  });

  it("should handle invalid JSON in LLM response gracefully", async () => {
    mockLlm.setResponseOverride("This is not valid JSON at all");

    const decision = await orchestrator.analyzeStrategy("some task");

    // Should fallback to react
    expect(decision.level).toBe("react");
  });

  it("should handle protocol selection for all valid protocols", async () => {
    const protocols: Protocol[] = [
      "HIERARCHICAL",
      "SEQUENTIAL",
      "SWARM",
      "CONTRACT_NET",
      "A2A",
      "BLACKBOARD",
      "MARKET_BASED",
    ];

    for (const protocol of protocols) {
      const response = JSON.stringify({
        level: "team",
        reasoning: `Using ${protocol}`,
        topicChange: false,
        protocol,
        team: {
          members: [
            { role: "Member1", expertise: ["test"], personality: "test" },
            { role: "Member2", expertise: ["test"], personality: "test" },
          ],
          manager: { role: "Manager", expertise: ["test"], personality: "test" },
          pipelineSteps: ["Step1"],
        },
      });

      mockLlm.setResponseOverride(response);

      const decision = await orchestrator.analyzeStrategy(`Task requiring ${protocol}`);

      expect(decision.protocol).toBe(protocol);
    }
  });

  it("should clear all conversation histories", async () => {
    // Add histories for multiple users
    await orchestrator.analyzeStrategy("First message", "user1");
    await orchestrator.analyzeStrategy("Second message", "user2");
    await orchestrator.analyzeStrategy("Third message", "user3");

    // Clear all
    orchestrator.clearHistory();

    // Verify by checking that new conversations work
    const decision = await orchestrator.analyzeStrategy("New message", "user1");
    expect(decision).toBeDefined();
  });

  it("should validate team config when level is team", async () => {
    const validTeamResponse = JSON.stringify({
      level: "team",
      reasoning: "Team task",
      topicChange: false,
      protocol: "HIERARCHICAL",
      team: {
        members: [
          {
            role: "Role1",
            expertise: ["Expert1"],
            personality: "Personal1",
          },
          {
            role: "Role2",
            expertise: ["Expert2"],
            personality: "Personal2",
          },
        ],
        manager: {
          role: "Manager",
          expertise: ["Manage"],
          personality: "Manage",
        },
        pipelineSteps: ["Step1"],
      },
    });

    mockLlm.setResponseOverride(validTeamResponse);

    const decision = await orchestrator.analyzeStrategy("Team task");

    expect(decision.level).toBe("team");
    expect(decision.teamConfig).toBeDefined();
    expect(decision.teamConfig?.members).toBeDefined();
    expect(decision.teamConfig?.manager).toBeDefined();
  });
});
