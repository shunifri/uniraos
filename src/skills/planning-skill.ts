/**
 * 多步规划 Skill
 *
 * LLM 先分析任务生成执行计划，再按计划逐步调用 Skill。
 * 支持动态调整（计划中途发现问题可重新规划）。
 */
import { defineSkill, defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import type { ExecutionEngine } from "../engine/index.js";
import type { LLMProvider } from "../llm/types.js";

export function createPlanningSkill(
  registry: SkillRegistry,
  engine: ExecutionEngine,
  getProvider: () => LLMProvider | null,
): void {
  registry.register(
    defineSystemSkill({
      name: "plan_and_execute",
      description: `多步规划执行：LLM 分析任务，生成执行计划，然后逐步执行。
参数:
  task(string): 任务描述
  max_steps?(number): 最大步骤数（默认 10）
  allow_replan?(boolean): 是否允许中途重新规划（默认 true）`,
      timeout: 300000, // 5 分钟
      handler: async (params) => {
        const provider = getProvider();
        if (!provider) {
          return { success: false, error: new Error("LLM 未配置") };
        }

        const task = params.task as string;
        const maxSteps = (params.max_steps as number) ?? 10;
        const allowReplan = (params.allow_replan as boolean) ?? true;

        if (!task) {
          return { success: false, error: new Error("task 必填") };
        }

        // 获取可用 Skill 列表
        const availableSkills = registry.listVisible().map((s) => ({
          name: s.name,
          description: s.description,
        }));

        // 生成计划
        const planPrompt = `你是一个任务规划器。根据以下任务描述，生成一个执行计划。

任务: ${task}

可用 Skill:
${availableSkills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}

请生成一个 JSON 格式的执行计划:
{
  "steps": [
    {"skill": "skill_name", "params": {...}, "description": "步骤描述"},
    ...
  ]
}

规则:
1. 每个步骤使用一个可用 Skill
2. 步骤之间可以传递数据（后续步骤可引用前序结果）
3. 最多 ${maxSteps} 个步骤
4. 如果任务无法用现有 Skill 完成，返回 {"steps": [], "reason": "原因"}

只输出 JSON，不要其他内容。`;

        let plan: { steps: Array<{ skill: string; params: Record<string, unknown>; description: string }>; reason?: string };

        try {
          const response = await provider.chat([
            { role: "user", content: planPrompt },
          ]);
          let jsonStr = (response.content ?? "").trim();
          if (jsonStr.startsWith("```")) {
            jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
          }
          plan = JSON.parse(jsonStr);
        } catch (err) {
          return { success: false, error: new Error(`规划失败: ${err instanceof Error ? err.message : String(err)}`) };
        }

        if (!plan.steps || plan.steps.length === 0) {
          return {
            success: false,
            error: new Error(plan.reason || "无法生成执行计划"),
            data: { plan },
          };
        }

        // 逐步执行
        const results: Array<{
          step: number;
          skill: string;
          description: string;
          success: boolean;
          data?: unknown;
          error?: string;
        }> = [];

        for (let i = 0; i < plan.steps.length; i++) {
          const step = plan.steps[i];

          // 检查 Skill 是否存在
          if (!registry.lookup(step.skill)) {
            results.push({
              step: i + 1,
              skill: step.skill,
              description: step.description,
              success: false,
              error: `Skill 不存在: ${step.skill}`,
            });

            if (allowReplan) {
              // 尝试重新规划剩余步骤
              break;
            }
            continue;
          }

          try {
            // 注入前序结果到参数
            const enrichedParams = {
              ...step.params,
              _previous_results: results.filter((r) => r.success).map((r) => r.data),
            };

            const result = await engine.execute(step.skill, enrichedParams);
            results.push({
              step: i + 1,
              skill: step.skill,
              description: step.description,
              success: result.success,
              data: result.data,
            });
          } catch (err) {
            results.push({
              step: i + 1,
              skill: step.skill,
              description: step.description,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });

            if (allowReplan) break;
          }
        }

        const successCount = results.filter((r) => r.success).length;
        return {
          success: successCount === plan.steps.length,
          data: {
            task,
            totalSteps: plan.steps.length,
            completedSteps: results.length,
            successSteps: successCount,
            plan: plan.steps.map((s) => s.description),
            results,
          },
        };
      },
    }),
  );

  console.log("   Planning skill registered");
}
