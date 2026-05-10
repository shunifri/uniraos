/**
 * 插件加载器
 * 从指定目录扫描并加载 Skill 插件
 *
 * 目录结构约定：
 *   skills/
 *     greet/
 *       skill.json        ← 清单文件
 *       index.ts|.js      ← 入口文件（导出 handler 函数）
 *     http-call/
 *       skill.json
 *       handler.ts
 */
import { existsSync, readdirSync, readFileSync, statSync, watch } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { createHash } from "crypto";
import type { SkillDefinition } from "../types/index.js";
import { defineSkill } from "../types/index.js";
import { Autonomy } from "../types/index.js";
import type { SkillRegistry } from "../registry/skill-registry.js";
import type {
  SkillManifest,
  PluginLoaderConfig,
  LoadedPlugin,
  PluginEvent,
  PluginEventHandler,
} from "./types.js";

export class PluginLoader {
  private config: Required<PluginLoaderConfig>;
  private loaded = new Map<string, LoadedPlugin>();
  private watcher: ReturnType<typeof watch> | null = null;
  private listeners: PluginEventHandler[] = [];
  private registry: SkillRegistry;
  /** 防抖定时器 */
  private reloadTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(registry: SkillRegistry, config: PluginLoaderConfig) {
    this.registry = registry;
    this.config = {
      hotReload: false,
      continueOnError: true,
      ...config,
    };
  }

  /** 扫描目录并加载所有插件 */
  async loadAll(): Promise<{ loaded: string[]; errors: Array<{ name: string; error: string }> }> {
    const dir = resolve(this.config.skillsDir);
    if (!existsSync(dir)) {
      return { loaded: [], errors: [{ name: dir, error: "Directory not found" }] };
    }

    const loaded: string[] = [];
    const errors: Array<{ name: string; error: string }> = [];

    const entries = readdirSync(dir);
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      const manifestPath = join(entryPath, "skill.json");
      if (!existsSync(manifestPath)) continue;

      try {
        await this.loadPlugin(entryPath);
        loaded.push(entry);
      } catch (err) {
        const errMsg = err instanceof Error ? (err as Error).message : String(err);
        errors.push({ name: entry, error: errMsg });
        this.emit({ type: "error", name: entry, error: err instanceof Error ? err : new Error(errMsg) });
        if (!this.config.continueOnError) break;
      }
    }

    if (this.config.hotReload) {
      this.startWatching();
    }

