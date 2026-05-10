/**
 * Inbox Service — 统一收件箱核心业务逻辑
 *
 * 职责：
 * - InboxItem 的 CRUD
 * - 聚合逻辑
 * - AI Review 触发
 * - 投递分发（调用 DeliveryRouter）
 */

import { log } from "../utils/logger.js";
import { getInboxRepository } from "./inbox-repository.js";
import { getDeliveryRouter } from "./delivery-router.js";
import { inboxEventBus } from "./inbox-events.js";
import type {
  InboxItem,
  CreateInboxItemInput,
  InboxQuery,
  InboxStats,
  AggregateOptions,
} from "./inbox-types.js";
import type { LLMProvider } from "../llm/types.js";

// 全局 LLM Provider getter（由 server.ts 初始化时注入）
let aiReviewProviderGetter: (() => LLMProvider | null) | null = null;

export function setAiReviewProviderGetter(getter: () => LLMProvider | null): void {
  aiReviewProviderGetter = getter;
}

export class InboxService {
  private repo = getInboxRepository();
  private router = getDeliveryRouter();

  /**
   * 创建 InboxItem
   */
  async createItem(input: CreateInboxItemInput): Promise<InboxItem> {
    const item = await this.repo.create(input);
    log("info", "inbox_item_created", { id: item.id, category: item.category, userId: item.userId });

    // 广播事件（SSE 推送）
    inboxEventBus.emitInboxEvent({ type: "new_item", userId: item.userId, item });

    // 触发投递
    await this.deliver(item);

    // 异步触发 AI Review（审批类默认开启）
    if (item.type === "approval") {
      this.triggerAIReview(item).catch((err) => {
        log("error", "inbox_ai_review_failed", { id: item.id, error: err.message });
      });
    }

    return item;
  }

  /**
   * 查询单个
   */
  async getItem(id: string): Promise<InboxItem | null> {
    return this.repo.findById(id);
  }

  /**
   * 列表查询
   */
  async listItems(query: InboxQuery): Promise<{ items: InboxItem[]; total: number }> {
    return this.repo.list(query);
  }

  /**
   * 标记已读
   */
  async markAsRead(id: string): Promise<void> {
    const item = await this.repo.findById(id);
    if (!item) return;
    await this.repo.updateStatus(id, "read");
    log("info", "inbox_item_read", { id });
    inboxEventBus.emitInboxEvent({ type: "item_updated", userId: item.userId, itemId: id, status: "read" });
  }

  /**
   * 完成/处理
   */
  async completeItem(id: string, result?: any): Promise<InboxItem | null> {
    const item = await this.repo.findById(id);
    if (!item) return null;

    await this.repo.updateStatus(id, "completed", Date.now());
    log("info", "inbox_item_completed", { id, category: item.category });

    inboxEventBus.emitInboxEvent({ type: "item_updated", userId: item.userId, itemId: id, status: "completed" });

    // 如果是 workflow_task，需要回调 workflow engine
    if (item.category === "workflow_task" && item.sourceId) {
      await this.callbackWorkflow(item, result);
    }

    // 如果是 evolution_approval，需要回调 evolution controller
    if (item.category === "evolution_approval" && item.sourceId) {
      await this.callbackEvolution(item, result);
    }

    return this.repo.findById(id);
  }

  /**
   * 忽略/关闭
   */
  async dismissItem(id: string): Promise<void> {
    const item = await this.repo.findById(id);
    if (!item) return;
    await this.repo.updateStatus(id, "dismissed", Date.now());
    log("info", "inbox_item_dismissed", { id });
    inboxEventBus.emitInboxEvent({ type: "item_updated", userId: item.userId, itemId: id, status: "dismissed" });
  }

  /**
   * 通过 source + sourceId 完成（用于系统回调）
   */
  async completeBySource(source: string, sourceId: string, result?: any): Promise<InboxItem | null> {
    const item = await this.repo.findBySourceAndSourceId(source, sourceId);
    if (!item) return null;
    return this.completeItem(item.id, result);
  }

  /**
   * 统计
   */
  async getStats(userId: string): Promise<InboxStats> {
    return this.repo.getStats(userId);
  }

