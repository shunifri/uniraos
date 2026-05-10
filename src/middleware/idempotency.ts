/**
 * P2 修复：幂等性中间件
 * 防止重复提交/重复处理同一请求
 * - 客户端通过 X-Idempotency-Key 头提供幂等键
 * - 服务端缓存处理结果（TTL 24h）
 * - 重复请求直接返回缓存结果
 */

import type { Request, Response, NextFunction } from "express";
import { getRedisClient } from "../cache/redis-client.js";
import { log } from "../utils/logger.js";

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24h
const MAX_BODY_SIZE = 10 * 1024; // 10KB 以内才缓存

interface CachedResult {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  createdAt: number;
}

export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = req.headers["x-idempotency-key"] as string | undefined;
  if (!key || req.method === "GET" || req.method === "HEAD") {
    next();
    return;
  }

  // 幂等键长度限制 + 格式校验（UUID 或安全随机字符串）
  if (key.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(key)) {
    res.status(400).json({ success: false, error: "Invalid idempotency key format" });
    return;
  }

  const redis = getRedisClient();
  const cacheKey = `idempotency:${key}`;

  try {
    const cached = await redis.get<CachedResult>(cacheKey);
    if (cached) {
      log("info", "idempotency_cache_hit", { key: key.slice(0, 20), path: req.path });
      for (const [h, v] of Object.entries(cached.headers)) {
        res.setHeader(h, v);
      }
      res.status(cached.statusCode).json(cached.body);
      return;
    }
  } catch {
    // Redis 故障时不阻断主流程
  }

  // 拦截 res.json() / res.send() 以缓存结果
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  let captured = false;

  const captureResult = (statusCode: number, body: unknown) => {
    if (captured) return;
    captured = true;

    const bodySize = JSON.stringify(body).length;
    if (bodySize > MAX_BODY_SIZE) return;
    if (statusCode >= 500) return; // 服务端错误不缓存

    const result: CachedResult = {
      statusCode,
      headers: {
        "Content-Type": res.getHeader("Content-Type") as string || "application/json",
      },
      body,
      createdAt: Date.now(),
    };

    redis.set(cacheKey, result, IDEMPOTENCY_TTL_SECONDS).catch(() => {
      // 缓存写入失败不阻断
    });
  };

  res.json = function (body: unknown) {
    captureResult(res.statusCode, body);
    return originalJson(body);
  };

  res.send = function (body: unknown) {
    if (typeof body === "object" && body !== null) {
      captureResult(res.statusCode, body);
    }
    return originalSend(body);
  };

  next();
}
