/**
 * Expert Registry: 预定义的专家智能体注册表
 *
 * 用于动态团队组建时，根据任务需求自动匹配最合适的专家组合。
 */
import type { ExpertProfile } from "./types.js";
import { Protocol } from "./types.js";

export class ExpertRegistry {
  private experts = new Map<string, ExpertProfile>();

  constructor() {
    this.registerDefaults();
  }

  /** 注册一个专家 */
  register(expert: ExpertProfile): void {
    this.experts.set(expert.role, expert);
  }

  /** 根据技能/任务类型查找匹配的专家 */
  findExperts(criteria: { skills?: string[]; taskType?: string }): ExpertProfile[] {
    const { skills = [], taskType = "" } = criteria;
    const results: ExpertProfile[] = [];

    for (const expert of this.experts.values()) {
      let score = 0;

      // 技能匹配
      for (const skill of skills) {
        const skillLower = skill.toLowerCase();
        for (const exp of expert.expertise) {
          if (exp.toLowerCase().includes(skillLower) || skillLower.includes(exp.toLowerCase())) {
            score += 2;
          }
        }
        if (expert.role.toLowerCase().includes(skillLower) || skillLower.includes(expert.role.toLowerCase())) {
          score += 1;
        }
      }

      // 任务类型匹配
      if (taskType) {
        const taskLower = taskType.toLowerCase();
        for (const exp of expert.expertise) {
          if (exp.toLowerCase().includes(taskLower) || taskLower.includes(exp.toLowerCase())) {
            score += 1;
          }
        }
      }

      if (score > 0) {
        results.push(expert);
      }
    }

    return results;
  }

  /** 获取默认专家组合（通用配置） */
  getDefaultExperts(): ExpertProfile[] {
    return [
      this.experts.get("analyst")!,
      this.experts.get("writer")!,
    ].filter(Boolean);
  }

  /** 根据角色名获取单个专家 */
  getExpert(role: string): ExpertProfile | undefined {
    return this.experts.get(role);
  }

  /** 获取所有已注册的专家 */
  getAllExperts(): ExpertProfile[] {
    return Array.from(this.experts.values());
  }

  /** 注册内置默认专家 */
  private registerDefaults(): void {
    this.register({
      role: "researcher",
      expertise: ["信息检索", "事实核查", "资料整理", "文献分析", "调研"],
      personality:
        "你是一个严谨的研究员，擅长深度调研、资料整理和知识综合。你总是基于可靠来源进行信息检索，并对关键事实进行交叉验证。",
      preferredProtocol: Protocol.SWARM,
    });

    this.register({
      role: "coder",
      expertise: ["编程", "代码编写", "调试", "架构设计", "技术方案", "代码审查"],
      personality:
        "你是一个资深软件工程师，擅长代码分析、架构设计和技术方案。你注重代码质量、可维护性和最佳实践。",
      preferredProtocol: Protocol.SEQUENTIAL,
    });

    this.register({
      role: "analyst",
      expertise: ["数据分析", "逻辑推理", "报告撰写", "深度分析", "统计"],
      personality:
        "你是一个数据分析师，擅长深度分析、逻辑推理和报告撰写。你能够从复杂数据中提取洞察，并用清晰的逻辑呈现结论。",
      preferredProtocol: Protocol.HIERARCHICAL,
    });

    this.register({
      role: "writer",
      expertise: ["文案撰写", "翻译", "内容设计", "编辑", "写作"],
      personality:
        "你是一个专业的写作者，擅长文案撰写、翻译和内容设计。你能够根据目标受众调整文风，产出高质量的文字内容。",
      preferredProtocol: Protocol.SEQUENTIAL,
    });

    this.register({
      role: "planner",
      expertise: ["任务分解", "计划制定", "项目管理", "进度控制", "资源协调"],
      personality:
        "你是一个高效的项目规划师，擅长任务分解、计划制定和资源协调。你能够将复杂目标拆解为可执行的步骤。",
      preferredProtocol: Protocol.HIERARCHICAL,
    });

    this.register({
      role: "reviewer",
      expertise: ["代码审查", "质量检查", "错误检测", "优化建议", "评审"],
      personality:
        "你是一个严谨的审查员，擅长质量检查、错误发现和改进建议。你对细节有极高的敏感度，善于发现潜在问题。",
      preferredProtocol: Protocol.SEQUENTIAL,
    });

    this.register({
      role: "creative",
      expertise: ["创意生成", "头脑风暴", "概念设计", "创新思维", "策划"],
      personality:
        "你是一个富有创造力的创意专家，擅长创意生成、头脑风暴和概念设计。你能够跳出常规思维，提出新颖独特的想法。",
      preferredProtocol: Protocol.SWARM,
    });

    this.register({
      role: "domain_expert",
      expertise: ["领域知识", "中文历史", "科技", "医学", "法律", "金融"],
      personality:
        "你是一个博学多才的领域专家，在中文历史、科技、医学、法律、金融等多个领域都有深厚积累。你能够提供权威、准确的领域知识。",
      preferredProtocol: Protocol.HIERARCHICAL,
    });
  }
}
