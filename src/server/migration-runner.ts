import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getMySQLAdapter } from "../db/mysql-adapter.js";

/**
 * Run inbox + scheduler database migration from SQL file.
 */
export async function runInboxSchedulerMigration(): Promise<void> {
  try {
    const adapter = getMySQLAdapter();
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const sqlPath = join(__dirname, "../db/migrations/v9_inbox_scheduler.sql");

    if (existsSync(sqlPath)) {
      const sql = readFileSync(sqlPath, "utf-8");
      const statements = sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
      for (const stmt of statements) {
        try {
          await adapter.execute(stmt);
        } catch (err: any) {
          if (!err.message?.includes("Duplicate") && !err.message?.includes("already exists")) {
            console.warn(`   Migration warning: ${err.message}`);
          }
        }
      }
      console.log("   Inbox + Scheduler migration applied");
    }
  } catch (err: any) {
    console.warn(`   Migration error: ${err.message}`);
  }
}
