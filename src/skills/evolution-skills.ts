/**
 * Evolution Skills
 *
 * Skills for querying and managing the Skill evolution system:
 * - evolution_genealogy: Query skill genealogy (ancestry, descendants, tree, siblings, stats)
 * - evolution_emergence_report: Get emergence detection report
 * - evolution_red_lines: Manage red line constraints
 * - evolution_check: Dry-run check if hypothetical skill generation would pass constraints
 */
import { defineSystemSkill, Autonomy } from "../types/index.js";
import type { SkillDefinition } from "../types/index.js";
import type { EvolutionController } from "../engine/evolution-controller.js";
import type { EmergenceDetector } from "../engine/emergence-detector.js";

export function createEvolutionSkills(
  controller: EvolutionController,
  detector: EmergenceDetector,
): SkillDefinition[] {
  return [
    // ===== evolution_genealogy: Query skill genealogy =====
    defineSystemSkill({
      name: "evolution_genealogy",
      description: `Query the skill genealogy tree.
Params:
  action('ancestry'|'descendants'|'tree'|'siblings'|'stats'): The genealogy query to perform
  name?(string): Skill name (required for ancestry/descendants/siblings)`,
      visible: true,
      handler: async (params) => {
        const action = params.action as string;
        const name = params.name as string | undefined;

        switch (action) {
          case "ancestry": {
            if (!name) {
              return { success: false, error: new Error("name is required for ancestry query") };
            }
            const chain = controller.getAncestry(name);
            return {
              success: true,
              data: { skillName: name, ancestry: chain, depth: chain.length - 1 },
            };
          }

          case "descendants": {
            if (!name) {
              return { success: false, error: new Error("name is required for descendants query") };
            }
            const descendants = controller.getDescendants(name);
            return {
              success: true,
              data: { skillName: name, descendants, count: descendants.length },
            };
          }

          case "tree": {
            const tree = controller.getGenealogyTree();
            return { success: true, data: { tree } };
          }

          case "siblings": {
            if (!name) {
              return { success: false, error: new Error("name is required for siblings query") };
            }
            const siblings = controller.getSiblings(name);
            return {
              success: true,
              data: { skillName: name, siblings, count: siblings.length },
            };
          }

          case "stats": {
            const stats = controller.getGenealogyStats();
            return { success: true, data: stats };
          }

          default:
            return {
              success: false,
              error: new Error(`Unknown action: ${action}. Use: ancestry, descendants, tree, siblings, stats`),
            };
        }
      },
    }),

    // ===== evolution_emergence_report: Get emergence detection report =====
    defineSystemSkill({
      name: "evolution_emergence_report",
      description: `Get emergence detection report showing detected patterns.
Params:
  since?(number): Only show patterns detected after this timestamp (ms)
  severity?('info'|'warning'|'critical'): Filter by severity level
  type?(string): Filter by pattern type (unexpected_chain, self_reference_loop, capability_escalation, resource_spike)`,
      visible: true,
      handler: async (params) => {
        const since = params.since as number | undefined;
        const severity = params.severity as string | undefined;
        const type = params.type as string | undefined;

        if (since != null || severity != null || type != null) {
          const patterns = detector.getPatterns({ since, severity, type });
          return {
            success: true,
            data: {
              patterns,
              count: patterns.length,
              filters: { since, severity, type },
            },
          };
        }

        // Full report
        const report = detector.getReport();
        return { success: true, data: report };
      },
    }),

    // ===== evolution_red_lines: Manage red line constraints =====
    defineSystemSkill({
      name: "evolution_red_lines",
      description: `Manage red line constraints for skill generation safety.
Params:
  action('list'|'add'|'remove'): Operation to perform
  id?(string): Constraint ID (required for add/remove)
  description?(string): Constraint description (required for add)
  blocking?(boolean): Whether violation blocks generation (default true, for add)`,
      visible: true,
      handler: async (params) => {
        const action = params.action as string;
        const id = params.id as string | undefined;

        switch (action) {
          case "list": {
            const redLines = controller.getRedLines();
            const violations = controller.getViolations();
            return {
              success: true,
              data: {
                redLines: redLines.map((rl) => ({
                  id: rl.id,
                  description: rl.description,
                  blocking: rl.blocking,
                })),
                count: redLines.length,
                totalViolations: violations.length,
              },
            };
          }

          case "add": {
            if (!id) {
              return { success: false, error: new Error("id is required for add action") };
            }
            const description = params.description as string;
            if (!description) {
              return { success: false, error: new Error("description is required for add action") };
            }
            const blocking = (params.blocking as boolean) ?? true;

            // Create a simple pattern-based red line from description
            // The description itself serves as documentation; the check is a no-op placeholder
            // since custom logic requires code. This registers a descriptive constraint
            // that always passes (users should use the programmatic API for real checks).
            controller.addRedLine({
              id,
              description,
              blocking,
              check: () => null, // Placeholder - custom logic must be added programmatically
            });

            return {
              success: true,
              data: {
                id,
                description,
                blocking,
                message: `Red line "${id}" added. Note: custom check logic must be added programmatically.`,
              },
            };
          }

          case "remove": {
            if (!id) {
              return { success: false, error: new Error("id is required for remove action") };
            }
            const removed = controller.removeRedLine(id);
            if (!removed) {
              return { success: false, error: new Error(`Red line not found: ${id}`) };
            }
            return {
              success: true,
              data: { id, message: `Red line "${id}" removed` },
            };
          }

          default:
            return {
              success: false,
              error: new Error(`Unknown action: ${action}. Use: list, add, remove`),
            };
        }
      },
    }),

    // ===== evolution_check: Dry-run check if skill generation would pass constraints =====
    defineSystemSkill({
      name: "evolution_check",
      description: `Dry-run check if a hypothetical skill generation would pass all constraints.
Params:
  name(string): Proposed skill name
  generatedBy(string): Name of the parent skill that would generate it
  capabilities?(string[]): Capabilities the new skill would request`,
      visible: true,
      handler: async (params) => {
        const name = params.name as string;
        const generatedBy = params.generatedBy as string;
        const capabilities = (params.capabilities as string[]) ?? [];

        if (!name) {
          return { success: false, error: new Error("name is required") };
        }
        if (!generatedBy) {
          return { success: false, error: new Error("generatedBy is required") };
        }

        // Check canGenerate (which includes red line checks)
        const result = controller.canGenerate(name, generatedBy, capabilities);

        // Also get the specific red line violations for more detail
        const depth = controller.getDepth(generatedBy) + 1;
        const violations = controller.getViolations({ since: Date.now() - 1000 });
        const relevantViolations = violations.filter((v) => v.skillName === name);

        return {
          success: true,
          data: {
            skillName: name,
            generatedBy,
            capabilities,
            computedDepth: depth,
            allowed: result.allowed,
            reason: result.reason ?? null,
            violations: relevantViolations.map((v) => ({
              constraintId: v.constraintId,
              description: v.description,
              blocking: v.blocking,
            })),
          },
        };
      },
    }),
  ];
}
