import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PluginLoader } from "../../src/plugin/plugin-loader.js";
import type { SkillRegistry } from "../../src/registry/skill-registry.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { createHash } from "crypto";

describe("PluginLoader checksum verification (P2)", () => {
  const tmpDir = resolve(process.cwd(), "tests", ".tmp-plugin-test");
  let loader: PluginLoader;
  const mockRegistry = {
    register: vi.fn(),
    unregister: vi.fn(),
    lookup: vi.fn(),
  } as unknown as SkillRegistry;

  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    loader = new PluginLoader(mockRegistry, { skillsDir: tmpDir });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should load plugin with valid checksum", async () => {
    const pluginDir = join(tmpDir, "valid-plugin");
    const entryPath = join(pluginDir, "index.js");
    const code = "export default async () => ({ success: true });";
    const checksum = createHash("sha256").update(code).digest("hex");

    // mkdir + write files
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "skill.json"),
      JSON.stringify({ name: "valid-plugin", version: "1.0.0", entry: "index.js", checksum }),
    );
    writeFileSync(entryPath, code);

    const result = await loader.loadPlugin(pluginDir);
    expect(result.name).toBe("valid-plugin");
    expect(mockRegistry.register).toHaveBeenCalled();
  });

  it("should reject plugin with invalid checksum", async () => {
    const pluginDir = join(tmpDir, "bad-plugin");
    const entryPath = join(pluginDir, "index.js");
    const code = "export default async () => ({ success: true });";
    const badChecksum = "0000000000000000000000000000000000000000000000000000000000000000";

    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "skill.json"),
      JSON.stringify({ name: "bad-plugin", version: "1.0.0", entry: "index.js", checksum: badChecksum }),
    );
    writeFileSync(entryPath, code);

    await expect(loader.loadPlugin(pluginDir)).rejects.toThrow("Checksum mismatch");
    expect(mockRegistry.register).not.toHaveBeenCalled();
  });

  it("should allow plugin without checksum in development", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const pluginDir = join(tmpDir, "no-checksum-plugin");
    const entryPath = join(pluginDir, "index.js");
    const code = "export default async () => ({ success: true });";

    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "skill.json"),
      JSON.stringify({ name: "no-checksum-plugin", version: "1.0.0", entry: "index.js" }),
    );
    writeFileSync(entryPath, code);

    const result = await loader.loadPlugin(pluginDir);
    expect(result.name).toBe("no-checksum-plugin");

    process.env.NODE_ENV = originalNodeEnv;
  });
});
