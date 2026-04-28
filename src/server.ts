import 'dotenv/config';
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { authMiddleware } from "./db/auth-middleware.js";
import { initDatabaseAsync } from "./db/database.js";
import * as userRepo from "./db/user-repository.js";
import { cleanExpiredSessions } from "./db/auth.js";
import { requestContext } from "./user/request-context.js";
import { bootstrap } from "./server/bootstrap.js";
import { startServer } from "./server/lifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: "50mb" }));

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
    userId: user?.id ?? "default",
    userName: user?.username,
    userDisplayName: user?.displayName,
    departmentId: user?.departmentId ?? undefined,
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

// 启动服务器生命周期（挂载路由、WAL 恢复、Inbox/Scheduler、监听端口）
startServer(app, deps);
