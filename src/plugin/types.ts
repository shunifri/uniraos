/**
 * 插件系统类型定义
 */
import type { Autonomy, RetryPolicy } from "../types/index.js";

/** Skill 包清单文件 (skill.json) */
export interface SkillManifest {
  /** Skill 名称 */
  name: string;
  /** 版本号 (semver) */
  version: string;
  /** 描述 */
  description?: string;
  /** 入口文件（相对于 skill.json 所在目录） */
  entry: string;
  /** 可见性（默认 true） */
  visible?: boolean;
  /** 自律级别 */
  autonomy?: Autonomy;
  /** 依赖的其他 Skill */
  dependencies?: string[];
  /** 超时时间（ms） */
  timeout?: number;
  /** 重试策略 */
  retry?: Partial<RetryPolicy>;
  /** 作者 */
  author?: string;
  /** 标签 */
  tags?: string[];
}

/** 插件加载器配置 */
export interface PluginLoaderConfig {
  /** Skill 插件目录 */
  skillsDir: string;
  /** 是否启用热加载（文件变更自动重载） */
  hotReload?: boolean;
  /** 加载出错时是否继续加载其他插件 */
  continueOnError?: boolean;
}

/** 已加载的插件信息 */
export interface LoadedPlugin {
  /** Skill 名称 */
  name: string;
  /** 版本 */
  version: string;
  /** 清单文件路径 */
  manifestPath: string;
  /** 入口文件路径 */
  entryPath: string;
  /** 加载时间 */
  loadedAt: number;
  /** 来源目录 */
  dir: string;
}

/** 插件加载事件 */
export type PluginEvent =
  | { type: "loaded"; plugin: LoadedPlugin }
  | { type: "unloaded"; name: string }
  | { type: "reloaded"; plugin: LoadedPlugin }
  | { type: "error"; name: string; error: Error };

export type PluginEventHandler = (event: PluginEvent) => void;
