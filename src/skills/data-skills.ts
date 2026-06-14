/**
 * 数据操作 Skill 家族
 *
 * 文件系统、HTTP 客户端、SQLite 查询 — 让智能体能与外部系统交互。
 * 所有操作都注册为标准 Skill，可被 Agent 自主调用。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync } from "fs";
import { join, dirname, resolve } from "path";
import { createHash } from "crypto";
import { defineSkill, defineSystemSkill } from "../types/index.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";
import type { SkillRegistry } from "../registry/index.js";
import { getCurrentUserId } from "../user/request-context.js";
import { isMySQL } from "../db/database.js";

// MySQL adapter helper
async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import('../db/mysql-adapter.js');
  return getAdapter();
}

// ===== 安全限制 =====

/** 全局 workspace 根目录（安全边界） */
const SAFE_BASE = resolve(process.cwd(), ".raos", "workspace");

/** 获取当前用户的个人 workspace 目录 */
function getUserWorkspace(): string {
  const userId = getCurrentUserId();
  const userBase = resolve(SAFE_BASE, userId);
  mkdirSync(userBase, { recursive: true });
  return userBase;
}

/** 将相对路径解析到当前用户的 workspace 中（安全检查） */
function ensureSafePath(path: string): string {
  const userBase = getUserWorkspace();
  const resolved = resolve(userBase, path);
  // 安全边界：不允许越出全局 workspace
  if (!resolved.startsWith(SAFE_BASE)) {
    throw new Error(`路径安全违规: 不允许访问 workspace 外的文件 (${path})`);
  }
  return resolved;
}

/** 返回相对于全局 workspace 的路径（用于 download URL） */
function toRelativePath(absPath: string): string {
  return absPath.slice(SAFE_BASE.length + 1); // strip SAFE_BASE + "/"
}

/** 检查文件是否为敏感文件（禁止读取） */
function isSensitiveFile(filePath: string): boolean {
  const basename = filePath.split("/").pop()?.toLowerCase() || "";
  // 禁止读取 .env 及环境配置文件
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  // 禁止读取包含敏感关键词的文件
  const sensitivePatterns = [
    "secret", "password", "token", "credential", "private_key", "api_key", "apikey",
    "passphrase", "auth", "key.pem", "cert.pem", ".pfx", ".p12",
  ];
  for (const pattern of sensitivePatterns) {
    if (basename.includes(pattern)) return true;
  }
  return false;
}

