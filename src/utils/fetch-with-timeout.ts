/**
 * SSRF 防护：校验 URL 不指向私有/内网地址
 */
export function validateUrlForSsrf(urlStr: string): void {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`);
  }

  // 只允许 http/https
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`URL protocol not allowed: ${url.protocol}`);
  }

  const hostname = url.hostname;

  // 禁止 localhost
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    throw new Error(`URL points to localhost: ${urlStr}`);
  }

  // 禁止私有 IP 段
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^127\./,
    /^0\./,
    /^fc00:/i,
    /^fe80:/i,
  ];
  for (const range of privateRanges) {
    if (range.test(hostname)) {
      throw new Error(`URL points to private IP: ${urlStr}`);
    }
  }
}

/**
 * Fetch with timeout and optional retry
 * Replaces naked `fetch()` calls that can hang forever.
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  /** 跳过 SSRF 校验（仅当调用方已自行校验 URL 时使用） */
  skipSsrfCheck?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export async function fetchWithTimeout(
  url: string | URL,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const urlStr = typeof url === "string" ? url : url.href;
  if (!options.skipSsrfCheck) {
    validateUrlForSsrf(urlStr);
  }

  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok && retries > 0) {
      await delay(retryDelayMs);
      return fetchWithTimeout(url, { ...options, retries: retries - 1 });
    }

    return response;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
    }

    if (retries > 0) {
      await delay(retryDelayMs);
      return fetchWithTimeout(url, { ...options, retries: retries - 1 });
    }

    throw err;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * JSON fetch with timeout — automatically parses JSON response.
 */
export async function fetchJsonWithTimeout<T>(
  url: string | URL,
  options: FetchWithTimeoutOptions = {}
): Promise<T> {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}
