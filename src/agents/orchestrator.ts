/**
 * Orchestrator: 智能策略选择器
 *
 * 自动分析用户输入的任务复杂度和性质，决定：
 * 1. 使用哪个级别的智能体（Simple / ReAct / Team）
 * 2. 如果是 Team，选择哪种协作协议
 * 3. 自动组建团队成员
 *
 * 决策依据：
 * - 任务类型（问答/执行/分析/创作等）
 * - 复杂度（单步/多步/跨领域）
 * - 是否需要工具调用
 * - 是否需要多专家协作
 */
import type { LLMProvider, Message } from "../llm/types.js";
import type { SkillRegistry } from "../registry/index.js";
import type { ExecutionEngine } from "../engine/index.js";
import type {
  AgentDeps,
  AgentInput,
  AgentOutput,
  AgentProfile,
  AgentStreamEvent,
  StrategyDecision,
  TeamConfig,
  StrategyConfig,
} from "./types.js";
import { Protocol } from "./types.js";
import { SimpleAgent } from "./simple-agent.js";
import { ReactAgent } from "./react-agent.js";
import { TeamAgent } from "./team-agent.js";
import { PlanAgent } from "./plan-agent.js";
import { requestContext } from "../user/request-context.js";

/** 单用户的对话历史（精简版，只保留 user/assistant） */
interface UserConversation {
  history: Message[];
  lastActive: number;
}

const MAX_HISTORY_TURNS = 20; // 最多保留最近 20 轮（40 条消息）
const MAX_HISTORY_CHARS = 16000; // 历史总字符数上限

/** 工具使用规范（注入到所有 Agent 的 system prompt 末尾） */
const TOOL_USAGE_GUIDELINES = `

## 工具使用规范

### 信息检索优先级（必须严格遵守！）
1. **首先**检查系统自动注入的"相关知识"（上方），如果内容与用户问题**确实相关**，优先基于这些知识来回答
2. **其次**，如果自动注入的知识不够充分或**与问题不相关**，主动调用 kb_search 用不同关键词检索知识库
3. **最后**，当知识库确实没有相关内容时，使用 web_search 搜索互联网
- 知识库是用户上传的专属资料，**但只有在内容与问题相关时才引用**
- **严禁强行引用不相关的知识库结果**——如果检索到的内容与用户提问主题不匹配，应忽略这些结果
- **回答必须忠于原文内容，禁止编造知识库中不存在的信息**
- 如果知识库中没有相关信息，坦诚告知用户，然后通过网络搜索等其他方式回答

### 用户交互（极其重要！）
以下场景**必须**使用 user_confirm 技能，**绝对不能直接回答**：

1. **当用户需要填报个人信息时**
   - 例如："我要填报下个人信息"
   - **必须**调用 user_confirm 收集表单信息（姓名、邮箱、电话、地址等）

2. **需要用户提供信息/确认时**
   - 用户请求需要多个选项的问题（如"我想学习编程，给我些建议"）
   - 需要确认用户偏好、目标、时间安排、预算等个性化信息
   - 问题描述不够清晰，需要用户补充细节

3. **推荐/选择类问题**
   - 提供推荐时，应先询问用户的偏好（如学习方向、风格、优先级等）
   - 有多个方案可供选择时，使用 selection 模式展示选项供用户选择

4. **制定计划/方案时**
   - 制定学习计划、工作计划、旅行计划等
   - 确认用户的时间安排、目标、预算等关键参数

**user_confirm 使用示例（必须严格遵守！）**：
- 场景："我要填报下个人信息" → 使用 type="form" 收集姓名、邮箱、电话
- 场景："我想学习编程" → 使用 type="selection" 提供选项（前端开发、后端开发、数据分析等）
- 场景："帮我制定学习计划" → 使用 type="form" 收集学习时间、目标、预算

**使用规范**：
- type: "selection" — 用于提供选项供用户选择（单选或多选）
- type: "form" — 用于收集表单信息（用户输入）
- type: "approval" — 用于简单的确认/取消操作
- title: 卡片标题，清晰说明交互目的
- description: 补充说明，解释为什么需要这些信息

### 降低幻觉（极其重要！）
- 如果知识库或上下文中有**相关**内容，**必须基于原文回答**，不要凭空生成
- 如果没有找到相关信息，明确告知用户"知识库中未找到相关信息"，不要编造
- 回答时尽量引用来源（如文档名称），让用户知道信息出处
- 不确定的信息要标注"根据知识库信息"或"以下仅供参考"
- **不要把不相关的知识库结果与用户提问强行关联，这是一种幻觉行为**

### 网络搜索引用规范
- 使用 web_search / web_fetch 获取信息后，**必须在回答中标注来源 URL**
- 格式：在引用的信息后标注 [来源](URL)，例如 [来源](https://example.com/article)
- 如果从多个网页获取信息，每条信息都应标注各自的来源
- 让用户能够验证信息的真实性

### 数据可视化
当你获取到结构化数据（统计数据、趋势数据、分布数据、对比数据等）时，**必须**使用 chart 相关 skill 生成可视化图表来呈现：
- chart_recommend: 根据数据推荐合适的图表类型
- chart_generate: 生成单个图表（支持 bar/line/pie/scatter/area/radar/heatmap/treemap 等）
- chart_multi: 生成多图表组合看板

使用 chart_generate 时传入 data 数组和适当的 chartType。例如查询到日志统计数据后，应生成柱状图或折线图展示趋势。

### 数据库查询
- 查询 MySQL 数据库时使用 mysql_query（需要传 connection 参数）
- 查询 SQLite 时使用 db_query
- 执行写操作分别使用 mysql_execute / db_execute

### 记忆管理
- 重要的对话结论、用户偏好，应主动存入短期记忆（stm_store）
- 需要长期保存的知识使用 ltm_store

### 输出格式
- 回复使用 Markdown 格式
- 代码块标注语言类型
- 表格数据优先用图表展示，其次用 Markdown 表格`;


