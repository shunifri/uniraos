import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PluginLoader } from "../../src/plugin/plugin-loader.js";
import { SkillRegistry } from "../../src/registry/skill-registry.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/** 创建一个测试插件目录 */
function createTestPlugin(
  baseDir: string,
  name: string,
  opts?: { version?: string; entry?: string; handlerCode?: string; visible?: boolean },
) {
  const pluginDir = join(baseDir, name);
  mkdirSync(pluginDir, { recursive: true });

  const version = opts?.version ?? "1.0.0";
  const entry = opts?.entry ?? "handler.mjs";
  const visible = opts?.visible ?? true;

  writeFileSync(
    join(pluginDir, "skill.json"),
    JSON.stringify({ name, version, entry, description: `Test plugin: ${name}`, visible }),
  );

  const handlerCode =
    opts?.handlerCode ??
    `export default async function(params) { return { success: true, data: { plugin: "${name}", params } }; }`;

  writeFileSync(join(pluginDir, entry), handlerCode);
  return pluginDir;
}

describe("PluginLoader", () => {
  let tmpDir: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(process.cwd(), "tests", ".tmp-plugin-"));
    registry = new SkillRegistry();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should load a single plugin", async () => {
    createTestPlugin(tmpDir, "hello");
    const loader = new PluginLoader(registry, { skillsDir: tmpDir });
    const result = await loader.loadAll();

    expect(result.loaded).toEqual(["hello"]);
    expect(result.errors).toHaveLength(0);
    expect(registry.lookup("hello")).toBeDefined();
    expect(loader.size).toBe(1);
    loader.destroy();
  });

  it("should load multiple plugins", async () => {
    createTestPlugin(tmpDir, "plugin_a");
    createTestPlugin(tmpDir, "plugin_b");
    createTestPlugin(tmpDir, "plugin_c");

    const loader = new PluginLoader(registry, { skillsDir: tmpDir });
    const result = await loader.loadAll();

    expect(result.loaded).toHaveLength(3);
    expect(registry.size).toBe(3);
    loader.destroy();
  });

  it("should skip directories without skill.json", async () => {
    createTestPlugin(tmpDir, "valid_plugin");
    mkdirSync(join(tmpDir, "not-a-plugin"));
    writeFileSync(join(tmpDir, "not-a-plugin", "random.txt"), "hello");

    const loader = new PluginLoader(registry, { skillsDir: tmpDir });
    const result = await loader.loadAll();

    expect(result.loaded).toEqual(["valid_plugin"]);
    expect(registry.size).toBe(1);
    loader.destroy();
  });

  it("should handle missing entry file", async () => {
    const pluginDir = join(tmpDir, "bad_entry");
    mkdirSync(pluginDir);
    writeFileSync(
      join(pluginDir, "skill.json"),
      JSON.stringify({ name: "bad_entry", version: "1.0.0", entry: "nonexistent.js" }),
    );

    const loader = new PluginLoader(registry, { skillsDir: tmpDir, continueOnError: true });
    const result = await loader.loadAll();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe("bad_entry");
    expect(registry.size).toBe(0);
    loader.destroy();
  });

  it("should handle invalid handler export", async () => {
    createTestPlugin(tmpDir, "no_handler", {
      handlerCode: `export const notAHandler = "oops";`,
    });

    const loader = new PluginLoader(registry, { skillsDir: tmpDir });
    const result = await loader.loadAll();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("handler function");
    loader.destroy();
  });

  it("should execute loaded plugin handler", async () => {
    createTestPlugin(tmpDir, "echo", {
      handlerCode: `export default async function(params) { return { success: true, data: { echo: params.msg } }; }`,
    });

    const loader = new PluginLoader(registry, { skillsDir: tmpDir });
    await loader.loadAll();

    const skill = registry.get("echo");
    const result = await skill.handler({ msg: "hello" }, {} as never);

    expect(result.success).toBe(true);
    expect((result.data as { echo: string }).echo).toBe("hello");
    loader.destroy();
  });

  it("should unload plugin", async () => {
    createTestPlugin(tmpDir, "temp");
    const loader = new PluginLoader(registry, { skillsDir: tmpDir });
    await loader.loadAll();
    expect(registry.size).toBe(1);

    loader.unloadPlugin("temp");
    expect(registry.size).toBe(0);
    expect(loader.size).toBe(0);
    loader.destroy();
  });

  it("should reload plugin", async () => {
    createTestPlugin(tmpDir, "reloadable", {
      handlerCode: `export default async function() { return { success: true, data: { v: 1 } }; }`,
    });

    const loader = new PluginLoader(registry, { skillsDir: tmpDir });
    await loader.loadAll();

    // 修改handler
    writeFileSync(
      join(tmpDir, "reloadable", "handler.mjs"),
      `export default async function() { return { success: true, data: { v: 2 } }; }`,
    );

    const reloaded = await loader.reloadPlugin("reloadable");
    expect(reloaded).not.toBeNull();

    const skill = registry.get("reloadable");
    const result = await skill.handler({}, {} as never);
    expect((result.data as { v: number }).v).toBe(2);
    loader.destroy();
  });

  it("should emit events", async () => {
    createTestPlugin(tmpDir, "evented");

    const events: string[] = [];
    const loader = new PluginLoader(registry, { skillsDir: tmpDir });
    loader.on((event) => events.push(event.type));

    await loader.loadAll();
    loader.unloadPlugin("evented");

    expect(events).toContain("loaded");
    expect(events).toContain("unloaded");
    loader.destroy();
  });

  it("should handle nonexistent skillsDir", async () => {
    const loader = new PluginLoader(registry, { skillsDir: join(tmpDir, "nope") });
    const result = await loader.loadAll();

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    loader.destroy();
  });

  it("should respect manifest fields", async () => {
    createTestPlugin(tmpDir, "configured", { visible: false });
    const loader = new PluginLoader(registry, { skillsDir: tmpDir });
    await loader.loadAll();

    const skill = registry.get("configured");
    expect(skill.visible).toBe(false);
    expect(skill.description).toBe("Test plugin: configured");
    loader.destroy();
  });

  it("should getLoaded return plugin info", async () => {
    createTestPlugin(tmpDir, "info_test", { version: "2.3.1" });
    const loader = new PluginLoader(registry, { skillsDir: tmpDir });
    await loader.loadAll();

    const loaded = loader.getLoaded();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("info_test");
    expect(loaded[0].version).toBe("2.3.1");
    expect(loaded[0].loadedAt).toBeGreaterThan(0);
    loader.destroy();
  });
});
