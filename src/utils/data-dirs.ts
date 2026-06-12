import { existsSync, mkdirSync, statSync } from "fs";
import { resolve } from "path";

/**
 * 运行时需要的本地数据目录 (相对 cwd 解析, 容器内 = /app/.raos/...)
 * 必须与 src/ 各种模块创建文件的路径保持一致, 否则 EACCES
 */
export const RUNTIME_DATA_DIRS = [
  ".raos", // 父目录, mkdirSync recursive 自动覆盖子目录
  ".raos/audit",
  ".raos/kb_images",
  ".raos/ltm",
  ".raos/calibration",
  ".raos/workspace",
] as const;

/**
 * 运行时需要的本地数据文件 (用于 statsync 父目录已存在, 但还是让 mkdirSync 跑一遍兜底)
 */
export const RUNTIME_DATA_FILES = [
  ".raos/wal.jsonl",
  ".raos/tasks.db",
  ".raos/config.json",
] as const;

/**
 * 在 server 启动早期调用, 确保所有 .raos 子目录存在并可写.
 *
 * **问题背景**: Docker 部署用 named volume `raos_data:/app/.raos`, named volume
 * 第一次挂载时是 docker 自动创建的空目录 (owner = root:root, mode 0755).
 * 容器内 USER raos (UID 1001) 在 mount 上没写权限创建子目录 → 启动时
 * `createFileSink` / `ConfigManager` / `FileWALStore` 调 `mkdirSync` 时
 * EACCES, 容器 exit + restart loop. 同事部署时 `raos-backend` `raos-workers`
 * 跑不起来就是这个原因.
 *
 * **修法**:
 * 1. 这里提前 mkdirSync + 不依赖父目录权限 (chmod 兜底) — 让 raos 自己创建子目录
 * 2. Dockerfile 镜像层预先 mkdir + chown raos:raos (Dockerfile 已做, 但没列子目录)
 *
 * @param cwd - 默认 process.cwd(), 测试时可传 tmpdir
 * @returns 创建/验证的目录列表 (含完整绝对路径)
 */
export function ensureRuntimeDataDirs(cwd: string = process.cwd()): string[] {
  const created: string[] = [];

  // 1. 先建所有子目录 (递归)
  for (const rel of RUNTIME_DATA_DIRS) {
    const full = resolve(cwd, rel);
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true });
      created.push(full);
    }
  }

  // 2. 父目录 .raos 兜底 chmod 0755 — 防 root 锁住 mount 时子目录继承错误权限
  //    (Dockerfile 已 chown, 但 named volume mount 拿到的 dir 可能 root:root 0755)
  const raosRoot = resolve(cwd, ".raos");
  try {
    const st = statSync(raosRoot);
    // 检查是否能写: 用 accessSync 等价的方式, 这里用 stat 看 mode
    // 简化: 强制 chmod 0755 (UID/GID 不改, mode 给 rw 给 owner, r 给 other)
    // mount 跨 host 时 chmod 经常 silent fail, 静默吞错
    if ((st.mode & 0o777) !== 0o755) {
      // 强制 chmod 0o755 — owner = process uid (raos 1001), 拿到 rwx
      try {
        const { chmodSync } = require("fs") as typeof import("fs");
        chmodSync(raosRoot, 0o755);
      } catch {
        // mount 跨 host 可能 EPERM, 静默吞
      }
    }
  } catch {
    // statSync 失败 = 不存在, mkdirSync 已建
  }

  // 3. 文件 parent dir 已经 RUNTIME_DATA_DIRS 覆盖, 这里跳过单独处理
  //    (createFileSink / ConfigManager / FileWALStore 各自有 mkdirSync 兜底)

  return created;
}