/** 默认 Profile 模板 */
const DEFAULT_PROFILES: Record<string, AgentProfile> = {
  general: {
    role: "通用助手",
    personality: "你是一个友善的 AI 助手，擅长回答各类问题。",
    expertise: ["通用知识", "问答"],
    allowedSkills: [],
  },
  coder: {
    role: "编程专家",
    personality: "你是一个资深软件工程师，擅长代码分析、架构设计和技术方案。",
    expertise: ["编程", "架构", "调试"],
    allowedSkills: [],
  },
  analyst: {
    role: "分析师",
    personality: "你是一个数据分析师，擅长深度分析、逻辑推理和报告撰写。",
    expertise: ["数据分析", "逻辑推理", "报告"],
    allowedSkills: [],
  },
  creative: {
    role: "创意专家",
    personality: "你是一个创意工作者，擅长文案撰写、创意策划和内容设计。",
    expertise: ["文案", "创意", "设计"],
    allowedSkills: [],
  },
  researcher: {
    role: "研究员",
    personality: "你是一个研究员，擅长深度调研、资料整理和知识综合。",
    expertise: ["调研", "知识整合", "文献分析"],
    allowedSkills: [],
  },
  reviewer: {
    role: "审查员",
    personality: "你是一个严谨的审查员，擅长质量检查、错误发现和改进建议。",
    expertise: ["质量审查", "错误检测", "优化建议"],
    allowedSkills: [],
  },
};

/** Orchestrator 配置 */
export interface OrchestratorConfig {
  /** 是否启用自动策略选择（关闭则始终用 ReAct） */
  autoStrategy: boolean;
  /** 默认 ReAct Agent 的 system prompt */
  defaultSystemPrompt?: string;
  /** ReAct 最大迭代次数 */
  maxIterations: number;
  /** 策略资源配置 */
  strategyConfig?: StrategyConfig;
}

const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  autoStrategy: true,
  maxIterations: 15,
};

export class Orchestrator {
  private deps: AgentDeps;
  private config: OrchestratorConfig;
  /** 每用户对话历史 */
  private userConversations = new Map<string, UserConversation>();
  /** 记忆分析防抖：用户 → 上次分析时间 */
  private lastAnalysisTime = new Map<string, number>();

  constructor(deps: AgentDeps, config?: Partial<OrchestratorConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
  }

  /** 更新依赖（如 LLM provider 变更时） */
  updateDeps(deps: Partial<AgentDeps>): void {
    if (deps.registry) this.deps.registry = deps.registry;
    if (deps.engine) this.deps.engine = deps.engine;
    if (deps.provider) this.deps.provider = deps.provider;
  }

  /** 清空指定用户的对话历史 */
  clearHistory(userId?: string): void {
    if (userId) {
      this.userConversations.delete(userId);
    } else {
      this.userConversations.clear();
    }
  }

  /** 获取用户对话历史（精简版） */
  private getUserHistory(userId: string): Message[] {
    return this.userConversations.get(userId)?.history ?? [];
  }

  /** 截断历史到最近 N 条消息（话题变化时使用） */
  private truncateHistory(userId: string, keepCount: number): void {
    const conv = this.userConversations.get(userId);
    if (!conv || conv.history.length <= keepCount) return;
    conv.history = conv.history.slice(-keepCount);
  }

  /** 追加消息到历史（支持 user/assistant/tool 摘要） */
  private appendHistory(userId: string, role: "user" | "assistant", content: string): void {
    let conv = this.userConversations.get(userId);
    if (!conv) {
      conv = { history: [], lastActive: Date.now() };
      this.userConversations.set(userId, conv);
    }
    conv.history.push({ role, content });
    conv.lastActive = Date.now();

    // 裁剪：保留最近 N 轮
    while (conv.history.length > MAX_HISTORY_TURNS * 2) {
      conv.history.shift();
    }

    // 裁剪：总字符数上限
    let totalChars = conv.history.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
    while (totalChars > MAX_HISTORY_CHARS && conv.history.length > 2) {
      const removed = conv.history.shift();
      totalChars -= removed?.content?.length ?? 0;
    }
  }

  /** 记录本轮 tool 调用摘要到历史（在 assistant 回复之前追加） */
  private recordToolSummary(userId: string, toolSummaries: string[]): void {
    if (toolSummaries.length === 0) return;
    const conv = this.userConversations.get(userId);
    if (!conv) return;
    // 把 tool 调用摘要作为 assistant 消息的前缀追加
    const summary = `[本轮使用工具: ${toolSummaries.join("; ")}]`;
    conv.history.push({ role: "assistant", content: summary });
  }

  /** 生成最近对话历史的摘要（用于策略分析） */
  private getRecentHistorySummary(userId: string, maxTurns = 6): string {
    const history = this.getUserHistory(userId);
    if (history.length === 0) return "";

    const recent = history.slice(-maxTurns);
    const lines: string[] = [];
    for (const msg of recent) {
      const label = msg.role === "user" ? "用户" : "助手";
      const text = (msg.content ?? "").slice(0, 200);
      lines.push(`${label}: ${text}`);
    }
    return lines.join("\n");
  }

