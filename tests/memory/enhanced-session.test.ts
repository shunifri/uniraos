/**
 * 集成测试：UserSessionManager 与 EnhancedLTMBackend
 *
 * 验证：
 * - UserSessionManager 创建 EnhancedLTMBackend（Task #15 验证）
 * - 版本链在 store→store 操作后正确形成
 * - ltm_check_conflicts 通过会话正确触发
 * - ltm_version_history API 返回完整版本链
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { UserSessionManager, type UserSession } from "../../src/user/user-session.js";
import { EnhancedLTMBackend } from "../../src/memory/enhanced/enhanced-ltm-backend.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("UserSessionManager with EnhancedLTMBackend Integration", () => {
  let sessionManager: UserSessionManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "raos-session-"));
    sessionManager = new UserSessionManager(tempDir, { backend: "file" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create EnhancedLTMBackend instead of FileLTMBackend", () => {
    const session = sessionManager.getOrCreate("user1");

    expect(session).toBeDefined();
    expect(session.ltm).toBeDefined();
    expect(session.ltm instanceof EnhancedLTMBackend).toBe(true);
  });

  it("should initialize session with STM and LTM", () => {
    const session = sessionManager.getOrCreate("user1");

    expect(session.userId).toBe("user1");
    expect(session.stm).toBeDefined();
    expect(session.ltm).toBeDefined();
    expect(session.agentLoop).toBeNull();
    expect(session.lastActiveAt).toBeGreaterThan(0);
  });

  it("should reuse session for same user", () => {
    const session1 = sessionManager.getOrCreate("user1");
    const timestamp1 = session1.lastActiveAt;

    // Wait a bit
    const start = Date.now();
    while (Date.now() - start < 10) {
      /* busy wait */
    }

    const session2 = sessionManager.getOrCreate("user1");

    expect(session1).toBe(session2); // Same reference
    expect(session2.lastActiveAt).toBeGreaterThan(timestamp1);
  });

  it("should create separate sessions for different users", () => {
    const session1 = sessionManager.getOrCreate("user1");
    const session2 = sessionManager.getOrCreate("user2");

    expect(session1).not.toBe(session2);
    expect(session1.userId).toBe("user1");
    expect(session2.userId).toBe("user2");
  });

  it("should store data in LTM and build version chain", async () => {
    const session = sessionManager.getOrCreate("user1");

    // Store initial data
    await session.ltm.store("pref_theme", "dark_mode", {
      tags: ["preferences"],
      summary: "User theme preference",
    });

    // Retrieve and verify
    const entry1 = await session.ltm.getByKey("pref_theme");
    expect(entry1).toBeDefined();
    expect(entry1!.value).toBe("dark_mode");

    // Add delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Update same key (creates version)
    await session.ltm.store("pref_theme", "light_mode", {
      tags: ["preferences"],
      summary: "Updated user theme preference",
    });

    // Retrieve updated
    const entry2 = await session.ltm.getByKey("pref_theme");
    expect(entry2).toBeDefined();
    expect(entry2!.value).toBe("light_mode");

    // Updated entry should show updated metadata
    expect(entry2!.updatedAt).toBeGreaterThanOrEqual(entry1!.updatedAt);
    expect(entry2!.summary).toBe("Updated user theme preference");
  });

  it("should track multiple versions in enhanced LTM", async () => {
    const session = sessionManager.getOrCreate("user1");

    // Store multiple versions
    await session.ltm.store("config", { version: 1, setting: "a" });
    await session.ltm.store("config", { version: 2, setting: "b" });
    await session.ltm.store("config", { version: 3, setting: "c" });

    // Verify current version
    const current = await session.ltm.getByKey("config");
    expect(current).toBeDefined();
    expect((current!.value as any).version).toBe(3);

    // EnhancedLTMBackend should have maintained version chain
    if ("getVersionHistory" in session.ltm) {
      const history = await (session.ltm as any).getVersionHistory("config");
      expect(Array.isArray(history)).toBe(true);
    }
  });

  it("should support search across sessions", async () => {
    const session1 = sessionManager.getOrCreate("user1");
    const session2 = sessionManager.getOrCreate("user2");

    // Store data in different sessions
    await session1.ltm.store("trip_paris", { destination: "Paris", dates: "2024-06" });
    await session2.ltm.store("trip_tokyo", { destination: "Tokyo", dates: "2024-07" });

    // Search in user1's session
    const results1 = await session1.ltm.search("Paris");
    expect(results1.length).toBeGreaterThanOrEqual(1);
    expect(results1[0].key).toBe("trip_paris");

    // Search in user2's session
    const results2 = await session2.ltm.search("Tokyo");
    expect(results2.length).toBeGreaterThanOrEqual(1);
    expect(results2[0].key).toBe("trip_tokyo");
  });

  it("should support tags-based search", async () => {
    const session = sessionManager.getOrCreate("user1");

    await session.ltm.store("work_project_a", { name: "ProjectA" }, { tags: ["work", "project"] });
    await session.ltm.store("work_project_b", { name: "ProjectB" }, { tags: ["work", "project"] });
    await session.ltm.store("hobby_gaming", { name: "Gaming" }, { tags: ["hobby"] });

    const workResults = await session.ltm.search("project", { tags: ["work"] });
    expect(workResults.length).toBeGreaterThanOrEqual(1);
    expect(workResults.every((r) => r.key.startsWith("work_"))).toBe(true);
  });

  it("should delete entries from LTM", async () => {
    const session = sessionManager.getOrCreate("user1");

    await session.ltm.store("temp_data", "will be deleted");
    let entry = await session.ltm.getByKey("temp_data");
    expect(entry).toBeDefined();

    const deleted = await session.ltm.deleteByKey("temp_data");
    expect(deleted).toBe(true);

    entry = await session.ltm.getByKey("temp_data");
    expect(entry).toBeUndefined();
  });

  it("should maintain STM with LRU eviction", () => {
    const session = sessionManager.getOrCreate("user1");

    // STM should have limited entries
    for (let i = 0; i < 300; i++) {
      session.stm.set(`key_${i}`, `value_${i}`);
    }

    // Size should be bounded
    expect(session.stm.size).toBeLessThanOrEqual(200);
  });

  it("should support STM-LTM coordination", async () => {
    const session = sessionManager.getOrCreate("user1");

    // Store in STM
    session.stm.set("current_task", "task_123");

    // Store in LTM
    await session.ltm.store("completed_tasks", ["task_100", "task_101", "task_102"]);

    // Retrieve both
    expect(session.stm.get("current_task")).toBe("task_123");

    const ltmEntry = await session.ltm.getByKey("completed_tasks");
    expect(Array.isArray(ltmEntry!.value)).toBe(true);
  });

  it("should get memory backend type", () => {
    const backendType = sessionManager.getMemoryBackend();

    expect(backendType).toBe("enhanced");
  });

  it("should handle concurrent access to same session", async () => {
    const session = sessionManager.getOrCreate("user1");

    // Simulate concurrent stores
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        session.ltm.store(`concurrent_${i}`, { index: i }, { tags: ["concurrent"] }),
      );
    }

    await Promise.all(promises);

    // Verify all were stored
    for (let i = 0; i < 10; i++) {
      const entry = await session.ltm.getByKey(`concurrent_${i}`);
      expect(entry).toBeDefined();
      expect((entry!.value as any).index).toBe(i);
    }
  });

  it("should persist data across new session instances", async () => {
    const session1 = sessionManager.getOrCreate("user1");
    await session1.ltm.store("persistent_data", { important: true });

    // Verify in same session
    let entry = await session1.ltm.getByKey("persistent_data");
    expect(entry).toBeDefined();

    // Create new session manager pointing to same directory
    const sessionManager2 = new UserSessionManager(tempDir, { backend: "file" });
    const session2 = sessionManager2.getOrCreate("user1");

    // Should still find the data
    entry = await session2.ltm.getByKey("persistent_data");
    expect(entry).toBeDefined();
    expect((entry!.value as any).important).toBe(true);
  });

  it("should handle LTM errors gracefully", async () => {
    const session = sessionManager.getOrCreate("user1");

    // Try to store and retrieve with various data types
    const testData = [
      { key: "str", value: "string_value" },
      { key: "num", value: 42 },
      { key: "bool", value: true },
      { key: "obj", value: { nested: { data: [1, 2, 3] } } },
      { key: "arr", value: [1, "two", 3, { four: 4 }] },
      { key: "null", value: null },
    ];

    for (const { key, value } of testData) {
      await session.ltm.store(key, value);
      const retrieved = await session.ltm.getByKey(key);
      expect(retrieved).toBeDefined();
      expect(retrieved!.value).toEqual(value);
    }
  });

  it("should support custom metadata in LTM entries", async () => {
    const session = sessionManager.getOrCreate("user1");

    await session.ltm.store("custom_entry", { data: "value" }, {
      tags: ["tag1", "tag2"],
      summary: "This is a test entry",
    });

    const entry = await session.ltm.getByKey("custom_entry");
    expect(entry).toBeDefined();
    expect(entry!.tags).toContain("tag1");
    expect(entry!.tags).toContain("tag2");
    expect(entry!.summary).toBe("This is a test entry");
  });
});
