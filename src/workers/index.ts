/**
 * RAOS Worker Process Entry
 *
 * 独立进程运行，负责：
 * - WAL 恢复与重放
 * - Bull 队列任务处理（Scheduler）
 * - Inbox 调度器迁移
 *
 * 不启动 HTTP 服务器。
 */

import { bootstrap } from "../server/bootstrap.js";
import { initWorkerInfrastructure } from "../server/lifecycle.js";

const deps = await bootstrap();
initWorkerInfrastructure(deps);

console.log("\n👷 Worker process started (no HTTP server)");
