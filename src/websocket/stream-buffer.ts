export interface StreamEvent {
  eventName: string;
  data: unknown;
  timestamp: number;
}

export interface StreamBufferOptions {
  ttlMs: number;
}

export class StreamBuffer {
  private buffers = new Map<string, StreamEvent[]>();
  private subscribers = new Map<string, Set<(event: StreamEvent) => void>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private readonly ttlMs: number;

  constructor(options: StreamBufferOptions = { ttlMs: 300000 }) {
    this.ttlMs = options.ttlMs;
  }

  append(streamId: string, event: StreamEvent): void {
    let list = this.buffers.get(streamId);
    if (!list) {
      list = [];
      this.buffers.set(streamId, list);
    }
    list.push(event);

    // Push to live subscribers
    const subs = this.subscribers.get(streamId);
    if (subs) {
      for (const cb of subs) {
        try { cb(event); } catch { /* ignore subscriber errors */ }
      }
    }

    this.scheduleCleanup(streamId);
  }

  subscribe(streamId: string, callback: (event: StreamEvent) => void): () => void {
    let subs = this.subscribers.get(streamId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(streamId, subs);
    }
    subs.add(callback);
    return () => {
      subs?.delete(callback);
    };
  }

  replay(streamId: string, callback: (event: StreamEvent) => void): number {
    const list = this.buffers.get(streamId);
    if (!list) return 0;
    for (const event of list) {
      try { callback(event); } catch { /* ignore */ }
    }
    return list.length;
  }

  clear(streamId: string): void {
    this.buffers.delete(streamId);
    this.subscribers.delete(streamId);
    const timer = this.timers.get(streamId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(streamId);
    }
  }

  /** P2 调试用：列出所有 streamId 及其事件计数 (不要返事件内容, 避免泄露) */
  stats(): Array<{ streamId: string; eventCount: number; subscriberCount: number; ageMs: number }> {
    const now = Date.now();
    const results: Array<{ streamId: string; eventCount: number; subscriberCount: number; ageMs: number }> = [];
    for (const [streamId, list] of this.buffers) {
      results.push({
        streamId,
        eventCount: list.length,
        subscriberCount: this.subscribers.get(streamId)?.size ?? 0,
        ageMs: list.length > 0 ? now - list[0].timestamp : 0,
      });
    }
    return results;
  }

  /** P2 调试用：取某 stream 的最近 N 条事件 (返完整内容, admin only) */
  peek(streamId: string, limit = 50): StreamEvent[] {
    const list = this.buffers.get(streamId);
    if (!list) return [];
    return list.slice(-limit);
  }

  private scheduleCleanup(streamId: string): void {
    const existing = this.timers.get(streamId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.clear(streamId);
    }, this.ttlMs);
    this.timers.set(streamId, timer);
  }
}

// Global singleton instance
let globalBuffer: StreamBuffer | null = null;

export function getStreamBuffer(): StreamBuffer {
  if (!globalBuffer) {
    globalBuffer = new StreamBuffer();
  }
  return globalBuffer;
}

export function resetStreamBuffer(): void {
  globalBuffer = null;
}