  /** KB 引用数据（每次对话后重置） */
  private lastKbReferences: Array<{
    index: number; docId: string; docName: string;
    chunkIndex: number; content: string; score: number;
    pageNumber: number | null;
    bboxes: Array<{ page: number; bbox: [number, number, number, number] }> | null;
  }> = [];

  /** Web 引用数据（每次对话后重置，从 tool_result 中收集） */
  private lastWebReferences: Array<{
    index: number; title: string; url: string; snippet?: string;
  }> = [];

  /** 获取最近一次对话的 KB 引用 */
  getLastKbReferences() {
    return this.lastKbReferences;
  }

  /** 获取最近一次对话的 Web 引用 */
  getLastWebReferences() {
    return this.lastWebReferences;
  }

  /** 从 tool_result 事件中收集 web 引用 */
  collectWebReferences(skillName: string, result: any): void {
    if (!result?.success || !result?.data) return;
    const data = result.data;

    if (skillName === "web_search" && Array.isArray(data.results)) {
      for (const r of data.results) {
        if (r.url && !this.lastWebReferences.some((w) => w.url === r.url)) {
          this.lastWebReferences.push({
            index: this.lastWebReferences.length + 1,
            title: r.title || r.url,
            url: r.url,
            snippet: r.snippet,
          });
        }
      }
    } else if (skillName === "web_fetch" && data.url) {
      if (!this.lastWebReferences.some((w) => w.url === data.url)) {
        this.lastWebReferences.push({
          index: this.lastWebReferences.length + 1,
          title: data.title || data.url,
          url: data.url,
        });
      }
    }
  }

