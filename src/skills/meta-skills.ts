/**
 * 元 Skill：Skill 的自我进化能力
 *
 * - skill_compose: 声明式组合多个 Skill 为一个新 Skill（流水线/并行/条件）
 * - skill_from_template: 基于参数化模板生成 Skill
 * - skill_from_description: LLM 驱动，从自然语言描述生成 Skill
 * - skill_optimizer: 分析 Skill 执行指标，建议优化
 * - skill_list_all: 列出所有 Skill 的完整信息（含指标）
 */
import { defineSkill, defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import type { ExecutionEngine } from "../engine/index.js";
import type { EvolutionController } from "../engine/evolution-controller.js";
import type { LLMProvider } from "../llm/types.js";
import { runInSandbox } from "../engine/worker-sandbox.js";
import { getCurrentUserId } from "../user/request-context.js";
import { permissions } from "../permissions/index.js";

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
    参数映射可用 $input 引用原始输入，$steps.stepKey 引用前序结果
  mode?("sequential"|"parallel"): 执行模式，默认 sequential
规则：
1. 优先组合现有 Skill，禁止拆分功能
2. 创建成功后停止，不要继续创建其他 Skill`,
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
                const result = await engine.execute(step.skill, resolvedParams, true);
                return { key: step.outputKey ?? step.skill, result };
              });

              const parallelResults = await Promise.all(promises);
              for (const { key, result } of parallelResults) {
                results[key] = result.data;
              }
            } else {
              for (const step of steps) {
                const resolvedParams = resolveParams(step.params ?? {}, results, inputParams);
                const result = await engine.execute(step.skill, resolvedParams, true);
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

        const prompt = `你是一个 Skill 代码生成器。根据以下描述生成一个 JavaScript 函数体。

Skill 名称: ${name}
Skill 描述: ${description}${exampleText}

要求:
1. 函数接收 (params, context) 两个参数，返回 { success: boolean, data?: unknown, error?: Error }
   - params: Record<string, unknown> 用户传入的参数
   - context: { callSkill(name, params) } 可调用其他系统 Skill
2. 优先使用 context.callSkill 调用已有系统 Skill（如 db_query, user_confirm 等）来完成功能，而不是直接操作底层资源
3. 只输出函数体代码（不需要 function 关键字和大括号）
4. 可以使用 async/await
5. 代码应该简洁、安全，不能使用 eval、require、import
6. 不能访问文件系统、网络或其他外部资源
7. 用 JavaScript 语法（不是 TypeScript）

只输出纯代码，不要任何解释或 markdown 标记。`;

        try {
          const response = await provider.chat([
            { role: "user", content: prompt },
          ]);

          let code = (response.content ?? "").trim();
          // 清理可能的 markdown 标记
          if (code.startsWith("```")) {
            code = code.replace(/^```(?:javascript|js|typescript|ts)?\n?/, "").replace(/\n?```$/, "");
          }

          // 安全检查
          const forbidden = ["require(", "import ", "process.", "child_process", "__dirname", "__filename", "eval(", "Function("];
          for (const f of forbidden) {
            if (code.includes(f)) {
              return { success: false, error: new Error(`生成的代码包含禁止的操作: ${f}`) };
            }
          }

          // 测试执行（用示例或空参数）— 通过 Worker 沙箱运行
          const testParams = examples.length > 0 ? examples[0].input : {};
          const testSandboxResult = await runInSandbox(code, testParams);
          if (!testSandboxResult.success) {
            return { success: false, error: new Error(`生成的 Skill 测试失败: ${testSandboxResult.error}`) };
          }
          const testResult = testSandboxResult.data;
          if (typeof testResult !== "object" || testResult === null) {
            return { success: false, error: new Error("生成的 Skill 未返回有效结果对象") };
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

  for (const [key, value] of Object.entries(paramTemplate)) {
    if (typeof value === "string" && value.startsWith("$")) {
      if (value === "$input") {
        resolved[key] = originalInput;
      } else if (value.startsWith("$input.")) {
        const field = value.slice(7);
        resolved[key] = (originalInput as any)[field];
      } else if (value.startsWith("$steps.")) {
        const parts = value.slice(7).split(".");
        let val: any = results;
        for (const p of parts) val = val?.[p];
        resolved[key] = val;
      } else {
        resolved[key] = value;
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
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
            valid = true;
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
        skills.map((s) => engine.execute(s, params)),
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
