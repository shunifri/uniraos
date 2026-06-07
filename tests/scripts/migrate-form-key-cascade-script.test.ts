import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import {
  parseCli,
  printHelp,
  resolveDefaultDbPath,
  checkSchema,
  scanInconsistencies,
  runMigration,
  type CliArgs,
  type FormRow,
  type BindingRow,
} from "../../scripts/migrate-form-key-cascade";

// ---------------------------------------------------------------------------
// Test fixtures: in-memory DB
// ---------------------------------------------------------------------------

function createTestDb(seed: "stale" | "healthy" | "mixed" | "empty"): {
  db: Database.Database;
  path: string;
  cleanup: () => void;
} {
  const path = `/tmp/migrate-test-${seed}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  const db = new Database(path);
  db.exec(`
    CREATE TABLE form_definitions (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
    CREATE TABLE workflow_form_bindings (
      id TEXT PRIMARY KEY, definition_key TEXT NOT NULL, node_id TEXT NOT NULL,
      form_id TEXT NOT NULL, form_version INTEGER DEFAULT -1,
      is_required INTEGER DEFAULT 1, mapping_json TEXT
    );
  `);

  if (seed === "stale") {
    db.prepare("INSERT INTO form_definitions VALUES (?, ?, ?)").run("uuid-1", "new_key", "Form 1");
    db.prepare("INSERT INTO workflow_form_bindings VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("bind-1", "wf1", "node1", "old_key", -1, 1, null);
  } else if (seed === "healthy") {
    db.prepare("INSERT INTO form_definitions VALUES (?, ?, ?)").run("uuid-1", "form_key", "Form 1");
    db.prepare("INSERT INTO workflow_form_bindings VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("bind-1", "wf1", "node1", "form_key", -1, 1, null);
    db.prepare("INSERT INTO workflow_form_bindings VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("bind-2", "wf1", "node2", "uuid-1", -1, 1, null);
  } else if (seed === "mixed") {
    db.prepare("INSERT INTO form_definitions VALUES (?, ?, ?)").run("uuid-1", "new_key", "Form 1");
    db.prepare("INSERT INTO form_definitions VALUES (?, ?, ?)").run("uuid-2", "form2", "Form 2");
    db.prepare("INSERT INTO workflow_form_bindings VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("bind-stale-1", "wf1", "n1", "old_key", -1, 1, null);
    db.prepare("INSERT INTO workflow_form_bindings VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("bind-healthy-1", "wf1", "n2", "new_key", -1, 1, null);
    db.prepare("INSERT INTO workflow_form_bindings VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("bind-healthy-2", "wf2", "n1", "uuid-2", -1, 1, null);
  }
  // "empty" leaves tables empty

  db.close();
  return {
    db: new Database(path, { readonly: true }),
    path,
    cleanup: () => {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("migrate-form-key-cascade.ts script", () => {
  describe("parseCli", () => {
    it("returns defaults when no args", () => {
      const r = parseCli([], {});
      expect(r.dryRun).toBe(false);
      expect(r.apply).toBe(false);
      expect(r.dbPath).toBeNull();
      expect(r.help).toBe(false);
    });

    it("parses --dry-run flag", () => {
      const r = parseCli(["--dry-run"], {});
      expect(r.dryRun).toBe(true);
      expect(r.apply).toBe(false);
    });

    it("parses --apply flag", () => {
      const r = parseCli(["--apply"], {});
      expect(r.apply).toBe(true);
      expect(r.dryRun).toBe(false);
    });

    it("parses --db=<path> flag", () => {
      const r = parseCli(["--db=/path/to/db.db", "--dry-run"], {});
      expect(r.dbPath).toBe("/path/to/db.db");
    });

    it("falls back to RAOS_DB_PATH env var when --db not set", () => {
      const r = parseCli(["--dry-run"], { RAOS_DB_PATH: "/env/path.db" });
      expect(r.dbPath).toBe("/env/path.db");
    });

    it("--db flag takes precedence over RAOS_DB_PATH", () => {
      const r = parseCli(["--db=/flag/path.db", "--dry-run"], { RAOS_DB_PATH: "/env/path.db" });
      expect(r.dbPath).toBe("/flag/path.db");
    });

    it("parses --help / -h", () => {
      expect(parseCli(["--help"], {}).help).toBe(true);
      expect(parseCli(["-h"], {}).help).toBe(true);
    });
  });

  describe("printHelp", () => {
    it("contains usage info for all flags and env var", () => {
      const help = printHelp();
      expect(help).toContain("Usage:");
      expect(help).toContain("--dry-run");
      expect(help).toContain("--apply");
      expect(help).toContain("--db=");
      expect(help).toContain("RAOS_DB_PATH");
      expect(help).toContain("Examples");
    });
  });

  describe("resolveDefaultDbPath", () => {
    it("returns the default path when no DB exists in cwd", () => {
      // Use a non-existent cwd to avoid picking up real dev DB
      const path = resolveDefaultDbPath("/nonexistent-tmp-cwd-xyz");
      expect(path).toContain(".raos/raos.db");
    });
  });

  describe("checkSchema", () => {
    it("returns true for both required tables when present", () => {
      const { db, cleanup } = createTestDb("healthy");
      try {
        const schema = checkSchema(db);
        expect(schema.form_definitions).toBe(true);
        expect(schema.workflow_form_bindings).toBe(true);
      } finally {
        cleanup();
      }
    });

    it("returns false for missing tables", () => {
      const path = `/tmp/migrate-test-empty-${Date.now()}.db`;
      const db = new Database(path);
      try {
        const schema = checkSchema(db);
        expect(schema.form_definitions).toBe(false);
        expect(schema.workflow_form_bindings).toBe(false);
      } finally {
        db.close();
        if (existsSync(path)) unlinkSync(path);
      }
    });
  });

  describe("scanInconsistencies (pure logic)", () => {
    it("returns empty for healthy data", () => {
      const forms: FormRow[] = [{ id: "uuid-1", key: "form_key", name: "Form 1" }];
      const bindings: BindingRow[] = [
        { id: "b1", definition_key: "wf", node_id: "n1", form_id: "form_key" },
        { id: "b2", definition_key: "wf", node_id: "n2", form_id: "uuid-1" },
      ];
      const result = scanInconsistencies(forms, bindings);
      expect(result).toHaveLength(0);
    });

    it("detects stale binding", () => {
      const forms: FormRow[] = [{ id: "uuid-1", key: "new_key", name: "Form 1" }];
      const bindings: BindingRow[] = [
        { id: "b1", definition_key: "wf", node_id: "n1", form_id: "old_key" },
      ];
      const result = scanInconsistencies(forms, bindings);
      expect(result).toHaveLength(1);
      expect(result[0].bindingId).toBe("b1");
      expect(result[0].currentFormId).toBe("old_key");
      expect(result[0].reason).toContain("old_key");
    });

    it("distinguishes stale vs healthy in mixed data", () => {
      const forms: FormRow[] = [
        { id: "uuid-1", key: "new_key", name: "Form 1" },
        { id: "uuid-2", key: "form2", name: "Form 2" },
      ];
      const bindings: BindingRow[] = [
        { id: "b-stale", definition_key: "wf", node_id: "n", form_id: "old_key" },
        { id: "b-key", definition_key: "wf", node_id: "n", form_id: "new_key" },
        { id: "b-uuid", definition_key: "wf", node_id: "n", form_id: "uuid-2" },
      ];
      const result = scanInconsistencies(forms, bindings);
      expect(result).toHaveLength(1);
      expect(result[0].bindingId).toBe("b-stale");
    });

    it("handles empty input", () => {
      expect(scanInconsistencies([], [])).toEqual([]);
    });
  });

  describe("runMigration (integration)", () => {
    it("--help returns help status without opening DB", async () => {
      const result = await runMigration({ dryRun: false, apply: false, dbPath: null, help: true });
      expect(result.status).toBe("help");
      expect(result.message).toContain("Usage:");
    });

    it("errors when neither --dry-run nor --apply given", async () => {
      const result = await runMigration({ dryRun: false, apply: false, dbPath: null, help: false });
      expect(result.status).toBe("error");
      expect(result.message).toContain("必须指定 --dry-run 或 --apply");
    });

    it("non-existent DB returns clear error", async () => {
      const result = await runMigration({
        dryRun: true,
        apply: false,
        dbPath: "/tmp/does-not-exist-mig-xyz.db",
        help: false,
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("DB 文件不存在");
      expect(result.message).toContain("--db=");
    });

    it("DB without required tables returns schema error", async () => {
      // Use dev DB which lacks form tables
      const result = await runMigration({
        dryRun: true,
        apply: false,
        dbPath: "/Users/liukavin/Documents/code/raos/.raos/raos.db",
        help: false,
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("DB schema 缺少必要表");
      expect(result.message).toContain("form_definitions");
    });

    it("healthy DB: returns no-action status", async () => {
      const { path, cleanup } = createTestDb("healthy");
      try {
        const result = await runMigration({
          dryRun: true,
          apply: false,
          dbPath: path,
          help: false,
        });
        expect(result.status).toBe("no-action");
        expect(result.formsCount).toBe(1);
        expect(result.bindingsCount).toBe(2);
        expect(result.inconsistencies).toHaveLength(0);
        expect(result.message).toContain("未发现需要修复");
      } finally {
        cleanup();
      }
    });

    it("stale DB: returns needs-manual-review with details", async () => {
      const { path, cleanup } = createTestDb("stale");
      try {
        const result = await runMigration({
          dryRun: true,
          apply: false,
          dbPath: path,
          help: false,
        });
        expect(result.status).toBe("needs-manual-review");
        expect(result.inconsistencies).toHaveLength(1);
        expect(result.inconsistencies[0].bindingId).toBe("bind-1");
        expect(result.inconsistencies[0].currentFormId).toBe("old_key");
        expect(result.message).toContain("人工 review");
      } finally {
        cleanup();
      }
    });

    it("mixed DB: only stale bindings reported", async () => {
      const { path, cleanup } = createTestDb("mixed");
      try {
        const result = await runMigration({
          dryRun: true,
          apply: false,
          dbPath: path,
          help: false,
        });
        expect(result.status).toBe("needs-manual-review");
        expect(result.inconsistencies).toHaveLength(1);
        expect(result.inconsistencies[0].bindingId).toBe("bind-stale-1");
      } finally {
        cleanup();
      }
    });

    it("--apply mode does NOT modify DB (no auto-fix possible)", async () => {
      const { path, cleanup } = createTestDb("stale");
      try {
        const result = await runMigration({
          dryRun: false,
          apply: true,
          dbPath: path,
          help: false,
        });
        expect(result.status).toBe("needs-manual-review");
        // Verify DB unchanged
        const verifyDb = new Database(path, { readonly: true });
        const row = verifyDb.prepare("SELECT form_id FROM workflow_form_bindings WHERE id = ?").get("bind-1") as { form_id: string };
        expect(row.form_id).toBe("old_key");
        verifyDb.close();
      } finally {
        cleanup();
      }
    });

    it("empty DB: returns no-action (no bindings to check)", async () => {
      const { path, cleanup } = createTestDb("empty");
      try {
        const result = await runMigration({
          dryRun: true,
          apply: false,
          dbPath: path,
          help: false,
        });
        expect(result.status).toBe("no-action");
        expect(result.formsCount).toBe(0);
        expect(result.bindingsCount).toBe(0);
      } finally {
        cleanup();
      }
    });
  });
});
