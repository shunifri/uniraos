import { defineSystemSkill } from "../types/index.js";
import { Autonomy } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import * as resRepo from "../db/resource-repository.js";

export function loadExampleSkills(registry: SkillRegistry): void {
  registry.register(
    defineSystemSkill({
      name: "log_before",
      visible: false,
      autonomy: Autonomy.AUTO_PRE,
      handler: async (params) => {
        console.log(`[AUTO_PRE] About to execute: ${params.target}`);
        return { success: true, data: { logged: true } };
      },
      description: "自动在执行前打印日志",
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "log_after",
      visible: false,
      autonomy: Autonomy.AUTO_POST,
      handler: async (params) => {
        console.log(`[AUTO_POST] Finished: ${params.target}`);
        return { success: true, data: { logged: true } };
      },
      description: "自动在执行后打印日志",
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "checkpoint",
      visible: false,
      autonomy: Autonomy.GUARDIAN,
      handler: async (params) => {
        console.log(`[GUARDIAN] Checkpoint saved for: ${params.target}`);
        return { success: true, data: { checkpoint: Date.now() } };
      },
      description: "守护级检查点保存",
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "greet",
      visible: true,
      dependencies: ["log_before", "log_after"],
      handler: async (params) => {
        const name = (params.name as string) || "World";
        return { success: true, data: { message: `Hello, ${name}!` } };
      },
      description: "打招呼 Skill，接受 name 参数",
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "add",
      visible: true,
      handler: async (params) => {
        const a = Number(params.a ?? 0);
        const b = Number(params.b ?? 0);
        return { success: true, data: { result: a + b } };
      },
      description: "加法计算，接受 a 和 b 参数",
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "slow_task",
      visible: true,
      timeout: 5000,
      retry: { maxRetries: 2, backoffMs: 500, backoffMultiplier: 2 },
      handler: async (params) => {
        const delay = Number(params.delay ?? 1000);
        await new Promise((r) => setTimeout(r, delay));
        return { success: true, data: { waited: delay } };
      },
      description: "模拟慢任务，接受 delay(ms) 参数",
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "random_fail",
      visible: true,
      retry: { maxRetries: 3, backoffMs: 200, backoffMultiplier: 2 },
      handler: async () => {
        if (Math.random() < 0.6) {
          throw new Error("Random failure!");
        }
        return { success: true, data: { lucky: true } };
      },
      description: "60% 概率失败的 Skill，用于测试重试",
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "get_time",
      visible: true,
      handler: async () => {
        return {
          success: true,
          data: {
            iso: new Date().toISOString(),
            timestamp: Date.now(),
            readable: new Date().toLocaleString("zh-CN"),
          },
        };
      },
      description: "获取当前时间",
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "calculate",
      visible: true,
      handler: async (params) => {
        const { expression } = params as { expression: string };
        if (!expression) {
          return { success: false, error: new Error("Missing expression") };
        }
        if (!/^[\d\s+\-*/().]+$/.test(expression)) {
          return { success: false, error: new Error("Invalid expression") };
        }
        const result = new Function(`return (${expression})`)();
        return { success: true, data: { expression, result } };
      },
      description: "数学表达式计算，接受 expression 参数，如 '2 + 3 * 4'",
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "list_skills",
      visible: true,
      handler: async () => {
        const skills = registry.listVisible().map((s) => ({
          name: s.name,
          description: s.description,
        }));
        return { success: true, data: { skills } };
      },
      description: "列出所有可用的 Skill 及其描述",
    }),
  );
}

export async function syncSkillsToResources(registry: SkillRegistry): Promise<void> {
  const skills = registry.list().map((s) => ({
    name: s.name,
    description: s.description,
  }));
  const result = await resRepo.syncSkillResources(skills);
  console.log(`   Skills synced to resources: ${result.added} added, ${result.total} total`);
}
