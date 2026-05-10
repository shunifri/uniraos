import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Message } from "../../src/llm/types.js";
import type { ConversationRepository } from "../../src/db/conversation-repository.js";

let testDb: Database.Database;

vi.mock("../../src/db/database.js", () => ({
  getDb: () => testDb,
  isMySQL: () => false,
  isSQLite: () => true,
  getDatabaseType: () => "sqlite",
}));

const { SQLiteConversationRepository } = await import("../../src/db/sqlite-conversation-repository.js");

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id VARCHAR(255) NOT NULL,
      conversation_id VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      content TEXT,
      tool_calls TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX idx_conversation_user ON conversation_history(user_id, conversation_id, created_at);
  `);
}

describe("SQLiteConversationRepository", () => {
  let repo: ConversationRepository;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
    repo = new SQLiteConversationRepository();
  });

  it("should save and load messages", async () => {
    await repo.saveMessage("user1", "conv1", { role: "user", content: "Hello" });
    await repo.saveMessage("user1", "conv1", { role: "assistant", content: "Hi there" });

    const history = await repo.getHistory("user1", "conv1");
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("Hello");
    expect(history[1].role).toBe("assistant");
    expect(history[1].content).toBe("Hi there");
  });

  it("should respect limit when loading history", async () => {
    await repo.saveMessage("user1", "conv1", { role: "user", content: "msg1" });
    await repo.saveMessage("user1", "conv1", { role: "assistant", content: "msg2" });
    await repo.saveMessage("user1", "conv1", { role: "user", content: "msg3" });

    const history = await repo.getHistory("user1", "conv1", 2);
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe("msg2");
    expect(history[1].content).toBe("msg3");
  });

  it("should clear history for specific conversation", async () => {
    await repo.saveMessage("user1", "conv1", { role: "user", content: "Hello" });
    await repo.saveMessage("user1", "conv2", { role: "user", content: "World" });

    await repo.clearHistory("user1", "conv1");

    const conv1History = await repo.getHistory("user1", "conv1");
    expect(conv1History).toHaveLength(0);

    const conv2History = await repo.getHistory("user1", "conv2");
    expect(conv2History).toHaveLength(1);
  });

  it("should clear all history for a user", async () => {
    await repo.saveMessage("user1", "conv1", { role: "user", content: "Hello" });
    await repo.saveMessage("user1", "conv2", { role: "user", content: "World" });
    await repo.saveMessage("user2", "conv1", { role: "user", content: "Hi" });

    await repo.clearHistory("user1");

    expect(await repo.getHistory("user1", "conv1")).toHaveLength(0);
    expect(await repo.getHistory("user1", "conv2")).toHaveLength(0);
    expect(await repo.getHistory("user2", "conv1")).toHaveLength(1);
  });

  it("should clear all history", async () => {
    await repo.saveMessage("user1", "conv1", { role: "user", content: "Hello" });
    await repo.saveMessage("user2", "conv1", { role: "user", content: "Hi" });

    await repo.clearHistory();

    expect(await repo.getHistory("user1", "conv1")).toHaveLength(0);
    expect(await repo.getHistory("user2", "conv1")).toHaveLength(0);
  });

  it("should list conversations for a user", async () => {
    await repo.saveMessage("user1", "conv1", { role: "user", content: "Hello" });
    await repo.saveMessage("user1", "conv2", { role: "user", content: "World" });
    await repo.saveMessage("user2", "conv3", { role: "user", content: "Hi" });

    const conversations = await repo.listConversations("user1");
    expect(conversations).toHaveLength(2);
    expect(conversations).toContain("conv1");
    expect(conversations).toContain("conv2");
  });
});

// Mock repository for orchestrator tests
class MockConversationRepository implements ConversationRepository {
  private messages: Map<string, Message[]> = new Map();

  private key(userId: string, conversationId: string): string {
    return `${userId}:${conversationId}`;
  }

  async saveMessage(userId: string, conversationId: string, message: Message): Promise<void> {
    const k = this.key(userId, conversationId);
    const msgs = this.messages.get(k) ?? [];
    msgs.push(message);
    this.messages.set(k, msgs);
  }

  async getHistory(userId: string, conversationId: string, limit?: number): Promise<Message[]> {
    const k = this.key(userId, conversationId);
    const msgs = this.messages.get(k) ?? [];
    return limit !== undefined ? msgs.slice(-limit) : [...msgs];
  }

  async clearHistory(userId?: string, conversationId?: string): Promise<void> {
    if (userId && conversationId) {
      this.messages.delete(this.key(userId, conversationId));
    } else if (userId) {
      for (const key of this.messages.keys()) {
        if (key.startsWith(`${userId}:`)) this.messages.delete(key);
      }
    } else {
      this.messages.clear();
    }
  }

  async listConversations(userId: string): Promise<string[]> {
    const conversations = new Set<string>();
    for (const key of this.messages.keys()) {
      if (key.startsWith(`${userId}:`)) {
        conversations.add(key.split(":")[1]);
      }
    }
    return Array.from(conversations);
  }
}

describe("Orchestrator with conversation repository", () => {
  let orchestrator: any;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _mockRepo: MockConversationRepository;

  beforeEach(async () => {
    const { Orchestrator } = await import("../../src/agents/orchestrator.js");
    const { SkillRegistry } = await import("../../src/registry/skill-registry.js");
    const { ExecutionEngine } = await import("../../src/engine/execution-engine.js");
    const { WALManager } = await import("../../src/wal/wal-manager.js");

    const registry = new SkillRegistry();
    const engine = new ExecutionEngine(registry, new WALManager(), { maxDepth: 20, callBudget: 100 });

    const mockLlm = {
      name: "mock",
      model: "mock",
      async chat() {
        return { content: "Mock response", toolCalls: [], finishReason: "stop" as const };
      },
      async embedding() {
        return Array(384).fill(0);
      },
    };

    orchestrator = new Orchestrator(
      { registry, engine, provider: mockLlm },
      { autoStrategy: false }
    );
  });

  it("should maintain conversation history in memory", async () => {
    const result = await orchestrator.run({
      message: "Hello",
      userId: "user1",
      conversationId: "conv1",
    });

    expect(result).toBeDefined();
    expect(result.response).toBe("Mock response");

    const history = orchestrator.getConversationHistory("user1", "conv1");
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it("should save messages in memory after run", async () => {
    await orchestrator.run({
      message: "Hello",
      userId: "user1",
      conversationId: "conv2",
    });

    const history = orchestrator.getConversationHistory("user1", "conv2");
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("Hello");
    expect(history[history.length - 1].role).toBe("assistant");
  });

  it("should clear history in memory", async () => {
    await orchestrator.run({
      message: "Hello",
      userId: "user1",
      conversationId: "conv3",
    });

    expect(orchestrator.getConversationHistory("user1", "conv3").length).toBeGreaterThan(0);

    await orchestrator.clearHistory("user1", "conv3");

    expect(orchestrator.getConversationHistory("user1", "conv3")).toHaveLength(0);
  });

  it("should handle multiple conversations per user in memory", async () => {
    await orchestrator.run({
      message: "Message in conv A",
      userId: "user1",
      conversationId: "convA",
    });

    await orchestrator.run({
      message: "Message in conv B",
      userId: "user1",
      conversationId: "convB",
    });

    const historyA = orchestrator.getConversationHistory("user1", "convA");
    const historyB = orchestrator.getConversationHistory("user1", "convB");

    expect(historyA.length).toBeGreaterThan(0);
    expect(historyB.length).toBeGreaterThan(0);
    expect(historyA[0].content).toBe("Message in conv A");
    expect(historyB[0].content).toBe("Message in conv B");
  });
});
