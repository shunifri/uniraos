import { describe, it, expect } from "vitest";
import { UserSessionManager } from "../../src/user/user-session.js";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("ltm debug", () => {
  it("should persist", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "raos-ltm-"));
    try {
      const sm1 = new UserSessionManager(tempDir, { backend: "file" });
      const s1 = sm1.getOrCreate("user1");
      await s1.ltm.store("key1", "value1");

      const indexPath = join(tempDir, "user1", "index.json");
      console.log("indexPath:", indexPath);
      console.log("exists:", existsSync(indexPath));
      if (existsSync(indexPath)) {
        console.log("content:", readFileSync(indexPath, "utf-8"));
      }

      const sm2 = new UserSessionManager(tempDir, { backend: "file" });
      const s2 = sm2.getOrCreate("user1");
      const entry = await s2.ltm.getByKey("key1");
      expect(entry).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
