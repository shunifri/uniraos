import { Router } from "express";
import { join } from "path";
import { randomUUID } from "crypto";
import { getStreamBuffer } from "../websocket/stream-buffer.js";
import { requireAuth, requirePermission } from "../permissions/middleware/auth-middleware.js";
import { getDb, isMySQL } from "../db/database.js";
import { getRoleAgentConfig, getUserRoles } from "../db/user-repository.js";
import type { RoleAgentConfig } from "../permissions/types/role.js";
import { parseDocument } from "../services/doc-parser.js";
import type { RouteDependencies } from "./types.js";
import { confirmQueue } from "../skills/user-confirm-skill.js";
import { log } from "../utils/logger.js";
import { requestContext } from "../user/request-context.js";
import { PendingConfirmRepository, type PendingConfirm } from "../db/pending-confirm-repository.js";
import { listPlans, pausePlan, resumePlan, cancelPlan, deletePlan } from "../plan/plan-state.js";

// MySQL adapter helper
async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import('../db/mysql-adapter.js');
  return getAdapter();
}

export function createAgentRoutes(deps: RouteDependencies): Router {
  const {
    sessionManager,
    getAgentLoop,
    getOrchestrator,
    getVisionConfig,
    registry,
  } = deps;
  const router = Router();

  /** 如果指定了 defaultSkill/defaultSkills，在消息中注入 skill 上下文 */
  function enrichWithDefaultSkills(message: string, defaultSkill?: string, defaultSkills?: string[]): string {
    const skills: string[] = [];
    if (defaultSkill) skills.push(defaultSkill);
    if (defaultSkills) skills.push(...defaultSkills);
    if (skills.length === 0) return message;

    const infos = skills.map((name) => {
      try {
        const sk = registry.lookup(name);
        return { name, desc: sk?.description || "无描述" };
      } catch {
        return { name, desc: "无描述" };
      }
    });

    if (infos.length === 1) {
      return `[系统指令：请优先使用 "${infos[0].name}" skill 处理以下请求。该 skill 功能描述：${infos[0].desc}]

${message}`;
    }

    const list = infos.map((i, idx) => `${idx + 1}. ${i.name} — ${i.desc}`).join("\n");
    return `[系统指令：请优先使用以下 skills 处理以下请求，按列表顺序优先尝试：
${list}
]

${message}`;
  }

  /** 根据 appId 从数据库加载应用的系统设定（name + description + 知识库 + 表单 + 工作流） */
  async function loadAppSystemPrompt(appId?: string): Promise<string | undefined> {
    if (!appId) return undefined;
    try {
      let row: any;
      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        const rows = await adapter.query("SELECT name, design_json FROM app_designs WHERE id = ? AND status = ?", [appId, "applied"]);
        row = rows[0];
      } else {
        row = getDb().prepare("SELECT name, design_json FROM app_designs WHERE id = ? AND status = ?").get(appId, "applied");
      }
      if (!row) return undefined;
      const design = typeof row.design_json === "string" ? JSON.parse(row.design_json) : row.design_json;
      const appName = row.name || "";
      const appDesc = design?.description || "";
      const customPrompt = design?.systemPrompt || "";
      const parts: string[] = [];
      if (appName) parts.push(`【应用名称】${appName}`);
      if (appDesc) parts.push(`【应用设定】${appDesc}`);
      if (customPrompt) parts.push(`【角色设定】${customPrompt}`);

      // 注入应用关联的知识库 collectionId
      const kbs = design?.components?.knowledgeBases ?? [];
      const collectionIds = kbs
        .filter((k: any) => k.collectionId)
        .map((k: any) => k.collectionId as string);
      if (collectionIds.length > 0) {
        parts.push(`【应用知识库】搜索知识库时请使用 collectionId="${collectionIds.join('" 或 collectionId="')}"，以确保搜索到应用专属知识库中的内容。当用户询问"有哪些专业/课程/项目"等需要完整列表的问题时，请传入 limit=30 或更大，避免结果不全。`);
      }

      // 注入应用表单定义，让 Agent 使用 formKey 调用 user_confirm 自动加载专属表单
      const forms = design?.components?.forms ?? [];
      if (forms.length > 0) {
        const formLines = forms.map((f: any) =>
          `- ${f.key}（${f.name}）${f.description ? "— " + f.description : ""}。使用方式：调用 user_confirm(type="form",formKey="${f.key}",title="${f.name}")`
        );
        parts.push(`【应用表单】\n${formLines.join("\n")}\n当用户表达意向、需要收集信息或进入业务流程时，**必须**调用以上应用专属表单（传入 formKey 即可自动加载与主站一致的表单定义），禁止直接在回复文本中询问用户。不要自己构造 fields 或 schema。\n表单数据导出：用户需要导出表单数据时，请引导用户使用下载链接 /api/form/export/{formKey}?format=csv 或 /api/form/export/{formKey}?format=xlsx`);
      }

      // 注入应用 Skill 定义，指导 Agent 使用现有系统 Skill 实现这些能力
      const skills = design?.components?.skills ?? [];
      if (skills.length > 0) {
        const skillLines = skills.map((s: any) => {
          let impl = "";
          if (s.name === "data_analysis_query") {
            impl = "【实现方式：调用 form_data_query(skillName='form_data_query', params={formKey, queryType, filters, groupBy, metrics, startDate, endDate}) 查询表单数据。form_data_query 是系统自动适配 MySQL/SQLite 的通用表单查询 Skill，无需关心底层数据库类型。】";
          } else if (s.name === "admission_info_query") {
            const kbIds = collectionIds.length > 0 ? collectionIds.join('" 或 collectionId="') : "";
            impl = kbIds ? `【实现方式：调用 kb_search(collectionId="${kbIds}", query=用户问题) 搜索知识库】` : "【实现方式：调用 kb_search 搜索知识库】";
          } else if (s.name === "major_recommendation") {
            const kbIds = collectionIds.length > 0 ? collectionIds.join('" 或 collectionId="') : "";
            impl = kbIds ? `【实现方式：调用 kb_search(collectionId="${kbIds}", query=用户背景+专业推荐) 搜索知识库后推荐】` : "【实现方式：调用 kb_search 搜索知识库后推荐】";
          } else if (s.name === "intent_form_guidance") {
            impl = "【实现方式：调用 user_confirm(type=\"form\", formKey=\"intent_registration\") 引导填写】";
          }
          return `- ${s.name}（${s.description || ""}）${s.logic ? "— " + s.logic : ""}${impl}`;
        });
        parts.push(`【应用 Skill】\n${skillLines.join("\n")}\n以上是你的核心业务能力。注意：以上 Skill 名称为能力标识，实际执行时请使用【实现方式】中指定的系统 Skill（db_query / kb_search / user_confirm 等），禁止直接调用不存在的 Skill 名称。`);
      }

      // 注入应用工作流定义，让 Agent 使用 approval_submit 启动流程
      const workflows = design?.components?.workflows ?? [];
      if (workflows.length > 0) {
        const wfLines = workflows.map((w: any) =>
          `- ${w.key}（${w.name}）${w.description ? "— " + w.description : ""}。使用方式：调用 approval_submit(workflowKey="${w.key}",formData={收集到的数据})`
        );
        parts.push(`【应用工作流】\n${wfLines.join("\n")}\n当用户完成信息填写并需要提交时，请优先使用以上应用专属工作流。`);
      }

      // 注入组件关联关系，实现触发式流程
      const relationships = design?.relationships ?? [];
      const submitsToRels = relationships.filter((r: any) => r.type === "submits_to");
      const triggerRels = relationships.filter((r: any) => r.type === "triggers");
      if (submitsToRels.length > 0 || triggerRels.length > 0) {
        const relLines: string[] = [];
        for (const r of submitsToRels) {
          const fromKey = String(r.from || "").replace(/^form:/, "");
          const toKey = String(r.to || "").replace(/^workflow:/, "");
          if (fromKey && toKey) {
            relLines.push(`- 表单「${fromKey}」提交后，必须自动触发工作流「${toKey}」${r.description ? "（" + r.description + "）" : ""}`);
          }
        }
        for (const r of triggerRels) {
          const fromKey = String(r.from || "").replace(/^skill:/, "");
          const toKey = String(r.to || "").replace(/^form:/, "");
          if (fromKey && toKey) {
            relLines.push(`- Skill「${fromKey}」执行后，应引导用户填写表单「${toKey}」${r.description ? "（" + r.description + "）" : ""}`);
          }
        }
        if (relLines.length > 0) {
          parts.push(`【触发规则】\n${relLines.join("\n")}\n以上关联关系是应用设计的核心业务流程，请严格遵守：\n1. 当用户在前端完成表单填写并点击提交后，视为表单已提交。\n2. 如果对话历史中出现 "[表单已提交]" 标记，说明用户已经提交了表单数据，后台会自动触发对应的工作流。你不需要调用 approval_submit，也不需要调用 user_confirm 询问用户。\n3. 表单提交后，你只需要正常回复用户即可（如"您的意向已提交，招生老师会尽快与您联系"），严禁展示任何确认按钮或再次询问用户。`);
        }
      }

      if (parts.length === 0) return undefined;
      parts.push("【角色锁定】以上是你的唯一身份和职责。禁止以通用 AI 助手身份自我介绍，禁止提及与当前应用无关的能力（如数据图表、文档解析、网页抓取等）。所有回复必须严格围绕以上应用设定展开，直接回应用户问题即可。");
      parts.push("请严格按照以上应用设定来回答用户问题。");
      return parts.join("\n");
    } catch {
      return undefined;
    }
  }

  async function resolveRoleAgentConfig(userId: string, role?: string): Promise<RoleAgentConfig | undefined> {
    if (role) {
      return await getRoleAgentConfig(role) ?? undefined;
    }
    const roles = await getUserRoles(userId);
    if (roles.length > 0) {
      return await getRoleAgentConfig(roles[0].id) ?? undefined;
    }
    return undefined;
  }

  // Agent chat (LLM + Tool Use)
  router.post("/agent/chat", requireAuth, requirePermission("chat"), async (req, res) => {
    const userId = req.user!.id;
    const { message, mode, conversationId, defaultSkill, defaultSkills, appId } = req.body as { message: string; mode?: "auto" | "simple" | "react" | "legacy"; conversationId?: string; defaultSkill?: string; defaultSkills?: string[]; appId?: string };
    if (!message) {
      res.status(400).json({ success: false, error: "message is required" });
      return;
    }

    const enrichedMsg = enrichWithDefaultSkills(message, defaultSkill, defaultSkills);
    const existing = requestContext.getStore();
    const ctx: import("../user/request-context.js").RequestContext = {
      userId: existing?.userId || req.user?.id || "default",
      userName: existing?.userName,
      userDisplayName: existing?.userDisplayName,
      departmentId: existing?.departmentId,
      requestId: existing?.requestId,
      conversationId: conversationId || existing?.conversationId,
      appId: appId || existing?.appId,
    };
    await requestContext.run(ctx, async () => {
      if (mode === "legacy" || mode === "react") {
        const loop = getAgentLoop(userId);
        if (!loop) {
          res.status(400).json({ success: false, error: "LLM not configured" });
          return;
        }
        try {
          const appSystemPrompt = await loadAppSystemPrompt(appId);
          const result = await loop.run(enrichedMsg, { conversationId, systemPrompt: appSystemPrompt });
          res.json({ success: true, ...result });
        } catch (err) {
          console.error("[agent-routes] error:", err);
          res.status(500).json({ success: false, error: "Internal server error" });
        }
        return;
      }

      const orchestrator = getOrchestrator();
      if (!orchestrator) {
        res.status(400).json({ success: false, error: "LLM not configured" });
        return;
      }

      try {
        const roleAgentConfig = await resolveRoleAgentConfig(userId, req.body?.role);
        const appSystemPrompt = await loadAppSystemPrompt(appId);
        const mergedRoleConfig = appSystemPrompt
          ? { ...roleAgentConfig, systemPrompt: appSystemPrompt }
          : roleAgentConfig;
        const result = await orchestrator.run({ message: enrichedMsg, userId, roleAgentConfig: mergedRoleConfig });
        res.json({ success: true, ...result });
      } catch (err) {
        console.error("[agent-routes] error:", err);
          res.status(500).json({ success: false, error: "Internal server error" });
      }
    });
  });

  // Agent streaming chat (SSE)
  router.post("/agent/chat/stream", requireAuth, requirePermission("chat.stream"), async (req, res) => {
    const userId = req.user!.id;
    const { message, mode, conversationId, defaultSkill, defaultSkills, appId } = req.body as {
      message: string;
      mode?: "auto" | "simple" | "react" | "legacy";
      conversationId?: string;
      defaultSkill?: string;
      defaultSkills?: string[];
      appId?: string;
    };
    console.log(`   [Chat] user=${userId}, msgLen=${message?.length ?? 0}`);
    if (!message) {
      res.status(400).json({ success: false, error: "message is required" });
      return;
    }

    const convId = conversationId || undefined;
    const existing = requestContext.getStore();
    const ctx: import("../user/request-context.js").RequestContext = {
      userId: existing?.userId || req.user?.id || "default",
      userName: existing?.userName,
      userDisplayName: existing?.userDisplayName,
      departmentId: existing?.departmentId,
      requestId: existing?.requestId,
      conversationId: convId || existing?.conversationId,
      appId: appId || existing?.appId,
    };
    await requestContext.run(ctx, async () => {

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(`event: connected\ndata: {}\n\n`);

    // 检查当前对话是否有进行中的计划
    if (convId) {
      try {
        const { findPlanByConversationId } = await import("../plan/plan-state.js");
        const found = findPlanByConversationId(convId, userId);
        if (found && found.plan.meta.status === "running") {
          const { plan } = found;
          const progress = Math.round(
            ((plan.steps.filter((s) => s.status === "completed" || s.status === "skipped").length) / plan.steps.length) * 100
          );
          const currentStep = plan.steps.find((s) => s.status === "running") || plan.steps.find((s) => s.status === "pending");
          res.write(`event: plan_progress\ndata: ${JSON.stringify({
            planId: plan.meta.planId,
            title: plan.meta.title,
            status: plan.meta.status,
            progress,
            currentStep: currentStep ? { index: currentStep.index, description: currentStep.description } : null,
            totalSteps: plan.steps.length,
            message: `计划正在执行中 [${progress}%] — 步骤 ${currentStep ? currentStep.index + 1 : "?"}/${plan.steps.length}: ${currentStep ? currentStep.description : ""}`,
          })}\n\n`);
        }
      } catch {
        // ignore
      }
    }

    let closed = false;
    const keepaliveTimer = setInterval(() => {
      if (!closed) {
        res.write(":keepalive\n\n");
      }
    }, 15000);

    res.on("close", () => {
      closed = true;
      clearInterval(keepaliveTimer);
    });

    const write = (eventName: string, data: unknown) => {
      if (closed) return;
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    await runAgentChatStream({
      userId,
      message,
      mode,
      conversationId: convId,
      defaultSkill,
      defaultSkills,
      appId,
      role: (req as any).body?.role,
    }, async (eventName, data) => {
      write(eventName, data);
    });

    if (!closed) {
      res.end();
    }
    });
  });

  router.post("/agent/chat/start", requireAuth, requirePermission("chat.stream"), async (req, res) => {
    const userId = req.user!.id;
    const { message, mode, conversationId, defaultSkill, defaultSkills, appId } = req.body as {
      message: string;
      mode?: "auto" | "simple" | "react" | "legacy";
      conversationId?: string;
      defaultSkill?: string;
      defaultSkills?: string[];
      appId?: string;
    };

    if (!message) {
      res.status(400).json({ success: false, error: "message is required" });
      return;
    }

    const streamId = randomUUID();
    const convId = conversationId || undefined;

    const existing = requestContext.getStore();
    const ctx: import("../user/request-context.js").RequestContext = {
      userId: existing?.userId || req.user?.id || "default",
      userName: existing?.userName,
      userDisplayName: existing?.userDisplayName,
      departmentId: existing?.departmentId ?? undefined,
      requestId: existing?.requestId,
      conversationId: convId || existing?.conversationId,
      appId: appId || existing?.appId,
    };

    // Start async stream generation (do not await)
    requestContext.run(ctx, async () => {
      await runAgentChatStream({
        userId,
        message,
        mode,
        conversationId: convId,
        defaultSkill,
        defaultSkills,
        appId,
        role: (req as any).body?.role,
        streamId,
      }, (eventName, data) => {
        getStreamBuffer().append(streamId, { eventName, data, timestamp: Date.now() });
      });
      // Allow late subscribers to receive final events, then clear buffer
      setTimeout(() => {
        getStreamBuffer().clear(streamId);
      }, 5000);
    });

    res.json({ success: true, streamId });
  });

  // 判断是否为匿名/访客用户的临时 ID
  const isAnonymousId = (id: string) => id.startsWith("v_") || id === "default" || id === "";

  /**
   * 表单确认后的业务持久化副作用：
   * 1. 保存聊天消息到 chat_messages
   * 2. 保存表单实例到 form_instances
   * 3. 自动触发关联工作流
   *
   * 此函数在「内存命中」和「数据库恢复」两种路径下都要执行，
   * 确保对话中提交的表单数据始终同步到业务表并触发流程。
   */
  async function persistConfirmSideEffects(
    record: PendingConfirm,
    response: unknown,
    cancelled: boolean,
    effectiveUserId: string,
  ): Promise<string | undefined> {
    const responseData = (typeof response === "object" && response !== null ? response : {}) as Record<string, unknown>;
    let workflowWarning: string | undefined;
    const { confirmId } = record;
    const conversationId = record.conversationId;

    // 1. 保存聊天消息（失败不影响主流程）
    if (conversationId) {
      try {
        const content = cancelled
          ? "用户取消了操作"
          : `[表单已提交] ${typeof response === "string" ? response : JSON.stringify(response)}`;
        if (isMySQL()) {
          const adapter = await getMySQLAdapter();
          await adapter.execute(
            "INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, created_at) VALUES (?, ?, ?, ?, ?, UNIX_TIMESTAMP() * 1000)",
            [conversationId, "user", content, "user_confirm", "done"],
          );
        } else {
          getDb().prepare(
            "INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, created_at) VALUES (?, ?, ?, ?, ?, unixepoch() * 1000)",
          ).run(conversationId, "user", content, "user_confirm", "done");
        }
      } catch (err) {
        console.warn("[confirm] Save chat message failed:", err);
      }
    }

    // 2. 保存表单实例 + 3. 触发工作流（仅非取消时）
    if (!cancelled) {
      try {
        const appId = (record.confirmData as any)?.appId as string | undefined;
        const formKey = (record.confirmData as any)?.formKey as string | undefined;

        // 2. 保存表单实例到 form_instances 表
        if (formKey) {
          try {
            const { getFormDefinitionByKey, createFormInstance, submitFormInstance } = await import("../services/form-service.js");
            const formDef = await getFormDefinitionByKey(formKey);
            if (formDef?.id) {
              const instance = await createFormInstance({
                definitionId: formDef.id,
                dataJson: responseData,
                status: "draft",
                submittedBy: effectiveUserId,
              });
              if (instance?.id) {
                await submitFormInstance(instance.id, effectiveUserId);
                console.log(`[confirm] Form instance saved: ${instance.id} for form ${formKey}`);
              }
            }
          } catch (err) {
            console.warn("[confirm] Save form instance failed:", err);
          }
        }

        // 3. 自动触发关联的工作流
        if (appId && formKey) {
          let designJson: any;
          if (isMySQL()) {
            const adapter = await getMySQLAdapter();
            const rows = await adapter.query("SELECT design_json FROM app_designs WHERE id = ? AND status = ?", [appId, "applied"]);
            designJson = rows[0]?.design_json;
          } else {
            const row = getDb().prepare("SELECT design_json FROM app_designs WHERE id = ? AND status = ?").get(appId, "applied") as any;
            designJson = row?.design_json;
          }
          if (designJson) {
            const design = typeof designJson === "string" ? JSON.parse(designJson) : designJson;
            const relationships = design?.relationships ?? [];
            const submitsTo = relationships.find((r: any) => r.type === "submits_to" && String(r.from || "").replace(/^form:/, "") === formKey);
            if (submitsTo) {
              const workflowKey = String(submitsTo.to || "").replace(/^workflow:/, "");
              if (workflowKey) {
                const { getWorkflowEngine } = await import("../workflow/engine.js");
                const engine = getWorkflowEngine();
                const wfResult = await engine.startInstance(workflowKey, effectiveUserId, responseData, `${formKey}_${confirmId}`);
                if (wfResult.success) {
                  console.log(`[confirm] Auto-triggered workflow ${workflowKey} for form ${formKey}`);
                } else {
                  console.warn("[confirm] Workflow trigger failed:", wfResult.error);
                  workflowWarning = `关联工作流启动失败: ${wfResult.error?.message || "未知错误"}`;
                }
              }
            }
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn("[confirm] Auto-trigger workflow failed:", errMsg);
        workflowWarning = `关联工作流启动异常: ${errMsg}`;
      }
    }

    return workflowWarning;
  }

  // POST /api/agent/chat/confirm — resolve a pending user_confirm
  router.post("/agent/chat/confirm", requireAuth, async (req, res) => {
    const { confirmId, response, cancelled } = req.body;
    const responseData = (typeof response === "object" && response !== null ? response : {}) as Record<string, unknown>;
    const userId = req.user!.id;
    if (!confirmId) {
      res.status(400).json({ error: "confirmId required" });
      return;
    }

    // 情况 1：内存 confirmQueue 中找到 → 正常 resolve（对话立即继续）
    const pending = confirmQueue.get(confirmId);
    if (pending) {
      if (pending.timeout) clearTimeout(pending.timeout);
      confirmQueue.delete(confirmId);
      if (cancelled) {
        pending.resolve({ cancelled: true, message: "用户取消了操作" });
      } else {
        pending.resolve(response);
      }

      // 异步执行业务持久化副作用（不阻塞对话继续）
      (async () => {
        try {
          const repo = PendingConfirmRepository.getInstance();
          const record = await repo.findById(confirmId);
          if (record && record.status === "pending") {
            // 安全检查：验证当前用户是否是记录所有者
            if (record.userId && record.userId !== userId && !isAnonymousId(record.userId)) {
              console.warn(`[confirm] Security: user ${userId} tried to resolve confirm ${confirmId} owned by ${record.userId}`);
              return;
            }
            const effectiveUserId = isAnonymousId(record.userId) ? userId : record.userId;
            // CAS 标记为已解决（防止并发重复处理）
            const resolved = await repo.resolve(confirmId, cancelled ? { cancelled: true } : responseData);
            if (resolved) {
              await persistConfirmSideEffects(record, response, cancelled, effectiveUserId);
            }
          }
        } catch (err) {
          console.warn("[confirm] Background persist failed:", err);
        }
      })();

      res.json({ success: true, continued: true });
      return;
    }

    // 情况 2：内存中没有，从数据库查找（后端重启/刷新场景）
    try {
      const repo = PendingConfirmRepository.getInstance();
      const record = await repo.findById(confirmId);
      if (record && record.status === "pending") {
        // Security: verify the current user matches the confirm record owner
        if (record.userId && record.userId !== userId && !isAnonymousId(record.userId)) {
          res.status(403).json({ error: "无权处理此确认请求" });
          return;
        }
        // If the confirm was created without a real user context, use the current authenticated user
        const effectiveUserId = isAnonymousId(record.userId) ? userId : record.userId;
        // 标记为已解决（利用 affectedRows 作为 CAS，防止并发重复处理）
        const resolved = await repo.resolve(confirmId, cancelled ? { cancelled: true } : responseData);
        if (!resolved) {
          res.status(409).json({ error: "Confirmation already processed by another request" });
          return;
        }

        const workflowWarning = await persistConfirmSideEffects(record, response, cancelled, effectiveUserId);
        res.json({ success: true, continued: false, message: "表单已提交，请继续对话", warning: workflowWarning });
        return;
      }
    } catch (err) {
      console.warn("[confirm] 数据库恢复 pending confirm 失败:", err);
    }

    // 情况 3：都找不到
    res.status(404).json({ error: "Confirmation not found or expired" });
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
      console.error("[agent-routes] error:", err);
          res.status(500).json({ success: false, error: "Internal server error" });
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

  router.get("/conversations", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    try {
      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        const rows = await adapter.query(
          "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50",
          [userId]
        );
        res.json({ success: true, conversations: rows });
      } else {
        const rows = getDb().prepare(
          "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50"
        ).all(userId);
        res.json({ success: true, conversations: rows });
      }
    } catch (error) {
      console.error("[agent-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.post("/conversations", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const id = "conv_" + crypto.randomUUID().slice(0, 12);
    const title = req.body.title || "新对话";
    try {
      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        await adapter.execute(
          "INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000)",
          [id, userId, title]
        );
      } else {
        getDb().prepare(
          "INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)"
        ).run(id, userId, title);
      }
      res.json({ success: true, id, title });
    } catch (error) {
      console.error("[agent-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.get("/conversations/:id/messages", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const convId = req.params.id as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const beforeId = parseInt(req.query.before_id as string) || 0;

    try {
      let conv;
      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        const rows = await adapter.query("SELECT id FROM conversations WHERE id = ? AND user_id = ?", [convId, userId]);
        conv = rows[0];
      } else {
        conv = getDb().prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?").get(convId, userId);
      }
      if (!conv) { res.status(404).json({ success: false, error: "Conversation not found" }); return; }

      let rows: any[];
      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        if (beforeId > 0) {
          rows = await adapter.query(
            "SELECT id, role, content, skill_name, status, is_error, extra, created_at FROM chat_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
            [convId, beforeId, limit]
          );
          rows.reverse();
        } else {
          rows = await adapter.query(
            "SELECT id, role, content, skill_name, status, is_error, extra, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
            [convId, limit]
          );
          rows.reverse();
        }
      } else {
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
      }

      const msgs = rows.map((r) => ({
        ...r,
        extra: r.extra ? (typeof r.extra === 'string' ? JSON.parse(r.extra) : r.extra) : undefined,
      }));

      let hasMore = false;
      if (rows.length > 0) {
        if (isMySQL()) {
          const adapter = await getMySQLAdapter();
          const countRows = await adapter.query("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ? AND id < ?", [convId, rows[0].id]);
          hasMore = countRows[0]?.c > 0;
        } else {
          hasMore = (getDb().prepare("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ? AND id < ?").get(convId, rows[0].id) as any).c > 0;
        }
      }

      res.json({ success: true, messages: msgs, hasMore });
    } catch (error) {
      console.error("[agent-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.post("/conversations/:id/messages", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const convId = req.params.id as string;
    log("info", "chat.save_messages", { convId, messageCount: (req.body.messages || []).length });
    
    try {
      let conv;
      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        const rows = await adapter.query("SELECT id FROM conversations WHERE id = ? AND user_id = ?", [convId, userId]);
        conv = rows[0];
      } else {
        conv = getDb().prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?").get(convId, userId);
      }
      if (!conv) { res.status(404).json({ success: false, error: "Conversation not found" }); return; }

      const msgs: Array<{ role: string; content: string; skillName?: string; status?: string; isError?: boolean; extra?: unknown }> = req.body.messages || [];
      
      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        for (const m of msgs) {
          const extraJson = m.extra ? JSON.stringify(m.extra) : null;
          await adapter.execute(
            "INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, is_error, extra, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP() * 1000)",
            [convId, m.role, m.content, m.skillName || null, m.status || null, m.isError ? 1 : 0, extraJson]
          );
        }
      } else {
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
      }

      const firstUser = msgs.find(m => m.role === "user");
      if (firstUser) {
        if (isMySQL()) {
          const adapter = await getMySQLAdapter();
          const countRows = await adapter.query("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ?", [convId]);
          const msgCount = countRows[0]?.c || 0;
          if (msgCount <= msgs.length) {
            const title = firstUser.content.slice(0, 50) + (firstUser.content.length > 50 ? "..." : "");
            await adapter.execute("UPDATE conversations SET title = ?, updated_at = UNIX_TIMESTAMP() * 1000 WHERE id = ?", [title, convId]);
          } else {
            await adapter.execute("UPDATE conversations SET updated_at = UNIX_TIMESTAMP() * 1000 WHERE id = ?", [convId]);
          }
        } else {
          const msgCount = (getDb().prepare("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ?").get(convId) as any).c;
          if (msgCount <= msgs.length) {
            const title = firstUser.content.slice(0, 50) + (firstUser.content.length > 50 ? "..." : "");
            getDb().prepare("UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ?").run(title, convId);
          } else {
            getDb().prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?").run(convId);
          }
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[agent-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.delete("/conversations/:id", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const convId = req.params.id as string;
    try {
      if (isMySQL()) {
        const adapter = await getMySQLAdapter();
        await adapter.execute("DELETE FROM conversations WHERE id = ? AND user_id = ?", [convId, userId]);
      } else {
        getDb().prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(convId, userId);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("[agent-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  // ===== Plan Management REST API =====
  router.get("/agent/plan/list", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const plans = listPlans(userId);
      res.json({ success: true, plans });
    } catch (err: any) {
      console.error("[agent-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.post("/agent/plan/pause", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { fileName } = req.body;
      const plan = await pausePlan(fileName, userId);
      res.json({ success: true, plan: { planId: plan.meta.planId, title: plan.meta.title, status: plan.meta.status } });
    } catch (err: any) {
      console.error("[agent-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.post("/agent/plan/resume", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { fileName } = req.body;
      const plan = await resumePlan(fileName, userId);
      res.json({ success: true, plan: { planId: plan.meta.planId, title: plan.meta.title, status: plan.meta.status } });
    } catch (err: any) {
      console.error("[agent-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.post("/agent/plan/cancel", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { fileName } = req.body;
      const plan = await cancelPlan(fileName, userId);
      res.json({ success: true, plan: { planId: plan.meta.planId, title: plan.meta.title, status: plan.meta.status } });
    } catch (err: any) {
      console.error("[agent-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  router.post("/agent/plan/delete", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const { fileName } = req.body;
      deletePlan(fileName, userId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[agent-routes] error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  });

  interface RunAgentChatStreamParams {
    userId: string;
    message: string;
    mode?: "auto" | "simple" | "react" | "legacy";
    conversationId?: string;
    defaultSkill?: string;
    defaultSkills?: string[];
    appId?: string;
    role?: string;
    streamId?: string;
  }

  async function runAgentChatStream(
    params: RunAgentChatStreamParams,
    onEvent: (eventName: string, data: unknown) => void | Promise<void>
  ): Promise<void> {
    const { userId, message, mode, conversationId: convId, defaultSkill, defaultSkills, appId, role } = params;

    async function saveMsg(role: string, content: string, opts?: { skillName?: string; status?: string; isError?: boolean; extra?: unknown }) {
      if (!convId) return;
      try {
        const extraJson = opts?.extra ? JSON.stringify(opts.extra) : null;
        if (isMySQL()) {
          const adapter = await getMySQLAdapter();
          await adapter.execute(
            "INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, is_error, extra, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP() * 1000)",
            [convId, role, content, opts?.skillName || null, opts?.status || null, opts?.isError ? 1 : 0, extraJson]
          );
        } else {
          const insertMsg = getDb().prepare("INSERT INTO chat_messages (conversation_id, role, content, skill_name, status, is_error, extra) VALUES (?, ?, ?, ?, ?, ?, ?)");
          insertMsg.run(convId, role, content, opts?.skillName || null, opts?.status || null, opts?.isError ? 1 : 0, extraJson);
        }
      } catch (err) {
        console.warn(`[saveMsg] failed: role=${role}, convId=${convId}, error=${err instanceof Error ? err.message : String(err)}`);
      }
    }

    async function updateConvTitle(title: string) {
      if (!convId) return;
      try {
        if (isMySQL()) {
          const adapter = await getMySQLAdapter();
          const rows = await adapter.query("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ?", [convId]);
          const msgCount = rows[0]?.c || 0;
          if (msgCount <= 2) {
            await adapter.execute("UPDATE conversations SET title = ?, updated_at = UNIX_TIMESTAMP() * 1000 WHERE id = ?", [title, convId]);
          } else {
            await adapter.execute("UPDATE conversations SET updated_at = UNIX_TIMESTAMP() * 1000 WHERE id = ?", [convId]);
          }
        } else {
          const msgCount = (getDb().prepare("SELECT COUNT(*) as c FROM chat_messages WHERE conversation_id = ?").get(convId) as any).c;
          if (msgCount <= 2) {
            getDb().prepare("UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ?").run(title, convId);
          } else {
            getDb().prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?").run(convId);
          }
        }
      } catch {}
    }

    const attachments: Array<{ name: string; path: string }> = [];
    const attachmentRegex = /(?:--- 文件: |\[附件: )(.+?)\s*\(路径:\s*(.+?)\)\s*(?:---|\])/g;
    let m: RegExpExecArray | null;
    while ((m = attachmentRegex.exec(message)) !== null) {
      attachments.push({ name: m[1], path: m[2] });
    }

    await saveMsg("user", message, attachments.length > 0 ? { extra: { attachments } } : undefined);
    await updateConvTitle(message.slice(0, 50) + (message.length > 50 ? "..." : ""));

    let enrichedMessage = message;
    enrichedMessage = enrichWithDefaultSkills(enrichedMessage, defaultSkill, defaultSkills);

    let currentAssistantText = "";
    let pendingToolName = "";
    let kbRefsSent = false;
    let kbRefsForSave: unknown[] = [];
    let webRefsForSave: unknown[] = [];

    try {
      const processEvent = async (eventName: string, eventData: any) => {
        if (eventName === "tool_result") {
          console.warn("[DEBUG tool_result] skillName=", eventData?.skillName, "result.data?.__userConfirm=", eventData?.result?.data?.__userConfirm, "result.data keys=", eventData?.result?.data ? Object.keys(eventData.result.data) : "undefined", "result.success=", eventData?.result?.success);
        }
        if (eventName === "tool_result" && eventData?.result?.data?.__userConfirm) {
          onEvent("user_confirm", eventData.result.data);
          await saveMsg("tool", "等待用户确认...", {
            skillName: eventData.skillName ?? pendingToolName,
            status: "done",
            isError: false,
          });
          await saveMsg("user_confirm", JSON.stringify(eventData.result.data), {
            skillName: eventData.skillName ?? pendingToolName,
          });
          return;
        }
        if (eventName === "user_confirm") {
          onEvent("user_confirm", eventData);
          await saveMsg("user_confirm", JSON.stringify(eventData), {
            skillName: pendingToolName || eventData.skillName || "user_confirm",
          });
          return;
        }

        onEvent(eventName, eventData);

        if (eventName === "strategy_selected") {
          const levelMap: Record<string, string> = { simple: "直接回答", react: "逐步推理" };
          const label = levelMap[eventData.level] || eventData.level;
          await saveMsg("strategy", `策略: ${label}`);
        } else if (eventName === "thinking") {
          const thinkContent = eventData.content || `正在思考 (第 ${eventData.iteration ?? ""} 轮)...`;
          await saveMsg("thinking", thinkContent);
        } else if (eventName === "text_delta") {
          currentAssistantText += eventData.text ?? "";
        } else if (eventName === "tool_call") {
          if (currentAssistantText) {
            await saveMsg("assistant", currentAssistantText);
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
              const dataStr = JSON.stringify(r.data);
              summary = r.data.message || r.data.text || r.data.content ||
                        (dataStr.length <= 500 ? dataStr : dataStr.slice(0, 300) + "...");
              extra = { ...(extra ?? {}), resultData: r.data };
            } else {
              summary = "完成";
            }
          } else {
            summary = r?.error?.message || r?.error || "失败";
          }
          await saveMsg("tool", summary, {
            skillName: eventData.skillName ?? pendingToolName,
            status: r?.success ? "done" : "error",
            isError: !r?.success,
            extra: { ...(extra ?? {}), result: r },
          });

          const toolName = eventData.skillName ?? pendingToolName;
          if (toolName === "kb_search" && r?.success && r.data && Array.isArray(r.data) && r.data.length > 0) {
            const refs = r.data.map((item: any, i: number) => ({
              index: i + 1,
              docId: item.docId,
              docName: item.docName,
              chunkIndex: item.chunkIndex,
              content: item.content,
              score: item.score,
              pageNumber: item.pageNumber ?? null,
              bboxes: item.bboxes ?? null,
              docMindTaskId: item.docMindTaskId ?? null,
            }));
            onEvent("kb_references", { references: refs });
            kbRefsSent = true;
            kbRefsForSave = refs;
          }
        } else if (eventName === "agent_done" || eventName === "done") {
          if (currentAssistantText) {
            const extraObj: Record<string, unknown> = {};
            if (kbRefsForSave.length > 0) extraObj.kbReferences = kbRefsForSave;
            if (webRefsForSave.length > 0) extraObj.webReferences = webRefsForSave;
            const kbExtra = Object.keys(extraObj).length > 0 ? extraObj : undefined;
            await saveMsg("assistant", currentAssistantText, { extra: kbExtra });
            currentAssistantText = "";
            kbRefsForSave = [];
            webRefsForSave = [];
          }
          if (eventData.hitMax) {
            await saveMsg("system", "已达最大迭代次数");
          }
        } else if (eventName === "error") {
          await saveMsg("assistant", eventData.error || "未知错误", { isError: true });
        }
      };

      const DB_HISTORY_LIMIT = 40;
      async function loadHistoryFromDb(conversationId: string): Promise<Array<{ role: string; content: string }>> {
        try {
          let rows: Array<{ role: string; content: string }> = [];
          if (isMySQL()) {
            const adapter = await getMySQLAdapter();
            rows = await adapter.query(
              "SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
              [conversationId, DB_HISTORY_LIMIT]
            );
            rows.reverse();
          } else {
            rows = getDb().prepare(
              "SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?"
            ).all(conversationId, DB_HISTORY_LIMIT) as Array<{ role: string; content: string }>;
            rows.reverse();
          }
          const validRoles = new Set(["user", "assistant", "tool", "system"]);
          const history = rows
            .filter((r) => validRoles.has(r.role))
            .map((r) => {
              if (r.role === "tool") {
                return { role: "user", content: `[工具执行结果] ${r.content}` };
              }
              if (r.role === "user" && r.content?.startsWith("[表单已提交]")) {
                return { role: "system", content: r.content };
              }
              return { role: r.role, content: r.content ?? "" };
            });
          const lastIdx = history.length - 1;
          if (lastIdx >= 0 && history[lastIdx].role === "user") {
            history.pop();
          }
          return history;
        } catch (err) {
          console.warn("[loadHistoryFromDb] failed:", err);
          return [];
        }
      }

      if (mode === "legacy" || mode === "react") {
        const loop = getAgentLoop(userId);
        if (!loop) { onEvent("error", { error: "LLM not configured" }); return; }
        const appSystemPrompt = await loadAppSystemPrompt(appId);
        for await (const event of loop.runStream(enrichedMessage, { conversationId: convId, systemPrompt: appSystemPrompt })) {
          await processEvent(event.event, event.data);
        }
      } else {
        const orchestrator = getOrchestrator();
        if (!orchestrator) { onEvent("error", { error: "LLM not configured" }); return; }
        const roleAgentConfig = await resolveRoleAgentConfig(userId, role);
        const appSystemPrompt = await loadAppSystemPrompt(appId);
        const mergedRoleConfig = appSystemPrompt
          ? { ...roleAgentConfig, systemPrompt: appSystemPrompt }
          : roleAgentConfig;
        const runStreamInput: any = { message: enrichedMessage, userId, roleAgentConfig: mergedRoleConfig };
        if (convId) {
          runStreamInput.conversationId = convId;
          const memoryHistory = (orchestrator as any).getConversationHistory?.(userId, convId);
          if (!memoryHistory || memoryHistory.length === 0) {
            const dbHistory = await loadHistoryFromDb(convId);
            if (dbHistory.length > 0) {
              runStreamInput.history = dbHistory;
            }
          }
        }

        for await (const event of orchestrator.runStream(runStreamInput)) {
          await processEvent(event.event, event.data);
        }
      }

      if (currentAssistantText) {
        const extraObj: Record<string, unknown> = {};
        if (kbRefsForSave.length > 0) extraObj.kbReferences = kbRefsForSave;
        if (webRefsForSave.length > 0) extraObj.webReferences = webRefsForSave;
        const extra = Object.keys(extraObj).length > 0 ? extraObj : undefined;
        await saveMsg("assistant", currentAssistantText, { extra });
        currentAssistantText = "";
      }
    } catch (err) {
      onEvent("error", { error: err instanceof Error ? err.message : String(err) });
      await saveMsg("assistant", err instanceof Error ? err.message : String(err), { isError: true });
    }
  }

  return router;
}