/** 扫描文件内容是否包含敏感信息模式 */
function containsSensitivePatterns(content: string): boolean {
  const patterns = [
    /password\s*[:=]\s*\S+/i,
    /host\s*[:=]\s*[\w.]+/i,
    /database\s*[:=]\s*\S+/i,
    /connection\s*[:=]\s*\{/i,
    /api[_-]?key\s*[:=]\s*\S+/i,
    /secret\s*[:=]\s*\S+/i,
    /private[_-]?key\s*[:=]\s*\S+/i,
  ];
  let matchCount = 0;
  for (const p of patterns) {
    if (p.test(content)) matchCount++;
  }
  // 至少匹配 2 个模式才判定为敏感（降低误报）
  return matchCount >= 2;
}

// ===== 文档格式强制转换 =====
const BINARY_DOC_EXTS = [".pptx", ".ppt", ".docx", ".doc", ".pdf"];

/** 如果路径是二进制文档扩展名且 content 是文本，强制改为 .md */
function forceMarkdownExt(relPath: string, content?: string): { relPath: string; content: string | undefined; converted: boolean } {
  const lower = relPath.toLowerCase();
  const isBinaryExt = BINARY_DOC_EXTS.some((e) => lower.endsWith(e));
  if (!isBinaryExt || !content || typeof content !== "string") {
    return { relPath, content, converted: false };
  }
  const oldExt = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
  const newPath = relPath.slice(0, relPath.lastIndexOf(".")) + ".md";
  // PPT 类型自动加 frontmatter
  let newContent = content;
  if ((oldExt === ".pptx" || oldExt === ".ppt") && !content.includes("\n---\n")) {
    newContent = "---\ntheme: business-blue\n---\n" + content;
  }
  return { relPath: newPath, content: newContent, converted: true };
}

// ===== 文件系统 Skills =====

function createFileSkills(registry: SkillRegistry): void {
  // 确保工作空间目录存在
  mkdirSync(SAFE_BASE, { recursive: true });

  registry.register(
    defineSystemSkill({
      name: "file_read",
      description: "读取文件内容。参数: path(string, 相对于 workspace), encoding?(string, 默认 utf-8)",
      paramSchema: {
        properties: {
          path: { type: "string", description: "File path relative to workspace" },
          encoding: { type: "string", description: "File encoding (default: utf-8)" },
        },
        required: ["path"],
      },
      handler: async (params) => {
        const path = ensureSafePath(params.path as string);
        if (!existsSync(path)) {
          return { success: false, error: new Error(`文件不存在: ${params.path}`) };
        }
        // 安全检查：禁止读取敏感文件
        if (isSensitiveFile(path)) {
          return { success: false, error: new Error(`安全限制: 该文件包含敏感信息，禁止读取`) };
        }
        const encoding = (params.encoding as BufferEncoding) ?? "utf-8";
        const content = readFileSync(path, encoding);
        // 内容安全检查：扫描敏感信息模式
        if (containsSensitivePatterns(content)) {
          return { success: false, error: new Error(`安全限制: 文件内容可能包含敏感信息（如数据库连接密码等），禁止读取`) };
        }
        const stat = statSync(path);
        return {
          success: true,
          data: {
            content,
            size: stat.size,
            modifiedAt: stat.mtimeMs,
          },
        };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "file_write",
      description: "写入文件内容（覆盖）。参数: path(string, 相对于 workspace), content(string), encoding?(string)。注意：文档/PPT 请使用 .md 格式，禁止 .pptx/.docx/.pdf。",
      paramSchema: {
        properties: {
          path: { type: "string", description: "File path relative to workspace" },
          content: { type: "string", description: "Content to write" },
          encoding: { type: "string", description: "File encoding (default: utf-8)" },
        },
        required: ["path", "content"],
      },
      handler: async (params) => {
        // 强制拦截二进制文档格式
        const forced = forceMarkdownExt(params.path as string, params.content as string);
        const filePath = ensureSafePath(forced.relPath);
        mkdirSync(dirname(filePath), { recursive: true });
        const encoding = (params.encoding as BufferEncoding) ?? "utf-8";
        const content = forced.content ?? (params.content as string);
        writeFileSync(filePath, content, encoding);
        const wsRelPath = toRelativePath(filePath);
        return {
          success: true,
          data: { path: wsRelPath, size: Buffer.byteLength(content, encoding) },
        };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "file_append",
      description: "追加内容到文件末尾。参数: path(string), content(string)",
      paramSchema: {
        properties: {
          path: { type: "string", description: "File path relative to workspace" },
          content: { type: "string", description: "Content to append" },
        },
        required: ["path", "content"],
      },
      handler: async (params) => {
        const path = ensureSafePath(params.path as string);
        mkdirSync(dirname(path), { recursive: true });
        const { appendFileSync } = await import("fs");
        appendFileSync(path, params.content as string, "utf-8");
        return { success: true, data: { path: params.path, appended: true } };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "file_delete",
      description: "删除文件。参数: path(string, 相对于 workspace)",
      paramSchema: {
        properties: {
          path: { type: "string", description: "File path relative to workspace" },
        },
        required: ["path"],
      },
      handler: async (params) => {
        const path = ensureSafePath(params.path as string);
        if (!existsSync(path)) {
          return { success: false, error: new Error(`文件不存在: ${params.path}`) };
        }
        unlinkSync(path);
        return { success: true, data: { deleted: params.path } };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "file_list",
      description: "列出目录下的文件和子目录。参数: path?(string, 默认根目录), recursive?(boolean, 默认 false)",
      paramSchema: {
        properties: {
          path: { type: "string", description: "Directory path relative to workspace (default: root)" },
          recursive: { type: "boolean", description: "Whether to list recursively (default: false)" },
        },
      },
      handler: async (params) => {
        const basePath = ensureSafePath((params.path as string) ?? ".");
        if (!existsSync(basePath)) {
          return { success: false, error: new Error(`目录不存在: ${params.path ?? "."}`) };
        }

        const recursive = params.recursive as boolean ?? false;
        const entries: Array<{ name: string; type: "file" | "directory"; size?: number }> = [];

        function scan(dir: string, prefix: string): void {
          const items = readdirSync(dir);
          for (const item of items) {
            const fullPath = join(dir, item);
            const stat = statSync(fullPath);
            const relativeName = prefix ? `${prefix}/${item}` : item;
            if (stat.isDirectory()) {
              entries.push({ name: relativeName, type: "directory" });
              if (recursive) scan(fullPath, relativeName);
            } else {
              entries.push({ name: relativeName, type: "file", size: stat.size });
            }
          }
        }

        scan(basePath, "");
        return { success: true, data: { entries, count: entries.length } };
      },
    }),
  );
}

// ===== 文件下载/提供 Skills =====

function createFileProvideSkills(registry: SkillRegistry): void {
  registry.register(
    defineSystemSkill({
      name: "file_provide",
      description:
        `向用户提供文件下载。先检查 workspace 中是否存在该文件，存在则返回下载信息；不存在则创建文件后返回。系统会自动渲染下载卡片，回复中不要再重复输出下载链接。
参数: path(string, 相对于 workspace 的路径), content?(string, 文件不存在时创建), filename?(string, 下载时显示的文件名)。
生成 PPT 时使用 markdown 格式：\`---\` 分隔幻灯片，开头可加 frontmatter 指定主题（如 theme: business-blue）。可选主题: business-blue / tech-dark / minimal-white / vibrant-orange / academic-green，也可调用 pptx_list_themes 查看自定义主题。`,
      handler: async (params) => {
        let relPath = params.path as string;
        if (!relPath) {
          return { success: false, error: new Error("path 参数必填") };
        }
        console.log("[file_provide] input:", { path: relPath, hasContent: !!params.content, contentType: typeof params.content, filename: params.filename });

        const isBinaryExt = BINARY_DOC_EXTS.some((e) => relPath.toLowerCase().endsWith(e));

        // 场景 1：有 content → 用 forceMarkdownExt 转换后创建
        if (params.content && typeof params.content === "string") {
          const forced = forceMarkdownExt(relPath, params.content as string);
          relPath = forced.relPath;
          params.content = forced.content;
          if (params.filename && forced.converted) {
            const fn = params.filename as string;
            params.filename = fn.slice(0, fn.lastIndexOf(".")) + ".md";
          }
        }
        // 场景 2：没有 content，但路径是二进制文档扩展名 → 检查是否有对应 .md 文件或旧文件可读
        else if (isBinaryExt) {
          const mdRelPath = relPath.slice(0, relPath.lastIndexOf(".")) + ".md";
          const mdAbsPath = ensureSafePath(mdRelPath);
          const oldAbsPath = ensureSafePath(relPath);
          // 如果 .md 已存在，直接用 .md
          if (existsSync(mdAbsPath)) {
            relPath = mdRelPath;
          }
          // 如果旧二进制文件存在且内容是文本，重命名为 .md
          else if (existsSync(oldAbsPath)) {
            try {
              const buf = readFileSync(oldAbsPath);
              const isText = !buf.some((b) => b === 0); // 简单判断：无 null 字节即为文本
              if (isText) {
                renameSync(oldAbsPath, mdAbsPath);
                relPath = mdRelPath;
              }
            } catch { /* 保持原路径 */ }
          }
          if (params.filename && relPath.endsWith(".md")) {
            const fn = params.filename as string;
            if (BINARY_DOC_EXTS.some((e) => fn.toLowerCase().endsWith(e))) {
              params.filename = fn.slice(0, fn.lastIndexOf(".")) + ".md";
            }
          }
        }

        // 确保 filename 也强制转为 .md（LLM 可能 path 用了 .md 但 filename 仍是 .pptx）
        if (params.filename && typeof params.filename === "string") {
          const fnLower = (params.filename as string).toLowerCase();
          if (BINARY_DOC_EXTS.some((e) => fnLower.endsWith(e))) {
            params.filename = (params.filename as string).slice(0, (params.filename as string).lastIndexOf(".")) + ".md";
          }
        }

        const absPath = ensureSafePath(relPath);
        const displayName = (params.filename as string) || relPath.split("/").pop() || relPath;

        // 如果文件不存在且提供了 content，则创建
        if (!existsSync(absPath) && params.content) {
          mkdirSync(dirname(absPath), { recursive: true });
          writeFileSync(absPath, params.content as string, "utf-8");
        }

        if (!existsSync(absPath)) {
          return { success: false, error: new Error(`文件不存在: ${relPath}`) };
        }

        const wsRelPath = toRelativePath(absPath);
        const stat = statSync(absPath);
        const ext = displayName.includes(".") ? displayName.slice(displayName.lastIndexOf(".")).toLowerCase() : "";
        console.log("[file_provide] output:", { relPath, wsRelPath, displayName, ext, absPath: absPath.slice(-50) });

        return {
          success: true,
          data: {
            __type: "file_download",
            files: [{
              name: displayName,
              path: wsRelPath,
              size: stat.size,
              ext,
              downloadUrl: `/api/download?path=${encodeURIComponent(wsRelPath)}`,
              contentUrl: ext === ".md" ? `/api/file/content?path=${encodeURIComponent(wsRelPath)}` : undefined,
            }],
          },
        };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "file_provide_multi",
      description:
        "向用户提供多个文件的打包下载。系统会自动渲染可视化下载卡片，你在回复文本中不要再重复输出下载链接。参数: files(Array<{path: string, filename?: string}>), zipName?(string, 压缩包名称，默认 files.zip)",
      handler: async (params) => {
        const files = params.files as Array<{ path: string; filename?: string }>;
        if (!files || !Array.isArray(files) || files.length === 0) {
          return { success: false, error: new Error("files 参数必填且不能为空数组") };
        }

        const zipName = (params.zipName as string) || "files.zip";
        const fileInfos: Array<{ name: string; path: string; size: number; ext: string; downloadUrl: string }> = [];

        const wsRelPaths: string[] = [];
        for (const f of files) {
          const absPath = ensureSafePath(f.path);
          if (!existsSync(absPath)) {
            return { success: false, error: new Error(`文件不存在: ${f.path}`) };
          }
          const wsRelPath = toRelativePath(absPath);
          wsRelPaths.push(wsRelPath);
          const stat = statSync(absPath);
          const name = f.filename || f.path.split("/").pop() || f.path;
          const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
          fileInfos.push({
            name,
            path: wsRelPath,
            size: stat.size,
            ext,
            downloadUrl: `/api/download?path=${encodeURIComponent(wsRelPath)}`,
          });
        }

        return {
          success: true,
          data: {
            __type: "file_download",
            files: fileInfos,
            zipDownloadUrl: "/api/download/zip",
            zipName,
            zipPaths: wsRelPaths,
          },
        };
      },
    }),
  );
}

// ===== 文件上传 Skills =====

async function createUploadSkills(registry: SkillRegistry): Promise<void> {
  const UPLOAD_DIR = resolve(SAFE_BASE, "uploads");
  mkdirSync(UPLOAD_DIR, { recursive: true });

  // SQLite 上传元数据数据库（仅 SQLite 模式使用）
  let uploadDb: any = null;
  if (!isMySQL()) {
    try {
      const { default: Database } = await import("better-sqlite3");
      const dbPath = resolve(process.cwd(), ".raos", "uploads.db");
      uploadDb = new Database(dbPath);
      uploadDb.pragma("journal_mode = WAL");
      uploadDb.exec(`
        CREATE TABLE IF NOT EXISTS uploads (
          id TEXT PRIMARY KEY,
          original_name TEXT NOT NULL,
          stored_name TEXT NOT NULL,
          path TEXT NOT NULL,
          size INTEGER NOT NULL,
          mime_type TEXT,
          uploaded_by TEXT DEFAULT 'system',
          uploaded_at INTEGER NOT NULL,
          tags TEXT DEFAULT '[]',
          description TEXT DEFAULT ''
        )
      `);
    } catch {
      // better-sqlite3 不可用时退化为纯文件模式
    }
  }

  registry.register(
    defineSystemSkill({
      name: "file_upload",
      description:
        "上传文件到工作空间。参数: filename(string, 原始文件名), content(string, base64编码的文件内容), description?(string), tags?(string[]), uploadedBy?(string), targetDir?(string, 相对workspace的目标文件夹路径)",
      handler: async (params) => {
        const filename = params.filename as string;
        const content = params.content as string;
        const mode = (params.mode as string) ?? "auto"; // "auto" | "overwrite" | "new_version"
        if (!filename || !content) {
          return { success: false, error: new Error("filename 和 content 参数必填") };
        }

        try {
          // 按用户隔离上传目录，或使用指定的目标文件夹
          const uploadedBy = (params.uploadedBy as string) ?? "default";
          const targetDir = params.targetDir as string | undefined;
          let userUploadDir: string;
          let relativePrefix: string;
          if (targetDir) {
            userUploadDir = resolve(SAFE_BASE, targetDir);
            if (!userUploadDir.startsWith(SAFE_BASE)) {
              return { success: false, error: new Error("路径安全违规") };
            }
            relativePrefix = targetDir;
          } else {
            userUploadDir = resolve(UPLOAD_DIR, uploadedBy);
            relativePrefix = `uploads/${uploadedBy}`;
          }
          mkdirSync(userUploadDir, { recursive: true });

          // 安全文件名处理：保留字母数字、中文、日文、韩文、空格、常见标点
          const safeName = filename.replace(/[^a-zA-Z0-9_\-.\s()\[\]{}（）【】「」《》、，。！？;:\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g, "_");
          const ext = safeName.includes(".") ? safeName.slice(safeName.lastIndexOf(".")) : "";
          const baseName = safeName.slice(0, safeName.lastIndexOf(".")) || safeName;

          // 解码 base64
          const buffer = Buffer.from(content, "base64");
          const fileHash = createHash("md5").update(buffer).digest("hex");

          // 从文件名还原原始名（去时间戳）
          const stripTs = (n: string) => n.replace(/_\d{10,15}(\.[^.]+)$/, "$1");

          // 扫描已有文件，检查内容重复和同名冲突
          let existingByHash: { name: string; path: string; size: number } | null = null;
          let existingByName: { name: string; path: string; size: number; hash: string } | null = null;
          try {
            const items = readdirSync(userUploadDir);
            for (const item of items) {
              if (item.startsWith(".")) continue;
              const itemPath = join(userUploadDir, item);
              try {
                const stat = statSync(itemPath);
                if (stat.isDirectory()) continue;
                const itemOriginal = stripTs(item);
                const itemHash = createHash("md5").update(readFileSync(itemPath)).digest("hex");

                // 内容完全相同
                if (itemHash === fileHash) {
                  existingByHash = { name: item, path: `${relativePrefix}/${item}`, size: stat.size };
                  break; // 内容一样，直接跳过
                }
                // 同名但内容不同（保留最新的记录用于冲突检测）
                if (itemOriginal === safeName && !existingByName) {
                  existingByName = { name: item, path: `${relativePrefix}/${item}`, size: stat.size, hash: itemHash };
                }
              } catch { /* skip */ }
            }
          } catch { /* dir not readable */ }

          // 1. 内容完全相同 → 跳过保存，返回已有文件
          if (existingByHash) {
            return {
              success: true,
              data: {
                id: "",
                filename,
                path: existingByHash.path,
                size: existingByHash.size,
                duplicate: "same_content",
                message: `文件内容已存在，无需重复上传`,
              },
            };
          }

          // 2. 同名但内容不同 → 根据 mode 决定
          if (existingByName && mode === "auto") {
            // 返回冲突信息让前端决定
            return {
              success: true,
              data: {
                id: "",
                filename,
                path: existingByName.path,
                size: buffer.length,
                duplicate: "name_conflict",
                existingPath: existingByName.path,
                message: `同名文件已存在但内容不同`,
              },
            };
          }

          // 3. 同名且选择覆盖 → 删除旧文件
          if (existingByName && mode === "overwrite") {
            const oldPath = join(userUploadDir, existingByName.name);
            try { if (existsSync(oldPath)) unlinkSync(oldPath); } catch { /* ignore */ }
            if (isMySQL()) {
              try { 
                const adapter = await getMySQLAdapter();
                await adapter.execute("DELETE FROM uploads WHERE stored_name = ?", [existingByName.name]); 
              } catch { /* ignore */ }
            } else if (uploadDb) {
              try { uploadDb.prepare("DELETE FROM uploads WHERE stored_name = ?").run(existingByName.name); } catch { /* ignore */ }
            }
          }

          // 4. 保存新文件
          const id = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const storedName = `${baseName}_${Date.now()}${ext}`;
          const filePath = join(userUploadDir, storedName);

          if (!resolve(filePath).startsWith(userUploadDir)) {
            return { success: false, error: new Error("路径安全违规") };
          }

          writeFileSync(filePath, buffer);

          const relativePath = `${relativePrefix}/${storedName}`;
          const tags = (params.tags as string[]) ?? [];
          const description = (params.description as string) ?? "";

          // 持久化元数据
          if (isMySQL()) {
            try {
              const adapter = await getMySQLAdapter();
              await adapter.execute(
                `INSERT INTO uploads (id, original_name, stored_name, path, size, mime_type, uploaded_by, uploaded_at, tags, description)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  id,
                  filename,
                  storedName,
                  relativePath,
                  buffer.length,
                  guessMimeType(ext),
                  (params.uploadedBy as string) ?? "system",
                  Date.now(),
                  JSON.stringify(tags),
                  description,
                ]
              );
            } catch { /* 元数据保存失败不影响文件上传 */ }
          } else if (uploadDb) {
            try {
              uploadDb.prepare(
                `INSERT INTO uploads (id, original_name, stored_name, path, size, mime_type, uploaded_by, uploaded_at, tags, description)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              ).run(
                id,
                filename,
                storedName,
                relativePath,
                buffer.length,
                guessMimeType(ext),
                (params.uploadedBy as string) ?? "system",
                Date.now(),
                JSON.stringify(tags),
                description,
              );
            } catch { /* 元数据保存失败不影响文件上传 */ }
          }

          return {
            success: true,
            data: {
              id,
              filename,
              path: relativePath,
              size: buffer.length,
              fileHash,
              message: mode === "overwrite"
                ? `文件已覆盖更新`
                : `文件已上传，可通过 file_read 或 doc_read 使用路径 "${relativePath}" 访问`,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "file_upload_list",
      description: "列出所有已上传的文件。参数: query?(string, 搜索文件名或描述), limit?(number, 默认 50)",
      handler: async (params) => {
        const limit = (params.limit as number) ?? 50;
        const query = params.query as string | undefined;

        // 优先从数据库查询
        if (isMySQL()) {
          try {
            const adapter = await getMySQLAdapter();
            let rows: any[];
            if (query) {
              rows = await adapter.query(
                `SELECT * FROM uploads WHERE original_name LIKE ? OR description LIKE ? ORDER BY uploaded_at DESC LIMIT ?`,
                [`%${query}%`, `%${query}%`, limit]
              );
            } else {
              rows = await adapter.query("SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT ?", [limit]);
            }

            return {
              success: true,
              data: {
                files: rows.map((r: any) => ({
                  ...r,
                  tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags ?? [],
                })),
                total: rows.length,
              },
            };
          } catch { /* fallback to filesystem */ }
        } else if (uploadDb) {
          try {
            let rows: any[];
            if (query) {
              rows = uploadDb
                .prepare(
                  `SELECT * FROM uploads WHERE original_name LIKE ? OR description LIKE ? ORDER BY uploaded_at DESC LIMIT ?`,
                )
                .all(`%${query}%`, `%${query}%`, limit);
            } else {
              rows = uploadDb.prepare("SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT ?").all(limit);
            }

            return {
              success: true,
              data: {
                files: rows.map((r: any) => ({
                  ...r,
                  tags: JSON.parse(r.tags ?? "[]"),
                })),
                total: rows.length,
              },
            };
          } catch { /* fallback to filesystem */ }
        }

        // 回退：直接读取文件系统
        if (!existsSync(UPLOAD_DIR)) {
          return { success: true, data: { files: [], total: 0 } };
        }
        const files = readdirSync(UPLOAD_DIR).map((name) => {
          const stat = statSync(join(UPLOAD_DIR, name));
          return { stored_name: name, path: `uploads/${name}`, size: stat.size, uploaded_at: stat.mtimeMs };
        });
        return { success: true, data: { files: files.slice(0, limit), total: files.length } };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "file_upload_delete",
      description: "删除已上传的文件。参数: path(string, 如 uploads/xxx.pdf) 或 id(string, 上传记录 ID)",
      handler: async (params) => {
        const id = params.id as string | undefined;
        const path = params.path as string | undefined;

        if (!id && !path) {
          return { success: false, error: new Error("需要提供 id 或 path 参数") };
        }

        let storedName: string | undefined;
        if (id) {
          if (isMySQL()) {
            try {
              const adapter = await getMySQLAdapter();
              const rows = await adapter.query("SELECT stored_name FROM uploads WHERE id = ?", [id]);
              if (rows[0]) storedName = rows[0].stored_name;
            } catch { /* ignore */ }
          } else if (uploadDb) {
            const row = uploadDb.prepare("SELECT stored_name FROM uploads WHERE id = ?").get(id) as any;
            if (row) storedName = row.stored_name;
          }
        } else if (path) {
          storedName = path.replace(/^uploads\//, "");
        }

        if (!storedName) {
          return { success: false, error: new Error("未找到该上传记录") };
        }

        const filePath = resolve(UPLOAD_DIR, storedName);
        if (!filePath.startsWith(UPLOAD_DIR)) {
          return { success: false, error: new Error("路径安全违规") };
        }

        try {
          if (existsSync(filePath)) unlinkSync(filePath);
          if (isMySQL()) {
            try {
              const adapter = await getMySQLAdapter();
              await adapter.execute("DELETE FROM uploads WHERE stored_name = ? OR id = ?", [storedName, id ?? ""]);
            } catch { /* ignore */ }
          } else if (uploadDb) {
            uploadDb.prepare("DELETE FROM uploads WHERE stored_name = ? OR id = ?").run(storedName, id ?? "");
          }
          return { success: true, data: { deleted: storedName } };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  // 搜索用户上传的文件并返回下载链接（支持模糊匹配，多个结果全部返回）
  registry.register(
    defineSystemSkill({
      name: "file_search",
      description:
        "搜索用户上传的文件。根据关键词模糊匹配文件名，返回所有匹配结果及下载链接。如果有多个相似文件，全部返回让用户选择。参数: query(string, 搜索关键词), limit?(number, 默认 10)",
      handler: async (params) => {
        const query = params.query as string;
        if (!query) return { success: false, error: new Error("query 参数必填") };
        const limit = (params.limit as number) ?? 10;
        const userId = getCurrentUserId();

        // 从文件名还原原始名
        const stripTimestamp = (name: string): string => name.replace(/_\d{10,15}(\.[^.]+)$/, "$1");

        // 搜索当前用户的上传目录
        const userDir = resolve(UPLOAD_DIR, userId);
        const results: Array<{ name: string; path: string; size: number; ext: string; downloadUrl: string }> = [];

        if (existsSync(userDir)) {
          const queryLower = query.toLowerCase();
          const queryChars = queryLower.split("");
          const items = readdirSync(userDir);
          for (const item of items) {
            if (item.startsWith(".")) continue;
            const fullPath = join(userDir, item);
            try {
              const stat = statSync(fullPath);
              if (stat.isDirectory()) continue;
              const originalName = stripTimestamp(item);
              const nameLower = originalName.toLowerCase();

              // 模糊匹配：包含关键词任意部分
              const match = nameLower.includes(queryLower) ||
                queryChars.every((c) => nameLower.includes(c));
              if (!match) continue;

              const wsRelPath = `uploads/${userId}/${item}`;
              const ext = item.includes(".") ? item.slice(item.lastIndexOf(".")).toLowerCase() : "";
              results.push({
                name: originalName,
                path: wsRelPath,
                size: stat.size,
                ext,
                downloadUrl: `/api/download?path=${encodeURIComponent(wsRelPath)}`,
              });
            } catch { /* skip */ }
          }
        }

        // 按文件名相关度排序（完全包含 > 部分匹配）
        const queryLower = query.toLowerCase();
        results.sort((a, b) => {
          const aExact = a.name.toLowerCase().includes(queryLower) ? 1 : 0;
          const bExact = b.name.toLowerCase().includes(queryLower) ? 1 : 0;
          return bExact - aExact;
        });

        const matched = results.slice(0, limit);

        if (matched.length === 0) {
          return { success: true, data: { message: `未找到与 "${query}" 相关的文件`, files: [], total: 0 } };
        }

        if (matched.length === 1) {
          // 只有一个匹配，直接作为 file_download 返回（前端会渲染下载卡片）
          return {
            success: true,
            data: {
              __type: "file_download",
              files: matched,
              message: `找到文件: ${matched[0].name}`,
            },
          };
        }

        // 多个匹配，全部返回让用户选择
        return {
          success: true,
          data: {
            __type: "file_download",
            files: matched,
            message: `找到 ${matched.length} 个相关文件，请选择需要的：`,
          },
        };
      },
    }),
  );
}

function guessMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".json": "application/json",
    ".xml": "text/xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

// ===== HTTP 客户端 Skill =====

/** 检查是否为内网地址 */
function isIntranetHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.startsWith("172.16.") ||
    host.startsWith("172.17.") ||
    host.startsWith("172.18.") ||
    host.startsWith("172.19.") ||
    host.startsWith("172.2") ||
    host.startsWith("172.30.") ||
    host.startsWith("172.31.") ||
    host.startsWith("169.254.") ||
    host === "::1"
  );
}

/** 检查是否在白名单中（支持精确匹配和 CIDR） */
function isWhitelisted(host: string): boolean {
  const whitelist = process.env.HTTP_INTRANET_WHITELIST ?? "";
  if (!whitelist) return false;

  const entries = whitelist.split(",").map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    // 精确匹配（域名或 IP）
    if (entry === host) return true;
    // CIDR 匹配（如 10.0.0.0/8）
    if (entry.includes("/") && matchCIDR(host, entry)) return true;
    // 通配符域名（如 *.company.com）
    if (entry.startsWith("*.") && host.endsWith(entry.slice(1))) return true;
  }
  return false;
}

/** CIDR 匹配 */
function matchCIDR(ip: string, cidr: string): boolean {
  try {
    const [range, bitsStr] = cidr.split("/");
    const bits = parseInt(bitsStr, 10);
    const ipParts = ip.split(".").map((n) => parseInt(n, 10));
    const rangeParts = range.split(".").map((n) => parseInt(n, 10));
    if (ipParts.length !== 4 || rangeParts.length !== 4) return false;

    let mask = 0;
    for (let i = 0; i < bits; i++) {
      mask |= 1 << (31 - i);
    }

    const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const rangeNum = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3];

    return (ipNum & mask) === (rangeNum & mask);
  } catch {
    return false;
  }
}

async function executeHttpRequest(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | object;
  timeout?: number;
}): Promise<{ success: boolean; data?: unknown; error?: Error }> {
  const url = params.url;
  if (!url) {
    return { success: false, error: new Error("url 参数必填") };
  }

  // 安全检查：默认禁止内网地址，但支持白名单
  const parsedUrl = new URL(url);
  const host = parsedUrl.hostname;
  if (isIntranetHost(host) && !isWhitelisted(host)) {
    return { success: false, error: new Error(`安全限制: 禁止访问内网地址 ${host}。如需访问，请联系管理员添加到 HTTP_INTRANET_WHITELIST 白名单。`) };
  }

  const method = (params.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = params.headers ?? {};
  const timeout = params.timeout ?? 30000;

  let body: string | undefined;
  if (params.body !== undefined) {
    if (typeof params.body === "object") {
      body = JSON.stringify(params.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    } else {
      body = String(params.body);
    }
  }

  try {
    const fetchOptions: Record<string, unknown> = {
      timeoutMs: timeout,
      method,
      headers,
      skipSsrfCheck: true, // skill 层已做白名单校验
    };
    // GET/HEAD 请求不能有 body，否则 Node.js fetch 会抛 TypeError
    if (body !== undefined && method !== "GET" && method !== "HEAD") {
      fetchOptions.body = body;
    }
    const response = await fetchWithTimeout(url, fetchOptions);

    const contentType = response.headers.get("content-type") ?? "";
    let responseBody: unknown;

    // HEAD 请求没有响应体，直接返回空
    if (method === "HEAD") {
      responseBody = "";
    } else if (contentType.includes("application/json")) {
      responseBody = await response.json();
    } else {
      const text = await response.text();
      // 限制响应体大小
      responseBody = text.length > 50000 ? text.substring(0, 50000) + "...[truncated]" : text;
    }

    return {
      success: response.ok,
      data: {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      },
      error: response.ok ? undefined : new Error(`HTTP ${response.status}: ${response.statusText}`),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

function createHttpSkills(registry: SkillRegistry): void {
  registry.register(
    defineSystemSkill({
      name: "http_call",
      description:
        "发起 HTTP 请求。参数: url(string), method?(string, 默认 GET), headers?(object), body?(string|object), timeout?(number, ms, 默认 30000)。注意：禁止访问内网地址和本地服务。",
      timeout: 60000,
      paramSchema: {
        properties: {
          url: { type: "string", description: "Target URL (must be a public address)" },
          method: { type: "string", description: "HTTP method (default: GET)", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
          headers: { type: "object", description: "Request headers as key-value pairs" },
          body: { type: ["string", "object"], description: "Request body (string or JSON object, auto-serialized)" },
          timeout: { type: "number", description: "Request timeout in milliseconds (default: 30000)" },
        },
        required: ["url"],
      },
      handler: async (params) => executeHttpRequest({
        url: params.url as string,
        method: params.method as string,
        headers: params.headers as Record<string, string>,
        body: params.body as string | object,
        timeout: params.timeout as number,
      }),
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "http_get",
      description: "发起 GET 请求（http_call 的快捷版）。参数: url(string), headers?(object)",
      timeout: 30000,
      handler: async (params) => executeHttpRequest({
        url: params.url as string,
        method: "GET",
        headers: params.headers as Record<string, string>,
        timeout: params.timeout as number,
      }),
    }),
  );

  // ===== IP 查询 Skills =====

  registry.register(
    defineSystemSkill({
      name: "ip_lookup",
      description: "查询当前设备的公网 IP 地址。无需参数，返回 { ip: string }。",
      timeout: 15000,
      handler: async () => {
        const providers = [
          { url: "https://icanhazip.com", parser: (text: string) => text.trim() },
          { url: "https://ident.me", parser: (text: string) => text.trim() },
        ];
        for (const provider of providers) {
          try {
            const result = await executeHttpRequest({ url: provider.url, method: "GET", timeout: 8000 });
            if (result.success && result.data && (result.data as any).body) {
              const ip = provider.parser(String((result.data as any).body));
              if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
                return { success: true, data: { ip, source: provider.url } };
              }
            }
          } catch { /* try next provider */ }
        }
        return { success: false, error: new Error("无法获取公网 IP，所有提供商均不可用") };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "geo_ip",
      description: "根据 IP 地址查询地理位置信息。参数: ip(string)。返回 { country, countryCode, region, regionName, city, zip, lat, lon, timezone, isp, org, as }。",
      timeout: 15000,
      paramSchema: {
        properties: {
          ip: { type: "string", description: "要查询的 IP 地址（IPv4 或 IPv6）" },
        },
        required: ["ip"],
      },
      handler: async (params) => {
        const ip = (params.ip as string || "").trim();
        if (!ip) {
          return { success: false, error: new Error("ip 参数必填") };
        }
        // ip-api.com 免费端点仅支持 HTTP
        const url = `http://ip-api.com/json/${encodeURIComponent(ip)}`;
        try {
          const result = await executeHttpRequest({ url, method: "GET", timeout: 10000 });
          if (!result.success) {
            return result;
          }
          const body = (result.data as any)?.body;
          if (body && body.status === "fail") {
            return { success: false, error: new Error(body.message || "IP 定位失败") };
          }
          if (body && body.status === "success") {
            return {
              success: true,
              data: {
                ip: body.query,
                country: body.country,
                countryCode: body.countryCode,
                region: body.region,
                regionName: body.regionName,
                city: body.city,
                zip: body.zip,
                lat: body.lat,
                lon: body.lon,
                timezone: body.timezone,
                isp: body.isp,
                org: body.org,
                as: body.as,
              },
            };
          }
          return { success: false, error: new Error("IP 定位服务返回无效数据") };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );
}

// ===== Shell 命令 Skill（受限） =====

function createShellSkills(registry: SkillRegistry): void {
  registry.register(
    defineSystemSkill({
      name: "shell_exec",
      description:
        "在安全沙箱中执行 shell 命令。参数: command(string), cwd?(string, 相对于 workspace), timeout?(number, ms, 默认 10000)。仅允许安全命令。",
      timeout: 30000,
      paramSchema: {
        properties: {
          command: { type: "string", description: "Shell command to execute (only safe commands allowed)" },
          cwd: { type: "string", description: "Working directory relative to workspace (default: workspace root)" },
          timeout: { type: "number", description: "Execution timeout in milliseconds (default: 10000)" },
        },
        required: ["command"],
      },
      handler: async (params) => {
        const { execSync } = await import("child_process");

        const command = params.command as string;
        if (!command) {
          return { success: false, error: new Error("command 参数必填") };
        }

        // 安全检查：命令白名单（只允许安全命令）
        const allowedCommands = [
          "ls", "cat", "head", "tail", "grep", "find", "wc", "sort", "uniq",
          "echo", "pwd", "date", "whoami", "mkdir", "touch", "cp", "mv",
          "npm", "node", "npx", "git", "python", "python3", "pip",
        ];
        const cmdBase = command.trim().split(/\s+/)[0];
        if (!allowedCommands.includes(cmdBase)) {
          return { success: false, error: new Error(`安全限制: 命令 "${cmdBase}" 不在白名单中。只允许: ${allowedCommands.join(", ")}`) };
        }
        // 额外黑名单检查（防止管道组合绕过）
        const dangerousPatterns = ["rm -rf /", "mkfs", "dd if=/dev/zero", ":(){ :|:&};:", "> /dev/sda", "curl.*\\|.*sh", "wget.*\\|.*sh"];
        for (const pattern of dangerousPatterns) {
          if (new RegExp(pattern, "i").test(command)) {
            return { success: false, error: new Error(`安全限制: 禁止执行危险命令组合`) };
          }
        }

        const cwd = params.cwd ? ensureSafePath(params.cwd as string) : SAFE_BASE;
        const timeout = (params.timeout as number) ?? 10000;

        try {
          const output = execSync(command, {
            cwd,
            timeout,
            encoding: "utf-8",
            maxBuffer: 1024 * 1024, // 1MB
            env: { ...process.env, PATH: process.env.PATH },
          });

          return {
            success: true,
            data: {
              stdout: output.length > 10000 ? output.substring(0, 10000) + "...[truncated]" : output,
              exitCode: 0,
            },
          };
        } catch (err: any) {
          return {
            success: false,
            data: {
              stdout: err.stdout?.substring(0, 5000),
              stderr: err.stderr?.substring(0, 5000),
              exitCode: err.status,
            },
            error: new Error(err.stderr?.substring(0, 500) || err.message),
          };
        }
      },
    }),
  );
}

// ===== PPTX 风格学习 Skills =====

function createPptxThemeSkills(registry: SkillRegistry): void {
  registry.register(
    defineSystemSkill({
      name: "pptx_learn_style",
      description:
        "从 workspace 中的 PPTX 文件学习风格（提取配色方案和字体），保存为自定义主题。参数: filePath(string, workspace 中的 PPTX 文件路径), name?(string, 主题名称，默认用文件名)",
      handler: async (params) => {
        const filePath = params.filePath as string;
        if (!filePath) {
          return { success: false, error: new Error("filePath 参数必填") };
        }

        const absPath = ensureSafePath(filePath);
        if (!existsSync(absPath)) {
          return { success: false, error: new Error(`文件不存在: ${filePath}`) };
        }
        if (!absPath.toLowerCase().endsWith(".pptx")) {
          return { success: false, error: new Error("仅支持 .pptx 文件") };
        }

        try {
          const { extractPptxStyle } = await import("../services/pptx-style-extractor.js");
          const { getDb } = await import("../db/database.js");

          const buffer = readFileSync(absPath);
          const sourceFile = filePath.split("/").pop() || filePath;
          const style = await extractPptxStyle(buffer, sourceFile, params.name as string | undefined);

          const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const userId = getCurrentUserId();

          if (isMySQL()) {
            const adapter = await getMySQLAdapter();
            await adapter.execute(
              "INSERT INTO custom_pptx_themes (id, user_id, name, colors_json, fonts_json, source_file, created_at) VALUES (?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP() * 1000)",
              [id, userId, style.name, JSON.stringify(style.colors), JSON.stringify(style.fonts), style.sourceFile]
            );
          } else {
            const { getDb } = await import('../db/database.js');
            getDb().prepare(
              "INSERT INTO custom_pptx_themes (id, user_id, name, colors_json, fonts_json, source_file) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(id, userId, style.name, JSON.stringify(style.colors), JSON.stringify(style.fonts), style.sourceFile);
          }

          return {
            success: true,
            data: {
              themeId: id,
              name: style.name,
              colors: style.colors,
              fonts: style.fonts,
              sourceFile: style.sourceFile,
              message: `已从 "${sourceFile}" 学习风格并保存为自定义主题 "${style.name}"（ID: ${id}）。生成 PPT 时在 frontmatter 中使用 theme: ${id} 即可应用。`,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "pptx_list_themes",
      description: "列出所有可用的 PPTX 主题（包括内置主题和用户自定义主题）。无参数。",
      handler: async (params) => {
        try {
          // 内置主题
          const builtIn = [
            { name: "business-blue", label: "商务蓝", custom: false },
            { name: "tech-dark", label: "科技深色", custom: false },
            { name: "minimal-white", label: "简约白", custom: false },
            { name: "vibrant-orange", label: "活力橙", custom: false },
            { name: "academic-green", label: "学术绿", custom: false },
          ];

          // 自定义主题
          let custom: any[] = [];
          try {
            let rows: any[];
            if (isMySQL()) {
              const adapter = await getMySQLAdapter();
              rows = await adapter.query("SELECT id, name, colors_json, fonts_json, source_file FROM custom_pptx_themes ORDER BY created_at DESC", []);
            } else {
              const { getDb } = await import("../db/database.js");
              rows = getDb().prepare("SELECT id, name, colors_json, fonts_json, source_file FROM custom_pptx_themes ORDER BY created_at DESC").all() as any[];
            }
            custom = rows.map((r) => ({
              name: r.id,
              label: r.name,
              custom: true,
              sourceFile: r.source_file,
              colors: JSON.parse(r.colors_json),
              fonts: JSON.parse(r.fonts_json),
            }));
          } catch { /* 表可能不存在 */ }

          return {
            success: true,
            data: {
              themes: [...builtIn, ...custom],
              total: builtIn.length + custom.length,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "pptx_delete_theme",
      description: "删除一个自定义 PPTX 主题。参数: themeId(string, 主题 ID)",
      handler: async (params) => {
        const themeId = params.themeId as string;
        if (!themeId) {
          return { success: false, error: new Error("themeId 参数必填") };
        }

        try {
          let success = false;
          if (isMySQL()) {
            const adapter = await getMySQLAdapter();
            const result = await adapter.execute("DELETE FROM custom_pptx_themes WHERE id = ?", [themeId]);
            success = result.affectedRows > 0;
          } else {
            const { getDb } = await import("../db/database.js");
            const result = getDb().prepare("DELETE FROM custom_pptx_themes WHERE id = ?").run(themeId);
            success = result.changes > 0;
          }

          if (!success) {
            return { success: false, error: new Error(`主题不存在: ${themeId}`) };
          }

          return {
            success: true,
            data: { deleted: themeId, message: `已删除自定义主题 ${themeId}` },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );
}

// ===== 注册所有数据操作 Skills =====

export async function createDataSkills(registry: SkillRegistry): Promise<void> {
  createFileSkills(registry);
  createFileProvideSkills(registry);
  await createUploadSkills(registry);
  createHttpSkills(registry);
  createShellSkills(registry);
  createPptxThemeSkills(registry);

  console.log("   Data operation skills registered (file/http/shell/upload/provide/pptx-theme)");
}
