/**
 * Resolve a full endpoint URL from a user-provided baseUrl.
 *
 * baseUrl 可能是两种:
 *   1. 基础 URL: "https://ark.cn-beijing.volces.com/api/v3" → 需要拼 endpointPath
 *   2. 完整 endpoint: "https://api.openai.com/v1/chat/completions" → 已含 endpointPath, 不重复拼
 *
 * 这是给"测试连接"端点用的, 不能假设 baseUrl 一定是哪种, 智能识别.
 *
 * @param baseUrl 用户配置里的 base URL (可能 undefined / 空字符串 / 完整 endpoint)
 * @param endpointPath 要追加的 path, 必须以 "/" 开头 (例: "/chat/completions")
 * @param defaultBase 兜底: 用户没配 baseUrl 时使用 (例: "https://api.openai.com/v1")
 * @returns 完整的 endpoint URL, 末尾不带 "/"
 */
export function resolveEndpoint(
  baseUrl: string | undefined,
  endpointPath: string,
  defaultBase: string,
): string {
  const base = (baseUrl && baseUrl.trim()) || defaultBase;
  const cleanBase = base.replace(/\/+$/, "");
  if (cleanBase.endsWith(endpointPath)) return cleanBase;
  return `${cleanBase}${endpointPath}`;
}