  /** 检索 LTM 记忆，返回上下文字符串 */
  private async recallMemories(userMessage: string): Promise<string> {
    this.lastKbReferences = [];
    this.lastWebReferences = [];
    const now = new Date();
    const hour = now.getHours();
    const timeGreeting = hour < 12 ? "早上" : hour < 18 ? "下午" : "晚上";
    let context = `\n\n## 当前时间\n${now.toLocaleString("zh-CN")}（${timeGreeting}）`;

    try {
      const skills = this.deps.registry.list();
      const hasLtmSearch = skills.some((s) => s.name === "ltm_search");
      const hasKbSearch = skills.some((s) => s.name === "kb_search");
      const hasLtmList = skills.some((s) => s.name === "ltm_list");
      const hasGraphQuery = skills.some((s) => s.name === "graph_query");

      // 并行检索 LTM、知识库和知识图谱
      const promises: Promise<{ type: string; data: any } | null>[] = [];

      if (hasLtmSearch) {
        // 对于身份查询问题，直接检索用户信息相关的记忆
        const isIdentityQuery = userMessage.includes("我是谁") || userMessage.includes("你知道我吗") || userMessage.includes("我的名字");

        if (isIdentityQuery) {
          // 首先尝试搜索用户相关信息
          promises.push(
            Promise.race([
              this.deps.engine.execute("ltm_search", { query: "user_name user_identity name 姓名 身份 user", limit: 10 }).then((r) => r.success ? { type: "ltm", data: r.data } : null),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
            ]).catch(() => null)
          );
          // 同时也尝试列出所有记忆，确保不遗漏
          if (hasLtmList) {
            promises.push(
              Promise.race([
                this.deps.engine.execute("ltm_list", { limit: 20 }).then((r) => r.success ? { type: "ltm_list", data: r.data } : null),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
              ]).catch(() => null)
            );
          }
        } else {
          promises.push(
            Promise.race([
              this.deps.engine.execute("ltm_search", { query: userMessage, limit: 5 }).then((r) => r.success ? { type: "ltm", data: r.data } : null),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
            ]).catch(() => null)
          );
        }
      }

      if (hasKbSearch) {
        promises.push(
          Promise.race([
            this.deps.engine.execute("kb_search", { query: userMessage, limit: 5, threshold: 0.35 }).then((r) => r.success ? { type: "kb", data: r.data } : null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
          ]).catch(() => null)
        );
      }

      if (hasGraphQuery) {
        // 查询知识图谱
        promises.push(
          Promise.race([
            this.deps.engine.execute("graph_query", { query: userMessage, maxDepth: 2, maxNodes: 20 }).then((r) => r.success ? { type: "graph", data: r.data } : null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
          ]).catch(() => null)
        );
      }

      const results = await Promise.all(promises);

      // 收集所有 LTM 记忆
      const allLtmEntries: Array<{ key: string; value: unknown; summary?: string; tags?: string[] }> = [];

      for (const res of results) {
        if (!res || !res.data || typeof res.data !== "object") continue;

        if (res.type === "ltm") {
          const data = res.data as { results?: Array<{ key: string; value: unknown; summary?: string; tags?: string[] }> };
          if (data.results && data.results.length > 0) {
            allLtmEntries.push(...data.results);
          }
        }

        if (res.type === "ltm_list") {
          const data = res.data as { entries?: Array<{ key: string; value: unknown; summary?: string; tags?: string[] }> };
          if (data.entries && data.entries.length > 0) {
            // 过滤出用户信息相关的记忆
            const userEntries = data.entries.filter((e) =>
              e.key.toLowerCase().includes("user") ||
              e.key.toLowerCase().includes("name") ||
              e.key.toLowerCase().includes("identity") ||
              e.key.toLowerCase().includes("姓名") ||
              e.key.toLowerCase().includes("身份")
            );
            allLtmEntries.push(...userEntries);
          }
        }
      }

      // 如果有 LTM 记忆，添加到上下文
      if (allLtmEntries.length > 0) {
        context += `\n\n## 你对用户的了解（内部参考，禁止直接列举给用户）\n`;
        for (const r of allLtmEntries) {
          const val = r.summary || (typeof r.value === "string" ? r.value : JSON.stringify(r.value));
          context += `- [${r.key}] ${String(val).slice(0, 300)}\n`;
        }
      }

      // 处理知识图谱数据
      for (const res of results) {
        if (!res || !res.data || typeof res.data !== "object") continue;

        if (res.type === "graph") {
          const graphData = res.data;
          if (graphData.nodes && graphData.nodes.length > 0) {
            // 构建知识图谱上下文
            const nodeLines: string[] = [];
            for (const node of graphData.nodes.slice(0, 10)) { // 最多显示 10 个节点
              const nodeInfo = `[${node.label}] ${node.properties?.value || "无内容"}`;
              nodeLines.push(nodeInfo);
            }

            if (nodeLines.length > 0) {
              context += `\n\n## 个人记忆知识图谱\n${nodeLines.join("\n")}\n\n⚠️ 知识图谱使用规则（必须严格遵守）：
- 知识图谱包含用户的个人记忆和关系网络
- 仅当知识图谱内容与用户问题**确实相关**时才引用
- 如果知识图谱结果与用户问题**不相关**（主题不匹配），则**忽略这些结果**，不要引用
- 禁止基于不相关的知识图谱内容编造关联关系`;
            }
          }
        }

        if (res.type === "kb") {
          // kb_search 现在返回的是直接在 data 字段中的数组
          if (res.data && Array.isArray(res.data) && res.data.length > 0) {
            // 编号引用，存储引用列表
            this.lastKbReferences = res.data.map((r: any, i: number) => ({
              index: i + 1,
              docId: r.docId,
              docName: r.docName,
              chunkIndex: r.chunkIndex,
              content: r.content,
              score: r.score,
              pageNumber: r.pageNumber ?? null,
              bboxes: r.bboxes ?? null,
            }));

            const kbLines = this.lastKbReferences.map(
              (r) => `[^${r.index}] 来源:《${r.docName}》第${r.chunkIndex + 1}段 — ${r.content.slice(0, 400)}${r.content.length > 400 ? "..." : ""}`
            );
            context += `\n\n## 相关知识（来自用户知识库）\n${kbLines.join("\n\n")}\n\n⚠️ 引用规则（必须严格遵守）：
- **引用格式**：在回答中引用知识库内容时，**必须**在对应语句末尾使用 [^编号] 标注来源，如"该项目要求供应商具备XX资质[^1]"
- 每条引用的编号对应上方的知识库条目编号
- 仅当知识库内容与用户问题**确实相关**时才引用
- 如果以上知识库结果与用户问题**不相关**（主题不匹配），则**忽略这些结果**，不要引用
- 禁止基于不相关的知识库内容编造关联关系
- 如果知识库中没有直接相关的信息，明确告知用户"知识库中未找到相关信息"，然后再用其他方式回答`;
          }
        }
      }
    } catch {
      // 静默失败
    }
    return context;
  }

  /** 构建带历史和记忆的 AgentInput */
  private async buildEnrichedInput(input: AgentInput & { userId?: string }): Promise<AgentInput> {
    const userId = input.userId ?? "__default__";

    // 检索记忆
    const memoryContext = await this.recallMemories(input.message);

    // 获取对话历史
    const history = this.getUserHistory(userId);

    // 记录用户消息
    this.appendHistory(userId, "user", input.message);

    return {
      ...input,
      history,
      context: {
        ...input.context,
        memoryContext: memoryContext + TOOL_USAGE_GUIDELINES,
      },
    };
  }

  /** 记录助手回复到历史 */
  private recordAssistantReply(userId: string, response: string): void {
    this.appendHistory(userId, "assistant", response);
  }

  /** 执行任务，自动选择策略 */
  async run(input: AgentInput & { userId?: string }): Promise<AgentOutput> {
    const userId = input.userId ?? "__default__";

    // 在对话开始时重置引用，确保不显示上一次对话的残留引用
    this.lastKbReferences = [];
    this.lastWebReferences = [];

    let result: AgentOutput;
    if (!this.config.autoStrategy) {
      const enrichedInput = await this.buildEnrichedInput(input);
      result = await this.runReact(enrichedInput);
    } else {
      const decision = await this.analyzeStrategy(input.message, userId);
      // 话题变化时截断历史，只保留最近 1 轮
      if (decision.topicChange) {
        this.truncateHistory(userId, 2);
      }
      const enrichedInput = await this.buildEnrichedInput(input);
      switch (decision.level) {
        case "simple":
          result = await this.runSimple(enrichedInput);
          break;
        case "plan":
          result = await this.runPlan(enrichedInput);
          break;
        case "team":
          result = await this.runTeam(enrichedInput, decision);
          break;
        default:
          result = await this.runReact(enrichedInput);
      }
    }

    // 记录 tool 调用摘要
    const toolNames = result.steps
      ?.filter((s) => s.type === "tool_call")
      .map((s) => (s.data as any)?.name ?? "unknown") ?? [];
    if (toolNames.length > 0) {
      this.recordToolSummary(userId, toolNames);
    }

    this.recordAssistantReply(userId, result.response);
    // 异步分析对话记忆（fire-and-forget）
    this.analyzeConversationMemory(userId, input.message, result.response);
    return result;
  }

  /** 流式执行 */
  async *runStream(input: AgentInput & { userId?: string }): AsyncGenerator<AgentStreamEvent> {
    const userId = input.userId ?? "__default__";
    let finalResponse = "";
    const toolNames: string[] = [];

    // 在对话开始时重置引用，确保不显示上一次对话的残留引用
    this.lastKbReferences = [];
    this.lastWebReferences = [];

    if (!this.config.autoStrategy) {
      const enrichedInput = await this.buildEnrichedInput(input);
      for await (const event of this.runReactStream(enrichedInput)) {
        if (event.event === "agent_done") {
          finalResponse = (event.data as any)?.response ?? "";
        }
        if (event.event === "tool_start") {
          toolNames.push((event.data as any)?.skillName ?? "unknown");
        }
        yield event;
      }
      if (toolNames.length > 0) this.recordToolSummary(userId, toolNames);
      this.recordAssistantReply(userId, finalResponse);
      this.analyzeConversationMemory(userId, input.message, finalResponse);
      return;
    }

    const decision = await this.analyzeStrategy(input.message, userId);

    // 话题变化时截断历史，只保留最近 1 轮
    if (decision.topicChange) {
      this.truncateHistory(userId, 2);
    }

    const enrichedInput = await this.buildEnrichedInput(input);

    yield {
      event: "strategy_selected",
      data: {
        level: decision.level,
        reasoning: decision.reasoning,
      },
    };

    let stream: AsyncGenerator<AgentStreamEvent>;
    if (decision.level === "simple") {
      stream = this.runSimpleStream(enrichedInput);
    } else if (decision.level === "plan") {
      stream = this.runPlanStream(enrichedInput);
    } else if (decision.level === "team") {
      stream = this.runTeamStream(enrichedInput, decision);
    } else {
      stream = this.runReactStream(enrichedInput);
    }

    for await (const event of stream) {
      if (event.event === "agent_done") {
        finalResponse = (event.data as any)?.response ?? "";
      }
      if (event.event === "tool_start") {
        toolNames.push((event.data as any)?.skillName ?? "unknown");
      }
      yield event;
    }

    if (toolNames.length > 0) this.recordToolSummary(userId, toolNames);
    this.recordAssistantReply(userId, finalResponse);
    this.analyzeConversationMemory(userId, input.message, finalResponse);
  }

  /** 分析任务并决策 */
  async analyzeStrategy(message: string, userId?: string): Promise<StrategyDecision> {
    // 首先使用关键词快速判断，实现智能策略选择
    const strategy = this.quickAnalyzeStrategy(message);
    if (strategy) {
      return strategy;
    }

    const skills = this.deps.registry.listVisible();
    const skillListText = skills
      .map((s) => `- ${s.name}: ${s.description}`)
      .join("\n");

    // 获取最近对话历史摘要
    const historySummary = userId ? this.getRecentHistorySummary(userId) : "";
    const historySection = historySummary
      ? `\n## 最近对话上下文\n${historySummary}\n`
      : "";

    const prompt = `分析以下用户任务，选择最合适的执行策略。
${historySection}
## 当前用户消息
${message}

## 可用工具/技能
${skillListText || "（无）"}

## 策略选项

### 级别
- simple: 简单问答、闲聊、翻译、知识查询 — 不需要工具调用
- react: 需要使用工具的单人任务 — 搜索、计算、数据库查询、记忆、图表生成等（绝大多数任务应使用此级别）
- plan: 多步规划任务 — 需要先制定计划再执行（如：复杂数据分析流程、项目管理）
- team: 多智能体协作任务 — 需要多个专家分工合作、并行分析、或复杂的协调流程

### Team 协议选择指南
当选择 team 级别时，根据任务特点选择协议：
- HIERARCHICAL: 任务有明确的层次结构或管理关系（如：代码审查需要架构师→前端专家→后端专家）
- SEQUENTIAL: 任务需要按顺序执行，后续任务依赖前面的结果（如：数据处理流水线：清洗→验证→分析→生成报告）
- SWARM: 多个独立子任务可并行执行，最后汇聚结果（如：从多个来源搜索信息然后合成）
- CONTRACT_NET: 任务分配时需要多个智能体竞争投标（如：多个专家评估同一个方案）
- A2A: 点对点移交，智能体间需要协议协商（如：前端设计→后端实现→测试）
- BLACKBOARD: 需要共享工作区协调多个智能体的异步工作（如：复杂系统设计，多个专家在黑板上更新进度）
- MARKET_BASED: 基于资源和能力的经济博弈（如：任务分配时根据成本和能力分配资源）

### Plan 策略指南
当任务具有以下特点时，选择 plan 级别：
- 需要明确步骤的复杂任务（如："我需要分析一份财务报告"）
- 涉及多个相关操作的任务（如："帮我搜索公司产品信息，然后生成对比分析"）
- 需要规划和执行的任务（如："帮我制定学习计划并准备相关资源"）

## 输出格式（仅 JSON，无 markdown）
{
  "level": "simple|react|plan|team",
  "reasoning": "一句话说明选择原因",
  "topicChange": false,
  "protocol": "HIERARCHICAL|SEQUENTIAL|SWARM|CONTRACT_NET|A2A|BLACKBOARD|MARKET_BASED（仅当 level=team 时必需）",
  "team": {
    "members": [{"role":"角色名","expertise":["领域1"],"personality":"人格描述"}],
    "manager": {"role":"经理角色","expertise":["领域"],"personality":"人格描述"},
    "pipelineSteps": ["步骤1","步骤2"]
  }
}

## Team 触发条件
选择 team 级别仅当：
- 任务包含多个独立子目标（如：分析文档同时生成摘要和数据可视化）
- 明确涉及多角色协作（如：评审代码需要多个专家视角）
- 需要并行分析或竞争选择（如：多个方案需要同时评估）
- LLM 识别需要特定协议的情况

## Plan 触发条件
选择 plan 级别仅当：
- 任务需要明确的步骤规划（如："帮我分析这份财务报告，然后生成分析图表"）
- 涉及多个连续操作（如："先搜索相关信息，然后整理成报告"）
- 复杂的多步骤任务（如："制定学习计划，准备相关资源，然后进行学习"）

## 优先级顺序
1. simple：纯粹的闲聊、简单问答、翻译（不需要工具）
2. react：需要工具调用的单人任务（搜索、查询、图表等）- **绝大多数任务**
3. plan：需要规划和执行的复杂任务
4. team：多智能体协作任务

## 重要规则
- 如果对话上下文中已经在进行某项任务（如数据库查询、数据分析），用户的后续追问（如"继续"、"详细分析"、"再查一下"等）**必须**选 react，延续已有任务
- 需要工具的单步任务（查数据库、搜索、生成图表、文件操作等）一律选 react
- 只有纯粹的闲聊、问答、翻译才选 simple
- Plan 应谨慎使用，仅当任务确实需要多步规划时才使用
- Team 应谨慎使用，仅当任务确实需要多智能体协作时才使用

## 话题变化检测（topicChange）
- 如果用户的新消息与最近对话上下文的话题**明显不同**，设置 topicChange=true
- 例如：之前在讨论数据库查询，突然问"今天天气怎样" → topicChange=true
- 如果是对之前话题的追问、深入、补充 → topicChange=false
- 没有历史对话时 → topicChange=false`;


    try {
      const response = await this.deps.provider.chat([
        { role: "user", content: prompt },
      ]);

      const content = response.content?.trim() ?? "{}";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.buildDecision(parsed);
      }
    } catch {}

    // 默认 fallback: react
    return {
      level: "react",
      reasoning: "默认策略",
    };
  }

  // ===== 私有方法 =====

  /** 异步分析对话，自动提取用户信息存入 STM/LTM（fire-and-forget） */
  private analyzeConversationMemory(userId: string, userMessage: string, assistantReply: string): void {
    // 防抖：同一用户 10 秒内不重复分析
    const now = Date.now();
    const last = this.lastAnalysisTime.get(userId) ?? 0;
    if (now - last < 10000) return;
    this.lastAnalysisTime.set(userId, now);

    const historySummary = this.getRecentHistorySummary(userId, 4);

    // 在正确的用户上下文中执行异步分析
    requestContext.run({ userId }, async () => {
      try {
        const prompt = `分析以下对话，提取值得记忆的用户个人信息。

用户: ${userMessage}
助手: ${assistantReply}
${historySummary ? `近期上下文: ${historySummary}` : ""}

输出 JSON（仅 JSON，无 markdown）:
{ "skip": bool, "shortTerm": [{"key":"描述性命名","value":"具体值"}], "longTerm": [{"key":"描述性命名","value":"具体值","tags":["标签"],"summary":"一句话摘要"}] }

规则：
- 闲聊/通用/无信息量的对话 skip=true
- shortTerm: 当前任务状态、临时偏好
- longTerm: 姓名、职业、爱好、技术栈、持久偏好
- key 用描述性命名如 user_name, user_job, user_hobby
- 只提取事实，不存对话原文
- 没有有价值的信息时 skip=true`;

        const response = await this.deps.provider.chat([
          { role: "user", content: prompt },
        ]);

        const content = response.content?.trim() ?? "{}";
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return;

        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.skip) return;

        // 写入 STM
        if (Array.isArray(parsed.shortTerm)) {
          for (const item of parsed.shortTerm) {
            if (item.key && item.value) {
              try {
                await this.deps.engine.execute("stm_store", { key: item.key, value: item.value });
              } catch {}
            }
          }
        }

        // 写入 LTM
        if (Array.isArray(parsed.longTerm)) {
          for (const item of parsed.longTerm) {
            if (item.key && item.value) {
              try {
                await this.deps.engine.execute("ltm_store", {
                  key: item.key,
                  value: item.value,
                  tags: item.tags || [],
                  summary: item.summary || String(item.value),
                });
              } catch {}
            }
          }
        }
      } catch {
        // 静默失败，不影响主流程
      }
    });
  }

