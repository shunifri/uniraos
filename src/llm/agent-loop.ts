/**
 * Agent Loop: ReAct 模式的 LLM 驱动 Skill 调用循环
 *
 * 流程: 用户输入 → LLM 推理 → 选择 Skill → 执行 → 观察结果 → 继续推理 → ... → 最终回复
 *       对话结束后 → 自动分析记忆 → 存储到 STM/LTM
 */
import type { ExecutionResult } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import type { ExecutionEngine } from "../engine/index.js";
import type {
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

const MEMORY_AWARE_PROMPT = `你是 RAOS (Recursive Agent Operating System) 的智能体，一个友善、自然的 AI 助手。

## 对话风格（最重要！）
像一个真实的朋友或助手一样说话，而不是机器人。

### 打招呼规则
- 如果"你对用户的了解"中有用户的名字，你**必须**用名字打招呼，例如"晚上好 Kavin！有什么需要帮忙的？"
- 根据当前时间（系统会提供）选择问候语：早上好（6-11点）/下午好（12-17点）/晚上好（18点以后）
- 如果记忆中没有名字，友好地问"你好呀，我可以怎么称呼你？"
- **禁止**在问候时列举你记得的其他信息（年龄、健康状况、家庭等），只用名字就够了
- 其他记忆是你的"内心知识"，只在用户聊到相关话题时才自然运用

### 回复原则
- 简洁自然，像真人聊天一样
- 记忆中的信息在相关时自然融入对话，不相关时不要主动提起
- 例如：用户说"帮我推荐个酒店"→ 你可以说"要不要找有游泳池的？你之前好像比较喜欢"（自然引用偏好）
- 例如：用户说"你好"→ 只需要友好问候，不要提健康数据

## 记忆管理
你拥有记忆能力，必须主动管理记忆：

### 存储长期记忆 (ltm_store)
当用户提到以下信息时，立即调用 ltm_store 存储：
- 个人信息：名字、职业、所在城市等
- 偏好和习惯：喜欢什么、不喜欢什么
- 重要事实：项目、技术栈、业务规则
- 用户要求记住的事情

存储时用有语义的 key 和 tags，例如：
- "我叫张三" → ltm_store(key="user_name", value="张三", tags=["personal","identity"])

### 存储短期记忆 (stm_store)
- 当前对话的临时上下文、中间结果、待办

### 原则
1. 主动存储，不要等用户说"记住这个"
2. 信息结构化存储，key 有语义
3. tags 有分类意义，方便检索

## 知识库（极其重要！）
你可以访问知识库（kb_search）来查找与用户问题相关的文档资料。

### 检索优先级（必须遵守）
1. **首先**检查系统自动注入的"相关知识"（见下方），如果已经包含了回答所需的信息，直接引用
2. **其次**，如果自动注入的知识不够充分，主动调用 kb_search 用不同关键词再检索
3. **最后**，只有当知识库确实没有相关内容时，才使用 web_search 搜索互联网
4. **绝对禁止**跳过知识库直接去 web_search — 知识库中的内容是用户上传的专属资料，优先级远高于网络信息

### 引用方式
- 回答时自然融合知识库内容，不要说"根据知识库"
- 如果知识库有明确答案，自信地回答，不需要额外搜索验证

## 任务执行
根据用户需求选择合适的 Skill 完成任务。如果需要多步操作，依次调用多个 Skill。
完成任务后，用自然语言总结结果回复用户。

## 文档生成规范（必须遵守）
当用户要求生成文档、报告、PPT 等文件时：
- **必须**使用 .md 格式，**禁止**使用 .pptx/.docx/.pdf 等二进制格式
- 系统会自动提供 PDF、DOCX、PPTX 格式转换下载按钮
- 生成 PPT 时，使用 \`---\` 分隔每张幻灯片，开头用 frontmatter 指定主题：
  \`\`\`
  ---
  theme: business-blue
  ---
  # 标题
  > 副标题
  ---
  ## 第一页
  - 要点
  ---
  ## 数据对比
  | 指标 | 数值 | 说明 |
  |------|------|------|
  | 效率 | 95%  | 提升显著 |
  \`\`\`
- **禁止在 markdown 中使用 HTML 标签**（如 \`<table>\`、\`<div>\`、\`<br>\`、\`<style>\` 等），所有内容必须用纯 markdown 语法
- 表格必须用 markdown 表格语法（\`| 列1 | 列2 |\`），禁止用 HTML \`<table>\` 标签
- 可选主题: business-blue / tech-dark / minimal-white / vibrant-orange / academic-green
- 可调用 pptx_list_themes 查看所有可用主题（包括用户自定义主题）

## 回复格式（极其重要！）
- **绝对禁止**在调用工具前写"让我xxx："或"我来xxx："这种以冒号结尾的预告。这会导致用户看到冒号后面一片空白。
- 正确做法：直接调用工具，拿到结果后再用自然语言回复用户。
- 如果需要连续调用多个工具，不要在每次调用前解说，直接调用即可。全部完成后统一回复结果。
- 示例（错误）：❌ "让我搜索一下相关信息：" → 然后调用 web_search
- 示例（正确）：✅ 直接调用 web_search，拿到结果后说"根据搜索结果，联鹏软件是..."
- 如果某个工具调用失败，不要反复尝试同一操作超过2次。换一个方法或直接告诉用户。`;

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
  /** 对话历史（跨 run 保持） */
  private conversationHistory: Message[] = [];
  /** 增强记忆模块（可选） */
  private factExtractor?: FactExtractor;
  private conflictDetector?: ConflictDetector;
  private ltmBackend?: LTMBackend;

  constructor(
    registry: SkillRegistry,
    engine: ExecutionEngine,
    provider: LLMProvider,
    config?: Partial<AgentLoopConfig>,
  ) {
    this.registry = registry;
    this.engine = engine;
    this.provider = provider;
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
    // 如果用户没有自定义 systemPrompt，使用记忆感知版本
    if (config?.systemPrompt === undefined || config.systemPrompt === "") {
      this.config.systemPrompt = MEMORY_AWARE_PROMPT;
    }
    this.toolDefs = skillsToTools(registry.list());
  }

  registerToolSchema(toolDef: ToolDefinition): void {
    this.toolSchemas.set(toolDef.function.name, toolDef);
    this.refreshTools();
  }

  refreshTools(): void {
    this.toolDefs = skillsToTools(this.registry.list()).map((td) => {
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

  /** 清空对话历史 */
  clearHistory(): void {
    this.conversationHistory = [];
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
      // 检查 ltm_search 是否已注册
      const skills = this.registry.list();
      const hasLtmSearch = skills.some((s) => s.name === "ltm_search");
      const hasKbSearch = skills.some((s) => s.name === "kb_search");

      // 并行检索 LTM 和知识库
      const promises: Promise<{ type: string; data: any } | null>[] = [];

      if (hasLtmSearch) {
        promises.push(
          Promise.race([
            this.engine.execute("ltm_search", { query: userMessage, limit: 5 }).then((r) => r.success ? { type: "ltm", data: r.data } : null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]).catch(() => null)
        );
      }

      // 判断是否为不需要知识库的消息（问候/闲聊/纯计算/代码类）
      const skipKbSearch = (() => {
        const msg = userMessage.trim();
        // 短消息（问候/闲聊）
        if (msg.length <= 10) return true;
        // 纯数学表达式
        if (/^[\d\s+\-*/().=×÷%^]+[等于多少是什么几]*.{0,5}$/.test(msg)) return true;
        // 明确的计算请求
        if (/^(计算|算一下|求|多少)/.test(msg) && /\d/.test(msg)) return true;
        return false;
      })();
      if (hasKbSearch && !skipKbSearch) {
        promises.push(
          Promise.race([
            this.engine.execute("kb_search", { query: userMessage, limit: 5, threshold: 0.15 }).then((r) => r.success ? { type: "kb", data: r.data } : null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
          ]).catch(() => null)
        );
      }

      const results = await Promise.all(promises);

      for (const res of results) {
        if (!res || !res.data || typeof res.data !== "object") continue;

        if (res.type === "ltm") {
          const data = res.data as { results?: Array<{ key: string; value: unknown; summary?: string; tags?: string[] }> };
          if (data.results && data.results.length > 0) {
            const memoryLines = data.results.map(
              (m) => `- [${m.key}] ${m.summary || JSON.stringify(m.value)}${m.tags?.length ? ` (tags: ${m.tags.join(", ")})` : ""}`
            );
            context += `\n\n## 你对用户的了解（内部参考，禁止直接列举给用户）\n${memoryLines.join("\n")}`;
          }
        }

        if (res.type === "kb") {
          const data = res.data as { results?: Array<{ docName: string; content: string; score: number; matchType: string }> };
          if (data.results && data.results.length > 0) {
            const kbLines = data.results.map(
              (r) => `- [${r.docName}] ${r.content?.slice(0, 300)}${r.content?.length > 300 ? "..." : ""}`
            );
            context += `\n\n## 相关知识（来自用户知识库，优先使用这些内容回答，不要再去 web_search）\n${kbLines.join("\n")}`;
          }
        }
      }
    } catch {
      // 静默失败
    }
    return context;
  }

  /** 流式 Agent 循环事件类型 */
  async *runStream(userMessage: string): AsyncGenerator<StreamEvent> {
    this.refreshTools();

    // 自动检索相关记忆，注入系统提示
    const memoryContext = await this.recallMemories(userMessage);

    const messages: Message[] = [
      { role: "system", content: this.config.systemPrompt + memoryContext },
      ...this.conversationHistory,
      { role: "user", content: userMessage },
    ];

    this.conversationHistory.push({ role: "user", content: userMessage });

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

        for await (const chunk of this.provider.chatStream(messages, this.toolDefs)) {
          if (chunk.type === "text_delta" && chunk.text) {
            textContent += chunk.text;
            yield { event: "text_delta", data: { text: chunk.text } };
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

        // 没有 tool calls，推理结束
        if (toolCalls.length === 0) {
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
            result = await this.engine.execute(toolCall.name, params);
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
        const response = await this.provider.chat(messages, this.toolDefs);

        if (response.content) {
          steps.push({ type: "llm_response", content: response.content, timestamp: Date.now() });
          yield { event: "text_delta", data: { text: response.content } };
        }

        if (response.finishReason !== "tool_calls" || response.toolCalls.length === 0) {
          messages.push({ role: "assistant", content: response.content ?? "" });
          break;
        }

        messages.push({ role: "assistant", content: response.content ?? "", toolCalls: response.toolCalls });

        for (const toolCall of response.toolCalls) {
          steps.push({ type: "tool_call", toolCall, timestamp: Date.now() });
          yield { event: "tool_call", data: { toolCall } };
          yield { event: "tool_start", data: { skillName: toolCall.name, toolCallId: toolCall.id } };

          let result: ExecutionResult | { success: false; error: string };
          try {
            const params = toolCall.arguments.params
              ? (toolCall.arguments.params as Record<string, unknown>)
              : toolCall.arguments;
            result = await this.engine.execute(toolCall.name, params);
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

    this.conversationHistory.push({ role: "assistant", content: finalResponse });

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
  async run(userMessage: string): Promise<AgentResult> {
    this.refreshTools();

    // 自动检索相关记忆，注入系统提示
    const memoryContext = await this.recallMemories(userMessage);

    // 构建消息列表：system + 历史 + 新消息
    const messages: Message[] = [
      { role: "system", content: this.config.systemPrompt + memoryContext },
      ...this.conversationHistory,
      { role: "user", content: userMessage },
    ];

    // 记录这轮新增的用户消息
    this.conversationHistory.push({ role: "user", content: userMessage });

    const steps: AgentStep[] = [];
    let iterations = 0;
    let hitMaxIterations = false;

    while (iterations < this.config.maxIterations) {
      iterations++;

      const response = await this.provider.chat(messages, this.toolDefs);

      if (response.content) {
        steps.push({
          type: "llm_response",
          content: response.content,
          timestamp: Date.now(),
        });
      }

      // 没有 tool calls，推理结束
      if (response.finishReason !== "tool_calls" || response.toolCalls.length === 0) {
        messages.push({
          role: "assistant",
          content: response.content ?? "",
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
          result = await this.engine.execute(toolCall.name, params);
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
    this.conversationHistory.push({
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
      const extractionPrompt = `分析以下对话，提取需要长期记忆的关键信息。

用户消息: "${userMessage}"
助手回复: "${assistantResponse}"

如果对话中包含以下类型的信息，以 JSON 数组格式输出需要存储的记忆：
- 用户的个人信息（名字、职业、位置等）
- 用户的偏好和习惯
- 重要的事实、决定、约定
- 用户明确要求记住的内容

输出格式（仅输出 JSON，无其他文字）：
[{"key": "语义化的key", "value": "要记住的内容", "tags": ["分类标签"], "summary": "一句话摘要"}]

如果没有需要记忆的信息，输出空数组: []`;

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
