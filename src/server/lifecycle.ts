import { join } from "path";
import type { Express } from "express";
import type { Server } from "http";
import { ShareRepository } from "../db/share-repository.js";
import { OpenAIMultimodalProvider } from "../llm/openai-multimodal-provider.js";
import { mountRoutes } from "../routes/index.js";
import { getInboxService, setAiReviewProviderGetter } from "../inbox/inbox-service.js";
import { runInboxSchedulerMigration } from "./migration-runner.js";
import type { BootstrapResult } from "./bootstrap.js";
import { shutdownTracing } from "../tracing.js";
import { closeWebSocketServer } from "../websocket/websocket-server.js";

/** 优雅关闭：等待连接排空的最大时间（ms） */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;

function createRouteDependencies(deps: BootstrapResult) {
  const { registry, engine, configManager, sessionManager, taskManager, skillAccessService, providerManager, wal, marketplace, pluginLoader, evolutionController, emergenceDetector, lifecycleManager, promptManager, modelRouter, federationTransport, migrationManager, federationManager, evolutionEngine, instanceId } = deps;
  return {
    registry, engine, skillAccessService, wal, configManager, sessionManager, taskManager, pluginLoader, marketplace,
    evolutionController, emergenceDetector, lifecycleManager, promptManager, modelRouter, federationTransport,
    migrationManager, federationManager, evolutionEngine, instanceId,
    getCurrentProvider: () => providerManager.getProvider(),
    getCurrentMultimodalProvider: () => providerManager.getMultimodalProvider(),
    createProvider: providerManager.createProvider,
    setCurrentProvider: (p: any) => { providerManager.setProvider(p); },
    getAgentLoop: (userId: string) => sessionManager.getOrCreate(userId).agentLoop ?? null,
    getOrchestrator: () => providerManager.getOrchestrator(),
    getAgentConfig: () => configManager.getAgent(),
    getVisionConfig: () => {
      const mm = configManager.getMultimodal();
      if (!mm.enabled || !mm.apiKey || !mm.visionModel) return null;
      return { apiKey: mm.apiKey, baseUrl: mm.baseUrl || "", model: mm.visionModel };
    },
    rebuildMultimodalProvider: () => {
      const mm = configManager.getMultimodal();
      if (!mm.enabled || !mm.apiKey) {
        providerManager.setMultimodalProvider(null);
        return;
      }
      providerManager.setMultimodalProvider(new OpenAIMultimodalProvider({
        apiKey: mm.apiKey, baseUrl: mm.baseUrl || undefined, imageModel: mm.imageModel,
        visionModel: mm.visionModel, ttsModel: mm.ttsModel, whisperModel: mm.whisperModel,
      }));
    },
    rebuildAllAgentLoops: () => {
      if (providerManager.getProvider()) {
        sessionManager.rebuildAllAgentLoops(registry, engine, providerManager.getProvider()!, configManager.getAgent());
      }
    },
    rebuildOrchestrator: () => { (globalThis as any).__orchestrator = null; },
    syncSkillsToResources: () => {
      const skills = registry.list();
      const resourceSkills = skills.filter((s: any) => s.type === "resource").map((s: any) => s.name);
      if (resourceSkills.length > 0) console.log(`   Skills synced to resources: ${resourceSkills.length} total`);
    },
    shareRepository: ShareRepository.getInstance(),
  };
}

/**
 * 初始化 Worker 基础设施（WAL 恢复、Inbox、信号处理）。
 * 可在 Server 进程和独立 Worker 进程中复用。
 */
