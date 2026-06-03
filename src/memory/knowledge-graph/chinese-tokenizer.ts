/**
 * 中文分词器 — KG v2 中文 query 召回能力
 *
 * 优先用 nodejieba（精度高，cppjieba 移植版），加载失败则降级到启发式切分。
 *
 * 为什么用 nodejieba 而不是 jieba-js：
 * - nodejieba: 精度等同 cppjieba（金标准），性能优（C++ 绑定）
 * - jieba-js: 纯 JS 实现，部署简单但精度稍逊、性能差
 *
 * Node 22 + Linux/macOS 预编译 binary 都有；如果环境没匹配，
 * 启动时会用启发式 fallback（虽然精度下降，但服务不挂）。
 */
import { log } from "../../utils/logger.js";

/** nodejieba 句柄，懒加载 */
let jieba: typeof import("nodejieba") | null = null;
let loadAttempted = false;
let loadFailed = false;

/** 加载 nodejieba。失败返回 false，降级到启发式。 */
function tryLoadJieba(): boolean {
  if (loadAttempted) return jieba !== null;
  loadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jieba = require("nodejieba");
    // 默认词典 + 自定义词典（可扩展）
    // jieba.load() 在 require 时已经自动加载，不需要显式调用
    log("info", "chinese_tokenizer_loaded", { backend: "nodejieba" });
    return true;
  } catch (err) {
    loadFailed = true;
    log("warn", "chinese_tokenizer_load_failed", {
      error: (err as Error).message,
      fallback: "heuristic",
    });
    return false;
  }
}

/**
 * 用 nodejieba 切分中文文本。
 * 混合输入：先识别中文部分用 jieba 切分，英文/数字部分保留原 token。
 */
export function chineseTokenize(text: string): string[] {
  if (!tryLoadJieba() || !jieba) {
    return heuristicChineseTokenize(text);
  }

  // 1) 把中英文数字切成"段"——中文段用 jieba，英文段保留原样
  const segments = text.split(/([a-zA-Z][a-zA-Z0-9_]*|\d+|[^\sa-zA-Z\d]+)/);
  const tokens: string[] = [];
  for (const seg of segments) {
    if (!seg) continue;
    // 纯英文/数字：保留原 token
    if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(seg) || /^\d+$/.test(seg)) {
      if (seg.length >= 1) tokens.push(seg);
      continue;
    }
    // 含中文：用 jieba 切
    if (/[\u4e00-\u9fff]/.test(seg)) {
      const cut = jieba.cut(seg, true); // HMM=true，比 cut 多了 HMM 识别新词
      for (const t of cut) {
        if (t && t !== " " && t.trim().length > 0) tokens.push(t);
      }
    } else {
      // 纯符号/空白：跳过
    }
  }
  // 兜底：把英文/数字部分转小写（中文不受影响，与启发式行为保持一致）
  return tokens.map((t) => (/[a-zA-Z]/.test(t) ? t.toLowerCase() : t));
}

/** 启发式 fallback：和修 2 那版一致（按标点/虚词切分） */
export function heuristicChineseTokenize(query: string): string[] {
  const lower = query.toLowerCase();
  const SEPARATOR_REGEX = /[\s,，.。!！?？;；:：、·\-—_/\\()()【】\[\]「」""''《》<>]+|和|与|跟|同|以及|在|上|下|的|是|了|有|什么|怎么|哪|里|中|为|对|以|于|把|被|给|从|到/g;
  const segments = lower.split(SEPARATOR_REGEX).filter(Boolean);
  const tokens: string[] = [];
  for (const seg of segments) {
    const m = seg.match(/[\u4e00-\u9fff]+|[a-z][a-z0-9_]+|\d+/g);
    if (!m) continue;
    for (const t of m) {
      if (t.length >= 2) tokens.push(t);
    }
  }
  return tokens;
}

/** 当前是否使用 nodejieba（用于诊断 / 健康检查） */
export function isJiebaActive(): boolean {
  return tryLoadJieba() && jieba !== null;
}

/** 强制重新加载（测试用） */
export function _resetJiebaForTest(): void {
  jieba = null;
  loadAttempted = false;
  loadFailed = false;
}
