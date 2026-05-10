/**
 * 联邦/迁移/进化 — 公共导出
 */

// 类型
export type {
  MigrationPackage,
  MigrationResult,
  InstanceProfile,
  FederatedMetricsSnapshot,
  SkillRecommendation,
  EvolutionStrategy,
  EvolutionContext,
  EvolutionAction,
  FederationTransport,
  FederationEventType,
  FederationEvent,
  FederationEventHandler,
} from "./types.js";

// 传输层
export { HttpFederationTransport } from "./http-transport.js";

// 迁移
export { SkillMigrationManager } from "./skill-migration.js";

// 联邦
export { FederationManager, DefaultRecommendationStrategy } from "./federation-manager.js";
export type { RecommendationStrategy } from "./federation-manager.js";

// 进化引擎
export {
  EvolutionEngine,
  BottleneckDetectionStrategy,
  InactiveRetirementStrategy,
  FederatedAdoptionStrategy,
  RetireActionExecutor,
} from "./evolution-engine.js";
export type { EvolutionEngineConfig } from "./evolution-engine.js";
export type { ActionExecutor } from "./types.js";

// Skills
export { createFederationSkills } from "./federation-skills.js";
