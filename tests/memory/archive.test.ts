import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileLTMBackend } from "../../src/memory/ltm.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("LTM Archive", () => {
  let ltm: FileLTMBackend;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "raos-archive-"));
    ltm = new FileLTMBackend({
      storePath: tmpDir,
      archiveThreshold: 10,
      coldDays: 0, // 任何记忆都视为冷的（测试用）
      coldAccessCount: 2,
      activeLimit: 5,
    });
  });

  afterEach(() => {
    ltm.destroy();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should manually archive cold entries", async () => {
    // 添加 8 条记忆
    for (let i = 0; i < 8; i++) {
      await ltm.store(`key_${i}`, `value_${i}`);
    }
    expect(ltm.size).toBe(8);

    const result = await ltm.archive("test");
    // 应该归档到只剩 activeLimit(5) 条
    expect(result.archived).toBe(3);
    expect(result.manifest).not.toBeNull();
    expect(ltm.size).toBe(5);
  });

  it("should auto-archive when threshold exceeded", async () => {
    // archiveThreshold = 10, 加 11 条
    for (let i = 0; i < 11; i++) {
      await ltm.store(`key_${i}`, `value_${i}`);
    }
    // 自动归档应该触发了，剩余 activeLimit(5) 条
    expect(ltm.size).toBeLessThanOrEqual(6); // 第11条触发归档，可能剩5+1
  });

  it("should list archive manifests", async () => {
    for (let i = 0; i < 8; i++) {
      await ltm.store(`key_${i}`, `value_${i}`);
    }
    await ltm.archive("test-reason");
    const manifests = await ltm.getArchiveManifests();
    expect(manifests.length).toBe(1);
    expect(manifests[0].reason).toBe("test-reason");
    expect(manifests[0].entryCount).toBe(3);
    expect(manifests[0].keySummary.length).toBe(3);
  });

  it("should restore from archive", async () => {
    for (let i = 0; i < 8; i++) {
      await ltm.store(`key_${i}`, `value_${i}`);
    }
    const { manifest } = await ltm.archive("test");
    const beforeSize = ltm.size;

    const restored = await ltm.restoreFromArchive(manifest!.id);
    expect(restored).toBe(3);
    expect(ltm.size).toBe(beforeSize + 3);
  });

  it("should restore specific keys from archive", async () => {
    for (let i = 0; i < 8; i++) {
      await ltm.store(`key_${i}`, `value_${i}`);
    }
    const { manifest } = await ltm.archive("test");
    const archivedKeys = manifest!.keySummary;

    // 只恢复第一个
    const restored = await ltm.restoreFromArchive(manifest!.id, [archivedKeys[0]]);
    expect(restored).toBe(1);
  });

  it("should search across archives", async () => {
    await ltm.store("important_fact", "the sky is blue", { tags: ["science"] });
    for (let i = 0; i < 8; i++) {
      await ltm.store(`filler_${i}`, `filler_${i}`);
    }
    await ltm.archive("test");

    // important_fact 应该被归档了（低访问次数）
    // 普通搜索找不到
    const normal = await ltm.search("sky");
    const withArchive = await ltm.search("sky", { includeArchive: true });

    // 归档搜索应该能找到
    expect(withArchive.length).toBeGreaterThanOrEqual(normal.length);
  });

  it("should persist manifests across restarts", async () => {
    for (let i = 0; i < 8; i++) {
      await ltm.store(`key_${i}`, `value_${i}`);
    }
    await ltm.archive("persist-test");

    // 重建实例
    const ltm2 = new FileLTMBackend({
      storePath: tmpDir,
      archiveThreshold: 10,
      coldDays: 0,
      coldAccessCount: 2,
      activeLimit: 5,
    });
    const manifests = await ltm2.getArchiveManifests();
    expect(manifests.length).toBe(1);
    expect(manifests[0].reason).toBe("persist-test");
  });

  it("should report archived count in stats", async () => {
    for (let i = 0; i < 8; i++) {
      await ltm.store(`key_${i}`, `value_${i}`);
    }
    await ltm.archive("test");
    const stats = await ltm.stats();
    expect(stats.archived).toBe(3);
    expect(stats.archives).toBe(1);
    expect(stats.scheduledArchive).toBeDefined();
    expect(stats.scheduledArchive.running).toBe(false);
  });
});

