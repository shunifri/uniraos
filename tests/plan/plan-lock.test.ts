import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { withPlanLock, readPlanFileLocked, writePlanFileLocked } from "../../src/plan/plan-lock.js";

const TEST_DIR = resolve(process.cwd(), ".raos", "workspace", "test_lock_user", "plans");

describe("Plan Lock", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it("should serialize concurrent writes to the same file", async () => {
    const filePath = join(TEST_DIR, "counter.md");
    writePlanFileLocked(filePath, "0");

    const increment = async () => {
      await withPlanLock(filePath, () => {
        const current = parseInt(readPlanFileLocked(filePath), 10);
        writePlanFileLocked(filePath, String(current + 1));
      });
    };

    await Promise.all(Array.from({ length: 10 }, () => increment()));
    const final = readPlanFileLocked(filePath);
    expect(final).toBe("10");
  });

  it("should allow concurrent operations on different files", async () => {
    const fileA = join(TEST_DIR, "a.md");
    const fileB = join(TEST_DIR, "b.md");
    writePlanFileLocked(fileA, "0");
    writePlanFileLocked(fileB, "0");

    const order: string[] = [];

    const lockA = withPlanLock(fileA, async () => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("a-end");
    });

    const lockB = withPlanLock(fileB, async () => {
      order.push("b-start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("b-end");
    });

    await Promise.all([lockA, lockB]);

    const aStartIdx = order.indexOf("a-start");
    const bStartIdx = order.indexOf("b-start");
    const aEndIdx = order.indexOf("a-end");
    const bEndIdx = order.indexOf("b-end");

    expect(aStartIdx).toBeLessThan(aEndIdx);
    expect(bStartIdx).toBeLessThan(bEndIdx);
    // Both should have started before either ended (parallel execution)
    expect(Math.max(aStartIdx, bStartIdx)).toBeLessThan(Math.min(aEndIdx, bEndIdx));
  });
});
