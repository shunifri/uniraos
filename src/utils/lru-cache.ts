/**
 * Simple in-memory LRU cache with TTL support.
 *
 * Uses Map insertion order for LRU tracking (ES2020+).
 */
export class LRUCache<T> {
  private cache = new Map<string, { value: T; timestamp: number }>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /** Retrieve a value and refresh its LRU position */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, { ...entry, timestamp: Date.now() });
    return entry.value;
  }

  /** Store a value */
  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Evict least recently used (first item in Map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.delete(key);
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  /** Check if a key exists and is not expired (without updating LRU order) */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /** Remove a specific key */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /** Clear all entries */
  clear(): void {
    this.cache.clear();
  }

  /** Iterate over all values (not LRU-safe) */
  *values(): Generator<T> {
    for (const entry of this.cache.values()) {
      if (Date.now() - entry.timestamp <= this.ttlMs) {
        yield entry.value;
      }
    }
  }

  /** Iterate over all entries (not LRU-safe) */
  *entries(): Generator<[string, T]> {
    for (const [key, entry] of this.cache.entries()) {
      if (Date.now() - entry.timestamp <= this.ttlMs) {
        yield [key, entry.value];
      }
    }
  }

  /** Current number of entries */
  get size(): number {
    return this.cache.size;
  }
}
