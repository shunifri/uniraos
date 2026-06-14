/**
 * ProfileGenerator - User profile generation and caching
 * Analyzes memory entries to extract static (stable) and dynamic (recent) facts.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import type { EnhancedLTMEntry } from "./version-chain.js";
import type { LLMProvider } from "../../llm/types.js";

/** User profile structure */
export interface UserProfile {
  userId: string;
  static: string[];
  dynamic: string[];
  generatedAt: number;
  memoryCountAtGeneration: number;
}

/** ProfileGenerator configuration */
export interface ProfileGeneratorConfig {
  /** Path to cache file */
  cachePath: string;
  /** Cache TTL in milliseconds (default: 1 hour) */
  cacheTTL?: number;
  /** Number of new entries that triggers a refresh (default: 10) */
  entryThreshold?: number;
}

/** Profile cache file structure */
interface ProfileCache {
  [userId: string]: UserProfile;
}

const DEFAULT_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const DEFAULT_ENTRY_THRESHOLD = 10;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const TEMPORAL_WORDS = [
  "today", "yesterday", "now", "currently", "recently",
  "just", "right now", "at the moment", "this week",
  "tonight", "this morning", "this afternoon",
];

/**
 * ProfileGenerator generates and caches user profiles from memory entries.
 */
export class ProfileGenerator {
  private cache: ProfileCache;
  private readonly cachePath: string;
  private readonly cacheTTL: number;
  private readonly entryThreshold: number;

  constructor(config: ProfileGeneratorConfig) {
    this.cachePath = config.cachePath;
    this.cacheTTL = config.cacheTTL ?? DEFAULT_CACHE_TTL;
    this.entryThreshold = config.entryThreshold ?? DEFAULT_ENTRY_THRESHOLD;
    this.cache = this.loadCache();
  }

  /**
   * Generate a profile from entries using LLM or rule-based fallback.
   */
  async generate(
    entries: EnhancedLTMEntry[],
    llmProvider?: LLMProvider,
    userId?: string,
  ): Promise<{ static: string[]; dynamic: string[] }> {
    if (entries.length === 0) {
      return { static: [], dynamic: [] };
    }

    const resolvedUserId = userId ?? "default";

    let result: { static: string[]; dynamic: string[] };

    if (llmProvider) {
      try {
        result = await this.generateWithLLM(entries, llmProvider);
      } catch {
        // LLM failure: fall back to rule-based
        result = this.generateRuleBased(entries);
      }
    } else {
      result = this.generateRuleBased(entries);
    }

    // Cache the result
    const profile: UserProfile = {
      userId: resolvedUserId,
      static: result.static,
      dynamic: result.dynamic,
      generatedAt: Date.now(),
      memoryCountAtGeneration: entries.length,
    };
    this.cache[resolvedUserId] = profile;
    this.saveCache();

    return result;
  }

  /**
   * Return cached profile for a user, or null if not cached.
   */
  getCached(userId: string): UserProfile | null {
    return this.cache[userId] ?? null;
  }

  /**
   * Force-regenerate profile for a user.
   */
  async refresh(
    userId: string,
    entries: EnhancedLTMEntry[],
    llmProvider?: LLMProvider,
  ): Promise<{ static: string[]; dynamic: string[] }> {
    // Remove existing cache entry so generate creates a fresh one
    delete this.cache[userId];
    return this.generate(entries, llmProvider, userId);
  }

  /**
   * Check if a cached profile is stale and needs refresh.
   * A profile is stale if:
   * - No cached profile exists
   * - Cache TTL has expired
   * - New entry count exceeds threshold
   */
  isStale(userId: string, currentEntryCount: number): boolean {
    const profile = this.cache[userId];
    if (!profile) return true;

    // TTL check
    const age = Date.now() - profile.generatedAt;
    if (age > this.cacheTTL) return true;

    // Entry threshold check
    const newEntries = currentEntryCount - profile.memoryCountAtGeneration;
    if (newEntries >= this.entryThreshold) return true;

    return false;
  }

  // ---- Private methods ----

  private async generateWithLLM(
    entries: EnhancedLTMEntry[],
    llmProvider: LLMProvider,
  ): Promise<{ static: string[]; dynamic: string[] }> {
    const entrySummaries = entries
      .filter((e) => !e.forgotten)
      .slice(0, 50) // limit context size
      .map((e) => {
        const dateStr = new Date(e.createdAt).toISOString().split("T")[0];
        return `[${dateStr}] ${e.key}: ${typeof e.value === "string" ? e.value : JSON.stringify(e.value)}`;
      })
      .join("\n");

    const prompt = `Analyze the following user memory entries and categorize facts about the user into two categories:

**Static facts**: Consistent facts that appear across multiple memories and have no time sensitivity. These are stable characteristics, preferences, or biographical details.

**Dynamic facts**: Facts from the last 7 days, containing temporal language, or representing single-occurrence states that may change.

Memory entries:
${entrySummaries}

Respond in valid JSON format only, with no other text:
{"static": ["fact1", "fact2"], "dynamic": ["fact1", "fact2"]}`;

    const response = await llmProvider.chat([
      { role: "system", content: "You are a profile analyzer. Extract user facts from memory entries. Respond only with valid JSON." },
      { role: "user", content: prompt },
    ]);

    if (!response.content) {
      throw new Error("LLM returned empty content");
    }

    const parsed = JSON.parse(response.content);
    return {
      static: Array.isArray(parsed.static) ? parsed.static : [],
      dynamic: Array.isArray(parsed.dynamic) ? parsed.dynamic : [],
    };
  }

  /**
   * Rule-based profile generation when no LLM is available.
   * Static: entries that appear multiple times (same key) or are older than 7 days.
   * Dynamic: entries within last 7 days, or containing temporal words.
   */
  private generateRuleBased(
    entries: EnhancedLTMEntry[],
  ): { static: string[]; dynamic: string[] } {
    const now = Date.now();
    const sevenDaysAgo = now - SEVEN_DAYS_MS;
    const activeEntries = entries.filter((e) => !e.forgotten);

    // Count occurrences per key
    const keyCounts = new Map<string, number>();
    for (const entry of activeEntries) {
      keyCounts.set(entry.key, (keyCounts.get(entry.key) ?? 0) + 1);
    }

    const staticFacts: string[] = [];
    const dynamicFacts: string[] = [];
    const seen = new Set<string>();

    for (const entry of activeEntries) {
      if (!entry.isLatest) continue; // Only consider latest versions

      const factStr = `${entry.key}: ${typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value)}`;
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);

      const isRecent = entry.createdAt > sevenDaysAgo;
      const valueStr = typeof entry.value === "string" ? entry.value.toLowerCase() : "";
      const hasTemporal = TEMPORAL_WORDS.some((w) => valueStr.includes(w));
      const isMultiVersion = (keyCounts.get(entry.key) ?? 0) > 1;

      if (hasTemporal || (isRecent && !isMultiVersion)) {
        dynamicFacts.push(factStr);
      } else {
        staticFacts.push(factStr);
      }
    }

    return { static: staticFacts, dynamic: dynamicFacts };
  }

  private loadCache(): ProfileCache {
    try {
      if (existsSync(this.cachePath)) {
        const data = readFileSync(this.cachePath, "utf-8");
        return JSON.parse(data) as ProfileCache;
      }
    } catch {
      // Corrupted cache file: start fresh
    }
    return {};
  }

  private saveCache(): void {
    try {
      writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), "utf-8");
    } catch {
      // Silently ignore write failures
    }
  }
}