  /**
   * 未读数
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.repo.getUnreadCount(userId);
  }

  /**
   * 聚合
   */
  async aggregateItems(userId: string, options: AggregateOptions = {}): Promise<InboxItem[]> {
    if (options.enabled === false) {
      const { items } = await this.listItems({ userId, pageSize: 1000 });
      return items;
    }

    const { items } = await this.listItems({ userId, status: "unread", pageSize: 1000 });
    if (items.length < 2) return items;

    const timeWindow = options.timeWindowMs || 3600000; // 默认 1h
    const threshold = Date.now() - timeWindow;

    // 按 category + source 分组
    const groups = new Map<string, InboxItem[]>();
    for (const item of items) {
      if (item.createdAt < threshold) continue;
      const key = `${item.category}:${item.source}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

    const result: InboxItem[] = [];

    for (const [, groupItems] of groups) {
      if (groupItems.length < 2) {
        result.push(...groupItems);
        continue;
      }

      // 时间窗口聚类
      const clusters = this.clusterByTimeWindow(groupItems, timeWindow);

      for (const cluster of clusters) {
        if (cluster.length < 2) {
          result.push(...cluster);
          continue;
        }

        // 语义相似度聚类（如果启用了阈值）
        const simThreshold = options.similarityThreshold;
        if (simThreshold && simThreshold > 0) {
          const semanticClusters = this.clusterBySemanticSimilarity(cluster, simThreshold);
          for (const semCluster of semanticClusters) {
            if (semCluster.length < 2) {
              result.push(...semCluster);
              continue;
            }
            result.push(this.createAggregateItem(semCluster));
          }
        } else {
          result.push(this.createAggregateItem(cluster));
        }
      }
    }

    return result;
  }

  // ─── 私有方法 ───

  private async deliver(item: InboxItem): Promise<void> {
    try {
      const decision = await this.router.route({
        item,
        userOnline: false, // 无 presence 系统时安全默认：离线通知走 email/IM 而非 chat
        relatedConversationId: item.conversationId,
      });

      switch (decision.channel) {
        case "chat":
          if (decision.targetConversationId) {
            await this.router.deliverToChat(item, decision.targetConversationId);
          }
          break;
        case "inbox":
          await this.router.deliverToInbox(item);
          break;
        case "email":
          await this.router.deliverToEmail(item);
          break;
        case "im":
          await this.router.deliverToIM(item);
          break;
        case "push":
          // TODO: Phase 4 实现推送通知
          break;
      }
    } catch (err: any) {
      log("error", "inbox_deliver_failed", { id: item.id, error: err.message });
    }
  }

  private async triggerAIReview(item: InboxItem): Promise<void> {
    const provider = aiReviewProviderGetter?.();
    if (!provider) {
      log("warn", "inbox_ai_review_no_provider", { id: item.id });
      return;
    }

    try {
      // 1. 尝试加载相关上下文（LTM / 历史审批记录）
      let context = "";
      try {
        // 查询该用户最近 10 条同类型的审批记录作为上下文
        const history = await this.repo.list({
          userId: item.userId,
          category: item.category,
          status: "completed",
          pageSize: 10,
        });
        if (history.items.length > 0) {
          context = history.items
            .map((h) => `- ${h.title} (${h.status})`)
            .join("\n");
        }
      } catch {
        // 上下文加载失败不影响主流程
      }

      // 2. 构造审批建议 prompt
      const payloadJson = JSON.stringify(item.payload || {}).slice(0, 1000);
      const prompt = `你是一位严谨的企业智能审批助手。请根据以下信息给出审批建议，并简要说明理由。

审批事项:
- 标题: ${item.title}
- 类型: ${item.type}
- 分类: ${item.category}
- 描述: ${item.description || "无"}
- 优先级: ${item.priority}
- 附加数据: ${payloadJson}

${context ? `该用户近期同类审批历史:\n${context}\n` : ""}

请用 JSON 格式返回（不要包含 markdown 代码块标记）：
{
  "recommendation": "approve | reject | need_more_info",
  "confidence": 0.0-1.0,
  "reason": "简要理由（50字以内）",
  "risks": ["风险1", "风险2"],
  "suggestedAction": "建议操作"
}`;

      const response = await provider.chat([
        { role: "system", content: "你是一个严谨的企业审批助手，只输出 JSON。" },
        { role: "user", content: prompt },
      ]);

      const content = response.content || "";
      // 尝试从回复中提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      let suggestion: any = null;
      if (jsonMatch) {
        try {
          suggestion = JSON.parse(jsonMatch[0]);
        } catch {
          suggestion = { raw: content };
        }
      } else {
        suggestion = { raw: content };
      }

      // 3. 存入 ai_suggestion
      await this.repo.updateAISuggestion(item.id, suggestion);
      log("info", "inbox_ai_review_completed", { id: item.id, recommendation: suggestion?.recommendation });
    } catch (err: any) {
      log("error", "inbox_ai_review_failed", { id: item.id, error: err.message });
    }
  }

  private async callbackWorkflow(item: InboxItem, result?: any): Promise<void> {
    try {
      const { getWorkflowEngine } = await import("../workflow/engine.js");
      const engine = getWorkflowEngine();
      if (item.sourceId) {
        const taskId = parseInt(item.sourceId, 10);
        if (!isNaN(taskId)) {
          // 从 result 中提取 action 和 userId
          const action = result?.action || "approve";
          const formData = result?.formData || {};
          const comment = result?.comment || "";
          const userId = result?.userId || item.userId;
          await engine.completeTask(taskId, { action, formData, comment }, userId);
          log("info", "inbox_callback_workflow_completed", { itemId: item.id, taskId });
        }
      }
    } catch (err: any) {
      log("error", "inbox_callback_workflow_failed", { itemId: item.id, error: err.message });
    }
  }

  private async callbackEvolution(item: InboxItem, result?: any): Promise<void> {
    try {
      const { getGlobalEvolutionController } = await import("../engine/evolution-controller.js");
      const controller = getGlobalEvolutionController();
      if (controller && item.sourceId) {
        const action = result?.action || "approve";
        if (action === "approve") {
          controller.approve(item.sourceId);
        } else if (action === "reject") {
          controller.reject(item.sourceId, result?.reason || "通过 Inbox 拒绝");
        }
        log("info", "inbox_callback_evolution_completed", { itemId: item.id, approvalId: item.sourceId, action });
      }
    } catch (err: any) {
      log("error", "inbox_callback_evolution_failed", { itemId: item.id, error: err.message });
    }
  }

  private clusterByTimeWindow(items: InboxItem[], windowMs: number): InboxItem[][] {
    const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
    const clusters: InboxItem[][] = [];
    let current: InboxItem[] = [];

    for (const item of sorted) {
      if (current.length === 0) {
        current.push(item);
      } else {
        const last = current[current.length - 1];
        if (item.createdAt - last.createdAt <= windowMs) {
          current.push(item);
        } else {
          clusters.push(current);
          current = [item];
        }
      }
    }

    if (current.length > 0) clusters.push(current);
    return clusters;
  }

  /**
   * 基于语义相似度的聚类（简化版：关键词 Jaccard 相似度）
   */
  private clusterBySemanticSimilarity(items: InboxItem[], threshold: number): InboxItem[][] {
    const clusters: InboxItem[][] = [];
    const used = new Set<number>();

    for (let i = 0; i < items.length; i++) {
      if (used.has(i)) continue;
      const cluster = [items[i]];
      used.add(i);

      for (let j = i + 1; j < items.length; j++) {
        if (used.has(j)) continue;
        const sim = this.computeTextSimilarity(items[i], items[j]);
        if (sim >= threshold) {
          cluster.push(items[j]);
          used.add(j);
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  /**
   * 计算两个 InboxItem 的文本相似度（Jaccard 系数）
   */
  private computeTextSimilarity(a: InboxItem, b: InboxItem): number {
    const textA = `${a.title} ${a.description || ""} ${a.category}`;
    const textB = `${b.title} ${b.description || ""} ${b.category}`;

    const tokensA = this.extractTokens(textA);
    const tokensB = this.extractTokens(textB);

    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
    const union = new Set([...tokensA, ...tokensB]);
    return intersection.size / union.size;
  }

  /**
   * 提取文本关键词（简单分词 + 去停用词）
   */
  private extractTokens(text: string): Set<string> {
    const stopWords = new Set(["的", "了", "是", "在", "和", "有", "我", "你", "他", "她", "它", "们", "这", "那", "之", "与", "及", "或", "等", "个", "为", "以", "可", "请", "无", "未", "已", "将", "并", "且", "但", "而", "于", "对", "从", "到", "中", "上", "下", "前", "后", "里", "外", "内", "间", "来", "去", "过", "着", "被", "把", "给", "让", "向", "往", "由", "自", "至", "若", "如", "则", "因", "故", "所", "其", "该", "此", "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "shall", "should", "can", "could", "may", "might", "must", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "and", "but", "if", "or", "because", "until", "while", "about", "against", "out", "off", "over", "under"]);

    const tokens = new Set<string>();
    // 匹配中文字符和英文单词
    const matches = text.toLowerCase().match(/[\u4e00-\u9fa5]|[a-z]+/g);
    if (matches) {
      for (const token of matches) {
        if (token.length > 1 && !stopWords.has(token)) {
          tokens.add(token);
        }
      }
    }
    return tokens;
  }

  /**
   * 创建聚合后的 InboxItem
   */
  private createAggregateItem(cluster: InboxItem[]): InboxItem {
    return {
      ...cluster[0],
      id: `agg_${crypto.randomUUID().slice(0, 12)}`,
      aggregateCount: cluster.length,
      aggregateGroupId: cluster[0].id,
      title: `${cluster[0].title} (等 ${cluster.length} 条)`,
      payload: {
        ...cluster[0].payload,
        aggregatedItems: cluster,
      },
    };
  }
}

// 单例
let serviceInstance: InboxService | null = null;

export function getInboxService(): InboxService {
  if (!serviceInstance) {
    serviceInstance = new InboxService();
  }
  return serviceInstance;
}
