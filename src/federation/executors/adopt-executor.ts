import type { ActionExecutor } from "../types.js";
import type { EvolutionAction } from "../types.js";
import type { SkillRegistry } from "../../registry/index.js";
import type { MetricsCollector } from "../../engine/metrics.js";

export class AdoptActionExecutor implements ActionExecutor {
  readonly actionType = "adopt";

  async execute(
    action: EvolutionAction,
    ctx: { registry: SkillRegistry; metrics: MetricsCollector },
  ): Promise<{ success: boolean; message: string }> {
    // Check if skill already exists
    if (ctx.registry.lookup(action.skillName)) {
      return { success: false, message: `Skill "${action.skillName}" already exists locally` };
    }

    // The payload should contain the recommendation with source instance info
    const recommendation = action.payload.recommendation as any;
    if (!recommendation?.sourceInstance) {
      return { success: false, message: "No source instance in recommendation" };
    }

    // For now, log the adoption intent (actual HTTP fetch from peer is a network operation)
    // In production, this would call the federation transport to fetch the skill package
    return {
      success: true,
      message: `Adoption of "${action.skillName}" from ${recommendation.sourceInstance} queued (requires federation transport)`,
    };
  }
}
