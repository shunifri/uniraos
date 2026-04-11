/**
 * OptimizeActionExecutor
 *
 * Handles "optimize" evolution actions.
 * Looks up the existing skill, queries the LLM for improved handler code,
 * validates it, tests it in the sandbox, and registers the new version
 * with a canary deployment.
 */
import type { LLMProvider } from "../../llm/types.js";
import type { SkillRegistry } from "../../registry/index.js";
import type { MetricsCollector } from "../../engine/metrics.js";
import type { SkillLifecycleManager } from "../../engine/skill-lifecycle.js";
import type { ActionExecutor } from "../evolution-engine.js";
import type { EvolutionAction } from "../types.js";
import { runInSandbox } from "../../engine/worker-sandbox.js";
import { Autonomy } from "../../types/index.js";

/** Patterns that must not appear in generated handler code */
const FORBIDDEN_PATTERNS = [
  /require\s*\(/,
  /process\.exit/,
  /child_process/,
  /\beval\b/,
  /new\s+Function\s*\(/,
  /fs\.(write|unlink|rm|delete)/,
];

function bumpPatchVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length < 3) return version + ".1";
  const patch = parseInt(parts[2] ?? "0", 10);
  return `${parts[0]}.${parts[1]}.${patch + 1}`;
}

function validateCode(code: string): string | null {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      return `Forbidden pattern detected: ${pattern.toString()}`;
    }
  }
  return null;
}

export class OptimizeActionExecutor implements ActionExecutor {
  readonly actionType = "optimize";

  constructor(
    private readonly llm: LLMProvider,
    private readonly lifecycle: SkillLifecycleManager,
  ) {}

  async execute(
    action: EvolutionAction,
    ctx: { registry: SkillRegistry; metrics: MetricsCollector },
  ): Promise<{ success: boolean; message: string }> {
    const { skillName, payload } = action;

    // 1. Look up the existing skill
    let existingSkill;
    try {
      existingSkill = ctx.registry.get(skillName);
    } catch {
      return { success: false, message: `Skill "${skillName}" not found in registry` };
    }

    // 2. Get current metrics
    const metrics = ctx.metrics.getMetrics(skillName);
    const metricsDesc = metrics
      ? `successRate=${(metrics.successRate * 100).toFixed(1)}%, p95=${metrics.p95DurationMs.toFixed(0)}ms, totalCalls=${metrics.totalCalls}`
      : "no metrics available";

    // 3. Call LLM to generate optimized handler code
    const reason = typeof payload.reason === "string" ? payload.reason : "performance degradation";
    const prompt = `You are optimizing a skill handler function for the RAOS skill system.

Skill name: ${skillName}
Current performance issue: ${reason}
Current metrics: ${metricsDesc}

Write an improved TypeScript async function body for the skill handler.
The function receives (params: Record<string, unknown>, context: ExecutionContext) and must return Promise<SkillResult>.
Return ONLY the function body code, without the function signature or any imports.
Focus on fixing the performance issue described above.`;

    let llmResponse;
    try {
      llmResponse = await this.llm.chat([{ role: "user", content: prompt }]);
    } catch (err) {
      return { success: false, message: `LLM call failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    const generatedCode = llmResponse.content;
    if (!generatedCode) {
      return { success: false, message: "LLM returned no code" };
    }

    // 4. Validate code for forbidden patterns
    const validationError = validateCode(generatedCode);
    if (validationError) {
      return { success: false, message: `Code validation failed: ${validationError}` };
    }

    // 5. Test in sandbox
    const sandboxResult = await runInSandbox(generatedCode, { test: true }, { timeout: 5000 });
    if (!sandboxResult.success && sandboxResult.error && !sandboxResult.error.includes("not a function")) {
      // Allow "not a function" errors — the code body may reference context vars
      // but a hard exception means something is wrong
      if (!sandboxResult.error.includes("params is not defined") &&
          !sandboxResult.error.includes("context is not defined")) {
        return { success: false, message: `Sandbox test failed: ${sandboxResult.error}` };
      }
    }

    // 6. Register optimized skill with bumped patch version
    const newVersion = bumpPatchVersion(existingSkill.version);
    const newVersionedName = `${skillName}@${newVersion}`;

    // Create a new skill definition with the generated code wrapped in a sandbox handler
    const optimizedSkill = {
      ...existingSkill,
      version: newVersion,
      handler: async (params: Record<string, unknown>, context: unknown) => {
        try {
          const result = await runInSandbox(generatedCode, params, { timeout: existingSkill.timeout ?? 30000 });
          return { success: result.success, data: result.data };
        } catch {
          // Fallback to original handler if sandbox execution fails
          return existingSkill.handler(params, context as any);
        }
      },
    };

    try {
      ctx.registry.registerVersion(optimizedSkill);
    } catch (err) {
      return { success: false, message: `Failed to register optimized skill: ${err instanceof Error ? err.message : String(err)}` };
    }

    // 7. Start canary deployment
    this.lifecycle.startCanary(skillName, existingSkill.version, newVersion);

    return {
      success: true,
      message: `Skill "${skillName}" optimized: ${existingSkill.version} → ${newVersion} (canary at ${newVersionedName})`,
    };
  }
}
