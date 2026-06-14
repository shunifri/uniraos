export { EnhancedLTMBackend, type EnhancedLTMConfig } from "./enhanced-ltm-backend.js";

// 模块导出
export { VersionChain, type EnhancedLTMEntry, type VersionFields, type VersionContext } from "./version-chain.js";
export { ForgettingManager } from "./forgetting-manager.js";
export { SearchEnhancer, type MetadataFilter, type FilterExpression } from "./search-enhancer.js";
export { ProfileGenerator, type UserProfile } from "./profile-generator.js";
export { FactExtractor, type ExtractedFact, type ExtractAndStoreResult } from "./fact-extractor.js";
export { ConflictDetector, type ConflictInfo } from "./conflict-detector.js";
export { DataMigrator, type MigrateResult } from "./data-migrator.js";
