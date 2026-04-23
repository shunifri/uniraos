/**
 * Agent Loop: ReAct 模式的 LLM 驱动 Skill 调用循环
 *
 * 流程: 用户输入 → LLM 推理 → 选择 Skill → 执行 → 观察结果 → 继续推理 → ... → 最终回复
 *       对话结束后 → 自动分析记忆 → 存储到 STM/LTM
 */
import type { ExecutionResult } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import type { ExecutionEngine } from "../engine/index.js";
import type { SkillAccessService } from "../engine/skill-access-service.js";
import type {
  ChatOptions,
  LLMProvider,
  Message,
  ToolCall,
  ToolDefinition,
} from "./types.js";
import { skillsToTools } from "./tool-bridge.js";
import { confirmQueue } from "../skills/user-confirm-skill.js";
import { requestContext, getCurrentUserId } from "../user/request-context.js";
import type { FactExtractor } from "../memory/enhanced/fact-extractor.js";
import type { ConflictDetector } from "../memory/enhanced/conflict-detector.js";
import type { LTMBackend } from "../memory/ltm-backend.js";

/** Agent 循环配置 */
export interface AgentLoopConfig {
  maxIterations: number;
  systemPrompt: string;
  includeTrace: boolean;
  /** 是否启用自动记忆提取 */
  autoMemory: boolean;
}

const MEMORY_AWARE_PROMPT = `你是 RAOS 的智能体，一个自然、友善的 AI 助手。

## 对话风格
- 像真人朋友一样简洁自然地说话
- 如果记忆中有用户名字，用名字打招呼（早上/下午/晚上根据时间选择）
- 记忆信息只在相关话题时自然融入，不主动列举

## 记忆管理
主动管理用户记忆：
- 用户提到个人信息、偏好、重要事实时，调用 ltm_store 存储
- 当前对话的临时上下文调用 stm_store
- 示例："我叫张三" → ltm_store(key="user_name", value="张三", tags=["personal"])

## 知识库
- 知识库 = 用户上传的文档，必须通过 kb_search 检索才能引用
- 检索优先级：kb_search → web_search
- kb_search 返回空时，明确告知用户"知识库中没有相关内容"
- 禁止编造知识库引用（没有调用 kb_search 就声称有知识库内容）

## 用户交互
需要用户选择/确认时，调用 user_confirm skill：
- selection：选项卡片（单选/多选）
- form：自由文本输入（姓名、地址等无法穷举的信息）
- approval：确认/取消
- 禁止在回复中直接输出选项列表（如"A. xxx / B. xxx"）

### 重要约束
- 数据查询类任务：先直接调用 db_query/mysql_query 获取数据，不要先弹 user_confirm 让用户选数据来源
- 只有确实需要用户主观选择时才用 user_confirm（如"确认删除吗？"、"想看图表还是表格？"）

## 文档规范
- 仅用户明确要求生成文件/文档/报告/PPT 时才调用 file_provide
- 文档/PPT 使用 .md 格式，系统会自动提供 PDF/DOCX/PPTX 转换
- 表格用 markdown 语法（| 列1 | 列2 |），禁止 HTML 标签
- 图片用 ![描述](链接)，视频直接放 URL 链接

## Skill 创建
- 所有功能集中在一个 skill 中，禁止拆分
- 优先用 skill_compose 组合现有 skill，避免 skill_from_description 代码生成
- 创建后测试，成功即停止，不要继续创建其他 skill

## 输出规范
- 调用工具前不要写"让我xxx："等预告，直接调用
- 多工具连续调用时不逐个解说，完成后统一回复
- 工具失败不要重试超过 2 次，换一个方法或告诉用户`;

const DEFAULT_AGENT_CONFIG: AgentLoopConfig = {
  maxIterations: 15,
  systemPrompt: MEMORY_AWARE_PROMPT,
  includeTrace: false,
  autoMemory: true,
};

/** Agent 循环中的单步记录 */
export interface AgentStep {
  type: "llm_response" | "tool_call" | "tool_result" | "auto_memory";
  content?: string;
  toolCall?: ToolCall;
  toolResult?: {
    skillName: string;
    result: ExecutionResult | { success: false; error: string };
  };
  timestamp: number;
}

/** Agent 循环的完整结果 */
export interface AgentResult {
  finalResponse: string;
  steps: AgentStep[];
  iterations: number;
  hitMaxIterations: boolean;
}

/** 流式事件 */
export interface StreamEvent {
  event: "thinking" | "text_delta" | "tool_call" | "tool_start" | "tool_result" | "user_confirm" | "done" | "error";
  data: Record<string, unknown>;
}

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return { raw: str };
  }
}

