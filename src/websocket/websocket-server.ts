import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { getStreamBuffer, StreamEvent } from "./stream-buffer.js";

export interface WSMessage {
  type: "subscribe" | "ping";
  streamId?: string;
}

export interface WSResponse {
  type: "event" | "replay_complete" | "pong" | "error";
  eventName?: string;
  data?: unknown;
  error?: string;
}

interface ClientState {
  ws: WebSocket;
  subscribedStreamId?: string;
  unsubscriber?: () => void;
  heartbeatTimer?: NodeJS.Timeout;
}

let wss: WebSocketServer | null = null;
const clients = new Set<ClientState>();

export function createWebSocketServer(
  server: HttpServer,
  options: { path?: string } = {}
): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ server, path: options.path || "/ws" });

  wss.on("connection", (ws) => {
    const client: ClientState = { ws };
    clients.add(client);

    // Heartbeat: close if no ping for 60s
    client.heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    }, 30000);

    ws.on("message", (raw) => {
      let msg: WSMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "error", error: "Invalid JSON" });
        return;
      }

      if (msg.type === "ping") {
        send(ws, { type: "pong" });
        return;
      }

      if (msg.type === "subscribe") {
        if (!msg.streamId) {
          send(ws, { type: "error", error: "streamId is required" });
          return;
        }
        handleSubscribe(client, msg.streamId);
        return;
      }

      send(ws, { type: "error", error: `Unknown type: ${(msg as any).type}` });
    });

    ws.on("close", () => cleanupClient(client));
    ws.on("error", () => cleanupClient(client));
  });

  return wss;
}

function handleSubscribe(client: ClientState, streamId: string): void {
  // Unsubscribe from previous stream
  if (client.unsubscriber) {
    client.unsubscriber();
    client.unsubscriber = undefined;
  }
  client.subscribedStreamId = streamId;

  const buffer = getStreamBuffer();

  // Replay existing events
  const count = buffer.replay(streamId, (event) => {
    send(client.ws, { type: "event", eventName: event.eventName, data: event.data });
  });

  // Signal replay complete
  send(client.ws, { type: "replay_complete" });

  // Subscribe to new events
  client.unsubscriber = buffer.subscribe(streamId, (event) => {
    send(client.ws, { type: "event", eventName: event.eventName, data: event.data });
  });
}

function send(ws: WebSocket, msg: WSResponse): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function cleanupClient(client: ClientState): void {
  clients.delete(client);
  if (client.unsubscriber) {
    client.unsubscriber();
  }
  if (client.heartbeatTimer) {
    clearInterval(client.heartbeatTimer);
  }
  try { client.ws.terminate(); } catch { /* ignore */ }
}

export async function closeWebSocketServer(): Promise<void> {
  if (!wss) return;
  for (const client of clients) {
    cleanupClient(client);
  }
  await new Promise<void>((resolve) => wss!.close(resolve));
  wss = null;
}
