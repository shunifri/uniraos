import { describe, it, expect, vi } from "vitest";
import { StreamBuffer } from "../../src/websocket/stream-buffer.js";

describe("StreamBuffer", () => {
  it("should append and replay events", () => {
    const buffer = new StreamBuffer({ ttlMs: 5000 });
    buffer.append("s1", { eventName: "text_delta", data: { text: "Hello" }, timestamp: 1 });
    buffer.append("s1", { eventName: "text_delta", data: { text: " world" }, timestamp: 2 });

    const replayed: any[] = [];
    const count = buffer.replay("s1", (e) => replayed.push(e));
    expect(count).toBe(2);
    expect(replayed).toHaveLength(2);
    expect(replayed[0].data.text).toBe("Hello");
    expect(replayed[1].data.text).toBe(" world");
  });

  it("should subscribe and receive new events", () => {
    const buffer = new StreamBuffer({ ttlMs: 5000 });
    const received: any[] = [];
    const unsub = buffer.subscribe("s1", (e) => received.push(e));

    buffer.append("s1", { eventName: "text_delta", data: { text: "A" }, timestamp: 1 });
    expect(received).toHaveLength(1);
    expect(received[0].data.text).toBe("A");

    unsub();
    buffer.append("s1", { eventName: "text_delta", data: { text: "B" }, timestamp: 2 });
    expect(received).toHaveLength(1);
  });

  it("should clear buffer and stop subscribers", () => {
    const buffer = new StreamBuffer({ ttlMs: 5000 });
    const received: any[] = [];
    buffer.subscribe("s1", (e) => received.push(e));

    buffer.append("s1", { eventName: "text_delta", data: { text: "X" }, timestamp: 1 });
    buffer.clear("s1");
    buffer.append("s1", { eventName: "text_delta", data: { text: "Y" }, timestamp: 2 });
    expect(received).toHaveLength(1);
  });

  it("should auto-expire after TTL", async () => {
    const buffer = new StreamBuffer({ ttlMs: 50 });
    buffer.append("s1", { eventName: "text_delta", data: { text: "X" }, timestamp: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect(buffer.replay("s1", () => {})).toBe(0);
  });
});