  /** 快速策略分析 */
  private quickAnalyzeStrategy(message: string): StrategyDecision | null {
    const lowerMsg = message.toLowerCase().trim();

    // 首先检查是否是追问模式（如"继续"、"详细分析"等）
    const followUpPatterns = [
      /^继续.*$|^.*继续$/, // 继续之前的任务
      /^详细.*$|^.*详细$/, // 详细分析
      /^再.*一下$|^.*再.*$/, // 再次查询
      /^深入.*$|^.*深入$/, // 深入分析
      /^接下来.*$|^.*接下来$/, // 接下来的步骤
    ];

    for (const pattern of followUpPatterns) {
      if (pattern.test(lowerMsg)) {
        return {
          level: "react",
          reasoning: "用户的追问，需要延续之前的任务",
          topicChange: false,
          taskType: 'followup',
          complexity: 0.6,
          confidence: 0.9,
        };
      }
    }

    // 关键词识别规则
    const patterns = {
      // simple 模式识别（只识别真正简单的、不需要任何工具调用的问题）
      simple: [
        /^[\s]*$/, // 空消息
        /^你好$|^您好$|^早上好$|^晚上好$|^下午好$|^再见$|^拜拜$/, // 简单问候
      ],

      // 需要用户确认的场景（选择 react 策略以确保 user_confirm 可用）
      needsConfirm: [
        /^我想学习.*$|^学习.*建议$|^如何学习.*$|^学习.*方法$/, // 学习建议类问题（需要确认学习方向/时间）
        /^帮我制定.*$|^制定.*计划$|^帮我规划.*$|^规划.*方案$/, // 制定计划类（需要确认需求/时间安排）
        /^我想.*推荐$|^.*推荐.*$|^给我推荐.*$/, // 推荐类问题（需要确认偏好）
        /^帮我选择.*$|^选择.*方案$|^哪个.*好$|^.*哪个.*$/, // 选择类问题（需要确认选项）
        /^帮我设置.*$|^设置.*参数$|^配置.*$|^.*配置.*$/, // 配置类问题（需要确认参数）
        /^我想.*减肥$|^减肥.*计划$|^健身.*方案$|^运动.*安排$/, // 健康类计划（需要确认身体状态/时间）
        /^我想.*旅行$|^旅行.*计划$|^行程.*安排$|^旅游.*建议$/, // 旅行类（需要确认时间/预算/目的地）
        /^帮我.*安排.*时间$|^时间.*安排$|^日程.*规划$/, // 时间安排类（需要确认时间表）
      ],

      // plan 模式识别
      plan: [
        /^帮我.*计划.*$|^.*计划.*帮我.*$|^制定.*计划.*$|^.*计划.*制定.*$/, // 明确的计划请求
        /^先.*然后.*$|^首先.*然后.*$|^.*先.*后.*$|^先.*再.*然后.*$/, // 多步任务
        /^帮我.*搜索.*然后.*$|^帮我.*查找.*然后.*$|^先.*搜索.*然后.*$|^先.*查找.*然后.*$/, // 搜索后处理
        /^分析.*报告.*$|^.*报告.*分析$|^生成.*报告.*$|^.*报告.*生成$/, // 复杂分析任务
        /^准备.*资料.*$|^.*资料.*准备$|^整理.*资料.*$|^.*资料.*整理$|^汇总.*信息.*$|^.*信息.*汇总$/, // 资料整理任务
        /^学习.*方法.*$|^.*方法.*学习$|^学习.*策略.*$|^.*策略.*学习$|^如何.*学习.*$|^.*学习.*如何.*$/, // 学习任务
        /^项目.*方案.*$|^.*方案.*项目$|^制定.*方案.*$|^.*方案.*制定$|^设计.*方案.*$|^.*方案.*设计$/, // 项目方案
        /^实施.*步骤.*$|^.*步骤.*实施$|^执行.*步骤.*$|^.*步骤.*执行$|^操作.*步骤.*$|^.*步骤.*操作$/, // 步骤相关
        /^流程.*说明.*$|^.*说明.*流程$|^工作.*流程.*$|^.*流程.*工作$|^操作.*流程.*$|^.*流程.*操作$/, // 流程相关
      ],

      // team 模式识别（需要多智能体协作）
      team: [
        /^代码.*审查.*$|^.*审查.*代码$|^代码.*分析.*$|^.*分析.*代码$|^架构.*设计.*$|^.*设计.*架构$/, // 复杂技术任务
        /^市场.*分析.*$|^.*分析.*市场$|^竞争.*分析.*$|^.*分析.*竞争$|^商业.*分析.*$|^.*分析.*商业$/, // 市场分析
        /^项目.*评估.*$|^.*评估.*项目$|^风险.*评估.*$|^.*评估.*风险$|^投资.*评估.*$|^.*评估.*投资$/, // 评估任务
      ],
    };

    // 检查是否匹配 simple 模式
    for (const pattern of patterns.simple) {
      if (pattern.test(lowerMsg)) {
        return {
          level: "simple",
          reasoning: "简单对话或问候，不需要工具调用",
          topicChange: false,
          taskType: 'qa',
          complexity: 0.1,
          confidence: 0.9,
        };
      }
    }

    // 检查是否需要用户确认的场景（优先于 plan 模式）
    for (const pattern of patterns.needsConfirm) {
      if (pattern.test(lowerMsg)) {
        return {
          level: "react", // 使用 react 策略以支持 tool use（user_confirm）
          reasoning: "需要用户确认或数据回填的任务，使用 react 策略以支持交互",
          topicChange: false,
          taskType: 'confirmation',
          complexity: 0.5,
          confidence: 0.85,
        };
      }
    }

    // 检查是否匹配 plan 模式
    for (const pattern of patterns.plan) {
      if (pattern.test(lowerMsg)) {
        return {
          level: "plan",
          reasoning: "需要多步骤规划和执行的任务",
          topicChange: false,
          taskType: 'planning',
          complexity: 0.7,
          confidence: 0.8,
        };
      }
    }

    // 检查是否匹配 team 模式
    for (const pattern of patterns.team) {
      if (pattern.test(lowerMsg)) {
        return {
          level: "team",
          protocol: Protocol.HIERARCHICAL,
          reasoning: "需要多智能体协作的复杂任务",
          topicChange: false,
          taskType: 'collaboration',
          complexity: 0.9,
          confidence: 0.85,
        };
      }
    }

    // 默认返回 null，由 LLM 进一步分析
    return null;
  }

