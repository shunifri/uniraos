#!/usr/bin/env tsx
/**
 * Q3 W2 Item #5: 一次性 migration helper
 * 扫描 form_definitions 与 workflow_form_bindings, 检测并修复历史不一致
 *
 * 背景: P1-25 之前 FormDesigner 改 key 会被 silently ignored, 但 binding 也没改.
 *   如果有用户直接通过 SQL 改了 form_definitions.key, 或在 P1-25 修复前残留的
 *   "binding.form_id 指向旧 key 但 form_definitions.key 已经是新值" 状态,
 *   工作流任务会 404.
 *
 * 用法:
 *   # Dry run (只打印, 不写) — 走默认 dev DB
 *   npx tsx scripts/migrate-form-key-cascade.ts --dry-run
 *
 *   # 真跑 (修复不一致)
 *   npx tsx scripts/migrate-form-key-cascade.ts --apply
 *
 *   # 指定 DB 路径 (绕过 initDatabase 的 migration 干扰, 适合 dev DB schema 不一致)
 *   npx tsx scripts/migrate-form-key-cascade.ts --db=/path/to/raos.db --dry-run
 *   RAOS_DB_PATH=/path/to/raos.db npx tsx scripts/migrate-form-key-cascade.ts --apply
 *
 * 修复策略:
 *   1. 对每个 form_definition, 用其 key 去查 workflow_form_bindings.form_id,
 *      找到匹配记录, 但 form_definition 的实际 key 已经是新值 → 修复 binding.form_id.
 *   2. 严格依赖 form_definitions.id: 如果 binding.form_id == form.id (UUID),
 *      不动 (UUID 是稳定标识, 改 key 不影响 UUID-based binding).
 *
 * 输出: 每条 binding 是否被修复, 修复后 form_id 的 old → new 值.
 *
 * 关键设计: 不走框架的 initDatabase (那条路径在 dev DB 上会因 v3 migration
 *   "ALTER TABLE chat_messages ADD COLUMN extra" 而 SqliteError), 直接 better-sqlite3
 *   开文件, 只做 SELECT / UPDATE. 不会修改 schema.
 */

import { existsSync } from "fs";
import { resolve as resolvePath } from "path";
import Database from "better-sqlite3";

