import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log, setLogLevel, addLogSink, removeLogSink, type LogEntry, type LogSink } from "../../src/utils/logger.js";

describe("logger sanitization", () => {
  let entries: LogEntry[];
  let sink: LogSink;

  beforeEach(() => {
    entries = [];
    sink = (e: LogEntry) => entries.push(e);
    setLogLevel("debug");
    addLogSink(sink);
  });

  afterEach(() => {
    removeLogSink(sink);
  });

  it("should mask sensitive keys like password", () => {
    log("info", "login", { password: "secret123" });
    expect(entries[0].password).toBe("***");
  });

  it("should mask apiKey", () => {
    log("info", "config", { apiKey: "sk-abc", api_key: "sk-def" });
    expect(entries[0].apiKey).toBe("***");
    expect(entries[0].api_key).toBe("***");
  });

  it("should mask token and secret", () => {
    log("info", "auth", { token: "jwt-token", secret: "my-secret" });
    expect(entries[0].token).toBe("***");
    expect(entries[0].secret).toBe("***");
  });

  it("should mask authorization header", () => {
    log("info", "request", { authorization: "Bearer xyz" });
    expect(entries[0].authorization).toBe("***");
  });

  it("should redact SQL queries", () => {
    log("info", "query", { sql: "SELECT * FROM users WHERE password = 'x'" });
    expect(entries[0].sql).toBe("[SQL_QUERY_REDACTED]");
  });

  it("should mask emails", () => {
    log("info", "user", { email: "alice@example.com" });
    expect(entries[0].email).toBe("al***@example.com");
  });

  it("should truncate long strings", () => {
    const long = "a".repeat(3000);
    log("info", "upload", { content: long });
    const val = entries[0].content as string;
    expect(val.length).toBeLessThan(3000);
    expect(val.includes("...[truncated 3000 chars]")).toBe(true);
  });

  it("should sanitize nested objects", () => {
    log("info", "nested", { user: { password: "p", name: "ok" } });
    expect((entries[0].user as any).password).toBe("***");
    expect((entries[0].user as any).name).toBe("ok");
  });

  it("should sanitize arrays", () => {
    log("info", "list", { items: [{ secret: "s" }, { secret: "t" }] });
    expect((entries[0].items as any[])[0].secret).toBe("***");
  });
});
