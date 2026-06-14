/**
 * 文档解析 Skill 家族
 *
 * 提供 PDF、Excel、Word、CSV 等文档的读取和解析能力，
 * 让智能体能够理解和处理各类文档文件。
 *
 * 依赖策略：
 * - CSV：内置实现，无外部依赖
 * - PDF：可选依赖 pdf-parse
 * - Excel：可选依赖 xlsx / exceljs
 * - Word：可选依赖 mammoth
 */
import { readFileSync, existsSync } from "fs";
import { resolve, extname } from "path";
import { defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";

const SAFE_BASE = resolve(process.cwd(), ".raos", "workspace");

function ensureSafePath(path: string): string {
  const resolved = resolve(SAFE_BASE, path);
  if (!resolved.startsWith(SAFE_BASE)) {
    throw new Error(`路径安全违规: 不允许访问 workspace 外的文件 (${path})`);
  }
  return resolved;
}

// ===== CSV 解析（内置） =====

function parseCSV(content: string, delimiter: string = ","): { headers: string[]; rows: Record<string, string>[]; rowCount: number } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [], rowCount: 0 };

  // 简单 CSV 解析（支持引号包裹）
  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });

  return { headers, rows, rowCount: rows.length };
}

// ===== 文档解析 Skills =====

function registerDocumentSkills(registry: SkillRegistry): void {
  // CSV 解析（内置，始终可用）
  registry.register(
    defineSystemSkill({
      name: "doc_read_csv",
      description:
        "解析 CSV 文件。参数: path(string, 相对于 workspace), delimiter?(string, 默认 ','), limit?(number, 最大行数), offset?(number, 跳过行数)",
      handler: async (params) => {
        const path = ensureSafePath(params.path as string);
        if (!existsSync(path)) {
          return { success: false, error: new Error(`文件不存在: ${params.path}`) };
        }

        try {
          const content = readFileSync(path, "utf-8");
          const delimiter = (params.delimiter as string) ?? ",";
          const result = parseCSV(content, delimiter);

          const offset = (params.offset as number) ?? 0;
          const limit = (params.limit as number) ?? result.rows.length;
          const sliced = result.rows.slice(offset, offset + limit);

          return {
            success: true,
            data: {
              headers: result.headers,
              rows: sliced,
              rowCount: sliced.length,
              totalRows: result.rowCount,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );

  // 通用文档读取（自动检测格式）
  registry.register(
    defineSystemSkill({
      name: "doc_read",
      description:
        "读取并解析文档文件（自动检测格式：PDF/Excel/Word/CSV/JSON/TXT）。参数: path(string, 相对于 workspace), options?(object)",
      timeout: 60000,
      handler: async (params) => {
        const filePath = params.path as string;
        const safePath = ensureSafePath(filePath);
        if (!existsSync(safePath)) {
          return { success: false, error: new Error(`文件不存在: ${filePath}`) };
        }

        const ext = extname(filePath).toLowerCase();

        try {
          switch (ext) {
            case ".csv":
            case ".tsv": {
              const content = readFileSync(safePath, "utf-8");
              const delimiter = ext === ".tsv" ? "\t" : ",";
              const result = parseCSV(content, delimiter);
              return { success: true, data: { format: "csv", ...result } };
            }

            case ".json": {
              const content = readFileSync(safePath, "utf-8");
              const data = JSON.parse(content);
              return { success: true, data: { format: "json", content: data } };
            }

            case ".txt":
            case ".md":
            case ".log": {
              const content = readFileSync(safePath, "utf-8");
              return {
                success: true,
                data: {
                  format: "text",
                  content: content.length > 100000 ? content.substring(0, 100000) + "\n...[truncated]" : content,
                  length: content.length,
                },
              };
            }

            case ".pdf":
              return await readPDF(safePath);

            case ".xlsx":
            case ".xls":
              return await readExcel(safePath, params.options as any);

            case ".docx":
              return await readWord(safePath);

            default:
              // 尝试作为纯文本读取
              try {
                const content = readFileSync(safePath, "utf-8");
                return {
                  success: true,
                  data: {
                    format: "text",
                    content: content.length > 100000 ? content.substring(0, 100000) + "\n...[truncated]" : content,
                    length: content.length,
                  },
                };
              } catch {
                return { success: false, error: new Error(`不支持的文件格式: ${ext}`) };
              }
          }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
  );
}

// ===== PDF 解析（可选依赖 pdf-parse） =====

async function readPDF(path: string): Promise<{ success: boolean; data?: any; error?: Error }> {
  try {
    // @ts-ignore — 可选依赖
    const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js") as any;
    const pdfParse = pdfParseModule.default ?? pdfParseModule;
    const buffer = readFileSync(path);
    const data = await pdfParse(buffer);

    return {
      success: true,
      data: {
        format: "pdf",
        text: data.text.length > 100000 ? data.text.substring(0, 100000) + "\n...[truncated]" : data.text,
        pages: data.numpages,
        info: data.info,
        textLength: data.text.length,
      },
    };
  } catch (err: unknown) {
    if ((err as any).code === "MODULE_NOT_FOUND" || (err as any).code === "ERR_MODULE_NOT_FOUND") {
      return { success: false, error: new Error("PDF 解析需要安装 pdf-parse: npm install pdf-parse") };
    }
    return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ===== Excel 解析（可选依赖 xlsx） =====

async function readExcel(path: string, options?: { sheet?: string | number }): Promise<{ success: boolean; data?: any; error?: Error }> {
  try {
    // @ts-ignore — 可选依赖
    const xlsxMod = await import("xlsx");
    const XLSX = (xlsxMod as any).default ?? xlsxMod;
    const workbook = XLSX.readFile(path);

    const sheetNames = workbook.SheetNames;
    let targetSheet: string;

    if (options?.sheet !== undefined) {
      if (typeof options.sheet === "number") {
        targetSheet = sheetNames[options.sheet] ?? sheetNames[0];
      } else {
        targetSheet = options.sheet;
      }
    } else {
      targetSheet = sheetNames[0];
    }

    const sheet = workbook.Sheets[targetSheet];
    if (!sheet) {
      return { success: false, error: new Error(`工作表不存在: ${targetSheet}`) };
    }

    const jsonData = XLSX.utils.sheet_to_json(sheet);
    const headers = jsonData.length > 0 ? Object.keys(jsonData[0] as object) : [];

    return {
      success: true,
      data: {
        format: "excel",
        sheetName: targetSheet,
        sheetNames,
        headers,
        rows: jsonData.slice(0, 10000), // 限制行数
        rowCount: jsonData.length,
        totalSheets: sheetNames.length,
      },
    };
  } catch (err: unknown) {
    if ((err as any).code === "MODULE_NOT_FOUND" || (err as any).code === "ERR_MODULE_NOT_FOUND") {
      return { success: false, error: new Error("Excel 解析需要安装 xlsx: npm install xlsx") };
    }
    return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ===== Word 解析（可选依赖 mammoth） =====

async function readWord(path: string): Promise<{ success: boolean; data?: any; error?: Error }> {
  try {
    // @ts-ignore — 可选依赖
    const mammoth = await import("mammoth");
    const buffer = readFileSync(path);

    const result = await mammoth.extractRawText({ buffer });
    const htmlResult = await mammoth.convertToHtml({ buffer });

    return {
      success: true,
      data: {
        format: "docx",
        text: result.value.length > 100000 ? result.value.substring(0, 100000) + "\n...[truncated]" : result.value,
        html: htmlResult.value.length > 100000 ? htmlResult.value.substring(0, 100000) + "\n...[truncated]" : htmlResult.value,
        textLength: result.value.length,
        messages: result.messages.slice(0, 10),
      },
    };
  } catch (err: unknown) {
    if ((err as any).code === "MODULE_NOT_FOUND" || (err as any).code === "ERR_MODULE_NOT_FOUND") {
      return { success: false, error: new Error("Word 解析需要安装 mammoth: npm install mammoth") };
    }
    return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ===== 注册所有文档解析 Skills =====

export function createDocumentSkills(registry: SkillRegistry): void {
  registerDocumentSkills(registry);
  console.log("   Document skills registered (doc_read/doc_read_csv + PDF/Excel/Word support)");
}