export class AgentLoop {
  private registry: SkillRegistry;
  private engine: ExecutionEngine;
  private provider: LLMProvider;
  private config: AgentLoopConfig;
  private toolDefs: ToolDefinition[];
  private toolSchemas = new Map<string, ToolDefinition>();
  /** 用户权限列表（用于按权限过滤 Skill） */
  private userPermissions: string[] | null = null;
  /** Skill 访问服务（用于完整的权限检查） */
  private skillAccessService?: SkillAccessService;
  /** 按 conversationId 隔离的对话历史 */
  private conversationHistories = new Map<string, Message[]>();
  /** 记录每个对话的 Skill 创建状态（强制规则：一个对话只能创建 1 个 Skill，可重试修改最多 3 次） */
  private skillCreationState = new Map<string, { skillName: string; attempts: number }>();
  /** 记录每个对话的 kb_search 是否有有效结果（防止编造知识库内容） */
  private kbSearchHasResults = new Set<string>();
  /** 增强记忆模块（可选） */
  private factExtractor?: FactExtractor;
  private conflictDetector?: ConflictDetector;
  private ltmBackend?: LTMBackend;

  /** 检测文本是否编造了知识库引用（没有有效 kb_search 结果却声称有知识库内容） */
  private containsFakeKbReference(text: string, conversationId: string): boolean {
    if (!text) return false;
    // 如果 kb_search 返回了有效结果，不拦截
    if (this.kbSearchHasResults.has(conversationId)) return false;
    // 检测编造知识库的关键词
    const fakePatterns = [
      /根据知识库[中的信息]?/,
      /根据系统自动注入/,
      /从知识库中[找到|获取|检索]/,
      /知识库显示/,
      /知识库.*相关[内容|信息|资料]/,
      /根据知识库.*我[看到|找到|了解]/,
    ];
    return fakePatterns.some((p) => p.test(text));
  }

  /** 检查是否为 Skill 创建类调用 */
  private isSkillCreationCall(skillName: string): boolean {
    return skillName === "skill_compose" || skillName === "skill_from_description" || skillName === "skill_from_template";
  }

  /** 检查当前对话是否已被禁止创建 Skill */
  private isSkillCreationBlocked(skillName: string, conversationId: string, toolParams?: Record<string, unknown>): boolean {
    if (!this.isSkillCreationCall(skillName)) return false;
    const state = this.skillCreationState.get(conversationId);
    if (!state) {
      // 第一次创建，允许
      return false;
    }
    // 已创建过，检查是否是同一个 Skill 的重试
    const newSkillName = (toolParams?.name as string) || "";
    if (newSkillName && state.skillName && newSkillName !== state.skillName) {
      // 试图创建不同的 Skill，拦截
      return true;
    }
    // 同一个 Skill 的重试，检查次数
    if (state.attempts >= 3) {
      return true;
    }
    return false;
  }

  /** 记录一次 Skill 创建尝试 */
  private recordSkillCreationAttempt(conversationId: string, toolParams?: Record<string, unknown>): void {
    const state = this.skillCreationState.get(conversationId);
    const skillName = (toolParams?.name as string) || "unknown";
    if (!state) {
      this.skillCreationState.set(conversationId, { skillName, attempts: 1 });
    } else {
      state.attempts += 1;
    }
  }

  constructor(
    registry: SkillRegistry,
    engine: ExecutionEngine,
    provider: LLMProvider,
    config?: Partial<AgentLoopConfig>,
    skillAccessService?: SkillAccessService,
  ) {
    this.registry = registry;
    this.engine = engine;
    this.provider = provider;
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
    this.skillAccessService = skillAccessService;
    // 如果用户没有自定义 systemPrompt，使用记忆感知版本
    if (config?.systemPrompt === undefined || config.systemPrompt === "") {
      this.config.systemPrompt = MEMORY_AWARE_PROMPT;
    }
    this.toolDefs = skillsToTools(registry.list());
  }

  /** 设置用户权限列表，用于按角色过滤可用 Skill */
  setUserPermissions(permissions: string[]): void {
    this.userPermissions = permissions;
    this.refreshTools();
  }

  /** 设置 Skill 访问服务，用于完整的权限检查（包括分享和所有权） */
  setSkillAccessService(service: SkillAccessService): void {
    this.skillAccessService = service;
    this.refreshTools();
  }

  registerToolSchema(toolDef: ToolDefinition): void {
    this.toolSchemas.set(toolDef.function.name, toolDef);
    this.refreshTools();
  }

