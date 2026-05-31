/**
 * 元 Skill：Skill 的自我进化能力
 *
 * - skill_compose: 声明式组合多个 Skill 为一个新 Skill（流水线/并行/条件）
 * - skill_from_template: 基于参数化模板生成 Skill
 * - skill_from_description: LLM 驱动，从自然语言描述生成 Skill
 * - skill_optimizer: 分析 Skill 执行指标，建议优化
 * - skill_list_all: 列出所有 Skill 的完整信息（含指标）
 */
import { defineSkill, defineSystemSkill, Autonomy } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import type { ExecutionEngine } from "../engine/index.js";
import type { EvolutionController } from "../engine/evolution-controller.js";
import type { LLMProvider } from "../llm/types.js";
import { runInSandbox } from "../engine/worker-sandbox.js";
import { getCurrentUserId } from "../user/request-context.js";
import { permissions } from "../permissions/index.js";
import { getCustomSkillRepository } from "../db/custom-skill-repository.js";
import { isMySQL } from "../db/database.js";
import { scanCode } from "../utils/code-security.js";

/** 计算两个字符串的编辑距离（Levenshtein Distance） */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

/** 计算两个字符串的相似度（0-1，1表示完全相同） */
function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  return 1 - distance / maxLen;
}

/** 检测是否存在相似 skill */
function findSimilarSkill(name: string, description: string, registry: SkillRegistry): { name: string; similarity: number } | null {
  const allSkills = registry.list();
  let bestMatch: { name: string; similarity: number } | null = null;
  for (const skill of allSkills) {
    const nameSim = stringSimilarity(name, skill.name);
    const descSim = stringSimilarity(description, skill.description ?? "");
    const similarity = Math.max(nameSim, descSim * 0.8); // 名称权重更高
    if (similarity > 0.75 && (!bestMatch || similarity > bestMatch.similarity)) {
      bestMatch = { name: skill.name, similarity };
    }
  }
  return bestMatch;
}

