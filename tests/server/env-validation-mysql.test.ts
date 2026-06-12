import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateEnv } from "../../src/server/env-validation.js";

describe("env-validation MySQL host check", () => {
  const ORIG_ENV = { ...process.env };
  let warnings: string[];
  let errors: string[];

  beforeEach(() => {
    warnings = [];
    errors = [];
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  function run() {
    const r = validateEnv();
    warnings = r.warnings;
    errors = r.errors;
  }

  it("USE_MYSQL=true + production + no MYSQL_PRIMARY_HOST → warning hint", () => {
    process.env.USE_MYSQL = "true";
    process.env.NODE_ENV = "production";
    delete process.env.MYSQL_PRIMARY_HOST;
    run();
    expect(warnings.some(w => w.includes("MYSQL_PRIMARY_HOST"))).toBe(true);
  });

  it("USE_MYSQL=true + production + host=localhost → error (loopback in container)", () => {
    process.env.USE_MYSQL = "true";
    process.env.NODE_ENV = "production";
    process.env.MYSQL_PRIMARY_HOST = "localhost";
    run();
    expect(errors.some(e => e.includes("loopback"))).toBe(true);
  });

  it("USE_MYSQL=true + production + host=127.0.0.1 → error", () => {
    process.env.USE_MYSQL = "true";
    process.env.NODE_ENV = "production";
    process.env.MYSQL_PRIMARY_HOST = "127.0.0.1";
    run();
    expect(errors.some(e => e.includes("loopback"))).toBe(true);
  });

  it("USE_MYSQL=true + production + host=172.29.0.2 → warning (raw IP, prefer service name)", () => {
    process.env.USE_MYSQL = "true";
    process.env.NODE_ENV = "production";
    process.env.MYSQL_PRIMARY_HOST = "172.29.0.2";
    run();
    expect(warnings.some(w => w.includes("raw IP"))).toBe(true);
  });

  it("USE_MYSQL=true + production + host=mysql-primary → no warning, no error", () => {
    process.env.USE_MYSQL = "true";
    process.env.NODE_ENV = "production";
    process.env.MYSQL_PRIMARY_HOST = "mysql-primary";
    run();
    expect(warnings.some(w => w.includes("MYSQL_PRIMARY_HOST"))).toBe(false);
    expect(errors.some(e => e.includes("loopback"))).toBe(false);
  });

  it("USE_MYSQL=false → no MySQL host check", () => {
    process.env.USE_MYSQL = "false";
    process.env.NODE_ENV = "production";
    process.env.MYSQL_PRIMARY_HOST = "localhost";
    run();
    expect(errors.some(e => e.includes("loopback"))).toBe(false);
  });

  it("development mode (NODE_ENV != production) + host=localhost → warning not error", () => {
    process.env.USE_MYSQL = "true";
    process.env.NODE_ENV = "development";
    process.env.MYSQL_PRIMARY_HOST = "localhost";
    run();
    // 开发模式 host check 只 warning, 不 error (validateEnvOrExit 才决定)
    expect(errors.some(e => e.includes("loopback"))).toBe(false);
  });
});
