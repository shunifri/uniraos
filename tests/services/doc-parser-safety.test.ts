import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("doc-parser safeReadFile (P1)", () => {
  const tmpDir = join(tmpdir(), "doc-parser-test-" + Date.now());

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should read files within size limit", async () => {
    const filePath = join(tmpDir, "small.txt");
    writeFileSync(filePath, "hello world");

    // Import the module fresh to test the fixed function
    const { safeReadFile } = await import("../../src/services/doc-parser.js");
    const buffer = safeReadFile(filePath);
    expect(buffer.toString()).toBe("hello world");
  });

  it("should reject files exceeding 100MB limit", async () => {
    const filePath = join(tmpDir, "huge.txt");
    // Create a sparse file or mock the stat
    // We'll create an actual file just over the limit
    const MAX_PARSE_FILE_SIZE = 100 * 1024 * 1024;
    const bigContent = Buffer.alloc(MAX_PARSE_FILE_SIZE + 1, "x");
    writeFileSync(filePath, bigContent);

    const { safeReadFile } = await import("../../src/services/doc-parser.js");
    expect(() => safeReadFile(filePath)).toThrow("File too large to parse");
  });
});
