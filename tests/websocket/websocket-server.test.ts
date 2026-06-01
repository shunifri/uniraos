import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "http";
import type { Server } from "http";
import WebSocket from "ws";
import { createWebSocketServer, closeWebSocketServer } from "../../src/websocket/websocket-server.js";
import { getStreamBuffer, resetStreamBuffer } from "../../src/websocket/stream-buffer.js";

describe("WebSocket Server", () => {
  let httpServer: Server;
  let wsUrl: string;

  beforeAll(async () => {
    resetStreamBuffer();
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as any).port;
    wsUrl = `ws://localhost:${port}/ws`;
    createWebSocketServer(httpServer, { path: "/ws" });
  });

  afterAll(async () => {
    await closeWebSocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("should accept connections and respond to ping", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    const pongPromise = new Promise<any>((resolve) => {
      ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    });
    ws.send(JSON.stringify({ type: "ping" }));
    const msg = await pongPromise;
    expect(msg.type).toBe("pong");
    ws.close();
  });

  it("should replay buffered events on subscribe", async () => {
    const buffer = getStreamBuffer();
    buffer.append("test-stream", { eventName: "text_delta", data: { text: "Hello" }, timestamp: 1 });

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    const messages: any[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ type: "subscribe", streamId: "test-stream" }));

    await new Promise((r) => setTimeout(r, 100));
    expect(messages.some((m) => m.type === "event" && m.eventName === "text_delta")).toBe(true);
    expect(messages.some((m) => m.type === "replay_complete")).toBe(true);
    ws.close();
  });
});
