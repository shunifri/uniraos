/**
 * Plan Parser — 解析和生成 Plan Markdown 文件
 *
 * 格式：
 * ---
 * planId: xxx
 * title: xxx
 * status: running
 * ...
 * ---
 *
 * # Title
 *
 * ## Task 1: xxx
 *
 * - [x] Step 1: description
 *   - **Result:** success
 *   - **Output:** ...
 *
 * - [ ] Step 2: description
 */

import type { PlanMeta, PlanStep, ParsedPlan, PlanStepStatus, PlanStatus } from "./plan-types.js";

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
const STEP_RE = /^- \[(.)\] (?:\*\*)?Step (\d+)(?::)?(?:\*\*)?\s*(.*)$/;
const TASK_HEADER_RE = /^##\s+Task\s+\d+:\s*(.+)$/;
const RESULT_RE = /^\s+- \*\*Result:\*\*\s*(.+)$/m;
const OUTPUT_RE = /^\s+- \*\*Output:\*\*\s*([\s\S]*?)(?=\n\s+- \*\*|\n- \[|$)/m;
const ERROR_RE = /^\s+- \*\*Error:\*\*\s*(.+)$/m;
const STARTED_RE = /^\s+- \*\*StartedAt:\*\*\s*(\d+)$/m;
const FINISHED_RE = /^\s+- \*\*FinishedAt:\*\*\s*(\d+)$/m;

const STATUS_MAP: Record<string, PlanStepStatus> = {
  " ": "pending",
  "~": "running",
  "x": "completed",
  "!": "failed",
  "-": "skipped",
};

const REVERSE_STATUS_MAP: Record<PlanStepStatus, string> = {
  pending: " ",
  running: "~",
  completed: "x",
  failed: "!",
  skipped: "-",
};

/** 解析 frontmatter 为 PlanMeta */
function parseFrontmatter(raw: string): Partial<PlanMeta> {
  const meta: Partial<PlanMeta> = {};
  for (const line of raw.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: any = line.slice(colonIdx + 1).trim();

    if (key === "tags") {
      value = value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
    } else if (["createdAt", "updatedAt", "currentStep", "totalSteps", "lastHeartbeat"].includes(key)) {
      value = parseInt(value, 10);
      if (isNaN(value)) value = key === "currentStep" ? -1 : 0;
    }
    (meta as any)[key] = value;
  }
  return meta;
}

/** 将 PlanMeta 序列化为 frontmatter */
function serializeFrontmatter(meta: PlanMeta): string {
  const lines = [
    "---",
    `planId: ${meta.planId}`,
    `title: ${meta.title}`,
    `status: ${meta.status}`,
    `createdAt: ${meta.createdAt}`,
    `updatedAt: ${meta.updatedAt}`,
    `currentStep: ${meta.currentStep}`,
    `totalSteps: ${meta.totalSteps}`,
  ];
  if (meta.conversationId) lines.push(`conversationId: ${meta.conversationId}`);
  if (meta.tags?.length) lines.push(`tags: [${meta.tags.join(", ")}]`);
  if (meta.error) lines.push(`error: ${meta.error}`);
  if (meta.lastHeartbeat) lines.push(`lastHeartbeat: ${meta.lastHeartbeat}`);
  if (meta.scheduledEventIds?.length) lines.push(`scheduledEventIds: [${meta.scheduledEventIds.join(", ")}]`);
  lines.push("---", "");
  return lines.join("\n");
}

/** 从 body 中提取标题 */
function extractTitleFromBody(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/** 解析 Plan Markdown 内容 */
export function parsePlan(content: string): ParsedPlan {
  const fmMatch = content.match(FRONTMATTER_RE);
  let rawFm = "";
  let body = content;
  if (fmMatch) {
    rawFm = fmMatch[1];
    body = content.slice(fmMatch[0].length);
  }

  const parsedFm = parseFrontmatter(rawFm);
  const steps: PlanStep[] = [];
  let currentTaskTitle = "";

  const lines = body.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 匹配 Task 标题
    const taskMatch = line.match(TASK_HEADER_RE);
    if (taskMatch) {
      currentTaskTitle = taskMatch[1].trim();
      i++;
      continue;
    }

    // 匹配步骤
    const stepMatch = line.match(STEP_RE);
    if (stepMatch) {
      const checkChar = stepMatch[1];
      const stepIndex = parseInt(stepMatch[2], 10) - 1;
      let description = stepMatch[3].trim();
      const status = STATUS_MAP[checkChar] || "pending";

      // 检测 optional 标记
      const optional = /\[optional\]|\(可选\)/i.test(description);
      if (optional) {
        description = description.replace(/\[optional\]|\(可选\)/gi, "").trim();
      }

      const step: PlanStep = {
        index: stepIndex,
        taskTitle: currentTaskTitle,
        description,
        status,
        optional,
      };

      // 解析步骤详情（接下来的缩进行）
      i++;
      const detailLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t"))) {
        detailLines.push(lines[i]);
        i++;
      }

      const detail = detailLines.join("\n");

      const resultMatch = detail.match(RESULT_RE);
      if (resultMatch) step.result = resultMatch[1].trim();

      const errorMatch = detail.match(ERROR_RE);
      if (errorMatch) step.error = errorMatch[1].trim();

      const startedMatch = detail.match(STARTED_RE);
      if (startedMatch) step.startedAt = parseInt(startedMatch[1], 10);

      const finishedMatch = detail.match(FINISHED_RE);
      if (finishedMatch) step.finishedAt = parseInt(finishedMatch[1], 10);

      const outputMatch = detail.match(OUTPUT_RE);
      if (outputMatch) step.output = outputMatch[1].trim();

      steps.push(step);
      continue;
    }

    i++;
  }

  // 排序步骤
  steps.sort((a, b) => a.index - b.index);

  const now = Date.now();
  const meta: PlanMeta = {
    planId: parsedFm.planId || `plan_${Math.random().toString(36).slice(2, 10)}`,
    title: parsedFm.title || extractTitleFromBody(body) || "Untitled Plan",
    status: (parsedFm.status as PlanStatus) || "draft",
    createdAt: parsedFm.createdAt || now,
    updatedAt: parsedFm.updatedAt || now,
    currentStep: parsedFm.currentStep ?? -1,
    totalSteps: parsedFm.totalSteps || steps.length,
    conversationId: parsedFm.conversationId,
    tags: parsedFm.tags,
    error: parsedFm.error,
  };

  return { meta, content: body, steps };
}

