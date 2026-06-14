/**
 * LTM 后端抽象接口
 * 所有长期记忆后端（文件、Supermemory 等）都实现此接口
 * 
 * @deprecated 类型已迁移至 ./ltm-types.ts，请从该模块导入
 */
export type {
  LTMEntry,
  LTMConfig,
  ArchiveManifest,
  LTMStoreOptions,
  LTMSearchOptions,
  LTMListOptions,
  LTMStats,
  LTMArchiveResult,
  LTMBackend,
} from "./ltm-types.js";
