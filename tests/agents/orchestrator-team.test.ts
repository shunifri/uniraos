import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../../src/agents/orchestrator.js";
import { TeamAgent } from "../../src/agents/team-agent.js";
import { Protocol } from "../../src/agents/types.js";
import type { AgentDeps, TeamConfig } from "../../src/agents/types.js";
import type { LLMProvider } from "../../src/llm/types.js";
import type { SkillRegistry } from "../../src/registry/index.js";
import type { ExecutionEngine } from "../../src/engine/index.js";

function makeMockProvider(responseContent = "{}"): LLMProvider {
  return {
    chat: vi.fn().mockResolvedValue({ content: responseContent }),
    stream: vi.fn(),
  } as unknown as LLMProvider;
}

function makeMockRegistry(skillNames: string[] = []): SkillRegistry {
  const skills = skillNames.map((name) => ({
    name,
    visible: true,
    description: `${name} skill`,
    handler: vi.fn(),
    version: "1.0.0",
    dependencies: [],
    capabilities: [],
    timeout: 5000,
    retry: { maxRetries: 1, backoffMs: 100, backoffMultiplier: 1.5 },
    visible_: true,
  }));
  return {
    list: vi.fn().mockReturnValue(skills),
    listVisible: vi.fn().mockReturnValue(skills),
    lookup: vi.fn().mockReturnValue(null),
    register: vi.fn(),
  } as unknown as SkillRegistry;
}

function makeMockEngine(): ExecutionEngine {
  return {
    execute: vi.fn().mockResolvedValue({ success: false }),
  } as unknown as ExecutionEngine;
}

function makeDeps(providerResponse = "{}"): AgentDeps {
  return {
    provider: makeMockProvider(providerResponse),
    registry: makeMockRegistry(["web_search", "kb_search"]),
    engine: makeMockEngine(),
  };
}

describe("Orchestrator", () => {
  it("can be instantiated with deps and config", () => {
    const orchestrator = new Orchestrator(makeDeps());
    expect(orchestrator).toBeDefined();
  });

  it("updateDeps replaces provider/registry/engine", () => {
    const deps = makeDeps();
    const orchestrator = new Orchestrator(deps);
    const newProvider = makeMockProvider("{}");
    orchestrator.updateDeps({ provider: newProvider });
    // No error thrown — deps updated successfully
    expect(orchestrator).toBeDefined();
  });

  describe("analyzeStrategy", () => {
    it("returns react as default when LLM returns empty JSON", async () => {
      const deps = makeDeps("{}");
      const orchestrator = new Orchestrator(deps);
      const decision = await orchestrator.analyzeStrategy("tell me a joke");
      expect(decision.level).toBe("react");
    });

    it("forces react even when LLM says simple (simple mode disabled)", async () => {
      const responseJson = JSON.stringify({
        level: "simple",
        reasoning: "just a greeting",
        topicChange: false,
      });
      const deps = makeDeps(responseJson);
      const orchestrator = new Orchestrator(deps);
      const decision = await orchestrator.analyzeStrategy("hello");
      // simple is forced to react to ensure tool-use capability
      expect(decision.level).toBe("react");
      expect(decision.reasoning).toBe("just a greeting");
    });

    it("returns react strategy when LLM says react", async () => {
      const responseJson = JSON.stringify({
        level: "react",
        reasoning: "needs tool",
        topicChange: false,
      });
      const deps = makeDeps(responseJson);
      const orchestrator = new Orchestrator(deps);
      const decision = await orchestrator.analyzeStrategy("search for something");
      expect(decision.level).toBe("react");
    });

    it("detects topic change flag from LLM response", async () => {
      const responseJson = JSON.stringify({
        level: "react",
        reasoning: "different topic",
        topicChange: true,
      });
      const deps = makeDeps(responseJson);
      const orchestrator = new Orchestrator(deps);
      const decision = await orchestrator.analyzeStrategy("now tell me the weather");
      expect(decision.topicChange).toBe(true);
    });

    it("falls back to react when LLM throws", async () => {
      const deps = makeDeps();
      (deps.provider.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM error"));
      const orchestrator = new Orchestrator(deps);
      const decision = await orchestrator.analyzeStrategy("something");
      expect(decision.level).toBe("react");
    });

    it("falls back to react when team members < 2", async () => {
      const responseJson = JSON.stringify({
        level: "team",
        protocol: "HIERARCHICAL",
        reasoning: "complex task",
        topicChange: false,
        team: {
          members: [{ role: "coder", personality: "You are coder", expertise: [], allowedSkills: [] }],
          maxRounds: 3,
        },
      });
      const deps = makeDeps(responseJson);
      const orchestrator = new Orchestrator(deps);
      const decision = await orchestrator.analyzeStrategy("complex task");
      expect(decision.level).toBe("react");
      expect(decision.reasoning).toContain("降级");
    });
  });
});

describe("TeamAgent", () => {
  const twoMemberConfig: TeamConfig = {
    members: [
      { role: "coder", personality: "You are a coder", expertise: ["coding"], allowedSkills: [] },
      { role: "reviewer", personality: "You are a reviewer", expertise: ["review"], allowedSkills: [] },
    ],
    maxRounds: 2,
  };

  it("can be instantiated with SEQUENTIAL protocol", () => {
    const deps = makeDeps();
    const agent = new TeamAgent(Protocol.SEQUENTIAL, twoMemberConfig, deps);
    expect(agent).toBeDefined();
    expect(agent.level).toBe("team");
    expect(agent.name).toBe("team:SEQUENTIAL");
  });

  it("can be instantiated with HIERARCHICAL protocol", () => {
    const deps = makeDeps();
    const agent = new TeamAgent(Protocol.HIERARCHICAL, twoMemberConfig, deps);
    expect(agent).toBeDefined();
  });

  it("can be instantiated with SWARM protocol", () => {
    const deps = makeDeps();
    const agent = new TeamAgent(Protocol.SWARM, twoMemberConfig, deps);
    expect(agent).toBeDefined();
  });

  it("can be instantiated with A2A protocol", () => {
    const deps = makeDeps();
    const agent = new TeamAgent(Protocol.A2A, twoMemberConfig, deps);
    expect(agent).toBeDefined();
  });

  it("can be instantiated with CONTRACT_NET protocol", () => {
    const deps = makeDeps();
    const agent = new TeamAgent(Protocol.CONTRACT_NET, twoMemberConfig, deps);
    expect(agent).toBeDefined();
  });

  it("can be instantiated with MARKET_BASED protocol", () => {
    const deps = makeDeps();
    const agent = new TeamAgent(Protocol.MARKET_BASED, twoMemberConfig, deps);
    expect(agent).toBeDefined();
  });

  it("can be instantiated with BLACKBOARD protocol", () => {
    const deps = makeDeps();
    const agent = new TeamAgent(Protocol.BLACKBOARD, twoMemberConfig, deps);
    expect(agent).toBeDefined();
  });

  it("throws on unknown protocol", () => {
    const deps = makeDeps();
    expect(
      () => new TeamAgent("UNKNOWN" as Protocol, twoMemberConfig, deps),
    ).toThrow("Unknown protocol");
  });

  it("has correct profile", () => {
    const deps = makeDeps();
    const agent = new TeamAgent(Protocol.SEQUENTIAL, twoMemberConfig, deps);
    expect(agent.profile.role).toBe("team_sequential");
    expect(agent.profile.expertise).toContain("协调");
  });
});
