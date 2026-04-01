/**
 * 联邦/迁移/进化 — Skill 注册
 *
 * 将三大能力（迁移、联邦、进化）暴露为标准 Skill，
 * 使 Agent 可以自主调用这些能力。
 */
import { defineSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";
import type { SkillMigrationManager } from "./skill-migration.js";
import type { FederationManager } from "./federation-manager.js";
import type { EvolutionEngine } from "./evolution-engine.js";

export function createFederationSkills(
  registry: SkillRegistry,
  migration: SkillMigrationManager,
  federation: FederationManager,
  evolution: EvolutionEngine,
): void {
  // ===== 迁移 Skills =====

  registry.register(
    defineSkill({
      name: "skill_migrate_pull",
      description:
        "从远程 RAOS 实例拉取 Skill 到本地。参数: endpoint(string, 远程实例地址), skillName(string, 要拉取的 Skill 名称)",
      timeout: 30000,
      handler: async (params) => {
        const endpoint = params.endpoint as string;
        const skillName = params.skillName as string;
        if (!endpoint || !skillName) {
          return { success: false, error: new Error("endpoint 和 skillName 参数必填") };
        }
        try {
          const result = await migration.pullSkill(endpoint, skillName);
          return { success: result.success, data: result, error: result.success ? undefined : new Error(result.reason) };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "skill_migrate_push",
      description:
        "将本地 Skill 推送到远程 RAOS 实例。参数: endpoint(string, 远程实例地址), skillName(string, 要推送的 Skill 名称)",
      timeout: 30000,
      handler: async (params) => {
        const endpoint = params.endpoint as string;
        const skillName = params.skillName as string;
        if (!endpoint || !skillName) {
          return { success: false, error: new Error("endpoint 和 skillName 参数必填") };
        }
        try {
          const result = await migration.pushSkill(endpoint, skillName);
          return { success: result.success, data: result, error: result.success ? undefined : new Error(result.reason) };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "skill_migrate_export",
      description: "将本地 Skill 导出为迁移包（JSON）。参数: skillName(string)",
      handler: async (params) => {
        const skillName = params.skillName as string;
        if (!skillName) return { success: false, error: new Error("skillName 参数必填") };
        const pkg = migration.exportSkill(skillName);
        if (!pkg) return { success: false, error: new Error(`Skill 不存在: ${skillName}`) };
        return { success: true, data: pkg };
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "skill_migrate_import",
      description: "从迁移包导入 Skill。参数: package(object, MigrationPackage JSON)",
      handler: async (params) => {
        const pkg = params.package as any;
        if (!pkg) return { success: false, error: new Error("package 参数必填") };
        try {
          const result = migration.importSkill(pkg);
          return { success: result.success, data: result, error: result.success ? undefined : new Error(result.reason) };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "skill_migrate_list_remote",
      description: "列出远程 RAOS 实例的 Skills。参数: endpoint(string)",
      timeout: 15000,
      handler: async (params) => {
        const endpoint = params.endpoint as string;
        if (!endpoint) return { success: false, error: new Error("endpoint 参数必填") };
        try {
          const skills = await migration.listRemoteSkills(endpoint);
          return { success: true, data: { skills, count: skills.length } };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "skill_migrate_history",
      description: "查看 Skill 迁移历史记录",
      handler: async () => {
        const history = migration.getHistory();
        return { success: true, data: { history, total: history.length } };
      },
    }),
  );

  // ===== 联邦 Skills =====

  registry.register(
    defineSkill({
      name: "federation_sync",
      description: "手动触发联邦指标同步并获取推荐。返回跨实例 Skill 推荐列表",
      timeout: 30000,
      handler: async () => {
        try {
          const recommendations = await federation.syncAndRecommend();
          return {
            success: true,
            data: {
              recommendations,
              count: recommendations.length,
              message: recommendations.length > 0
                ? `发现 ${recommendations.length} 个推荐，可使用 federation_accept 采纳`
                : "暂无推荐",
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "federation_recommendations",
      description: "查看当前联邦推荐列表",
      handler: async () => {
        const recommendations = federation.getRecommendations();
        return { success: true, data: { recommendations, count: recommendations.length } };
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "federation_accept",
      description: "采纳联邦推荐（拉取远程高质量 Skill）。参数: skillName(string, 推荐的 Skill 名称)",
      timeout: 30000,
      handler: async (params) => {
        const skillName = params.skillName as string;
        if (!skillName) return { success: false, error: new Error("skillName 参数必填") };
        try {
          const result = await federation.acceptRecommendation(skillName);
          return { success: result.success, data: result, error: result.success ? undefined : new Error(result.reason) };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "federation_status",
      description: "查看联邦网络状态（对等实例、指标快照）",
      handler: async () => {
        const profile = federation.getLocalProfile();
        const remoteSnapshots = federation.getRemoteSnapshots();
        return {
          success: true,
          data: {
            local: profile,
            peers: [...remoteSnapshots.keys()],
            peerCount: remoteSnapshots.size,
            recommendations: federation.getRecommendations().length,
          },
        };
      },
    }),
  );

  // ===== 进化 Skills =====

  registry.register(
    defineSkill({
      name: "evolution_run",
      description: "手动触发一次进化循环（分析系统瓶颈并生成优化建议）",
      timeout: 60000,
      handler: async () => {
        try {
          const result = await evolution.runCycle();
          return {
            success: true,
            data: {
              totalActions: result.actions.length,
              executedCount: result.executed.length,
              actions: result.actions.slice(0, 20), // 限制返回数量
              executed: result.executed,
              message: result.actions.length > 0
                ? `发现 ${result.actions.length} 个优化建议，执行了 ${result.executed.length} 个`
                : "系统运行正常，暂无优化建议",
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "evolution_pending",
      description: "查看待处理的进化动作列表",
      handler: async () => {
        const actions = evolution.getPendingActions();
        return { success: true, data: { actions, count: actions.length } };
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "evolution_execute",
      description: "手动执行一个进化动作。参数: skillName(string), actionType(string, optimize|retire|adopt|generate|canary|rollback)",
      timeout: 30000,
      handler: async (params) => {
        const skillName = params.skillName as string;
        const actionType = params.actionType as string;
        if (!skillName || !actionType) {
          return { success: false, error: new Error("skillName 和 actionType 参数必填") };
        }

        const action = evolution.getPendingActions().find(
          (a) => a.skillName === skillName && a.type === actionType,
        );
        if (!action) {
          return { success: false, error: new Error(`未找到匹配的进化动作: ${actionType}:${skillName}`) };
        }

        try {
          const result = await evolution.executeAction(action);
          return { success: result.success, data: result, error: result.success ? undefined : new Error(result.message) };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "evolution_history",
      description: "查看进化执行历史",
      handler: async () => {
        const history = evolution.getExecutedActions();
        return { success: true, data: { history: history.slice(-50), total: history.length } };
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "evolution_status",
      description: "查看进化引擎状态（运行状态、策略列表、配置等）",
      handler: async () => {
        return { success: true, data: evolution.getStatus() };
      },
    }),
  );

  registry.register(
    defineSkill({
      name: "evolution_config",
      description:
        "更新进化引擎配置。参数: autoExecute?(boolean), cycleIntervalMs?(number), maxActionsPerCycle?(number), skipApprovalRequired?(boolean)",
      handler: async (params) => {
        const update: Record<string, unknown> = {};
        if (params.autoExecute !== undefined) update.autoExecute = params.autoExecute;
        if (params.cycleIntervalMs !== undefined) update.cycleIntervalMs = params.cycleIntervalMs;
        if (params.maxActionsPerCycle !== undefined) update.maxActionsPerCycle = params.maxActionsPerCycle;
        if (params.skipApprovalRequired !== undefined) update.skipApprovalRequired = params.skipApprovalRequired;

        evolution.updateConfig(update as any);
        return { success: true, data: evolution.getStatus() };
      },
    }),
  );

  console.log(
    "   Federation skills registered (skill_migrate_*/federation_*/evolution_*)",
  );
}
