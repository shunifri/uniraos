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
 *   # Dry run (只打印, 不写)
 *   npx tsx scripts/migrate-form-key-cascade.ts --dry-run
 *
 *   # 真跑 (修复不一致)
 *   npx tsx scripts/migrate-form-key-cascade.ts --apply
 *
 * 修复策略:
 *   1. 对每个 form_definition, 用其 key 去查 workflow_form_bindings.form_id,
 *      找到匹配记录, 但 form_definition 的实际 key 已经是新值 → 修复 binding.form_id.
 *   2. 严格依赖 form_definitions.id: 如果 binding.form_id == form.id (UUID),
 *      不动 (UUID 是稳定标识, 改 key 不影响 UUID-based binding).
 *
 * 输出: 每条 binding 是否被修复, 修复后 form_id 的 old → new 值.
 */

import { getDb, isMySQL, initDatabaseAsync } from "../src/db/database.js";
import { getMySQLAdapter } from "../src/db/mysql-adapter.js";

interface InconsistencyRow {
  bindingId: string;
  definitionKey: string;
  nodeId: string;
  currentFormId: string;
  expectedFormId: string;
  reason: string;
}

async function loadFormDefinitions(): Promise<Array<{ id: string; key: string; name: string }>> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query<{ id: string; key: string; name: string }>(
      "SELECT id, `key`, name FROM form_definitions"
    );
    return rows;
  }
  const db = getDb();
  return db.prepare("SELECT id, key, name FROM form_definitions").all() as any[];
}

async function loadAllBindings(): Promise<Array<{ id: string; definition_key: string; node_id: string; form_id: string }>> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    return adapter.query(
      "SELECT id, definition_key, node_id, form_id FROM workflow_form_bindings"
    );
  }
  const db = getDb();
  return db.prepare(
    "SELECT id, definition_key, node_id, form_id FROM workflow_form_bindings"
  ).all() as any[];
}

async function fixBinding(bindingId: string, newFormId: string, dryRun: boolean): Promise<boolean> {
  if (dryRun) return false;
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute("UPDATE workflow_form_bindings SET form_id = ? WHERE id = ?", [newFormId, bindingId]);
    return true;
  }
  const db = getDb();
  db.prepare("UPDATE workflow_form_bindings SET form_id = ? WHERE id = ?").run(newFormId, bindingId);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");

  if (!dryRun && !apply) {
    console.error("Usage:");
    console.error("  npx tsx scripts/migrate-form-key-cascade.ts --dry-run   # 只扫描不写");
    console.error("  npx tsx scripts/migrate-form-key-cascade.ts --apply      # 真跑修复");
    process.exit(1);
  }

  if (apply) {
    console.warn("⚠️  APPLY MODE: 将会修改 workflow_form_bindings 表");
  } else {
    console.log("🔍 DRY-RUN: 不会修改任何数据");
  }

  try {
    await initDatabaseAsync();
  } catch (err) {
    console.error("Failed to initialize database:", (err as Error).message);
    console.error("\n如果本地 dev DB schema 不一致, 可以指定生产 DB 文件路径:");
    console.error("  RAOS_DB_PATH=/path/to/raos.db npx tsx scripts/migrate-form-key-cascade.ts --dry-run");
    console.error("\n或者在 MySQL 模式下设置环境变量 RAOS_DB_TYPE=mysql.");
    process.exit(1);
  }

  const forms = await loadFormDefinitions();
  const bindings = await loadAllBindings();

  console.log(`\nLoaded ${forms.length} form_definitions, ${bindings.length} workflow_form_bindings\n`);

  // Build lookup maps:
  // - byId: form UUID → form
  // - byKey: form key → form
  const byId = new Map(forms.map(f => [f.id, f]));
  const byKey = new Map(forms.map(f => [f.key, f]));

  const inconsistencies: InconsistencyRow[] = [];

  for (const b of bindings) {
    // Case 1: form_id is a UUID matching a form definition
    const formById = byId.get(b.form_id);
    if (formById) {
      // UUID-based binding, key changes don't affect it. No action.
      continue;
    }

    // Case 2: form_id looks like a key (not a UUID)
    // Check if any form's CURRENT key matches
    const formByCurrentKey = byKey.get(b.form_id);
    if (formByCurrentKey) {
      // form_id == current key, OK
      continue;
    }

    // Case 3: form_id is a stale key
    // Look for a form whose id appears in name only (e.g. was renamed in DB)
    // We don't know the new key, so this is harder. Best effort:
    // Try to find a binding whose definition_key matches and look for similar
    // form_id from definition table.
    //
    // For safety, mark it as "unknown stale" and DO NOT auto-fix.
    inconsistencies.push({
      bindingId: b.id,
      definitionKey: b.definition_key,
      nodeId: b.node_id,
      currentFormId: b.form_id,
      expectedFormId: "???",
      reason: `form_id "${b.form_id}" 找不到对应的 form_definition (既非 UUID 也非当前 key). 可能需要人工 review.`,
    });
  }

  // Also detect: form_id IS a current key, but should be UUID (consistency check)
  // This is informational only — we don't auto-fix UUID vs key in form_id.
  for (const b of bindings) {
    const formByCurrentKey = byKey.get(b.form_id);
    if (formByCurrentKey) {
      // form_id is current key — that's the historical pattern, OK.
      // But also check: if there's a form with the same key but a different
      // name, that's not necessarily wrong, so just log informational.
      if (forms.length < 20) {
        // Only log in small databases to avoid spam
        console.log(`  [info] binding ${b.id} (${b.definition_key}.${b.node_id}) uses key-based form_id "${b.form_id}"`);
      }
    }
  }

  if (inconsistencies.length === 0) {
    console.log("✅ 未发现需要修复的不一致.");
    return;
  }

  console.log(`\n发现 ${inconsistencies.length} 条可能不一致的 binding:\n`);
  for (const inc of inconsistencies) {
    console.log(`  - binding ${inc.bindingId}: ${inc.reason}`);
  }

  console.log(`\n⚠️  注意: 由于无法从 binding 自动推断新 key, 这些 case 需要人工 review.`);
  console.log(`   脚本不做自动 fix. 请检查 form_definitions 表确认每个 binding 的正确 form_id.`);
  console.log(`\n如果你已经通过其他方式知道正确的新 key, 可以手动:`);
  console.log(`   UPDATE workflow_form_bindings SET form_id = '<new_key>' WHERE id = '<binding_id>';`);

  if (apply) {
    console.log(`\n(apply 模式未执行任何 DML, 因为没有可自动推断的修复目标)`);
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
