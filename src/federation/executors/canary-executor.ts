/**
 * CanaryActionExecutor
 *
 * Handles "canary" evolution actions.
 * Evaluates the canary status for the skill and takes the appropriate
 * action: promote, rollback, continue, or error if not in canary.
 */
import type { SkillLifecycleManager } from "../../engine/skill-lifecycle.js";
import type { SkillRegistry } from "../../registry/index.js";
import type { MetricsCollector } from "../../engine/metrics.js";
import type { ActionExecutor } from "../evolution-engine.js";
import type { EvolutionAction } from "../types.js";

export class CanaryActionExecutor implements ActionExecutor {
  readonly actionType = "canary";

  constructor(private readonly lifecycle: SkillLifecycleManager) {}

  async execute(
    action: EvolutionAction,
    _ctx: { registry: SkillRegistry; metrics: MetricsCollector },
  ): Promise<{ success: boolean; message: string }> {
    const { skillName } = action;

    const evaluation = this.lifecycle.evaluateCanary(skillName);

    switch (evaluation) {
      case "promote":
        this.lifecycle.promoteCanary(skillName);
        return {
          success: true,
          message: `Skill "${skillName}" canary promoted to full traffic`,
        };

      case "rollback":
        this.lifecycle.rollbackCanary(skillName);
        return {
          success: true,
          message: `Skill "${skillName}" canary rolled back to previous version`,
        };

      case "continue":
        return {
          success: true,
          message: `Skill "${skillName}" canary continuing — insufficient data for decision`,
        };

      case "not_canary":
        return {
          success: false,
          message: `Skill "${skillName}" is not in canary state`,
        };

      default: {
        const _exhaustive: never = evaluation;
        return {
          success: false,
          message: `Unknown canary evaluation result for skill "${skillName}"`,
        };
      }
    }
  }
}