  refreshTools(): void {
    // 优先使用 SkillAccessService（考虑分享和所有权）
    if (this.skillAccessService) {
      try {
        const userId = getCurrentUserId();
        if (userId && userId !== "default") {
          this.skillAccessService.getAccessibleSkills(userId, { visibleOnly: true }, false)
            .then((result) => {
              this.toolDefs = skillsToTools(result.skills).map((td) => {
                const custom = this.toolSchemas.get(td.function.name);
                return custom ?? td;
              });
            })
            .catch(() => {
              // 如果获取失败，回退到简单的权限过滤
              this.fallbackRefreshTools();
            });
          return;
        }
      } catch {
        // 获取用户 ID 失败，回退到简单的权限过滤
      }
    }
    this.fallbackRefreshTools();
  }

  private fallbackRefreshTools(): void {
    const skills = this.userPermissions
      ? this.registry.listVisibleByPermissions(this.userPermissions)
      : this.registry.list();
    this.toolDefs = skillsToTools(skills).map((td) => {
      const custom = this.toolSchemas.get(td.function.name);
      return custom ?? td;
    });
  }

  /** 注入增强记忆模块（可选，用于结构化事实提取和冲突检测） */
  setEnhancedMemory(
    factExtractor: FactExtractor,
    conflictDetector?: ConflictDetector,
    ltmBackend?: LTMBackend,
  ): void {
    this.factExtractor = factExtractor;
    this.conflictDetector = conflictDetector;
    this.ltmBackend = ltmBackend;
  }

  /** 获取指定会话的历史记录 */
  private getHistory(conversationId?: string): Message[] {
    if (!conversationId) return [];
    let history = this.conversationHistories.get(conversationId);
    if (!history) {
      history = [];
      this.conversationHistories.set(conversationId, history);
    }
    return history;
  }

  /** 清空对话历史 */
  clearHistory(conversationId?: string): void {
    if (conversationId) {
      this.conversationHistories.delete(conversationId);
    } else {
      this.conversationHistories.clear();
    }
  }

  /** 截断过大的工具结果，防止上下文窗口溢出 */
  private truncateToolResult(result: ExecutionResult | { success: false; error: string }): string {
    const MAX_RESULT_LEN = 8000;
    const obj = {
      success: result.success,
      data: "data" in result ? result.data : undefined,
      error: "error" in result ? result.error : undefined,
    };
    let json = JSON.stringify(obj, null, 2);
    if (json.length > MAX_RESULT_LEN) {
      json = json.slice(0, MAX_RESULT_LEN) + "\n...[truncated, total " + json.length + " chars]";
    }
    return json;
  }

  /** 检测文本中是否包含选项列表（需要拦截并用 user_confirm 替代） */
  private containsOptionList(text: string): boolean {
    if (!text || text.length < 20) return false;
    // 检测 bullet points（• · - *）连续出现 2+ 次
    const bulletPattern = /^[\s]*[•·\-*]\s+\S+/gm;
    const bullets = text.match(bulletPattern);
    if (bullets && bullets.length >= 2) {
      // 进一步确认：文本末尾有询问语气
      const lastPart = text.slice(-200).toLowerCase();
      const askingPatterns = ["吗？", "吗?", "需要什么", "需要我", "怎么帮你", "有什么", "请选择", "你可以"];
      if (askingPatterns.some((p) => lastPart.includes(p))) {
        return true;
      }
    }
    // 检测 "A. / B. / C." 或 "1. / 2. / 3." 选项模式
    const optionPattern = /(?:^|\n)\s*(?:[A-Da-d][\.、]|\d+[\.、])\s*\S+/gm;
    const options = text.match(optionPattern);
    if (options && options.length >= 2) {
      const lastPart = text.slice(-200).toLowerCase();
      const askingPatterns = ["吗？", "吗?", "需要什么", "需要我", "怎么帮你", "有什么", "请选择", "你可以"];
      if (askingPatterns.some((p) => lastPart.includes(p))) {
        return true;
      }
    }
    return false;
  }

