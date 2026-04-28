import { join } from "path";
import type { Express } from "express";
import { ShareRepository } from "../db/share-repository.js";
import { OpenAIMultimodalProvider } from "../llm/openai-multimodal-provider.js";
import { mountRoutes } from "../routes/index.js";
import { getSchedulerService } from "../scheduler/scheduler-service.js";
import { processScheduleJob } from "../scheduler/scheduler-worker.js";
import { getInboxService, setAiReviewProviderGetter } from "../inbox/inbox-service.js";
import { runInboxSchedulerMigration } from "./migration-runner.js";
import type { BootstrapResult } from "./bootstrap.js";

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
 * 初始化 Worker 基础设施（WAL 恢复、Scheduler、Inbox、信号处理）。
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

  // ─── 初始化 Inbox + Scheduler 基础设施 ───
  const schedulerQueue = getSchedulerService()["queue"];
  if (schedulerQueue) {
    schedulerQueue.process(async (job) => {
      await processScheduleJob(job.data);
      return { success: true };
    });
    console.log("   Scheduler worker initialized (Bull)");
  }

  // 注入 AI Review 的 LLM Provider getter
  setAiReviewProviderGetter(() => providerManager.getProvider());

  runInboxSchedulerMigration();

  // 处理未捕获的异常，防止进程崩溃
  process.on("uncaughtException", (err) => {
    console.error("[FATAL] Uncaught Exception:", err);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
  });

  // 优雅关闭：处理 SIGTERM 和 SIGINT
  process.on("SIGTERM", () => {
    console.log("\n✓ SIGTERM received, closing resources...");
    evolutionController.close();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.log("\n✓ SIGINT received, closing resources...");
    evolutionController.close();
    process.exit(0);
  });
}

export function startServer(app: Express, deps: BootstrapResult): void {
  const { configManager, federationTransport, federationManager, evolutionEngine, instanceId } = deps;
  const PORT = process.env.PORT ?? 3000;

  initWorkerInfrastructure(deps);

  // 挂载 routes/ 目录下的所有路由
  mountRoutes(app, createRouteDependencies(deps));

  app.listen(PORT, () => {
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
}