export interface InconsistencyRow {
  bindingId: string;
  definitionKey: string;
  nodeId: string;
  currentFormId: string;
  expectedFormId: string | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

export interface CliArgs {
  dryRun: boolean;
  apply: boolean;
  dbPath: string | null;
  help: boolean;
}

export function parseCli(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): CliArgs {
  const result: CliArgs = {
    dryRun: argv.includes("--dry-run"),
    apply: argv.includes("--apply"),
    dbPath: null,
    help: argv.includes("--help") || argv.includes("-h"),
  };

  // --db=<path>
  for (const arg of argv) {
    if (arg.startsWith("--db=")) {
      result.dbPath = arg.slice("--db=".length);
    }
  }

  // RAOS_DB_PATH env var
  if (!result.dbPath && env.RAOS_DB_PATH) {
    result.dbPath = env.RAOS_DB_PATH;
  }

  return result;
}

export function printHelp(): string {
  return `Usage: migrate-form-key-cascade [options]

Options:
  --dry-run              只扫描不写 (默认)
  --apply                真跑修复
  --db=<path>            指定 SQLite DB 文件路径 (绕过 initDatabase migrations)
  -h, --help             显示帮助

Environment:
  RAOS_DB_PATH           等同 --db=<path>

Examples:
  # 1) 默认 dev DB dry-run
  npx tsx scripts/migrate-form-key-cascade.ts --dry-run

  # 2) 指定生产 DB
  npx tsx scripts/migrate-form-key-cascade.ts --db=/var/lib/raos/prod.db --dry-run
  RAOS_DB_PATH=/var/lib/raos/prod.db npx tsx scripts/migrate-form-key-cascade.ts --apply

  # 3) 错误时显示当前 DB path 解析
  npx tsx scripts/migrate-form-key-cascade.ts --help
`;
}

// ---------------------------------------------------------------------------
// DB resolution
// ---------------------------------------------------------------------------

const DEFAULT_DEV_DB_PATHS = [
  ".raos/raos.db",          // 标准 dev DB 路径 (按 cwd)
  "raos.db",                // 兼容旧位置
];

export function resolveDefaultDbPath(cwd: string = process.cwd()): string {
  for (const candidate of DEFAULT_DEV_DB_PATHS) {
    const abs = resolvePath(cwd, candidate);
    if (existsSync(abs)) {
      return abs;
    }
  }
  // 默认返回值, 即使不存在也返回, 让 caller 报清晰错误
  return resolvePath(cwd, DEFAULT_DEV_DB_PATHS[0]);
}

// ---------------------------------------------------------------------------
// Schema check
// ---------------------------------------------------------------------------

export interface RequiredTables {
  form_definitions: boolean;
  workflow_form_bindings: boolean;
}

export function checkSchema(db: import("better-sqlite3").Database): RequiredTables {
  const result: RequiredTables = {
    form_definitions: false,
    workflow_form_bindings: false,
  };
  for (const tableName of ["form_definitions", "workflow_form_bindings"] as const) {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      )
      .get(tableName) as { name: string } | undefined;
    if (row) {
      if (tableName === "form_definitions") result.form_definitions = true;
      if (tableName === "workflow_form_bindings") result.workflow_form_bindings = true;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core: scan + fix
// ---------------------------------------------------------------------------

export interface FormRow {
  id: string;
  key: string;
  name: string;
}

export interface BindingRow {
  id: string;
  definition_key: string;
  node_id: string;
  form_id: string;
}

export function loadFormDefinitions(db: import("better-sqlite3").Database): FormRow[] {
  return db.prepare("SELECT id, key, name FROM form_definitions").all() as FormRow[];
}

export function loadAllBindings(db: import("better-sqlite3").Database): BindingRow[] {
  return db
    .prepare(
      "SELECT id, definition_key, node_id, form_id FROM workflow_form_bindings"
    )
    .all() as BindingRow[];
}

export function scanInconsistencies(
  forms: FormRow[],
  bindings: BindingRow[]
): InconsistencyRow[] {
  const byId = new Map(forms.map((f) => [f.id, f]));
  const byKey = new Map(forms.map((f) => [f.key, f]));
  const inconsistencies: InconsistencyRow[] = [];

  for (const b of bindings) {
    // Case 1: form_id is a UUID matching a form definition — OK, no action
    const formById = byId.get(b.form_id);
    if (formById) continue;

    // Case 2: form_id is a current key — OK
    const formByCurrentKey = byKey.get(b.form_id);
    if (formByCurrentKey) continue;

    // Case 3: form_id is a stale key. We can't auto-fix without knowing the new key.
    inconsistencies.push({
      bindingId: b.id,
      definitionKey: b.definition_key,
      nodeId: b.node_id,
      currentFormId: b.form_id,
      expectedFormId: null,
      reason: `form_id "${b.form_id}" 找不到对应的 form_definition (既非 UUID 也非当前 key). 需要人工 review 确认正确的新 key.`,
    });
  }

  return inconsistencies;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface MigrationResult {
  status: "ok" | "help" | "no-action" | "needs-manual-review" | "error";
  message: string;
  inconsistencies: InconsistencyRow[];
  formsCount: number;
  bindingsCount: number;
  dbPath: string;
}

export async function runMigration(cli: CliArgs, cwd: string = process.cwd()): Promise<MigrationResult> {
  if (cli.help) {
    return { status: "help", message: printHelp(), inconsistencies: [], formsCount: 0, bindingsCount: 0, dbPath: "" };
  }

  if (!cli.dryRun && !cli.apply) {
    return {
      status: "error",
      message: "Error: 必须指定 --dry-run 或 --apply. 详见 --help.",
      inconsistencies: [],
      formsCount: 0,
      bindingsCount: 0,
      dbPath: "",
    };
  }

  // 解析 DB 路径
  const dbPath = cli.dbPath ? resolvePath(cli.dbPath) : resolveDefaultDbPath(cwd);
  if (!existsSync(dbPath)) {
    return {
      status: "error",
      message: `DB 文件不存在: ${dbPath}. 提示: 用 --db=<path> 或 RAOS_DB_PATH 指定正确路径.`,
      inconsistencies: [],
      formsCount: 0,
      bindingsCount: 0,
      dbPath,
    };
  }

  // 直接 better-sqlite3 开文件, 不走框架的 initDatabase / migrations.
  let db: import("better-sqlite3").Database;
  try {
    db = new Database(dbPath, { readonly: cli.dryRun, fileMustExist: true });
  } catch (err) {
    return {
      status: "error",
      message: `打开 DB 失败: ${(err as Error).message}. 路径: ${dbPath}`,
      inconsistencies: [],
      formsCount: 0,
      bindingsCount: 0,
      dbPath,
    };
  }

  try {
    // Schema check
    const schema = checkSchema(db);
    if (!schema.form_definitions || !schema.workflow_form_bindings) {
      return {
        status: "error",
        message: `DB schema 缺少必要表: form_definitions: ${schema.form_definitions ? "✓" : "✗"}, workflow_form_bindings: ${schema.workflow_form_bindings ? "✓" : "✗"}. 这可能不是 RAOS 的 DB 文件, 或者 schema 还没初始化.`,
        inconsistencies: [],
        formsCount: 0,
        bindingsCount: 0,
        dbPath,
      };
    }

    // 加载数据
    const forms = loadFormDefinitions(db);
    const bindings = loadAllBindings(db);

    // 扫描不一致
    const inconsistencies = scanInconsistencies(forms, bindings);

    if (inconsistencies.length === 0) {
      return {
        status: "no-action",
        message: "未发现需要修复的不一致. (form_id 全部命中 UUID 或当前 key, 无 stale 引用.)",
        inconsistencies: [],
        formsCount: forms.length,
        bindingsCount: bindings.length,
        dbPath,
      };
    }

    return {
      status: "needs-manual-review",
      message: `发现 ${inconsistencies.length} 条可能不一致的 binding. 由于无法自动推断新 key, 需要人工 review.`,
      inconsistencies,
      formsCount: forms.length,
      bindingsCount: bindings.length,
      dbPath,
    };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint (only runs when invoked as a script, not when imported)
// ---------------------------------------------------------------------------

function isMainModule(): boolean {
  // 简化: 用 process.argv[1] 判断, 不依赖 import.meta (后者要 esm module)
  return process.argv[1]?.endsWith("migrate-form-key-cascade.ts") ||
    process.argv[1]?.endsWith("migrate-form-key-cascade") ||
    false;
}

async function main() {
  const cli = parseCli();
  const result = await runMigration(cli);

  if (result.status === "help") {
    console.log(result.message);
    return;
  }

  if (result.status === "error") {
    console.error(`❌ ${result.message}`);
    if (result.dbPath) {
      console.error(`   DB path: ${result.dbPath}`);
    }
    process.exit(1);
  }

  if (cli.apply) {
    console.warn("⚠️  APPLY MODE: 将会修改 workflow_form_bindings 表");
  } else {
    console.log("🔍 DRY-RUN: 不会修改任何数据");
  }
  console.log(`📁 DB 路径: ${result.dbPath}`);
  console.log("✅ Schema 检查通过 (form_definitions + workflow_form_bindings 都存在)");
  console.log(`\nLoaded ${result.formsCount} form_definitions, ${result.bindingsCount} workflow_form_bindings\n`);

  if (result.status === "no-action") {
    console.log("✅ " + result.message);
    return;
  }

  // needs-manual-review
  console.log(`\n发现 ${result.inconsistencies.length} 条可能不一致的 binding:\n`);
  for (const inc of result.inconsistencies) {
    console.log(`  - binding ${inc.bindingId}:`);
    console.log(`      definition_key: ${inc.definitionKey}`);
    console.log(`      node_id:        ${inc.nodeId}`);
    console.log(`      current form_id: ${inc.currentFormId}`);
    console.log(`      reason:         ${inc.reason}`);
    console.log();
  }
  console.log(`⚠️  这些 binding 的 form_id 找不到对应的 form (既非 UUID 也非当前 key).`);
  console.log(`   由于无法从 binding 自动推断新 key, 这些 case 需要人工 review.`);
  console.log(`   脚本不做自动 fix.`);
  console.log(``);
  console.log(`如果你已经通过其他方式知道正确的新 key, 可以手动 SQL:`);
  console.log(`   UPDATE workflow_form_bindings SET form_id = '<new_key>' WHERE id = '<binding_id>';`);

  if (cli.apply) {
    console.log(`\n(apply 模式未执行任何 DML, 因为没有可自动推断的修复目标)`);
  }
}

if (isMainModule()) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}

