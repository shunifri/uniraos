import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { UserSessionManager } from "../../src/user/user-session.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("ltm debug2", () => {
  let sessionManager: UserSessionManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "raos-session-"));
    sessionManager = new UserSessionManager(tempDir, { backend: "file" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should persist data across new session instances", async () => {
    const session1 = sessionManager.getOrCreate("user1");
    await session1.ltm.store("persistent_data", { important: true });

    let entry = await session1.ltm.getByKey("persistent_data");
    expect(entry).toBeDefined();

    const sessionManager2 = new UserSessionManager(tempDir, { backend: "file" });
    const session2 = sessionManager2.getOrCreate("user1");

    entry = await session2.ltm.getByKey("persistent_data");
    expect(entry).toBeDefined();
    expect((entry!.value as any).important).toBe(true);
  });
});
