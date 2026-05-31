import 'dotenv/config';
import { initTracing } from "./tracing.js";
initTracing(); // P1-21 OpenTelemetry 必须在其他模块之前初始化
import express from "express";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { validateEnvOrExit } from "./server/env-validation.js";
import { authMiddleware } from "./permissions/middleware/auth-middleware.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { register } from "prom-client";
import { initDatabaseAsync } from "./db/database.js";
import * as userRepo from "./db/user-repository.js";
import { cleanExpiredSessions } from "./db/auth.js";
import { requestContext } from "./user/request-context.js";
import { bootstrap } from "./server/bootstrap.js";
import { startServer } from "./server/lifecycle.js";
import { generalRateLimit, authRateLimit, llmRateLimit, uploadRateLimit, securityHeaders, corsMiddleware, auditMiddleware, requestTimeoutMiddleware } from "./routes/security-middleware.js";
import { globalErrorHandler } from "./routes/middleware.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import { batchLimitMiddleware } from "./middleware/batch-limit.js";
import { jsonDepthLimitMiddleware } from "./middleware/json-depth-limit.js";
import { urlLengthLimitMiddleware } from "./middleware/url-length-limit.js";
import { hppProtectionMiddleware } from "./middleware/hpp-protection.js";

// 启动前验证环境变量（P0 安全修复：防止弱密码/默认配置启动）
validateEnvOrExit();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// 生产安全中间件：Helmet 安全头（必须在最前面）
app.use(securityHeaders);

// Cookie 解析（必须在 CORS 和 authMiddleware 之前）
app.use(cookieParser());

// 调试日志：仅在 debug 模式下记录所有进入后端的请求
if (process.env.LOG_LEVEL === "debug" || process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.path} - User-Agent: ${req.headers['user-agent']?.slice(0, 50)}`);
    next();
  });
}

// Prometheus metrics 端点（独立路径，避免与 skill-routes 冲突）
app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// CORS 中间件
app.use(corsMiddleware);

// 链路追踪 ID（必须在 auditMiddleware 之前，以便审计日志复用）
app.use(requestIdMiddleware);

// 请求审计
app.use(auditMiddleware);

// P2 修复：幂等性中间件（防止重复提交）
app.use(idempotencyMiddleware);

// 入站请求超时
app.use(requestTimeoutMiddleware);

app.use(express.json({ limit: "50mb" }));

// P2 修复：批量操作限流（防止超大数组耗尽资源）
app.use(batchLimitMiddleware());

// P2 修复：JSON 嵌套深度限制（防止原型污染 / 嵌套炸弹）
app.use(jsonDepthLimitMiddleware());

// P2 修复：URL 长度限制（防止超长 URL 拒绝服务）
app.use(urlLengthLimitMiddleware());

// P2 修复：HTTP 参数污染防护
app.use(hppProtectionMiddleware());

// 初始化数据库（异步）
await initDatabaseAsync();
await userRepo.ensureAdminExists();

// 定时清理过期 session（每小时）
setInterval(() => cleanExpiredSessions(), 60 * 60 * 1000);

// 认证中间件：解析 Bearer token，挂载 req.user
app.use(authMiddleware);

// userId 上下文中间件：已登录用户用 user.id，未登录降级为 "default"
app.use((req, _res, next) => {
  const user = req.user;
  requestContext.run({
    userId: user?.id || "default",
    userName: user?.username,
    userDisplayName: user?.displayName,
    departmentId: user?.departmentId ?? undefined,
    requestId: (req as any).requestId,
  }, () => next());
});

// 启动所有服务
const deps = await bootstrap();

// 静态文件 - UI
// assets/ 目录文件名含 content hash，可以长期缓存
app.use("/assets", express.static(join(__dirname, "ui", "assets"), {
  maxAge: "1y",
  immutable: true,
}));
// 其他静态文件不缓存（特别是 index.html）
app.use(express.static(join(__dirname, "ui"), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  },
}));

// SPA fallback — 非 API 路由全部返回 index.html（禁止缓存）
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/") && !req.path.includes(".")) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(join(__dirname, "ui", "index.html"));
  } else {
    next();
  }
});

// 生产安全中间件：速率限制
app.use(generalRateLimit);
app.use("/api/auth/login", authRateLimit);
app.use("/api/auth/register", authRateLimit);
app.use("/api/llm", llmRateLimit);
app.use("/api/chat", llmRateLimit);
app.use("/api/upload", uploadRateLimit);

// 启动服务器生命周期（挂载路由、WAL 恢复、Inbox/Scheduler、监听端口）
startServer(app, deps);

// 全局错误处理（必须放在所有路由之后）
app.use(globalErrorHandler);
