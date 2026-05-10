import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UserSessionManager } from "../../src/user/user-session.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("UserSessionManager", () => {
  let sessionManager: UserSessionManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "raos-user-session-"));
    sessionManager = new UserSessionManager(tempDir, { backend: "file" });
  });

  afterEach(() => {
    sessionManager.stopCleanup();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("getOrCreate", () => {
    it("should create a new session for a user", () => {
      const session = sessionManager.getOrCreate("user-1");
      expect(session.userId).toBe("user-1");
      expect(session.stm).toBeDefined();
      expect(session.ltm).toBeDefined();
      expect(session.agentLoop).toBeNull();
      expect(session.lastActiveAt).toBeGreaterThan(0);
    });

    it("should reuse existing session for same user", () => {
      const session1 = sessionManager.getOrCreate("user-1");
      const timestamp1 = session1.lastActiveAt;

      // Wait a bit
      const start = Date.now();
      while (Date.now() - start < 10) {
        /* busy wait */
      }

      const session2 = sessionManager.getOrCreate("user-1");
      expect(session1).toBe(session2);
      expect(session2.lastActiveAt).toBeGreaterThanOrEqual(timestamp1);
    });

    it("should create separate sessions for different users", () => {
      const session1 = sessionManager.getOrCreate("user-1");
      const session2 = sessionManager.getOrCreate("user-2");
      expect(session1).not.toBe(session2);
      expect(session1.userId).toBe("user-1");
      expect(session2.userId).toBe("user-2");
    });
  });

  describe("destroy", () => {
    it("should remove a user's session", () => {
      sessionManager.getOrCreate("user-1");
      expect(sessionManager.listSessions()).toHaveLength(1);

      sessionManager.destroy("user-1");
      expect(sessionManager.listSessions()).toHaveLength(0);
    });

    it("should not throw when destroying non-existent session", () => {
      expect(() => sessionManager.destroy("non-existent")).not.toThrow();
    });
  });

  describe("listSessions", () => {
    it("should list all active sessions", () => {
      sessionManager.getOrCreate("user-1");
      sessionManager.getOrCreate("user-2");

      const sessions = sessionManager.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.userId).sort()).toEqual(["user-1", "user-2"]);
      expect(sessions.every((s) => s.hasAgentLoop === false)).toBe(true);
    });

    it("should return empty array when no sessions exist", () => {
      expect(sessionManager.listSessions()).toEqual([]);
    });
  });

  describe("startCleanup / stopCleanup", () => {
    it("should clean up inactive sessions after maxIdleMs", async () => {
      sessionManager.getOrCreate("user-1");

      // Start cleanup with very short interval and idle time
      sessionManager.startCleanup(50, 100);

      // Wait for cleanup to run (use setTimeout to yield event loop)
      await new Promise((r) => setTimeout(r, 250));

      expect(sessionManager.listSessions()).toHaveLength(0);
    });

    it("should keep active sessions during cleanup", async () => {
      sessionManager.getOrCreate("user-1");
      sessionManager.startCleanup(50, 5000);

      // Wait a bit but less than maxIdleMs
      await new Promise((r) => setTimeout(r, 150));

      // Session should still exist because it's active and maxIdleMs is large
      expect(sessionManager.listSessions()).toHaveLength(1);
    });

    it("should stop cleanup timer", async () => {
      sessionManager.startCleanup(50, 100);
      sessionManager.stopCleanup();

      sessionManager.getOrCreate("user-1");

      await new Promise((r) => setTimeout(r, 200));

      expect(sessionManager.listSessions()).toHaveLength(1);
    });

    it("should not throw when stopCleanup is called multiple times", () => {
      sessionManager.stopCleanup();
      expect(() => sessionManager.stopCleanup()).not.toThrow();
    });
  });

  describe("setEmbeddingProvider", () => {
    it("should set embedding provider without error", () => {
      const mockProvider = {
        embed: vi.fn().mockResolvedValue([0.1, 0.2]),
      } as any;

      expect(() => sessionManager.setEmbeddingProvider(mockProvider)).not.toThrow();
    });
  });

  describe("setLLMProvider", () => {
    it("should set LLM provider without error", () => {
      const mockProvider = {
        chat: vi.fn().mockResolvedValue({ content: "hi" }),
      } as any;

      expect(() => sessionManager.setLLMProvider(mockProvider)).not.toThrow();
    });
  });

  describe("getMemoryBackend", () => {
    it("should return 'enhanced'", () => {
      expect(sessionManager.getMemoryBackend()).toBe("enhanced");
    });
  });

  describe("rebuildAgentLoop", () => {
    it("should create an agent loop for a user", () => {
      const mockRegistry = {
        onChange: vi.fn(),
        list: () => [],
        getSkills: () => [],
      } as any;
      const mockEngine = { execute: vi.fn() } as any;
      const mockProvider = {
        name: "mock",
        model: "mock",
        chat: vi.fn().mockResolvedValue({ content: "test", toolCalls: [], finishReason: "stop" }),
        embedding: vi.fn().mockResolvedValue([0.1]),
      } as any;

      sessionManager.rebuildAgentLoop("user-1", mockRegistry, mockEngine, mockProvider);

      const sessions = sessionManager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].hasAgentLoop).toBe(true);
    });
  });

  describe("rebuildAllAgentLoops", () => {
    it("should rebuild agent loops for all sessions", () => {
      const mockRegistry = {
        onChange: vi.fn(),
        list: () => [],
        getSkills: () => [],
      } as any;
      const mockEngine = { execute: vi.fn() } as any;
      const mockProvider = {
        name: "mock",
        model: "mock",
        chat: vi.fn().mockResolvedValue({ content: "test", toolCalls: [], finishReason: "stop" }),
        embedding: vi.fn().mockResolvedValue([0.1]),
      } as any;

      sessionManager.getOrCreate("user-1");
      sessionManager.getOrCreate("user-2");

      sessionManager.rebuildAllAgentLoops(mockRegistry, mockEngine, mockProvider);

      const sessions = sessionManager.listSessions();
      expect(sessions.every((s) => s.hasAgentLoop)).toBe(true);
    });
  });

  describe("session expiration behavior", () => {
    it("should update lastActiveAt on repeated getOrCreate calls", () => {
      const session = sessionManager.getOrCreate("user-1");
      const firstActiveAt = session.lastActiveAt;

      const start = Date.now();
      while (Date.now() - start < 20) {
        /* busy wait */
      }

      sessionManager.getOrCreate("user-1");
      expect(session.lastActiveAt).toBeGreaterThanOrEqual(firstActiveAt);
    });
  });
});
