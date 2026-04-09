import { Router } from "express";
import { join } from "path";
import { requireAuth, requirePermission } from "../db/auth-middleware.js";
import { getDb } from "../db/database.js";
import { parseDocument } from "../services/doc-parser.js";
import type { RouteDependencies } from "./index.js";
import { confirmQueue } from "../skills/user-confirm-skill.js";

export function createAgentRoutes(deps: RouteDependencies): Router {
  const {
    sessionManager,
    getAgentLoop,
    getOrchestrator,
    getVisionConfig,
  } = deps;
  const router = Router();

  // Agent chat (LLM + Tool Use)
  router.post("/agent/chat", requireAuth, requirePermission("chat"), async (req, res) => {
    const userId = req.user!.id;
    const { message, mode } = req.body as { message: string; mode?: "auto" | "simple" | "react" | "legacy" };
    if (!message) {
      res.status(400).json({ success: false, error: "message is required" });
      return;
    }

    if (mode === "legacy" || mode === "react") {
      const loop = getAgentLoop(userId);
      if (!loop) {
        res.status(400).json({ success: false, error: "LLM not configured" });
        return;
      }
      try {
        const result = await loop.run(message);
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    const orchestrator = getOrchestrator();
    if (!orchestrator) {
      res.status(400).json({ success: false, error: "LLM not configured" });
      return;
    }

    try {
      const result = await orchestrator.run({ message, userId });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Agent streaming chat (SSE)
  router.post("/agent/chat/stream", requireAuth, requirePermission("chat.stream"), async (req, res) => {
    const userId = req.user!.id;
    const { message, mode, conversationId, deepThink } = req.body as {
      message: string;
      mode?: "auto" | "simple" | "react" | "legacy";
      conversationId?: string;
      deepThink?: boolean;
    };
    console.log(`   [Chat] user=${userId}, deepThink=${!!deepThink}, msgLen=${message?.length ?? 0}`);
    if (!message) {
      res.status(400).json({ success: false, error: "message is required" });
      return;
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(`event: connected\ndata: {}\n\n`);

    let closed = false;
    res.on("close", () => {
      closed = true;
      // TODO: Clean up any pending user_confirm for this session.
      // Currently we cannot easily map confirmIds to sessions without additional tracking.
      // confirmQueue entries will self-clean via their 2-minute timeout safety net.
    });

    const write = (eventName: string, data: unknown) => {
      if (closed) return;
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // ===== Backend message persistence =====
    const convId = conversationId || null;
    const insertMsg = convId
      ? getDb().prepare("INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, is_error, extra) VALUES (?, ?, ?, ?, ?, ?, ?)")
      : null;

    function saveMsg(role: string, content: string, opts?: { skillName?: string; status?: string; isError?: boolean; extra?: unknown }) {
      if (!insertMsg || !convId) return;
      try {
        insertMsg.run(convId, role, content, opts?.skillName || null, opts?.status || null, opts?.isError ? 1 : 0, opts?.extra ? JSON.stringify(opts.extra) : null);
      } catch {}
    }

    function updateConvTitle(title: string) {
      if (!convId) return;
      try {
        const msgCount = (getDb().prepare("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ?").get(convId) as any).c;
        if (msgCount <= 2) {
          getDb().prepare("UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ?").run(title, convId);
        } else {
          getDb().prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?").run(convId);
        }
      } catch {}
    }

    // Save user message
    saveMsg("user", message);
    updateConvTitle(message.slice(0, 50) + (message.length > 50 ? "..." : ""));

    // Parse attachments: use vision model OCR to parse file content
    let enrichedMessage = message;
    const attachmentMatch = message.match(/^\[附件: (.+?)\]\n?([\s\S]*)$/);
    if (attachmentMatch) {
      const attachmentStr = attachmentMatch[1];
      const userText = attachmentMatch[2] || "";
      const fileEntries = attachmentStr.split(", ").map((entry) => {
        const m = entry.match(/^(.+?)\s*\(路径:\s*(.+?)\)$/);
        return m ? { name: m[1], path: m[2] } : null;
      }).filter(Boolean) as Array<{ name: string; path: string }>;

      if (fileEntries.length > 0) {
        const visionConfig = getVisionConfig();
        const SAFE_BASE = join(process.cwd(), ".raos", "workspace");
        const fileContents: string[] = [];

        for (const file of fileEntries) {
          try {
            const safePath = join(SAFE_BASE, file.path);
            write("tool_start", { skillName: "doc_parse", args: { file: file.name } });
            const result = await parseDocument(safePath, visionConfig);
            if (result.success) {
              let content = result.content;
              if (content.length > 8000) content = content.slice(0, 8000) + "\n...[内容已截断]";
              fileContents.push(`### 文件: ${file.name}\n${content}`);
              write("tool_result", { result: { success: true, data: { message: `${file.name} 解析完成 (${result.format}, ${result.metadata?.method})` } } });
            } else {
              fileContents.push(`### 文件: ${file.name}\n[解析失败: ${result.error}]`);
              write("tool_result", { result: { success: false, error: result.error } });
            }
          } catch (e: any) {
            fileContents.push(`### 文件: ${file.name}\n[读取失败: ${e.message}]`);
            write("tool_result", { result: { success: false, error: e.message } });
          }
        }
        enrichedMessage = `${userText}\n\n---\n## 用户上传的文件内容\n${fileContents.join("\n\n")}`;
      }
    }

    // Track streaming text and chart data
    let currentAssistantText = "";
    let pendingToolName = "";
    let kbRefsSent = false;
    let kbRefsForSave: unknown[] = [];
    let webRefsForSave: unknown[] = [];

    try {
      const processEvent = (eventName: string, eventData: any) => {
        // 拦截 user_confirm：当 tool_result 包含 __userConfirm 时，改为发送 user_confirm 事件
        if (eventName === "tool_result" && eventData?.result?.data?.__userConfirm) {
          write("user_confirm", eventData.result.data);
          saveMsg("tool", "等待用户确认...", {
            skillName: eventData.skillName ?? pendingToolName,
            status: "done",
            isError: false,
          });
          return;
        }
        // user_confirm 事件直接透传（来自 AgentLoop 路径）
        if (eventName === "user_confirm") {
          write("user_confirm", eventData);
          return;
        }

        write(eventName, eventData);

        if (eventName === "strategy_selected") {
          const levelMap: Record<string, string> = { simple: "直接回答", react: "逐步推理" };
          const label = levelMap[eventData.level] || eventData.level;
          saveMsg("strategy", `策略: ${label}${eventData.reasoning ? " — " + eventData.reasoning : ""}`);
        } else if (eventName === "text_delta") {
          currentAssistantText += eventData.text ?? "";
        } else if (eventName === "tool_call") {
          if (currentAssistantText) {
            saveMsg("assistant", currentAssistantText);
            currentAssistantText = "";
          }
        } else if (eventName === "tool_start") {
          pendingToolName = eventData.skillName ?? "";
        } else if (eventName === "tool_result") {
          const r = eventData.result;
          let summary = "";
          let extra: Record<string, unknown> | undefined;

          if (r?.success) {
            if (r.data?.__type === "file_download" && r.data?.files) {
              summary = `已准备 ${r.data.files.length} 个文件`;
              extra = { fileDownload: r.data };
            } else if (r.data?.option && r.data?.chartType) {
              summary = `已生成${r.data.chartType}图表`;
              extra = { chartOptions: [r.data.option] };
            } else if (r.data?.charts && Array.isArray(r.data.charts)) {
              summary = `已生成 ${r.data.charts.length} 个图表`;
              extra = { chartOptions: r.data.charts.map((c: any) => c.option).filter(Boolean) };
            } else if (r.data?.message) {
              summary = r.data.message;
            } else if (r.data?.results && Array.isArray(r.data.results)) {
              summary = `获取到 ${r.data.results.length} 条结果`;
            } else if (typeof r.data === "string") {
              summary = r.data.slice(0, 300);
            } else if (r.data && typeof r.data === "object") {
              // 发送精简的结果数据给前端
              const dataStr = JSON.stringify(r.data);
              summary = r.data.message || r.data.text || r.data.content ||
                        (dataStr.length <= 500 ? dataStr : dataStr.slice(0, 300) + "...");
              // 传递完整数据供展开查看
              extra = { ...(extra ?? {}), resultData: r.data };
            } else {
              summary = "完成";
            }
          } else {
            summary = r?.error?.message || r?.error || "失败";
          }
          saveMsg("tool", summary, {
            skillName: eventData.skillName ?? pendingToolName,
            status: r?.success ? "done" : "error",
            isError: !r?.success,
            extra: { ...(extra ?? {}), result: r },
          });

          // kb_search 结果 → 提取为知识库引用卡片
          const toolName = eventData.skillName ?? pendingToolName;
          if (toolName === "kb_search" && r?.success && r.data?.results && Array.isArray(r.data.results) && r.data.results.length > 0) {
            const refs = r.data.results.map((item: any, i: number) => ({
              index: i + 1,
              docId: item.docId,
              docName: item.docName,
              chunkIndex: item.chunkIndex,
              content: item.content,
              score: item.score,
              pageNumber: item.pageNumber ?? null,
              bboxes: item.bboxes ?? null,
            }));
            write("kb_references", { references: refs });
            kbRefsSent = true;
            kbRefsForSave = refs;
          }
        } else if (eventName === "agent_done" || eventName === "done") {
          if (currentAssistantText) {
            const extraObj: Record<string, unknown> = {};
            if (kbRefsForSave.length > 0) extraObj.kbReferences = kbRefsForSave;
            if (webRefsForSave.length > 0) extraObj.webReferences = webRefsForSave;
            const kbExtra = Object.keys(extraObj).length > 0 ? extraObj : undefined;
            saveMsg("assistant", currentAssistantText, { extra: kbExtra });
            currentAssistantText = "";
            kbRefsForSave = [];
            webRefsForSave = [];
          }
          if (eventData.hitMax) {
            saveMsg("system", "已达最大迭代次数");
          }
        } else if (eventName === "error") {
          saveMsg("assistant", eventData.error || "未知错误", { isError: true });
        }
      };

      if (mode === "legacy" || mode === "react") {
        // 直接 AgentLoop 模式
        const loop = getAgentLoop(userId);
        if (!loop) { write("error", { error: "LLM not configured" }); res.end(); return; }
        const loopChatOptions = deepThink ? { deepThink: true } : undefined;
        for await (const event of loop.runStream(enrichedMessage, loopChatOptions)) {
          if (closed) break;
          processEvent(event.event, event.data);
        }
      } else {
        // 默认 Orchestrator 模式（始终使用 react 策略，不走 simple）
        const orchestrator = getOrchestrator();
        if (!orchestrator) { write("error", { error: "LLM not configured" }); res.end(); return; }
        for await (const event of orchestrator.runStream({ message: enrichedMessage, userId, context: { deepThink } })) {
          if (closed) break;
          processEvent(event.event, event.data);
        }
      }

      // Save any remaining text after stream ends
      if (currentAssistantText) {
        const extraObj: Record<string, unknown> = {};
        if (kbRefsForSave.length > 0) extraObj.kbReferences = kbRefsForSave;
        if (webRefsForSave.length > 0) extraObj.webReferences = webRefsForSave;
        const extra = Object.keys(extraObj).length > 0 ? extraObj : undefined;
        saveMsg("assistant", currentAssistantText, { extra });
        currentAssistantText = "";
      }
    } catch (err) {
      write("error", { error: err instanceof Error ? err.message : String(err) });
      saveMsg("assistant", err instanceof Error ? err.message : String(err), { isError: true });
    }

    if (!closed) {
      res.end();
    }
  });

  // POST /api/agent/chat/confirm — resolve a pending user_confirm
  router.post("/agent/chat/confirm", requireAuth, (req, res) => {
    const { confirmId, response, cancelled } = req.body;
    if (!confirmId) {
      res.status(400).json({ error: "confirmId required" });
      return;
    }
    const pending = confirmQueue.get(confirmId);
    if (!pending) {
      res.status(404).json({ error: "Confirmation not found or expired" });
      return;
    }
    clearTimeout(pending.timeout);
    confirmQueue.delete(confirmId);
    if (cancelled) {
      pending.resolve({ cancelled: true, message: "用户取消了操作" });
    } else {
      pending.resolve(response);
    }
    res.json({ success: true });
  });

  // Strategy analysis API
  router.post("/agent/strategy", requireAuth, requirePermission("chat"), async (req, res) => {
    const orchestrator = getOrchestrator();
    if (!orchestrator) {
      res.status(400).json({ success: false, error: "LLM not configured" });
      return;
    }

    const { message } = req.body as { message: string };
    if (!message) {
      res.status(400).json({ success: false, error: "message is required" });
      return;
    }

    try {
      const decision = await orchestrator.analyzeStrategy(message);
      res.json({ success: true, strategy: decision });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Clear conversation history
  router.post("/agent/clear", requireAuth, (req, res) => {
    const userId = req.user!.id;
    const session = sessionManager.getOrCreate(userId);
    if (session.agentLoop) {
      session.agentLoop.clearHistory();
    }
    const orchestrator = getOrchestrator();
    if (orchestrator) {
      orchestrator.clearHistory(userId);
    }
    res.json({ success: true, message: "Conversation history cleared" });
  });

  // ===== Chat history persistence API =====

  router.get("/conversations", requireAuth, (req, res) => {
    const userId = req.user!.id;
    const rows = getDb().prepare(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50"
    ).all(userId);
    res.json({ success: true, conversations: rows });
  });

  router.post("/conversations", requireAuth, (req, res) => {
    const userId = req.user!.id;
    const id = "conv_" + crypto.randomUUID().slice(0, 12);
    const title = req.body.title || "新对话";
    getDb().prepare(
      "INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)"
    ).run(id, userId, title);
    res.json({ success: true, id, title });
  });

  router.get("/conversations/:id/messages", requireAuth, (req, res) => {
    const userId = req.user!.id;
    const convId = req.params.id as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const beforeId = parseInt(req.query.before_id as string) || 0;

    const conv = getDb().prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?").get(convId, userId);
    if (!conv) { res.status(404).json({ success: false, error: "Conversation not found" }); return; }

    let rows: any[];
    if (beforeId > 0) {
      rows = getDb().prepare(
        "SELECT id, role, content, skill_name, status, is_error, extra, created_at FROM chat_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?"
      ).all(convId, beforeId, limit) as any[];
      rows.reverse();
    } else {
      rows = getDb().prepare(
        "SELECT id, role, content, skill_name, status, is_error, extra, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?"
      ).all(convId, limit) as any[];
      rows.reverse();
    }

    const msgs = rows.map((r) => ({
      ...r,
      extra: r.extra ? JSON.parse(r.extra) : undefined,
    }));

    const hasMore = rows.length > 0 && (getDb().prepare(
      "SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ? AND id < ?"
    ).get(convId, rows[0].id) as any).c > 0;

    res.json({ success: true, messages: msgs, hasMore });
  });

  router.post("/conversations/:id/messages", requireAuth, (req, res) => {
    const userId = req.user!.id;
    const convId = req.params.id as string;
    console.log(`   [CHAT] Save messages to ${convId}: ${JSON.stringify((req.body.messages || []).map((m: any) => ({ role: m.role, len: m.content?.length })))}`);
    const conv = getDb().prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?").get(convId, userId);
    if (!conv) { res.status(404).json({ success: false, error: "Conversation not found" }); return; }

    const msgs: Array<{ role: string; content: string; skillName?: string; status?: string; isError?: boolean; extra?: unknown }> = req.body.messages || [];
    const insert = getDb().prepare(
      "INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, is_error, extra) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertMany = getDb().transaction((items: typeof msgs) => {
      for (const m of items) {
        const extraJson = m.extra ? JSON.stringify(m.extra) : null;
        insert.run(convId, m.role, m.content, m.skillName || null, m.status || null, m.isError ? 1 : 0, extraJson);
      }
    });
    insertMany(msgs);

    const firstUser = msgs.find(m => m.role === "user");
    if (firstUser) {
      const msgCount = (getDb().prepare("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ?").get(convId) as any).c;
      if (msgCount <= msgs.length) {
        const title = firstUser.content.slice(0, 50) + (firstUser.content.length > 50 ? "..." : "");
        getDb().prepare("UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ?").run(title, convId);
      } else {
        getDb().prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?").run(convId);
      }
    }

    res.json({ success: true });
  });

  router.delete("/conversations/:id", requireAuth, (req, res) => {
    const userId = req.user!.id;
    const convId = req.params.id as string;
    getDb().prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(convId, userId);
    res.json({ success: true });
  });

  return router;
}
