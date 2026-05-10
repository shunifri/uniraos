import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe.skip("Worker Process", () => {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  let originalProcessOn: typeof process.on;

  beforeEach(() => {
    originalProcessOn = process.on.bind(process);
    handlers["uncaughtException"] = [];
    handlers["unhandledRejection"] = [];
    handlers["SIGTERM"] = [];
    handlers["SIGINT"] = [];

    vi.spyOn(process, "on").mockImplementation((event: string | symbol, listener: (...args: unknown[]) => void) => {
      const key = String(event);
      if (!handlers[key]) handlers[key] = [];
      handlers[key].push(listener);
      return process;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should register process event handlers", async () => {
    const mockDeps = {
      engine: { execute: vi.fn() },
      wal: { recover: () => ({ entries: [], description: "none" }), replay: vi.fn().mockResolvedValue({ succeeded: 0, failed: 0, skipped: 0, durationMs: 0 }) },
      configManager: {
        getEvolution: () => ({ autoExecute: false }),
        getFederation: () => ({ peers: [] }),
      },
      providerManager: { getProvider: () => null, getMultimodalProvider: () => null },
      evolutionController: { close: vi.fn() },
      federationTransport: { addPeer: vi.fn() },
      federationManager: { start: vi.fn(), getRemoteSnapshots: () => new Map(), getRecommendations: () => [] },
      evolutionEngine: { start: vi.fn(), getStatus: () => ({}) },
      instanceId: "test-instance",
    } as unknown as import("../../src/server/bootstrap.js").BootstrapResult;

    const { initWorkerInfrastructure } = await import("../../src/server/lifecycle.js");
    initWorkerInfrastructure(mockDeps);

    expect(handlers["uncaughtException"].length).toBeGreaterThan(0);
    expect(handlers["unhandledRejection"].length).toBeGreaterThan(0);
    expect(handlers["SIGTERM"].length).toBeGreaterThan(0);
    expect(handlers["SIGINT"].length).toBeGreaterThan(0);
  });

  it("SIGTERM handler should close evolutionController", async () => {
    const closeMock = vi.fn();
    const mockDeps = {
      engine: { execute: vi.fn() },
      wal: { recover: () => ({ entries: [], description: "none" }), replay: vi.fn().mockResolvedValue({ succeeded: 0, failed: 0, skipped: 0, durationMs: 0 }) },
      configManager: { getEvolution: () => ({ autoExecute: false }), getFederation: () => ({ peers: [] }) },
      providerManager: { getProvider: () => null },
      evolutionController: { close: closeMock },
      federationTransport: { addPeer: vi.fn() },
      federationManager: { start: vi.fn(), getRemoteSnapshots: () => new Map(), getRecommendations: () => [] },
      evolutionEngine: { start: vi.fn(), getStatus: () => ({}) },
      instanceId: "test-instance",
    } as unknown as import("../../src/server/bootstrap.js").BootstrapResult;

    const { initWorkerInfrastructure } = await import("../../src/server/lifecycle.js");
    initWorkerInfrastructure(mockDeps);

    const sigtermHandler = handlers["SIGTERM"][0];
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    sigtermHandler();

    expect(closeMock).toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
