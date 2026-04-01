/**
 * Team Agent: 智能体容器，通过协作协议驱动多专家协同
 *
 * 根据 TeamConfig 中指定的协议，创建子智能体并协调执行。
 */
import type {
  Agent,
  AgentDeps,
  AgentInput,
  AgentOutput,
  AgentProfile,
  AgentStreamEvent,
  Protocol,
  ProtocolExecutor,
  TeamConfig,
} from "./types.js";
import { SimpleAgent } from "./simple-agent.js";
import { ReactAgent } from "./react-agent.js";
import { SequentialExecutor } from "./protocols/sequential.js";
import { HierarchicalExecutor } from "./protocols/hierarchical.js";
import { SwarmExecutor } from "./protocols/swarm.js";
import { A2AExecutor } from "./protocols/a2a.js";
import { ContractNetExecutor } from "./protocols/contract-net.js";
import { MarketBasedExecutor } from "./protocols/market-based.js";
import { BlackboardExecutor } from "./protocols/blackboard.js";

export class TeamAgent implements Agent {
  readonly name: string;
  readonly level = "team" as const;
  readonly profile: AgentProfile;
  private deps: AgentDeps;
  private protocol: Protocol;
  private teamConfig: TeamConfig;
  private executor: ProtocolExecutor;

  constructor(
    protocol: Protocol,
    teamConfig: TeamConfig,
    deps: AgentDeps,
  ) {
    this.protocol = protocol;
    this.teamConfig = teamConfig;
    this.deps = deps;
    this.name = `team:${protocol}`;
    this.profile = {
      role: `team_${protocol.toLowerCase()}`,
      personality: `团队智能体，使用 ${protocol} 协议协调多个专家。`,
      expertise: ["协调", "任务分配"],
      allowedSkills: [],
    };
    this.executor = this.createExecutor(protocol);
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    return this.executor.execute(input, this.teamConfig, (profile) =>
      this.createSubAgent(profile),
    );
  }

  async *runStream(input: AgentInput): AsyncGenerator<AgentStreamEvent> {
    yield {
      event: "strategy_selected",
      data: {
        level: "team",
        protocol: this.protocol,
        members: this.teamConfig.members.map((m) => m.role),
      },
    };

    yield* this.executor.executeStream(input, this.teamConfig, (profile) =>
      this.createSubAgent(profile),
    );
  }

  private createSubAgent(profile: AgentProfile): Agent {
    // 如果 profile 有 allowedSkills，说明需要工具调用 → ReactAgent
    // 否则使用 SimpleAgent
    if (profile.allowedSkills.length > 0) {
      return new ReactAgent(profile, this.deps, { maxIterations: 10 });
    }
    return new SimpleAgent(profile, this.deps);
  }

  private createExecutor(protocol: Protocol): ProtocolExecutor {
    switch (protocol) {
      case "SEQUENTIAL":
        return new SequentialExecutor();
      case "HIERARCHICAL":
        return new HierarchicalExecutor(this.deps.provider);
      case "SWARM":
        return new SwarmExecutor(this.deps.provider);
      case "A2A":
        return new A2AExecutor(this.deps.provider);
      case "CONTRACT_NET":
        return new ContractNetExecutor(this.deps.provider);
      case "MARKET_BASED":
        return new MarketBasedExecutor(this.deps.provider);
      case "BLACKBOARD":
        return new BlackboardExecutor(this.deps.provider);
      default:
        throw new Error(`Unknown protocol: ${protocol}`);
    }
  }
}