    return { loaded, errors };
  }

  /** 加载单个插件 */
  async loadPlugin(pluginDir: string): Promise<LoadedPlugin> {
    const manifestPath = join(pluginDir, "skill.json");
    const manifest = this.readManifest(manifestPath);

    // 如果已加载同名插件，先卸载
    if (this.loaded.has(manifest.name)) {
      this.unloadPlugin(manifest.name);
    }

    const entryPath = resolve(pluginDir, manifest.entry);
    if (!existsSync(entryPath)) {
      throw new Error(`Entry file not found: ${entryPath}`);
    }

    // P2 修复：校验和验证（插件签名验证）
    this.verifyChecksum(manifest, entryPath);

    // 动态导入入口文件
    const handler = await this.importHandler(entryPath);

    // 构建 SkillDefinition
    const skill = defineSkill({
      name: manifest.name,
      visible: manifest.visible ?? true,
      autonomy: manifest.autonomy ? (manifest.autonomy as Autonomy) : Autonomy.MANUAL,
      dependencies: manifest.dependencies ?? [],
      timeout: manifest.timeout ?? 30000,
      retry: manifest.retry
        ? {
            maxRetries: manifest.retry.maxRetries ?? 0,
            backoffMs: manifest.retry.backoffMs ?? 1000,
            backoffMultiplier: manifest.retry.backoffMultiplier ?? 2,
          }
        : undefined,
      handler,
      description: manifest.description ?? "",
    });

    // 注册到 Registry
    this.registry.register(skill);

    const pluginInfo: LoadedPlugin = {
      name: manifest.name,
      version: manifest.version,
      manifestPath,
      entryPath,
      loadedAt: Date.now(),
      dir: pluginDir,
    };

    this.loaded.set(manifest.name, pluginInfo);
    this.emit({ type: "loaded", plugin: pluginInfo });
    return pluginInfo;
  }

  /** 卸载插件 */
  unloadPlugin(name: string): boolean {
    const plugin = this.loaded.get(name);
    if (!plugin) return false;

    try {
      this.registry.unregister(name);
    } catch {
      // 可能因为依赖关系无法卸载，记录但不阻断
    }

    this.loaded.delete(name);
    this.emit({ type: "unloaded", name });
    return true;
  }

  /** 重载插件 */
  async reloadPlugin(name: string): Promise<LoadedPlugin | null> {
    const existing = this.loaded.get(name);
    if (!existing) return null;

    const plugin = await this.loadPlugin(existing.dir);
    this.emit({ type: "reloaded", plugin });
    return plugin;
  }

  /** 获取已加载的插件列表 */
  getLoaded(): LoadedPlugin[] {
    return [...this.loaded.values()];
  }

  /** 获取已加载插件数量 */
  get size(): number {
    return this.loaded.size;
  }

  /** 监听插件事件 */
  on(handler: PluginEventHandler): void {
    this.listeners.push(handler);
  }

  /** 启动文件监听（热加载） */
  private startWatching(): void {
    if (this.watcher) return;
    const dir = resolve(this.config.skillsDir);
    if (!existsSync(dir)) return;

    this.watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;

      // 找到变更文件对应的插件目录
      const parts = filename.split(/[/\\]/);
      const pluginDirName = parts[0];
      if (!pluginDirName) return;

      const pluginDir = join(dir, pluginDirName);
      const manifestPath = join(pluginDir, "skill.json");
      if (!existsSync(manifestPath)) return;

      // 防抖：同一插件 300ms 内多次变更合并为一次重载
      const existing = this.reloadTimers.get(pluginDirName);
      if (existing) clearTimeout(existing);

      this.reloadTimers.set(
        pluginDirName,
        setTimeout(async () => {
          this.reloadTimers.delete(pluginDirName);
          try {
            const manifest = this.readManifest(manifestPath);
            if (this.loaded.has(manifest.name)) {
              await this.reloadPlugin(manifest.name);
              console.log(`[PluginLoader] Hot-reloaded: ${manifest.name}`);
            } else {
              await this.loadPlugin(pluginDir);
              console.log(`[PluginLoader] Hot-loaded new: ${manifest.name}`);
            }
          } catch (err) {
            console.error(`[PluginLoader] Hot-reload failed for ${pluginDirName}:`, err);
          }
        }, 300),
      );
    });

    // 不阻止进程退出
    if (this.watcher && "unref" in this.watcher) {
      (this.watcher as { unref: () => void }).unref();
    }
  }

  /** 停止文件监听 */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.reloadTimers.values()) {
      clearTimeout(timer);
    }
    this.reloadTimers.clear();
  }

  /** 销毁加载器 */
  destroy(): void {
    this.stopWatching();
    // 卸载所有插件（逆序，避免依赖问题）
    const names = [...this.loaded.keys()].reverse();
    for (const name of names) {
      this.unloadPlugin(name);
    }
  }

  /** 读取并解析清单文件 */
  private readManifest(manifestPath: string): SkillManifest {
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as SkillManifest;

    if (!manifest.name) throw new Error(`Missing "name" in ${manifestPath}`);
    if (!manifest.version) throw new Error(`Missing "version" in ${manifestPath}`);
    if (!manifest.entry) throw new Error(`Missing "entry" in ${manifestPath}`);

    return manifest;
  }

  /** 动态导入处理函数 */
  private async importHandler(entryPath: string): Promise<SkillDefinition["handler"]> {
    // 使用 file:// URL + 唯一随机标识绕过 ESM 缓存（热加载需要）
    const url = pathToFileURL(entryPath).href + `?v=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const mod = await import(url);

    // 支持多种导出方式：export default handler / export { handler } / module.exports = handler
    const handler = mod.default ?? mod.handler;
    if (typeof handler !== "function") {
      throw new Error(`Entry file must export a handler function: ${entryPath}`);
    }

    return handler;
  }

  /** P2 修复：验证插件文件完整性 */
  private verifyChecksum(manifest: SkillManifest, entryPath: string): void {
    const expected = manifest.checksum;
    if (!expected) {
      // 无校验和时，生产环境警告（可配置为拒绝）
      if (process.env.NODE_ENV === "production") {
        console.warn(`[PluginLoader] Warning: Skill "${manifest.name}" lacks checksum verification`);
      }
      return;
    }

    const content = readFileSync(entryPath, "utf-8");
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== expected) {
      throw new Error(
        `Checksum mismatch for "${manifest.name}": expected ${expected.slice(0, 16)}..., got ${actual.slice(0, 16)}...`
      );
    }
  }

  private emit(event: PluginEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 监听器异常不影响核心流程
      }
    }
  }
}