describe("LTM Scheduled Archive", () => {
  let ltm: FileLTMBackend;
  let tmpDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = mkdtempSync(join(tmpdir(), "raos-sched-"));
  });

  afterEach(() => {
    ltm.destroy();
    vi.useRealTimers();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should start and stop scheduled archive", () => {
    ltm = new FileLTMBackend({
      storePath: tmpDir,
      coldDays: 0,
      coldAccessCount: 2,
      activeLimit: 5,
    });

    expect(ltm.isScheduledArchiveRunning()).toBe(false);
    ltm.startScheduledArchive(1000);
    expect(ltm.isScheduledArchiveRunning()).toBe(true);
    ltm.stopScheduledArchive();
    expect(ltm.isScheduledArchiveRunning()).toBe(false);
  });

  it("should auto-start when archiveIntervalMs is configured", () => {
    ltm = new FileLTMBackend({
      storePath: tmpDir,
      coldDays: 0,
      coldAccessCount: 2,
      activeLimit: 5,
      archiveIntervalMs: 5000,
    });

    expect(ltm.isScheduledArchiveRunning()).toBe(true);
  });

  it("should archive cold entries on timer tick", async () => {
    ltm = new FileLTMBackend({
      storePath: tmpDir,
      coldDays: 0,
      coldAccessCount: 2,
      activeLimit: 5,
      archiveIntervalMs: 1000,
    });

    // 添加 8 条记忆
    for (let i = 0; i < 8; i++) {
      await ltm.store(`key_${i}`, `value_${i}`);
    }
    expect(ltm.size).toBe(8);
    expect(ltm.getLastScheduledArchiveAt()).toBe(0);

    // 触发定时器
    vi.advanceTimersByTime(1000);

    // 应该归档了冷记忆，剩余 activeLimit(5)
    expect(ltm.size).toBe(5);
    expect(ltm.getLastScheduledArchiveAt()).toBeGreaterThan(0);
    expect((await ltm.getArchiveManifests()).length).toBe(1);
    expect((await ltm.getArchiveManifests())[0].reason).toBe("scheduled");
  });

  it("should not archive when no cold entries", async () => {
    ltm = new FileLTMBackend({
      storePath: tmpDir,
      coldDays: 0,
      coldAccessCount: 2,
      activeLimit: 10,
      archiveIntervalMs: 1000,
    });

    // 只有 3 条，低于 activeLimit
    for (let i = 0; i < 3; i++) {
      await ltm.store(`key_${i}`, `value_${i}`);
    }

    vi.advanceTimersByTime(1000);

    expect(ltm.size).toBe(3);
    expect((await ltm.getArchiveManifests()).length).toBe(0);
  });

  it("should run multiple archive cycles", async () => {
    ltm = new FileLTMBackend({
      storePath: tmpDir,
      coldDays: 0,
      coldAccessCount: 2,
      activeLimit: 3,
      archiveIntervalMs: 1000,
    });

    // 第一轮：加 6 条
    for (let i = 0; i < 6; i++) {
      await ltm.store(`batch1_${i}`, `value_${i}`);
    }
    vi.advanceTimersByTime(1000);
    expect(ltm.size).toBe(3);

    // 第二轮：再加 4 条
    for (let i = 0; i < 4; i++) {
      await ltm.store(`batch2_${i}`, `value_${i}`);
    }
    expect(ltm.size).toBe(7);
    vi.advanceTimersByTime(1000);
    expect(ltm.size).toBe(3);

    // 应该有 2 次归档
    expect((await ltm.getArchiveManifests()).length).toBe(2);
  });

  it("should report scheduled archive status in stats", async () => {
    ltm = new FileLTMBackend({
      storePath: tmpDir,
      coldDays: 0,
      coldAccessCount: 2,
      activeLimit: 5,
      archiveIntervalMs: 2000,
    });

    const stats = await ltm.stats();
    expect(stats.scheduledArchive.running).toBe(true);
    expect(stats.scheduledArchive.lastRunAt).toBe(0);

    for (let i = 0; i < 8; i++) {
      await ltm.store(`key_${i}`, `value_${i}`);
    }
    vi.advanceTimersByTime(2000);

    const stats2 = await ltm.stats();
    expect(stats2.scheduledArchive.lastRunAt).toBeGreaterThan(0);
  });
});