  private buildDecision(parsed: any): StrategyDecision {
    const level = parsed.level ?? "react";
    const decision: StrategyDecision = {
      level,
      reasoning: parsed.reasoning ?? "",
      topicChange: !!parsed.topicChange,
      taskType: parsed.taskType,
      complexity: parsed.complexity,
      confidence: parsed.confidence,
      planSteps: parsed.planSteps,
    };

    if (level === "team" && parsed.protocol) {
      decision.protocol = parsed.protocol as Protocol;

      const team = parsed.team ?? {};
      const members: AgentProfile[] = (team.members ?? []).map((m: any) => ({
        role: m.role ?? "通用助手",
        personality: m.personality ?? `你是 ${m.role}。`,
        expertise: m.expertise ?? [],
        allowedSkills: m.allowedSkills ?? [],
        costPerToken: m.costPerToken,
      }));

      // 确保至少有 2 个成员
      if (members.length < 2) {
        return { level: "react", reasoning: "团队成员不足，降级为 ReAct" };
      }

      decision.teamConfig = {
        members,
        manager: team.manager
          ? {
              role: team.manager.role ?? "项目经理",
              personality: team.manager.personality ?? "你是项目经理。",
              expertise: team.manager.expertise ?? ["项目管理"],
              allowedSkills: team.manager.allowedSkills ?? [],
            }
          : undefined,
        pipelineSteps: team.pipelineSteps,
        maxRounds: team.maxRounds ?? 5,
      };
    }

    return decision;
  }

