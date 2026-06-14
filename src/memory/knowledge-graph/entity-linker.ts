/**
 * 实体链接器 (Entity Linker) — KG v2 阶段 2
 *
 * 职责：把 LLM 抽取出的"表面形式"（surface form）映射到图谱里的 canonical 节点。
 * 详见 docs/KG_ARCHITECTURE_VISION.md §3.2。
 *
 * 阶段 2 实现：
 * - 基础规则：归一化字符串（小写、去标点、空格/下划线合并）作为 canonical key
 * - 跨语言轻量映射：内置常见中英文对照（如 "苹果" ↔ "apple"）
 * - 阶段 3 演进：LLM 兜底（处理模糊别名）、embedding 相似度匹配
 */

const SURFACE_NORMALIZE_REGEX = /[_\-\s·]+/g;
const STRIP_PUNCT_REGEX = /[^\p{L}\p{N}_]/gu;
const ZW_SPACES = /[\u3000\s]+/g;

/**
 * 把任意 surface form 归一化为 canonical key。
 * 阶段 2 的规则：去标点、小写、中文保留。
 */
export function normalizeSurfaceForm(input: string): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  // 把多种空白/分隔符统一为下划线
  s = s.replace(SURFACE_NORMALIZE_REGEX, "_");
  // 去标点
  s = s.replace(STRIP_PUNCT_REGEX, "");
  // 去掉首尾下划线
  s = s.replace(/^_+|_+$/g, "");
  return s;
}

/**
 * 内置的跨语言/同义词映射（阶段 2 轻量版）。
 * 命中任一 alias → 返回 canonical key（英文/首选形式）。
 * 阶段 3 演进：可注入 LLM/embedding 替代。
 *
 * 注意：所有 key 在模块加载时会通过 normalizeSurfaceForm 归一化，
 * 这样既支持 "apple inc"（空格）又支持 "Apple Inc."（带点）等变体。
 */
const RAW_ALIAS_MAP: Record<string, string> = {
  // 公司
  "苹果公司": "apple_inc",
  "apple inc": "apple_inc",
  "apple": "apple_inc",
  "苹果": "apple_inc",
  "微软": "microsoft",
  "microsoft": "microsoft",
  "ms": "microsoft",
  "谷歌": "google",
  "google": "google",
  "alphabet": "google",
  // 人物
  "蒂姆库克": "tim_cook",
  "tim cook": "tim_cook",
  "库克": "tim_cook",
  "乔布斯": "steve_jobs",
  "jobs": "steve_jobs",
  "steve jobs": "steve_jobs",
  // 概念
  "人工智能": "ai",
  "ai": "ai",
  "artificial intelligence": "ai",
  "机器学习": "machine_learning",
  "ml": "machine_learning",
  "machine learning": "machine_learning",
  "深度学习": "deep_learning",
  "dl": "deep_learning",
  "deep learning": "deep_learning",
  "神经网络": "neural_network",
  "nn": "neural_network",
  "neural network": "neural_network",
};

/** 模块加载时把 key 归一化，避免空格/下划线不一致 */
const ALIAS_MAP: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(RAW_ALIAS_MAP)) {
    out[normalizeSurfaceForm(k)] = v;
  }
  return out;
})();

/**
 * 把 surface form 转成 canonical form。
 * 阶段 2 优先级：
 *   1. 内置 alias 命中（key 已归一化；为兼容"蒂姆库克"和"蒂姆_库克"两种 key，
 *      会同时尝试下划线版和无下划线版）
 *   2. 否则 normalize 后的字符串本身
 */
export function surfaceToCanonical(input: string): string {
  const normalized = normalizeSurfaceForm(input);
  if (!normalized) return input.trim();
  // 直接命中
  if (ALIAS_MAP[normalized]) return ALIAS_MAP[normalized];
  // fallback：去下划线后再试一次（兼容旧的 alias key 没带下划线的情况）
  const deUnderscored = normalized.replace(/_/g, "");
  if (ALIAS_MAP[deUnderscored]) return ALIAS_MAP[deUnderscored];
  return normalized;
}

/**
 * 判断两个 surface form 是否指向同一 canonical entity。
 * 阶段 2 用法：在 LLM 抽取中，"Apple" 和 "apple" 应当合并。
 */
export function isSameEntity(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return surfaceToCanonical(a) === surfaceToCanonical(b);
}

/**
 * 可注入的链接策略接口。
 * 阶段 3 可以注入基于 LLM/embedding 的链接器。
 */
export interface EntityLinker {
  toCanonical(surface: string): string;
  isSame(a: string, b: string): boolean;
}

/** 默认实现：基于内置 alias + 字符串归一化。 */
export const defaultEntityLinker: EntityLinker = {
  toCanonical: surfaceToCanonical,
  isSame: isSameEntity,
};
