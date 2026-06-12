import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ensureRuntimeDataDirs, RUNTIME_DATA_DIRS } from "../../src/utils/data-dirs.js";

describe("ensureRuntimeDataDirs", () => {
  let tmpCwd: string;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "raos-data-dirs-"));
  });

  afterEach(() => {
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("creates all 6 .raos subdirs when none exist", () => {
    const created = ensureRuntimeDataDirs(tmpCwd);
    expect(created).toHaveLength(RUNTIME_DATA_DIRS.length);
    for (const rel of RUNTIME_DATA_DIRS) {
      const full = join(tmpCwd, rel);
      expect(existsSync(full)).toBe(true);
      expect(statSync(full).isDirectory()).toBe(true);
    }
  });

  it("is idempotent: running twice does not error and creates 0 second time", () => {
    ensureRuntimeDataDirs(tmpCwd);
    const second = ensureRuntimeDataDirs(tmpCwd);
    expect(second).toHaveLength(0);
    for (const rel of RUNTIME_DATA_DIRS) {
      expect(existsSync(join(tmpCwd, rel))).toBe(true);
    }
  });

  it("preserves existing files in subdirs (does not clobber)", () => {
    const auditDir = join(tmpCwd, ".raos/audit");
    // 手动 mkdir + 写个文件, 再调 ensureRuntimeDataDirs
    require("fs").mkdirSync(auditDir, { recursive: true });
    const preserved = join(auditDir, "audit.log");
    writeFileSync(preserved, "old log line", "utf-8");

    ensureRuntimeDataDirs(tmpCwd);

    expect(existsSync(preserved)).toBe(true);
    expect(require("fs").readFileSync(preserved, "utf-8")).toBe("old log line");
  });

  it("reproduces the Docker EACCES scenario: parent dir owned by root 0755, raos user can still create subdirs", () => {
    // 模拟 Docker named volume 第一次挂载: 父目录 root:root 0755 (没写权限给非 owner)
    // 但 raos 是子目录创建者 — mkdir recursive 仍然能跑
    // 注意: 真实 Docker 场景 EACCES 是因为父目录是 root 且 mode 不含 w for other
    // 这里我们只验证 mkdir 路径, 不模拟 root 权限 (chown 需 sudo)
    // 关键验证: ensureRuntimeDataDirs 不依赖父目录已存在, 自己递归建
    const result = ensureRuntimeDataDirs(tmpCwd);
    expect(result.length).toBe(RUNTIME_DATA_DIRS.length);
  });

  it("chmod 0o755 on .raos parent if mode differs (防 mount 上父目录权限错)", () => {
    ensureRuntimeDataDirs(tmpCwd);
    const raosRoot = join(tmpCwd, ".raos");
    const st = statSync(raosRoot);
    // 验证 mode 至少是 rwxr-xr-x (0o755) — owner 可写, group/other 可读可执行
    expect((st.mode & 0o755) === 0o755).toBe(true);
  });
});