  private runSimple(input: AgentInput): Promise<AgentOutput> {
    const profile = { ...DEFAULT_PROFILES.general };
    if (this.config.defaultSystemPrompt) {
      profile.personality = this.config.defaultSystemPrompt;
    }
    const agent = new SimpleAgent(profile, this.deps);
    return agent.run(input);
  }

  private async *runSimpleStream(input: AgentInput): AsyncGenerator<AgentStreamEvent> {
    const profile = { ...DEFAULT_PROFILES.general };
    if (this.config.defaultSystemPrompt) {
      profile.personality = this.config.defaultSystemPrompt;
    }
    const agent = new SimpleAgent(profile, this.deps);
    yield* agent.runStream(input);
  }

  private runPlan(input: AgentInput): Promise<AgentOutput> {
    const profile: AgentProfile = {
      role: "规划助手",
      personality: this.config.defaultSystemPrompt ?? DEFAULT_PROFILES.general.personality,
      expertise: ["规划", "任务分析", "执行"],
      allowedSkills: [], // 全部可用
    };
    const agent = new PlanAgent(profile, this.deps, {
      maxSteps: this.config.strategyConfig?.planStepLimit ?? 10,
      allowReplan: this.config.strategyConfig?.allowStrategySwitch ?? true,
    });
    return agent.run(input);
  }

