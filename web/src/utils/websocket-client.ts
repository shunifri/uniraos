export interface WSClientOptions {
  url: string;
  token?: string;
  onEvent: (eventName: string, data: unknown) => void;
  onReplayComplete: () => void;
  onError: (error: string) => void;
  onClose: () => void;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private options: WSClientOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private subscribedStreamId: string | null = null;
  private isClosed = false;

  constructor(options: WSClientOptions) {
    this.options = options;
  }

  connect(): void {
    if (this.isClosed) return;
    const url = this.options.token
      ? `${this.options.url}?token=${encodeURIComponent(this.options.token)}`
      : this.options.url;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.startHeartbeat();
      if (this.subscribedStreamId) {
        this.subscribe(this.subscribedStreamId);
      }
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "event" && msg.eventName !== undefined) {
          this.options.onEvent(msg.eventName, msg.data);
        } else if (msg.type === "replay_complete") {
          this.options.onReplayComplete();
        } else if (msg.type === "error") {
          this.options.onError(msg.error || "Unknown WebSocket error");
        }
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.options.onClose();
      if (!this.isClosed) {
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  subscribe(streamId: string): void {
    this.subscribedStreamId = streamId;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", streamId }));
    }
  }

  disconnect(): void {
    this.isClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 25000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