export function initWorkerInfrastructure(deps: BootstrapResult): void {
  const { engine, wal, configManager, providerManager, evolutionController, federationTransport, federationManager, evolutionEngine, instanceId } = deps;

  // 启动时自动 WAL 恢复
  const walRecoveryPlan = wal.recover();
  if (walRecoveryPlan.entries.length > 0) {
    console.log(`\n   WAL recovery: ${walRecoveryPlan.description}`);
    wal.replay(engine).then((result) => {
      console.log(`   WAL replay complete: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped (${result.durationMs}ms)`);
    }).catch((err) => {
      console.error(`   WAL replay error: ${err.message}`);
    });
  }

  // ─── 初始化 Inbox 基础设施 ───

  // 注入 AI Review 的 LLM Provider getter
  setAiReviewProviderGetter(() => providerManager.getProvider());

  void runInboxSchedulerMigration();

  // 处理未捕获的异常，防止进程崩溃
  process.on("uncaughtException", (err) => {
    console.error("[FATAL] Uncaught Exception:", err);
    // 不立即 exit，给日志/监控上报留出时间；依赖进程管理器（systemd/K8s）后续终止
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
  });
}

function setupGracefulShutdown(server: Server, evolutionController: BootstrapResult["evolutionController"]): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[${signal}] received, starting graceful shutdown...`);

    // 1. 关闭 WebSocket 连接
    closeWebSocketServer().catch(() => {});

    // 2. 停止接受新连接
    server.close(() => {
      console.log("   HTTP server closed (no new connections accepted)");
    });

    // 2. 关闭外部连接（最佳努力）
    const closePromises: Promise<unknown>[] = [];

    // 关闭 Redis
    try {
      const { getRedisClient } = await import("../cache/redis-client.js");
      closePromises.push(getRedisClient().close().catch(() => {}));
    } catch { /* Redis not initialized */ }

    // 关闭数据库
    try {
      const { closeDatabase } = await import("../db/database.js");
      closePromises.push(Promise.resolve(closeDatabase()).catch(() => {}));
    } catch { /* DB not initialized */ }

    // 关闭 RabbitMQ
    try {
      const { getRabbitMQClient } = await import("../queue/rabbitmq-client.js");
      closePromises.push(getRabbitMQClient().close().catch(() => {}));
    } catch { /* RabbitMQ not initialized */ }

    // 关闭 OpenTelemetry
    closePromises.push(shutdownTracing().catch(() => {}));

    await Promise.allSettled(closePromises);
    console.log("   External connections closed");

    // 4. 给现有请求一个宽限期，然后强制退出
    const forceExit = setTimeout(() => {
      console.error("   Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

    // 5. 当所有连接关闭后，清理定时器并正常退出
    server.on("close", () => {
      clearTimeout(forceExit);
      console.log("   Graceful shutdown complete");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

export function startServer(app: Express, deps: BootstrapResult): Server {
  const { configManager, federationTransport, federationManager, evolutionEngine, instanceId, evolutionController } = deps;
  const PORT = process.env.PORT ?? 3000;

  initWorkerInfrastructure(deps);

  // 挂载 routes/ 目录下的所有路由
  mountRoutes(app, createRouteDependencies(deps));

  const server = app.listen(PORT, () => {
    console.log(`\n🚀 RAOS Dev Server running at http://localhost:${PORT}`);
    console.log(`   API:  http://localhost:${PORT}/api/skills`);
    console.log(`   UI:   http://localhost:${PORT}`);
    console.log(`   Instance: ${instanceId}`);

    // 启动联邦心跳和进化引擎
    const fedPeers = configManager.getFederation().peers;
    if (fedPeers.length > 0) {
      for (const peer of fedPeers) {
        federationTransport.addPeer({
          instanceId: peer.endpoint,
          endpoint: peer.endpoint,
          version: "2.0",
          capabilities: [],
          skillCount: 0,
          lastHeartbeat: Date.now(),
        });
      }
      federationManager.start();
      console.log(`   Federation: ${fedPeers.length} peers configured`);
    }

    const evoConfig = configManager.getEvolution();
    evolutionEngine.start();
    console.log(`   Evolution engine: started (auto=${evoConfig.autoExecute})\n`);
  });

  setupGracefulShutdown(server, evolutionController);
  return server;
}