  private async *runPlanStream(input: AgentInput): AsyncGenerator<AgentStreamEvent> {
    const profile: AgentProfile = {
      role: "规划助手",
      personality: this.config.defaultSystemPrompt ?? DEFAULT_PROFILES.general.personality,
      expertise: ["规划", "任务分析", "执行"],
      allowedSkills: [], // 全部可用
    };
    const agent = new PlanAgent(profile, this.deps, {
      maxSteps: this.config.strategyConfig?.planStepLimit ?? 10,
      allowReplan: this.config.strategyConfig?.allowStrategySwitch ?? true,
    });
    yield* agent.runStream(input);
  }

  private runReact(input: AgentInput): Promise<AgentOutput> {
    const profile: AgentProfile = {
      role: "ReAct 助手",
      personality: this.config.defaultSystemPrompt ?? DEFAULT_PROFILES.general.personality,
      expertise: ["通用"],
      allowedSkills: [], // 全部可用
    };
    const agent = new ReactAgent(profile, this.deps, {
      maxIterations: this.config.maxIterations,
    });
    return agent.run(input);
  }

  private async *runReactStream(input: AgentInput): AsyncGenerator<AgentStreamEvent> {
    const profile: AgentProfile = {
      role: "ReAct 助手",
      personality: this.config.defaultSystemPrompt ?? DEFAULT_PROFILES.general.personality,
      expertise: ["通用"],
      allowedSkills: [],
    };
    const agent = new ReactAgent(profile, this.deps, {
      maxIterations: this.config.maxIterations,
    });
    yield* agent.runStream(input);
  }

  private runTeam(input: AgentInput, decision: StrategyDecision): Promise<AgentOutput> {
    const teamAgent = new TeamAgent(
      decision.protocol!,
      decision.teamConfig!,
      this.deps,
    );
    return teamAgent.run(input);
  }

  private async *runTeamStream(
    input: AgentInput,
    decision: StrategyDecision,
  ): AsyncGenerator<AgentStreamEvent> {
    const teamAgent = new TeamAgent(
      decision.protocol!,
      decision.teamConfig!,
      this.deps,
    );
    yield* teamAgent.runStream(input);
  }
}
