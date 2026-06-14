import { defineSystemSkill } from "../types/index.js";
import { Autonomy } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import * as resRepo from "../db/resource-repository.js";
import { safeEvaluateExpression } from "../utils/safe-expression.js";

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
        const { expression, context } = params as { expression: string; context?: Record<string, unknown> };
        if (!expression) {
          return { success: false, error: new Error("Missing expression") };
        }
        try {
          const result = safeEvaluateExpression(expression, context ?? {});
          return { success: true, data: { expression, result } };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // 如果是 Unknown identifier，列出 context 中可用的变量名，帮助调试
          if (msg.startsWith("Unknown identifier:")) {
            const available = Object.keys(context ?? {}).join(", ");
            return { success: false, error: new Error(`${msg}. Available variables in context: [${available || "none"}]`) };
          }
          return { success: false, error: new Error(`Expression evaluation failed: ${msg}`) };
        }
      },
      description: "表达式计算，接受 expression 参数和可选 context(变量对象)。支持：数字运算(2+3*4)、变量访问(如 geo_ip.city)、比较判断(x>5)、三元条件(a?b:c)、内置函数(Math.max,Math.round等)。不支持：自定义函数定义、字符串拼接、复杂逻辑、赋值操作。需要引用前序步骤结果时，通过 context 参数传入，expression 中直接使用变量名（如 context: {temp: 25}, expression: 'temp > 20 ? hot : cool'）。",
      paramSchema: {
        properties: {
          expression: { type: "string", description: "表达式字符串" },
          context: { type: "object", description: "变量上下文对象，表达式中可直接引用其属性" },
        },
        required: ["expression"],
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "weather_advice",
      visible: true,
      handler: async (params) => {
        let { temp, weather, humidity, windSpeed, city } = params as {
          temp?: number | string;
          weather?: string;
          humidity?: number | string;
          windSpeed?: number | string;
          city?: string;
        };
        // 自动转换字符串为数字（兼容 http 响应中的字符串值）
        if (typeof temp === "string") temp = parseFloat(temp);
        if (typeof humidity === "string") humidity = parseFloat(humidity);
        if (typeof windSpeed === "string") windSpeed = parseFloat(windSpeed);
        if (temp === undefined || Number.isNaN(temp)) {
          return { success: false, error: new Error("Missing or invalid temp parameter") };
        }

        const location = city || "当前位置";
        const w = (weather || "").toLowerCase();
        const h = humidity ?? 50;
        const ws = windSpeed ?? 0;

        // 温度建议
        let tempAdvice = "";
        let clothing = "";
        if (temp < 0) { tempAdvice = "天气寒冷，尽量减少户外活动时间"; clothing = "羽绒服、厚毛衣、保暖内衣、围巾手套"; }
        else if (temp < 10) { tempAdvice = "天气较冷，注意保暖"; clothing = "厚外套、毛衣、长裤"; }
        else if (temp < 20) { tempAdvice = "天气凉爽，体感舒适"; clothing = "薄外套、长袖衬衫、长裤"; }
        else if (temp < 28) { tempAdvice = "天气温暖，适合户外活动"; clothing = "短袖、薄长裤或裙子"; }
        else if (temp < 35) { tempAdvice = "天气炎热，注意防暑降温"; clothing = "短袖、短裤、透气衣物，注意防晒"; }
        else { tempAdvice = "天气酷热，尽量避免长时间户外活动"; clothing = "轻薄透气衣物，务必做好防晒"; }

        // 天气状况建议
        const weatherTips: string[] = [];
        if (w.includes("rain") || w.includes("雨") || w.includes("shower")) {
          weatherTips.push("有雨，外出请携带雨具");
          clothing += "，携带雨伞或雨衣";
        }
        if (w.includes("snow") || w.includes("雪")) {
          weatherTips.push("有雪，路面可能湿滑，注意交通安全");
          clothing += "，穿防滑鞋";
        }
        if (w.includes("thunder") || w.includes("雷") || w.includes("storm")) {
          weatherTips.push("有雷雨，避免在空旷地带活动");
        }
        if (w.includes("fog") || w.includes("雾")) {
          weatherTips.push("有雾，能见度较低，驾车请减速慢行");
        }
        if (ws > 20) {
          weatherTips.push("风力较大，注意防风，避免在广告牌下停留");
        }
        if (h > 80) {
          weatherTips.push("湿度较高，体感闷热，注意补充水分");
        }
        if (h < 30) {
          weatherTips.push("空气干燥，注意保湿和补水");
        }

        // 健康建议
        const healthTips: string[] = [];
        if (temp > 30) { healthTips.push("高温天注意防暑，多饮水，避免正午时段户外活动"); }
        else if (temp < 5) { healthTips.push("低温天注意保暖，预防呼吸道感染"); }
        if (h > 80 && temp > 25) { healthTips.push("高温高湿天气容易中暑，注意室内通风"); }
        if (w.includes("pollen") || w.includes("花粉")) { healthTips.push("花粉浓度可能较高，过敏体质者注意防护"); }
        healthTips.push("保持良好作息，适量运动，增强免疫力");

        return {
          success: true,
          data: {
            location,
            temperature: temp,
            weather: weather || "未知",
            humidity: h,
            windSpeed: ws,
            travelAdvice: [tempAdvice, ...weatherTips].join("。"),
            clothingAdvice: clothing,
            healthAdvice: healthTips.join("。"),
          },
        };
      },
      description: "根据天气参数生成出行和健康建议。参数: temp(number, °C), weather?(string), humidity?(number, %), windSpeed?(number, km/h), city?(string)",
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
