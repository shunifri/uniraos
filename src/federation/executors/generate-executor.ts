/**
 * GenerateActionExecutor
 *
 * Handles "generate" evolution actions.
 * Checks the skill doesn't already exist, calls the LLM to generate handler
 * code, validates it, tests in sandbox, then either submits for approval or
 * registers directly.
 */
import type { LLMProvider } from "../../llm/types.js";
import type { SkillRegistry } from "../../registry/index.js";
import type { MetricsCollector } from "../../engine/metrics.js";
import type { EvolutionController } from "../../engine/evolution-controller.js";
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

function validateCode(code: string): string | null {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      return `Forbidden pattern detected: ${pattern.toString()}`;
    }
  }
  return null;
}

export class GenerateActionExecutor implements ActionExecutor {
  readonly actionType = "generate";

  constructor(
    private readonly llm: LLMProvider,
    private readonly controller: EvolutionController,
  ) {}

  async execute(
    action: EvolutionAction,
    ctx: { registry: SkillRegistry; metrics: MetricsCollector },
  ): Promise<{ success: boolean; message: string }> {
    const { skillName, payload } = action;

    // 1. Check the skill doesn't already exist
    const existing = ctx.registry.lookup(skillName);
    if (existing) {
      return { success: false, message: `Skill "${skillName}" already exists in registry` };
    }

    // 2. Get description from payload
    const description = typeof payload.description === "string"
      ? payload.description
      : `A skill named ${skillName}`;

    const capabilities = Array.isArray(payload.capabilities)
      ? (payload.capabilities as string[])
      : [];

    // 3. Call LLM to generate handler code
    const prompt = `You are generating a new skill handler function for the RAOS skill system.

Skill name: ${skillName}
Description: ${description}
Required capabilities: ${capabilities.length > 0 ? capabilities.join(", ") : "none"}

Write a TypeScript async function body for the skill handler.
The function receives (params: Record<string, unknown>, context: ExecutionContext) and must return Promise<SkillResult>.
Return ONLY the function body code, without the function signature or any imports.
The function should implement the described functionality.`;

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
    if (!sandboxResult.success && sandboxResult.error) {
      // Allow errors where missing params/context — handler code needs those vars
      if (!sandboxResult.error.includes("params is not defined") &&
          !sandboxResult.error.includes("context is not defined") &&
          !sandboxResult.error.includes("not a function")) {
        return { success: false, message: `Sandbox test failed: ${sandboxResult.error}` };
      }
    }

    // 6a. If requires approval: submit for approval
    if (action.requiresApproval) {
      const approvalId = this.controller.submitForApproval(
        skillName,
        description,
        generatedCode,
        capabilities,
        "evolution-engine",
      );
      return {
        success: true,
        message: `Skill "${skillName}" submitted for approval (id: ${approvalId})`,
      };
    }

    // 6b. Otherwise: register directly with sandbox-wrapped generated code
    const codeForHandler = generatedCode;
    const newSkill = {
      name: skillName,
      version: "1.0.0",
      visible: true,
      autonomy: Autonomy.MANUAL,
      dependencies: [] as string[],
      timeout: 30000,
      retry: { maxRetries: 0, backoffMs: 1000, backoffMultiplier: 2 },
      description,
      capabilities,
      handler: async (params: Record<string, unknown>, _context: unknown) => {
        try {
          const result = await runInSandbox(codeForHandler, params, { timeout: 30000 });
          return { success: result.success, data: result.data };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    };

    try {
      ctx.registry.register(newSkill);
    } catch (err) {
      return { success: false, message: `Failed to register skill: ${err instanceof Error ? err.message : String(err)}` };
    }

    this.controller.recordGeneration(skillName, "evolution-engine");

    return {
      success: true,
      message: `Skill "${skillName}" generated and registered (version 1.0.0)`,
    };
  }
}
