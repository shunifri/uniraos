import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  log,
  setLogLevel,
  getLogLevel,
  addLogSink,
  removeLogSink,
  type LogSink,
  type LogEntry,
} from "../../src/utils/logger";

describe("logger", () => {
  let mockSink: LogSink;
  let captured: LogEntry[];

  beforeEach(() => {
    setLogLevel("debug");
    captured = [];
    mockSink = (entry: LogEntry) => {
      captured.push(entry);
    };
    addLogSink(mockSink);
  });

  afterEach(() => {
    removeLogSink(mockSink);
    setLogLevel("info");
  });

  it("should log entry with correct level and event", () => {
    log("info", "user.login", { userId: "123" });
    expect(captured).toHaveLength(1);
    expect(captured[0].level).toBe("info");
    expect(captured[0].event).toBe("user.login");
    expect(captured[0].userId).toBe("123");
    expect(typeof captured[0].timestamp).toBe("string");
  });

  it("should not log below current level", () => {
    setLogLevel("warn");
    log("info", "should.skip");
    log("warn", "should.keep");
    expect(captured).toHaveLength(1);
    expect(captured[0].event).toBe("should.keep");
  });

  it("should get and set log level", () => {
    expect(getLogLevel()).toBe("debug");
    setLogLevel("error");
    expect(getLogLevel()).toBe("error");
  });

  it("should handle sink errors gracefully", () => {
    const badSink: LogSink = () => {
      throw new Error("sink crash");
    };
    addLogSink(badSink);
    // Should not throw
    expect(() => log("info", "test")).not.toThrow();
    removeLogSink(badSink);
  });
});