/** 生成 Plan Markdown 内容 */
export function serializePlan(plan: ParsedPlan): string {
  const fm = serializeFrontmatter(plan.meta);

  // 按 Task 分组步骤
  const taskGroups = new Map<string, PlanStep[]>();
  for (const step of plan.steps) {
    const arr = taskGroups.get(step.taskTitle) || [];
    arr.push(step);
    taskGroups.set(step.taskTitle, arr);
  }

  let body = "";
  let first = true;
  for (const [taskTitle, steps] of taskGroups) {
    if (!first) body += "\n";
    first = false;
    body += `## Task: ${taskTitle}\n\n`;
    for (const step of steps) {
      const check = REVERSE_STATUS_MAP[step.status];
      body += `- [${check}] **Step ${step.index + 1}:** ${step.description}\n`;
      if (step.startedAt !== undefined) body += `  - **StartedAt:** ${step.startedAt}\n`;
      if (step.finishedAt !== undefined) body += `  - **FinishedAt:** ${step.finishedAt}\n`;
      if (step.result !== undefined) body += `  - **Result:** ${step.result}\n`;
      if (step.error !== undefined) body += `  - **Error:** ${step.error}\n`;
      if (step.output !== undefined) body += `  - **Output:** ${step.output}\n`;
    }
  }

  return fm + body;
}

/** 计算计划进度百分比 */
export function computeProgress(plan: ParsedPlan): number {
  if (plan.steps.length === 0) return 0;
  const completed = plan.steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
  return Math.round((completed / plan.steps.length) * 100);
}

/** 创建新的 Plan 内容（从用户输入的 markdown） */
export function createPlanContent(title: string, userContent: string, tags?: string[], conversationId?: string): string {
  const planId = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();

  // 尝试从用户内容中解析步骤
  const temp = parsePlan(userContent);
  const steps = temp.steps.length > 0 ? temp.steps : inferStepsFromContent(userContent);

  const meta: PlanMeta = {
    planId,
    title,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    currentStep: -1,
    totalSteps: steps.length,
    conversationId,
    tags,
  };

  const plan: ParsedPlan = {
    meta,
    content: userContent,
    steps,
  };

  return serializePlan(plan);
}

/** 从纯文本内容推断步骤（简单启发式） */
function inferStepsFromContent(content: string): PlanStep[] {
  const steps: PlanStep[] = [];
  const lines = content.split("\n");
  let currentTask = "Main Task";

  for (const line of lines) {
    const taskMatch = line.match(/^#{2,3}\s+(?:Task\s*\d*[:\-]?\s*)?(.+)/);
    if (taskMatch) {
      currentTask = taskMatch[1].trim();
      continue;
    }

    const stepMatch = line.match(/^- \[(.)\]\s*(?:\*\*)?Step\s*\d+[:\-]?\s*(?:\*\*)?\s*(.+)/);
    if (stepMatch) {
      steps.push({
        index: steps.length,
        taskTitle: currentTask,
        description: stepMatch[2].trim(),
        status: STATUS_MAP[stepMatch[1]] || "pending",
      });
      continue;
    }

    // 也支持普通列表项作为步骤（无 Step N 前缀）
    const listMatch = line.match(/^- \[(.)\]\s+(.+)/);
    if (listMatch && steps.length < 50) {
      // 避免重复添加已经由 STEP_RE 匹配的步骤
      const desc = listMatch[2].trim();
      if (!desc.startsWith("Step ")) {
        steps.push({
          index: steps.length,
          taskTitle: currentTask,
          description: desc,
          status: STATUS_MAP[listMatch[1]] || "pending",
        });
      }
    }
  }

  return steps;
}