export function createMetaSkills(
  registry: SkillRegistry,
  engine: ExecutionEngine,
  llmProvider?: LLMProvider | (() => LLMProvider | null),
  evolutionController?: EvolutionController,
): void {
  function getProvider(): LLMProvider | null {
    if (!llmProvider) return null;
    return typeof llmProvider === "function" ? llmProvider() : llmProvider;
  }
  // ===== skill_compose: 声明式组合 =====
  registry.register(
    defineSystemSkill({
      name: "skill_compose",
      description: `【创建 Skill 的首选方式】创建一个组合 Skill，将多个现有 Skill 串联或并行执行。所有功能集中在一个 Skill 中，禁止拆分。
参数:
  name(string): 新 Skill 名称
  description(string): 描述
  steps(array): 执行步骤 [{ skill: "skill名", params: {参数映射}, outputKey?: "结果存储键" }]
    参数映射可用 $input 引用原始输入，$steps.stepKey 引用前序结果（支持字符串内嵌替换如 "lat=$steps.weather.lat"）
  mode?("sequential"|"parallel"): 执行模式，默认 sequential
可用 Skill 及注意事项：
- http_call: 发起 HTTP 请求（通用，支持所有方法）
- calculate: 数学/逻辑表达式计算。expression 只支持数字运算、变量访问、比较判断、三元条件、Math.* 函数。不支持自定义函数定义、字符串拼接、复杂逻辑、赋值操作。
  【重要】expression 中引用前序步骤结果时：
    - 直接使用 outputKey（或 skill 名称，如果未指定 outputKey）作为变量名
    - 示例：若步骤 {skill:"geo_ip", outputKey:"geo"} 返回 {city:"Shanghai"}，则 expression 写 geo.city
    - 示例：若步骤 {skill:"geo_ip"}（未指定 outputKey）返回 {city:"Shanghai"}，则 expression 写 geo_ip.city
    - 禁止在 expression 中使用 $steps.xxx、context.xxx 或 $input.xxx 语法
    - 禁止在 expression 中写字符串字面量进行拼接（如 "city=" + geo.city），calculate 不支持字符串拼接
- weather_advice: 根据天气参数给出健康建议（直接传 temp/weather/humidity 等参数）
规则：
1. 优先组合现有 Skill，禁止拆分功能
2. 需要数据转换时优先用 calculate，禁止在 calculate 中写自定义函数
3. 创建成功后停止，不要继续创建其他 Skill`,
      paramSchema: {
        properties: {
          name: { type: "string", description: "Name for the new composed skill" },
          description: { type: "string", description: "Description of the composed skill" },
          steps: { type: "array", description: "Array of steps: [{skill, params?, outputKey?}]", items: { type: "object" } },
          mode: { type: "string", description: "Execution mode: 'sequential' (default) or 'parallel'", enum: ["sequential", "parallel"] },
        },
        required: ["name", "steps"],
      },
      handler: async (params, context) => {
        const name = params.name as string;
        const description = params.description as string;
        const steps = params.steps as Array<{
          skill: string;
          params?: Record<string, unknown>;
          outputKey?: string;
        }>;
        const mode = (params.mode as string) ?? "sequential";

        if (!name || !steps || steps.length === 0) {
          return { success: false, error: new Error("name 和 steps 参数必填") };
        }

        // 验证所有引用的 Skill 存在且用户有执行权限
        const userId = context.user?.id || getCurrentUserId();
        if (!userId || userId === "default") {
          return { success: false, error: new Error("需要登录用户才能创建组合 Skill") };
        }
        for (const step of steps) {
          if (!registry.lookup(step.skill)) {
            return { success: false, error: new Error(`Skill 不存在: ${step.skill}`) };
          }
          const canExecute = await permissions.hasSkillPermission(userId, step.skill);
          if (!canExecute) {
            return { success: false, error: new Error(`无权执行 Skill: ${step.skill}，无法将其包含在组合 Skill 中`) };
          }
        }

        // 检查名字冲突
        if (registry.lookup(name)) {
          return { success: false, error: new Error(`Skill 已存在: ${name}`) };
        }

        // 提交审批，而不是直接注册
        const generatedBy = userId !== "default" ? userId : "skill_compose";

        // 构建可序列化的 skill 定义
        const skillDef = {
          metaType: "composed",
          name,
          description: `[组合] ${description}`,
          steps,
          mode,
          owner: generatedBy,
        };

        if (evolutionController) {
          const approvalId = await evolutionController.submitForApproval(
            name,
            description,
            JSON.stringify(skillDef),
            [],
            generatedBy,
          );
          return {
            success: true,
            data: {
              name,
              approvalId,
              status: "pending_approval",
              steps: steps.length,
              mode,
              message: `组合 Skill "${name}" 已提交审批，请前往 Evolution → Pending Actions 审批后使用`,
            },
          };
        }

        // 如果没有 evolutionController，回退到直接注册（开发环境兼容）
        const composedSkill = defineSkill({
          name,
          description: `[组合] ${description}`,
          owner: generatedBy,
          handler: async (inputParams, context) => {
            const results: Record<string, unknown> = {};
            results["$input"] = inputParams;

            if (mode === "parallel") {
              const promises = steps.map(async (step) => {
                const resolvedParams = resolveParams(step.params ?? {}, results, inputParams);
                const finalParams = injectCalculateContext(step.skill, resolvedParams, results);
                const result = await engine.execute(step.skill, finalParams, true);
                return { key: step.outputKey ?? step.skill, result };
              });

              const parallelResults = await Promise.all(promises);
              for (const { key, result } of parallelResults) {
                results[key] = result.data;
              }
            } else {
              for (const step of steps) {
                const resolvedParams = resolveParams(step.params ?? {}, results, inputParams);
                const finalParams = injectCalculateContext(step.skill, resolvedParams, results);
                const result = await engine.execute(step.skill, finalParams, true);
                const key = step.outputKey ?? step.skill;
                results[key] = result.data;

                if (!result.success) {
                  return {
                    success: false,
                    error: new Error(`步骤 ${step.skill} 失败: ${result.error?.message}`),
                    data: results,
                  };
                }
              }
            }

            return { success: true, data: results };
          },
        });

        registry.register(composedSkill);

        return {
          success: true,
          data: {
            name,
            description,
            steps: steps.length,
            mode,
            message: `组合 Skill "${name}" 创建成功，包含 ${steps.length} 个步骤`,
          },
        };
      },
    }),
  );

  // ===== skill_from_template: 模板生成 =====
  registry.register(
    defineSystemSkill({
      name: "skill_from_template",
      description: `基于模板创建新 Skill。
参数:
  name(string): 新 Skill 名称
  description(string): 描述
  template("transform"|"validate"|"aggregate"): 模板类型
  config(object): 模板配置
    transform: { inputField: string, outputField: string, expression: string }
    validate: { rules: [{field: string, condition: string, message: string}] }
    aggregate: { skills: string[], mergeStrategy: "concat"|"merge"|"pick_best" }`,
      paramSchema: {
        properties: {
          name: { type: "string", description: "Name for the new skill" },
          description: { type: "string", description: "Description of the new skill" },
          template: { type: "string", description: "Template type to use", enum: ["transform", "validate", "aggregate"] },
          config: { type: "object", description: "Template configuration object" },
        },
        required: ["name", "template"],
      },
      handler: async (params, context) => {
        const name = params.name as string;
        const description = params.description as string;
        const template = params.template as string;
        const config = params.config as Record<string, unknown>;

        if (!name || !template) {
          return { success: false, error: new Error("name 和 template 必填") };
        }

        if (registry.lookup(name)) {
          return { success: false, error: new Error(`Skill 已存在: ${name}`) };
        }

        const userId = context.user?.id || getCurrentUserId();
        const generatedBy = userId !== "default" ? userId : "skill_from_template";

        // 构建可序列化的 skill 定义
        const skillDef = {
          metaType: "template",
          name,
          description: `[模板:${template}] ${description}`,
          template,
          config,
          owner: generatedBy,
        };

        if (evolutionController) {
          const approvalId = evolutionController.submitForApproval(
            name,
            description,
            JSON.stringify(skillDef),
            [],
            generatedBy,
          );
          return {
            success: true,
            data: {
              name,
              approvalId,
              status: "pending_approval",
              template,
              message: `模板 Skill "${name}" 已提交审批，请前往 Evolution → Pending Actions 审批后使用`,
            },
          };
        }

        // 如果没有 evolutionController，回退到直接注册（开发环境兼容）
        let skill;
        switch (template) {
          case "transform":
            skill = createTransformSkill(name, description, config);
            break;
          case "validate":
            skill = createValidateSkill(name, description, config);
            break;
          case "aggregate":
            skill = createAggregateSkill(name, description, config, engine);
            break;
          default:
            return { success: false, error: new Error(`未知模板: ${template}`) };
        }

        (skill as any).owner = generatedBy;
        registry.register(skill);

        return {
          success: true,
          data: {
            name,
            template,
            message: `从模板 "${template}" 创建 Skill "${name}" 成功`,
          },
        };
      },
    }),
  );

  // ===== skill_unregister: 删除动态 Skill =====
  registry.register(
    defineSystemSkill({
      name: "skill_unregister",
      description: "注销一个动态创建的 Skill。参数: name(string)",
      handler: async (params) => {
        const name = params.name as string;
        if (!name) {
          return { success: false, error: new Error("name 必填") };
        }

        try {
          registry.unregister(name);
          return { success: true, data: { unregistered: name } };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  // ===== skill_info: 获取 Skill 详情 + 指标 =====
  registry.register(
    defineSystemSkill({
      name: "skill_info",
      description: "获取指定 Skill 的详细信息和执行指标。参数: name(string)",
      paramSchema: {
        properties: {
          name: { type: "string", description: "Name of the skill to get information about" },
        },
        required: ["name"],
      },
      handler: async (params) => {
        const name = params.name as string;
        const skill = registry.lookup(name);
        if (!skill) {
          return { success: false, error: new Error(`Skill 不存在: ${name}`) };
        }

        const metrics = engine.metrics.getMetrics(name);

        return {
          success: true,
          data: {
            name: skill.name,
            version: skill.version,
            description: skill.description,
            visible: skill.visible,
            autonomy: skill.autonomy,
            timeout: skill.timeout,
            dependencies: skill.dependencies,
            async: skill.async,
            retry: skill.retry,
            capabilities: skill.capabilities,
            circuitBreaker: skill.circuitBreaker,
            errorPropagation: skill.errorPropagation,
            metrics: metrics ?? { totalCalls: 0 },
          },
        };
      },
    }),
  );

  // ===== skill_from_description: LLM 驱动的 Skill 生成 =====
  registry.register(
    defineSystemSkill({
      name: "skill_from_description",
      timeout: 300000, // 5 分钟：LLM 生成代码可能很慢
      description: `【最后手段】从自然语言描述生成代码 Skill。仅在现有 Skill 无法通过组合实现需求时才使用。
参数:
  name(string): 新 Skill 名称
  description(string): 功能描述
  examples?(array): 输入输出示例 [{input: {}, output: {}}]
  capabilities?(string[]): 所需权限声明
规则：
1. 优先使用 skill_compose 组合现有 Skill
2. 创建成功后停止，不要继续创建其他 Skill`,
      paramSchema: {
        properties: {
          name: { type: "string", description: "Name for the new skill" },
          description: { type: "string", description: "Natural language description of what the skill should do" },
          examples: { type: "array", description: "Input/output examples [{input: {}, output: {}}]", items: { type: "object" } },
          capabilities: { type: "array", description: "Required capability declarations", items: { type: "string" } },
          autoRegister: { type: "boolean", description: "自动注册模式：为 true 时直接保存到 custom_skills 并注册到 registry，不走审批流程（用于 App 自动生成等自动化场景）" },
        },
        required: ["name", "description"],
      },
      handler: async (params, context) => {
        const provider = getProvider();
        if (!provider) {
          return { success: false, error: new Error("LLM 未配置，无法生成 Skill") };
        }

        const name = params.name as string;
        const description = params.description as string;
        const examples = (params.examples as Array<{ input: Record<string, unknown>; output: Record<string, unknown> }>) ?? [];
        const capabilities = (params.capabilities as string[]) ?? [];
        const autoRegister = params.autoRegister as boolean;

        if (!name || !description) {
          return { success: false, error: new Error("name 和 description 必填") };
        }

        if (registry.lookup(name)) {
          return { success: false, error: new Error(`Skill 已存在: ${name}`) };
        }

        // 检测相似 skill（防止冗余创建）
        const similar = findSimilarSkill(name, description, registry);
        if (similar) {
          return {
            success: false,
            error: new Error(
              `检测到相似的已有 skill "${similar.name}"（相似度: ${(similar.similarity * 100).toFixed(1)}%）。` +
              `如果现有 skill 不能满足需求，请说明具体差异；否则请直接使用现有 skill。`
            ),
          };
        }

        // 构建 LLM Prompt
        const exampleText = examples.length > 0
          ? `\n示例:\n${examples.map((e, i) => `  ${i + 1}. 输入: ${JSON.stringify(e.input)} → 输出: ${JSON.stringify(e.output)}`).join("\n")}`
          : "";

        const dbTypeHint = isMySQL()
          ? "当前系统使用 MySQL 数据库，如需直接 SQL 查询请使用 mysql_query(skillName='mysql_query', params={sql})，所有数据库连接由系统托管，代码中禁止自行构造 connection 对象或引用 host/port/user/password/database 等变量。"
          : "当前系统使用 SQLite 数据库，如需直接 SQL 查询请使用 db_query(skillName='db_query', params={sql})。";

        const prompt = `你是一个 Skill 代码生成器。根据以下描述生成一个 JavaScript 函数体。

Skill 名称: ${name}
Skill 描述: ${description}${exampleText}

数据库环境提示: ${dbTypeHint}

要求:
1. 函数接收 (params, context) 两个参数，返回 { success: boolean, data?: unknown, error?: Error }
   - params: Record<string, unknown> 用户传入的参数，所有输入必须从 params 读取
   - context: { callSkill(name, params) } 可调用其他系统 Skill
   - 【重要】context.callSkill(name, params) 直接返回 skill 的 data 结果（不是 {success, data} 包装），调用失败会抛异常，用 try/catch 捕获
2. 优先使用 context.callSkill 调用已有系统 Skill 来完成功能，禁止直接操作底层数据库连接
3. 【关键】代码中禁止引用任何未声明的变量（如 host、port、config 等），所有配置和输入必须从 params 获取
4. 【关键】如果 params 缺少必要参数，不要抛出异常，而是 return { success: false, error: new Error("缺少 xxx 参数") }
5. 只输出函数体代码（不需要 function 关键字和大括号）
6. 可以使用 async/await、try/catch、new Date()、new Error()
7. 代码应该简洁、安全，不能使用 eval、require、import
8. 不能访问文件系统、网络或其他外部资源
9. 用 JavaScript 语法（不是 TypeScript），不要写类型注解（如 ": string"、"as any"）

只输出纯代码，不要任何解释或 markdown 标记。`;

        try {
          const response = await provider.chat([
            { role: "user", content: prompt },
          ]);

          let code = (response.content ?? "").trim();
          // 清理可能的 markdown 标记（支持代码块前后有解释文字的情况）
          const codeBlockMatch = code.match(/```(?:javascript|js|typescript|ts)?\n?([\s\S]*?)\n?```/);
          if (codeBlockMatch) {
            code = codeBlockMatch[1].trim();
          } else if (code.startsWith("```")) {
            code = code.replace(/^```(?:javascript|js|typescript|ts)?\n?/, "").replace(/\n?```$/, "");
          }

          // 安全检查：AST 静态分析
          // 注意：代码在 sandbox 中会被包裹在 async IIFE 中执行，scanCode 也需要同样处理才能正确解析 await
          const wrappedCodeForScan = `(async () => {\n${code}\n})()`;
          const securityResult = scanCode(wrappedCodeForScan);
          if (!securityResult.safe) {
            const violationStr = securityResult.violations.join(" | ");
            console.warn(`[skill_from_description] scanCode failed for ${name}: ${violationStr}, codePreview=${code.slice(0, 120).replace(/\n/g, "\\n")}`);
            return {
              success: false,
              error: new Error(`生成的代码未通过安全检查: ${violationStr}`),
            };
          }

          // 测试执行（用示例或空参数）— 通过 Worker 沙箱运行
          const testParams = examples.length > 0 ? examples[0].input : {};
          const testSandboxResult = await runInSandbox(
            code,
            testParams,
            { timeout: 30000 },
            {
              callSkill: async (skillName: string, _skillParams: Record<string, unknown>) => {
                // Mock 常用系统 Skill 的返回值，避免测试时因 undefined 崩溃
                if (skillName === "form_data_query") return { records: [], total: 0 };
                if (skillName === "mysql_query" || skillName === "db_query") return [];
                if (skillName === "kb_search" || skillName === "kb_query") return { results: [] };
                if (skillName === "workflow_start") return { instanceId: "mock-instance-id" };
                return {};
              },
              user: context.user,
            },
          );
          if (!testSandboxResult.success) {
            const errorMsg = String(testSandboxResult.error || "");
            const isCodeBug =
              errorMsg.includes("ReferenceError") ||
              errorMsg.includes("is not defined") ||
              errorMsg.includes("SyntaxError") ||
              errorMsg.includes("Unexpected token") ||
              errorMsg.includes("Cannot access") ||
              errorMsg.includes("is not a function");
            if (isCodeBug) {
              return { success: false, error: new Error(`生成的 Skill 测试失败: ${testSandboxResult.error}`) };
            }
            // 业务参数校验等环境限制导致的失败，记录但不阻塞，继续审批流程
            console.warn(`[skill_from_description] Sandbox 测试因业务逻辑/参数不足失败（非代码 bug），继续提交审批: ${name}, error=${errorMsg}`);
          }
          const testResult = testSandboxResult.success ? testSandboxResult.data : undefined;
          if (testResult !== undefined && (typeof testResult !== "object" || testResult === null)) {
            return { success: false, error: new Error("生成的 Skill 未返回有效结果对象") };
          }

          // 自动注册模式：直接保存到 custom_skills 并注册，不走审批（用于 App 自动生成等场景）
          if (autoRegister) {
            try {
              const repo = getCustomSkillRepository();
              const skillDef = defineSkill({
                name,
                description,
                version: "1.0.0",
                visible: true,
                autonomy: Autonomy.MANUAL,
                dependencies: [],
                timeout: 30000,
                retry: { maxRetries: 0, backoffMs: 1000, backoffMultiplier: 2 },
                handler: async () => ({ success: true, data: {} }),
              });
              await repo.create(skillDef, getCurrentUserId(), code);
              // 立即注册到 registry（如果尚未注册）
              if (!registry.lookup(name)) {
                const foundSkill = await repo.findByName(name, getCurrentUserId()) || await repo.findByName(name);
                if (foundSkill) {
                  const reconstructed = await repo.reconstructSkill(foundSkill);
                  registry.register(reconstructed);
                }
              }
              return {
                success: true,
                data: { name, status: "created", message: `Skill "${name}" 已自动生成并注册` },
              };
            } catch (regErr: any) {
              const regMsg = regErr instanceof Error ? regErr.message : String(regErr);
              if (regMsg.includes("Duplicate") || regMsg.includes("already exists") || regMsg.includes("UNIQUE constraint")) {
                return { success: true, data: { name, status: "exists", message: `Skill "${name}" 已存在` } };
              }
              return { success: false, error: new Error(`自动注册失败: ${regMsg}`) };
            }
          }

          // 提交审批，而不是直接注册
          if (!evolutionController) {
            return { success: false, error: new Error("进化控制器未初始化，无法提交审批") };
          }
          const userId = context.user?.id || getCurrentUserId();
          const generatedBy = userId !== "default" ? userId : "skill_from_description";
          const approvalId = evolutionController.submitForApproval(
            name,
            description,
            code,
            capabilities,
            generatedBy,
          );
          return {
            success: true,
            data: {
              name,
              approvalId,
              status: "pending_approval",
              generatedCode: code,
              testResult,
              message: `Skill "${name}" 已生成并提交审批，在审批通过前无法使用。请勿尝试创建替代 skill，请等待管理员审批。`,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  // ===== skill_optimizer: 分析 Skill 指标并建议优化 =====
  registry.register(
    defineSystemSkill({
      name: "skill_optimizer",
      description: `分析 Skill 执行指标，给出优化建议。
参数:
  name?(string): 指定 Skill 名称，不指定则分析全局
  threshold_success_rate?(number): 成功率阈值（默认 0.9）
  threshold_p95_ms?(number): P95 延迟阈值（默认 5000ms）`,
      paramSchema: {
        properties: {
          name: { type: "string", description: "Skill name to analyze (analyzes all skills if omitted)" },
          threshold_success_rate: { type: "number", description: "Success rate threshold (default: 0.9)" },
          threshold_p95_ms: { type: "number", description: "P95 latency threshold in milliseconds (default: 5000)" },
        },
      },
      handler: async (params) => {
        const name = params.name as string | undefined;
        const successThreshold = (params.threshold_success_rate as number) ?? 0.9;
        const p95Threshold = (params.threshold_p95_ms as number) ?? 5000;

        if (name) {
          const metrics = engine.metrics.getMetrics(name);
          if (!metrics) {
            return { success: false, error: new Error(`无指标数据: ${name}`) };
          }
          return {
            success: true,
            data: {
              skill: name,
              metrics,
              issues: analyzeIssues(name, metrics, successThreshold, p95Threshold),
            },
          };
        }

        // 全局分析
        const allMetrics = engine.metrics.getAllMetrics();
        const issues: Array<{ skill: string; problems: string[] }> = [];

        for (const m of allMetrics) {
          const problems = analyzeIssues(m.skillName, m, successThreshold, p95Threshold);
          if (problems.length > 0) {
            issues.push({ skill: m.skillName, problems });
          }
        }

        return {
          success: true,
          data: {
            totalSkills: allMetrics.length,
            issueCount: issues.length,
            issues,
          },
        };
      },
    }),
  );

  // ===== skill_test: 自动测试 Skill =====
  registry.register(
    defineSystemSkill({
      name: "skill_test",
      description: `自动测试一个 Skill，可手动提供测试用例或让 LLM 生成。
参数:
  name(string): 要测试的 Skill 名称
  cases?(array): 测试用例 [{input: {}, expected?: {success: boolean, data?: any}, description?: string}]
  auto_generate?(boolean): 是否让 LLM 自动生成测试用例（需 LLM 支持）
  count?(number): 自动生成的用例数量（默认 3）`,
      paramSchema: {
        properties: {
          name: { type: "string", description: "Name of the skill to test" },
          cases: { type: "array", description: "Test cases [{input: {}, expected?: {success, data?}, description?}]", items: { type: "object" } },
          auto_generate: { type: "boolean", description: "Whether to auto-generate test cases using LLM" },
          count: { type: "number", description: "Number of auto-generated test cases (default: 3)" },
        },
        required: ["name"],
      },
      handler: async (params) => {
        const name = params.name as string;
        if (!name) {
          return { success: false, error: new Error("name 必填") };
        }

        const skill = registry.lookup(name);
        if (!skill) {
          return { success: false, error: new Error(`Skill 不存在: ${name}`) };
        }

        let cases = params.cases as Array<{
          input: Record<string, unknown>;
          expected?: { success: boolean; data?: unknown };
          description?: string;
        }> | undefined;

        const autoGenerate = params.auto_generate as boolean;
        const count = (params.count as number) ?? 3;

        // 自动生成测试用例
        if (autoGenerate && (!cases || cases.length === 0)) {
          const provider = getProvider();
          if (!provider) {
            return { success: false, error: new Error("LLM 未配置，无法自动生成测试用例") };
          }

          const prompt = `为以下 Skill 生成 ${count} 个测试用例。

Skill 名称: ${skill.name}
Skill 描述: ${skill.description}

返回 JSON 数组格式:
[{"input": {...}, "expected": {"success": true/false, "data": ...}, "description": "测试描述"}]

只输出 JSON 数组，不要其他内容。`;

          try {
            const response = await provider.chat([
              { role: "user", content: prompt },
            ]);
            let jsonStr = (response.content ?? "").trim();
            if (jsonStr.startsWith("```")) {
              jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
            }
            cases = JSON.parse(jsonStr);
          } catch (err) {
            return { success: false, error: new Error(`生成测试用例失败: ${err instanceof Error ? err.message : String(err)}`) };
          }
        }

        if (!cases || cases.length === 0) {
          return { success: false, error: new Error("无测试用例") };
        }

        // 执行测试
        const results: Array<{
          description: string;
          input: Record<string, unknown>;
          passed: boolean;
          actual?: unknown;
          expected?: unknown;
          error?: string;
          durationMs: number;
        }> = [];

        for (const tc of cases) {
          const start = Date.now();
          try {
            const actual = await engine.execute(name, tc.input);
            const dur = Date.now() - start;
            let passed = true;

            if (tc.expected) {
              if (tc.expected.success !== undefined && actual.success !== tc.expected.success) {
                passed = false;
              }
              if (tc.expected.data !== undefined && JSON.stringify(actual.data) !== JSON.stringify(tc.expected.data)) {
                passed = false;
              }
            }

            results.push({
              description: tc.description || JSON.stringify(tc.input),
              input: tc.input,
              passed,
              actual: { success: actual.success, data: actual.data },
              expected: tc.expected,
              durationMs: dur,
            });
          } catch (err) {
            const dur = Date.now() - start;
            const passed = tc.expected?.success === false;
            results.push({
              description: tc.description || JSON.stringify(tc.input),
              input: tc.input,
              passed,
              error: err instanceof Error ? err.message : String(err),
              expected: tc.expected,
              durationMs: dur,
            });
          }
        }

        const passCount = results.filter((r) => r.passed).length;
        return {
          success: true,
          data: {
            skill: name,
            total: results.length,
            passed: passCount,
            failed: results.length - passCount,
            passRate: passCount / results.length,
            results,
          },
        };
      },
    }),
  );

  // ===== skill_list_all: 列出所有 Skill 完整信息 =====
  registry.register(
    defineSystemSkill({
      name: "skill_list_all",
      description: "列出所有已注册 Skill 的完整信息，包含版本、能力声明和执行指标。",
      handler: async () => {
        const skills = registry.list().map((s) => {
          const metrics = engine.metrics.getMetrics(s.name);
          return {
            name: s.name,
            version: s.version,
            description: s.description,
            visible: s.visible,
            autonomy: s.autonomy,
            dependencies: s.dependencies,
            capabilities: s.capabilities,
            hasCompensate: !!s.compensate,
            hasCircuitBreaker: !!s.circuitBreaker,
            metrics: metrics
              ? {
                  calls: metrics.totalCalls,
                  successRate: metrics.successRate,
                  avgMs: Math.round(metrics.avgDurationMs),
                }
              : null,
          };
        });
        return { success: true, data: { count: skills.length, skills } };
      },
    }),
  );

  console.log("   Meta skills registered (compose/template/unregister/info/generate/optimizer/test/list_all)");
}

// ===== 指标分析 =====

function analyzeIssues(
  _name: string,
  metrics: { totalCalls: number; successRate: number; p95DurationMs?: number; errorDistribution?: Record<string, number> },
  successThreshold: number,
  p95Threshold: number,
): string[] {
  const problems: string[] = [];

  if (metrics.totalCalls > 0 && metrics.successRate < successThreshold) {
    problems.push(
      `成功率 ${(metrics.successRate * 100).toFixed(1)}% 低于阈值 ${(successThreshold * 100).toFixed(0)}%`,
    );
  }

  if (metrics.p95DurationMs && metrics.p95DurationMs > p95Threshold) {
    problems.push(
      `P95 延迟 ${metrics.p95DurationMs.toFixed(0)}ms 超过阈值 ${p95Threshold}ms，建议添加缓存或优化逻辑`,
    );
  }

  if (metrics.errorDistribution) {
    const topErrors = Object.entries(metrics.errorDistribution)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 3);
    if (topErrors.length > 0) {
      problems.push(
        `频繁错误类型: ${topErrors.map(([type, count]) => `${type}(${count})`).join(", ")}`,
      );
    }
  }

  if (metrics.totalCalls > 100 && metrics.successRate < 0.5) {
    problems.push("建议添加熔断器配置，防止级联故障");
  }

  return problems;
}

// ===== 辅助函数 =====

export function resolveParams(
  paramTemplate: Record<string, unknown>,
  results: Record<string, unknown>,
  originalInput: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  function lookupRef(ref: string): unknown {
    if (ref === "$input") return originalInput;
    if (ref.startsWith("$input.")) {
      const parts = ref.slice(7).split(".");
      let val: any = originalInput;
      for (const p of parts) val = val?.[p];
      return val;
    }
    if (ref.startsWith("$steps.")) {
      const parts = ref.slice(7).split(".");
      let val: any = results;
      for (const p of parts) val = val?.[p];
      return val;
    }
    return ref;
  }

  function interpolateString(str: string): unknown {
    // 纯引用，如 "$steps.weather.temp"
    if (str.startsWith("$") && !str.includes(" ") && str.split("$").length === 2) {
      return lookupRef(str);
    }
    // 模板字符串内嵌替换，如 "lat is $steps.weather.lat"
    return str.replace(/\$input\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)/g, (match) => {
      const val = lookupRef(match);
      return typeof val === "string" ? val : JSON.stringify(val);
    }).replace(/\$steps\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)/g, (match) => {
      const val = lookupRef(match);
      return typeof val === "string" ? val : JSON.stringify(val);
    });
  }

  for (const [key, value] of Object.entries(paramTemplate)) {
    // expression 字段是代码/表达式，不应被 $steps/$input 模板替换
    if (key === "expression" && typeof value === "string") {
      resolved[key] = value;
    } else if (typeof value === "string") {
      resolved[key] = interpolateString(value);
    } else if (Array.isArray(value)) {
      resolved[key] = value.map((v) => {
        if (typeof v === "string") {
          return v.startsWith("$") ? interpolateString(v) : v;
        }
        if (v && typeof v === "object" && !Array.isArray(v)) {
          return resolveParams(v as Record<string, unknown>, results, originalInput);
        }
        return v;
      });
    } else if (value && typeof value === "object") {
      resolved[key] = resolveParams(value as Record<string, unknown>, results, originalInput);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/** 为 calculate 步骤自动注入前序结果作为 context */
export function injectCalculateContext(
  skillName: string,
  params: Record<string, unknown>,
  results: Record<string, unknown>,
): Record<string, unknown> {
  if (skillName !== "calculate") return params;
  if (params.context) {
    // 如果用户显式传了 context，只在调试模式下记录
    if (process.env.DEBUG_CALCULATE) {
      console.log("[injectCalculateContext] user provided context:", params.context);
    }
    return params;
  }
  // 将前序步骤结果注入为 context
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(results)) {
    if (key === "$input") {
      // 保留原始输入，让 calculate expression 可以引用 input.xxx
      context.input = value;
      continue;
    }
    if (key.startsWith("$")) continue;
    // 在组合 skill handler 中，results[key] 已被赋值为 result.data
    // 只有当值是完整的 ExecutionResult { success, data, error } 时才解包
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "success" in (value as any) &&
      "data" in (value as any)
    ) {
      context[key] = (value as any).data;
    } else {
      context[key] = value;
    }
  }
  if (process.env.DEBUG_CALCULATE) {
    console.log("[injectCalculateContext] auto-injected context keys:", Object.keys(context));
  }
  return { ...params, context };
}

export function createTransformSkill(name: string, description: string, config: Record<string, unknown>) {
  const inputField = config.inputField as string;
  const outputField = config.outputField as string;
  const expression = config.expression as string;

  return defineSkill({
    name,
    description: `[模板:transform] ${description}`,
    handler: async (params) => {
      const input = params[inputField];
      // 安全执行简单表达式
      let output: unknown;
      try {
        if (expression === "uppercase" && typeof input === "string") {
          output = input.toUpperCase();
        } else if (expression === "lowercase" && typeof input === "string") {
          output = input.toLowerCase();
        } else if (expression === "trim" && typeof input === "string") {
          output = input.trim();
        } else if (expression === "length") {
          output = typeof input === "string" ? input.length : Array.isArray(input) ? input.length : 0;
        } else if (expression === "json_parse" && typeof input === "string") {
          output = JSON.parse(input);
        } else if (expression === "json_stringify") {
          output = JSON.stringify(input);
        } else {
          output = input; // passthrough
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
      }

      return { success: true, data: { [outputField]: output } };
    },
  });
}

export function createValidateSkill(name: string, description: string, config: Record<string, unknown>) {
  const rules = config.rules as Array<{ field: string; condition: string; message: string }>;

  return defineSkill({
    name,
    description: `[模板:validate] ${description}`,
    handler: async (params) => {
      const errors: string[] = [];

      for (const rule of rules) {
        const value = params[rule.field];
        let valid = true;

        switch (rule.condition) {
          case "required":
            valid = value !== undefined && value !== null && value !== "";
            break;
          case "is_string":
            valid = typeof value === "string";
            break;
          case "is_number":
            valid = typeof value === "number" && !isNaN(value);
            break;
          case "not_empty":
            valid = Array.isArray(value) ? value.length > 0 : !!value;
            break;
          default:
            // 未知 condition 视为验证失败，防止 LLM 生成无效规则被静默通过
            valid = false;
            errors.push(`未知验证规则: ${rule.condition} (${rule.message})`);
        }

        if (!valid) errors.push(rule.message);
      }

      return {
        success: errors.length === 0,
        data: { valid: errors.length === 0, errors },
        error: errors.length > 0 ? new Error(errors.join("; ")) : undefined,
      };
    },
  });
}

export function createAggregateSkill(
  name: string,
  description: string,
  config: Record<string, unknown>,
  engine: ExecutionEngine,
) {
  const skills = config.skills as string[];
  const mergeStrategy = (config.mergeStrategy as string) ?? "merge";

  return defineSkill({
    name,
    description: `[模板:aggregate] ${description}`,
    handler: async (params) => {
      const results = await Promise.all(
        skills.map((s) => {
          const finalParams = injectCalculateContext(s, params, {});
          return engine.execute(s, finalParams);
        }),
      );

      if (mergeStrategy === "concat") {
        const combined = results.map((r) => r.data);
        return { success: true, data: { results: combined } };
      } else if (mergeStrategy === "pick_best") {
        const successful = results.filter((r) => r.success);
        return {
          success: successful.length > 0,
          data: successful[0]?.data ?? null,
        };
      } else {
        // merge
        let merged: Record<string, unknown> = {};
        for (let i = 0; i < results.length; i++) {
          if (results[i].data && typeof results[i].data === "object") {
            merged = { ...merged, ...(results[i].data as Record<string, unknown>) };
          } else {
            merged[skills[i]] = results[i].data;
          }
        }
        return { success: true, data: merged };
      }
    },
  });
}

/** 审批数据接口 */
export interface ApprovalData {
  name: string;
  description: string;
  code: string;
  capabilities: string[];
  generatedBy: string;
}

/** 从审批数据创建 Skill（用于审批通过时注册 + 启动时恢复） */
export async function createSkillFromApproval(
  approval: ApprovalData,
  engine: ExecutionEngine,
): Promise<ReturnType<typeof defineSkill>> {
  if (approval.code.trim().startsWith("{")) {
    const def = JSON.parse(approval.code);

    if (def.metaType === "composed") {
      const { steps, mode } = def;
      return defineSkill({
        name: def.name,
        description: def.description,
        owner: approval.generatedBy,
        handler: async (inputParams, context) => {
          const results: Record<string, unknown> = {};
          results["$input"] = inputParams;

          if (mode === "parallel") {
            const promises = steps.map(async (step: any) => {
              const resolvedParams = resolveParams(step.params ?? {}, results, inputParams);
              const finalParams = injectCalculateContext(step.skill, resolvedParams, results);
              const result = await engine.execute(step.skill, finalParams, true);
              return { key: step.outputKey ?? step.skill, result };
            });
            const parallelResults = await Promise.all(promises);
            for (const { key, result } of parallelResults) {
              results[key] = result.data;
            }
          } else {
            for (const step of steps) {
              const resolvedParams = resolveParams(step.params ?? {}, results, inputParams);
              const finalParams = injectCalculateContext(step.skill, resolvedParams, results);
              const result = await engine.execute(step.skill, finalParams, true);
              const key = step.outputKey ?? step.skill;
              results[key] = result.data;
              if (!result.success) {
                return { success: false, error: new Error(`步骤 ${step.skill} 失败: ${result.error?.message}`), data: results };
              }
            }
          }
          return { success: true, data: results };
        },
      });
    } else if (def.metaType === "template") {
      let skill;
      switch (def.template) {
        case "transform":
          skill = createTransformSkill(def.name, def.description, def.config);
          break;
        case "validate":
          skill = createValidateSkill(def.name, def.description, def.config);
          break;
        case "aggregate":
          skill = createAggregateSkill(def.name, def.description, def.config, engine);
          break;
        default:
          throw new Error(`未知模板类型: ${def.template}`);
      }
      (skill as any).owner = approval.generatedBy;
      return skill;
    } else {
      throw new Error(`未知的 meta skill 类型: ${def.metaType}`);
    }
  } else {
    // 传统代码字符串（skill_from_description）
    const code = approval.code;
    return defineSkill({
      name: approval.name,
      description: `[已审批] ${approval.description}`,
      capabilities: approval.capabilities,
      owner: approval.generatedBy,
      handler: async (params, context) => {
        try {
          const sandboxCtx = {
            callSkill: async (name: string, skillParams: Record<string, unknown>) => {
              const result = await engine.execute(name, skillParams);
              if (!result.success) {
                throw new Error(result.error?.message || `Skill "${name}" 执行失败`);
              }
              return result.data;
            },
            user: context.user,
          };
          const result = await runInSandbox(code, params, { timeout: 30000 }, sandboxCtx);
          return { success: result.success, data: result.data };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    });
  }
}