  /**
   * 自动检索 LTM 中与用户消息相关的记忆，返回注入到 system prompt 的补充文本。
   * 静默失败，不影响主流程。
   */
  private async recallMemories(userMessage: string): Promise<string> {
    const now = new Date();
    const hour = now.getHours();
    const timeGreeting = hour < 12 ? "早上" : hour < 18 ? "下午" : "晚上";
    let context = `\n\n## 当前时间\n${now.toLocaleString("zh-CN")}（${timeGreeting}）`;

    try {
      // 使用知识图谱 BFS 检索相关记忆（优先），回退到 LTM 关键词搜索
      const hasGraphQuery = this.registry.list().some((s) => s.name === "graph_query");
      const hasLtmSearch = this.registry.list().some((s) => s.name === "ltm_search");

      let memoryFound = false;

      // 优先：知识图谱 BFS 检索（拓扑关联，效率更高）
      if (hasGraphQuery) {
        try {
          const graphResult = await Promise.race([
            this.engine.execute("graph_query", { query: userMessage, maxDepth: 2, maxNodes: 5 }),
            new Promise<any>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          if (graphResult?.success && graphResult.data?.nodes?.length > 0) {
            const nodes = graphResult.data.nodes as Array<{ label: string; tags: string[]; properties: Record<string, unknown> }>;
            const memoryLines = nodes.map(
              (n) => `- [${n.label}] ${n.properties?.value ? String(n.properties.value).slice(0, 300) : ""}${n.tags?.length ? ` (tags: ${n.tags.join(", ")})` : ""}`
            );
            context += `\n\n## 你对用户的了解（内部参考，禁止直接列举给用户）\n${memoryLines.join("\n")}`;
            memoryFound = true;
          }
        } catch { /* 图谱查询失败静默降级 */ }
      }

      // 降级：LTM 关键词/语义搜索
      if (!memoryFound && hasLtmSearch) {
        try {
          const ltmResult = await Promise.race([
            this.engine.execute("ltm_search", { query: userMessage, limit: 5 }),
            new Promise<any>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          if (ltmResult?.success) {
            const data = ltmResult.data as { results?: Array<{ key: string; value: unknown; summary?: string; tags?: string[] }> };
            if (data.results && data.results.length > 0) {
              const memoryLines = data.results.map(
                (m) => `- [${m.key}] ${m.summary || JSON.stringify(m.value)}${m.tags?.length ? ` (tags: ${m.tags.join(", ")})` : ""}`
              );
              context += `\n\n## 你对用户的了解（内部参考，禁止直接列举给用户）\n${memoryLines.join("\n")}`;
            }
          }
        } catch { /* LTM 查询失败静默 */ }
      }

      // KB 搜索由 AI 通过 tool-use 自主调用 kb_search，不再预注入
    } catch {
      // 静默失败
    }
    return context;
  }

  /** 流式 Agent 循环事件类型 */
  async *runStream(userMessage: string, chatOptions?: ChatOptions): AsyncGenerator<StreamEvent> {
    this.refreshTools();

    // 自动检索相关记忆，注入系统提示
    const memoryContext = await this.recallMemories(userMessage);

    const conversationHistory = this.getHistory(chatOptions?.conversationId);

    const messages: Message[] = [
      { role: "system", content: this.config.systemPrompt + memoryContext },
      ...conversationHistory,
      { role: "user", content: userMessage },
    ];

    conversationHistory.push({ role: "user", content: userMessage });

    const steps: AgentStep[] = [];
    let iterations = 0;
    let hitMaxIterations = false;

    while (iterations < this.config.maxIterations) {
      iterations++;
      yield { event: "thinking", data: { iteration: iterations } };

      if (this.provider.chatStream) {
        // 流式模式
        let textContent = "";
        const toolCalls: ToolCall[] = [];
        const toolCallBuffers = new Map<string, { id: string; name: string; args: string }>();
        let insideThinkTag = false; // 跟踪是否在 <think> 标签内
        let thinkBuffer = ""; // 累积思考内容

        for await (const chunk of this.provider.chatStream(messages, this.toolDefs, chatOptions)) {
          if (chunk.type === "text_delta" && chunk.text) {
            // 1. reasoning_content（DeepSeek thinking mode via reasoning flag）
            if ((chunk as any).reasoning) {
              thinkBuffer += chunk.text;
              // 每积累一定量就发送一次，避免最后才发
              if (thinkBuffer.length > 100) {
                yield { event: "thinking", data: { content: thinkBuffer } };
                thinkBuffer = "";
              }
              continue; // 不输出到正文
            }

            // 2. 过滤 <think>...</think> 标签内容
            let text = chunk.text;
            if (text.includes("<think>")) {
              insideThinkTag = true;
              text = text.replace(/<think>/g, "");
            }
            if (text.includes("</think>")) {
              insideThinkTag = false;
              text = text.replace(/<\/think>/g, "");
              if (thinkBuffer) {
                yield { event: "thinking", data: { content: thinkBuffer } };
                thinkBuffer = "";
              }
              if (text.trim()) {
                textContent += text;
                yield { event: "text_delta", data: { text } };
              }
              continue;
            }
            if (insideThinkTag) {
              thinkBuffer += text;
              continue;
            }

            // 3. 正常文本 — 如果有残余的 thinkBuffer，先发送
            if (thinkBuffer) {
              yield { event: "thinking", data: { content: thinkBuffer } };
              thinkBuffer = "";
            }
            textContent += text;
            yield { event: "text_delta", data: { text } };
          } else if (chunk.type === "tool_call_complete") {
            const tc: ToolCall = {
              id: chunk.toolCallId!,
              name: chunk.toolCallName!,
              arguments: safeJsonParse(chunk.toolCallArgs ?? "{}"),
            };
            toolCalls.push(tc);
            yield { event: "tool_call", data: { toolCall: tc } };
          }
        }

        if (textContent) {
          steps.push({ type: "llm_response", content: textContent, timestamp: Date.now() });
        }

        const convId = chatOptions?.conversationId || "default";

        // 没有 tool calls，推理结束
        if (toolCalls.length === 0) {
          // 输出安全检查：禁止编造知识库引用
          if (textContent && this.containsFakeKbReference(textContent, convId)) {
            messages.push({ role: "assistant", content: textContent });
            messages.push({
              role: "system",
              content: "【系统拦截】检测到您在回复中编造了知识库引用（如'根据知识库中的信息'），但您没有调用 kb_search。规则：没有调用 kb_search 就**没有任何**知识库内容可用。请删除编造的引用，如果确实需要知识库信息，请先调用 kb_search。",
            });
            continue; // 让 LLM 重新生成
          }
          // 输出安全检查：禁止包含选项列表
          if (textContent && this.containsOptionList(textContent)) {
            messages.push({ role: "assistant", content: textContent });
            messages.push({
              role: "system",
              content: "【系统拦截】检测到您的回复中包含选项列表（如 • 查看xxx / • 生成xxx）。根据规则，禁止在回复中直接输出选项列表，必须使用 user_confirm(type='selection') skill 来呈现选择。请删除选项列表文本，直接调用 user_confirm skill 让用户点击选择。",
            });
            continue; // 让 LLM 重新生成
          }
          // 禁止空回复：如果 AI 没有生成任何内容，强制要求回复
          if (!textContent || textContent.trim().length === 0) {
            messages.push({ role: "assistant", content: "" });
            messages.push({
              role: "system",
              content: "【系统拦截】检测到您没有生成任何回复内容。规则：每次交互必须给用户有意义的反馈，禁止空回复。如果知识库没有结果，请告诉用户'知识库中没有相关内容，让我尝试其他方式'，然后继续查询数据库或其他途径。",
            });
            continue;
          }
          messages.push({ role: "assistant", content: textContent });
          break;
        }

        // 有 tool calls
        messages.push({ role: "assistant", content: textContent, toolCalls });

        for (const toolCall of toolCalls) {
          steps.push({ type: "tool_call", toolCall, timestamp: Date.now() });
          yield { event: "tool_start", data: { skillName: toolCall.name, toolCallId: toolCall.id } };

          let result: ExecutionResult | { success: false; error: string };
          try {
            const params = toolCall.arguments.params
              ? (toolCall.arguments.params as Record<string, unknown>)
              : toolCall.arguments;
            // 硬性拦截：一个对话只能创建 1 个 Skill，同名可重试最多 3 次
            if (this.isSkillCreationBlocked(toolCall.name, convId, params)) {
              const state = this.skillCreationState.get(convId);
              if (state && state.attempts >= 3) {
                result = {
                  success: false,
                  error: "【系统拦截】当前对话已尝试 3 次 Skill 创建（含重试）均未成功，已放弃创建。规则：一个对话只能创建一个 Skill，最多尝试 3 次。",
                };
              } else {
                result = {
                  success: false,
                  error: `【系统拦截】当前对话已创建 Skill "${state?.skillName}"，禁止再创建其他 Skill。规则：所有功能必须集中在一个 Skill 中。如需修改当前 Skill，请使用相同名称重试。`,
                };
              }
            } else {
              this.recordSkillCreationAttempt(convId, params);
              result = await this.engine.execute(toolCall.name, params);
              if (toolCall.name === "kb_search" && result.success) {
                const data = (result as any).data;
                if (Array.isArray(data) && data.length > 0) {
                  this.kbSearchHasResults.add(convId);
                }
              }
            }
          } catch (err) {
            result = { success: false, error: err instanceof Error ? err.message : String(err) };
          }

          // Check for user_confirm pause/resume
          if (result.success && (result as any).data?.__userConfirm) {
            const confirmData = (result as any).data;
            yield { event: "user_confirm", data: confirmData };

            // Wait for user response via confirmQueue (with timeout)
            const CONFIRM_TIMEOUT_MS = 300000; // 5 minutes
            const userResponse = await new Promise<unknown>((resolve, reject) => {
              const timer = setTimeout(() => {
                confirmQueue.delete(confirmData.confirmId);
                reject(new Error("用户确认超时"));
              }, CONFIRM_TIMEOUT_MS);
              confirmQueue.set(confirmData.confirmId, { resolve, reject, timeout: timer });
            }).catch((err) => ({ cancelled: true, message: err.message }));

            // Replace the tool result with the user's response
            const userResult: ExecutionResult = {
              success: true,
              data: { userResponse },
              trace: [],
              traceId: `confirm-${confirmData.confirmId}`,
            };
            steps.push({ type: "tool_result", toolResult: { skillName: toolCall.name, result: userResult }, timestamp: Date.now() });
            yield { event: "tool_result", data: { skillName: toolCall.name, toolCallId: toolCall.id, result: userResult } };
            messages.push({ role: "tool", content: this.truncateToolResult(userResult), toolCallId: toolCall.id });
            continue;
          }

          steps.push({ type: "tool_result", toolResult: { skillName: toolCall.name, result }, timestamp: Date.now() });
          yield { event: "tool_result", data: { skillName: toolCall.name, toolCallId: toolCall.id, result } };

          const resultContent = this.truncateToolResult(result);

          messages.push({ role: "tool", content: resultContent, toolCallId: toolCall.id });
        }
      } else {
        // 非流式 fallback
        const response = await this.provider.chat(messages, this.toolDefs, chatOptions);

        if (response.content) {
          steps.push({ type: "llm_response", content: response.content, timestamp: Date.now() });
          yield { event: "text_delta", data: { text: response.content } };
        }

        if (response.finishReason !== "tool_calls" || response.toolCalls.length === 0) {
          messages.push({ role: "assistant", content: response.content ?? "" });
          break;
        }

        messages.push({ role: "assistant", content: response.content ?? "", toolCalls: response.toolCalls });

        const convId2 = chatOptions?.conversationId || "default";
        for (const toolCall of response.toolCalls) {
          steps.push({ type: "tool_call", toolCall, timestamp: Date.now() });
          yield { event: "tool_call", data: { toolCall } };
          yield { event: "tool_start", data: { skillName: toolCall.name, toolCallId: toolCall.id } };

          let result: ExecutionResult | { success: false; error: string };
          try {
            const params = toolCall.arguments.params
              ? (toolCall.arguments.params as Record<string, unknown>)
              : toolCall.arguments;
            // 硬性拦截：一个对话只能创建一个 Skill
            if (this.isSkillCreationBlocked(toolCall.name, convId2)) {
              result = {
                success: false,
                error: "【系统拦截】当前对话已创建过 Skill，禁止继续创建。规则：一个对话只能创建一个 Skill，创建成功后停止并等待用户反馈。如需创建其他 Skill，请开启新对话。",
              };
            } else {
              result = await this.engine.execute(toolCall.name, params);
            }
          } catch (err) {
            result = { success: false, error: err instanceof Error ? err.message : String(err) };
          }

          // Check for user_confirm pause/resume
          if (result.success && (result as any).data?.__userConfirm) {
            const confirmData = (result as any).data;
            yield { event: "user_confirm", data: confirmData };

            // Wait for user response via confirmQueue (with timeout)
            const CONFIRM_TIMEOUT_MS = 300000; // 5 minutes
            const userResponse = await new Promise<unknown>((resolve, reject) => {
              const timer = setTimeout(() => {
                confirmQueue.delete(confirmData.confirmId);
                reject(new Error("用户确认超时"));
              }, CONFIRM_TIMEOUT_MS);
              confirmQueue.set(confirmData.confirmId, { resolve, reject, timeout: timer });
            }).catch((err) => ({ cancelled: true, message: err.message }));

            const userResult: ExecutionResult = {
              success: true,
              data: { userResponse },
              trace: [],
              traceId: `confirm-${confirmData.confirmId}`,
            };
            steps.push({ type: "tool_result", toolResult: { skillName: toolCall.name, result: userResult }, timestamp: Date.now() });
            yield { event: "tool_result", data: { skillName: toolCall.name, toolCallId: toolCall.id, result: userResult } };
            messages.push({ role: "tool", content: this.truncateToolResult(userResult), toolCallId: toolCall.id });
            continue;
          }

          steps.push({ type: "tool_result", toolResult: { skillName: toolCall.name, result }, timestamp: Date.now() });
          yield { event: "tool_result", data: { skillName: toolCall.name, toolCallId: toolCall.id, result } };

          const resultContent = this.truncateToolResult(result);

          messages.push({ role: "tool", content: resultContent, toolCallId: toolCall.id });
        }
      }

      if (iterations >= this.config.maxIterations) {
        hitMaxIterations = true;
      }
    }

    // 提取最终回复
    const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant" && m.content);
    const finalResponse = lastAssistantMsg?.content ?? "[Agent reached max iterations without final response]";

    conversationHistory.push({ role: "assistant", content: finalResponse });

    yield { event: "done", data: { finalResponse, iterations, hitMax: hitMaxIterations } };

    // 自动记忆（不阻塞流，保持用户上下文）
    if (this.config.autoMemory) {
      const userId = getCurrentUserId();
      requestContext.run({ userId }, () => {
        this.autoExtractMemory(userMessage, finalResponse, steps).catch((err) => {
          console.error("   Auto-memory extraction failed:", err?.message || err);
        });
      });
    }
  }

  /** 执行 Agent 循环 */
  async run(userMessage: string, chatOptions?: ChatOptions): Promise<AgentResult> {
    this.refreshTools();

    // 自动检索相关记忆，注入系统提示
    const memoryContext = await this.recallMemories(userMessage);

    const conversationHistory = this.getHistory(chatOptions?.conversationId);

    // 构建消息列表：system + 历史 + 新消息
    const messages: Message[] = [
      { role: "system", content: this.config.systemPrompt + memoryContext },
      ...conversationHistory,
      { role: "user", content: userMessage },
    ];

    // 记录这轮新增的用户消息
    conversationHistory.push({ role: "user", content: userMessage });

    const steps: AgentStep[] = [];
    let iterations = 0;
    let hitMaxIterations = false;

    while (iterations < this.config.maxIterations) {
      iterations++;

      const response = await this.provider.chat(messages, this.toolDefs, chatOptions);

      if (response.content) {
        steps.push({
          type: "llm_response",
          content: response.content,
          timestamp: Date.now(),
        });
      }

      // 没有 tool calls，推理结束
      if (response.finishReason !== "tool_calls" || response.toolCalls.length === 0) {
        const content = response.content ?? "";
        const convIdNs = chatOptions?.conversationId || "default";
        // 输出安全检查：禁止编造知识库引用
        if (content && this.containsFakeKbReference(content, convIdNs)) {
          messages.push({ role: "assistant", content });
          messages.push({
            role: "system",
            content: "【系统拦截】检测到您在回复中编造了知识库引用（如'根据知识库中的信息'），但您没有调用 kb_search。规则：没有调用 kb_search 就**没有任何**知识库内容可用。请删除编造的引用，如果确实需要知识库信息，请先调用 kb_search。",
          });
          continue; // 让 LLM 重新生成
        }
        // 输出安全检查：禁止包含选项列表
        if (content && this.containsOptionList(content)) {
          messages.push({ role: "assistant", content });
          messages.push({
            role: "system",
            content: "【系统拦截】检测到您的回复中包含选项列表（如 • 查看xxx / • 生成xxx）。根据规则，禁止在回复中直接输出选项列表，必须使用 user_confirm(type='selection') skill 来呈现选择。请删除选项列表文本，直接调用 user_confirm skill 让用户点击选择。",
          });
          continue; // 让 LLM 重新生成
        }
        messages.push({
          role: "assistant",
          content,
        });
        break;
      }

      // 有 tool calls
      messages.push({
        role: "assistant",
        content: response.content ?? "",
        toolCalls: response.toolCalls,
      });

      // 逐个执行 tool calls
      const convId3 = chatOptions?.conversationId || "default";
      for (const toolCall of response.toolCalls) {
        steps.push({
          type: "tool_call",
          toolCall,
          timestamp: Date.now(),
        });

        let result: ExecutionResult | { success: false; error: string };
        try {
          const params = toolCall.arguments.params
            ? (toolCall.arguments.params as Record<string, unknown>)
            : toolCall.arguments;
          // 硬性拦截：一个对话只能创建一个 Skill
          if (this.isSkillCreationBlocked(toolCall.name, convId3)) {
            result = {
              success: false,
              error: "【系统拦截】当前对话已创建过 Skill，禁止继续创建。规则：一个对话只能创建一个 Skill，创建成功后停止并等待用户反馈。如需创建其他 Skill，请开启新对话。",
            };
          } else {
            result = await this.engine.execute(toolCall.name, params);
            if (toolCall.name === "kb_search" && result.success) {
              const data = (result as any).data;
              if (Array.isArray(data) && data.length > 0) {
                this.kbSearchHasResults.add(convId3);
              }
            }
          }
        } catch (err) {
          result = {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }

        // Non-streaming: user_confirm cannot pause — return a failure so AI knows it needs streaming
        if (result.success && (result as any).data?.__userConfirm) {
          result = {
            success: false,
            error: "user_confirm requires streaming mode (SSE). Please use the streaming chat endpoint.",
          };
        }

        steps.push({
          type: "tool_result",
          toolResult: { skillName: toolCall.name, result },
          timestamp: Date.now(),
        });

        const resultContent = this.truncateToolResult(result);

        messages.push({
          role: "tool",
          content: resultContent,
          toolCallId: toolCall.id,
        });
      }

      if (iterations >= this.config.maxIterations) {
        hitMaxIterations = true;
      }
    }

    // 提取最终回复
    const lastAssistantMsg = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content);

    const finalResponse =
      lastAssistantMsg?.content ?? "[Agent reached max iterations without final response]";

    // 记录 assistant 回复到对话历史
    conversationHistory.push({
      role: "assistant",
      content: finalResponse,
    });

    // 如果 LLM 没有主动存储记忆，进行自动记忆提取
    if (this.config.autoMemory) {
      const memorySteps = await this.autoExtractMemory(userMessage, finalResponse, steps);
      steps.push(...memorySteps);
    }

    return {
      finalResponse,
      steps,
      iterations,
      hitMaxIterations,
    };
  }

  /**
   * 自动记忆提取：分析对话内容，将重要信息存入记忆
   * 仅在 LLM 本轮没有主动调用记忆 Skill 时触发
   */
  private async autoExtractMemory(
    userMessage: string,
    assistantResponse: string,
    steps: AgentStep[],
  ): Promise<AgentStep[]> {
    // 检查本轮是否已经有记忆操作
    const hasMemoryOps = steps.some(
      (s) =>
        s.type === "tool_call" &&
        s.toolCall &&
        (s.toolCall.name.startsWith("stm_") ||
          s.toolCall.name.startsWith("ltm_")),
    );
    if (hasMemoryOps) return []; // LLM 已经主动处理了

    const memorySteps: AgentStep[] = [];

    try {
      // 用 LLM 分析对话内容，提取需要记忆的信息
      const extractionPrompt = `分析对话，提取需长期记忆的关键信息。

用户: "${userMessage}"
助手: "${assistantResponse}"

输出 JSON 数组（仅 JSON，无其他文字）：
[{"key":"语义化key","value":"内容","tags":["分类"],"summary":"摘要"}]

类型：个人信息、偏好习惯、重要事实、用户要求记住的内容。无则输出 []`;

      const response = await this.provider.chat([
        { role: "user", content: extractionPrompt },
      ]);

      if (!response.content) return [];

      // 解析 LLM 返回的记忆条目
      const content = response.content.trim();
      // 提取 JSON 部分（处理可能的 markdown code block）
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const memories = JSON.parse(jsonMatch[0]) as Array<{
        key: string;
        value: string;
        tags?: string[];
        summary?: string;
      }>;

      // 逐条存储
      for (const mem of memories) {
        if (!mem.key || !mem.value) continue;

        try {
          const result = await this.engine.execute("ltm_store", {
            key: mem.key,
            value: mem.value,
            tags: mem.tags ?? [],
            summary: mem.summary ?? "",
          });

          memorySteps.push({
            type: "auto_memory",
            content: `Auto-stored: ${mem.key} = ${mem.value}`,
            toolResult: { skillName: "ltm_store", result },
            timestamp: Date.now(),
          });
        } catch {
          // 静默失败，不影响主流程
        }
      }
    } catch {
      // 提取失败不影响主流程
    }

    // Enhanced: 使用 FactExtractor 提取结构化事实
    if (this.factExtractor) {
      try {
        const conversationText = `User: ${userMessage}\nAssistant: ${assistantResponse}`;
        const facts = await this.factExtractor.extract(conversationText, this.provider);
        for (const fact of facts) {
          // 冲突检测
          if (this.conflictDetector && this.ltmBackend) {
            const conflicts = await this.conflictDetector.detectForKey(
              fact.key,
              fact.fact,
              this.ltmBackend,
              this.provider,
            );
            if (conflicts.length > 0 && conflicts[0].severity === "high") {
              continue; // 跳过高冲突事实
            }
          }
          // 存储结构化事实到 LTM
          try {
            const result = await this.engine.execute("ltm_store", {
              key: `fact:${fact.key}`,
              value: fact.fact,
              tags: [...(fact.tags ?? []), "fact", "extracted"],
              summary: fact.fact.substring(0, 100),
            });
            memorySteps.push({
              type: "auto_memory",
              content: `Enhanced fact stored: ${fact.key} = ${fact.fact}`,
              toolResult: { skillName: "ltm_store", result },
              timestamp: Date.now(),
            });
          } catch {
            // 单条存储失败不影响其他
          }
        }
      } catch {
        // Enhanced extraction is best-effort
      }
    }

    return memorySteps;
  }
}
